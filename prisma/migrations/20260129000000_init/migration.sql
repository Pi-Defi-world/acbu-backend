-- This is a consolidated baseline migration that replaces the previous 25 migration
-- files. It captures the full schema as defined in schema.prisma plus non-schema
-- database objects (seed data, triggers, functions, constraints) required by the
-- application.

-- CreateEnum
CREATE TYPE "ApiKeyType" AS ENUM ('USER_KEY', 'ADMIN_KEY', 'BREAK_GLASS_KEY');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255),
    "kyc_status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "kyc_verified_at" TIMESTAMP(6),
    "actor_type" VARCHAR(20) NOT NULL DEFAULT 'sme',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "stellar_address" VARCHAR(56),
    "kyc_status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "kyc_verified_at" TIMESTAMP(6),
    "country_code" VARCHAR(3),
    "username" VARCHAR(64),
    "phone_e164" VARCHAR(20),
    "email" VARCHAR(255),
    "email_verified_at" TIMESTAMP(6),
    "phone_verified_at" TIMESTAMP(6),
    "privacy_hide_from_search" BOOLEAN NOT NULL DEFAULT true,
    "passcode_hash" VARCHAR(255),
    "encrypted_stellar_secret" VARCHAR(512),
    "key_encryption_hint" VARCHAR(50),
    "wallet_version" INTEGER NOT NULL DEFAULT 0,
    "two_fa_method" VARCHAR(20),
    "totp_secret_encrypted" VARCHAR(512),
    "actor_type" VARCHAR(20) NOT NULL DEFAULT 'retail',
    "tier" VARCHAR(20) NOT NULL DEFAULT 'free',
    "organization_id" UUID,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "organization_id" UUID,
    "idempotency_key" VARCHAR(255),
    "type" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "usdc_amount" DECIMAL(20,8),
    "acbu_amount" DECIMAL(20,8),
    "acbu_amount_burned" DECIMAL(20,8),
    "local_currency" VARCHAR(3),
    "local_amount" DECIMAL(20,2),
    "recipient_account" JSONB,
    "recipient_address" VARCHAR(56),
    "fee" DECIMAL(20,8),
    "rate_snapshot" JSONB,
    "blockchain_tx_hash" VARCHAR(255),
    "confirmations" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(6),

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reserves" (
    "id" UUID NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "segment" VARCHAR(20) NOT NULL DEFAULT 'transactions',
    "target_weight" DECIMAL(5,2) NOT NULL,
    "actual_weight" DECIMAL(5,2) NOT NULL,
    "reserve_amount" DECIMAL(20,2) NOT NULL,
    "reserve_value_usd" DECIMAL(20,2) NOT NULL,
    "timestamp" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reserves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reserve_history" (
    "id" UUID NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "amount_change" DECIMAL(20,2) NOT NULL,
    "reason" VARCHAR(100),
    "transaction_id" UUID,
    "previous_amount" DECIMAL(20,2),
    "new_amount" DECIMAL(20,2),
    "timestamp" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reserve_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oracle_rates" (
    "id" UUID NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "rate_usd" DECIMAL(20,8) NOT NULL,
    "central_bank_rate" DECIMAL(20,8),
    "fintech_rate" DECIMAL(20,8),
    "forex_rate" DECIMAL(20,8),
    "median_rate" DECIMAL(20,8) NOT NULL,
    "twap_24h" DECIMAL(20,8),
    "validator_signatures" JSONB,
    "timestamp" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oracle_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acbu_rates" (
    "id" UUID NOT NULL,
    "acbu_usd" DECIMAL(20,8) NOT NULL,
    "acbu_eur" DECIMAL(20,8),
    "acbu_gbp" DECIMAL(20,8),
    "acbu_ngn" DECIMAL(20,2),
    "acbu_kes" DECIMAL(20,2),
    "acbu_zar" DECIMAL(20,2),
    "acbu_rwf" DECIMAL(20,2),
    "acbu_ghs" DECIMAL(20,2),
    "acbu_egp" DECIMAL(20,2),
    "acbu_mad" DECIMAL(20,2),
    "acbu_tzs" DECIMAL(20,2),
    "acbu_ugx" DECIMAL(20,2),
    "acbu_xof" DECIMAL(20,2),
    "change_24h_usd" DECIMAL(5,2),
    "timestamp" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acbu_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "basket_metrics" (
    "id" UUID NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "period" VARCHAR(20) NOT NULL,
    "gdp_score" DECIMAL(10,4),
    "trade_score" DECIMAL(10,4),
    "liquidity_score" DECIMAL(10,4),
    "raw_values" JSONB,
    "source" VARCHAR(100),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "basket_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "basket_config" (
    "id" UUID NOT NULL,
    "effective_from" TIMESTAMP(6) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "weight" DECIMAL(5,2) NOT NULL,
    "proposal_id" UUID,
    "status" VARCHAR(20) NOT NULL,

    CONSTRAINT "basket_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rebalancing_events" (
    "id" UUID NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "adjustments" JSONB,
    "started_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(6),

    CONSTRAINT "rebalancing_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_trail" (
    "id" UUID NOT NULL,
    "event_type" VARCHAR(50) NOT NULL,
    "entity_type" VARCHAR(50),
    "entity_id" UUID,
    "action" VARCHAR(50) NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB,
    "performed_by" UUID,
    "actor_type" VARCHAR(20),
    "key_type" VARCHAR(32),
    "organization_id" UUID,
    "reason" VARCHAR(255),
    "timestamp" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_trail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhooks" (
    "id" UUID NOT NULL,
    "transaction_id" UUID,
    "event_type" VARCHAR(50) NOT NULL,
    "payload" JSONB NOT NULL,
    "signature" VARCHAR(255),
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "on_ramp_swaps" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "idempotency_key" VARCHAR(255),
    "stellar_address" VARCHAR(56) NOT NULL,
    "source" VARCHAR(20) NOT NULL DEFAULT 'xlm_deposit',
    "xlm_amount" DECIMAL(20,7),
    "usdc_amount" DECIMAL(20,8),
    "status" VARCHAR(20) NOT NULL,
    "transaction_id" UUID,
    "completed_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "on_ramp_swaps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_withdrawal_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "organization_id" UUID,
    "audience" VARCHAR(20) NOT NULL,
    "amount_acbu" DECIMAL(20,8) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "forced_removal" BOOLEAN NOT NULL DEFAULT false,
    "fee_percent" DECIMAL(5,2),
    "available_at" TIMESTAMP(6) NOT NULL,
    "notified_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investment_withdrawal_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "organization_id" UUID,
    "lookup_key" VARCHAR(24),
    "key_hash" VARCHAR(255) NOT NULL,
    "key_type" "ApiKeyType" NOT NULL DEFAULT 'USER_KEY',
    "created_by_user_id" UUID,
    "emergency_reason" VARCHAR(255),
    "emergency_expires_at" TIMESTAMP(6),
    "permissions" JSONB,
    "rate_limit" INTEGER NOT NULL DEFAULT 100,
    "last_used_at" TIMESTAMP(6),
    "expires_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(6),

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_passkeys" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "credential_id" VARCHAR(512) NOT NULL,
    "public_key" TEXT NOT NULL,
    "device_name" VARCHAR(100),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_passkeys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_devices" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "user_agent" VARCHAR(512),
    "last_ip" VARCHAR(45),
    "is_trusted" BOOLEAN NOT NULL DEFAULT false,
    "verification_attempts" INTEGER NOT NULL DEFAULT 0,
    "trusted_at" TIMESTAMP(6),
    "last_seen_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "user_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardians" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "guardian_user_id" UUID,
    "guardian_email" VARCHAR(255),
    "guardian_phone" VARCHAR(20),
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "order" SMALLINT NOT NULL DEFAULT 0,
    "invited_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "guardians_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_contacts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "contact_user_id" UUID,
    "contact_username" VARCHAR(64),
    "contact_phone_e164" VARCHAR(20),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_challenges" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" VARCHAR(255) NOT NULL,
    "channel" VARCHAR(20) NOT NULL,
    "expires_at" TIMESTAMP(6) NOT NULL,
    "used_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_applications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "country_code" VARCHAR(3) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "fee_paid_acbu" DECIMAL(20,8) NOT NULL,
    "fee_tx_hash" VARCHAR(255),
    "fee_mint_transaction_id" UUID,
    "machine_confidence" DECIMAL(3,2),
    "machine_redacted_payload" TEXT,
    "machine_extracted_payload" TEXT,
    "rejection_reason" VARCHAR(500),
    "resolved_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "kyc_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_documents" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "storage_ref" VARCHAR(512) NOT NULL,
    "checksum" VARCHAR(64),
    "mime_type" VARCHAR(100),
    "scan_status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "file_size_bytes" INTEGER,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kyc_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_validators" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "country_code" VARCHAR(3) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "accuracy_score" DECIMAL(3,2) NOT NULL DEFAULT 1,
    "completed_count" INTEGER NOT NULL DEFAULT 0,
    "agreement_accepted_at" TIMESTAMP(6),
    "training_completed_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "kyc_validators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_validations" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "validator_id" UUID NOT NULL,
    "result" VARCHAR(20) NOT NULL,
    "notes" VARCHAR(500),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kyc_validations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_validator_rewards" (
    "id" UUID NOT NULL,
    "validator_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "acbu_amount" DECIMAL(20,8) NOT NULL,
    "tx_hash" VARCHAR(255),
    "status" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kyc_validator_rewards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_batches" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "user_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "total_amount" DECIMAL(20,8) NOT NULL,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'ACBU',
    "idempotency_key" VARCHAR(100),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,
    "completed_at" TIMESTAMP(6),

    CONSTRAINT "salary_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_items" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "recipient_id" UUID,
    "recipient_address" VARCHAR(56) NOT NULL,
    "amount" DECIMAL(20,8) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "transaction_id" UUID,
    "error_message" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "salary_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_schedules" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "cron" VARCHAR(100) NOT NULL,
    "amount_config" JSONB NOT NULL,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'ACBU',
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "last_run_at" TIMESTAMP(6),
    "next_run_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "salary_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bulk_transfer_jobs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "total_rows" INTEGER NOT NULL,
    "processed_rows" INTEGER NOT NULL DEFAULT 0,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "failure_report" JSONB,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(6),
    "error_message" TEXT,

    CONSTRAINT "bulk_transfer_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recovery_attempts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "identifier" VARCHAR(255) NOT NULL,
    "ip" VARCHAR(45),
    "user_agent" VARCHAR(512),
    "success" BOOLEAN NOT NULL DEFAULT false,
    "reason" VARCHAR(255),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_strategies" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "policy_limit_usd" DECIMAL(20,2) NOT NULL,
    "deployed_notional_usd" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "target_apy_bps" INTEGER,
    "risk_tier" VARCHAR(20) NOT NULL DEFAULT 'medium',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "investment_strategies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_family_id" UUID NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMP(6) NOT NULL,
    "revoked_at" TIMESTAMP(6),
    "replaced_by_token" VARCHAR(255),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(6),

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable (non-schema: limits_config)
CREATE TABLE "limits_config" (
    "id" UUID NOT NULL,
    "scope" VARCHAR(32) NOT NULL,
    "values" JSONB NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "limits_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_organization_kyc_status" ON "organizations"("kyc_status");

-- CreateIndex
CREATE UNIQUE INDEX "users_stellar_address_key" ON "users"("stellar_address");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_e164_key" ON "users"("phone_e164");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "idx_stellar_address" ON "users"("stellar_address");

-- CreateIndex
CREATE INDEX "idx_username" ON "users"("username");

-- CreateIndex
CREATE INDEX "idx_phone_e164" ON "users"("phone_e164");

-- CreateIndex
CREATE INDEX "idx_email" ON "users"("email");

-- CreateIndex
CREATE INDEX "idx_user_actor_type" ON "users"("actor_type");

-- CreateIndex
CREATE INDEX "idx_user_organization_id" ON "users"("organization_id");

-- CreateIndex
CREATE INDEX "idx_transactions_organization_id" ON "transactions"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "idx_transactions_idempotency_key" ON "transactions"("idempotency_key");

-- CreateIndex
CREATE INDEX "idx_transactions_user_id" ON "transactions"("user_id");

-- CreateIndex
CREATE INDEX "idx_transactions_type" ON "transactions"("type");

-- CreateIndex
CREATE INDEX "idx_transactions_status" ON "transactions"("status");

-- CreateIndex
CREATE INDEX "idx_transactions_created_at" ON "transactions"("created_at");

-- CreateIndex
CREATE INDEX "idx_transactions_user_type" ON "transactions"("user_id", "type");

-- CreateIndex
CREATE INDEX "idx_transactions_status_created" ON "transactions"("status", "created_at");

-- CreateIndex
CREATE INDEX "idx_transactions_user_id_created_at" ON "transactions"("user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_transactions_type_blockchain_tx_hash" ON "transactions"("type", "blockchain_tx_hash");

-- CreateIndex
CREATE INDEX "idx_reserves_currency" ON "reserves"("currency");

-- CreateIndex
CREATE INDEX "idx_reserves_segment" ON "reserves"("segment");

-- CreateIndex
CREATE INDEX "idx_reserves_timestamp" ON "reserves"("timestamp");

-- CreateIndex
CREATE INDEX "idx_reserves_currency_segment_timestamp" ON "reserves"("currency", "segment", "timestamp" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "reserves_currency_segment_timestamp_key" ON "reserves"("currency", "segment", "timestamp");

-- CreateIndex
CREATE INDEX "idx_reserve_history_currency" ON "reserve_history"("currency");

-- CreateIndex
CREATE INDEX "idx_reserve_history_timestamp" ON "reserve_history"("timestamp");

-- CreateIndex
CREATE INDEX "idx_reserve_history_transaction_id" ON "reserve_history"("transaction_id");

-- CreateIndex
CREATE INDEX "idx_oracle_rates_timestamp" ON "oracle_rates"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "oracle_rates_currency_timestamp_key" ON "oracle_rates"("currency", "timestamp");

-- CreateIndex
CREATE INDEX "idx_acbu_rates_timestamp" ON "acbu_rates"("timestamp");

-- CreateIndex
CREATE INDEX "idx_basket_metrics_currency" ON "basket_metrics"("currency");

-- CreateIndex
CREATE INDEX "idx_basket_metrics_period" ON "basket_metrics"("period");

-- CreateIndex
CREATE UNIQUE INDEX "basket_metrics_currency_period_key" ON "basket_metrics"("currency", "period");

-- CreateIndex
CREATE INDEX "idx_basket_config_status" ON "basket_config"("status");

-- CreateIndex
CREATE INDEX "idx_basket_config_effective_from" ON "basket_config"("effective_from");

-- CreateIndex
CREATE INDEX "idx_basket_config_current" ON "basket_config"("status", "effective_from" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "basket_config_effective_from_currency_key" ON "basket_config"("effective_from", "currency");

-- CreateIndex
CREATE INDEX "idx_rebalancing_events_type" ON "rebalancing_events"("type");

-- CreateIndex
CREATE INDEX "idx_rebalancing_events_status" ON "rebalancing_events"("status");

-- CreateIndex
CREATE INDEX "idx_rebalancing_events_started_at" ON "rebalancing_events"("started_at");

-- CreateIndex
CREATE INDEX "idx_audit_trail_event_type" ON "audit_trail"("event_type");

-- CreateIndex
CREATE INDEX "idx_audit_trail_entity_type" ON "audit_trail"("entity_type");

-- CreateIndex
CREATE INDEX "idx_audit_trail_entity_id" ON "audit_trail"("entity_id");

-- CreateIndex
CREATE INDEX "idx_audit_trail_actor_type_timestamp" ON "audit_trail"("actor_type", "timestamp");

-- CreateIndex
CREATE INDEX "idx_audit_trail_org_timestamp" ON "audit_trail"("organization_id", "timestamp");

-- CreateIndex
CREATE INDEX "idx_audit_trail_timestamp" ON "audit_trail"("timestamp");

-- CreateIndex
CREATE INDEX "idx_webhooks_transaction_id" ON "webhooks"("transaction_id");

-- CreateIndex
CREATE INDEX "idx_webhooks_status" ON "webhooks"("status");

-- CreateIndex
CREATE UNIQUE INDEX "on_ramp_swaps_idempotency_key_key" ON "on_ramp_swaps"("idempotency_key");

-- CreateIndex
CREATE INDEX "idx_on_ramp_swap_status" ON "on_ramp_swaps"("status");

-- CreateIndex
CREATE INDEX "idx_on_ramp_swap_status_created_at" ON "on_ramp_swaps"("status", "created_at");

-- CreateIndex
CREATE INDEX "idx_on_ramp_swap_source" ON "on_ramp_swaps"("source");

-- CreateIndex
CREATE INDEX "idx_on_ramp_swap_user_id" ON "on_ramp_swaps"("user_id");

-- CreateIndex
CREATE INDEX "idx_on_ramp_swap_created_at" ON "on_ramp_swaps"("created_at");

-- CreateIndex
CREATE INDEX "idx_inv_withdrawal_status" ON "investment_withdrawal_requests"("status");

-- CreateIndex
CREATE INDEX "idx_inv_withdrawal_available_at" ON "investment_withdrawal_requests"("available_at");

-- CreateIndex
CREATE INDEX "idx_inv_withdrawal_user_id" ON "investment_withdrawal_requests"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_lookup_key_key" ON "api_keys"("lookup_key");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "idx_api_keys_user_id" ON "api_keys"("user_id");

-- CreateIndex
CREATE INDEX "idx_api_keys_organization_id" ON "api_keys"("organization_id");

-- CreateIndex
CREATE INDEX "idx_api_keys_key_type" ON "api_keys"("key_type");

-- CreateIndex
CREATE INDEX "idx_api_keys_key_hash" ON "api_keys"("key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "user_passkeys_credential_id_key" ON "user_passkeys"("credential_id");

-- CreateIndex
CREATE INDEX "idx_user_passkey_user_id" ON "user_passkeys"("user_id");

-- CreateIndex
CREATE INDEX "idx_user_devices_user_id" ON "user_devices"("user_id");

-- CreateIndex
CREATE INDEX "idx_user_devices_fingerprint" ON "user_devices"("fingerprint");

-- CreateIndex
CREATE INDEX "idx_user_devices_last_seen_at" ON "user_devices"("last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_devices_user_id_fingerprint_key" ON "user_devices"("user_id", "fingerprint");

-- CreateIndex
CREATE INDEX "idx_guardian_user_id" ON "guardians"("user_id");

-- CreateIndex
CREATE INDEX "idx_guardian_guardian_user_id" ON "guardians"("guardian_user_id");

-- CreateIndex
CREATE INDEX "idx_user_contact_user_id" ON "user_contacts"("user_id");

-- CreateIndex
CREATE INDEX "idx_user_contact_contact_user_id" ON "user_contacts"("contact_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_contacts_user_id_contact_user_id_key" ON "user_contacts"("user_id", "contact_user_id");

-- CreateIndex
CREATE INDEX "idx_otp_challenge_user_id" ON "otp_challenges"("user_id");

-- CreateIndex
CREATE INDEX "idx_otp_challenge_expires_at" ON "otp_challenges"("expires_at");

-- CreateIndex
CREATE INDEX "idx_kyc_application_user_id" ON "kyc_applications"("user_id");

-- CreateIndex
CREATE INDEX "idx_kyc_application_status" ON "kyc_applications"("status");

-- CreateIndex
CREATE INDEX "idx_kyc_application_country" ON "kyc_applications"("country_code");

-- CreateIndex
CREATE INDEX "idx_kyc_application_created_at" ON "kyc_applications"("created_at");

-- CreateIndex
CREATE INDEX "idx_kyc_document_application_id" ON "kyc_documents"("application_id");

-- CreateIndex
CREATE INDEX "idx_kyc_validator_country" ON "kyc_validators"("country_code");

-- CreateIndex
CREATE INDEX "idx_kyc_validator_status" ON "kyc_validators"("status");

-- CreateIndex
CREATE UNIQUE INDEX "kyc_validators_user_id_country_code_key" ON "kyc_validators"("user_id", "country_code");

-- CreateIndex
CREATE INDEX "idx_kyc_validation_application_id" ON "kyc_validations"("application_id");

-- CreateIndex
CREATE INDEX "idx_kyc_validation_validator_id" ON "kyc_validations"("validator_id");

-- CreateIndex
CREATE INDEX "idx_kyc_validator_reward_validator_id" ON "kyc_validator_rewards"("validator_id");

-- CreateIndex
CREATE INDEX "idx_kyc_validator_reward_application_id" ON "kyc_validator_rewards"("application_id");

-- CreateIndex
CREATE INDEX "idx_kyc_validator_reward_status" ON "kyc_validator_rewards"("status");

-- CreateIndex
CREATE UNIQUE INDEX "salary_batches_idempotency_key_key" ON "salary_batches"("idempotency_key");

-- CreateIndex
CREATE INDEX "idx_salary_batch_org_id" ON "salary_batches"("organization_id");

-- CreateIndex
CREATE INDEX "idx_salary_batch_user_id" ON "salary_batches"("user_id");

-- CreateIndex
CREATE INDEX "idx_salary_batch_status" ON "salary_batches"("status");

-- CreateIndex
CREATE UNIQUE INDEX "salary_items_transaction_id_key" ON "salary_items"("transaction_id");

-- CreateIndex
CREATE INDEX "idx_salary_item_batch_id" ON "salary_items"("batch_id");

-- CreateIndex
CREATE INDEX "idx_salary_item_status" ON "salary_items"("status");

-- CreateIndex
CREATE INDEX "idx_salary_schedule_org_id" ON "salary_schedules"("organization_id");

-- CreateIndex
CREATE INDEX "idx_salary_schedule_status" ON "salary_schedules"("status");

-- CreateIndex
CREATE INDEX "idx_salary_schedule_next_run" ON "salary_schedules"("next_run_at");

-- CreateIndex
CREATE INDEX "idx_bulk_transfer_jobs_organization_id" ON "bulk_transfer_jobs"("organization_id");

-- CreateIndex
CREATE INDEX "idx_bulk_transfer_jobs_status" ON "bulk_transfer_jobs"("status");

-- CreateIndex
CREATE INDEX "idx_bulk_transfer_jobs_created_at" ON "bulk_transfer_jobs"("created_at");

-- CreateIndex
CREATE INDEX "idx_recovery_attempt_user_id" ON "recovery_attempts"("user_id");

-- CreateIndex
CREATE INDEX "idx_recovery_attempt_identifier" ON "recovery_attempts"("identifier");

-- CreateIndex
CREATE INDEX "idx_recovery_attempt_created_at" ON "recovery_attempts"("created_at");

-- CreateIndex
CREATE INDEX "idx_recovery_attempt_success" ON "recovery_attempts"("success");

-- CreateIndex
CREATE UNIQUE INDEX "investment_strategies_name_key" ON "investment_strategies"("name");

-- CreateIndex
CREATE INDEX "idx_investment_strategies_status" ON "investment_strategies"("status");

-- CreateIndex
CREATE INDEX "idx_investment_strategies_risk_tier" ON "investment_strategies"("risk_tier");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "idx_refresh_tokens_user_id" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "idx_refresh_tokens_token_family_id" ON "refresh_tokens"("token_family_id");

-- CreateIndex
CREATE INDEX "idx_refresh_tokens_token_hash" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "idx_refresh_tokens_expires_at" ON "refresh_tokens"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "limits_config_scope_key" ON "limits_config"("scope");

-- CreateIndex
CREATE INDEX "idx_limit_config_updated_at" ON "limits_config"("updated_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserve_history" ADD CONSTRAINT "reserve_history_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "on_ramp_swaps" ADD CONSTRAINT "on_ramp_swaps_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_passkeys" ADD CONSTRAINT "user_passkeys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_devices" ADD CONSTRAINT "user_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_guardian_user_id_fkey" FOREIGN KEY ("guardian_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_contacts" ADD CONSTRAINT "user_contacts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_contacts" ADD CONSTRAINT "user_contacts_contact_user_id_fkey" FOREIGN KEY ("contact_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_applications" ADD CONSTRAINT "kyc_applications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_documents" ADD CONSTRAINT "kyc_documents_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "kyc_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_validators" ADD CONSTRAINT "kyc_validators_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_validations" ADD CONSTRAINT "kyc_validations_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "kyc_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_validations" ADD CONSTRAINT "kyc_validations_validator_id_fkey" FOREIGN KEY ("validator_id") REFERENCES "kyc_validators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_validator_rewards" ADD CONSTRAINT "kyc_validator_rewards_validator_id_fkey" FOREIGN KEY ("validator_id") REFERENCES "kyc_validators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_validator_rewards" ADD CONSTRAINT "kyc_validator_rewards_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "kyc_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_batches" ADD CONSTRAINT "salary_batches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_batches" ADD CONSTRAINT "salary_batches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_items" ADD CONSTRAINT "salary_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "salary_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_items" ADD CONSTRAINT "salary_items_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_schedules" ADD CONSTRAINT "salary_schedules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_schedules" ADD CONSTRAINT "salary_schedules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulk_transfer_jobs" ADD CONSTRAINT "bulk_transfer_jobs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SeedData: limits_config
INSERT INTO "limits_config" ("id", "scope", "values")
VALUES
    ('00000000-0000-0000-0000-000000000161', 'retail', '{}'::jsonb),
    ('00000000-0000-0000-0000-000000000162', 'business', '{}'::jsonb),
    ('00000000-0000-0000-0000-000000000163', 'government', '{}'::jsonb),
    ('00000000-0000-0000-0000-000000000164', 'circuit_breaker', '{}'::jsonb);

-- Constraint: stellar address validation
DO $$
DECLARE invalid_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO invalid_count FROM users
  WHERE "stellar_address" IS NOT NULL AND (
    LENGTH("stellar_address") != 56 OR "stellar_address" NOT LIKE 'G%'
    OR "stellar_address" ~ '^G[A]{55}$' OR "stellar_address" ~ '^G[B]{55}$'
    OR "stellar_address" ~ '^G[0]{55}$' OR "stellar_address" LIKE 'GTEST%'
    OR "stellar_address" LIKE 'GDUMMY%' OR "stellar_address" LIKE 'GPLACEHOLDER%'
    OR "stellar_address" LIKE 'GXXXXXXXX%'
  );
  IF invalid_count > 0 THEN
    RAISE EXCEPTION 'Found % users with invalid stellar_address format.', invalid_count;
  END IF;
END $$;

ALTER TABLE users ADD CONSTRAINT chk_valid_stellar_address CHECK (
  "stellar_address" IS NULL OR (
    LENGTH("stellar_address") = 56 AND "stellar_address" LIKE 'G%'
    AND "stellar_address" ~ '^[A-Z2-7]{56}$'
    AND "stellar_address" !~ '^G[A]{55}$' AND "stellar_address" !~ '^G[B]{55}$'
    AND "stellar_address" !~ '^G[0]{55}$' AND "stellar_address" NOT LIKE 'GTEST%'
    AND "stellar_address" NOT LIKE 'GDUMMY%' AND "stellar_address" NOT LIKE 'GPLACEHOLDER%'
    AND "stellar_address" NOT LIKE 'GXXXXXXXX%'
  )
);

-- Function: audit_trail_immutable
CREATE OR REPLACE FUNCTION audit_trail_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_trail rows are immutable: % operations are not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

-- Trigger: prevent UPDATE on audit_trail
CREATE TRIGGER trg_audit_trail_no_update
  BEFORE UPDATE ON audit_trail
  FOR EACH ROW EXECUTE FUNCTION audit_trail_immutable();

-- Trigger: prevent DELETE on audit_trail
CREATE TRIGGER trg_audit_trail_no_delete
  BEFORE DELETE ON audit_trail
  FOR EACH ROW EXECUTE FUNCTION audit_trail_immutable();

-- Function: sync_prisma_migrations_from_snapshot (replica failover support)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '_prisma_migration_row') THEN
    CREATE TYPE _prisma_migration_row AS (
      id VARCHAR(36), checksum VARCHAR(64), finished_at TIMESTAMPTZ,
      migration_name VARCHAR(255), logs TEXT, rolled_back_at TIMESTAMPTZ,
      started_at TIMESTAMPTZ, applied_steps_count INTEGER
    );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION sync_prisma_migrations_from_snapshot(
  p_rows _prisma_migration_row[]
)
RETURNS TABLE(upserted INT, skipped INT)
LANGUAGE plpgsql AS $$
DECLARE r _prisma_migration_row; v_upserted INT := 0; v_skipped INT := 0;
BEGIN
  FOREACH r IN ARRAY p_rows LOOP
    INSERT INTO "_prisma_migrations" (
      id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count
    ) VALUES (r.id, r.checksum, r.finished_at, r.migration_name, r.logs, r.rolled_back_at, r.started_at, r.applied_steps_count)
    ON CONFLICT (id) DO NOTHING;
    IF FOUND THEN v_upserted := v_upserted + 1; ELSE v_skipped := v_skipped + 1; END IF;
  END LOOP;
  RETURN QUERY SELECT v_upserted, v_skipped;
END; $$;

COMMENT ON FUNCTION sync_prisma_migrations_from_snapshot IS
  '#383: Call this on a newly-promoted replica immediately after promotion.';
