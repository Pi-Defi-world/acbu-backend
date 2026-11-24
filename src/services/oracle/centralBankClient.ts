/**
 * Oracle Layer 1: Central bank / official rate feed per currency.
 * URLs are configurable via CURRENCY_CENTRAL_BANK_URLS (JSON map).
 * Expected response: JSON with a numeric rate (USD per 1 unit of currency).
 * Common shapes: { rate: number }, { conversion_rate: number }, { data: { rate: number } }.
 */
import axios from "axios";
import { config } from "../../config/env";
import { logger } from "../../config/logger";

/**
 * Fetch official/USD rate from central bank URL for the given currency.
 * Returns null if no URL is configured or request fails.
 */
export async function fetchCentralBankRateUsd(currency: string): Promise<number | null> {
  const url = config.oracle.centralBankUrls[currency];
  if (!url) return null;
  try {
    const { data } = await axios.get<Record<string, unknown>>(url, {
      timeout: 15_000,
    });
    const rate = extractRate(data);
    return rate;
  } catch (e) {
    logger.warn("Oracle: central bank rate failed", { currency, error: e });
    return null;
  }
}

function extractRate(obj: Record<string, unknown>): number | null {
  if (typeof obj.rate === "number") return obj.rate;
  if (typeof obj.conversion_rate === "number") return obj.conversion_rate;
  if (
    obj.data &&
    typeof obj.data === "object" &&
    typeof (obj.data as Record<string, unknown>).rate === "number"
  ) {
    return (obj.data as Record<string, unknown>).rate as number;
  }
  return null;
}
