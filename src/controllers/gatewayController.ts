import { Response, NextFunction } from "express";
import { acbuEscrowService } from "../services/contracts";
import { getContractAddresses } from "../config/contracts";
import type { AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";

export async function postGatewayCharge(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { payer, payee, amount, escrow_id } = req.body || {};
    if (!payer || !payee || !amount || escrow_id == null) {
      throw new AppError("payer, payee, amount, and escrow_id required", 400);
    }
    if (!getContractAddresses().escrow) {
      throw new AppError("Escrow contract not configured", 503);
    }
    const txHash = await acbuEscrowService.create({
      payer,
      payee,
      amount: String(amount),
      escrowId: Number(escrow_id),
    });
    res.status(200).json({ transaction_hash: txHash, escrow_id: Number(escrow_id) });
  } catch (e) {
    next(e);
  }
}

export async function postGatewayConfirm(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { escrow_id, action } = req.body || {};
    if (escrow_id == null) {
      throw new AppError("escrow_id required", 400);
    }
    if (!getContractAddresses().escrow) {
      throw new AppError("Escrow contract not configured", 503);
    }
    if (action === "release") {
      const payer = req.body?.payer;
      if (!payer) throw new AppError("payer required for release", 400);
      const txHash = await acbuEscrowService.release(Number(escrow_id), payer);
      res.status(200).json({ transaction_hash: txHash, action: "release" });
    } else if (action === "refund") {
      const payer = req.body?.payer;
      if (!payer) throw new AppError("payer required for refund", 400);
      const txHash = await acbuEscrowService.refund({
        escrowId: Number(escrow_id),
        payer,
      });
      res.status(200).json({ transaction_hash: txHash, action: "refund" });
    } else {
      throw new AppError("action must be release or refund", 400);
    }
  } catch (e) {
    next(e);
  }
}
