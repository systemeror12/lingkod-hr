import type { StatusDisplay } from '../components/ui/status-tag';

export type PayrollInputSourceModule = 'LEAVE' | 'OVERTIME';
export type PayrollInputStatus = 'PENDING' | 'CONSUMED' | 'CANCELLED';
export type AuthorizedInputStatus = 'RECORDED' | 'APPROVED' | 'CANCELLED';

export const sourceModuleLabel: Record<PayrollInputSourceModule, string> = {
  LEAVE: 'Leave',
  OVERTIME: 'Overtime',
};

/** A pending input has not been used by any payroll yet, so it never reads as done. */
export const payrollInputStatusDisplay: Record<PayrollInputStatus, StatusDisplay> = {
  PENDING: { label: 'Pending', tone: 'warning' },
  CONSUMED: { label: 'Consumed', tone: 'info' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
};

/** A recorded input takes no effect until someone other than its recorder approves it. */
export const authorizedInputStatusDisplay: Record<AuthorizedInputStatus, StatusDisplay> = {
  RECORDED: { label: 'Recorded, not approved', tone: 'warning' },
  APPROVED: { label: 'Approved', tone: 'success' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
};

export const payrollInputKindLabel: Record<string, string> = {
  LEAVE_WITHOUT_PAY: 'Leave without pay',
  UNPAID_DEFICIT_REMAINDER: 'Unpaid deficit remainder',
  MONETIZATION_EARNING: 'Monetization earning',
  OVERTIME_HOURS: 'Overtime hours',
};

/**
 * The record a source module posted, by its source type, and the workspace that holds it. An
 * unknown type keeps its raw name and has no workspace.
 */
export function sourceRecord(sourceType: string): {
  label: string;
  workspace: { href: string; label: string } | null;
} {
  switch (sourceType) {
    case 'LeavePosting':
      return {
        label: 'Leave Posting',
        workspace: { href: '/leave-applications', label: 'Leave Applications' },
      };
    case 'AttendanceDeficitCharge':
      return {
        label: 'Attendance Deficit Charge',
        workspace: { href: '/leave-accounts', label: 'Leave Accounts' },
      };
    case 'OvertimeServiceRecord':
      return {
        label: 'Overtime Service Record',
        workspace: { href: '/overtime-authorities', label: 'Overtime Authorities' },
      };
    default:
      return { label: sourceType, workspace: null };
  }
}

/** A decimal as the API sends it, without trailing zeros: `1500.00000000` reads `1500`. */
export function decimalLabel(value: string): string {
  return value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
}
