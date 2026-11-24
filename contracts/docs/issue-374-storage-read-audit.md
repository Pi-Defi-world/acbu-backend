# Audit: Unused Storage Reads (`let _ = env.storage()...get(...)`)

**Issue:** #374 — *"`let _ = env.storage().get::<_, i128>(&key)` for unused storage reads"*
**Status:** Verified — no occurrences in the codebase.
**Date:** 2026-06-26

## Background

Issue #374 (from the `ISSUES.md` audit list, item #105) reports that some
contracts may read a storage value with `let _ = env.storage()...get(...)`. That
pattern fetches a value at gas cost and then immediately discards it, which
usually means the developer intended to use the value but forgot. The fix would
be to either use the value or remove the read.

## Method

The whole workspace was audited for the pattern and for any discarded storage
read in general:

1. **Discard bindings** — search every Rust file (sources *and* tests) for
   `let _ = ...`, underscore-prefixed bindings, and the `::<_, i128>` turbofish:

   ```bash
   grep -rnE 'let[[:space:]]+_' --include='*.rs' .   # excluding target/
   grep -rn  '::<_, i128>'       --include='*.rs' .   # excluding target/
   ```

2. **Compiler-detected unused reads** — let the compiler flag any value that is
   read and never used:

   ```bash
   cargo check --workspace 2>&1 | grep -iE 'unused_variables|never read'
   ```

## Results

| Check | Result |
| --- | --- |
| `let _ = ...` discard bindings | **0 matches** |
| underscore-prefixed bindings (`let _x = ...`) | **0 matches** |
| `::<_, i128>` turbofish reads | **0 matches** |
| `cargo check` unused-read / "never read" warnings | **none** (only an unrelated `unused manifest key: workspace.build` notice) |

Every `env.storage()...get(...)` call in the contracts binds its result to a
named variable that is subsequently used. The storage-read-then-discard
anti-pattern described in issue #374 does not occur in any contract.

## Conclusion

There is no live `let _ = ...` storage read to use or remove — the audit item is
a false positive against the current source. This document records the
verification so the conclusion is traceable. Should the pattern ever be
introduced, the searches above reproduce the audit.
