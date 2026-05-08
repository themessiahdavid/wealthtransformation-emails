import pino from "pino";
import { config } from "./config.js";

export const logger = pino({
  level: config.logLevel,
  base: { service: "wt-emails", env: config.env },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = typeof logger;
