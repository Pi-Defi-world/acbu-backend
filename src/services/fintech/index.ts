/**
 * Fintech provider router and types. Import from here so the router is wired with all providers.
 */
import { simulatedFintechProvider } from "./simulated";
import { FintechProviderRouter, setFintechRouter } from "./router";

const router = new FintechProviderRouter({});
// Register simulated provider for all potential IDs to override any legacy config
router.register("simulated", simulatedFintechProvider);
router.register("flutterwave", simulatedFintechProvider);
router.register("paystack", simulatedFintechProvider);
router.register("mtn_momo", simulatedFintechProvider);

setFintechRouter(router);

export { getFintechRouter, setFintechRouter, FintechProviderRouter } from "./router";
export type { FintechProvider, FintechProviderId, DisburseRecipient } from "./types";
