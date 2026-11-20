//! # C-043 — Emergency Multisig for Admin Operations
//!
//! This contract implements an M-of-N multisig guard for admin operations
//! across all ACBU contracts.
//!
//! ## Architecture
//!
//! Each protected contract stores the address of **this** multisig contract as
//! its `ADMIN` key.  When an admin-only function calls `admin.require_auth()`,
//! Soroban only accepts the multisig as authoriser while the multisig contract
//! is the caller of that invocation.  `execute()` therefore performs the
//! approved call itself, after M-of-N signers have approved the proposal via
//! `approve()`.
//!
//! ## Proposal lifecycle (AC-010)
//!
//! 1. Any signer calls `propose(target, action)` → returns `proposal_id`.
//!    The target contract and the typed [`MultisigAction`] are stored on the
//!    proposal, so the approval is scoped to one specific call.
//! 2. Each of the M required signers calls `approve(proposal_id)`.
//! 3. Once the threshold is reached, any signer calls `execute(proposal_id)`.
//!    The contract invokes **exactly** the stored `target` + `action` on its
//!    own behalf, then emits `ProposalExecutedEvent` and marks the proposal
//!    done.  A proposal approved for e.g. `pause` can therefore never be used
//!    to reach another admin function.
//!
//! ## Self-governance (AC-006)
//!
//! The multisig's own signer set and WASM are changed through proposals that
//! carry the action's parameters: `propose_update_config` and
//! `propose_upgrade`. Once such a proposal reaches the threshold, `execute`
//! applies the bound action itself. There is no separate entry point gated on
//! `current_contract_address().require_auth()` — that auth can only be
//! satisfied by the contract invoking itself, which never happens, so it
//! would lock the signer set and WASM forever.
//!
//! ## Expiry
//!
//! Proposals expire after `PROPOSAL_TTL_SECONDS` (48 hours by default).
//! Expired proposals cannot be approved or executed.

#![no_std]

use core::fmt::{self, Display};
use soroban_sdk::{
    contract, contractimpl, contractmeta, contracttype, symbol_short, Address, BytesN, Env, Vec,
};

use shared::{
    AdminProposal, ConfigArgs, DataKey as SharedDataKey, MultisigAction, MultisigConfig,
    ProposalApprovedEvent, ProposalCreatedEvent, ProposalExecutedEvent, UpgradeArgs,
    CONTRACT_VERSION,
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Proposals expire after 48 hours if not executed.
const PROPOSAL_TTL_SECONDS: u64 = 172_800;

/// Maximum number of signers to keep gas costs bounded.
const MAX_SIGNERS: u32 = 20;

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    /// MultisigConfig (signers + threshold)
    Config,
    /// Next proposal ID counter
    NextId,
    /// AdminProposal keyed by proposal_id (u64)
    Proposal(u64),
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[soroban_sdk::contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 4001,
    NotInitialized = 4002,
    Unauthorized = 4003,
    ProposalNotFound = 4004,
    AlreadyApproved = 4005,
    AlreadyExecuted = 4006,
    Expired = 4007,
    ThresholdNotMet = 4008,
    InvalidThreshold = 4009,
    TooManySigners = 4010,
    EmptySigners = 4011,
    DuplicateSigner = 4012,
    Unknown = 4999,
}

impl Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::AlreadyInitialized => "multisig already initialized",
            Self::NotInitialized => "multisig not initialized",
            Self::Unauthorized => "unauthorized",
            Self::ProposalNotFound => "proposal not found",
            Self::AlreadyApproved => "proposal already approved",
            Self::AlreadyExecuted => "proposal already executed",
            Self::Expired => "proposal expired",
            Self::ThresholdNotMet => "approval threshold not met",
            Self::InvalidThreshold => "invalid threshold",
            Self::TooManySigners => "too many signers",
            Self::EmptySigners => "signers list cannot be empty",
            Self::DuplicateSigner => "duplicate signer",
            Self::Unknown => "unknown multisig error",
        };
        f.write_str(message)
    }
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

contractmeta!(key = "version", val = "1");

#[contract]
pub struct MultisigContract;

#[contractimpl]
impl MultisigContract {
    // -----------------------------------------------------------------------
    // Initialisation
    // -----------------------------------------------------------------------

    /// Initialise the multisig with a list of signers and an M-of-N threshold.
    ///
    /// * `signers`   — ordered list of authorised signer addresses (1–20).
    /// * `threshold` — minimum approvals required (1 ≤ threshold ≤ signers.len()).
    pub fn initialize(env: Env, signers: Vec<Address>, threshold: u32) {
        if env.storage().instance().has(&DataKey::Config) {
            env.panic_with_error(Error::AlreadyInitialized);
        }

        Self::validate_config(&env, &signers, threshold);

        let config = MultisigConfig { signers, threshold };
        env.storage().instance().set(&DataKey::Config, &config);
        env.storage().instance().set(&DataKey::NextId, &0u64);
        env.storage()
            .instance()
            .set(&SharedDataKey::Version, &CONTRACT_VERSION);
    }

    // -----------------------------------------------------------------------
    // Proposal lifecycle
    // -----------------------------------------------------------------------

    /// Create a new proposal authorising `action` on `target`.
    ///
    /// The proposer must be a registered signer.  The full `(target, action)`
    /// pair is stored on the proposal, so later approvals — and the eventual
    /// execution — are scoped to exactly that call.
    ///
    /// Returns the new `proposal_id`.
    pub fn propose(env: Env, proposer: Address, target: Address, action: MultisigAction) -> u64 {
        Self::create_proposal(&env, proposer, target, action)
    }

    /// Propose replacing the signer list and threshold (AC-006).
    ///
    /// The new config is validated now and bound to the proposal; `execute`
    /// applies it once the current threshold is met. Returns the `proposal_id`.
    pub fn propose_update_config(
        env: Env,
        proposer: Address,
        new_signers: Vec<Address>,
        new_threshold: u32,
    ) -> u64 {
        let action = MultisigAction::UpdateConfig(ConfigArgs {
            signers: new_signers,
            threshold: new_threshold,
        });
        Self::create_proposal(&env, proposer, env.current_contract_address(), action)
    }

    /// Propose upgrading this contract to `new_wasm_hash` (AC-006).
    ///
    /// The stored version is bumped by one and bound to the proposal; `execute`
    /// performs the upgrade once the threshold is met. Returns the
    /// `proposal_id`.
    pub fn propose_upgrade(env: Env, proposer: Address, new_wasm_hash: BytesN<32>) -> u64 {
        let current_version: u32 = env
            .storage()
            .instance()
            .get(&SharedDataKey::Version)
            .unwrap_or(0);
        let action = MultisigAction::Upgrade(UpgradeArgs {
            new_wasm_hash,
            new_version: current_version + 1,
        });
        Self::create_proposal(&env, proposer, env.current_contract_address(), action)
    }

    fn create_proposal(
        env: &Env,
        proposer: Address,
        target: Address,
        action: MultisigAction,
    ) -> u64 {
        proposer.require_auth();
        let config = Self::load_config(env);
        Self::assert_is_signer(env, &proposer, &config);

        // Self-governance actions may only target this contract, and the bound
        // config must be valid at proposal time so a malformed rotation can
        // never reach `execute` (AC-006).
        if let MultisigAction::UpdateConfig(args) = &action {
            if target != env.current_contract_address() {
                env.panic_with_error(Error::Unauthorized);
            }
            Self::validate_config(env, &args.signers, args.threshold);
        }

        let proposal_id: u64 = env.storage().instance().get(&DataKey::NextId).unwrap_or(0);

        let expires_at = env.ledger().timestamp() + PROPOSAL_TTL_SECONDS;

        // The proposer's approval is counted immediately.
        let mut approvals = Vec::new(env);
        approvals.push_back(proposer.clone());

        let proposal = AdminProposal {
            target: target.clone(),
            action: action.clone(),
            approvals,
            executed: false,
            expires_at,
        };

        env.storage()
            .instance()
            .set(&DataKey::Proposal(proposal_id), &proposal);
        env.storage()
            .instance()
            .set(&DataKey::NextId, &(proposal_id + 1));

        env.events().publish(
            (symbol_short!("proposed"),),
            ProposalCreatedEvent {
                proposal_id,
                proposer,
                target,
                action,
                expires_at,
            },
        );

        proposal_id
    }

    /// Approve an existing proposal.  The approver must be a registered signer
    /// who has not already approved this proposal.
    pub fn approve(env: Env, approver: Address, proposal_id: u64) {
        approver.require_auth();
        let config = Self::load_config(&env);
        Self::assert_is_signer(&env, &approver, &config);

        let mut proposal: AdminProposal = env
            .storage()
            .instance()
            .get(&DataKey::Proposal(proposal_id))
            .unwrap_or_else(|| env.panic_with_error(Error::ProposalNotFound));

        if proposal.executed {
            env.panic_with_error(Error::AlreadyExecuted);
        }
        if env.ledger().timestamp() > proposal.expires_at {
            env.panic_with_error(Error::Expired);
        }

        // Reject duplicate approvals from the same signer.
        for existing in proposal.approvals.iter() {
            if existing == approver {
                env.panic_with_error(Error::AlreadyApproved);
            }
        }

        proposal.approvals.push_back(approver.clone());
        let approval_count = proposal.approvals.len();

        env.storage()
            .instance()
            .set(&DataKey::Proposal(proposal_id), &proposal);

        env.events().publish(
            (symbol_short!("approved"),),
            ProposalApprovedEvent {
                proposal_id,
                approver,
                approval_count,
            },
        );
    }

    /// Execute a proposal that has reached the approval threshold.
    ///
    /// The executor must be a registered signer.  The contract performs exactly
    /// the `target` + `action` stored on the proposal, on its own behalf, so
    /// the call performed is bound to what the signers approved (AC-010).
    /// After this call the proposal is marked executed and cannot be
    /// re-executed.
    pub fn execute(env: Env, executor: Address, proposal_id: u64) {
        executor.require_auth();
        let config = Self::load_config(&env);
        Self::assert_is_signer(&env, &executor, &config);

        let mut proposal: AdminProposal = env
            .storage()
            .instance()
            .get(&DataKey::Proposal(proposal_id))
            .unwrap_or_else(|| env.panic_with_error(Error::ProposalNotFound));

        if proposal.executed {
            env.panic_with_error(Error::AlreadyExecuted);
        }
        if env.ledger().timestamp() > proposal.expires_at {
            env.panic_with_error(Error::Expired);
        }
        for addr in proposal.approvals.iter() {
            Self::assert_is_signer(&env, &addr, &config);
        }
        if proposal.approvals.len() < config.threshold {
            env.panic_with_error(Error::ThresholdNotMet);
        }

        // Commit the executed flag before applying the action so the proposal
        // cannot be replayed even if the target re-enters this contract.  A
        // failure in the applied action reverts the whole transaction,
        // including this write.
        proposal.executed = true;
        env.storage()
            .instance()
            .set(&DataKey::Proposal(proposal_id), &proposal);

        // Perform exactly the approved action.  For any other contract the
        // multisig is the caller, so the target's `admin.require_auth()` —
        // where `admin` is this contract — is satisfied, and only for this
        // stored invocation.  Actions that administer the multisig itself are
        // applied in-process: Soroban forbids contract re-entry, so they
        // cannot go through a self-directed cross-contract call (AC-006).
        let self_address = env.current_contract_address();
        match (&proposal.target, &proposal.action) {
            (target, MultisigAction::UpdateConfig(args)) if *target == self_address => {
                // Re-validate: the bound config was checked at proposal time,
                // but keep the invariant local to the write.
                Self::validate_config(&env, &args.signers, args.threshold);
                let new_config = MultisigConfig {
                    signers: args.signers.clone(),
                    threshold: args.threshold,
                };
                env.storage().instance().set(&DataKey::Config, &new_config);
                env.events()
                    .publish((symbol_short!("cfg_upd"), proposal_id), new_config);
            }
            (target, MultisigAction::Upgrade(args)) if *target == self_address => {
                env.events()
                    .publish((symbol_short!("upgraded"), proposal_id), args.new_wasm_hash.clone());
                env.deployer()
                    .update_current_contract_wasm(args.new_wasm_hash.clone());
                env.storage()
                    .instance()
                    .set(&SharedDataKey::Version, &args.new_version);
            }
            (target, action) => action.invoke(&env, target),
        }

        env.events().publish(
            (symbol_short!("executed"),),
            ProposalExecutedEvent {
                proposal_id,
                target: proposal.target,
                action: proposal.action,
                executed_by: executor,
            },
        );
    }

    // -----------------------------------------------------------------------
    // Read-only helpers
    // -----------------------------------------------------------------------

    /// Return the current multisig configuration (signer list and threshold).
    pub fn get_config(env: Env) -> MultisigConfig {
        Self::load_config(&env)
    }

    /// Return the proposal identified by `proposal_id`, panicking with
    /// `ProposalNotFound` if it does not exist.
    pub fn get_proposal(env: Env, proposal_id: u64) -> AdminProposal {
        env.storage()
            .instance()
            .get(&DataKey::Proposal(proposal_id))
            .unwrap_or_else(|| env.panic_with_error(Error::ProposalNotFound))
    }

    /// Return the action bound to `proposal_id`, or `None` if no such
    /// proposal exists.  Every proposal is bound to a typed action at creation
    /// time (AC-010) — self-governance proposals included.
    pub fn get_action(env: Env, proposal_id: u64) -> Option<MultisigAction> {
        let proposal: AdminProposal = env
            .storage()
            .instance()
            .get(&DataKey::Proposal(proposal_id))?;
        Some(proposal.action)
    }

    /// Return the id that will be assigned to the next created proposal.
    pub fn get_next_id(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::NextId).unwrap_or(0)
    }

    /// Return `true` if `address` is one of the configured signers.
    pub fn is_signer(env: Env, address: Address) -> bool {
        let config = Self::load_config(&env);
        for s in config.signers.iter() {
            if s == address {
                return true;
            }
        }
        false
    }

    /// Return the number of approvals recorded for `proposal_id`, panicking with
    /// `ProposalNotFound` if it does not exist.
    pub fn approval_count(env: Env, proposal_id: u64) -> u32 {
        let proposal: AdminProposal = env
            .storage()
            .instance()
            .get(&DataKey::Proposal(proposal_id))
            .unwrap_or_else(|| env.panic_with_error(Error::ProposalNotFound));
        proposal.approvals.len()
    }

    /// Return the stored contract version (0 if never set).
    pub fn version(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&SharedDataKey::Version)
            .unwrap_or(0)
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    fn load_config(env: &Env) -> MultisigConfig {
        env.storage()
            .instance()
            .get(&DataKey::Config)
            .unwrap_or_else(|| env.panic_with_error(Error::NotInitialized))
    }

    fn assert_is_signer(env: &Env, address: &Address, config: &MultisigConfig) {
        for s in config.signers.iter() {
            if &s == address {
                return;
            }
        }
        env.panic_with_error(Error::Unauthorized);
    }

    fn validate_config(env: &Env, signers: &Vec<Address>, threshold: u32) {
        if signers.is_empty() {
            env.panic_with_error(Error::EmptySigners);
        }
        if signers.len() > MAX_SIGNERS {
            env.panic_with_error(Error::TooManySigners);
        }
        // Threshold must be at least 1 and at most the number of signers.
        // A threshold of 0 would allow proposals to execute with zero approvals.
        if threshold < 1 || threshold > signers.len() {
            env.panic_with_error(Error::InvalidThreshold);
        }
        // Reject duplicate signers.
        let n = signers.len();
        for i in 0..n {
            for j in (i + 1)..n {
                if signers.get(i).unwrap() == signers.get(j).unwrap() {
                    env.panic_with_error(Error::DuplicateSigner);
                }
            }
        }
    }
}
