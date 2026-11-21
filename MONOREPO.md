# Monorepo Overview

This repository is a monorepo containing the project's source code, documentation, and supporting tooling.

## Background: Drips Wave Rejection

The monorepo was rejected during a Drips Wave review. The rejection and the subsequent remediation work are tracked under the Wave 11 consolidated monorepo audit (see `WAVE11_PROBLEMS.md`). A formal incident post-mortem, covering the attack timeline, affected commit SHAs, purge verification hashes, and permanent guardrails, is maintained at `docs/security/INCIDENT_RESPONSE_WAVE11.md`.

## Incident Documentation

- Incident response record (Wave 11): `docs/security/INCIDENT_RESPONSE_WAVE11.md`
- Incident ID: W11-INC-013 (incident-hardening)
- Purpose: provide an auditable, reviewable record for external auditors, Stellar Wave reviewers, and enterprise partners.

## Repository Layout

- `docs/` - project documentation, including `docs/security/` for security and incident records.
- `WAVE11_PROBLEMS.md` - consolidated Wave 11 monorepo audit findings that source incident issues.

## Contributing

Changes that touch security-sensitive areas should reference the relevant incident or audit identifier in the commit message and pull request description, and should be reviewed against the guardrails documented in the incident response record.
