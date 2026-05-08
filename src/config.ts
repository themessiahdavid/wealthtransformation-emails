import { existsSync, readFileSync } from "node:fs";
import "dotenv/config";

function required(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env: ${key}`);
  return v;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function int(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) throw new Error(`Env ${key} is not an integer: ${v}`);
  return n;
}

function readSecretFile(path: string, allowMissing = false): string | undefined {
  if (!existsSync(path)) {
    if (allowMissing) return undefined;
    throw new Error(`Secret file not found: ${path}`);
  }
  return readFileSync(path, "utf8").trim();
}

const ALLOWED_CHAINS = ["BASE_MAINNET", "BASE_SEPOLIA"] as const;
type Chain = (typeof ALLOWED_CHAINS)[number];

function chain(): Chain {
  // Defaults to BASE_SEPOLIA in dev/test so the module loads cleanly without
  // a full .env. Production / staging must set CHAIN explicitly.
  const v = process.env["CHAIN"] ?? "BASE_SEPOLIA";
  if (!ALLOWED_CHAINS.includes(v as Chain)) {
    throw new Error(`CHAIN must be one of ${ALLOWED_CHAINS.join(", ")}, got: ${v}`);
  }
  return v as Chain;
}

export const config = {
  env: optional("NODE_ENV", "development"),
  logLevel: optional("LOG_LEVEL", "info"),

  apiPort: int("API_PORT", 4100),

  // SendGrid
  // Allow missing in dev so the worker can boot in stub mode without a real key.
  sendgridApiKey: readSecretFile(
    optional("SENDGRID_API_KEY_PATH", "/dev/null"),
    true,
  ) ?? "",
  senderFromEmail: optional("SENDER_FROM_EMAIL", "team@mail.wealthtransformation.com"),
  senderFromName: optional("SENDER_FROM_NAME", "Wealth Transformation"),
  senderReplyTo: optional("SENDER_REPLY_TO", "support@mail.wealthtransformation.com"),
  sendgridWebhookKey:
    readSecretFile(
      optional("SENDGRID_WEBHOOK_VERIFICATION_KEY_PATH", "/dev/null"),
      true,
    ) ?? "",

  // Internal HMAC for service-to-service callers
  internalHmacSecret: readSecretFile(
    optional("INTERNAL_HMAC_SECRET_PATH", "/dev/null"),
    true,
  ) ?? "",

  // IAT lookup
  iatLookupUrl: optional(
    "IAT_INTERNAL_LOOKUP_URL",
    "https://api.iamtransformation.com/api/v1/internal/wallet-email",
  ),
  iatLookupHmac: readSecretFile(
    optional("IAT_INTERNAL_HMAC_SECRET_PATH", "/dev/null"),
    true,
  ) ?? "",

  // Chain
  baseRpcUrl: optional("BASE_RPC_URL", "https://sepolia.base.org"),
  wtContractAddress: optional(
    "WT_CONTRACT_ADDRESS",
    "0xeb83B8ce7636669FA940f57e01D7a9a3A7ddB78d",
  ) as `0x${string}`,
  chain: chain(),

  // Admin
  adminAllowlist: optional("ADMIN_ALLOWLIST", "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),

  // Throughput
  outboxBatchSize: int("OUTBOX_BATCH_SIZE", 100),
  outboxIntervalMs: int("OUTBOX_INTERVAL_MS", 5000),
  sendRateLimitPerMinute: int("SEND_RATE_LIMIT_PER_MINUTE", 1000),

  // Public-facing URLs
  publicBaseUrl: optional("PUBLIC_BASE_URL", "https://wealthtransformation.com"),
} as const;

export type Config = typeof config;
