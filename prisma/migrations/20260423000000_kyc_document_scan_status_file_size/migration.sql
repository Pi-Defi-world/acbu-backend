-- B-062: Add scan_status and file_size_bytes to kyc_documents
-- scan_status tracks the virus-scan result so the download gate can be
-- evaluated from the DB without an extra S3 GetObjectTagging round-trip.
-- file_size_bytes stores the client-reported size for integrity auditing.

ALTER TABLE "kyc_documents"
  ADD COLUMN IF NOT EXISTS "scan_status"    VARCHAR(20) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "file_size_bytes" INTEGER;
