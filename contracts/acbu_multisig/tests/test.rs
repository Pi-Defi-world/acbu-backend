#![cfg(test)]

use acbu_multisig::{MultisigContract, MultisigContractClient};
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    Address, Env, String as SorobanString,
};

fn setup(env: &Env, n: usize, threshold: u32) -> (Vec<Address>, MultisigContractClient<'_>) {
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
    (rust_signers, client)
}

// ── Basic initialisation ────────────────────────────────────────────────────

#[test]
fn test_initialize_2_of_3() {
    let env = Env::default();
    env.mock_all_auths();
    let (signers, client) = setup(&env, 3, 2);
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
    let (_signers, client) = setup(&env, 5, 3);
    let cfg = client.get_config();
    assert_eq!(cfg.threshold, 3, "cfg.threshold should equal 3");
    assert_eq!(cfg.signers.len(), 5, "cfg.signers.len() should equal 5");
}

#[test]
#[should_panic]
fn test_initialize_twice_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, client) = setup(&env, 3, 2);
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
    let (signers, client) = setup(&env, 3, 2);
    let id = client.propose(&signers[0], &SorobanString::from_str(&env, "pause"));
    assert_eq!(id, 0, "id should equal 0");
}

#[test]
fn test_propose_increments_id() {
    let env = Env::default();
    env.mock_all_auths();
    let (signers, client) = setup(&env, 3, 2);
    let id0 = client.propose(&signers[0], &SorobanString::from_str(&env, "pause"));
    let id1 = client.propose(&signers[1], &SorobanString::from_str(&env, "upgrade"));
    assert_eq!(id0, 0, "id0 should equal 0");
    assert_eq!(id1, 1, "id1 should equal 1");
}

#[test]
fn test_proposer_approval_counted_immediately() {
    let env = Env::default();
    env.mock_all_auths();
    let (signers, client) = setup(&env, 3, 2);
    let pid = client.propose(&signers[0], &SorobanString::from_str(&env, "pause"));
    assert_eq!(client.approval_count(&pid), 1, "client.approval_count(&pid) should equal 1");
}

#[test]
#[should_panic]
fn test_non_signer_cannot_propose() {
    let env = Env::default();
    env.mock_all_auths();
    let (_signers, client) = setup(&env, 3, 2);
    let outsider = Address::generate(&env);
    client.propose(&outsider, &SorobanString::from_str(&env, "pause"));
}

// ── Approve ─────────────────────────────────────────────────────────────────

#[test]
fn test_approve_increments_count() {
    let env = Env::default();
    env.mock_all_auths();
    let (signers, client) = setup(&env, 3, 2);
    let pid = client.propose(&signers[0], &SorobanString::from_str(&env, "pause"));
    client.approve(&signers[1], &pid);
    assert_eq!(client.approval_count(&pid), 2, "client.approval_count(&pid) should equal 2");
}

#[test]
#[should_panic]
fn test_double_approve_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (signers, client) = setup(&env, 3, 2);
    let pid = client.propose(&signers[0], &SorobanString::from_str(&env, "pause"));
    client.approve(&signers[0], &pid); // already approved via propose
}

#[test]
#[should_panic]
fn test_non_signer_cannot_approve() {
    let env = Env::default();
    env.mock_all_auths();
    let (signers, client) = setup(&env, 3, 2);
    let pid = client.propose(&signers[0], &SorobanString::from_str(&env, "pause"));
    let outsider = Address::generate(&env);
    client.approve(&outsider, &pid);
}

#[test]
#[should_panic]
fn test_approve_expired_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (signers, client) = setup(&env, 3, 2);
    let pid = client.propose(&signers[0], &SorobanString::from_str(&env, "pause"));
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
    let (signers, client) = setup(&env, 3, 2);
    let pid = client.propose(&signers[0], &SorobanString::from_str(&env, "pause"));
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
    let (signers, client) = setup(&env, 5, 3);
    let pid = client.propose(&signers[0], &SorobanString::from_str(&env, "upgrade"));
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
    let (signers, client) = setup(&env, 3, 2);
    let pid = client.propose(&signers[0], &SorobanString::from_str(&env, "pause"));
    // only 1 approval (the proposer) — threshold is 2
    client.execute(&signers[1], &pid);
}

#[test]
#[should_panic]
fn test_execute_twice_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (signers, client) = setup(&env, 3, 2);
    let pid = client.propose(&signers[0], &SorobanString::from_str(&env, "pause"));
    client.approve(&signers[1], &pid);
    client.execute(&signers[2], &pid);
    client.execute(&signers[2], &pid); // second execute must panic
}

#[test]
#[should_panic]
fn test_execute_expired_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (signers, client) = setup(&env, 3, 2);
    let pid = client.propose(&signers[0], &SorobanString::from_str(&env, "pause"));
    client.approve(&signers[1], &pid);
    env.ledger().with_mut(|l| l.timestamp = 172_801);
    client.execute(&signers[2], &pid);
}

#[test]
#[should_panic]
fn test_non_signer_cannot_execute() {
    let env = Env::default();
    env.mock_all_auths();
    let (signers, client) = setup(&env, 3, 2);
    let pid = client.propose(&signers[0], &SorobanString::from_str(&env, "pause"));
    client.approve(&signers[1], &pid);
    let outsider = Address::generate(&env);
    client.execute(&outsider, &pid);
}

// ── Events ───────────────────────────────────────────────────────────────────

#[test]
fn test_propose_emits_event() {
    let env = Env::default();
    env.mock_all_auths();
    let (signers, client) = setup(&env, 3, 2);
    client.propose(&signers[0], &SorobanString::from_str(&env, "pause"));
    let events = env.events().all();
    assert!(!events.is_empty());
}

#[test]
fn test_execute_emits_event() {
    let env = Env::default();
    env.mock_all_auths();
    let (signers, client) = setup(&env, 3, 2);
    let pid = client.propose(&signers[0], &SorobanString::from_str(&env, "pause"));
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
    let (_signers, client) = setup(&env, 3, 2);
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
    let (signers, client) = setup(&env, 3, 2);
    let pid = client.propose(&signers[0], &SorobanString::from_str(&env, "pause"));
    client.approve(&signers[1], &pid);

    // Rotate signer set: remove signers[0], keep signers[1], add a new signer.
    let mut new_signers = soroban_sdk::Vec::new(&env);
    new_signers.push_back(signers[1].clone());
    new_signers.push_back(signers[2].clone());
    new_signers.push_back(Address::generate(&env));
    client.update_config(&new_signers, &2);

    // signers[0] approved but is no longer a signer — execute must panic.
    client.execute(&signers[2], &pid);
}

// ── Additional Tests ─────────────────────────────────────────────────────────

/// Test that multiple proposals can exist simultaneously and be managed independently.
#[test]
fn test_multiple_concurrent_proposals() {
    let env = Env::default();
    env.mock_all_auths();
    let (signers, client) = setup(&env, 4, 3);
    
    // Create three different proposals
    let pid0 = client.propose(&signers[0], &SorobanString::from_str(&env, "pause"));
    let pid1 = client.propose(&signers[1], &SorobanString::from_str(&env, "upgrade"));
    let pid2 = client.propose(&signers[2], &SorobanString::from_str(&env, "transfer"));
    
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
    let (signers, client) = setup(&env, 1, 1);
    
    let cfg = client.get_config();
    assert_eq!(cfg.threshold, 1, "Threshold should be 1");
    assert_eq!(cfg.signers.len(), 1, "Should have exactly 1 signer");
    
    // Propose automatically meets threshold
    let pid = client.propose(&signers[0], &SorobanString::from_str(&env, "pause"));
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
    let (signers, client) = setup(&env, 5, 2);
    
    // Create proposal and get initial approvals
    let pid = client.propose(&signers[0], &SorobanString::from_str(&env, "pause"));
    client.approve(&signers[1], &pid);
    assert_eq!(client.approval_count(&pid), 2, "Should have 2 approvals");
    
    // Update config to increase threshold to 4
    let mut same_signers = soroban_sdk::Vec::new(&env);
    for i in 0..5 {
        same_signers.push_back(signers[i].clone());
    }
    client.update_config(&same_signers, &4);
    
    // Verify config updated
    let cfg = client.get_config();
    assert_eq!(cfg.threshold, 4, "Threshold should be updated to 4");
    
    // With only 2 approvals and new threshold of 4, execution should fail
    // (This test verifies the threshold is enforced after config changes)
    let result = std::panic::catch_unwind(|| {
        client.execute(&signers[2], &pid);
    });
    assert!(result.is_err(), "Execute should panic when approvals are below new threshold");
}
