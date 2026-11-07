export const CTO_REQUEST_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'FOR_APPROVAL',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
] as const;
export type CtoRequestStatus = (typeof CTO_REQUEST_STATUSES)[number];

/** Statuses whose uncancelled dates hold their Work Date for the Employee. */
export const CTO_LIVE_STATUSES: readonly CtoRequestStatus[] = [
  'SUBMITTED',
  'FOR_APPROVAL',
  'APPROVED',
];

/** JC 2, s. 2004 item 5.9.2: a request covers at most five consecutive Work Dates. */
export const CTO_MAX_WORK_DATES = 5;

/** The shared Approval Route a CTO Request is recommended and approved through. */
export const CTO_REQUEST_ROUTE_CODE = 'CTO_REQUEST';
export const CTO_REQUEST_APPROVAL_SUBJECT_TYPE = 'CTO_REQUEST';

/** The source an Attendance CTO input names for an approved Work Date. */
export const CTO_ATTENDANCE_SOURCE_TYPE = 'CtoRequest';

export const CREATE_PERMISSION = 'overtime.cto.create';
export const SUBMIT_PERMISSION = 'overtime.cto.submit';
export const WITHDRAW_PERMISSION = 'overtime.cto.withdraw';
export const RECOMMEND_PERMISSION = 'overtime.cto.recommend';
export const RETURN_PERMISSION = 'overtime.cto.return';
export const APPROVE_PERMISSION = 'overtime.cto.approve';
export const REJECT_PERMISSION = 'overtime.cto.reject';
export const CANCEL_PERMISSION = 'overtime.cto.cancel';

/**
 * Why approved CTO is cancelled: the Head of Office's recall in the exigency of the
 * service (JC 2, s. 2004 item 5.9.3), or the Employee's request made outside the
 * system (hris-controls §5.19).
 */
export const CTO_CANCELLATION_KINDS = ['RECALL', 'EMPLOYEE_REQUEST'] as const;
export type CtoCancellationKind = (typeof CTO_CANCELLATION_KINDS)[number];

export type CtoRequestDateInput =
  | { workDate: string; unit: 'WHOLE' }
  /** `startsAt` and `endsAt` are ISO instants. */
  | { workDate: string; unit: 'HALF'; startsAt: string; endsAt: string };

export interface CtoRequestCreateInput {
  employeeId: string;
  dates: CtoRequestDateInput[];
}

export interface CtoRequestRecommendInput {
  comment?: string | undefined;
}

export interface CtoRequestReturnInput {
  comment: string;
}

export interface CtoRequestApproveInput {
  comment?: string | undefined;
}

export interface CtoRequestRejectInput {
  reason: string;
}

export interface CtoRequestCancelInput {
  kind: CtoCancellationKind;
  reason: string;
  /** The Work Dates to cancel; every uncancelled one when omitted. */
  workDates?: string[] | undefined;
}

export interface CtoRequestDateSummary {
  id: string;
  workDate: string;
  unit: 'WHOLE' | 'HALF';
  startsAt: string | null;
  endsAt: string | null;
  chargedMinutes: number;
  attendanceCtoInputId: string | null;
  cancelledByCtoCancellationId: string | null;
}

export interface CtoRequestSummary {
  id: string;
  agencyId: string;
  employeeId: string;
  cocAccountId: string;
  status: CtoRequestStatus;
  approvedByMembershipId: string | null;
  approvedAt: string | null;
  createdAt: string;
  totalChargedMinutes: number;
  dates: CtoRequestDateSummary[];
}

export class CtoRequestError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'CtoRequestError';
  }
}
