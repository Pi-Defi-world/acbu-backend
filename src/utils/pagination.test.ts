// W10-BE-017: list endpoints must never accept an unbounded page size.
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, parseOffsetPagination } from "./pagination";

describe("parseOffsetPagination (W10-BE-017)", () => {
  it("uses the defaults when no pagination is supplied", () => {
    expect(parseOffsetPagination({})).toEqual({ limit: DEFAULT_PAGE_LIMIT, offset: 0 });
  });

  it("passes through in-range values, flooring decimals", () => {
    expect(parseOffsetPagination({ limit: "50", offset: "120" })).toEqual({
      limit: 50,
      offset: 120,
    });
    expect(parseOffsetPagination({ limit: "7.9", offset: "3.2" })).toEqual({
      limit: 7,
      offset: 3,
    });
  });

  it("clamps an oversized limit to the maximum page size", () => {
    expect(parseOffsetPagination({ limit: "5000" }).limit).toBe(MAX_PAGE_LIMIT);
    expect(parseOffsetPagination({ limit: "1e30" }).limit).toBe(MAX_PAGE_LIMIT);
  });

  it("falls back to the default for zero, negative, or non-numeric limits", () => {
    for (const limit of ["0", "-10", "abc", "", "   ", "Infinity", "NaN"]) {
      expect(parseOffsetPagination({ limit }).limit).toBe(DEFAULT_PAGE_LIMIT);
    }
  });

  it("falls back to the default for repeated (array) query params", () => {
    expect(parseOffsetPagination({ limit: ["10", "20"] }).limit).toBe(DEFAULT_PAGE_LIMIT);
    expect(parseOffsetPagination({ offset: ["10", "20"] }).offset).toBe(0);
  });

  it("normalises invalid offsets to zero", () => {
    for (const offset of ["-5", "abc", "", "Infinity"]) {
      expect(parseOffsetPagination({ offset }).offset).toBe(0);
    }
  });

  it("clamps offsets the database cannot represent", () => {
    expect(parseOffsetPagination({ offset: "99999999999999999999" }).offset).toBe(2_147_483_647);
  });

  it("honours explicit default and maximum overrides", () => {
    expect(parseOffsetPagination({}, { defaultLimit: 50, maxLimit: 200 })).toEqual({
      limit: 50,
      offset: 0,
    });
    expect(parseOffsetPagination({ limit: "500" }, { maxLimit: 200 }).limit).toBe(200);
  });
});
