// Signed preference-center tokens. Used so a recipient can manage their
// preferences without logging in — the link in every email footer carries
// a token that authenticates them as a specific subscriber.
//
// The token is HMAC'd over `subscriberId.expiresAt` and base64url-encoded.

import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

const TOKEN_TTL_SEC = 60 * 60 * 24 * 365; // 1 year — preference links shouldn't expire fast

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Buffer {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4;
  if (pad) s += "=".repeat(4 - pad);
  return Buffer.from(s, "base64");
}

export function issueToken(subscriberId: string): string {
  if (!config.internalHmacSecret) throw new Error("internal HMAC not set");
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC;
  const payload = `${subscriberId}.${exp}`;
  const sig = createHmac("sha256", config.internalHmacSecret).update(payload).digest();
  return `${b64url(Buffer.from(payload))}.${b64url(sig)}`;
}

export function verifyToken(token: string): { subscriberId: string } | null {
  if (!config.internalHmacSecret) return null;
  const [payloadB64, sigB64] = token.split(".");
  if (!payloadB64 || !sigB64) return null;
  const payload = fromB64url(payloadB64).toString("utf8");
  const [subscriberId, expStr] = payload.split(".");
  if (!subscriberId || !expStr) return null;
  const exp = Number.parseInt(expStr, 10);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;
  const expectedSig = createHmac("sha256", config.internalHmacSecret)
    .update(payload)
    .digest();
  const sig = fromB64url(sigB64);
  if (sig.length !== expectedSig.length) return null;
  try {
    if (!timingSafeEqual(sig, expectedSig)) return null;
  } catch {
    return null;
  }
  return { subscriberId };
}
