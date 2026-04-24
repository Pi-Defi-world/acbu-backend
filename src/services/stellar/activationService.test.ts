const mockLoadAccount = jest.fn();
const mockSubmitTransaction = jest.fn();
const mockCreateAccount = jest.fn();
const mockSign = jest.fn();
const mockAddOperation = jest.fn();
const mockSetTimeout = jest.fn();
const mockBuild = jest.fn();
const mockFromSecret = jest.fn();
const mockGetBaseFee = jest.fn();

const mockTx = {
  sign: mockSign,
};

const mockBuilder = {
  addOperation: mockAddOperation,
  setTimeout: mockSetTimeout,
  build: mockBuild,
};

mockAddOperation.mockReturnValue(mockBuilder);
mockSetTimeout.mockReturnValue(mockBuilder);
mockBuild.mockReturnValue(mockTx);
mockFromSecret.mockImplementation((secret: string) => ({
  secret: () => secret,
}));

jest.mock("@stellar/stellar-sdk", () => ({
  Keypair: {
    fromSecret: mockFromSecret,
  },
  Operation: {
    createAccount: mockCreateAccount,
  },
  TransactionBuilder: jest.fn(() => mockBuilder),
}));

jest.mock("./client", () => ({
  stellarClient: {
    getServer: () => ({
      loadAccount: mockLoadAccount,
      submitTransaction: mockSubmitTransaction,
    }),
    getKeypair: () => ({
      publicKey: () => "G_BACKEND",
      secret: () => "S_BACKEND",
    }),
    getNetworkPassphrase: () => "Test SDF Network ; September 2015",
  },
}));

jest.mock("./feeManager", () => ({
  getBaseFee: (...args: unknown[]) => mockGetBaseFee(...args),
}));

jest.mock("../../config/env", () => ({
  config: {
    stellar: {
      nativeAssetCode: "PI",
      activationAmount: "5",
      activationStrategy: "create_account_native",
      bootstrapProfile: "pi-testnet",
    },
  },
}));

import { config } from "../../config/env";
import { ensureAccountActivated } from "./activationService";

describe("ensureAccountActivated", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (config.stellar as any).nativeAssetCode = "PI";
    (config.stellar as any).activationAmount = "5";
    (config.stellar as any).activationStrategy = "create_account_native";
    (config.stellar as any).bootstrapProfile = "pi-testnet";
    mockAddOperation.mockReturnValue(mockBuilder);
    mockSetTimeout.mockReturnValue(mockBuilder);
    mockBuild.mockReturnValue(mockTx);
    mockGetBaseFee.mockResolvedValue("100");
    mockSubmitTransaction.mockResolvedValue({ hash: "tx-hash-1" });
  });

  it("returns the configured bootstrap asset metadata when the account already exists", async () => {
    mockLoadAccount.mockResolvedValueOnce({ id: "existing-account" });

    await expect(ensureAccountActivated("G_DEST")).resolves.toEqual({
      created: false,
      fundingAssetCode: "PI",
      startingBalance: "5",
      strategy: "create_account_native",
      bootstrapProfile: "pi-testnet",
    });
    expect(mockCreateAccount).not.toHaveBeenCalled();
  });

  it("creates the account with the configured activation amount and reports the configured asset code", async () => {
    mockLoadAccount
      .mockRejectedValueOnce({ response: { status: 404 } })
      .mockResolvedValueOnce({ id: "source-account" });
    mockCreateAccount.mockReturnValue({ type: "create-account-op" });

    const result = await ensureAccountActivated("G_DEST");

    expect(mockCreateAccount).toHaveBeenCalledWith({
      destination: "G_DEST",
      startingBalance: "5",
    });
    expect(result).toEqual({
      created: true,
      txHash: "tx-hash-1",
      fundingAssetCode: "PI",
      startingBalance: "5",
      strategy: "create_account_native",
      bootstrapProfile: "pi-testnet",
    });
    expect(mockSign).toHaveBeenCalledTimes(1);
  });

  it("honors the activation strategy feature flag when auto-activation is disabled", async () => {
    (config.stellar as any).activationStrategy = "disabled";
    mockLoadAccount.mockRejectedValueOnce({ response: { status: 404 } });

    await expect(ensureAccountActivated("G_DEST")).rejects.toThrow(
      "Wallet activation is disabled for bootstrap asset PI",
    );
    expect(mockCreateAccount).not.toHaveBeenCalled();
  });
});
