import { Keypair } from "@stellar/stellar-sdk";
import { BurningService } from "../src/services/contracts/acbuBurning.service";
import { contractClient } from "../src/services/stellar/contractClient";

jest.mock("../src/services/stellar/contractClient", () => ({
  contractClient: { invokeContract: jest.fn() },
  ContractClient: {
    toScVal: jest.fn((value) => value),
    fromScVal: jest.fn(() => "500"),
  },
}));

jest.mock("../src/services/stellar/client", () => ({
  stellarClient: { getKeypair: jest.fn(() => ({ publicKey: () => "test-pub-key" })) },
}));

jest.mock("../src/config/logger", () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

describe("BurningService recipient validation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects a contract address as a redeem recipient", async () => {
    const service = new BurningService("burning-contract");

    await expect(
      service.redeemSingle({
        user: "G" + "A".repeat(55),
        recipient: "C" + "A".repeat(55),
        acbuAmount: "100",
        currency: "NGN",
        idempotencyKey: "burn-1",
      }),
    ).rejects.toThrow("Invalid recipient account");

    expect(contractClient.invokeContract).not.toHaveBeenCalled();
  });

  it("allows a valid Stellar account as a redeem recipient", async () => {
    const recipient = Keypair.random().publicKey();
    (contractClient.invokeContract as jest.Mock).mockResolvedValue({
      transactionHash: "tx-1",
      result: "result",
    });
    const service = new BurningService("burning-contract");

    await expect(
      service.redeemSingle({
        user: Keypair.random().publicKey(),
        recipient,
        acbuAmount: "100",
        currency: "NGN",
        idempotencyKey: "burn-2",
      }),
    ).resolves.toEqual({
      transactionHash: "tx-1",
      localAmount: "500",
    });
  });

  it("rejects a contract address for basket redemption", async () => {
    const service = new BurningService("burning-contract");

    await expect(
      service.redeemBasket({
        user: "G" + "A".repeat(55),
        recipient: "C" + "A".repeat(55),
        acbuAmount: "100",
        idempotencyKey: "burn-basket-1",
      }),
    ).rejects.toThrow("Invalid recipient account");

    expect(contractClient.invokeContract).not.toHaveBeenCalled();
  });
});
