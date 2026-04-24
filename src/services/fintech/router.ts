/**
 * Routes currency to the right fintech provider per FINTECH_PARTNERSHIPS.MD.
 * Default: NGN→paystack, RWF→mtn_momo, others→flutterwave.
 * Falls back to flutterwave when the mapped provider is not registered.
 */

import type { FintechProvider, FintechProviderId } from "./types";


/**
 * Default currency → provider id array (priority order). Overridable via config.
 * Example: NGN: ["paystack", "flutterwave"]
 */
const DEFAULT_CURRENCY_PROVIDERS: Record<string, FintechProviderId[]> = {
  NGN: ["paystack", "flutterwave"],
  KES: ["flutterwave"],
  RWF: ["mtn_momo", "flutterwave"],
  ZAR: ["flutterwave"],
  GHS: ["flutterwave"],
  EGP: ["flutterwave"],
  MAD: ["flutterwave"],
  TZS: ["flutterwave"],
  UGX: ["flutterwave"],
  XOF: ["flutterwave"],
};

export class FintechProviderRouter {
  private providers: Map<FintechProviderId, FintechProvider> = new Map();
  private currencyProviders: Record<string, FintechProviderId[]>;

  constructor(currencyProviders?: Record<string, FintechProviderId[]>) {
    this.currencyProviders = currencyProviders ?? DEFAULT_CURRENCY_PROVIDERS;
  }

  register(id: FintechProviderId, provider: FintechProvider): void {
    this.providers.set(id, provider);
  }

  /**
   * Selects the best provider for a currency based on health and fees.
   * If all fail, throws an error.
   * @param currency
   * @param opts Optionally pass {simulateOutageFor?: FintechProviderId}
   */
  async getProvider(currency: string, opts?: { simulateOutageFor?: FintechProviderId }): Promise<FintechProvider> {
    const providerIds = this.currencyProviders[currency] ?? ["flutterwave"];
    let lastError: Error | null = null;
    for (const id of providerIds) {
      if (opts?.simulateOutageFor && id === opts.simulateOutageFor) {
        // Simulate outage for this provider
        continue;
      }
      const provider = this.providers.get(id);
      if (!provider) continue;
      // Health check: try getBalance (could be replaced with a real health endpoint)
      try {
        await provider.getBalance(currency);
        // TODO: Add fee comparison logic here if needed
        return provider;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        continue;
      }
    }
    // Fallback: try flutterwave if not already tried
    if (!providerIds.includes("flutterwave")) {
      const fallback = this.providers.get("flutterwave");
      if (fallback) return fallback;
    }
    throw new Error(
      `No healthy fintech provider for currency ${currency}` + (lastError ? ": " + lastError.message : "")
    );
  }

  /** Get provider by id (e.g. 'flutterwave' for FX fallback). */
  getProviderById(id: FintechProviderId): FintechProvider {
    const provider = this.providers.get(id);
    if (!provider) {
      throw new Error(`Fintech provider ${id} not registered`);
    }
    return provider;
  }
}

/** Singleton router; set by fintech/index.ts after registering providers. */
let routerInstance: FintechProviderRouter | null = null;

/**
 * Get the shared router. Import from 'services/fintech' so that index has run and providers are registered.
 */
export function getFintechRouter(): FintechProviderRouter {
  if (!routerInstance) {
    throw new Error(
      "Fintech router not initialized. Import from services/fintech so providers are registered.",
    );
  }
  return routerInstance;
}

/**
 * Set the router instance. Used by fintech/index.ts to wire flutterwave, paystack, mtn_momo.
 */
export function setFintechRouter(router: FintechProviderRouter): void {
  routerInstance = router;
}
