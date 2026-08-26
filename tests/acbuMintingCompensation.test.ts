import { MintingService } from "../src/services/contracts/acbuMinting.service";
import { contractClient } from "../src/services/stellar/contractClient";
import { prisma } from "../src/config/database";

jest.mock("../src/services/stellar/contractClient", () => ({
  contractClient: { invokeContract: jest.fn() },
  ContractClient: { toScVal: jest.fn(), fromScVal: jest.fn() },
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

describe("MintingService Compensation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("marks tx FAILED if stellar throws", async () => {
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
      data: { status: "FAILED" },
    });
  });
});
