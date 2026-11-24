# Weight Drift Audit Implementation - Summary

**Status:** ✅ Complete  
**Branch:** `feat/weight-drift-audit-job`  
**Commit:** a092919 - Weight drift audit system with weekly job, approval gate, and audit trail

## Issue Resolution

**Severity:** Medium | **Area:** backend/ops

### Problem Statement
Weights drift from policy without automation. Fix direction: Scheduled job + audit log + manual approval gate.

### Solution Delivered

#### 1. Scheduled Weekly Job ✅
- **Location:** [src/jobs/weightDriftAuditJob.ts](../src/jobs/weightDriftAuditJob.ts)
- **Schedule:** Every Monday at 00:00 UTC (configurable)
- **Emission:** Weekly diff report with per-currency analysis
- **Email Notification:** Sent to admin distribution list with drift summary

#### 2. Comprehensive Drift Calculation ✅
- **Location:** [src/services/reserve/WeightDriftAuditService.ts](../src/services/reserve/WeightDriftAuditService.ts)
- **Calculates:** Actual weight vs. policy (basket config target)
- **Threshold:** 2% drift triggers audit record
- **Per-Currency:** Policy %, Actual %, Drift %, Recommendations

#### 3. Manual Approval Gate ✅
- **Status:** All audits created with "pending" status
- **Admin Review:** Required before any weight adjustments
- **Workflow:** Approve, Reject, or Hold for decision
- **Tracked:** All approvals logged to audit trail

#### 4. Complete Audit Trail ✅
- **Events Logged:**
  - `WEIGHT_DRIFT_AUDIT_CREATED` - New audit generated
  - `WEIGHT_DRIFT_AUDIT_APPROVED` - Admin approval recorded
  - `WEIGHT_DRIFT_AUDIT_REJECTED` - Admin rejection recorded
- **Compliance:** Full timestamp, actor, and change history

#### 5. Admin API Endpoints ✅
- `GET /v1/admin/weight-drift-audits` - List with filtering & pagination
- `GET /v1/admin/weight-drift-audits/{id}` - Single audit details
- `POST /v1/admin/weight-drift-audits` - Manual audit trigger
- `POST /v1/admin/weight-drift-audits/{id}/approve` - Approve audit
- `POST /v1/admin/weight-drift-audits/{id}/reject` - Reject audit

## Acceptance Criteria Met

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Weekly job emits diff report | ✅ | `weightDriftAuditJob.ts` runs every Monday, generates detailed report |
| Per-currency analysis | ✅ | `WeightDriftAuditService.calculateDriftReport()` with thresholds |
| Audit stored pending approval | ✅ | `weight_drift_audits` table with status=pending |
| Manual approval gate | ✅ | API endpoints for approve/reject workflow |
| Audit log entries | ✅ | Integrated with `auditService` for all lifecycle events |
| Scheduled automation | ✅ | Job started in `src/index.ts` at app bootstrap |
| Email notifications | ✅ | Sends to `ADMIN_NOTIFICATION_EMAIL` after each run |

## Implementation Files

### New Files Created (9 total)

| File | Purpose | LOC |
|------|---------|-----|
| `docs/WEIGHT_DRIFT_AUDIT.md` | Comprehensive documentation | 363 |
| `prisma/migrations/20260427000000_add_weight_drift_audit/migration.sql` | Database schema | 42 |
| `src/controllers/weightDriftAuditController.ts` | API request handlers | 291 |
| `src/jobs/weightDriftAuditJob.ts` | Weekly scheduler | 230 |
| `src/routes/weightDriftAuditRoutes.ts` | Route definitions | 44 |
| `src/services/reserve/WeightDriftAuditService.ts` | Core business logic | 366 |
| `tests/weightDriftAudit.test.ts` | Unit tests | 333 |

**Total New Code:** 1,669 lines

### Files Modified (2 total)

| File | Changes |
|------|---------|
| `src/routes/index.ts` | Added import and route registration |
| `src/index.ts` | Added scheduler startup at boot |

## Database Schema

### `weight_drift_audits` Table
Stores audit records with drift analysis and approval status.

**Key Fields:**
- `id` (UUID) - Primary key
- `audit_period_start/end` (timestamp) - Analysis window
- `total_currencies` (int) - Basket size
- `currencies_exceeding_threshold` (int) - Problem count
- `max_drift_percent` (decimal) - Maximum drift observed
- `status` (varchar) - pending | approved | rejected
- `diff_report` (jsonb) - Full analysis snapshot
- `created_by/approved_by` (uuid) - Admin audit trail
- `approval_notes` (text) - Sign-off message

### `weight_drift_currencies` Table
Snapshot of per-currency drift for each audit.

**Key Fields:**
- `id` (UUID) - Primary key
- `audit_id` (UUID) - FK to audit
- `currency` (varchar) - 3-letter code
- `policy_weight` (decimal) - Target from basket config
- `actual_weight` (decimal) - Calculated from reserves
- `drift_percent` (decimal) - Difference
- `exceeds_threshold` (boolean) - Flag for > 2%
- `recommendation` (text) - Remediation guidance

## Configuration

### Environment Variables

```bash
# Audit scheduling
WEIGHT_DRIFT_AUDIT_INTERVAL_DAYS=7          # Default: weekly
WEIGHT_DRIFT_AUDIT_RUN_ON_STARTUP=false     # Auto-run at boot

# Notifications
ADMIN_NOTIFICATION_EMAIL=ops@acbu.com       # Email list for alerts
```

### Threshold Configuration

**Drift Threshold:** 2% (hardcoded in service)
- Currencies with |drift| > 2% marked as "exceeds_threshold"
- Recommendations generated for all drifts > 0.5%

## Deployment Steps

1. **Apply migration:**
   ```bash
   npx prisma migrate deploy
   ```

2. **Set environment variables:**
   ```bash
   export ADMIN_NOTIFICATION_EMAIL=ops-team@acbu.com
   export WEIGHT_DRIFT_AUDIT_RUN_ON_STARTUP=false
   ```

3. **Deploy code** from branch `feat/weight-drift-audit-job`

4. **Verify startup:**
   - Check logs for: "Weight drift audit scheduler started"
   - Next run should be scheduled for upcoming Monday 00:00 UTC

5. **Test manual trigger:**
   ```bash
   curl -X POST http://localhost:3000/v1/admin/weight-drift-audits \
     -H "Authorization: Bearer $ADMIN_KEY" \
     -H "Content-Type: application/json"
   ```

## Testing

**Unit Tests:** [tests/weightDriftAudit.test.ts](../tests/weightDriftAudit.test.ts)

```bash
pnpm test -- tests/weightDriftAudit.test.ts
```

**Coverage:**
- Drift calculation accuracy (various weight scenarios)
- Audit creation with DB persistence
- Approval/rejection workflows
- Pagination and filtering
- Audit log entry generation
- Email notification triggers

**Manual Testing:**
1. Create audit via API → verify "pending" status
2. List audits → confirm pagination works
3. Approve audit → check audit trail logged
4. Reject audit → verify reason recorded

## Integration Points

### Existing Services Used
- **BasketService** - Policy weights from active basket config
- **ReserveTracker** - Actual weights from on-chain reserves
- **AuditService** - Logging of all policy changes
- **NotificationService** - Email alerts to admins

### New Service Export
```typescript
// src/services/reserve/index.ts
export { weightDriftAuditService } from "./WeightDriftAuditService";
```

## Example: End-to-End Workflow

### Week 1 - Automated Audit
1. Monday 00:00 UTC: Job runs `calculateDriftReport()`
2. USD weight drifted to 42% (policy: 40%, drift: +2%)
3. Audit created with `status=pending`, UUID: `audit-123`
4. Email sent to ops team: "USD overweight by 2.00%"
5. Admins review via API: `GET /v1/admin/weight-drift-audits/audit-123`

### Week 1 - Manual Approval
1. Admin reviews drift report and market conditions
2. Approves: `POST /v1/admin/weight-drift-audits/audit-123/approve`
3. Request body: `{ "approvalNotes": "Within acceptable range, no action needed" }`
4. Status updates to `approved`
5. Event logged: `WEIGHT_DRIFT_AUDIT_APPROVED` with timestamp and admin ID

### Week 2 - New Audit (Rejection)
1. Monday 00:00 UTC: New audit generated
2. NGN weight now 25% (policy: 30%, drift: -5%)
3. Audit created as pending
4. Admin reviews and decides to wait for DAO vote
5. Rejects: `POST /v1/admin/weight-drift-audits/audit-124/reject`
6. Request body: `{ "reason": "Awaiting Q2 DAO vote on rebalancing" }`
7. Status updates to `rejected`
8. Event logged: `WEIGHT_DRIFT_AUDIT_REJECTED` with reason

## Monitoring & Alerts

**Logs to Watch:**
```
✓ "Weight drift audit scheduler started"
✓ "Weight drift report calculated"
✓ "Weight drift audit created"
✓ "Weight drift audit approved" or "rejected"
✓ "Weight drift audit email sent"
✗ "Weight drift audit job failed" - Needs investigation
✗ "Failed to send weight drift audit email" - Check email config
```

**Metrics to Track:**
- Audit frequency (should be weekly)
- Currencies exceeding threshold (trend over time)
- Max drift percentage (monitor for volatility)
- Approval turnaround time (time from creation to approval)
- Rejection rate (indicates policy issues if high)

## Future Enhancements

1. **Auto-approval rules** - Approve low-drift audits automatically
2. **Per-currency thresholds** - Different thresholds by currency liquidity
3. **Rebalancing instructions** - Auto-generate swaps from approved audits
4. **Dashboard UI** - Visual drift monitoring interface
5. **Historical analytics** - Trend charts and reports
6. **External alerts** - PagerDuty/Slack integration for critical drift
7. **Drift prediction** - ML-based forecasting of future drift
8. **Policy updates** - Auto-suggest weight adjustments based on market

## Troubleshooting

### Issue: Audit not running
**Check:**
- Logs for scheduler startup
- System clock in UTC timezone
- PostgreSQL and RabbitMQ connectivity

### Issue: Drift calculations wrong
**Check:**
- Active basket config has correct weights
- Reserve tracker pulling on-chain balances
- All currencies have reserve entries

### Issue: Email not sending
**Check:**
- `ADMIN_NOTIFICATION_EMAIL` environment variable set
- Email service credentials valid
- Network connectivity to email provider

## References

**Documentation:**
- [WEIGHT_DRIFT_AUDIT.md](../docs/WEIGHT_DRIFT_AUDIT.md) - Full architecture guide
- [WeightDriftAuditService API](../src/services/reserve/WeightDriftAuditService.ts)
- [weightDriftAuditJob Flow](../src/jobs/weightDriftAuditJob.ts)

**Related:**
- [BasketService](../src/services/basket/basketService.ts) - Policy weights
- [ReserveTracker](../src/services/reserve/ReserveTracker.ts) - Actual weights
- [RebalancingEngine](../src/services/reserve/RebalancingEngine.ts) - Drift calculations
- [AuditService](../src/services/audit/auditService.ts) - Compliance logging

---

**Implementation Date:** 2026-04-27  
**Implemented By:** GitHub Copilot  
**Branch:** feat/weight-drift-audit-job  
**Status:** Ready for PR Review & Merge
