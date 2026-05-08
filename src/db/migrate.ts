// Simple sequential migration runner. Each .sql file in src/db/migrations is
// applied exactly once, in numeric-prefix order. Tracking table is
// `wt_email_schema_migrations`.
//
// Usage:
//   pnpm tsx src/db/migrate.ts up
//   pnpm tsx src/db/migrate.ts status

import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import { getPool, closePool } from "./pool.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "migrations");

interface Migration {
  name: string;
  path: string;
  sql: string;
}

function loadMigrations(): Migration[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  return files.map((f) => ({
    name: f.replace(/\.sql$/, ""),
    path: join(MIGRATIONS_DIR, f),
    sql: readFileSync(join(MIGRATIONS_DIR, f), "utf8"),
  }));
}

async function ensureTrackingTable() {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS wt_email_schema_migrations (
      name VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function alreadyApplied(): Promise<Set<string>> {
  const r = await getPool().query<{ name: string }>(
    "SELECT name FROM wt_email_schema_migrations",
  );
  return new Set(r.rows.map((row) => row.name));
}

async function applyOne(m: Migration) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(m.sql);
    await client.query(
      "INSERT INTO wt_email_schema_migrations (name) VALUES ($1)",
      [m.name],
    );
    await client.query("COMMIT");
    // eslint-disable-next-line no-console
    console.log(`✓ applied ${m.name}`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function up() {
  await ensureTrackingTable();
  const applied = await alreadyApplied();
  const all = loadMigrations();
  const pending = all.filter((m) => !applied.has(m.name));
  if (pending.length === 0) {
    // eslint-disable-next-line no-console
    console.log("All migrations applied.");
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`Applying ${pending.length} pending migration(s)…`);
  for (const m of pending) {
    await applyOne(m);
  }
}

async function status() {
  await ensureTrackingTable();
  const applied = await alreadyApplied();
  const all = loadMigrations();
  for (const m of all) {
    const tag = applied.has(m.name) ? "✓" : "•";
    // eslint-disable-next-line no-console
    console.log(`${tag} ${m.name}`);
  }
}

const cmd = process.argv[2] ?? "up";
const main = cmd === "status" ? status : up;
main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("FATAL:", err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(closePool);
