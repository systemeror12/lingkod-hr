import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { payrollCalculationHash } from '../payroll-calculation/calculation-hash';
import {
  classifyPayrollExport,
  PayrollExportReconciliationError,
} from '../payroll-periods/payroll-export-reconciliation';
import {
  ACCOUNTING_SUPPORT_EXPORT_CONTRACT,
  ACCOUNTING_SUPPORT_EXPORT_STATEMENT,
  buildAccountingSupportExport,
  sumEmployeeDetail,
  type AccountingSupportSourceResult,
} from './accounting-support-export-contract';

const components = [
  {
    id: 'c-basic',
    code: 'BASIC_SALARY',
    name: 'Basic salary',
    category: 'EARNING',
    reportingCategory: null,
  },
  {
    id: 'c-gsis-ps',
    code: 'GSIS_PERSONAL_SHARE',
    name: 'GSIS personal share',
    category: 'DEDUCTION',
    reportingCategory: 'GSIS',
  },
  {
    id: 'c-gsis-gs',
    code: 'GSIS_GOVERNMENT_SHARE',
    name: 'GSIS government share',
    category: 'EMPLOYER_SHARE',
    reportingCategory: 'GSIS',
  },
];

const result = (
  id: string,
  employeeNumber: string,
  gross: string,
  deductions: string,
  net: string,
): AccountingSupportSourceResult => ({
  id,
  employeeId: `employee-${id}`,
  employeeNumber,
  legalName: `Employee ${id.toUpperCase()}`,
  calculationHash: id.repeat(64).slice(0, 64),
  grossAmount: gross,
  totalDeductions: deductions,
  netAmount: net,
});

const line = (
  id: string,
  payrollEmployeeId: string,
  payComponentId: string,
  lineType: string,
  amount: string,
) => ({
  id,
  payrollEmployeeId,
  payComponentId,
  lineType,
  amount,
});

function source() {
  const results = [
    result('b', 'E-002', '25000.5', '0', '25000.5'),
    result('a', 'E-001', '30000', '2700', '27300'),
  ];
  return {
    header: {
      id: 'export-1',
      agencyId: 'agency-1',
      payrollPeriod: {
        id: 'period-1',
        code: 'PAY-2026-03',
        runType: 'REGULAR',
        periodFrom: '2026-03-01',
        periodTo: '2026-03-31',
        paymentDate: '2026-03-31',
      },
      finalization: {
        calculationVersion: 2,
        calculationHash: payrollCalculationHash(results),
        payrollCertificationId: 'certification-1',
        finalizedAt: '2026-03-25T00:00:00.000Z',
      },
    },
    results,
    lines: [
      line('1', 'a', 'c-basic', 'EARNING', '30000'),
      line('2', 'a', 'c-gsis-ps', 'DEDUCTION', '2700'),
      line('3', 'a', 'c-gsis-gs', 'EMPLOYER_SHARE', '3600'),
      line('4', 'b', 'c-basic', 'EARNING', '25000.5'),
    ],
    components,
    checksum: (content: string) => createHash('sha256').update(content, 'utf8').digest('hex'),
  };
}

describe('buildAccountingSupportExport', () => {
  it('reuses the #636 classification and ties the companion to the export by checksum', () => {
    const input = source();
    const built = buildAccountingSupportExport(input);
    const content = JSON.parse(built.content);

    expect(content.contract).toEqual(ACCOUNTING_SUPPORT_EXPORT_CONTRACT);
    expect(content.statement).toBe(ACCOUNTING_SUPPORT_EXPORT_STATEMENT);
    expect(content.statement).toContain('not a journal entry');
    const classified = classifyPayrollExport({
      expectedCalculationHash: input.header.finalization.calculationHash,
      results: input.results,
      lines: input.lines,
      components,
    });
    expect(content.classifiedLines).toEqual(classified.classifiedLines);
    expect(content.reconciliation).toEqual(classified.reconciliation);
    expect(content.employeeDetailChecksum).toBe(input.checksum(built.employeeDetailContent));
    // The export carries no employee-level detail.
    expect(built.content).not.toContain('Employee A');
    expect(built.content).not.toContain('E-001');
  });

  it('lists each result in the companion, and its totals equal the export', () => {
    const built = buildAccountingSupportExport(source());
    const detail = JSON.parse(built.employeeDetailContent);
    const content = JSON.parse(built.content);

    expect(detail.accountingSupportExportId).toBe('export-1');
    expect(
      detail.employees.map((employee: { employeeNumber: string }) => employee.employeeNumber),
    ).toEqual(['E-001', 'E-002']);
    expect(detail.employees[0]).toMatchObject({
      legalName: 'Employee A',
      grossAmount: '30000.0000',
      totalDeductions: '2700.0000',
      netAmount: '27300.0000',
    });
    expect(detail.employees[0].lines).toHaveLength(3);
    expect(detail.totals).toEqual({
      classifiedLines: content.classifiedLines,
      reconciliation: content.reconciliation,
    });
  });

  it('renders the same bytes for the same source', () => {
    expect(buildAccountingSupportExport(source())).toEqual(buildAccountingSupportExport(source()));
  });

  it('refuses a source that does not reconcile', () => {
    const input = source();
    input.results[1] = { ...input.results[1]!, grossAmount: '30000.01', netAmount: '27300.01' };
    input.header.finalization.calculationHash = payrollCalculationHash(input.results);
    expect(() => buildAccountingSupportExport(input)).toThrow(PayrollExportReconciliationError);
  });

  it('refuses results that no longer match the hash the payroll was finalized under', () => {
    const input = source();
    input.header.finalization.calculationHash = 'f'.repeat(64);
    expect(() => buildAccountingSupportExport(input)).toThrow(/calculation hash/);
  });
});

describe('sumEmployeeDetail', () => {
  it('sums per-employee classifications back to the whole', () => {
    const { results, lines } = source();
    const whole = classifyPayrollExport({
      expectedCalculationHash: payrollCalculationHash(results),
      results,
      lines,
      components,
    });
    const parts = results.map((each) =>
      classifyPayrollExport({
        expectedCalculationHash: payrollCalculationHash([each]),
        results: [each],
        lines: lines.filter((own) => own.payrollEmployeeId === each.id),
        components,
      }),
    );
    expect(sumEmployeeDetail(parts)).toEqual(whole);
    expect(sumEmployeeDetail(parts.slice(1))).not.toEqual(whole);
  });
});
