/**
 * Send minimum Pi to user's Pi address to activate the wallet (create account on-chain).
 * Called when user has paid KYC fee; platform Pi wallet is the source.
 * Complements the Stellar XLM activation service.
 */
import { config } from "../../config/env";
import { piClient } from "./client";
import { logger } from "../../config/logger";

/**
 * Send minBalancePi to the given Pi address (createAccount or payment if account exists).
 * Uses platform Pi secret key as source. Throws on failure.
 */
export async function sendPiToActivate(piAddress: string): Promise<string> {
  if (!piClient.isEnabled()) {
    throw new Error("Pi bridge is not enabled");
  }

  const amountPi = config.pi.minBalancePi ?? 0.1;

  try {
    const result = await piClient.sendPiToActivate(piAddress, amountPi);
    return result;
  } catch (err: unknown) {
    const e = err as {
      response?: {
        data?: { extras?: { result_codes?: { operations?: string[] } } };
      };
      message?: string;
    };
    const msg = e?.message ?? String(err);

    // Already exists is not a failure
    if (msg.includes("already_exists") || msg.includes("already_funded")) {
      logger.info("Pi wallet already funded, skip activation", {
        piAddress: piAddress.slice(0, 8) + "…",
      });
      return "already_exists";
    }

    throw err;
  }
}
