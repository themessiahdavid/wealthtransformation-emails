-- =============================================================================
-- Migration 006: wt_email_drip_state
-- =============================================================================
-- Tracks each subscriber's progress through each autoresponder sequence.
-- One row per (subscriber, drip type) combination.
--
-- Sequences run in parallel for different drip types but exactly one
-- tier-upgrade drip is active per subscriber at any moment (governed by
-- which tier they own — owning T2 stops the T1→T2 drip and starts T2→T3).
--
-- The cron scheduler scans this table every 15 minutes for due steps.

CREATE TABLE wt_email_drip_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  subscriber_id UUID NOT NULL REFERENCES wt_email_subscribers(id) ON DELETE CASCADE,
  drip_type wt_email_type NOT NULL,                 -- one of the drip_* enum values

  -- Sequence position (0..6 for the 7-step sequences)
  current_step SMALLINT NOT NULL DEFAULT 0,
  total_steps SMALLINT NOT NULL DEFAULT 7,

  -- Lifecycle
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  next_step_due_at TIMESTAMPTZ,                     -- when the cron should fire current_step
  last_step_sent_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,                          -- all 7 steps sent
  cancelled_at TIMESTAMPTZ,                          -- buyer upgraded, unsubscribed, or suppressed
  cancelled_reason VARCHAR(64),                      -- 'upgraded', 'unsubscribed', 'suppressed', 'admin'

  -- Cadence override based on engagement tier at the time of each schedule
  cadence_multiplier NUMERIC(3,1) NOT NULL DEFAULT 1.0, -- 1.0 = engaged, 2.0 = cooling, dropped = cold/frozen

  metadata JSONB NOT NULL DEFAULT '{}',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (subscriber_id, drip_type)
);

CREATE INDEX idx_wt_email_drip_due ON wt_email_drip_state (next_step_due_at)
  WHERE cancelled_at IS NULL AND completed_at IS NULL AND next_step_due_at IS NOT NULL;

CREATE INDEX idx_wt_email_drip_subscriber ON wt_email_drip_state (subscriber_id);
