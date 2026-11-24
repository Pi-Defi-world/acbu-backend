/**
 * Tests: user-scoped idempotency keys (Pi-Defi-world/acbu-backend#985).
 * A globally unique idempotency column plus an unscoped partner
 * `fintech_tx_id` lets two users collide on the same key. Scoping the key by
 * the authenticated user removes the cross-user collision and the resulting
 * status/existence disclosure.
 */

import {
  extractIdempotencyKey,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  scopeIdempotencyKey,
} from "../src/utils/idempotency";

describe("scopeIdempotencyKey (#985)", () => {
  it("namespaces the same raw key differently per user", () => {
    const alice = scopeIdempotencyKey("11111111-1111-1111-1111-111111111111", "FTX-123");
    const bob = scopeIdempotencyKey("22222222-2222-2222-2222-222222222222", "FTX-123");

    expect(alice).not.toBe(bob);
    expect(alice).toContain("FTX-123");
    expect(bob).toContain("FTX-123");
  });

  it("keeps the same scoped key for repeated submissions by the same user", () => {
    const first = scopeIdempotencyKey("user-a", "FTX-123");
    const second = scopeIdempotencyKey("user-a", "FTX-123");
    expect(first).toBe(second);
  });

  it("stays within the 255-character column limit for oversized keys", () => {
    const scope = "user-with-a-very-long-identifier-0123456789abcdef";
    const oversized = "K".repeat(400);

    const scoped = scopeIdempotencyKey(scope, oversized);

    expect(scoped.length).toBeLessThanOrEqual(IDEMPOTENCY_KEY_MAX_LENGTH);
    expect(scoped.startsWith(`${scope}:`)).toBe(true);
  });

  it("does not truncate keys that already fit", () => {
    const scoped = scopeIdempotencyKey("user-a", "short-key");
    expect(scoped).toBe("user-a:short-key");
  });
});

describe("extractIdempotencyKey", () => {
  function fakeRequest(headers: Record<string, string>, body: Record<string, unknown>) {
    return {
      header: (name: string) => headers[name],
      body,
    } as never;
  }

  it("reads the Idempotency-Key header first", () => {
    const req = fakeRequest({ "Idempotency-Key": "hdr-key" }, { idempotencyKey: "body-key" });
    expect(extractIdempotencyKey(req)).toBe("hdr-key");
  });

  it("falls back to the body idempotencyKey", () => {
    const req = fakeRequest({}, { idempotencyKey: "body-key" });
    expect(extractIdempotencyKey(req)).toBe("body-key");
  });

  it("returns undefined when neither is present", () => {
    expect(extractIdempotencyKey(fakeRequest({}, {}))).toBeUndefined();
    expect(extractIdempotencyKey(fakeRequest({}, { idempotencyKey: 42 }))).toBeUndefined();
  });
});
