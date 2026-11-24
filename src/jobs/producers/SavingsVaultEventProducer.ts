import { BaseProducer } from "./BaseProducer";
import { QUEUES } from "../../config/rabbitmq";
import type { SavingsVaultEvent } from "../../types/rabbitmq-schemas";

export class SavingsVaultEventProducer extends BaseProducer<SavingsVaultEvent> {
  protected queue = QUEUES.ACBU_SAVINGS_VAULT_EVENTS;
}

export const savingsVaultEventProducer = new SavingsVaultEventProducer();
