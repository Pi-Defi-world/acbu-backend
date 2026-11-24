/**
 * Canonical types for Horizon contract balance effects.
 *
 * These map to Horizon effect types 96 (contract_credited) and 97
 * (contract_debited), which surface SAC-related balance changes.
 *
 * Shape verified against live Horizon testnet + mainnet responses (2026-08-22)
 * and go-stellar-sdk protocols/horizon/effects.ContractCredited|ContractDebited.
 */

/** Horizon contract effect type names ACBU currently consumes */
export type HorizonContractEffectType = "contract_credited" | "contract_debited";

/**
 * Live Horizon JSON shape for contract_credited / contract_debited.
 *
 * Important: transaction_hash is NOT present on the effect body.
 * Resolve it via `_links.operation` → operation resource → transaction_hash.
 */
export interface HorizonContractBalanceEffect {
  id: string;
  paging_token: string;
  account: string;
  type: HorizonContractEffectType;
  type_i: 96 | 97;
  created_at: string;
  asset_type: "native" | "credit_alphanum4" | "credit_alphanum12";
  asset_code?: string;
  asset_issuer?: string;
  contract: string;
  amount: string;
  _links?: {
    operation?: { href?: string };
    succeeds?: { href?: string };
    precedes?: { href?: string };
  };
}

/** Stable internal representation used by listeners and jobs */
export interface ParsedContractBalanceEffect {
  effectId: string;
  type: HorizonContractEffectType;
  account: string;
  contract: string;
  amount: string;
  assetType: string;
  assetCode?: string;
  assetIssuer?: string;
  /** Horizon operation id extracted from _links.operation when present */
  operationId?: string;
  /** Only set after caller resolves operation → transaction */
  transactionHash?: string;
}
