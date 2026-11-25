/**
 * W11-INC-008: the branch protection audit must distinguish an enabled
 * required-signatures rule from an absent rule and must query every protected
 * branch.
 */
/* eslint-disable @typescript-eslint/no-var-requires */
const {
  PROTECTED_BRANCHES,
  fetchRequiredSignatureStatus,
  interpretSignatureStatus,
  parseArguments,
} = require("../scripts/ci/check-branch-protection-signing");

describe("branch protection required-signature audit", () => {
  it("interprets GitHub's 204/404 contract", () => {
    expect(interpretSignatureStatus(204)).toBe("enabled");
    expect(interpretSignatureStatus(404)).toBe("not enabled");
    expect(() => interpretSignatureStatus(403)).toThrow("Unexpected GitHub API status 403");
  });

  it("covers every protected branch", () => {
    expect(PROTECTED_BRANCHES).toEqual(expect.arrayContaining(["main", "dev", "develop"]));
  });

  it("queries the required_signatures endpoint for the requested branch", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ status: 204 });

    const status = await fetchRequiredSignatureStatus({
      repository: "Pi-Defi-world/acbu-backend",
      branch: "dev",
      token: "admin-token",
      fetchImpl,
    });

    expect(status).toBe("enabled");
    expect(fetchImpl.mock.calls[0][0]).toBe(
      "https://api.github.com/repos/Pi-Defi-world/acbu-backend/branches/dev/" +
        "protection/required_signatures",
    );
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe("Bearer admin-token");
  });

  it("parses an explicit repository argument", () => {
    expect(parseArguments(["--repository=org/repo"])).toEqual({
      repository: "org/repo",
      help: false,
    });
  });
});
