# Generic Emails — Seven Wrappers

*Wealth Transformation transactional and lifecycle emails. Written ONCE, reused across every product. Slot in product-specific paragraphs from the per-product drip documents (drip-t0-to-t1.md through drip-t6-to-t7.md, plus the T8 and T9 outliers from threads 2 and 3) via Handlebars variables {{{ctaParagraph}}} and {{{celebrationParagraph}}} (triple-brace = render as raw HTML, no escape).*

*Voice continuity with the seven drip documents is the load-bearing requirement. Same regal/editorial register. Same compression discipline. Same anti-fabricated-proof and anti-manufactured-urgency posture. Same Doctor-not-Salesman stance. Wrappers are shorter than drip emails (most 100-300 words) but the voice is identical.*

*Brunson rule held throughout: don't bury the news. Wrappers 1-4 (the on-chain ones) lead with the news in the subject and confirm it in the first sentence of the body, then let the slot-in paragraph carry the rung-specific framing. Wrappers 5-7 (the lifecycle ones) lead with the recipient's state, not the system's.*

---

===
EMAIL TYPE: earned_commission
WHEN IT FIRES: The smart contract has just executed a commission payout to the recipient because someone in their tree purchased a tier the recipient owns. Triggered immediately on-chain by the smart contract event.
AUDIENCE: someone whose wallet just got paid. Positive emotional state. The chain already celebrated for us by paying instantly — the wrapper acknowledges the news cleanly, lets the slot-in paragraph carry the rung-specific framing, and exits.

SUBJECT (≤50 chars): +${{amount}} from {{buyerName}}.
PREHEADER (≤90 chars): Smart contract executed. Funds settled in seconds.

BODY:

{{firstName}} —

The chain just paid. <strong>${{amount}}</strong> from <strong>{{buyerName}}</strong>'s purchase of <strong>{{tierName}}</strong>, settled in your wallet on the same on-chain transaction that delivered the playbook to them.

Verifiable here: <a href="{{basescanUrl}}">{{basescanUrl}}</a>.

{{{celebrationParagraph}}}

— David

PRIMARY CTA (button copy, ≤30 chars): View on-chain
PRIMARY CTA URL: {{basescanUrl}}

VARIABLES USED: {{firstName}}, {{amount}}, {{buyerName}}, {{tierName}}, {{basescanUrl}}, {{{celebrationParagraph}}} (triple-brace, renders pre-built HTML from per-product collateral)

===

===
EMAIL TYPE: lost_commission
WHEN IT FIRES: The smart contract has just executed a commission compression — someone in the recipient's tree purchased a tier the recipient does NOT own, and the commission walked past the recipient up to the first wallet above them that does own it. Triggered immediately on-chain by the smart contract event.
AUDIENCE: someone who just lost real money. The emotional state is pain. The wrapper honors the pain without performing it. Per spec, the discomfort IS the feature — don't dilute it. The slot-in CTA paragraph is the antidote: ownership of the rung means the next sale of this rung in their tree credits instead of compresses.

SUBJECT (≤50 chars): ${{amount}} walked past your wallet.
PREHEADER (≤90 chars): {{buyerName}} bought {{tierName}}. You don't own this rung yet.

BODY:

{{firstName}} —

<strong>{{buyerName}}</strong> just bought <strong>{{tierName}}</strong> through your line. The <strong>${{amount}}</strong> commission walked past your wallet to the first wallet above you that owns this rung.

The transaction is on-chain: <a href="{{basescanUrl}}">{{basescanUrl}}</a>.

{{{ctaParagraph}}}

— David

PRIMARY CTA (button copy, ≤30 chars): View on-chain
PRIMARY CTA URL: {{basescanUrl}}

P.S.:
The smart contract is final. The commission has already executed and credited above you. The next sale of this rung in your tree is the question, not this one. Decide whether you want it to walk past again or to credit. The activate link is in the paragraph above.

VARIABLES USED: {{firstName}}, {{buyerName}}, {{tierName}}, {{amount}}, {{basescanUrl}}, {{{ctaParagraph}}} (triple-brace, renders pre-built HTML from per-product collateral including its own embedded activate button + URL → {{activateUrl}})

===

===
EMAIL TYPE: cascade_passup
WHEN IT FIRES: The recipient's per-tier counter on {{tierName}} just rolled over after their third sale at that tier. The recipient earned the commission on sales 1 and 2; the commission on sale 3 just passed up to the first wallet above them that also owns this tier. The counter resets to zero. Triggered immediately on-chain by the smart contract event.
AUDIENCE: someone in a mixed emotional state — grateful for the credited sales 1 and 2, stung by the sale 3 passup. The wrapper names the powerline mechanic honestly and exits with the actionable next step: one more sale at this tier and the cycle restarts in their favor.

SUBJECT (≤50 chars): Sale 3. Counter rolled. Next stays.
PREHEADER (≤90 chars): Powerline mechanic just fired. The math is what makes it climb.

BODY:

{{firstName}} —

Counter just rolled over on <strong>{{tierName}}</strong>.

Sales one and two at this tier credited to your wallet. Sale three — the one that just fired — passed up to the first wallet above you that also owns {{tierName}}. That's the powerline mechanic: every third sale at every tier passes up to the sponsor at that tier. It's how the architecture climbs.

The on-chain record: <a href="{{basescanUrl}}">{{basescanUrl}}</a>.

Your counter at this tier is now back at <strong>{{counterAt}}</strong>. Make one more sale at <strong>{{tierName}}</strong> and the next sale stays with you.

The math doesn't care which sale is yours and which passes up. It just rotates. Most producers running this honestly think about the powerline once and then stop thinking about it — the climb compounds in both directions whether you're tracking it or not.

— David

PRIMARY CTA (button copy, ≤30 chars): View on-chain
PRIMARY CTA URL: {{basescanUrl}}

VARIABLES USED: {{firstName}}, {{tierName}}, {{basescanUrl}}, {{counterAt}}

===

===
EMAIL TYPE: sponsor_signup
WHEN IT FIRES: A new buyer has just activated through the recipient's referral link — a personal recruit. The new buyer purchased a tier (typically the lowest entry rung), and the recipient earned the commission. Triggered immediately on-chain by the smart contract event.
AUDIENCE: someone who just gained a personal recruit. Positive state. The wrapper acknowledges the recruit cleanly, names the immediate commission, and softly teases the architecture math: when the new buyer ascends the ladder, every rung the recipient owns earns from the same buyer again at higher amounts.

SUBJECT (≤50 chars): {{buyerName}} just signed up under you.
PREHEADER (≤90 chars): Activated {{tierName}}. Earned you ${{commissionAmount}}. The climb starts here.

BODY:

{{firstName}} —

<strong>{{buyerName}}</strong> just signed up under your link. They activated <strong>{{tierName}}</strong>, which credited <strong>${{commissionAmount}}</strong> to your wallet on the same on-chain transaction.

Verifiable here: <a href="{{basescanUrl}}">{{basescanUrl}}</a>.

The first sale is the smallest math you'll see from this buyer. The interesting math is what happens next. If they ascend the ladder — and the ladder is engineered so most do — every rung above {{tierName}} that they activate runs the same on-chain payout to you, instantly, on each transaction. The first sale credits you ${{commissionAmount}}. The full ascent through the ladder, if they walk all of it, credits you the full ladder.

The work from here is structurally simple. They've started the climb. The architecture does the rest. Your job is to be available when they ask the questions every new buyer asks at the rungs above their first one — and to point them at the next page when they're ready.

That's the entire mechanic.

— David

PRIMARY CTA (button copy, ≤30 chars): View on-chain
PRIMARY CTA URL: {{basescanUrl}}

VARIABLES USED: {{firstName}}, {{buyerName}}, {{tierName}}, {{commissionAmount}}, {{basescanUrl}}

===

===
EMAIL TYPE: opt_in_confirmation
WHEN IT FIRES: A visitor completes the capture form on wealthtransformation.com. Triggered by the form submission. Single-action email — until the recipient clicks the confirm link, no further emails are sent and the lead does not enter the drip-capture-to-t1 sequence.
AUDIENCE: someone who just opted in but hasn't confirmed. Cold but interested. They're at the start of the funnel, with zero prior context for the brand. The wrapper's job is warm, brief, single-action: confirm what they're confirming, give them the click, exit.

SUBJECT (≤50 chars): Confirm to receive the playbook.
PREHEADER (≤90 chars): One click to start. After you confirm, the first story arrives in your inbox.

BODY:

{{firstName}} —

You opted in at wealthtransformation.com. Click below to confirm.

After you click, the first email arrives — the story behind the screenshot most people pause at on the page. After that, a deliberate sequence: a story Tuesday, the math Thursday, an objection handler the following Sunday, and so on. Every email is part of an arc with a beginning and an end.

If you didn't opt in or you've changed your mind, do nothing. No email arrives. The list forgets the address by the end of the week.

— David

PRIMARY CTA (button copy, ≤30 chars): Confirm I want this
PRIMARY CTA URL: {{confirmUrl}}

P.S.:
The unsubscribe link at the bottom of every email closes the loop in one click if at any point the sequence stops being useful. This list treats your decision as final the same way the smart contract that runs the rest of this ecosystem does. Click decisively if you click.

VARIABLES USED: {{firstName}}, {{confirmUrl}}

===

===
EMAIL TYPE: reactivation
WHEN IT FIRES: The recipient's engagement_score has dipped into the "cooling" or "cold" tier — typically around the 14-30 day mark of inactivity. Fires OUTSIDE any drip sequence as a one-off. Distinct from the in-drip Step 5 reactivation emails (which fire mid-drip and reference the specific product being sold).
AUDIENCE: someone who used to engage and has gone quiet. Could be at any tier of ownership — from cold opt-in to T7 owner. The wrapper names the silence honestly, surfaces the recipient's tree activity if relevant, and asks them whether they want the cadence to continue or pause. Doctor-posture throughout. No manipulation.

SUBJECT (≤50 chars): {{daysSinceLastOpen}} days. Quiet check.
PREHEADER (≤90 chars): Used to engage. Hasn't recently. Pause the cadence or keep it running?

BODY:

{{firstName}} —

It's been about {{daysSinceLastOpen}} days since I saw you open one of these. Could be travel. Could be inbox triage. Could be something heavier than either. So treat this as a check, not a push.

I'd rather be in your inbox at the right cadence than the wrong one. If the cadence I've been running is too much for the current season — say so by clicking the pause link below and the rhythm slows. If it's the right cadence and the silence is just life, ignore this email entirely and the rhythm continues.

{{#if downlineSize}}On the contract side, your tree's been moving. <strong>{{downlineSize}}</strong> {{#if (eq downlineSize "1")}}referral{{else}}referrals{{/if}} active{{#if downlineDeepBuyers}}, {{downlineDeepBuyers}} of whom have bought through multiple rungs{{/if}}.{{#if lostAmountThisQuarter}} <strong>${{lostAmountThisQuarter}}</strong> in commissions walked past your wallet this quarter to whoever above you owns the rungs you don't. Verifiable: <a href="{{basescanWalletUrl}}">{{basescanWalletUrl}}</a>.{{/if}} Whether the cadence pauses or keeps running, the chain continues to compound either way.{{/if}}

The decision is yours. The list treats it as final.

— David

PRIMARY CTA (button copy, ≤30 chars): Pause the cadence
PRIMARY CTA URL: {{preferenceCenterUrl}}

P.S.:
If you'd rather not pause and just want a different shape — fewer emails per week, only specific products, only earned-commission and lost-commission notifications — the preferences page handles that too. Same link. The pause and the calibration share a control panel.

VARIABLES USED: {{firstName}}, {{daysSinceLastOpen}}, {{preferenceCenterUrl}}, {{downlineSize}} (with Handlebars conditional), {{downlineDeepBuyers}} (nested conditional, appears only when populated and only inside the downlineSize branch), {{lostAmountThisQuarter}} (nested conditional, populated only when > 0), {{basescanWalletUrl}} (used inside the lostAmountThisQuarter branch only). The {{#if (eq downlineSize "1")}} helper requires Handlebars eq helper which SendGrid Dynamic Templates supports natively.

===

===
EMAIL TYPE: win_back
WHEN IT FIRES: The recipient's engagement_score has been frozen for 90+ days. Last attempt before suppression — the next state is either reply-and-stay or unsubscribe-from-system.
AUDIENCE: someone who hasn't engaged in months. The relationship is effectively dead unless they revive it actively. The wrapper does not perform pleading or guilt. It names the situation, gives the recipient the agency to revive it, and exits gracefully whether they reply or not. Peterson-grade respect for the recipient's right to decide. P.S. carries the page link as the final, low-pressure hook.

SUBJECT (≤50 chars): Final email.
PREHEADER (≤90 chars): Going to stop after this. Reply with one word if you want me to stay.

BODY:

{{firstName}} —

It's been about {{daysSinceLastOpen}} days. The list's heuristic says it's time to stop sending, and I respect the heuristic.

This is the last email I'll send unless I hear from you. Reply with one word — <em>stay</em> — and the list reactivates and I keep showing up. Don't reply, and I go quiet. Either is fine. The decision was always yours.

I'm not going to make the case for staying. If the work I've been pointing at hasn't been useful enough to keep your attention, more emails won't fix that, and pretending the past months haven't happened would be insulting to both of us.

What I'll say is that the door doesn't lock when I stop sending. If a quiet morning comes, six months or a year from now, when you remember this list existed and the question of why becomes interesting again, the page is still there.

Good luck with the work.

— David

PRIMARY CTA (button copy, ≤30 chars): (none — reply-to email only)
PRIMARY CTA URL: (n/a — reply-to is the only call to action)

P.S.:
<strong>wealthtransformation.com.</strong> Nine rungs. Smart-contract delivery. The full ladder, if you ever want to look. The first rung is three dollars. Every rung after pays itself back on the first sale through it. The math is the math. Reply <em>stay</em> if you want me back. Otherwise, peace.

VARIABLES USED: {{firstName}}, {{daysSinceLastOpen}}

===

---

# CALIBRATION NOTES (REMOVE BEFORE INGEST)

**Voice continuity with drips 1-7.** All seven wrappers hold the regal/editorial register established across the 7 drip documents. Same compression discipline. Same anti-fabricated-proof and anti-manufactured-urgency posture. No "right?" tics. No "imagine if." No theatrical urgency. No countdown timers. No fake testimonials. Smart contract finality framed as feature throughout (lost_commission P.S., opt_in_confirmation P.S.). Doctor-not-Salesman stance preserved (lost_commission's *"decide whether you want it to walk past again or to credit,"* reactivation's *"the decision is yours, the list treats it as final,"* win_back's *"the decision was always yours"*).

**Brunson rule held — don't bury the news.** Wrappers 1-4 (the on-chain ones) lead with the news in the subject and confirm it in the first sentence of the body. Earned: the chain just paid. Lost: the commission walked past. Cascade: the counter rolled. Sponsor: the new buyer just activated. The slot-in paragraphs (or the rest of the body, for cascade and sponsor) carry the framing without delaying the news.

**Slot-in rendering.** {{{celebrationParagraph}}} (earned_commission) and {{{ctaParagraph}}} (lost_commission) use Handlebars triple-brace syntax to render the pre-built HTML from per-product collateral as raw, unescaped. The slot-in paragraphs already contain their own embedded markup (<strong>, <em>, <a href> tags) and, in the lost_commission case, their own embedded CTA button + URL targeting {{activateUrl}}. The wrapper's PRIMARY CTA in lost_commission targets {{basescanUrl}} (verify the loss on chain) rather than duplicating the slot-in's activate CTA — two clear paths, no conflict: verify the math (chain) or fix it (activate via the slot-in's button).

**Discomfort as feature in lost_commission.** Per the user spec for this wrapper: *"the discomfort IS the feature — don't dilute it."* The wrapper does not soften the loss, does not apologize for the loss, does not offer reassurance. The opening sentence names the buyer, the product, and the dollar amount that walked past. The on-chain link is offered for verification immediately. The slot-in paragraph carries the antidote (own the rung, the next sale credits instead of compresses). The P.S. closes by naming the choice the recipient now has and pointing at the slot-in paragraph's embedded activate link. No softening at any point.

**Cascade_passup honors the mixed emotional state.** The recipient earned from sales 1 and 2 at this tier and watched sale 3 leave. The wrapper acknowledges both — *"Sales one and two at this tier credited to your wallet. Sale three — the one that just fired — passed up..."* — and immediately reframes the powerline mechanic as the climbing mechanism rather than as a loss. The actionable next step is named: *"Make one more sale at {{tierName}} and the next sale stays with you."* The {{counterAt}} variable surfaces the post-rollover counter state (typically 0). The closing paragraph gives the recipient permission to stop tracking the powerline once the principle is understood — the climb compounds in both directions whether they're tracking it or not.

**Sponsor_signup teases the architecture math.** Brunson rule: don't bury the news. The first sentence names the new buyer and confirms the credited commission. The closing paragraphs tease the ladder math without pushing — the recruit's first sale is the smallest math the recipient will see from this buyer; if the buyer ascends, every rung the recipient owns earns again at higher amounts. The work-from-here paragraph handles the structural-simplicity reframe: the recipient's job is to be available when the new buyer hits the next rung, not to push them up the ladder.

**Opt_in_confirmation preserves single-action discipline.** The wrapper does exactly three things: confirms what they're confirming (the WT playbook), names the cadence shape (story Tuesday / math Thursday / objection handler Sunday — which previews the actual rhythm of the t0→t1 drip), and gives them the one click. The P.S. introduces the unsubscribe-link discipline early so first-time subscribers see the Doctor-posture before they've experienced any other email — which is trust-building work that pays off across the rest of the funnel.

**Reactivation handles {{lostAmountThisQuarter}} without manipulating it.** The Handlebars conditional surfaces the recipient's tree activity only when {{downlineSize}} is populated, and the lost-commission number only when {{lostAmountThisQuarter}} > 0. The closing line of the conditional block — *"Whether the cadence pauses or keeps running, the chain continues to compound either way"* — is the doctor-posture move that prevents the on-chain reality from being weaponized into email-cadence pressure. The recipient's relationship to the email cadence is decoupled from their relationship to the commercial outcomes. Both are honored.

**Win_back is structurally distinct from reactivation.** Reactivation is a one-off check-in for someone who's been quiet 14-30 days. Win_back is the last email before suppression for someone who's been frozen 90+ days. The tone is graceful exit, not negotiation. The CTA is reply-to-stay only — no preference center link, because the choice at this stage is binary: revive the relationship by replying, or let it close. The P.S. carries the page link as a final, low-pressure hook for the *"some quiet morning, six months from now"* return that's referenced across the drips' Step 6 graceful-exit emails.

**Variable usage map across the 7 wrappers.**
- earned_commission: {{firstName}}, {{amount}}, {{buyerName}}, {{tierName}}, {{basescanUrl}}, {{{celebrationParagraph}}}
- lost_commission: {{firstName}}, {{buyerName}}, {{tierName}}, {{amount}}, {{basescanUrl}}, {{{ctaParagraph}}}, plus {{activateUrl}} embedded inside the slot-in
- cascade_passup: {{firstName}}, {{tierName}}, {{basescanUrl}}, {{counterAt}}
- sponsor_signup: {{firstName}}, {{buyerName}}, {{tierName}}, {{commissionAmount}}, {{basescanUrl}}
- opt_in_confirmation: {{firstName}}, {{confirmUrl}}
- reactivation: {{firstName}}, {{daysSinceLastOpen}}, {{preferenceCenterUrl}}, {{downlineSize}} (conditional), {{downlineDeepBuyers}} (nested), {{lostAmountThisQuarter}} (nested), {{basescanWalletUrl}}
- win_back: {{firstName}}, {{daysSinceLastOpen}}

**Variables NOT used.** {{walletShort}} (not load-bearing for any wrapper's argument; visual cleanliness wins per user note from drip 5). {{tierProductPrice}}, {{tierTotalPrice}}, {{currentTier}}, {{nextTier}} — not needed, since the slot-in paragraphs already contain product-specific pricing and tier-name framing. {{sponsorName}}, {{buyerWalletShort}} — not load-bearing for any wrapper's argument.

**Approval-bar test.** Kennedy: tight, story-driven where appropriate (lost_commission's discomfort-as-feature; win_back's graceful exit; opt_in_confirmation's single-action discipline), no fake bonus, no fake testimonial, P.S. anchors where the email shape calls for it. Brunson: don't-bury-the-news rule held in wrappers 1-4; Hook-State-Action structure in transactional wrappers; the on-chain proof link offered immediately as the verifiable receipt. Bandler/Robbins: time-anchored where relevant ({{daysSinceLastOpen}} surfacing in reactivation and win_back; "settled in seconds" in earned_commission). Peterson: respects recipient agency at the highest standard in the sequence — *"the decision is yours,"* *"the decision was always yours,"* *"the list treats it as final,"* *"the door doesn't lock when I stop sending."* Brand voice: regal/editorial, of-a-piece with the seven drip documents.

**Sequence completion.** This is the eighth and final document in thread 1. With this generic-emails.md ingested alongside drip-t0-to-t1.md through drip-t6-to-t7.md, the engineering thread has the full set of 56 emails across 7 drip sequences plus 7 generic wrappers. Total count: 49 drip emails + 7 wrappers = 56 emails, exactly as planned in the original commission spec. The wrappers slot in the per-product paragraphs (#8a lost-commission CTA paragraphs and #8b earned-commission celebration paragraphs) accumulated across the 7 drip documents plus the T8 and T9 outliers from threads 2 and 3, covering all 9 tiers of the Wealth Transformation ladder.
