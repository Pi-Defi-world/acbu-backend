# Jurisdiction Licensing Compliance

## Overview

This document describes the jurisdiction licensing implementation for KYC/AML operations in the ACBU platform, addressing issue #1143.

## Background

### The Problem

ACBU's KYC/AML operations may trigger licensing obligations in multiple countries. The Rwanda entity's license does not automatically passport across the 10 ACBU target jurisdictions. Operating KYC services in unlicensed jurisdictions could result in regulatory violations.

### Compliance Gap

- **Rwanda license**: ACBU holds KYC/AML licensing in Rwanda (RWA)
- **Target jurisdictions**: ACBU operates across 10+ African countries
- **License portability**: Financial licenses typically do not passport across jurisdictions
- **Current limitation**: The platform did not validate whether KYC operations were licensed per jurisdiction

## Implementation

### Configuration

The following environment variables control jurisdiction licensing behavior:

| Variable | Description | Default |
|----------|-------------|---------|
| `LICENSED_JURISDICTIONS` | Comma-separated list of ISO 3166-1 alpha-3 country codes where ACBU holds KYC/AML licensing | `RWA` |
| `JURISDICTION_ENFORCE` | When `true`, enforces jurisdiction licensing checks for KYC operations. When `false`, logs warnings only (log-only mode). | `false` |
| `KYC_OPERATING_MODEL` | Operating model: `direct` (ACBU operates KYC directly) or `partner` (KYC handled by licensed partners). | `direct` |

### Operating Models

#### Direct Model (Default: `KYC_OPERATING_MODEL=direct`)

ACBU operates KYC verification directly. This requires:
- Holding appropriate KYC/AML licenses in each jurisdiction
- Compliance with local regulatory requirements
- Direct responsibility for KYC outcomes

**Behavior:**
- KYC applications are only accepted from licensed jurisdictions
- Users from unlicensed jurisdictions receive a clear error message
- Enforcement mode rejects applications from unlicensed jurisdictions

#### Partner Model (`KYC_OPERATING_MODEL=partner`)

KYC verification is handled by licensed partners in each jurisdiction. This model:
- Allows operation in jurisdictions where ACBU does not hold direct licenses
- Partners hold the required local licenses
- ACBU acts as a platform/technology provider

**Behavior:**
- Jurisdiction checks are bypassed (partners handle compliance)
- Responsibility for KYC compliance rests with the partner
- Requires partner integration and due diligence

### Modes of Operation

#### Log-Only Mode (Default: `JURISDICTION_ENFORCE=false`)

- Logs warnings when KYC operations occur in unlicensed jurisdictions
- Allows KYC operations to proceed for operational continuity
- **Use case**: Development, testing, or phased production rollout
- **Limitation**: Does not prevent regulatory violations

#### Enforcement Mode (`JURISDICTION_ENFORCE=true`)

- Rejects KYC operations from unlicensed jurisdictions
- **Use case**: Full regulatory compliance enforcement
- **Behavior**: Returns 422 error with explanation
- **Error message**: "KYC operations are not licensed for jurisdiction [CODE]. ACBU currently holds licenses for: [LIST]. If this is a partner-operated KYC, set KYC_OPERATING_MODEL=partner. Otherwise, contact legal/compliance to obtain the required license."

### Current Implementation Status

- ✅ Configuration via environment variables
- ✅ Jurisdiction validation in KYC controller
- ✅ Logging of compliance violations
- ✅ Enforcement mode (rejects non-compliant operations)
- ✅ Error handling in API layer
- ✅ Support for direct and partner operating models
- ⏳ Per-jurisdiction license tracking (future)
- ⏳ Partner integration for partner model (future)
- ⏳ Automated license renewal tracking (future)

## Recommended Deployment Strategy

### Phase 1: Log-Only Monitoring (Current Default)

1. Deploy with `JURISDICTION_ENFORCE=false`
2. Monitor logs for KYC operations from unlicensed jurisdictions
3. Assess volume and geographic distribution of KYC applications
4. Engage legal/compliance team on licensing strategy

### Phase 2: Direct Model Enforcement

1. Confirm licensing status in target jurisdictions
2. Update `LICENSED_JURISDICTIONS` with licensed countries
3. Enable `JURISDICTION_ENFORCE=true` in production
4. Provide clear error messaging to users from unlicensed jurisdictions

### Phase 3: Partner Model (Alternative)

1. Identify and vet licensed KYC partners in target jurisdictions
2. Integrate partner APIs for KYC verification
3. Set `KYC_OPERATING_MODEL=partner`
4. Enable `JURISDICTION_ENFORCE=true` to ensure partner model is used

## Country Codes

Use ISO 3166-1 alpha-3 codes for jurisdictions:

| Code | Country |
|------|---------|
| RWA | Rwanda |
| NGA | Nigeria |
| KEN | Kenya |
| GHA | Ghana |
| UGA | Uganda |
| TZA | Tanzania |
| ZAF | South Africa |
| ETH | Ethiopia |
| COD | Democratic Republic of Congo |
| CIV | Côte d'Ivoire |

For a complete list, see: https://en.wikipedia.org/wiki/ISO_3166-1_alpha-3

## Security Considerations

- Jurisdiction checks are performed server-side, not client-side
- Configuration cannot be bypassed by API clients
- All jurisdiction checks are logged for audit trail
- Country codes are normalized to uppercase for consistency
- License list is read from environment, not user input

## Migration Guide

### From Direct to Partner Model

If transitioning from direct to partner model:

1. **Legal review**: Confirm partner model is acceptable in target jurisdictions
2. **Partner selection**: Vet licensed KYC partners in each jurisdiction
3. **Integration**: Build partner API integrations
4. **Configuration update**: Set `KYC_OPERATING_MODEL=partner`
5. **Testing**: Verify KYC flows work through partners
6. **Enable enforcement**: Set `JURISDICTION_ENFORCE=true`

### Adding New Jurisdictions

When obtaining a new license:

1. **Add to list**: Update `LICENSED_JURISDICTIONS` with the new country code
2. **Test**: Verify KYC operations work for the new jurisdiction
3. **Monitor**: Log compliance checks for the new jurisdiction
4. **Enable**: If in log-only mode, enable enforcement after validation

## References

- Issue: #1143 - Rwanda license does not passport across 10 jurisdictions; ACBU KYC implies local licensing
- ISO 3166-1: https://en.wikipedia.org/wiki/ISO_3166-1
- FATF Recommendations: https://www.fatf-gafi.org/publications/fatfrecommendations/
- Regional Regulatory Bodies:
  - Central Bank of Kenya (CBK)
  - Central Bank of Nigeria (CBN)
  - Bank of Ghana (BoG)
  - National Bank of Rwanda (BNR)

## Future Enhancements

1. **Per-jurisdiction license tracking**: Track license numbers, expiry dates, and renewal schedules
2. **Automated compliance alerts**: Notify when licenses are approaching expiry
3. **Partner directory**: Manage partner relationships and compliance status
4. **Dynamic jurisdiction detection**: Auto-detect user jurisdiction based on IP/location
5. **Regulatory requirement mapping**: Map jurisdiction-specific KYC/AML requirements
