import pg from "pg";

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (pool) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  pool = new pg.Pool({
    connectionString: url,
    max: Number.parseInt(process.env.DATABASE_POOL_MAX ?? "10", 10),
    idleTimeoutMillis: 30_000,
  });
  // Surface connection errors loudly — silent pool errors caused 6h debug last time.
  pool.on("error", (err) => {
    // eslint-disable-next-line no-console
    console.error("[pg] idle client error:", err);
  });
  return pool;
}

export async function withTx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // swallow rollback errors — original is more useful
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
