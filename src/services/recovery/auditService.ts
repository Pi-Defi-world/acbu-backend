/**
 * Audit logging service for recovery actions
 * Provides comprehensive logging for security and compliance
 */
import { prisma } from "../../config/database";
import { logger } from "../../config/logger";

export interface AuditEvent {
  eventType:
    | "recovery_initiated"
    | "recovery_completed"
    | "recovery_failed"
    | "device_trusted"
    | "session_rotated";
  userId: string;
  identifier?: string;
  ip?: string;
  userAgent?: string;
  deviceId?: string;
  details?: Record<string, any>;
  risk: "low" | "medium" | "high";
}

/**
 * Log recovery-related audit events
 */
export async function auditRecoveryEvent(event: AuditEvent): Promise<void> {
  try {
    // Log to audit trail in database
    await prisma.auditTrail.create({
      data: {
        eventType: `recovery_${event.eventType}`,
        entityType: "User",
        entityId: event.userId,
        action: event.eventType,
        newValue: {
          identifier: event.identifier
            ? event.identifier.includes("@")
              ? "***@***"
              : event.identifier.slice(0, 6) + "***"
            : undefined,
          ip: event.ip,
          userAgent: event.userAgent,
          deviceId: event.deviceId,
          details: event.details,
          risk: event.risk,
          timestamp: new Date().toISOString(),
        },
        performedBy: event.userId,
      },
    });

    // Also log to application logger for immediate monitoring
    logger.warn("Recovery audit event", {
      eventType: event.eventType,
      userId: event.userId,
      hasIdentifier: !!event.identifier,
      hasIp: !!event.ip,
      risk: event.risk,
      details: event.details,
    });

    // For high-risk events, we might want to send alerts
    if (event.risk === "high") {
      await sendHighRiskAlert(event);
    }
  } catch (error) {
    logger.error("Failed to log audit event", { error, event });
  }
}

/**
 * Send alerts for high-risk recovery events
 */
async function sendHighRiskAlert(event: AuditEvent): Promise<void> {
  // This could integrate with a monitoring service, send emails, etc.
  // For now, we'll just log with high severity
  logger.error("HIGH RISK RECOVERY EVENT", {
    eventType: event.eventType,
    userId: event.userId,
    ip: event.ip,
    userAgent: event.userAgent,
    details: event.details,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Get recent audit events for a user
 */
export async function getUserRecoveryAuditHistory(
  userId: string,
  limit: number = 50,
): Promise<any[]> {
  return prisma.auditTrail.findMany({
    where: {
      entityType: "User",
      entityId: userId,
      eventType: { startsWith: "recovery_" },
    },
    orderBy: { timestamp: "desc" },
    take: limit,
  });
}

/**
 * Check for suspicious recovery patterns
 */
export async function detectSuspiciousPatterns(userId: string): Promise<{
  isSuspicious: boolean;
  reasons: string[];
}> {
  const now = new Date();
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const last1h = new Date(now.getTime() - 60 * 60 * 1000);

  const [recentAttempts, uniqueDevices, uniqueIps] = await Promise.all([
    // Count recovery attempts in last 24h
    prisma.auditTrail.count({
      where: {
        entityType: "User",
        entityId: userId,
        eventType: "recovery_initiated",
        timestamp: { gte: last24h },
      },
    }),
    // Count unique devices in last 24h
    prisma.auditTrail.findMany({
      where: {
        entityType: "User",
        entityId: userId,
        timestamp: { gte: last24h },
      },
      select: { newValue: true },
      distinct: ["newValue"],
    }),
    // Count unique IPs in last hour
    prisma.auditTrail.findMany({
      where: {
        entityType: "User",
        entityId: userId,
        timestamp: { gte: last1h },
      },
      select: { newValue: true },
      distinct: ["newValue"],
    }),
  ]);

  const reasons: string[] = [];
  let uniqueDeviceCount = 0;
  let uniqueIpCount = 0;

  // Count unique devices and IPs from the audit data
  const deviceSet = new Set<string>();
  const ipSet = new Set<string>();

  uniqueDevices.forEach((audit: { newValue: unknown }) => {
    const details = audit.newValue as Record<string, unknown>;
    if (details?.deviceId && typeof details.deviceId === "string") {
      deviceSet.add(details.deviceId);
    }
  });

  uniqueIps.forEach((audit: { newValue: unknown }) => {
    const details = audit.newValue as Record<string, unknown>;
    if (details?.ip && typeof details.ip === "string") {
      ipSet.add(details.ip);
    }
  });

  uniqueDeviceCount = deviceSet.size;
  uniqueIpCount = ipSet.size;

  // Check for suspicious patterns
  if (recentAttempts > 5) {
    reasons.push("High number of recovery attempts in 24 hours");
  }

  if (uniqueDeviceCount > 3) {
    reasons.push("Multiple devices used for recovery");
  }

  if (uniqueIpCount > 2) {
    reasons.push("Multiple IP addresses used for recovery");
  }

  return {
    isSuspicious: reasons.length > 0,
    reasons,
  };
}

/**
 * Rotate user sessions after recovery
 */
export async function rotateUserSessions(userId: string): Promise<void> {
  try {
    // Revoke all existing API keys for the user
    await prisma.apiKey.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    // Log session rotation
    await auditRecoveryEvent({
      eventType: "session_rotated",
      userId,
      details: { allApiKeysRevoked: true },
      risk: "medium",
    });

    logger.info("User sessions rotated after recovery", { userId });
  } catch (error) {
    logger.error("Failed to rotate user sessions", { error, userId });
  }
}
