/**
 * Listens for events on acbu_lending_pool contract and enqueues ACBU_LENDING_POOL_EVENTS.
 */
import { eventListener, ContractEvent } from "../services/stellar/eventListener";
import { getContractAddresses } from "../config/contracts";
import { logger } from "../config/logger";
import { lendingPoolEventProducer } from "./producers";
import { extractAndValidateTxHash } from "../services/stellar/txHashValidation";
import type { LendingPoolEvent } from "../types/rabbitmq-schemas";

const LENDING_POOL_EFFECT_TYPES = [
  "contract_credited",
  "contract_debited",
  "contract_effect",
] as const;

type LendingPoolEffectType = (typeof LENDING_POOL_EFFECT_TYPES)[number];

function isLendingPoolEffectType(type: string): type is LendingPoolEffectType {
  return (LENDING_POOL_EFFECT_TYPES as readonly string[]).includes(type);
}

function sanitizeEventData(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const { txHash, valid } = extractAndValidateTxHash(data);
  if (txHash === null || !valid) {
    const sanitized = { ...data };
    delete sanitized.transaction_hash;
    delete sanitized.transaction_id;
    delete sanitized.tx_hash;
    return sanitized;
  }
  return data;
}

export async function startLendingPoolEventListener(): Promise<void> {
  const contractId = getContractAddresses().lendingPool;
  if (!contractId) {
    logger.info("Lending pool event listener skipped: no CONTRACT_LENDING_POOL configured");
    return;
  }

  const handler = async (event: ContractEvent): Promise<void> => {
    try {
      // listenToContractEvents (below) already filters to LENDING_POOL_EFFECT_TYPES
      // before invoking this handler, so this should be unreachable — narrow
      // explicitly anyway rather than casting past the compiler.
      if (!isLendingPoolEffectType(event.type)) {
        logger.warn("Lending pool event with unexpected type reached handler", {
          type: event.type,
          contractId: event.contractId,
          ledger: event.ledger,
        });
        return;
      }

      const rawData = (event.data || {}) as Record<string, unknown>;
      const { txHash, valid } = extractAndValidateTxHash(rawData);

      if (txHash !== null && !valid) {
        logger.warn("Lending pool event: rejecting event with unverified tx hash", {
          txHash,
          ledger: event.ledger,
          type: event.type,
        });
        return;
      }

      const sanitizedData = sanitizeEventData(rawData);

      const validatedEvent: LendingPoolEvent = {
        contractId: event.contractId,
        type: event.type,
        data: sanitizedData,
        ledger: event.ledger,
        timestamp: new Date(event.timestamp || Date.now()).toISOString(),
      };

      await lendingPoolEventProducer.publish(validatedEvent);

      logger.debug("Lending pool event enqueued with validation", {
        type: event.type,
        ledger: event.ledger,
      });
    } catch (error) {
      logger.error("Lending pool event enqueue failed", {
        error: error instanceof Error ? error.message : String(error),
        eventType: event.type,
        ledger: event.ledger,
      });
    }
  };

  eventListener.listenToContractEvents(
    contractId,
    [...LENDING_POOL_EFFECT_TYPES],
    handler,
  );
  logger.info("Lending pool event listener registered with validation", {
    contractId,
    effectTypes: LENDING_POOL_EFFECT_TYPES,
  });
}
