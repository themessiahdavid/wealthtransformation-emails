// "Should this go out?" gate. Called by every producer before enqueueing,
// and by the worker before sending. Blocks suppressed addresses, paused
// subscribers, disabled email types, and global pause.

import { getPool } from "../db/pool.js";
import { logger } from "../log.js";

export interface DispatchCheck {
  allow: boolean;
  reason?: string;
}

export async function isGloballyPaused(): Promise<boolean> {
  const r = await getPool().query<{ value: boolean }>(
    `SELECT (value::text)::boolean AS value FROM wt_email_settings WHERE key = 'global_pause' LIMIT 1`,
  );
  return r.rows[0]?.value === true;
}

export async function isTypeEnabled(emailType: string): Promise<boolean> {
  // Drip types share a single global toggle.
  const settingKey = emailType.startsWith("drip_")
    ? "type_enabled.drips"
    : `type_enabled.${emailType}`;
  const r = await getPool().query<{ value: boolean }>(
    `SELECT (value::text)::boolean AS value FROM wt_email_settings WHERE key = $1 LIMIT 1`,
    [settingKey],
  );
  // If no setting row exists, default to enabled (admin can opt out per-type later).
  return r.rows[0]?.value !== false;
}

export async function isAddressSuppressed(email: string): Promise<boolean> {
  const r = await getPool().query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM wt_email_suppressions
        WHERE lower(email) = lower($1) AND released_at IS NULL
     ) AS exists`,
    [email],
  );
  return r.rows[0]?.exists === true;
}

export async function preflight(args: {
  emailType: string;
  recipientEmail: string;
  subscriberId: string | null;
}): Promise<DispatchCheck> {
  if (await isGloballyPaused()) return { allow: false, reason: "global_pause" };
  if (!(await isTypeEnabled(args.emailType)))
    return { allow: false, reason: `type_disabled:${args.emailType}` };
  if (await isAddressSuppressed(args.recipientEmail))
    return { allow: false, reason: "suppressed" };

  if (args.subscriberId) {
    const r = await getPool().query<{
      enabled: boolean;
      paused: boolean;
      unsubscribed: boolean;
      confirmed: boolean;
      transactional: boolean;
    }>(
      `SELECT
         wt_email_pref_enabled($1::uuid, $2::wt_email_type) AS enabled,
         (s.paused_until IS NOT NULL AND s.paused_until > NOW()) AS paused,
         (s.unsubscribed_at IS NOT NULL) AS unsubscribed,
         (s.email_confirmed_at IS NOT NULL) AS confirmed,
         ($2::wt_email_type IN ('earned_commission','lost_commission','cascade_passup',
                                'sponsor_signup','opt_in_confirmation')) AS transactional
       FROM wt_email_subscribers s
       WHERE s.id = $1::uuid
       LIMIT 1`,
      [args.subscriberId, args.emailType],
    );
    const row = r.rows[0];
    if (!row) {
      logger.warn(
        { subscriberId: args.subscriberId },
        "preflight subscriber lookup empty",
      );
      return { allow: false, reason: "subscriber_not_found" };
    }
    if (row.unsubscribed) return { allow: false, reason: "unsubscribed" };
    if (!row.enabled) return { allow: false, reason: "preference_off" };
    if (row.paused) return { allow: false, reason: "paused" };
    // Marketing emails require double opt-in confirmation. Transactional always go.
    if (!row.transactional && !row.confirmed)
      return { allow: false, reason: "not_confirmed" };
  }
  return { allow: true };
}
