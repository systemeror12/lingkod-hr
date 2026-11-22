import { Prisma } from '@prisma/client';
import { canonicalJson, payrollCalculationHash } from '../payroll-calculation/calculation-hash';
import {
  classifyPayrollExport,
  PayrollExportReconciliationError,
  type ClassifiedPayrollExport,
  type ClassifiedPayrollExportLine,
  type ExportPayComponent,
  type ExportSourceLine,
  type ExportSourceResult,
  type PayrollExportReconciliation,
} from '../payroll-periods/payroll-export-reconciliation';

/** The contract version this code renders; migration 0189 defines it. */
export const ACCOUNTING_SUPPORT_EXPORT_CONTRACT = {
  code: 'FINALIZED_PAYROLL_ACCOUNTING_SUPPORT_EXPORT',
  version: 1,
} as const;

/** Contract version 1's statement, verbatim: no journal entry, no posting, and a download is no outcome (#29). */
export const ACCOUNTING_SUPPORT_EXPORT_STATEMENT =
  'This Structured Export is HRIS payroll data from one finalized payroll result, for accounting support. It is not a journal entry and claims no debit, credit, or posting. Neither generating nor downloading it records that a receiving system received, accepted, or posted it.';

/** The Employee Detail Companion's statement. */
export const EMPLOYEE_DETAIL_COMPANION_STATEMENT =
  'This Employee Detail Companion is employee-level detail of the Finalized Payroll Accounting Support Export it names. It asserts no more than that export does.';

/** One Payroll Employee Result with the Employee it pays, as generation reads it. */
export interface AccountingSupportSourceResult extends ExportSourceResult {
  employeeNumber: string;
  legalName: string;
}

/** What the export states about the finalized payroll it comes from. */
export interface AccountingSupportExportHeader {
  id: string;
  agencyId: string;
  payrollPeriod: {
    id: string;
    code: string;
    runType: string;
    periodFrom: string;
    periodTo: string;
    paymentDate: string;
  };
  finalization: {
    calculationVersion: number;
    calculationHash: string;
    payrollCertificationId: string;
    finalizedAt: string;
  };
}

export interface AccountingSupportExportArtifacts {
  classified: ClassifiedPayrollExport;
  /** The export, as canonical JSON. */
  content: string;
  /** The Employee Detail Companion, as canonical JSON. */
  employeeDetailContent: string;
  employeeDetailChecksum: string;
}

/**
 * Build both artifacts of a Finalized Payroll Accounting Support Export (#29,
 * #355) from the finalized calculation version. The export's Classified
 * Payroll Export Lines and Payroll Export Reconciliation are #636's,
 * unchanged. The Employee Detail Companion classifies each result's lines the
 * same way, and its totals, summed over the employees, must equal the
 * export's. Throws `PayrollExportReconciliationError` on any failure, so
 * nothing is generated from a source that does not reconcile.
 */
export function buildAccountingSupportExport(source: {
  header: AccountingSupportExportHeader;
  results: readonly AccountingSupportSourceResult[];
  lines: readonly ExportSourceLine[];
  components: readonly ExportPayComponent[];
  checksum: (content: string) => string;
}): AccountingSupportExportArtifacts {
  const { header, lines, components } = source;
  const classified = classifyPayrollExport({
    expectedCalculationHash: header.finalization.calculationHash,
    results: source.results,
    lines,
    components,
  });

  const results = [...source.results].sort((a, b) =>
    a.employeeNumber !== b.employeeNumber
      ? compare(a.employeeNumber, b.employeeNumber)
      : compare(a.id, b.id),
  );
  const employees = results.map((result) => {
    const own = classifyPayrollExport({
      expectedCalculationHash: payrollCalculationHash([result]),
      results: [result],
      lines: lines.filter((line) => line.payrollEmployeeId === result.id),
      components,
    });
    return { result, ...own };
  });
  const totals = sumEmployeeDetail(employees);
  if (canonicalJson(totals) !== canonicalJson(classified)) {
    throw new PayrollExportReconciliationError([
      'The Employee Detail Companion’s totals do not equal the export’s.',
    ]);
  }

  const employeeDetailContent = canonicalJson({
    contract: ACCOUNTING_SUPPORT_EXPORT_CONTRACT,
    statement: EMPLOYEE_DETAIL_COMPANION_STATEMENT,
    accountingSupportExportId: header.id,
    agencyId: header.agencyId,
    payrollPeriodId: header.payrollPeriod.id,
    finalization: header.finalization,
    employees: employees.map(({ result, classifiedLines }) => ({
      payrollEmployeeId: result.id,
      employeeId: result.employeeId,
      employeeNumber: result.employeeNumber,
      legalName: result.legalName,
      grossAmount: money(result.grossAmount),
      totalDeductions: money(result.totalDeductions),
      netAmount: money(result.netAmount),
      lines: classifiedLines,
    })),
    totals,
  });
  const employeeDetailChecksum = source.checksum(employeeDetailContent);
  const content = canonicalJson({
    contract: ACCOUNTING_SUPPORT_EXPORT_CONTRACT,
    statement: ACCOUNTING_SUPPORT_EXPORT_STATEMENT,
    ...header,
    ...classified,
    employeeDetailChecksum,
  });
  return { classified, content, employeeDetailContent, employeeDetailChecksum };
}

/**
 * The companion's totals: each employee's classified lines summed by pay
 * component and kind, in the export's line order, and their reconciliations
 * summed. Equal to the export's exactly when every amount is accounted for.
 */
export function sumEmployeeDetail(
  employees: readonly ClassifiedPayrollExport[],
): ClassifiedPayrollExport {
  const lines = new Map<string, { line: ClassifiedPayrollExportLine; amount: Prisma.Decimal }>();
  for (const { classifiedLines } of employees) {
    for (const line of classifiedLines) {
      const key = `${line.payComponentCode}:${line.componentKind}`;
      const total = lines.get(key);
      lines.set(key, {
        line: {
          ...line,
          sourceLineCount: (total?.line.sourceLineCount ?? 0) + line.sourceLineCount,
        },
        amount: (total?.amount ?? new Prisma.Decimal(0)).add(line.amount),
      });
    }
  }
  const kinds = ['EARNING', 'DEDUCTION', 'EMPLOYER_SHARE', 'INFORMATIONAL'];
  const classifiedLines = [...lines.values()]
    .sort((a, b) =>
      a.line.payComponentCode !== b.line.payComponentCode
        ? compare(a.line.payComponentCode, b.line.payComponentCode)
        : kinds.indexOf(a.line.componentKind) - kinds.indexOf(b.line.componentKind),
    )
    .map(({ line, amount }, index) => ({ ...line, lineNo: index + 1, amount: amount.toFixed(4) }));

  const sum = (field: keyof PayrollExportReconciliation) =>
    employees.reduce(
      (total, { reconciliation }) => total.add(reconciliation[field]),
      new Prisma.Decimal(0),
    );
  const count = (field: keyof PayrollExportReconciliation) => sum(field).toNumber();
  return {
    classifiedLines,
    reconciliation: {
      resultCount: count('resultCount'),
      sourceLineCount: count('sourceLineCount'),
      classifiedSourceLineCount: count('classifiedSourceLineCount'),
      grossAmount: sum('grossAmount').toFixed(4),
      totalDeductions: sum('totalDeductions').toFixed(4),
      netAmount: sum('netAmount').toFixed(4),
      employerShareAmount: sum('employerShareAmount').toFixed(4),
      informationalAmount: sum('informationalAmount').toFixed(4),
    },
  };
}

const money = (value: string) => new Prisma.Decimal(value).toFixed(4);
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
