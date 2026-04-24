import { z } from "zod";

export const bulkTransferRowSchema = z.object({
  to: z.string().trim().min(1, "to is required"),
  amount_acbu: z
    .string()
    .trim()
    .min(1, "amount_acbu is required")
    .refine((value: string) => /^\d+(\.\d{1,7})?$/.test(value) && Number(value) > 0, {
      message:
        "amount_acbu must be a positive number with up to 7 decimal places",
    }),
  reference: z.string().trim().optional(),
  idempotency_key: z.string().trim().optional(),
});

export type BulkTransferRowInput = z.infer<typeof bulkTransferRowSchema>;

export function validateBulkTransferRow(row: unknown): BulkTransferRowInput {
  return bulkTransferRowSchema.parse(row);
}

export function validateBulkTransferRowSafe(row: unknown) {
  return bulkTransferRowSchema.safeParse(row);
}
