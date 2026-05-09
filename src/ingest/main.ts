// Ingestion CLI. Three subcommands:
//   parse — parse all .md files under content/copy/ and print a summary
//   render — render every email through the design system to dist-preview/{type}-{step}.html
//   upload — push every email to SendGrid as a Dynamic Template + record in DB
//
// Usage:
//   pnpm tsx src/ingest/main.ts parse
//   pnpm tsx src/ingest/main.ts render
//   pnpm tsx src/ingest/main.ts upload

import { readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import { parseFile, type EmailBlock, type SlotInBlock } from "./parse-md.js";
import { renderEmail } from "../email/design-system.js";
import { uploadAllToSendGrid, persistTemplates } from "./upload-sendgrid.js";
import { logger } from "../log.js";
import { closePool } from "../db/pool.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = join(__dirname, "..", "..", "content", "copy");
const PREVIEW_DIR = join(__dirname, "..", "..", "dist-preview");

interface IngestResult {
  emails: EmailBlock[];
  slotIns: SlotInBlock[];
}

function loadAll(): IngestResult {
  const files = readdirSync(CONTENT_DIR).filter((f) => f.endsWith(".md"));
  const emails: EmailBlock[] = [];
  const slotIns: SlotInBlock[] = [];
  for (const f of files) {
    const parsed = parseFile(join(CONTENT_DIR, f));
    emails.push(...parsed.emailBlocks);
    slotIns.push(...parsed.slotInBlocks);
  }
  return { emails, slotIns };
}

function summarizeParse({ emails, slotIns }: IngestResult): void {
  // eslint-disable-next-line no-console
  console.log(`\n=== PARSE SUMMARY ===`);
  // eslint-disable-next-line no-console
  console.log(`emails: ${emails.length}`);
  // eslint-disable-next-line no-console
  console.log(`slot-ins: ${slotIns.length}`);

  // Group by type to verify drip 0..6 + wrappers all present.
  const byType: Record<string, number> = {};
  for (const e of emails) {
    byType[e.emailType] = (byType[e.emailType] ?? 0) + 1;
  }
  // eslint-disable-next-line no-console
  console.log("\n--- by type ---");
  for (const [t, n] of Object.entries(byType).sort()) {
    // eslint-disable-next-line no-console
    console.log(`  ${t}: ${n}`);
  }

  const lostByTier: Record<number, number> = {};
  const earnedByTier: Record<number, number> = {};
  for (const s of slotIns) {
    if (s.tier === undefined) continue;
    if (s.kind === "lost_commission_cta") lostByTier[s.tier] = (lostByTier[s.tier] ?? 0) + 1;
    if (s.kind === "earned_commission_celebration")
      earnedByTier[s.tier] = (earnedByTier[s.tier] ?? 0) + 1;
  }
  // eslint-disable-next-line no-console
  console.log("\n--- slot-ins by tier ---");
  for (let t = 1; t <= 9; t++) {
    // eslint-disable-next-line no-console
    console.log(
      `  T${t}: lost=${lostByTier[t] ?? 0}, earned=${earnedByTier[t] ?? 0}`,
    );
  }

  // Verify nothing missing.
  const missing: string[] = [];
  for (let t = 1; t <= 9; t++) {
    if (!lostByTier[t]) missing.push(`T${t} lost-commission CTA`);
    if (!earnedByTier[t]) missing.push(`T${t} earned-commission celebration`);
  }
  if (missing.length) {
    // eslint-disable-next-line no-console
    console.log(`\n⚠️  MISSING: ${missing.join(", ")}`);
  } else {
    // eslint-disable-next-line no-console
    console.log(`\n✓ all 9 tiers have both slot-ins`);
  }
}

function renderAll({ emails, slotIns }: IngestResult): void {
  mkdirSync(PREVIEW_DIR, { recursive: true });
  for (const e of emails) {
    const filename = `${e.emailType}${e.step !== undefined ? `-step${e.step}` : ""}.html`;
    const html = renderEmail(e, slotIns);
    writeFileSync(join(PREVIEW_DIR, filename), html);
  }
  // Also write an index so you can click through.
  const list = emails
    .map((e) => {
      const filename = `${e.emailType}${e.step !== undefined ? `-step${e.step}` : ""}.html`;
      return `<li><a href="${filename}">${filename}</a> — <em>${e.subject}</em></li>`;
    })
    .join("\n");
  writeFileSync(
    join(PREVIEW_DIR, "index.html"),
    `<!doctype html><html><head><meta charset="utf-8"><title>WT Email previews</title>
<style>body{font-family:Georgia,serif;max-width:900px;margin:2rem auto;padding:0 1rem;background:#f3f3f3;color:#14110d}
li{margin:.5rem 0}a{color:#8a6a26}em{color:#666}</style></head>
<body><h1>Wealth Transformation — Email Previews</h1>
<p>Total: ${emails.length} emails. Click to view rendered HTML.</p>
<ul>${list}</ul></body></html>`,
  );
  // eslint-disable-next-line no-console
  console.log(`\n✓ rendered ${emails.length} emails → dist-preview/`);
  // eslint-disable-next-line no-console
  console.log(`open dist-preview/index.html in a browser to click through`);
}

async function uploadAll(result: IngestResult): Promise<void> {
  const uploaded = await uploadAllToSendGrid(result.emails, result.slotIns);
  await persistTemplates(uploaded, result.slotIns);
  // eslint-disable-next-line no-console
  console.log(`\n✓ uploaded ${uploaded.length} templates to SendGrid + DB`);
}

const cmd = process.argv[2] ?? "parse";
const result = loadAll();
const main = async () => {
  if (cmd === "parse") summarizeParse(result);
  else if (cmd === "render") renderAll(result);
  else if (cmd === "upload") await uploadAll(result);
  else {
    // eslint-disable-next-line no-console
    console.error(`unknown command: ${cmd}`);
    process.exit(1);
  }
};
main()
  .catch((err) => {
    logger.error({ err: err instanceof Error ? err.message : err }, "ingest_fatal");
    process.exit(1);
  })
  .finally(closePool);
