/**
 * Shared parsers for Horizon contract_credited / contract_debited effects.
 *
 * Prefer these helpers over ad-hoc field extraction in individual listeners.
 * Live payloads do not include recipient/to/value/transaction_hash on the
 * effect body — only amount, account, contract, and an operation link.
 */

import type {
  HorizonContractBalanceEffect,
  HorizonContractEffectType,
  ParsedContractBalanceEffect,
} from "./horizonEffectTypes";

const CONTRACT_EFFECT_TYPES = new Set<string>(["contract_credited", "contract_debited"]);

export function isHorizonContractBalanceEffect(
  data: unknown,
): data is HorizonContractBalanceEffect {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.type === "string" &&
    CONTRACT_EFFECT_TYPES.has(d.type) &&
    typeof d.account === "string" &&
    typeof d.contract === "string" &&
    typeof d.amount === "string"
  );
}

/**
 * Parse a raw Horizon effect (or ContractEvent.data) into a stable shape.
 * Returns null when required fields are missing or the type is not a
 * contract balance effect.
 */
export function parseHorizonContractBalanceEffect(
  data: unknown,
): ParsedContractBalanceEffect | null {
  if (!isHorizonContractBalanceEffect(data)) return null;

  const operationHref = data._links?.operation?.href;
  const operationId = operationHref ? operationHref.split("/").filter(Boolean).pop() : undefined;

  return {
    effectId: data.id,
    type: data.type as HorizonContractEffectType,
    account: data.account,
    contract: data.contract,
    amount: data.amount,
    assetType: data.asset_type,
    assetCode: data.asset_code,
    assetIssuer: data.asset_issuer,
    operationId: operationId && /^\d+$/.test(operationId) ? operationId : undefined,
  };
}

/**
 * Extract Horizon operation id from an effect for follow-up transaction
 * hash resolution. Prefer this over reading transaction_hash from the
 * effect body (it is typically absent).
 */
export function getOperationIdFromEffect(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const links = (data as Record<string, unknown>)._links as
    | Record<string, { href?: string }>
    | undefined;
  const href = links?.operation?.href;
  if (typeof href !== "string") return null;
  const id = href.split("/").filter(Boolean).pop();
  return id && /^\d+$/.test(id) ? id : null;
}

/**
 * Best-effort amount extraction for older call sites that still accept
 * loosely-shaped effect data. Prefer parseHorizonContractBalanceEffect.
 */
export function parseAmountFromEffectData(data: Record<string, unknown>): string | null {
  const amount = data.amount ?? data.value;
  if (typeof amount === "string") return amount;
  if (typeof amount === "number") return String(amount);
  return null;
}

/**
 * Best-effort account extraction. Live contract_* effects expose `account`.
 */
export function parseAccountFromEffectData(data: Record<string, unknown>): string | null {
  const account = data.account ?? data.recipient ?? data.to;
  if (typeof account === "string" && account.length >= 56) return account;
  return null;
}
