-- Down Migration: drop refresh_tokens table
DROP TABLE IF EXISTS "refresh_tokens" CASCADE;
