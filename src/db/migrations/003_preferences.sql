-- =============================================================================
-- Migration 003: wt_email_preferences
-- =============================================================================
-- Per-subscriber per-type opt-in. Defaults vary by type — transactional types
-- default to TRUE, marketing/drip types default to FALSE until double opt-in
-- clicks confirm.
--
-- "lost_commission" supports a third state ('digest_daily') beyond on/off
-- (per Dave's spec). Stored as 'digest_daily' override on the enabled column
-- via the cadence_override field.

CREATE TABLE wt_email_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id UUID NOT NULL REFERENCES wt_email_subscribers(id) ON DELETE CASCADE,
  email_type wt_email_type NOT NULL,

  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  cadence_override VARCHAR(16),  -- 'real_time' (default), 'digest_daily', 'digest_weekly'

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_via VARCHAR(32),        -- 'preference_center', 'admin', 'unsubscribe_link', 'system'

  UNIQUE (subscriber_id, email_type)
);

CREATE INDEX idx_wt_email_prefs_subscriber ON wt_email_preferences (subscriber_id);

-- Helper: check if a subscriber has a given email type enabled.
-- Uses the explicit row if present; falls back to type-default if not.
CREATE OR REPLACE FUNCTION wt_email_pref_enabled(
  p_subscriber_id UUID,
  p_email_type wt_email_type
) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_enabled BOOLEAN;
  v_default BOOLEAN;
BEGIN
  SELECT enabled INTO v_enabled
    FROM wt_email_preferences
   WHERE subscriber_id = p_subscriber_id
     AND email_type = p_email_type
   LIMIT 1;

  IF v_enabled IS NOT NULL THEN
    RETURN v_enabled;
  END IF;

  -- Type-defaults. Transactional = ON. Drips/marketing = OFF until opt-in.
  v_default := CASE p_email_type
    WHEN 'earned_commission' THEN TRUE
    WHEN 'lost_commission' THEN TRUE
    WHEN 'cascade_passup' THEN TRUE
    WHEN 'sponsor_signup' THEN TRUE
    WHEN 'opt_in_confirmation' THEN TRUE
    ELSE FALSE  -- drips, reactivation, win-back, broadcast all opt-in
  END;
  RETURN v_default;
END;
$$;
