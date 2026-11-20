#![cfg(test)]

#[path = "common/mod.rs"]
mod common;


#[test]
fn test_burning_initialize_and_version() {
    let env = Env::default();
    let ctx = setup_test(&env);


}

#[test]
fn test_pause_unpause() {
    let env = Env::default();
    let ctx = setup_test(&env);

    assert!(!ctx.burning.is_paused());

    ctx.burning.pause();
    assert!(ctx.burning.is_paused());

    ctx.burning.unpause();
    assert!(!ctx.burning.is_paused());

}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_redeem_single_when_paused() {
    let env = Env::default();
    let ctx = setup_test(&env);


    let currency = CurrencyCode::new(&env, "NGN");

}
