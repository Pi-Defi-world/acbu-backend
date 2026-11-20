#![cfg(test)]

use acbu_multisig::{MultisigContract, MultisigContractClient};
use shared::{ConfigArgs, CurrencyCode, MultisigAction, RateAdminArgs, UpgradeArgs};
use soroban_sdk::{
    contract, contractimpl, symbol_short,
    testutils::{Address as _, Events, Ledger},
    Address, BytesN, Env,
};

// ── Mock target ──────────────────────────────────────────────────────────────

/// Minimal stand-in for a protected contract.  Its entrypoints mirror the
/// admin surface the multisig is expected to drive, and each one records that
/// it ran so tests can assert *which* action `execute` actually invoked.
#[contract]
pub struct MockTarget;

#[contractimpl]
impl MockTarget {
    pub fn pause(env: Env) {
        env.storage()
            .instance()
            .set(&symbol_short!("paused"), &true);
    }

    pub fn unpause(env: Env) {
        env.storage()
            .instance()
            .set(&symbol_short!("paused"), &false);
    }

    pub fn update_acbu_token(env: Env, token: Address) {
        env.storage()
            .instance()
            .set(&symbol_short!("token"), &token);
    }

    pub fn set_rate_admin(env: Env, _currency: CurrencyCode, rate: i128) {
        env.storage().instance().set(&symbol_short!("rate"), &rate);
    }

    pub fn upgrade(env: Env, hash: BytesN<32>, version: u32) {
        env.storage().instance().set(&symbol_short!("hash"), &hash);
        env.storage()
            .instance()
            .set(&symbol_short!("ver"), &version);
    }

    pub fn update_config(env: Env, signers: soroban_sdk::Vec<Address>, threshold: u32) {
        env.storage()
            .instance()
            .set(&symbol_short!("signers"), &signers);
        env.storage()
            .instance()
            .set(&symbol_short!("threshold"), &threshold);
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&symbol_short!("paused"))
            .unwrap_or(false)
    }

    pub fn rate(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&symbol_short!("rate"))
            .unwrap_or(0)
    }

    pub fn token(env: Env) -> Option<Address> {
        env.storage().instance().get(&symbol_short!("token"))
    }

    pub fn stored_hash(env: Env) -> BytesN<32> {
        env.storage()
            .instance()
            .get(&symbol_short!("hash"))
            .unwrap()
    }

    pub fn stored_version(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&symbol_short!("ver"))
            .unwrap_or(0)
    }

    pub fn stored_signers(env: Env) -> soroban_sdk::Vec<Address> {
        env.storage()
            .instance()
            .get(&symbol_short!("signers"))
            .unwrap()
    }

    pub fn stored_threshold(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&symbol_short!("threshold"))
            .unwrap_or(0)
    }
}

// ── Harness ──────────────────────────────────────────────────────────────────

fn setup(
    env: &Env,
    n: usize,
    threshold: u32,
) -> (Vec<Address>, MultisigContractClient<'_>, Address) {
    let mut signers = soroban_sdk::Vec::new(env);
    let mut rust_signers = Vec::new();
    for _ in 0..n {
        let s = Address::generate(env);
        signers.push_back(s.clone());
        rust_signers.push(s);
    }
    let id = env.register_contract(None, MultisigContract);
    let client = MultisigContractClient::new(env, &id);
    client.initialize(&signers, &threshold);

    let target = env.register_contract(None, MockTarget);
    (rust_signers, client, target)
}

fn dummy_hash(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[7u8; 32])
}

// ── Basic initialisation ────────────────────────────────────────────────────

#[test]
fn test_initialize_2_of_3() {
    let env = Env::default();
    env.mock_all_auths();
    let (signers, client, _target) = setup(&env, 3, 2);
    let cfg = client.get_config();
    assert_eq!(cfg.threshold, 2, "cfg.threshold should equal 2");
    assert_eq!(cfg.signers.len(), 3, "cfg.signers.len() should equal 3");
    assert!(client.is_signer(&signers[0]));
    assert!(client.is_signer(&signers[1]));
    assert!(client.is_signer(&signers[2]));
}

#[test]
fn test_initialize_3_of_5() {
    let env = Env::default();
    env.mock_all_auths();
    let (_signers, client, _target) = setup(&env, 5, 3);
    let cfg = client.get_config();
    assert_eq!(cfg.threshold, 3, "cfg.threshold should equal 3");
    assert_eq!(cfg.signers.len(), 5, "cfg.signers.len() should equal 5");
}

#[test]
#[should_panic]
fn test_initialize_twice_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client, _target) = setup(&env, 3, 2);
    // second init must panic
    let mut s2 = soroban_sdk::Vec::new(&env);
    s2.push_back(Address::generate(&env));
    client.initialize(&s2, &1);
}

#[test]
#[should_panic]
fn test_threshold_zero_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, MultisigContract);
    let client = MultisigContractClient::new(&env, &id);
    let mut s = soroban_sdk::Vec::new(&env);
    s.push_back(Address::generate(&env));
    client.initialize(&s, &0);
}

#[test]
#[should_panic]
fn test_threshold_exceeds_signers_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, MultisigContract);
    let client = MultisigContractClient::new(&env, &id);
    let mut s = soroban_sdk::Vec::new(&env);
    s.push_back(Address::generate(&env));
    client.initialize(&s, &2); // threshold > signers
}

#[test]
#[should_panic]
fn test_duplicate_signer_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, MultisigContract);
    let client = MultisigContractClient::new(&env, &id);
    let dup = Address::generate(&env);
    let mut s = soroban_sdk::Vec::new(&env);
    s.push_back(dup.clone());
    s.push_back(dup.clone());
    client.initialize(&s, &1);
}

// ── Propose ─────────────────────────────────────────────────────────────────

#[test]
fn test_propose_returns_id_zero() {
    let env = Env::default();
    env.mock_all_auths();
    let (signers, client, target) = setup(&env, 3, 2);
    let id = client.propose(&signers[0], &target, &MultisigAction::Pause);
    assert_eq!(id, 0, "id should equal 0");
}

#[test]
fn test_propose_increments_id() {
    let env = Env::default();
    env.mock_all_auths();
    let (signers, client, target) = setup(&env, 3, 2);
    let id0 = client.propose(&signers[0], &target, &MultisigAction::Pause);
    let id1 = client.propose(&signers[1], &target, &MultisigAction::Unpause);
    assert_eq!(id0, 0, "id0 should equal 0");
    assert_eq!(id1, 1, "id1 should equal 1");
}

#[test]
fn test_proposer_approval_counted_immediately() {
    let env = Env::default();
    env.mock_all_auths();
    let (signers, client, target) = setup(&env, 3, 2);
    let pid = client.propose(&signers[0], &target, &MultisigAction::Pause);
    assert_eq!(client.approval_count(&pid), 1, "client.approval_count(&pid) should equal 1");
}

#[test]
#[should_panic]
fn test_non_signer_cannot_propose() {
    let env = Env::default();
    env.mock_all_auths();
    let (_signers, client, target) = setup(&env, 3, 2);
    let outsider = Address::generate(&env);
    client.propose(&outsider, &target, &MultisigAction::Pause);
}

// ── Approve ─────────────────────────────────────────────────────────────────

#[test]
fn test_approve_increments_count() {
    let env = Env::default();
    env.mock_all_auths();
    let (signers, client, target) = setup(&env, 3, 2);
    let pid = client.propose(&signers[0], &target, &MultisigAction::Pause);
    client.approve(&signers[1], &pid);
    assert_eq!(client.approval_count(&pid), 2, "client.approval_count(&pid) should equal 2");
}

#[test]
#[should_panic]
fn test_double_approve_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (signers, client, target) = setup(&env, 3, 2);
    let pid = client.propose(&signers[0], &target, &MultisigAction::Pause);
    client.approve(&signers[0], &pid); // already approved via propose
}

#[test]
#[should_panic]
fn test_non_signer_cannot_approve() {
    let env = Env::default();
    env.mock_all_auths();
    let (signers, client, target) = setup(&env, 3, 2);
    let pid = client.propose(&signers[0], &target, &MultisigAction::Pause);
    let outsider = Address::generate(&env);
    client.approve(&outsider, &pid);
}

#[test]
#[should_panic]
fn test_approve_expired_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (signers, client, target) = setup(&env, 3, 2);
    let pid = client.propose(&signers[0], &target, &MultisigAction::Pause);
    // advance time past TTL (48 h + 1 s)
    env.ledger().with_mut(|l| l.timestamp = 172_801);
    client.approve(&signers[1], &pid);
}

// ── Execute ──────────────────────────────────────────────────────────────────

/// Core acceptance check: M-of-N — 2-of-3 must succeed.
#[test]
fn test_execute_2_of_3_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let (signers, client, target) = setup(&env, 3, 2);
    let pid = client.propose(&signers[0], &target, &MultisigAction::Pause);
    client.approve(&signers[1], &pid);
    // threshold met — execute must succeed
    client.execute(&signers[2], &pid);
    let proposal = client.get_proposal(&pid);
    assert!(proposal.executed);
}

/// 3-of-5 acceptance check.
#[test]
fn test_execute_3_of_5_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let (signers, client, target) = setup(&env, 5, 3);
    let action = MultisigAction::Upgrade(UpgradeArgs {
        new_wasm_hash: dummy_hash(&env),
        new_version: 2,
    });
    let pid = client.propose(&signers[0], &target, &action);
    client.approve(&signers[1], &pid);
    client.approve(&signers[2], &pid);
    client.execute(&signers[3], &pid);
    assert!(client.get_proposal(&pid).executed);
}

/// Threshold NOT met — execute must panic.
#[test]
#[should_panic]
fn test_execute_below_threshold_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (signers, client, target) = setup(&env, 3, 2);
    let pid = client.propose(&signers[0], &target, &MultisigAction::Pause);
    // only 1 approval (the proposer) — threshold is 2
    client.execute(&signers[1], &pid);
}

#[test]
#[should_panic]
fn test_execute_twice_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (signers, client, target) = setup(&env, 3, 2);
    let pid = client.propose(&signers[0], &target, &MultisigAction::Pause);
    client.approve(&signers[1], &pid);
    client.execute(&signers[2], &pid);
    client.execute(&signers[2], &pid); // second execute must panic
}

#[test]
#[should_panic]
fn test_execute_expired_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (signers, client, target) = setup(&env, 3, 2);
    let pid = client.propose(&signers[0], &target, &MultisigAction::Pause);
    client.approve(&signers[1], &pid);
    env.ledger().with_mut(|l| l.timestamp = 172_801);
    client.execute(&signers[2], &pid);
}

#[test]
#[should_panic]
fn test_non_signer_cannot_execute() {
    let env = Env::default();
    env.mock_all_auths();
    let (signers, client, target) = setup(&env, 3, 2);
    let pid = client.propose(&signers[0], &target, &MultisigAction::Pause);
    client.approve(&signers[1], &pid);
    let outsider = Address::generate(&env);
    client.execute(&outsider, &pid);
}

// ── AC-010: the executed action is bound to the approved action ─────────────

/// A proposal records the full `(target, action)` pair, so `execute` has no
/// ambiguity about what was approved.
#[test]
fn test_proposal_records_target_and_action() {
    let env = Env::default();
    env.mock_all_auths();
    let (signers, client, target) = setup(&env, 3, 2);

    let ngn = CurrencyCode::new(&env, "NGN");
    let action = MultisigAction::SetRateAdmin(RateAdminArgs {
        currency: ngn,
        rate: 500,
    });
    let pid = client.propose(&signers[0], &target, &action);

    let proposal = client.get_proposal(&pid);
    assert_eq!(proposal.target, target);
    assert_eq!(proposal.action, action);
}

/// Executing a `Pause` proposal invokes `pause()` on the target *only*.  It
/// cannot reach `set_rate_admin`, `update_acbu_token`, or `upgrade`, which was
/// the privilege-escalation reported in AC-010.
#[test]
fn test_execute_invokes_only_the_approved_action() {
    let env = Env::default();
    env.mock_all_auths();
    let (signers, client, target) = setup(&env, 3, 2);
    let target_client = MockTargetClient::new(&env, &target);

    let pid = client.propose(&signers[0], &target, &MultisigAction::Pause);
    client.approve(&signers[1], &pid);
    client.execute(&signers[2], &pid);

    assert!(target_client.is_paused(), "pause() must have been invoked");
    assert_eq!(target_client.rate(), 0, "set_rate_admin must not have run");
    assert_eq!(target_client.stored_version(), 0, "upgrade must not have run");
    assert!(target_client.token().is_none(), "update_acbu_token must not have run");
}

#[test]
fn test_execute_invokes_set_rate_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let (signers, client, target) = setup(&env, 3, 2);
    let target_client = MockTargetClient::new(&env, &target);

    let ngn = CurrencyCode::new(&env, "NGN");
    let action = MultisigAction::SetRateAdmin(RateAdminArgs {
        currency: ngn,
        rate: 12_345,
    });
    let pid = client.propose(&signers[0], &target, &action);
    client.approve(&signers[1], &pid);
    client.execute(&signers[2], &pid);

    assert_eq!(target_client.rate(), 12_345);
    assert!(!target_client.is_paused(), "pause() must not have run");
}

#[test]
fn test_execute_invokes_update_acbu_token() {
    let env = Env::default();
    env.mock_all_auths();
    let (signers, client, target) = setup(&env, 3, 2);
    let target_client = MockTargetClient::new(&env, &target);

    let new_token = Address::generate(&env);
    let pid =
        client.propose(&signers[0], &target, &MultisigAction::UpdateAcbuToken(new_token.clone()));
    client.approve(&signers[1], &pid);
    client.execute(&signers[2], &pid);

    assert_eq!(target_client.token(), Some(new_token));
}

#[test]
fn test_execute_invokes_upgrade() {
    let env = Env::default();
    env.mock_all_auths();
    let (signers, client, target) = setup(&env, 3, 2);
    let target_client = MockTargetClient::new(&env, &target);

    let hash = dummy_hash(&env);
    let action = MultisigAction::Upgrade(UpgradeArgs {
        new_wasm_hash: hash.clone(),
        new_version: 7,
    });
    let pid = client.propose(&signers[0], &target, &action);
    client.approve(&signers[1], &pid);
    client.execute(&signers[2], &pid);

    assert_eq!(target_client.stored_version(), 7);
    assert_eq!(target_client.stored_hash(), hash);
}

/// The multisig can rotate its own signer set, but only through `execute` of an
/// explicitly approved `UpdateConfig` proposal targeting itself.
#[test]
fn test_execute_rotates_signers_via_update_config() {
    let env = Env::default();
    env.mock_all_auths();
    let (signers, client, _target) = setup(&env, 3, 2);

    let added = Address::generate(&env);
    let mut new_signers = soroban_sdk::Vec::new(&env);
    new_signers.push_back(signers[0].clone());
    new_signers.push_back(signers[1].clone());
    new_signers.push_back(added.clone());

    let self_id = client.address.clone();
    let pid = client.propose(
        &signers[0],
        &self_id,
        &MultisigAction::UpdateConfig(ConfigArgs {
            signers: new_signers.clone(),
            threshold: 3,
        }),
    );
    client.approve(&signers[1], &pid);
    client.approve(&signers[2], &pid);
    client.execute(&signers[0], &pid);

    let cfg = client.get_config();
    assert_eq!(cfg.threshold, 3, "threshold should be rotated");
    assert_eq!(cfg.signers.len(), 3, "signer set should be replaced");
    assert!(client.is_signer(&added), "new signer should be registered");
}

// ── Events ───────────────────────────────────────────────────────────────────

#[test]
fn test_propose_emits_event() {
    let env = Env::default();
    env.mock_all_auths();
    let (signers, client, target) = setup(&env, 3, 2);
    client.propose(&signers[0], &target, &MultisigAction::Pause);
    let events = env.events().all();
    assert!(!events.is_empty());
}

#[test]
fn test_execute_emits_event() {
    let env = Env::default();
    env.mock_all_auths();
    let (signers, client, target) = setup(&env, 3, 2);
    let pid = client.propose(&signers[0], &target, &MultisigAction::Pause);
    client.approve(&signers[1], &pid);
    client.execute(&signers[2], &pid);
    let events = env.events().all();
    // at least propose + approve + execute events
    assert!(events.len() >= 3);
}

// ── is_signer ────────────────────────────────────────────────────────────────

#[test]
fn test_is_signer_false_for_outsider() {
    let env = Env::default();
    env.mock_all_auths();
    let (_signers, client, _target) = setup(&env, 3, 2);
    let outsider = Address::generate(&env);
    assert!(!client.is_signer(&outsider));
}

// ── Regression: signer removal after approval ───────────────────────────────

/// Approvals from a signer who was later removed must not count toward the
/// threshold at execution time.
#[test]
#[should_panic]
fn test_execute_after_signer_removed_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (signers, client, target) = setup(&env, 3, 2);
    let pid = client.propose(&signers[0], &target, &MultisigAction::Pause);
    client.approve(&signers[1], &pid);

    // Rotate signer set: remove signers[0], keep signers[1], add a new signer.
    let mut new_signers = soroban_sdk::Vec::new(&env);
    new_signers.push_back(signers[1].clone());
    new_signers.push_back(signers[2].clone());
    new_signers.push_back(Address::generate(&env));
    let rotate = client.propose_update_config(&signers[1], &new_signers, &2);
    client.approve(&signers[2], &rotate);
    client.execute(&signers[2], &rotate);

    // signers[0] approved but is no longer a signer — execute must panic.
    client.execute(&signers[2], &pid);
}

// ── Additional Tests ─────────────────────────────────────────────────────────

/// Test that multiple proposals can exist simultaneously and be managed independently.
#[test]
fn test_multiple_concurrent_proposals() {
    let env = Env::default();
    env.mock_all_auths();
    let (signers, client, target) = setup(&env, 4, 3);

    // Create three different proposals
    let token = Address::generate(&env);
    let pid0 = client.propose(&signers[0], &target, &MultisigAction::Pause);
    let pid1 = client.propose(&signers[1], &target, &MultisigAction::Unpause);
    let pid2 =
        client.propose(&signers[2], &target, &MultisigAction::UpdateAcbuToken(token.clone()));

    assert_eq!(pid0, 0, "First proposal ID should be 0");
    assert_eq!(pid1, 1, "Second proposal ID should be 1");
    assert_eq!(pid2, 2, "Third proposal ID should be 2");

    // Each proposal should have only 1 approval (from proposer)
    assert_eq!(client.approval_count(&pid0), 1);
    assert_eq!(client.approval_count(&pid1), 1);
    assert_eq!(client.approval_count(&pid2), 1);

    // Approve first proposal to threshold and execute it
    client.approve(&signers[1], &pid0);
    client.approve(&signers[2], &pid0);
    client.execute(&signers[3], &pid0);

    // Verify first proposal is executed but others are not
    assert!(client.get_proposal(&pid0).executed);
    assert!(!client.get_proposal(&pid1).executed);
    assert!(!client.get_proposal(&pid2).executed);

    // Other proposals should still be independently approvable
    client.approve(&signers[0], &pid1);
    assert_eq!(client.approval_count(&pid1), 2);
}

/// Test edge case: 1-of-1 multisig (single signer scenario).
#[test]
fn test_single_signer_1_of_1() {
    let env = Env::default();
    env.mock_all_auths();
    let (signers, client, target) = setup(&env, 1, 1);

    let cfg = client.get_config();
    assert_eq!(cfg.threshold, 1, "Threshold should be 1");
    assert_eq!(cfg.signers.len(), 1, "Should have exactly 1 signer");

    // Propose automatically meets threshold
    let pid = client.propose(&signers[0], &target, &MultisigAction::Pause);
    assert_eq!(client.approval_count(&pid), 1, "Should have 1 approval");

    // Execute should succeed immediately
    client.execute(&signers[0], &pid);
    assert!(client.get_proposal(&pid).executed);
}

/// Test that approval count correctly reflects unique approvals after config changes.
#[test]
fn test_threshold_increase_requires_more_approvals() {
    let env = Env::default();
    env.mock_all_auths();
    let (signers, client, target) = setup(&env, 5, 2);

    // Create proposal and get initial approvals
    let pid = client.propose(&signers[0], &target, &MultisigAction::Pause);
    client.approve(&signers[1], &pid);
    assert_eq!(client.approval_count(&pid), 2, "Should have 2 approvals");

    // Update config to increase threshold to 4
    let mut same_signers = soroban_sdk::Vec::new(&env);
    for s in signers.iter() {
        same_signers.push_back(s.clone());
    }
    let raise = client.propose_update_config(&signers[2], &same_signers, &4);
    client.approve(&signers[3], &raise);
    client.execute(&signers[3], &raise);

    // Verify config updated
    let cfg = client.get_config();
    assert_eq!(cfg.threshold, 4, "Threshold should be updated to 4");
}

/// After the threshold is raised, existing proposals must be re-checked against
/// the new threshold before they can execute.
#[test]
#[should_panic]
fn test_execute_below_raised_threshold_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (signers, client, target) = setup(&env, 5, 2);

    let pid = client.propose(&signers[0], &target, &MultisigAction::Pause);
    client.approve(&signers[1], &pid);

    // Raise the threshold to 4 — the two approvals are no longer enough.
    let mut same_signers = soroban_sdk::Vec::new(&env);
    for s in signers.iter() {
        same_signers.push_back(s.clone());
    }
    let raise = client.propose_update_config(&signers[2], &same_signers, &4);
    client.approve(&signers[3], &raise);
    client.approve(&signers[4], &raise);
    client.approve(&signers[0], &raise);
    client.execute(&signers[1], &raise);

    client.execute(&signers[2], &pid);
}
