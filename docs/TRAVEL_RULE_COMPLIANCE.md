# Travel Rule / AML Compliance

## Overview

This document describes the Travel Rule compliance implementation for P2P transfers in the ACBU platform, addressing issue #1142.

## Background

### The Problem

Direct P2P transfers between non-custodied wallets on the Stellar blockchain cannot satisfy Travel Rule originator/beneficiary data requirements. The blockchain layer only carries public addresses (G...), not KYC/identity information required by FATF Travel Rule regulations for transfers above certain thresholds.

### Compliance Gap

- **Zero-fee direct P2P**: The platform supports direct wallet-to-wallet transfers with minimal fees (docs.md §8.4)
- **Travel Rule compliance**: Regulatory requirements mandate originator/beneficiary data for transfers above thresholds (typically $1,000 USD equivalent)
- **Current limitation**: On-chain P2P between non-custodied wallets cannot embed or validate this required data

## Implementation

### Configuration

The following environment variables control Travel Rule compliance behavior:

| Variable | Description | Default |
|----------|-------------|---------|
| `TRAVEL_RULE_THRESHOLD_ACBU` | Amount threshold in ACBU above which Travel Rule compliance is required | 1000 |
| `TRAVEL_RULE_ENFORCE` | When `true`, enforces Travel Rule compliance for P2P transfers above threshold. When `false`, logs warnings only (log-only mode). | `false` |
| `TRAVEL_RULE_MODE` | Compliance mode: `strict` (reject non-compliant) or `allowlist` (only allow VASP/allowlisted recipients). | `strict` |

### Modes of Operation

#### Log-Only Mode (Default: `TRAVEL_RULE_ENFORCE=false`)

- Logs warnings when transfers exceed the threshold
- Allows transfers to proceed for operational continuity
- **Use case**: Development, testing, or phased production rollout
- **Limitation**: Does not prevent regulatory violations

#### Strict Mode (`TRAVEL_RULE_ENFORCE=true`, `TRAVEL_RULE_MODE=strict`)

- Rejects all direct P2P transfers above the threshold
- **Use case**: Full regulatory compliance enforcement
- **Behavior**: Returns 422 error with explanation
- **Error message**: "Transfer amount X ACBU exceeds Travel Rule threshold... Direct P2P transfers cannot satisfy Travel Rule requirements."

#### Allowlist Mode (`TRAVEL_RULE_ENFORCE=true`, `TRAVEL_RULE_MODE=allowlist`)

- Only allows transfers above threshold to VASP-intermediated or allowlisted recipients
- **Use case**: Partial compliance with trusted partner VASPs
- **Current limitation**: Allowlist implementation not yet complete (future enhancement)

### Current Implementation Status

- ✅ Configuration via environment variables
- ✅ Threshold-based checks in transfer service
- ✅ Logging of compliance violations
- ✅ Enforcement mode (rejects non-compliant transfers)
- ✅ Error handling in API layer
- ⏳ VASP intermediation integration (future)
- ⏳ Allowlist management (future)
- ⏳ On/off-ramp Travel Rule data exchange (future)

## Recommended Deployment Strategy

### Phase 1: Log-Only Monitoring (Current Default)

1. Deploy with `TRAVEL_RULE_ENFORCE=false`
2. Monitor logs for transfers exceeding threshold
3. Assess volume and impact of affected transfers
4. Engage legal/compliance team on threshold appropriateness

### Phase 2: Soft Enforcement (Warning Only)

1. Implement user-facing warnings in frontend for transfers above threshold
2. Add educational messaging about Travel Rule requirements
3. Encourage use of on/off-ramp services for larger transfers

### Phase 3: Full Enforcement

1. Enable `TRAVEL_RULE_ENFORCE=true` in production
2. Implement VASP intermediation for compliant large transfers
3. Provide clear user guidance for compliance alternatives

## Alternatives for Large Transfers

When Travel Rule enforcement is enabled, users can:

1. **Use on/off-ramp services**: Fiat on-ramps and off-ramps typically have KYC/AML processes that satisfy Travel Rule requirements
2. **Lower transfer amounts**: Split transfers into smaller amounts below the threshold (where applicable and compliant)
3. **Use VASP-intermediated transfers** (future): Transfer through compliant VASP partners when this feature is implemented

## Security Considerations

- Travel Rule checks are performed server-side, not client-side
- Configuration cannot be bypassed by API clients
- All compliance checks are logged for audit trail
- Threshold configuration is read from environment, not user input

## References

- Issue: #1142 - Travel Rule / AML unenforceable on direct P2P Stellar transfers
- FATF Travel Rule: https://www.fatf-gafi.org/publications/trf/
- Stellar AML/Travel Rule considerations: https://stellar.org/learn/stellar-basics/aml-compliance

## Future Enhancements

1. **VASP Intermediation**: Integrate with VASP partners to exchange originator/beneficiary data
2. **Allowlist Management**: Admin interface to manage trusted recipient addresses
3. **Per-User Thresholds**: Different thresholds based on KYC level or user segment
4. **Real-time Currency Conversion**: Convert ACBU threshold to USD equivalent dynamically
5. **Blockchain Memo Fields**: Explore using Stellar memo fields for compliance data (with encryption)
