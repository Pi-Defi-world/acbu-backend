import fs from "node:fs";
import path from "node:path";

describe("Phase 1 volume assumptions", () => {
  const documentPath = path.join(process.cwd(), "docs", "phase-1-volume-assumptions.md");

  it("keeps the two-country sensitivity below the three-country baseline", () => {
    const document = fs.readFileSync(documentPath, "utf8");

    expect(document).toContain("total volume target of **$20M**");
    expect(document).toContain("**$13.33M**");
    expect(document).toContain("$20M x (2 / 3) = $13.33M");
    expect(document).not.toContain("$200M");
  });
});
