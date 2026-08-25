import { prisma } from "../../config/database";
import { BASKET_CURRENCIES, type BasketCurrency } from "../../config/basket";
import { Decimal } from "@prisma/client/runtime/library";
import { getLatestAcbuRate } from "../rates/acbuRateCache";
import {
  acbuBurningService,
  acbuMintingService,
  acbuOracleService,
} from "../contracts";
import { stellarClient } from "../stellar/client";
import { getContractAddresses } from "../../config/contracts";
import { decryptUserStellarSecret } from "../wallet/stellarSecretService";
import {
  ensureAcbuTrustline,
  ensureDemoFiatTrustline,
} from "../stellar/trustlineService";
import { ensureAccountActivated } from "../stellar/activationService";
import {
  InvalidCurrencyError,
  InvalidMintAmountError,
  InvalidCurrencyForOnRampError,
  TrustlineMissingError,
  NonExistentContractFunctionError,
  ValidationError,
} from "../../errors/index";

const DECIMALS_7 = 1e7;
const DECIMALS_7_BIGINT = 10_000_000n;
const MIN_MINT_USD_7 = 10_000_000n; // 1 USD in 7-dec fixed point
const MAX_MINT_USD_7 = 1_000_000_000_000n; // 100,000 USD in 7-dec fixed point

function assertMintingConfigured(): void {
  const { minting } = getContractAddresses();
  if (!minting) {
    throw new ValidationError("Minting contract not configured (CONTRACT_MINTING)");
  }
}

function wholeFiatToI128(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ValidationError("Invalid fiat amount");
  }
  return String(Math.round(amount * DECIMALS_7));
}

function divCeil(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b;
}

/**
 * Pre-validate demo fiat mint bounds using current on-chain oracle rate so we can
 * return a clean 400 instead of a generic Soroban simulation error.
 */
async function validateDemoMintAmount(
  currency: string,
  fiatAmountI128: string,
): Promise<void> {
  try {
    const rate = BigInt(await acbuOracleService.getRate(currency));
    if (rate <= 0n) return; // Let on-chain path surface invalid-rate if needed.

    const fiat = BigInt(fiatAmountI128);
    const usdGross = (fiat * rate) / DECIMALS_7_BIGINT;
    if (usdGross >= MIN_MINT_USD_7 && usdGross <= MAX_MINT_USD_7) {
      return;
    }

    const minFiatI128 = divCeil(MIN_MINT_USD_7 * DECIMALS_7_BIGINT, rate);
    const maxFiatI128 = (MAX_MINT_USD_7 * DECIMALS_7_BIGINT) / rate;

    const minFiat = Number(minFiatI128) / DECIMALS_7;
    const maxFiat = Number(maxFiatI128) / DECIMALS_7;
    const requestedFiat = Number(fiatAmountI128) / DECIMALS_7;
    const usdApprox = Number(usdGross) / DECIMALS_7;

    throw new InvalidMintAmountError(
      `Invalid mint amount for ${currency}: ${requestedFiat} converts to ~${usdApprox.toFixed(2)} USD. Allowed range is ${minFiat.toFixed(2)} to ${maxFiat.toFixed(2)} ${currency}.`,
    );
  } catch (e) {
    // Bubble only intentional validation errors; ignore pre-check network issues.
    if (e instanceof InvalidMintAmountError) {
      throw e;
    }
  }
}

export type FiatAccountView = {
  id: string;
  currency: string;
  balance: string;
  usd_equivalent: string | null;
  bank_name: string;
  account_number: string;
  ledger_entries: [];
};

/**
 * Soroban custodial demo fiat: no simulated bank. Returns one row per basket currency for UI compatibility.
 */
export async function getBankAccounts(
  userId: string,
): Promise<FiatAccountView[]> {
  const [user, faucetRows, latestRates] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, phoneE164: true, id: true },
    }),
    prisma.transaction.findMany({
      where: {
        userId,
        type: "mint",
        status: "completed",
        localCurrency: { in: BASKET_CURRENCIES },
        localAmount: { not: null },
        rateSnapshot: { path: ["source"], equals: "admin_drip_demo_fiat" },
      },
      take: 1_000, // #437: cap per-user faucet rows
      select: {
        localCurrency: true,
        localAmount: true,
      },
    }),
    prisma.oracleRate.findMany({
      where: { currency: { in: BASKET_CURRENCIES } },
      orderBy: { timestamp: "desc" },
      distinct: ["currency"],
      select: { currency: true, rateUsd: true },
    }),
  ]);

  const suffix =
    user?.username || user?.phoneE164 || user?.id.slice(0, 8) || "user";

  const balances = new Map<string, number>();
  for (const c of BASKET_CURRENCIES) balances.set(c, 0);
  for (const row of faucetRows) {
    const c = row.localCurrency ?? "";
    if (!balances.has(c) || !row.localAmount) continue;
    balances.set(c, (balances.get(c) ?? 0) + row.localAmount.toNumber());
  }

  const usdRates = new Map<string, number>();
  for (const r of latestRates) {
    usdRates.set(r.currency, r.rateUsd.toNumber());
  }

  return BASKET_CURRENCIES.map((currency) => {
    const balance = balances.get(currency) ?? 0;
    const rateUsd = usdRates.get(currency) ?? 0;
    const usdEquivalent = rateUsd > 0 ? balance / rateUsd : null;
    return {
      id: `${currency}-${userId}`,
      currency,
      balance: balance.toString(),
      usd_equivalent: usdEquivalent != null ? usdEquivalent.toString() : null,
      bank_name: "Soroban (demo basket)",
      account_number: `${suffix}-${currency}`,
      ledger_entries: [],
    };
  });
}

/**
 * Testnet faucet: admin key drips demo S-token from minting contract custody to the user's Stellar address.
 */
export async function requestFaucet(
  userId: string,
  currency: string,
  amount: number,
  recipient?: string,
  passcode?: string,
): Promise<{
  currency: string;
  amount: number;
  amount_i128: string;
  transaction_hash: string;
}> {
  if (!BASKET_CURRENCIES.includes(currency as BasketCurrency)) {
    throw new InvalidCurrencyError(currency);
  }

  if (amount <= 0 || amount > 10_000_000) {
    throw new ValidationError("Invalid amount (must be > 0 and <= 10000000).");
  }

  assertMintingConfigured();

  let stellarAddress: string | undefined;
  // Prefer explicit recipient from the caller (frontend can derive from local seed).
  if (recipient) {
    stellarAddress = recipient;
  } else {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { stellarAddress: true },
      });
      stellarAddress = user?.stellarAddress ?? undefined;
    } catch {
      // Allow faucet to operate even if Prisma/Accelerate is unreachable.
      // This is safe because admin_drip_demo_fiat is still admin-gated on-chain.
    }
  }
  if (!stellarAddress) {
    throw new ValidationError("User wallet address not set (and no recipient provided).");
  }

  // Ensure the recipient account exists on-chain (testnet: newly generated addresses need funding).
  await ensureAccountActivated(stellarAddress);

  // Ensure the recipient can receive the demo SAC-wrapped classic asset.
  // This requires a classic trustline on the recipient account.
  //
  // We can auto-add it only if the backend can decrypt the user's seed.
  if (passcode) {
    try {
      const secret = await decryptUserStellarSecret(userId, passcode);
      if (secret) {
        await ensureDemoFiatTrustline({ userSecret: secret, currency });
      }
    } catch {
      // Ignore trustline failures and let the on-chain call surface the real error.
    }
  }

  const amountI128 = wholeFiatToI128(amount);
  let transactionHash: string;
  try {
    ({ transactionHash } = await acbuMintingService.adminDripDemoFiat({
      recipient: stellarAddress,
      currency,
      amount: amountI128,
    }));
  } catch (e) {
    // If the user has no trustline yet, try to add it (if passcode available) and retry once.
    if (
      passcode &&
      e instanceof Error &&
      e.message.includes("trustline entry is missing")
    ) {
      const secret = await decryptUserStellarSecret(userId, passcode);
      if (!secret) throw new TrustlineMissingError(e.message);
      await ensureDemoFiatTrustline({ userSecret: secret, currency });
      ({ transactionHash } = await acbuMintingService.adminDripDemoFiat({
        recipient: stellarAddress,
        currency,
        amount: amountI128,
      }));
    } else if (e instanceof Error && e.message.includes("non-existent contract function")) {
      throw new NonExistentContractFunctionError();
    } else {
      throw e;
    }
  }

  // Record faucet drips in transaction history so Activity can display them.
  // We store the dispensed fiat amount/currency and chain hash.
  try {
    await prisma.transaction.create({
      data: {
        userId,
        type: "mint",
        status: "completed",
        localCurrency: currency,
        localAmount: new Decimal(amount),
        blockchainTxHash: transactionHash,
        rateSnapshot: {
          source: "admin_drip_demo_fiat",
          recipient: stellarAddress,
          amount_i128: amountI128,
        },
        completedAt: new Date(),
      },
    });
  } catch {
    // Do not fail faucet response if history persistence is temporarily unavailable.
  }

  return {
    currency,
    amount,
    amount_i128: amountI128,
    transaction_hash: transactionHash,
  };
}

/**
 * On-ramp: custodial `mint_from_demo_fiat` (no simulated bank ledger).
 */
export async function simulateOnRamp(
  userId: string,
  currency: string,
  fiatAmount: number,
  passcode?: string,
): Promise<{
  transactionId: string;
  acbuAmount: number;
  blockchain_tx_hash: string;
}> {
  assertMintingConfigured();

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.stellarAddress) {
    throw new ValidationError("User wallet address not set");
  }

  if (!BASKET_CURRENCIES.includes(currency as BasketCurrency)) {
    throw new InvalidCurrencyForOnRampError();
  }

  const sourceAccount = stellarClient.getKeypair()?.publicKey();
  if (!sourceAccount) {
    throw new ValidationError("No Stellar source account (STELLAR_SECRET_KEY)");
  }

  const fiatAmountI128 = wholeFiatToI128(fiatAmount);
  await validateDemoMintAmount(currency, fiatAmountI128);

  // Default setup: if passcode is available, ensure recipient has ACBU trustline
  // before minting to avoid contract-level trustline failures.
  if (passcode) {
    try {
      const secret = await decryptUserStellarSecret(userId, passcode);
      if (secret) {
        await ensureAcbuTrustline({ userSecret: secret });
      }
    } catch {
      // Ignore and let on-chain call surface exact trustline error if still missing.
    }
  }

  const tx = await prisma.transaction.create({
    data: {
      userId,
      type: "mint",
      status: "pending",
      rateSnapshot: {
        source: "mint_from_demo_fiat",
        currency,
        fiat_amount: fiatAmount,
      },
    },
  });

  try {
    const result = await acbuMintingService.mintFromDemoFiat({
      operator: sourceAccount,
      recipient: user.stellarAddress,
      currency,
      fiatAmount: fiatAmountI128,
    });
    const acbuNum = Number(result.acbuAmount) / DECIMALS_7;

    await prisma.transaction.update({
      where: { id: tx.id },
      data: {
        status: "completed",
        acbuAmount: new Decimal(acbuNum),
        blockchainTxHash: result.transactionHash,
        completedAt: new Date(),
      },
    });

    return {
      transactionId: tx.id,
      acbuAmount: acbuNum,
      blockchain_tx_hash: result.transactionHash,
    };
  } catch (err: unknown) {
    // Retry once after auto-adding ACBU trustline (same resilience pattern as faucet).
    if (
      passcode &&
      err instanceof Error &&
      err.message.includes("trustline entry is missing")
    ) {
      const secret = await decryptUserStellarSecret(userId, passcode);
      if (secret) {
        await ensureAcbuTrustline({ userSecret: secret });
        const retry = await acbuMintingService.mintFromDemoFiat({
          operator: sourceAccount,
          recipient: user.stellarAddress,
          currency,
          fiatAmount: fiatAmountI128,
        });
        const acbuNum = Number(retry.acbuAmount) / DECIMALS_7;
        await prisma.transaction.update({
          where: { id: tx.id },
          data: {
            status: "completed",
            acbuAmount: new Decimal(acbuNum),
            blockchainTxHash: retry.transactionHash,
            completedAt: new Date(),
          },
        });
        return {
          transactionId: tx.id,
          acbuAmount: acbuNum,
          blockchain_tx_hash: retry.transactionHash,
        };
      }
      throw new TrustlineMissingError(err.message);
    }
    if (err instanceof Error && err.message.includes("non-existent contract function")) {
      throw new NonExistentContractFunctionError();
    }

    const message = err instanceof Error ? err.message : String(err);
    await prisma.transaction.update({
      where: { id: tx.id },
      data: {
        status: "failed",
        rateSnapshot: {
          source: "mint_from_demo_fiat",
          currency,
          fiat_amount: fiatAmount,
          error: message,
          at: new Date().toISOString(),
        },
      },
    });
    throw err;
  }
}

/**
 * Off-ramp: burn ACBU for basket slice; no simulated bank credit (Horizon / custodial fiat is truth).
 */
export async function simulateOffRamp(
  userId: string,
  currency: string,
  acbuAmount: number,
  blockchainTxHash?: string,
): Promise<{
  fiatAmount: number;
  acbuAmount: number;
  transactionId: string;
}> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.stellarAddress) {
    throw new ValidationError("User wallet address not set");
  }

  const acbuRateRecord = await getLatestAcbuRate();

  const rateKey =
    `acbu${currency.charAt(0).toUpperCase() + currency.slice(1).toLowerCase()}` as keyof typeof acbuRateRecord;
  const acbuPerLocal = acbuRateRecord[rateKey];

  if (
    !acbuPerLocal ||
    typeof acbuPerLocal !== "object" ||
    !("toNumber" in acbuPerLocal)
  ) {
    throw new Error(`Rate not found for currency ${currency}`);
  }

  const fiatAmount = acbuAmount * acbuPerLocal.toNumber();

  const addresses = getContractAddresses();
  if (!addresses.burning) {
    throw new Error("Burning contract not configured");
  }

  let txHash = blockchainTxHash;
  if (!txHash) {
    const sourceAccount = stellarClient.getKeypair()?.publicKey();
    if (!sourceAccount) {
      throw new Error("No Stellar source account (STELLAR_SECRET_KEY)");
    }

    const acbuAmount7 = Math.round(acbuAmount * DECIMALS_7).toString();

    const result = await acbuBurningService.redeemSingle({
      user: sourceAccount,
      recipient: sourceAccount,
      acbuAmount: acbuAmount7,
      currency,
    });
    txHash = result.transactionHash;
  }

  return {
    fiatAmount,
    acbuAmount,
    transactionId: txHash,
  };
}
