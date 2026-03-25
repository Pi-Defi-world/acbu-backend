/**
 * Send minimum cryptocurrency to user's address to activate the wallet (create account on-chain).
 * Called when user has paid KYC fee; platform wallet (Stellar or Pi) is the source.
 *
 * Chain Selection:
 * - Uses Pi when PI_BRIDGE_ENABLED=true (Pi bridge/chain is active)
 * - Falls back to Stellar XLM otherwise (default behavior)
 */
import { Operation, TransactionBuilder } from "stellar-sdk";
import { config } from "../../config/env";
import { stellarClient } from "../stellar/client";
import { getBaseFee } from "../stellar/feeManager";
import { piClient } from "../pi/client";
import { sendPiToActivate } from "../pi/activationService";
import { logger } from "../../config/logger";

/**
 * Send minimum balance to activate a wallet.
 * Automatically selects between Pi and Stellar based on configuration.
 *
 * @param address - The target address on the active chain (Stellar or Pi)
 * @returns Transaction hash
 */
export async function sendCryptoToActivate(address: string): Promise<string> {
  // Use Pi if bridge is enabled, otherwise use Stellar
  if (piClient.isEnabled()) {
    logger.info("Using Pi bridge for wallet activation", {
      address: address.slice(0, 8) + "…",
      network: piClient.getNetwork(),
    });
    return sendPiToActivate(address);
  } else {
    logger.info("Using Stellar for wallet activation", {
      address: address.slice(0, 8) + "…",
    });
    return sendXlmToActivate(address);
  }
}

/**
 * Send minBalanceXlm to the given Stellar address (createAccount or payment if account exists).
 * Uses platform stellar.secretKey as source. Throws on failure.
 */
export async function sendXlmToActivate(
  stellarAddress: string,
): Promise<string> {
  const keypair = stellarClient.getKeypair();
  if (!keypair) {
    throw new Error("Platform Stellar key not configured; cannot fund wallet");
  }
  const sourceAccountId = keypair.publicKey();
  const amountXlm = config.stellar.minBalanceXlm ?? 1;
  const server = stellarClient.getServer();
  const networkPassphrase = stellarClient.getNetworkPassphrase();
  const sourceAccount = await server.loadAccount(sourceAccountId);

  const op = Operation.createAccount({
    destination: stellarAddress,
    startingBalance: String(amountXlm),
  });

  const builder = new TransactionBuilder(sourceAccount, {
    fee: await getBaseFee(),
    networkPassphrase,
  }).addOperation(op);
  const transaction = builder.build();
  transaction.sign(keypair);
  try {
    const result = await server.submitTransaction(transaction);
    logger.info("Wallet activated with XLM", {
      stellarAddress: stellarAddress.slice(0, 8) + "…",
      amountXlm,
      hash: result.hash,
    });
    return result.hash;
  } catch (err: unknown) {
    const e = err as {
      response?: {
        data?: { extras?: { result_codes?: { operations?: string[] } } };
      };
      message?: string;
    };
    const opCode =
      e?.response?.data?.extras?.result_codes?.operations?.[0] ?? "";
    const msg = opCode || (e?.message ?? String(err));
    if (
      msg.includes("op_already_exists") ||
      msg.includes("CREATE_ACCOUNT_ALREADY_EXIST")
    ) {
      logger.info("Wallet already funded, skip activation", {
        stellarAddress: stellarAddress.slice(0, 8) + "…",
      });
      return "already_exists";
    }
    throw err;
  }
}
