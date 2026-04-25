/**
 * Transfer service types.
 * createTransfer accepts alias or raw G... and returns transaction_id, status.
 */

export interface CreateTransferParams {
  senderUserId: string;
  to: string;
  amountAcbu: string;
}

export interface CreateTransferOptions {
  /** When provided and returns a key, the service submits the Stellar payment. Otherwise tx stays pending. */
  getSenderSigningKey?: (userId: string) => Promise<string | null>;
  /** When provided, transfer is recorded as already submitted by the client. */
  submittedBlockchainTxHash?: string;
  /** Trace/request ID for distributed tracing. Generated via crypto.randomUUID() if not supplied. */
  correlationId?: string;
}

export interface CreateTransferResult {
  transactionId: string;
  status: string;
}
