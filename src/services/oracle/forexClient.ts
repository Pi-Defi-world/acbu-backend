/**
 * Oracle Layer 3: Forex price feed via ExchangeRate-API (or compatible).
 * Returns USD rate per 1 unit of currency (e.g. 1 NGN = x USD).
 */
export {
  fetchExchangeRateUsd as fetchForexRateUsd,
  refreshExchangeRate,
  triggerBackgroundExchangeRateRefresh,
} from "../rates/exchangeRateService";
