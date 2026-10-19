/**
 * Single source of truth for the ACBU Stellar asset (code + issuer).
 *
 * Every helper that builds or matches an ACBU asset should go through this
 * module so the platform never has multiple, independently-read copies of
 * STELLAR_ACBU_ASSET_CODE / STELLAR_ACBU_ASSET_ISSUER that can drift. If a
 * future org/env ever needs a different issuer, only this module changes and
 * all consumers (transfers, trustlines, balances, reserve supply) follow.
 *
 * Fail-fast contract: there is no silent native (XLM) fallback. Building an
 * ACBU asset without a configured issuer throws instead of moving the wrong
 * asset — transferring bare XLM when ACBU was requested misroutes funds.
 */
import { Asset, StrKey } from "@stellar/stellar-sdk";

const DEFAULT_CODE = "ACBU";
const CODE_PATTERN = /^[A-Z0-9]{1,12}$/;

export interface AcbuAssetConfig {
  code: string;
  issuer: string | null;
}

/** Read and validate the configured ACBU code + issuer. Never guesses. */
export function getAcbuAssetConfig(): AcbuAssetConfig {
  const code = (process.env.STELLAR_ACBU_ASSET_CODE || DEFAULT_CODE).trim().toUpperCase();
  const issuer = (process.env.STELLAR_ACBU_ASSET_ISSUER || "").trim() || null;

  if (!CODE_PATTERN.test(code)) {
    throw new Error(
      `Invalid ACBU asset code "${code}": must be 1-12 alphanumeric characters (STELLAR_ACBU_ASSET_CODE)`,
    );
  }
  if (issuer && !StrKey.isValidEd25519PublicKey(issuer)) {
    throw new Error(
      `Invalid ACBU asset issuer "${issuer}": not a valid Stellar public key (STELLAR_ACBU_ASSET_ISSUER)`,
    );
  }
  return { code, issuer };
}

/** ACBU asset code (normalized), e.g. "ACBU". */
export function getAcbuAssetCode(): string {
  return getAcbuAssetConfig().code;
}

/**
 * ACBU asset issuer. Throws when not configured instead of letting callers
 * silently infer an asset from a missing or wrong issuer.
 */
export function getAcbuIssuer(): string {
  const { issuer } = getAcbuAssetConfig();
  if (!issuer) {
    throw new Error("STELLAR_ACBU_ASSET_ISSUER is not configured");
  }
  return issuer;
}

/**
 * Full ACBU Stellar asset. Throws when the issuer is not configured rather
 * than silently falling back to native XLM.
 */
export function getAcbuAsset(): Asset {
  const { code, issuer } = getAcbuAssetConfig();
  if (!issuer) {
    throw new Error("STELLAR_ACBU_ASSET_ISSUER is not configured");
  }
  return new Asset(code, issuer);
}
