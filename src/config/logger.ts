import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import path from "path";
import fs from "fs";
import { config } from "./env";
import { FinancialLogPayload, FinancialEventEnvironment } from "../types/logging";
// Re-export redaction helpers so callers that previously imported from logger.ts
// continue to work without changes. The implementations live in logRedaction.ts.
export { redactFormat, redactLogValue, redactPii } from "./logRedaction";
import { redactFormat, redactLogValue } from "./logRedaction";

export type LogLevel = "error" | "warn" | "info" | "http" | "verbose" | "debug" | "silly";

export function resolveTransportLogLevels(options: {
  nodeEnv: string;
  logLevel: LogLevel;
  logConsoleLevel?: LogLevel;
  logFileLevel?: LogLevel;
}): { console: LogLevel; file: LogLevel; error: LogLevel } {
  const isProduction = options.nodeEnv === "production";

  return {
    console: options.logConsoleLevel ?? (isProduction ? "info" : options.logLevel),
    file: options.logFileLevel ?? (isProduction ? "info" : options.logLevel),
    error: "error",
  };
}

const transportLevels = resolveTransportLogLevels({
  nodeEnv: config.nodeEnv,
  logLevel: config.logLevel as LogLevel,
  logConsoleLevel: config.logConsoleLevel as LogLevel,
  logFileLevel: config.logFileLevel as LogLevel,
});

const logDir = path.dirname(config.logFile);

if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  redactFormat(),
  winston.format.json(),
);

const consoleFormat = winston.format.combine(
  redactFormat(),
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

const isProduction = config.nodeEnv === "production";

export const logger = winston.createLogger({
  level: config.logLevel,
  format: logFormat,
  defaultMeta: { service: "acbu-backend" },
  transports: [
    new winston.transports.Console({
      level: transportLevels.console,
      format: isProduction
        ? consoleFormat
        : winston.format.combine(
            redactFormat(),
            winston.format.colorize(),
            winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
            winston.format.simple(),
          ),
    }),
    // Rotating error log: daily rotation, 14-day retention, 100 MB max per file
    new DailyRotateFile({
      dirname: logDir,
      filename: "error-%DATE%.log",
      datePattern: "YYYY-MM-DD",
      level: "error",
      maxFiles: "14d",
      maxSize: "100m",
      zippedArchive: true,
    }),
    // Rotating combined log: daily rotation, 30-day retention, 100 MB max per file
    new DailyRotateFile({
      dirname: logDir,
      filename: "combined-%DATE%.log",
      datePattern: "YYYY-MM-DD",
      level: transportLevels.file,
      maxFiles: "30d",
      maxSize: "100m",
      zippedArchive: true,
    }),
  ],
});

// Structured Financial Logging

// Audit dead-letter queue (DLQ) for financial events that fail validation.
// Records are appended as newline-delimited JSON so they can be replayed,
// alerted on, or reconciled later instead of vanishing from the audit trail.
const FINANCIAL_EVENT_DLQ_FILENAME = "financial-events-dlq.log";

export function getFinancialEventDlqFilePath(): string {
  return path.join(logDir, FINANCIAL_EVENT_DLQ_FILENAME);
}

function writeFinancialEventDlq(record: Record<string, unknown>): void {
  try {
    fs.appendFileSync(getFinancialEventDlqFilePath(), `${JSON.stringify(record)}\n`, "utf8");
  } catch (err) {
    // Never let DLQ persistence failures propagate to callers; the error-level
    // alert emitted alongside still surfaces the rejected event.
    logger.error("Failed to persist invalid financial event to audit DLQ", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

const REQUIRED_FIELDS: (keyof FinancialLogPayload)[] = [
  "event",
  "amount",
  "currency",
  "userId",
  "accountId",
  "idempotencyKey",
  "transactionId",
  "status",
  "correlationId",
];

export function logFinancialEvent(
  payload: Omit<FinancialLogPayload, "timestamp" | "environment"> &
    Partial<Pick<FinancialLogPayload, "timestamp" | "environment">>,
): void {
  // Apply defaults (caller-supplied values take precedence)
  const entry: FinancialLogPayload = {
    ...payload,
    timestamp: payload.timestamp ?? new Date().toISOString(),
    environment: payload.environment ?? (config.nodeEnv as FinancialEventEnvironment),
  };

  // Redact PII in all fields using the full key-based + card-number redaction
  const mutableEntry = entry as unknown as Record<string, unknown>;
  for (const key of Object.keys(mutableEntry)) {
    mutableEntry[key] = redactLogValue(mutableEntry[key], key);
  }

  // Validate required fields
  const missing = REQUIRED_FIELDS.filter(
    (f) => entry[f] === undefined || entry[f] === null || entry[f] === "",
  );
  if (missing.length > 0) {
    // Error-level alert: a malformed financial event must never disappear
    // from the audit trail silently (#791).
    logger.error("logFinancialEvent: missing required fields — event quarantined to audit DLQ", {
      missing,
      partial: entry,
    });
    // Preserve the redacted partial record in the audit DLQ for replay and
    // reconciliation instead of dropping it.
    writeFinancialEventDlq({
      reason: "missing_required_fields",
      missing,
      dlqTimestamp: new Date().toISOString(),
      event: entry,
    });
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
