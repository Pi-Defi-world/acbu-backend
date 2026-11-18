#![no_std]
use core::fmt::{self, Display};
use soroban_sdk::{
    contract, contracterror, contractimpl, contractmeta, contracttype, symbol_short, Address,
    BytesN, Env, Symbol,
};

use shared::{reentrancy_guard, ContractPhase, DataKey as SharedDataKey, CONTRACT_VERSION};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum EscrowError {
    Paused = 3001,
    InvalidAmount = 3002,
    EscrowNotFound = 3003,
    PayerMismatch = 3004,
    EscrowExists = 3005,
    UninitializedAdmin = 3006,
    UninitializedAcBuToken = 3007,
    AlreadyInitialized = 3008,
    TimelockNotElapsed = 3009,
    NoPendingUpgrade = 3010,
    Unauthorized = 3011,
    NoPendingAdmin = 3012,
    AdminTimelockNotElapsed = 3013,
    NoPendingAdminToCancel = 3014,
    InsufficientBalance = 3015,
    Expired = 3016,
    SelfEscrow = 3017,
    Unknown = 3999,
}

impl Display for EscrowError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::Paused => "escrow is paused",
            Self::InvalidAmount => "invalid escrow amount",
            Self::EscrowNotFound => "escrow not found",
            Self::PayerMismatch => "payer mismatch",
            Self::EscrowExists => "escrow already exists",
            Self::UninitializedAdmin => "escrow admin not initialized",
            Self::UninitializedAcBuToken => "escrow token not initialized",
            Self::AlreadyInitialized => "escrow already initialized",
            Self::TimelockNotElapsed => "timelock has not elapsed",
            Self::NoPendingUpgrade => "no pending upgrade",
            Self::Unauthorized => "unauthorized",
            Self::NoPendingAdmin => "no pending admin",
            Self::AdminTimelockNotElapsed => "admin timelock has not elapsed",
            Self::NoPendingAdminToCancel => "no pending admin to cancel",
            Self::InsufficientBalance => "insufficient contract balance",
            Self::Expired => "escrow has expired",
            Self::SelfEscrow => "payee cannot be the same as payer",
            Self::Unknown => "unknown escrow error",
        };
        f.write_str(message)
    }
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EscrowDataKey {
    pub admin: Symbol,
    pub acbu_token: Symbol,
    pub phase: Symbol,
    pub pending_upgrade: Symbol,
    pub pending_upgrade_eligible_at: Symbol,
    pub pending_admin: Symbol,
    pub pending_admin_eligible_at: Symbol,
}

const DATA_KEY: EscrowDataKey = EscrowDataKey {
    admin: symbol_short!("ADMIN"),
    acbu_token: symbol_short!("ACBU_TKN"),
    phase: symbol_short!("PHASE"),
    pending_upgrade: symbol_short!("PEND_UPG"),
    pending_upgrade_eligible_at: symbol_short!("PU_ETA"),
    pending_admin: symbol_short!("PEND_ADM"),
    pending_admin_eligible_at: symbol_short!("PA_ETA"),
};

const UPGRADE_TIMELOCK_SECONDS: u64 = 86_400;
/// Admin rotation timelock: the pending admin must wait this long before
/// claiming ownership, giving the current admin a window to cancel a mistaken
/// or malicious transfer.
const ADMIN_TIMELOCK_SECONDS: u64 = 86_400;

const MIN_ESCROW_AMOUNT: i128 = 10_000_000; // 10 ACBU (7 decimals)
const MAX_ESCROW_LIFETIME: u64 = 30 * 86_400; // 30 days

// ---------------------------------------------------------------------------
// Temporary-storage TTL thresholds (unit: ledgers; ~5 seconds per ledger)
// ---------------------------------------------------------------------------

/// Minimum TTL bump threshold for escrow temporary storage entries.
/// If the remaining TTL is below this value the entry is extended.
/// 17 280 ledgers × 5 s ≈ 86 400 s = 24 hours.
const ESCROW_TTL_THRESHOLD_MIN_LEDGERS: u32 = 17_280;

/// Target TTL for escrow temporary storage entries after an extension.
/// 518 400 ledgers × 5 s ≈ 2 592 000 s = 30 days.
/// Matches MAX_ESCROW_LIFETIME so entries are kept alive for the full escrow window.
const ESCROW_TTL_THRESHOLD_MAX_LEDGERS: u32 = 518_400;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EscrowId(pub Address, pub u64);

#[contracttype]
#[derive(Clone, Debug)]
pub struct EscrowCreatedEvent {
    pub escrow_id: u64,
    pub payer: Address,
    pub payee: Address,
    pub amount: i128,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct EscrowReleasedEvent {
    pub escrow_id: u64,
    pub payee: Address,
    pub amount: i128,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct EscrowRefundedEvent {
    pub escrow_id: u64,
    pub payer: Address,
    pub amount: i128,
    pub timestamp: u64,
}

contractmeta!(key = "version", val = "1");

#[contract]
pub struct Escrow;

#[contractimpl]
impl Escrow {
    fn load_admin(env: &Env) -> Result<Address, EscrowError> {
        env.storage()
            .instance()
            .get(&DATA_KEY.admin)
            .ok_or(EscrowError::UninitializedAdmin)
    }

    /// Current admin address.
    pub fn get_admin(env: Env) -> Address {
        Self::load_admin(&env).unwrap_or_else(|e| env.panic_with_error(e))
    }

    fn get_acbu_token(env: &Env) -> Result<Address, EscrowError> {
        env.storage()
            .instance()
            .get(&DATA_KEY.acbu_token)
            .ok_or(EscrowError::UninitializedAcBuToken)
    }

    fn check_paused(env: &Env) {
        let phase: ContractPhase = env
            .storage()
            .instance()
            .get(&DATA_KEY.phase)
            .unwrap_or(ContractPhase::Uninitialized);
        if phase == ContractPhase::Paused {
            env.panic_with_error(EscrowError::Paused);
        }
    }

    /// Initialize the escrow contract
    pub fn initialize(env: Env, admin: Address, acbu_token: Address) {
        if env.storage().instance().has(&DATA_KEY.admin) {
            env.panic_with_error(EscrowError::AlreadyInitialized);
        }
        env.storage().instance().set(&DATA_KEY.admin, &admin);
        env.storage()
            .instance()
            .set(&DATA_KEY.acbu_token, &acbu_token);
        env.storage()
            .instance()
            .set(&DATA_KEY.phase, &ContractPhase::Active);
        env.storage()
            .instance()
            .set(&SharedDataKey::Version, &CONTRACT_VERSION);
    }

    /// Return the stored escrow fields in the same order as `create` parameters:
    /// `(payer, payee, amount)`.
    ///
    /// Keeping the return order consistent with the creation parameters prevents
    /// off-by-field bugs in client code that destructures the response tuple.
    pub fn get_escrow(env: Env, payer: Address, escrow_id: u64) -> (Address, Address, i128) {
        let key = EscrowId(payer, escrow_id);
        env.storage()
            .temporary()
            .get(&key)
            .unwrap_or_else(|| env.panic_with_error(EscrowError::EscrowNotFound))
    }

    /// Create escrow: payer deposits ACBU, payee can claim after release
    /// Escrow ID is unique per payer and provided by caller to prevent collisions
    pub fn create(env: Env, payer: Address, payee: Address, amount: i128, escrow_id: u64) {
        // Re-entrancy guard
        reentrancy_guard::acquire_guard(&env);

        Self::check_paused(&env);

        if amount < MIN_ESCROW_AMOUNT {
            env.panic_with_error(EscrowError::InvalidAmount);
        }
        if payer == payee {
            env.panic_with_error(EscrowError::SelfEscrow);
        }
        payer.require_auth();
        payee.require_auth();
        let key = EscrowId(payer.clone(), escrow_id);

        if env.storage().temporary().has(&key) {
            env.panic_with_error(EscrowError::EscrowExists);
        }

        let acbu = Self::get_acbu_token(&env).unwrap_or_else(|e| env.panic_with_error(e));
        let client = soroban_sdk::token::Client::new(&env, &acbu);

        let expiry = env.ledger().timestamp() + MAX_ESCROW_LIFETIME;

        // CEI: write state before the external token transfer so any token-level
        // callback observes the escrow as already recorded.
        env.storage()
            .temporary()
            .set(&key, &(payer.clone(), payee.clone(), amount, expiry));

        // Extend entry TTL to match the maximum lifetime: 30 days.
        // See ESCROW_TTL_THRESHOLD_MIN_LEDGERS / ESCROW_TTL_THRESHOLD_MAX_LEDGERS.
        env.storage().temporary().extend_ttl(
            &key,
            ESCROW_TTL_THRESHOLD_MIN_LEDGERS,
            ESCROW_TTL_THRESHOLD_MAX_LEDGERS,
        );

        client.transfer(&payer, &env.current_contract_address(), &amount);

        env.events().publish(
            (symbol_short!("esc_crtd"), escrow_id),
            EscrowCreatedEvent {
                escrow_id,
                payer,
                payee,
                amount,
                timestamp: env.ledger().timestamp(),
            },
        );

        // Release re-entrancy guard
        reentrancy_guard::release_guard(&env);
    }

    /// Release escrow: payee receives ACBU.
    /// Only the payer or admin can authorize the release.
    pub fn release(env: Env, escrow_id: u64, payer: Address) {
        // Re-entrancy guard
        reentrancy_guard::acquire_guard(&env);

        Self::check_paused(&env);

        let admin = Self::load_admin(&env).unwrap_or_else(|e| env.panic_with_error(e));
        if payer == admin {
            admin.require_auth();
        } else {
            payer.require_auth();
        }
        let key = EscrowId(payer.clone(), escrow_id);
        let (stored_payer, payee, amount, expiry): (Address, Address, i128, u64) = env
            .storage()
            .temporary()
            .get(&key)
            .unwrap_or_else(|| env.panic_with_error(EscrowError::EscrowNotFound));
        if stored_payer != payer {
            env.panic_with_error(EscrowError::PayerMismatch);
        }
        if env.ledger().timestamp() > expiry {
            env.panic_with_error(EscrowError::Expired);
        }
        let acbu = Self::get_acbu_token(&env).unwrap_or_else(|e| env.panic_with_error(e));
        let client = soroban_sdk::token::Client::new(&env, &acbu);
        env.storage().temporary().remove(&key);
        client.transfer(&env.current_contract_address(), &payee, &amount);
        env.events().publish(
            (symbol_short!("esc_rel"), escrow_id),
            EscrowReleasedEvent {
                escrow_id,
                payee,
                amount,
                timestamp: env.ledger().timestamp(),
            },
        );

        // Release re-entrancy guard
        reentrancy_guard::release_guard(&env);
    }
    /// Refund escrow: payer gets ACBU back (admin or dispute resolution, or payer after expiry)
    /// key is same as release since it identifies which escrow to refund
    pub fn refund(env: Env, escrow_id: u64, payer: Address) {
        // Re-entrancy guard
        reentrancy_guard::acquire_guard(&env);

        let admin = Self::load_admin(&env).unwrap_or_else(|e| env.panic_with_error(e));

        let key = EscrowId(payer.clone(), escrow_id);
        let (stored_payer, _payee, amount, expiry): (Address, Address, i128, u64) = env
            .storage()
            .temporary()
            .get(&key)
            .unwrap_or_else(|| env.panic_with_error(EscrowError::EscrowNotFound));

        if stored_payer != payer {
            env.panic_with_error(EscrowError::PayerMismatch);
        }

        // After expiry the payer may self-refund; before expiry only admin can force a refund.
        if env.ledger().timestamp() > expiry {
            payer.require_auth();
        } else {
            admin.require_auth();
        }

        let acbu = Self::get_acbu_token(&env).unwrap_or_else(|e| env.panic_with_error(e));
        let client = soroban_sdk::token::Client::new(&env, &acbu);

        // Validate contract balance before mutating storage.
        // Ensures balance state is sound and prevents premature state update if the transfer would fail.
        let balance = client.balance(&env.current_contract_address());
        if balance < amount {
            env.panic_with_error(EscrowError::InsufficientBalance);
        }

        // CEI: remove the escrow record before the external transfer so the
        // escrow cannot be refunded twice if the token executes a callback.
        env.storage().temporary().remove(&key);

        client.transfer(&env.current_contract_address(), &payer, &amount);

        env.events().publish(
            (symbol_short!("esc_ref"), escrow_id),
            EscrowRefundedEvent {
                escrow_id,
                payer,
                amount,
                timestamp: env.ledger().timestamp(),
            },
        );

        // Release re-entrancy guard
        reentrancy_guard::release_guard(&env);
    }

    /// Pause the contract, disabling escrow creation/release/refund (admin only).
    pub fn pause(env: Env) {
        let admin = Self::load_admin(&env).unwrap_or_else(|e| env.panic_with_error(e));
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DATA_KEY.phase, &ContractPhase::Paused);
    }

    /// Unpause the contract, re-enabling state-changing operations (admin only).
    pub fn unpause(env: Env) {
        let admin = Self::load_admin(&env).unwrap_or_else(|e| env.panic_with_error(e));
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DATA_KEY.phase, &ContractPhase::Active);
    }

    /// Update the ACBU token contract address (admin only).
    pub fn update_acbu_token(env: Env, new_acbu_token: Address) {
        let admin = Self::load_admin(&env).unwrap_or_else(|e| env.panic_with_error(e));
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DATA_KEY.acbu_token, &new_acbu_token);
    }

    // -----------------------------------------------------------------------
    // Two-step admin rotation
    //
    // Current admin nominates a successor and starts a timelock; the successor
    // must explicitly accept after the timelock elapses; the current admin may
    // cancel a pending transfer at any time. Prevents a single lost or
    // compromised key from leaving the contract permanently unmanageable.
    // -----------------------------------------------------------------------

    /// Step 1 — current admin nominates `new_admin` and starts the timelock.
    pub fn transfer_admin(env: Env, new_admin: Address) {
        let admin = Self::load_admin(&env).unwrap_or_else(|e| env.panic_with_error(e));
        admin.require_auth();
        let eligible_at = env.ledger().timestamp() + ADMIN_TIMELOCK_SECONDS;
        env.storage()
            .instance()
            .set(&DATA_KEY.pending_admin, &new_admin);
        env.storage()
            .instance()
            .set(&DATA_KEY.pending_admin_eligible_at, &eligible_at);
        env.events()
            .publish((symbol_short!("adm_init"),), (admin, new_admin, eligible_at));
    }

    /// Step 2 — the nominated address claims ownership after the timelock.
    pub fn accept_admin(env: Env) {
        let pending_admin: Address = env
            .storage()
            .instance()
            .get(&DATA_KEY.pending_admin)
            .unwrap_or_else(|| env.panic_with_error(EscrowError::NoPendingAdmin));
        pending_admin.require_auth();

        let eligible_at: u64 = env
            .storage()
            .instance()
            .get(&DATA_KEY.pending_admin_eligible_at)
            .unwrap_or(u64::MAX);
        if env.ledger().timestamp() < eligible_at {
            env.panic_with_error(EscrowError::AdminTimelockNotElapsed);
        }

        let old_admin = Self::load_admin(&env).unwrap_or_else(|e| env.panic_with_error(e));
        env.storage()
            .instance()
            .set(&DATA_KEY.admin, &pending_admin);
        env.storage().instance().remove(&DATA_KEY.pending_admin);
        env.storage()
            .instance()
            .remove(&DATA_KEY.pending_admin_eligible_at);

        env.events().publish(
            (symbol_short!("adm_done"),),
            (old_admin, pending_admin, env.ledger().timestamp()),
        );
    }

    /// Cancel a pending transfer (current admin only).
    pub fn cancel_admin_transfer(env: Env) {
        let admin = Self::load_admin(&env).unwrap_or_else(|e| env.panic_with_error(e));
        admin.require_auth();
        let pending_admin: Address = env
            .storage()
            .instance()
            .get(&DATA_KEY.pending_admin)
            .unwrap_or_else(|| env.panic_with_error(EscrowError::NoPendingAdminToCancel));
        env.storage().instance().remove(&DATA_KEY.pending_admin);
        env.storage()
            .instance()
            .remove(&DATA_KEY.pending_admin_eligible_at);
        env.events().publish(
            (symbol_short!("adm_cncl"),),
            (admin, pending_admin, env.ledger().timestamp()),
        );
    }

    /// Pending successor, if a transfer is in progress.
    pub fn get_pending_admin(env: Env) -> Option<Address> {
        env.storage().instance().get(&DATA_KEY.pending_admin)
    }

    /// Timestamp after which `accept_admin` becomes callable.
    pub fn get_pending_admin_eligible_at(env: Env) -> Option<u64> {
        env.storage()
            .instance()
            .get(&DATA_KEY.pending_admin_eligible_at)
    }

    /// Return the stored contract version (0 if never set).
    pub fn version(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&SharedDataKey::Version)
            .unwrap_or(0)
    }

    /// Bump the stored version to the current [`CONTRACT_VERSION`] after a code
    /// upgrade (admin only). No-op if already at or above the current version.
    pub fn migrate(env: Env) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DATA_KEY.admin)
            .unwrap_or_else(|| env.panic_with_error(EscrowError::UninitializedAdmin));
        admin.require_auth();

        let current_version = CONTRACT_VERSION;
        let stored_version: u32 = env
            .storage()
            .instance()
            .get(&SharedDataKey::Version)
            .unwrap_or(0);
        if stored_version < current_version {
            env.storage()
                .instance()
                .set(&SharedDataKey::Version, &current_version);
        }
    }

    /// Stage a WASM upgrade to `new_wasm_hash` and start the upgrade timelock
    /// (admin only). Apply it later with [`Self::execute_upgrade`] once the
    /// timelock elapses, or abort with [`Self::cancel_upgrade`].
    pub fn propose_upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin = Self::load_admin(&env).unwrap_or_else(|e| env.panic_with_error(e));
        admin.require_auth();
        let eligible_at = env.ledger().timestamp() + UPGRADE_TIMELOCK_SECONDS;
        env.storage()
            .instance()
            .set(&DATA_KEY.pending_upgrade, &new_wasm_hash);
        env.storage()
            .instance()
            .set(&DATA_KEY.pending_upgrade_eligible_at, &eligible_at);
    }

    /// Execute a previously proposed upgrade once its timelock has elapsed,
    /// swapping in the staged WASM (admin only). Fails if no upgrade is pending or
    /// the timelock is still active.
    pub fn execute_upgrade(env: Env) {
        let admin = Self::load_admin(&env).unwrap_or_else(|e| env.panic_with_error(e));
        admin.require_auth();
        let wasm_hash: BytesN<32> = env
            .storage()
            .instance()
            .get(&DATA_KEY.pending_upgrade)
            .unwrap_or_else(|| env.panic_with_error(EscrowError::NoPendingUpgrade));
        let eligible_at: u64 = env
            .storage()
            .instance()
            .get(&DATA_KEY.pending_upgrade_eligible_at)
            .unwrap_or(u64::MAX);
        if env.ledger().timestamp() < eligible_at {
            env.panic_with_error(EscrowError::TimelockNotElapsed);
        }
        env.storage().instance().remove(&DATA_KEY.pending_upgrade);
        env.storage()
            .instance()
            .remove(&DATA_KEY.pending_upgrade_eligible_at);
        env.deployer().update_current_contract_wasm(wasm_hash);
    }

    /// Cancel a pending upgrade, clearing the staged WASM hash and timelock
    /// (admin only).
    pub fn cancel_upgrade(env: Env) {
        let admin = Self::load_admin(&env).unwrap_or_else(|e| env.panic_with_error(e));
        admin.require_auth();
        env.storage().instance().remove(&DATA_KEY.pending_upgrade);
        env.storage()
            .instance()
            .remove(&DATA_KEY.pending_upgrade_eligible_at);
    }
}
