import { describe, it, expect, beforeAll } from "vitest";
import { createHmac } from "node:crypto";
import type { Request } from "express";
import { verifyHmac } from "../api/auth.js";
import { issueToken, verifyToken } from "../api/preference-token.js";

const SECRET = "0".repeat(48);

beforeAll(() => {
  process.env.INTERNAL_HMAC_SECRET_PATH = "";
  // Bypass file-based loader by mutating the imported config.
  // (config is frozen as `as const` but the property descriptor is writable
  // for tests because the inner object literal isn't deeply frozen.)
});

function fakeReq(body: string, ts: string, sig: string | null): Request {
  const headers: Record<string, string> = {};
  if (sig !== null) headers["x-wt-signature"] = sig;
  headers["x-wt-timestamp"] = ts;
  return {
    header: (h: string) => headers[h.toLowerCase()],
    rawBody: Buffer.from(body, "utf8"),
  } as unknown as Request;
}

describe("verifyHmac", () => {
  it("rejects when no internal secret is configured", () => {
    // config.internalHmacSecret is empty string by default in test env.
    const req = fakeReq('{"a":1}', String(Math.floor(Date.now() / 1000)), "deadbeef");
    expect(verifyHmac(req)).toBe(false);
  });
});

describe("preference token", () => {
  beforeAll(async () => {
    // Inject a secret directly.
    const cfgMod = await import("../config.js");
    (cfgMod.config as unknown as { internalHmacSecret: string }).internalHmacSecret = SECRET;
  });

  it("round-trips a valid subscriber id", () => {
    const id = "11111111-1111-1111-1111-111111111111";
    const tok = issueToken(id);
    expect(verifyToken(tok)?.subscriberId).toBe(id);
  });

  it("rejects tampered token", () => {
    const tok = issueToken("aaaa1111-1111-1111-1111-111111111111");
    const broken = tok.slice(0, -2) + (tok.endsWith("a") ? "b" : "a");
    expect(verifyToken(broken)).toBeNull();
  });

  it("rejects garbage", () => {
    expect(verifyToken("nope")).toBeNull();
    expect(verifyToken("a.b")).toBeNull();
  });

  it("verifies a manually-constructed valid token", () => {
    const id = "22222222-2222-2222-2222-222222222222";
    const exp = Math.floor(Date.now() / 1000) + 60;
    const payload = `${id}.${exp}`;
    const sig = createHmac("sha256", SECRET).update(payload).digest();
    const b64url = (b: Buffer) =>
      b
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    const token = `${b64url(Buffer.from(payload))}.${b64url(sig)}`;
    expect(verifyToken(token)?.subscriberId).toBe(id);
  });
});
