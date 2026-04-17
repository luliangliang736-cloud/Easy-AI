const VALID_SERVICE_TIERS = new Set(["default", "priority"]);
const DEFAULT_SERVICE_TIER = "priority";

export function resolveNanoServiceTier(requestedTier) {
  const tier = String(
    requestedTier || process.env.NANO_SERVICE_TIER || DEFAULT_SERVICE_TIER
  )
    .trim()
    .toLowerCase();

  return VALID_SERVICE_TIERS.has(tier) ? tier : DEFAULT_SERVICE_TIER;
}
