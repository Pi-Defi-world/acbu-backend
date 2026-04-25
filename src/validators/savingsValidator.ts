import { z } from "zod";
import { SAVINGS_APY_BY_TERM } from "../config/savings";

const ALLOWED_SAVINGS_TERM_SECONDS = Object.keys(SAVINGS_APY_BY_TERM)
  .map((term) => Number(term))
  .filter((term) => !Number.isNaN(term));

const termSecondsSchema = z
  .coerce.number({ required_error: "term_seconds is required" })
  .int("term_seconds must be an integer")
  .positive("term_seconds must be a positive integer")
  .refine(
    (value) => ALLOWED_SAVINGS_TERM_SECONDS.includes(value),
    {
      message: `term_seconds must be one of: ${ALLOWED_SAVINGS_TERM_SECONDS.join(", ")}`,
    },
  );

const amountStringSchema = z
  .string({ required_error: "Amount is required" })
  .min(1, "Amount cannot be empty")
  .regex(/^[0-9]+(?:\.[0-9]+)?$/, "Amount must be a decimal string");

export const savingsDepositSchema = z.object({
  body: z.object({
    amount: amountStringSchema,
    term_seconds: termSecondsSchema,
  }),
});

export const savingsWithdrawSchema = z.object({
  body: z.object({
    amount: amountStringSchema,
    term_seconds: termSecondsSchema,
  }),
});

export const savingsPositionsSchema = z.object({
  query: z.object({
    term_seconds: z
      .coerce.number()
      .int("term_seconds must be an integer")
      .positive("term_seconds must be a positive integer")
      .refine(
        (value) => ALLOWED_SAVINGS_TERM_SECONDS.includes(value),
        {
          message: `term_seconds must be one of: ${ALLOWED_SAVINGS_TERM_SECONDS.join(", ")}`,
        },
      )
      .optional(),
  }),
});
