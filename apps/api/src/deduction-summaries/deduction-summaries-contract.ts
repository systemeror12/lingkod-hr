import { Prisma } from '@prisma/client';
import { canonicalJson } from '../payroll-calculation/calculation-hash';
import { sha256 } from '../contribution-remittances/contribution-remittance-contract';

/** The contract version this code renders; migration 0200 defines it. */
export const DEDUCTION_SUMMARIES_CONTRACT = {
  code: 'DEDUCTION_SUMMARIES',
  version: 1,
} as const;

/**
 * Contract version 1's statement, verbatim: the artifacts are no BIR form,
 * return, or filing, and remit nothing to any payee (PAY-009, PAY-010, #617).
 */
export const DEDUCTION_SUMMARIES_STATEMENT =
  'This Structured Export is HRIS payroll data from one finalized payroll, for review. It is not a BIR form, return, certificate, or filing, and not a remittance to any payee. It does not claim that any tax or deduction was filed, remitted, or received, and does not follow the format of the BIR or any other issuer.';

/** The FINALIZED period the artifacts state. */
export interface DeductionSummariesPeriod {
  id: string;
  code: string;
  runType: string;
  periodFrom: string;
  periodTo: string;
  paymentDate: string;
  calculationVersion: number;
  finalizedAt: string;
}

interface EmployeeRef {
  payrollEmployeeId: string;
  agencyEmployeeNumber: string;
  employeeName: string;
}

/** One Tax Line of a FINALIZED result. */
export interface TaxSourceLine extends EmployeeRef {
  taxLineId: string;
  taxableCompensation: string;
  nonTaxableCompensation: string;
  withholdingTax: string;
  /** The year-end adjustment's reason, `YEAR_END` or `SEPARATION`; null in any other period. */
  yearEndAdjustment: string | null;
  ruleVersionId: string;
  ruleVersionCode: string;
}

/** One Loan Deduction Line of a FINALIZED result, with its obligation's payee. */
export interface LoanDeductionSourceLine extends EmployeeRef {
  loanDeductionLineId: string;
  deductionObligationId: string;
  payeeCategory: string;
  payeeName: string;
  issuerReference: string;
  amountDue: string;
  deductedAmount: string;
  notDeductedAmount: string;
}

/** One `DEDUCTION` Payroll Line of a FINALIZED result. */
export interface DeductionSourceLine extends EmployeeRef {
  payrollLineId: string;
  componentCode: string;
  componentName: string;
  amount: string;
  payrollAdjustmentId: string | null;
}

export interface TaxSummaryTotals {
  lineCount: number;
  taxableCompensationTotal: string;
  nonTaxableCompensationTotal: string;
  withholdingTaxTotal: string;
}

export interface LoanRemittanceTotals {
  lineCount: number;
  amountDueTotal: string;
  deductedTotal: string;
  notDeductedTotal: string;
}

export interface DeductionRegisterTotals {
  lineCount: number;
  amountTotal: string;
}

export interface PlannedArtifact<Totals> {
  content: string;
  checksum: string;
  totals: Totals;
}

export interface DeductionSummariesPlan {
  taxSummary: PlannedArtifact<TaxSummaryTotals>;
  loanRemittanceSummary: PlannedArtifact<LoanRemittanceTotals & { payeeCount: number }>;
  deductionRegister: PlannedArtifact<DeductionRegisterTotals & { employeeCount: number }>;
}

/**
 * Render the Tax Summary, the Loan Remittance Summary by payee, and the
 * Deduction Register from a finalized payroll's Tax Lines, Loan Deduction
 * Lines, and `DEDUCTION` Payroll Lines. Each lists every line it reads and
 * totals exactly those lines; every group's total is the sum of its lines,
 * and every artifact's total the sum of its groups. A payroll with no line
 * of a kind still gets that artifact, with zero totals.
 */
export function planDeductionSummaries(input: {
  agencyId: string;
  summaryId: string;
  generatedAt: string;
  period: DeductionSummariesPeriod;
  taxLines: readonly TaxSourceLine[];
  loanDeductionLines: readonly LoanDeductionSourceLine[];
  deductionLines: readonly DeductionSourceLine[];
}): DeductionSummariesPlan {
  const header = {
    contract: DEDUCTION_SUMMARIES_CONTRACT,
    statement: DEDUCTION_SUMMARIES_STATEMENT,
    agencyId: input.agencyId,
    deductionSummaryId: input.summaryId,
    generatedAt: input.generatedAt,
    payrollPeriod: input.period,
  };
  return {
    taxSummary: taxSummary(header, input.taxLines),
    loanRemittanceSummary: loanRemittanceSummary(header, input.loanDeductionLines),
    deductionRegister: deductionRegister(header, input.deductionLines),
  };
}

function taxSummary(
  header: object,
  source: readonly TaxSourceLine[],
): PlannedArtifact<TaxSummaryTotals> {
  const lines = [...source].sort(byEmployee).map((line) => ({
    taxLineId: line.taxLineId,
    ...employeeOf(line),
    taxableCompensation: amount(line.taxableCompensation),
    nonTaxableCompensation: amount(line.nonTaxableCompensation),
    withholdingTax: amount(line.withholdingTax),
    yearEndAdjustment: line.yearEndAdjustment,
    ruleVersion: { id: line.ruleVersionId, code: line.ruleVersionCode },
  }));
  const totals = {
    lineCount: lines.length,
    taxableCompensationTotal: sum(lines.map((line) => line.taxableCompensation)),
    nonTaxableCompensationTotal: sum(lines.map((line) => line.nonTaxableCompensation)),
    withholdingTaxTotal: sum(lines.map((line) => line.withholdingTax)),
  };
  return artifact({ ...header, artifact: 'TAX_SUMMARY', lines, totals }, totals);
}

/**
 * One group per payee: the obligation's payee category and payee name, the
 * name compared without case as the obligation stores it (citext). No
 * category is special, so any payee an obligation names gets its own group.
 */
function loanRemittanceSummary(
  header: object,
  source: readonly LoanDeductionSourceLine[],
): PlannedArtifact<LoanRemittanceTotals & { payeeCount: number }> {
  const groups = new Map<string, LoanDeductionSourceLine[]>();
  for (const line of source) {
    const key = `${line.payeeCategory}\u0000${line.payeeName.toLowerCase()}`;
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }
  const payees = [...groups.entries()]
    .sort(([left], [right]) => compare(left, right))
    .map(([, group]) => {
      const lines = [...group]
        .sort(
          (left, right) =>
            byEmployee(left, right) ||
            compare(left.issuerReference, right.issuerReference) ||
            compare(left.loanDeductionLineId, right.loanDeductionLineId),
        )
        .map((line) => ({
          loanDeductionLineId: line.loanDeductionLineId,
          deductionObligationId: line.deductionObligationId,
          issuerReference: line.issuerReference,
          ...employeeOf(line),
          amountDue: amount(line.amountDue),
          deductedAmount: amount(line.deductedAmount),
          notDeductedAmount: amount(line.notDeductedAmount),
        }));
      return {
        payeeCategory: group[0]!.payeeCategory,
        // The first spelling in code-unit order, so the name never depends on row order.
        payeeName: group.map((line) => line.payeeName).sort(compare)[0]!,
        lines,
        totals: loanTotals(lines),
      };
    });
  const totals = {
    payeeCount: payees.length,
    ...loanTotals(payees.flatMap((payee) => payee.lines)),
  };
  return artifact({ ...header, artifact: 'LOAN_REMITTANCE_SUMMARY', payees, totals }, totals);
}

function loanTotals(
  lines: readonly { amountDue: string; deductedAmount: string; notDeductedAmount: string }[],
): LoanRemittanceTotals {
  return {
    lineCount: lines.length,
    amountDueTotal: sum(lines.map((line) => line.amountDue)),
    deductedTotal: sum(lines.map((line) => line.deductedAmount)),
    notDeductedTotal: sum(lines.map((line) => line.notDeductedAmount)),
  };
}

/** Each Employee's deduction lines, then each pay component's totals. */
function deductionRegister(
  header: object,
  source: readonly DeductionSourceLine[],
): PlannedArtifact<DeductionRegisterTotals & { employeeCount: number }> {
  const sorted = [...source].sort(
    (left, right) =>
      byEmployee(left, right) ||
      compare(left.componentCode, right.componentCode) ||
      compare(left.payrollLineId, right.payrollLineId),
  );
  const employees = new Map<string, DeductionSourceLine[]>();
  for (const line of sorted) {
    employees.set(line.payrollEmployeeId, [...(employees.get(line.payrollEmployeeId) ?? []), line]);
  }
  const employeeEntries = [...employees.values()].map((group) => {
    const lines = group.map((line) => ({
      payrollLineId: line.payrollLineId,
      componentCode: line.componentCode,
      componentName: line.componentName,
      amount: amount(line.amount),
      payrollAdjustmentId: line.payrollAdjustmentId,
    }));
    return { ...employeeOf(group[0]!), lines, totals: registerTotals(lines) };
  });

  const components = new Map<string, DeductionSourceLine[]>();
  for (const line of sorted) {
    components.set(line.componentCode, [...(components.get(line.componentCode) ?? []), line]);
  }
  const componentEntries = [...components.entries()]
    .sort(([left], [right]) => compare(left, right))
    .map(([componentCode, group]) => ({
      componentCode,
      componentName: group[0]!.componentName,
      ...registerTotals(group),
    }));

  const totals = { employeeCount: employeeEntries.length, ...registerTotals(sorted) };
  return artifact(
    {
      ...header,
      artifact: 'DEDUCTION_REGISTER',
      employees: employeeEntries,
      components: componentEntries,
      totals,
    },
    totals,
  );
}

function registerTotals(lines: readonly { amount: string }[]): DeductionRegisterTotals {
  return { lineCount: lines.length, amountTotal: sum(lines.map((line) => line.amount)) };
}

function artifact<Totals>(value: unknown, totals: Totals): PlannedArtifact<Totals> {
  const content = canonicalJson(value);
  return { content, checksum: sha256(content), totals };
}

function employeeOf(line: EmployeeRef): EmployeeRef {
  return {
    payrollEmployeeId: line.payrollEmployeeId,
    agencyEmployeeNumber: line.agencyEmployeeNumber,
    employeeName: line.employeeName,
  };
}

function byEmployee(left: EmployeeRef, right: EmployeeRef): number {
  return (
    compare(left.agencyEmployeeNumber, right.agencyEmployeeNumber) ||
    compare(left.payrollEmployeeId, right.payrollEmployeeId)
  );
}

/** Code-unit order, so the order never depends on a locale. */
function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Four places, as the source lines store amounts. */
function amount(value: string): string {
  return new Prisma.Decimal(value).toFixed(4);
}

function sum(amounts: readonly string[]): string {
  return amounts.reduce((total, value) => total.add(value), new Prisma.Decimal(0)).toFixed(4);
}
