# Weight Drift Audit System Implementation

**Branch:** `feat/weight-drift-audit-job`

## Overview

This implementation addresses the weight drift issue where basket weights can drift from policy without automation. The solution provides:

1. **Scheduled weekly audit job** - Runs every Monday at 00:00 UTC
2. **Comprehensive drift reporting** - Per-currency analysis with policy vs. actual weights
3. **Manual approval gate** - Admin review and sign-off before weight adjustments
4. **Audit trail** - Complete logged history of all policy changes
5. **Email notifications** - Automated alerts to admins when drift exceeds thresholds

## Architecture

### Database Schema

Two new tables track weight drift audits:

#### `weight_drift_audits` (main audit record)
- `id` - UUID primary key
- `audit_period_start` / `audit_period_end` - Audit time window
- `total_currencies` - Number of currencies in basket
- `currencies_exceeding_threshold` - Count of currencies with drift > 2%
- `max_drift_percent` - Maximum drift observed
- `status` - `pending` | `approved` | `rejected`
- `diff_report` - Full JSON report with all analysis
- `created_by` - Admin/system that initiated audit
- `approved_by` - Admin that approved (null if not yet approved)
- `approval_notes` - Admin approval/rejection notes
- `created_at` / `approved_at` - Timestamps

Indexes:
- `idx_weight_drift_audits_status` - Quick filtering by approval status
- `idx_weight_drift_audits_created_at` - Recent audits first
- `idx_weight_drift_audits_status_created` - Combined for list operations
- `idx_weight_drift_audits_period` - Historical audit lookup

#### `weight_drift_currencies` (per-currency snapshot)
- `id` - UUID primary key
- `audit_id` - FK to audit record
- `currency` - 3-letter code (USD, NGN, KES, etc.)
- `policy_weight` - Target weight from basket config
- `actual_weight` - Calculated from reserve tracker
- `drift_percent` - (actual - policy)
- `exceeds_threshold` - Boolean flag (|drift| > 2%)
- `recommendation` - Remediation guidance

Indexes:
- `idx_weight_drift_currencies_audit_id` - Quick lookup by audit
- `idx_weight_drift_currencies_currency` - Historical drift by currency
- `idx_weight_drift_currencies_exceeds` - Find problematic currencies

### Services

#### `WeightDriftAuditService` (`src/services/reserve/WeightDriftAuditService.ts`)

**Responsibilities:**
1. Calculate drift: Compares actual weights (from reserve tracker) vs. policy weights (from basket config)
2. Generate report: Per-currency analysis with recommendations
3. Create audits: Persist to DB with pending status
4. Manage approval: Approve/reject with audit trail
5. List/retrieve: Paginated audit browsing with filtering

**Key Methods:**

```typescript
// Calculate drift report (no DB changes)
async calculateDriftReport(): Promise<WeightDriftReport>

// Create audit record in DB
async createAudit(report, createdBy): Promise<WeightDriftReport>

// Approve pending audit
async approveAudit(auditId, approvedBy, notes): Promise<WeightDriftReport>

// Reject pending audit
async rejectAudit(auditId, rejectedBy, reason): Promise<WeightDriftReport>

// List audits with filtering/pagination
async listAudits(status?, limit, offset): Promise<{ audits, total }>

// Get single audit
async getAudit(auditId): Promise<WeightDriftReport>
```

**Drift Threshold:** 2% (configurable)
- If |drift| ≤ 0.5%: "Within acceptable range"
- If 0.5% < |drift| ≤ 2%: Warning, no action needed
- If |drift| > 2%: Exceeds threshold, triggers in audit report

### Scheduled Job

#### `weightDriftAuditJob.ts` (`src/jobs/weightDriftAuditJob.ts`)

**Execution:**
- **Default schedule:** Every Monday at 00:00 UTC (configurable via `WEIGHT_DRIFT_AUDIT_INTERVAL_DAYS`)
- **Run on startup:** Can auto-run at boot if `WEIGHT_DRIFT_AUDIT_RUN_ON_STARTUP=true`
- **Graceful shutdown:** `stopWeightDriftAuditScheduler()` for clean termination

**Workflow:**
1. Calculate drift report using `WeightDriftAuditService.calculateDriftReport()`
2. Create audit record in DB with "pending" status
3. Generate detailed email report with per-currency breakdown
4. Send email to admin distribution list (env: `NOTIFICATION_ALERT_EMAIL`)
5. Log audit creation with all details

**Email Content:**
- Audit period (last 7 days by default)
- Summary: Total currencies, count exceeding threshold, max drift
- Per-currency breakdown: Policy%, Actual%, Drift%, Threshold flag
- Action required message and audit ID

**Error Handling:**
- If email send fails: Logged as warning, audit still created
- If job crashes: Retry after 5 minutes with backoff
- If timer overflows: Uses custom sleep handler for durations > 2^31 ms

### API Endpoints

All endpoints require `ADMIN_KEY` authentication.

#### 1. List Audits
```http
GET /v1/admin/weight-drift-audits?status=pending&limit=20&offset=0
```

**Query Parameters:**
- `status` (optional): `pending` | `approved` | `rejected`
- `limit` (default: 20): Results per page
- `offset` (default: 0): Pagination offset

**Response:**
```json
{
  "audits": [
    {
      "auditId": "uuid",
      "auditPeriodStart": "2026-04-20T00:00:00Z",
      "auditPeriodEnd": "2026-04-27T00:00:00Z",
      "totalCurrencies": 5,
      "currenciesExceedingThreshold": 2,
      "maxDriftPercent": 3.42,
      "status": "pending",
      "entries": [
        {
          "currency": "USD",
          "policyWeight": 40.0,
          "actualWeight": 42.5,
          "driftPercent": 2.5,
          "exceedsThreshold": true,
          "recommendation": "Overweight by 2.50%. Consider reducing USD position..."
        }
      ]
    }
  ],
  "pagination": {
    "limit": 20,
    "offset": 0,
    "total": 42
  }
}
```

#### 2. Get Audit Details
```http
GET /v1/admin/weight-drift-audits/{id}
```

Returns full audit with all per-currency data.

#### 3. Create Manual Audit
```http
POST /v1/admin/weight-drift-audits
```

Manually trigger audit (outside of scheduled job). Useful for on-demand checks.

**Response:** Same as audit record above with status "pending"

#### 4. Approve Audit
```http
POST /v1/admin/weight-drift-audits/{id}/approve
Content-Type: application/json

{
  "approvalNotes": "Reviewed markets; drift acceptable for now"
}
```

**Returns:** Updated audit with status "approved", approvedBy set, approvalNotes saved

**Audit Log Entry:**
```
WEIGHT_DRIFT_AUDIT_APPROVED
- Entity: WeightDriftAudit
- Action: approve
- Performed By: Admin UUID
- New Value: { status: "approved", approvalNotes }
```

#### 5. Reject Audit
```http
POST /v1/admin/weight-drift-audits/{id}/reject
Content-Type: application/json

{
  "reason": "Waiting for Q2 rebalancing decision from DAO"
}
```

**Returns:** Updated audit with status "rejected", approvalNotes contains reason

**Audit Log Entry:**
```
WEIGHT_DRIFT_AUDIT_REJECTED
- Entity: WeightDriftAudit
- Action: reject
- Performed By: Admin UUID
- New Value: { status: "rejected", reason }
```

## Environment Variables

```bash
# Weight drift audit scheduling
WEIGHT_DRIFT_AUDIT_INTERVAL_DAYS=7          # Default: 7 days (weekly)
WEIGHT_DRIFT_AUDIT_RUN_ON_STARTUP=false     # Run audit immediately on app startup

# Admin notifications
NOTIFICATION_ALERT_EMAIL=ops@example.com    # Comma-separated list of admin emails
```

## Audit Trail Integration

All audit lifecycle events are logged via `AuditService`:

### Events Logged

1. **WEIGHT_DRIFT_AUDIT_CREATED**
   - When: New audit generated
   - Payload: currenciesExceedingThreshold, maxDriftPercent
   - Performed By: `system` or requesting admin

2. **WEIGHT_DRIFT_AUDIT_APPROVED**
   - When: Admin approves pending audit
   - Payload: status=approved, approvalNotes
   - Performed By: Approving admin

3. **WEIGHT_DRIFT_AUDIT_REJECTED**
   - When: Admin rejects pending audit
   - Payload: status=rejected, reason
   - Performed By: Rejecting admin

All entries include:
- Timestamp
- Entity type: `WeightDriftAudit`
- Entity ID: Audit UUID
- Old/new values for comparison

## Acceptance Criteria ✅

- [x] Weekly job runs automatically (Monday 00:00 UTC)
- [x] Diff report includes per-currency analysis with policy vs. actual
- [x] Audit stored with "pending" status awaiting approval
- [x] Manual approval gate prevents auto-adjustment
- [x] Audit log created for all policy changes
- [x] Email notification sent to admins with drift summary
- [x] Admin API endpoints for list/approve/reject workflows
- [x] Comprehensive test coverage

## Implementation Files

### New Files
- `prisma/migrations/20260427000000_add_weight_drift_audit/migration.sql` - Database schema
- `src/services/reserve/WeightDriftAuditService.ts` - Core service logic
- `src/jobs/weightDriftAuditJob.ts` - Scheduled job
- `src/controllers/weightDriftAuditController.ts` - API endpoints
- `src/routes/weightDriftAuditRoutes.ts` - Route definitions
- `tests/weightDriftAudit.test.ts` - Unit tests

### Modified Files
- `src/routes/index.ts` - Registered weight drift audit routes
- `src/index.ts` - Start weight drift audit scheduler at boot

## Testing

Run the test suite:

```bash
pnpm test -- tests/weightDriftAudit.test.ts
```

**Test Coverage:**
- Drift calculation accuracy
- Audit creation and DB persistence
- Approval/rejection workflows
- List and pagination
- Audit log entries
- Email notification triggers

## Deployment Checklist

1. **Run migration:**
   ```bash
   npx prisma migrate deploy
   ```

2. **Set environment variables:**
   ```bash
   NOTIFICATION_ALERT_EMAIL=ops-team@acbu.com
   WEIGHT_DRIFT_AUDIT_RUN_ON_STARTUP=false
   ```

3. **Deploy code** to staging and production

4. **Verify scheduler:**
   - Check logs for "Weight drift audit scheduler started"
   - Confirm next run scheduled for Monday 00:00 UTC

5. **Test manual audit trigger:**
   ```bash
   curl -X POST http://localhost:3000/v1/admin/weight-drift-audits \
     -H "Authorization: Bearer <ADMIN_KEY>"
   ```

6. **Verify email notifications:**
   - Check inbox for test audit email
   - Confirm all currencies listed with drift values

## Future Enhancements

1. **Automated rebalancing approval** - Auto-approve low-drift audits per policy
2. **Drift threshold rules** - Per-currency thresholds based on liquidity
3. **Rebalancing instructions** - Auto-generate swap instructions from audit
4. **Dashboard UI** - Visual weight drift monitoring and approval interface
5. **Historical analytics** - Trend analysis of weight drift over time
6. **Alert rules** - PagerDuty/Slack integration for critical drift

## Troubleshooting

### Audit not running on schedule
- Check logs for scheduler startup message
- Verify system clock is in UTC
- Check RabbitMQ and PostgreSQL connectivity

### Email not sending
- Verify `NOTIFICATION_ALERT_EMAIL` is set
- Check email service credentials
- Review `sendEmail` error logs

### Drift calculations incorrect
- Verify basket config has active entries with correct weights
- Check reserve tracker is pulling correct on-chain balances
- Confirm all basket currencies have reserve entries

## References

- [BasketService](../basket/basketService.ts) - Policy weights
- [ReserveTracker](./ReserveTracker.ts) - Actual weights
- [RebalancingEngine](./RebalancingEngine.ts) - Weight drift calculations
- [AuditService](../audit/auditService.ts) - Audit logging
