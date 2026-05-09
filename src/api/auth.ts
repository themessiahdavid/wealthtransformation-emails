// Authentication for the HTTP API.
//
// Two flavors:
//   1. Service-to-service HMAC ('x-wt-signature' + 'x-wt-timestamp' over body) —
//      used by indexer, IAT side, WT Next.js app. Same scheme as the IAT webhook.
//   2. Admin SIWE — wallet signs a nonce-bound message, we verify, issue a
//      short-lived JWT in an http-only cookie. Admin endpoints check the JWT.
//
// Public endpoints (preference center, opt-in confirmation, unsubscribe) use
// signed token URLs — no auth needed.

import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { config } from "../config.js";
import { logger } from "../log.js";

const HMAC_SKEW_SEC = 5 * 60;

export function verifyHmac(req: Request): boolean {
  if (!config.internalHmacSecret) return false;
  const sig = req.header("x-wt-signature");
  const ts = req.header("x-wt-timestamp");
  if (!sig || !ts) return false;
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - tsNum) > HMAC_SKEW_SEC) return false;
  // Allow empty body for GET — sender signs `${ts}.` with no body bytes.
  // POST/PUT/DELETE must have a body parsed by express.json() so rawBody
  // is non-empty.
  const raw = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0);
  if (req.method !== "GET" && raw.length === 0) return false;
  const expected = createHmac("sha256", config.internalHmacSecret)
    .update(`${ts}.`)
    .update(raw)
    .digest("hex");
  if (sig.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(sig, "utf8"), Buffer.from(expected, "utf8"));
  } catch {
    return false;
  }
}

export function requireHmac(req: Request, res: Response, next: NextFunction) {
  if (!verifyHmac(req)) {
    return res.status(401).json({ error: "WT_HMAC_INVALID" });
  }
  next();
}

// ---- SIWE-bound admin JWT ----
// We don't implement the full SIWE flow here — that lives in the wealthtransformation-app
// frontend. The API just verifies a JWT that the frontend issues after SIWE
// success, signed with the same internal HMAC secret.

const JWT_TTL_SEC = 15 * 60;

export function issueAdminToken(walletAddress: string): string {
  if (!config.internalHmacSecret) throw new Error("internal HMAC not set");
  const lowered = walletAddress.toLowerCase();
  if (!config.adminAllowlist.includes(lowered)) {
    throw new Error("not_in_allowlist");
  }
  return jwt.sign(
    { sub: lowered, role: "admin", jti: randomBytes(8).toString("hex") },
    config.internalHmacSecret,
    { algorithm: "HS256", expiresIn: JWT_TTL_SEC },
  );
}

export interface AdminClaims {
  sub: string;
  role: "admin";
}

export function verifyAdminToken(token: string): AdminClaims | null {
  if (!config.internalHmacSecret) return null;
  try {
    const decoded = jwt.verify(token, config.internalHmacSecret, {
      algorithms: ["HS256"],
    }) as Partial<AdminClaims>;
    if (decoded?.role !== "admin" || typeof decoded.sub !== "string") return null;
    if (!config.adminAllowlist.includes(decoded.sub)) return null;
    return { sub: decoded.sub, role: "admin" };
  } catch (err) {
    logger.debug({ err: err instanceof Error ? err.message : err }, "jwt_verify_failed");
    return null;
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const cookie = req.headers.cookie ?? "";
  const m = cookie.match(/wt_admin_token=([^;]+)/);
  const token = m?.[1] ?? req.header("authorization")?.replace(/^Bearer\s+/, "");
  if (!token) return res.status(401).json({ error: "missing_token" });
  const claims = verifyAdminToken(token);
  if (!claims) return res.status(401).json({ error: "invalid_token" });
  (req as Request & { admin?: AdminClaims }).admin = claims;
  next();
}
