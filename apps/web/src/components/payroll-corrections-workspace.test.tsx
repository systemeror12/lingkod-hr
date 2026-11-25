import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PayrollAdjustment } from '../lib/payroll-corrections';
import type { PayrollLine, PayrollPeriod, PayrollPeriodReview } from '../lib/payroll-periods';
import { PayrollCorrectionsWorkspace } from './payroll-corrections-workspace';
import { PeriodCorrection, sourceSummary } from './payslips-workspace';

const finalized: PayrollPeriod = {
  id: 'period-1',
  code: 'P-2851-02',
  runType: 'REGULAR',
  periodFrom: '2851-02-01',
  periodTo: '2851-02-28',
  cutoffAt: '2851-02-20T00:00:00.000Z',
  paymentDate: '2851-02-28',
  status: 'FINALIZED',
  carriesAdjustments: false,
  calculationVersion: 1,
  payComponentIds: [],
  finalizedAt: '2026-11-02T01:00:00.000Z',
  voidRequestedAt: null,
  voidDocumentVersionId: null,
  voidReason: null,
  voidedAt: null,
  rowVersion: 8,
  totals: null,
};

const pending: PayrollAdjustment = {
  id: 'adjustment-1',
  employeeId: 'employee-1',
  status: 'OPEN',
  openedAt: '2026-11-10T01:00:00.000Z',
  postedAt: null,
  cancelledAt: null,
  originalPayrollPeriod: { id: 'period-0', code: 'P-2850-CLOTHING', status: 'FINALIZED' },
  carriedBy: [],
  postedBy: null,
  causes: [
    {
      id: 'cause-1',
      origin: 'SOURCE_CORRECTION',
      reason: null,
      payrollInputId: 'input-1',
      sourceCorrectionKey: 'LEAVE-CANCELLATION:1',
      payrollHoldId: null,
      openedByMembershipId: null,
      openedByName: null,
      createdAt: '2026-11-10T01:00:00.000Z',
    },
  ],
};

function workspace(overrides: Partial<Parameters<typeof PayrollCorrectionsWorkspace>[0]> = {}) {
  return renderToStaticMarkup(
    <PayrollCorrectionsWorkspace
      agencyId="agency-1"
      authorities={[]}
      canAdjust={false}
      canApproveVoid={false}
      canRequestVoid={false}
      employees={[{ id: 'employee-1', employeeNumber: 'E-1', legalName: 'Alex Rivera' }]}
      evidenceReadable={false}
      initialAdjustments={[pending]}
      initialPeriods={[finalized]}
      {...overrides}
    />,
  );
}

describe('PayrollCorrectionsWorkspace', () => {
  it('lists a pending source correction as pending, with what it names', () => {
    const html = workspace();
    expect(html).toContain('Alex Rivera');
    expect(html).toContain('P-2850-CLOTHING');
    expect(html).toContain('Source correction');
    expect(html).toContain('Correction key LEAVE-CANCELLATION:1');
    expect(html).toContain('Not in a payroll yet');
    expect(html).toMatch(/>Pending</);
    expect(html).toContain('/payslips?period=period-0#period-period-0');
  });

  it('offers opening a correction only to an actor who holds a method’s permission', () => {
    expect(workspace()).not.toContain('Open correction');
    expect(workspace({ canAdjust: true })).toContain('Open correction');
    expect(workspace({ canRequestVoid: true })).toContain('Open correction');
  });

  it('reads a requested void as pending, and offers its decision to a void approver', () => {
    const requested = {
      ...finalized,
      voidRequestedAt: '2026-11-20T01:00:00.000Z',
      voidReason: 'Wrong salary schedule.',
    };
    const reader = workspace({ initialPeriods: [requested] });
    expect(reader).toContain('Void requested');
    expect(reader).toContain('Wrong salary schedule.');
    expect(reader).not.toContain('Approve void');
    const approver = workspace({ initialPeriods: [requested], canApproveVoid: true });
    expect(approver).toContain('Approve void');
    expect(approver).toContain('Decline');
  });
});

describe('PeriodCorrection', () => {
  const read = (overrides: Partial<PayrollPeriodReview>): PayrollPeriodReview => ({
    id: 'period-1',
    status: 'VOIDED',
    calculationVersion: 1,
    rowVersion: 9,
    calculationHash: null,
    finalizedAt: '2026-11-02T01:00:00.000Z',
    finalizedByMembershipId: null,
    finalizedByName: null,
    certification: null,
    replacedByPeriodId: null,
    replacesPeriodIds: [],
    ...overrides,
  });
  const voided: PayrollPeriod = {
    ...finalized,
    status: 'VOIDED',
    voidReason: 'Wrong salary schedule.',
    voidedAt: '2026-11-21T01:00:00.000Z',
  };
  const codes = (id: string) => (id === 'period-2' ? 'P-2851-02-R' : id);

  it('keeps a voided payroll readable and links it to its replacement', () => {
    const html = renderToStaticMarkup(
      <PeriodCorrection
        onFollow={() => undefined}
        period={voided}
        periodCode={codes}
        read={read({ replacedByPeriodId: 'period-2' })}
      />,
    );
    expect(html).toContain('Wrong salary schedule.');
    expect(html).toContain('href="#period-period-2"');
    expect(html).toContain('P-2851-02-R');
  });

  it('says when no replacement exists yet, and never before the period is read', () => {
    const none = renderToStaticMarkup(
      <PeriodCorrection
        onFollow={() => undefined}
        period={voided}
        periodCode={codes}
        read={read({})}
      />,
    );
    expect(none).toContain('No replacement period yet');
    const reading = renderToStaticMarkup(
      <PeriodCorrection
        onFollow={() => undefined}
        period={voided}
        periodCode={codes}
        read={null}
      />,
    );
    expect(reading).toContain('Reading…');
  });

  it('links a replacement back to the payroll it replaces', () => {
    const html = renderToStaticMarkup(
      <PeriodCorrection
        onFollow={() => undefined}
        period={{ ...finalized, id: 'period-2', code: 'P-2851-02-R', status: 'DRAFT' }}
        periodCode={(id) => (id === 'period-1' ? 'P-2851-02' : id)}
        read={read({ id: 'period-2', status: 'DRAFT', replacesPeriodIds: ['period-1'] })}
      />,
    );
    expect(html).toContain('Replaces the voided');
    expect(html).toContain('href="#period-period-1"');
  });

  it('shows nothing for a payroll with no void and no replacement', () => {
    expect(
      renderToStaticMarkup(
        <PeriodCorrection
          onFollow={() => undefined}
          period={finalized}
          periodCode={codes}
          read={read({ status: 'FINALIZED' })}
        />,
      ),
    ).toBe('');
  });
});

describe('sourceSummary', () => {
  it('names the Payroll Adjustment a carried line recalculates', () => {
    const line: PayrollLine = {
      id: 'line-1',
      payComponent: { id: 'c-1', code: 'DAYS_WITHOUT_PAY', name: 'Salary for days without pay' },
      lineType: 'DEDUCTION',
      quantity: null,
      rate: null,
      amount: '-500.0000',
      ruleVersion: null,
      sources: [],
      sourceSnapshot: {
        payrollAdjustment: {
          payrollAdjustmentId: 'adjustment-1',
          originalPayrollPeriodId: 'period-0',
          periodFrom: '2850-01-01',
          periodTo: '2850-12-31',
        },
      },
    };
    expect(sourceSummary(line)).toBe('Payroll Adjustment for Jan 1, 2850 – Dec 31, 2850');
  });
});
