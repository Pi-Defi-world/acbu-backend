import { sanitizeString } from "../src/utils/sanitize";

describe("sanitizeString", () => {
  it("removes html-like tags and trims whitespace", () => {
    expect(sanitizeString("  <b>Hello</b>  ")).toBe("Hello");
  });
});
