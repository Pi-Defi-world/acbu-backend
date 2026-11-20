import { Response, NextFunction } from "express";
import { acbuLendingPoolService } from "../services/contracts";
import { getContractAddresses } from "../config/contracts";
import type { AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";

export async function postLendingDeposit(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { lender, amount } = req.body || {};
    if (!lender || !amount) {
      throw new AppError("lender and amount required", 400);
    }
    if (!getContractAddresses().lendingPool) {
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
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { lender, amount } = req.body || {};
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
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const lender = req.query?.lender as string;
    if (!lender) {
      throw new AppError("query lender required", 400);
    }
    if (!getContractAddresses().lendingPool) {
      throw new AppError("Lending pool contract not configured", 503);
    }
    const balance = await acbuLendingPoolService.getBalance(lender);
    res.status(200).json({ lender, balance });
  } catch (e) {
    next(e);
  }
}

export async function postLendingBorrow(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { borrower, lender, amount, collateralAmount, loanId } = req.body || {};
    if (!borrower || !lender || !amount || !collateralAmount || loanId === undefined) {
      throw new AppError(
        "borrower, lender, amount, collateralAmount, and loanId required",
        400,
      );
    }
    if (!getContractAddresses().lendingPool) {
      throw new AppError("Lending pool contract not configured", 503);
    }
    const txHash = await acbuLendingPoolService.borrow({
      borrower,
      lender,
      amount: String(amount),
      collateralAmount: String(collateralAmount),
      loanId: Number(loanId),
    });
    res.status(200).json({ transaction_hash: txHash });
  } catch (e) {
    next(e);
  }
}

export async function postLendingRepay(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { borrower, amount, loanId } = req.body || {};
    if (!borrower || !amount || loanId === undefined) {
      throw new AppError("borrower, amount, and loanId required", 400);
    }
    if (!getContractAddresses().lendingPool) {
      throw new AppError("Lending pool contract not configured", 503);
    }
    const txHash = await acbuLendingPoolService.repay({
      borrower,
      amount: String(amount),
      loanId: Number(loanId),
    });
    res.status(200).json({ transaction_hash: txHash });
  } catch (e) {
    next(e);
  }
}

export async function postLendingLiquidate(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { liquidator, borrower, loanId } = req.body || {};
    if (!liquidator || !borrower || loanId === undefined) {
      throw new AppError("liquidator, borrower, and loanId required", 400);
    }
    if (!getContractAddresses().lendingPool) {
      throw new AppError("Lending pool contract not configured", 503);
    }
    const txHash = await acbuLendingPoolService.liquidate({
      liquidator,
      borrower,
      loanId: Number(loanId),
    });
    res.status(200).json({ transaction_hash: txHash });
  } catch (e) {
    next(e);
  }
}
