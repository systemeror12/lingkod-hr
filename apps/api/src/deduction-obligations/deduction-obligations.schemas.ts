import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { deductionPayeeCategorySchema } from '../payroll-rule-versions/national-payroll-rule-versions';

const text = (maximum: number) => z.string().trim().min(1).max(maximum);
const isoDate = z.iso.date();
const amount = z
  .string()
  .regex(/^\d{1,15}(\.\d{1,4})?$/, 'An amount is a decimal string with up to 4 places.')
  .refine((value) => new Prisma.Decimal(value).gt(0), 'An amount is greater than zero.');

/** The finalized Document Version that authorizes the obligation's terms. */
const authority = {
  authorityDocumentId: z.uuid(),
  authorityDocumentVersionId: z.uuid(),
};

/** The issuer-validated terms a change may replace. */
const terms = {
  outstandingBalance: amount,
  scheduledAmount: amount,
  effectiveFrom: isoDate,
  ...authority,
};

export const deductionObligationIdSchema = z.uuid();
export const payrollAdjustmentIdSchema = z.uuid();

export const recordDeductionObligationSchema = z
  .object({
    payeeCategory: deductionPayeeCategorySchema,
    payeeName: text(255),
    issuerReference: text(100),
    incurredOn: isoDate,
    ...terms,
  })
  .strict();

/**
 * A final and executory COA decision that recovers a negative Payroll
 * Adjustment (#648, ADR 0017). The payee category is always
 * NATIONAL_GOVERNMENT_COA_DECISION, and the balance is the negative net
 * difference Payroll's calculation found, so neither is entered.
 * `scheduledAmount` is the whole amount or the monthly amount COA approved;
 * `incurredOn` is the date the decision became final and executory.
 */
export const recordRecoveryObligationSchema = z
  .object({
    payeeName: text(255),
    issuerReference: text(100),
    incurredOn: isoDate,
    scheduledAmount: amount,
    effectiveFrom: isoDate,
    ...authority,
  })
  .strict();

export const changeDeductionObligationSchema = z.object({ ...terms, reason: text(1000) }).strict();

export const endDeductionObligationSchema = z
  .object({ effectiveTo: isoDate, reason: text(1000) })
  .strict();

export type RecordDeductionObligationInput = z.infer<typeof recordDeductionObligationSchema>;
export type RecordRecoveryObligationInput = z.infer<typeof recordRecoveryObligationSchema>;
export type ChangeDeductionObligationInput = z.infer<typeof changeDeductionObligationSchema>;
export type EndDeductionObligationInput = z.infer<typeof endDeductionObligationSchema>;
