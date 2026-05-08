-- =============================================================================
-- Migration 002: wt_email_subscribers
-- =============================================================================
-- The list of people who can receive emails from us. Keyed by wallet (the only
-- truly stable identifier across IAT + WT). Email is cached from IAT for fast
-- access; refreshed when IAT pings us with a wallet binding.
--
-- A row is created at first capture (via the WT site capture form OR at first
-- on-chain Purchased event we see). Owns_tiers and engagement_score are
-- updated by background jobs.

CREATE TABLE wt_email_subscribers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  wallet_address VARCHAR(64) NOT NULL,           -- lowercased EVM address
  iat_user_id UUID,                              -- nullable until IAT user provisioned
  email VARCHAR(320) NOT NULL,                   -- RFC max length
  display_name VARCHAR(120),                     -- pulled from IAT users.display_name

  -- Lifecycle
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  email_confirmed_at TIMESTAMPTZ,                -- NULL until double opt-in clicked
  unsubscribed_at TIMESTAMPTZ,                   -- soft-delete: NULL = subscribed
  suppressed_at TIMESTAMPTZ,                     -- hard suppress (bounce/spam)
  suppressed_reason TEXT,

  -- Tier ownership snapshot (synced from contract reads)
  owns_tiers SMALLINT[] NOT NULL DEFAULT '{}',   -- e.g. {1,2,3} for someone who owns T1+T2+T3
  is_affiliate_tiers SMALLINT[] NOT NULL DEFAULT '{}', -- subset of owns_tiers where they paid admin fee
  tiers_synced_at TIMESTAMPTZ,                   -- last on-chain sync

  -- Engagement
  engagement_score NUMERIC(8,2) NOT NULL DEFAULT 0,
  engagement_tier wt_engagement_tier NOT NULL DEFAULT 'engaged',
  engagement_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Activity
  last_open_at TIMESTAMPTZ,
  last_click_at TIMESTAMPTZ,
  last_send_at TIMESTAMPTZ,
  last_purchase_at TIMESTAMPTZ,
  paused_until TIMESTAMPTZ,                      -- pause-for-30-days link mechanism

  -- Provenance
  ref_code VARCHAR(64),                          -- ?ref= cookie at capture, if any
  source VARCHAR(32) NOT NULL DEFAULT 'unknown', -- 'capture_form' | 'on_chain' | 'manual_add'
  metadata JSONB NOT NULL DEFAULT '{}',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_wt_email_subs_wallet ON wt_email_subscribers (lower(wallet_address));
CREATE UNIQUE INDEX idx_wt_email_subs_email ON wt_email_subscribers (lower(email));
CREATE INDEX idx_wt_email_subs_engagement ON wt_email_subscribers (engagement_tier, engagement_updated_at)
  WHERE unsubscribed_at IS NULL AND suppressed_at IS NULL;
CREATE INDEX idx_wt_email_subs_iat_user ON wt_email_subscribers (iat_user_id) WHERE iat_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION wt_email_subs_touch_updated() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_wt_email_subs_touch
  BEFORE UPDATE ON wt_email_subscribers
  FOR EACH ROW EXECUTE FUNCTION wt_email_subs_touch_updated();
