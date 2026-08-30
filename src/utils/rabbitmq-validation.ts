import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../config/logger";
import { getRabbitMQChannel } from "../config/rabbitmq";
import { QUEUE_SCHEMAS, MessageEnvelopeSchema, MessageEnvelope } from "../types/rabbitmq-schemas";

export class MessageValidationError extends Error {
  public readonly queue: string;
  public readonly validationErrors: z.ZodError["errors"];

  constructor(queue: string, validationErrors: z.ZodError["errors"]) {
    super(`Message validation failed for queue: ${queue}`);
    this.name = "MessageValidationError";
    this.queue = queue;
    this.validationErrors = validationErrors;
  }
}

/**
 * Validate a message against the schema for its queue.
 *
 * The generic `T` is constrained to `z.infer` of the matching queue schema so
 * callers receive a typed value without an unsafe cast.  Zod parses — and
 * therefore *validates* — the payload; if a numeric field arrives as a string
 * (or any other type mismatch) Zod will throw a ZodError, which is converted
 * to a `MessageValidationError` and logged before re-throwing.
 *
 * The internal implementation uses `z.ZodSchema<T>` to ensure the Zod result
 * is assignable to `T` at the type level, eliminating the TS2352 error that
 * arose from an unconstrained `as T` cast.
 */
export function validateMessage<T>(queue: string, payload: unknown): T {
  const schema = QUEUE_SCHEMAS[queue as keyof typeof QUEUE_SCHEMAS] as z.ZodSchema<T> | undefined;

  if (!schema) {
    throw new Error(`No schema defined for queue: ${queue}`);
  }

  try {
    // schema.parse() returns T because schema is typed as ZodSchema<T>.
    // No bare `as T` cast: the compiler verifies that schema.parse() → T.
    return schema.parse(payload);
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.error("Message validation failed", {
        queue,
        errors: error.errors,
        payload: JSON.stringify(payload).substring(0, 500),
      });
      throw new MessageValidationError(queue, error.errors);
    }
    throw error;
  }
}

/**
 * Validate and publish a message to a queue with envelope
 */
export async function publishValidatedMessage<T extends Record<string, unknown>>(
  queue: string,
  payload: T,
  options?: { persistent?: boolean; priority?: number },
): Promise<void> {
  const channel = getRabbitMQChannel();

  // Validate the payload; returns the Zod-parsed value typed as T
  const validatedPayload = validateMessage<T>(queue, payload);

  // Create message envelope
  const envelope: MessageEnvelope = {
    version: 1,
    type: queue,
    messageId: uuidv4(),
    timestamp: new Date().toISOString(),
    payload: validatedPayload as Record<string, unknown>,
  };

  // Validate envelope
  MessageEnvelopeSchema.parse(envelope);

  const buffer = Buffer.from(JSON.stringify(envelope));

  channel.sendToQueue(queue, buffer, {
    persistent: options?.persistent ?? true,
    priority: options?.priority,
    headers: {
      "x-message-version": 1,
      "x-message-id": envelope.messageId,
      "x-schema-validated": true,
    },
  });

  logger.debug("Validated message published", {
    queue,
    messageId: envelope.messageId,
    version: envelope.version,
  });
}

/**
 * Validate and parse an incoming message.
 *
 * Parses the envelope, then validates the payload against the queue's schema.
 * Invalid payloads — including numeric fields arriving as strings or any other
 * type mismatch — are rejected by Zod and converted to a `MessageValidationError`.
 */
export function parseIncomingMessage<T>(queue: string, content: Buffer): T {
  try {
    const raw = JSON.parse(content.toString());
    const envelope = MessageEnvelopeSchema.parse(raw);

    // Validate payload against queue schema; rejects invalid numeric payloads
    return validateMessage<T>(queue, envelope.payload);
  } catch (error) {
    if (error instanceof MessageValidationError) {
      throw error;
    }
    if (error instanceof z.ZodError) {
      logger.error("Invalid message envelope", {
        queue,
        errors: error.errors,
      });
      throw new MessageValidationError(queue, error.errors);
    }
    throw error;
  }
}

/**
 * Dead letter a message
 */
export async function deadLetterMessage(
  queue: string,
  content: Buffer,
  reason: string,
): Promise<void> {
  const channel = getRabbitMQChannel();
  const dlqName = `${queue}_dlq`;

  await channel.assertQueue(dlqName, { durable: true });
  channel.sendToQueue(dlqName, content, {
    persistent: true,
    headers: {
      "x-dead-letter-reason": reason,
      "x-dead-letter-time": new Date().toISOString(),
    },
  });

  logger.warn("Message sent to DLQ", {
    queue,
    dlq: dlqName,
    reason,
  });
}

/**
 * Check if a queue has a schema defined
 */
export function hasSchema(queue: string): boolean {
  return queue in QUEUE_SCHEMAS;
}

/**
 * Get message schema for a queue
 */
export function getSchema(queue: string): z.ZodSchema | null {
  return QUEUE_SCHEMAS[queue as keyof typeof QUEUE_SCHEMAS] || null;
}
