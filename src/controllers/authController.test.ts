import {
  postSignup,
  postSignin,
  postSignout,
  postVerify2fa,
} from "./authController";
import { prisma } from "../config/database";
import { AppError } from "../middleware/errorHandler";
import type { AuthRequest } from "../middleware/auth";
import type { Response, NextFunction } from "express";

jest.mock("../services/auth", () => ({
  signup: jest.fn(),
  signin: jest.fn(),
  verify2fa: jest.fn(),
}));

jest.mock("../config/database", () => ({
  prisma: {
    apiKey: { update: jest.fn() },
  },
}));

jest.mock("../config/logger", () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

// Import after mocks are registered
import { signup, signin, verify2fa } from "../services/auth";

const makeRes = () => {
  const res = { status: jest.fn(), json: jest.fn() } as unknown as Response;
  (res.status as jest.Mock).mockReturnValue(res);
  (res.json as jest.Mock).mockReturnValue(res);
  return res;
};

const makeNext = () => jest.fn() as jest.MockedFunction<NextFunction>;

describe("authController", () => {
  beforeEach(() => jest.clearAllMocks());

  // ── postSignup ─────────────────────────────────────────────────────────────

  describe("postSignup", () => {
    it("returns 201 with user_id on success", async () => {
      (signup as jest.Mock).mockResolvedValue({
        user_id: "u1",
        message: "Account created.",
      });
      const res = makeRes();
      const next = makeNext();
      await postSignup(
        { body: { username: "alice", passcode: "1234" } } as AuthRequest,
        res,
        next,
      );
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        user_id: "u1",
        message: "Account created.",
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("returns 400 when passcode is too short (Zod validation)", async () => {
      const next = makeNext();
      await postSignup(
        { body: { username: "alice", passcode: "12" } } as AuthRequest,
        makeRes(),
        next,
      );
      const err = (next as jest.Mock).mock.calls[0][0] as AppError;
      expect(err.statusCode).toBe(400);
    });

    it("returns 400 when username is missing", async () => {
      const next = makeNext();
      await postSignup(
        { body: { passcode: "1234" } } as AuthRequest,
        makeRes(),
        next,
      );
      const err = (next as jest.Mock).mock.calls[0][0] as AppError;
      expect(err.statusCode).toBe(400);
    });

    it("returns 409 when username is already taken", async () => {
      (signup as jest.Mock).mockRejectedValue(
        new Error("Username already taken"),
      );
      const next = makeNext();
      await postSignup(
        { body: { username: "alice", passcode: "1234" } } as AuthRequest,
        makeRes(),
        next,
      );
      const err = (next as jest.Mock).mock.calls[0][0] as AppError;
      expect(err.statusCode).toBe(409);
      expect(err.message).toBe("Username already taken");
    });
  });

  // ── postSignin ─────────────────────────────────────────────────────────────

  describe("postSignin", () => {
    it("returns 200 with api_key and user_id on success", async () => {
      (signin as jest.Mock).mockResolvedValue({
        api_key: "acbu_xxx",
        user_id: "u1",
      });
      const res = makeRes();
      const next = makeNext();
      await postSignin(
        { body: { identifier: "alice", passcode: "1234" } } as AuthRequest,
        res,
        next,
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ api_key: "acbu_xxx", user_id: "u1" }),
      );
    });

    it("returns requires_2fa and challenge_token when 2FA is required", async () => {
      (signin as jest.Mock).mockResolvedValue({
        requires_2fa: true,
        challenge_token: "tok123",
      });
      const res = makeRes();
      await postSignin(
        { body: { identifier: "alice", passcode: "1234" } } as AuthRequest,
        res,
        makeNext(),
      );
      expect(res.json).toHaveBeenCalledWith({
        requires_2fa: true,
        challenge_token: "tok123",
      });
    });

    it("includes wallet_created flag when wallet is newly created", async () => {
      (signin as jest.Mock).mockResolvedValue({
        api_key: "key",
        user_id: "u1",
        wallet_created: true,
        passphrase: "words",
        encryption_method_required: true,
      });
      const res = makeRes();
      await postSignin(
        { body: { identifier: "alice", passcode: "1234" } } as AuthRequest,
        res,
        makeNext(),
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          wallet_created: true,
          encryption_method_required: true,
        }),
      );
    });

    it("returns 401 on invalid credentials", async () => {
      (signin as jest.Mock).mockRejectedValue(new Error("Invalid credentials"));
      const next = makeNext();
      await postSignin(
        { body: { identifier: "alice", passcode: "wrong" } } as AuthRequest,
        makeRes(),
        next,
      );
      const err = (next as jest.Mock).mock.calls[0][0] as AppError;
      expect(err.statusCode).toBe(401);
      expect(err.message).toBe("Invalid credentials");
    });

    it("returns 400 when identifier is missing (Zod validation)", async () => {
      const next = makeNext();
      await postSignin(
        { body: { passcode: "1234" } } as AuthRequest,
        makeRes(),
        next,
      );
      const err = (next as jest.Mock).mock.calls[0][0] as AppError;
      expect(err.statusCode).toBe(400);
    });

    it("returns 503 when OTP delivery is unavailable", async () => {
      (signin as jest.Mock).mockRejectedValue(
        new Error("OTP delivery unavailable"),
      );
      const next = makeNext();
      await postSignin(
        { body: { identifier: "alice", passcode: "1234" } } as AuthRequest,
        makeRes(),
        next,
      );
      const err = (next as jest.Mock).mock.calls[0][0] as AppError;
      expect(err.statusCode).toBe(503);
    });

    it("returns 400 when 2FA channel is not configured", async () => {
      (signin as jest.Mock).mockRejectedValue(
        new Error("2FA channel not configured"),
      );
      const next = makeNext();
      await postSignin(
        { body: { identifier: "alice", passcode: "1234" } } as AuthRequest,
        makeRes(),
        next,
      );
      const err = (next as jest.Mock).mock.calls[0][0] as AppError;
      expect(err.statusCode).toBe(400);
    });
  });

  // ── postSignout ────────────────────────────────────────────────────────────

  describe("postSignout", () => {
    it("revokes the current API key and returns { ok: true }", async () => {
      (prisma.apiKey.update as jest.Mock).mockResolvedValue({});
      const res = makeRes();
      const next = makeNext();
      await postSignout({ apiKey: { id: "key-1" } } as AuthRequest, res, next);
      expect(prisma.apiKey.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "key-1" },
          data: expect.objectContaining({ revokedAt: expect.any(Date) }),
        }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ ok: true });
    });

    it("returns 401 when there is no API key on the request", async () => {
      const next = makeNext();
      await postSignout({} as AuthRequest, makeRes(), next);
      const err = (next as jest.Mock).mock.calls[0][0] as AppError;
      expect(err.statusCode).toBe(401);
    });
  });

  // ── postVerify2fa ──────────────────────────────────────────────────────────

  describe("postVerify2fa", () => {
    it("returns 200 with api_key on valid code", async () => {
      (verify2fa as jest.Mock).mockResolvedValue({
        api_key: "acbu_yyy",
        user_id: "u2",
      });
      const res = makeRes();
      await postVerify2fa(
        { body: { challenge_token: "tok", code: "123456" } } as AuthRequest,
        res,
        makeNext(),
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ api_key: "acbu_yyy", user_id: "u2" }),
      );
    });

    it("returns 401 on invalid or expired challenge", async () => {
      (verify2fa as jest.Mock).mockRejectedValue(
        new Error("Invalid or expired challenge"),
      );
      const next = makeNext();
      await postVerify2fa(
        { body: { challenge_token: "bad", code: "000000" } } as AuthRequest,
        makeRes(),
        next,
      );
      expect((next as jest.Mock).mock.calls[0][0]).toMatchObject({
        statusCode: 401,
      });
    });

    it("returns 401 on invalid code", async () => {
      (verify2fa as jest.Mock).mockRejectedValue(new Error("Invalid code"));
      const next = makeNext();
      await postVerify2fa(
        { body: { challenge_token: "tok", code: "000000" } } as AuthRequest,
        makeRes(),
        next,
      );
      expect((next as jest.Mock).mock.calls[0][0]).toMatchObject({
        statusCode: 401,
      });
    });

    it("returns 400 when challenge_token is missing (Zod validation)", async () => {
      const next = makeNext();
      await postVerify2fa(
        { body: { code: "123456" } } as AuthRequest,
        makeRes(),
        next,
      );
      expect((next as jest.Mock).mock.calls[0][0]).toMatchObject({
        statusCode: 400,
      });
    });

    it("returns 400 when 2FA method is unsupported", async () => {
      (verify2fa as jest.Mock).mockRejectedValue(
        new Error("Unsupported 2FA method"),
      );
      const next = makeNext();
      await postVerify2fa(
        { body: { challenge_token: "tok", code: "999999" } } as AuthRequest,
        makeRes(),
        next,
      );
      expect((next as jest.Mock).mock.calls[0][0]).toMatchObject({
        statusCode: 400,
      });
    });
  });
});
