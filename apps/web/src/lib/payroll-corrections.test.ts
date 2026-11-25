import { describe, expect, it } from 'vitest';
import {
  adjustmentListPath,
  adjustmentProgress,
  adjustmentStatusDisplay,
  causeDetail,
  recalculationNotice,
  voidStateOf,
  type PayrollAdjustment,
} from './payroll-corrections';
import type { PayrollPeriod } from './payroll-periods';

const adjustment: PayrollAdjustment = {
  id: 'adjustment-1',
  employeeId: 'employee-1',
  status: 'OPEN',
  openedAt: '2026-11-10T01:00:00.000Z',
  postedAt: null,
  cancelledAt: null,
  originalPayrollPeriod: { id: 'period-1', code: 'P-2850-03', status: 'FINALIZED' },
  carriedBy: [],
  postedBy: null,
  causes: [],
};

const period: PayrollPeriod = {
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

describe('adjustmentProgress', () => {
  it('reads an open adjustment as pending until a payroll posts it', () => {
    expect(adjustmentStatusDisplay.OPEN.label).toBe('Pending');
    expect(adjustmentProgress(adjustment)).toBe('Not in a payroll yet');
    expect(
      adjustmentProgress({
        ...adjustment,
        carriedBy: [
          { id: 'supplemental', code: 'SUPP-1', status: 'FOR_REVIEW' },
          { id: 'regular', code: 'P-2850-04', status: 'CALCULATING' },
        ],
      }),
    ).toBe('In SUPP-1 (For review), P-2850-04 (Computing…)');
  });

  it('names the period that posted it, and none for a recovery the COA route posted', () => {
    const postedBy = { id: 'supplemental', code: 'SUPP-1', status: 'FINALIZED' as const };
    expect(adjustmentProgress({ ...adjustment, status: 'POSTED', postedBy })).toBe(
      'Posted by SUPP-1',
    );
    expect(adjustmentProgress({ ...adjustment, status: 'POSTED' })).toBe('Posted');
    expect(adjustmentProgress({ ...adjustment, status: 'CANCELLED' })).toBe('Cancelled');
  });
});

describe('causeDetail', () => {
  const cause = {
    id: 'cause-1',
    reason: null,
    payrollInputId: null,
    sourceCorrectionKey: null,
    payrollHoldId: null,
    openedByMembershipId: null,
    openedByName: null,
    createdAt: '2026-11-10T01:00:00.000Z',
  };

  it('names what each origin records', () => {
    expect(
      causeDetail({
        ...cause,
        origin: 'SOURCE_CORRECTION',
        payrollInputId: 'input-1',
        sourceCorrectionKey: 'LEAVE:1',
      }),
    ).toEqual(['Correction key LEAVE:1', 'Payroll Input input-1']);
    expect(causeDetail({ ...cause, origin: 'PAYROLL_HOLD', payrollHoldId: 'hold-1' })).toEqual([
      'Payroll Hold hold-1',
    ]);
    expect(
      causeDetail({
        ...cause,
        origin: 'RECALCULATION',
        reason: 'Step increment.',
        openedByName: 'Marisol Santos',
      }),
    ).toEqual(['Step increment.', 'Asked by Marisol Santos']);
  });
});

describe('adjustmentListPath', () => {
  it('sends the status filter, and none for All', () => {
    expect(adjustmentListPath('OPEN')).toBe('/payroll-adjustments?status=OPEN');
    expect(adjustmentListPath('ALL')).toBe('/payroll-adjustments');
  });
});

describe('voidStateOf', () => {
  it('reads a requested void as pending and a voided payroll as voided', () => {
    expect(voidStateOf(period)).toBeNull();
    expect(voidStateOf({ ...period, voidRequestedAt: '2026-11-20T01:00:00.000Z' })).toBe(
      'REQUESTED',
    );
    expect(voidStateOf({ ...period, status: 'VOIDED', voidedAt: '2026-11-21T01:00:00.000Z' })).toBe(
      'VOIDED',
    );
  });

  it('leaves out a cancelled draft, which was never finalized', () => {
    expect(voidStateOf({ ...period, status: 'VOIDED', finalizedAt: null })).toBeNull();
  });
});

describe('recalculationNotice', () => {
  const name = (id: string) => (id === 'employee-1' ? 'Alex Rivera' : id);

  it('says whether each Employee opened or joined an adjustment, and that it is pending', () => {
    expect(
      recalculationNotice(
        'P-2850-03',
        {
          payrollPeriodId: 'period-1',
          adjustments: [{ payrollAdjustmentId: 'a-1', employeeId: 'employee-1', joined: true }],
        },
        name,
      ),
    ).toBe(
      'Joined the open Payroll Adjustment against P-2850-03 for Alex Rivera. It stays pending until a payroll carries it.',
    );
    expect(
      recalculationNotice(
        'P-2850-03',
        {
          payrollPeriodId: 'period-1',
          adjustments: [
            { payrollAdjustmentId: 'a-1', employeeId: 'employee-1', joined: false },
            { payrollAdjustmentId: 'a-2', employeeId: 'employee-2', joined: false },
          ],
        },
        name,
      ),
    ).toBe(
      'Opened a Payroll Adjustment against P-2850-03 for 2 Employees. It stays pending until a payroll carries it.',
    );
  });
});
