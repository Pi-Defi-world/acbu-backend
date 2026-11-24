#![cfg(test)]

//! Snapshot validation module
//!
//! This module provides utilities to validate that test snapshots are not stale
//! and accurately reflect the current contract implementation.
//!
//! ## Problem
//! Snapshot files may reference old variable names or event field names.
//! If snapshots are not regenerated after refactoring, snapshot-based tests
//! can pass with stale data, creating a false sense of security.
//!
//! ## Solution
//! This module provides:
//! 1. Snapshot schema validation to detect structural changes
//! 2. Field name validation against current contract implementation
//! 3. Automated snapshot regeneration utilities
//! 4. Snapshot freshness checks

use soroban_sdk::{Env, Symbol};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

/// Expected storage keys that should be present in contract snapshots
/// Update this list when storage keys are added/removed/renamed
const EXPECTED_STORAGE_KEYS: &[&str] = &[
    "ACBU_TKN",
    "ADMIN",
    "FEE_RATE",
    "FEE_SGL",
    "FTX_IDS",
    "MAX_DRIP",
    "MAX_MINT",
    "MAX_SUP",
    "MIN_MINT",
    "OPERATOR",
    "ORACLE",
    "PEND_ADM",
    "PA_ETA",
    "PHASE",
    "PRF_SET",
    "PROOFS",
    "RES_TRK",
    "SUPPLY",
    "TRSY",
    "TX_NONCE",
    "USDC_TKN",
    "VAULT",
];

/// Expected event types that should be emitted by the contract
/// Update this list when event types are added/removed/renamed
const EXPECTED_EVENT_TYPES: &[&str] = &[
    "mint",
    "adm_init",
    "adm_done",
    "adm_cncl",
];

/// Represents the result of snapshot validation
#[derive(Debug, Clone)]
pub struct ValidationResult {
    pub is_valid: bool,
    pub missing_keys: Vec<String>,
    pub unexpected_keys: Vec<String>,
    pub missing_events: Vec<String>,
    pub errors: Vec<String>,
}

impl ValidationResult {
    pub fn new() -> Self {
        Self {
            is_valid: true,
            missing_keys: Vec::new(),
            unexpected_keys: Vec::new(),
            missing_events: Vec::new(),
            errors: Vec::new(),
        }
    }

    pub fn add_error(&mut self, error: String) {
        self.is_valid = false;
        self.errors.push(error);
    }

    pub fn report(&self) -> String {
        let mut report = String::new();
        report.push_str("=== Snapshot Validation Report ===\n");
        
        if self.is_valid {
            report.push_str("✓ All snapshots are valid\n");
        } else {
            report.push_str("✗ Snapshot validation failed\n\n");
            
            if !self.missing_keys.is_empty() {
                report.push_str("Missing storage keys:\n");
                for key in &self.missing_keys {
                    report.push_str(&format!("  - {}\n", key));
                }
                report.push('\n');
            }
            
            if !self.unexpected_keys.is_empty() {
                report.push_str("Unexpected storage keys (possibly renamed/removed):\n");
                for key in &self.unexpected_keys {
                    report.push_str(&format!("  - {}\n", key));
                }
                report.push('\n');
            }
            
            if !self.missing_events.is_empty() {
                report.push_str("Missing event types:\n");
                for event in &self.missing_events {
                    report.push_str(&format!("  - {}\n", event));
                }
                report.push('\n');
            }
            
            if !self.errors.is_empty() {
                report.push_str("Errors:\n");
                for error in &self.errors {
                    report.push_str(&format!("  - {}\n", error));
                }
            }
        }
        
        report
    }
}

/// Get the path to the snapshot directory
pub fn snapshot_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("test_snapshots")
}

/// List all snapshot files in the snapshot directory
pub fn list_snapshots() -> Result<Vec<PathBuf>, std::io::Error> {
    let dir = snapshot_dir();
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut snapshots = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("json") {
            snapshots.push(path);
        }
    }
    Ok(snapshots)
}

/// Validate a single snapshot file
pub fn validate_snapshot(path: &Path) -> ValidationResult {
    let mut result = ValidationResult::new();

    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(e) => {
            result.add_error(format!("Failed to read snapshot: {}", e));
            return result;
        }
    };

    let snapshot: serde_json::Value = match serde_json::from_str(&content) {
        Ok(s) => s,
        Err(e) => {
            result.add_error(format!("Failed to parse snapshot JSON: {}", e));
            return result;
        }
    };

    // Validate storage keys
    if let Some(ledger) = snapshot.get("ledger") {
        if let Some(entries) = ledger.get("ledger_entries").and_then(|e| e.as_array()) {
            let mut found_keys = HashSet::new();
            
            for entry in entries {
                if let Some(data_array) = entry.as_array() {
                    if data_array.len() >= 2 {
                        if let Some(ledger_entry_data) = data_array[1].as_array() {
                            if let Some(data_obj) = ledger_entry_data.get(0) {
                                if let Some(data) = data_obj.get("data") {
                                    if let Some(contract_data) = data.get("contract_data") {
                                        if let Some(val) = contract_data.get("val") {
                                            if let Some(contract_instance) = val.get("contract_instance") {
                                                if let Some(storage) = contract_instance.get("storage").and_then(|s| s.as_array()) {
                                                    for item in storage {
                                                        if let Some(key) = item.get("key") {
                                                            if let Some(symbol) = key.get("symbol").and_then(|s| s.as_str()) {
                                                                found_keys.insert(symbol.to_string());
                                                            }
                                                            if let Some(vec) = key.get("vec").and_then(|v| v.as_array()) {
                                                                if let Some(first) = vec.first() {
                                                                    if let Some(symbol) = first.get("symbol").and_then(|s| s.as_str()) {
                                                                        found_keys.insert(symbol.to_string());
                                                                    }
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Check for missing expected keys
            let expected_set: HashSet<String> = EXPECTED_STORAGE_KEYS.iter().map(|s| s.to_string()).collect();
            for expected in &expected_set {
                if !found_keys.contains(expected) {
                    result.missing_keys.push(expected.clone());
                    result.is_valid = false;
                }
            }

            // Check for unexpected keys (potential renames/removals)
            for found in &found_keys {
                if !expected_set.contains(found) {
                    result.unexpected_keys.push(found.clone());
                    result.is_valid = false;
                }
            }
        }
    }

    // Validate event types
    if let Some(events) = snapshot.get("events").and_then(|e| e.as_array()) {
        let mut found_events = HashSet::new();
        
        for event in events {
            if let Some(event_obj) = event.get("event") {
                if let Some(body) = event_obj.get("body") {
                    if let Some(v0) = body.get("v0") {
                        if let Some(topics) = v0.get("topics").and_then(|t| t.as_array()) {
                            if let Some(first_topic) = topics.first() {
                                if let Some(symbol) = first_topic.get("symbol").and_then(|s| s.as_str()) {
                                    if symbol != "fn_call" && symbol != "fn_return" && symbol != "error" {
                                        found_events.insert(symbol.to_string());
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // Note: We don't mark snapshots invalid for missing events since not all tests
        // emit all event types. We just report them for awareness.
        for expected_event in EXPECTED_EVENT_TYPES {
            if !found_events.contains(*expected_event) {
                result.missing_events.push(expected_event.to_string());
            }
        }
    }

    result
}

/// Validate all snapshots in the snapshot directory
pub fn validate_all_snapshots() -> ValidationResult {
    let mut combined_result = ValidationResult::new();

    match list_snapshots() {
        Ok(snapshots) => {
            if snapshots.is_empty() {
                combined_result.add_error("No snapshots found".to_string());
                return combined_result;
            }

            for snapshot_path in snapshots {
                let result = validate_snapshot(&snapshot_path);
                
                if !result.is_valid {
                    combined_result.is_valid = false;
                    combined_result.errors.push(format!(
                        "Snapshot {} is invalid",
                        snapshot_path.file_name().unwrap_or_default().to_string_lossy()
                    ));
                    combined_result.missing_keys.extend(result.missing_keys);
                    combined_result.unexpected_keys.extend(result.unexpected_keys);
                }
                
                combined_result.missing_events.extend(result.missing_events);
            }
        }
        Err(e) => {
            combined_result.add_error(format!("Failed to list snapshots: {}", e));
        }
    }

    combined_result
}

/// Delete all snapshot files (useful before regeneration)
pub fn clean_snapshots() -> Result<usize, std::io::Error> {
    let snapshots = list_snapshots()?;
    let count = snapshots.len();
    
    for snapshot in snapshots {
        fs::remove_file(snapshot)?;
    }
    
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_snapshot_validation() {
        // This test validates all existing snapshots
        let result = validate_all_snapshots();
        
        // Print the validation report
        println!("{}", result.report());
        
        // If validation fails, provide helpful guidance
        if !result.is_valid {
            eprintln!("\n⚠️  Snapshot validation failed!");
            eprintln!("This may indicate that:");
            eprintln!("  1. Storage keys have been renamed or removed");
            eprintln!("  2. Event types have changed");
            eprintln!("  3. Snapshots are stale and need regeneration");
            eprintln!("\nTo fix:");
            eprintln!("  1. If you refactored the contract, update EXPECTED_STORAGE_KEYS and EXPECTED_EVENT_TYPES");
            eprintln!("  2. Delete old snapshots: rm -rf acbu_minting/test_snapshots/*.json");
            eprintln!("  3. Regenerate snapshots by running tests with snapshot recording enabled");
            eprintln!("  4. Commit the new snapshots to version control");
            
            // Don't panic in test mode to allow CI to continue
            // but make it clear that action is needed
            assert!(
                result.is_valid,
                "Snapshot validation failed. See stderr for details."
            );
        }
    }

    #[test]
    fn test_expected_keys_list_is_not_empty() {
        assert!(!EXPECTED_STORAGE_KEYS.is_empty(), "EXPECTED_STORAGE_KEYS should not be empty");
    }

    #[test]
    fn test_expected_events_list_is_not_empty() {
        assert!(!EXPECTED_EVENT_TYPES.is_empty(), "EXPECTED_EVENT_TYPES should not be empty");
    }

    #[test]
    fn test_snapshot_dir_exists() {
        let dir = snapshot_dir();
        assert!(
            dir.exists(),
            "Snapshot directory should exist: {}",
            dir.display()
        );
    }
}
