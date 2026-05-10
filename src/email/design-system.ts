// Email HTML renderer. Wraps each email's body in the WT brand shell:
// brushed-black hero with crest seal, parchment editorial body, gold rule,
// brushed-black footer with CAN-SPAM physical address + unsubscribe + pause +
// preference-center links.
//
// Two key constraints driving the markup:
//   1. Inlined CSS — Gmail/Outlook strip <style> tags. Every rule must live
//      on the element itself. The trade-off is that the source is verbose.
//   2. Mobile-responsive without media queries — half of opens happen on
//      iOS Mail and Android Gmail; we use max-width on a container plus
//      text-align:center on inline-blocks so it collapses cleanly.
//
// Brand tokens (mirrored from src/lib/brand.ts in the WT app):
//   --wt-bg        #0a0908      brushed black
//   --wt-cream     #f3f3f3      parchment body
//   --wt-cream-soft #ebe4d3     warm parchment for callouts
//   --wt-gold      #cca349
//   --wt-gold-dim  #8a6a26
//   --wt-ink       #14110d      ink text on parchment
//   --wt-text      #f3f3f3      cream text on brushed black

import type { EmailBlock, SlotInBlock } from "../ingest/parse-md.js";
import { config } from "../config.js";
import { tier as tierMeta, targetTierForDrip } from "../tiers.js";

interface Tokens {
  bg: string;
  cream: string;
  creamSoft: string;
  gold: string;
  goldDim: string;
  ink: string;
  text: string;
}

const T: Tokens = {
  bg: "#0a0908",
  cream: "#f3f3f3",
  creamSoft: "#ebe4d3",
  gold: "#cca349",
  goldDim: "#8a6a26",
  ink: "#14110d",
  text: "#f3f3f3",
};

const FOOTER_ADDRESS_HTML = `
  Transformation IP Trust<br>
  243 E 5th Ave #A62<br>
  Anchorage, AK 99501<br>
  United States
`;

interface RenderEmailOpts {
  unsubscribeUrl?: string;
  preferenceCenterUrl?: string;
  pauseUrl?: string;
}

// Convert the Markdown-ish body (paragraphs separated by blank lines, with
// <strong> and <em> already present) into safe email HTML. Each paragraph
// becomes a <p> with inlined typography. We deliberately keep this minimal —
// the body content was authored as already-HTML-friendly plain text.
function bodyToHtml(body: string): string {
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  return paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 1.4em;font:400 17px/1.7 'Iowan Old Style',Georgia,'Times New Roman',serif;color:${T.ink};">${p}</p>`,
    )
    .join("\n");
}

function buttonHtml(text: string, url: string): string {
  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:2em auto;">
      <tr>
        <td align="center" bgcolor="${T.bg}" style="border-radius:4px;border:1px solid ${T.gold};">
          <a href="${url}" style="display:inline-block;padding:14px 36px;font:600 13px/1 'Trajan Pro','Cormorant Garamond',Georgia,serif;letter-spacing:0.18em;text-transform:uppercase;color:${T.gold};text-decoration:none;">${text}</a>
        </td>
      </tr>
    </table>
  `;
}

function goldRuleHtml(): string {
  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:2em auto;">
      <tr><td style="height:1px;width:80px;background:${T.gold};line-height:1px;font-size:1px;">&nbsp;</td></tr>
    </table>
  `;
}

// Lost-commission action block — rendered inside the {{{ctaParagraph}}} slot
// of the lost_commission wrapper. Prepends Opus's per-tier narrative with a
// prominent gold-bordered "Activate" button and an explicit 3-step "how to
// activate" list, so the recipient never has to figure out what to click.
//
// Returns SendGrid-Handlebars-friendly HTML: tier-specific copy when called
// at producer-time, no further substitution needed.
export function buildLostCommissionActionBlock(targetTier: number): string {
  const t = tierMeta(targetTier);
  if (!t) return "";
  const activateUrl = `${config.publicBaseUrl}/tier/${targetTier}`;

  return `
    <div style="margin:1.4em 0;font:400 16px/1.65 'Iowan Old Style',Georgia,serif;color:${T.ink};">
      <p style="margin:0 0 1.2em;">{{ctaNarrative}}</p>
    </div>

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:1.6em auto;width:100%;max-width:520px;">
      <tr>
        <td bgcolor="${T.creamSoft}" style="background:${T.creamSoft};border:1px solid ${T.gold};border-radius:4px;padding:22px 24px;">
          <div style="font:600 10px/1 'Trajan Pro','Cormorant Garamond',Georgia,serif;letter-spacing:0.22em;text-transform:uppercase;color:${T.goldDim};">How to activate &mdash; 60 seconds</div>
          <ol style="margin:14px 0 18px;padding-left:22px;font:400 14px/1.55 'Iowan Old Style',Georgia,serif;color:${T.ink};">
            <li style="margin-bottom:6px;">Click the button below.</li>
            <li style="margin-bottom:6px;">Connect any EVM wallet (MetaMask, Coinbase, Rainbow, Phantom). One-click EIP-6963 detection.</li>
            <li>Approve <strong>$${t.totalUsd} USDC</strong> on Base and confirm. Settles in seconds. The product hits your account on the same on-chain transaction that pays your sponsor.</li>
          </ol>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:0 auto;">
            <tr>
              <td align="center" bgcolor="${T.bg}" style="border-radius:4px;border:1px solid ${T.gold};">
                <a href="${activateUrl}" style="display:inline-block;padding:14px 30px;font:600 12px/1 'Trajan Pro','Cormorant Garamond',Georgia,serif;letter-spacing:0.18em;text-transform:uppercase;color:${T.gold};text-decoration:none;">Activate ${t.productName} &rarr; $${t.totalUsd}</a>
              </td>
            </tr>
          </table>
          <p style="margin:14px 0 0;font:400 12px/1.5 Georgia,serif;color:${T.ink};opacity:.7;text-align:center;">
            The link goes to <a href="${activateUrl}" style="color:${T.goldDim};">wealthtransformation.com/tier/${targetTier}</a> &mdash; the same page any of your referrals would see.
          </p>
        </td>
      </tr>
    </table>
  `;
}

// Cream "lightbox" panel that sits beneath every CTA selling a tier. CODE-
// compliant copy: states the mechanism (100% on-chain commissions), the
// concrete benefit (one sale = product price back instantly), and the
// reseller admin fee as the optional trade-off (pay it = earn from
// referrals, skip it = own the product but no earn rights).
//
// Tier-specific when we know the target tier (drips), generic otherwise.
// Falls back to {{tierName}} / {{tierProductPrice}} / {{tierAdminFee}}
// Handlebars vars when called for a non-drip context.
function commissionsCalloutHtml(targetTier: number | null): string {
  const tInfo = targetTier ? tierMeta(targetTier) : null;
  const productName = tInfo?.productName ?? "{{tierName}}";
  const productPrice = tInfo ? `$${tInfo.productPriceUsd}` : "${{tierProductPrice}}";
  const adminFee = tInfo ? `$${tInfo.adminFeeUsd}` : "${{tierAdminFee}}";
  const total = tInfo ? `$${tInfo.totalUsd}` : "${{tierTotalPrice}}";

  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:1.6em auto 0;width:100%;max-width:520px;">
      <tr>
        <td bgcolor="${T.creamSoft}" style="background:${T.creamSoft};border:1px solid ${T.goldDim};border-radius:4px;padding:18px 22px;">
          <div style="font:600 10px/1 'Trajan Pro','Cormorant Garamond',Georgia,serif;letter-spacing:0.22em;text-transform:uppercase;color:${T.goldDim};margin-bottom:10px;">100% commissions · on-chain</div>
          <p style="margin:0 0 8px;font:400 14px/1.55 'Iowan Old Style',Georgia,serif;color:${T.ink};">
            Every sale of <strong>${productName}</strong> pays <strong>${productPrice}</strong> instantly to the seller&rsquo;s wallet on the same on-chain transaction that delivers the product. One referred sale through your link pays back your ${productPrice} in seconds &mdash; no payout cycle, no chargeback, no clawback.
          </p>
          <p style="margin:0;font:400 13px/1.55 'Iowan Old Style',Georgia,serif;color:${T.ink};opacity:.78;">
            The optional <strong>10% reseller admin fee</strong> (${adminFee} &mdash; total ${total}) keeps the contract running and grants you reseller rights at this rung. Without it, you own the product but don&rsquo;t earn from referrals at this tier.
          </p>
        </td>
      </tr>
    </table>
  `;
}

// Brand assets hosted on a public-read S3 bucket. Persistent, HTTPS,
// content-type set to image/png with 24h cache headers. Updated by:
//   aws s3 sync ~/wealthtransformation-app/public/brand/logos \
//     s3://wt-brand-assets-534312620594/brand/logos
// (Picked S3 over GitHub raw URLs because the wt-app repo is private and
// raw.githubusercontent.com 404s without an auth token for private repos.)
const ASSETS_BASE =
  "https://wt-brand-assets-534312620594.s3.amazonaws.com/brand";

function headerHtml(): string {
  return `
    <tr>
      <td bgcolor="${T.bg}" style="background:${T.bg};padding:36px 24px 28px;text-align:center;">
        <a href="https://wealthtransformation.com" style="text-decoration:none;display:inline-block;">
          <img src="${ASSETS_BASE}/logos/horizontal-on-black.png"
               alt="Wealth Transformation"
               width="264"
               style="display:block;margin:0 auto;width:264px;max-width:72%;height:auto;border:0;outline:none;text-decoration:none;" />
        </a>
        <div style="height:1px;width:48px;background:${T.gold};margin:22px auto 0;line-height:1px;font-size:1px;">&nbsp;</div>
      </td>
    </tr>
  `;
}

function footerHtml(opts: RenderEmailOpts): string {
  const unsub = opts.unsubscribeUrl ?? "{{unsubscribeUrl}}";
  const prefs = opts.preferenceCenterUrl ?? "{{preferenceCenterUrl}}";
  const pause = opts.pauseUrl ?? "{{pauseUrl}}";
  return `
    <tr>
      <td bgcolor="${T.bg}" style="background:${T.bg};padding:32px 24px;text-align:center;">
        <div style="font:400 11px/1.6 Georgia,serif;color:${T.text};opacity:.7;">
          ${FOOTER_ADDRESS_HTML}
        </div>
        <div style="height:1px;width:32px;background:${T.goldDim};margin:18px auto;opacity:.6;"></div>
        <div style="font:400 11px/1.6 Georgia,serif;color:${T.text};opacity:.6;">
          <a href="${prefs}" style="color:${T.gold};text-decoration:none;">Preferences</a>
          &nbsp;·&nbsp;
          <a href="${pause}" style="color:${T.gold};text-decoration:none;">Pause for 30 days</a>
          &nbsp;·&nbsp;
          <a href="${unsub}" style="color:${T.gold};text-decoration:none;">Unsubscribe</a>
        </div>
        <div style="font:400 10px/1.5 Georgia,serif;color:${T.text};opacity:.4;margin-top:14px;">
          On-chain settlement is final and irreversible. We never custody your funds.<br>
          Wealth Transformation is a separate organization from I AM TRANSFORMATION.
        </div>
      </td>
    </tr>
  `;
}

// Resolve a slot-in paragraph reference by tier. Used at render time to inject
// the per-product paragraph into earned/lost wrappers.
function findSlotIn(
  slotIns: SlotInBlock[],
  kind: SlotInBlock["kind"],
  tier: number,
): SlotInBlock | undefined {
  return slotIns.find((s) => s.kind === kind && s.tier === tier);
}

// Substitute {{variables}} in a string with a sample value when rendering for
// preview. At runtime SendGrid does this; for our local preview we fake it.
// `targetTier` tells us which tier this preview is for — drives tierName,
// activateUrl, prices etc. so the preview matches what the real recipient will
// see for that drip.
function previewSubstitute(template: string, targetTier: number | null): string {
  const t = targetTier ? tierMeta(targetTier) : null;
  const sample: Record<string, string> = {
    firstName: "David",
    sponsorName: "Alice",
    walletShort: "0x35491f…7B43A",
    tierName: t?.productName ?? "The Short That Pays",
    tierProductPrice: t ? String(t.productPriceUsd) : "3",
    tierTotalPrice: t ? String(t.totalUsd) : "3.30",
    tierAdminFee: t ? String(t.adminFeeUsd) : "0.30",
    currentTier: targetTier ? String(targetTier - 1) : "0",
    nextTier: targetTier ? String(targetTier) : "1",
    activateUrl: `${config.publicBaseUrl}/tier/${targetTier ?? 1}`,
    basescanWalletUrl:
      "https://sepolia.basescan.org/address/0x35491f6661b843C130F43CeA61F507839227B43A",
    basescanUrl: "https://sepolia.basescan.org/tx/0xabc",
    lostAmountThisQuarter: "126",
    downlineSize: "7",
    downlineDeepBuyers: "2",
    buyerName: "Carol",
    buyerWalletShort: "0x82FFb3…237E06",
    amount: t ? String(t.productPriceUsd) : "3",
    counterAt: "3",
    preferenceCenterUrl: `${config.publicBaseUrl}/email-preferences?token=PREVIEW`,
    unsubscribeUrl: `${config.publicBaseUrl}/email-unsubscribe?token=PREVIEW`,
    pauseUrl: `${config.publicBaseUrl}/email-pause?token=PREVIEW`,
    confirmUrl: `${config.publicBaseUrl}/email-confirm?token=PREVIEW`,
  };
  return template
    // {{#if X}}...{{else}}...{{/if}} — render the truthy branch for preview.
    .replace(
      /\{\{#if\s+([^}]+)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g,
      (_match, _cond: string, ifBranch: string) => ifBranch,
    )
    // {{{var}}} — raw HTML render (slot-ins). For preview just unwrap.
    .replace(/\{\{\{\s*([\w.]+)\s*\}\}\}/g, (_m, key: string) => sample[key] ?? "")
    // {{var}} — escaped substitute.
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => sample[key] ?? "");
}

export function renderEmail(
  email: EmailBlock,
  slotIns: SlotInBlock[],
  opts: RenderEmailOpts = {},
  previewMode = true,
): string {
  // Wrappers (earned_commission, lost_commission) accept slot-in paragraphs
  // for the tier the recipient just lost/earned on. For preview we inject T1.
  let body = email.body;

  if (email.emailType === "earned_commission" || email.emailType === "lost_commission") {
    const tier = 1; // preview tier
    const kind: SlotInBlock["kind"] =
      email.emailType === "earned_commission"
        ? "earned_commission_celebration"
        : "lost_commission_cta";
    const slotIn = findSlotIn(slotIns, kind, tier);
    if (slotIn) {
      body = body
        .replace(/\{\{\{\s*celebrationParagraph\s*\}\}\}/g, slotIn.paragraphHtml)
        .replace(/\{\{\{\s*ctaParagraph\s*\}\}\}/g, slotIn.paragraphHtml);
    }
  }

  // Render body to HTML (paragraphs).
  const bodyHtml = bodyToHtml(body);

  // Add P.S. block if present.
  let psHtml = "";
  if (email.ps) {
    psHtml = `
      <p style="margin:2.5em 0 1.4em;font:400 16px/1.7 'Iowan Old Style',Georgia,serif;color:${T.ink};font-style:italic;border-top:1px solid #d6cfba;padding-top:1.4em;">
        <strong style="font-style:normal;letter-spacing:0.1em;text-transform:uppercase;font-size:11px;color:${T.goldDim};">P.S.</strong>
        ${email.ps}
      </p>
    `;
  }

  // Add primary CTA button if present.
  let ctaHtml = "";
  let calloutHtml = "";
  if (email.primaryCtaText && email.primaryCtaUrl && !email.primaryCtaText.startsWith("(none")) {
    ctaHtml = buttonHtml(email.primaryCtaText, email.primaryCtaUrl);
    // Commissions callout fires only when the CTA is a tier-purchase URL —
    // detected by either {{activateUrl}} or a literal /tier/ path. Skips for
    // basescan / preference-center / mailto reply-to CTAs.
    const isTierCta =
      email.primaryCtaUrl.includes("activateUrl") || email.primaryCtaUrl.includes("/tier/");
    if (isTierCta) {
      const targetTier = targetTierForDrip(email.emailType);
      calloutHtml = commissionsCalloutHtml(targetTier);
    }
  }

  const innerRaw = `
    <tr>
      <td bgcolor="${T.cream}" style="background:${T.cream};padding:48px 40px 24px;">
        ${bodyHtml}
        ${ctaHtml}
        ${calloutHtml}
        ${goldRuleHtml()}
        ${psHtml}
      </td>
    </tr>
  `;

  const previewTier = targetTierForDrip(email.emailType);
  const subject = previewMode ? previewSubstitute(email.subject, previewTier) : email.subject;
  const preheader = previewMode
    ? previewSubstitute(email.preheader ?? "", previewTier)
    : email.preheader ?? "";

  // Hidden preheader hack — Gmail/Apple Mail show this as the snippet.
  const preheaderHtml = `<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${T.cream};">${preheader}</div>`;

  let html = `<!doctype html>
<html lang="en" style="margin:0;padding:0;">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:${T.bg};color:${T.ink};">
${preheaderHtml}
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" bgcolor="${T.bg}" style="background:${T.bg};">
  <tr>
    <td align="center" style="padding:24px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px;width:100%;background:${T.cream};border:1px solid ${T.goldDim};">
        ${headerHtml()}
        ${innerRaw}
        ${footerHtml(opts)}
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  // Run preview substitution across the WHOLE document (header, body, footer)
  // so {{preferenceCenterUrl}} / {{unsubscribeUrl}} / {{pauseUrl}} in the
  // footer are demoed too. At runtime SendGrid substitutes everything at send
  // time so this preview pass only fires when previewMode=true.
  if (previewMode) {
    html = previewSubstitute(html, previewTier);
  }

  return html;
}

// Convenience: render a plain-text version too. SendGrid serves both.
export function renderEmailText(email: EmailBlock, previewMode = true): string {
  let body = email.body
    // strip HTML tags
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (email.ps) body += `\n\nP.S.\n${email.ps.replace(/<[^>]+>/g, "")}`;
  if (email.primaryCtaUrl) body += `\n\n→ ${email.primaryCtaText ?? "Activate"}: ${email.primaryCtaUrl}`;
  body += `\n\n—\nWealth Transformation\nTransformation IP Trust\n243 E 5th Ave #A62, Anchorage, AK 99501, USA\n\nPreferences: {{preferenceCenterUrl}}\nUnsubscribe: {{unsubscribeUrl}}\n`;
  const previewTier = targetTierForDrip(email.emailType);
  return previewMode ? previewSubstitute(body, previewTier) : body;
}
