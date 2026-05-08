-- =============================================================================
-- Migration 008: admin audit + global settings
-- =============================================================================

CREATE TABLE wt_email_settings (
  key VARCHAR(64) PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_by_wallet VARCHAR(64),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Boot defaults — global on/off switches per email type, plus paused-globally.
INSERT INTO wt_email_settings (key, value, description) VALUES
  ('global_pause', 'false'::jsonb, 'Master kill-switch — true halts ALL sends'),
  ('type_enabled.earned_commission', 'true'::jsonb, 'Per-type global toggle'),
  ('type_enabled.lost_commission', 'true'::jsonb, ''),
  ('type_enabled.cascade_passup', 'true'::jsonb, ''),
  ('type_enabled.sponsor_signup', 'true'::jsonb, ''),
  ('type_enabled.opt_in_confirmation', 'true'::jsonb, ''),
  ('type_enabled.drips', 'true'::jsonb, 'Single toggle for all drip_* types'),
  ('type_enabled.broadcast', 'true'::jsonb, ''),
  ('type_enabled.reactivation', 'true'::jsonb, ''),
  ('type_enabled.win_back', 'true'::jsonb, ''),
  ('send_rate_per_minute', '1000'::jsonb, 'Max sends per minute (SendGrid reputation guard)'),
  ('engagement_score_thresholds',
   '{"engaged": 5, "cooling": 0, "cold": -2}'::jsonb,
   'Score thresholds: ≥engaged=engaged tier, ≥cooling=cooling, ≥cold=cold, else frozen')
ON CONFLICT (key) DO NOTHING;

-- =============================================================================
-- Admin audit log — every admin action recorded.
-- =============================================================================
CREATE TABLE wt_email_admin_log (
  id BIGSERIAL PRIMARY KEY,
  actor_wallet VARCHAR(64) NOT NULL,
  action VARCHAR(64) NOT NULL,                    -- 'pause', 'resume', 'send_broadcast', 'edit_template', etc.
  target_type VARCHAR(32),                        -- 'template', 'broadcast', 'subscriber', 'setting'
  target_id VARCHAR(255),
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wt_email_admin_log_actor ON wt_email_admin_log (actor_wallet, created_at DESC);
CREATE INDEX idx_wt_email_admin_log_target ON wt_email_admin_log (target_type, target_id, created_at DESC);

-- =============================================================================
-- Suppressions list — hard bounces, spam reports, manual bans.
-- =============================================================================
CREATE TABLE wt_email_suppressions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(320) NOT NULL,
  reason VARCHAR(64) NOT NULL,                    -- 'hard_bounce', 'spam_report', 'manual', 'invalid'
  details TEXT,
  suppressed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at TIMESTAMPTZ,                         -- NULL = currently suppressed
  released_by_wallet VARCHAR(64)
);

CREATE UNIQUE INDEX idx_wt_email_suppressions_active ON wt_email_suppressions (lower(email))
  WHERE released_at IS NULL;
