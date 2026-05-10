// Convert one Purchased event into the appropriate set of email enqueues:
//   - earned_commission to the final recipient
//   - lost_commission to each compressed-past upline (they didn't own the tier)
//   - cascade_passup to each cascade skipper (they passed the commission up)
//   - sponsor_signup to directSponsor[buyer] IF this is buyer's first purchase
//
// Idempotency is per (txHash, logIndex, type, recipient) so retries are safe.

import { logger } from "../log.js";
import { withTx, getPool } from "../db/pool.js";
import { enqueue } from "../email/outbox.js";
import { SkipWalker } from "../chain/skip-walker.js";
import { lookup } from "../iat/lookup.js";
import { upsertSubscriber, findByWallet } from "../subscribers/upsert.js";
import { config } from "../config.js";

// Slot-in paragraphs are versioned per (kind, tier) and stored in
// wt_email_settings as a single JSONB blob (populated by the ingest CLI).
// Cached for 60s to avoid hammering the DB on bulk processing.
let slotInCache: { value: Record<string, { paragraphHtml: string }>; expiresAt: number } | null =
  null;

async function getSlotIn(
  kind: "lost_commission_cta" | "earned_commission_celebration",
  tier: number,
): Promise<string> {
  if (!slotInCache || slotInCache.expiresAt < Date.now()) {
    const r = await getPool().query<{
      value: Record<string, { paragraphHtml: string }>;
    }>(`SELECT value FROM wt_email_settings WHERE key = 'slot_in_paragraphs' LIMIT 1`);
    slotInCache = {
      value: r.rows[0]?.value ?? {},
      expiresAt: Date.now() + 60_000,
    };
  }
  const key = `${kind}:t${tier}`;
  return slotInCache.value[key]?.paragraphHtml ?? "";
}

// Tier name lookup — keep in sync with src/lib/contract.ts on the WT app side.
const TIER_NAMES: Record<number, string> = {
  1: "The Short That Pays",
  2: "Your First Sale Playbook",
  3: "The Creator Engine",
  4: "The Closer's Codex",
  5: "The Omnipresence Engine",
  6: "The Live Recruiting Formula",
  7: "Producer Transformation",
  8: "Team Transformation",
  9: "Influence Transformation",
};

const TIER_PRICE_USD: Record<number, number> = {
  1: 3,
  2: 6,
  3: 9,
  4: 30,
  5: 60,
  6: 90,
  7: 300,
  8: 600,
  9: 900,
};

export interface PurchasedEvent {
  txHash: `0x${string}`;
  logIndex: number;
  blockNumber: bigint;
  buyer: `0x${string}`;
  tier: number;
  // The contract's chosen earningSeller (post-walkUpQualified).
  earningSeller: `0x${string}`;
  // Final recipient after cascade.
  commissionRecipient: `0x${string}`;
  // Whether this purchase invoked a passup at any point.
  isPassup: boolean;
  // Whether the buyer became an affiliate on this purchase (first time).
  becameAffiliate: boolean;
  occurredAt: Date;
}

function basescanTxUrl(txHash: string): string {
  const path =
    config.chain === "BASE_MAINNET"
      ? `https://basescan.org/tx/${txHash}`
      : `https://sepolia.basescan.org/tx/${txHash}`;
  return path;
}

function shortenWallet(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

interface ResolvedRecipient {
  email: string;
  displayName: string;
  subscriberId: string;
  isAffiliate: boolean;
  ownsTiers: number[];
}

async function resolveRecipient(
  wallet: `0x${string}`,
  tier: number,
): Promise<ResolvedRecipient | null> {
  // Try IAT lookup first (source of truth for emails).
  const iat = await lookup(wallet);
  if (!iat.email) return null;

  // Upsert into our subscriber table so prefs + engagement track correctly.
  const sub = await upsertSubscriber({
    walletAddress: wallet,
    email: iat.email,
    iatUserId: iat.iatUserId,
    displayName: iat.displayName,
    source: "on_chain",
  });

  return {
    email: iat.email,
    displayName: iat.displayName ?? shortenWallet(wallet),
    subscriberId: sub.subscriberId,
    isAffiliate: iat.isAffiliateAtTiers.includes(tier),
    ownsTiers: iat.ownsTiers,
  };
}

export interface ProcessResult {
  earnedQueued: number;
  lostQueued: number;
  cascadeQueued: number;
  sponsorQueued: number;
  skippedNoEmail: number;
}

export async function processPurchasedEvent(
  event: PurchasedEvent,
): Promise<ProcessResult> {
  const result: ProcessResult = {
    earnedQueued: 0,
    lostQueued: 0,
    cascadeQueued: 0,
    sponsorQueued: 0,
    skippedNoEmail: 0,
  };

  const tierName = TIER_NAMES[event.tier] ?? `Tier ${event.tier}`;
  const productPriceUsd = TIER_PRICE_USD[event.tier] ?? 0;

  const buyer = await resolveRecipient(event.buyer, event.tier);

  // Run the skip-walker against contract state at the event's block.
  const walker = new SkipWalker();
  const report = await walker
    .simulate(event.buyer, event.tier, BigInt(productPriceUsd * 1_000_000), {
      blockNumber: event.blockNumber,
    })
    .catch((err) => {
      logger.warn(
        { err: err instanceof Error ? err.message : err, txHash: event.txHash },
        "skip_walker_failed_falling_back_to_event_data",
      );
      return null;
    });

  const idemBase = `wt-${config.chain}-${event.txHash}-${event.logIndex}`;

  // ---- 1. Earned commission email (to final recipient) ----
  const finalRecipient = (report?.finalRecipient ?? event.commissionRecipient).toLowerCase() as `0x${string}`;
  // Skip if the recipient is the company wallet — we don't email ourselves.
  const company = (await walker.getCompanyWallet().catch(() => null))?.toLowerCase();
  if (company && finalRecipient !== company) {
    const earner = await resolveRecipient(finalRecipient, event.tier);
    if (earner) {
      const queued = await enqueue({
        emailType: "earned_commission",
        templateId: "earned_commission_v1",
        subscriberId: earner.subscriberId,
        recipientEmail: earner.email,
        recipientWallet: finalRecipient,
        subject: "You just earned ${{amount}} on Wealth Transformation",
        vars: {
          firstName: earner.displayName,
          amount: productPriceUsd,
          tier: event.tier,
          tierName,
          buyerName: buyer?.displayName ?? shortenWallet(event.buyer),
          buyerWalletShort: shortenWallet(event.buyer),
          isPassup: report?.isPassup ?? event.isPassup,
          basescanUrl: basescanTxUrl(event.txHash),
          occurredAt: event.occurredAt.toISOString(),
          // Per-tier slot-in paragraph the wrapper template renders via
          // {{{celebrationParagraph}}}. Empty string if no slot-in exists
          // for this tier — wrapper still renders, just without the
          // tier-specific celebration block.
          celebrationParagraph: await getSlotIn("earned_commission_celebration", event.tier),
        },
        idempotencyKey: `${idemBase}-earned-${finalRecipient}`,
        triggeredBy: "indexer_event",
        context: {
          txHash: event.txHash,
          logIndex: event.logIndex,
          blockNumber: event.blockNumber.toString(),
        },
      });
      if (queued) result.earnedQueued += 1;
    } else {
      result.skippedNoEmail += 1;
    }
  }

  // ---- 2. Lost commission emails (to each compressed-past upline) ----
  if (report) {
    for (const skip of report.compressedSkips) {
      const skipped = await resolveRecipient(skip.address, event.tier);
      if (!skipped) {
        result.skippedNoEmail += 1;
        continue;
      }
      // Per spec: customer-only buyers (not affiliate at any tier) skip these.
      if (skipped.ownsTiers.length === 0) continue;
      const queued = await enqueue({
        emailType: "lost_commission",
        templateId: "lost_commission_v1",
        subscriberId: skipped.subscriberId,
        recipientEmail: skipped.email,
        recipientWallet: skip.address,
        subject:
          "{{buyerName}} just bought {{tierName}} — you lost a ${{amount}} commission",
        vars: {
          firstName: skipped.displayName,
          amount: productPriceUsd,
          tier: event.tier,
          tierName,
          buyerName: buyer?.displayName ?? shortenWallet(event.buyer),
          buyerWalletShort: shortenWallet(event.buyer),
          activateUrl: `${config.publicBaseUrl}/tier/${event.tier}`,
          basescanUrl: basescanTxUrl(event.txHash),
          reason: skip.reason,
          // Per-tier slot-in CTA paragraph rendered via {{{ctaParagraph}}}
          // in the lost_commission wrapper template.
          ctaParagraph: await getSlotIn("lost_commission_cta", event.tier),
        },
        idempotencyKey: `${idemBase}-lost-${skip.address}`,
        triggeredBy: "indexer_event",
        context: {
          txHash: event.txHash,
          logIndex: event.logIndex,
          skipReason: skip.reason,
        },
      });
      if (queued) result.lostQueued += 1;
    }

    // ---- 3. Cascade passup emails ----
    for (const skip of report.cascadeSkips) {
      const passer = await resolveRecipient(skip.address, event.tier);
      if (!passer) {
        result.skippedNoEmail += 1;
        continue;
      }
      const queued = await enqueue({
        emailType: "cascade_passup",
        templateId: "cascade_passup_v1",
        subscriberId: passer.subscriberId,
        recipientEmail: passer.email,
        recipientWallet: skip.address,
        subject: "Your every-3rd just powerlined — make one more sale to keep the next",
        vars: {
          firstName: passer.displayName,
          amount: productPriceUsd,
          tier: event.tier,
          tierName,
          counterAt: skip.counterAt.toString(),
          buyerName: buyer?.displayName ?? shortenWallet(event.buyer),
          basescanUrl: basescanTxUrl(event.txHash),
        },
        idempotencyKey: `${idemBase}-cascade-${skip.address}`,
        triggeredBy: "indexer_event",
        context: { txHash: event.txHash, logIndex: event.logIndex },
      });
      if (queued) result.cascadeQueued += 1;
    }
  }

  // ---- 4. Sponsor-signup email (only on buyer's first purchase) ----
  if (event.becameAffiliate) {
    // The buyer's directSponsor is the address recorded at first purchase.
    // We can extract it from the walker by reading the chain at the event
    // block — the SkipWalker's compressedSkips list starts with directSponsor
    // (or is empty if directSponsor was already qualified). Either way, the
    // event itself names the contract's `submittedSponsor` and `effectiveSponsor`,
    // and we use the `commissionRecipient` as the closest signal here.
    const sponsorAddr = (
      report?.compressedSkips[0]?.address ?? event.commissionRecipient
    ).toLowerCase() as `0x${string}`;
    if (company && sponsorAddr !== company) {
      const sponsor = await resolveRecipient(sponsorAddr, event.tier);
      if (sponsor && buyer) {
        const queued = await enqueue({
          emailType: "sponsor_signup",
          templateId: "sponsor_signup_v1",
          subscriberId: sponsor.subscriberId,
          recipientEmail: sponsor.email,
          recipientWallet: sponsorAddr,
          subject: "{{buyerName}} just signed up under you on Wealth Transformation",
          vars: {
            firstName: sponsor.displayName,
            buyerName: buyer.displayName,
            buyerWalletShort: shortenWallet(event.buyer),
            tier: event.tier,
            tierName,
            commissionAmount: productPriceUsd,
            basescanUrl: basescanTxUrl(event.txHash),
          },
          idempotencyKey: `${idemBase}-sponsor-${sponsorAddr}`,
          triggeredBy: "indexer_event",
          context: { txHash: event.txHash, logIndex: event.logIndex },
        });
        if (queued) result.sponsorQueued += 1;
      }
    }
  }

  // Make TypeScript happy about unused.
  void findByWallet;
  void withTx;

  logger.info(
    {
      txHash: event.txHash,
      tier: event.tier,
      ...result,
    },
    "purchase_event_processed",
  );

  return result;
}
