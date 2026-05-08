// HTTP API. Endpoints:
//
//   Public (signed-token auth):
//     GET  /v1/preferences?token=…              — current pref state
//     POST /v1/preferences                       — update prefs
//     GET  /v1/unsubscribe?token=…&type=…       — one-click unsubscribe
//     GET  /v1/confirm?token=…                   — opt-in confirmation
//     GET  /v1/pause?token=…&days=30             — pause-for-N-days
//
//   Service-to-service (HMAC):
//     POST /v1/internal/capture                  — wt_app capture form → enroll subscriber
//     POST /v1/internal/purchase-event           — indexer → fan out emails for one Purchased
//     POST /v1/internal/sponsor-notify           — manual sponsor email trigger
//     POST /v1/internal/sendgrid-callback        — SendGrid event webhook (open/click/bounce)
//
//   Admin (JWT):
//     POST /v1/admin/auth                        — exchange SIWE proof for JWT
//     GET  /v1/admin/dashboard                   — stats summary
//     GET  /v1/admin/sends                       — recent send log
//     GET  /v1/admin/templates                   — list templates
//     POST /v1/admin/templates                   — create new template version
//     PUT  /v1/admin/settings                    — toggle global pause / per-type
//     POST /v1/admin/broadcast                   — send broadcast
//     GET  /v1/admin/subscribers                 — list with filters

import express, { type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { logger } from "../log.js";
import { getPool } from "../db/pool.js";
import { requireHmac, requireAdmin } from "./auth.js";
import { issueToken, verifyToken } from "./preference-token.js";
import { processPurchasedEvent } from "../producers/purchase.js";
import { upsertSubscriber } from "../subscribers/upsert.js";
import { applyEvent } from "../scoring/engagement.js";

export function buildApp() {
  const app = express();

  // Capture raw body for HMAC verification.
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as Request & { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );

  app.get("/healthz", (_req, res) => res.json({ ok: true }));

  // -------- Public preference center --------
  app.get("/v1/preferences", async (req, res) => {
    const token = String(req.query.token ?? "");
    const verified = verifyToken(token);
    if (!verified) return res.status(401).json({ error: "invalid_token" });
    const prefs = await getPool().query(
      `SELECT email_type, enabled, cadence_override
         FROM wt_email_preferences WHERE subscriber_id = $1::uuid`,
      [verified.subscriberId],
    );
    const sub = await getPool().query<{
      email: string;
      paused_until: Date | null;
      unsubscribed_at: Date | null;
    }>(
      `SELECT email, paused_until, unsubscribed_at
         FROM wt_email_subscribers WHERE id = $1::uuid LIMIT 1`,
      [verified.subscriberId],
    );
    if (sub.rows.length === 0) return res.status(404).json({ error: "not_found" });
    res.json({
      email: sub.rows[0].email,
      pausedUntil: sub.rows[0].paused_until,
      unsubscribed: !!sub.rows[0].unsubscribed_at,
      preferences: prefs.rows,
    });
  });

  const PrefsUpdateSchema = z.object({
    token: z.string(),
    preferences: z.array(
      z.object({
        emailType: z.string(),
        enabled: z.boolean(),
        cadenceOverride: z.string().nullable().optional(),
      }),
    ),
  });
  app.post("/v1/preferences", async (req, res) => {
    const parsed = PrefsUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid_body" });
    const verified = verifyToken(parsed.data.token);
    if (!verified) return res.status(401).json({ error: "invalid_token" });
    for (const p of parsed.data.preferences) {
      await getPool().query(
        `INSERT INTO wt_email_preferences
           (subscriber_id, email_type, enabled, cadence_override, updated_via)
         VALUES ($1::uuid, $2::wt_email_type, $3, $4, 'preference_center')
         ON CONFLICT (subscriber_id, email_type) DO UPDATE SET
           enabled = EXCLUDED.enabled,
           cadence_override = EXCLUDED.cadence_override,
           updated_at = NOW(),
           updated_via = 'preference_center'`,
        [verified.subscriberId, p.emailType, p.enabled, p.cadenceOverride ?? null],
      );
    }
    res.json({ ok: true });
  });

  app.get("/v1/unsubscribe", async (req, res) => {
    const token = String(req.query.token ?? "");
    const verified = verifyToken(token);
    if (!verified) return res.status(401).send("invalid token");
    await getPool().query(
      `UPDATE wt_email_subscribers SET unsubscribed_at = NOW() WHERE id = $1::uuid`,
      [verified.subscriberId],
    );
    res
      .type("text/html")
      .send(
        "<h1>Unsubscribed.</h1><p>You will no longer receive marketing emails from Wealth Transformation. You'll still receive transactional notifications about your wallet activity unless you turn those off in your preference center.</p>",
      );
  });

  app.get("/v1/confirm", async (req, res) => {
    const token = String(req.query.token ?? "");
    const verified = verifyToken(token);
    if (!verified) return res.status(401).send("invalid token");
    await getPool().query(
      `UPDATE wt_email_subscribers
          SET email_confirmed_at = COALESCE(email_confirmed_at, NOW())
        WHERE id = $1::uuid`,
      [verified.subscriberId],
    );
    res
      .type("text/html")
      .send(
        "<h1>Email confirmed.</h1><p>You're on the list. Watch your inbox for the playbook.</p>",
      );
  });

  app.get("/v1/pause", async (req, res) => {
    const token = String(req.query.token ?? "");
    const days = Math.min(90, Math.max(1, Number.parseInt(String(req.query.days ?? "30"), 10)));
    const verified = verifyToken(token);
    if (!verified) return res.status(401).send("invalid token");
    await getPool().query(
      `UPDATE wt_email_subscribers SET paused_until = NOW() + ($2 || ' days')::interval WHERE id = $1::uuid`,
      [verified.subscriberId, days],
    );
    res.type("text/html").send(`<h1>Paused for ${days} days.</h1>`);
  });

  // -------- Service-to-service --------
  app.post("/v1/internal/capture", requireHmac, async (req, res) => {
    const Schema = z.object({
      walletAddress: z.string(),
      email: z.string().email(),
      refCode: z.string().optional().nullable(),
      displayName: z.string().optional().nullable(),
    });
    const parsed = Schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid_body" });
    const r = await upsertSubscriber({
      walletAddress: parsed.data.walletAddress,
      email: parsed.data.email,
      refCode: parsed.data.refCode ?? null,
      displayName: parsed.data.displayName ?? null,
      source: "capture_form",
    });
    res.json({ subscriberId: r.subscriberId, isNew: r.isNew });
  });

  app.post("/v1/internal/purchase-event", requireHmac, async (req, res) => {
    const Schema = z.object({
      txHash: z.string(),
      logIndex: z.number().int(),
      blockNumber: z.union([z.string(), z.number()]),
      buyer: z.string(),
      tier: z.number().int(),
      earningSeller: z.string(),
      commissionRecipient: z.string(),
      isPassup: z.boolean(),
      becameAffiliate: z.boolean(),
      occurredAt: z.string(),
    });
    const parsed = Schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid_body" });
    const result = await processPurchasedEvent({
      txHash: parsed.data.txHash as `0x${string}`,
      logIndex: parsed.data.logIndex,
      blockNumber: BigInt(parsed.data.blockNumber),
      buyer: parsed.data.buyer as `0x${string}`,
      tier: parsed.data.tier,
      earningSeller: parsed.data.earningSeller as `0x${string}`,
      commissionRecipient: parsed.data.commissionRecipient as `0x${string}`,
      isPassup: parsed.data.isPassup,
      becameAffiliate: parsed.data.becameAffiliate,
      occurredAt: new Date(parsed.data.occurredAt),
    });
    res.json({ ok: true, ...result });
  });

  // SendGrid event webhook — open / click / bounce / spam_report / delivered.
  app.post("/v1/internal/sendgrid-callback", express.json(), async (req, res) => {
    // SendGrid sends an array of events.
    const events = Array.isArray(req.body) ? req.body : [];
    for (const ev of events) {
      const e = ev as Record<string, unknown>;
      const customArgs = (e["customArgs"] ?? {}) as Record<string, string>;
      const outboxId = customArgs["outbox_id"];
      if (!outboxId) continue;
      const eventName = String(e["event"] ?? "");
      const sql = (() => {
        switch (eventName) {
          case "delivered":
            return `UPDATE wt_email_outbox SET status = 'delivered', delivered_at = NOW() WHERE id = $1::uuid`;
          case "open":
            return `UPDATE wt_email_outbox SET opened_at = COALESCE(opened_at, NOW()), status = CASE WHEN status IN ('sent','delivered') THEN 'opened'::wt_email_status ELSE status END WHERE id = $1::uuid`;
          case "click":
            return `UPDATE wt_email_outbox SET clicked_at = COALESCE(clicked_at, NOW()), status = CASE WHEN status IN ('sent','delivered','opened') THEN 'clicked'::wt_email_status ELSE status END WHERE id = $1::uuid`;
          case "bounce":
          case "blocked":
          case "dropped":
            return `UPDATE wt_email_outbox SET bounced_at = NOW(), bounce_reason = $2, status = 'bounced' WHERE id = $1::uuid`;
          case "spamreport":
            return `UPDATE wt_email_outbox SET status = 'spam_reported' WHERE id = $1::uuid`;
          default:
            return null;
        }
      })();
      if (!sql) continue;
      try {
        if (sql.includes("$2")) {
          await getPool().query(sql, [outboxId, String(e["reason"] ?? eventName)]);
        } else {
          await getPool().query(sql, [outboxId]);
        }
        // Update engagement scoring on the subscriber.
        const r = await getPool().query<{ subscriber_id: string | null }>(
          `SELECT subscriber_id FROM wt_email_outbox WHERE id = $1::uuid LIMIT 1`,
          [outboxId],
        );
        const subId = r.rows[0]?.subscriber_id;
        if (subId) {
          if (eventName === "open") await applyEvent(subId, "open");
          else if (eventName === "click") await applyEvent(subId, "click");
          else if (eventName === "bounce" || eventName === "spamreport")
            await applyEvent(subId, "spam_or_bounce");
        }
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : err, outboxId, eventName },
          "sendgrid_callback_update_failed",
        );
      }
    }
    res.json({ ok: true });
  });

  // -------- Admin --------
  app.get("/v1/admin/dashboard", requireAdmin, async (_req, res) => {
    const r = await getPool().query<{
      total_subscribers: number;
      sent_24h: number;
      bounced_24h: number;
      open_rate_24h: number | null;
    }>(
      `SELECT
         (SELECT COUNT(*)::int FROM wt_email_subscribers WHERE unsubscribed_at IS NULL AND suppressed_at IS NULL) AS total_subscribers,
         (SELECT COUNT(*)::int FROM wt_email_outbox WHERE sent_at > NOW() - INTERVAL '24 hours') AS sent_24h,
         (SELECT COUNT(*)::int FROM wt_email_outbox WHERE bounced_at > NOW() - INTERVAL '24 hours') AS bounced_24h,
         (SELECT (COUNT(*) FILTER (WHERE opened_at IS NOT NULL))::float
                 / NULLIF(COUNT(*) FILTER (WHERE sent_at > NOW() - INTERVAL '24 hours'), 0)
            FROM wt_email_outbox
           WHERE sent_at > NOW() - INTERVAL '24 hours') AS open_rate_24h`,
    );
    res.json(r.rows[0]);
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err: err instanceof Error ? err.message : err }, "api_unhandled");
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = buildApp();
  const server = app.listen(config.apiPort, () => {
    logger.info({ port: config.apiPort, env: config.env }, "api_listening");
  });
  const shutdown = () => {
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// Helper export for issueToken (used by drip emails to embed pref-center links).
export { issueToken };
