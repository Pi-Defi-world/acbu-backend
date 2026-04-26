-- Runtime-tunable limit overrides. Missing keys fall back to env/default limits.
CREATE TABLE "limits_config" (
    "id" UUID NOT NULL,
    "scope" VARCHAR(32) NOT NULL,
    "values" JSONB NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "limits_config_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "limits_config_scope_key" ON "limits_config"("scope");

CREATE INDEX "idx_limit_config_updated_at" ON "limits_config"("updated_at");

INSERT INTO "limits_config" ("id", "scope", "values")
VALUES
    ('00000000-0000-0000-0000-000000000161', 'retail', '{}'::jsonb),
    ('00000000-0000-0000-0000-000000000162', 'business', '{}'::jsonb),
    ('00000000-0000-0000-0000-000000000163', 'government', '{}'::jsonb),
    ('00000000-0000-0000-0000-000000000164', 'circuit_breaker', '{}'::jsonb);
