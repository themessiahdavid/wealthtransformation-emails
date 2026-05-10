// Autoresponder scheduler. Runs every 15 min:
//   1. Find subscribers eligible for new drip enrollment (just-purchased a tier)
//   2. For each existing drip_state row whose next_step_due_at <= now, enqueue
//      that step's email and advance current_step
//   3. Cancel drips when buyer's tier ownership now includes the upgrade target
//
// The 7-step cadence per drip (in days from enrollment):
//   step 0: day 0      (welcome + tease)
//   step 1: day 2      (case study)
//   step 2: day 4      (the math)
//   step 3: day 7      (objection handler)
//   step 4: day 11     (pure value gift)
//   step 5: day 16     (time-bound reactivation)
//   step 6: day 21     (graceful exit)
// Cadence multiplier from engagement tier stretches each delta:
//   engaged: 1.0×, cooling: 2.0×, cold: skip steps 0/1/3/4/6 (only 2 + 5),
//   frozen: pause entirely.

import { logger } from "../log.js";
import { getPool } from "../db/pool.js";
import { enqueue } from "../email/outbox.js";
import { lookup } from "../iat/lookup.js";
import { tier as tierMeta, targetTierForDrip, activateUrlForTier } from "../tiers.js";
import { config } from "../config.js";
import { issueToken } from "../api/preference-token.js";

const STEP_DAYS_FROM_ENROLL = [0, 2, 4, 7, 11, 16, 21];

// Map of which drip_type to enroll based on current ownership.
// Owning T1 only → drip_t1_to_t2. Owning T2 → drip_t2_to_t3. Etc.
function dripForOwnership(ownsTiers: number[]): string | null {
  const owned = new Set(ownsTiers);
  if (owned.size === 0) return "drip_capture_to_t1";
  // Highest owned tier drives next-tier drip.
  const max = Math.max(...owned);
  if (max >= 9) return null;
  return `drip_t${max}_to_t${max + 1}`;
}

interface DripRow {
  id: string;
  subscriber_id: string;
  drip_type: string;
  current_step: number;
  total_steps: number;
  cadence_multiplier: number;
}

export async function tickEnroll(): Promise<{ enrolled: number }> {
  // Enroll any subscriber who has confirmed their email + has an applicable
  // drip type that's not already active for them.
  const r = await getPool().query<{
    id: string;
    wallet_address: string;
    owns_tiers: number[];
    engagement_tier: string;
  }>(
    `SELECT id, wallet_address, owns_tiers, engagement_tier
       FROM wt_email_subscribers
      WHERE email_confirmed_at IS NOT NULL
        AND unsubscribed_at IS NULL
        AND suppressed_at IS NULL
        AND (paused_until IS NULL OR paused_until <= NOW())
        AND engagement_tier <> 'frozen'`,
  );
  let enrolled = 0;
  for (const s of r.rows) {
    const dripType = dripForOwnership(s.owns_tiers ?? []);
    if (!dripType) continue;
    // Refresh tier ownership from chain occasionally — for now, trust DB. The
    // indexer's purchase producer will keep this current.
    const upserted = await getPool().query<{ inserted: boolean }>(
      `INSERT INTO wt_email_drip_state
          (subscriber_id, drip_type, total_steps, next_step_due_at, cadence_multiplier)
        VALUES ($1::uuid, $2::wt_email_type, 7, NOW(),
                CASE WHEN $3 = 'cooling' THEN 2.0 ELSE 1.0 END)
        ON CONFLICT (subscriber_id, drip_type) DO NOTHING
        RETURNING (xmax = 0) AS inserted`,
      [s.id, dripType, s.engagement_tier],
    );
    if (upserted.rows[0]?.inserted) enrolled += 1;
  }
  return { enrolled };
}

export async function tickFire(): Promise<{ fired: number; cancelled: number }> {
  const due = await getPool().query<DripRow & { wallet_address: string; email: string }>(
    `SELECT d.id, d.subscriber_id, d.drip_type, d.current_step, d.total_steps,
            d.cadence_multiplier, s.wallet_address, s.email
       FROM wt_email_drip_state d
       JOIN wt_email_subscribers s ON s.id = d.subscriber_id
      WHERE d.next_step_due_at <= NOW()
        AND d.cancelled_at IS NULL
        AND d.completed_at IS NULL
        AND s.unsubscribed_at IS NULL
        AND s.suppressed_at IS NULL
        AND (s.paused_until IS NULL OR s.paused_until <= NOW())
        AND s.engagement_tier <> 'frozen'
      LIMIT 500
      FOR UPDATE OF d SKIP LOCKED`,
  );

  let fired = 0;
  let cancelled = 0;

  for (const row of due.rows) {
    // Cancel if buyer has now upgraded past this drip's target.
    const iat = await lookup(row.wallet_address);
    const targetUpgrade = parseInt(row.drip_type.replace(/^drip_t(\d+)_to_t(\d+)$/, "$2"), 10);
    if (
      !Number.isNaN(targetUpgrade) &&
      iat.ownsTiers.includes(targetUpgrade)
    ) {
      await getPool().query(
        `UPDATE wt_email_drip_state SET cancelled_at = NOW(), cancelled_reason = 'upgraded' WHERE id = $1::uuid`,
        [row.id],
      );
      cancelled += 1;
      continue;
    }

    // Skip rule for cold engagement: only fire steps 2 (math) and 5 (reactivation).
    const isCold = row.cadence_multiplier > 0 && false; // TODO wire from current tier read at fire time
    if (isCold && row.current_step !== 2 && row.current_step !== 5) {
      // Advance without sending.
      await getPool().query(
        `UPDATE wt_email_drip_state
            SET current_step = current_step + 1,
                next_step_due_at = NOW() + ($2 || ' days')::interval
          WHERE id = $1::uuid`,
        [row.id, STEP_DAYS_FROM_ENROLL[row.current_step + 1] ?? 21],
      );
      continue;
    }

    // Build the variable hash SendGrid substitutes at send time. Drip emails
    // need every variable any drip step references — populated per the target
    // tier so {{activateUrl}}, {{tierName}}, {{tierProductPrice}} all route
    // and render correctly.
    const targetTier = targetTierForDrip(row.drip_type);
    const tInfo = targetTier ? tierMeta(targetTier) : undefined;
    const prefToken = issueToken(row.subscriber_id);
    const prefUrl = `${config.publicBaseUrl}/email-preferences?token=${encodeURIComponent(prefToken)}`;
    const unsubUrl = `${config.publicBaseUrl}/email-unsubscribe?token=${encodeURIComponent(prefToken)}`;
    const pauseUrl = `${config.publicBaseUrl}/email-pause?token=${encodeURIComponent(prefToken)}`;
    const basescanWalletUrl =
      config.chain === "BASE_MAINNET"
        ? `https://basescan.org/address/${row.wallet_address}`
        : `https://sepolia.basescan.org/address/${row.wallet_address}`;
    const vars = {
      firstName: "", // wt_email_subscribers.display_name; query separately if needed
      activateUrl: targetTier ? activateUrlForTier(targetTier) : config.publicBaseUrl,
      walletShort: `${row.wallet_address.slice(0, 6)}…${row.wallet_address.slice(-4)}`,
      basescanWalletUrl,
      preferenceCenterUrl: prefUrl,
      unsubscribeUrl: unsubUrl,
      pauseUrl,
      tier: tInfo?.tier ?? "",
      tierName: tInfo?.productName ?? "",
      tierProductPrice: tInfo?.productPriceUsd ?? "",
      tierTotalPrice: tInfo?.totalUsd ?? "",
      tierAdminFee: tInfo?.adminFeeUsd ?? "",
      currentTier: targetTier ? targetTier - 1 : "",
      nextTier: targetTier ?? "",
      dripType: row.drip_type,
      step: row.current_step,
    };

    const subject = `Step ${row.current_step + 1}: ${row.drip_type.replace(/_/g, " ")}`;
    const idempotencyKey = `drip-${row.subscriber_id}-${row.drip_type}-${row.current_step}`;
    await enqueue({
      emailType: row.drip_type,
      templateId: `${row.drip_type}_step${row.current_step}_v1`,
      subscriberId: row.subscriber_id,
      recipientEmail: row.email,
      recipientWallet: row.wallet_address,
      subject,
      vars,
      idempotencyKey,
      triggeredBy: "drip_cron",
      context: {
        dripStateId: row.id,
        dripType: row.drip_type,
        step: row.current_step,
      },
    });
    fired += 1;

    // Advance.
    const nextStep = row.current_step + 1;
    if (nextStep >= row.total_steps) {
      await getPool().query(
        `UPDATE wt_email_drip_state
            SET completed_at = NOW(),
                current_step = $2,
                last_step_sent_at = NOW(),
                next_step_due_at = NULL
          WHERE id = $1::uuid`,
        [row.id, nextStep],
      );
    } else {
      const stretchDays = STEP_DAYS_FROM_ENROLL[nextStep] ?? 21;
      const stretched = stretchDays * Number(row.cadence_multiplier);
      // The "interval from enrollment" math means we should compute due time
      // from enrolled_at, not from now. Simplification: compute days-from-now
      // since gap-from-prev-step is what users feel.
      const gap =
        (STEP_DAYS_FROM_ENROLL[nextStep] ?? 0) -
        (STEP_DAYS_FROM_ENROLL[row.current_step] ?? 0);
      void stretched; // unused for now; kept for future enrolled_at-based math
      await getPool().query(
        `UPDATE wt_email_drip_state
            SET current_step = $2,
                last_step_sent_at = NOW(),
                next_step_due_at = NOW() + ($3 || ' days')::interval
          WHERE id = $1::uuid`,
        [row.id, nextStep, gap],
      );
    }
  }
  return { fired, cancelled };
}

export async function runOnce(): Promise<void> {
  const e = await tickEnroll();
  const f = await tickFire();
  logger.info(
    { enrolled: e.enrolled, fired: f.fired, cancelled: f.cancelled },
    "drip_tick_done",
  );
}
