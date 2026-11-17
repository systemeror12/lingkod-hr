import { Prisma } from '@prisma/client';
import { payrollCalculationHash } from '../payroll-calculation/calculation-hash';

export type ComponentKind = 'EARNING' | 'DEDUCTION' | 'EMPLOYER_SHARE' | 'INFORMATIONAL';

/** How an amount affects employee net pay: the Payroll Effect, never a debit or credit. */
export type PayrollEffect = 'ADDS' | 'SUBTRACTS' | 'NONE';

const PAYROLL_EFFECTS: Record<ComponentKind, PayrollEffect> = {
  EARNING: 'ADDS',
  DEDUCTION: 'SUBTRACTS',
  EMPLOYER_SHARE: 'NONE',
  INFORMATIONAL: 'NONE',
};

/** One Payroll Employee Result of the exported calculation version. */
export interface ExportSourceResult {
  id: string;
  employeeId: string;
  calculationHash: string;
  grossAmount: string;
  totalDeductions: string;
  netAmount: string;
}

/** One Payroll Line of those results. */
export interface ExportSourceLine {
  id: string;
  payrollEmployeeId: string;
  payComponentId: string;
  lineType: string;
  amount: string;
}

/** A pay component as the catalogue records it. */
export interface ExportPayComponent {
  id: string;
  code: string;
  name: string;
  category: string;
  reportingCategory: string | null;
}

/**
 * A Classified Payroll Export Line: the sum of the source lines of one pay
 * component and component kind. It is not a journal line.
 */
export interface ClassifiedPayrollExportLine {
  lineNo: number;
  payComponentCode: string;
  payComponentName: string;
  componentKind: ComponentKind;
  payrollEffect: PayrollEffect;
  reportingCategory: string | null;
  amount: string;
  sourceLineCount: number;
}

/** The Payroll Export Reconciliation: the totals the classified lines were proven against. */
export interface PayrollExportReconciliation {
  resultCount: number;
  sourceLineCount: number;
  classifiedSourceLineCount: number;
  grossAmount: string;
  totalDeductions: string;
  netAmount: string;
  employerShareAmount: string;
  informationalAmount: string;
}

export interface ClassifiedPayrollExport {
  classifiedLines: ClassifiedPayrollExportLine[];
  reconciliation: PayrollExportReconciliation;
}

/** The reconciliation failed: nothing may be generated from this source. */
export class PayrollExportReconciliationError extends Error {
  constructor(readonly failures: string[]) {
    super(`The payroll export does not reconcile: ${failures.join(' ')}`);
    this.name = 'PayrollExportReconciliationError';
  }
}

const KINDS = Object.keys(PAYROLL_EFFECTS) as ComponentKind[];
const isKind = (value: string): value is ComponentKind => KINDS.includes(value as ComponentKind);
const zero = () => new Prisma.Decimal(0);
const money = (value: Prisma.Decimal) => value.toFixed(4);

/**
 * Classify the Payroll Lines of one calculation version and prove the
 * classification reconciles (the Payroll Export Reconciliation, #29). Each
 * source line maps to exactly one classified line, keyed by its pay component
 * and component kind. Throws `PayrollExportReconciliationError` listing every
 * failure, so a source that does not reconcile generates nothing.
 *
 * `expectedCalculationHash` is the hash the export binds, such as the
 * certification's: the results must still be exactly what was certified.
 */
export function classifyPayrollExport(source: {
  expectedCalculationHash: string;
  results: readonly ExportSourceResult[];
  lines: readonly ExportSourceLine[];
  components: readonly ExportPayComponent[];
}): ClassifiedPayrollExport {
  const failures: string[] = [];
  const { results, lines } = source;

  if (payrollCalculationHash(results) !== source.expectedCalculationHash) {
    failures.push('The results no longer match the calculation hash the export binds.');
  }

  const components = new Map(source.components.map((component) => [component.id, component]));
  const resultLines = new Map(results.map((result) => [result.id, [] as ExportSourceLine[]]));
  const groups = new Map<
    string,
    { component: ExportPayComponent; kind: ComponentKind; amount: Prisma.Decimal; count: number }
  >();
  const sourceByKind = new Map(KINDS.map((kind) => [kind, zero()]));

  for (const line of lines) {
    const ofResult = resultLines.get(line.payrollEmployeeId);
    if (!ofResult) {
      failures.push(`Payroll Line ${line.id} is not a line of an exported result.`);
      continue;
    }
    ofResult.push(line);
    const component = components.get(line.payComponentId);
    if (!component) {
      failures.push(`Payroll Line ${line.id} names a pay component not in the catalogue.`);
      continue;
    }
    if (!isKind(line.lineType) || line.lineType !== component.category) {
      failures.push(
        `Payroll Line ${line.id} is ${line.lineType}, but ${component.code} is ${component.category}.`,
      );
      continue;
    }
    const amount = new Prisma.Decimal(line.amount);
    sourceByKind.set(line.lineType, sourceByKind.get(line.lineType)!.add(amount));
    const key = `${component.id}:${line.lineType}`;
    const group = groups.get(key) ?? { component, kind: line.lineType, amount: zero(), count: 0 };
    group.amount = group.amount.add(amount);
    group.count += 1;
    groups.set(key, group);
  }

  let gross = zero();
  let deductions = zero();
  let net = zero();
  for (const result of results) {
    const sum = (kind: ComponentKind) =>
      resultLines
        .get(result.id)!
        .filter((line) => line.lineType === kind)
        .reduce((total, line) => total.add(line.amount), zero());
    const resultGross = new Prisma.Decimal(result.grossAmount);
    const resultDeductions = new Prisma.Decimal(result.totalDeductions);
    const resultNet = new Prisma.Decimal(result.netAmount);
    if (
      !sum('EARNING').equals(resultGross) ||
      !sum('DEDUCTION').equals(resultDeductions) ||
      !resultGross.sub(resultDeductions).equals(resultNet)
    ) {
      failures.push(`The result of Employee ${result.employeeId} does not reconcile to its lines.`);
    }
    gross = gross.add(resultGross);
    deductions = deductions.add(resultDeductions);
    net = net.add(resultNet);
  }

  const classifiedLines = [...groups.values()]
    .sort((a, b) =>
      a.component.code !== b.component.code
        ? a.component.code < b.component.code
          ? -1
          : 1
        : KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind),
    )
    .map((group, index): ClassifiedPayrollExportLine => ({
      lineNo: index + 1,
      payComponentCode: group.component.code,
      payComponentName: group.component.name,
      componentKind: group.kind,
      payrollEffect: PAYROLL_EFFECTS[group.kind],
      reportingCategory: group.component.reportingCategory,
      amount: money(group.amount),
      sourceLineCount: group.count,
    }));

  const classifiedSourceLineCount = classifiedLines.reduce(
    (total, line) => total + line.sourceLineCount,
    0,
  );
  if (failures.length === 0 && classifiedSourceLineCount !== lines.length) {
    failures.push(
      `${lines.length} source lines were read, but the classified lines sum ${classifiedSourceLineCount}.`,
    );
  }
  const classifiedByKind = (kind: ComponentKind) =>
    classifiedLines
      .filter((line) => line.componentKind === kind)
      .reduce((total, line) => total.add(line.amount), zero());
  for (const kind of KINDS) {
    if (!classifiedByKind(kind).equals(sourceByKind.get(kind)!)) {
      failures.push(`The classified ${kind} lines do not sum to the source lines.`);
    }
  }
  if (!classifiedByKind('EARNING').equals(gross)) {
    failures.push('The classified earnings do not equal the results’ gross amount.');
  }
  if (!classifiedByKind('DEDUCTION').equals(deductions)) {
    failures.push('The classified deductions do not equal the results’ total deductions.');
  }

  if (failures.length > 0) throw new PayrollExportReconciliationError(failures);
  return {
    classifiedLines,
    reconciliation: {
      resultCount: results.length,
      sourceLineCount: lines.length,
      classifiedSourceLineCount,
      grossAmount: money(gross),
      totalDeductions: money(deductions),
      netAmount: money(net),
      employerShareAmount: money(classifiedByKind('EMPLOYER_SHARE')),
      informationalAmount: money(classifiedByKind('INFORMATIONAL')),
    },
  };
}
