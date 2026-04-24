/**
 * Bulk transfer service types.
 * Handles batch CSV processing with per-row idempotency and failure reporting.
 */

export interface BulkTransferRow {
  /** Recipient identifier (alias @user, E.164, email, or raw G... 56-char Stellar address) */
  to: string;
  /** Amount in ACBU as a positive numeric string, up to 7 decimal places */
  amount_acbu: string;
  /** Optional reference for idempotency and reconciliation (e.g. invoice ID, batch row key) */
  reference?: string;
  /** Optional idempotency key; if not provided, derived from row content */
  idempotency_key?: string;
}

export interface BulkTransferRowResult {
  /** Zero-based row index from CSV */
  rowIndex: number;
  /** Derived or provided idempotency key */
  idempotencyKey: string;
  /** "success" or "failure" */
  status: "success" | "failure" | "skipped";
  /** Transaction ID if successful; null otherwise */
  transactionId?: string;
  /** Error message if failed */
  errorMessage?: string;
}

export type BulkTransferJobStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed";

export interface BulkTransferJobResult {
  /** Unique job ID for tracking and polling */
  jobId: string;
  /** Total rows in CSV */
  totalRows: number;
  /** Number of rows successfully processed */
  successCount: number;
  /** Number of rows that failed */
  failureCount: number;
  /** Rows that were skipped (e.g., duplicate idempotency keys from prior runs) */
  skippedCount: number;
  /** Job status at completion */
  status: BulkTransferJobStatus;
  /** ISO timestamp of job creation */
  createdAt: string;
  /** ISO timestamp of job completion, or null if still processing */
  completedAt?: string;
  /** Detailed failure report: array of failed rows with error messages */
  failureReport: BulkTransferRowResult[];
}

export interface ProcessBulkTransferParams {
  /** Organization ID from authenticated request */
  organizationId: string;
  /** Authenticated sender user ID when available */
  senderUserId?: string;
  /** CSV file content as Buffer or stream */
  fileContent: Buffer | NodeJS.ReadableStream;
  /** Optional file name for logging */
  fileName?: string;
  /** Optional caller-provided batch reference for correlation/logs */
  batchReference?: string;
}

export interface ProcessBulkTransferOptions {
  /** Chunk size for batch processing. Default 100 rows. */
  chunkSize?: number;
  /** Maximum file size in bytes. Default 10MB. */
  maxFileSizeBytes?: number;
  /** Allowed MIME types. Default ['text/csv', 'text/plain'] */
  allowedMimeTypes?: string[];
}
