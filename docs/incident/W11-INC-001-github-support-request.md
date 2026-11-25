# W11-INC-001 — GitHub Support request template (orphaned attacker commits)

## Status

The source repositories were purged locally with `git-filter-repo` and the
current monorepo was imported as clean tree snapshots (see `MONOREPO.md`).
GitHub can still serve the purged commit objects by SHA from its commit cache.
That cache is server-side: it cannot be cleared from a PR or by a repository
admin. **An organisation owner must submit the request below to GitHub Support.**

This file is the ready-to-copy ticket content. Issue
[#1314](https://github.com/Pi-Defi-world/acbu-backend/issues/1314) tracks it.

## Where to submit

https://support.github.com/contact → _Repository / organisation_ →
_Security / legal_ → _Report a security issue_.

Ask for the ticket to be copied to the `Pi-Defi-world` organisation so the same
garbage collection covers the archived source repositories listed below.

## Ticket subject

`Request server-side GC of orphaned attacker commit objects — Pi-Defi-world org`

## Ticket body (copy/paste)

```text
Hello GitHub Support,

We are remediating a malware incident in the Pi-Defi-world organisation. The
compromised commits were removed from all refs with git-filter-repo, and the
affected repositories were rebuilt from clean snapshots. However, the old
commit objects are still directly viewable/fetchable by SHA via GitHub's commit
cache.

Known attacker SHA prefixes:
  ab82ba0, 85a6aef, 4c5de4c
Commit author observed in the purged history:
  "N-thnI" / "Nathan Iheanyi" <Niheanyi404@gmail.com> (case variants)

Direct URLs that still resolve (verify before sending):
  https://github.com/Pi-Defi-world/acbu-backend/commit/ab82ba0
  https://github.com/Pi-Defi-world/acbu-backend/commit/85a6aef
  https://github.com/Pi-Defi-world/acbu-backend/commit/4c5de4c

Affected repositories:
  - Pi-Defi-world/acbu-backend
  - Pi-Defi-world/acbu-frontend
  - Pi-Defi-world/acbu-smart-contract

Requested action:
  1. Run repository garbage collection on the affected repositories to remove
     unreferenced loose objects and unreferenced objects in packfiles.
  2. Purge the server-side commit cache so the SHAs above no longer resolve.
  3. Confirm in writing once the SHAs return 404 from both the web UI and the
     REST commits API.

Why this is urgent:
  Drips Wave auditors verify repository objects by SHA. Reachable malware
  objects cause a persistent security review rejection for the whole
  organisation, even though no branch or tag references them.

Verification you can use after the fix:
  node scripts/ci/check-orphaned-attacker-commits.js --fail

We understand that unreachable objects are normally pruned on a schedule; we
are requesting an expedited, organisation-wide purge and a completion notice.
Please let us know if you need a signed incident statement or additional SHAs.

Thank you,
<organisation owner name>
```

## Local verification

Before filing, confirm which SHAs are still served:

```bash
node scripts/ci/check-orphaned-attacker-commits.js
```

The script reports local reachability with `git cat-file -e` and GitHub
reachability using the public commit URLs (`.../commit/<sha>`), which accept the
abbreviated SHAs from the incident report. It exits non-zero with `--fail` when a
SHA is still fetchable; use that after GitHub Support confirms the purge as the
final acceptance check for issue #1314. Transient GitHub errors are reported as
`unknown` rather than as a pass.

## Complementary controls in this repository

- `.github/workflows/malware-ioc-scan.yml` blocks reintroduction of the known
  IoC files/content on every PR and push.
- `MONOREPO.md` documents why the `frontend/` and `contracts/` trees were
  imported as history-free snapshots.
- This PR intentionally does not rewrite public history again; doing so would
  invalidate every open PR and would not clear GitHub's server-side cache.
