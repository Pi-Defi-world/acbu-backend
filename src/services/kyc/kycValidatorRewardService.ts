import { prisma } from "../../config/database";
import { logger } from "../../config/logger";
import { acbuMintingService } from "../contracts";
import { AppError } from "../../middleware/errorHandler";

export const MAX_REWARD_ACBU = "1000";
export const REWARD_DECIMALS = 7;

export interface CreateRewardParams {
  validatorId: string;
  applicationId: string;
  acbuAmount: string;
  txHash?: string;
}

export interface KycRewardValidationResult {
  valid: boolean;
  onChainTotalMinted: string;
  rewardAmount: string;
  maxAllowed: string;
  reason?: string;
}

const MAX_REWARD_PCT_OF_MINTED = 5n;

async function getOnChainTotalMinted(): Promise<string> {
  return acbuMintingService.getTotalSupply();
}

export async function validateRewardAmount(acbuAmount: string): Promise<KycRewardValidationResult> {
  const rewardAmount = BigInt(acbuAmount);
  const onChainTotalRaw = await getOnChainTotalMinted();
  const onChainTotal = BigInt(onChainTotalRaw);
  const maxAllowed = BigInt(MAX_REWARD_ACBU) * BigInt(10 ** REWARD_DECIMALS);

  if (rewardAmount <= BigInt(0)) {
    return {
      valid: false,
      onChainTotalMinted: onChainTotal.toString(),
      rewardAmount: acbuAmount,
      maxAllowed: maxAllowed.toString(),
      reason: "Reward amount must be positive",
    };
  }

  if (rewardAmount > maxAllowed) {
    return {
      valid: false,
      onChainTotalMinted: onChainTotal.toString(),
      rewardAmount: acbuAmount,
      maxAllowed: maxAllowed.toString(),
      reason: `Reward ${acbuAmount} exceeds max allowed ${maxAllowed.toString()}`,
    };
  }

  if (onChainTotal <= BigInt(0)) {
    return {
      valid: false,
      onChainTotalMinted: "0",
      rewardAmount: acbuAmount,
      maxAllowed: maxAllowed.toString(),
      reason: "On-chain mint total is zero - cannot verify reward",
    };
  }

  const maxRewardBasedOnMinted = (onChainTotal * MAX_REWARD_PCT_OF_MINTED) / 100n;
  if (rewardAmount > maxRewardBasedOnMinted) {
    return {
      valid: false,
      onChainTotalMinted: onChainTotal.toString(),
      rewardAmount: acbuAmount,
      maxAllowed: maxAllowed.toString(),
      reason: `Reward ${acbuAmount} exceeds ${MAX_REWARD_PCT_OF_MINTED}% of on-chain minted total (${maxRewardBasedOnMinted.toString()})`,
    };
  }

  return {
    valid: true,
    onChainTotalMinted: onChainTotal.toString(),
    rewardAmount: acbuAmount,
    maxAllowed: maxAllowed.toString(),
  };
}

export async function createValidatorReward(params: CreateRewardParams): Promise<{
  id: string;
  acbuAmount: string;
  status: string;
  verificationRef: string;
}> {
  const validation = await validateRewardAmount(params.acbuAmount);
  if (!validation.valid) {
    throw new AppError(`Reward validation failed: ${validation.reason}`, 400);
  }

  const reward = await prisma.kycValidatorReward.create({
    data: {
      validatorId: params.validatorId,
      applicationId: params.applicationId,
      acbuAmount: params.acbuAmount,
      txHash: params.txHash,
      status: "pending",
    },
    select: {
      id: true,
      acbuAmount: true,
      status: true,
      createdAt: true,
    },
  });

  logger.info("KYC validator reward created with on-chain verification", {
    rewardId: reward.id,
    validatorId: params.validatorId,
    applicationId: params.applicationId,
    acbuAmount: params.acbuAmount,
    onChainVerified: validation.onChainTotalMinted,
  });

  return {
    id: reward.id,
    acbuAmount: reward.acbuAmount.toString(),
    status: reward.status,
    verificationRef: `onchain_${validation.onChainTotalMinted}`,
  };
}

export async function getValidatorRewards(
  validatorId: string,
): Promise<Array<{ id: string; acbuAmount: string; status: string; createdAt: Date }>> {
  const rewards = await prisma.kycValidatorReward.findMany({
    where: { validatorId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      acbuAmount: true,
      status: true,
      createdAt: true,
    },
  });

  return rewards.map(
    (r: {
      id: string;
      acbuAmount: { toString: () => string };
      status: string;
      createdAt: Date;
    }) => ({
      ...r,
      acbuAmount: r.acbuAmount.toString(),
    }),
  );
}
