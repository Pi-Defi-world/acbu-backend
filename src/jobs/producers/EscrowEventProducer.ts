import { BaseProducer } from "./BaseProducer";
import { QUEUES } from "../../config/rabbitmq";
import type { EscrowEvent } from "../../types/rabbitmq-schemas";

export class EscrowEventProducer extends BaseProducer<EscrowEvent> {
  protected queue = QUEUES.ACBU_ESCROW_EVENTS;
}

export const escrowEventProducer = new EscrowEventProducer();
