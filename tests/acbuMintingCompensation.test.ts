import { MintingService } from "../src/services/contracts/acbuMinting.service";
import { contractClient } from "../src/services/stellar/contractClient";
import { stellarClient } from "../src/services/stellar/client";
import { prisma } from "../src/config/database";
import type { TransactionStatus } from "../src/utils/transactionStateMachine";

jest.mock("../src/services/stellar/contractClient", () => ({
  contractClient: { invokeContract: jest.fn() },
  ContractClient: { toScVal: jest.fn(), fromScVal: jest.fn(), bigIntToI128: jest.fn() },
}));

jest.mock("../src/services/stellar/client", () => ({
  stellarClient: { getKeypair: jest.fn(() => ({ publicKey: () => "test-pub-key" })) },
}));

jest.mock("../src/config/database", () => ({
  prisma: {
    transaction: { update: jest.fn() },
  },
}));

jest.mock("../src/config/logger", () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

const VALID_STATUSES: readonly string[] = ["pending", "processing", "completed", "failed"];

describe("MintingService Compensation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("marks tx failed if stellar throws", async () => {
    const service = new MintingService("contract-id");
    (contractClient.invokeContract as jest.Mock).mockRejectedValue(new Error("Stellar Fail"));

    await expect(
      service.mintFromUsdc({
        user: "user",
        usdcAmount: "100",
        recipient: "rec",
        txId: "123",
      } as any),
    ).rejects.toThrow("Stellar Fail");

    expect(prisma.transaction.update).toHaveBeenCalledWith({
      where: { id: "123" },
      data: { status: "failed" },
    });
  });

  it("writes a status that is valid for the transaction state machine", async () => {
    const service = new MintingService("contract-id");
    (contractClient.invokeContract as jest.Mock).mockRejectedValue(new Error("Stellar Fail"));

    await expect(
      service.mintFromUsdc({
        user: "user",
        usdcAmount: "100",
        recipient: "rec",
        txId: "123",
      } as any),
    ).rejects.toThrow("Stellar Fail");

    const updateArgs = (prisma.transaction.update as jest.Mock).mock.calls[0][0];
    const status = updateArgs.data.status as TransactionStatus;

    expect(VALID_STATUSES).toContain(status);
    expect(status).toBe(status.toLowerCase());
  });

  it("does not touch the database when no txId is provided", async () => {
    const service = new MintingService("contract-id");
    (contractClient.invokeContract as jest.Mock).mockRejectedValue(new Error("Stellar Fail"));

    await expect(
      service.mintFromUsdc({
        user: "user",
        usdcAmount: "100",
        recipient: "rec",
      } as any),
    ).rejects.toThrow("Stellar Fail");

    expect(prisma.transaction.update).not.toHaveBeenCalled();
  });

  describe("every mint path compensates through the typed params", () => {
    const mintPaths: {
      name: string;
      invoke: (service: MintingService) => Promise<unknown>;
    }[] = [
      {
        name: "mintFromUsdc",
        invoke: (service) =>
          service.mintFromUsdc({
            user: "user",
            usdcAmount: "100",
            recipient: "rec",
            txId: "123",
          }),
      },
      {
        name: "mintFromBasket",
        invoke: (service) =>
          service.mintFromBasket({
            user: "user",
            recipient: "rec",
            acbuAmount: "100",
            txId: "123",
          }),
      },
      {
        name: "mintFromSingle",
        invoke: (service) =>
          service.mintFromSingle({
            user: "user",
            recipient: "rec",
            currency: "NGN",
            sTokenAmount: "100",
            txId: "123",
          }),
      },
      {
        name: "mintFromDemoFiat",
        invoke: (service) =>
          service.mintFromDemoFiat({
            operator: "operator",
            recipient: "rec",
            currency: "NGN",
            fiatAmount: "100",
            txId: "123",
          }),
      },
      {
        name: "adminDripDemoFiat",
        invoke: (service) =>
          service.adminDripDemoFiat({
            recipient: "rec",
            currency: "NGN",
            amount: "100",
            txId: "123",
          }),
      },
    ];

    for (const { name, invoke } of mintPaths) {
      it(`compensates ${name}`, async () => {
        const service = new MintingService("contract-id");
        (contractClient.invokeContract as jest.Mock).mockRejectedValue(new Error("Stellar Fail"));

        await expect(invoke(service)).rejects.toThrow();

        expect(prisma.transaction.update).toHaveBeenCalledWith({
          where: { id: "123" },
          data: { status: "failed" },
        });
      });
    }
  });
});
