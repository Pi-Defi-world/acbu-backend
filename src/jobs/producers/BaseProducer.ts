import { assertQueueWithDLQ } from "../../config/rabbitmq";
import { logger } from "../../config/logger";
import { publishValidatedMessage, validateMessage } from "../../utils/rabbitmq-validation";

export abstract class BaseProducer<T> {
  protected abstract queue: string;

  /**
   * Optional subclass hook for additional, schema-specific checks or transforms.
   * NOTE: schema validation at the producer boundary is ALWAYS performed by
   * `publish()` below and can never be skipped by omitting this method.
   */
  protected validate?(payload: T): T | Promise<T>;

  async publish(payload: T, options?: { persistent?: boolean; priority?: number }): Promise<void> {
    try {
      // Ensure queue exists with DLQ
      await assertQueueWithDLQ(this.queue);

      // Producer-boundary validation: reject malformed or tampered payloads
      // BEFORE they are enqueued. This guarantees the validation schemas in
      // rabbitmq-schemas.ts are always honored, regardless of subclass behaviour.
      const schemaValidated = validateMessage<T>(this.queue, payload);

      // Optional subclass-specific post-schema checks/transforms.
      const finalPayload = this.validate ? await this.validate(schemaValidated) : schemaValidated;

      await publishValidatedMessage(this.queue, finalPayload, options);

      logger.debug("Message published successfully", {
        queue: this.queue,
        payload: finalPayload,
      });
    } catch (error) {
      logger.error("Failed to publish message", {
        queue: this.queue,
        error: error instanceof Error ? error.message : String(error),
        payload,
      });
      throw error;
    }
  }
}
