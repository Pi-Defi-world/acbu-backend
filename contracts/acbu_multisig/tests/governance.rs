// AC-006: the multisig governs its own signer set and WASM through proposals
// that `execute` applies — no entry point needs the contract's own auth.
//
// AC-010: every proposal carries a typed [`MultisigAction`]; the self-
// governance actions are the `UpdateConfig` / `Upgrade` variants targeting the
// multisig contract itself, applied in-process by `execute`.

use acbu_multisig::{Error, MultisigContract, MultisigContractClient};
use shared::{ConfigArgs, MultisigAction, MultisigConfig, UpgradeArgs};
use soroban_sdk::testutils::{Address as _, Ledger, MockAuth, MockAuthInvoke};
use soroban_sdk::{vec, Address, BytesN, Env, IntoVal, Vec};

const TOKEN_WASM: &[u8] = include_bytes!("../../soroban_token_contract.wasm");

fn setup(env: &Env, n: u32, threshold: u32) -> (Vec<Address>, MultisigContractClient<'_>) {
    let mut signers = Vec::new(env);
    for _ in 0..n {
        signers.push_back(Address::generate(env));
    }
    let id = env.register_contract(None, MultisigContract);
    let client = MultisigContractClient::new(env, &id);
    client.initialize(&signers, &threshold);
    (signers, client)
}

/// Authorise exactly one call by `signer` — no mocked auth for anyone else,
/// in particular not for the multisig contract itself.
fn sign<'a>(
    env: &Env,
    client: &MultisigContractClient<'a>,
    signer: &Address,
    fn_name: &'a str,
    args: soroban_sdk::Vec<soroban_sdk::Val>,
) {
    env.mock_auths(&[MockAuth {
        address: signer,
        invoke: &MockAuthInvoke {
            contract: &client.address,
            fn_name,
            args,
            sub_invokes: &[],
        },
    }]);
}

#[test]
fn signer_rotation_succeeds_with_only_signer_auth() {
    let env = Env::default();
    let (signers, client) = setup(&env, 3, 2);
    let (s0, s1) = (signers.get(0).unwrap(), signers.get(1).unwrap());
    let new_signers = vec![&env, s1.clone(), Address::generate(&env)];

    sign(
        &env,
        &client,
        &s0,
        "propose_update_config",
        (s0.clone(), new_signers.clone(), 2u32).into_val(&env),
    );
    let pid = client.propose_update_config(&s0, &new_signers, &2);
    sign(&env, &client, &s1, "approve", (s1.clone(), pid).into_val(&env));
    client.approve(&s1, &pid);
    sign(&env, &client, &s1, "execute", (s1.clone(), pid).into_val(&env));
    client.execute(&s1, &pid);

    assert_eq!(
        client.get_config(),
        MultisigConfig {
            signers: new_signers,
            threshold: 2
        }
    );
    assert!(!client.is_signer(&s0));
    assert!(client.get_proposal(&pid).executed);
}

#[test]
fn rotation_is_not_applied_below_threshold() {
    let env = Env::default();
    env.mock_all_auths();
    let (signers, client) = setup(&env, 3, 2);
    let s0 = signers.get(0).unwrap();
    let before = client.get_config();

    let pid = client.propose_update_config(&s0, &vec![&env, s0.clone()], &1);
    assert_eq!(client.try_execute(&s0, &pid), Err(Ok(Error::ThresholdNotMet.into())));
    assert_eq!(client.get_config(), before);
}

#[test]
fn rotation_cannot_be_replayed() {
    let env = Env::default();
    env.mock_all_auths();
    let (signers, client) = setup(&env, 2, 1);
    let s0 = signers.get(0).unwrap();

    let pid = client.propose_update_config(&s0, &signers, &2);
    client.execute(&s0, &pid);
    assert_eq!(client.try_execute(&s0, &pid), Err(Ok(Error::AlreadyExecuted.into())));
}

#[test]
fn expired_rotation_is_not_applied() {
    let env = Env::default();
    env.mock_all_auths();
    let (signers, client) = setup(&env, 2, 1);
    let s0 = signers.get(0).unwrap();
    let before = client.get_config();

    let pid = client.propose_update_config(&s0, &vec![&env, s0.clone()], &1);
    env.ledger().with_mut(|l| l.timestamp += 172_801);
    assert_eq!(client.try_execute(&s0, &pid), Err(Ok(Error::Expired.into())));
    assert_eq!(client.get_config(), before);
}

#[test]
fn invalid_rotation_is_rejected_at_proposal_time() {
    let env = Env::default();
    env.mock_all_auths();
    let (signers, client) = setup(&env, 2, 1);
    let s0 = signers.get(0).unwrap();

    assert_eq!(
        client.try_propose_update_config(&s0, &signers, &3),
        Err(Ok(Error::InvalidThreshold.into()))
    );
    assert_eq!(
        client.try_propose_update_config(&s0, &Vec::new(&env), &1),
        Err(Ok(Error::EmptySigners.into()))
    );
    assert_eq!(client.get_next_id(), 0, "no proposal must be recorded");
}

#[test]
fn outsider_cannot_propose_rotation() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client) = setup(&env, 2, 1);
    let outsider = Address::generate(&env);

    assert_eq!(
        client.try_propose_update_config(&outsider, &vec![&env, outsider.clone()], &1),
        Err(Ok(Error::Unauthorized.into()))
    );
}

#[test]
fn action_is_bound_to_proposal() {
    let env = Env::default();
    env.mock_all_auths();
    let (signers, client) = setup(&env, 2, 1);
    let s0 = signers.get(0).unwrap();
    let hash = BytesN::from_array(&env, &[7u8; 32]);

    let pid = client.propose_upgrade(&s0, &hash);
    assert_eq!(
        client.get_action(&pid),
        Some(MultisigAction::Upgrade(UpgradeArgs {
            new_wasm_hash: hash,
            new_version: client.version() + 1,
        }))
    );

    let self_address = client.address.clone();
    let plain = client.propose(&s0, &self_address, &MultisigAction::Pause);
    assert_eq!(client.get_action(&plain), Some(MultisigAction::Pause));
}

#[test]
fn self_governance_action_cannot_target_another_contract() {
    let env = Env::default();
    env.mock_all_auths();
    let (signers, client) = setup(&env, 2, 1);
    let s0 = signers.get(0).unwrap();
    let outsider_contract = Address::generate(&env);

    assert_eq!(
        client.try_propose(
            &s0,
            &outsider_contract,
            &MultisigAction::UpdateConfig(ConfigArgs {
                signers: vec![&env, s0.clone()],
                threshold: 1,
            })
        ),
        Err(Ok(Error::Unauthorized.into()))
    );
    assert_eq!(client.get_next_id(), 0, "no proposal must be recorded");
}

#[test]
fn upgrade_succeeds_with_only_signer_auth() {
    let env = Env::default();
    let (signers, client) = setup(&env, 2, 2);
    let (s0, s1) = (signers.get(0).unwrap(), signers.get(1).unwrap());
    let hash = env.deployer().upload_contract_wasm(TOKEN_WASM);

    sign(&env, &client, &s0, "propose_upgrade", (s0.clone(), hash.clone()).into_val(&env));
    let pid = client.propose_upgrade(&s0, &hash);
    sign(&env, &client, &s1, "approve", (s1.clone(), pid).into_val(&env));
    client.approve(&s1, &pid);
    sign(&env, &client, &s1, "execute", (s1.clone(), pid).into_val(&env));
    client.execute(&s1, &pid);

    // The contract now runs the new WASM (a stub with no contract entry
    // points), so the multisig's own functions are gone.
    assert!(client.try_get_config().is_err());
}
