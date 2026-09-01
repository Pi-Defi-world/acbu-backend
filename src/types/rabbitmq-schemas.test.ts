import { QUEUES } from "../config/rabbitmq";
import { QUEUE_RETRY_LIMITS } from "../jobs/queueConfig";
import { QUEUE_SCHEMAS } from "./rabbitmq-schemas";

describe("RabbitMQ queue registry", () => {
  it("keeps queue constants, schemas, and retry config in sync", () => {
    const schemaKeys = Object.keys(QUEUE_SCHEMAS);
    const retryKeys = Object.keys(QUEUE_RETRY_LIMITS);
    const queueKeys = Object.values(QUEUES);
    const runtimeQueueKeys = queueKeys.filter((queueName) => !queueName.endsWith("_dlq"));

    expect(new Set(schemaKeys)).toEqual(new Set(runtimeQueueKeys));
    expect(new Set(retryKeys)).toEqual(new Set(runtimeQueueKeys));
  });
});
