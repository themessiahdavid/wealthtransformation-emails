// Force-enqueue one of each wrapper email type to verify templates +
// slot-in paragraph rendering end-to-end against SendGrid. Each goes to
// thekingdomofelohim@gmail.com.

import "dotenv/config";
import { enqueue } from "../src/email/outbox.js";
import { upsertSubscriber } from "../src/subscribers/upsert.js";
import { getPool, closePool } from "../src/db/pool.js";
import { config } from "../src/config.js";
import { tier as tierMeta } from "../src/tiers.js";
import { issueToken } from "../src/api/preference-token.js";

const RECIP_EMAIL = "thekingdomofelohim@gmail.com";
const RECIP_WALLET = "0x35491f6661b843C130F43CeA61F507839227B43A";
const SAMPLE_TIER = 5; // The Omnipresence Engine — gives us a $60 amount that's not the smallest

async function main() {
  // Make sure subscriber exists.
  const sub = await upsertSubscriber({
    walletAddress: RECIP_WALLET,
    email: RECIP_EMAIL,
    displayName: "David",
    source: "manual_add",
  });

  // Mark them confirmed so preflight gate doesn't block (transactional skips
  // confirmation but we do this for cleanliness).
  await getPool().query(
    `UPDATE wt_email_subscribers SET email_confirmed_at = COALESCE(email_confirmed_at, NOW()) WHERE id = $1::uuid`,
    [sub.subscriberId],
  );

  const t = tierMeta(SAMPLE_TIER)!;
  const prefToken = issueToken(sub.subscriberId);
  const prefUrl = `${config.publicBaseUrl}/email-preferences?token=${encodeURIComponent(prefToken)}`;
  const unsubUrl = `${config.publicBaseUrl}/email-unsubscribe?token=${encodeURIComponent(prefToken)}`;
  const pauseUrl = `${config.publicBaseUrl}/email-pause?token=${encodeURIComponent(prefToken)}`;
  const basescanWalletUrl = `https://sepolia.basescan.org/address/${RECIP_WALLET}`;
  const basescanTx = `https://sepolia.basescan.org/tx/0xtest${Date.now().toString(16)}`;

  // Pull slot-in paragraphs from settings JSONB blob.
  const slotIns = await getPool().query<{ value: Record<string, { paragraphHtml: string; ctaButton?: string; ctaUrl?: string }> }>(
    `SELECT value FROM wt_email_settings WHERE key = 'slot_in_paragraphs' LIMIT 1`,
  );
  const slotMap = slotIns.rows[0]?.value ?? {};
  const earnedSlot = slotMap[`earned_commission_celebration:t${SAMPLE_TIER}`];
  const lostSlot = slotMap[`lost_commission_cta:t${SAMPLE_TIER}`];

  const baseVars = {
    firstName: "David",
    walletShort: `${RECIP_WALLET.slice(0, 6)}…${RECIP_WALLET.slice(-4)}`,
    basescanWalletUrl,
    basescanUrl: basescanTx,
    preferenceCenterUrl: prefUrl,
    unsubscribeUrl: unsubUrl,
    pauseUrl,
    tier: SAMPLE_TIER,
    tierName: t.productName,
    tierProductPrice: t.productPriceUsd,
    tierTotalPrice: t.totalUsd,
    tierAdminFee: t.adminFeeUsd,
    amount: t.productPriceUsd,
    activateUrl: `${config.publicBaseUrl}/tier/${SAMPLE_TIER}`,
  };

  const stamp = Date.now();

  // 1. earned_commission
  await enqueue({
    emailType: "earned_commission",
    templateId: "earned_commission_v1",
    subscriberId: sub.subscriberId,
    recipientEmail: RECIP_EMAIL,
    recipientWallet: RECIP_WALLET,
    subject: `+$${t.productPriceUsd} from {{buyerName}}.`,
    vars: {
      ...baseVars,
      buyerName: "Carol",
      buyerWalletShort: "0xCAR0L…1234",
      celebrationParagraph: earnedSlot?.paragraphHtml ?? "",
    },
    idempotencyKey: `harness-earned-${stamp}`,
    triggeredBy: "test-wrappers",
  });

  // 2. lost_commission
  await enqueue({
    emailType: "lost_commission",
    templateId: "lost_commission_v1",
    subscriberId: sub.subscriberId,
    recipientEmail: RECIP_EMAIL,
    recipientWallet: RECIP_WALLET,
    subject: `$${t.productPriceUsd} walked past your wallet.`,
    vars: {
      ...baseVars,
      buyerName: "Frank",
      buyerWalletShort: "0xFRA1K…5678",
      ctaParagraph: lostSlot?.paragraphHtml ?? "",
    },
    idempotencyKey: `harness-lost-${stamp}`,
    triggeredBy: "test-wrappers",
  });

  // 3. cascade_passup
  await enqueue({
    emailType: "cascade_passup",
    templateId: "cascade_passup_v1",
    subscriberId: sub.subscriberId,
    recipientEmail: RECIP_EMAIL,
    recipientWallet: RECIP_WALLET,
    subject: "Sale 3. Counter rolled. Next stays.",
    vars: {
      ...baseVars,
      buyerName: "Greg",
      counterAt: "3",
    },
    idempotencyKey: `harness-cascade-${stamp}`,
    triggeredBy: "test-wrappers",
  });

  // 4. sponsor_signup
  await enqueue({
    emailType: "sponsor_signup",
    templateId: "sponsor_signup_v1",
    subscriberId: sub.subscriberId,
    recipientEmail: RECIP_EMAIL,
    recipientWallet: RECIP_WALLET,
    subject: "Carol just signed up under you.",
    vars: {
      ...baseVars,
      buyerName: "Carol",
      buyerWalletShort: "0xCAR0L…1234",
    },
    idempotencyKey: `harness-sponsor-${stamp}`,
    triggeredBy: "test-wrappers",
  });

  // eslint-disable-next-line no-console
  console.log("Enqueued all 4 wrapper emails. Worker will drain in ≤5s.");
  await closePool();
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
