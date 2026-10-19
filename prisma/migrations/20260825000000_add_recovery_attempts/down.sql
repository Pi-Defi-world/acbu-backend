-- Down Migration: drop recovery_attempts table
DROP TABLE IF EXISTS "recovery_attempts" CASCADE;
