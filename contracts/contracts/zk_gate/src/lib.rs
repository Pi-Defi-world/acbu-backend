#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, IntoVal, Vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ZkGateError {
    Unauthorized = 1,
    AlreadyInitialized = 2,
    InvalidVrf = 3,
    VrfNotConfigured = 4,
    PolicyNotConfigured = 5,
    RiskScoreTooHigh = 6,
    TierTooLow = 7,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GatePolicy {
    pub min_tier: u32,
    pub max_risk_score: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
enum DataKey {
    Owner,
    Vrf,
    Policy,
}

#[contract]
pub struct ZkGate;

#[contractimpl]
impl ZkGate {
    pub fn __constructor(env: Env, owner: Address) {
        Self::initialize(env, owner);
    }

    pub fn initialize(env: Env, owner: Address) {
        if env.storage().instance().has(&DataKey::Owner) {
            env.panic_with_error(ZkGateError::AlreadyInitialized);
        }

        owner.require_auth();
        env.storage().instance().set(&DataKey::Owner, &owner);
        env.storage().instance().remove(&DataKey::Vrf);
    }

    pub fn set_vrf(env: Env, owner: Address, vrf: Address) {
        let stored_owner: Address = env
            .storage()
            .instance()
            .get(&DataKey::Owner)
            .unwrap_or_else(|| env.panic_with_error(ZkGateError::Unauthorized));

        if owner != stored_owner {
            env.panic_with_error(ZkGateError::Unauthorized);
        }

        owner.require_auth();
        Self::require_contract_vrf(&env, &vrf);
        env.storage().instance().set(&DataKey::Vrf, &vrf);
    }

    pub fn get_vrf(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::Vrf)
    }

    pub fn set_policy(env: Env, owner: Address, min_tier: u32, max_risk_score: u32) {
        let stored_owner: Address = env
            .storage()
            .instance()
            .get(&DataKey::Owner)
            .unwrap_or_else(|| env.panic_with_error(ZkGateError::Unauthorized));

        if owner != stored_owner {
            env.panic_with_error(ZkGateError::Unauthorized);
        }

        owner.require_auth();
        let policy = GatePolicy {
            min_tier,
            max_risk_score,
        };
        env.storage().instance().set(&DataKey::Policy, &policy);
    }

    pub fn get_policy(env: Env) -> Option<GatePolicy> {
        env.storage().instance().get(&DataKey::Policy)
    }

    pub fn check_policy(env: Env, tier: u32, risk_score: u32) -> bool {
        let Some(policy) = env.storage().instance().get::<_, GatePolicy>(&DataKey::Policy) else {
            env.panic_with_error(ZkGateError::PolicyNotConfigured);
        };

        tier >= policy.min_tier && risk_score <= policy.max_risk_score
    }

    pub fn assert_policy(env: Env, tier: u32, risk_score: u32) {
        let Some(policy) = env.storage().instance().get::<_, GatePolicy>(&DataKey::Policy) else {
            env.panic_with_error(ZkGateError::PolicyNotConfigured);
        };

        if tier < policy.min_tier {
            env.panic_with_error(ZkGateError::TierTooLow);
        }
        if risk_score > policy.max_risk_score {
            env.panic_with_error(ZkGateError::RiskScoreTooHigh);
        }
    }

    pub fn chk(env: Env, account: Address) -> bool {
        let Some(vrf) = env.storage().instance().get(&DataKey::Vrf) else {
            return false;
        };

        if vrf == env.current_contract_address() {
            return false;
        }

        let verified: bool = env.invoke_contract(
            &vrf,
            &symbol_short!("is_v"),
            Vec::from_array(&env, [account.into_val(&env)]),
        );

        verified
    }

    pub fn verify_compliance(env: Env, account: Address, tier: u32, risk_score: u32) -> bool {
        if !Self::check_policy(env.clone(), tier, risk_score) {
            return false;
        }
        Self::chk(env, account)
    }

    fn require_contract_vrf(_env: &Env, vrf: &Address) {
        if *vrf == _env.current_contract_address() {
            _env.panic_with_error(ZkGateError::InvalidVrf);
        }
    }
}
