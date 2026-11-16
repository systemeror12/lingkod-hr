import type { Prisma } from '@prisma/client';
import { BasicSalaryMissingCheck } from './basic-salary-missing.check';
import { ContributionBillingCheck } from './contribution-billing.check';
import { NetPayNegativeCheck } from './net-pay-negative.check';
import { NetPayVarianceCheck } from './net-pay-variance.check';
import { OvertimePayCapsCheck } from './overtime-pay-caps.check';
import type { CheckedException, CheckedRun, PayrollCheck } from './payroll-check';
import { PayrollLineDuplicateCheck } from './payroll-line-duplicate.check';

const CHECKS: readonly PayrollCheck[] = [
  new NetPayNegativeCheck(),
  new BasicSalaryMissingCheck(),
  new PayrollLineDuplicateCheck(),
  new NetPayVarianceCheck(),
  new OvertimePayCapsCheck(),
  new ContributionBillingCheck(),
];

/**
 * Run every check over a stored calculation version and write the exceptions
 * they raise, `OPEN`. Returns how many block, so the calculation can return
 * the period to `DRAFT`. The exceptions are not part of a result's
 * calculation hash: a check judges the result, it does not decide it.
 */
export async function runPayrollChecks(
  transaction: Prisma.TransactionClient,
  run: CheckedRun,
): Promise<{ blocking: number }> {
  const exceptions: CheckedException[] = [];
  for (const check of CHECKS) exceptions.push(...(await check.check(transaction, run)));
  await transaction.payrollException.createMany({
    data: exceptions.map((exception) => ({
      agencyId: run.agencyId,
      payrollPeriodId: run.payrollPeriodId,
      calculationVersion: run.calculationVersion,
      employeeId: exception.employeeId,
      exceptionType: exception.exceptionType,
      severity: exception.severity,
      status: 'OPEN',
      details: exception.details as Prisma.InputJsonObject,
    })),
  });
  return { blocking: exceptions.filter((exception) => exception.severity === 'BLOCKING').length };
}
