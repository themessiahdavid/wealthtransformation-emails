-- =============================================================================
-- Migration 004: wt_email_outbox
-- =============================================================================
-- Every email — transactional, drip, broadcast — flows through this single
-- queue. Producers INSERT rows with status='queued'. The worker drains in
-- batches, calls SendGrid, updates status. Status callbacks from SendGrid
-- (delivered, opened, clicked, bounced, etc.) update the same row.
--
-- The idempotency_key is the producer's responsibility. For chain events:
--   wt-{chain}-{txHash}-{logIndex}-{type}-{recipientWallet}
-- For drips:
--   drip-{subscriberId}-{type}-{stepIndex}
-- For sponsor signups:
--   sponsor-{newUserWallet}-{sponsorWallet}
-- This prevents duplicate sends on retry.

CREATE TABLE wt_email_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Routing
  email_type wt_email_type NOT NULL,
  template_id VARCHAR(128) NOT NULL,         -- SendGrid dynamic template ID
  template_version INTEGER NOT NULL DEFAULT 1,

  -- Recipient
  subscriber_id UUID REFERENCES wt_email_subscribers(id) ON DELETE SET NULL,
  recipient_email VARCHAR(320) NOT NULL,
  recipient_wallet VARCHAR(64),

  -- Body
  subject TEXT NOT NULL,
  vars JSONB NOT NULL DEFAULT '{}',          -- substitution variables for template

  -- Idempotency: producer-supplied unique key. ON CONFLICT DO NOTHING.
  idempotency_key VARCHAR(255) NOT NULL UNIQUE,

  -- Lifecycle
  status wt_email_status NOT NULL DEFAULT 'queued',
  scheduled_for TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Send tracking
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  sendgrid_message_id VARCHAR(255),
  delivered_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  bounced_at TIMESTAMPTZ,
  bounce_reason TEXT,
  failed_at TIMESTAMPTZ,
  failed_reason TEXT,

  -- Provenance
  triggered_by VARCHAR(64) NOT NULL,         -- 'indexer', 'capture_api', 'cron', 'admin', 'sponsor_api'
  context JSONB NOT NULL DEFAULT '{}',       -- arbitrary trigger context (txHash, blockNumber, etc.)

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Worker drain query: queued + due, order by scheduled_for, FOR UPDATE SKIP LOCKED.
CREATE INDEX idx_wt_email_outbox_drain ON wt_email_outbox (scheduled_for, id)
  WHERE status = 'queued';

-- Admin send-log lookups
CREATE INDEX idx_wt_email_outbox_recipient ON wt_email_outbox (recipient_email, created_at DESC);
CREATE INDEX idx_wt_email_outbox_subscriber ON wt_email_outbox (subscriber_id, created_at DESC)
  WHERE subscriber_id IS NOT NULL;
CREATE INDEX idx_wt_email_outbox_type ON wt_email_outbox (email_type, created_at DESC);

-- SendGrid event-webhook lookup
CREATE INDEX idx_wt_email_outbox_sendgrid_msg ON wt_email_outbox (sendgrid_message_id)
  WHERE sendgrid_message_id IS NOT NULL;
