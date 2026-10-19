/**
 * Listens for BurnEvent (contract_debited) on acbu_burning contract and enqueues WITHDRAWAL_PROCESSING jobs.
 */
import { eventListener, ContractEvent } from "../services/stellar/eventListener";
import { getContractAddresses } from "../config/contracts";
import { enqueueWithdrawalProcessing } from "./withdrawalProcessingJob";
import { logger } from "../config/logger";
import { prisma } from "../config/database";
import { resolveTxHash, verifyTxHashOnChain } from "../services/stellar/txHashValidation";

const BURN_EFFECT_TYPES = ["contract_debited", "contract_effect"];

async function findTransactionByBlockchainHash(txHash: string): Promise<string | null> {
  const tx = await prisma.transaction.findFirst({
    where: {
      type: "burn",
      blockchainTxHash: txHash,
      status: { in: ["pending", "processing"] },
    },
    select: { id: true },
  });
  return tx?.id ?? null;
}

export async function startBurnEventListener(): Promise<void> {
  const burningContractId = getContractAddresses().burning;
  if (!burningContractId) {
    logger.info("Burn event listener skipped: no CONTRACT_BURNING configured");
    return;
  }

  const handler = async (event: ContractEvent): Promise<void> => {
    const data = (event.data || {}) as Record<string, unknown>;

    // Horizon contract_debited effects carry no transaction hash in the effect
    // body, so resolve it from the referenced operation. If nothing verifiable
    // can be resolved the event is dropped — a synthetic id would be unusable
    // for correlating against the transaction ledger.
    const { txHash, verified } = await resolveTxHash(data);
    if (!verified || txHash === null) {
      logger.debug("Burn event: no resolvable blockchain tx hash, skipping enqueue", {
        ledger: event.ledger,
        type: event.type,
      });
      return;
    }

    const onChainValid = await verifyTxHashOnChain(txHash);
    if (!onChainValid) {
      logger.warn("Burn event: rejecting event — tx hash not found on-chain", {
        txHash,
        ledger: event.ledger,
      });
      return;
    }

    const transactionId = await findTransactionByBlockchainHash(txHash);
    if (!transactionId) {
      logger.debug("Burn event: no pending/processing burn transaction for hash", {
        txHash,
      });
      return;
    }

    await enqueueWithdrawalProcessing({ transactionId, txHash });
  };

  eventListener.listenToContractEvents(burningContractId, BURN_EFFECT_TYPES, handler);
  logger.info("Burn event listener registered", {
    contractId: burningContractId,
    effectTypes: BURN_EFFECT_TYPES,
  });
}
