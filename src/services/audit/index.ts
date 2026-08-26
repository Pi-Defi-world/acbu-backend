import { logAudit } from "./auditService";

export { logAudit, type AuditEntry } from "./auditService";

export const auditService = {
  logAuditEntry: logAudit,
};
