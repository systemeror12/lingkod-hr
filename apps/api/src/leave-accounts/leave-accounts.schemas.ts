import { z } from 'zod';

export const leaveAccountIdSchema = z.string().uuid();
export const leaveAccountLedgerEntryIdSchema = z.string().uuid();
export const leaveAccountDateSchema = z.string().date();
export const leaveAccountInstantSchema = z.string().datetime({ offset: true });
export const leaveAccountIdempotencyKeySchema = z.string().trim().min(1).max(200);
export const leaveAccountReasonSchema = z.string().trim().min(1).max(500);
export const leaveAccountStatusSchema = z.enum(['ACTIVE', 'FROZEN', 'CLOSED']);
export const leaveAccountQuantitySchema = z
  .number()
  .finite()
  .min(-99_999_999.9999)
  .max(99_999_999.9999);

export const leaveAccountOpenSchema = z
  .object({
    employeeId: z.string().uuid(),
    leaveTypeId: z.string().uuid(),
    effectiveDate: leaveAccountDateSchema,
    openingQuantity: leaveAccountQuantitySchema.nonnegative(),
    evidenceDocumentId: z.string().uuid(),
    reason: leaveAccountReasonSchema.optional(),
  })
  .strict();

export const leaveAccountFreezeSchema = z
  .object({
    reason: leaveAccountReasonSchema,
  })
  .strict();

export const leaveAccountCloseSchema = z
  .object({
    closedAt: leaveAccountDateSchema,
    reason: leaveAccountReasonSchema,
  })
  .strict();

export const leaveAccountAdjustmentSchema = z
  .object({
    quantity: leaveAccountQuantitySchema.refine((value) => value !== 0, {
      message: 'Enter a non-zero quantity.',
    }),
    effectiveDate: leaveAccountDateSchema,
    authorityDocumentId: z.string().uuid(),
    evidenceDocumentId: z.string().uuid(),
    reason: leaveAccountReasonSchema,
  })
  .strict();

export const leaveAccountReversalSchema = z
  .object({
    authorityDocumentId: z.string().uuid(),
    evidenceDocumentId: z.string().uuid(),
    reason: leaveAccountReasonSchema,
  })
  .strict();
