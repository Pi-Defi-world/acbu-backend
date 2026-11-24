import { Decimal } from "@prisma/client/runtime/library";
import { getLatestAcbuRate } from "../services/rates/acbuRateCache";

/**
 * Return the latest ACBU/USD conversion rate as an exact decimal value.
 * The cached database rate avoids floating-point conversion in limit checks.
 */
export async function getAcbuUsdRate(): Promise<Decimal> {
  const latest = await getLatestAcbuRate();
  const rate = new Decimal(latest.rate);

  if (!rate.isFinite() || rate.lte(0)) {
    throw new Error("ACBU/USD rate is unavailable or invalid");
  }

  return rate;
}
