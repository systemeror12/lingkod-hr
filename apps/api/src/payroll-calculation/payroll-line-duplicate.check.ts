import type { Prisma } from '@prisma/client';
import { blocking } from './payroll-calculator';
import type { CheckedException, CheckedRun, PayrollCheck } from './payroll-check';

interface DuplicateRow {
  employee_id: string;
  payroll_employee_id: string;
  component_code: string;
  line_type: string;
  amount: string;
  line_ids: string[];
}

/**
 * Duplicates (#623): two lines of one result that agree in every calculated
 * value, namely component, line type, rule version, quantity, rate, amount,
 * and source, pay the same thing twice. Lines from different sources differ in
 * their source, so a correct calculation never writes one. It blocks.
 *
 * The schema already refuses the other duplicates: a second result for an
 * Employee in one version, a second Employee for one person in an Agency, and
 * a second regular period for one month.
 */
export class PayrollLineDuplicateCheck implements PayrollCheck {
  async check(transaction: Prisma.TransactionClient, run: CheckedRun): Promise<CheckedException[]> {
    const duplicates = await transaction.$queryRaw<DuplicateRow[]>`
      SELECT e."employee_id", e."id" AS "payroll_employee_id", c."code" AS "component_code",
             l."line_type", l."amount"::text AS "amount",
             array_agg(l."id"::text ORDER BY l."id") AS "line_ids"
      FROM "payroll_lines" l
      JOIN "payroll_employees" e ON e."agency_id" = l."agency_id" AND e."id" = l."payroll_employee_id"
      JOIN "pay_components" c ON c."id" = l."pay_component_id"
      WHERE e."agency_id" = CAST(${run.agencyId} AS uuid)
        AND e."payroll_period_id" = CAST(${run.payrollPeriodId} AS uuid)
        AND e."calculation_version" = ${run.calculationVersion}
      GROUP BY e."employee_id", e."id", c."code", l."line_type", l."rule_version_id",
               l."quantity", l."rate", l."amount", l."source_snapshot"
      HAVING count(*) > 1
      ORDER BY e."employee_id", c."code", l."line_type"
    `;
    return duplicates.map((row) => ({
      employeeId: row.employee_id,
      ...blocking(
        'PAYROLL_LINE_DUPLICATE',
        `${row.line_ids.length} identical ${row.component_code} ${row.line_type} lines of ${row.amount} pay the same source more than once.`,
        {
          payrollEmployeeId: row.payroll_employee_id,
          componentCode: row.component_code,
          lineType: row.line_type,
          amount: row.amount,
          payrollLineIds: row.line_ids,
        },
      ),
    }));
  }
}
