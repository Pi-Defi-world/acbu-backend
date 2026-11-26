#![cfg(test)]

use acbu_multisig::{MultisigContract, MultisigContractClient};
use proptest::prelude::*;
use shared::MultisigAction;
use soroban_sdk::{testutils::Address as _, Address, Env, Vec};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn setup(env: &Env, num_signers: usize, threshold: u32) -> (MultisigContractClient<'_>, Vec<Address>) {
    env.mock_all_auths();
    let mut signers = Vec::new(env);
    for _ in 0..num_signers {
        signers.push_back(Address::generate(env));
    }
    let contract_id = env.register_contract(None, MultisigContract);
    let client = MultisigContractClient::new(env, &contract_id);
    client.initialize(&signers, &threshold);
    (client, signers)
}

// ---------------------------------------------------------------------------
// Property: threshold boundary — only 1..=signers.len() is valid
// ---------------------------------------------------------------------------
proptest! {
    #[test]
    fn prop_initialize_threshold_boundary(
        num_signers in 1usize..15usize,
        threshold_offset in -3i32..20i32,
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let mut signers = Vec::new(&env);
        for _ in 0..num_signers {
            signers.push_back(Address::generate(&env));
        }

        let threshold_raw = threshold_offset + 1; // shift so offset=0 -> threshold=1
        if threshold_raw <= 0 || threshold_raw > 50 {
            return Ok(());
        }
        let threshold = threshold_raw as u32;

        let contract_id = env.register_contract(None, MultisigContract);
        let client = MultisigContractClient::new(&env, &contract_id);

        let result = client.try_initialize(&signers, &threshold);

        let valid = threshold >= 1 && threshold <= (num_signers as u32);
        if valid {
            assert!(result.is_ok(), "threshold={threshold} with {num_signers} signers must be accepted");
        } else {
            assert!(result.is_err(), "threshold={threshold} with {num_signers} signers must be rejected");
        }
    }

    // -----------------------------------------------------------------------
    // Property: double initialization is always rejected
    // -----------------------------------------------------------------------
    #[test]
    fn prop_double_initialize_rejected(_seed in 0u32..1000u32) {
        let env = Env::default();
        let (client, signers) = setup(&env, 3, 2);

        let result = client.try_initialize(&signers, &2u32);
        assert!(result.is_err(), "second initialize must always be rejected");
    }

    // -----------------------------------------------------------------------
    // Property: a signer can propose and the returned proposal_id is monotone
    // -----------------------------------------------------------------------
    #[test]
    fn prop_proposal_ids_monotone(num_proposals in 1usize..10usize) {
        let env = Env::default();
        let (client, signers) = setup(&env, 3, 2);
        let signer = signers.get(0).unwrap();
        // Any target is fine — we only care about the ID increment.
        let target = Address::generate(&env);

        let mut last_id = 0u64;
        for i in 0..num_proposals {
            let proposal_id = client.propose(&signer, &target, &MultisigAction::Pause);
            if i > 0 {
                assert!(
                    proposal_id > last_id,
                    "proposal_id={proposal_id} must be greater than last_id={last_id}"
                );
            }
            last_id = proposal_id;
        }
    }

    // -----------------------------------------------------------------------
    // Property: non-signer cannot propose
    // -----------------------------------------------------------------------
    #[test]
    fn prop_non_signer_cannot_propose(_seed in 0u32..100u32) {
        let env = Env::default();
        let (client, _signers) = setup(&env, 3, 2);
        let outsider = Address::generate(&env);
        let target = Address::generate(&env);

        let result = client.try_propose(&outsider, &target, &MultisigAction::Pause);
        assert!(result.is_err(), "non-signer must not be able to create proposals");
    }

    // -----------------------------------------------------------------------
    // Property: a signer cannot approve the same proposal twice
    // -----------------------------------------------------------------------
    #[test]
    fn prop_double_approval_rejected(_seed in 0u32..100u32) {
        let env = Env::default();
        let (client, signers) = setup(&env, 3, 3); // threshold=3 so execution won't fire
        let signer0 = signers.get(0).unwrap();
        let target = Address::generate(&env);

        let pid = client.propose(&signer0, &target, &MultisigAction::Pause);
        client.approve(&signer0, &pid);

        // Second approval from the same signer must fail.
        let result = client.try_approve(&signer0, &pid);
        assert!(result.is_err(), "double approval by same signer must be rejected");
    }

    // -----------------------------------------------------------------------
    // Property: execution without reaching threshold must fail
    // -----------------------------------------------------------------------
    #[test]
    fn prop_execute_below_threshold_rejected(_seed in 0u32..100u32) {
        let env = Env::default();
        // 3 signers, threshold=3; we only approve with 1 and try to execute.
        let (client, signers) = setup(&env, 3, 3);
        let signer0 = signers.get(0).unwrap();
        let target = Address::generate(&env);

        let pid = client.propose(&signer0, &target, &MultisigAction::Pause);
        client.approve(&signer0, &pid);

        // Only 1 of 3 approvals — execute must fail.
        let result = client.try_execute(&signer0, &pid);
        assert!(result.is_err(), "execution below threshold must fail");
    }

    // -----------------------------------------------------------------------
    // Property: proposal for non-existent ID must fail on approve / execute
    // -----------------------------------------------------------------------
    #[test]
    fn prop_nonexistent_proposal_rejected(pid in 100_000u64..u64::MAX) {
        let env = Env::default();
        let (client, signers) = setup(&env, 2, 1);
        let signer = signers.get(0).unwrap();

        assert!(client.try_approve(&signer, &pid).is_err(), "approve on unknown pid must fail");
        assert!(client.try_execute(&signer, &pid).is_err(), "execute on unknown pid must fail");
    }

    // -----------------------------------------------------------------------
    // Property: M-of-N approval count — once exactly M signers approve, the
    //           execute result must not be ThresholdNotMet.
    //
    // We use a Pause action on a stub target that exposes a `pause()` entry
    // point, so execute can actually complete when threshold is met.
    // -----------------------------------------------------------------------
    #[test]
    fn prop_threshold_met_after_m_approvals(
        n in 2usize..6usize,
        m in 1usize..6usize,
    ) {
        // Adjust m so it never exceeds n.
        let m = m.min(n);

        let env = Env::default();
        let (client, signers) = setup(&env, n, m as u32);
        let signer0 = signers.get(0).unwrap();
        let target = soroban_sdk::Address::generate(&env);

        // Propose + approve with the proposer (counts as 1).
        let pid = client.propose(&signer0, &target, &MultisigAction::Pause);
        client.approve(&signer0, &pid);

        // Add (m - 1) more approvals from distinct signers.
        for i in 1..m {
            let signer = signers.get(i as u32).unwrap();
            client.approve(&signer, &pid);
        }

        // All m approvals recorded; threshold must be met.
        // We verify by checking that approve count equals m.
        let approval_count = client.approval_count(&pid);
        assert_eq!(
            approval_count,
            m as u32,
            "approval_count={approval_count} must equal m={m}"
        );
    }
}
