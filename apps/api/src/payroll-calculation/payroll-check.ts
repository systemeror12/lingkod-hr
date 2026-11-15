import type { Prisma } from '@prisma/client';
import type { CalculatedException } from './payroll-calculator';

/** The calculation version a check reads, once its results and lines are stored. */
export interface CheckedRun {
  agencyId: string;
  payrollPeriodId: string;
  calculationVersion: number;
  runType: string;
  periodFrom: string;
}

export interface CheckedException extends CalculatedException {
  employeeId: string;
}

/**
 * A check of a calculated payroll (WF-010 step M). Calculators decide lines
 * one Employee at a time; a check reads what the calculation stored, in its
 * transaction, and may compare it with earlier periods. It writes no line.
 */
export interface PayrollCheck {
  check(transaction: Prisma.TransactionClient, run: CheckedRun): Promise<CheckedException[]>;
}

/** Where a check finds the stored results of its run. */
export const resultsOf = (run: CheckedRun) => ({
  agencyId: run.agencyId,
  payrollPeriodId: run.payrollPeriodId,
  calculationVersion: run.calculationVersion,
});
