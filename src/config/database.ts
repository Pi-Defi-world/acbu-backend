import { PrismaClient } from "@prisma/client";
import { withAccelerate } from "@prisma/extension-accelerate";
import { config } from "./env";
import { logger } from "./logger";
import { trace, SpanStatusCode } from "@opentelemetry/api";

const useAccelerate = Boolean(config.prismaAccelerateUrl);
const databaseUrl = useAccelerate
  ? config.prismaAccelerateUrl!
  : config.databaseUrl;

const basePrisma = new PrismaClient({
  datasources: { db: { url: databaseUrl } },
  log: [
    { level: "query", emit: "event" },
    { level: "error", emit: "stdout" },
    { level: "warn", emit: "stdout" },
  ],
});

// OTel: wrap every Prisma query in a span so traces link DB calls to parent spans
basePrisma.$use(async (params, next) => {
  const tracer = trace.getTracer("prisma");
  const spanName = `prisma.${params.model ?? "raw"}.${params.action}`;
  return tracer.startActiveSpan(spanName, async (span) => {
    span.setAttributes({
      "db.system": "postgresql",
      "db.operation": params.action,
      ...(params.model ? { "db.prisma.model": params.model } : {}),
    });
    try {
      const result = await next(params);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
      throw err;
    } finally {
      span.end();
    }
  });
});

export const prisma = useAccelerate
  ? basePrisma.$extends(withAccelerate())
  : basePrisma;

// Log queries in development ($on exists only on base client, not on extended proxy)
if (config.nodeEnv === "development") {
  basePrisma.$on(
    "query" as never,
    (e: { query: string; params: string; duration: number }) => {
      logger.debug("Query", {
        query: e.query,
        params: e.params,
        duration: `${e.duration}ms`,
      });
    },
  );
}

// Handle graceful shutdown
process.on("beforeExit", async () => {
  await basePrisma.$disconnect();
});

export default prisma;
