/**
 * World Bank API client for macroeconomic data (GDP, Population, etc.).
 * Base URL: https://api.worldbank.org/v2
 * Indicator codes:
 * - GDP (current US$): NY.GDP.MKTP.CD
 * - Population, total: SP.POP.TOTL
 * - Official exchange rate (LCU per US$, period average): PA.NUS.FCRF
 */
import axios from "axios";
import { logger } from "../../config/logger";

const WORLD_BANK_BASE = "https://api.worldbank.org/v2";

/** Basket currency to World Bank country ISO2 code. */
export const CURRENCY_TO_ISO2: Record<string, string> = {
  NGN: "NG",
  ZAR: "ZA",
  KES: "KE",
  EGP: "EG",
  GHS: "GH",
  RWF: "RW",
  XOF: "SN", // Using Senegal as representative for WAEMU
  MAD: "MA",
  TZS: "TZ",
  UGX: "UG",
};

interface WorldBankResponseItem {
  indicator?: { id: string; value: string };
  country?: { id: string; value: string };
  countryiso3code?: string;
  value?: number | null;
  date?: string;
  unit?: string;
  obs_status?: string;
  decimal?: number;
}

type WorldBankResponse = [
  {
    page: number;
    pages: number;
    per_page: number;
    total: number;
    sourceid: string;
    lastupdated: string;
  },
  WorldBankResponseItem[]?,
];

/**
 * Fetch a specific indicator value for a country.
 */
export async function fetchIndicatorValue(
  iso2: string,
  indicatorCode: string,
): Promise<number | null> {
  // Use format=json as it's easier to parse than the provided XML example,
  // but matches the same data structure.
  const url = `${WORLD_BANK_BASE}/country/${iso2}/indicator/${indicatorCode}?format=json&per_page=5`;

  try {
    const { data } = await axios.get<WorldBankResponse>(url, {
      timeout: 15_000,
    });

    if (!Array.isArray(data) || !data[1]) {
      return null;
    }

    const records = data[1] as WorldBankResponseItem[];
    // Find the most recent record with a non-null value
    const latestRecord = records.find((r) => r.value !== null && r.value !== undefined);

    if (latestRecord && typeof latestRecord.value === "number") {
      return latestRecord.value;
    }

    return null;
  } catch (e) {
    logger.warn("World Bank indicator fetch failed", {
      iso2,
      indicatorCode,
      error: e,
    });
    return null;
  }
}

/**
 * Fetch latest GDP (current US$) for a country.
 */
export async function fetchGdpUsd(currency: string): Promise<number | null> {
  const iso2 = CURRENCY_TO_ISO2[currency];
  if (!iso2) return null;
  return fetchIndicatorValue(iso2, "NY.GDP.MKTP.CD");
}

/**
 * Fetch total population for a country.
 */
export async function fetchPopulation(currency: string): Promise<number | null> {
  const iso2 = CURRENCY_TO_ISO2[currency];
  if (!iso2) return null;
  return fetchIndicatorValue(iso2, "SP.POP.TOTL");
}

/**
 * Fetch official exchange rate (LCU per US$).
 * NOTE: This returns units of local currency per 1 USD.
 * Our system uses USD per 1 unit of local currency.
 */
export async function fetchExchangeRate(currency: string): Promise<number | null> {
  const iso2 = CURRENCY_TO_ISO2[currency];
  if (!iso2) return null;

  const lcuPerUsd = await fetchIndicatorValue(iso2, "PA.NUS.FCRF");
  if (lcuPerUsd && lcuPerUsd > 0) {
    // Convert to USD per 1 unit of local currency
    return 1 / lcuPerUsd;
  }

  return null;
}
