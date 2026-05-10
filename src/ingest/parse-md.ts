// Parses the Opus-delivered Markdown email files into structured records ready
// for SendGrid template upload + database insert.
//
// Each `===`-bounded block in a Markdown file is one of:
//   1. An email block — has "EMAIL TYPE: drip_..." or "EMAIL TYPE: earned_commission" etc.
//   2. A lost-commission CTA paragraph block — starts "LOST-COMMISSION CTA"
//   3. An earned-commission celebration paragraph block — starts "EARNED-COMMISSION CELEBRATION"
//
// The parser tolerates the inconsistent inner formatting (Opus used both numeric
// and string step indicators, with and without spaces around hyphens) by
// normalizing everything against an explicit regex set.

import { readFileSync } from "node:fs";

export interface EmailBlock {
  emailType: string;             // e.g. "drip_capture_to_t1", "earned_commission"
  step?: number;                  // 0..6 for drips; absent for wrappers
  productBeingSold?: string;
  audience?: string;
  subject: string;
  preheader?: string;
  body: string;                   // raw HTML-friendly body, with {{vars}} preserved
  primaryCtaText?: string;
  primaryCtaUrl?: string;
  ps?: string;
  variablesUsed: string[];
  rawSection: string;             // for debugging
}

export interface SlotInBlock {
  kind: "lost_commission_cta" | "earned_commission_celebration";
  productName: string;
  tier?: number;                  // mapped from product → tier when possible
  paragraphHtml: string;
  ctaButton?: string;
  ctaUrl?: string;
}

export interface ParsedFile {
  filePath: string;
  emailBlocks: EmailBlock[];
  slotInBlocks: SlotInBlock[];
}

const PRODUCT_TO_TIER: Record<string, number> = {
  "the short that pays": 1,
  "your first sale playbook": 2,
  "the creator engine": 3,
  "the closer's codex": 4,
  "the closers codex": 4,
  "the omnipresence engine": 5,
  "the live recruiting formula": 6,
  "producer transformation": 7,
  "team transformation": 8,
  "influence transformation": 9,
};

function tierForProduct(productName: string): number | undefined {
  const key = productName.toLowerCase().trim();
  for (const [name, tier] of Object.entries(PRODUCT_TO_TIER)) {
    if (key.includes(name)) return tier;
  }
  return undefined;
}

// Split a file into ===-bounded sections. The Opus format always has exactly
// `===` on its own line as both opener and closer of each block.
function extractSections(content: string): string[] {
  const sections: string[] = [];
  const lines = content.split("\n");
  let cur: string[] = [];
  let inSection = false;
  for (const line of lines) {
    if (line.trim() === "===") {
      if (inSection) {
        sections.push(cur.join("\n"));
        cur = [];
        inSection = false;
      } else {
        inSection = true;
      }
      continue;
    }
    if (inSection) cur.push(line);
  }
  return sections;
}

// Pull a labeled field's value. Most fields are "FIELD: value" but a few span
// multiple lines (BODY, P.S., PARAGRAPH). We use a regex to find the label and
// then take everything until the next ALL-CAPS label or end of section.
const FIELD_LABELS = [
  "EMAIL TYPE",
  "PRODUCT BEING SOLD",
  "AUDIENCE",
  "STEP/TIMING",
  "SUBJECT",
  "PREHEADER",
  "BODY",
  "PRIMARY CTA",
  "PRIMARY CTA URL",
  "P.S.",
  "VARIABLES USED",
  "WHEN IT FIRES",
  "LOST-COMMISSION CTA",
  "EARNED-COMMISSION CELEBRATION",
  "PARAGRAPH",
  "CTA BUTTON",
  "CTA URL",
];

interface FieldMap {
  [key: string]: string;
}

function extractFields(section: string): FieldMap {
  const lines = section.split("\n");
  const fields: FieldMap = {};
  let curLabel: string | null = null;
  let curValueLines: string[] = [];

  const flush = () => {
    if (curLabel) {
      fields[curLabel] = curValueLines.join("\n").trim();
    }
    curValueLines = [];
  };

  // Sort FIELD_LABELS by descending length so a line starting with
  // "PRIMARY CTA URL:" matches the longer "PRIMARY CTA URL" label, not the
  // shorter "PRIMARY CTA" prefix.
  const labels = [...FIELD_LABELS].sort((a, b) => b.length - a.length);

  for (const line of lines) {
    // Match a known label at the start of a line. Build patterns from the
    // labels list so we don't have to fight regex character-class subtleties
    // (P.S. ending with . was breaking the previous all-caps regex).
    let matchedLabel: string | null = null;
    let matchedValue = "";
    for (const lbl of labels) {
      // Allow optional parenthetical qualifier between label and colon:
      //   PRIMARY CTA (button copy, ≤30 chars): value
      const escaped = lbl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`^${escaped}(?:\\s*\\([^)]*\\))?\\s*:\\s*(.*)$`);
      const m = line.match(re);
      if (m) {
        matchedLabel = lbl;
        matchedValue = m[1];
        break;
      }
    }
    if (matchedLabel) {
      flush();
      curLabel = matchedLabel;
      curValueLines = [matchedValue];
    } else if (curLabel) {
      curValueLines.push(line);
    }
  }
  flush();
  return fields;
}

function parseStepFromEmailType(value: string): { type: string; step?: number } {
  // "drip_capture_to_t1 — Step 0" or "drip_t1_to_t2 — Step 3" or "earned_commission"
  const m = value.match(/^(\S+)(?:\s*[—\-]\s*Step\s*(\d+))?/i);
  if (!m) return { type: value.trim() };
  return { type: m[1].trim(), step: m[2] ? Number.parseInt(m[2], 10) : undefined };
}

function splitVariableList(value: string): string[] {
  // The "VARIABLES USED" field is freeform — pull out anything matching {{...}}.
  const matches = value.match(/\{\{?\s*[\w.]+\s*\}?\}\}?/g) ?? [];
  return Array.from(new Set(matches.map((s) => s.replace(/[{}\s]/g, "").replace(/^[#/]/, ""))));
}

function parseEmailBlock(section: string): EmailBlock | null {
  const fields = extractFields(section);
  if (!fields["EMAIL TYPE"]) return null;
  const { type, step } = parseStepFromEmailType(fields["EMAIL TYPE"]);

  const subject = fields["SUBJECT"];
  if (!subject) return null;

  // PRIMARY CTA may be a single line "Button text" or two lines "button" + "url".
  const ctaText = fields["PRIMARY CTA"]?.split("\n")[0]?.trim();
  const ctaUrl = fields["PRIMARY CTA URL"]?.trim();

  return {
    emailType: type,
    step,
    productBeingSold: fields["PRODUCT BEING SOLD"],
    audience: fields["AUDIENCE"],
    subject: subject.replace(/^["']|["']$/g, ""),
    preheader: fields["PREHEADER"],
    body: fields["BODY"] ?? "",
    primaryCtaText: ctaText,
    primaryCtaUrl: ctaUrl,
    ps: fields["P.S."],
    variablesUsed: fields["VARIABLES USED"]
      ? splitVariableList(fields["VARIABLES USED"])
      : [],
    rawSection: section,
  };
}

function parseSlotInBlock(section: string): SlotInBlock | null {
  const lines = section.split("\n").map((l) => l.trim());
  const firstNonEmpty = lines.find((l) => l.length > 0);
  if (!firstNonEmpty) return null;

  let kind: SlotInBlock["kind"] | null = null;
  // Tolerate optional markdown heading prefix (#, ##) used inconsistently
  // across threads.
  if (/^#*\s*LOST-COMMISSION\s+CTA\b/i.test(firstNonEmpty)) kind = "lost_commission_cta";
  else if (/^#*\s*EARNED-COMMISSION\s+CELEBRATION\b/i.test(firstNonEmpty))
    kind = "earned_commission_celebration";
  if (!kind) return null;

  // Product name: everything after the first "Product:" on the header line.
  const productMatch = firstNonEmpty.match(/Product:\s*([^()]+?)(?:\s*\([^)]*\))?\s*$/);
  const productName = (productMatch?.[1] ?? "").trim();

  // Paragraph: lines between "PARAGRAPH:" and the next ALL-CAPS field or end.
  let paragraphHtml = "";
  let ctaButton: string | undefined;
  let ctaUrl: string | undefined;
  const paragraphIdx = lines.findIndex((l) => /^PARAGRAPH:\s*$/i.test(l));
  if (paragraphIdx !== -1) {
    const collected: string[] = [];
    for (let i = paragraphIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      // Stop on next labeled field (e.g. CTA BUTTON:, CTA URL:).
      if (/^(CTA\s+BUTTON|CTA\s+URL)\s*:/i.test(line)) break;
      collected.push(line);
    }
    paragraphHtml = collected.join("\n").trim();
  }
  // Pull CTA fields if present.
  for (const l of lines) {
    const btn = l.match(/^CTA\s+BUTTON\s*:\s*(.+)$/i);
    if (btn) ctaButton = btn[1].trim();
    const url = l.match(/^CTA\s+URL\s*:\s*(.+)$/i);
    if (url) ctaUrl = url[1].trim();
  }

  return {
    kind,
    productName,
    tier: tierForProduct(productName),
    paragraphHtml,
    ctaButton,
    ctaUrl,
  };
}

// Fallback: T9 file (and possibly others) have slot-in blocks outside `===`
// pairing. Scan the full file for slot-in headers and synthesize blocks.
function scanFreestandingSlotIns(content: string): SlotInBlock[] {
  const out: SlotInBlock[] = [];
  const HEADER_RE =
    /^(?:#+\s*)?(LOST-COMMISSION\s+CTA|EARNED-COMMISSION\s+CELEBRATION)\b[^\n]*$/gim;
  const headerMatches: Array<{ index: number; line: string; kind: SlotInBlock["kind"] }> =
    [];
  let m: RegExpExecArray | null;
  while ((m = HEADER_RE.exec(content)) !== null) {
    const kind = /LOST-COMMISSION/i.test(m[1])
      ? "lost_commission_cta"
      : "earned_commission_celebration";
    headerMatches.push({ index: m.index, line: m[0], kind });
  }
  for (let i = 0; i < headerMatches.length; i++) {
    const start = headerMatches[i].index;
    const end = i + 1 < headerMatches.length ? headerMatches[i + 1].index : content.length;
    const segment = content.slice(start, end);
    const parsed = parseSlotInBlock(segment);
    if (parsed) out.push(parsed);
  }
  return out;
}

export function parseFile(filePath: string): ParsedFile {
  const content = readFileSync(filePath, "utf8");
  const sections = extractSections(content);
  const emailBlocks: EmailBlock[] = [];
  const slotInBlocks: SlotInBlock[] = [];
  for (const sec of sections) {
    const slot = parseSlotInBlock(sec);
    if (slot) {
      slotInBlocks.push(slot);
      continue;
    }
    const email = parseEmailBlock(sec);
    if (email) emailBlocks.push(email);
  }
  // If we found fewer slot-ins than headers in the file, run the freestanding
  // scan to pick up the orphans. Dedupe by (kind, tier).
  const freestanding = scanFreestandingSlotIns(content);
  const seen = new Set(slotInBlocks.map((s) => `${s.kind}:${s.tier ?? "?"}`));
  for (const f of freestanding) {
    const key = `${f.kind}:${f.tier ?? "?"}`;
    if (!seen.has(key)) {
      slotInBlocks.push(f);
      seen.add(key);
    }
  }
  return { filePath, emailBlocks, slotInBlocks };
}
