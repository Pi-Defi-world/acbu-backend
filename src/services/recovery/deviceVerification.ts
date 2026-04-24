/**
 * Device verification service for recovery security
 * Provides device fingerprinting and verification as second factor
 */
import crypto from "crypto";
import { prisma } from "../../config/database";
import { logger } from "../../config/logger";

export interface DeviceFingerprint {
  userAgent: string;
  ip: string;
  acceptLanguage?: string;
  acceptEncoding?: string;
  timezone?: string;
  screenResolution?: string;
  platform?: string;
}

export interface DeviceVerificationResult {
  deviceId: string;
  isTrusted: boolean;
  requiresVerification: boolean;
}

/**
 * Generate device fingerprint from request data
 */
export function generateDeviceFingerprint(
  fingerprint: DeviceFingerprint,
): string {
  const data = JSON.stringify({
    userAgent: fingerprint.userAgent,
    acceptLanguage: fingerprint.acceptLanguage,
    acceptEncoding: fingerprint.acceptEncoding,
    platform: fingerprint.platform,
    // Hash IP to avoid storing raw IP
    ipHash: fingerprint.ip
      ? crypto.createHash("sha256").update(fingerprint.ip).digest("hex")
      : null,
  });

  return crypto.createHash("sha256").update(data).digest("hex");
}

/**
 * Register or verify device for recovery
 */
export async function verifyDevice(
  userId: string,
  fingerprint: DeviceFingerprint,
): Promise<DeviceVerificationResult> {
  const deviceFingerprint = generateDeviceFingerprint(fingerprint);

  // Check if device exists and is trusted
  const existingDevice = await prisma.userDevice.findFirst({
    where: {
      userId,
      fingerprint: deviceFingerprint,
    },
  });

  if (existingDevice && existingDevice.isTrusted) {
    // Update last seen
    await prisma.userDevice.update({
      where: { id: existingDevice.id },
      data: {
        lastSeenAt: new Date(),
        lastIp: fingerprint.ip,
      },
    });

    return {
      deviceId: existingDevice.id,
      isTrusted: true,
      requiresVerification: false,
    };
  }

  // Device not found or not trusted, create new device record
  const device = await prisma.userDevice.upsert({
    where: {
      userId_fingerprint: {
        userId,
        fingerprint: deviceFingerprint,
      },
    },
    update: {
      lastSeenAt: new Date(),
      lastIp: fingerprint.ip,
      verificationAttempts: { increment: 1 },
    },
    create: {
      userId,
      fingerprint: deviceFingerprint,
      userAgent: fingerprint.userAgent,
      lastIp: fingerprint.ip,
      isTrusted: false,
      verificationAttempts: 1,
    },
  });

  return {
    deviceId: device.id,
    isTrusted: false,
    requiresVerification: true,
  };
}

/**
 * Trust device after successful recovery with second factor
 */
export async function trustDevice(deviceId: string): Promise<void> {
  await prisma.userDevice.update({
    where: { id: deviceId },
    data: {
      isTrusted: true,
      trustedAt: new Date(),
    },
  });

  logger.info("Device trusted after successful recovery", { deviceId });
}

/**
 * Check if device has exceeded verification attempts
 */
export async function isDeviceRateLimited(
  userId: string,
  fingerprint: DeviceFingerprint,
): Promise<boolean> {
  const deviceFingerprint = generateDeviceFingerprint(fingerprint);

  const device = await prisma.userDevice.findFirst({
    where: {
      userId,
      fingerprint: deviceFingerprint,
    },
  });

  if (!device) return false;

  // Check if device has too many recent attempts
  const recentAttempts = await prisma.userDevice.count({
    where: {
      userId,
      fingerprint: deviceFingerprint,
      verificationAttempts: { gt: 5 },
      lastSeenAt: { gte: new Date(Date.now() - 60 * 60 * 1000) }, // Last hour
    },
  });

  return recentAttempts > 0;
}

/**
 * Clean up old device records
 */
export async function cleanupOldDevices(): Promise<void> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  await prisma.userDevice.deleteMany({
    where: {
      lastSeenAt: { lt: thirtyDaysAgo },
      isTrusted: false,
    },
  });

  logger.info("Cleaned up old untrusted devices");
}
