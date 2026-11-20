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
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
enum DataKey {
    Owner,
    Vrf,
}

#[contract]
pub struct ZkGate;

#[contractimpl]
impl ZkGate {
    pub fn __constructor(env: Env, owner: Address) {
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

    fn require_contract_vrf(_env: &Env, vrf: &Address) {
        if *vrf == _env.current_contract_address() {
            _env.panic_with_error(ZkGateError::InvalidVrf);
        }
    }
}
