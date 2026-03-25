import { z } from "zod";

export const savingsDepositSchema = z.object({
  body: z.object({
    user: z
      .string({ required_error: "User address is required" })
      .min(1, "User address cannot be empty"),
    amount: z.coerce
      .number({ required_error: "Amount is required" })
      .positive("Amount must be greater than zero"),
    term_seconds: z.coerce
      .number({ required_error: "term_seconds is required" })
      .int()
      .nonnegative("term_seconds must be a non-negative integer"),
  }),
});

export const savingsWithdrawSchema = z.object({
  body: z.object({
    user: z
      .string({ required_error: "User address is required" })
      .min(1, "User address cannot be empty"),
    amount: z.coerce
      .number({ required_error: "Amount is required" })
      .positive("Amount must be greater than zero"),
    term_seconds: z.coerce
      .number({ required_error: "term_seconds is required" })
      .int()
      .nonnegative("term_seconds must be a non-negative integer"),
  }),
});

export const savingsPositionsSchema = z.object({
  query: z.object({
    user: z
      .string({ required_error: 'Query parameter "user" is required' })
      .min(1, "User address cannot be empty"),
    term_seconds: z.coerce
      .number()
      .int()
      .nonnegative("term_seconds must be a non-negative integer")
      .optional(),
  }),
});
