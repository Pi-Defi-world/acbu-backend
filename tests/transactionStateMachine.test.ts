process.env.DATABASE_URL = "postgresql://test:test@localhost/test";
process.env.MONGODB_URI = "mongodb://localhost/test";
process.env.RABBITMQ_URL = "amqp://localhost";
process.env.JWT_SECRET = "test-secret";

import {
  assertValidTransition,
  isTerminalStatus,
  TransactionStatus,
} from "../src/utils/transactionStateMachine";

describe("B-073 — Transaction status machine", () => {
  describe("assertValidTransition — valid transitions", () => {
    it("allows pending → processing", () => {
      expect(() => assertValidTransition("pending", "processing")).not.toThrow();
    });

    it("allows pending → failed", () => {
      expect(() => assertValidTransition("pending", "failed")).not.toThrow();
    });

    it("allows processing → completed", () => {
      expect(() =>
        assertValidTransition("processing", "completed"),
      ).not.toThrow();
    });

    it("allows processing → failed", () => {
      expect(() =>
        assertValidTransition("processing", "failed"),
      ).not.toThrow();
    });
  });

  describe("assertValidTransition — invalid transitions throw domain error", () => {
    it("rejects pending → completed (skips processing)", () => {
      expect(() => assertValidTransition("pending", "completed")).toThrow();
    });

    it("rejects completed → pending (reversal not allowed)", () => {
      expect(() => assertValidTransition("completed", "pending")).toThrow();
    });

    it("rejects completed → processing (re-open not allowed)", () => {
      expect(() => assertValidTransition("completed", "processing")).toThrow();
    });

    it("rejects completed → failed (terminal state)", () => {
      expect(() => assertValidTransition("completed", "failed")).toThrow();
    });

    it("rejects failed → pending (reversal not allowed)", () => {
      expect(() => assertValidTransition("failed", "pending")).toThrow();
    });

    it("rejects failed → processing (reversal not allowed)", () => {
      expect(() => assertValidTransition("failed", "processing")).toThrow();
    });

    it("rejects failed → completed (terminal state)", () => {
      expect(() => assertValidTransition("failed", "completed")).toThrow();
    });

    it("rejects processing → pending (reversal not allowed)", () => {
      expect(() => assertValidTransition("processing", "pending")).toThrow();
    });

    it("throws AppError with status 409 for illegal transition", () => {
      try {
        assertValidTransition("completed", "pending");
        fail("Expected error was not thrown");
      } catch (err: unknown) {
        expect(err).toHaveProperty("statusCode", 409);
        expect((err as Error).message).toMatch(/invalid.*transition/i);
      }
    });

    it("throws AppError with status 422 for unknown source status", () => {
      try {
        assertValidTransition(
          "unknown" as TransactionStatus,
          "completed" as TransactionStatus,
        );
        fail("Expected error was not thrown");
      } catch (err: unknown) {
        expect(err).toHaveProperty("statusCode", 422);
      }
    });
  });

  describe("isTerminalStatus", () => {
    it("marks completed as terminal", () => {
      expect(isTerminalStatus("completed")).toBe(true);
    });

    it("marks failed as terminal", () => {
      expect(isTerminalStatus("failed")).toBe(true);
    });

    it("marks pending as non-terminal", () => {
      expect(isTerminalStatus("pending")).toBe(false);
    });

    it("marks processing as non-terminal", () => {
      expect(isTerminalStatus("processing")).toBe(false);
    });
  });
});
