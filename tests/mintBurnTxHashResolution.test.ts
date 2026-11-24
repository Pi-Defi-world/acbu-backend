/**
 * Mint and burn event → transaction correlation.
 *
 * Each listener's own registration is captured as it happens, so a case can
 * only ever drive the listener it names — the existing suite addresses handlers
 * through a registry keyed by effect type alone, and all five contract
 * listeners register for the same three types.
 */

type ContractEventHandler = (event: {
  contractId: string;
  type: string;
  version: number;
  data: Record<string, unknown>;
  ledger: number;
  timestamp: number;
}) => Promise<void>;

const mockEnqueueUsdcConversion = jest.fn().mockResolvedValue(undefined);
const mockEnqueueWithdrawalProcessing = jest.fn().mockResolvedValue(undefined);
const mockTransactionFindFirst = jest.fn();
const mockGetTransaction = jest.fn();
const mockOperationCall = jest.fn();

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
    minting: "CB-MINT",
    burning: "CB-BURN",
    savingsVault: "",
    lendingPool: "",
    escrow: "",
  }),
}));

jest.mock("../src/config/database", () => ({
  prisma: {
    transaction: { findFirst: mockTransactionFindFirst },
  },
}));

jest.mock("../src/services/stellar/client", () => ({
  stellarClient: {
    getTransaction: mockGetTransaction,
    getServer: () => ({
      operations: () => ({
        operation: () => ({ call: mockOperationCall }),
      }),
    }),
  },
}));

jest.mock("../src/services/stellar/eventListener", () => {
  const registrations: Array<{
    contractId: string;
    types: string[];
    handler: ContractEventHandler;
  }> = [];
  return {
    eventListener: {
      listenToContractEvents: (
        contractId: string,
        types: string[],
        handler: ContractEventHandler,
      ) => {
        registrations.push({ contractId, types, handler });
      },
    },
    ContractEvent: jest.fn(),
    _registrations: registrations,
  };
});

jest.mock("../src/jobs/usdcConversionJob", () => ({
  enqueueUsdcConversion: mockEnqueueUsdcConversion,
}));

jest.mock("../src/jobs/withdrawalProcessingJob", () => ({
  enqueueWithdrawalProcessing: mockEnqueueWithdrawalProcessing,
}));

import { _registrations } from "../src/services/stellar/eventListener";
import { startMintEventListener } from "../src/jobs/acbu_minting_event_listener";
import { startBurnEventListener } from "../src/jobs/acbu_burning_event_listener";

const MINT_HASH = "a".repeat(64);
const BURN_HASH = "b".repeat(64);
const RECIPIENT = "G" + "A".repeat(55);

function handlerFor(contractId: string): ContractEventHandler {
  const entry = _registrations.find((r) => r.contractId === contractId);
  if (!entry) throw new Error(`no listener registered for ${contractId}`);
  return entry.handler;
}

function makeEvent(contractId: string, type: string, data: Record<string, unknown>) {
  return { contractId, type, version: 1, data, ledger: 4200, timestamp: Date.now() };
}

beforeAll(async () => {
  await startMintEventListener();
  await startBurnEventListener();
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe("Mint listener – transaction hash resolution", () => {
  it("drops an effect that carries no transaction hash at all", async () => {
    const event = makeEvent("CB-MINT", "contract_credited", {
      amount: "100",
      account: RECIPIENT,
    });

    await handlerFor("CB-MINT")(event);

    expect(mockEnqueueUsdcConversion).not.toHaveBeenCalled();
  });

  it("drops an effect whose hash is not on the chain", async () => {
    mockGetTransaction.mockRejectedValue(new Error("not found"));
    const event = makeEvent("CB-MINT", "contract_credited", {
      amount: "100",
      account: RECIPIENT,
      transaction_hash: MINT_HASH,
    });

    await handlerFor("CB-MINT")(event);

    expect(mockEnqueueUsdcConversion).not.toHaveBeenCalled();
  });

  it("drops an effect whose hash matches no pending mint transaction", async () => {
    mockGetTransaction.mockResolvedValue({ id: MINT_HASH });
    mockTransactionFindFirst.mockResolvedValue(null);
    const event = makeEvent("CB-MINT", "contract_credited", {
      amount: "100",
      account: RECIPIENT,
      transaction_hash: MINT_HASH,
    });

    await handlerFor("CB-MINT")(event);

    expect(mockEnqueueUsdcConversion).not.toHaveBeenCalled();
  });

  it("enqueues with the resolved hash and the matched transaction", async () => {
    mockGetTransaction.mockResolvedValue({ id: MINT_HASH });
    mockTransactionFindFirst.mockResolvedValue({ id: "mint-tx-1" });
    const event = makeEvent("CB-MINT", "contract_credited", {
      amount: "100",
      account: RECIPIENT,
      transaction_hash: MINT_HASH,
    });

    await handlerFor("CB-MINT")(event);

    expect(mockEnqueueUsdcConversion).toHaveBeenCalledWith({
      usdcAmount: "100",
      recipient: RECIPIENT,
      txHash: MINT_HASH,
      transactionId: "mint-tx-1",
    });
  });

  it("never hands the conversion job a synthetic transaction id", async () => {
    mockGetTransaction.mockResolvedValue({ id: MINT_HASH });
    mockTransactionFindFirst.mockResolvedValue({ id: "mint-tx-2" });
    const event = makeEvent("CB-MINT", "contract_credited", {
      amount: "100",
      account: RECIPIENT,
      transaction_hash: MINT_HASH,
    });

    await handlerFor("CB-MINT")(event);

    const calls = mockEnqueueUsdcConversion.mock.calls;
    expect(calls).toHaveLength(1);
    for (const [payload] of calls) {
      expect(payload.txHash).toMatch(/^[a-f0-9]{64}$/);
    }
  });
});

describe("Burn listener – transaction hash resolution", () => {
  it("resolves the hash from the referenced operation when the body has none", async () => {
    mockOperationCall.mockResolvedValue({ transaction_hash: BURN_HASH });
    mockGetTransaction.mockResolvedValue({ id: BURN_HASH });
    mockTransactionFindFirst.mockResolvedValue({ id: "burn-tx-9" });
    const event = makeEvent("CB-BURN", "contract_debited", {
      amount: "50",
      _links: {
        operation: { href: `https://horizon-testnet.stellar.org/operations/123456789` },
      },
    });

    await handlerFor("CB-BURN")(event);

    expect(mockEnqueueWithdrawalProcessing).toHaveBeenCalledWith({
      transactionId: "burn-tx-9",
      txHash: BURN_HASH,
    });
  });

  it("drops the event when neither a hash nor an operation link is present", async () => {
    const event = makeEvent("CB-BURN", "contract_debited", { amount: "50" });

    await handlerFor("CB-BURN")(event);

    expect(mockEnqueueWithdrawalProcessing).not.toHaveBeenCalled();
  });

  it("drops the event when the hash is on the chain but no burn transaction matches", async () => {
    mockGetTransaction.mockResolvedValue({ id: BURN_HASH });
    mockTransactionFindFirst.mockResolvedValue(null);
    const event = makeEvent("CB-BURN", "contract_debited", {
      amount: "50",
      transaction_hash: BURN_HASH,
    });

    await handlerFor("CB-BURN")(event);

    expect(mockEnqueueWithdrawalProcessing).not.toHaveBeenCalled();
  });
});
