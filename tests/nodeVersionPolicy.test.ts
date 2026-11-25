import fs from "node:fs";
import path from "node:path";

const repositoryRoot = path.resolve(__dirname, "..");

describe("Node version policy", () => {
  it("pins the repository to Node 22", () => {
    const nvmrc = fs.readFileSync(path.join(repositoryRoot, ".nvmrc"), "utf8").trim();
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
    ) as { engines?: { node?: string } };

    expect(nvmrc).toBe("22");
    expect(packageJson.engines?.node).toBe("22.x");
  });

  it("uses Node 22 in every setup-node workflow step", () => {
    const workflowsDirectory = path.join(repositoryRoot, ".github", "workflows");
    const workflowFiles = fs
      .readdirSync(workflowsDirectory)
      .filter((fileName) => fileName.endsWith(".yml") || fileName.endsWith(".yaml"));

    for (const workflowFile of workflowFiles) {
      const workflow = fs.readFileSync(path.join(workflowsDirectory, workflowFile), "utf8");
      const setupNodeStepCount = workflow.match(/uses:\s*actions\/setup-node@/g)?.length ?? 0;
      const nodeVersions = [...workflow.matchAll(/node-version:\s*["']?([^"'\s]+)["']?/g)].map(
        ([, version]) => version,
      );

      expect(nodeVersions).toHaveLength(setupNodeStepCount);
      expect(nodeVersions).toEqual(Array(setupNodeStepCount).fill("22"));
    }
  });
});
