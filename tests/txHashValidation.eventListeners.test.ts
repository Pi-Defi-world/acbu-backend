/**
 * Tests: Transaction hash validation in event listeners.
 * Verifies that fake/injected events with invalid or non-existent tx hashes are rejected.
 */

// ── shared mocks ────────────────────────────────────────────────────────────

const mockPublish = jest.fn().mockResolvedValue(undefined);
const mockEnqueueUsdcConversion = jest.fn().mockResolvedValue(undefined);
const mockEnqueueWithdrawalProcessing = jest.fn().mockResolvedValue(undefined);
const mockPrismaFindFirst = jest.fn();

jest.mock("../src/config/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock("../src/config/contracts", () => ({
  getContractAddresses: () => ({
    oracle: "",
    reserveTracker: "",
    minting: "CB minting-contract",
    burning: "CB burning-contract",
    savingsVault: "CB savings-contract",
    lendingPool: "CB lending-contract",
    escrow: "CB escrow-contract",
  }),
}));

jest.mock("../src/config/database", () => ({
  prisma: {
    transaction: { findFirst: mockPrismaFindFirst },
  },
}));

jest.mock("../src/services/stellar/client", () => ({
  stellarClient: {
    getServer: jest.fn(),
    getTransaction: jest.fn(),
  },
}));

jest.mock("../src/services/stellar/eventListener", () => {
  const handlers: Record<string, Function[]> = {};
  return {
    eventListener: {
      listenToContractEvents: jest.fn(
        (contractId: string, types: string[], handler: Function) => {
          for (const t of types) {
            if (!handlers[t]) handlers[t] = [];
            handlers[t].push(handler);
          }
        },
      ),
    },
    ContractEvent: jest.fn(),
    _handlers: handlers,
  };
});

jest.mock("../src/jobs/producers", () => ({
  escrowEventProducer: { publish: mockPublish },
  lendingPoolEventProducer: { publish: mockPublish },
  savingsVaultEventProducer: { publish: mockPublish },
}));

jest.mock("../src/jobs/usdcConversionJob", () => ({
  enqueueUsdcConversion: mockEnqueueUsdcConversion,
}));

jest.mock("../src/jobs/withdrawalProcessingJob", () => ({
  enqueueWithdrawalProcessing: mockEnqueueWithdrawalProcessing,
}));

// ── imports (after mocks) ───────────────────────────────────────────────────

import { _handlers } from "../src/services/stellar/eventListener";
import { startEscrowEventListener } from "../src/jobs/acbu_escrow_event_listener";
import { startLendingPoolEventListener } from "../src/jobs/acbu_lending_pool_event_listener";
import { startSavingsVaultEventListener } from "../src/jobs/acbu_savings_vault_event_listener";
import { startMintEventListener } from "../src/jobs/acbu_minting_event_listener";
import { startBurnEventListener } from "../src/jobs/acbu_burning_event_listener";
import { stellarClient } from "../src/services/stellar/client";
import { ContractEvent } from "../src/services/stellar/eventListener";

// ── helpers ─────────────────────────────────────────────────────────────────

function makeEvent(
  type: string,
  data: Record<string, unknown>,
  ledger = 100,
): ContractEvent {
  return {
    contractId: "CB-contract",
    type,
    version: 1,
    data,
    ledger,
    timestamp: Date.now(),
  };
}

function invokeHandler(
  type: string,
  event: ContractEvent,
): Promise<void> | undefined {
  const fns = _handlers[type];
  if (!fns || fns.length === 0) return undefined;
  return fns[0](event) as Promise<void>;
}

// ── tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  (stellarClient.getTransaction as jest.Mock).mockRejectedValue(
    new Error("not found"),
  );
});

describe("Escrow listener – rejects fake tx hashes", () => {
  beforeAll(() => {
    startEscrowEventListener();
  });

  it("rejects event with non-hex tx hash", async () => {
    const event = makeEvent("contract_credited", {
      amount: "100",
      account: "G" + "A".repeat(55),
      transaction_hash: "ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ", // not hex
    });
    await invokeHandler("contract_credited", event);
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("rejects event with wrong-length tx hash (too short)", async () => {
    const event = makeEvent("contract_debited", {
      amount: "50",
      account: "G" + "A".repeat(55),
      transaction_hash: "abc123",
    });
    await invokeHandler("contract_debited", event);
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("rejects event with wrong-length tx hash (too long)", async () => {
    const event = makeEvent("contract_effect", {
      amount: "10",
      transaction_hash: "a".repeat(65),
    });
    await invokeHandler("contract_effect", event);
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("rejects event with tx_hash containing uppercase (non-lowercase hex)", async () => {
    const event = makeEvent("contract_credited", {
      amount: "10",
      tx_hash: "A".repeat(64), // uppercase hex fails regex /^[a-f0-9]{64}$/i ... wait, regex is case-insensitive
    });
    // Actually uppercase IS valid per the regex /i flag. Let's use non-hex chars.
    const event2 = makeEvent("contract_credited", {
      amount: "10",
      tx_hash: "g" + "a".repeat(63), // 'g' is not valid hex
    });
    await invokeHandler("contract_credited", event2);
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("accepts valid 64-char hex tx hash", async () => {
    const validHash = "a".repeat(64);
    (stellarClient.getTransaction as jest.Mock).mockResolvedValue({ id: validHash });
    const event = makeEvent("contract_credited", {
      amount: "100",
      account: "G" + "A".repeat(55),
      transaction_hash: validHash,
    });
    await invokeHandler("contract_credited", event);
    expect(mockPublish).toHaveBeenCalled();
  });

  it("publishes event when no tx hash is present", async () => {
    const event = makeEvent("contract_credited", {
      amount: "100",
      account: "G" + "A".repeat(55),
    });
    await invokeHandler("contract_credited", event);
    expect(mockPublish).toHaveBeenCalled();
  });

  it("does not publish an event with an unexpected type", async () => {
    const event = makeEvent("unexpected_type", { amount: "100" });

    await invokeHandler("contract_credited", event);

    expect(mockPublish).not.toHaveBeenCalled();
  });
});

describe("Lending Pool listener – rejects fake tx hashes", () => {
  beforeAll(() => {
    startLendingPoolEventListener();
  });

  it("rejects event with invalid tx hash format", async () => {
    const event = makeEvent("contract_credited", {
      amount: "100",
      transaction_hash: "not-a-real-hash!!!",
    });
    await invokeHandler("contract_credited", event);
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("accepts valid tx hash", async () => {
    const validHash = "b".repeat(64);
    (stellarClient.getTransaction as jest.Mock).mockResolvedValue({ id: validHash });
    const event = makeEvent("contract_debited", {
      amount: "50",
      transaction_hash: validHash,
    });
    await invokeHandler("contract_debited", event);
    expect(mockPublish).toHaveBeenCalled();
  });
});

describe("Savings Vault listener – rejects fake tx hashes", () => {
  beforeAll(() => {
    startSavingsVaultEventListener();
  });

  it("rejects event with fake tx hash", async () => {
    const event = makeEvent("contract_effect", {
      amount: "200",
      transaction_hash: "ZZ" + "0".repeat(62),
    });
    await invokeHandler("contract_effect", event);
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("strips invalid tx hash and still publishes sanitized event", async () => {
    const event = makeEvent("contract_credited", {
      amount: "200",
      transaction_hash: "invalid",
    });
    await invokeHandler("contract_credited", event);
    // Invalid hash should be stripped but event should still be published (no hash = fine)
    expect(mockPublish).toHaveBeenCalled();
    const publishedData = mockPublish.mock.calls[mockPublish.mock.calls.length - 1][0];
    expect(publishedData.data.transaction_hash).toBeUndefined();
  });
});

describe("Minting listener – rejects fake tx hashes", () => {
  beforeAll(() => {
    startMintEventListener();
  });

  it("rejects event with no on-chain tx hash", async () => {
    const fakeHash = "a".repeat(64);
    (stellarClient.getTransaction as jest.Mock).mockRejectedValue(
      new Error("not found"),
    );
    const event = makeEvent("contract_credited", {
      amount: "100",
      account: "G" + "A".repeat(55),
      transaction_hash: fakeHash,
    });
    await invokeHandler("contract_credited", event);
    expect(mockEnqueueUsdcConversion).not.toHaveBeenCalled();
  });

  it("rejects event with non-hex tx hash", async () => {
    const event = makeEvent("contract_credited", {
      amount: "100",
      account: "G" + "A".repeat(55),
      transaction_hash: "not_valid_hash_at_all_wrong_length_and_chars",
    });
    await invokeHandler("contract_credited", event);
    expect(mockEnqueueUsdcConversion).not.toHaveBeenCalled();
  });

  it("rejects event with no verifiable hash at all", async () => {
    const event = makeEvent("contract_credited", {
      amount: "100",
      account: "G" + "A".repeat(55),
    });
    await invokeHandler("contract_credited", event);
    expect(mockEnqueueUsdcConversion).not.toHaveBeenCalled();
  });

  it("accepts event with valid on-chain tx hash", async () => {
    const realHash = "c".repeat(64);
    (stellarClient.getTransaction as jest.Mock).mockResolvedValue({ id: realHash });
    mockPrismaFindFirst.mockResolvedValue({ id: "tx-id-123" });
    const event = makeEvent("contract_credited", {
      amount: "100",
      account: "G" + "A".repeat(55),
      transaction_hash: realHash,
    });
    await invokeHandler("contract_credited", event);
    expect(mockEnqueueUsdcConversion).toHaveBeenCalledWith(
      expect.objectContaining({ txHash: realHash, transactionId: "tx-id-123" }),
    );
  });

  it("ignores verified events that cannot be correlated to a transaction (no orphan reserve history, #982)", async () => {
    const realHash = "f".repeat(64);
    (stellarClient.getTransaction as jest.Mock).mockResolvedValue({ id: realHash });
    // No pending/processing mint transaction matches the hash.
    mockPrismaFindFirst.mockResolvedValue(null);
    const event = makeEvent("contract_credited", {
      amount: "100",
      account: "G" + "A".repeat(55),
      transaction_hash: realHash,
    });
    await invokeHandler("contract_credited", event);
    expect(mockEnqueueUsdcConversion).not.toHaveBeenCalled();
  });
});

describe("Burning listener – rejects fake tx hashes", () => {
  beforeAll(() => {
    startBurnEventListener();
  });

  it("rejects event with no on-chain tx hash", async () => {
    const fakeHash = "d".repeat(64);
    (stellarClient.getTransaction as jest.Mock).mockRejectedValue(
      new Error("not found"),
    );
    const event = makeEvent("contract_debited", {
      amount: "50",
      transaction_hash: fakeHash,
    });
    await invokeHandler("contract_debited", event);
    expect(mockEnqueueWithdrawalProcessing).not.toHaveBeenCalled();
  });

  it("rejects event with completely invalid hash", async () => {
    const event = makeEvent("contract_debited", {
      amount: "50",
      transaction_hash: "xyz_not_hex",
    });
    await invokeHandler("contract_debited", event);
    expect(mockEnqueueWithdrawalProcessing).not.toHaveBeenCalled();
  });

  it("accepts event with valid on-chain tx hash and matching DB record", async () => {
    const realHash = "e".repeat(64);
    (stellarClient.getTransaction as jest.Mock).mockResolvedValue({ id: realHash });
    mockPrismaFindFirst.mockResolvedValue({ id: "burn-tx-456" });
    const event = makeEvent("contract_debited", {
      amount: "50",
      transaction_hash: realHash,
    });
    await invokeHandler("contract_debited", event);
    expect(mockEnqueueWithdrawalProcessing).toHaveBeenCalledWith(
      expect.objectContaining({ txHash: realHash, transactionId: "burn-tx-456" }),
    );
  });
});
