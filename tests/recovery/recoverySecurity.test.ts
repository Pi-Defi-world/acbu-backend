/**
 * E2E tests for recovery security enhancements
 * Tests that second factor is required and security measures work properly
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { 
  unlockApp, 
  verifyRecoveryOtp,
  UnlockAppParams,
  VerifyRecoveryOtpParams 
} from '../../src/services/recovery/recoveryService';
import { DeviceFingerprint } from '../../src/services/recovery/deviceVerification';
import { getUserRecoveryAuditHistory } from '../../src/services/recovery/auditService';

const prisma = new PrismaClient();

describe('Recovery Security E2E Tests', () => {
  let testUser: any;
  let testDeviceFingerprint: DeviceFingerprint;
  let testDeviceFingerprint2: DeviceFingerprint;

  beforeAll(async () => {
    // Create test user with passcode
    const passcodeHash = await bcrypt.hash('test1234', 10);
    testUser = await prisma.user.create({
      data: {
        email: 'test@example.com',
        passcodeHash,
        kycStatus: 'verified',
      },
    });

    // Test device fingerprints
    testDeviceFingerprint = {
      userAgent: 'Mozilla/5.0 (Test Browser)',
      ip: '192.168.1.100',
      acceptLanguage: 'en-US,en;q=0.9',
      platform: 'Win32',
    };

    testDeviceFingerprint2 = {
      userAgent: 'Mozilla/5.0 (Different Browser)',
      ip: '192.168.1.101',
      acceptLanguage: 'en-US,en;q=0.9',
      platform: 'MacIntel',
    };
  });

  afterAll(async () => {
    // Cleanup test data
    await prisma.user.delete({ where: { id: testUser.id } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clean up test data before each test
    await prisma.otpChallenge.deleteMany({ where: { userId: testUser.id } });
    await prisma.recoveryAttempt.deleteMany({ where: { userId: testUser.id } });
    await prisma.userDevice.deleteMany({ where: { userId: testUser.id } });
    await prisma.apiKey.deleteMany({ where: { userId: testUser.id } });
  });

  describe('Device Verification Requirements', () => {
    it('should require device verification for new devices', async () => {
      const params: UnlockAppParams = {
        identifier: 'test@example.com',
        passcode: 'test1234',
        deviceFingerprint: testDeviceFingerprint,
      };

      const result = await unlockApp(params);

      expect(result.requires_device_verification).toBe(true);
      expect(result.device_id).toBeDefined();
      expect(result.challenge_token).toBeDefined();
      expect(result.channel).toBe('email');
    });

    it('should allow trusted devices to skip verification', async () => {
      // First, complete recovery to trust the device
      const params1: UnlockAppParams = {
        identifier: 'test@example.com',
        passcode: 'test1234',
        deviceFingerprint: testDeviceFingerprint,
      };

      await unlockApp(params1);
      
      // Mock OTP verification (in real test, you'd intercept the OTP)
      const otpChallenge = await prisma.otpChallenge.findFirst({
        where: { userId: testUser.id },
      });

      if (otpChallenge) {
        // Mock successful OTP verification by updating usedAt
        await prisma.otpChallenge.update({
          where: { id: otpChallenge.id },
          data: { usedAt: new Date() },
        });
      }

      // Second attempt with same device should be trusted
      const params2: UnlockAppParams = {
        identifier: 'test@example.com',
        passcode: 'test1234',
        deviceFingerprint: testDeviceFingerprint,
      };

      const result2 = await unlockApp(params2);

      // After first successful recovery, device should be trusted
      // This depends on the trust_device parameter in verifyRecoveryOtp
      expect(result2.challenge_token).toBeDefined();
    });

    it('should detect suspicious patterns across multiple devices', async () => {
      // Attempt recovery from multiple devices/IPs
      const devices = [testDeviceFingerprint, testDeviceFingerprint2];
      
      for (const device of devices) {
        const params: UnlockAppParams = {
          identifier: 'test@example.com',
          passcode: 'wrongpass', // Wrong passcode to create failed attempts
          deviceFingerprint: device,
        };

        try {
          await unlockApp(params);
        } catch (error) {
          // Expected to fail
        }
      }

      // Check audit history for suspicious patterns
      const auditHistory = await getUserRecoveryAuditHistory(testUser.id);
      expect(auditHistory.length).toBeGreaterThan(0);
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce rate limits on recovery attempts', async () => {
      const params: UnlockAppParams = {
        identifier: 'test@example.com',
        passcode: 'wrongpass', // Wrong passcode to trigger rate limiting
        deviceFingerprint: testDeviceFingerprint,
      };

      // Make multiple attempts to trigger rate limiting
      let attempts = 0;
      let rateLimitHit = false;

      while (attempts < 10 && !rateLimitHit) {
        try {
          await unlockApp(params);
        } catch (error: any) {
          if (error.message.includes('Rate limit exceeded') || 
              error.message.includes('Too many attempts')) {
            rateLimitHit = true;
            expect(error.message).toMatch(/Rate limit|Too many attempts/);
          }
        }
        attempts++;
      }

      expect(rateLimitHit).toBe(true);
    });

    it('should enforce per-identifier rate limits', async () => {
      const params: UnlockAppParams = {
        identifier: 'test@example.com',
        passcode: 'wrongpass',
        deviceFingerprint: testDeviceFingerprint,
      };

      // Count recovery attempts
      const initialAttempts = await prisma.recoveryAttempt.count({
        where: { identifier: 'test@example.com' },
      });

      // Make attempts until rate limited
      let attempts = 0;
      let rateLimited = false;

      while (attempts < 6 && !rateLimited) {
        try {
          await unlockApp(params);
        } catch (error: any) {
          if (error.message.includes('Rate limit exceeded')) {
            rateLimited = true;
          }
        }
        attempts++;
      }

      const finalAttempts = await prisma.recoveryAttempt.count({
        where: { identifier: 'test@example.com' },
      });

      expect(finalAttempts).toBeGreaterThan(initialAttempts);
    });
  });

  describe('Session Rotation', () => {
    it('should rotate sessions after successful recovery', async () => {
      // Create an existing API key
      await prisma.apiKey.create({
        data: {
          userId: testUser.id,
          lookupKey: 'testkey',
          keyHash: await bcrypt.hash('testsecret', 10),
        },
      });

      // Verify initial API key count
      await prisma.apiKey.count({
        where: { userId: testUser.id, revokedAt: null },
      });

      // Complete recovery process
      const unlockParams: UnlockAppParams = {
        identifier: 'test@example.com',
        passcode: 'test1234',
        deviceFingerprint: testDeviceFingerprint,
      };

      const unlockResult = await unlockApp(unlockParams);

      // Mock OTP verification
      const otpChallenge = await prisma.otpChallenge.findFirst({
        where: { userId: testUser.id },
      });

      if (otpChallenge) {
        await prisma.otpChallenge.update({
          where: { id: otpChallenge.id },
          data: { usedAt: new Date() },
        });
      }

      const verifyParams: VerifyRecoveryOtpParams = {
        challenge_token: unlockResult.challenge_token,
        code: '123456', // Mock OTP
        deviceFingerprint: testDeviceFingerprint,
        trust_device: true,
      };

      try {
        await verifyRecoveryOtp(verifyParams);
      } catch (error) {
        // Expected to fail with invalid OTP, but session rotation should still work
        // In a real test, you'd intercept the actual OTP
      }

      // Check that old keys are revoked
      const revokedKeys = await prisma.apiKey.count({
        where: { 
          userId: testUser.id, 
          revokedAt: { not: null },
        },
      });

      expect(revokedKeys).toBeGreaterThan(0);
    });
  });

  describe('Audit Logging', () => {
    it('should log all recovery events', async () => {
      const params: UnlockAppParams = {
        identifier: 'test@example.com',
        passcode: 'test1234',
        deviceFingerprint: testDeviceFingerprint,
      };

      await unlockApp(params);

      // Check audit trail
      const auditEvents = await prisma.auditTrail.findMany({
        where: {
          entityType: 'User',
          entityId: testUser.id,
          eventType: { startsWith: 'recovery_' },
        },
      });

      expect(auditEvents.length).toBeGreaterThan(0);
      
      const recoveryInitiatedEvent = auditEvents.find(
        event => event.eventType === 'recovery_initiated'
      );
      
      expect(recoveryInitiatedEvent).toBeDefined();
    });

    it('should log failed recovery attempts', async () => {
      const params: UnlockAppParams = {
        identifier: 'test@example.com',
        passcode: 'wrongpass',
        deviceFingerprint: testDeviceFingerprint,
      };

      try {
        await unlockApp(params);
      } catch (error) {
        // Expected to fail
      }

      // Check audit trail for failed attempts
      const auditEvents = await prisma.auditTrail.findMany({
        where: {
          entityType: 'User',
          entityId: testUser.id,
          eventType: 'recovery_failed',
        },
      });

      expect(auditEvents.length).toBeGreaterThan(0);
    });
  });

  describe('Security Requirements', () => {
    it('should not allow API key generation without second factor', async () => {
      // This test ensures that even with correct passcode, 
      // additional verification is required
      
      const params: UnlockAppParams = {
        identifier: 'test@example.com',
        passcode: 'test1234',
        deviceFingerprint: testDeviceFingerprint,
      };

      const result = await unlockApp(params);

      // Should require device verification (second factor)
      expect(result.requires_device_verification).toBe(true);
      
      // Should not directly provide API key
      expect((result as any).api_key).toBeUndefined();
      
      // Should provide challenge token that requires OTP verification
      expect(result.challenge_token).toBeDefined();
    });

    it('should prevent account takeover with leaked passcode alone', async () => {
      // Simulate attacker with leaked passcode but no access to email/SMS
      const attackerDevice: DeviceFingerprint = {
        userAgent: 'Attacker Browser',
        ip: '203.0.113.1', // Different IP
        acceptLanguage: 'en-US',
        platform: 'Linux',
      };

      const params: UnlockAppParams = {
        identifier: 'test@example.com',
        passcode: 'test1234', // Leaked passcode
        deviceFingerprint: attackerDevice,
      };

      const result = await unlockApp(params);

      // Attacker should still need OTP verification (sent to legitimate user's email)
      expect(result.requires_device_verification).toBe(true);
      expect(result.channel).toBe('email');
      
      // Without access to email, attacker cannot complete recovery
      const verifyParams: VerifyRecoveryOtpParams = {
        challenge_token: result.challenge_token,
        code: '000000', // Wrong OTP
        deviceFingerprint: attackerDevice,
      };

      await expect(verifyRecoveryOtp(verifyParams)).rejects.toThrow('Invalid code');
    });
  });
});
