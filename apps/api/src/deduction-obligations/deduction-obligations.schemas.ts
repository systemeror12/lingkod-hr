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

export const recordDeductionObligationSchema = z
  .object({
    payeeCategory: deductionPayeeCategorySchema,
    payeeName: text(255),
    issuerReference: text(100),
    incurredOn: isoDate,
    ...terms,
  })
  .strict();

export const changeDeductionObligationSchema = z.object({ ...terms, reason: text(1000) }).strict();

export const endDeductionObligationSchema = z
  .object({ effectiveTo: isoDate, reason: text(1000) })
  .strict();

export type RecordDeductionObligationInput = z.infer<typeof recordDeductionObligationSchema>;
export type ChangeDeductionObligationInput = z.infer<typeof changeDeductionObligationSchema>;
export type EndDeductionObligationInput = z.infer<typeof endDeductionObligationSchema>;
