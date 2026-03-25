/**
 * Transfer service: resolve alias to stellarAddress, create Transaction, optionally submit Stellar payment.
 * Uses direct wallets (G...). When getSenderSigningKey is provided, signs and submits; otherwise leaves pending.
 */
import { Operation, Asset, Keypair, TransactionBuilder } from "stellar-sdk";
import { prisma } from "../../config/database";
import { stellarClient } from "../stellar/client";
import { getBaseFee } from "../stellar/feeManager";
import { resolveRecipientToStellarAddress } from "../recipient/recipientResolver";
import { logger } from "../../config/logger";
import type {
  CreateTransferParams,
  CreateTransferOptions,
  CreateTransferResult,
} from "./types";

/** ACBU asset: use native when issuer not configured. Set STELLAR_ACBU_ASSET_ISSUER for custom asset. */
function getAcbuAsset(): Asset {
  const issuer = process.env.STELLAR_ACBU_ASSET_ISSUER;
  if (issuer) {
    return new Asset("ACBU", issuer);
  }
  return Asset.native();
}

/**
 * Build, sign with sender key, and submit a Stellar payment. Returns hash or throws.
 */
async function submitStellarPayment(
  sourceSecretKey: string,
  destinationAddress: string,
  amountAcbu: string,
  asset: Asset,
): Promise<string> {
  const keypair = Keypair.fromSecret(sourceSecretKey);
  const sourceAccountId = keypair.publicKey();
  const server = stellarClient.getServer();
  const networkPassphrase = stellarClient.getNetworkPassphrase();
  const sourceAccount = await server.loadAccount(sourceAccountId);
  const op = Operation.payment({
    destination: destinationAddress,
    asset,
    amount: amountAcbu,
  });
  const builder = new TransactionBuilder(sourceAccount, {
    fee: await getBaseFee(),
    networkPassphrase,
  }).addOperation(op);
  const transaction = builder.build();
  transaction.sign(keypair);
  const result = await server.submitTransaction(transaction);
  return result.hash;
}

/**
 * Create a transfer: resolve recipient, create Transaction row, optionally submit Stellar payment.
 * When getSenderSigningKey is not provided or returns null, status remains 'pending'.
 */
export async function createTransfer(
  params: CreateTransferParams,
  options?: CreateTransferOptions,
): Promise<CreateTransferResult> {
  const { senderUserId, to } = params;
  const amount = params.amountAcbu.trim();
  // Reject scientific notation and enforce up to 7 decimal places (Stellar max precision)
  if (!amount || !/^\d+(\.\d{1,7})?$/.test(amount) || Number(amount) <= 0) {
    throw new Error(
      "amount_acbu must be a positive number with up to 7 decimal places",
    );
  }

  const sender = await prisma.user.findUnique({
    where: { id: senderUserId },
    select: { stellarAddress: true, kycStatus: true },
  });
  if (!sender) {
    throw new Error("Sender user not found");
  }
  if (sender.kycStatus !== "verified") {
    throw new Error(
      "KYC required to make payments. Complete verification first.",
    );
  }

  const recipientAddress = await resolveRecipientToStellarAddress(
    to,
    senderUserId,
  );
  if (!recipientAddress) {
    throw new Error("Recipient not found or not available");
  }

  // Prevent self-transfer
  if (sender.stellarAddress && recipientAddress === sender.stellarAddress) {
    throw new Error("Cannot transfer to yourself");
  }

  const tx = await prisma.transaction.create({
    data: {
      userId: senderUserId,
      type: "transfer",
      status: "pending",
      recipientAddress,
      acbuAmount: amount,
    },
  });

  let status = "pending";
  let blockchainTxHash: string | null = null;

  const getKey = options?.getSenderSigningKey;
  if (getKey) {
    const secretKey = await getKey(senderUserId);
    if (secretKey) {
      try {
        const asset = getAcbuAsset();
        blockchainTxHash = await submitStellarPayment(
          secretKey,
          recipientAddress,
          amount,
          asset,
        );
        status = "completed";
        await prisma.transaction.update({
          where: { id: tx.id },
          data: {
            status: "completed",
            blockchainTxHash,
            completedAt: new Date(),
          },
        });
        logger.info("Transfer completed", {
          transactionId: tx.id,
          blockchainTxHash,
          senderUserId,
        });
      } catch (err) {
        logger.error("Transfer Stellar submission failed", {
          transactionId: tx.id,
          senderUserId,
          error: err,
        });
        status = "failed";
        await prisma.transaction.update({
          where: { id: tx.id },
          data: { status: "failed" },
        });
      }
    }
  }

  return {
    transactionId: tx.id,
    status,
  };
}
