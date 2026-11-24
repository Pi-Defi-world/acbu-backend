import { BaseProducer } from "./BaseProducer";
import { QUEUES } from "../../config/rabbitmq";
import type { LendingPoolEvent } from "../../types/rabbitmq-schemas";

export class LendingPoolEventProducer extends BaseProducer<LendingPoolEvent> {
  protected queue = QUEUES.ACBU_LENDING_POOL_EVENTS;
}

export const lendingPoolEventProducer = new LendingPoolEventProducer();
