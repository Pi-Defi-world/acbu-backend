/**
 * Client-side feature flags.
 *
 * Off by default for flows that aren't production-ready (e.g. the
 * international transfer tab on /currency, and the business payment
 * gateway, both of which still need backend + compliance wiring).
 */
export const featureFlags = {
  internationalTransfers: false,
  businessGateway: false,
} as const;
