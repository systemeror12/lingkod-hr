import { Prisma } from '@prisma/client';
import { blocking } from './payroll-calculator';
import type { CheckedException, CheckedRun, PayrollCheck } from './payroll-check';

interface OvertimeResultRow {
  employee_id: string;
  payroll_employee_id: string;
  overtime: string;
  basic_salary: string;
  employee_cap_share: string;
  agency_cap_share: string;
  payroll_line_ids: string[];
}

interface PriorRow {
  employee_id: string;
  overtime: string;
  basic_salary: string;
}

const AUTHORITY = 'CSC-DBM JC No. 2, s. 2015';

/** A share as a percentage for a message: `0.05` reads `5%`. */
const percent = (share: Prisma.Decimal) => `${share.mul(100).toString()}%`;

/**
 * The annual Overtime Pay caps (research overtime-coc-cto-authorities.md,
 * "Overtime Pay limits for #347"), judged over each `CALCULATED` result that
 * pays `OVERTIME_PAY`. Both block.
 *
 * - `OVERTIME_PAY_AGENCY_CAP_UNVERIFIED`: item 10.7 caps the Agency's
 *   Overtime Pay for the year at 5% of its Personnel Services budget, and the
 *   DBM approves each grant above it. LingkodHR records neither the budget nor
 *   a DBM approval, so no Overtime Pay can be shown within the cap.
 * - `OVERTIME_PAY_EMPLOYEE_ANNUAL_CAP`: item 10.6 caps a year's Overtime Pay
 *   at 50% of the Employee's total basic salary for the year. That total is
 *   known only when the year ends, so the pay is within the cap for certain
 *   only while the year's Overtime Pay so far stays within the share of the
 *   basic salary paid so far: this period's and every `FINALIZED` period's of
 *   the same calendar year, basic salary less salary for days without pay.
 *   Anything past that blocks rather than guess the rest of the year. The
 *   year is the period's own (_reading_: the circular counts pay "in a year").
 *   Only one regular period is open at a time, so no other period of the year
 *   holds unfinalized pay.
 *
 * The shares come from the rule versions of the lines; where they differ, the
 * smallest applies.
 */
export class OvertimePayCapsCheck implements PayrollCheck {
  async check(transaction: Prisma.TransactionClient, run: CheckedRun): Promise<CheckedException[]> {
    if (run.runType !== 'REGULAR') return [];
    const results = await transaction.$queryRaw<OvertimeResultRow[]>`
      SELECT e."employee_id", e."id" AS "payroll_employee_id",
             sum(l."amount") FILTER (WHERE c."code" = 'OVERTIME_PAY')::text AS "overtime",
             (COALESCE(sum(l."amount") FILTER (WHERE c."code" = 'BASIC_SALARY'), 0)
               - COALESCE(sum(l."amount") FILTER (WHERE c."code" = 'DAYS_WITHOUT_PAY'), 0))::text
               AS "basic_salary",
             min((v."parameters"->>'employeeAnnualCapShare')::numeric)::text AS "employee_cap_share",
             min((v."parameters"->>'agencyAnnualCapShare')::numeric)::text AS "agency_cap_share",
             array_agg(l."id"::text ORDER BY l."id") FILTER (WHERE c."code" = 'OVERTIME_PAY')
               AS "payroll_line_ids"
      FROM "payroll_employees" e
      JOIN "payroll_lines" l ON l."agency_id" = e."agency_id" AND l."payroll_employee_id" = e."id"
      JOIN "pay_components" c ON c."id" = l."pay_component_id"
      LEFT JOIN "national_payroll_rule_versions" v
        ON v."id" = l."rule_version_id" AND c."code" = 'OVERTIME_PAY'
      WHERE e."agency_id" = CAST(${run.agencyId} AS uuid)
        AND e."payroll_period_id" = CAST(${run.payrollPeriodId} AS uuid)
        AND e."calculation_version" = ${run.calculationVersion}
        AND e."status" = 'CALCULATED'
      GROUP BY e."employee_id", e."id"
      HAVING count(*) FILTER (WHERE c."code" = 'OVERTIME_PAY') > 0
      ORDER BY e."employee_id"
    `;
    if (results.length === 0) return [];

    const year = run.periodFrom.slice(0, 4);
    const prior = new Map(
      (
        await transaction.$queryRaw<PriorRow[]>`
          SELECT e."employee_id",
                 COALESCE(sum(l."amount") FILTER (WHERE c."code" = 'OVERTIME_PAY'), 0)::text
                   AS "overtime",
                 (COALESCE(sum(l."amount") FILTER (WHERE c."code" = 'BASIC_SALARY'), 0)
                   - COALESCE(sum(l."amount") FILTER (WHERE c."code" = 'DAYS_WITHOUT_PAY'), 0))::text
                   AS "basic_salary"
          FROM "payroll_periods" p
          JOIN "payroll_employees" e
            ON e."agency_id" = p."agency_id" AND e."payroll_period_id" = p."id"
           AND e."calculation_version" = p."calculation_version"
          JOIN "payroll_lines" l ON l."agency_id" = e."agency_id" AND l."payroll_employee_id" = e."id"
          JOIN "pay_components" c ON c."id" = l."pay_component_id"
          WHERE p."agency_id" = CAST(${run.agencyId} AS uuid)
            AND p."status" = 'FINALIZED'
            AND p."id" <> CAST(${run.payrollPeriodId} AS uuid)
            AND p."period_from" BETWEEN CAST(${`${year}-01-01`} AS date)
                                    AND CAST(${`${year}-12-31`} AS date)
            AND e."employee_id"::text = ANY(${results.map((row) => row.employee_id)})
          GROUP BY e."employee_id"
        `
      ).map((row) => [row.employee_id, row]),
    );

    return results.flatMap((row) => {
      const overtime = new Prisma.Decimal(row.overtime);
      const agencyShare = new Prisma.Decimal(row.agency_cap_share);
      const employeeShare = new Prisma.Decimal(row.employee_cap_share);
      const lines = {
        payrollEmployeeId: row.payroll_employee_id,
        payrollLineIds: row.payroll_line_ids,
      };
      const exceptions: CheckedException[] = [
        {
          employeeId: row.employee_id,
          ...blocking(
            'OVERTIME_PAY_AGENCY_CAP_UNVERIFIED',
            `${AUTHORITY} item 10.7 caps the Agency's Overtime Pay for the year at ${percent(agencyShare)} of its total Personnel Services budget, and any grant above it needs the DBM's approval. LingkodHR records neither the Agency's Personnel Services budget nor a DBM approval, so this ${overtime.toString()} of Overtime Pay cannot be shown within the cap.`,
            {
              ...lines,
              overtime: overtime.toString(),
              agencyAnnualCapShare: agencyShare.toString(),
            },
          ),
        },
      ];

      const before = prior.get(row.employee_id);
      const priorOvertime = new Prisma.Decimal(before?.overtime ?? 0);
      const yearOvertime = priorOvertime.add(overtime);
      const yearBasicSalary = new Prisma.Decimal(before?.basic_salary ?? 0).add(row.basic_salary);
      const ceiling = yearBasicSalary.mul(employeeShare);
      if (yearOvertime.gt(ceiling)) {
        exceptions.push({
          employeeId: row.employee_id,
          ...blocking(
            'OVERTIME_PAY_EMPLOYEE_ANNUAL_CAP',
            `Overtime Pay of ${yearOvertime.toString()} in ${year}, ${priorOvertime.toString()} in finalized payrolls and ${overtime.toString()} here, exceeds ${percent(employeeShare)} of the ${yearBasicSalary.toString()} basic salary paid in ${year} so far. ${AUTHORITY} item 10.6 caps a year's Overtime Pay at ${percent(employeeShare)} of the year's total basic salary, which is not known until the year ends, so this pay cannot be shown within the cap.`,
            {
              ...lines,
              year,
              overtime: overtime.toString(),
              priorOvertime: priorOvertime.toString(),
              yearBasicSalary: yearBasicSalary.toString(),
              employeeAnnualCapShare: employeeShare.toString(),
            },
          ),
        });
      }
      return exceptions;
    });
  }
}
