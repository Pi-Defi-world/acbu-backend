import { Keypair } from "@stellar/stellar-sdk";
import {
  assertUserWalletAddress,
  enrollClientGeneratedWallet,
  getWalletEnrollmentStatus,
} from "./walletService";
import { prisma } from "../../config/database";
import { updateWalletWithConcurrency } from "./walletStateService";

jest.mock("../../config/database", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock("./walletStateService", () => ({
  updateWalletWithConcurrency: jest.fn(),
}));

const mockedFindUnique = prisma.user.findUnique as jest.Mock;
const mockedUpdateWallet = updateWalletWithConcurrency as jest.Mock;

describe("walletService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns the user wallet address when it matches the provided address", async () => {
    mockedFindUnique.mockResolvedValue({
      stellarAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    });
    const result = await assertUserWalletAddress(
      "user-1",
      "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    );
    expect(result).toBe("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");
    expect(mockedFindUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: { stellarAddress: true },
    });
  });

  it("throws 400 when the user has no wallet address", async () => {
    mockedFindUnique.mockResolvedValue({ stellarAddress: null });
    await expect(
      assertUserWalletAddress("user-2", "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"),
    ).rejects.toMatchObject({ statusCode: 400, message: "User wallet address not set" });
  });

  it("throws 403 when the provided address does not match the user's wallet", async () => {
    mockedFindUnique.mockResolvedValue({
      stellarAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    });
    await expect(
      assertUserWalletAddress("user-3", "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"),
    ).rejects.toMatchObject({ statusCode: 403, message: "Wallet address does not match user" });
  });
});

describe("getWalletEnrollmentStatus", () => {
  it("reports enrolled when the user has a public address bound", async () => {
    mockedFindUnique.mockResolvedValue({
      stellarAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    });
    await expect(getWalletEnrollmentStatus("user-1")).resolves.toEqual({
      enrolled: true,
      stellar_address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    });
  });

  it("reports enrollment required when no address is bound", async () => {
    mockedFindUnique.mockResolvedValue({ stellarAddress: null });
    await expect(getWalletEnrollmentStatus("user-2")).resolves.toEqual({
      enrolled: false,
      stellar_address: null,
    });
  });

  it("reports enrollment required for an unknown user", async () => {
    mockedFindUnique.mockResolvedValue(null);
    await expect(getWalletEnrollmentStatus("missing")).resolves.toEqual({
      enrolled: false,
      stellar_address: null,
    });
  });

  it("never reads or returns key material", async () => {
    mockedFindUnique.mockResolvedValue({ stellarAddress: null });
    await getWalletEnrollmentStatus("user-4");
    expect(mockedFindUnique).toHaveBeenCalledWith({
      where: { id: "user-4" },
      select: { stellarAddress: true },
    });
  });
});

describe("enrollClientGeneratedWallet", () => {
  const address = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
  const wrappedKey = Buffer.concat([
    Buffer.alloc(12, 7),
    Buffer.alloc(56, 9),
    Buffer.alloc(16, 3),
  ]).toString("base64");

  beforeEach(() => {
    jest.clearAllMocks();
    mockedUpdateWallet.mockResolvedValue(4);
  });

  it("binds the client-generated public key and its encrypted backup", async () => {
    mockedFindUnique.mockResolvedValue({ stellarAddress: null });
    const version = await enrollClientGeneratedWallet("user-1", "3", {
      stellarAddress: address,
      wrappedKey,
      wrapAlgorithm: "aes-256-gcm",
      wrapKdf: "scrypt:N=16384",
    });

    expect(version).toBe(4);
    expect(mockedUpdateWallet).toHaveBeenCalledWith("user-1", "3", {
      stellarAddress: address,
      encryptedStellarSecret: wrappedKey,
      keyEncryptionHint: "client_wrapped",
    });
  });

  it("stores no backup when the client keeps the key on-device only", async () => {
    mockedFindUnique.mockResolvedValue({ stellarAddress: null });
    await enrollClientGeneratedWallet("user-2", "3", { stellarAddress: address });

    expect(mockedUpdateWallet).toHaveBeenCalledWith("user-2", "3", {
      stellarAddress: address,
      encryptedStellarSecret: null,
      keyEncryptionHint: "external",
    });
  });

  it("is idempotent for the same address", async () => {
    mockedFindUnique.mockResolvedValue({ stellarAddress: address });
    await expect(
      enrollClientGeneratedWallet("user-3", "3", { stellarAddress: address }),
    ).resolves.toBe(4);
  });

  it("refuses to silently replace a different enrolled address", async () => {
    mockedFindUnique.mockResolvedValue({
      stellarAddress: Keypair.random().publicKey(),
    });
    await expect(
      enrollClientGeneratedWallet("user-4", "3", { stellarAddress: address }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("rejects an address that is not a valid Stellar public key", async () => {
    mockedFindUnique.mockResolvedValue({ stellarAddress: null });
    await expect(
      enrollClientGeneratedWallet("user-5", "3", { stellarAddress: "S".repeat(56) }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mockedUpdateWallet).not.toHaveBeenCalled();
  });

  it("rejects placeholder addresses", async () => {
    mockedFindUnique.mockResolvedValue({ stellarAddress: null });
    await expect(
      enrollClientGeneratedWallet("user-6", "3", { stellarAddress: `G${"A".repeat(55)}` }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("refuses raw key material as a backup", async () => {
    mockedFindUnique.mockResolvedValue({ stellarAddress: null });
    const seed = Keypair.random().secret();
    await expect(
      enrollClientGeneratedWallet("user-7", "3", {
        stellarAddress: address,
        wrappedKey: seed,
        wrapAlgorithm: "aes-256-gcm",
        wrapKdf: "scrypt",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mockedUpdateWallet).not.toHaveBeenCalled();
  });

  it("refuses base64-encoded raw key material as a backup", async () => {
    mockedFindUnique.mockResolvedValue({ stellarAddress: null });
    const seed = Keypair.random().secret();
    await expect(
      enrollClientGeneratedWallet("user-8", "3", {
        stellarAddress: address,
        wrappedKey: Buffer.from(seed, "utf8").toString("base64"),
        wrapAlgorithm: "aes-256-gcm",
        wrapKdf: "scrypt",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mockedUpdateWallet).not.toHaveBeenCalled();
  });
});
