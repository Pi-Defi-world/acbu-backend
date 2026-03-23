import { Request, Response, NextFunction } from "express";
import { acbuSavingsVaultService } from "../services/contracts";
import { contractAddresses } from "../config/contracts";
import type { AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import {
  isSavingsLockDate,
  getNextSavingsWithdrawalDate,
  getApyForTerm,
} from "../config/savings";

export async function postSavingsDeposit(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.apiKey?.userId;

    if (!userId) {
      throw new AppError("Authenticated user ID required for savings", 401);
    }

    const { amount, term_seconds } = authReq.body || {};
    if (!amount || term_seconds == null) {
      throw new AppError("amount and term_seconds required", 400);
    }
    if (!contractAddresses.savingsVault) {
      throw new AppError("Savings vault contract not configured", 503);
    }
    const result = await acbuSavingsVaultService.deposit({
      user: userId,
      amount: String(amount),
      termSeconds: Number(term_seconds),
    });
    res.status(200).json({
      transaction_hash: result.transactionHash,
      new_balance: result.newBalance,
    });
  } catch (e) {
    next(e);
  }
}

export async function postSavingsWithdraw(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (isSavingsLockDate()) {
      const nextDate = getNextSavingsWithdrawalDate();
      res.status(403).json({
        error: "Savings locked",
        code: "SAVINGS_LOCK_DATE",
        message:
          "Savings withdrawals are not allowed on this date. Next available withdrawal date below.",
        next_available_withdrawal_date: nextDate.toISOString().slice(0, 10),
      });
      return;
    }
    const authReq = req as AuthRequest;
    const userId = authReq.apiKey?.userId;

    if (!userId) {
      throw new AppError("Authenticated user ID required for savings", 401);
    }

    const { term_seconds, amount } = authReq.body || {};
    if (term_seconds == null || !amount) {
      throw new AppError("term_seconds and amount required", 400);
    }
    if (!contractAddresses.savingsVault) {
      throw new AppError("Savings vault contract not configured", 503);
    }
    const txHash = await acbuSavingsVaultService.withdraw({
      user: userId,
      termSeconds: Number(term_seconds),
      amount: String(amount),
    });
    res.status(200).json({ transaction_hash: txHash });
  } catch (e) {
    next(e);
  }
}

export async function getSavingsPositions(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.apiKey?.userId;

    if (!userId) {
      throw new AppError("Authenticated user ID required for savings", 401);
    }

    const termSeconds = authReq.query?.term_seconds as string;
    if (!contractAddresses.savingsVault) {
      throw new AppError("Savings vault contract not configured", 503);
    }
    const balance = await acbuSavingsVaultService.getBalance(
      userId,
      termSeconds != null ? Number(termSeconds) : 0,
    );
    const termSec = termSeconds != null ? Number(termSeconds) : 0;
    const apy = getApyForTerm(termSec);
    const nextDate = getNextSavingsWithdrawalDate();
    res.status(200).json({
      user: userId,
      term_seconds: termSec || null,
      balance,
      apy_percent: apy,
      next_available_withdrawal_date: isSavingsLockDate()
        ? nextDate.toISOString().slice(0, 10)
        : null,
    });
  } catch (e) {
    next(e);
  }
}

/** GET /savings/next-withdrawal-date - When is the next date withdrawals are allowed. */
export async function getNextWithdrawalDate(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const nextDate = getNextSavingsWithdrawalDate();
    res.status(200).json({
      next_available_withdrawal_date: nextDate.toISOString().slice(0, 10),
      is_locked_today: isSavingsLockDate(),
    });
  } catch (e) {
    next(e);
  }
}
