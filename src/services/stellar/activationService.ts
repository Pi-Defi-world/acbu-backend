import { Keypair, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { config } from "../../config/env";
import { stellarClient } from "./client";
import { getBaseFee } from "./feeManager";

export interface ActivationResult {
  created: boolean;
  txHash?: string;
  fundingAssetCode: string;
  startingBalance: string;
  strategy: "create_account_native" | "disabled";
  bootstrapProfile?: string;
}

function getActivationSettings(): {
  fundingAssetCode: string;
  startingBalance: string;
  strategy: "create_account_native" | "disabled";
  bootstrapProfile: string;
} {
  return {
    fundingAssetCode: config.stellar.nativeAssetCode || "XLM",
    startingBalance: config.stellar.activationAmount || "1",
    strategy: config.stellar.activationStrategy || "create_account_native",
    bootstrapProfile: config.stellar.bootstrapProfile || "",
  };
}

export async function ensureAccountActivated(
  destination: string,
): Promise<ActivationResult> {
  const server = stellarClient.getServer();
  const activation = getActivationSettings();

  try {
    await server.loadAccount(destination);
    return {
      created: false,
      fundingAssetCode: activation.fundingAssetCode,
      startingBalance: activation.startingBalance,
      strategy: activation.strategy,
      bootstrapProfile: activation.bootstrapProfile,
    };
  } catch (e: any) {
    if (e?.response?.status !== 404) throw e;
  }

  if (activation.strategy === "disabled") {
    throw new Error(
      `Wallet activation is disabled for bootstrap asset ${activation.fundingAssetCode}`,
    );
  }

  const backendKp = stellarClient.getKeypair();
  if (!backendKp) {
    throw new Error("No Stellar source account (STELLAR_SECRET_KEY)");
  }

  const sourceAccount = await server.loadAccount(backendKp.publicKey());
  const op = Operation.createAccount({
    destination,
    // createAccount always funds the network-native asset; the configured
    // fundingAssetCode is returned to callers so the UI/docs can match the
    // target network bootstrap profile (for example PI vs XLM).
    startingBalance: activation.startingBalance,
  });

  const tx = new TransactionBuilder(sourceAccount, {
    fee: await getBaseFee(),
    networkPassphrase: stellarClient.getNetworkPassphrase(),
  })
    .addOperation(op)
    .setTimeout(0)
    .build();

  tx.sign(Keypair.fromSecret(backendKp.secret()));
  const res = await server.submitTransaction(tx);
  return {
    created: true,
    txHash: res.hash,
    fundingAssetCode: activation.fundingAssetCode,
    startingBalance: activation.startingBalance,
    strategy: activation.strategy,
    bootstrapProfile: activation.bootstrapProfile,
  };
}
