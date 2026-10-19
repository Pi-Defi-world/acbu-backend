-- Down Migration: drop weight drift audit tables
DROP TABLE IF EXISTS "weight_drift_currencies" CASCADE;
DROP TABLE IF EXISTS "weight_drift_audits" CASCADE;
