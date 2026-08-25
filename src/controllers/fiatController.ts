import { Response, NextFunction } from "express";
import { z } from "zod";
import { AuthRequest } from "../middleware/auth";
import {
  requestFaucet,
  getBankAccounts,
  simulateOnRamp,
  simulateOffRamp,
  type FiatAccountView,
} from "../services/fiat/fiatService";
import { AppError } from "../middleware/errorHandler";
import { TrustlineMissingError } from "../errors/index";

export const faucetSchema = z.object({
  currency: z.string().min(3).max(3),
  amount: z.number().positive(),
  recipient: z.string().optional(),
  passcode: z.string().optional(),
});

export const onRampSchema = z.object({
  currency: z.string().min(3).max(3),
  amount: z.number().positive(),
  passcode: z.string().optional(),
});

export const offRampSchema = z.object({
  currency: z.string().min(3).max(3),
  amount: z.number().positive(),
  blockchain_tx_hash: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/, "blockchain_tx_hash must be a 64-char hex hash")
    .optional(),
});

function serializeFiatAccount(acc: FiatAccountView) {
  return {
    id: acc.id,
    currency: acc.currency,
    balance: acc.balance,
    usd_equivalent: acc.usd_equivalent,
    bank_name: acc.bank_name,
    account_number: acc.account_number,
    account_name: acc.account_number,
    ledger_entries: acc.ledger_entries,
  };
}

export async function postFaucet(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.apiKey?.userId;
    if (!userId) return next(new AppError("User not found in API key", 401));

    const body = faucetSchema.parse(req.body);
    const result = await requestFaucet(
      userId,
      body.currency.toUpperCase(),
      body.amount,
      body.recipient,
      body.passcode,
    );

    res.status(200).json(result);
  } catch (e) {
    if (e instanceof z.ZodError) {
      const msg = e.errors.map((x) => x.message).join("; ");
      return next(new AppError(msg, 400));
    }
    if (e instanceof TrustlineMissingError) {
      return next(
        new AppError(
          "Your wallet is missing a trustline for this demo currency (SAC). Add a trustline for the asset (e.g. NGN:GDHO63...) in your wallet, then retry the faucet.",
          400,
        ),
      );
    }
    next(e);
  }
}

export async function postOnRamp(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.apiKey?.userId;
    if (!userId) return next(new AppError("User not found in API key", 401));

    const body = onRampSchema.parse(req.body);
    const result = await simulateOnRamp(
      userId,
      body.currency.toUpperCase(),
      body.amount,
      body.passcode,
    );

    res.status(200).json(result);
  } catch (e) {
    if (e instanceof z.ZodError) {
      const msg = e.errors.map((x) => x.message).join("; ");
      return next(new AppError(msg, 400));
    }
    if (e instanceof TrustlineMissingError) {
      return next(
        new AppError(
          "Recipient wallet is missing the ACBU trustline. Add trustline for ACBU first, then retry on-ramp mint.",
          400,
        ),
      );
    }
    next(e);
  }
}

export async function postOffRamp(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.apiKey?.userId;
    if (!userId) return next(new AppError("User not found in API key", 401));

    const body = offRampSchema.parse(req.body);
    const result = await simulateOffRamp(
      userId,
      body.currency.toUpperCase(),
      body.amount,
      body.blockchain_tx_hash,
    );

    res.status(200).json(result);
  } catch (e) {
    if (e instanceof z.ZodError) {
      const msg = e.errors.map((x) => x.message).join("; ");
      return next(new AppError(msg, 400));
    }
    next(e);
  }
}

export async function getAccounts(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.apiKey?.userId;
    if (!userId) return next(new AppError("User not found in API key", 401));

    const accounts = await getBankAccounts(userId);
    res.status(200).json({
      mode: "on_chain",
      accounts: accounts.map(serializeFiatAccount),
    });
  } catch (e) {
    next(e);
  }
}
