import { z } from 'zod';

export const PAYROLL_EXCEPTION_SEVERITIES = ['BLOCKING', 'WARNING'] as const;
export const PAYROLL_EXCEPTION_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'] as const;

export type PayrollExceptionSeverity = (typeof PAYROLL_EXCEPTION_SEVERITIES)[number];
export type PayrollExceptionStatus = (typeof PAYROLL_EXCEPTION_STATUSES)[number];

/** Filters of the exception list. The version defaults to the period's current one. */
export const payrollExceptionListQuerySchema = z
  .object({
    severity: z.enum(PAYROLL_EXCEPTION_SEVERITIES).optional(),
    status: z.enum(PAYROLL_EXCEPTION_STATUSES).optional(),
    calculationVersion: z.coerce.number().int().positive().optional(),
  })
  .strict();

/** Acknowledging or resolving an exception takes a reason. */
export const payrollExceptionDecisionSchema = z
  .object({ reason: z.string().trim().min(1, 'A reason is required.').max(2000) })
  .strict();
