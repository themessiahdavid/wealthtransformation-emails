// Single source of truth for the WT tier ladder. Mirror of the on-chain
// TIERS map. Used by the drip scheduler to populate {{activateUrl}},
// {{tierName}}, {{tierProductPrice}}, etc., and by the design system to
// render the commissions callout under each CTA.

import { config } from "./config.js";

export interface TierMeta {
  tier: number;
  productName: string;
  productPriceUsd: number;     // dollars (no admin fee)
  adminFeeUsd: number;         // dollars (10% of product)
  totalUsd: number;            // product + admin
  productOnly: string;         // sticker for product-only ($X)
  totalSticker: string;        // sticker for total ($X.XX)
}

const TIER_TABLE: TierMeta[] = [
  { tier: 1, productName: "The Short That Pays", productPriceUsd: 3, adminFeeUsd: 0.30, totalUsd: 3.30, productOnly: "$3", totalSticker: "$3.30" },
  { tier: 2, productName: "Your First Sale Playbook", productPriceUsd: 6, adminFeeUsd: 0.60, totalUsd: 6.60, productOnly: "$6", totalSticker: "$6.60" },
  { tier: 3, productName: "The Creator Engine", productPriceUsd: 9, adminFeeUsd: 0.90, totalUsd: 9.90, productOnly: "$9", totalSticker: "$9.90" },
  { tier: 4, productName: "The Closer's Codex", productPriceUsd: 30, adminFeeUsd: 3, totalUsd: 33, productOnly: "$30", totalSticker: "$33" },
  { tier: 5, productName: "The Omnipresence Engine", productPriceUsd: 60, adminFeeUsd: 6, totalUsd: 66, productOnly: "$60", totalSticker: "$66" },
  { tier: 6, productName: "The Live Recruiting Formula", productPriceUsd: 90, adminFeeUsd: 9, totalUsd: 99, productOnly: "$90", totalSticker: "$99" },
  { tier: 7, productName: "Producer Transformation", productPriceUsd: 300, adminFeeUsd: 30, totalUsd: 330, productOnly: "$300", totalSticker: "$330" },
  { tier: 8, productName: "Team Transformation", productPriceUsd: 600, adminFeeUsd: 60, totalUsd: 660, productOnly: "$600", totalSticker: "$660" },
  { tier: 9, productName: "Influence Transformation", productPriceUsd: 900, adminFeeUsd: 90, totalUsd: 990, productOnly: "$900", totalSticker: "$990" },
];

export function tier(n: number): TierMeta | undefined {
  return TIER_TABLE.find((t) => t.tier === n);
}

// Parse "drip_capture_to_t1" or "drip_t3_to_t4" → target tier number.
export function targetTierForDrip(dripType: string): number | null {
  const m = dripType.match(/^drip_(?:capture|t\d+)_to_t(\d+)$/);
  return m ? Number.parseInt(m[1], 10) : null;
}

export function activateUrlForTier(n: number): string {
  return `${config.publicBaseUrl}/tier/${n}`;
}
