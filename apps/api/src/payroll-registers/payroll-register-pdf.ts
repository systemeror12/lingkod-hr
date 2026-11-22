import type {
  ClassifiedPayrollExportLine,
  PayrollExportReconciliation,
} from '../payroll-periods/payroll-export-reconciliation';
import { money } from '../payslips/payslip-pdf';

/** One FINALIZED Payroll Employee Result as the register lists it. */
export interface PayrollRegisterRow {
  employeeNumber: string;
  legalName: string;
  grossAmount: string;
  totalDeductions: string;
  netAmount: string;
}

/** What one Payroll Register states: a finalized period, its results, and their reconciled totals. */
export interface PayrollRegisterStatement {
  agencyName: string;
  period: {
    code: string;
    runType: string;
    periodFrom: string;
    periodTo: string;
    paymentDate: string;
    finalizedAt: string;
    calculationVersion: number;
    calculationHash: string;
  };
  /** In agency employee number order. */
  rows: PayrollRegisterRow[];
  components: ClassifiedPayrollExportLine[];
  totals: PayrollExportReconciliation;
}

const SECTIONS = [
  ['EARNING', 'Earnings'],
  ['DEDUCTION', 'Deductions'],
  ['EMPLOYER_SHARE', 'Employer shares (paid by the Agency, not deducted from pay)'],
  ['INFORMATIONAL', 'Informational (does not change pay)'],
] as const;

/**
 * The Payroll Register's text, top to bottom. It is LingkodHR's own
 * Printable System View (#617): no form number, form title, or claim to
 * conform to a COA or BIR format. It lists each FINALIZED result's gross,
 * deductions, and net, then each pay component's total by line type, then
 * the period's totals, all as the Payroll Export Reconciliation proved them.
 */
export function payrollRegisterText(statement: PayrollRegisterStatement): string[] {
  const { period, totals } = statement;
  const text = [
    'PAYROLL REGISTER',
    statement.agencyName,
    'A LingkodHR Printable System View. It lists the finalized Payroll Employee Results of one Payroll Period. It is not proof of payment and is not a prescribed government form.',
    '',
    `Payroll Period: ${period.code}, ${period.runType}, ${period.periodFrom} to ${period.periodTo}`,
    `Payment date: ${period.paymentDate}. Finalized: ${period.finalizedAt}.`,
    `Calculation version ${period.calculationVersion}, hash ${period.calculationHash}`,
    '',
    `EMPLOYEES (${totals.resultCount})`,
  ];
  for (const row of statement.rows) {
    text.push(
      `${row.employeeNumber}  ${row.legalName}`,
      `    Gross PHP ${money(row.grossAmount)}  Deductions PHP ${money(row.totalDeductions)}  Net PHP ${money(row.netAmount)}`,
    );
  }
  text.push('', 'COMPONENT TOTALS');
  for (const [kind, title] of SECTIONS) {
    const lines = statement.components.filter((line) => line.componentKind === kind);
    if (lines.length === 0) continue;
    text.push(title);
    for (const line of lines) {
      const count = `${line.sourceLineCount} ${line.sourceLineCount === 1 ? 'line' : 'lines'}`;
      text.push(
        `    ${line.payComponentName} (${line.payComponentCode}): PHP ${money(line.amount)}, ${count}`,
      );
    }
  }
  text.push(
    '',
    'TOTALS',
    `Gross earnings: PHP ${money(totals.grossAmount)}`,
    `Total deductions: PHP ${money(totals.totalDeductions)}`,
    `Net pay: PHP ${money(totals.netAmount)}`,
    `Employer shares: PHP ${money(totals.employerShareAmount)}`,
    `Informational: PHP ${money(totals.informationalAmount)}`,
  );
  return text;
}
