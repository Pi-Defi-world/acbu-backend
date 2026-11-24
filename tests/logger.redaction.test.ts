import { redactLogValue, redactFormat } from "../src/config/logger";
import winston from "winston";
import { Writable } from "stream";

describe("redactLogValue", () => {
  it("redacts sensitive keys such as passcode", () => {
    expect(redactLogValue({ passcode: "1234", userId: "u-1" })).toEqual({
      passcode: "[REDACTED]",
      userId: "u-1",
    });
  });

  it("redacts nested sensitive keys and card-like numbers", () => {
    expect(
      redactLogValue({
        error: "failed",
        meta: {
          authorization: "Bearer abc",
          note: "card 4111111111111111 charged",
        },
      }),
    ).toEqual({
      error: "failed",
      meta: {
        authorization: "[REDACTED]",
        note: "card [REDACTED] charged",
      },
    });
  });

  it("does not mutate the original object", () => {
    const original = { passcode: "secret", nested: { token: "abc" } };
    redactLogValue(original);
    expect(original).toEqual({ passcode: "secret", nested: { token: "abc" } });
  });

  it("handles circular references", () => {
    const circular: Record<string, unknown> = { ok: true };
    circular.self = circular;
    expect(redactLogValue(circular)).toEqual({
      ok: true,
      self: "[Circular]",
    });
  });
});

describe("redactLogValue – error stack frames", () => {
  it("redacts card numbers embedded in a stack trace", () => {
    const stackWithCard =
      "Error: something\n    at processPayment (payment.ts:12:5)\n    card 4111111111111111 passed as arg";
    const result = redactLogValue(stackWithCard, "stack") as string;
    expect(result).not.toContain("4111111111111111");
    expect(result).toContain("[REDACTED]");
    // Preserves the rest of the stack trace
    expect(result).toContain("Error: something");
    expect(result).toContain("at processPayment");
  });

  it("redacts card numbers in nested error stack", () => {
    const err = {
      message: "payment failed",
      stack: "Error: payment failed\n    at fn (file.ts:1)\n    4111111111111111",
    };
    const result = redactLogValue(err) as Record<string, unknown>;
    expect(result.stack).not.toContain("4111111111111111");
    expect(result.stack).toContain("[REDACTED]");
    // message is a normal string value — redactPii should leave it unchanged when no card
    expect(result.message).toBe("payment failed");
  });

  it("leaves stack without PII unchanged", () => {
    const cleanStack = "Error: oops\n    at doThing (app.ts:5:3)";
    const result = redactLogValue(cleanStack, "stack") as string;
    expect(result).toBe(cleanStack);
  });
});

describe("redactFormat – structured field preservation", () => {
  function makeLogger(chunks: string[]) {
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    return winston.createLogger({
      level: "debug",
      format: winston.format.combine(
        winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        redactFormat(),
        winston.format.json(),
      ),
      transports: [new winston.transports.Stream({ stream })],
    });
  }

  it("preserves timestamp, level, and message intact", (done) => {
    const chunks: string[] = [];
    const log = makeLogger(chunks);
    log.info("user logged in", { userId: "u-1" });

    setImmediate(() => {
      const parsed = JSON.parse(chunks[0]);
      // Structured fields must not be redacted
      expect(typeof parsed.timestamp).toBe("string");
      expect(parsed.timestamp).not.toBe("[REDACTED]");
      expect(parsed.level).toBe("info");
      expect(parsed.message).toBe("user logged in");
      done();
    });
  });

  it("redacts meta but preserves structured fields", (done) => {
    const chunks: string[] = [];
    const log = makeLogger(chunks);
    log.debug("failed", { passcode: "my-secret", amount: 10 });

    setImmediate(() => {
      const parsed = JSON.parse(chunks[0]);
      expect(parsed.message).toBe("failed");
      expect(parsed.level).toBe("debug");
      expect(parsed.timestamp).not.toBe("[REDACTED]");
      expect(parsed.passcode).toBe("[REDACTED]");
      expect(parsed.amount).toBe(10);
      expect(chunks[0]).not.toContain("my-secret");
      done();
    });
  });

  it("redacts card numbers in error stack attached to log meta", (done) => {
    const chunks: string[] = [];
    const log = makeLogger(chunks);
    const errStack =
      "Error: bad\n    at pay (pay.ts:1)\n    raw card: 4111111111111111";
    log.error("payment error", { err: { message: "bad", stack: errStack } });

    setImmediate(() => {
      const parsed = JSON.parse(chunks[0]);
      expect(parsed.message).toBe("payment error");
      const stackOut = parsed.err?.stack as string;
      expect(stackOut).toBeDefined();
      expect(stackOut).not.toContain("4111111111111111");
      expect(stackOut).toContain("[REDACTED]");
      expect(stackOut).toContain("at pay");
      done();
    });
  });
});

describe("redactFormat (winston) – legacy test", () => {
  it("redacts meta on logger.debug before transport write", (done) => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });

    const testLogger = winston.createLogger({
      level: "debug",
      format: winston.format.combine(redactFormat(), winston.format.json()),
      transports: [new winston.transports.Stream({ stream })],
    });

    testLogger.debug("failed", { passcode: "my-secret", amount: 10 });

    setImmediate(() => {
      expect(chunks).toHaveLength(1);
      const parsed = JSON.parse(chunks[0]);
      expect(parsed.message).toBe("failed");
      expect(parsed.passcode).toBe("[REDACTED]");
      expect(parsed.amount).toBe(10);
      expect(chunks[0]).not.toContain("my-secret");
      done();
    });
  });
});

describe("logFinancialEvent key-based redaction (#789)", () => {
  it("redacts sensitive keys in financial event payloads via redactLogValue", () => {
    // Capture what gets logged
    const logged: unknown[] = [];
    const originalInfo = console.info;
    // We spy on the underlying redactLogValue behaviour rather than console;
    // the easiest way is to verify redactLogValue directly with a financial-like object.
    const payload = {
      event: "payment",
      amount: "100.00",
      currency: "NGN",
      userId: "user-1",
      accountId: "acc-1",
      idempotencyKey: "key-1",
      transactionId: "tx-1",
      status: "success",
      correlationId: "corr-1",
      // sensitive field that should be redacted
      authorization: "Bearer secret-token",
    };

    const redacted = redactLogValue(payload) as Record<string, unknown>;

    expect(redacted["authorization"]).toBe("[REDACTED]");
    // non-sensitive fields are preserved
    expect(redacted["userId"]).toBe("user-1");
    expect(redacted["amount"]).toBe("100.00");

    void logged; void originalInfo;
  });
});
