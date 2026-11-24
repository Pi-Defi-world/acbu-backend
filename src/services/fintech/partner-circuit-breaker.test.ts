import { readFileSync } from "node:fs";
import { join } from "node:path";

const clients = ["flutterwave", "mtn-momo", "paystack"].map((name) =>
  readFileSync(join(__dirname, `../${name}/client.ts`), "utf8"),
);

describe("fintech partner resilience", () => {
  it("keeps each external partner behind its own circuit breaker", () => {
    for (const source of clients) {
      expect(source).toContain('import { CircuitBreaker } from "../../utils/circuitBreaker"');
      expect(source).toContain("private breaker: CircuitBreaker");
      expect(source).toContain("this.breaker.canExecute()");
      expect(source).toContain("this.breaker.recordFailure()");
    }
  });
});
