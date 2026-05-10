// Upload parsed emails to SendGrid as Dynamic Templates.
//
// Strategy: one Dynamic Template per email_type+step combination. Each template
// has one active version at a time. We:
//   1. Search for an existing template by name. If found → create a new version
//      under it (so SendGrid keeps history). If not → create a new template.
//   2. Activate the new version.
//   3. Persist (sendgrid_template_id, version) into wt_email_templates with
//      is_active=true and is_active=false on prior versions.
//
// Idempotent: re-running the upload bumps the version each time.

import { config } from "../config.js";
import { logger } from "../log.js";
import { getPool } from "../db/pool.js";
import { renderEmail, renderEmailText } from "../email/design-system.js";
import type { EmailBlock, SlotInBlock } from "./parse-md.js";

interface UploadedTemplate {
  email: EmailBlock;
  sendgridTemplateId: string;
  versionId: string;
  versionNumber: number;
}

const SG_BASE = "https://api.sendgrid.com/v3";

function templateName(email: EmailBlock): string {
  return `wt_${email.emailType}${email.step !== undefined ? `_step${email.step}` : ""}`;
}

async function sgFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${SG_BASE}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${config.sendgridApiKey}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`SendGrid ${init.method ?? "GET"} ${path} → ${res.status}: ${body}`);
  }
  return (await res.json()) as T;
}

interface SgTemplateListItem {
  id: string;
  name: string;
  generation: string;
  versions: Array<{ id: string; template_id: string; active: number; name: string }>;
}

async function findOrCreateTemplate(name: string): Promise<string> {
  // Page through templates by name.
  const list = await sgFetch<{ result: SgTemplateListItem[] }>(
    `/templates?generations=dynamic&page_size=200`,
  );
  const existing = list.result.find((t) => t.name === name);
  if (existing) return existing.id;
  const created = await sgFetch<{ id: string }>("/templates", {
    method: "POST",
    body: JSON.stringify({ name, generation: "dynamic" }),
  });
  return created.id;
}

async function createVersion(
  templateId: string,
  email: EmailBlock,
  slotIns: SlotInBlock[],
): Promise<{ versionId: string; versionNumber: number }> {
  // Render with previewMode=false so Handlebars vars stay live.
  const html = renderEmail(email, slotIns, {}, false);
  const text = renderEmailText(email, false);

  // Prune old versions before creating a new one — SendGrid caps at 300 total
  // dynamic-template versions per account. Keep only the currently-active
  // version, delete the rest, then add the new one.
  const detail = await sgFetch<SgTemplateListItem>(`/templates/${templateId}`);
  const versions = detail.versions ?? [];
  for (const v of versions) {
    if (v.active === 1) continue;
    try {
      await sgFetch(`/templates/${templateId}/versions/${v.id}`, { method: "DELETE" });
    } catch {
      // ignore — best-effort prune
    }
  }
  const nextVersion = versions.length + 1; // monotonically increasing — keeps audit log clean

  const created = await sgFetch<{ id: string }>(`/templates/${templateId}/versions`, {
    method: "POST",
    body: JSON.stringify({
      template_id: templateId,
      active: 1,
      name: `v${nextVersion} ${new Date().toISOString().slice(0, 10)}`,
      subject: email.subject,
      html_content: html,
      plain_content: text,
      generate_plain_content: false,
      editor: "code",
    }),
  });
  return { versionId: created.id, versionNumber: nextVersion };
}

export async function uploadAllToSendGrid(
  emails: EmailBlock[],
  slotIns: SlotInBlock[],
): Promise<UploadedTemplate[]> {
  if (!config.sendgridApiKey) {
    throw new Error("SENDGRID_API_KEY_PATH not set — cannot upload");
  }
  const out: UploadedTemplate[] = [];
  for (const email of emails) {
    const name = templateName(email);
    const templateId = await findOrCreateTemplate(name);
    const { versionId, versionNumber } = await createVersion(templateId, email, slotIns);
    out.push({ email, sendgridTemplateId: templateId, versionId, versionNumber });
    logger.info(
      { name, templateId, versionNumber, subject: email.subject },
      "uploaded_template",
    );
  }
  return out;
}

export async function persistTemplates(
  uploaded: UploadedTemplate[],
  slotIns: SlotInBlock[],
): Promise<void> {
  for (const u of uploaded) {
    const requiredVars = u.email.variablesUsed;
    const subject = u.email.subject;
    // Insert new row, deactivate previous active row for this email_type.
    await getPool().query(`
      UPDATE wt_email_templates
         SET is_active = FALSE
       WHERE email_type = $1::wt_email_type AND is_active = TRUE
    `, [u.email.emailType]);
    await getPool().query(
      `INSERT INTO wt_email_templates
         (email_type, version, is_active, subject, sendgrid_template_id,
          html_body, text_body, required_variables, notes, created_by)
       VALUES ($1::wt_email_type, $2, TRUE, $3, $4, NULL, NULL, $5::jsonb, $6, 'ingest_cli')
       ON CONFLICT (email_type, version) DO UPDATE SET
         is_active = TRUE,
         subject = EXCLUDED.subject,
         sendgrid_template_id = EXCLUDED.sendgrid_template_id,
         required_variables = EXCLUDED.required_variables,
         notes = EXCLUDED.notes`,
      [
        u.email.emailType,
        u.versionNumber,
        subject,
        u.sendgridTemplateId,
        JSON.stringify(requiredVars),
        `step=${u.email.step ?? "n/a"}; productBeingSold=${u.email.productBeingSold ?? "n/a"}`,
      ],
    );
  }
  // Persist slot-ins as a separate small table — but we don't have a migration
  // for that yet. Stash as a settings JSONB blob keyed by tier+kind so the
  // wrapper renderer can look them up without a new schema.
  const slotInBlob: Record<string, unknown> = {};
  for (const s of slotIns) {
    if (s.tier === undefined) continue;
    const key = `${s.kind}:t${s.tier}`;
    slotInBlob[key] = {
      productName: s.productName,
      paragraphHtml: s.paragraphHtml,
      ctaButton: s.ctaButton ?? null,
      ctaUrl: s.ctaUrl ?? null,
    };
  }
  await getPool().query(
    `INSERT INTO wt_email_settings (key, value, description)
     VALUES ('slot_in_paragraphs', $1::jsonb, 'Per-product paragraphs for earned/lost wrappers, keyed by {kind}:t{tier}.')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [JSON.stringify(slotInBlob)],
  );
}
