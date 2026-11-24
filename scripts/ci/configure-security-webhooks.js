#!/usr/bin/env node
/**
 * Configure or verify GitHub organization/repository security audit webhooks
 * for W11-INC-015 (membership, repository, and branch protection events).
 *
 * Usage:
 *   GITHUB_TOKEN=... node scripts/ci/configure-security-webhooks.js \
 *     --org <org-name> \
 *     --url https://hooks.slack.com/services/... \
 *     [--secret <hmac-secret>] \
 *     [--dry-run | --check]
 *
 *   GITHUB_TOKEN=... node scripts/ci/configure-security-webhooks.js \
 *     --repo <owner/repo> \
 *     --url https://discord.com/api/webhooks/... \
 *     [--secret <hmac-secret>] \
 *     [--dry-run | --check]
 */

"use strict";

const crypto = require("node:crypto");

const ORG_SECURITY_EVENTS = Object.freeze([
  "membership",
  "member",
  "organization",
  "team",
  "repository",
  "branch_protection_rule",
  "branch_protection_configuration",
  "repository_ruleset",
  "deploy_key",
]);

const REPO_SECURITY_EVENTS = Object.freeze([
  "member",
  "repository",
  "branch_protection_rule",
  "branch_protection_configuration",
  "repository_ruleset",
  "deploy_key",
]);

function validateWebhookUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") {
    throw new Error("Webhook URL is required (--url or SECURITY_AUDIT_WEBHOOK_URL).");
  }
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid webhook URL: ${rawUrl}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(
      `Webhook URL must use HTTPS to protect audit payloads in transit (got ${parsed.protocol}).`,
    );
  }
  return parsed.toString();
}

function getRequiredEvents(scope) {
  if (scope === "org") return [...ORG_SECURITY_EVENTS];
  if (scope === "repo") return [...REPO_SECURITY_EVENTS];
  throw new Error(`Unsupported scope "${scope}". Expected "org" or "repo".`);
}

function buildWebhookConfig({ scope, url, secret }) {
  const validatedUrl = validateWebhookUrl(url);
  const events = getRequiredEvents(scope);

  const config = {
    url: validatedUrl,
    content_type: "json",
    insecure_ssl: "0",
  };
  if (secret) {
    config.secret = secret;
  }

  return {
    name: "web",
    active: true,
    events,
    config,
  };
}

function getHooksEndpoint({ org, repo }) {
  if (org && repo) {
    throw new Error("Specify either --org or --repo, not both.");
  }
  if (org) {
    if (!/^[A-Za-z0-9_.-]+$/.test(org)) {
      throw new Error(`Invalid GitHub organization name: ${org}`);
    }
    return {
      scope: "org",
      endpoint: `https://api.github.com/orgs/${org}/hooks`,
    };
  }
  if (repo) {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
      throw new Error(`Invalid GitHub repository slug (expected owner/repo): ${repo}`);
    }
    return {
      scope: "repo",
      endpoint: `https://api.github.com/repos/${repo}/hooks`,
    };
  }
  throw new Error("Either --org <org> or --repo <owner/repo> is required.");
}

function findMissingEvents(existingHooks, targetUrl, requiredEvents) {
  const matchingHook = existingHooks.find(
    (hook) => hook && hook.active && hook.config && hook.config.url === targetUrl,
  );
  if (!matchingHook) {
    return {
      found: false,
      hookId: null,
      missingEvents: [...requiredEvents],
    };
  }
  const configured = new Set(Array.isArray(matchingHook.events) ? matchingHook.events : []);
  if (configured.has("*")) {
    return { found: true, hookId: matchingHook.id, missingEvents: [] };
  }
  const missingEvents = requiredEvents.filter((evt) => !configured.has(evt));
  return {
    found: true,
    hookId: matchingHook.id,
    missingEvents,
  };
}

function signPayload(payloadString, secret) {
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(payloadString, "utf8");
  return `sha256=${hmac.digest("hex")}`;
}

function formatAlertPayload({ event, action, repository, actor, timestamp, details }) {
  const summary = `[SECURITY AUDIT] ${event}${action ? `.${action}` : ""} on ${repository} by ${actor}`;
  return {
    text: summary,
    content: summary,
    audit_event: {
      source: "github-actions",
      event,
      action: action || "triggered",
      repository,
      actor,
      timestamp: timestamp || new Date().toISOString(),
      details: details || {},
    },
  };
}

function parseArgs(argv) {
  const args = {
    org: null,
    repo: null,
    url: process.env.SECURITY_AUDIT_WEBHOOK_URL || null,
    secret: process.env.SECURITY_AUDIT_WEBHOOK_SECRET || null,
    dryRun: false,
    check: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--org") {
      args.org = argv[++i];
    } else if (flag === "--repo") {
      args.repo = argv[++i];
    } else if (flag === "--url") {
      args.url = argv[++i];
    } else if (flag === "--secret") {
      args.secret = argv[++i];
    } else if (flag === "--dry-run") {
      args.dryRun = true;
    } else if (flag === "--check") {
      args.check = true;
    } else if (flag === "--help" || flag === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${flag}`);
    }
  }
  return args;
}

async function githubRequest(url, { method = "GET", token, body } = {}) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "acbu-security-audit-webhook-config",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (body) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API ${method} ${url} failed (${response.status}): ${text}`);
  }
  return response.json();
}

async function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(
      "Usage: node scripts/ci/configure-security-webhooks.js (--org <org> | --repo <owner/repo>) --url <https-url> [--secret <secret>] [--dry-run | --check]",
    );
    return 0;
  }

  const { scope, endpoint } = getHooksEndpoint({ org: args.org, repo: args.repo });
  const payload = buildWebhookConfig({ scope, url: args.url, secret: args.secret });

  if (args.dryRun) {
    const sanitized = {
      ...payload,
      config: {
        ...payload.config,
        secret: payload.config.secret ? "[REDACTED]" : undefined,
      },
    };
    console.log(JSON.stringify({ endpoint, scope, payload: sanitized }, null, 2));
    return 0;
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN environment variable is required (admin:org_hook or admin:repo_hook).");
  }

  const existingHooks = await githubRequest(endpoint, { token });
  const status = findMissingEvents(existingHooks, payload.config.url, payload.events);

  if (args.check) {
    if (status.found && status.missingEvents.length === 0) {
      console.log(`OK: Security audit webhook #${status.hookId} covers all ${payload.events.length} required events.`);
      return 0;
    }
    console.error(
      status.found
        ? `FAIL: Webhook #${status.hookId} is missing events: ${status.missingEvents.join(", ")}`
        : `FAIL: No active webhook found for ${payload.config.url}`,
    );
    return 1;
  }

  if (status.found) {
    const updated = await githubRequest(`${endpoint}/${status.hookId}`, {
      method: "PATCH",
      token,
      body: { active: true, events: payload.events, config: payload.config },
    });
    console.log(`Updated security audit webhook #${updated.id} with ${payload.events.length} events.`);
  } else {
    const created = await githubRequest(endpoint, {
      method: "POST",
      token,
      body: payload,
    });
    console.log(`Created security audit webhook #${created.id} with ${payload.events.length} events.`);
  }
  return 0;
}

if (require.main === module) {
  runCli()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      console.error(`Error: ${err.message}`);
      process.exitCode = 1;
    });
}

module.exports = {
  ORG_SECURITY_EVENTS,
  REPO_SECURITY_EVENTS,
  validateWebhookUrl,
  getRequiredEvents,
  buildWebhookConfig,
  getHooksEndpoint,
  findMissingEvents,
  signPayload,
  formatAlertPayload,
  parseArgs,
  runCli,
};
