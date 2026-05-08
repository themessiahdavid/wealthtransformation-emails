// Idempotent subscriber upsert. Producers call this whenever they encounter a
// (wallet, email) pair — capture form, on-chain Purchased event, IAT
// auto-provision callback. Returns the subscriber id.

import type { PoolClient } from "pg";
import { getPool } from "../db/pool.js";

export interface UpsertInput {
  walletAddress: string;
  email: string;
  iatUserId?: string | null;
  displayName?: string | null;
  source: "capture_form" | "on_chain" | "iat_provision" | "manual_add";
  refCode?: string | null;
}

export interface UpsertResult {
  subscriberId: string;
  isNew: boolean;
}

export async function upsertSubscriber(
  input: UpsertInput,
  client?: PoolClient,
): Promise<UpsertResult> {
  const q = client ?? getPool();
  // The unique-on-lower(wallet) index lets us upsert by wallet. Email is also
  // unique — if a different wallet shows up with the same email, we'll get an
  // error and the producer needs to decide policy. (Rare in practice.)
  const wallet = input.walletAddress.toLowerCase();
  const r = await q.query<{ id: string; is_new: boolean }>(
    `INSERT INTO wt_email_subscribers
       (wallet_address, email, iat_user_id, display_name, source, ref_code)
     VALUES (lower($1), $2, $3::uuid, $4, $5, $6)
     ON CONFLICT (lower(wallet_address)) DO UPDATE SET
       email = COALESCE(EXCLUDED.email, wt_email_subscribers.email),
       iat_user_id = COALESCE(EXCLUDED.iat_user_id, wt_email_subscribers.iat_user_id),
       display_name = COALESCE(EXCLUDED.display_name, wt_email_subscribers.display_name)
     RETURNING id, (xmax = 0) AS is_new`,
    [
      wallet,
      input.email.toLowerCase(),
      input.iatUserId ?? null,
      input.displayName ?? null,
      input.source,
      input.refCode ?? null,
    ],
  );
  return { subscriberId: r.rows[0].id, isNew: r.rows[0].is_new };
}

export async function findByWallet(walletAddress: string): Promise<{
  id: string;
  email: string;
  iat_user_id: string | null;
  display_name: string | null;
  unsubscribed_at: Date | null;
  email_confirmed_at: Date | null;
} | null> {
  const r = await getPool().query(
    `SELECT id, email, iat_user_id, display_name, unsubscribed_at, email_confirmed_at
       FROM wt_email_subscribers
      WHERE lower(wallet_address) = lower($1)
      LIMIT 1`,
    [walletAddress],
  );
  return r.rows[0] ?? null;
}
