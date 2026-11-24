-- Down Migration: drop salary models tables
DROP TABLE IF EXISTS "salary_items" CASCADE;
DROP TABLE IF EXISTS "salary_schedules" CASCADE;
DROP TABLE IF EXISTS "salary_batches" CASCADE;
