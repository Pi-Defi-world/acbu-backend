import { Response, NextFunction } from "express";
import { z } from "zod";
import { AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import {
  createValidatorReward,
  getValidatorRewards,
} from "../services/kyc/kycValidatorRewardService";

const createRewardSchema = z.object({
  validator_id: z.string().uuid(),
  application_id: z.string().uuid(),
  acbu_amount: z.string().regex(/^[1-9]\d*$/, "Must be a positive integer string"),
  tx_hash: z.string().optional(),
});

export async function createReward(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = createRewardSchema.parse(req.body);
    const result = await createValidatorReward({
      validatorId: body.validator_id,
      applicationId: body.application_id,
      acbuAmount: body.acbu_amount,
      txHash: body.tx_hash,
    });
    res.status(201).json(result);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return next(new AppError(e.errors.map((x) => x.message).join("; "), 400));
    }
    next(e);
  }
}

export async function listRewards(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const validatorId = req.params.validatorId;
    if (!validatorId) {
      throw new AppError("validatorId parameter required", 400);
    }
    const rewards = await getValidatorRewards(validatorId);
    res.status(200).json({ rewards });
  } catch (e) {
    next(e);
  }
}
