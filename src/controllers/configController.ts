/**
 * GET /v1/config/assets — Asset configuration endpoint.
 *
 * Public callers receive only the information strictly needed to set up a
 * trustline against the ACBU asset: the asset code/issuer and the Stellar
 * network passphrase.  Infrastructure details (Horizon URL, Soroban RPC URL,
 * contract addresses) are gated behind API-key authentication to limit the
 * information-disclosure surface described in W10-BE-013.
 *
 * Authenticated callers (valid `x-api-key` or `Authorization: Bearer <key>`)
 * receive the full response including infra endpoints.
 */
import { Response, NextFunction } from "express";
import { stellarClient } from "../services/stellar/client";
import { getContractAddresses } from "../config/contracts";
import { getAcbuAssetConfig } from "../config/acbuAsset";

export async function getPublicAssetsConfig(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { code, issuer } = getAcbuAssetConfig();

    res.status(200).json({
      acbu: {
        code,
        issuer,
      },
      demo_fiat: {
        issuer,
      },
      stellar: {
        network_passphrase: stellarClient.getNetworkPassphrase(),
        horizon_url: stellarClient.getHorizonUrl?.() ?? null,
        soroban_rpc_url: stellarClient.getSorobanRpcUrl?.() ?? null,
      },
      contracts: {
        burning: getContractAddresses().burning || null,
      },
    });
  } catch (e) {
    next(e);
  }
}
