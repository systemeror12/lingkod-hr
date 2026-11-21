import type { RequestContext } from '@lingkod-hr/auth';
import { describe, expect, it, vi } from 'vitest';
import { REQUIRED_PERMISSIONS } from '../auth/auth.decorators';
import { payrollCalculationHash } from '../payroll-calculation/calculation-hash';
import {
  classifyPayrollExport,
  PayrollExportReconciliationError,
  type ExportSourceLine,
  type ExportSourceResult,
} from './payroll-export-reconciliation';
import { PayrollPeriodsController } from './payroll-periods.controller';
import { PayrollReviewExportService } from './payroll-review-export.service';

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
  gross: string,
  deductions: string,
  net: string,
): ExportSourceResult => ({
  id,
  employeeId: `employee-${id}`,
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
): ExportSourceLine => ({ id, payrollEmployeeId, payComponentId, lineType, amount });

function source() {
  const results = [result('a', '30000', '2700', '27300'), result('b', '25000.5', '0', '25000.5')];
  return {
    expectedCalculationHash: payrollCalculationHash(results),
    results,
    lines: [
      line('1', 'a', 'c-basic', 'EARNING', '30000'),
      line('2', 'a', 'c-gsis-ps', 'DEDUCTION', '2700'),
      line('3', 'a', 'c-gsis-gs', 'EMPLOYER_SHARE', '3600'),
      line('4', 'b', 'c-basic', 'EARNING', '25000.5'),
    ],
    components,
  };
}

const failuresOf = (work: () => unknown): string[] => {
  try {
    work();
  } catch (error: unknown) {
    if (error instanceof PayrollExportReconciliationError) return error.failures;
    throw error;
  }
  throw new Error('The export reconciled.');
};

describe('classifying a payroll export', () => {
  it('maps every source line to exactly one classified line and reconciles the totals', () => {
    expect(classifyPayrollExport(source())).toEqual({
      classifiedLines: [
        {
          lineNo: 1,
          payComponentCode: 'BASIC_SALARY',
          payComponentName: 'Basic salary',
          componentKind: 'EARNING',
          payrollEffect: 'ADDS',
          reportingCategory: null,
          amount: '55000.5000',
          sourceLineCount: 2,
        },
        {
          lineNo: 2,
          payComponentCode: 'GSIS_GOVERNMENT_SHARE',
          payComponentName: 'GSIS government share',
          componentKind: 'EMPLOYER_SHARE',
          payrollEffect: 'NONE',
          reportingCategory: 'GSIS',
          amount: '3600.0000',
          sourceLineCount: 1,
        },
        {
          lineNo: 3,
          payComponentCode: 'GSIS_PERSONAL_SHARE',
          payComponentName: 'GSIS personal share',
          componentKind: 'DEDUCTION',
          payrollEffect: 'SUBTRACTS',
          reportingCategory: 'GSIS',
          amount: '2700.0000',
          sourceLineCount: 1,
        },
      ],
      reconciliation: {
        resultCount: 2,
        sourceLineCount: 4,
        classifiedSourceLineCount: 4,
        grossAmount: '55000.5000',
        totalDeductions: '2700.0000',
        netAmount: '52300.5000',
        employerShareAmount: '3600.0000',
        informationalAmount: '0.0000',
      },
    });
  });

  it('classifies the same source the same way whatever order it is read in', () => {
    const forward = source();
    const reversed = {
      ...forward,
      results: [...forward.results].reverse(),
      lines: [...forward.lines].reverse(),
    };
    expect(classifyPayrollExport(reversed)).toEqual(classifyPayrollExport(forward));
  });

  it('reconciles a version with no results to an empty export', () => {
    expect(
      classifyPayrollExport({
        expectedCalculationHash: payrollCalculationHash([]),
        results: [],
        lines: [],
        components,
      }),
    ).toMatchObject({
      classifiedLines: [],
      reconciliation: { resultCount: 0, netAmount: '0.0000' },
    });
  });

  it('blocks when the results are no longer what the export binds', () => {
    expect(
      failuresOf(() => classifyPayrollExport({ ...source(), expectedCalculationHash: 'f' })),
    ).toEqual(['The results no longer match the calculation hash the export binds.']);
  });

  it('blocks when a result does not reconcile to its lines', () => {
    const changed = source();
    changed.results[0] = { ...changed.results[0]!, grossAmount: '30000.01', netAmount: '27300.01' };
    changed.expectedCalculationHash = payrollCalculationHash(changed.results);
    expect(failuresOf(() => classifyPayrollExport(changed))).toEqual([
      'The result of Employee employee-a does not reconcile to its lines.',
      'The classified earnings do not equal the results’ gross amount.',
    ]);
  });

  it('blocks a line of another result, an unknown component, or a kind the component is not', () => {
    const changed = source();
    changed.lines.push(
      line('5', 'z', 'c-basic', 'EARNING', '1'),
      line('6', 'a', 'c-missing', 'EARNING', '1'),
      line('7', 'a', 'c-gsis-ps', 'EARNING', '1'),
    );
    expect(failuresOf(() => classifyPayrollExport(changed))).toEqual([
      'Payroll Line 5 is not a line of an exported result.',
      'Payroll Line 6 names a pay component not in the catalogue.',
      'Payroll Line 7 is EARNING, but GSIS_PERSONAL_SHARE is DEDUCTION.',
      // Lines 6 and 7 are still result a's, so its earnings no longer match its gross.
      'The result of Employee employee-a does not reconcile to its lines.',
    ]);
  });
});

describe('the Certified Payroll Review Export commands', () => {
  const context: RequestContext = {
    requestId: 'request-1',
    agencyId: '00000000-0000-4000-8000-000000000001',
    userId: '00000000-0000-4000-8000-000000000002',
    membershipId: '00000000-0000-4000-8000-000000000003',
    primaryOrganizationUnitId: null,
    permissions: [{ code: 'payroll.periods.read', scopePolicy: 'OWN' }],
  };
  const periodId = '00000000-0000-4000-8000-000000000004';

  it('read with payroll.periods.read on the route, and have no generate route', () => {
    const required = (handler: keyof PayrollPeriodsController) =>
      Reflect.getMetadata(REQUIRED_PERMISSIONS, PayrollPeriodsController.prototype[handler]);
    expect(required('readReviewExport')).toEqual(['payroll.periods.read']);
    // Certify generates the export; nothing else writes one.
    expect(Object.getOwnPropertyNames(PayrollPeriodsController.prototype)).not.toContain(
      'generateReviewExport',
    );
  });

  it('refuse a reader who does not hold payroll.periods.read for the whole Agency', async () => {
    await expect(
      new PayrollReviewExportService().read(context, periodId, periodId),
    ).rejects.toMatchObject({ statusCode: 403, code: 'PAYROLL_REVIEW_EXPORT_FORBIDDEN' });
  });

  it('refuse a malformed export id before calling the service', async () => {
    const reviewExport = { read: vi.fn() };
    const controller = new PayrollPeriodsController(
      {} as never,
      {} as never,
      reviewExport as never,
      {} as never,
      {} as never,
    );
    await expect(
      controller.readReviewExport(context.agencyId, periodId, 'nope', context),
    ).rejects.toMatchObject({ status: 404 });
    expect(reviewExport.read).not.toHaveBeenCalled();
  });
});
