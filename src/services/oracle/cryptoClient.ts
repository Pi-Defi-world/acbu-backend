import axios from "axios";
import { logger } from "../../config/logger";

interface BinanceTickerResponse {
  symbol: string;
  price: string;
}

/**
 * Fetch XLM to USD (USDT) rate from Binance public API.
 * Returns null if the request fails.
 */
export async function fetchXlmRateUsd(): Promise<number | null> {
  const url = "https://api.binance.com/api/v3/ticker/price?symbol=XLMUSDT";
  try {
    const { data } = await axios.get<BinanceTickerResponse>(url, {
      timeout: 5000,
    });
    const price = parseFloat(data.price);
    if (!isNaN(price) && price > 0) {
      return price;
    }
    return null;
  } catch (e) {
    logger.warn("Oracle: Binance XLM/USDT rate fetch failed", {
      symbol: "XLMUSDT",
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}
