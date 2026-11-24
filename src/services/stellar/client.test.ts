const mockFromSecret = jest.fn<any, [string]>();
const mockFromPublicKey = jest.fn<any, [string]>();
const mockRandom = jest.fn<any, []>();

jest.mock("@stellar/stellar-sdk", () => ({
  Keypair: {
    fromSecret: (s: string) => mockFromSecret(s),
    fromPublicKey: (s: string) => mockFromPublicKey(s),
    random: () => mockRandom(),
  },
  Horizon: { Server: jest.fn() },
  TransactionBuilder: jest.fn(),
  Operation: {},
  Transaction: jest.fn(),
  FeeBumpTransaction: jest.fn(),
}));

jest.mock("../../config/logger", () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

jest.mock("../../config/env", () => ({
  config: {
    stellar: {
      network: "testnet",
      horizonUrl: "https://horizon-testnet.stellar.org",
      networkPassphrase: "Test SDF Network ; September 2015",
      secretKey: "",
      sorobanRpcUrl: "https://soroban-testnet.stellar.org",
      nativeAssetCode: "XLM",
      activationStrategy: "create_account_native",
      bootstrapProfile: "",
      activationAmount: "1",
      baseFeeStroops: 100,
      useDynamicFees: false,
      treasuryAccountId: "",
    },
  },
}));

import { StellarClient } from "./client";
import { logger } from "../../config/logger";
import { config } from "../../config/env";

// Prefer an injected secret so CI/CD can supply a non-committed value.
// The fallback uses a synthetic placeholder (never a real Stellar seed).
const VALID_SECRET = process.env.TEST_STELLAR_SECRET_KEY ?? `S${"A".repeat(55)}`;

beforeEach(() => {
  jest.clearAllMocks();
  mockFromSecret.mockImplementation((secret: string) => {
    if (secret === VALID_SECRET) {
      return { publicKey: () => "GDZRKO6ZP4C5DQ4V6T6P6R4H7ZV7R56L5V6P6R4H7ZV7R56L5V6P6" };
    }
    throw new Error("Invalid seed");
  });
});

describe("StellarClient", () => {
  describe("constructor secret key validation", () => {
    it("uses an explicitly configured treasury account for operation validation", async () => {
      const treasuryAccountId = "GConfiguredTreasuryAccount";
      const client = new StellarClient({ treasuryAccountId });

      await expect(
        client.buildTransaction(treasuryAccountId, [
          { type: "accountMerge", destination: "GDestination" } as any,
        ]),
      ).rejects.toThrow("forbidden for the treasury account");
    });

    it("initializes keypair when secret key is valid", () => {
      const client = new StellarClient({ secretKey: VALID_SECRET });
      expect(client.getKeypair()).not.toBeNull();
      expect(mockFromSecret).toHaveBeenCalledWith(VALID_SECRET);
    });

    it("throws 'Invalid Stellar secret key' when secret key has wrong format (hex instead of base32)", () => {
      const hexKey = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6";
      expect(() => new StellarClient({ secretKey: hexKey })).toThrow("Invalid Stellar secret key");
      expect(logger.error).toHaveBeenCalledWith(
        "Failed to initialize Stellar keypair",
        expect.any(Object),
      );
    });

    it("throws 'Invalid Stellar secret key' when secret key has wrong length", () => {
      expect(() => new StellarClient({ secretKey: "too-short" })).toThrow(
        "Invalid Stellar secret key",
      );
      expect(logger.error).toHaveBeenCalledWith(
        "Failed to initialize Stellar keypair",
        expect.any(Object),
      );
    });

    it("does not initialize keypair when secret key is empty", () => {
      const client = new StellarClient({ secretKey: "" });
      expect(client.getKeypair()).toBeNull();
      expect(mockFromSecret).not.toHaveBeenCalled();
    });

    it("does not initialize keypair when secret key is not provided", () => {
      const client = new StellarClient({});
      expect(client.getKeypair()).toBeNull();
      expect(mockFromSecret).not.toHaveBeenCalled();
    });

    it("initializes keypair from config when no override provided and config has secretKey", () => {
      (config.stellar as any).secretKey = VALID_SECRET;
      const client = new StellarClient();
      expect(client.getKeypair()).not.toBeNull();
      expect(mockFromSecret).toHaveBeenCalledWith(VALID_SECRET);
      (config.stellar as any).secretKey = "";
    });
  });

  describe("external HSM / multi-sig signer support", () => {
    it("configures external signer without initializing an in-memory keypair", () => {
      const sign = jest.fn(async (tx: any) => tx);
      const client = new StellarClient({
        signer: {
          publicKey: "GEXTERNALHSMSIGNERACCOUNTID",
          sign,
        },
      });

      expect(client.getKeypair()).toBeNull();
      expect(mockFromSecret).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        "External Stellar transaction signer configured",
        expect.objectContaining({ publicKey: "GEXTERNALHSMSIGNERACCOUNTID" }),
      );
    });

    it("enforces treasury account operation restrictions using the external signer publicKey", async () => {
      const signerPublicKey = "GEXTERNALHSMSIGNERACCOUNTID";
      const client = new StellarClient({
        signer: {
          publicKey: signerPublicKey,
          sign: jest.fn(async (tx: any) => tx),
        },
      });

      await expect(
        client.buildTransaction(signerPublicKey, [
          { type: "accountMerge", destination: "GDestination" } as any,
        ]),
      ).rejects.toThrow("forbidden for the treasury account");
    });
  });
});
