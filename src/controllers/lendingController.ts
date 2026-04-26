import { Request, Response, NextFunction } from "express";
import { acbuLendingPoolService } from "../services/contracts";
import { contractAddresses } from "../config/contracts";
import type { AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";

export async function postLendingDeposit(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { lender, amount } = (req as AuthRequest).body || {};
    if (!lender || !amount) {
      throw new AppError("lender and amount required", 400);
    }
    if (!contractAddresses.lendingPool) {
      throw new AppError("Lending pool contract not configured", 503);
    }
    const result = await acbuLendingPoolService.deposit({
      lender,
      amount: String(amount),
    });
    res.status(200).json({
      transaction_hash: result.transactionHash,
      new_balance: result.newBalance,
    });
  } catch (e) {
    next(e);
  }
}

export async function postLendingWithdraw(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { lender, amount } = (req as AuthRequest).body || {};
    if (!lender || !amount) {
      throw new AppError("lender and amount required", 400);
    }
    const txHash = await acbuLendingPoolService.withdraw({
      lender,
      amount: String(amount),
    });
    res.status(200).json({ transaction_hash: txHash });
  } catch (e) {
    next(e);
  }
}

export async function getLendingBalance(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const lender = (req as AuthRequest).query?.lender as string;
    if (!lender) {
      throw new AppError("query lender required", 400);
    }
    if (!contractAddresses.lendingPool) {
      throw new AppError("Lending pool contract not configured", 503);
    }
    const balance = await acbuLendingPoolService.getBalance(lender);
    res.status(200).json({ lender, balance });
  } catch (e) {
    next(e);
  }
}
