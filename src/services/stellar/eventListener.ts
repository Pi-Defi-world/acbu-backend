import { connectRabbitMQ, QUEUES } from "../../config/rabbitmq";
import { logger } from "../../config/logger";
import { stellarClient } from "./client";

export interface ContractEvent {
  contractId: string;
  type: string;
  version: number;
  data: Record<string, unknown>;
  ledger: number;
  timestamp: number;
}

export const CONTRACT_EVENT_PAYLOAD_VERSION = 1;

export type EventHandler = (event: ContractEvent) => Promise<void>;

interface RawContractEffect {
  contract?: unknown;
  type?: unknown;
  ledger?: unknown;
  created_at?: unknown;
  paging_token?: unknown;
  pagingToken?: (() => string) | unknown;
  [key: string]: unknown;
}

interface ContractEffectsBuilder {
  order(value: "asc" | "desc"): ContractEffectsBuilder;
  limit(value: number): ContractEffectsBuilder;
  cursor(value: string): ContractEffectsBuilder;
  ledger?(value: number): ContractEffectsBuilder;
  call(): Promise<{ records: RawContractEffect[] }>;
}

interface ContractEffectsApi {
  forContract(contractId: string): ContractEffectsBuilder;
}

interface LedgerRecord {
  sequence?: unknown;
  hash?: unknown;
  prev_hash?: unknown;
}

interface LedgersApi {
  ledger(sequence: number): { call(): Promise<LedgerRecord> };
}

/** Confirmed ledger tracked per contract so reorgs/rollbacks can be detected. */
interface ConfirmedLedger {
  hash: string;
  /** Cursor to resume from to re-ingest this ledger's events. */
  cursorBefore: string | null;
}

class LedgerDiscontinuityError extends Error {
  constructor(
    message: string,
    readonly rewindToLedger: number,
  ) {
    super(message);
    this.name = "LedgerDiscontinuityError";
  }
}

const FETCH_ATTEMPTS = 3;
/** Number of most recent confirmed ledger hashes kept (and re-verified) per contract. */
const LEDGER_HASH_WINDOW = 50;
const LEDGER_REVERIFY_DEPTH = 5;
const HANDLER_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;
const ACTIVE_POLL_DELAY_MS = 250;
const IDLE_POLL_DELAY_MS = 1000;
const IDLE_WITHOUT_SUBSCRIPTIONS_DELAY_MS = 2000;
const RECONNECT_MAX_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY_MS = 2000;

export interface EventListenerHealthStatus {
  status: "up" | "down";
  lastHealthyAt: number | null;
  lastUnhealthyAt: number | null;
  lastError: string | null;
  reconnectAttemptsTotal: number;
  lastReconnectAttemptAt: number | null;
}

export const eventListenerHealth: EventListenerHealthStatus = {
  status: "down",
  lastHealthyAt: null,
  lastUnhealthyAt: null,
  lastError: null,
  reconnectAttemptsTotal: 0,
  lastReconnectAttemptAt: null,
};

export class EventListener {
  private server: ReturnType<typeof stellarClient.getServer>;
  private eventHandlers: Map<string, EventHandler[]> = new Map();
  private registeredContractIds: Set<string> = new Set();
  private contractCursors: Map<string, string | null> = new Map();
  private confirmedLedgers: Map<string, Map<number, ConfirmedLedger>> = new Map();
  private isListening = false;
  private isReconnecting = false;
  private defaultCursor: string | null = null;
  private healthStatus = eventListenerHealth;

  constructor() {
    this.server = stellarClient.getServer();
  }

  /**
   * Register an event handler for a specific event type.
   * Kept for backward compatibility; contract listeners register filtered wrappers here.
   */
  on(eventType: string, handler: EventHandler): void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, []);
    }
    this.eventHandlers.get(eventType)!.push(handler);
    logger.info("Event handler registered", { eventType });
  }

  /**
   * Remove an event handler.
   */
  off(eventType: string, handler: EventHandler): void {
    const handlers = this.eventHandlers.get(eventType);
    if (!handlers) return;

    const index = handlers.indexOf(handler);
    if (index === -1) return;

    handlers.splice(index, 1);
    logger.info("Event handler removed", { eventType });
  }

  /**
   * Start listening for contract-scoped Horizon effects.
   */
  async start(cursor?: string | Record<string, string>): Promise<void> {
    if (this.isListening) {
      logger.warn("EventListener is already listening");
      return;
    }

    this.isListening = true;
    if (typeof cursor === "string") {
      this.defaultCursor = cursor;
    } else if (cursor) {
      for (const [contractId, value] of Object.entries(cursor)) {
        this.contractCursors.set(contractId, value);
      }
    }

    logger.info("Starting event listener", {
      contractCount: this.registeredContractIds.size,
      hasDefaultCursor: Boolean(this.defaultCursor),
    });

    await this.listen();
  }

  /**
   * Stop listening for events.
   */
  stop(): void {
    this.isListening = false;
    logger.info("Stopped event listener");
  }

  /**
   * Poll each registered contract once.
   * Public so tests and replay tooling can inject a single polling cycle.
   */
  async pollOnce(): Promise<boolean> {
    const contractIds = [...this.registeredContractIds];
    if (contractIds.length === 0) {
      logger.debug("EventListener poll skipped: no registered contract IDs");
      return false;
    }

    let processedAny = false;
    for (const contractId of contractIds) {
      const processed = await this.pollContractOnce(contractId);
      processedAny = processedAny || processed;
    }

    return processedAny;
  }

  /**
   * Process a raw Horizon effect for a specific contract.
   * Public so tests and DLQ replay tools can verify projection delivery.
   */
  async dispatchRawEffect(registeredContractId: string, effect: RawContractEffect): Promise<void> {
    try {
      const event = this.parseEffect(registeredContractId, effect);
      await this.dispatchEvent(event);
    } catch (error) {
      await this.captureFailure("parse_failure", {
        registeredContractId,
        effect,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  getHealthStatus(): EventListenerHealthStatus {
    return { ...this.healthStatus };
  }

  private markHealthy(): void {
    if (this.healthStatus.status !== "up") {
      logger.info("Soroban event listener recovered", {
        lastError: this.healthStatus.lastError,
      });
    }

    this.healthStatus.status = "up";
    this.healthStatus.lastHealthyAt = Date.now();
    this.healthStatus.lastError = null;
  }

  private markUnhealthy(error: string): void {
    if (this.healthStatus.status !== "down") {
      logger.warn("Soroban event listener disconnected", { error });
    }

    this.healthStatus.status = "down";
    this.healthStatus.lastUnhealthyAt = Date.now();
    this.healthStatus.lastError = error;
  }

  private async reconnectServer(contractId?: string): Promise<void> {
    if (this.isReconnecting) {
      return;
    }

    this.isReconnecting = true;
    try {
      for (let attempt = 1; attempt <= RECONNECT_MAX_ATTEMPTS; attempt += 1) {
        this.healthStatus.lastReconnectAttemptAt = Date.now();
        this.healthStatus.reconnectAttemptsTotal += 1;

        try {
          this.server = stellarClient.getServer();

          if (contractId) {
            const cursor = this.contractCursors.get(contractId) ?? this.defaultCursor;
            const builder = this.getEffectsApi().forContract(contractId).order("asc").limit(1);

            if (cursor) {
              builder.cursor(cursor);
            }

            await builder.call();
          }

          this.markHealthy();
          return;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.warn("Soroban event listener reconnect attempt failed", {
            contractId,
            attempt,
            error: message,
          });
          this.markUnhealthy(message);

          if (attempt < RECONNECT_MAX_ATTEMPTS) {
            await this.sleep(RECONNECT_BASE_DELAY_MS * attempt);
          }
        }
      }
    } finally {
      this.isReconnecting = false;
    }
  }

  /**
   * Listen for specific contract events (MintEvent, BurnEvent, etc.).
   */
  listenToContractEvents(contractId: string, eventTypes: string[], handler: EventHandler): void {
    if (!contractId) {
      logger.warn("Skipping contract event registration: missing contractId");
      return;
    }

    this.registeredContractIds.add(contractId);
    if (!this.contractCursors.has(contractId)) {
      this.contractCursors.set(contractId, this.defaultCursor);
    }

    const contractHandler: EventHandler = async (event) => {
      if (event.contractId === contractId && eventTypes.includes(event.type)) {
        await handler(event);
      }
    };

    this.on("*", contractHandler);
  }

  /**
   * Get events for a specific contract.
   */
  async getContractEvents(
    contractId: string,
    options?: {
      fromLedger?: number;
      toLedger?: number;
      limit?: number;
    },
  ): Promise<ContractEvent[]> {
    try {
      const builder = this.getEffectsApi()
        .forContract(contractId)
        .order("asc")
        .limit(options?.limit ?? 200);

      if (options?.fromLedger && builder.ledger) {
        builder.ledger(options.fromLedger);
      }

      const effects = await builder.call();
      const events: ContractEvent[] = [];
      for (const effect of effects.records) {
        const parsed = this.parseEffect(contractId, effect);
        if (options?.toLedger !== undefined && parsed.ledger > options.toLedger) {
          continue;
        }
        events.push(parsed);
      }

      return events;
    } catch (error) {
      logger.error("Failed to get contract events", { contractId, error });
      throw error;
    }
  }

  private async listen(): Promise<void> {
    while (this.isListening) {
      try {
        const hasSubscriptions = this.registeredContractIds.size > 0;
        if (!hasSubscriptions) {
          await this.sleep(IDLE_WITHOUT_SUBSCRIPTIONS_DELAY_MS);
          continue;
        }

        const processedAny = await this.pollOnce();
        await this.sleep(processedAny ? ACTIVE_POLL_DELAY_MS : IDLE_POLL_DELAY_MS);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error("Error listening for events", { error: message });
        this.markUnhealthy(message);
        await this.reconnectServer();
        await this.sleep(IDLE_POLL_DELAY_MS);
      }
    }
  }

  private getEffectsApi(): ContractEffectsApi {
    return this.server.effects() as unknown as ContractEffectsApi;
  }

  private async pollContractOnce(contractId: string): Promise<boolean> {
    try {
      const effects = await this.withRetries({
        label: "stellar contract effects fetch",
        attempts: FETCH_ATTEMPTS,
        context: {
          contractId,
          cursor: this.contractCursors.get(contractId) ?? this.defaultCursor,
        },
        fn: async () => {
          const builder = this.getEffectsApi().forContract(contractId).order("asc").limit(200);
          const cursor = this.contractCursors.get(contractId) ?? this.defaultCursor;
          if (cursor) {
            builder.cursor(cursor);
          }
          return builder.call();
        },
      });

      this.markHealthy();

      if (effects.records.length === 0) {
        return false;
      }

      // Verify ledger continuity before committing this batch to the handlers.
      let ledgerHashes: Map<number, string>;
      try {
        ledgerHashes = await this.verifyLedgerContinuity(contractId, effects.records);
      } catch (error) {
        if (error instanceof LedgerDiscontinuityError) {
          await this.handleLedgerDiscontinuity(contractId, error);
          return false;
        }
        throw error;
      }

      for (const effect of effects.records) {
        const cursorBefore = this.contractCursors.get(contractId) ?? this.defaultCursor ?? null;
        await this.dispatchRawEffect(contractId, effect);
        this.updateCursor(contractId, effect);
        this.recordConfirmedLedger(contractId, effect, ledgerHashes, cursorBefore);
      }

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("Failed to poll contract effects", {
        contractId,
        cursor: this.contractCursors.get(contractId) ?? this.defaultCursor,
        error: message,
      });
      this.markUnhealthy(message);
      await this.reconnectServer(contractId);
      return false;
    }
  }

  private getLedgersApi(): LedgersApi {
    return this.server.ledgers() as unknown as LedgersApi;
  }

  private effectLedger(effect: RawContractEffect): number {
    const ledger =
      typeof effect.ledger === "number"
        ? effect.ledger
        : Number.parseInt(String(effect.ledger ?? "0"), 10);
    return Number.isFinite(ledger) ? ledger : 0;
  }

  private async fetchLedger(sequence: number): Promise<{ hash: string; prevHash: string }> {
    const record = await this.withRetries({
      label: "stellar ledger fetch",
      attempts: FETCH_ATTEMPTS,
      context: { ledger: sequence },
      fn: async () => this.getLedgersApi().ledger(sequence).call(),
    });

    if (typeof record.hash !== "string" || typeof record.prev_hash !== "string") {
      throw new Error(`Ledger ${sequence} response missing hash/prev_hash`);
    }
    return { hash: record.hash, prevHash: record.prev_hash };
  }

  /**
   * Verify that a batch of effects sits on the same chain we previously confirmed.
   * - Re-checks the hashes of the most recent confirmed ledgers (detects rollback/reorg).
   * - Rejects batches that go backwards behind already-confirmed ledgers.
   * - Checks each new ledger's prev_hash against the confirmed hash of the preceding ledger.
   * Returns the verified hash for each ledger in the batch.
   * Throws LedgerDiscontinuityError when the chain no longer matches.
   */
  private async verifyLedgerContinuity(
    contractId: string,
    records: RawContractEffect[],
  ): Promise<Map<number, string>> {
    const confirmed = this.confirmedLedgers.get(contractId) ?? new Map<number, ConfirmedLedger>();

    // 1. Re-verify the newest confirmed ledgers still match the network.
    const recent = [...confirmed.keys()].sort((a, b) => a - b).slice(-LEDGER_REVERIFY_DEPTH);
    for (const sequence of recent) {
      const current = await this.fetchLedger(sequence);
      if (current.hash !== confirmed.get(sequence)!.hash) {
        throw new LedgerDiscontinuityError(
          `Confirmed ledger ${sequence} hash changed (reorg detected)`,
          sequence,
        );
      }
    }

    // 2. Verify each new ledger in the batch.
    const maxConfirmed = confirmed.size > 0 ? Math.max(...confirmed.keys()) : 0;
    const sequences = [...new Set(records.map((r) => this.effectLedger(r)))]
      .filter((sequence) => sequence > 0)
      .sort((a, b) => a - b);
    const verified = new Map<number, string>();

    for (const sequence of sequences) {
      if (confirmed.has(sequence)) {
        // Same ledger resumed mid-way; already hash-checked above or confirmed.
        verified.set(sequence, confirmed.get(sequence)!.hash);
        continue;
      }
      if (sequence < maxConfirmed) {
        throw new LedgerDiscontinuityError(
          `Ledger ${sequence} is behind confirmed ledger ${maxConfirmed} (rollback)`,
          sequence,
        );
      }

      const { hash, prevHash } = await this.fetchLedger(sequence);
      const parentHash = verified.get(sequence - 1) ?? confirmed.get(sequence - 1)?.hash;
      if (parentHash && parentHash !== prevHash) {
        throw new LedgerDiscontinuityError(
          `Ledger ${sequence} prev_hash does not match confirmed ledger ${sequence - 1}`,
          sequence - 1,
        );
      }
      verified.set(sequence, hash);
    }

    return verified;
  }

  private recordConfirmedLedger(
    contractId: string,
    effect: RawContractEffect,
    ledgerHashes: Map<number, string>,
    cursorBefore: string | null,
  ): void {
    const sequence = this.effectLedger(effect);
    const hash = ledgerHashes.get(sequence);
    if (!hash) return;

    let confirmed = this.confirmedLedgers.get(contractId);
    if (!confirmed) {
      confirmed = new Map();
      this.confirmedLedgers.set(contractId, confirmed);
    }
    if (!confirmed.has(sequence)) {
      confirmed.set(sequence, { hash, cursorBefore });
    }

    if (confirmed.size > LEDGER_HASH_WINDOW) {
      const oldest = [...confirmed.keys()].sort((a, b) => a - b);
      for (const old of oldest.slice(0, confirmed.size - LEDGER_HASH_WINDOW)) {
        confirmed.delete(old);
      }
    }
  }

  /**
   * Rewind the contract cursor to before the divergent ledger and drop stale state,
   * so the canonical ledgers are re-ingested. Events already handed to handlers from
   * orphaned ledgers are reported to the DLQ for reconciliation.
   */
  private async handleLedgerDiscontinuity(
    contractId: string,
    error: LedgerDiscontinuityError,
  ): Promise<void> {
    const confirmed = this.confirmedLedgers.get(contractId) ?? new Map<number, ConfirmedLedger>();
    const affected = [...confirmed.keys()].filter((seq) => seq >= error.rewindToLedger);
    const earliest = affected.length > 0 ? Math.min(...affected) : null;

    logger.error("Ledger discontinuity detected, rewinding event cursor", {
      contractId,
      rewindToLedger: error.rewindToLedger,
      affectedLedgers: affected,
      error: error.message,
    });

    if (earliest !== null) {
      this.contractCursors.set(contractId, confirmed.get(earliest)!.cursorBefore);
    }
    for (const seq of affected) {
      confirmed.delete(seq);
    }

    await this.captureFailure("ledger_reorg", {
      contractId,
      rewindToLedger: error.rewindToLedger,
      affectedLedgers: affected,
      error: error.message,
    });
  }

  private parseEffect(registeredContractId: string, effect: RawContractEffect): ContractEvent {
    if (!effect || typeof effect !== "object") {
      throw new Error("Effect payload must be an object");
    }

    const type =
      typeof effect.type === "string" && effect.type.trim().length > 0 ? effect.type : null;
    if (!type) {
      throw new Error("Effect payload missing type");
    }

    const contractId =
      typeof effect.contract === "string" && effect.contract.trim().length > 0
        ? effect.contract
        : registeredContractId;
    if (!contractId) {
      throw new Error("Effect payload missing contract id");
    }

    const ledger =
      typeof effect.ledger === "number"
        ? effect.ledger
        : Number.parseInt(String(effect.ledger ?? "0"), 10);

    const parsedTimestamp =
      typeof effect.created_at === "string" ? new Date(effect.created_at).getTime() : Number.NaN;
    const timestamp = Number.isFinite(parsedTimestamp) ? parsedTimestamp : Date.now();

    return {
      contractId,
      type,
      version: CONTRACT_EVENT_PAYLOAD_VERSION,
      data: effect,
      ledger: Number.isFinite(ledger) ? ledger : 0,
      timestamp,
    };
  }

  private async dispatchEvent(event: ContractEvent): Promise<void> {
    const handlers = this.eventHandlers.get(event.type) || [];
    const wildcardHandlers = this.eventHandlers.get("*") || [];

    for (const handler of [...handlers, ...wildcardHandlers]) {
      await this.invokeHandlerWithRetry(handler, event);
    }
  }

  private async invokeHandlerWithRetry(handler: EventHandler, event: ContractEvent): Promise<void> {
    try {
      await this.withRetries({
        label: "stellar event handler",
        attempts: HANDLER_ATTEMPTS,
        context: {
          contractId: event.contractId,
          eventType: event.type,
          ledger: event.ledger,
        },
        fn: async () => handler(event),
      });
    } catch (error) {
      await this.captureFailure("handler_failure", {
        event,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async captureFailure(
    reason: "parse_failure" | "handler_failure" | "ledger_reorg",
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      const ch = await connectRabbitMQ();
      await ch.assertQueue(QUEUES.STELLAR_EVENT_FAILURES_DLQ, {
        durable: true,
      });
      ch.sendToQueue(
        QUEUES.STELLAR_EVENT_FAILURES_DLQ,
        Buffer.from(
          JSON.stringify({
            reason,
            capturedAt: new Date().toISOString(),
            ...payload,
          }),
        ),
        { persistent: true },
      );
    } catch (captureError) {
      logger.error("Failed to capture stellar event failure", {
        reason,
        payload,
        error: captureError instanceof Error ? captureError.message : String(captureError),
      });
    }
  }

  private updateCursor(contractId: string, effect: RawContractEffect): void {
    const cursor =
      typeof effect.paging_token === "string"
        ? effect.paging_token
        : typeof effect.pagingToken === "function"
          ? effect.pagingToken()
          : null;

    if (cursor) {
      this.contractCursors.set(contractId, cursor);
    }
  }

  private async withRetries<T>(params: {
    label: string;
    attempts: number;
    context: Record<string, unknown>;
    fn: () => Promise<T>;
  }): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= params.attempts; attempt++) {
      try {
        return await params.fn();
      } catch (error) {
        lastError = error;
        logger.warn(`${params.label} failed`, {
          ...params.context,
          attempt,
          attempts: params.attempts,
          error: error instanceof Error ? error.message : String(error),
        });
        if (attempt < params.attempts) {
          await this.sleep(RETRY_BASE_DELAY_MS * attempt);
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const eventListener = new EventListener();
