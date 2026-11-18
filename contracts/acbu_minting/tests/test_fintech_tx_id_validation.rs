// Integration tests for C-039: strict input validation for fintech_tx_id
//
// Acceptance check: invalid IDs are rejected at the contract boundary.
//
// Rules under test:
//   1. Empty string → rejected
//   2. Too short (< 8 chars) → rejected
//   3. Too long (> 64 chars) → rejected
//   4. Invalid charset: space → rejected
//   5. Invalid charset: special chars (@, #, $, !, ., /) → rejected
//   6. Invalid charset: non-ASCII / unicode → rejected
//   7. Invalid charset: control characters → rejected
//   8. Valid: exactly 8 chars (min boundary) → accepted
//   9. Valid: exactly 64 chars (max boundary) → accepted
//  10. Valid: alphanumeric only → accepted
//  11. Valid: hyphens and underscores → accepted
//  12. Valid: mixed case alphanumeric with hyphens/underscores → accepted
//  13. Uniqueness: duplicate ID → rejected
//  14. Uniqueness: distinct IDs → both accepted
//  15. Uniqueness: ID reuse after different ID used → still rejected
#![cfg(test)]

use acbu_minting::{MintingContract, MintingContractClient};
use shared::{CurrencyCode, DECIMALS};
use soroban_sdk::{
    contract, contractimpl, symbol_short,
    testutils::Address as _,
    Address, Env, String as SorobanString, Vec,
};

// ── Mocks ────────────────────────────────────────────────────────────────────

mod oracle_mock {
    use soroban_sdk::{contract, contractimpl, Address, Env, Vec};

    use shared::CurrencyCode;
    use super::DECIMALS;

    #[contract]
    pub struct MockOracle;

    #[contractimpl]
    impl MockOracle {
        pub fn get_acbu_usd_rate_with_timestamp(env: Env) -> (i128, u64) {
            (DECIMALS, env.ledger().timestamp())
        }
        pub fn get_rate_with_timestamp(env: Env, _c: CurrencyCode) -> (i128, u64) {
            (DECIMALS, env.ledger().timestamp())
        }
        pub fn get_currencies(env: Env) -> Vec<CurrencyCode> {
            Vec::new(&env)
        }
        pub fn get_basket_weight(_env: Env, _c: CurrencyCode) -> i128 {
            0
        }
        pub fn get_rate(_env: Env, _c: CurrencyCode) -> i128 {
            DECIMALS
        }
        pub fn get_s_token_address(env: Env, _c: CurrencyCode) -> Address {
            Address::generate(&env)
        }
    }
}

mod reserve_mock {
    use soroban_sdk::{contract, contractimpl, Env};

    #[contract]
    pub struct MockReserveTracker;

    #[contractimpl]
    impl MockReserveTracker {
        pub fn is_reserve_sufficient(_env: Env, _supply: i128) -> bool {
            true
        }
    }
}

// ── Harness ──────────────────────────────────────────────────────────────────

struct Harness {
    env: Env,
    operator: Address,
    recipient: Address,
    acbu_token: Address,
    client: MintingContractClient<'static>,
}

impl Harness {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let operator = Address::generate(&env);
        let recipient = Address::generate(&env);

        let oracle = env.register_contract(None, oracle_mock::MockOracle);
        let reserve_tracker = env.register_contract(None, reserve_mock::MockReserveTracker);

        let contract_id = env.register_contract(None, MintingContract);
        let acbu_token = env
            .register_stellar_asset_contract_v2(contract_id.clone())
            .address();
        let usdc_token = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();

        let client = MintingContractClient::new(
            unsafe { &*(&env as *const Env) },
            &contract_id,
        );

        let config = acbu_minting::MintingConfig {
            admin: admin.clone(),
            oracle: oracle.clone(),
            reserve_tracker: reserve_tracker.clone(),
            acbu_token: acbu_token.clone(),
            usdc_token: usdc_token.clone(),
            vault: admin.clone(),
            treasury: admin.clone(),
            fee_rate_bps: 50,
            fee_single_bps: 100,
            operator: admin.clone(),
        };
        client.initialize(&config);

        client.set_operator(&operator);

        Self {
            env,
            operator,
            recipient,
            acbu_token,
            client,
        }
    }

    /// Call mint_from_fiat and return the Result so tests can assert on errors.
    fn try_mint(&self, tx_id: &str) -> bool {
        let id = SorobanString::from_str(&self.env, tx_id);
        self.client.try_mint_from_fiat(
            &self.operator,
            &self.recipient,
            &CurrencyCode::new(&self.env, "NGN"),
            &(50 * DECIMALS), // valid fiat amount
            &id,
        ).is_ok()
    }

    /// Call mint_from_fiat and expect success.
    fn mint_ok(&self, tx_id: &str) -> i128 {
        let id = SorobanString::from_str(&self.env, tx_id);
        self.client
            .mint_from_fiat(
                &self.operator,
                &self.recipient,
                &CurrencyCode::new(&self.env, "NGN"),
                &(50 * DECIMALS),
                &id,
            )
    }

    /// Call mint_from_fiat and expect failure.
    fn mint_err(&self, tx_id: &str) {
        assert!(
            !self.try_mint(tx_id),
            "expected rejection for id {:?} but it was accepted",
            tx_id
        );
    }
}

// ── 1. Empty string ───────────────────────────────────────────────────────────

#[test]
fn test_empty_id_rejected() {
    let h = Harness::new();
    h.mint_err("");
}

// ── 2. Too short (< 8 chars) ──────────────────────────────────────────────────

#[test]
fn test_id_length_1_rejected() {
    let h = Harness::new();
    h.mint_err("A");
}

#[test]
fn test_id_length_7_rejected() {
    let h = Harness::new();
    h.mint_err("ABCDEFG"); // 7 chars — one short of minimum
}

// ── 3. Too long (> 64 chars) ──────────────────────────────────────────────────

#[test]
fn test_id_length_65_rejected() {
    let h = Harness::new();
    // 65 alphanumeric characters — one over the maximum
    h.mint_err("A1234567890123456789012345678901234567890123456789012345678901234");
}

#[test]
fn test_id_length_100_rejected() {
    let h = Harness::new();
    h.mint_err("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
}

// ── 4. Invalid charset: space ─────────────────────────────────────────────────

#[test]
fn test_id_with_space_rejected() {
    let h = Harness::new();
    h.mint_err("fintech tx001"); // space in the middle
}

#[test]
fn test_id_with_leading_space_rejected() {
    let h = Harness::new();
    h.mint_err(" fintech001"); // leading space
}

#[test]
fn test_id_with_trailing_space_rejected() {
    let h = Harness::new();
    h.mint_err("fintech001 "); // trailing space
}

// ── 5. Invalid charset: special characters ────────────────────────────────────

#[test]
fn test_id_with_at_sign_rejected() {
    let h = Harness::new();
    h.mint_err("fintech@001");
}

#[test]
fn test_id_with_hash_rejected() {
    let h = Harness::new();
    h.mint_err("fintech#001");
}

#[test]
fn test_id_with_dollar_rejected() {
    let h = Harness::new();
    h.mint_err("fintech$001");
}

#[test]
fn test_id_with_exclamation_rejected() {
    let h = Harness::new();
    h.mint_err("fintech!001");
}

#[test]
fn test_id_with_dot_rejected() {
    let h = Harness::new();
    h.mint_err("fintech.001");
}

#[test]
fn test_id_with_slash_rejected() {
    let h = Harness::new();
    h.mint_err("fintech/001");
}

#[test]
fn test_id_with_colon_rejected() {
    let h = Harness::new();
    h.mint_err("fintech:001");
}

#[test]
fn test_id_with_plus_rejected() {
    let h = Harness::new();
    h.mint_err("fintech+001");
}

#[test]
fn test_id_with_equals_rejected() {
    let h = Harness::new();
    h.mint_err("fintech=001");
}

#[test]
fn test_id_with_percent_rejected() {
    let h = Harness::new();
    h.mint_err("fintech%001");
}

#[test]
fn test_id_with_ampersand_rejected() {
    let h = Harness::new();
    h.mint_err("fintech&001");
}

#[test]
fn test_id_with_asterisk_rejected() {
    let h = Harness::new();
    h.mint_err("fintech*001");
}

#[test]
fn test_id_with_open_paren_rejected() {
    let h = Harness::new();
    h.mint_err("fintech(001");
}

#[test]
fn test_id_with_backslash_rejected() {
    let h = Harness::new();
    h.mint_err("fintech\\001");
}

#[test]
fn test_id_with_pipe_rejected() {
    let h = Harness::new();
    h.mint_err("fintech|001");
}

#[test]
fn test_id_with_tilde_rejected() {
    let h = Harness::new();
    h.mint_err("fintech~001");
}

#[test]
fn test_id_with_backtick_rejected() {
    let h = Harness::new();
    h.mint_err("fintech`001");
}

#[test]
fn test_id_with_caret_rejected() {
    let h = Harness::new();
    h.mint_err("fintech^001");
}

#[test]
fn test_id_with_open_bracket_rejected() {
    let h = Harness::new();
    h.mint_err("fintech[001");
}

#[test]
fn test_id_with_open_brace_rejected() {
    let h = Harness::new();
    h.mint_err("fintech{001");
}

#[test]
fn test_id_with_semicolon_rejected() {
    let h = Harness::new();
    h.mint_err("fintech;001");
}

#[test]
fn test_id_with_quote_rejected() {
    let h = Harness::new();
    h.mint_err("fintech'001");
}

#[test]
fn test_id_with_double_quote_rejected() {
    let h = Harness::new();
    h.mint_err("fintech\"001");
}

#[test]
fn test_id_with_comma_rejected() {
    let h = Harness::new();
    h.mint_err("fintech,001");
}

#[test]
fn test_id_with_less_than_rejected() {
    let h = Harness::new();
    h.mint_err("fintech<001");
}

#[test]
fn test_id_with_greater_than_rejected() {
    let h = Harness::new();
    h.mint_err("fintech>001");
}

#[test]
fn test_id_with_question_mark_rejected() {
    let h = Harness::new();
    h.mint_err("fintech?001");
}

// ── 6. Invalid charset: non-ASCII / unicode ───────────────────────────────────

#[test]
fn test_id_with_unicode_emoji_rejected() {
    let h = Harness::new();
    // "fintech" + emoji — multi-byte UTF-8 sequence
    h.mint_err("fintech\u{1F600}001");
}

#[test]
fn test_id_with_accented_char_rejected() {
    let h = Harness::new();
    h.mint_err("fintéch001"); // é is U+00E9, two bytes in UTF-8
}

#[test]
fn test_id_with_arabic_char_rejected() {
    let h = Harness::new();
    h.mint_err("fintech\u{0627}001"); // Arabic letter alef
}

// ── 7. Invalid charset: control characters ────────────────────────────────────

#[test]
fn test_id_with_newline_rejected() {
    let h = Harness::new();
    h.mint_err("fintech\n001");
}

#[test]
fn test_id_with_tab_rejected() {
    let h = Harness::new();
    h.mint_err("fintech\t001");
}

#[test]
fn test_id_with_null_byte_rejected() {
    let h = Harness::new();
    h.mint_err("fintech\x00001");
}

#[test]
fn test_id_with_carriage_return_rejected() {
    let h = Harness::new();
    h.mint_err("fintech\r001");
}

// ── 8. Valid: exactly 8 chars (minimum boundary) ─────────────────────────────

#[test]
fn test_id_exactly_min_length_accepted() {
    let h = Harness::new();
    assert!(
        h.try_mint("ABCD1234"),
        "ID of exactly 8 characters must be accepted"
    );
}

// ── 9. Valid: exactly 64 chars (maximum boundary) ────────────────────────────

#[test]
fn test_id_exactly_max_length_accepted() {
    let h = Harness::new();
    assert!(
        h.try_mint("A123456789012345678901234567890123456789012345678901234567890123"),
        "ID of exactly 64 characters must be accepted"
    );
}

// ── 10. Valid: alphanumeric only ──────────────────────────────────────────────

#[test]
fn test_id_alphanumeric_only_accepted() {
    let h = Harness::new();
    assert!(h.try_mint("fintech001"));
}

#[test]
fn test_id_all_digits_accepted() {
    let h = Harness::new();
    assert!(h.try_mint("12345678"));
}

#[test]
fn test_id_all_uppercase_accepted() {
    let h = Harness::new();
    assert!(h.try_mint("ABCDEFGH"));
}

#[test]
fn test_id_all_lowercase_accepted() {
    let h = Harness::new();
    assert!(h.try_mint("abcdefgh"));
}

// ── 11. Valid: hyphens and underscores ────────────────────────────────────────

#[test]
fn test_id_with_hyphens_accepted() {
    let h = Harness::new();
    assert!(h.try_mint("fintech-tx-001"));
}

#[test]
fn test_id_with_underscores_accepted() {
    let h = Harness::new();
    assert!(h.try_mint("fintech_tx_001"));
}

#[test]
fn test_id_with_leading_hyphen_accepted() {
    let h = Harness::new();
    assert!(h.try_mint("-fintech001"));
}

#[test]
fn test_id_with_leading_underscore_accepted() {
    let h = Harness::new();
    assert!(h.try_mint("_fintech001"));
}

// ── 12. Valid: mixed case with hyphens/underscores ────────────────────────────

#[test]
fn test_id_uuid_style_accepted() {
    let h = Harness::new();
    assert!(h.try_mint("a1b2c3d4-e5f6-7890-abcd-ef1234567890"));
}

#[test]
fn test_id_typical_fintech_format_accepted() {
    let h = Harness::new();
    assert!(h.try_mint("FLW-TXN-20240101-001"));
}

#[test]
fn test_id_paystack_style_accepted() {
    let h = Harness::new();
    assert!(h.try_mint("PSK_test_abc123XYZ"));
}

// ── 13. Uniqueness: duplicate ID rejected ─────────────────────────────────────

#[test]
fn test_duplicate_id_rejected() {
    let h = Harness::new();
    let tx_id = "fintech-tx-dup001";

    assert!(h.try_mint(tx_id), "first use of ID must succeed");
    assert!(
        !h.try_mint(tx_id),
        "duplicate fintech_tx_id must be rejected (C-039 uniqueness)"
    );
}

// ── 14. Uniqueness: distinct IDs both accepted ────────────────────────────────

#[test]
fn test_distinct_ids_both_accepted() {
    let h = Harness::new();

    assert!(h.try_mint("fintech-tx-00001"));
    assert!(h.try_mint("fintech-tx-00002"));
    assert!(h.try_mint("fintech-tx-00003"));
}

// ── 15. Uniqueness: reuse after different ID used ─────────────────────────────

#[test]
fn test_id_reuse_still_rejected_after_other_ids_used() {
    let h = Harness::new();
    let first_id = "fintech-tx-first1";
    let second_id = "fintech-tx-secnd1";

    assert!(h.try_mint(first_id));
    assert!(h.try_mint(second_id));
    assert!(
        !h.try_mint(first_id),
        "previously used ID must remain rejected even after other IDs are processed"
    );
}

// ── 16. Boundary: 7-char ID rejected, 8-char ID accepted (off-by-one) ─────────

#[test]
fn test_length_boundary_7_vs_8() {
    let h = Harness::new();
    assert!(!h.try_mint("1234567"), "7-char ID must be rejected");
    assert!(h.try_mint("12345678"), "8-char ID must be accepted");
}

// ── 17. Boundary: 64-char ID accepted, 65-char ID rejected (off-by-one) ───────

#[test]
fn test_length_boundary_64_vs_65() {
    let h = Harness::new();

    let id_64 = "A234567890123456789012345678901234567890123456789012345678901234";
    assert_eq!(id_64.len(), 64, "id_64.len() should equal 64");
    assert!(h.try_mint(id_64), "64-char ID must be accepted");

    let id_65 = "A2345678901234567890123456789012345678901234567890123456789012345";
    assert_eq!(id_65.len(), 65, "id_65.len() should equal 65");
    assert!(!h.try_mint(id_65), "65-char ID must be rejected");
}

// ── 18. Validation fires before uniqueness check ──────────────────────────────

#[test]
fn test_invalid_id_rejected_before_uniqueness_check() {
    let h = Harness::new();
    assert!(
        !h.try_mint("bad id here!"),
        "invalid ID must be rejected regardless of uniqueness"
    );
}

// ── 19. Whitespace-only ID rejected ───────────────────────────────────────────

#[test]
fn test_whitespace_only_id_rejected() {
    let h = Harness::new();
    h.mint_err("        "); // 8 spaces — meets length but fails charset
}

// ── 20. MintEvent carries the validated tx_id verbatim ────────────────────────

/// After a successful mint, the MintEvent.transaction_id must equal the
/// fintech_tx_id that was passed in.
#[test]
fn test_mint_event_carries_validated_tx_id() {
    use soroban_sdk::{
        symbol_short,
        testutils::Events,
        FromVal, IntoVal, Symbol,
    };
    use shared::MintEvent;

    let h = Harness::new();
    let tx_id_str = "FLW-TXN-20240101";
    let tx_id = SorobanString::from_str(&h.env, tx_id_str);

    h.client
        .mint_from_fiat(
            &h.operator,
            &h.recipient,
            &CurrencyCode::new(&h.env, "NGN"),
            &(50 * DECIMALS),
            &tx_id,
        );

    let events = h.env.events().all();
    let mint_event = events
        .iter()
        .rev()
        .find(|e| {
            e.0 == h.client.address
                && Symbol::from_val(&h.env, &e.1.get(0).unwrap()) == symbol_short!("mint")
        })
        .expect("mint event must be emitted");

    let ev: MintEvent = mint_event.2.into_val(&h.env);
    assert_eq!(
        ev.transaction_id,
        tx_id,
        "MintEvent.transaction_id must equal the validated fintech_tx_id"
    );
}
