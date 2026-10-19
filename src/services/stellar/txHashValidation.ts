import { logger } from "../../config/logger";
import { stellarClient } from "./client";

const STELLAR_TX_HASH_REGEX = /^[a-f0-9]{64}$/i;

export function isValidStellarTxHash(hash: string): boolean {
  return typeof hash === "string" && STELLAR_TX_HASH_REGEX.test(hash);
}

export function extractTxHashFromEffect(data: Record<string, unknown>): string | null {
  const raw = data.transaction_hash ?? data.transaction_id ?? data.tx_hash;
  if (typeof raw === "string" && isValidStellarTxHash(raw)) {
    return raw;
  }

  const links = data._links as Record<string, { href?: string }> | undefined;
  const txHref = links?.transaction?.href;
  if (typeof txHref === "string") {
    const match = txHref.match(/\/([a-f0-9]{64})$/i);
    if (match) return match[1];
  }

  return null;
}

export function extractAndValidateTxHash(data: Record<string, unknown>): {
  txHash: string | null;
  valid: boolean;
} {
  const txHash = extractTxHashFromEffect(data);
  if (txHash === null) {
    return { txHash: null, valid: true };
  }
  return { txHash, valid: isValidStellarTxHash(txHash) };
}

/**
 * Resolve the real transaction hash for an effect by fetching its operation
 * from Horizon. Horizon contract_credited / contract_debited effects do NOT
 * carry transaction_hash on the effect body; the canonical source is the
 * operation resource referenced via _links.operation.
 */
export async function resolveTxHashFromOperation(operationId: string): Promise<string | null> {
  try {
    const op = await (stellarClient
      .getServer()
      .operations()
      .operation(operationId)
      .call() as Promise<{ transaction_hash?: string }>);

    const hash = op.transaction_hash;
    if (typeof hash === "string" && isValidStellarTxHash(hash)) {
      return hash;
    }
    return null;
  } catch (error) {
    logger.warn("Failed to resolve tx hash from Horizon operation", {
      operationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Extract operation id from _links.operation.href on a Horizon effect.
 */
export function getOperationIdFromEffectData(data: Record<string, unknown>): string | null {
  const links = data._links as Record<string, { href?: string }> | undefined;
  const href = links?.operation?.href;
  if (typeof href !== "string") return null;
  const id = href.split("/").filter(Boolean).pop();
  return id && /^\d+$/.test(id) ? id : null;
}

/**
 * Full resolution: try direct extraction first, fall back to operation lookup.
 * Returns the validated tx hash and whether it was chain-verified.
 */
export async function resolveTxHash(
  data: Record<string, unknown>,
): Promise<{ txHash: string | null; verified: boolean }> {
  const direct = extractTxHashFromEffect(data);
  if (direct) {
    return { txHash: direct, verified: true };
  }

  const opId = getOperationIdFromEffectData(data);
  if (opId) {
    const resolved = await resolveTxHashFromOperation(opId);
    if (resolved) {
      return { txHash: resolved, verified: true };
    }
  }

  return { txHash: null, verified: false };
}

/**
 * Verify a transaction hash exists on the Stellar network.
 */
export async function verifyTxHashOnChain(txHash: string): Promise<boolean> {
  if (!isValidStellarTxHash(txHash)) return false;
  try {
    await stellarClient.getTransaction(txHash);
    return true;
  } catch {
    return false;
  }
}
