// Resolve a wallet address to an IAT user's email + display name. Cached for
// 60 seconds in-memory to avoid hammering IAT on bulk operations. Calls a
// dedicated internal HMAC-authenticated endpoint on api.iamtransformation.com.
//
// IMPORTANT: this endpoint must be added on the IAT side. See
// docs/IAT_INTERNAL_LOOKUP_API.md (TODO) — until built, lookup() returns null
// and producers fall back to "no email on file" behavior (do not send).

import { createHmac } from "node:crypto";
import { config } from "../config.js";
import { logger } from "../log.js";

interface LookupResult {
  email: string | null;
  iatUserId: string | null;
  displayName: string | null;
  ownsTiers: number[];
  isAffiliateAtTiers: number[];
}

const cache = new Map<string, { value: LookupResult; expiresAt: number }>();
const TTL_MS = 60_000;

function signBody(secret: string, ts: string, body: string): string {
  return createHmac("sha256", secret).update(`${ts}.`).update(body).digest("hex");
}

export async function lookup(walletAddress: string): Promise<LookupResult> {
  const key = walletAddress.toLowerCase();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  if (!config.iatLookupHmac) {
    logger.warn(
      { wallet: walletAddress },
      "iat_lookup_skipped_no_hmac (set IAT_INTERNAL_HMAC_SECRET_PATH)",
    );
    return {
      email: null,
      iatUserId: null,
      displayName: null,
      ownsTiers: [],
      isAffiliateAtTiers: [],
    };
  }

  const body = JSON.stringify({ walletAddress: key });
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = signBody(config.iatLookupHmac, ts, body);

  try {
    const res = await fetch(config.iatLookupUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-wt-signature": sig,
        "x-wt-timestamp": ts,
      },
      body,
    });
    if (!res.ok) {
      logger.warn({ status: res.status, wallet: walletAddress }, "iat_lookup_failed");
      const empty: LookupResult = {
        email: null,
        iatUserId: null,
        displayName: null,
        ownsTiers: [],
        isAffiliateAtTiers: [],
      };
      // Cache misses for a shorter window so a freshly-provisioned user
      // becomes lookupable quickly.
      cache.set(key, { value: empty, expiresAt: Date.now() + 5_000 });
      return empty;
    }
    const json = (await res.json()) as Partial<LookupResult>;
    const value: LookupResult = {
      email: json.email ?? null,
      iatUserId: json.iatUserId ?? null,
      displayName: json.displayName ?? null,
      ownsTiers: Array.isArray(json.ownsTiers) ? json.ownsTiers : [],
      isAffiliateAtTiers: Array.isArray(json.isAffiliateAtTiers)
        ? json.isAffiliateAtTiers
        : [],
    };
    cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
    return value;
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : err, wallet: walletAddress },
      "iat_lookup_error",
    );
    return {
      email: null,
      iatUserId: null,
      displayName: null,
      ownsTiers: [],
      isAffiliateAtTiers: [],
    };
  }
}

export function clearCache() {
  cache.clear();
}
