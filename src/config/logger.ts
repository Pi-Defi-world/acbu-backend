import winston from "winston";
import path from "path";
import { config } from "./env";
import { FinancialLogPayload, FinancialEventEnvironment } from "../types/logging";

const logDir = path.dirname(config.logFile);

// Create logs directory if it doesn't exist
import fs from "fs";
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json(),
);

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(meta).length > 0) {
      msg += ` ${JSON.stringify(meta)}`;
    }
    return msg;
  }),
);

export const logger = winston.createLogger({
  level: config.logLevel,
  format: logFormat,
  defaultMeta: { service: "acbu-backend" },
  transports: [
    // Write all logs to console
    new winston.transports.Console({
      format: consoleFormat,
    }),
    // Write all logs with level 'error' and below to error.log
    new winston.transports.File({
      filename: path.join(logDir, "error.log"),
      level: "error",
    }),
    // Write all logs to combined.log
    new winston.transports.File({
      filename: config.logFile,
    }),
  ],
});

// If we're not in production, log to the console with simpler format
if (config.nodeEnv !== "production") {
  logger.add(
    new winston.transports.Console({
      format: winston.format.simple(),
    }),
  );
}

// ── Structured Financial Logging ─────────────────────────────────────────────

const REQUIRED_FIELDS: (keyof FinancialLogPayload)[] = [
  "event", "amount", "currency", "userId", "accountId",
  "idempotencyKey", "transactionId", "status", "correlationId",
];

const CARD_NUMBER_PATTERN = /\b\d{13,19}\b/g;

function redactPii(value: string): string {
  return value.replace(CARD_NUMBER_PATTERN, "[REDACTED]");
}

export function logFinancialEvent(payload: Omit<FinancialLogPayload, "timestamp" | "environment"> & Partial<Pick<FinancialLogPayload, "timestamp" | "environment">>): void {
  // Apply defaults (caller-supplied values take precedence)
  const entry: FinancialLogPayload = {
    ...payload,
    timestamp: payload.timestamp ?? new Date().toISOString(),
    environment: payload.environment ?? (config.nodeEnv as FinancialEventEnvironment),
  };

  // Redact PII in string fields
  const mutableEntry = entry as unknown as Record<string, unknown>;
  for (const key of Object.keys(mutableEntry)) {
    if (typeof mutableEntry[key] === "string") {
      mutableEntry[key] = redactPii(mutableEntry[key] as string);
    }
  }

  // Validate required fields
  const missing = REQUIRED_FIELDS.filter(
    (f) => entry[f] === undefined || entry[f] === null || entry[f] === "",
  );
  if (missing.length > 0) {
    logger.warn("logFinancialEvent: missing required fields", { missing, partial: entry });
    return;
  }

  // Select log level by status
  switch (entry.status) {
    case "failed":
      logger.error("financial_event", entry);
      break;
    case "reversed":
      logger.warn("financial_event", entry);
      break;
    default:
      logger.info("financial_event", entry);
  }
}
