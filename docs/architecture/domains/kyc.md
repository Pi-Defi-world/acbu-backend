# KYC Domain

## Description

The KYC (Know Your Customer) domain handles identity verification for users. A user submits a `KycApplication` with supporting `KycDocument` uploads. Trained `KycValidator` users review each application and record their decision as a `KycValidation`. Validators earn ACBU token rewards tracked in `KycValidatorReward`. Machine-confidence scoring supplements the human review process.

## Canonical operating and regulatory model

ACBU operates the KYC decisioning layer through its controlled validator pool. ACBU owns the application workflow, document redaction/storage controls, validator assignment, consensus decision, audit trail, and validator rewards. The `KycApplication` decision is therefore an ACBU compliance decision, subject to the applicable regulated-entity and jurisdictional review before launch.

Fintech partners are delegated service providers only: they may supply identity, sanctions, document, or liveness signals through an integration, but they do not become the canonical KYC controller and cannot approve or reject an ACBU application. Partner data is minimized, retained according to the ACBU retention policy, and reconciled into the ACBU application record. If a jurisdiction requires a locally licensed provider to perform a regulated step, that provider is onboarded as an ACBU-controlled vendor and the responsibility matrix is updated; the system does not run a second, parallel partner-owned KYC architecture.

This decision resolves the former ambiguity between partner-delegated KYC and an ACBU-operated validator pool: the validator pool is canonical, while partner checks are optional evidence inputs and jurisdiction-specific outsourced processing under ACBU oversight.

---

## Entity-Relationship Diagram

```mermaid
erDiagram
    User {
        uuid id PK
        string kycStatus
    }
    KycApplication {
        uuid id PK
        uuid userId FK
        string countryCode
        string status
        decimal feePaidAcbu
        string feeTxHash
        decimal machineConfidence
        string rejectionReason
        datetime resolvedAt
    }
    KycDocument {
        uuid id PK
        uuid applicationId FK
        string kind
        string storageRef
        string checksum
        string mimeType
        string scanStatus
        int fileSizeBytes
    }
    KycValidator {
        uuid id PK
        uuid userId FK
        string countryCode
        string status
        decimal accuracyScore
        int completedCount
    }
    KycValidation {
        uuid id PK
        uuid applicationId FK
        uuid validatorId FK
        string result
        string notes
    }
    KycValidatorReward {
        uuid id PK
        uuid validatorId FK
        uuid applicationId FK
        decimal acbuAmount
        string txHash
        string status
    }

    User ||--o{ KycApplication : "submits"
    User ||--o{ KycValidator : "registered as"
    KycApplication ||--o{ KycDocument : "has many"
    KycApplication ||--o{ KycValidation : "reviewed by"
    KycApplication ||--o{ KycValidatorReward : "generates"
    KycValidator ||--o{ KycValidation : "records"
    KycValidator ||--o{ KycValidatorReward : "earns"
```

---

## Business Logic Notes

### KycApplication status lifecycle
Applications progress through statuses: `pending` → `under_review` → `approved` | `rejected`. The `machineConfidence` score (0–1) from automated document scanning influences routing — high-confidence applications may be auto-approved; low-confidence ones are queued for human review. `rejectionReason` is populated on rejection.

### KycDocument scanning
Each document (`passport`, `national_id`, `selfie`, etc.) stored in cloud object storage is tracked via `storageRef`. The `scanStatus` field (`pending` → `clean` | `flagged`) reflects the result of virus/malware scanning. `fileSizeBytes` is captured for storage quota enforcement.

### KycValidator country specialization
A `KycValidator` is registered with a `countryCode`, meaning validators are matched to applications from their country. The `@@unique([userId, countryCode])` constraint means a user can be a validator for multiple countries but only once per country. `accuracyScore` is updated after each decision is reconciled against ground truth.

### KycValidation consensus
Multiple validators review the same application. `result` values are `pending`, `approve`, or `reject`. The application service aggregates validation results to reach a final consensus decision.

### KycValidatorReward payout
When a validator's decision is confirmed correct, a `KycValidatorReward` row is created with `status: pending`. The treasury service mints ACBU tokens on-chain and records the `txHash`. The status transitions to `completed` once the blockchain transaction confirms.

### Cross-domain note
`KycApplication.feeMintTransactionId` references a `Transaction` in the Transactions & Payments domain (no DB-level FK constraint; application-layer reference). This tracks the on-chain ACBU fee payment made by the user to submit their KYC application.
