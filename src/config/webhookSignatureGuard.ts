const TRUE_VALUES = new Set(["true", "1", "yes", "on"]);
const TEST_PROFILES = new Set(["test", "testing", "ci"]);

export function isWebhookSignatureBypassEnabled(
  rawValue: string | undefined = process.env.WEBHOOK_SIGNATURE_BYPASS,
): boolean {
  return typeof rawValue === "string" && TRUE_VALUES.has(rawValue.trim().toLowerCase());
}

/**
 * Reject unsafe webhook-signature bypass configuration before the server
 * starts. A bypass is only valid in an explicit test/CI profile.
 */
export function assertWebhookSignatureConfigSafe(): void {
  if (!isWebhookSignatureBypassEnabled()) return;

  const profiles = [
    process.env.NODE_ENV,
    process.env.APP_PROFILE,
    process.env.APP_ENV,
    process.env.ENVIRONMENT,
  ].filter(
    (value): value is string => typeof value === "string",
  ).map((value) => value.trim().toLowerCase());

  if (!profiles.some((profile) => TEST_PROFILES.has(profile)) || profiles.includes("production")) {
    throw new Error("WEBHOOK_SIGNATURE_BYPASS must only be enabled in an explicit test profile.");
  }
}
