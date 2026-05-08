// Outbox drain worker. Polls every config.outboxIntervalMs, claims a batch,
// sends each via SendGrid, marks status. Honors preflight gates and per-minute
// rate limit.

import { config } from "../config.js";
import { logger } from "../log.js";
import { takeBatch, markSent, markFailed, type OutboxRow } from "../email/outbox.js";
import { resolveTemplate, renderFallback, renderSubject } from "../email/templates.js";
import { sendOne } from "../email/sendgrid.js";
import { preflight } from "../email/dispatch.js";
import { closePool } from "../db/pool.js";

class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  constructor(
    public readonly capacity: number,
    public readonly refillPerMs: number,
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }
  tryConsume(n = 1): boolean {
    const now = Date.now();
    this.tokens = Math.min(
      this.capacity,
      this.tokens + (now - this.lastRefill) * this.refillPerMs,
    );
    this.lastRefill = now;
    if (this.tokens >= n) {
      this.tokens -= n;
      return true;
    }
    return false;
  }
}

async function processOne(row: OutboxRow, bucket: TokenBucket): Promise<void> {
  // Re-check preflight at send time — settings or preferences might have
  // changed since enqueue.
  const pre = await preflight({
    emailType: row.email_type,
    recipientEmail: row.recipient_email,
    subscriberId: row.subscriber_id,
  });
  if (!pre.allow) {
    await markFailed(row.id, `preflight:${pre.reason}`, false);
    logger.info(
      { id: row.id, type: row.email_type, reason: pre.reason },
      "send_blocked_by_preflight",
    );
    return;
  }

  const template = await resolveTemplate(row.email_type);
  if (!template) {
    await markFailed(row.id, "no_active_template", false);
    logger.warn({ id: row.id, type: row.email_type }, "no_active_template_for_type");
    return;
  }

  // Validate required variables present.
  for (const v of template.requiredVariables) {
    if (!(v in row.vars)) {
      await markFailed(row.id, `missing_var:${v}`, false);
      logger.warn(
        { id: row.id, type: row.email_type, missing: v },
        "missing_required_variable",
      );
      return;
    }
  }

  // Wait for a rate-limit token (cheap busy-wait — outboxIntervalMs gates the loop).
  if (!bucket.tryConsume(1)) {
    // Reschedule to next tick rather than block the batch.
    await markFailed(row.id, "rate_limited", true);
    return;
  }

  const subject = renderSubject(row.subject || template.subject, row.vars);
  const result = await sendOne({
    to: row.recipient_email,
    subject,
    templateId: template.templateId ?? undefined,
    dynamicTemplateData: template.templateId ? row.vars : undefined,
    htmlBody:
      !template.templateId && template.htmlBody
        ? renderFallback(template.htmlBody, row.vars)
        : undefined,
    textBody:
      !template.templateId && template.textBody
        ? renderFallback(template.textBody, row.vars)
        : undefined,
    customArgs: {
      outbox_id: row.id,
      email_type: row.email_type,
      template_version: String(template.version),
    },
    category: row.email_type,
  });

  if (result.ok) {
    await markSent(row.id, result.messageId);
    logger.info(
      {
        id: row.id,
        type: row.email_type,
        to: row.recipient_email,
        messageId: result.messageId,
      },
      "sent",
    );
  } else {
    await markFailed(row.id, result.message, result.retryable);
    logger.warn(
      {
        id: row.id,
        type: row.email_type,
        to: row.recipient_email,
        retryable: result.retryable,
        reason: result.message,
      },
      "send_failed",
    );
  }
}

async function tick(bucket: TokenBucket): Promise<number> {
  const batch = await takeBatch(config.outboxBatchSize);
  if (batch.length === 0) return 0;
  // Send sequentially to keep ordering and rate-limit math simple. Concurrency
  // can be added later if SendGrid throughput becomes a bottleneck.
  for (const row of batch) {
    try {
      await processOne(row, bucket);
    } catch (err) {
      logger.error(
        { id: row.id, err: err instanceof Error ? err.message : err },
        "process_one_unhandled",
      );
      await markFailed(
        row.id,
        err instanceof Error ? err.message : "unhandled_error",
        true,
      );
    }
  }
  return batch.length;
}

export async function run(abortSignal?: AbortSignal): Promise<void> {
  const bucket = new TokenBucket(
    config.sendRateLimitPerMinute,
    config.sendRateLimitPerMinute / 60_000,
  );
  logger.info(
    {
      batchSize: config.outboxBatchSize,
      intervalMs: config.outboxIntervalMs,
      rateLimit: config.sendRateLimitPerMinute,
      stubMode: !config.sendgridApiKey,
    },
    "worker_started",
  );

  while (!abortSignal?.aborted) {
    try {
      const sent = await tick(bucket);
      if (sent > 0) logger.debug({ sent }, "tick_done");
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : err }, "tick_error");
    }
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, config.outboxIntervalMs);
      abortSignal?.addEventListener(
        "abort",
        () => {
          clearTimeout(t);
          resolve();
        },
        { once: true },
      );
    });
  }
  logger.info("worker_stopped");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const abort = new AbortController();
  process.on("SIGINT", () => abort.abort());
  process.on("SIGTERM", () => abort.abort());
  run(abort.signal)
    .catch((err) => {
      logger.error({ err: err instanceof Error ? err.message : err }, "worker_fatal");
      process.exit(1);
    })
    .finally(closePool);
}
