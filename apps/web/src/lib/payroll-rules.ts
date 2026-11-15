import type { StatusDisplay } from '../components/ui/status-tag';
import { dateLabel } from './overtime-format';

export type RuleKind =
  | 'SALARY_SCHEDULE'
  | 'AUTHORIZED_DEDUCTIONS'
  | 'GSIS_CONTRIBUTION'
  | 'EMPLOYEES_COMPENSATION'
  | 'YEAR_END_BONUS_AND_CASH_GIFT'
  | 'PERA'
  | 'COMMUTABLE_RATA'
  | 'CLOTHING_ALLOWANCE';

/** One National Payroll Rule Version as `GET /national-payroll-rule-versions` lists it. */
export interface RuleVersionSummary {
  id: string;
  ruleKind: RuleKind;
  code: string;
  name: string;
  issuingAuthority: string;
  issuanceReference: string;
  sourceUrl: string;
  verifiedOn: string;
  verifiedBy: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  loadedAt: string;
  supersedes: { id: string; code: string } | null;
  supersededBy: { id: string; code: string; effectiveFrom: string } | null;
  salaryGradeRateCount: number;
}

export interface SalaryGradeRate {
  salaryGrade: number;
  salaryStep: number;
  monthlyRate: string;
}

/** One version as `GET /national-payroll-rule-versions/:id` returns it. */
export interface RuleVersionDetail extends RuleVersionSummary {
  parameters: unknown;
  salaryGradeRates: SalaryGradeRate[];
}

export const ruleKindLabel: Record<RuleKind, string> = {
  SALARY_SCHEDULE: 'Salary schedule',
  AUTHORIZED_DEDUCTIONS: 'Authorized deductions',
  GSIS_CONTRIBUTION: 'GSIS contribution',
  EMPLOYEES_COMPENSATION: "Employees' Compensation",
  YEAR_END_BONUS_AND_CASH_GIFT: 'Year-end bonus and cash gift',
  PERA: 'PERA',
  COMMUTABLE_RATA: 'Commutable RATA',
  CLOTHING_ALLOWANCE: 'Uniform/clothing allowance',
};

/** The payee categories an authorized-deductions version may list, as the API names them. */
export const payeeCategoryLabel: Record<string, string> = {
  BIR: 'BIR',
  PHILHEALTH: 'PhilHealth',
  GSIS: 'GSIS',
  HDMF: 'HDMF (Pag-IBIG)',
  NATIONAL_GOVERNMENT_COA_DECISION: 'National Government under a final COA decision',
  EMPLOYEE_COOPERATIVE_OR_ASSOCIATION: 'Employee cooperative or association',
  EMPLOYEE_PROVIDENT_FUND: 'Employee provident fund',
  GOVERNMENT_FINANCIAL_INSTITUTION: 'Government financial institution',
  LICENSED_INSURER: 'Licensed insurer',
  THRIFT_OR_RURAL_BANK: 'Thrift or rural bank',
};

/** A version's own dates, as loaded: `From Jan 1, 2027 to Dec 31, 2027`. */
export function effectivityLabel(
  version: Pick<RuleVersionSummary, 'effectiveFrom' | 'effectiveTo'>,
): string {
  return version.effectiveTo
    ? `${dateLabel(version.effectiveFrom)} to ${dateLabel(version.effectiveTo)}`
    : `From ${dateLabel(version.effectiveFrom)}`;
}

/** A superseded version reads as replaced, never as current; the successor names its date. */
export function supersessionDisplay(
  version: Pick<RuleVersionSummary, 'supersededBy'>,
): StatusDisplay {
  return version.supersededBy
    ? { label: `Superseded from ${dateLabel(version.supersededBy.effectiveFrom)}`, tone: 'neutral' }
    : { label: 'Not superseded', tone: 'info' };
}

/** The payee categories an authorized-deductions version lists, or none when it lists none. */
export function allowedPayeeCategories(parameters: unknown): string[] {
  const categories = (parameters as { allowedPayeeCategories?: unknown } | null)
    ?.allowedPayeeCategories;
  return Array.isArray(categories)
    ? categories.filter((category): category is string => typeof category === 'string')
    : [];
}

/** One Salary Grade and step with each compared version's rate, `null` where it has none. */
export interface ComparedRate {
  salaryGrade: number;
  salaryStep: number;
  left: string | null;
  right: string | null;
}

/**
 * Line two schedules' rates up by Salary Grade and step, in grade then step order. It only
 * places the loaded values side by side; it derives no amount.
 */
export function compareRates(
  left: readonly SalaryGradeRate[],
  right: readonly SalaryGradeRate[],
): ComparedRate[] {
  const rows = new Map<string, ComparedRate>();
  const row = ({ salaryGrade, salaryStep }: SalaryGradeRate) => {
    const key = `${salaryGrade}:${salaryStep}`;
    const existing = rows.get(key) ?? { salaryGrade, salaryStep, left: null, right: null };
    rows.set(key, existing);
    return existing;
  };
  for (const rate of left) row(rate).left = rate.monthlyRate;
  for (const rate of right) row(rate).right = rate.monthlyRate;
  return [...rows.values()].sort(
    (a, b) => a.salaryGrade - b.salaryGrade || a.salaryStep - b.salaryStep,
  );
}
