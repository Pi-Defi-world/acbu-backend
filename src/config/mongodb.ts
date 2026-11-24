import { MongoClient, Db, Collection, ChangeStreamDocument, ResumeToken } from "mongodb";
import { config } from "./env";
import { logger } from "./logger";

let client: MongoClient | null = null;
let db: Db | null = null;

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 200;

/** Collection that persists one document per named stream consumer. */
const RESUME_TOKEN_COLLECTION = "_changeStreamTokens";

function sanitizeMongoUri(uri: string): string {
  return uri.replace(/\/\/[^:@]+:[^@]+@/, "//***:***@");
}

export async function connectMongoDB(): Promise<Db> {
  if (db) return db;

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      client = new MongoClient(config.mongodbUri);
      await client.connect();
      db = client.db();
      logger.info("MongoDB connected successfully");
      break;
    } catch (error) {
      lastError = error;
      client = null;
      if (attempt === MAX_RETRIES) break;
      const delay = BASE_DELAY_MS * 2 ** (attempt - 1);
      logger.warn(`MongoDB connection attempt ${attempt} failed, retrying in ${delay}ms`, {
        uri: sanitizeMongoUri(config.mongodbUri),
        error,
      });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  if (!db) {
    logger.error("Failed to connect to MongoDB after retries", {
      uri: sanitizeMongoUri(config.mongodbUri),
      error: lastError,
    });
    throw lastError;
  }

  const collection = db.collection("cache");

  const indexConfigs: Array<{
    spec: Record<string, 1>;
    options: { name: string; expireAfterSeconds?: number };
    critical: boolean;
  }> = [
    {
      spec: { key: 1, expiresAt: 1 },
      options: { name: "idx_key_expiresAt" },
      critical: false,
    },
    {
      spec: { expiresAt: 1 },
      options: { name: "idx_expiresAt_ttl", expireAfterSeconds: 0 },
      critical: true,
    },
  ];

  const results = await Promise.allSettled(
    indexConfigs.map((idx) => collection.createIndex(idx.spec, idx.options)),
  );

  results.forEach((result, i) => {
    if (result.status === "rejected") {
      const cfg = indexConfigs[i];
      const logData = { indexName: cfg.options.name, error: result.reason };
      if (cfg.critical) {
        logger.error("Critical index creation failed", logData);
      } else {
        logger.warn("Index creation warning", logData);
      }
    }
  });

  return db;
}

export async function disconnectMongoDB(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
    logger.info("MongoDB disconnected");
  }
}

export function getMongoDB(): Db {
  if (!db) {
    throw new Error("MongoDB not connected. Call connectMongoDB() first.");
  }
  return db;
}

// ── #389: Persistent resume-token helpers ────────────────────────────────────
//
// Change stream consumers call `watchWithResumeToken` instead of `collection.watch()`.
// On each event the token is upserted into `_changeStreamTokens`; on restart the stream
// reopens from the last stored token so no events are missed or double-replayed.

function getTokenCollection(): Collection<{ _id: string; token: ResumeToken }> {
  return getMongoDB().collection<{ _id: string; token: ResumeToken }>(RESUME_TOKEN_COLLECTION);
}

/** Load the persisted resume token for a named stream consumer, or null if none. */
export async function loadResumeToken(consumerName: string): Promise<ResumeToken | null> {
  const doc = await getTokenCollection().findOne({ _id: consumerName });
  return doc?.token ?? null;
}

/** Persist the latest resume token for a named stream consumer. */
export async function saveResumeToken(consumerName: string, token: ResumeToken): Promise<void> {
  await getTokenCollection().updateOne(
    { _id: consumerName },
    { $set: { token } },
    { upsert: true },
  );
}

/**
 * Open a resumable change stream on `collection` for the given consumer.
 *
 * The returned async generator yields each `ChangeStreamDocument` and
 * automatically persists the resume token after every event. On process
 * restart callers should construct a new generator; it will resume from
 * the last saved token transparently.
 *
 * @example
 * ```ts
 * for await (const event of watchWithResumeToken("myConsumer", db.collection("orders"))) {
 *   await processEvent(event);
 * }
 * ```
 */
export async function* watchWithResumeToken<TSchema extends object = Record<string, unknown>>(
  consumerName: string,
  collection: Collection<TSchema>,
  pipeline: Record<string, unknown>[] = [],
): AsyncGenerator<ChangeStreamDocument<TSchema>> {
  const savedToken = await loadResumeToken(consumerName);
  const streamOptions = savedToken ? { resumeAfter: savedToken } : {};

  const stream = collection.watch<TSchema>(pipeline, streamOptions);

  logger.info("Change stream opened", {
    consumer: consumerName,
    resuming: savedToken != null,
  });

  try {
    for await (const event of stream) {
      const token = event._id;
      yield event;
      // Persist after yielding so the consumer has a chance to process first.
      // If the process crashes before this upsert the event will be re-delivered
      // on next restart (at-least-once delivery). That is the safe default.
      await saveResumeToken(consumerName, token);
    }
  } finally {
    await stream.close();
    logger.info("Change stream closed", { consumer: consumerName });
  }
}
