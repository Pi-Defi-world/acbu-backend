#![cfg(test)]

use acbu_escrow::EscrowError;
use std::string::ToString;

#[test]
fn error_display_is_human_readable() {
    assert_eq!(EscrowError::Paused.to_string(), "escrow is paused");
}
