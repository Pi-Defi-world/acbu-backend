#![no_std]
use core::fmt::{self, Display};
use soroban_sdk::{
    contract, contracterror, contractimpl, contractmeta, contracttype, symbol_short, Address,
    BytesN, Env,
};

use shared::{
    reentrancy_guard, ContractPhase, DataKey as SharedDataKey, BASIS_POINTS, CONTRACT_VERSION,
};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    AcbuToken,
    FeeRate,
    Phase,
    Balance(Address),
    Borrowed(Address), // Tracks total amount borrowed from each lender
    Loan(LoanId),
    ActiveLoansLiquidity, // Tracks total amount currently loaned out
    LenderBalances,
    PendingUpgradeWasm,
    PendingUpgradeVersion,
    PendingUpgradeEligibleAt,
    PendingAdmin,
    PendingAdminEligibleAt,
}

const VERSION: u32 = CONTRACT_VERSION;
/// Duration of a loan in seconds (30 days).
const LOAN_TERM_SECONDS: u64 = 30 * 24 * 60 * 60;
const UPGRADE_TIMELOCK_SECONDS: u64 = 86_400;
/// TTL extension applied to instance storage on every public entry-point call
/// (≈60 days at ~5-second ledger close time).
const INSTANCE_TTL_BUMP: u32 = 1_036_800;
/// Minimum remaining TTL below which the extension kicks in; using the same
/// value as the bump means the lease is always reset to 60 days.
const INSTANCE_TTL_THRESHOLD: u32 = 1_036_800;
/// TTL extension applied to persistent storage entries (lender balances, loan
/// records) — extended to ≈120 days to survive a period of user inactivity.
const PERSISTENT_TTL_BUMP: u32 = 2_073_600;
/// Threshold for persistent TTL extension — extended when less than 60 days
/// of TTL remain, keeping the entry alive for another 120 days.
const PERSISTENT_TTL_THRESHOLD: u32 = 1_036_800;
/// Minimum balance a lender may leave in the pool after a partial withdrawal.
/// A withdrawal must either drain the balance to zero or leave at least this
/// amount. This prevents dust balances (e.g. 1 stroop) that waste a storage
/// entry and cause precision errors in later operations.
const MIN_POOL_BALANCE: i128 = 1_000_000; // 0.1 ACBU (7 decimals)
/// Admin rotation timelock: the pending admin must wait this long before
/// claiming ownership, giving the current admin a window to cancel a mistaken
/// or malicious transfer.
const ADMIN_TIMELOCK_SECONDS: u64 = 86_400;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LoanId(pub Address, pub u64);

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum LoanStatus {
    Active,
    Repaid,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct LoanData {
    pub borrower: Address,
    pub lender: Address,
    pub amount: i128,
    /// Reserved for a future multi-asset collateral extension; always `0` today.
    ///
    /// The pool is single-asset: both the liquidity and the loan principal are
    /// ACBU. Posting ACBU as collateral for an ACBU loan is a no-op — it locks
    /// at least as much of the borrowed asset as it releases and provides no
    /// credit protection — so no collateral is pulled on [`LendingPool::borrow`].
    /// See [`LendingPool::borrow`] for the full rationale (SC-018).
    ///
    /// The field is retained rather than removed so that already-stored
    /// [`LoanData`] entries keep decoding across a contract upgrade, and so that
    /// a real (distinct-asset) collateral implementation can populate it without
    /// another storage migration.
    pub collateral_amount: i128,
    pub interest_rate_bps: u32,
    pub loan_start_timestamp: u64,
    pub repayment_deadline: u64,
    pub accrued_interest: i128,
    pub total_repayment_due: i128,
    pub status: LoanStatus,
}

/// Emitted when a lender deposits liquidity into the pool.
///
/// The `lender` address is carried in the event **payload** (not only the
/// topic) so off-chain indexers can attribute a deposit to a specific user
/// without having to parse the originating transaction envelope. See #369.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct DepositEvent {
    pub lender: Address,
    pub amount: i128,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct BorrowEvent {
    pub creator: Address,
    pub amount: i128,
    pub token: Address,
    pub loan_id: u64,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct RepayEvent {
    pub creator: Address,
    pub amount: i128,
    pub token: Address,
    pub loan_id: u64,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct LoanCreatedEvent {
    pub loan_id: u64,
    pub lender: Address,
    pub borrower: Address,
    pub amount: i128,
    pub interest_bps: i128,
    pub term_seconds: u64,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct LoanRepaidEvent {
    pub loan_id: u64,
    pub borrower: Address,
    pub amount: i128,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct RepaymentEvent {
    pub borrower: Address,
    pub amount: i128,
    pub timestamp: u64,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    Paused = 2001,
    InvalidVersion = 2002,
    TimelockNotElapsed = 2003,
    NoPendingUpgrade = 2004,
    NoPendingAdmin = 2005,
    AdminTimelockNotElapsed = 2006,
    NoPendingAdminToCancel = 2007,
    NotFound = 2008,
    InvalidState = 2009,
    Unauthorized = 2010,
    AlreadyInitialized = 2011,
    InvalidAmount = 2012,
    InsufficientBalance = 2013,
    // Reserved. Never returned by the current single-asset pool, which takes no
    // collateral (see `LoanData::collateral_amount` and `LendingPool::borrow`).
    // Kept so error code 2014 stays stable for clients and remains available to a
    // future distinct-asset collateral implementation. Note: `//` and not `///` —
    // a doc comment here would replace the short `Display` wording in the
    // generated docs/ERROR_CODES.md table.
    InsufficientCollateral = 2014,
    InsufficientLiquidity = 2015,
    DustBalance = 2016,
    Unknown = 2999,
}

impl Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::NotFound => "resource not found",
            Self::InvalidState => "invalid lending pool state",
            Self::Unauthorized => "unauthorized",
            Self::AlreadyInitialized => "lending pool already initialized",
            Self::InvalidAmount => "invalid amount",
            Self::InsufficientBalance => "insufficient balance",
            Self::InsufficientCollateral => "insufficient collateral",
            Self::InsufficientLiquidity => "insufficient liquidity",
            Self::DustBalance => "dust balance",
            Self::Paused => "lending pool is paused",
            Self::InvalidVersion => "invalid contract version",
            Self::TimelockNotElapsed => "timelock has not elapsed",
            Self::NoPendingUpgrade => "no pending upgrade",
            Self::NoPendingAdmin => "no pending admin",
            Self::AdminTimelockNotElapsed => "admin timelock has not elapsed",
            Self::NoPendingAdminToCancel => "no pending admin to cancel",
            Self::Unknown => "unknown lending pool error",
        };
        f.write_str(message)
    }
}

contractmeta!(key = "version", val = "1");

#[contract]
pub struct LendingPool;

#[contractimpl]
impl LendingPool {
    /// Initialize the pool.
    ///
    /// `fee_rate_bps` is the annualized loan fee rate in basis points. It is
    /// snapshotted into each loan and accrued into `total_repayment_due`.
    pub fn initialize(env: Env, admin: Address, acbu_token: Address, fee_rate_bps: i128) {
        if env.storage().instance().has(&DataKey::Admin) {
            env.panic_with_error(Error::AlreadyInitialized);
        }
        if fee_rate_bps < 0 || fee_rate_bps > BASIS_POINTS {
            env.panic_with_error(Error::InvalidAmount);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::AcbuToken, &acbu_token);
        env.storage()
            .instance()
            .set(&DataKey::FeeRate, &fee_rate_bps);
        env.storage()
            .instance()
            .set(&DataKey::Phase, &ContractPhase::Active);
        env.storage()
            .instance()
            .set(&DataKey::ActiveLoansLiquidity, &0i128);
        env.storage()
            .instance()
            .set(&SharedDataKey::Version, &VERSION);
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_BUMP);
    }

    /// Deposit `amount` of ACBU into the pool as the caller's lendable liquidity.
    ///
    /// Requires `lender`'s authorization and that the pool is not paused. The
    /// tokens are pulled from `lender` into the contract and credited to their
    /// pool balance. `amount` must be positive. Emits a [`DepositEvent`].
    pub fn deposit(env: Env, lender: Address, amount: i128) {
        // Re-entrancy guard
        reentrancy_guard::acquire_guard(&env);

        lender.require_auth();
        Self::check_paused(&env);

        if amount <= 0 {
            env.panic_with_error(Error::InvalidAmount);
        }

        let acbu_token: Address = env.storage().instance().get(&DataKey::AcbuToken).unwrap();

        // CEI: Update state before external calls
        let current_balance: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Balance(lender.clone()))
            .unwrap_or(0);
        let new_balance = current_balance
            .checked_add(amount)
            .unwrap_or_else(|| env.panic_with_error(Error::InvalidAmount));
        env.storage()
            .persistent()
            .set(&DataKey::Balance(lender.clone()), &new_balance);
        env.storage().persistent().extend_ttl(
            &DataKey::Balance(lender.clone()),
            PERSISTENT_TTL_THRESHOLD,
            PERSISTENT_TTL_BUMP,
        );
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_BUMP);

        let token = soroban_sdk::token::Client::new(&env, &acbu_token);
        token.transfer(&lender, &env.current_contract_address(), &amount);

        env.events().publish(
            (symbol_short!("deposit"), lender.clone()),
            DepositEvent {
                lender,
                amount,
                timestamp: env.ledger().timestamp(),
            },
        );

        // Release re-entrancy guard
        reentrancy_guard::release_guard(&env);
    }

    /// Withdraw `amount` of ACBU from the caller's pool balance.
    ///
    /// Requires `lender`'s authorization and that the pool is not paused. Only the
    /// portion of the balance not currently lent out (balance minus borrowed) may
    /// be withdrawn. A withdrawal must either drain the balance to zero or leave at
    /// least [`MIN_POOL_BALANCE`]; otherwise it fails with [`Error::DustBalance`].
    pub fn withdraw(env: Env, lender: Address, amount: i128) {
        // Re-entrancy guard
        reentrancy_guard::acquire_guard(&env);

        lender.require_auth();
        Self::check_paused(&env);

        if amount <= 0 {
            env.panic_with_error(Error::InvalidAmount);
        }

        let current_balance: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Balance(lender.clone()))
            .unwrap_or(0);

        let already_borrowed: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Borrowed(lender.clone()))
            .unwrap_or(0);

        let available_balance = current_balance.checked_sub(already_borrowed).unwrap_or(0);
        if available_balance < amount {
            env.panic_with_error(Error::InsufficientBalance);
        }

        // CEI: Update state before external calls
        let new_balance = current_balance
            .checked_sub(amount)
            .unwrap_or_else(|| env.panic_with_error(Error::InsufficientBalance));

        // Reject withdrawals that would leave a dust balance behind. The lender
        // must either withdraw their full balance or keep at least the minimum.
        if new_balance != 0 && new_balance < MIN_POOL_BALANCE {
            env.panic_with_error(Error::DustBalance);
        }

        env.storage()
            .persistent()
            .set(&DataKey::Balance(lender.clone()), &new_balance);
        env.storage().persistent().extend_ttl(
            &DataKey::Balance(lender.clone()),
            PERSISTENT_TTL_THRESHOLD,
            PERSISTENT_TTL_BUMP,
        );
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_BUMP);

        let acbu_token: Address = env.storage().instance().get(&DataKey::AcbuToken).unwrap();
        let token = soroban_sdk::token::Client::new(&env, &acbu_token);
        token.transfer(&env.current_contract_address(), &lender, &amount);

        env.events()
            .publish((symbol_short!("withdraw"), lender), amount);

        // Release re-entrancy guard
        reentrancy_guard::release_guard(&env);
    }

    /// Borrow `amount` of ACBU from a specific `lender`'s liquidity, creating
    /// a new loan keyed by `(borrower, loan_id)`.
    ///
    /// Requires authorization from **both** `borrower` and `lender`, and that the
    /// pool is not paused. The lender must have enough unborrowed balance.
    /// `loan_id` must be unique for the borrower. Emits [`BorrowEvent`] and
    /// [`LoanCreatedEvent`].
    ///
    /// # Design: this pool is uncollateralized by construction (SC-018)
    ///
    /// An earlier iteration pulled a `collateral_amount` of ACBU from the
    /// borrower and required `collateral_amount >= amount` before paying out
    /// `amount` of the *same* ACBU token. That is a degenerate arrangement: the
    /// borrower had to already hold — and give up control of — at least as much
    /// ACBU as they received, so the loan extended no purchasing power, and the
    /// "collateral" gave the lender no protection they did not already have.
    /// There was also no liquidation path that could seize it. It was leftover
    /// from an earlier design rather than an intended placeholder, and the
    /// collateral leg has been removed.
    ///
    /// Because nothing secures the principal, credit risk sits entirely with the
    /// lender, so the lender must consent to each individual loan: `borrow`
    /// requires `lender.require_auth()` in addition to `borrower.require_auth()`.
    /// Depositing liquidity is *not* an open offer to lend it to anyone — without
    /// the lender's signature, any address could drain a depositor's balance as
    /// an unsecured loan. Both parties therefore sign the same borrow
    /// transaction, making each loan an explicit peer-to-peer agreement.
    ///
    /// Meaningful collateral requires a *distinct* asset plus oracle pricing and
    /// a liquidation path; that is a separate feature, and
    /// [`LoanData::collateral_amount`] is reserved for it.
    pub fn borrow(
        env: Env,
        borrower: Address,
        lender: Address,
        amount: i128,
        loan_id: u64,
    ) {
        // Re-entrancy guard
        reentrancy_guard::acquire_guard(&env);

        borrower.require_auth();
        // The loan is unsecured (see the function docs), so the lender bears the
        // full credit risk and must approve this specific loan.
        lender.require_auth();
        Self::check_paused(&env);

        if amount <= 0 {
            env.panic_with_error(Error::InvalidAmount);
        }

        let lender_balance: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Balance(lender.clone()))
            .unwrap_or(0);
        let already_borrowed: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Borrowed(lender.clone()))
            .unwrap_or(0);
        let unborrowed_balance = lender_balance.checked_sub(already_borrowed).unwrap_or(0);
        if unborrowed_balance < amount {
            env.panic_with_error(Error::InsufficientBalance);
        }

        let loan_key = LoanId(borrower.clone(), loan_id);
        if env
            .storage()
            .persistent()
            .has(&DataKey::Loan(loan_key.clone()))
        {
            env.panic_with_error(Error::InvalidState);
        }

        let acbu_token: Address = env.storage().instance().get(&DataKey::AcbuToken).unwrap();
        let token = soroban_sdk::token::Client::new(&env, &acbu_token);

        let contract_balance = token.balance(&env.current_contract_address());
        if contract_balance < amount {
            env.panic_with_error(Error::InsufficientBalance);
        }

        // CEI: Update state before external calls
        let active_loans_liquidity: i128 = env
            .storage()
            .instance()
            .get(&DataKey::ActiveLoansLiquidity)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::ActiveLoansLiquidity, &(active_loans_liquidity + amount));

        let new_borrowed = already_borrowed
            .checked_add(amount)
            .unwrap_or_else(|| env.panic_with_error(Error::InvalidAmount));
        env.storage()
            .persistent()
            .set(&DataKey::Borrowed(lender.clone()), &new_borrowed);

        // Pay out the loan principal.
        token.transfer(&env.current_contract_address(), &borrower, &amount);

        let fee_rate_bps: i128 = env.storage().instance().get(&DataKey::FeeRate).unwrap_or(0);
        let start_time = env.ledger().timestamp();

        let loan_data = LoanData {
            borrower: borrower.clone(),
            lender: lender.clone(),
            amount,
            // No collateral is taken; the field is reserved for a future
            // distinct-asset collateral extension (SC-018).
            collateral_amount: 0,
            interest_rate_bps: u32::try_from(fee_rate_bps)
                .unwrap_or_else(|_| env.panic_with_error(Error::InvalidAmount)),
            loan_start_timestamp: start_time,
            repayment_deadline: start_time + LOAN_TERM_SECONDS,
            accrued_interest: 0,
            total_repayment_due: amount,
            status: LoanStatus::Active,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Loan(loan_key.clone()), &loan_data);
        env.storage().persistent().extend_ttl(
            &DataKey::Loan(loan_key),
            PERSISTENT_TTL_THRESHOLD,
            PERSISTENT_TTL_BUMP,
        );
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_BUMP);

        let timestamp = env.ledger().timestamp();

        env.events().publish(
            (symbol_short!("borrow"), borrower.clone()),
            BorrowEvent {
                creator: borrower.clone(),
                amount,
                token: acbu_token,
                loan_id,
                timestamp,
            },
        );
        env.events().publish(
            (symbol_short!("loan_cr"),),
            LoanCreatedEvent {
                loan_id,
                lender,
                borrower,
                amount,
                interest_bps: fee_rate_bps,
                term_seconds: LOAN_TERM_SECONDS,
                timestamp,
            },
        );

        // Release re-entrancy guard
        reentrancy_guard::release_guard(&env);
    }

    /// Return the loan identified by `(borrower, loan_id)`, or `None` if it does
    /// not exist.
    ///
    /// For active loans the returned [`LoanData`] is updated in-memory with the
    /// fee accrued up to the current ledger timestamp (`accrued_interest` and
    /// `total_repayment_due` are recomputed); the stored loan is not modified.
    /// Repaid loans are returned as-is.
    pub fn get_loan(env: Env, borrower: Address, loan_id: u64) -> Option<LoanData> {
        let loan_key = LoanId(borrower, loan_id);
        let mut loan_data: LoanData = env.storage().persistent().get(&DataKey::Loan(loan_key))?;

        if let LoanStatus::Repaid = loan_data.status {
            return Some(loan_data);
        }

        let current_time = env.ledger().timestamp();
        let elapsed = current_time.saturating_sub(loan_data.loan_start_timestamp);

        let accrued_fee = Self::calculate_accrued_fee(
            &env,
            loan_data.amount,
            loan_data.interest_rate_bps,
            elapsed,
        );
        loan_data.accrued_interest = loan_data
            .accrued_interest
            .checked_add(accrued_fee)
            .unwrap_or_else(|| env.panic_with_error(Error::InvalidAmount));
        loan_data.total_repayment_due = loan_data
            .amount
            .checked_add(loan_data.accrued_interest)
            .unwrap_or_else(|| env.panic_with_error(Error::InvalidAmount));

        Some(loan_data)
    }

    /// Repay `amount` toward the loan `(borrower, loan_id)`.
    ///
    /// Requires `borrower`'s authorization and that the pool is not paused.
    /// `amount` is applied to accrued interest first, then principal, and may not
    /// exceed the total amount due. When the principal reaches zero the loan is
    /// marked [`LoanStatus::Repaid`]. Emits [`RepayEvent`], [`RepaymentEvent`]
    /// and [`LoanRepaidEvent`].
    pub fn repay(env: Env, borrower: Address, amount: i128, loan_id: u64) {
        // Re-entrancy guard
        reentrancy_guard::acquire_guard(&env);

        borrower.require_auth();
        Self::check_paused(&env);

        if amount <= 0 {
            env.panic_with_error(Error::InvalidAmount);
        }

        let loan_key = LoanId(borrower.clone(), loan_id);
        let mut loan_data = Self::get_loan(env.clone(), borrower.clone(), loan_id)
            .unwrap_or_else(|| env.panic_with_error(Error::NotFound));

        if amount > loan_data.total_repayment_due {
            env.panic_with_error(Error::InvalidAmount);
        }
        if let LoanStatus::Repaid = loan_data.status {
            env.panic_with_error(Error::InvalidState);
        }

        let acbu_token: Address = env.storage().instance().get(&DataKey::AcbuToken).unwrap();
        let token = soroban_sdk::token::Client::new(&env, &acbu_token);

        let principal_repaid = if amount > loan_data.accrued_interest {
            amount - loan_data.accrued_interest
        } else {
            0
        };

        // CEI: Update state before external calls
        loan_data.amount = loan_data.amount.checked_sub(principal_repaid).unwrap_or(0);

        let active_loans_liquidity: i128 = env
            .storage()
            .instance()
            .get(&DataKey::ActiveLoansLiquidity)
            .unwrap_or(0);
        env.storage().instance().set(
            &DataKey::ActiveLoansLiquidity,
            &active_loans_liquidity
                .checked_sub(principal_repaid)
                .unwrap_or(0),
        );

        if principal_repaid > 0 {
            let lender = loan_data.lender.clone();
            let already_borrowed: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::Borrowed(lender.clone()))
                .unwrap_or(0);
            let new_borrowed = already_borrowed.checked_sub(principal_repaid).unwrap_or(0);
            env.storage()
                .persistent()
                .set(&DataKey::Borrowed(lender), &new_borrowed);
        }

        token.transfer(&borrower, &env.current_contract_address(), &amount);

        let interest_repaid = amount - principal_repaid;
        if interest_repaid > 0 {
            let lender = loan_data.lender.clone();
            token.transfer(&env.current_contract_address(), &lender, &interest_repaid);
        }

        if loan_data.amount == 0 {
            loan_data.accrued_interest = 0;
            loan_data.total_repayment_due = 0;
            loan_data.loan_start_timestamp = env.ledger().timestamp();
            loan_data.status = LoanStatus::Repaid;

            env.storage()
                .persistent()
                .set(&DataKey::Loan(loan_key.clone()), &loan_data);
        } else {
            loan_data.loan_start_timestamp = env.ledger().timestamp();
            let remaining_interest = if amount < loan_data.accrued_interest {
                loan_data.accrued_interest - amount
            } else {
                0
            };
            loan_data.accrued_interest = remaining_interest;
            loan_data.total_repayment_due = loan_data
                .amount
                .checked_add(remaining_interest)
                .unwrap_or_else(|| env.panic_with_error(Error::InvalidAmount));

            env.storage()
                .persistent()
                .set(&DataKey::Loan(loan_key.clone()), &loan_data);
        }
        env.storage().persistent().extend_ttl(
            &DataKey::Loan(loan_key),
            PERSISTENT_TTL_THRESHOLD,
            PERSISTENT_TTL_BUMP,
        );
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_BUMP);

        let timestamp = env.ledger().timestamp();
        env.events().publish(
            (symbol_short!("repay"), borrower.clone()),
            RepayEvent {
                creator: borrower.clone(),
                amount,
                token: acbu_token,
                loan_id,
                timestamp,
            },
        );
        env.events().publish(
            (symbol_short!("repaymt"),),
            RepaymentEvent {
                borrower: borrower.clone(),
                amount,
                timestamp,
            },
        );
        env.events().publish(
            (symbol_short!("loan_rp"),),
            LoanRepaidEvent {
                loan_id,
                borrower,
                amount,
                timestamp,
            },
        );

        // Release re-entrancy guard
        reentrancy_guard::release_guard(&env);
    }

    /// Pause the pool, disabling deposit/withdraw/borrow/repay. Admin only.
    pub fn pause(env: Env) {
        Self::check_admin(&env);
        env.storage()
            .instance()
            .set(&DataKey::Phase, &ContractPhase::Paused);
    }

    /// Unpause the pool, re-enabling state-changing operations. Admin only.
    pub fn unpause(env: Env) {
        Self::check_admin(&env);
        env.storage()
            .instance()
            .set(&DataKey::Phase, &ContractPhase::Active);
    }

    /// Stage a WASM upgrade to `new_wasm_hash`/`new_version` and start the upgrade
    /// timelock. Admin only. `new_version` must exceed the current version. The
    /// upgrade is applied later via [`Self::execute_upgrade`] once the timelock
    /// elapses, and can be aborted with [`Self::cancel_upgrade`].
    pub fn propose_upgrade(env: Env, new_wasm_hash: BytesN<32>, new_version: u32) {
        Self::check_admin(&env);
        let current_version: u32 = env
            .storage()
            .instance()
            .get(&SharedDataKey::Version)
            .unwrap_or(0);
        if new_version <= current_version {
            env.panic_with_error(Error::InvalidVersion);
        }
        let eligible_at = env.ledger().timestamp() + UPGRADE_TIMELOCK_SECONDS;
        env.storage()
            .instance()
            .set(&DataKey::PendingUpgradeWasm, &new_wasm_hash);
        env.storage()
            .instance()
            .set(&DataKey::PendingUpgradeVersion, &new_version);
        env.storage()
            .instance()
            .set(&DataKey::PendingUpgradeEligibleAt, &eligible_at);
    }

    /// Execute a previously proposed upgrade once its timelock has elapsed,
    /// swapping in the new WASM, running any migrations and bumping the stored
    /// version. Admin only. Fails if no upgrade is pending or the timelock is
    /// still active.
    pub fn execute_upgrade(env: Env) {
        Self::check_admin(&env);
        let wasm_hash: BytesN<32> = env
            .storage()
            .instance()
            .get(&DataKey::PendingUpgradeWasm)
            .unwrap_or_else(|| env.panic_with_error(Error::NoPendingUpgrade));
        let new_version: u32 = env
            .storage()
            .instance()
            .get(&DataKey::PendingUpgradeVersion)
            .unwrap_or_else(|| env.panic_with_error(Error::NoPendingUpgrade));
        let eligible_at: u64 = env
            .storage()
            .instance()
            .get(&DataKey::PendingUpgradeEligibleAt)
            .unwrap_or(u64::MAX);
        if env.ledger().timestamp() < eligible_at {
            env.panic_with_error(Error::TimelockNotElapsed);
        }
        let current_version: u32 = env
            .storage()
            .instance()
            .get(&SharedDataKey::Version)
            .unwrap_or(0);
        env.storage()
            .instance()
            .remove(&DataKey::PendingUpgradeWasm);
        env.storage()
            .instance()
            .remove(&DataKey::PendingUpgradeVersion);
        env.storage()
            .instance()
            .remove(&DataKey::PendingUpgradeEligibleAt);
        env.deployer().update_current_contract_wasm(wasm_hash);
        for v in current_version..new_version {
            match v {
                0 => shared::migrate_v0_to_v1(&env),
                _ => {}
            }
        }
        env.storage()
            .instance()
            .set(&SharedDataKey::Version, &new_version);
    }

    /// Cancel a pending upgrade, clearing the staged WASM hash, version and
    /// timelock. Admin only.
    pub fn cancel_upgrade(env: Env) {
        Self::check_admin(&env);
        env.storage()
            .instance()
            .remove(&DataKey::PendingUpgradeWasm);
        env.storage()
            .instance()
            .remove(&DataKey::PendingUpgradeVersion);
        env.storage()
            .instance()
            .remove(&DataKey::PendingUpgradeEligibleAt);
    }

    /// Return the lender's total pool balance (including any amount currently lent
    /// out), or `0` if they have never deposited.
    pub fn get_balance(env: Env, lender: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Balance(lender))
            .unwrap_or(0)
    }

    /// Returns the current annualized loan interest rate in basis points.
    pub fn get_interest_rate(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::FeeRate).unwrap_or(0)
    }

    /// Update the annualized loan interest rate in basis points.
    ///
    /// This is a high-privilege operation — changing the interest rate affects
    /// all lenders and borrowers. Access is therefore restricted to the **admin**
    /// only. Operators (who handle day-to-day minting) must NOT be able to call
    /// this function; a compromised operator key must not be able to set
    /// exorbitant rates. See issue #339.
    pub fn set_interest_rate(env: Env, new_rate_bps: i128) {
        // Admin-only: explicitly fetches and requires auth from the stored admin
        // address. This is identical to check_admin but inlined here to make the
        // privilege boundary visible at the call site.
        Self::check_admin(&env);

        if new_rate_bps < 0 || new_rate_bps > BASIS_POINTS {
            env.panic_with_error(Error::InvalidAmount);
        }

        let old_rate: i128 = env.storage().instance().get(&DataKey::FeeRate).unwrap_or(0);

        env.storage()
            .instance()
            .set(&DataKey::FeeRate, &new_rate_bps);

        env.events()
            .publish((symbol_short!("rate_set"),), (old_rate, new_rate_bps));
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
        Self::check_admin(&env);
        let eligible_at = env.ledger().timestamp() + ADMIN_TIMELOCK_SECONDS;
        env.storage()
            .instance()
            .set(&DataKey::PendingAdmin, &new_admin);
        env.storage()
            .instance()
            .set(&DataKey::PendingAdminEligibleAt, &eligible_at);
        let current_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        env.events()
            .publish((symbol_short!("adm_init"),), (current_admin, new_admin, eligible_at));
    }

    /// Step 2 — the nominated address claims ownership after the timelock.
    pub fn accept_admin(env: Env) {
        let pending_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::PendingAdmin)
            .unwrap_or_else(|| env.panic_with_error(Error::NoPendingAdmin));
        pending_admin.require_auth();

        let eligible_at: u64 = env
            .storage()
            .instance()
            .get(&DataKey::PendingAdminEligibleAt)
            .unwrap_or(u64::MAX);
        if env.ledger().timestamp() < eligible_at {
            env.panic_with_error(Error::AdminTimelockNotElapsed);
        }

        let old_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        env.storage()
            .instance()
            .set(&DataKey::Admin, &pending_admin);
        env.storage().instance().remove(&DataKey::PendingAdmin);
        env.storage()
            .instance()
            .remove(&DataKey::PendingAdminEligibleAt);

        env.events().publish(
            (symbol_short!("adm_done"),),
            (old_admin, pending_admin, env.ledger().timestamp()),
        );
    }

    /// Cancel a pending transfer (current admin only).
    pub fn cancel_admin_transfer(env: Env) {
        Self::check_admin(&env);
        let pending_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::PendingAdmin)
            .unwrap_or_else(|| env.panic_with_error(Error::NoPendingAdminToCancel));
        env.storage().instance().remove(&DataKey::PendingAdmin);
        env.storage()
            .instance()
            .remove(&DataKey::PendingAdminEligibleAt);
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        env.events().publish(
            (symbol_short!("adm_cncl"),),
            (admin, pending_admin, env.ledger().timestamp()),
        );
    }

    /// Current admin address.
    pub fn get_admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }

    /// Pending successor, if a transfer is in progress.
    pub fn get_pending_admin(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::PendingAdmin)
    }

    /// Timestamp after which `accept_admin` becomes callable.
    pub fn get_pending_admin_eligible_at(env: Env) -> Option<u64> {
        env.storage()
            .instance()
            .get(&DataKey::PendingAdminEligibleAt)
    }

    fn check_admin(env: &Env) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
    }

    fn check_paused(env: &Env) {
        let phase: ContractPhase = env
            .storage()
            .instance()
            .get(&DataKey::Phase)
            .unwrap_or(ContractPhase::Uninitialized);
        if phase == ContractPhase::Paused {
            env.panic_with_error(Error::Paused);
        }
    }

    // FIX(#322): Guard against zero total deposits / zero inputs before
    // computing interest factors. Returns 0 immediately when any operand
    // is zero, avoiding unnecessary checked arithmetic and preventing
    // divide-by-zero if the divisor were ever to evaluate to zero.
    fn calculate_accrued_fee(
        env: &Env,
        principal: i128,
        fee_rate_bps: u32,
        elapsed_seconds: u64,
    ) -> i128 {
        const SECONDS_PER_YEAR: i128 = 31_536_000;

        if principal == 0 || fee_rate_bps == 0 || elapsed_seconds == 0 {
            return 0;
        }

        let divisor = BASIS_POINTS
            .checked_mul(SECONDS_PER_YEAR)
            .unwrap_or_else(|| env.panic_with_error(Error::InvalidAmount));

        if divisor == 0 {
            env.panic_with_error(Error::InvalidAmount);
        }

        principal
            .checked_mul(i128::from(fee_rate_bps))
            .and_then(|v| v.checked_mul(i128::from(elapsed_seconds)))
            .and_then(|v| v.checked_div(divisor))
            .unwrap_or_else(|| env.panic_with_error(Error::InvalidAmount))
    }
}
