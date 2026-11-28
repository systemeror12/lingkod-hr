import { describe, expect, it } from 'vitest';
import {
  exceptionMessage,
  exceptionTypeLabel,
  moneyLabel,
  periodStatusDisplay,
  stageCells,
  startsCollapsed,
  approvalEntries,
  payslipActions,
  payslipStatusDisplay,
  releaseNotice,
  reviewActions,
  REVIEW_PERMISSIONS,
  type CheckpointReview,
  type PayrollPeriodReview,
  type PeriodPayslipEntry,
  yearToDateFacts,
} from './payroll-periods';

describe('stageCells', () => {
  it('reads Computing… while calculating and never marks the calculation done', () => {
    const cells = stageCells('CALCULATING')!;
    expect(cells.map(({ label }) => label)).toEqual([
      'Draft',
      'Computing…',
      'Certified',
      'Reviewed',
      'Approved',
      'Finalized',
    ]);
    expect(cells[1]).toEqual({ label: 'Computing…', state: 'current' });
    expect(cells.filter(({ state }) => state === 'done').map(({ label }) => label)).toEqual([]);
    expect(periodStatusDisplay.CALCULATING).toEqual({ label: 'Computing…', tone: 'warning' });
  });

  it('marks the stages a period reached, with its own stage current', () => {
    expect(stageCells('FOR_REVIEW')!.map(({ state }) => state)).toEqual([
      'done',
      'current',
      'pending',
      'pending',
      'pending',
      'pending',
    ]);
    expect(stageCells('FINALIZED')!.at(-1)).toEqual({ label: 'Finalized', state: 'current' });
    expect(stageCells('VOIDED')).toBeNull();
  });

  it('shows only a finalized period as complete and collapses finished periods', () => {
    const complete = Object.entries(periodStatusDisplay)
      .filter(([, { tone }]) => tone === 'success')
      .map(([status]) => status);
    expect(complete).toEqual(['FINALIZED']);
    expect(startsCollapsed('FINALIZED')).toBe(true);
    expect(startsCollapsed('VOIDED')).toBe(true);
    expect(startsCollapsed('DRAFT')).toBe(false);
  });
});

describe('labels', () => {
  it('reads amounts as pesos without rounding away a recorded digit', () => {
    expect(moneyLabel('31705.0000')).toBe('₱31,705.00');
    expect(moneyLabel('1234567.5000')).toBe('₱1,234,567.50');
    expect(moneyLabel('0.0000')).toBe('₱0.00');
    expect(moneyLabel('12.3456')).toBe('₱12.3456');
    expect(moneyLabel('-40.5000')).toBe('-₱40.50');
  });

  it('names an exception type and its recorded reason', () => {
    expect(exceptionTypeLabel('COMPENSATION_BASIS_INDETERMINATE')).toBe(
      'Compensation basis indeterminate',
    );
    expect(exceptionMessage({ message: 'No pay basis is recorded.' })).toBe(
      'No pay basis is recorded.',
    );
    expect(exceptionMessage({})).toBeNull();
    expect(exceptionMessage(null)).toBeNull();
  });
});

describe('yearToDateFacts', () => {
  it('reads the stored snapshot as labelled facts and skips what it lacks', () => {
    expect(
      yearToDateFacts({
        taxYear: 2026,
        payrollPeriodIds: ['period-1'],
        taxableCompensation: '1000.0000',
        withholdingTax: '0.0000',
      }),
    ).toEqual([
      ['Tax year', '2026'],
      ['Finalized periods counted', '1 period'],
      ['Taxable compensation', '₱1,000.00'],
      ['Withholding tax', '₱0.00'],
    ]);
    expect(yearToDateFacts(null)).toEqual([]);
  });
});

const reviewer = (checkpoint: 'BUDGET' | 'ACCOUNTING', name: string): CheckpointReview => ({
  id: `review-${checkpoint}`,
  reviewExportId: 'export-1',
  checkpoint,
  outcome: 'CONFIRMED',
  externalReference: `${checkpoint}-REF`,
  evidenceDocumentVersionId: 'evidence-1',
  reason: null,
  reviewedByMembershipId: `member-${checkpoint}`,
  reviewedByName: name,
  reviewedAt: '2026-11-20T02:00:00.000Z',
});

function review(
  status: PayrollPeriodReview['status'],
  checkpointReviews: CheckpointReview[] = [],
  approved = false,
): PayrollPeriodReview {
  const certified = status !== 'FOR_REVIEW';
  return {
    id: 'period-1',
    status,
    calculationVersion: 1,
    rowVersion: 4,
    calculationHash: 'a'.repeat(64),
    finalizedAt: status === 'FINALIZED' ? '2026-11-21T03:00:00.000Z' : null,
    finalizedByMembershipId: status === 'FINALIZED' ? 'member-approver' : null,
    finalizedByName: status === 'FINALIZED' ? 'Pia Approver' : null,
    replacedByPeriodId: null,
    replacesPeriodIds: [],
    certification: certified
      ? {
          id: 'certification-1',
          calculationVersion: 1,
          calculationHash: 'a'.repeat(64),
          certifiedByMembershipId: 'member-certifier',
          certifiedByName: 'Hana Certifier',
          certifiedAt: '2026-11-19T01:00:00.000Z',
          approvedByMembershipId: approved ? 'member-approver' : null,
          approvedByName: approved ? 'Pia Approver' : null,
          approvedAt: approved ? '2026-11-20T05:00:00.000Z' : null,
          reviewExportId: 'export-1',
          checkpointReviews,
        }
      : null,
  };
}

const all = new Set<string>(REVIEW_PERMISSIONS);
const kinds = (actions: ReturnType<typeof reviewActions>) =>
  actions.map((action) => (action.kind === 'checkpoint' ? action.checkpoint : action.kind));

describe('checkpoint stages', () => {
  it('reads Reviewed 1/2 after one confirmed review, pending, and Reviewed after both', () => {
    expect(stageCells('CERTIFIED')![3]).toEqual({ label: 'Reviewed', state: 'pending' });
    expect(stageCells('CERTIFIED', 1)![3]).toEqual({ label: 'Reviewed 1/2', state: 'pending' });
    expect(stageCells('CERTIFIED', 1)![2]).toEqual({ label: 'Certified', state: 'current' });
    expect(stageCells('CERTIFIED', 2)!.map(({ state }) => state)).toEqual([
      'done',
      'done',
      'done',
      'current',
      'pending',
      'pending',
    ]);
  });
});

describe('reviewActions', () => {
  it('offers each actor only what their permission and the period state allow', () => {
    const certifier = new Set(['payroll.periods.certify', 'payroll.periods.return']);
    expect(kinds(reviewActions(review('FOR_REVIEW'), certifier))).toEqual(['certify', 'return']);
    expect(kinds(reviewActions(review('CERTIFIED'), certifier))).toEqual([]);

    const budget = new Set(['payroll.periods.review_funding']);
    expect(kinds(reviewActions(review('FOR_REVIEW'), budget))).toEqual([]);
    expect(kinds(reviewActions(review('CERTIFIED'), budget))).toEqual(['BUDGET']);
    // A checkpoint reviewed on the export in force is not offered again.
    expect(
      kinds(reviewActions(review('CERTIFIED', [reviewer('BUDGET', 'Ben Budget')]), budget)),
    ).toEqual([]);

    const approver = new Set([
      'payroll.periods.approve',
      'payroll.periods.revoke_certification',
      'payroll.periods.return_approved',
      'payroll.periods.finalize',
    ]);
    expect(
      kinds(reviewActions(review('CERTIFIED', [reviewer('BUDGET', 'Ben Budget')]), approver)),
    ).toEqual(['revoke']);
    const both = [reviewer('BUDGET', 'Ben Budget'), reviewer('ACCOUNTING', 'Ana Accounts')];
    expect(kinds(reviewActions(review('CERTIFIED', both), approver))).toEqual([
      'approve',
      'revoke',
    ]);
    expect(kinds(reviewActions(review('APPROVED', both, true), approver))).toEqual([
      'finalize',
      'return-approved',
    ]);
    expect(reviewActions(review('FINALIZED', both, true), all)).toEqual([]);
  });

  it('offers releasing payslips only while the server lists one Ready', () => {
    const releaser = new Set(['payroll.payslips.release']);
    const entry = (status: string | null): PeriodPayslipEntry => ({
      payrollEmployeeId: `result-${status}`,
      employee: { id: 'employee-1', employeeNumber: 'E-1', legalName: 'Ana Employee' },
      payslip: status
        ? {
            id: `payslip-${status}`,
            payrollPeriodId: 'period-1',
            payrollEmployeeId: `result-${status}`,
            status,
            releasedAt: null,
            releasedByMembershipId: null,
            withheldAt: null,
            withheldByMembershipId: null,
            withholdReason: null,
          }
        : null,
    });
    const ready = [entry('RELEASED'), entry('READY')];
    expect(kinds(payslipActions('FINALIZED', releaser, ready))).toEqual(['release']);
    // Generating, Withheld, Released, or not yet generated: nothing to release.
    expect(
      payslipActions('FINALIZED', releaser, [
        entry('GENERATING'),
        entry('WITHHELD'),
        entry('RELEASED'),
        entry(null),
      ]),
    ).toEqual([]);
    // Without the server's list, nothing is offered.
    expect(payslipActions('FINALIZED', releaser, null)).toEqual([]);
    expect(payslipActions('APPROVED', releaser, ready)).toEqual([]);
    expect(payslipActions('FINALIZED', new Set(['payroll.periods.finalize']), ready)).toEqual([]);
  });

  it('never reads a generating or missing payslip as Ready, nor a Ready one as Released', () => {
    expect(payslipStatusDisplay(null).label).toBe('Not generated yet');
    expect(payslipStatusDisplay({ status: 'GENERATING' })).toEqual({
      label: 'Generating…',
      tone: 'warning',
    });
    expect(payslipStatusDisplay({ status: 'READY' }).label).toBe('Ready');
    expect(payslipStatusDisplay({ status: 'WITHHELD' }).label).toBe('Withheld');
    expect(payslipStatusDisplay({ status: 'RELEASED' }).tone).toBe('success');
  });

  it('offers no checkpoint without an export, and no certification without a hash', () => {
    const certified = review('CERTIFIED');
    certified.certification!.reviewExportId = null;
    expect(kinds(reviewActions(certified, all))).toEqual(['revoke']);
    expect(kinds(reviewActions({ ...review('FOR_REVIEW'), calculationHash: null }, all))).toEqual([
      'return',
    ]);
  });
});

describe('approvalEntries', () => {
  it('keeps certified, each review, approved, and finalized apart, with who and when', () => {
    const finalized = review(
      'FINALIZED',
      [reviewer('BUDGET', 'Ben Budget'), reviewer('ACCOUNTING', 'Ana Accounts')],
      true,
    );
    expect(approvalEntries(finalized)).toEqual([
      {
        step: 'Certified',
        state: 'done',
        by: 'Hana Certifier',
        at: '2026-11-19T01:00:00.000Z',
        note: 'Calculation version 1',
      },
      {
        step: 'Budget review',
        state: 'done',
        by: 'Ben Budget',
        at: '2026-11-20T02:00:00.000Z',
        note: 'Confirmed · BUDGET-REF',
      },
      {
        step: 'Accounting review',
        state: 'done',
        by: 'Ana Accounts',
        at: '2026-11-20T02:00:00.000Z',
        note: 'Confirmed · ACCOUNTING-REF',
      },
      {
        step: 'Approved',
        state: 'done',
        by: 'Pia Approver',
        at: '2026-11-20T05:00:00.000Z',
        note: null,
      },
      {
        step: 'Finalized',
        state: 'done',
        by: 'Pia Approver',
        at: '2026-11-21T03:00:00.000Z',
        note: null,
      },
    ]);
  });

  it('reads a step not taken as pending', () => {
    const entries = approvalEntries(review('CERTIFIED', [reviewer('BUDGET', 'Ben Budget')]));
    expect(entries.map(({ step, state }) => `${step} ${state}`)).toEqual([
      'Certified done',
      'Budget review done',
      'Accounting review pending',
      'Approved pending',
      'Finalized pending',
    ]);
    expect(approvalEntries(review('FOR_REVIEW'))[0]).toMatchObject({
      step: 'Certified',
      state: 'pending',
      by: null,
    });
  });
});

describe('releaseNotice', () => {
  const release = (released: number, generatingCount: number) => ({
    payrollPeriodId: 'period-1',
    releasedPayslipIds: Array.from({ length: released }, (_, index) => `payslip-${index}`),
    generatingCount,
  });

  it('reads what the API released and never counts a generating payslip as released', () => {
    expect(releaseNotice('P-1', release(1, 0))).toBe('Released 1 payslip of P-1 to its Employee.');
    expect(releaseNotice('P-1', release(3, 2))).toBe(
      'Released 3 payslips of P-1 to their Employees. 2 payslips are still generating; release again once they are Ready.',
    );
    expect(releaseNotice('P-1', release(0, 1))).toBe(
      'No payslip of P-1 was Ready, so none was released. 1 payslip is still generating; release again once it is Ready.',
    );
  });
});
