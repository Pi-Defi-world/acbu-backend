"use strict";

/**
 * W11-INC-008: verify that every commit in a pull request carries a signature
 * GitHub considers verified.
 *
 * This is a defence-in-depth gate. The authoritative control is the
 * "Require signed commits" branch protection rule documented in
 * docs/BRANCH_PROTECTION.md; a repository file cannot enable that setting.
 *
 * Usage in GitHub Actions (GITHUB_TOKEN, GITHUB_REPOSITORY and
 * GITHUB_EVENT_PATH are supplied automatically):
 *   node scripts/ci/check-signed-commits.js
 *
 * Usage locally:
 *   GITHUB_TOKEN=<token> node scripts/ci/check-signed-commits.js \
 *     --repository Pi-Defi-world/acbu-backend --pull-request 1465
 */

const fs = require("node:fs");

const DEFAULT_API_BASE = "https://api.github.com";
const PER_PAGE = 100;

function parseArguments(argv) {
  const options = { repository: undefined, pullNumber: undefined, help: false };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const [flag, inlineValue] = argument.split("=", 2);

    if (flag === "--help" || flag === "-h") {
      options.help = true;
      continue;
    }

    if (flag !== "--repository" && flag !== "--pull-request") {
      throw new Error(`Unknown option: ${argument}`);
    }

    const value = inlineValue ?? argv[++index];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${flag}`);
    }

    if (flag === "--repository") {
      options.repository = value;
    } else {
      const pullNumber = Number(value);
      if (!Number.isInteger(pullNumber) || pullNumber <= 0) {
        throw new Error(`Invalid pull request number: ${value}`);
      }
      options.pullNumber = pullNumber;
    }
  }

  return options;
}

function validateRepository(repository) {
  if (typeof repository !== "string" || !/^[^/\s]+\/[^/\s]+$/.test(repository)) {
    throw new Error(`Invalid repository: ${String(repository)} (expected owner/repo)`);
  }
  return repository;
}

function readPullRequestContext(eventPath) {
  if (!eventPath || !fs.existsSync(eventPath)) {
    return {};
  }

  const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
  return {
    repository: event.repository?.full_name,
    pullNumber: event.pull_request?.number ?? event.number,
  };
}

function resolveContext(argv, env) {
  const options = parseArguments(argv);
  const eventContext = readPullRequestContext(env.GITHUB_EVENT_PATH);

  const repository = validateRepository(
    options.repository ?? env.GITHUB_REPOSITORY ?? eventContext.repository,
  );
  const pullNumber = options.pullNumber ?? Number(eventContext.pullNumber);

  if (!Number.isInteger(pullNumber) || pullNumber <= 0) {
    throw new Error("Pull request number is missing (use --pull-request N)");
  }

  return { repository, pullNumber };
}

function requestHeaders(token) {
  if (!token) {
    throw new Error("GITHUB_TOKEN is required to query the pull request commits API");
  }

  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "acbu-signed-commit-check",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function fetchAllPullRequestCommits({
  repository,
  pullNumber,
  token,
  apiBaseUrl = DEFAULT_API_BASE,
  fetchImpl = fetch,
  perPage = PER_PAGE,
}) {
  const [owner, repo] = validateRepository(repository).split("/");
  const headers = requestHeaders(token);
  const commits = [];

  for (let page = 1; ; page += 1) {
    const url =
      `${apiBaseUrl.replace(/\/$/, "")}/repos/${encodeURIComponent(owner)}/` +
      `${encodeURIComponent(repo)}/pulls/${pullNumber}/commits` +
      `?per_page=${perPage}&page=${page}`;
    const response = await fetchImpl(url, { headers });

    if (!response.ok) {
      throw new Error(`GitHub API returned ${response.status} while listing PR commits`);
    }

    const pageCommits = await response.json();
    commits.push(...pageCommits);

    if (pageCommits.length < perPage) {
      break;
    }
  }

  return commits;
}

function evaluateCommitSignatures(commits) {
  return (commits ?? []).map((entry, index) => {
    const verification = entry.commit?.verification ?? {};
    const verified = verification.verified === true && verification.reason === "valid";

    return {
      sha: entry.sha ?? `#${index + 1}`,
      verified,
      reason: verification.reason ?? "missing_verification",
      author: entry.commit?.author?.name ?? "unknown",
    };
  });
}

function formatResults(results) {
  return results
    .map(({ sha, verified, reason, author }) => {
      const state = verified ? "VERIFIED" : "UNVERIFIED";
      return `  ${sha.slice(0, 12)} ${state} (${reason}) ${author}`;
    })
    .join("\n");
}

async function main(argv = process.argv.slice(2), env = process.env, fetchImpl = fetch) {
  if (parseArguments(argv).help) {
    console.log(
      "Usage: node scripts/ci/check-signed-commits.js " +
        "[--repository owner/repo] [--pull-request N]",
    );
    return;
  }

  const { repository, pullNumber } = resolveContext(argv, env);
  const apiBaseUrl = env.GITHUB_API_URL || DEFAULT_API_BASE;
  const commits = await fetchAllPullRequestCommits({
    repository,
    pullNumber,
    token: env.GITHUB_TOKEN,
    apiBaseUrl,
    fetchImpl,
  });
  const results = evaluateCommitSignatures(commits);
  const unverified = results.filter((result) => !result.verified);

  console.log(`Commit signature check for ${repository}#${pullNumber}`);
  console.log(formatResults(results));

  if (results.length === 0) {
    console.error("No commits were returned; refusing to pass the signature check.");
    process.exitCode = 1;
    return;
  }

  if (unverified.length > 0) {
    console.error(
      `${unverified.length} of ${results.length} commit(s) are not verified by GitHub. ` +
        "Sign commits with GPG or SSH and see docs/BRANCH_PROTECTION.md.",
    );
    process.exitCode = 1;
    return;
  }

  console.log(`All ${results.length} pull request commit(s) have verified signatures.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_API_BASE,
  evaluateCommitSignatures,
  fetchAllPullRequestCommits,
  formatResults,
  parseArguments,
  requestHeaders,
  resolveContext,
  validateRepository,
};
