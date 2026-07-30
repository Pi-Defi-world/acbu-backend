-- BE-018: Add per-challenge attempt throttling to otp_challenges
-- failed_attempts: incremented on every wrong OTP guess for this challenge row
-- locked_at:       set when failed_attempts reaches the lockout threshold (5)

ALTER TABLE "otp_challenges"
  ADD COLUMN "failed_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "locked_at"       TIMESTAMP(6);
