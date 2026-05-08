-- =============================================================================
-- Migration 005: wt_email_templates
-- =============================================================================
-- Versioned template store. Each email type can have multiple template versions
-- but exactly one is_active=true at a time. Admin edits create new rows
-- (versioning) so we never lose old copy.
--
-- The actual rendered HTML lives in SendGrid Dynamic Templates (referenced by
-- sendgrid_template_id). This table stores the WT-side metadata: which version
-- to use for which type, what variables are required, the subject line, and a
-- preview-text fallback.

CREATE TABLE wt_email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  email_type wt_email_type NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,

  -- Subject line (with optional template variables like {firstName})
  subject TEXT NOT NULL,
  preview_text TEXT,                                 -- preheader

  -- SendGrid dynamic template ID — assigned after upload to SendGrid
  sendgrid_template_id VARCHAR(128),

  -- Local fallback (used if SendGrid upload not yet done OR for admin preview)
  html_body TEXT,
  text_body TEXT,

  -- Variable schema declared by this version. Worker validates payload.
  required_variables JSONB NOT NULL DEFAULT '[]',    -- e.g. ["tier", "amount", "buyerName"]
  optional_variables JSONB NOT NULL DEFAULT '[]',

  notes TEXT,                                         -- admin notes ("v2: tightened CTA copy")

  created_by VARCHAR(64),                             -- admin wallet address
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (email_type, version)
);

-- Only one active version per type.
CREATE UNIQUE INDEX idx_wt_email_templates_active ON wt_email_templates (email_type)
  WHERE is_active = TRUE;
