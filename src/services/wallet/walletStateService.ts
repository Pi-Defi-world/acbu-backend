import { Horizon } from "@stellar/stellar-sdk";
import { prisma } from "../../config/database";
import { AppError } from "../../middleware/errorHandler";
import { assertIfMatchHeaderPresent } from "../../utils/walletConcurrency";
import { getAcbuAssetConfig } from "../../config/acbuAsset";

export type WalletBalanceSnapshot = {
  balance: string;
  currency: "ACBU";
  stellar_address: string | null;
  balance_stellar: string;
  balance_source: "stellar" | "none";
};

export type WalletState = WalletBalanceSnapshot & {
  wallet_version: number;
};

const balanceCache = new Map<
  string,
  { expiresAt: number; value: WalletBalanceSnapshot; walletVersion: number }
>();

function getBalanceCacheTtlMs(): number {
  const raw = process.env.BALANCE_CACHE_TTL_MS;
  const n = raw ? Number(raw) : 15_000;
  if (!Number.isFinite(n) || n < 0) return 15_000;
  return Math.min(Math.max(0, Math.floor(n)), 120_000);
}

function invalidateBalanceCache(userId: string): void {
  for (const key of balanceCache.keys()) {
    if (key.startsWith(`${userId}|`)) {
      balanceCache.delete(key);
    }
  }
}

export async function getWalletVersion(userId: string): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { walletVersion: true },
  });
  if (!user) throw new AppError("User not found", 404);
  return user.walletVersion;
}

export async function reserveWalletVersion(
  userId: string,
  ifMatch: string | undefined,
): Promise<number> {
  const expectedVersion = assertIfMatchHeaderPresent(ifMatch);

  const result = await prisma.user.updateMany({
    where: { id: userId, walletVersion: expectedVersion },
    data: { walletVersion: { increment: 1 } },
  });

  if (result.count === 0) {
    throw new AppError(
      "Wallet was modified by another request; refresh and retry with the current ETag",
      412,
      "PRECONDITION_FAILED",
    );
  }

  invalidateBalanceCache(userId);
  return expectedVersion + 1;
}

export async function updateWalletWithConcurrency(
  userId: string,
  ifMatch: string | undefined,
  data: {
    stellarAddress?: string | null;
    encryptedStellarSecret?: string | null;
    keyEncryptionHint?: string | null;
  },
): Promise<number> {
  const expectedVersion = assertIfMatchHeaderPresent(ifMatch);

  const result = await prisma.user.updateMany({
    where: { id: userId, walletVersion: expectedVersion },
    data: {
      ...data,
      walletVersion: { increment: 1 },
    },
  });

  if (result.count === 0) {
    throw new AppError(
      "Wallet was modified by another request; refresh and retry with the current ETag",
      412,
      "PRECONDITION_FAILED",
    );
  }

  invalidateBalanceCache(userId);
  return expectedVersion + 1;
}

export async function fetchWalletBalance(userId: string): Promise<{
  snapshot: WalletBalanceSnapshot;
  walletVersion: number;
}> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { stellarAddress: true, walletVersion: true },
  });

  if (!user) throw new AppError("User not found", 404);

  if (!user.stellarAddress) {
    return {
      walletVersion: user.walletVersion,
      snapshot: {
        balance: "0",
        currency: "ACBU",
        stellar_address: null,
        balance_stellar: "0",
        balance_source: "none",
      },
    };
  }

  const horizonUrl = process.env.STELLAR_HORIZON_URL || "https://horizon-testnet.stellar.org";
  // Single source of truth for the ACBU code + issuer (see config/acbuAsset.ts).
  const { code: assetCode, issuer: assetIssuer } = getAcbuAssetConfig();
  const cacheKey = [userId, horizonUrl, assetCode, assetIssuer].join("|");
  const cached = balanceCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now() && cached.walletVersion === user.walletVersion) {
    return { snapshot: cached.value, walletVersion: user.walletVersion };
  }

  const server = new Horizon.Server(horizonUrl);

  try {
    const account = await server.loadAccount(user.stellarAddress);
    const acbuBalance = account.balances.find((balance) => {
      if (balance.asset_type === "native") return false;
      return (
        "asset_code" in balance &&
        balance.asset_code === assetCode &&
        balance.asset_issuer === assetIssuer
      );
    });

    const stellarNum = acbuBalance ? Number.parseFloat(acbuBalance.balance) : 0;
    const displayNum = Number.isFinite(stellarNum) ? stellarNum : 0;
    const snapshot: WalletBalanceSnapshot = {
      balance: String(displayNum),
      currency: "ACBU",
      stellar_address: user.stellarAddress,
      balance_stellar: String(displayNum),
      balance_source: "stellar",
    };

    balanceCache.set(cacheKey, {
      expiresAt: Date.now() + getBalanceCacheTtlMs(),
      value: snapshot,
      walletVersion: user.walletVersion,
    });

    return { snapshot, walletVersion: user.walletVersion };
  } catch (error: unknown) {
    const stellarError = error as { response?: { status?: number } };
    if (stellarError.response?.status === 404) {
      const snapshot: WalletBalanceSnapshot = {
        balance: "0",
        currency: "ACBU",
        stellar_address: user.stellarAddress,
        balance_stellar: "0",
        balance_source: "none",
      };
      balanceCache.set(cacheKey, {
        expiresAt: Date.now() + getBalanceCacheTtlMs(),
        value: snapshot,
        walletVersion: user.walletVersion,
      });
      return { snapshot, walletVersion: user.walletVersion };
    }
    throw error;
  }
}

export async function getWalletState(userId: string): Promise<WalletState> {
  const { snapshot, walletVersion } = await fetchWalletBalance(userId);
  return { ...snapshot, wallet_version: walletVersion };
}
