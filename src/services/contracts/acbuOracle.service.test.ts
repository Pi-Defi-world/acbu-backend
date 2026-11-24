import { Keypair } from "@stellar/stellar-sdk";

jest.mock("../../config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("../stellar/client", () => ({
  stellarClient: { getKeypair: jest.fn() },
}));

jest.mock("../stellar/contractClient", () => {
  return {
    ContractClient: {
      toScVal: jest.fn((value: unknown) => ({ kind: "scval", value })),
      bigIntToI128: jest.fn((value: bigint) => ({ kind: "i128", value })),
      fromScVal: jest.fn((scVal: { value: unknown }) => scVal.value),
    },
    contractClient: {
      readContract: jest.fn(),
      invokeContract: jest.fn(),
    },
  };
});

import { stellarClient } from "../stellar/client";
import { contractClient } from "../stellar/contractClient";
import { OracleService } from "./acbuOracle.service";

describe("OracleService.updateRate", () => {
  const validatorKeys = Array.from({ length: 5 }, () => Keypair.random().publicKey());
  const service = new OracleService("oracle-contract");
  const readContract = contractClient.readContract as jest.Mock;
  const invokeContract = contractClient.invokeContract as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    (stellarClient.getKeypair as jest.Mock).mockReturnValue({
      publicKey: () => validatorKeys[0],
    });
    readContract.mockImplementation((_contractId: string, method: string) => {
      if (method === "get_validators") {
        return Promise.resolve({ value: validatorKeys });
      }
      if (method === "get_min_signatures") {
        return Promise.resolve({ value: 3 });
      }
      throw new Error(`Unexpected contract read: ${method}`);
    });
    invokeContract.mockResolvedValue({ transactionHash: "tx-hash" });
  });

  it("submits a single validator rate through update_rate with the contract's typed arguments", async () => {
    await expect(
      service.updateRate({
        validator: validatorKeys[0],
        currency: "NGN",
        rate: "1230000000",
        sources: ["1220000000", "1230000000", "1240000000"],
        timestamp: 1_800_000_000,
      }),
    ).resolves.toBe("tx-hash");

    expect(invokeContract).toHaveBeenCalledTimes(1);
    const invocation = invokeContract.mock.calls[0][0];
    expect(invocation.functionName).toBe("update_rate");
    expect(invocation.sourceAccount).toBe(validatorKeys[0]);
    expect(invocation.args).toHaveLength(5);
    expect(invocation.args[0]).toEqual({ kind: "scval", value: validatorKeys[0] });
    expect(invocation.args[1]).toEqual({ kind: "scval", value: [["NGN"]] });
    expect(invocation.args[2]).toEqual({ kind: "i128", value: BigInt("1230000000") });
    expect(invocation.args[3]).toEqual({
      kind: "scval",
      value: [BigInt("1220000000"), BigInt("1230000000"), BigInt("1240000000")],
    });
    expect(invocation.args[4].u64().toBigInt()).toBe(BigInt("1800000000"));
  });

  it("refuses to submit when the configured contract does not enforce a 3-of-5 quorum", async () => {
    readContract.mockImplementation((_contractId: string, method: string) => {
      if (method === "get_validators") {
        return Promise.resolve({ value: validatorKeys });
      }
      return Promise.resolve({ value: 1 });
    });

    await expect(
      service.updateRate({
        validator: validatorKeys[0],
        currency: "NGN",
        rate: "1230000000",
        sources: ["1220000000", "1230000000", "1240000000"],
        timestamp: 1_800_000_000,
      }),
    ).rejects.toThrow("must enforce a 3-of-5 minimum validator quorum");

    expect(invokeContract).not.toHaveBeenCalled();
  });

  it("does not count duplicate validator entries toward the quorum", async () => {
    readContract.mockImplementation((_contractId: string, method: string) => {
      if (method === "get_validators") {
        return Promise.resolve({
          value: [...validatorKeys.slice(0, 4), validatorKeys[3]],
        });
      }
      return Promise.resolve({ value: 3 });
    });

    await expect(
      service.updateRate({
        validator: validatorKeys[0],
        currency: "NGN",
        rate: "1230000000",
        sources: ["1220000000", "1230000000", "1240000000"],
        timestamp: 1_800_000_000,
      }),
    ).rejects.toThrow("must enforce a 3-of-5 minimum validator quorum");

    expect(invokeContract).not.toHaveBeenCalled();
  });

  it("refuses a submission that claims a different validator than its signer", async () => {
    await expect(
      service.updateRate({
        validator: validatorKeys[1],
        currency: "NGN",
        rate: "1230000000",
        sources: ["1220000000", "1230000000", "1240000000"],
        timestamp: 1_800_000_000,
      }),
    ).rejects.toThrow("must match the validator address");

    expect(readContract).not.toHaveBeenCalled();
    expect(invokeContract).not.toHaveBeenCalled();
  });
});
