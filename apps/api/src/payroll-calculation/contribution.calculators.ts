import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CompensationBasis } from '../compensation-basis/compensation-basis.service';
import { ruleVersionsInEffectDuring } from '../payroll-periods/payroll-rule-snapshots';
import {
  employeesCompensationParameters,
  gsisContributionParameters,
  type NationalPayrollRuleKind,
  pagIbigContributionParameters,
  philHealthContributionParameters,
} from '../payroll-rule-versions/national-payroll-rule-versions';
import { BASIC_SALARY_COMPONENT_CODE } from './basic-salary.calculator';
import {
  blocking,
  type CalculatedException,
  type CalculatedLine,
  type CalculationContext,
  type CalculatorOutcome,
  type ContributionType,
  type FrozenRuleVersion,
  type PayrollCalculator,
} from './payroll-calculator';
import type { TaxTreatment } from './year-end-bonus.calculator';

export const GSIS_PERSONAL_SHARE_COMPONENT_CODE = 'GSIS_PERSONAL_SHARE';
export const GSIS_GOVERNMENT_SHARE_COMPONENT_CODE = 'GSIS_GOVERNMENT_SHARE';
export const EMPLOYEES_COMPENSATION_COMPONENT_CODE = 'EMPLOYEES_COMPENSATION';
export const PHILHEALTH_EMPLOYEE_SHARE_COMPONENT_CODE = 'PHILHEALTH_EMPLOYEE_SHARE';
export const PHILHEALTH_EMPLOYER_SHARE_COMPONENT_CODE = 'PHILHEALTH_EMPLOYER_SHARE';
export const PAGIBIG_EMPLOYEE_SHARE_COMPONENT_CODE = 'PAGIBIG_EMPLOYEE_SHARE';
export const PAGIBIG_EMPLOYER_SHARE_COMPONENT_CODE = 'PAGIBIG_EMPLOYER_SHARE';

/**
 * GSIS contributions (RA No. 8291, sec. 5(a); BRD PAY-004): the personal share
 * as a deduction and the government share as an employer share, each the
 * GSIS version's rate of the month's basic salary. It runs after the basic
 * salary calculator. Every case the recorded rules do not settle blocks:
 *
 * - no GSIS version in effect on every date of the month, or a version that
 *   changes inside it;
 * - service for only part of the month;
 * - a basic salary above the version's AMC limit, where RA 8291 sets another
 *   member share and the base is unsettled (research open question 3);
 * - a share that is not whole centavos, which no recorded rule rounds.
 *
 * With no basic salary line it writes nothing: basic salary's own exception
 * already blocks the Employee.
 */
@Injectable()
export class GsisContributionCalculator implements PayrollCalculator {
  calculate(
    basis: CompensationBasis,
    context: CalculationContext,
    earlierLines: readonly CalculatedLine[],
  ): CalculatorOutcome {
    const base = contributionBase('GSIS', 'GSIS_CONTRIBUTION', basis, context, earlierLines);
    if (!('version' in base)) return base;
    const { version, salary, basicSalary } = base;
    const parameters = gsisContributionParameters.parse(version.parameters);
    const limit = parameters.monthlyCompensationLimit;
    if (limit !== null && salary.gt(limit)) {
      return refuse(
        'GSIS_ABOVE_AMC_LIMIT',
        `The monthly basic salary ${salary.toFixed(2)} is above the AMC limit ${limit} of GSIS version ${version.code}. RA No. 8291 sec. 5(a) sets another member share above the limit, and no recorded rule settles the base there.`,
        { monthlySalary: salary.toFixed(4), monthlyCompensationLimit: limit },
      );
    }
    const personal = shareOf(salary, parameters.employeeRate);
    const government = shareOf(salary, parameters.employerRate);
    const unrounded = [personal, government].filter((share) => !isWholeCentavos(share));
    if (unrounded.length > 0) return refuseRounding('GSIS', salary, unrounded);

    const source = {
      contributionType: 'GSIS',
      basedOn: basicSalary,
      compensationBase: salary.toFixed(4),
      ruleVersionCode: version.code,
      parameters,
    };
    return {
      lines: [
        shareLine(
          GSIS_PERSONAL_SHARE_COMPONENT_CODE,
          'DEDUCTION',
          version,
          salary,
          parameters.employeeRate,
          source,
        ),
        shareLine(
          GSIS_GOVERNMENT_SHARE_COMPONENT_CODE,
          'EMPLOYER_SHARE',
          version,
          salary,
          parameters.employerRate,
          source,
        ),
      ],
      exceptions: [],
      contributions: [
        {
          contributionType: 'GSIS',
          employeeShare: personal.toFixed(4),
          employerShare: government.toFixed(4),
          compensationBase: salary.toFixed(4),
          ruleVersionId: version.id,
        },
      ],
    };
  }
}

/**
 * Employees' Compensation (PD No. 626, art. 181; BRD PAY-004): the version's
 * employer rate of the monthly salary credit, which is the month's basic
 * salary up to the version's ceiling. It is paid entirely by the employer, so
 * it writes an employer share and never a deduction (art. 181(c)). It blocks
 * on the same unsettled cases as GSIS, except the AMC limit.
 */
@Injectable()
export class EmployeesCompensationCalculator implements PayrollCalculator {
  calculate(
    basis: CompensationBasis,
    context: CalculationContext,
    earlierLines: readonly CalculatedLine[],
  ): CalculatorOutcome {
    const base = contributionBase(
      'EMPLOYEES_COMPENSATION',
      'EMPLOYEES_COMPENSATION',
      basis,
      context,
      earlierLines,
    );
    if (!('version' in base)) return base;
    const { version, salary, basicSalary } = base;
    const parameters = employeesCompensationParameters.parse(version.parameters);
    const credit = Prisma.Decimal.min(salary, parameters.monthlySalaryCreditCeiling);
    const share = shareOf(credit, parameters.employerRate);
    if (!isWholeCentavos(share)) return refuseRounding('EMPLOYEES_COMPENSATION', credit, [share]);

    const source = {
      contributionType: 'EMPLOYEES_COMPENSATION',
      basedOn: basicSalary,
      compensationBase: credit.toFixed(4),
      ceilingApplied: credit.lt(salary),
      ruleVersionCode: version.code,
      parameters,
    };
    return {
      lines: [
        shareLine(
          EMPLOYEES_COMPENSATION_COMPONENT_CODE,
          'EMPLOYER_SHARE',
          version,
          credit,
          parameters.employerRate,
          source,
        ),
      ],
      exceptions: [],
      contributions: [
        {
          contributionType: 'EMPLOYEES_COMPENSATION',
          employeeShare: new Prisma.Decimal(0).toFixed(4),
          employerShare: share.toFixed(4),
          compensationBase: credit.toFixed(4),
          ruleVersionId: version.id,
        },
      ],
    };
  }
}

/**
 * The PhilHealth premium (RA No. 11223, sec. 10; PhilHealth Circular No.
 * 2020-0005, Rev. 1; research R19): the version's employee rate as a
 * deduction and its employer rate as an employer share, each of the month's
 * basic salary held between the version's income floor and ceiling. The
 * basic salary line is the Monthly Basic Salary: days without pay are their
 * own deduction line, and the circular keeps such deductions out of the base
 * (sec. IV.F). It blocks on the same unsettled cases as GSIS, except the AMC
 * limit.
 */
@Injectable()
export class PhilHealthContributionCalculator implements PayrollCalculator {
  calculate(
    basis: CompensationBasis,
    context: CalculationContext,
    earlierLines: readonly CalculatedLine[],
  ): CalculatorOutcome {
    const base = contributionBase(
      'PHILHEALTH',
      'PHILHEALTH_CONTRIBUTION',
      basis,
      context,
      earlierLines,
    );
    if (!('version' in base)) return base;
    const { version, salary, basicSalary } = base;
    const parameters = philHealthContributionParameters.parse(version.parameters);
    const premiumBase = Prisma.Decimal.min(
      Prisma.Decimal.max(salary, parameters.monthlyIncomeFloor),
      parameters.monthlyIncomeCeiling,
    );
    const employee = shareOf(premiumBase, parameters.employeeRate);
    const employer = shareOf(premiumBase, parameters.employerRate);
    const unrounded = [employee, employer].filter((share) => !isWholeCentavos(share));
    if (unrounded.length > 0) return refuseRounding('PHILHEALTH', premiumBase, unrounded);

    const source = {
      contributionType: 'PHILHEALTH',
      basedOn: basicSalary,
      compensationBase: premiumBase.toFixed(4),
      floorApplied: premiumBase.gt(salary),
      ceilingApplied: premiumBase.lt(salary),
      ruleVersionCode: version.code,
      parameters,
    };
    return {
      lines: [
        shareLine(
          PHILHEALTH_EMPLOYEE_SHARE_COMPONENT_CODE,
          'DEDUCTION',
          version,
          premiumBase,
          parameters.employeeRate,
          source,
        ),
        shareLine(
          PHILHEALTH_EMPLOYER_SHARE_COMPONENT_CODE,
          'EMPLOYER_SHARE',
          version,
          premiumBase,
          parameters.employerRate,
          source,
        ),
      ],
      exceptions: [],
      contributions: [
        {
          contributionType: 'PHILHEALTH',
          employeeShare: employee.toFixed(4),
          employerShare: employer.toFixed(4),
          compensationBase: premiumBase.toFixed(4),
          ruleVersionId: version.id,
        },
      ],
    };
  }
}

/**
 * Pag-IBIG contributions (RA No. 9679, sec. 7; research R20, R21): the
 * employee share as a deduction and the employer share, each a rate of the
 * fund salary, the month's basic salary up to the version's Maximum Fund
 * Salary. An Employee whose basic salary is not more than the version's lower
 * band pays the lower band's employee rate; the employer rate is the same for
 * every band. It blocks on the same unsettled cases as GSIS, except the AMC
 * limit.
 */
@Injectable()
export class PagIbigContributionCalculator implements PayrollCalculator {
  calculate(
    basis: CompensationBasis,
    context: CalculationContext,
    earlierLines: readonly CalculatedLine[],
  ): CalculatorOutcome {
    const base = contributionBase('PAGIBIG', 'PAGIBIG_CONTRIBUTION', basis, context, earlierLines);
    if (!('version' in base)) return base;
    const { version, salary, basicSalary } = base;
    const parameters = pagIbigContributionParameters.parse(version.parameters);
    const lowerBand = salary.lte(parameters.lowerBandMonthlyCompensation);
    const employeeRate = lowerBand ? parameters.lowerBandEmployeeRate : parameters.employeeRate;
    const fundSalary = Prisma.Decimal.min(salary, parameters.maximumFundSalary);
    const employee = shareOf(fundSalary, employeeRate);
    const employer = shareOf(fundSalary, parameters.employerRate);
    const unrounded = [employee, employer].filter((share) => !isWholeCentavos(share));
    if (unrounded.length > 0) return refuseRounding('PAGIBIG', fundSalary, unrounded);

    const source = {
      contributionType: 'PAGIBIG',
      basedOn: basicSalary,
      compensationBase: fundSalary.toFixed(4),
      lowerBandApplied: lowerBand,
      maximumFundSalaryApplied: fundSalary.lt(salary),
      ruleVersionCode: version.code,
      parameters,
    };
    return {
      lines: [
        shareLine(
          PAGIBIG_EMPLOYEE_SHARE_COMPONENT_CODE,
          'DEDUCTION',
          version,
          fundSalary,
          employeeRate,
          source,
        ),
        shareLine(
          PAGIBIG_EMPLOYER_SHARE_COMPONENT_CODE,
          'EMPLOYER_SHARE',
          version,
          fundSalary,
          parameters.employerRate,
          source,
        ),
      ],
      exceptions: [],
      contributions: [
        {
          contributionType: 'PAGIBIG',
          employeeShare: employee.toFixed(4),
          employerShare: employer.toFixed(4),
          compensationBase: fundSalary.toFixed(4),
          ruleVersionId: version.id,
        },
      ],
    };
  }
}

type BaseOutcome =
  | {
      version: FrozenRuleVersion;
      salary: Prisma.Decimal;
      basicSalary: { componentCode: string; amount: string };
    }
  | CalculatorOutcome;

/**
 * The contribution's rule version and the month's basic salary, or the
 * exceptions that stop it: a partial month, and a version missing, expired,
 * or changing in the month. With no basic salary line it returns no line and
 * no exception.
 */
function contributionBase(
  type: ContributionType,
  ruleKind: NationalPayrollRuleKind,
  basis: CompensationBasis,
  context: CalculationContext,
  earlierLines: readonly CalculatedLine[],
): BaseOutcome {
  const label = contributionLabel[type];
  const exceptions: CalculatedException[] = [];
  const unserved = basis.stretches.filter((stretch) => stretch.personnel === null);
  if (unserved.length > 0) {
    const dates = unserved.map(({ from, to }) => ({ from, to }));
    exceptions.push(
      blocking(
        `${type}_PARTIAL_MONTH`,
        `Served only part of ${context.periodFrom} to ${context.periodTo}. No recorded rule sets the ${label} base for a partial month.`,
        { unservedDates: dates },
      ),
    );
  }

  const versions = context.snapshotRuleVersions.filter((version) => version.ruleKind === ruleKind);
  const coverage = ruleVersionsInEffectDuring(
    ruleKind,
    versions,
    context.periodFrom,
    context.periodTo,
  );
  let version: FrozenRuleVersion | undefined;
  if (coverage.status === 'NOT_IN_EFFECT') {
    exceptions.push(
      blocking(
        `${type}_RULE_NOT_IN_EFFECT`,
        `${coverage.reason} ${label} is not calculated without it.`,
        { ruleKind },
      ),
    );
  } else if (coverage.ruleVersionIds.length > 1) {
    exceptions.push(
      blocking(
        `${type}_RULE_CHANGE_IN_PERIOD`,
        `The ${ruleKind} version changes inside ${context.periodFrom} to ${context.periodTo}. No recorded rule apportions ${label} across a change inside the month.`,
        { ruleVersionIds: coverage.ruleVersionIds },
      ),
    );
  } else {
    version = versions.find((candidate) => candidate.id === coverage.ruleVersionIds[0]);
  }
  if (exceptions.length > 0 || !version) return { lines: [], exceptions };

  const basicSalaries = earlierLines.filter(
    (line) => line.componentCode === BASIC_SALARY_COMPONENT_CODE,
  );
  const [basicSalary, ...more] = basicSalaries;
  if (!basicSalary) return { lines: [], exceptions: [] };
  if (more.length > 0) throw new Error('Basic salary writes at most one line a month.');
  return {
    version,
    salary: new Prisma.Decimal(basicSalary.amount),
    basicSalary: { componentCode: basicSalary.componentCode, amount: basicSalary.amount },
  };
}

const contributionLabel: Record<ContributionType, string> = {
  GSIS: 'GSIS',
  EMPLOYEES_COMPENSATION: "Employees' Compensation",
  PHILHEALTH: 'PhilHealth',
  PAGIBIG: 'Pag-IBIG',
};

const shareOf = (base: Prisma.Decimal, rate: string) => base.mul(rate);

const isWholeCentavos = (amount: Prisma.Decimal) => amount.equals(amount.toDecimalPlaces(2));

/**
 * A share as a line: quantity is the base, so quantity × rate is the amount.
 * Each share is a mandatory contribution; the withholding tax excludes the
 * employee's share from taxable compensation.
 */
function shareLine(
  componentCode: string,
  lineType: 'DEDUCTION' | 'EMPLOYER_SHARE',
  version: FrozenRuleVersion,
  base: Prisma.Decimal,
  rate: string,
  source: Record<string, unknown>,
): CalculatedLine {
  return {
    componentCode,
    lineType,
    ruleVersionId: version.id,
    quantity: base.toFixed(4),
    rate: new Prisma.Decimal(rate).toFixed(8),
    amount: shareOf(base, rate).toFixed(4),
    source: { ...source, taxTreatment: 'MANDATORY_CONTRIBUTION' satisfies TaxTreatment },
  };
}

function refuseRounding(
  type: ContributionType,
  base: Prisma.Decimal,
  shares: Prisma.Decimal[],
): CalculatorOutcome {
  return refuse(
    `${type}_ROUNDING_UNSETTLED`,
    `The share ${shares.map((share) => share.toString()).join(', ')} of the base ${base.toFixed(2)} is not a whole number of centavos, and no recorded rule rounds it.`,
    { compensationBase: base.toFixed(4), shares: shares.map((share) => share.toString()) },
  );
}

const refuse = (
  exceptionType: string,
  message: string,
  details: Record<string, unknown>,
): CalculatorOutcome => ({ lines: [], exceptions: [blocking(exceptionType, message, details)] });
