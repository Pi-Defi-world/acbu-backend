import { logger } from "../config/logger";

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  failureThreshold: number;
  cooldownMs: number;
  successThreshold: number;
}

const DEFAULT_OPTIONS: CircuitBreakerOptions = {
  failureThreshold: 5,
  cooldownMs: 60_000, // 60 seconds
  successThreshold: 2,
};

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime: number | null = null;
  private options: CircuitBreakerOptions;

  constructor(options?: Partial<CircuitBreakerOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Check if the circuit allows execution
   * Returns true if CLOSED or HALF_OPEN (after cooldown)
   */
  canExecute(): boolean {
    if (this.state === "CLOSED") {
      return true;
    }

    if (this.state === "OPEN") {
      const now = Date.now();
      if (
        this.lastFailureTime &&
        now - this.lastFailureTime >= this.options.cooldownMs
      ) {
        this.transitionTo("HALF_OPEN");
        return true;
      }
      return false;
    }

    // HALF_OPEN - allow one test request
    return true;
  }

  /**
   * Record a successful operation
   */
  recordSuccess(): void {
    if (this.state === "HALF_OPEN") {
      this.successCount++;
      if (this.successCount >= this.options.successThreshold) {
        this.transitionTo("CLOSED");
      }
    } else if (this.state === "CLOSED") {
      // Reset failure count on success in closed state
      this.failureCount = 0;
    }
  }

  /**
   * Record a failed operation
   */
  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === "HALF_OPEN") {
      // Any failure in half-open immediately opens circuit
      this.transitionTo("OPEN");
    } else if (
      this.state === "CLOSED" &&
      this.failureCount >= this.options.failureThreshold
    ) {
      this.transitionTo("OPEN");
    }
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    // Check if we should transition from OPEN to HALF_OPEN
    if (this.state === "OPEN" && this.lastFailureTime) {
      const now = Date.now();
      if (now - this.lastFailureTime >= this.options.cooldownMs) {
        this.transitionTo("HALF_OPEN");
      }
    }
    return this.state;
  }

  /**
   * Manually reset the circuit breaker (useful for testing)
   */
  reset(): void {
    this.transitionTo("CLOSED");
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
  }

  /**
   * Get metrics for observability
   */
  getMetrics(): {
    state: CircuitState;
    failureCount: number;
    successCount: number;
    lastFailureTime: number | null;
  } {
    return {
      state: this.getState(),
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
    };
  }

  private transitionTo(newState: CircuitState): void {
    if (this.state !== newState) {
      const oldState = this.state;
      this.state = newState;

      logger.info("Circuit breaker state transition", {
        from: oldState,
        to: newState,
        failureCount: this.failureCount,
        successCount: this.successCount,
      });

      // Reset counters on state transitions
      if (newState === "CLOSED") {
        this.failureCount = 0;
        this.successCount = 0;
      } else if (newState === "HALF_OPEN") {
        this.successCount = 0;
      }
    }
  }
}

// Export singleton instance for rate limiter use
export const circuitBreaker = new CircuitBreaker();
