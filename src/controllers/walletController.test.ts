import type { NextFunction, Response } from "express";
import { postWalletEnroll, walletEnrollSchema } from "./walletController";
import { enrollClientGeneratedWallet } from "../services/wallet/walletService";
import { AppError } from "../middleware/errorHandler";
import type { AuthRequest } from "../middleware/auth";

jest.mock("../services/wallet/walletService", () => ({
  enrollClientGeneratedWallet: jest.fn(),
}));

jest.mock("../config/database", () => ({
  prisma: { user: { findUnique: jest.fn(), updateMany: jest.fn() } },
}));

jest.mock("../config/logger", () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

jest.mock("../services/stellar/activationService", () => ({
  ensureAccountActivated: jest.fn(),
}));

// Import after mocks are registered
import { Keypair } from "@stellar/stellar-sdk";

const ADDRESS = Keypair.random().publicKey();
const WRAPPED_KEY = Buffer.concat([
  Buffer.alloc(12, 7),
  Buffer.alloc(56, 9),
  Buffer.alloc(16, 3),
]).toString("base64");

const makeRes = () => {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
    setHeader: jest.fn(),
  } as unknown as Response;
  (res.status as jest.Mock).mockReturnValue(res);
  (res.json as jest.Mock).mockReturnValue(res);
  return res;
};

const makeReq = (body: Record<string, unknown>, userId: string | null = "user-1"): AuthRequest =>
  ({
    apiKey: userId ? { userId } : {},
    body,
    header: (name: string) => (name === "if-match" ? '"3"' : undefined),
  }) as unknown as AuthRequest;

describe("postWalletEnroll", () => {
  const next = jest.fn() as jest.MockedFunction<NextFunction>;

  beforeEach(() => {
    jest.clearAllMocks();
    (enrollClientGeneratedWallet as jest.Mock).mockResolvedValue(4);
  });

  it("binds the client-generated public key and its encrypted backup", async () => {
    const res = makeRes();
    await postWalletEnroll(
      makeReq({
        stellar_address: ADDRESS,
        wrapped_key: WRAPPED_KEY,
        wrap_algorithm: "aes-256-gcm",
        wrap_kdf: "scrypt:N=16384",
      }),
      res,
      next,
    );

    expect(enrollClientGeneratedWallet).toHaveBeenCalledWith(
      "user-1",
      '"3"',
      expect.objectContaining({
        stellarAddress: ADDRESS,
        wrappedKey: WRAPPED_KEY,
        wrapAlgorithm: "aes-256-gcm",
        wrapKdf: "scrypt:N=16384",
      }),
    );
    expect(res.setHeader).toHaveBeenCalledWith("ETag", '"4"');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      stellar_address: ADDRESS,
      has_encrypted_backup: true,
      wallet_version: 4,
    });
  });

  it("enrolls an address-only wallet when the client keeps no backup", async () => {
    await postWalletEnroll(makeReq({ stellar_address: ADDRESS }), makeRes(), next);

    expect(enrollClientGeneratedWallet).toHaveBeenCalledWith(
      "user-1",
      '"3"',
      expect.objectContaining({ stellarAddress: ADDRESS, wrappedKey: undefined }),
    );
  });

  it("requires a user-scoped API key", async () => {
    const res = makeRes();
    await postWalletEnroll(makeReq({ stellar_address: ADDRESS }, null), res, next);

    const error = next.mock.calls[0][0] as AppError;
    expect(error.statusCode).toBe(401);
    expect(enrollClientGeneratedWallet).not.toHaveBeenCalled();
  });

  it("rejects a missing or malformed public key", async () => {
    for (const body of [{}, { stellar_address: "not-a-key" }]) {
      const res = makeRes();
      await postWalletEnroll(makeReq(body), res, next);
      const error = next.mock.calls[0][0] as AppError;
      expect(error.statusCode).toBe(400);
    }
    expect(enrollClientGeneratedWallet).not.toHaveBeenCalled();
  });

  it("requires the encryption metadata that makes a backup readable by the client", async () => {
    const res = makeRes();
    await postWalletEnroll(
      makeReq({ stellar_address: ADDRESS, wrapped_key: WRAPPED_KEY }),
      res,
      next,
    );

    const error = next.mock.calls[0][0] as AppError;
    expect(error.statusCode).toBe(400);
    expect(error.message).toMatch(/wrap_algorithm/);
    expect(enrollClientGeneratedWallet).not.toHaveBeenCalled();
  });

  it("surfaces custody rejections from the service", async () => {
    (enrollClientGeneratedWallet as jest.Mock).mockRejectedValue(
      new AppError("Refusing to store unencrypted Stellar secret", 400),
    );
    const res = makeRes();
    await postWalletEnroll(
      makeReq({
        stellar_address: ADDRESS,
        wrapped_key: "raw",
        wrap_algorithm: "aes-256-gcm",
        wrap_kdf: "scrypt",
      }),
      res,
      next,
    );

    const error = next.mock.calls[0][0] as AppError;
    expect(error.message).toMatch(/unencrypted Stellar secret/);
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe("walletEnrollSchema", () => {
  it("accepts only the public address plus an opaque backup", () => {
    const parsed = walletEnrollSchema.parse({
      stellar_address: ADDRESS,
      wrapped_key: WRAPPED_KEY,
      wrap_algorithm: "aes-256-gcm",
      wrap_kdf: "scrypt",
    });
    expect(Object.keys(parsed).sort()).toEqual([
      "stellar_address",
      "wrap_algorithm",
      "wrap_kdf",
      "wrapped_key",
    ]);
  });

  it("has no field that could carry a private key", () => {
    const parsed = walletEnrollSchema.parse({
      stellar_address: ADDRESS,
      passphrase: Keypair.random().secret(),
      secret: Keypair.random().secret(),
      passcode: "hunter2hunter2",
    });
    expect(parsed).not.toHaveProperty("passphrase");
    expect(parsed).not.toHaveProperty("secret");
    expect(parsed).not.toHaveProperty("passcode");
  });
});
