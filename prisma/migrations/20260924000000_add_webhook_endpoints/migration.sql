-- CreateTable
CREATE TABLE "webhook_endpoints" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "url" VARCHAR(2048) NOT NULL,
    "secret" VARCHAR(255),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "webhooks"
    ADD COLUMN "endpoint_id" UUID,
    ADD COLUMN "endpoint_url" VARCHAR(2048),
    ADD COLUMN "endpoint_secret" VARCHAR(255);

-- CreateIndex
CREATE INDEX "idx_webhook_endpoints_org_active" ON "webhook_endpoints"("organization_id", "active");
CREATE INDEX "idx_webhooks_endpoint_id" ON "webhooks"("endpoint_id");

-- AddForeignKey
ALTER TABLE "webhook_endpoints"
    ADD CONSTRAINT "webhook_endpoints_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "webhooks"
    ADD CONSTRAINT "webhooks_endpoint_id_fkey"
    FOREIGN KEY ("endpoint_id") REFERENCES "webhook_endpoints"("id") ON DELETE SET NULL ON UPDATE CASCADE;
