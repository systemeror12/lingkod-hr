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
  calculationVersion: number;
  payComponentIds: string[];
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

export interface PayrollResultDetail extends PayrollResult {
  calculationHash: string;
  lines: PayrollLine[];
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
 * as done. A voided period has no stage bar.
 */
export function stageCells(status: PayrollPeriodStatus): StageCell[] | null {
  if (status === 'VOIDED') return null;
  const done = reached[status];
  return STAGES.map((label, index) => {
    if (status === 'CALCULATING' && index === 1) return { label: 'Computing…', state: 'current' };
    if (index < done) return { label, state: index === done - 1 ? 'current' : 'done' };
    return { label, state: 'pending' };
  });
}

/** Finished periods start collapsed on the list. */
export function startsCollapsed(status: PayrollPeriodStatus): boolean {
  return status === 'FINALIZED' || status === 'VOIDED';
}
