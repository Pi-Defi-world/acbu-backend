"use strict";

/**
 * W11-INC-001 support evidence collector.
 *
 * Reports whether the known attacker commit SHAs are still reachable:
 *  - locally, via `git cat-file -e <sha>^{commit}`
 *  - on GitHub, via the public commit URL (the exact URL auditors use; unlike
 *    the REST endpoint it accepts the abbreviated SHAs from the incident report)
 *
 * Run from the repository root:
 *   node scripts/ci/check-orphaned-attacker-commits.js
 *   node scripts/ci/check-orphaned-attacker-commits.js --fail
 *
 * Report-only by default. `--fail` makes the process exit non-zero when any
 * listed SHA is still fetchable, for use as a temporary verification gate
 * after GitHub Support confirms the garbage collection.
 */

const { execFileSync } = require("node:child_process");

const REPOSITORY = process.env.TARGET_REPOSITORY || "Pi-Defi-world/acbu-backend";

const KNOWN_ATTACKER_COMMITS = ["ab82ba0", "85a6aef", "4c5de4c"];

const WEB_BASE = "https://github.com";

function isLocallyReachable(sha) {
  try {
    execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns true (viewable), false (404) or null (unknown, e.g. rate limited).
 */
async function isRemotelyReachable(sha) {
  try {
    const response = await fetch(`${WEB_BASE}/${REPOSITORY}/commit/${sha}`, {
      headers: { "User-Agent": "acbu-incident-verifier" },
      redirect: "manual",
    });
    if (response.status === 200) return true;
    if (response.status === 404) return false;
    console.warn(`  ${sha}: GitHub returned ${response.status}; result unknown`);
    return null;
  } catch (error) {
    console.warn(`  ${sha}: GitHub check failed (${error.message}); result unknown`);
    return null;
  }
}

function buildReport(local, remote) {
  return KNOWN_ATTACKER_COMMITS.map((sha) => ({
    sha,
    local: local[sha] ?? false,
    github: remote[sha] ?? null,
  }));
}

async function collect() {
  const local = {};
  const remote = {};

  for (const sha of KNOWN_ATTACKER_COMMITS) {
    local[sha] = isLocallyReachable(sha);
    remote[sha] = await isRemotelyReachable(sha);
  }

  return buildReport(local, remote);
}

async function main() {
  const report = await collect();
  const reachable = report.filter((entry) => entry.local || entry.github);

  console.log(`W11-INC-001 reachability check for ${REPOSITORY}`);
  for (const entry of report) {
    const githubState = entry.github === null ? "unknown" : entry.github ? "REACHABLE" : "absent";
    console.log(
      `  ${entry.sha}: local=${entry.local ? "REACHABLE" : "absent"}, github=${githubState}`,
    );
  }

  if (reachable.length === 0) {
    console.log("All known attacker commit SHAs are unreachable.");
    return;
  }

  console.log(
    `${reachable.length} known attacker commit SHA(s) are still fetchable - ` +
      "submit the GitHub Support request documented in " +
      "docs/incident/W11-INC-001-github-support-request.md",
  );
  if (process.argv.includes("--fail")) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  KNOWN_ATTACKER_COMMITS,
  REPOSITORY,
  buildReport,
  collect,
};
