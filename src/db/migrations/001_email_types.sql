-- =============================================================================
-- Migration 001: email type enum + helpers
-- =============================================================================
-- Defines the canonical set of email types the system can produce. Every other
-- table references this enum for consistency. Adding a new email type requires
-- a new migration that ALTERs this type.

CREATE TYPE wt_email_type AS ENUM (
  -- Transactional (cannot be unsubscribed without explicit override)
  'earned_commission',
  'lost_commission',
  'cascade_passup',
  'sponsor_signup',

  -- Lifecycle / preference
  'opt_in_confirmation',

  -- Autoresponder drips (one per upgrade target)
  'drip_capture_to_t1',
  'drip_t1_to_t2',
  'drip_t2_to_t3',
  'drip_t3_to_t4',
  'drip_t4_to_t5',
  'drip_t5_to_t6',
  'drip_t6_to_t7',
  'drip_t7_to_t8',
  'drip_t8_to_t9',

  -- Engagement / lifecycle
  'reactivation',
  'win_back',

  -- Broadcast (catch-all for ad-hoc sends)
  'broadcast'
);

CREATE TYPE wt_email_status AS ENUM (
  'queued',
  'sending',
  'sent',
  'delivered',
  'opened',
  'clicked',
  'bounced',
  'spam_reported',
  'failed',
  'cancelled',
  'suppressed'
);

CREATE TYPE wt_engagement_tier AS ENUM (
  'engaged',   -- score >= 5; full cadence
  'cooling',   -- 0-4; 2x stretched cadence
  'cold',      -- -2 to 0; only emails 3 + 6 of each drip
  'frozen'     -- < -2; sequence paused, quarterly retry only
);
