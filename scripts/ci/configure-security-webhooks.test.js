const assert = require("node:assert/strict");
const test = require("node:test");

const {
  ORG_SECURITY_EVENTS,
  REPO_SECURITY_EVENTS,
  validateWebhookUrl,
  buildWebhookConfig,
  getHooksEndpoint,
  findMissingEvents,
  signPayload,
  formatAlertPayload,
  parseArgs,
} = require("./configure-security-webhooks");

test("organization security events include membership, repository, and branch protection", () => {
  for (const required of [
    "membership",
    "member",
    "repository",
    "branch_protection_rule",
    "branch_protection_configuration",
    "repository_ruleset",
  ]) {
    assert.ok(ORG_SECURITY_EVENTS.includes(required), `missing org event: ${required}`);
  }
});

test("repository security events include member, repository, and branch protection", () => {
  for (const required of [
    "member",
    "repository",
    "branch_protection_rule",
    "branch_protection_configuration",
    "repository_ruleset",
  ]) {
    assert.ok(REPO_SECURITY_EVENTS.includes(required), `missing repo event: ${required}`);
  }
});

test("validateWebhookUrl accepts HTTPS and rejects HTTP or invalid URLs", () => {
  assert.equal(
    validateWebhookUrl("https://hooks.slack.com/services/T00/B00/XXX"),
    "https://hooks.slack.com/services/T00/B00/XXX",
  );
  assert.throws(() => validateWebhookUrl("http://insecure.example.com/hook"), /HTTPS/);
  assert.throws(() => validateWebhookUrl("not-a-url"), /Invalid webhook URL/);
  assert.throws(() => validateWebhookUrl(""), /required/);
});

test("buildWebhookConfig enforces TLS verification and JSON content type", () => {
  const payload = buildWebhookConfig({
    scope: "org",
    url: "https://siem.example.com/github-audit",
    secret: "test-hmac-secret",
  });
  assert.equal(payload.active, true);
  assert.equal(payload.config.content_type, "json");
  assert.equal(payload.config.insecure_ssl, "0");
  assert.equal(payload.config.secret, "test-hmac-secret");
  assert.deepEqual(payload.events, [...ORG_SECURITY_EVENTS]);
});

test("getHooksEndpoint resolves org and repo endpoints and rejects invalid inputs", () => {
  assert.deepEqual(getHooksEndpoint({ org: "Pi-Defi-world" }), {
    scope: "org",
    endpoint: "https://api.github.com/orgs/Pi-Defi-world/hooks",
  });
  assert.deepEqual(getHooksEndpoint({ repo: "Pi-Defi-world/acbu-backend" }), {
    scope: "repo",
    endpoint: "https://api.github.com/repos/Pi-Defi-world/acbu-backend/hooks",
  });
  assert.throws(() => getHooksEndpoint({ org: "a", repo: "a/b" }), /not both/);
  assert.throws(() => getHooksEndpoint({}), /required/);
  assert.throws(() => getHooksEndpoint({ repo: "invalid-slug" }), /Invalid GitHub repository slug/);
});

test("findMissingEvents detects missing hooks, partial coverage, and full coverage", () => {
  const targetUrl = "https://siem.example.com/hook";
  const required = ["membership", "repository", "branch_protection_rule"];

  assert.deepEqual(findMissingEvents([], targetUrl, required), {
    found: false,
    hookId: null,
    missingEvents: required,
  });

  const partial = findMissingEvents(
    [{ id: 42, active: true, config: { url: targetUrl }, events: ["repository"] }],
    targetUrl,
    required,
  );
  assert.deepEqual(partial, {
    found: true,
    hookId: 42,
    missingEvents: ["membership", "branch_protection_rule"],
  });

  const wildcard = findMissingEvents(
    [{ id: 99, active: true, config: { url: targetUrl }, events: ["*"] }],
    targetUrl,
    required,
  );
  assert.deepEqual(wildcard, {
    found: true,
    hookId: 99,
    missingEvents: [],
  });
});

test("signPayload produces deterministic sha256 HMAC signature", () => {
  const sig = signPayload('{"event":"branch_protection_rule"}', "secret-key");
  assert.match(sig, /^sha256=[0-9a-f]{64}$/);
  assert.equal(sig, signPayload('{"event":"branch_protection_rule"}', "secret-key"));
});

test("formatAlertPayload produces Slack/Discord/SIEM compatible payload", () => {
  const alert = formatAlertPayload({
    event: "branch_protection_rule",
    action: "edited",
    repository: "Pi-Defi-world/acbu-backend",
    actor: "octocat",
    timestamp: "2026-11-20T00:00:00.000Z",
  });
  assert.ok(alert.text.includes("branch_protection_rule.edited"));
  assert.equal(alert.content, alert.text);
  assert.equal(alert.audit_event.repository, "Pi-Defi-world/acbu-backend");
  assert.equal(alert.audit_event.actor, "octocat");
});

test("parseArgs parses CLI flags correctly", () => {
  const parsed = parseArgs([
    "--org",
    "Pi-Defi-world",
    "--url",
    "https://hooks.slack.com/services/A/B/C",
    "--dry-run",
  ]);
  assert.equal(parsed.org, "Pi-Defi-world");
  assert.equal(parsed.url, "https://hooks.slack.com/services/A/B/C");
  assert.equal(parsed.dryRun, true);
  assert.equal(parsed.check, false);
});
