import { connectRabbitMQ, QUEUES } from "../../config/rabbitmq";
import { logger } from "../../config/logger";
import { stellarClient } from "./client";

export interface ContractEvent {
  contractId: string;
  type: string;
  data: Record<string, unknown>;
  ledger: number;
  timestamp: number;
}

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

const FETCH_ATTEMPTS = 3;
const HANDLER_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;
const ACTIVE_POLL_DELAY_MS = 250;
const IDLE_POLL_DELAY_MS = 1000;
const IDLE_WITHOUT_SUBSCRIPTIONS_DELAY_MS = 2000;

export class EventListener {
  private server: ReturnType<typeof stellarClient.getServer>;
  private eventHandlers: Map<string, EventHandler[]> = new Map();
  private registeredContractIds: Set<string> = new Set();
  private contractCursors: Map<string, string | null> = new Map();
  private isListening = false;
  private defaultCursor: string | null = null;

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
  async dispatchRawEffect(
    registeredContractId: string,
    effect: RawContractEffect,
  ): Promise<void> {
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

  /**
   * Listen for specific contract events (MintEvent, BurnEvent, etc.).
   */
  listenToContractEvents(
    contractId: string,
    eventTypes: string[],
    handler: EventHandler,
  ): void {
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
        if (
          options?.toLedger !== undefined &&
          parsed.ledger > options.toLedger
        ) {
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
        await this.sleep(
          processedAny ? ACTIVE_POLL_DELAY_MS : IDLE_POLL_DELAY_MS,
        );
      } catch (error) {
        logger.error("Error listening for events", {
          error: error instanceof Error ? error.message : String(error),
        });
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
          const builder = this.getEffectsApi()
            .forContract(contractId)
            .order("asc")
            .limit(200);
          const cursor =
            this.contractCursors.get(contractId) ?? this.defaultCursor;
          if (cursor) {
            builder.cursor(cursor);
          }
          return builder.call();
        },
      });

      for (const effect of effects.records) {
        await this.dispatchRawEffect(contractId, effect);
        this.updateCursor(contractId, effect);
      }

      return effects.records.length > 0;
    } catch (error) {
      logger.error("Failed to poll contract effects", {
        contractId,
        cursor: this.contractCursors.get(contractId) ?? this.defaultCursor,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  private parseEffect(
    registeredContractId: string,
    effect: RawContractEffect,
  ): ContractEvent {
    if (!effect || typeof effect !== "object") {
      throw new Error("Effect payload must be an object");
    }

    const type =
      typeof effect.type === "string" && effect.type.trim().length > 0
        ? effect.type
        : null;
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
      typeof effect.created_at === "string"
        ? new Date(effect.created_at).getTime()
        : Number.NaN;
    const timestamp = Number.isFinite(parsedTimestamp)
      ? parsedTimestamp
      : Date.now();

    return {
      contractId,
      type,
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

  private async invokeHandlerWithRetry(
    handler: EventHandler,
    event: ContractEvent,
  ): Promise<void> {
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
    reason: "parse_failure" | "handler_failure",
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
        error:
          captureError instanceof Error
            ? captureError.message
            : String(captureError),
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
