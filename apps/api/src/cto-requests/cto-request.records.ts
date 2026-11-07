import { Prisma } from '@prisma/client';
import { hasPermission, type RequestContext } from '@lingkod-hr/auth';
import type { AttendanceDaysService } from '../attendance-days/attendance-days.service';
import { resolveEmployeeScope, scopeCovers } from '../employee-scope';
import { datesBetween } from './cto-request-rule';
import {
  CTO_LIVE_STATUSES,
  CTO_MAX_WORK_DATES,
  CTO_REQUEST_APPROVAL_SUBJECT_TYPE,
  CtoRequestError,
  type CtoRequestDateInput,
  type CtoRequestDateSummary,
  type CtoRequestStatus,
  type CtoRequestSummary,
} from './cto-requests.types';

const requestSelect = {
  id: true,
  agencyId: true,
  employeeId: true,
  cocAccountId: true,
  status: true,
  approvedByMembershipId: true,
  approvedAt: true,
  createdAt: true,
  dates: {
    orderBy: { workDate: 'asc' as const },
    select: {
      id: true,
      workDate: true,
      unit: true,
      startsAt: true,
      endsAt: true,
      chargedMinutes: true,
      attendanceCtoInputId: true,
      cancelledByCtoCancellationId: true,
      attendanceCorrectionId: true,
    },
  },
} as const;

export function toDatabaseDate(workDate: string): Date {
  return new Date(`${workDate}T00:00:00.000Z`);
}

export async function readRequest(
  transaction: Prisma.TransactionClient,
  agencyId: string,
  requestId: string,
): Promise<CtoRequestSummary> {
  const record = await transaction.ctoRequest.findFirst({
    where: { agencyId, id: requestId },
    select: requestSelect,
  });
  if (!record) throw requestNotFound();
  return {
    id: record.id,
    agencyId: record.agencyId,
    employeeId: record.employeeId,
    cocAccountId: record.cocAccountId,
    status: record.status as CtoRequestStatus,
    approvedByMembershipId: record.approvedByMembershipId,
    approvedAt: record.approvedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    totalChargedMinutes: record.dates.reduce((sum, date) => sum + date.chargedMinutes, 0),
    dates: record.dates.map((date) => ({
      id: date.id,
      workDate: date.workDate.toISOString().slice(0, 10),
      unit: date.unit as CtoRequestDateSummary['unit'],
      startsAt: date.startsAt?.toISOString() ?? null,
      endsAt: date.endsAt?.toISOString() ?? null,
      chargedMinutes: date.chargedMinutes,
      attendanceCtoInputId: date.attendanceCtoInputId,
      cancelledByCtoCancellationId: date.cancelledByCtoCancellationId,
      attendanceCorrectionId: date.attendanceCorrectionId,
    })),
  };
}

/** Lock one request for a command and return it. */
export async function lockRequest(
  transaction: Prisma.TransactionClient,
  agencyId: string,
  requestId: string,
): Promise<CtoRequestSummary> {
  const rows = await transaction.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT "id" FROM "cto_requests" WHERE "agency_id" = CAST(${agencyId} AS uuid) AND "id" = CAST(${requestId} AS uuid) FOR UPDATE`,
  );
  if (rows.length !== 1) throw requestNotFound();
  return readRequest(transaction, agencyId, requestId);
}

/**
 * Require the permission and that its grant reaches the Employee: an Agency grant
 * reaches everyone, a Supervisor's DIRECT_REPORTS grant their direct reports
 * (ADR 0007), and an Employee's OWN grant only themselves.
 */
export async function assertEmployeeAccess(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  permission: string,
  employeeId: string,
): Promise<void> {
  const forbidden = new CtoRequestError(
    'The current Agency Membership lacks the required permission.',
    403,
    'CTO_REQUEST_FORBIDDEN',
  );
  if (!context.agencyId || !context.userId || !context.membershipId) throw forbidden;
  if (hasPermission(context, permission, { agencyId: context.agencyId })) return;
  const scope = await resolveEmployeeScope(context, permission, transaction);
  if (!scope) throw forbidden;
  if (!scopeCovers(scope, employeeId)) {
    throw new CtoRequestError(
      'The Employee is outside the scope of the current Agency Membership.',
      403,
      'CTO_REQUEST_SCOPE_FORBIDDEN',
    );
  }
}

/** Refuse an actor deciding their own request, whatever the grant. */
export async function assertNotOwnRequest(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  employeeId: string,
): Promise<void> {
  const membership = await transaction.agencyMembership.findFirst({
    where: { agencyId: context.agencyId, id: context.membershipId },
    select: { employeeId: true },
  });
  if (membership?.employeeId === employeeId) {
    throw new CtoRequestError(
      'An Employee cannot decide their own CTO Request.',
      403,
      'CTO_REQUEST_SELF_DECISION',
    );
  }
}

export function assertStatus(
  request: CtoRequestSummary,
  expected: readonly CtoRequestStatus[],
  action: string,
): void {
  if (!expected.includes(request.status)) {
    throw new CtoRequestError(
      `Only a ${expected.join(' or ')} CTO Request can be ${action}; this one is ${request.status}.`,
      409,
      'CTO_REQUEST_STATUS_INVALID',
    );
  }
}

/**
 * Whether this actor already made this decision under this idempotency key, so a
 * retry returns the request and writes nothing. Run under the request lock. Another
 * actor, a different reason, or a different `fingerprint` of the decision's other
 * inputs under the same key is a conflict.
 */
export async function decisionAlreadyRecorded(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  decision: {
    action: 'CTO_REQUEST_APPROVED' | 'CTO_REQUEST_REJECTED' | 'CTO_REQUEST_CANCELLED';
    requestId: string;
    idempotencyKey: string | undefined;
    reason: string | null;
    fingerprint?: string;
  },
): Promise<boolean> {
  if (!decision.idempotencyKey) return false;
  const event = await transaction.auditEvent.findFirst({
    where: {
      agencyId: context.agencyId,
      action: decision.action,
      entityId: decision.requestId,
      idempotencyKey: decision.idempotencyKey,
    },
    select: { actorMembershipId: true, reason: true, metadata: true },
  });
  if (!event) return false;
  const metadata = event.metadata as Prisma.JsonObject | null;
  if (
    event.actorMembershipId !== context.membershipId ||
    event.reason !== decision.reason ||
    (decision.fingerprint !== undefined && metadata?.fingerprint !== decision.fingerprint)
  ) {
    throw new CtoRequestError(
      'This Idempotency-Key was used for a different CTO Request decision.',
      409,
      'CTO_REQUEST_IDEMPOTENCY_CONFLICT',
    );
  }
  return true;
}

/** The stored dates as the input they were created from. */
export function dateInputs(request: CtoRequestSummary): CtoRequestDateInput[] {
  return request.dates.map((date) =>
    date.unit === 'HALF'
      ? { workDate: date.workDate, unit: 'HALF', startsAt: date.startsAt!, endsAt: date.endsAt! }
      : { workDate: date.workDate, unit: 'WHOLE' },
  );
}

const unitInvalid = (message: string, code: string) => new CtoRequestError(message, 422, code);

/**
 * Validate a request's Work Dates against the Employee's schedule and return each
 * date's charge, in Work Date order: at most five distinct dates with no working
 * date between them, each charged its expected-duty minutes or half of them. A
 * calendar date without expected duty does not break the run, so a Friday and the
 * next Monday are consecutive on a Monday-to-Friday schedule.
 *
 * A `HALF` interval must be placed on expected duty and span exactly the charge,
 * since Attendance pays the interval and the ledger draws the charge. A `HALF` date
 * with an odd number of expected minutes is refused: no source sets a rounding rule.
 */
export async function chargeWorkDates(
  days: AttendanceDaysService,
  transaction: Prisma.TransactionClient,
  agencyId: string,
  employeeId: string,
  dates: readonly CtoRequestDateInput[],
): Promise<Array<CtoRequestDateInput & { chargedMinutes: number }>> {
  if (dates.length === 0) {
    throw unitInvalid('A CTO Request needs at least one Work Date.', 'CTO_REQUEST_NO_WORK_DATES');
  }
  if (new Set(dates.map((date) => date.workDate)).size !== dates.length) {
    throw unitInvalid('A Work Date appears once on a CTO Request.', 'CTO_WORK_DATE_REPEATED');
  }
  if (dates.length > CTO_MAX_WORK_DATES) {
    throw unitInvalid(
      `A CTO Request holds at most ${CTO_MAX_WORK_DATES} consecutive Work Dates.`,
      'CTO_TOO_MANY_WORK_DATES',
    );
  }
  const ordered = [...dates].sort((left, right) => left.workDate.localeCompare(right.workDate));
  const charged = [];
  for (const date of ordered) {
    const duty = await days.expectedDutyInTransaction(
      transaction,
      agencyId,
      employeeId,
      date.workDate,
      date.unit === 'HALF'
        ? { startsAt: new Date(date.startsAt), endsAt: new Date(date.endsAt) }
        : undefined,
    );
    if (!duty) {
      throw new CtoRequestError(
        `The Employee's schedule for ${date.workDate} cannot be resolved, so its expected duty is unknown.`,
        409,
        'CTO_SCHEDULE_UNRESOLVED',
      );
    }
    if (duty.minutes === 0) {
      throw unitInvalid(
        `${date.workDate} has no expected duty, so it cannot take CTO.`,
        'CTO_NO_EXPECTED_DUTY',
      );
    }
    if (date.unit === 'WHOLE') {
      charged.push({ ...date, chargedMinutes: duty.minutes });
      continue;
    }
    if (duty.minutes % 2 !== 0) {
      throw unitInvalid(
        `${date.workDate} has ${duty.minutes} expected minutes, which do not halve into whole minutes.`,
        'CTO_HALF_NOT_WHOLE_MINUTES',
      );
    }
    if (duty.timedCtoMinutes === null) {
      throw unitInvalid(
        `The half day on ${date.workDate} falls outside its expected duty.`,
        'CTO_HALF_OUTSIDE_EXPECTED_DUTY',
      );
    }
    const chargedMinutes = duty.minutes / 2;
    if (duty.timedCtoMinutes !== chargedMinutes) {
      throw unitInvalid(
        `The half day on ${date.workDate} covers ${duty.timedCtoMinutes} minutes of expected duty, not ${chargedMinutes}.`,
        'CTO_HALF_INTERVAL_NOT_HALF',
      );
    }
    charged.push({ ...date, chargedMinutes });
  }
  await assertConsecutive(
    days,
    transaction,
    agencyId,
    employeeId,
    ordered.map((date) => date.workDate),
  );
  return charged;
}

async function assertConsecutive(
  days: AttendanceDaysService,
  transaction: Prisma.TransactionClient,
  agencyId: string,
  employeeId: string,
  workDates: readonly string[],
): Promise<void> {
  for (const [index, workDate] of workDates.slice(1).entries()) {
    for (const between of datesBetween(workDates[index]!, workDate)) {
      const duty = await days.expectedDutyInTransaction(transaction, agencyId, employeeId, between);
      if (!duty || duty.minutes > 0) {
        throw unitInvalid(
          `The Work Dates of a CTO Request are consecutive, but ${between} lies between them.`,
          'CTO_WORK_DATES_NOT_CONSECUTIVE',
        );
      }
    }
  }
}

/**
 * Refuse a Work Date already uncancelled on one of the Employee's live requests. A
 * DRAFT is not live, so the request being submitted never finds itself, and a
 * cancelled date is free for a new request. Submission holds the COC Account lock
 * across this read and its status change, so two submissions can't both pass.
 * Creating a draft reads without the lock, to refuse early.
 */
export async function assertWorkDatesNotLive(
  transaction: Prisma.TransactionClient,
  agencyId: string,
  employeeId: string,
  workDates: readonly string[],
): Promise<void> {
  const taken = await transaction.ctoRequestDate.findFirst({
    where: {
      agencyId,
      workDate: { in: workDates.map(toDatabaseDate) },
      cancelledByCtoCancellationId: null,
      request: { employeeId, status: { in: [...CTO_LIVE_STATUSES] } },
    },
    orderBy: { workDate: 'asc' },
    select: { workDate: true },
  });
  if (taken) {
    throw new CtoRequestError(
      `${taken.workDate.toISOString().slice(0, 10)} is already on another of the Employee's CTO Requests.`,
      409,
      'CTO_WORK_DATE_TAKEN',
    );
  }
}

/** The request's one open Approval Request in `status`, if any. */
export function openApprovalRequest(
  transaction: Prisma.TransactionClient,
  agencyId: string,
  requestId: string,
  status: 'IN_PROGRESS' | 'RETURNED',
) {
  return transaction.approvalRequest.findFirst({
    where: {
      agencyId,
      subjectType: CTO_REQUEST_APPROVAL_SUBJECT_TYPE,
      subjectId: requestId,
      status,
    },
    select: { id: true },
  });
}

export function approvalRequestMissing(): CtoRequestError {
  return new CtoRequestError(
    'The CTO Request has no Approval Request awaiting a decision.',
    409,
    'CTO_REQUEST_APPROVAL_REQUEST_MISSING',
  );
}

export function requestNotFound(): CtoRequestError {
  return new CtoRequestError('The CTO Request could not be found.', 404, 'CTO_REQUEST_NOT_FOUND');
}
