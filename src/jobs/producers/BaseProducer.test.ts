import { BaseProducer } from "./BaseProducer";
import { auditLogProducer } from "./AuditLogProducer";
import { MessageValidationError } from "../../utils/rabbitmq-validation";
import * as rabbitmq from "../../config/rabbitmq";

jest.mock("../../config/rabbitmq", () => ({
  getRabbitMQChannel: jest.fn(() => ({ sendToQueue: jest.fn() })),
  assertQueueWithDLQ: jest.fn(async () => undefined),
  QUEUES: { AUDIT_LOGS: "audit_logs" },
}));

describe("BaseProducer (producer-boundary validation)", () => {
  beforeEach(() => {
    (rabbitmq.getRabbitMQChannel as jest.Mock).mockClear();
    (rabbitmq.assertQueueWithDLQ as jest.Mock).mockClear();
  });

  it("enqueues a valid payload after schema validation", async () => {
    await auditLogProducer.publish({ eventType: "login", action: "create" });

    expect(rabbitmq.getRabbitMQChannel).toHaveBeenCalled();
    const channel = (rabbitmq.getRabbitMQChannel as jest.Mock).mock.results[0].value;
    expect(channel.sendToQueue).toHaveBeenCalledTimes(1);
    expect(channel.sendToQueue.mock.calls[0][0]).toBe("audit_logs");
  });

  it("rejects a tampered payload (wrong field type) BEFORE enqueue", async () => {
    await expect(
      auditLogProducer.publish({ eventType: 123, action: "create" } as never),
    ).rejects.toBeInstanceOf(MessageValidationError);

    expect(rabbitmq.getRabbitMQChannel).not.toHaveBeenCalled();
  });

  it("rejects a payload missing required fields BEFORE enqueue", async () => {
    await expect(auditLogProducer.publish({ eventType: "login" } as never)).rejects.toBeInstanceOf(
      MessageValidationError,
    );

    expect(rabbitmq.getRabbitMQChannel).not.toHaveBeenCalled();
  });

  it("enforces validation even if a subclass bypasses validate()", async () => {
    class BypassProducer extends BaseProducer<Record<string, unknown>> {
      protected queue = "audit_logs";
      // Intentionally does NOT validate — the base boundary must still reject.
      protected validate(payload: Record<string, unknown>) {
        return payload;
      }
    }

    const bypass = new BypassProducer();
    await expect(bypass.publish({ eventType: 123 })).rejects.toBeInstanceOf(MessageValidationError);

    expect(rabbitmq.getRabbitMQChannel).not.toHaveBeenCalled();
  });
});
