import { PrismaClient } from "@prisma/client";
import { withAccelerate } from "@prisma/extension-accelerate";
import { config } from "./env";
import { logger } from "./logger";
import { trace, SpanStatusCode } from "@opentelemetry/api";

const useAccelerate = Boolean(config.prismaAccelerateUrl);
const databaseUrl = useAccelerate
  ? config.prismaAccelerateUrl!
  : config.databaseUrl;

let basePrisma: any;
// Use in-repo Jest mock when running tests to avoid depending on Jest's
// hoisting behavior for automatic mocks. This makes `new PrismaClient()`
// return the mock implementation during tests.
if (process.env.NODE_ENV === "test") {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mock = require("../../__mocks__/@prisma/client");
  basePrisma = new mock.PrismaClient();
} else {
  basePrisma = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
    log: [
      { level: "query", emit: "event" },
      { level: "error", emit: "stdout" },
      { level: "warn", emit: "stdout" },
    ],
  });
}

// OTel: wrap every Prisma query in a span so traces link DB calls to parent spans
if (typeof basePrisma.$use === "function") {
  basePrisma.$use(async (params: any, next: any) => {
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
}

const initialPrisma: any = useAccelerate
  ? basePrisma.$extends(withAccelerate())
  : basePrisma;

// Export a client object. For test runs we prefer a plain object that
// exposes model properties directly (e.g. `prisma.user`) so the in-repo
// mock is always accessible as simple properties. For non-test runs we
// keep a Proxy around to forward to the real Prisma client or extensions.
let exportedPrisma: any;

if (process.env.NODE_ENV === "test") {
  // When running tests, export the (mock) Prisma client directly so
  // model getters like `prisma.recoveryAttempt.count` are available
  // as on a normal PrismaClient instance. This avoids fragile getter
  // indirection and ensures tests and app code share the same mock.
  exportedPrisma = initialPrisma;
} else {
  // Some runtime Prisma mocks or extensions may not expose model getters
  // directly. Wrap the client in a proxy that forwards unknown property
  // accesses to `model(name)` when available so calls like
  // `prisma.user.create()` work with extended clients.
  const prismaProxy = new Proxy(initialPrisma as any, {
    get(target, prop: string | symbol, receiver) {
      if (typeof prop === "symbol") return Reflect.get(target, prop, receiver);
      if (prop in target) return (target as any)[prop];
      if (typeof (target as any).model === "function") {
        return (target as any).model(prop as string);
      }
      return undefined;
    },
  });
  exportedPrisma = prismaProxy;
}

export const prisma: any = exportedPrisma;

// Log queries in development ($on exists only on base client, not on extended proxy)
if (config.nodeEnv === "development" && typeof basePrisma.$on === "function") {
  basePrisma.$on(
    "query" as never,
    (e: any) => {
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

export default exportedPrisma;

// Ensure common model getters exist on the exported proxy for simplified
// in-repo mocks that rely on direct properties like `prisma.user`.
// Define explicit getters that forward to `initialPrisma.model(name)` so
// both `prisma.user.create()` and `prisma.model('user')` work reliably.
const _modelNames = [
  "user",
  "recoveryAttempt",
  "userDevice",
  "salaryBatch",
  "salaryItem",
  "salarySchedule",
  "transaction",
  "webhook",
  "oracleRate",
  "reserve",
  "reserveHistory",
  "apiKey",
];
for (const name of _modelNames) {
  try {
    Object.defineProperty(exportedPrisma, name, {
      configurable: true,
      enumerable: true,
      get() {
        try {
          const direct = (initialPrisma as any)[name];
          if (direct !== undefined) return direct;
          if (typeof (initialPrisma as any).model === "function") {
            return (initialPrisma as any).model(name);
          }
        } catch (e) {
          // ignore
        }
        return undefined;
      },
    });
  } catch (e) {
    // best-effort only; ignore failures
  }
}
