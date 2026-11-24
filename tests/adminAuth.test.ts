// Tests for requireAdminApiKey middleware (B-031, W10-BE-006)
import crypto from "crypto";
import { Response } from "express";

const mockConfig = {
  adminApiKey: undefined as string | undefined,
  adminApiKeys: undefined as Array<{ id: string; key: string }> | undefined,
};

jest.mock("../src/config/env", () => ({ config: mockConfig }));
jest.mock("../src/config/logger", () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

import { requireAdminApiKey, AdminRequest } from "../src/middleware/adminAuth";

function makeReq(adminKey?: string): AdminRequest {
  return { headers: adminKey ? { "x-admin-key": adminKey } : {} } as AdminRequest;
}

function makeNext() {
  return jest.fn();
}

describe("requireAdminApiKey", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig.adminApiKeys = undefined;
  });

  it("returns 503 when ADMIN_API_KEY is not configured", () => {
    mockConfig.adminApiKey = undefined;
    const next = makeNext();
    requireAdminApiKey(makeReq("anything"), {} as Response, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 503 }));
  });

  it("returns 401 when no x-admin-key header is provided", () => {
    mockConfig.adminApiKey = "secret-key";
    const next = makeNext();
    requireAdminApiKey(makeReq(), {} as Response, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it("returns 401 when x-admin-key header is wrong", () => {
    mockConfig.adminApiKey = "secret-key";
    const next = makeNext();
    requireAdminApiKey(makeReq("wrong-key"), {} as Response, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it("calls next() with no error when key matches", () => {
    mockConfig.adminApiKey = "secret-key";
    const next = makeNext();
    requireAdminApiKey(makeReq("secret-key"), {} as Response, next);
    expect(next).toHaveBeenCalledWith();
  });

  // ── W10-BE-006: constant-time comparison ────────────────────────────────
  it("compares secrets with crypto.timingSafeEqual, never with string equality", () => {
    mockConfig.adminApiKey = "secret-key";
    const spy = jest.spyOn(crypto, "timingSafeEqual");
    const next = makeNext();

    requireAdminApiKey(makeReq("secret-key"), {} as Response, next);

    expect(spy).toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();

    spy.mockRestore();
  });

  it("rejects a wrong key whose length differs without throwing", () => {
    mockConfig.adminApiKey = "secret-key";
    const next = makeNext();

    expect(() =>
      requireAdminApiKey(makeReq("secret-key-plus-more"), {} as Response, next),
    ).not.toThrow();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it("rejects a key that is a prefix or extension of the configured key", () => {
    mockConfig.adminApiKey = "secret-key";
    const prefixNext = makeNext();
    const extensionNext = makeNext();

    requireAdminApiKey(makeReq("secret"), {} as Response, prefixNext);
    requireAdminApiKey(makeReq("secret-key-2"), {} as Response, extensionNext);

    expect(prefixNext).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    expect(extensionNext).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it("checks every configured key, attributing the request to the matching admin", () => {
    mockConfig.adminApiKeys = [
      { id: "admin-a", key: "key-a" },
      { id: "admin-b", key: "key-b" },
      { id: "admin-c", key: "key-c" },
    ];
    const spy = jest.spyOn(crypto, "timingSafeEqual");
    const req = makeReq("key-b");
    const next = makeNext();

    requireAdminApiKey(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.admin).toEqual({ id: "admin-b" });
    expect(req.adminId).toBe("admin-b");
    // No early break: all three configured keys are compared.
    expect(spy).toHaveBeenCalledTimes(3);

    spy.mockRestore();
  });

  it("prefers the first configured key when several keys match", () => {
    mockConfig.adminApiKeys = [
      { id: "admin-a", key: "shared-key" },
      { id: "admin-b", key: "shared-key" },
    ];
    const req = makeReq("shared-key");
    const next = makeNext();

    requireAdminApiKey(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.admin).toEqual({ id: "admin-a" });
  });
});
