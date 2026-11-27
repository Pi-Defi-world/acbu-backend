/**
 * W11-INC-001: the support evidence report must list every known SHA and mark
 * reachability from both local objects and the GitHub commit cache.
 */
/* eslint-disable @typescript-eslint/no-var-requires */
const {
  buildReport,
  KNOWN_ATTACKER_COMMITS,
} = require("../scripts/ci/check-orphaned-attacker-commits");

describe("orphaned attacker commit report", () => {
  it("includes every known attacker SHA", () => {
    expect(KNOWN_ATTACKER_COMMITS).toEqual(
      expect.arrayContaining(["ab82ba0", "85a6aef", "4c5de4c"]),
    );
  });

  it("reports local and GitHub reachability independently", () => {
    const local = { ab82ba0: false, "85a6aef": true, "4c5de4c": false };
    const remote = { ab82ba0: true, "85a6aef": false, "4c5de4c": false };

    expect(buildReport(local, remote)).toEqual(
      KNOWN_ATTACKER_COMMITS.map((sha: string) => ({
        sha,
        local: local[sha as keyof typeof local] ?? false,
        github: remote[sha as keyof typeof remote] ?? false,
      })),
    );
  });

  it("defaults missing entries to absent locally and unknown on GitHub", () => {
    expect(buildReport({}, {})).toEqual(
      KNOWN_ATTACKER_COMMITS.map((sha: string) => ({
        sha,
        local: false,
        github: null,
      })),
    );
  });
});
