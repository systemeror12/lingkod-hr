import { z } from 'zod';

export const PAYROLL_RUN_TYPES = ['REGULAR', 'SPECIAL'] as const;
export const PAYROLL_PERIOD_STATUSES = [
  'DRAFT',
  'CALCULATING',
  'FOR_REVIEW',
  'CERTIFIED',
  'APPROVED',
  'FINALIZED',
  'VOIDED',
] as const;

export type PayrollRunType = (typeof PAYROLL_RUN_TYPES)[number];
export type PayrollPeriodStatus = (typeof PAYROLL_PERIOD_STATUSES)[number];

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Enter a valid calendar date.');

const cutoffAt = z.string().datetime({ offset: true });
const reason = z.string().trim().min(1, 'A reason is required.').max(2000);
const rowVersion = z.number().int().positive();

/**
 * A new Payroll Period. A regular period covers one calendar month and names
 * no component; a special period names the components it pays.
 */
export const payrollPeriodCreateSchema = z
  .object({
    code: z.string().trim().min(1).max(50),
    runType: z.enum(PAYROLL_RUN_TYPES),
    periodFrom: isoDate,
    periodTo: isoDate,
    cutoffAt,
    paymentDate: isoDate,
    payComponentIds: z.array(z.string().uuid()).max(100).default([]),
  })
  .strict()
  .refine((value) => value.periodTo >= value.periodFrom, {
    message: 'The period ends on or after it starts.',
    path: ['periodTo'],
  })
  .refine((value) => new Set(value.payComponentIds).size === value.payComponentIds.length, {
    message: 'A component appears once.',
    path: ['payComponentIds'],
  });

export type PayrollPeriodCreateInput = z.input<typeof payrollPeriodCreateSchema>;

export const payrollPeriodCutoffMoveSchema = z.object({ cutoffAt, reason, rowVersion }).strict();

export type PayrollPeriodCutoffMoveInput = z.input<typeof payrollPeriodCutoffMoveSchema>;

export const payrollPeriodCancelSchema = z.object({ reason, rowVersion }).strict();

export type PayrollPeriodCancelInput = z.input<typeof payrollPeriodCancelSchema>;

export const payrollPeriodCalculationStartSchema = z.object({ rowVersion }).strict();

export type PayrollPeriodCalculationStartInput = z.input<
  typeof payrollPeriodCalculationStartSchema
>;

const calculationHash = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'Enter the 64-character calculation hash.');

/**
 * Certify the calculation version, and its hash, that the HR Certifier
 * reviewed. Both bind the certification, so no row version is needed.
 */
export const payrollPeriodCertifySchema = z
  .object({ calculationVersion: z.number().int().positive(), calculationHash })
  .strict();

export type PayrollPeriodCertifyInput = z.input<typeof payrollPeriodCertifySchema>;

/**
 * Approve the period at the row version the Payroll Approver read. Every
 * change to the certification moves the row version, so it binds the
 * certified version, hash, and export the approver saw.
 */
export const payrollPeriodApproveSchema = z.object({ rowVersion }).strict();

export type PayrollPeriodApproveInput = z.input<typeof payrollPeriodApproveSchema>;

/**
 * Revoke a certification, return a period for correction, or return an
 * approved period before finalization, with a reason.
 */
export const payrollPeriodReasonedCommandSchema = z.object({ reason, rowVersion }).strict();

export type PayrollPeriodReasonedCommandInput = z.input<typeof payrollPeriodReasonedCommandSchema>;

export const PAYROLL_EXPORT_CHECKPOINTS = ['BUDGET', 'ACCOUNTING'] as const;

export type PayrollExportCheckpoint = (typeof PAYROLL_EXPORT_CHECKPOINTS)[number];

const externalReference = z.string().trim().min(1, 'Enter the external reference.').max(200);
const evidenceDocumentVersionId = z.string().uuid();

/**
 * A Payroll Export Checkpoint Review of the export named in the route (#29,
 * #637). A confirmation names the external reference and the finalized
 * Document Version that evidences it; a return gives its reason and may name
 * either.
 */
export const payrollCheckpointReviewSchema = z.discriminatedUnion('outcome', [
  z
    .object({ outcome: z.literal('CONFIRMED'), externalReference, evidenceDocumentVersionId })
    .strict(),
  z
    .object({
      outcome: z.literal('RETURNED'),
      reason,
      externalReference: externalReference.optional(),
      evidenceDocumentVersionId: evidenceDocumentVersionId.optional(),
    })
    .strict(),
]);

export type PayrollCheckpointReviewInput = z.input<typeof payrollCheckpointReviewSchema>;
