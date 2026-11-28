import type { StatusDisplay } from '../components/ui/status-tag';
import {
  periodStatusDisplay,
  type PayrollPeriod,
  type PayrollPeriodStatus,
} from './payroll-periods';

export type PayrollAdjustmentStatus = 'OPEN' | 'POSTED' | 'CANCELLED';
export type PayrollAdjustmentOrigin = 'SOURCE_CORRECTION' | 'PAYROLL_HOLD' | 'RECALCULATION';

/** A Payroll Period a Payroll Adjustment names. */
export interface PayrollAdjustmentPeriodRef {
  id: string;
  code: string;
  status: PayrollPeriodStatus;
}

/** Why a Payroll Adjustment opened, or a later cause that joined it. */
export interface PayrollAdjustmentCause {
  id: string;
  origin: PayrollAdjustmentOrigin;
  reason: string | null;
  payrollInputId: string | null;
  sourceCorrectionKey: string | null;
  payrollHoldId: string | null;
  openedByMembershipId: string | null;
  openedByName: string | null;
  createdAt: string;
}

/**
 * One Payroll Adjustment as `GET /payroll-adjustments` lists it. `carriedBy` names each period
 * whose current calculation carries an open one; `postedBy` the period that posted it. It holds no
 * amount: the carrying period's Payroll Lines hold the difference.
 */
export interface PayrollAdjustment {
  id: string;
  employeeId: string;
  status: PayrollAdjustmentStatus;
  openedAt: string;
  postedAt: string | null;
  cancelledAt: string | null;
  originalPayrollPeriod: PayrollAdjustmentPeriodRef;
  carriedBy: PayrollAdjustmentPeriodRef[];
  postedBy: PayrollAdjustmentPeriodRef | null;
  causes: PayrollAdjustmentCause[];
}

/** What `POST /payroll-periods/:id/adjustments` answers: one row per Employee. */
export interface PayrollRecalculationResult {
  payrollPeriodId: string;
  adjustments: { payrollAdjustmentId: string; employeeId: string; joined: boolean }[];
}

/** An open adjustment is pending until a payroll posts it; it never reads as done. */
export const adjustmentStatusDisplay: Record<PayrollAdjustmentStatus, StatusDisplay> = {
  OPEN: { label: 'Pending', tone: 'warning' },
  POSTED: { label: 'Posted', tone: 'success' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
};

export const causeOriginLabel: Record<PayrollAdjustmentOrigin, string> = {
  SOURCE_CORRECTION: 'Source correction',
  PAYROLL_HOLD: 'Payroll Hold',
  RECALCULATION: 'Recalculation request',
};

/** The filters of the adjustment list; `ALL` sends none. */
export const ADJUSTMENT_FILTERS = ['OPEN', 'POSTED', 'CANCELLED', 'ALL'] as const;
export type AdjustmentFilter = (typeof ADJUSTMENT_FILTERS)[number];

export const adjustmentFilterLabel: Record<AdjustmentFilter, string> = {
  OPEN: 'Pending',
  POSTED: 'Posted',
  CANCELLED: 'Cancelled',
  ALL: 'All',
};

/** The list's query string for a filter. */
export function adjustmentListPath(filter: AdjustmentFilter): string {
  return filter === 'ALL' ? '/payroll-adjustments' : `/payroll-adjustments?status=${filter}`;
}

const periodLabel = (period: PayrollAdjustmentPeriodRef) =>
  `${period.code} (${periodStatusDisplay[period.status].label})`;

/**
 * Where an adjustment stands, in the API's terms: the period that posted it, the periods whose
 * calculation carries it, or that no payroll has taken it up yet.
 */
export function adjustmentProgress(adjustment: PayrollAdjustment): string {
  switch (adjustment.status) {
    case 'POSTED':
      return adjustment.postedBy ? `Posted by ${adjustment.postedBy.code}` : 'Posted';
    case 'CANCELLED':
      return 'Cancelled';
    case 'OPEN':
      return adjustment.carriedBy.length === 0
        ? 'Not in a payroll yet'
        : `In ${adjustment.carriedBy.map(periodLabel).join(', ')}`;
  }
}

/** What one cause names, beyond its origin. */
export function causeDetail(cause: PayrollAdjustmentCause): string[] {
  switch (cause.origin) {
    case 'SOURCE_CORRECTION':
      return [
        `Correction key ${cause.sourceCorrectionKey ?? '—'}`,
        `Payroll Input ${cause.payrollInputId ?? '—'}`,
      ];
    case 'PAYROLL_HOLD':
      return [`Payroll Hold ${cause.payrollHoldId ?? '—'}`];
    case 'RECALCULATION':
      return [cause.reason ?? '', `Asked by ${cause.openedByName ?? 'an unknown member'}`];
  }
}

/** A void request or a void, as the period list reports it. */
export type VoidState = 'REQUESTED' | 'VOIDED';

/**
 * A finalized period's void, if it has one: requested and awaiting approval, or voided. A draft
 * that was cancelled was never finalized, so it is no correction.
 */
export function voidStateOf(period: PayrollPeriod): VoidState | null {
  if (period.finalizedAt === null) return null;
  if (period.status === 'VOIDED') return 'VOIDED';
  if (period.status === 'FINALIZED' && period.voidRequestedAt !== null) return 'REQUESTED';
  return null;
}

/** A requested void is pending, never voided. */
export const voidStateDisplay: Record<VoidState, StatusDisplay> = {
  REQUESTED: { label: 'Void requested', tone: 'warning' },
  VOIDED: { label: 'Voided', tone: 'neutral' },
};

/** What a recalculation request did, as the API answered it, naming each Employee. */
export function recalculationNotice(
  code: string,
  result: PayrollRecalculationResult,
  employeeName: (employeeId: string) => string,
): string {
  const rows = result.adjustments;
  if (rows.length === 0) return `${code} has no Employee to recalculate.`;
  const joined = rows.filter((row) => row.joined);
  const opened = rows.filter((row) => !row.joined);
  const names = (list: typeof rows) =>
    list.length === 1 ? employeeName(list[0]!.employeeId) : `${list.length} Employees`;
  const parts = [];
  if (opened.length > 0) {
    parts.push(`Opened a Payroll Adjustment against ${code} for ${names(opened)}.`);
  }
  if (joined.length > 0) {
    parts.push(`Joined the open Payroll Adjustment against ${code} for ${names(joined)}.`);
  }
  parts.push('It stays pending until a payroll carries it.');
  return parts.join(' ');
}
