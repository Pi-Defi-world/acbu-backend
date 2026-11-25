"use strict";

/**
 * W11-INC-008: audit the GitHub-side "Require signed commits" rule.
 *
 * This setting cannot be enabled from a repository commit. An organisation
 * owner or repository admin must enable it in GitHub UI/API; this script gives
 * them a repeatable verification command.
 *
 * Usage:
 *   GH_TOKEN=<admin PAT with Administration:read> \
 *     node scripts/ci/check-branch-protection-signing.js \
 *     --repository Pi-Defi-world/acbu-backend
 */

const DEFAULT_API_BASE = "https://api.github.com";
const PROTECTED_BRANCHES = ["main", "dev", "develop"];

function parseArguments(argv) {
  const options = { repository: undefined, help: false };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const [flag, inlineValue] = argument.split("=", 2);

    if (flag === "--help" || flag === "-h") {
      options.help = true;
      continue;
    }

    if (flag !== "--repository") {
      throw new Error(`Unknown option: ${argument}`);
    }

    const value = inlineValue ?? argv[++index];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${flag}`);
    }
    options.repository = value;
  }

  return options;
}

function validateRepository(repository) {
  if (typeof repository !== "string" || !/^[^/\s]+\/[^/\s]+$/.test(repository)) {
    throw new Error(`Invalid repository: ${String(repository)} (expected owner/repo)`);
  }
  return repository;
}

function requestHeaders(token) {
  if (!token) {
    throw new Error(
      "A GitHub token with Administration:read permission is required " +
        "(set GH_TOKEN or GITHUB_TOKEN)",
    );
  }

  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "acbu-branch-protection-signing-audit",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function interpretSignatureStatus(status) {
  if (status === 204) return "enabled";
  if (status === 404) return "not enabled";
  throw new Error(`Unexpected GitHub API status ${status} while reading required signatures`);
}

async function fetchRequiredSignatureStatus({
  repository,
  branch,
  token,
  apiBaseUrl = DEFAULT_API_BASE,
  fetchImpl = fetch,
}) {
  const [owner, repo] = validateRepository(repository).split("/");
  const url =
    `${apiBaseUrl.replace(/\/$/, "")}/repos/${encodeURIComponent(owner)}/` +
    `${encodeURIComponent(repo)}/branches/${encodeURIComponent(branch)}/` +
    "protection/required_signatures";
  const response = await fetchImpl(url, { headers: requestHeaders(token) });
  return interpretSignatureStatus(response.status);
}

async function main(argv = process.argv.slice(2), env = process.env, fetchImpl = fetch) {
  if (parseArguments(argv).help) {
    console.log(
      "Usage: node scripts/ci/check-branch-protection-signing.js [--repository owner/repo]",
    );
    return;
  }

  const repository = validateRepository(parseArguments(argv).repository ?? env.GITHUB_REPOSITORY);
  const token = env.GH_TOKEN || env.GITHUB_TOKEN;
  const apiBaseUrl = env.GITHUB_API_URL || DEFAULT_API_BASE;

  console.log(`Required-signatures audit for ${repository}`);
  const failures = [];

  for (const branch of PROTECTED_BRANCHES) {
    const status = await fetchRequiredSignatureStatus({
      repository,
      branch,
      token,
      apiBaseUrl,
      fetchImpl,
    });
    console.log(`  ${branch}: ${status}`);
    if (status !== "enabled") {
      failures.push(branch);
    }
  }

  if (failures.length > 0) {
    console.error(
      `Enable "Require signed commits" for: ${failures.join(", ")}. ` +
        "See docs/BRANCH_PROTECTION.md.",
    );
    process.exitCode = 1;
    return;
  }

  console.log("All protected branches require verified signatures.");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_API_BASE,
  PROTECTED_BRANCHES,
  fetchRequiredSignatureStatus,
  interpretSignatureStatus,
  parseArguments,
  requestHeaders,
  validateRepository,
};
