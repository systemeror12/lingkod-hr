import type { Prisma } from '@prisma/client';
import { blocking } from './payroll-calculator';
import {
  type CheckedException,
  type CheckedRun,
  type PayrollCheck,
  resultsOf,
} from './payroll-check';

/**
 * Negative net pay blocks (#623): a result whose deductions exceed its gross.
 * No authority found addresses negative net pay, so its severity is the
 * developer's ruling, and a period never proceeds with one.
 */
export class NetPayNegativeCheck implements PayrollCheck {
  async check(transaction: Prisma.TransactionClient, run: CheckedRun): Promise<CheckedException[]> {
    const negative = await transaction.payrollEmployee.findMany({
      where: { ...resultsOf(run), netAmount: { lt: 0 } },
      orderBy: { employeeId: 'asc' },
      select: {
        id: true,
        employeeId: true,
        grossAmount: true,
        totalDeductions: true,
        netAmount: true,
      },
    });
    return negative.map((result) => ({
      employeeId: result.employeeId,
      ...blocking(
        'NET_PAY_NEGATIVE',
        `Net pay is ${result.netAmount.toString()}: deductions of ${result.totalDeductions.toString()} exceed gross pay of ${result.grossAmount.toString()}.`,
        {
          payrollEmployeeId: result.id,
          grossAmount: result.grossAmount.toString(),
          totalDeductions: result.totalDeductions.toString(),
          netAmount: result.netAmount.toString(),
        },
      ),
    }));
  }
}
