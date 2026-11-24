/**
 * W10-I-013: Tests for monitoring service
 */

import {
  recordQueueDepth,
  recordQueuePublish,
  recordQueueConsume,
  recordQueueError,
  recordCircuitBreakerState,
} from "./monitoringService";
import {
  rabbitmqQueueDepthGauge,
  rabbitmqQueuePublishCounter,
  rabbitmqQueueConsumeCounter,
  rabbitmqQueueErrorCounter,
  stellarCircuitBreakerStateGauge,
} from "../../config/promMetrics";

// Mock the prom-client metrics
jest.mock("../../config/promMetrics", () => ({
  reserveRatioGauge: { set: jest.fn() },
  reserveRatioBreachCounter: { inc: jest.fn() },
  rabbitmqQueueDepthGauge: { set: jest.fn() },
  rabbitmqQueuePublishCounter: { inc: jest.fn() },
  rabbitmqQueueConsumeCounter: { inc: jest.fn() },
  rabbitmqQueueErrorCounter: { inc: jest.fn() },
  stellarRpcDurationHistogram: { observe: jest.fn() },
  stellarRpcErrorCounter: { inc: jest.fn() },
  stellarCircuitBreakerStateGauge: { set: jest.fn() },
}));

describe("monitoringService (W10-I-013)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Queue metrics", () => {
    it("records queue depth", () => {
      recordQueueDepth("test_queue", 100);
      expect(rabbitmqQueueDepthGauge.set).toHaveBeenCalledWith(
        { queue_name: "test_queue" },
        100,
      );
    });

    it("records queue publish", () => {
      recordQueuePublish("test_queue");
      expect(rabbitmqQueuePublishCounter.inc).toHaveBeenCalledWith({
        queue_name: "test_queue",
      });
    });

    it("records queue consume", () => {
      recordQueueConsume("test_queue");
      expect(rabbitmqQueueConsumeCounter.inc).toHaveBeenCalledWith({
        queue_name: "test_queue",
      });
    });

    it("records queue error", () => {
      recordQueueError("test_queue", "processing_failed");
      expect(rabbitmqQueueErrorCounter.inc).toHaveBeenCalledWith({
        queue_name: "test_queue",
        error_type: "processing_failed",
      });
    });
  });

  describe("Circuit breaker metrics", () => {
    it("records circuit breaker state", () => {
      recordCircuitBreakerState("stellar_horizon", "closed");
      expect(stellarCircuitBreakerStateGauge.set).toHaveBeenCalledWith(
        { service: "stellar_horizon", network: "testnet" },
        0,
      );

      recordCircuitBreakerState("stellar_horizon", "open");
      expect(stellarCircuitBreakerStateGauge.set).toHaveBeenCalledWith(
        { service: "stellar_horizon", network: "testnet" },
        1,
      );

      recordCircuitBreakerState("stellar_horizon", "half-open");
      expect(stellarCircuitBreakerStateGauge.set).toHaveBeenCalledWith(
        { service: "stellar_horizon", network: "testnet" },
        2,
      );
    });
  });
});
