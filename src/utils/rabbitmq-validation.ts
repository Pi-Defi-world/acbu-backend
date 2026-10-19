import { randomUUID } from "node:crypto";
import { z } from "zod";
import { logger } from "../config/logger";
import { getRabbitMQChannel } from "../config/rabbitmq";
import { QUEUE_SCHEMAS, MessageEnvelopeSchema, MessageEnvelope } from "../types/rabbitmq-schemas";

/** Queue names that have a registered payload schema. */
export type QueueSchemaName = keyof typeof QUEUE_SCHEMAS;

/**
 * Payload type for a queue, derived from the schema registry.
 *
 * This is the single source of truth for "what does this queue carry": the type
 * is *computed* from `QUEUE_SCHEMAS` instead of being asserted by the caller.
 */
export type QueuePayload<Q extends QueueSchemaName> = z.infer<(typeof QUEUE_SCHEMAS)[Q]>;

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

/** Queue names that have a payload schema registered in `QUEUE_SCHEMAS`. */
export type QueueName = keyof typeof QUEUE_SCHEMAS;

/** Payload type of a queue, derived from the schema registered for it. */
export type QueuePayload<Q extends QueueName> = z.infer<(typeof QUEUE_SCHEMAS)[Q]>;

/**
 * Validate a payload against the schema registered for a queue.
 *
 * The payload type is inferred from the queue name (`QueuePayload<Q>`), so the
 * compiler — not a caller-supplied type argument — decides what comes out:
 *
 * ```ts
 * const notification = validateMessage(QUEUES.NOTIFICATIONS, raw); // Notification
 * ```
 */
export function validateMessage<Q extends QueueSchemaName>(queue: Q, payload: unknown): QueuePayload<Q>;
/**
 * Validate a payload when the queue name is only known at runtime (e.g. a
 * producer holding `protected queue: string`). Callers must supply the expected
 * payload type and are responsible for it being the type the queue schema
 * produces; prefer the queue-name overload above wherever the literal queue
 * constant is available.
 */
export function validateMessage<T>(queue: string, payload: unknown): T;
export function validateMessage<T>(queue: string, payload: unknown): T {
  if (!(queue in QUEUE_SCHEMAS)) {
    throw new Error(`No schema defined for queue: ${queue}`);
  }

  try {
    // The registry is keyed by runtime queue names, so this lookup cannot be
    // statically tied to T; the double assertion is confined to this one place
    // and only the compatibility overload can reach it.
    const schema = QUEUE_SCHEMAS[queue as QueueSchemaName] as unknown as
      | z.ZodSchema<T>
      | undefined;
    if (!schema) {
      throw new Error(`No schema defined for queue: ${queue}`);
    }
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
 * Validate a payload against the schema registered for `queue`.
 *
 * The queue name determines the returned type, so — unlike `validateMessage`,
 * where the caller supplies `T` and the schema is trusted to produce it — a
 * payload that does not belong to the queue (or a queue that has no schema) is
 * rejected by the compiler. `safeParse` returns an already-typed value, so no
 * `as` cast is involved at any point.
 */
export function validateQueueMessage<Q extends QueueName>(
  queue: Q,
  payload: unknown,
): QueuePayload<Q> {
  const schema = QUEUE_SCHEMAS[queue];

  const result = schema.safeParse(payload);
  if (!result.success) {
    logger.error("Message validation failed", {
      queue,
      errors: result.error.errors,
      payload: JSON.stringify(payload).substring(0, 500),
    });
    throw new MessageValidationError(queue, result.error.errors);
  }

  return result.data;
}

/**
 * Validate and parse an incoming message.
 *
 * Parses the envelope, then validates the payload against the queue's schema,
 * with the queue name determining the type of the returned payload (see
 * `validateQueueMessage`). Invalid payloads — including numeric fields arriving
 * as strings or any other type mismatch — are rejected by Zod and converted to
 * a `MessageValidationError`.
 */
export function parseQueueMessage<Q extends QueueName>(queue: Q, content: Buffer): QueuePayload<Q> {
  try {
    const raw: unknown = JSON.parse(content.toString());
    const envelope = MessageEnvelopeSchema.parse(raw);

    return validateQueueMessage(queue, envelope.payload);
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
    messageId: randomUUID(),
    timestamp: new Date().toISOString(),
    payload: validatedPayload,
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
 *
 * The return type is derived from the queue constant, so consumers cannot
 * *assert* the wrong payload type by passing a mismatched explicit type
 * argument — the previous `parseIncomingMessage<WithdrawalStatus>(QUEUES.OTP_SEND, …)`
 * footgun is now a compile error:
 *
 * ```ts
 * const payload = parseIncomingMessage(QUEUES.OTP_SEND, msg.content); // OtpSend
 * ```
 */
export function parseIncomingMessage<Q extends QueueSchemaName>(
  queue: Q,
  content: Buffer,
): QueuePayload<Q> {
  try {
    const raw: unknown = JSON.parse(content.toString());
    const envelope = MessageEnvelopeSchema.parse(raw);

    // Validate payload against queue schema; rejects invalid numeric payloads
    return validateMessage(queue, envelope.payload);
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
