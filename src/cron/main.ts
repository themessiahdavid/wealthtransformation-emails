// Cron entry point. Schedules:
//   - Drip scheduler tick (every 15 min)
//   - Daily engagement decay (00:30 UTC)
//   - Hourly tier-ownership refresh (TODO when on-chain sync is built)

import cron, { type ScheduledTask } from "node-cron";
import { logger } from "../log.js";
import { runOnce as dripRun } from "../drips/scheduler.js";
import { dailyDecay } from "../scoring/engagement.js";
import { closePool } from "../db/pool.js";

const tasks: ScheduledTask[] = [];

export function start() {
  tasks.push(
    cron.schedule("*/15 * * * *", async () => {
      try {
        await dripRun();
      } catch (err) {
        logger.error({ err: err instanceof Error ? err.message : err }, "drip_cron_error");
      }
    }),
  );
  tasks.push(
    cron.schedule("30 0 * * *", async () => {
      try {
        const updated = await dailyDecay();
        logger.info({ updated }, "daily_decay_done");
      } catch (err) {
        logger.error(
          { err: err instanceof Error ? err.message : err },
          "daily_decay_error",
        );
      }
    }),
  );
  logger.info({ taskCount: tasks.length }, "cron_started");
}

export function stop() {
  for (const t of tasks) t.stop();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start();
  const shutdown = async () => {
    stop();
    await closePool();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
