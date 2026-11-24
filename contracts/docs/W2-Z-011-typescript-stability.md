# Frontend TypeScript Version Stability

**Issue:** W2-Z-011 — `typescript ~6.0.2` in frontend (pre-release era)  
**Severity:** Low  
**Area:** zk/frontend  
**Status:** Documented — frontend tree unavailable in this checkout

## Background

The frontend dependency manifest reportedly declares TypeScript as:

```json
"typescript": "~6.0.2"
```

A pre-release TypeScript range can introduce breaking compiler behavior and
make builds difficult to reproduce as new matching releases become available.
The frontend should use a stable TypeScript release and commit the resulting
lockfile update.

## Required Remediation

Update `frontend/zk-comply-frontend/package.json` to a stable TypeScript
version. Keep the version range intentionally narrow, or pin an exact version
according to the frontend dependency policy. Regenerate and commit the
corresponding `frontend/zk-comply-frontend/pnpm-lock.yaml`.

For example, after confirming the frontend's supported toolchain:

```bash
cd frontend/zk-comply-frontend
pnpm add --save-dev typescript@<stable-version>
```

Do not select a pre-release, nightly, or release-candidate version.

## Acceptance Check

From `frontend/zk-comply-frontend`, the frozen install must complete without
updating the lockfile:

```bash
pnpm install --frozen-lockfile
pnpm exec tsc --version
```

The reported TypeScript version must be a stable release, and the manifest and
lockfile must resolve the same version.

## Repository Verification

At the time this document was created, the checked-out `dev` branch contained
no `frontend/zk-comply-frontend/package.json`, `package.json`, or
`pnpm-lock.yaml`. Therefore, the dependency update and frozen-install check
could not be performed in this contract-only checkout. The remediation should
be completed in the repository revision that contains the frontend tree.
