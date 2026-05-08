// Resolves an email_type to its active SendGrid template + subject + variable
// schema. Worker calls this for each outbox row before sending.

import { getPool } from "../db/pool.js";

export interface ResolvedTemplate {
  templateId: string | null;       // null until SendGrid upload happens
  htmlBody: string | null;
  textBody: string | null;
  subject: string;
  version: number;
  requiredVariables: string[];
}

export async function resolveTemplate(emailType: string): Promise<ResolvedTemplate | null> {
  const r = await getPool().query<{
    sendgrid_template_id: string | null;
    html_body: string | null;
    text_body: string | null;
    subject: string;
    version: number;
    required_variables: string[];
  }>(
    `SELECT sendgrid_template_id, html_body, text_body, subject, version, required_variables
       FROM wt_email_templates
      WHERE email_type = $1::wt_email_type AND is_active = TRUE
      LIMIT 1`,
    [emailType],
  );
  if (r.rows.length === 0) return null;
  const t = r.rows[0];
  return {
    templateId: t.sendgrid_template_id,
    htmlBody: t.html_body,
    textBody: t.text_body,
    subject: t.subject,
    version: t.version,
    requiredVariables: Array.isArray(t.required_variables) ? t.required_variables : [],
  };
}

// Render-time substitution for fallback HTML/text when no SendGrid template
// is uploaded yet. Trivial {{var}} replacement — no logic, no helpers. Real
// templates run through SendGrid's Handlebars engine.
export function renderFallback(
  body: string,
  vars: Record<string, unknown>,
): string {
  return body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const path = key.split(".");
    let cur: unknown = vars;
    for (const p of path) {
      if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
        cur = (cur as Record<string, unknown>)[p];
      } else {
        return "";
      }
    }
    return cur === null || cur === undefined ? "" : String(cur);
  });
}

export function renderSubject(subject: string, vars: Record<string, unknown>): string {
  return renderFallback(subject, vars);
}
