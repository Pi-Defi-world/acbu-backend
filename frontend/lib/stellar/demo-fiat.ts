import { Asset } from "@stellar/stellar-sdk";

/**
 * Issuer bundled with the repository for local development and testnet.
 *
 * This key is only meant for the demo fiat currencies. ACBU is a different
 * asset: its SAC is bound to the issuer the deployed minting contract was
 * built with, so ACBU must never reuse this value as a fallback.
 */
export const DEMO_FIAT_ISSUER =
  process.env.NEXT_PUBLIC_DEMO_FIAT_ISSUER ??
  // Default to current dev issuer used by backend (.env STELLAR_ACBU_ASSET_ISSUER)
  "GDHO63RZEUNDRVF6WA7HD4D7PLNLUMSK5H74ONW3MEF3VKF4BZJ6GDML";

export const ACBU_ASSET_CODE = (
  process.env.NEXT_PUBLIC_ACBU_ASSET_CODE ?? "ACBU"
)
  .trim()
  .toUpperCase();

/**
 * Issuer for the ACBU asset as resolvable without any runtime check.
 *
 * Non-production keeps the historical behaviour of defaulting to the demo
 * issuer. In production an absent variable resolves to an empty string rather
 * than to a different asset; code paths that actually build the asset should
 * call `resolveAcbuAssetIssuer()` (or `acbuAsset()`), which raises a clear
 * error instead.
 */
export const ACBU_ASSET_ISSUER =
  (process.env.NEXT_PUBLIC_ACBU_ASSET_ISSUER ?? "").trim() ||
  (process.env.NODE_ENV === "production" ? "" : DEMO_FIAT_ISSUER);

type IssuerEnv = Record<string, string | undefined>;

/** Whether the deployment pinned the ACBU issuer explicitly. */
export function isAcbuAssetIssuerConfigured(env: IssuerEnv = process.env): boolean {
  return (env.NEXT_PUBLIC_ACBU_ASSET_ISSUER ?? '').trim().length > 0;
}

/**
 * Resolve the issuer that the ACBU asset should be created against.
 *
 * Outside production an unset variable falls back to the bundled demo issuer so
 * that local/testnet setups keep working. In production it is an error instead:
 * the demo issuer is a different asset than the one the minting contract knows
 * about, and quietly using it makes trustline, mint and burn operations target
 * the wrong asset without any visible failure.
 */
export function resolveAcbuAssetIssuer(env: IssuerEnv = process.env): string {
  const configured = (env.NEXT_PUBLIC_ACBU_ASSET_ISSUER ?? "").trim();
  if (configured) return configured;

  if (env.NODE_ENV === "production") {
    throw new Error(
      "NEXT_PUBLIC_ACBU_ASSET_ISSUER is not set. Refusing to fall back to the " +
        "bundled demo/test issuer in production: it would not match the issuer " +
        "the deployed minting contract is bound to. Set the variable and rebuild.",
    );
  }

  return DEMO_FIAT_ISSUER;
}

export function demoFiatAsset(currency: string): Asset {
  const code = currency.trim().toUpperCase();
  return new Asset(code, DEMO_FIAT_ISSUER);
}

export function acbuAsset(): Asset {
  return new Asset(ACBU_ASSET_CODE, resolveAcbuAssetIssuer());
}
