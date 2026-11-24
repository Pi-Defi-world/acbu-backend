import { ZkVerifierService } from "../acbuZkVerifier.service";
import type { SubmitProofParams } from "../acbuZkVerifier.service";

/**
 * Unit tests for ZkVerifierService — W11-CAR-019
 *
 * These tests verify that `submitProof` serialises exactly two contract
 * arguments (`proof`, `public_inputs`) and NOT the erroneous three-argument
 * form (`user`, `proof`, `public_inputs`) that caused Soroban VM argument
 * deserialization failure (SC#1017 / W10-Z-003).
 */

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock("../../../config/env", () => ({
  config: {
    stellar: {
      network: "testnet",
    },
  },
}));

const mockInvokeContract = jest.fn();
const mockReadContract = jest.fn();

jest.mock("../../stellar/contractClient", () => {
  const { ContractClient: RealContractClient } = jest.requireActual(
    "../../stellar/contractClient",
  );
  return {
    ContractClient: RealContractClient,
    contractClient: {
      invokeContract: (...args: unknown[]) => mockInvokeContract(...args),
      readContract: (...args: unknown[]) => mockReadContract(...args),
    },
  };
});

jest.mock("../../stellar/client", () => ({
  stellarClient: {
    getKeypair: () => ({
      publicKey: () => "GDHO63RZEUNDRVF6WA7HD4D7PLNLUMSK5H74ONW3MEF3VKF4BZJ6GDML",
    }),
    getNetworkPassphrase: () => "Test SDF Network ; September 2015",
    getSorobanRpcUrl: () => "https://soroban-testnet.stellar.org",
  },
}));

jest.mock("../../../config/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const FAKE_CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("ZkVerifierService", () => {
  let service: ZkVerifierService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ZkVerifierService(FAKE_CONTRACT_ID);
  });

  describe("submitProof", () => {
    it("passes exactly two arguments (proof, publicInputs) — not three", async () => {
      // Arrange: mock a successful contract invocation
      const { xdr } = jest.requireActual("@stellar/stellar-sdk");
      mockInvokeContract.mockResolvedValueOnce({
        transactionHash: "abc123",
        result: xdr.ScVal.scvVec([xdr.ScVal.scvBool(true), xdr.ScVal.scvU32(1)]),
        ledger: 42,
      });

      const params: SubmitProofParams = {
        proof: new Uint8Array([1, 2, 3]),
        publicInputs: new Uint8Array([4, 5, 6]),
      };

      // Act
      await service.submitProof(params);

      // Assert: invokeContract was called once
      expect(mockInvokeContract).toHaveBeenCalledTimes(1);

      const callArgs = mockInvokeContract.mock.calls[0][0];

      // The function name must be "submit_proof"
      expect(callArgs.functionName).toBe("submit_proof");

      // The contract ID must be passed through
      expect(callArgs.contractId).toBe(FAKE_CONTRACT_ID);

      // ----------------------------------------------------------------
      // CRITICAL ASSERTION (W11-CAR-019):
      // The args array must contain exactly 2 elements (proof, public_inputs),
      // NOT 3 (user, proof, public_inputs).
      // ----------------------------------------------------------------
      expect(callArgs.args).toHaveLength(2);
    });

    it("returns verified=true and policyVersion from contract result", async () => {
      const { xdr } = jest.requireActual("@stellar/stellar-sdk");
      mockInvokeContract.mockResolvedValueOnce({
        transactionHash: "tx-hash-ok",
        result: xdr.ScVal.scvVec([xdr.ScVal.scvBool(true), xdr.ScVal.scvU32(7)]),
        ledger: 100,
      });

      const result = await service.submitProof({
        proof: new Uint8Array([10, 20]),
        publicInputs: new Uint8Array([30, 40]),
      });

      expect(result.transactionHash).toBe("tx-hash-ok");
      expect(result.verified).toBe(true);
      expect(result.policyVersion).toBe(7);
    });

    it("returns verified=false when proof is invalid", async () => {
      const { xdr } = jest.requireActual("@stellar/stellar-sdk");
      mockInvokeContract.mockResolvedValueOnce({
        transactionHash: "tx-hash-fail",
        result: xdr.ScVal.scvVec([xdr.ScVal.scvBool(false), xdr.ScVal.scvU32(3)]),
        ledger: 101,
      });

      const result = await service.submitProof({
        proof: new Uint8Array([0]),
        publicInputs: new Uint8Array([0]),
      });

      expect(result.verified).toBe(false);
      expect(result.policyVersion).toBe(3);
    });

    it("throws when no source account is available", async () => {
      // Override the mock to return no keypair
      const clientMod = jest.requireMock("../../stellar/client");
      const originalGetKeypair = clientMod.stellarClient.getKeypair;
      clientMod.stellarClient.getKeypair = () => null;

      await expect(
        service.submitProof({
          proof: new Uint8Array([1]),
          publicInputs: new Uint8Array([2]),
        }),
      ).rejects.toThrow("No source account available");

      // Restore
      clientMod.stellarClient.getKeypair = originalGetKeypair;
    });

    it("propagates contract invocation errors", async () => {
      mockInvokeContract.mockRejectedValueOnce(new Error("Simulation error: host function failure"));

      await expect(
        service.submitProof({
          proof: new Uint8Array([1]),
          publicInputs: new Uint8Array([2]),
        }),
      ).rejects.toThrow("Simulation error: host function failure");
    });
  });

  describe("getPolicyVersion", () => {
    it("reads policy version from contract", async () => {
      const { xdr } = jest.requireActual("@stellar/stellar-sdk");
      mockReadContract.mockResolvedValueOnce(xdr.ScVal.scvU32(5));

      const version = await service.getPolicyVersion();

      expect(version).toBe(5);
      expect(mockReadContract).toHaveBeenCalledWith(
        FAKE_CONTRACT_ID,
        "get_policy_version",
        [],
      );
    });
  });

  describe("getRevocationRoot", () => {
    it("reads revocation root from contract", async () => {
      const { xdr } = jest.requireActual("@stellar/stellar-sdk");
      mockReadContract.mockResolvedValueOnce(
        xdr.ScVal.scvString("abcdef1234567890"),
      );

      const root = await service.getRevocationRoot();

      expect(root).toBe("abcdef1234567890");
      expect(mockReadContract).toHaveBeenCalledWith(
        FAKE_CONTRACT_ID,
        "get_revocation_root",
        [],
      );
    });
  });
});
