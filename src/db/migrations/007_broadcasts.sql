-- =============================================================================
-- Migration 007: wt_email_broadcasts
-- =============================================================================
-- Admin-composed one-off sends. The admin defines a subject + body + segment
-- predicate. The system materializes recipients (one outbox row per match)
-- and the worker sends them at the configured rate.

CREATE TABLE wt_email_broadcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Composition
  subject TEXT NOT NULL,
  preview_text TEXT,
  html_body TEXT NOT NULL,
  text_body TEXT,

  -- Segmentation predicate. Evaluated by the materializer to expand into outbox rows.
  -- Schema:
  --   { ownsTiers: { any?: number[], all?: number[], none?: number[] }
  --   , capturedNotPurchased?: boolean
  --   , minEarningsLast30dCents?: number
  --   , walletAllowlist?: string[]
  --   , engagementTierIn?: string[]
  --   , confirmedOnly?: boolean
  --   }
  segment JSONB NOT NULL DEFAULT '{}',

  -- Lifecycle
  status VARCHAR(32) NOT NULL DEFAULT 'draft',     -- 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled'
  scheduled_for TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Stats (filled in as the materialized rows progress)
  total_recipients INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  opened_count INTEGER NOT NULL DEFAULT 0,
  clicked_count INTEGER NOT NULL DEFAULT 0,
  bounced_count INTEGER NOT NULL DEFAULT 0,
  unsubscribed_count INTEGER NOT NULL DEFAULT 0,

  -- Provenance
  created_by_wallet VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wt_email_broadcasts_status ON wt_email_broadcasts (status, scheduled_for);
