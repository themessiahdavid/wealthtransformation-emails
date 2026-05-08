// Outbox enqueue + drain. Producers call enqueue(); the worker drains in
// batches via takeBatch + markSent/markFailed. Idempotency is enforced by the
// unique constraint on idempotency_key — duplicate enqueues silently no-op.

import type { PoolClient } from "pg";
import { getPool } from "../db/pool.js";

export interface EnqueueInput {
  emailType: string;
  templateId: string;
  templateVersion?: number;
  subscriberId: string | null;
  recipientEmail: string;
  recipientWallet: string | null;
  subject: string;
  vars: Record<string, unknown>;
  idempotencyKey: string;
  scheduledFor?: Date;
  triggeredBy: string;
  context?: Record<string, unknown>;
}

export interface OutboxRow {
  id: string;
  email_type: string;
  template_id: string;
  template_version: number;
  subscriber_id: string | null;
  recipient_email: string;
  recipient_wallet: string | null;
  subject: string;
  vars: Record<string, unknown>;
  idempotency_key: string;
  status: string;
  scheduled_for: Date;
  attempts: number;
}

// Returns the inserted row id, or null if a row with the same idempotency key
// already exists (silent no-op — desired behavior).
export async function enqueue(
  input: EnqueueInput,
  client?: PoolClient,
): Promise<string | null> {
  const q = client ?? getPool();
  const r = await q.query<{ id: string }>(
    `INSERT INTO wt_email_outbox
       (email_type, template_id, template_version, subscriber_id, recipient_email,
        recipient_wallet, subject, vars, idempotency_key, scheduled_for,
        triggered_by, context)
     VALUES ($1, $2, $3, $4::uuid, $5, $6, $7, $8::jsonb, $9, $10, $11, $12::jsonb)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [
      input.emailType,
      input.templateId,
      input.templateVersion ?? 1,
      input.subscriberId,
      input.recipientEmail,
      input.recipientWallet,
      input.subject,
      JSON.stringify(input.vars),
      input.idempotencyKey,
      input.scheduledFor ?? new Date(),
      input.triggeredBy,
      JSON.stringify(input.context ?? {}),
    ],
  );
  return r.rows[0]?.id ?? null;
}

// Atomically claim up to `limit` queued rows that are due. Marks them 'sending'.
// Uses FOR UPDATE SKIP LOCKED so multiple workers can drain the same queue
// safely.
export async function takeBatch(limit: number): Promise<OutboxRow[]> {
  const r = await getPool().query<OutboxRow>(
    `WITH claimed AS (
       SELECT id FROM wt_email_outbox
        WHERE status = 'queued' AND scheduled_for <= NOW()
        ORDER BY scheduled_for, id
        LIMIT $1
        FOR UPDATE SKIP LOCKED
     )
     UPDATE wt_email_outbox o
        SET status = 'sending',
            attempts = attempts + 1,
            last_attempt_at = NOW()
       FROM claimed c
      WHERE o.id = c.id
      RETURNING o.*`,
    [limit],
  );
  return r.rows;
}

export async function markSent(
  id: string,
  sendgridMessageId: string,
): Promise<void> {
  await getPool().query(
    `UPDATE wt_email_outbox
        SET status = 'sent',
            sent_at = NOW(),
            sendgrid_message_id = $2
      WHERE id = $1`,
    [id, sendgridMessageId],
  );
}

export async function markFailed(
  id: string,
  reason: string,
  retryable: boolean,
  maxAttempts = 5,
): Promise<void> {
  await getPool().query(
    `UPDATE wt_email_outbox
        SET status = CASE
              WHEN $3::boolean = TRUE AND attempts < $4 THEN 'queued'::wt_email_status
              ELSE 'failed'::wt_email_status
            END,
            scheduled_for = CASE
              WHEN $3::boolean = TRUE AND attempts < $4
                THEN NOW() + (LEAST(60, POW(2, attempts)) || ' seconds')::interval
              ELSE scheduled_for
            END,
            failed_at = CASE
              WHEN $3::boolean = TRUE AND attempts < $4 THEN failed_at
              ELSE NOW()
            END,
            failed_reason = $2
      WHERE id = $1`,
    [id, reason, retryable, maxAttempts],
  );
}

export async function markCancelled(id: string): Promise<void> {
  await getPool().query(
    `UPDATE wt_email_outbox SET status = 'cancelled' WHERE id = $1 AND status = 'queued'`,
    [id],
  );
}
