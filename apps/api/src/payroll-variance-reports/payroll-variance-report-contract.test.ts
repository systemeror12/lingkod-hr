import { describe, expect, it } from 'vitest';
import {
  planPayrollVarianceReport,
  sha256,
  type VarianceReportPeriod,
  type VarianceSourceResult,
} from './payroll-variance-report-contract';

const period = (code: string, runType = 'REGULAR'): VarianceReportPeriod => ({
  id: `${code}-id`,
  code,
  runType,
  periodFrom: '2875-03-01',
  periodTo: '2875-03-31',
  paymentDate: '2875-03-31',
  calculationVersion: 2,
  finalizedAt: '2875-04-01T00:00:00.000Z',
});

const line = (code: string, amount: string, lineType = 'EARNING') => ({
  payComponentId: `${code}-id`,
  componentCode: code,
  componentName: `Component ${code}`,
  lineType,
  amount,
});

const result = (
  number: string,
  netAmount: string,
  lines: VarianceSourceResult['lines'],
): VarianceSourceResult => ({
  employeeId: `${number}-id`,
  agencyEmployeeNumber: number,
  employeeName: `Member ${number}`,
  netAmount,
  lines,
});

const plan = (input: Partial<Parameters<typeof planPayrollVarianceReport>[0]>) =>
  planPayrollVarianceReport({
    agencyId: 'agency',
    reportId: 'report',
    generatedAt: '2875-04-02T00:00:00.000Z',
    period: period('PAY-2875-03'),
    results: [],
    prior: null,
    exceptions: [],
    ...input,
  });

const varianceOf = (content: string) =>
  (JSON.parse(content) as { variance: Record<string, unknown> }).variance;

describe('planPayrollVarianceReport', () => {
  it('shows both values of each difference, absent as null, for a new Employee and a removed component', () => {
    const report = plan({
      prior: {
        period: period('PAY-2875-02'),
        results: [
          result('E-001', '30000', [
            line('BASIC_SALARY', '30000'),
            line('PERA', '2000'),
            line('GSIS', '2700', 'DEDUCTION'),
          ]),
          result('E-002', '25000', [line('BASIC_SALARY', '25000')]),
        ],
      },
      results: [
        // PERA removed; GSIS unchanged.
        result('E-001', '28000', [
          line('BASIC_SALARY', '30000'),
          line('GSIS', '2700', 'DEDUCTION'),
        ]),
        // Unchanged: not listed.
        result('E-002', '25000', [line('BASIC_SALARY', '25000')]),
        // New Employee.
        result('E-003', '20000', [line('BASIC_SALARY', '15000'), line('BASIC_SALARY', '5000')]),
      ],
    });

    expect(varianceOf(report.content)).toEqual({
      status: 'COMPARED',
      priorComparablePeriod: period('PAY-2875-02'),
      employees: [
        {
          employeeId: 'E-001-id',
          agencyEmployeeNumber: 'E-001',
          employeeName: 'Member E-001',
          inPriorPeriod: true,
          inThisPeriod: true,
          priorNetAmount: '30000.0000',
          netAmount: '28000.0000',
          netDifference: '-2000.0000',
          components: [
            {
              payComponentId: 'PERA-id',
              componentCode: 'PERA',
              componentName: 'Component PERA',
              lineType: 'EARNING',
              priorAmount: '2000.0000',
              currentAmount: null,
              difference: '-2000.0000',
            },
          ],
        },
        {
          employeeId: 'E-003-id',
          agencyEmployeeNumber: 'E-003',
          employeeName: 'Member E-003',
          inPriorPeriod: false,
          inThisPeriod: true,
          priorNetAmount: null,
          netAmount: '20000.0000',
          netDifference: '20000.0000',
          components: [
            {
              payComponentId: 'BASIC_SALARY-id',
              componentCode: 'BASIC_SALARY',
              componentName: 'Component BASIC_SALARY',
              lineType: 'EARNING',
              priorAmount: null,
              currentAmount: '20000.0000',
              difference: '20000.0000',
            },
          ],
        },
      ],
    });
    expect(report.checksum).toBe(sha256(report.content));
  });

  it('lists an Employee absent from this period with their prior values', () => {
    const report = plan({
      prior: {
        period: period('PAY-2875-02'),
        results: [result('E-009', '10000', [line('BASIC_SALARY', '10000')])],
      },
      results: [],
    });
    expect(varianceOf(report.content).employees).toMatchObject([
      {
        inPriorPeriod: true,
        inThisPeriod: false,
        priorNetAmount: '10000.0000',
        netAmount: null,
        components: [{ priorAmount: '10000.0000', currentAmount: null }],
      },
    ]);
  });

  it('says there is no prior comparable period instead of reporting zero variance', () => {
    const results = [result('E-001', '30000', [line('BASIC_SALARY', '30000')])];
    expect(varianceOf(plan({ results }).content)).toEqual({
      status: 'NO_PRIOR_COMPARABLE_PERIOD',
      reason:
        'The Agency has no FINALIZED regular Payroll Period before this one, so nothing is compared.',
    });
    expect(varianceOf(plan({ results, period: period('BONUS-2875', 'SPECIAL') }).content)).toEqual({
      status: 'NO_PRIOR_COMPARABLE_PERIOD',
      reason:
        'Payroll Period BONUS-2875 is a SPECIAL run, and only a regular run has a prior comparable period, so nothing is compared.',
    });
  });

  it('lists every exception with its decision and holds, in version and Employee order', () => {
    const employee = {
      id: 'E-001-id',
      agencyEmployeeNumber: 'E-001',
      employeeName: 'Member E-001',
    };
    const report = plan({
      exceptions: [
        {
          id: 'x3',
          calculationVersion: 2,
          exceptionType: 'NET_PAY_VARIANCE',
          severity: 'WARNING',
          status: 'ACKNOWLEDGED',
          details: { message: 'Net pay is lower.' },
          reason: 'Step increment withdrawn.',
          resolvedByMembershipId: 'm1',
          employee,
          holds: [],
        },
        {
          id: 'x1',
          calculationVersion: 1,
          exceptionType: 'BASIC_SALARY_MISSING',
          severity: 'BLOCKING',
          status: 'OPEN',
          details: { message: 'No basic salary.' },
          reason: null,
          resolvedByMembershipId: null,
          employee,
          holds: [
            {
              id: 'h1',
              reason: 'Awaiting the appointment.',
              placedByMembershipId: 'm1',
              placedAt: '2875-03-21T00:00:00.000Z',
              liftedByMembershipId: null,
              liftedAt: null,
            },
          ],
        },
        {
          id: 'x2',
          calculationVersion: 1,
          exceptionType: 'RULE_VERSION_LOADED_AFTER_SNAPSHOT',
          severity: 'BLOCKING',
          status: 'OPEN',
          details: { message: 'A rule version was loaded.' },
          reason: null,
          resolvedByMembershipId: null,
          employee: null,
          holds: [],
        },
      ],
    });
    const { exceptions } = JSON.parse(report.content) as {
      exceptions: { payrollExceptionId: string; decision: unknown; holds: unknown[] }[];
    };
    expect(exceptions.map((exception) => exception.payrollExceptionId)).toEqual(['x2', 'x1', 'x3']);
    expect(exceptions[1]).toMatchObject({ decision: null, holds: [{ id: 'h1' }] });
    expect(exceptions[2]!.decision).toEqual({
      reason: 'Step increment withdrawn.',
      decidedByMembershipId: 'm1',
    });
  });
});
