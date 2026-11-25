/**
 * W11-INC-008: the PR signature gate must fail closed on unsigned,
 * badly signed or unknown-key commits, and must paginate the GitHub API.
 */
/* eslint-disable @typescript-eslint/no-var-requires */
const {
  evaluateCommitSignatures,
  fetchAllPullRequestCommits,
  formatResults,
  parseArguments,
  validateRepository,
} = require("../scripts/ci/check-signed-commits");

function commit(sha: string, verification: Record<string, unknown>) {
  return {
    sha,
    commit: {
      verification,
      author: { name: "Test Maintainer" },
    },
  };
}

describe("pull request commit signature check", () => {
  it("accepts only commits GitHub marks verified with a valid signature", () => {
    const commits = [
      commit("aaaaaaaaaaaa", { verified: true, reason: "valid" }),
      commit("bbbbbbbbbbbb", { verified: true, reason: "unknown_key" }),
      commit("cccccccccccc", { verified: false, reason: "bad_signature" }),
      commit("dddddddddddd", {}),
    ];

    expect(evaluateCommitSignatures(commits)).toEqual([
      {
        sha: "aaaaaaaaaaaa",
        verified: true,
        reason: "valid",
        author: "Test Maintainer",
      },
      {
        sha: "bbbbbbbbbbbb",
        verified: false,
        reason: "unknown_key",
        author: "Test Maintainer",
      },
      {
        sha: "cccccccccccc",
        verified: false,
        reason: "bad_signature",
        author: "Test Maintainer",
      },
      {
        sha: "dddddddddddd",
        verified: false,
        reason: "missing_verification",
        author: "Test Maintainer",
      },
    ]);
  });

  it("reports every commit with its verification reason", () => {
    const results = evaluateCommitSignatures([
      commit("aaaaaaaaaaaaaaaa", { verified: true, reason: "valid" }),
      commit("bbbbbbbbbbbbbbbb", { verified: false, reason: "unsigned" }),
    ]);

    const output = formatResults(results);
    expect(output).toContain("aaaaaaaaaaaa VERIFIED (valid)");
    expect(output).toContain("bbbbbbbbbbbb UNVERIFIED (unsigned)");
  });

  it("paginates until GitHub returns a short page", async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => Array.from({ length: 100 }, (_, index) => commit(`sha-${index}`, {})),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [commit("sha-100", { verified: true, reason: "valid" })],
      });

    const commits = await fetchAllPullRequestCommits({
      repository: "Pi-Defi-world/acbu-backend",
      pullNumber: 1465,
      token: "test-token",
      apiBaseUrl: "https://api.github.com/",
      fetchImpl,
    });

    expect(commits).toHaveLength(101);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][0]).toContain("page=2");
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe("Bearer test-token");
  });

  it("rejects non-GitHub repository values", () => {
    expect(() => validateRepository("not-a-repository")).toThrow("owner/repo");
  });

  it("parses explicit repository and pull request options", () => {
    expect(parseArguments(["--repository", "org/repo", "--pull-request", "42"])).toEqual({
      repository: "org/repo",
      pullNumber: 42,
      help: false,
    });
  });
});
