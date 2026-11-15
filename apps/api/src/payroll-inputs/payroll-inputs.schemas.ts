import { z } from 'zod';

export const PAYROLL_INPUT_SOURCE_MODULES = ['LEAVE', 'OVERTIME'] as const;
export const PAYROLL_INPUT_KINDS = [
  'LEAVE_WITHOUT_PAY',
  'UNPAID_DEFICIT_REMAINDER',
  'MONETIZATION_EARNING',
  'OVERTIME_HOURS',
] as const;
export const PAYROLL_INPUT_STATUSES = ['PENDING', 'CONSUMED', 'CANCELLED'] as const;

export type PayrollInputSourceModule = (typeof PAYROLL_INPUT_SOURCE_MODULES)[number];
export type PayrollInputKind = (typeof PAYROLL_INPUT_KINDS)[number];
export type PayrollInputStatus = (typeof PAYROLL_INPUT_STATUSES)[number];

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Enter a valid calendar date.');

// A positive value that fits numeric(12,4).
const quantity = z
  .string()
  .regex(/^\d{1,8}(\.\d{1,4})?$/, 'Enter a quantity with up to four decimal places.')
  .refine((value) => Number(value) > 0, 'The quantity must be greater than zero.');

/**
 * What a source module sends for one effect: a quantity and its provenance,
 * never a pay component, rate, or amount.
 */
export const payrollInputSubmissionSchema = z
  .object({
    agencyId: z.string().uuid(),
    employeeId: z.string().uuid(),
    sourceModule: z.enum(PAYROLL_INPUT_SOURCE_MODULES),
    inputKind: z.enum(PAYROLL_INPUT_KINDS),
    /** The source's own stable effect key, unique per Agency and source module. */
    sourceKey: z.string().regex(/\S/, 'A stable source key is required.'),
    sourceType: z.string().regex(/\S/, 'A source entity type is required.'),
    sourceId: z.string().uuid(),
    /** The first Work Date, or the valuation date. */
    effectiveDate: isoDate,
    quantity: quantity.nullish(),
    /** The approved source snapshot Payroll freezes with the input. */
    payload: z.record(z.string(), z.json()),
    /** The withdrawn input this one replaces, from the same source effect chain. */
    replacesPayrollInputId: z.string().uuid().nullish(),
  })
  .strict()
  .refine(
    (value) => (value.inputKind === 'OVERTIME_HOURS') === (value.sourceModule === 'OVERTIME'),
    { message: 'Overtime posts only overtime hours.', path: ['inputKind'] },
  );

export type PayrollInputSubmission = z.input<typeof payrollInputSubmissionSchema>;

/** A source module's request to withdraw an input it posted (payroll-schema.md §4). */
export interface PayrollInputWithdrawal {
  agencyId: string;
  sourceModule: PayrollInputSourceModule;
  payrollInputId: string;
  /** The source's stable key for this correction; a retry sends the same key. */
  correctionKey: string;
}

export const payrollInputListFiltersSchema = z
  .object({
    sourceModule: z.enum(PAYROLL_INPUT_SOURCE_MODULES).optional(),
    status: z.enum(PAYROLL_INPUT_STATUSES).optional(),
  })
  .strict();

export type PayrollInputListFilters = z.infer<typeof payrollInputListFiltersSchema>;
