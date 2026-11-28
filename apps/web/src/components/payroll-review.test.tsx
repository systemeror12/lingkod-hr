import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  reviewActions,
  type PayrollPeriod,
  type PayrollPeriodReview,
} from '../lib/payroll-periods';
import { PayrollReview } from './payroll-review';
import { StageBar } from './payslips-workspace';

const period: PayrollPeriod = {
  id: 'period-1',
  code: 'P-1',
  runType: 'SPECIAL',
  periodFrom: '2850-01-01',
  periodTo: '2850-12-31',
  cutoffAt: '2850-01-01T00:00:00.000Z',
  paymentDate: '2850-06-15',
  status: 'CERTIFIED',
  calculationVersion: 1,
  carriesAdjustments: false,
  payComponentIds: [],
  finalizedAt: null,
  voidRequestedAt: null,
  voidDocumentVersionId: null,
  voidReason: null,
  voidedAt: null,
  rowVersion: 4,
  totals: null,
};

const review: PayrollPeriodReview = {
  id: 'period-1',
  status: 'CERTIFIED',
  calculationVersion: 1,
  rowVersion: 4,
  calculationHash: 'a'.repeat(64),
  finalizedAt: null,
  finalizedByMembershipId: null,
  finalizedByName: null,
  replacedByPeriodId: null,
  replacesPeriodIds: [],
  certification: {
    id: 'certification-1',
    calculationVersion: 1,
    calculationHash: 'a'.repeat(64),
    certifiedByMembershipId: 'member-1',
    certifiedByName: 'Hana Certifier',
    certifiedAt: '2026-11-19T01:00:00.000Z',
    approvedByMembershipId: null,
    approvedByName: null,
    approvedAt: null,
    reviewExportId: 'export-1',
    checkpointReviews: [
      {
        id: 'review-1',
        reviewExportId: 'export-1',
        checkpoint: 'BUDGET',
        outcome: 'CONFIRMED',
        externalReference: 'ORS-2850-0001',
        evidenceDocumentVersionId: 'evidence-1',
        reason: null,
        reviewedByMembershipId: 'member-2',
        reviewedByName: 'Ben Budget',
        reviewedAt: '2026-11-20T02:00:00.000Z',
      },
    ],
  },
};

const render = (held: string[]) =>
  renderToStaticMarkup(
    <PayrollReview
      acting={null}
      actions={reviewActions(review, new Set(held))}
      code="P-1"
      evidenceOptions={[]}
      evidenceReadable={false}
      onAct={() => undefined}
      onDone={async () => undefined}
      request={async () => null}
      review={review}
    />,
  );

describe('PayrollReview', () => {
  it('names who certified and reviewed, and when, and keeps the steps not taken pending', () => {
    const html = render([]);
    expect(html).toContain('Hana Certifier');
    expect(html).toContain('Ben Budget');
    expect(html).toContain('Confirmed · ORS-2850-0001');
    expect(html).toMatch(/data-step="Accounting review".*?Pending/);
    expect(html).toMatch(/data-step="Approved".*?Pending/);
    expect(html).not.toContain('review actions');
  });

  it('shows the Accounting Reviewer their checkpoint and the approver no approval yet', () => {
    expect(render(['payroll.periods.review_accounting'])).toContain('Record Accounting review');
    const approver = render(['payroll.periods.approve', 'payroll.periods.revoke_certification']);
    expect(approver).not.toContain('Approve payroll');
    expect(approver).toContain('Revoke certification');
  });
});

describe('PayrollReview on a finalized period', () => {
  it('offers the Payroll Approver to release its Ready payslips', () => {
    const finalized: PayrollPeriodReview = {
      ...review,
      status: 'FINALIZED',
      finalizedAt: '2026-11-21T03:00:00.000Z',
      finalizedByMembershipId: 'member-4',
      finalizedByName: 'Pat Approver',
    };
    const html = renderToStaticMarkup(
      <PayrollReview
        acting={{ kind: 'release', primary: true }}
        actions={[{ kind: 'release', primary: true }]}
        code="P-1"
        evidenceOptions={[]}
        evidenceReadable={false}
        onAct={() => undefined}
        onDone={async () => undefined}
        request={async () => null}
        review={finalized}
      />,
    );
    expect(html).toContain('aria-label="Release payslips"');
    expect(html).toContain('A payslip still generating stays unreleased');
    expect(render(['payroll.periods.finalize'])).not.toContain('Release payslips');
  });
});

describe('StageBar with checkpoint reviews', () => {
  it('reads Reviewed 1/2 after one confirmed review, not yet reached', () => {
    const html = renderToStaticMarkup(<StageBar period={period} review={review} />);
    expect(html).toMatch(/aria-current="step"[^>]*>Certified</);
    expect(html).toContain('>Reviewed 1/2<');
  });
});
