# W2-B-071 / #781 — `@babel/core` arbitrary file read via `sourceMappingURL`

- **Severity:** Medium
- **Area:** backend/deps
- **Advisory:** [GHSA-4x5r-pxfx-6jf8](https://github.com/advisories/GHSA-4x5r-pxfx-6jf8) (CVE-2026-49356)
- **Evidence cited in the issue:** `pnpm audit` — GHSA-4x5r-pxfx-6jf8 via jest toolchain
- **Requested fix:** upgrade `@babel/core` to `>=7.29.6`
- **Acceptance criteria:** audit item cleared

## Vulnerability

Compiling attacker-controlled source code with `@babel/core` lets the
attacker read an arbitrary file from disk via a crafted `sourceMappingURL`
comment, provided they can also observe the compiled output and know the
target file's path. Only affects consumers that compile untrusted input
(here: the jest/babel-jest/ts-jest toolchain used at test time — hence
"Test-time arbitrary file read" in the issue).

- **Vulnerable:** `@babel/core` <= 7.29.0, and 8.0.0-alpha.0 through 8.0.0-rc.5
- **Patched:** `@babel/core` 7.29.6+, or 8.0.0-rc.6+

## Investigation

Before making any change, checked whether this was already resolved:

1. `package.json`'s `pnpm.overrides` already pins
   `"@babel/core": ">=7.29.6 <8.0.0"`.
2. `pnpm-lock.yaml`'s `overrides:` block mirrors that pin.
3. Every resolved `@babel/core` entry in the lockfile's `packages:` and
   `snapshots:` sections — the actual installed version, not just the
   declared range — is `7.29.7`, which satisfies `>=7.29.6`. There is a
   single unified resolution across the whole dependency graph (including
   the jest/babel-jest/ts-jest chain the issue's evidence points at); no
   vulnerable version remains anywhere in the tree.

This override was already introduced by `629487e` —
`chore(deps): resolve 87 npm security vulnerabilities` (2026-08-08) — as
part of an earlier bulk dependency-audit remediation, ahead of this
specific `W2-B-071` / `#781` ticket being filed or picked up individually.

## Conclusion

**No code or dependency change was needed.** The acceptance criteria
(`@babel/core >= 7.29.6`, audit item cleared) is already met on `dev` as
of this verification. This document exists so the audit trail for
`W2-B-071` / `#781` records that outcome instead of leaving the item
looking unaddressed, and so `#781` can be closed referencing this
verification and the originating commit `629487e`.

## Re-verifying

```bash
grep -n "@babel/core@" pnpm-lock.yaml   # every match should read 7.29.7 or higher
pnpm audit                              # once network access + pnpm are available
```
