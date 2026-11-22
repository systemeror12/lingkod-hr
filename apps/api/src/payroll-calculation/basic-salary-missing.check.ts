import type { Prisma } from '@prisma/client';
import { BASIC_SALARY_COMPONENT_CODE } from './basic-salary.calculator';
import { blocking } from './payroll-calculator';
import {
  type CheckedException,
  type CheckedRun,
  type PayrollCheck,
  resultsOf,
} from './payroll-check';

/**
 * Missing data (#623): a regular period pays basic salary (BRD PAY-003), and a
 * calculator that cannot settle a line blocks instead of writing none. So a
 * `CALCULATED` result of a regular period with no basic salary earning line is
 * missing its salary, and blocks rather than paying the rest without it.
 *
 * A result that carries Payroll Adjustments for an Employee with no service
 * in the period holds only the adjustment lines (#356), so it is not checked,
 * and an adjustment's basic salary difference is not the period's salary.
 */
export class BasicSalaryMissingCheck implements PayrollCheck {
  async check(transaction: Prisma.TransactionClient, run: CheckedRun): Promise<CheckedException[]> {
    if (run.runType !== 'REGULAR') return [];
    const component = await transaction.payComponent.findUniqueOrThrow({
      where: { code: BASIC_SALARY_COMPONENT_CODE },
      select: { id: true },
    });
    const unserved = await transaction.$queryRaw<{ id: string }[]>`
      SELECT "id"::text FROM "payroll_employees"
      WHERE "agency_id" = CAST(${run.agencyId} AS uuid)
        AND "payroll_period_id" = CAST(${run.payrollPeriodId} AS uuid)
        AND "calculation_version" = ${run.calculationVersion}
        AND NOT jsonb_path_exists("compensation_basis_snapshot", '$.stretches[*].personnel ? (@ != null)')
    `;
    const missing = await transaction.payrollEmployee.findMany({
      where: {
        ...resultsOf(run),
        status: 'CALCULATED',
        id: { notIn: unserved.map((result) => result.id) },
        lines: {
          none: { payComponentId: component.id, lineType: 'EARNING', payrollAdjustmentId: null },
        },
      },
      orderBy: { employeeId: 'asc' },
      select: { id: true, employeeId: true },
    });
    return missing.map((result) => ({
      employeeId: result.employeeId,
      ...blocking(
        'BASIC_SALARY_MISSING',
        'The result has no basic salary line, which every Employee in a regular Payroll Period is paid.',
        { payrollEmployeeId: result.id },
      ),
    }));
  }
}
