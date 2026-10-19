/**
 * AB-052 (#1002): fee handling for the Stellar payment submitted by
 * `createTransfer` → `submitStellarPayment`.
 *
 * The bug: the fee was resolved once, when the transaction was built, and never
 * looked at again before submission. Under a network fee surge the transaction
 * reached Horizon underpriced and was rejected with `tx_insufficient_fee`,
 * surfacing as an opaque, generic failure with nothing to act on.
 *
 * These tests drive the real Stellar SDK (no TransactionBuilder/Keypair stub) so
 * the fee assertions are made against the transaction that actually got built
 * and submitted, and only the I/O boundaries (Horizon, Prisma, config) are mocked.
 */
import { Account, Keypair } from "@stellar/stellar-sdk";

jest.mock("../../config/database", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    transaction: {
      create: jest.fn(),
      update: jest.fn(),
    },
    userContact: {
      findFirst: jest.fn(),
    },
  },
}));

jest.mock("../stellar/client", () => ({
  stellarClient: {
    getServer: jest.fn(),
    getNetworkPassphrase: jest.fn(() => "Test SDF Network ; September 2015"),
  },
}));

const mockGetBaseFee = jest.fn<Promise<string>, []>();
const mockGetPaymentFee = jest.fn();

jest.mock("../stellar/feeManager", () => ({
  getBaseFee: (...args: []) => mockGetBaseFee(...args),
  getPaymentFee: (...args: []) => mockGetPaymentFee(...args),
}));

jest.mock("../wallet/walletStateService", () => ({
  reserveWalletVersion: jest.fn().mockResolvedValue(1),
  fetchWalletBalance: jest.fn(),
}));

jest.mock("../../config/logger", () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logFinancialEvent: jest.fn(),
}));

import { prisma } from "../../config/database";
import { stellarClient } from "../stellar/client";
import { fetchWalletBalance } from "../wallet/walletStateService";
import { logger, logFinancialEvent } from "../../config/logger";
import { createTransfer } from "./transferService";
import { StellarFeeSurgeError } from "../../errors";

const mockUser = prisma.user as jest.Mocked<typeof prisma.user>;
const mockTx = prisma.transaction as jest.Mocked<typeof prisma.transaction>;

const TEST_ISSUER = "GD5FHO5TWVJ7K7J24Y4EATJTAQCWDCOYPBY4A7AUXZ46YUOVVF6UVE7E";
const SENDER_ID = "user-sender-fee";
const MAX_PAYMENT_FEE_STROOPS = 1_000_000;

/** Real keypairs, so signed transactions and fee encoding are exercised for real. */
let senderKeypair: Keypair;
let recipientAddress: string;

/** Transactions handed to Horizon, in submission order, with a numeric total fee. */
let submitted: { fee: number }[];

/**
 * Queued outcome for each successive `submitTransaction` call. An entry with an
 * `error` is rejected; anything else resolves. Lets a test make the *first*
 * attempt fail while still recording the fee that attempt carried.
 */
let submitQueue: Array<{ error?: Error }>;

/** Load a real Account (sequence number is read by TransactionBuilder). */
const loadAccount = jest.fn(async () => new Account(senderKeypair.publicKey(), "1"));
const submitTransaction = jest.fn(async (tx: { fee: unknown }) => {
  // `transaction.fee` is numeric in the SDK types but serialised as a string at
  // runtime, so normalise it for assertions.
  submitted.push({ fee: Number(tx.fee) });
  const outcome = submitQueue.shift();
  if (outcome?.error) {
    throw outcome.error;
  }
  return { hash: `stellar-hash-${submitted.length}` };
});

/**
 * Build the fee quote `getPaymentFee()` would return for a live network base
 * fee, so tests exercise the real buffer/ceiling semantics.
 */
function quoteFor(
  networkFeeStroops: number,
  bufferBps = 2000,
  maxFeeStroops = MAX_PAYMENT_FEE_STROOPS,
) {
  const buffered = Math.ceil(networkFeeStroops * (1 + bufferBps / 10_000));
  const feeStroops = Math.min(buffered, maxFeeStroops);
  return {
    feeStroops,
    networkFeeStroops,
    buffered: buffered > networkFeeStroops,
    clampedToCeiling: feeStroops < buffered,
    maxFeeStroops,
  };
}

/** A Horizon 400 rejection carrying the tx_insufficient_fee result code. */
function horizonInsufficientFeeError(): Error {
  const err = new Error("Request failed with status code 400") as Error & {
    response?: { status: number; data: unknown };
  };
  err.response = {
    status: 400,
    data: {
      type: "https://stellar.org/horizon-errors/transaction_failed",
      title: "Transaction Failed",
      extras: {
        result_codes: { transaction: "tx_insufficient_fee", operations: ["op_underfunded"] },
      },
    },
  };
  return err;
}

/** A Horizon rejection that is NOT about fees — must not be disguised as a surge. */
function horizonBadAuthError(): Error {
  const err = new Error("Request failed with status code 400") as Error & {
    response?: { status: number; data: unknown };
  };
  err.response = {
    status: 400,
    data: {
      extras: {
        result_codes: { transaction: "tx_bad_auth", operations: ["op_no_source_account"] },
      },
    },
  };
  return err;
}

/** Drive createTransfer down the signed-submission path. */
async function submitTransfer() {
  return createTransfer(
    { senderUserId: SENDER_ID, to: recipientAddress, amountAcbu: "10" },
    { getSenderSigningKey: async () => senderKeypair.secret() },
  );
}

/**
 * Drive createTransfer and return whatever it rejected with, or null if it
 * resolved. Used for the fee-surge path, which now rethrows a 503 to the caller.
 */
async function rejectionFromTransfer(): Promise<unknown> {
  try {
    await submitTransfer();
  } catch (err) {
    return err;
  }
  return null;
}

/** The `status` values written to the Transaction row. */
function statusUpdates(): string[] {
  return (mockTx.update as jest.Mock).mock.calls
    .map((call) => (call[0] as { data?: { status?: string } })?.data?.status)
    .filter((s): s is string => typeof s === "string");
}

/** The structured fields logged for a failed submission. */
function failureLog() {
  return (logger.error as jest.Mock).mock.calls.find(
    (call) => call[0] === "Transfer Stellar submission failed",
  )?.[1] as Record<string, unknown> | undefined;
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.STELLAR_ACBU_ASSET_ISSUER = TEST_ISSUER;

  senderKeypair = Keypair.random();
  recipientAddress = Keypair.random().publicKey();
  submitted = [];
  submitQueue = [];

  loadAccount.mockImplementation(async () => new Account(senderKeypair.publicKey(), "1"));
  submitTransaction.mockImplementation(async (tx: { fee: unknown }) => {
    submitted.push({ fee: Number(tx.fee) });
    const outcome = submitQueue.shift();
    if (outcome?.error) {
      throw outcome.error;
    }
    return { hash: `stellar-hash-${submitted.length}` };
  });
  (stellarClient.getServer as jest.Mock).mockReturnValue({ loadAccount, submitTransaction });

  (mockUser.findUnique as jest.Mock).mockResolvedValue({
    stellarAddress: senderKeypair.publicKey(),
    kycStatus: "verified",
  });
  (mockTx.create as jest.Mock).mockResolvedValue({ id: "tx-fee-1" });
  (mockTx.update as jest.Mock).mockResolvedValue({});
  (fetchWalletBalance as jest.Mock).mockResolvedValue({
    snapshot: { balance: "1000000" },
    walletVersion: 1,
  });

  // Default: a calm 100-stroop network, priced with the standard 20% buffer.
  mockGetBaseFee.mockResolvedValue("100");
  mockGetPaymentFee.mockResolvedValue(quoteFor(100));
});

describe("Stellar payment fee re-validation (AB-052)", () => {
  it("prices the transaction with the buffered fee and submits it", async () => {
    const result = await submitTransfer();

    expect(result.status).toBe("completed");
    expect(submitted).toHaveLength(1);
    // 100 stroops network fee + 20% buffer.
    expect(submitted[0].fee).toBe(120);
  });

  it("re-reads the network fee before submitting rather than trusting the build-time value", async () => {
    await submitTransfer();

    expect(mockGetPaymentFee).toHaveBeenCalledTimes(1);
    expect(mockGetBaseFee).toHaveBeenCalledTimes(1);
  });

  // ── fee spike between build and submit ────────────────────────────────────

  it("rebuilds and reprices when the fee rises above the built transaction fee", async () => {
    // Attempt 1 builds at 120 stroops; the pre-submission re-read sees 1000.
    mockGetPaymentFee.mockResolvedValueOnce(quoteFor(100)).mockResolvedValueOnce(quoteFor(1000));
    mockGetBaseFee.mockResolvedValue("1000");

    const result = await submitTransfer();

    expect(result.status).toBe("completed");
    // Rebuilt locally and submitted once — no wasted on-chain rejection.
    expect(submitTransaction).toHaveBeenCalledTimes(1);
    expect(submitted).toHaveLength(1);
    expect(submitted[0].fee).toBe(1200);
    // The account is reloaded so the rebuilt transaction carries a fresh sequence.
    expect(loadAccount).toHaveBeenCalledTimes(2);
  });

  it("keeps rebuilding while the fee keeps rising, and reprices each time", async () => {
    mockGetPaymentFee
      .mockResolvedValueOnce(quoteFor(100))
      .mockResolvedValueOnce(quoteFor(500))
      .mockResolvedValueOnce(quoteFor(2000));
    mockGetBaseFee.mockResolvedValue("2000");

    const result = await submitTransfer();

    expect(result.status).toBe("completed");
    expect(submitted[0].fee).toBe(2400);
  });

  it("submits as priced when the pre-submission re-read cannot reach Horizon", async () => {
    mockGetBaseFee.mockRejectedValue(new Error("Horizon timeout"));

    const result = await submitTransfer();

    // An unavailable check must never block an otherwise valid payment.
    expect(result.status).toBe("completed");
    expect(submitted).toHaveLength(1);
    expect(submitted[0].fee).toBe(120);
  });

  it("submits as priced when the pre-submission re-read returns a non-numeric fee", async () => {
    mockGetBaseFee.mockResolvedValue("not-a-number");

    const result = await submitTransfer();

    expect(result.status).toBe("completed");
    expect(submitted[0].fee).toBe(120);
  });

  it("fails fast with a structured error once the fee outruns the payment fee ceiling", async () => {
    // Network base fee is above the ceiling, so no affordable transaction can succeed.
    mockGetPaymentFee.mockResolvedValue(quoteFor(MAX_PAYMENT_FEE_STROOPS + 1));

    const error = (await rejectionFromTransfer()) as StellarFeeSurgeError;

    // A fee surge reaches the caller as a 503 rather than a silent "failed".
    expect(error).toBeInstanceOf(StellarFeeSurgeError);
    expect(error.code).toBe("STELLAR_FEE_SURGE");
    expect(error.statusCode).toBe(503);
    expect(error.detectedBy).toBe("fee_pricing");
    // Never even attempted: submitting could only produce a rejection.
    expect(submitTransaction).not.toHaveBeenCalled();
    // And it is a fee surge, not some incidental build/serialisation failure.
    expect(failureLog()?.error).toBeInstanceOf(StellarFeeSurgeError);
    expect(failureLog()).toMatchObject({ detectedBy: "fee_pricing" });
  });

  it("marks the transaction failed before rethrowing a fee surge", async () => {
    mockGetPaymentFee.mockResolvedValue(quoteFor(MAX_PAYMENT_FEE_STROOPS + 1));

    await rejectionFromTransfer();

    // The record must be consistent before the throw: a rethrow that skipped
    // this would leave the row stuck in 'pending' forever.
    expect(statusUpdates()).toEqual(["failed"]);
    expect(logFinancialEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: "transfer.failed" }),
    );
  });

  it("reports the fee ceiling failure as STELLAR_FEE_SURGE with the live network fee", async () => {
    mockGetPaymentFee.mockResolvedValue(quoteFor(MAX_PAYMENT_FEE_STROOPS + 1));

    await rejectionFromTransfer();

    const log = failureLog();
    expect(log).toMatchObject({
      errorCode: "STELLAR_FEE_SURGE",
      maxFeeStroops: MAX_PAYMENT_FEE_STROOPS,
      detectedBy: "fee_pricing",
    });
    expect(log?.error).toBeInstanceOf(StellarFeeSurgeError);
    expect((log?.error as StellarFeeSurgeError).networkFeeStroops).toBe(
      MAX_PAYMENT_FEE_STROOPS + 1,
    );
  });

  it("emits transfer.failed with the STELLAR_FEE_SURGE error code on a ceiling breach", async () => {
    mockGetPaymentFee.mockResolvedValue(quoteFor(MAX_PAYMENT_FEE_STROOPS + 1));

    await rejectionFromTransfer();

    expect(logFinancialEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "transfer.failed",
        status: "failed",
        errorCode: "STELLAR_FEE_SURGE",
      }),
    );
  });

  it("gives up with a structured error when the fee rises on every attempt", async () => {
    // Always stale: the pre-submission check can never be satisfied.
    mockGetPaymentFee.mockResolvedValue(quoteFor(100));
    mockGetBaseFee.mockResolvedValue("5000");

    const error = (await rejectionFromTransfer()) as StellarFeeSurgeError;

    expect(error).toBeInstanceOf(StellarFeeSurgeError);
    expect(error.detectedBy).toBe("pre_submission_check");
    expect(submitTransaction).not.toHaveBeenCalled();
    // Bounded work: one account load + one build per allowed attempt.
    expect(loadAccount).toHaveBeenCalledTimes(3);
    const log = failureLog();
    expect(log).toMatchObject({
      errorCode: "STELLAR_FEE_SURGE",
      detectedBy: "pre_submission_check",
    });
    expect(log?.error).toBeInstanceOf(StellarFeeSurgeError);
  });

  // ── Horizon fee rejections ────────────────────────────────────────────────

  it("retries with a repriced transaction when Horizon rejects for an insufficient fee", async () => {
    // The surge lands during the submission round trip, so the pre-submission
    // check sees a healthy fee and the rejection is the first signal.
    mockGetBaseFee.mockResolvedValue("100");
    mockGetPaymentFee.mockResolvedValueOnce(quoteFor(100)).mockResolvedValueOnce(quoteFor(9000));
    submitQueue = [{ error: horizonInsufficientFeeError() }];

    const result = await submitTransfer();

    expect(result.status).toBe("completed");
    expect(submitTransaction).toHaveBeenCalledTimes(2);
    expect(submitted[0].fee).toBe(120);
    expect(submitted[1].fee).toBe(10800);
  });

  it("does not mask a non-fee Horizon rejection as a fee surge", async () => {
    submitQueue = [{ error: horizonBadAuthError() }];

    const result = await submitTransfer();

    expect(result.status).toBe("failed");
    // A bad signature is not retryable-by-repricing, so it is not retried...
    expect(submitTransaction).toHaveBeenCalledTimes(1);
    // ...and it must not be reported as a fee surge.
    expect(failureLog()?.error).not.toBeInstanceOf(StellarFeeSurgeError);
    expect(failureLog()).not.toHaveProperty("errorCode");
    expect(logFinancialEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: "transfer.failed", errorCode: undefined }),
    );
  });

  it("wraps a persistent tx_insufficient_fee rejection in a StellarFeeSurgeError", async () => {
    submitQueue = [
      { error: horizonInsufficientFeeError() },
      { error: horizonInsufficientFeeError() },
      { error: horizonInsufficientFeeError() },
    ];

    const thrown = (await rejectionFromTransfer()) as StellarFeeSurgeError;

    // Repriced and retried up to the attempt limit before giving up.
    expect(submitTransaction).toHaveBeenCalledTimes(3);
    // Retrying is pointless for the caller once the surge survives 3 attempts,
    // so the retryable-but-persistent condition is surfaced as a 503.
    expect(thrown).toBeInstanceOf(StellarFeeSurgeError);
    expect(thrown.code).toBe("STELLAR_FEE_SURGE");
    expect(thrown.statusCode).toBe(503);
    expect(thrown.isOperational).toBe(true);
    expect(thrown.detectedBy).toBe("horizon_rejection");
    expect(thrown.transactionFeeStroops).toBe(120);
    expect(thrown.maxFeeStroops).toBe(MAX_PAYMENT_FEE_STROOPS);
    expect(thrown.details).toMatchObject({
      detectedBy: "horizon_rejection",
      transactionFeeStroops: 120,
      maxFeeStroops: MAX_PAYMENT_FEE_STROOPS,
    });
    // The same error is recorded, so the audit trail matches what was thrown.
    expect(failureLog()?.error).toBe(thrown);
    expect(statusUpdates()).toEqual(["failed"]);
  });

  it("detects a fee rejection reported only in the error message", async () => {
    submitQueue = [{ error: new Error("tx_insufficient_fee") }];
    mockGetPaymentFee.mockResolvedValueOnce(quoteFor(100)).mockResolvedValueOnce(quoteFor(700));

    const result = await submitTransfer();

    expect(result.status).toBe("completed");
    expect(submitTransaction).toHaveBeenCalledTimes(2);
    expect(submitted[1].fee).toBe(840);
  });

  it("detects a fee rejection embedded in a longer error message", async () => {
    // Horizon often wraps the code in prose; the code still has to be found.
    submitQueue = [{ error: new Error("Transaction failed: tx_insufficient_fee") }];
    mockGetPaymentFee.mockResolvedValueOnce(quoteFor(100)).mockResolvedValueOnce(quoteFor(700));

    const result = await submitTransfer();

    expect(result.status).toBe("completed");
    expect(submitTransaction).toHaveBeenCalledTimes(2);
    expect(submitted[1].fee).toBe(840);
  });

  it("detects a fee rejection reported on the operation result code", async () => {
    const err = new Error("Request failed with status code 400") as Error & {
      response?: { data: unknown };
    };
    err.response = {
      data: { extras: { result_codes: { operations: ["tx_insufficient_fee"] } } },
    };
    submitQueue = [{ error: err }];
    mockGetPaymentFee.mockResolvedValueOnce(quoteFor(100)).mockResolvedValueOnce(quoteFor(700));

    const result = await submitTransfer();

    expect(result.status).toBe("completed");
    expect(submitted[1].fee).toBe(840);
  });

  it("retries a fee-bump wrapper whose inner transaction was underpriced", async () => {
    // tx_fee_bump_inner_failed on its own is ambiguous — it reports any inner
    // failure — so it only counts as a fee surge alongside an inner
    // tx_insufficient_fee.
    const err = new Error("Request failed with status code 400") as Error & {
      response?: { data: unknown };
    };
    err.response = {
      data: {
        extras: {
          result_codes: { transaction: "tx_fee_bump_inner_failed" },
          result_codes_transactions: ["tx_insufficient_fee"],
        },
      },
    };
    submitQueue = [{ error: err }, { error: err }, { error: err }];

    const thrown = await rejectionFromTransfer();

    expect(thrown).toBeInstanceOf(StellarFeeSurgeError);
    expect(submitTransaction).toHaveBeenCalledTimes(3);
  });

  it("does not blame the fee when a fee-bump wrapper failed for another reason", async () => {
    const err = new Error("Request failed with status code 400") as Error & {
      response?: { data: unknown };
    };
    err.response = {
      data: {
        extras: {
          result_codes: { transaction: "tx_fee_bump_inner_failed" },
          result_codes_transactions: ["tx_bad_auth"],
        },
      },
    };
    submitQueue = [{ error: err }];

    const result = await submitTransfer();

    expect(result.status).toBe("failed");
    // A bad signature is not fixed by repricing, so it must not be retried or
    // reported as a fee surge.
    expect(submitTransaction).toHaveBeenCalledTimes(1);
    expect(failureLog()?.error).toBeInstanceOf(Error);
    expect(failureLog()?.error).not.toBeInstanceOf(StellarFeeSurgeError);
  });

  it("propagates a non-fee submission failure without retrying", async () => {
    submitQueue = [{ error: new Error("Horizon unavailable") }];

    // Resolves rather than throwing: only a fee surge is surfaced as a 503, so
    // unrelated submission failures keep their existing `failed` result.
    const result = await submitTransfer();

    expect(result.status).toBe("failed");
    expect(submitTransaction).toHaveBeenCalledTimes(1);
    expect(failureLog()?.error).toBeInstanceOf(Error);
    expect(failureLog()?.error).not.toBeInstanceOf(StellarFeeSurgeError);
  });
});
