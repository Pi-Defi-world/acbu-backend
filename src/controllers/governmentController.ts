/**
 * Government segment: treasury view and statements.
 * For government actors (actorType === 'government'); reuse enterprise-style aggregates.
 */
import { Response, NextFunction } from "express";
import { prisma } from "../config/database";
import { AuthRequest } from "../middleware/auth";

export async function getGovernmentTreasury(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.apiKey?.userId ?? null;
    const organizationId = req.apiKey?.organizationId ?? null;
    // TODO: aggregate from transactions for this org/user (government); reserve exposure
    const minted = await prisma.transaction.aggregate({
      where: {
        type: "mint",
        status: "completed",
        ...(userId ? { userId } : { user: { organizationId } }),
      },
      _sum: { acbuAmount: true },
    });
    const burned = await prisma.transaction.aggregate({
      where: {
        type: "burn",
        status: { in: ["completed", "processing"] },
        ...(userId ? { userId } : { user: { organizationId } }),
      },
      _sum: { acbuAmountBurned: true },
    });
    const totalAcbu =
      (minted._sum.acbuAmount?.toNumber() ?? 0) -
      (burned._sum.acbuAmountBurned?.toNumber() ?? 0);
    res.status(200).json({
      totalBalanceAcbu: totalAcbu,
      byCurrency: [],
      message:
        "Government treasury view. Investment allocation and yield will appear when implemented.",
    });
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
    const userId = req.apiKey?.userId ?? null;
    const organizationId = req.apiKey?.organizationId ?? null;
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
        type: { in: ["mint", "burn", "transfer"] },
        ...(userId ? { userId } : { user: { organizationId } }),
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
