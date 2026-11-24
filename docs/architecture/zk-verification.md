# Zero-knowledge verification

## Scope

The ZK component is an optional privacy-preserving eligibility proof, not a replacement for KYC, reserve accounting, or AML monitoring. A user may prove that an ACBU-controlled KYC application is in an allowed state without revealing the underlying identity documents or validator notes to an on-chain consumer.

The initial proof statement is:

> Given an ACBU-issued commitment to a KYC application, the applicant knows the corresponding secret and the committed application has an approved status, an unexpired review, and a country/risk tier allowed by the policy supplied to the circuit.

The circuit must not prove or expose raw PII, document images, sanctions-screening details, or validator identities. Those remain in the backend's controlled KYC records. Revocation and expiry are represented by a policy version and revocation root; a proof is invalid unless both match the verifier's current configuration.

## Placement and consumers

The prover runs client-side or in an ACBU privacy service after the backend has approved the application. The verifier is a versioned Soroban contract (`acbu-zk` when deployed) or an equivalent audited backend verifier during the pre-chain phase. The backend KYC service issues the commitment and policy root, and the verifier returns only a boolean plus the policy version. Transfer, mint, and redemption authorization services consume that result; reserve accounting and AML case management continue to consume the ordinary backend records.

No production flow may claim ZK protection until the circuit, trusted setup/proving assumptions, verifier implementation, public inputs, proof-size/gas limits, key rotation, and negative/revocation tests are reviewed and version-pinned. Until then, the feature flag remains disabled and ordinary ACBU KYC status is authoritative.
