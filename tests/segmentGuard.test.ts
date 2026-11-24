// Tests for requireMinTier (B-047) and requireAdminKeyType (W10-BE-005)
import { Response } from "express";
import { requireAdminKeyType, requireMinTier, TIER_ORDER } from "../src/middleware/segmentGuard";
import type { ApiKeyType, AuthRequest, UserTier } from "../src/middleware/auth";

function makeReq(tier?: UserTier): AuthRequest {
  return { userTier: tier } as AuthRequest;
}

function makeApiKeyReq(keyType?: ApiKeyType): AuthRequest {
  return {
    apiKey: keyType
      ? ({
          id: "key-1",
          userId: "user-1",
          organizationId: null,
          keyType,
          createdByUserId: null,
          emergencyReason: null,
          emergencyExpiresAt: null,
          permissions: [],
          rateLimit: 100,
        } as NonNullable<AuthRequest["apiKey"]>)
      : undefined,
  } as AuthRequest;
}

function makeNext(): jest.Mock {
  return jest.fn();
}

describe("requireMinTier", () => {
  it("blocks when userTier is undefined (no tier set)", () => {
    const next = makeNext();
    requireMinTier("free")(makeReq(undefined), {} as Response, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it("allows exact tier match", () => {
    const next = makeNext();
    requireMinTier("verified")(makeReq("verified"), {} as Response, next);
    expect(next).toHaveBeenCalledWith(); // called with no args = pass
  });

  it("allows higher tier than required", () => {
    const next = makeNext();
    requireMinTier("verified")(makeReq("sme"), {} as Response, next);
    expect(next).toHaveBeenCalledWith();
  });

  it("blocks free tier from verified+ endpoint", () => {
    const next = makeNext();
    requireMinTier("verified")(makeReq("free"), {} as Response, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it("blocks free tier from sme+ endpoint", () => {
    const next = makeNext();
    requireMinTier("sme")(makeReq("free"), {} as Response, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it("blocks verified tier from sme+ endpoint", () => {
    const next = makeNext();
    requireMinTier("sme")(makeReq("verified"), {} as Response, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it("allows sme tier on sme+ endpoint", () => {
    const next = makeNext();
    requireMinTier("sme")(makeReq("sme"), {} as Response, next);
    expect(next).toHaveBeenCalledWith();
  });

  it("allows enterprise tier on sme+ endpoint", () => {
    const next = makeNext();
    requireMinTier("sme")(makeReq("enterprise"), {} as Response, next);
    expect(next).toHaveBeenCalledWith();
  });

  it("blocks non-enterprise tier from enterprise+ endpoint", () => {
    for (const tier of ["free", "verified", "sme"] as UserTier[]) {
      const next = makeNext();
      requireMinTier("enterprise")(makeReq(tier), {} as Response, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    }
  });

  it("allows enterprise tier on enterprise+ endpoint", () => {
    const next = makeNext();
    requireMinTier("enterprise")(makeReq("enterprise"), {} as Response, next);
    expect(next).toHaveBeenCalledWith();
  });

  it("TIER_ORDER is correctly ordered", () => {
    expect(TIER_ORDER).toEqual(["free", "verified", "sme", "enterprise"]);
  });
});

describe("requireAdminKeyType", () => {
  it("blocks when no API key is attached", () => {
    const next = makeNext();
    requireAdminKeyType()(makeApiKeyReq(), {} as Response, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it("blocks a USER_KEY", () => {
    const next = makeNext();
    requireAdminKeyType()(makeApiKeyReq("USER_KEY"), {} as Response, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it("allows an ADMIN_KEY", () => {
    const next = makeNext();
    requireAdminKeyType()(makeApiKeyReq("ADMIN_KEY"), {} as Response, next);
    expect(next).toHaveBeenCalledWith();
  });

  it("allows a BREAK_GLASS_KEY", () => {
    const next = makeNext();
    requireAdminKeyType()(makeApiKeyReq("BREAK_GLASS_KEY"), {} as Response, next);
    expect(next).toHaveBeenCalledWith();
  });
});
