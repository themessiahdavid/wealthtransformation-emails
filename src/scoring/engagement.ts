// Engagement score updates + tier classification.
//
// Score deltas (per spec):
//   open: +1, click: +3, send-no-open-48h: -0.5, spam/bounce: -50, purchase: +10 (reset)
// Tier mapping (default thresholds — overridable via wt_email_settings):
//   >= 5 → engaged (1.0× cadence)
//   0..4 → cooling (2.0× stretched cadence)
//   -2..0 → cold (only emails 3 + 6 of each drip)
//   < -2 → frozen (sequence paused)

import { getPool } from "../db/pool.js";

export type ScoreEvent =
  | "open"
  | "click"
  | "send_no_open"
  | "spam_or_bounce"
  | "purchase";

const DELTAS: Record<ScoreEvent, number> = {
  open: 1,
  click: 3,
  send_no_open: -0.5,
  spam_or_bounce: -50,
  purchase: 10, // also resets to ≥10
};

export interface ScoreThresholds {
  engaged: number;
  cooling: number;
  cold: number;
}

let thresholdsCache: { value: ScoreThresholds; expiresAt: number } | null = null;

export async function getThresholds(): Promise<ScoreThresholds> {
  if (thresholdsCache && thresholdsCache.expiresAt > Date.now())
    return thresholdsCache.value;
  const r = await getPool().query<{ value: ScoreThresholds }>(
    `SELECT value FROM wt_email_settings WHERE key = 'engagement_score_thresholds' LIMIT 1`,
  );
  const value = r.rows[0]?.value ?? { engaged: 5, cooling: 0, cold: -2 };
  thresholdsCache = { value, expiresAt: Date.now() + 60_000 };
  return value;
}

export function tierForScore(
  score: number,
  thresholds: ScoreThresholds,
): "engaged" | "cooling" | "cold" | "frozen" {
  if (score >= thresholds.engaged) return "engaged";
  if (score >= thresholds.cooling) return "cooling";
  if (score >= thresholds.cold) return "cold";
  return "frozen";
}

export async function applyEvent(
  subscriberId: string,
  event: ScoreEvent,
): Promise<{ newScore: number; newTier: string }> {
  const delta = DELTAS[event];
  const thresholds = await getThresholds();

  // Purchase event: floor the score to delta, don't add. (Reset behavior.)
  const r = await getPool().query<{ engagement_score: number }>(
    `UPDATE wt_email_subscribers
        SET engagement_score = CASE
              WHEN $2 = 'purchase' THEN GREATEST(engagement_score, $3::numeric)
              ELSE engagement_score + $3::numeric
            END,
            engagement_updated_at = NOW()
      WHERE id = $1::uuid
      RETURNING engagement_score`,
    [subscriberId, event, delta],
  );
  const newScore = Number(r.rows[0]?.engagement_score ?? 0);
  const newTier = tierForScore(newScore, thresholds);
  await getPool().query(
    `UPDATE wt_email_subscribers SET engagement_tier = $2::wt_engagement_tier WHERE id = $1::uuid`,
    [subscriberId, newTier],
  );
  return { newScore, newTier };
}

// Daily-decay job hook: subtract 0.1 from every active subscriber's score.
// Prevents permanently inflated scores from old activity.
export async function dailyDecay(): Promise<number> {
  const r = await getPool().query<{ count: number }>(
    `WITH updated AS (
       UPDATE wt_email_subscribers
          SET engagement_score = engagement_score - 0.1,
              engagement_updated_at = NOW()
        WHERE unsubscribed_at IS NULL AND suppressed_at IS NULL
        RETURNING id
     )
     SELECT COUNT(*)::int AS count FROM updated`,
  );
  return r.rows[0]?.count ?? 0;
}
