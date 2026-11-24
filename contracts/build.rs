// Build script for ACBU Smart Contracts
// Verifies WASM artifact integrity before compilation.
// Fails fast if hash mismatches to prevent supply chain attacks.
//
// The WASM file is committed to the repository with its SHA-256 hash
// pinned in source (inside each contractimport! macro and in this script).
// If the file is missing (e.g. after a partial clone), build.rs will
// automatically run ./scripts/fetch_token_wasm.sh to obtain it.
//
// Post-build WASM optimisation (wasm-opt / wasm-strip)
// ─────────────────────────────────────────────────────
// Enabled by setting the environment variable WASM_POST_OPT=1:
//
//   WASM_POST_OPT=1 cargo build --release --target wasm32-unknown-unknown
//
// When WASM_POST_OPT is not set (the default) the steps are skipped
// silently so that plain `cargo build / cargo test` are never affected.
//
// When WASM_POST_OPT=1 but a required tool is missing, the build prints
// an actionable install hint and *fails* — the developer explicitly asked
// for optimisation, so a silent skip would be misleading.
//
// Required tools:
//   wasm-opt  — from the Binaryen project:
//               https://github.com/WebAssembly/binaryen/releases
//               macOS : brew install binaryen
//               Debian: apt install binaryen
//
//   wasm-strip — from the WABT project:
//               https://github.com/WebAssembly/wabt/releases
//               macOS : brew install wabt
//               Debian: apt install wabt

use std::fs;
use std::path::{Path, PathBuf};
use std::process;
use std::process::Command;

/// Expected SHA-256 of soroban_token_contract.wasm.
/// Must match the sha256 field in every contractimport! that references
/// this artifact (acbu_minting, acbu_burning, acbu_reserve_tracker).
const EXPECTED_HASH: &str = "6b14997b915dee21082884cd5a2f1f2f0aef0073d1dcb9c5b3c674cf487fb41d";

const WASM_PATH: &str = "soroban_token_contract.wasm";

/// Release WASM output directory (relative to workspace root).
const RELEASE_WASM_DIR: &str = "target/wasm32-unknown-unknown/release";

fn main() {
    // Re-run this script whenever the WASM file changes or the opt toggle flips.
    println!("cargo:rerun-if-changed={}", WASM_PATH);
    println!("cargo:rerun-if-env-changed=WASM_POST_OPT");

    if !Path::new(WASM_PATH).exists() {
        eprintln!("info[build]: {} not found — attempting automatic fetch.", WASM_PATH);
        auto_fetch_wasm();
        if !Path::new(WASM_PATH).exists() {
            eprintln!("error[build]: Automatic fetch failed. {} still missing.", WASM_PATH);
            eprintln!();
            eprintln!("  Manually run the fetch script to obtain the artifact:");
            eprintln!();
            eprintln!("      ./scripts/fetch_token_wasm.sh");
            eprintln!();
            eprintln!("  Expected SHA-256: {}", EXPECTED_HASH);
            process::exit(1);
        }
    }

    let data = fs::read(WASM_PATH).unwrap_or_else(|e| {
        eprintln!("error[build]: Cannot read {}: {}", WASM_PATH, e);
        process::exit(1);
    });

    let actual_hash = sha256_hex(&data);
    if actual_hash != EXPECTED_HASH {
        eprintln!("error[build]: WASM hash mismatch — possible supply-chain tampering.");
        eprintln!("  expected: {}", EXPECTED_HASH);
        eprintln!("  actual:   {}", actual_hash);
        eprintln!();
        eprintln!("  Re-run ./scripts/fetch_token_wasm.sh to restore the verified artifact.");
        process::exit(1);
    }

    println!(
        "cargo:warning=soroban_token_contract.wasm verified ({} bytes, sha256 OK)",
        data.len()
    );

    verify_source_hashes();

    // Optional post-build size optimisation — enabled by WASM_POST_OPT=1.
    if std::env::var("WASM_POST_OPT").as_deref() == Ok("1") {
        post_opt_wasm();
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Source hash verification
// ─────────────────────────────────────────────────────────────────────────────

/// Verify that every contractimport! in source still references the expected hash.
fn verify_source_hashes() {
    let tagged_files = [
        "acbu_minting/src/lib.rs",
        "acbu_burning/src/lib.rs",
        "acbu_reserve_tracker/src/lib.rs",
    ];

    for path in &tagged_files {
        println!("cargo:rerun-if-changed={}", path);
        match fs::read_to_string(path) {
            Ok(content) => {
                if content.contains("contractimport!")
                    && !content.contains(&format!("sha256 = \"{}\"", EXPECTED_HASH))
                {
                    eprintln!(
                        "error[build]: {} contains a contractimport! \
                         with a hash that does not match EXPECTED_HASH.",
                        path
                    );
                    eprintln!("  expected: {}", EXPECTED_HASH);
                    eprintln!("  Update the sha256 field in that file to match.");
                    process::exit(1);
                }
            }
            Err(e) => {
                eprintln!(
                    "error[build]: Could not read {} for hash check: {}",
                    path, e
                );
                process::exit(1);
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Optional WASM post-optimisation (wasm-opt + wasm-strip)
// ─────────────────────────────────────────────────────────────────────────────

/// Run `wasm-opt` and `wasm-strip` over every contract WASM in the release dir.
///
/// Probes for each tool before use.  If a tool is absent **and** the caller
/// explicitly set `WASM_POST_OPT=1`, the build fails with install instructions.
fn post_opt_wasm() {
    let wasm_dir = Path::new(RELEASE_WASM_DIR);

    if !wasm_dir.exists() {
        // The release dir doesn't exist yet — nothing to optimise.
        // This happens when build.rs runs before `cargo build --release` has
        // produced output (e.g., during `cargo check`).
        println!(
            "cargo:warning=WASM_POST_OPT=1 set but {} does not exist yet; \
             post-optimisation skipped for this build.",
            RELEASE_WASM_DIR
        );
        return;
    }

    let wasm_files: Vec<PathBuf> = match fs::read_dir(wasm_dir) {
        Ok(entries) => entries
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.extension().and_then(|x| x.to_str()) == Some("wasm"))
            // Skip the dependency/ sub-dir that cargo sometimes emits.
            .filter(|p| {
                p.parent()
                    .and_then(|d| d.file_name())
                    .and_then(|n| n.to_str())
                    != Some("deps")
            })
            .collect(),
        Err(e) => {
            eprintln!(
                "cargo:warning=Could not read {}: {} — post-optimisation skipped.",
                RELEASE_WASM_DIR, e
            );
            return;
        }
    };

    if wasm_files.is_empty() {
        println!(
            "cargo:warning=WASM_POST_OPT=1 set but no .wasm files found in {}.",
            RELEASE_WASM_DIR
        );
        return;
    }

    // Probe tools once before iterating over files.
    require_tool(
        "wasm-opt",
        &["--version"],
        "Install binaryen:\n  \
         macOS : brew install binaryen\n  \
         Debian: apt install binaryen\n  \
         GitHub: https://github.com/WebAssembly/binaryen/releases",
    );
    require_tool(
        "wasm-strip",
        &["--version"],
        "Install wabt:\n  \
         macOS : brew install wabt\n  \
         Debian: apt install wabt\n  \
         GitHub: https://github.com/WebAssembly/wabt/releases",
    );

    for wasm in &wasm_files {
        let display = wasm.display();

        // wasm-opt -Oz --strip-debug -o <file> <file>
        run_tool(
            "wasm-opt",
            &[
                "-Oz",
                "--strip-debug",
                "-o",
                wasm.to_str().expect("non-UTF-8 WASM path"),
                wasm.to_str().expect("non-UTF-8 WASM path"),
            ],
        );
        println!("cargo:warning=wasm-opt applied to {}", display);

        // wasm-strip <file>
        run_tool("wasm-strip", &[wasm.to_str().expect("non-UTF-8 WASM path")]);
        println!("cargo:warning=wasm-strip applied to {}", display);
    }
}

/// Probe whether `tool` is available on PATH.
///
/// * If the tool is **not found** (OS error 2 / "not found on PATH") and
///   `WASM_POST_OPT=1` is set, the build **fails** with `install_hint`.
/// * Any other OS error is treated as a hard failure (permissions, etc.).
/// * A non-zero exit from the probe command itself is **ignored** — some
///   versions of these tools return non-zero for `--version`.
fn require_tool(tool: &str, probe_args: &[&str], install_hint: &str) {
    let result = Command::new(tool).args(probe_args).output();

    match result {
        Ok(_) => {} // binary exists; actual exit code doesn't matter for a version probe
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            eprintln!();
            eprintln!(
                "error[build]: `{}` not found on PATH but WASM_POST_OPT=1 is set.",
                tool
            );
            eprintln!();
            eprintln!("  {}", install_hint.replace('\n', "\n  "));
            eprintln!();
            eprintln!("  To skip post-optimisation, unset WASM_POST_OPT or set it to 0.");
            eprintln!();
            process::exit(1);
        }
        Err(e) => {
            eprintln!(
                "error[build]: Failed to probe `{}`: {} — \
                 check PATH and file permissions.",
                tool, e
            );
            process::exit(1);
        }
    }
}

/// Run `tool` with `args`, failing the build on non-zero exit.
///
/// Assumes `require_tool` was already called for this binary.
fn run_tool(tool: &str, args: &[&str]) {
    let status = Command::new(tool).args(args).status().unwrap_or_else(|e| {
        eprintln!("error[build]: Could not spawn `{}`: {}", tool, e);
        process::exit(1);
    });

    if !status.success() {
        eprintln!(
            "error[build]: `{}` exited with status {} — optimisation failed.",
            tool,
            status.code().unwrap_or(-1)
        );
        process::exit(1);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Automatic WASM fetch
// ─────────────────────────────────────────────────────────────────────────────

/// Attempt to obtain the WASM artifact automatically by running the fetch script.
///
/// This is a best-effort operation: if git, cargo, or the network are unavailable
/// the function prints a warning and returns, letting the caller produce a clear
/// actionable error.
fn auto_fetch_wasm() {
    // Resolve the fetch script relative to the workspace root.
    // build.rs runs with cwd = workspace root, so "scripts/..." works directly.
    let fetch_script = Path::new("scripts/fetch_token_wasm.sh");

    if !fetch_script.exists() {
        eprintln!(
            "info[build]: Fetch script {} not found — skipping auto-fetch.",
            fetch_script.display()
        );
        return;
    }

    // Make the script executable (may not be set after a partial clone).
    let _ = Command::new("chmod").arg("+x").arg(fetch_script).status();

    eprintln!("info[build]: Running {} ...", fetch_script.display());

    let status = match Command::new("sh").arg(fetch_script).status() {
        Ok(s) => s,
        Err(e) => {
            eprintln!(
                "info[build]: Could not spawn fetch script: {} — skipping auto-fetch.",
                e
            );
            return;
        }
    };

    if !status.success() {
        eprintln!(
            "info[build]: Fetch script exited with status {} — auto-fetch failed.",
            status.code().unwrap_or(-1)
        );
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// SHA-256 (pure-Rust, no external crates)
// ─────────────────────────────────────────────────────────────────────────────

/// Compute a lowercase hex SHA-256 digest without any external crate.
fn sha256_hex(data: &[u8]) -> String {
    // Initial hash values (first 32 bits of fractional parts of square roots
    // of the first 8 primes).
    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];

    // Round constants (first 32 bits of the fractional parts of the cube
    // roots of the first 64 primes).
    #[rustfmt::skip]
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
        0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
        0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
        0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
        0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
        0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
        0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
        0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];

    // Pre-processing: pad message to 512-bit blocks.
    let bit_len = (data.len() as u64).wrapping_mul(8);
    let mut msg = data.to_vec();
    msg.push(0x80);
    while (msg.len() % 64) != 56 {
        msg.push(0x00);
    }
    msg.extend_from_slice(&bit_len.to_be_bytes());

    for block in msg.chunks(64) {
        let mut w = [0u32; 64];
        for (i, chunk) in block.chunks(4).enumerate().take(16) {
            w[i] = u32::from_be_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }

        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh] =
            [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7]];

        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);

            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }

        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
        h[5] = h[5].wrapping_add(f);
        h[6] = h[6].wrapping_add(g);
        h[7] = h[7].wrapping_add(hh);
    }

    h.iter().map(|v| format!("{:08x}", v)).collect::<String>()
}
