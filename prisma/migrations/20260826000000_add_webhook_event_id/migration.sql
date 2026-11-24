ALTER TABLE "webhooks" ADD COLUMN "event_id" VARCHAR(255);

CREATE UNIQUE INDEX "idx_webhooks_event_id_unique"
  ON "webhooks"("event_id")
  WHERE "event_id" IS NOT NULL;