
export interface CreateSalaryBatchParams {
  organizationId?: string;
  userId: string;
  totalAmount?: string;
  currency: string;
  idempotencyKey?: string;
  items: Array<{
    recipientId?: string;
    recipientAddress: string;
    amount: string;
  }>;
}

export interface CreateSalaryBatchResult {
  batchId: string;
  status: string;
}

export interface SalaryBatchDetails {
  id: string;
  status: string;
  totalAmount: string;
  currency: string;
  createdAt: string;
  items: Array<{
    id: string;
    recipientAddress: string;
    amount: string;
    status: string;
    transactionId?: string;
    errorMessage?: string;
  }>;
}
