import { BaseProducer } from "./BaseProducer";
import { QUEUES } from "../../config/rabbitmq";
import type { AuditLog } from "../../types/rabbitmq-schemas";

export class AuditLogProducer extends BaseProducer<AuditLog> {
  protected queue = QUEUES.AUDIT_LOGS;
}

export const auditLogProducer = new AuditLogProducer();
