import { SavingsVaultService } from "./acbuSavingsVault.service";
import { ContractClient, contractClient } from "../stellar/contractClient";
import { stellarClient } from "../stellar/client";

jest.mock("../stellar/contractClient", () => ({
  contractClient: { invokeContract: jest.fn() },
  ContractClient: { toScVal: jest.fn((value) => value), fromScVal: jest.fn() },
}));

jest.mock("../stellar/client", () => ({
  stellarClient: { getKeypair: jest.fn(() => ({ publicKey: () => "test-pub-key" })) },
}));

describe("SavingsVaultService contract amounts", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("passes large deposit amounts to Soroban as exact BigInts", async () => {
    (contractClient.invokeContract as jest.Mock).mockResolvedValue({
      transactionHash: "tx-hash",
      result: "new-balance",
    });
    (ContractClient.fromScVal as jest.Mock).mockReturnValue(1n);

    const service = new SavingsVaultService("contract-id");
    await service.deposit({
      user: "user",
      amount: "9007199254740993",
      termSeconds: 86400,
    });

    expect(ContractClient.toScVal).toHaveBeenNthCalledWith(2, 9007199254740993n);
    expect(contractClient.invokeContract).toHaveBeenCalledTimes(1);
  });

  it("rejects fractional and out-of-range amounts before invoking the contract", async () => {
    const service = new SavingsVaultService("contract-id");

    await expect(
      service.deposit({ user: "user", amount: "1.5", termSeconds: 86400 }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      service.withdraw({
        user: "user",
        amount: "170141183460469231731687303715884105728",
        termSeconds: 86400,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(contractClient.invokeContract).not.toHaveBeenCalled();
  });
});
