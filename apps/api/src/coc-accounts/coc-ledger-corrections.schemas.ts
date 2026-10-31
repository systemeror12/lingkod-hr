import { z } from 'zod';

export const cocLedgerIdSchema = z.string().uuid();

export const cocIdempotencyKeySchema = z.string().trim().min(1).max(200);

const correctionFields = {
  reason: z.string().trim().min(1).max(4000),
  supportingDocumentVersionId: z.string().uuid(),
};

export const cocAdjustmentSchema = z
  .object({
    /** Signed as the ledger stores it, so a positive adjustment cannot be expressed. */
    minutes: z
      .string()
      .trim()
      .regex(/^-\d{1,10}(\.\d)?$/, 'Enter negative minutes with at most one decimal place.')
      .refine((value) => Number(value) < 0, 'Enter negative minutes.'),
    /** The COC drawn from; the earliest-expiring when omitted. */
    validUntil: z.string().date().optional(),
    ...correctionFields,
  })
  .strict();

export const cocReversalSchema = z.object(correctionFields).strict();
