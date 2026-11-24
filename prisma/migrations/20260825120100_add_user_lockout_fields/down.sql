-- Down Migration: revert user lockout fields
ALTER TABLE "users" DROP COLUMN IF EXISTS "lockout_until";
ALTER TABLE "users" DROP COLUMN IF EXISTS "failed_signin_attempts";
