import { generateId, generateCorrelationId } from "../src/utils/idGenerator";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Standard UUID regex: xxxxxxxx-xxxx-Mxxx-Nxxx-xxxxxxxxxxxx */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function versionNibble(id: string): number {
  // Byte 6 (chars 14–16 after removing hyphens, position 14 in the raw hex)
  // In the formatted string "xxxxxxxx-xxxx-Mxxx-..." the version char is at
  // index 14 (0-based).
  return parseInt(id[14]!, 16);
}

function variantBits(id: string): number {
  // Byte 8: variant char is at index 19 in the formatted string.
  return parseInt(id[19]!, 16);
}

// ---------------------------------------------------------------------------
// generateId() — UUIDv7
// ---------------------------------------------------------------------------

describe("generateId()", () => {
  it("returns a lowercase hyphen-separated UUID string", () => {
    const id = generateId();
    expect(id).toMatch(UUID_RE);
  });

  it("has version nibble = 7", () => {
    for (let i = 0; i < 20; i++) {
      expect(versionNibble(generateId())).toBe(7);
    }
  });

  it("has RFC 4122 variant bits (10xx — high nibble 8–b)", () => {
    for (let i = 0; i < 20; i++) {
      const v = variantBits(generateId());
      expect(v).toBeGreaterThanOrEqual(8);
      expect(v).toBeLessThanOrEqual(0xb);
    }
  });

  it("embeds a plausible unix timestamp in the top 48 bits", () => {
    const before = Date.now();
    const id = generateId();
    const after = Date.now();

    // Extract 48-bit timestamp from the first 12 hex chars (6 bytes).
    const hex = id.replace(/-/g, "");
    const tsMs = parseInt(hex.slice(0, 12), 16);

    expect(tsMs).toBeGreaterThanOrEqual(before);
    expect(tsMs).toBeLessThanOrEqual(after + 1); // +1 for rounding
  });

  it("generates unique IDs across a large batch", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      ids.add(generateId());
    }
    expect(ids.size).toBe(10_000);
  });

  it("IDs generated in sequence are lexicographically ordered (monotonic)", () => {
    // Generate a batch; because they're produced in the same process with
    // advancing time (or the same ms with an incrementing counter), each ID
    // must be >= the previous one.
    const ids: string[] = [];
    for (let i = 0; i < 200; i++) {
      ids.push(generateId());
    }

    for (let i = 1; i < ids.length; i++) {
      // Compare the raw hex (no hyphens) so the timestamp ordering is visible.
      const prev = ids[i - 1]!.replace(/-/g, "");
      const curr = ids[i]!.replace(/-/g, "");
      expect(curr >= prev).toBe(true);
    }
  });

  it("IDs from different milliseconds sort in time order", async () => {
    const id1 = generateId();
    // Advance the clock by at least 1 ms.
    await new Promise((resolve) => setTimeout(resolve, 2));
    const id2 = generateId();

    const hex1 = id1.replace(/-/g, "").slice(0, 12);
    const hex2 = id2.replace(/-/g, "").slice(0, 12);
    expect(parseInt(hex2, 16)).toBeGreaterThan(parseInt(hex1, 16));
  });
});

// ---------------------------------------------------------------------------
// generateCorrelationId() — UUIDv4
// ---------------------------------------------------------------------------

describe("generateCorrelationId()", () => {
  it("returns a lowercase hyphen-separated UUID string", () => {
    expect(generateCorrelationId()).toMatch(UUID_RE);
  });

  it("has version nibble = 4", () => {
    for (let i = 0; i < 20; i++) {
      expect(versionNibble(generateCorrelationId())).toBe(4);
    }
  });

  it("has RFC 4122 variant bits", () => {
    for (let i = 0; i < 20; i++) {
      const v = variantBits(generateCorrelationId());
      expect(v).toBeGreaterThanOrEqual(8);
      expect(v).toBeLessThanOrEqual(0xb);
    }
  });

  it("generates unique IDs across a large batch", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      ids.add(generateCorrelationId());
    }
    expect(ids.size).toBe(10_000);
  });

  it("does NOT embed a predictable timestamp (first 48 bits vary randomly)", () => {
    const now = Date.now();
    let timestampMatchCount = 0;

    for (let i = 0; i < 100; i++) {
      const hex = generateCorrelationId().replace(/-/g, "");
      const topBits = parseInt(hex.slice(0, 12), 16);
      // If UUIDv4 were accidentally using timestamp, top bits would be close to now.
      if (Math.abs(topBits - now) < 1000) {
        timestampMatchCount++;
      }
    }

    // Statistically impossible for random bytes to match the current ms timestamp.
    expect(timestampMatchCount).toBe(0);
  });
});
