import type { Prisma } from '@prisma/client';
import {
  type CheckedException,
  type CheckedRun,
  type PayrollCheck,
  resultsOf,
} from './payroll-check';

/**
 * Variance warns (#623, developer's ruling): an Employee whose net pay differs
 * at all from their result in the Agency's last `FINALIZED` regular Payroll
 * Period before this one. There is no threshold. It compares only regular
 * runs, and only `CALCULATED` results, since an `EXCEPTION` result calculated
 * no amount. With no finalized prior period, or no prior result for the
 * Employee, such as a new hire, there is nothing to compare and no warning.
 */
export class NetPayVarianceCheck implements PayrollCheck {
  async check(transaction: Prisma.TransactionClient, run: CheckedRun): Promise<CheckedException[]> {
    if (run.runType !== 'REGULAR') return [];
    const prior = await transaction.payrollPeriod.findFirst({
      where: {
        agencyId: run.agencyId,
        runType: 'REGULAR',
        status: 'FINALIZED',
        periodFrom: { lt: new Date(`${run.periodFrom}T00:00:00.000Z`) },
      },
      orderBy: { periodFrom: 'desc' },
      select: { id: true, code: true, calculationVersion: true },
    });
    if (!prior) return [];

    const priorNet = new Map(
      (
        await transaction.payrollEmployee.findMany({
          where: {
            agencyId: run.agencyId,
            payrollPeriodId: prior.id,
            calculationVersion: prior.calculationVersion,
          },
          select: { employeeId: true, netAmount: true },
        })
      ).map((result) => [result.employeeId, result.netAmount]),
    );
    const current = await transaction.payrollEmployee.findMany({
      where: { ...resultsOf(run), status: 'CALCULATED' },
      orderBy: { employeeId: 'asc' },
      select: { id: true, employeeId: true, netAmount: true },
    });
    return current.flatMap((result) => {
      const before = priorNet.get(result.employeeId);
      if (!before || before.equals(result.netAmount)) return [];
      const difference = result.netAmount.sub(before);
      return [
        {
          employeeId: result.employeeId,
          exceptionType: 'NET_PAY_VARIANCE',
          severity: 'WARNING' as const,
          details: {
            message: `Net pay is ${result.netAmount.toString()}, ${difference.isPositive() ? 'up' : 'down'} ${difference.abs().toString()} from ${before.toString()} in Payroll Period ${prior.code}.`,
            payrollEmployeeId: result.id,
            netAmount: result.netAmount.toString(),
            priorNetAmount: before.toString(),
            difference: difference.toString(),
            priorPayrollPeriodId: prior.id,
            priorCalculationVersion: prior.calculationVersion,
          },
        },
      ];
    });
  }
}
