/**
 * Government segment: treasury view and statements.
 * For government actors (actorType === 'government'); aggregate exposure from
 * basket config, transaction history, and reserve segments.
 */
import { Response, NextFunction } from "express";
import { prisma } from "../config/database";
import { AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { basketService } from "../services/basket";
import { ReserveTracker } from "../services/reserve/ReserveTracker";

type DecimalLike = { toNumber: () => number } | null | undefined;
type BasketEntry = { currency: string; weight: number };
type TransactionWhere = Record<string, unknown>;

type TreasuryByCurrencyRow = {
  currency: string;
  targetWeight: number | null;
  mintedAcbu: number;
  burnedAcbu: number;
  netAcbu: number;
  mintedLocalAmount: number;
  burnedLocalAmount: number;
  reserveExposure: {
    transactions: number;
    investmentSavings: number;
    total: number;
  };
  reserveValueUsd: {
    transactions: number;
    investmentSavings: number;
    total: number;
  };
};

type TreasuryResponse = {
  totalBalanceAcbu: number;
  totalReserveExposureUsd: number;
  segments: {
    transactionsUsd: number;
    investmentSavingsUsd: number;
  };
  byCurrency: TreasuryByCurrencyRow[];
  message: string;
};

const treasuryCache = new Map<
  string,
  { expiresAt: number; value: TreasuryResponse }
>();

function decimalToNumber(value: DecimalLike): number {
  return value?.toNumber() ?? 0;
}

function getTreasuryCacheTtlMs(): number {
  const raw = process.env.GOVERNMENT_TREASURY_CACHE_TTL_MS;
  const parsed = raw ? Number(raw) : 15_000;
  if (!Number.isFinite(parsed) || parsed < 0) return 15_000;
  return Math.min(Math.max(0, Math.floor(parsed)), 300_000);
}

function getActorContext(req: AuthRequest): {
  userId: string | null;
  organizationId: string | null;
  cacheKey: string;
  transactionWhere: TransactionWhere;
} {
  const userId = req.apiKey?.userId ?? null;
  const organizationId = req.apiKey?.organizationId ?? null;

  if (!userId && !organizationId) {
    throw new AppError(
      "Government treasury requires a user or organization context",
      401,
    );
  }

  if (userId) {
    return {
      userId,
      organizationId,
      cacheKey: `government-treasury:user:${userId}`,
      transactionWhere: { userId },
    };
  }

  return {
    userId,
    organizationId,
    cacheKey: `government-treasury:org:${organizationId}`,
    transactionWhere: {
      OR: [
        { user: { organizationId } },
        { rateSnapshot: { path: ["organizationId"], equals: organizationId } },
      ],
    } as TransactionWhere,
  };
}

function getOrderedCurrencies(
  preferredOrder: string[],
  currencies: Iterable<string>,
): string[] {
  const remaining = new Set(currencies);
  const ordered: string[] = [];

  for (const currency of preferredOrder) {
    if (remaining.has(currency)) {
      ordered.push(currency);
      remaining.delete(currency);
    }
  }

  return [...ordered, ...[...remaining].sort()];
}

function getReserveValue(
  reserveByCurrencyAndSegment: Map<
    string,
    { reserveAmount: number; reserveValueUsd: number }
  >,
  currency: string,
  segment: string,
): { reserveAmount: number; reserveValueUsd: number } {
  return (
    reserveByCurrencyAndSegment.get(`${currency}:${segment}`) ?? {
      reserveAmount: 0,
      reserveValueUsd: 0,
    }
  );
}

export async function getGovernmentTreasury(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = getActorContext(req);
    const cached = treasuryCache.get(actor.cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      res.status(200).json(cached.value);
      return;
    }

    const [basket, transactions, latestReserves] = (await Promise.all([
      basketService.getCurrentBasket(),
      prisma.transaction.findMany({
        where: {
          ...actor.transactionWhere,
          type: { in: ["mint", "burn"] },
          status: { in: ["completed", "processing"] },
        },
        select: {
          type: true,
          localCurrency: true,
          localAmount: true,
          acbuAmount: true,
          acbuAmountBurned: true,
        },
      }),
      prisma.reserve.findMany({
        where: {
          segment: {
            in: [
              ReserveTracker.SEGMENT_TRANSACTIONS,
              ReserveTracker.SEGMENT_INVESTMENT_SAVINGS,
            ],
          },
        },
        orderBy: { timestamp: "desc" },
        distinct: ["currency", "segment"],
        select: {
          currency: true,
          segment: true,
          reserveAmount: true,
          reserveValueUsd: true,
        },
      }),
    ])) as [
      BasketEntry[],
      Array<{
        type: string;
        localCurrency: string | null;
        localAmount: DecimalLike;
        acbuAmount: DecimalLike;
        acbuAmountBurned: DecimalLike;
      }>,
      Array<{
        currency: string;
        segment: string;
        reserveAmount: { toNumber: () => number };
        reserveValueUsd: { toNumber: () => number };
      }>,
    ];

    const basketWeightByCurrency = new Map<string, number>(
      basket.map((entry: BasketEntry) => [entry.currency, entry.weight]),
    );

    const reserveByCurrencyAndSegment = new Map<
      string,
      { reserveAmount: number; reserveValueUsd: number }
    >();
    for (const reserve of latestReserves) {
      reserveByCurrencyAndSegment.set(
        `${reserve.currency}:${reserve.segment}`,
        {
          reserveAmount: reserve.reserveAmount.toNumber(),
          reserveValueUsd: reserve.reserveValueUsd.toNumber(),
        },
      );
    }

    const txByCurrency = new Map<
      string,
      {
        mintedAcbu: number;
        burnedAcbu: number;
        mintedLocalAmount: number;
        burnedLocalAmount: number;
      }
    >();

    let totalBalanceAcbu = 0;
    for (const transaction of transactions) {
      const mintedAcbu =
        transaction.type === "mint"
          ? decimalToNumber(transaction.acbuAmount)
          : 0;
      const burnedAcbu =
        transaction.type === "burn"
          ? decimalToNumber(transaction.acbuAmountBurned)
          : 0;
      totalBalanceAcbu += mintedAcbu - burnedAcbu;

      if (!transaction.localCurrency) continue;
      const current = txByCurrency.get(transaction.localCurrency) ?? {
        mintedAcbu: 0,
        burnedAcbu: 0,
        mintedLocalAmount: 0,
        burnedLocalAmount: 0,
      };
      current.mintedAcbu += mintedAcbu;
      current.burnedAcbu += burnedAcbu;
      if (transaction.type === "mint") {
        current.mintedLocalAmount += decimalToNumber(transaction.localAmount);
      }
      if (transaction.type === "burn") {
        current.burnedLocalAmount += decimalToNumber(transaction.localAmount);
      }
      txByCurrency.set(transaction.localCurrency, current);
    }

    const currencyUniverse = new Set<string>(
      basket.map((entry: BasketEntry) => entry.currency),
    );
    for (const currency of txByCurrency.keys()) currencyUniverse.add(currency);
    for (const reserve of latestReserves)
      currencyUniverse.add(reserve.currency);

    const byCurrency = getOrderedCurrencies(
      basket.map((entry: BasketEntry) => entry.currency),
      currencyUniverse,
    ).map((currency) => {
      const tx = txByCurrency.get(currency) ?? {
        mintedAcbu: 0,
        burnedAcbu: 0,
        mintedLocalAmount: 0,
        burnedLocalAmount: 0,
      };

      const txReserve = getReserveValue(
        reserveByCurrencyAndSegment,
        currency,
        ReserveTracker.SEGMENT_TRANSACTIONS,
      );
      const investmentReserve = getReserveValue(
        reserveByCurrencyAndSegment,
        currency,
        ReserveTracker.SEGMENT_INVESTMENT_SAVINGS,
      );

      return {
        currency,
        targetWeight: basketWeightByCurrency.get(currency) ?? null,
        mintedAcbu: tx.mintedAcbu,
        burnedAcbu: tx.burnedAcbu,
        netAcbu: tx.mintedAcbu - tx.burnedAcbu,
        mintedLocalAmount: tx.mintedLocalAmount,
        burnedLocalAmount: tx.burnedLocalAmount,
        reserveExposure: {
          transactions: txReserve.reserveAmount,
          investmentSavings: investmentReserve.reserveAmount,
          total: txReserve.reserveAmount + investmentReserve.reserveAmount,
        },
        reserveValueUsd: {
          transactions: txReserve.reserveValueUsd,
          investmentSavings: investmentReserve.reserveValueUsd,
          total: txReserve.reserveValueUsd + investmentReserve.reserveValueUsd,
        },
      };
    });

    const response: TreasuryResponse = {
      totalBalanceAcbu,
      totalReserveExposureUsd: byCurrency.reduce(
        (sum, row) => sum + row.reserveValueUsd.total,
        0,
      ),
      segments: {
        transactionsUsd: byCurrency.reduce(
          (sum, row) => sum + row.reserveValueUsd.transactions,
          0,
        ),
        investmentSavingsUsd: byCurrency.reduce(
          (sum, row) => sum + row.reserveValueUsd.investmentSavings,
          0,
        ),
      },
      byCurrency,
      message:
        "Government treasury exposure aggregated from basket configuration, transaction history, and reserve segments.",
    };

    treasuryCache.set(actor.cacheKey, {
      expiresAt: Date.now() + getTreasuryCacheTtlMs(),
      value: response,
    });

    res.status(200).json(response);
  } catch (e) {
    next(e);
  }
}

export async function getGovernmentStatements(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = getActorContext(req);
    const rawLimit = req.query.limit;
    let limit = 20;
    if (rawLimit !== undefined) {
      const parsed = Number(rawLimit);
      if (!Number.isNaN(parsed) && parsed > 0) {
        limit = Math.min(100, Math.max(1, Math.floor(parsed)));
      }
    }

    const transactions = await prisma.transaction.findMany({
      where: {
        ...actor.transactionWhere,
        type: { in: ["mint", "burn", "transfer"] },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        type: true,
        status: true,
        acbuAmount: true,
        acbuAmountBurned: true,
        usdcAmount: true,
        localCurrency: true,
        localAmount: true,
        fee: true,
        createdAt: true,
      },
    });

    res.status(200).json({
      statements: transactions,
      limit,
    });
  } catch (e) {
    next(e);
  }
}
