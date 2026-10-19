import { Asset, Keypair, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { stellarClient } from "./client";
import { getBaseFee } from "./feeManager";
import { getAcbuAssetCode, getAcbuIssuer } from "../../config/acbuAsset";

async function ensureAssetTrustline(params: {
  userSecret: string;
  code: string;
  issuer: string;
}): Promise<{ added: boolean; txHash?: string }> {
  const asset = new Asset(params.code, params.issuer);
  const kp = Keypair.fromSecret(params.userSecret);
  const accountId = kp.publicKey();
  const server = stellarClient.getServer();

  const account = await server.loadAccount(accountId);
  const hasTrustline = account.balances.some((b: any) => {
    if (b.asset_type === "native") return false;
    return b.asset_code === params.code && b.asset_issuer === params.issuer;
  });
  if (hasTrustline) return { added: false };

  const op = Operation.changeTrust({ asset });
  const tx = new TransactionBuilder(account, {
    fee: await getBaseFee(),
    networkPassphrase: stellarClient.getNetworkPassphrase(),
  })
    .addOperation(op)
    .setTimeout(0)
    .build();

  tx.sign(kp);
  const result = await server.submitTransaction(tx);
  return { added: true, txHash: result.hash };
}

export async function ensureDemoFiatTrustline(params: {
  userSecret: string;
  currency: string;
}): Promise<{ added: boolean; txHash?: string }> {
  const code = params.currency.trim().toUpperCase();
  const issuer = getAcbuIssuer();
  return ensureAssetTrustline({
    userSecret: params.userSecret,
    code,
    issuer,
  });
}

export async function ensureAcbuTrustline(params: {
  userSecret: string;
}): Promise<{ added: boolean; txHash?: string }> {
  return ensureAssetTrustline({
    userSecret: params.userSecret,
    code: getAcbuAssetCode(),
    issuer: getAcbuIssuer(),
  });
}
