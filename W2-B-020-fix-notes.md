# W2-B-020 — WeightDriftAuditJob sendEmail Wrong Arguments

## Status: Already Fixed ✅

**Severity:** High  
**Area:** `backend/jobs`  
**File:** `src/jobs/weightDriftAuditJob.ts` (line 140)  
**Fixed in:** Commit `63e0529` — _fix(build): resolve remaining tsc errors so pnpm build passes (#754)_

---

## Original Bug

The `sendEmail()` call inside `runWeightDriftAuditOnce()` had two problems
that caused the drift-alert job to crash mid-run, preventing any alert email
from ever being delivered:

### 1. Wrong config path

```ts
// ❌ config.ADMIN_NOTIFICATION_EMAIL did not exist — always evaluated to
//    undefined, so the email block was silently skipped.
if (config.ADMIN_NOTIFICATION_EMAIL) { ... }
```

### 2. Wrong call signature

```ts
// ❌ sendEmail() expects three positional arguments: (to, subject, body).
//    Passing a single object assigned the entire object to the `to` parameter,
//    causing a runtime crash.
await sendEmail({
  to: config.ADMIN_NOTIFICATION_EMAIL,
  subject: `[ACBU] Weekly Weight Drift Audit - ...`,
  body: emailBody,
  html: `<pre>${emailBody}</pre>`,
});
```

---

## Applied Fix (commit 63e0529)

```ts
// ✅ Uses the correct config path that actually exists.
const adminNotificationEmail = config.notification.alertEmail;
if (adminNotificationEmail) {
  // ✅ Matches the real sendEmail(to, subject, body) signature.
  await sendEmail(
    adminNotificationEmail,
    `[ACBU] Weekly Weight Drift Audit - ${audit.currenciesExceedingThreshold > 0 ? "ACTION REQUIRED" : "OK"}`,
    emailBody,
  );
}
```

---

## Verification

- The `sendEmail` function in `src/services/notification/notificationService.ts`
  has the signature `sendEmail(to: string, subject: string, body: string)`.
- All other callers in the codebase (`notificationConsumer.ts`, `auditService.ts`)
  use the same 3-argument pattern.
- The current code on HEAD (`37ff26e`) already contains the corrected version.

**No further changes are required.**
