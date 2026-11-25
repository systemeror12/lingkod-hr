import type { StatusDisplay } from '../components/ui/status-tag';

export type PayrollPeriodStatus =
  'DRAFT' | 'CALCULATING' | 'FOR_REVIEW' | 'CERTIFIED' | 'APPROVED' | 'FINALIZED' | 'VOIDED';
export type PayrollRunType = 'REGULAR' | 'SPECIAL';
export type PayrollExceptionSeverity = 'BLOCKING' | 'WARNING';
export type PayrollExceptionStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';

/** The totals of a period's current calculation version; null before one completes. */
export interface PayrollPeriodTotals {
  resultCount: number;
  grossAmount: string;
  totalDeductions: string;
  netAmount: string;
}

/** One period as `GET /payroll-periods` lists it. */
export interface PayrollPeriod {
  id: string;
  code: string;
  runType: PayrollRunType;
  periodFrom: string;
  periodTo: string;
  cutoffAt: string;
  paymentDate: string;
  status: PayrollPeriodStatus;
  /** A special period marked to carry the open Payroll Adjustments: the supplemental payroll. */
  carriesAdjustments: boolean;
  calculationVersion: number;
  payComponentIds: string[];
  /** When it became Finalized; kept once it is voided. */
  finalizedAt: string | null;
  /** A finalized period's open or approved void request (#358); null when none. */
  voidRequestedAt: string | null;
  voidDocumentVersionId: string | null;
  /** The void request's reason, or a cancelled draft's. */
  voidReason: string | null;
  voidedAt: string | null;
  rowVersion: number;
  totals: PayrollPeriodTotals | null;
}

export interface PayComponentOption {
  id: string;
  code: string;
  name: string;
}

export interface PayrollPeriodList {
  periods: PayrollPeriod[];
  payComponents: PayComponentOption[];
}

/** One Payroll Employee Result: an Employee's payslip in one calculation version. */
export interface PayrollResult {
  id: string;
  employeeId: string;
  calculationVersion: number;
  status: string;
  grossAmount: string;
  totalDeductions: string;
  netAmount: string;
}

export type PayrollLineSourceKind =
  'PAYROLL_INPUT' | 'ATTENDANCE_PAYROLL_FACT' | 'AUTHORIZED_PAYROLL_COMPONENT_INPUT';

export interface PayrollLine {
  id: string;
  payComponent: PayComponentOption;
  lineType: string;
  quantity: string | null;
  rate: string | null;
  amount: string;
  ruleVersion: { id: string; code: string; name: string } | null;
  sources: { kind: PayrollLineSourceKind; id: string }[];
  sourceSnapshot: unknown;
}

export type ContributionType = 'GSIS' | 'EMPLOYEES_COMPENSATION' | 'PHILHEALTH' | 'PAGIBIG';
type RuleVersionRef = { id: string; code: string; name: string };

/** One statutory contribution of a payslip, with the base its shares were figured on. */
export interface ContributionLine {
  id: string;
  contributionType: ContributionType;
  employeeShare: string;
  employerShare: string;
  compensationBase: string;
  ruleVersion: RuleVersionRef;
}

/**
 * The withholding tax of a payslip. `yearToDateSnapshot` is what the calculation read of the
 * Agency's finalized periods earlier in the tax year, as stored; `yearToDateFacts` reads it.
 */
export interface TaxLine {
  id: string;
  taxableCompensation: string;
  nonTaxableCompensation: string;
  withholdingTax: string;
  ruleVersion: RuleVersionRef;
  yearToDateSnapshot: unknown;
}

/** What one Deduction Obligation was due, what was deducted, and what the net-pay floor stopped. */
export interface LoanDeductionLine {
  id: string;
  deductionObligationId: string;
  payeeCategory: string;
  payeeName: string;
  issuerReference: string;
  priority: number;
  amountDue: string;
  deductedAmount: string;
  notDeductedAmount: string;
  ruleVersion: RuleVersionRef;
}

export interface PayrollResultDetail extends PayrollResult {
  calculationHash: string;
  lines: PayrollLine[];
  contributions: ContributionLine[];
  taxLine: TaxLine | null;
  loanDeductions: LoanDeductionLine[];
}

/** One issuer billing row of a period; a later billing of the Employee and type supersedes it. */
export interface ContributionBilling {
  id: string;
  employeeId: string;
  contributionType: ContributionType;
  employeeShare: string;
  employerShare: string;
  evidenceDocumentVersionId: string;
  supersedesContributionBillingId: string | null;
  recordedAt: string;
  current: boolean;
}

export const contributionTypeLabel: Record<ContributionType, string> = {
  GSIS: 'GSIS',
  EMPLOYEES_COMPENSATION: "Employees' Compensation",
  PHILHEALTH: 'PhilHealth',
  PAGIBIG: 'Pag-IBIG',
};

/**
 * The year-to-date figures a Tax Line read, as labelled facts, skipping any the snapshot lacks.
 * Amounts read as pesos; the de minimis benefits read one per benefit.
 */
export function yearToDateFacts(snapshot: unknown): [string, string][] {
  if (typeof snapshot !== 'object' || snapshot === null) return [];
  const value = snapshot as Record<string, unknown>;
  const facts: [string, string][] = [];
  if (typeof value.taxYear === 'number') facts.push(['Tax year', String(value.taxYear)]);
  if (Array.isArray(value.payrollPeriodIds)) {
    const count = value.payrollPeriodIds.length;
    facts.push(['Finalized periods counted', count === 1 ? '1 period' : `${count} periods`]);
  }
  const amounts: [string, string][] = [
    ['taxableCompensation', 'Taxable compensation'],
    ['nonTaxableCompensation', 'Non-taxable compensation'],
    ['withholdingTax', 'Withholding tax'],
    ['thirteenthMonthAndOtherBenefits', '13th-month pay and other benefits'],
  ];
  for (const [key, label] of amounts) {
    const amount = value[key];
    if (typeof amount === 'string') facts.push([label, moneyLabel(amount)]);
  }
  const deMinimis = value.deMinimisBenefits;
  if (typeof deMinimis === 'object' && deMinimis !== null) {
    for (const [benefit, amount] of Object.entries(deMinimis)) {
      if (typeof amount === 'string') {
        facts.push([`De minimis: ${exceptionTypeLabel(benefit)}`, moneyLabel(amount)]);
      }
    }
  }
  return facts;
}

export interface PayrollException {
  id: string;
  calculationVersion: number;
  employeeId: string | null;
  exceptionType: string;
  severity: PayrollExceptionSeverity;
  status: PayrollExceptionStatus;
  details: unknown;
  reason: string | null;
}

/** A calculation still running is pending, never done: only Finalized reads as complete. */
export const periodStatusDisplay: Record<PayrollPeriodStatus, StatusDisplay> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  CALCULATING: { label: 'Computing…', tone: 'warning' },
  FOR_REVIEW: { label: 'For review', tone: 'info' },
  CERTIFIED: { label: 'Certified', tone: 'info' },
  APPROVED: { label: 'Approved', tone: 'info' },
  FINALIZED: { label: 'Finalized', tone: 'success' },
  VOIDED: { label: 'Voided', tone: 'neutral' },
};

export const runTypeLabel: Record<PayrollRunType, string> = {
  REGULAR: 'Regular',
  SPECIAL: 'Special',
};

/** A blocked result has no lines and zero totals, so it never reads as calculated. */
export function resultStatusDisplay(status: string): StatusDisplay {
  switch (status) {
    case 'CALCULATED':
      return { label: 'Calculated', tone: 'info' };
    case 'EXCEPTION':
      return { label: 'Blocked by exception', tone: 'danger' };
    case 'FINALIZED':
      return { label: 'Finalized', tone: 'success' };
    // A voided period's results stay readable, voided with it (#358).
    case 'VOIDED':
      return { label: 'Voided', tone: 'neutral' };
    default:
      return { label: status, tone: 'neutral' };
  }
}

export const severityDisplay: Record<PayrollExceptionSeverity, StatusDisplay> = {
  BLOCKING: { label: 'Blocking', tone: 'danger' },
  WARNING: { label: 'Warning', tone: 'warning' },
};

export const exceptionStatusDisplay: Record<PayrollExceptionStatus, StatusDisplay> = {
  OPEN: { label: 'Open', tone: 'warning' },
  ACKNOWLEDGED: { label: 'Acknowledged', tone: 'neutral' },
  RESOLVED: { label: 'Resolved', tone: 'neutral' },
};

export const lineTypeLabel: Record<string, string> = {
  EARNING: 'Earning',
  DEDUCTION: 'Deduction',
  EMPLOYER_SHARE: 'Employer share',
  INFORMATIONAL: 'Informational',
};

export const lineSourceLabel: Record<PayrollLineSourceKind, string> = {
  PAYROLL_INPUT: 'Payroll Input',
  ATTENDANCE_PAYROLL_FACT: 'Attendance Payroll Fact',
  AUTHORIZED_PAYROLL_COMPONENT_INPUT: 'Authorized Payroll Component Input',
};

/** An exception type code as words: `BASIC_SALARY_MISSING` reads `Basic salary missing`. */
export function exceptionTypeLabel(code: string): string {
  const words = code.toLowerCase().replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Why the calculation raised the exception, as it recorded it. */
export function exceptionMessage(details: unknown): string | null {
  const message = (details as { message?: unknown } | null)?.message;
  return typeof message === 'string' ? message : null;
}

/**
 * An amount as the API sends it, in pesos with grouped thousands and at least two decimals:
 * `31705.0000` reads `₱31,705.00`. Digits past the centavo stay when they are not zero.
 */
export function moneyLabel(value: string): string {
  const negative = value.startsWith('-');
  const [whole = '0', fraction = ''] = value.replace(/^-/, '').split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const cents = fraction.replace(/0+$/, '').padEnd(2, '0');
  return `${negative ? '-' : ''}₱${grouped}.${cents}`;
}

export type StageCell = {
  label: string;
  state: 'done' | 'current' | 'pending';
};

const STAGES = ['Draft', 'Calculated', 'Certified', 'Reviewed', 'Approved', 'Finalized'] as const;

/** How many stage cells each status has reached. */
const reached: Record<Exclude<PayrollPeriodStatus, 'VOIDED'>, number> = {
  DRAFT: 1,
  CALCULATING: 1,
  FOR_REVIEW: 2,
  CERTIFIED: 3,
  APPROVED: 5,
  FINALIZED: 6,
};

/**
 * The stage bar of a period: Draft, Calculated, Certified, Reviewed, Approved, and Finalized,
 * each its own cell. A running calculation reads `Computing…` in the Calculated cell and never
 * as done. A certified period is Reviewed once both checkpoint reviews are confirmed; after one
 * it reads `Reviewed 1/2`, still pending. A voided period has no stage bar.
 */
export function stageCells(status: PayrollPeriodStatus, confirmedReviews = 0): StageCell[] | null {
  if (status === 'VOIDED') return null;
  const reviewed = status === 'CERTIFIED' && confirmedReviews >= CHECKPOINTS.length;
  const done = reviewed ? reached.CERTIFIED + 1 : reached[status];
  return STAGES.map((label, index) => {
    if (status === 'CALCULATING' && index === 1) return { label: 'Computing…', state: 'current' };
    if (index < done) return { label, state: index === done - 1 ? 'current' : 'done' };
    if (status === 'CERTIFIED' && label === 'Reviewed' && confirmedReviews > 0) {
      return { label: `Reviewed ${confirmedReviews}/${CHECKPOINTS.length}`, state: 'pending' };
    }
    return { label, state: 'pending' };
  });
}

/** Finished periods start collapsed on the list. */
export function startsCollapsed(status: PayrollPeriodStatus): boolean {
  return status === 'FINALIZED' || status === 'VOIDED';
}

export type PayrollExportCheckpoint = 'BUDGET' | 'ACCOUNTING';

/** Budget reviews funding and Accounting reviews the accounts, in either order (#29). */
export const CHECKPOINTS: readonly PayrollExportCheckpoint[] = ['BUDGET', 'ACCOUNTING'];

export const checkpointLabel: Record<PayrollExportCheckpoint, string> = {
  BUDGET: 'Budget',
  ACCOUNTING: 'Accounting',
};

/** One Payroll Export Checkpoint Review of the current Certified Payroll Review Export. */
export interface CheckpointReview {
  id: string;
  reviewExportId: string;
  checkpoint: PayrollExportCheckpoint;
  outcome: 'CONFIRMED' | 'RETURNED';
  externalReference: string | null;
  evidenceDocumentVersionId: string | null;
  reason: string | null;
  reviewedByMembershipId: string;
  reviewedByName: string | null;
  reviewedAt: string;
}

/** The Payroll Certification in force, its approval, and its export's checkpoint reviews. */
export interface PayrollCertification {
  id: string;
  calculationVersion: number;
  calculationHash: string;
  certifiedByMembershipId: string;
  certifiedByName: string | null;
  certifiedAt: string;
  approvedByMembershipId: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  reviewExportId: string | null;
  checkpointReviews: CheckpointReview[];
}

/** A period as `GET /payroll-periods/:id` reads it: what certifying binds and who acted. */
export interface PayrollPeriodReview {
  id: string;
  status: PayrollPeriodStatus;
  calculationVersion: number;
  rowVersion: number;
  calculationHash: string | null;
  finalizedAt: string | null;
  finalizedByMembershipId: string | null;
  finalizedByName: string | null;
  certification: PayrollCertification | null;
  /** A voided regular period's replacement: the same month's regular period that is not voided. */
  replacedByPeriodId: string | null;
  /** The voided periods a regular period replaces. */
  replacesPeriodIds: string[];
}

/** The checkpoint reviews confirmed on the export in force. */
export function confirmedCheckpoints(review: PayrollPeriodReview): PayrollExportCheckpoint[] {
  const reviews = review.certification?.checkpointReviews ?? [];
  return CHECKPOINTS.filter((checkpoint) =>
    reviews.some((row) => row.checkpoint === checkpoint && row.outcome === 'CONFIRMED'),
  );
}

/** The review commands of a period (hris-controls.md §5.20); `primary` ones move it forward. */
export type ReviewAction =
  | { kind: 'certify'; primary: true }
  | { kind: 'return'; primary: false }
  | { kind: 'checkpoint'; checkpoint: PayrollExportCheckpoint; primary: true }
  | { kind: 'revoke'; primary: false }
  | { kind: 'approve'; primary: true }
  | { kind: 'return-approved'; primary: false }
  | { kind: 'finalize'; primary: true }
  | { kind: 'release'; primary: true };

/** The permission each review command, and each payslip command, needs Agency-wide (§6.10). */
export const REVIEW_PERMISSIONS = [
  'payroll.periods.certify',
  'payroll.periods.return',
  'payroll.periods.review_funding',
  'payroll.periods.review_accounting',
  'payroll.periods.revoke_certification',
  'payroll.periods.approve',
  'payroll.periods.return_approved',
  'payroll.periods.finalize',
  'payroll.payslips.release',
  'payroll.payslips.withhold',
] as const;

export type ReviewPermission = (typeof REVIEW_PERMISSIONS)[number];

const checkpointPermission: Record<PayrollExportCheckpoint, ReviewPermission> = {
  BUDGET: 'payroll.periods.review_funding',
  ACCOUNTING: 'payroll.periods.review_accounting',
};

/**
 * The review commands the actor's permissions and the period's state allow, primary first. A
 * checkpoint is offered until it is reviewed on the export in force; approval once both are
 * confirmed. The API still decides each command, including the one-function rule, and its
 * refusal reads as its reason.
 */
export function reviewActions(
  review: PayrollPeriodReview,
  held: ReadonlySet<string>,
): ReviewAction[] {
  const actions: ReviewAction[] = [];
  switch (review.status) {
    case 'FOR_REVIEW':
      if (held.has('payroll.periods.certify') && review.calculationHash) {
        actions.push({ kind: 'certify', primary: true });
      }
      if (held.has('payroll.periods.return')) actions.push({ kind: 'return', primary: false });
      break;
    case 'CERTIFIED': {
      const reviews = review.certification?.checkpointReviews ?? [];
      if (review.certification?.reviewExportId) {
        for (const checkpoint of CHECKPOINTS) {
          if (
            held.has(checkpointPermission[checkpoint]) &&
            !reviews.some((row) => row.checkpoint === checkpoint)
          ) {
            actions.push({ kind: 'checkpoint', checkpoint, primary: true });
          }
        }
      }
      if (
        held.has('payroll.periods.approve') &&
        confirmedCheckpoints(review).length === CHECKPOINTS.length
      ) {
        actions.push({ kind: 'approve', primary: true });
      }
      if (held.has('payroll.periods.revoke_certification')) {
        actions.push({ kind: 'revoke', primary: false });
      }
      break;
    }
    case 'APPROVED':
      if (held.has('payroll.periods.finalize')) actions.push({ kind: 'finalize', primary: true });
      if (held.has('payroll.periods.return_approved')) {
        actions.push({ kind: 'return-approved', primary: false });
      }
      break;
    default:
      break;
  }
  return actions;
}

/**
 * Releasing a Finalized period's payslips, offered only while the server's list of them has one
 * Ready. Without the list nothing is offered. The API says what it released and what is still
 * generating.
 */
export function payslipActions(
  status: PayrollPeriodStatus,
  held: ReadonlySet<string>,
  payslips: readonly PeriodPayslipEntry[] | null,
): ReviewAction[] {
  const ready = payslips?.some((entry) => entry.payslip?.status === 'READY') ?? false;
  return status === 'FINALIZED' && held.has('payroll.payslips.release') && ready
    ? [{ kind: 'release', primary: true }]
    : [];
}

/** A Payslip as `GET /payroll-periods/:id/payslips` and the payslip commands return it. */
export interface PayslipRecord {
  id: string;
  payrollPeriodId: string;
  payrollEmployeeId: string;
  status: string;
  releasedAt: string | null;
  releasedByMembershipId: string | null;
  withheldAt: string | null;
  withheldByMembershipId: string | null;
  withholdReason: string | null;
}

/** One result of a period with its Payslip; null while generation has not created it yet. */
export interface PeriodPayslipEntry {
  payrollEmployeeId: string;
  employee: { id: string; employeeNumber: string; legalName: string };
  payslip: PayslipRecord | null;
}

/** A Payslip's status as the API names it: Generating never reads as Ready, nor Ready as Released. */
export function payslipStatusDisplay(payslip: { status: string } | null): StatusDisplay {
  if (!payslip) return { label: 'Not generated yet', tone: 'neutral' };
  switch (payslip.status) {
    case 'GENERATING':
      return { label: 'Generating…', tone: 'warning' };
    case 'READY':
      return { label: 'Ready', tone: 'info' };
    case 'WITHHELD':
      return { label: 'Withheld', tone: 'warning' };
    case 'RELEASED':
      return { label: 'Released', tone: 'success' };
    case 'SUPERSEDED':
      return { label: 'Superseded', tone: 'neutral' };
    default:
      return { label: payslip.status, tone: 'neutral' };
  }
}

/** What `POST /payroll-periods/:id/payslips/release` answers. */
export interface PeriodPayslipRelease {
  payrollPeriodId: string;
  releasedPayslipIds: string[];
  generatingCount: number;
}

const payslipCount = (count: number) => (count === 1 ? '1 payslip' : `${count} payslips`);

/** What a release did, as the API counted it; payslips still generating never read as released. */
export function releaseNotice(code: string, release: PeriodPayslipRelease): string {
  const released = release.releasedPayslipIds.length;
  const done =
    released === 0
      ? `No payslip of ${code} was Ready, so none was released.`
      : `Released ${payslipCount(released)} of ${code} to ${released === 1 ? 'its Employee' : 'their Employees'}.`;
  if (release.generatingCount === 0) return done;
  const [verb, pronoun] = release.generatingCount === 1 ? ['is', 'it is'] : ['are', 'they are'];
  return `${done} ${payslipCount(release.generatingCount)} ${verb} still generating; release again once ${pronoun} Ready.`;
}

/** One entry of a period's Approvals: a step, and who took it when, or that it is pending. */
export interface ApprovalEntry {
  step: string;
  state: 'done' | 'pending';
  by: string | null;
  at: string | null;
  note: string | null;
}

const memberName = (name: string | null) => name ?? 'Unknown member';

/**
 * Who certified, reviewed (Budget and Accounting apart), approved, and finalized the period, and
 * when. A step not taken yet reads Pending, never done. No record holds who started a
 * calculation, so the calculation has no entry.
 */
export function approvalEntries(review: PayrollPeriodReview): ApprovalEntry[] {
  const certification = review.certification;
  const pending = (step: string): ApprovalEntry => ({
    step,
    state: 'pending',
    by: null,
    at: null,
    note: null,
  });
  // A finalized period keeps its certification; anything earlier without one is not certified.
  const entries: ApprovalEntry[] = [
    certification
      ? {
          step: 'Certified',
          state: 'done',
          by: memberName(certification.certifiedByName),
          at: certification.certifiedAt,
          note: `Calculation version ${certification.calculationVersion}`,
        }
      : pending('Certified'),
  ];
  for (const checkpoint of CHECKPOINTS) {
    const step = `${checkpointLabel[checkpoint]} review`;
    const row = certification?.checkpointReviews.find((item) => item.checkpoint === checkpoint);
    entries.push(
      row
        ? {
            step,
            state: 'done',
            by: memberName(row.reviewedByName),
            at: row.reviewedAt,
            note:
              row.outcome === 'CONFIRMED'
                ? `Confirmed · ${row.externalReference ?? 'no reference'}`
                : `Returned · ${row.reason ?? ''}`,
          }
        : pending(step),
    );
  }
  entries.push(
    certification?.approvedAt
      ? {
          step: 'Approved',
          state: 'done',
          by: memberName(certification.approvedByName),
          at: certification.approvedAt,
          note: null,
        }
      : pending('Approved'),
    review.finalizedAt
      ? {
          step: 'Finalized',
          state: 'done',
          by: review.finalizedByMembershipId ? memberName(review.finalizedByName) : 'Not recorded',
          at: review.finalizedAt,
          note: null,
        }
      : pending('Finalized'),
  );
  return entries;
}

/** An instant in Philippine time, such as `Nov 20, 2026, 10:00 AM`. */
export function instantLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Manila',
  });
}
