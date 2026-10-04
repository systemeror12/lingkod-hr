import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hasPermission, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import {
  AttendanceExceptionError,
  formatDate,
  manilaToday,
  toDatabaseDate,
} from '../attendance-configuration/attendance-configuration.types';
import {
  ScheduleAssignmentsService,
  type AttendanceResolution,
} from '../attendance-configuration/schedule-assignments.service';
import { ATTENDANCE_AUDIT_WRITER, type AttendanceAuditWriter } from './attendance.audit';
import {
  evaluateAttendanceSequence,
  matchAttendanceEvent,
  nextExpectedEventType,
  presentWorkDateEvents,
  type AttendanceEventMatch,
  type AttendanceWorkDateCandidate,
} from './attendance-matching';
import {
  addDateValueDays,
  attendanceExceptionDetails,
  AttendanceServiceError,
  captureException,
  eventCollectionWindow,
  localDateValue,
  zonedTimeToInstant,
  type AttendanceCaptureAssociation,
  type AttendanceCaptureException,
  type AttendanceClockStateSummary,
  type AttendanceEventCaptureResult,
  type AttendanceEventListFilter,
  type AttendanceEventPresentation,
  type AttendanceEventSource,
  type AttendanceEventSummary,
  type AttendanceEventType,
  type AttendanceMatchSummary,
  type AttendanceWebClockStatusSummary,
  type AttendanceWebClockVersionSummary,
  type AttendanceWorkDateContext,
  type AttendanceWorkDateEvent,
  type ClockAttendanceEventInput,
  type CreateManualAttendanceEventInput,
  type SetWebClockEnablementInput,
} from './attendance.types';

const eventSelect = {
  id: true,
  employeeId: true,
  eventTime: true,
  eventType: true,
  source: true,
  sourceReference: true,
  enteredByMembershipId: true,
  reason: true,
  createdAt: true,
  employee: { select: { id: true, employeeNumber: true, legalName: true } },
} as const;

const webClockSelect = {
  id: true,
  versionNo: true,
  enabled: true,
  effectiveFrom: true,
  effectiveTo: true,
  status: true,
  reason: true,
  activatedByMembershipId: true,
  activatedAt: true,
  createdAt: true,
} as const;

type AttendanceEventRecord = Prisma.AttendanceEventGetPayload<{ select: typeof eventSelect }>;
type AttendanceWebClockVersionRecord = Prisma.AttendanceWebClockVersionGetPayload<{
  select: typeof webClockSelect;
}>;

function eventSummary(record: AttendanceEventRecord): AttendanceEventSummary {
  return {
    id: record.id,
    employeeId: record.employeeId,
    employee: {
      id: record.employee.id,
      employeeNumber: record.employee.employeeNumber,
      legalName: record.employee.legalName,
    },
    eventTime: record.eventTime.toISOString(),
    eventType: record.eventType as AttendanceEventType,
    source: record.source as AttendanceEventSource,
    sourceReference: record.sourceReference,
    enteredByMembershipId: record.enteredByMembershipId,
    reason: record.reason,
    createdAt: record.createdAt.toISOString(),
  };
}

function webClockSummary(
  record: AttendanceWebClockVersionRecord,
): AttendanceWebClockVersionSummary {
  return {
    id: record.id,
    versionNo: record.versionNo,
    enabled: record.enabled,
    effectiveFrom: formatDate(record.effectiveFrom),
    effectiveTo: record.effectiveTo ? formatDate(record.effectiveTo) : null,
    status: record.status as AttendanceWebClockVersionSummary['status'],
    reason: record.reason,
    activatedByMembershipId: record.activatedByMembershipId,
    activatedAt: record.activatedAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
  };
}

function associationOf(resolution: AttendanceResolution): AttendanceCaptureAssociation {
  const { dayRule } = resolution;
  return {
    workDate: resolution.workDate,
    scheduleAssignmentId: resolution.assignment.id,
    workScheduleVersionId: resolution.workScheduleVersion.id,
    workScheduleVersionNo: resolution.workScheduleVersion.versionNo,
    workScheduleCode: resolution.assignment.workScheduleCode,
    workScheduleName: resolution.assignment.workScheduleName,
    scheduleType: resolution.workScheduleVersion.scheduleType,
    timezone: resolution.workScheduleVersion.timezone,
    workArrangementVersionId: resolution.workArrangementVersion.id,
    workArrangementVersionNo: resolution.workArrangementVersion.versionNo,
    workArrangementCode: resolution.assignment.workArrangementCode,
    workArrangementName: resolution.assignment.workArrangementName,
    arrangementType: resolution.workArrangementVersion.arrangementType,
    holidayCalendarId: resolution.assignment.holidayCalendarId,
    holidayCalendarVersionId: resolution.holidayCalendarVersion.id,
    holidayEntries: resolution.holidayEntries.map((entry) => ({
      name: entry.name,
      dayType: entry.dayType,
      holidayDate: entry.holidayDate,
    })),
    dayRule: {
      weekday: dayRule.weekday,
      ruleType: dayRule.ruleType,
      dutyStartTime: dayRule.dutyStartTime,
      earliestStartTime: dayRule.earliestStartTime,
      latestStartTime: dayRule.latestStartTime,
      dutyEndTime: dayRule.dutyEndTime,
      endNextCalendarDay: dayRule.endNextCalendarDay,
      eventPattern: dayRule.eventPattern,
      collectionBeforeMinutes: dayRule.collectionBeforeMinutes,
      collectionAfterMinutes: dayRule.collectionAfterMinutes,
      breakCount: dayRule.breaks.length,
    },
  };
}

function scopeAllowsEmployee(scope: ResolvedReadScope, employeeId: string): boolean {
  return scope.kind === 'AGENCY' || scope.employeeIds.includes(employeeId);
}

type ResolvedReadScope = { kind: 'AGENCY' } | { kind: 'SCOPED'; employeeIds: string[] };

interface CapturedEventInput {
  employeeId: string;
  eventType: AttendanceEventType;
  eventTime: Date;
  source: AttendanceEventSource;
  reason: string | null;
  sourceReference: string | null;
}

interface ResolvedNow {
  candidates: AttendanceWorkDateCandidate[];
  exceptions: AttendanceCaptureException[];
  match: AttendanceEventMatch;
  target: AttendanceWorkDateCandidate | null;
  events: AttendanceEventRecord[];
  presentations: Map<string, AttendanceEventPresentation>;
  nextEventType: AttendanceEventType | null;
  serviceCovered: boolean;
}

@Injectable()
export class AttendanceService {
  constructor(
    @Inject(ATTENDANCE_AUDIT_WRITER) private readonly auditWriter: AttendanceAuditWriter,
    @Inject(ScheduleAssignmentsService) private readonly assignments: ScheduleAssignmentsService,
  ) {}

  async getWebClockStatus(
    context: RequestContext,
    asOfValue?: string,
  ): Promise<AttendanceWebClockStatusSummary> {
    this.assertPermission(
      context,
      'attendance.configuration.read',
      'ATTENDANCE_CONFIGURATION_FORBIDDEN',
    );
    const asOf = asOfValue ?? manilaToday();
    const asOfDate = toDatabaseDate(asOf);
    return withDatabaseContext(this.databaseContext(context), (transaction) =>
      this.webClockStatus(transaction, context.agencyId, asOf, asOfDate),
    );
  }

  async setWebClockEnablement(
    context: RequestContext,
    input: SetWebClockEnablementInput,
    rawIdempotencyKey?: string,
  ): Promise<AttendanceWebClockStatusSummary> {
    this.assertPermission(
      context,
      'attendance.configuration.activate',
      'ATTENDANCE_CONFIGURATION_FORBIDDEN',
    );
    const effectiveFromValue = formatDate(toDatabaseDate(input.effectiveFrom));
    const reason = input.reason.trim();
    if (!reason) throw this.reasonRequired();
    const idempotencyKey = rawIdempotencyKey?.trim() || null;
    const fingerprint = JSON.stringify({
      command: 'ATTENDANCE_WEB_CLOCK_SET',
      enabled: input.enabled,
      effectiveFrom: effectiveFromValue,
      reason,
    });
    return withDatabaseContext(this.databaseContext(context, true), async (transaction) => {
      await this.lockAgency(transaction, context.agencyId);
      if (idempotencyKey) {
        const completed = await this.completedWrite(transaction, context, {
          action: 'ATTENDANCE_WEB_CLOCK_SET',
          idempotencyKey,
          fingerprint,
        });
        if (completed) {
          const versionId = this.metadataString(completed.metadata, 'versionId');
          const effectiveFrom = this.metadataString(completed.metadata, 'effectiveFrom');
          if (!versionId || !effectiveFrom) throw this.idempotencyConflict();
          return this.webClockStatus(transaction, context.agencyId, effectiveFrom);
        }
      }
      const today = manilaToday();
      if (effectiveFromValue < today) throw this.effectivePast();
      const active = await this.headWebClockVersion(transaction, context.agencyId);
      if (active && effectiveFromValue <= formatDate(active.effectiveFrom)) {
        throw this.effectiveConflict();
      }
      if (active && active.enabled === input.enabled) throw this.unchanged();
      if (!active && !input.enabled) throw this.unchanged();
      const effectiveFrom = toDatabaseDate(effectiveFromValue);
      const activatedAt = new Date();
      if (active) {
        await transaction.attendanceWebClockVersion.update({
          where: { agencyId_id: { agencyId: context.agencyId, id: active.id } },
          data: {
            status: 'SUPERSEDED',
            effectiveTo: toDatabaseDate(addDateValueDays(effectiveFromValue, -1)),
          },
        });
      }
      const version = await transaction.attendanceWebClockVersion.create({
        data: {
          agencyId: context.agencyId,
          versionNo: active ? active.versionNo + 1 : 1,
          enabled: input.enabled,
          effectiveFrom,
          status: 'ACTIVE',
          reason,
          activatedByMembershipId: context.membershipId,
          activatedAt,
        },
        select: { id: true },
      });
      const versionId = version.id;
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'ATTENDANCE_WEB_CLOCK_SET',
        entityType: 'AttendanceWebClockVersion',
        entityId: versionId,
        previousStatus: active ? 'ACTIVE' : 'None',
        newStatus: input.enabled ? 'ENABLED' : 'DISABLED',
        reason,
        requestId: context.requestId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        metadata: {
          fingerprint,
          versionId,
          enabled: input.enabled,
          effectiveFrom: effectiveFromValue,
        },
      });
      return this.webClockStatus(transaction, context.agencyId, effectiveFromValue, effectiveFrom);
    });
  }

  async listEvents(
    context: RequestContext,
    filter: AttendanceEventListFilter = {},
  ): Promise<AttendanceEventSummary[]> {
    const scope = await this.readScope(context);
    const from = filter.from ? toDatabaseDate(filter.from) : null;
    const to = filter.to ? toDatabaseDate(filter.to) : null;
    if (from && to && to < from) throw this.rangeInvalid();
    return withDatabaseContext(this.databaseContext(context), async (transaction) => {
      const timezone = await this.agencyTimezone(transaction, context.agencyId);
      if (filter.employeeId && !scopeAllowsEmployee(scope, filter.employeeId)) {
        throw this.readForbidden();
      }
      const employeeFilter = filter.employeeId
        ? { employeeId: filter.employeeId }
        : scope.kind === 'SCOPED'
          ? { employeeId: { in: scope.employeeIds } }
          : {};
      const range = this.eventTimeRange(timezone, from, to);
      const records = await transaction.attendanceEvent.findMany({
        where: { agencyId: context.agencyId, ...employeeFilter, ...range },
        orderBy: { eventTime: 'desc' },
        take: 200,
        select: eventSelect,
      });
      return records.map(eventSummary);
    });
  }

  async getEventContext(
    context: RequestContext,
    employeeId: string,
    workDateValue: string,
  ): Promise<AttendanceWorkDateContext> {
    const scope = await this.readScope(context);
    if (!scopeAllowsEmployee(scope, employeeId)) throw this.readForbidden();
    return withDatabaseContext(this.databaseContext(context), async (transaction) => {
      const employee = await transaction.employee.findFirst({
        where: { agencyId: context.agencyId, id: employeeId },
        select: { id: true },
      });
      if (!employee) throw this.employeeNotFound();
      const exceptions: AttendanceCaptureException[] = [];
      let resolution: AttendanceResolution | null = null;
      try {
        resolution = await this.assignments.resolveForWorkDateInTransaction(
          transaction,
          context.agencyId,
          employeeId,
          workDateValue,
        );
      } catch (error: unknown) {
        const capture = attendanceExceptionDetails(error);
        if (!capture) throw error;
        exceptions.push(capture);
      }
      if (!resolution) {
        return { workDate: workDateValue, association: null, exceptions, events: [] };
      }
      const records = await this.workDateEvents(
        transaction,
        context.agencyId,
        employeeId,
        resolution,
      );
      const presentations = presentWorkDateEvents(
        resolution.workDate,
        resolution.dayRule,
        records.map((record) => ({
          id: record.id,
          eventType: record.eventType as AttendanceEventType,
          eventTime: record.eventTime,
        })),
      );
      return {
        workDate: resolution.workDate,
        association: associationOf(resolution),
        exceptions,
        events: records.map((record) => ({
          ...eventSummary(record),
          presentation: presentations.get(record.id) ?? null,
        })),
      };
    });
  }

  async captureManual(
    context: RequestContext,
    input: CreateManualAttendanceEventInput,
    rawIdempotencyKey?: string,
  ): Promise<AttendanceEventCaptureResult> {
    this.assertPermission(
      context,
      'attendance.events.create_manual',
      'ATTENDANCE_EVENT_CREATE_FORBIDDEN',
    );
    this.assertManualScope(context);
    const reason = input.reason.trim();
    if (!reason) throw this.reasonRequired();
    const eventTime = new Date(input.eventTime);
    if (Number.isNaN(eventTime.getTime())) throw this.timeInvalid();
    if (eventTime.getTime() > Date.now() + 60_000) throw this.futureEvent();
    const idempotencyKey = rawIdempotencyKey?.trim() || null;
    const fingerprint = JSON.stringify({
      command: 'ATTENDANCE_EVENT_RECORDED',
      employeeId: input.employeeId,
      eventType: input.eventType,
      eventTime: input.eventTime,
      reason,
      sourceReference: input.sourceReference ?? null,
    });
    return withDatabaseContext(this.databaseContext(context), async (transaction) => {
      await this.lockEmployee(transaction, context.agencyId, input.employeeId);
      if (idempotencyKey) {
        const completed = await this.completedWrite(transaction, context, {
          action: 'ATTENDANCE_EVENT_RECORDED',
          idempotencyKey,
          fingerprint,
        });
        if (completed) return this.replayedCapture(completed.metadata);
      }
      const result = await this.captureEvent(transaction, context, {
        employeeId: input.employeeId,
        eventType: input.eventType,
        eventTime,
        source: 'MANUAL',
        reason,
        sourceReference: input.sourceReference?.trim() || null,
      });
      await this.writeCaptureAudit(transaction, context, {
        action: 'ATTENDANCE_EVENT_RECORDED',
        idempotencyKey,
        fingerprint,
        reason,
        employeeId: input.employeeId,
        eventType: input.eventType,
        eventTime: input.eventTime,
        result,
      });
      return result;
    });
  }

  async getClockState(context: RequestContext): Promise<AttendanceClockStateSummary> {
    this.assertPermission(context, 'attendance.events.clock', 'ATTENDANCE_CLOCK_FORBIDDEN');
    return withDatabaseContext(this.databaseContext(context), async (transaction) => {
      const employee = await this.clockEmployee(transaction, context);
      const timezone = await this.agencyTimezone(transaction, context.agencyId);
      const asOf = localDateValue(new Date(), timezone);
      const version = await this.activeWebClockVersion(transaction, context.agencyId, asOf);
      if (!version?.enabled) {
        const recent = await transaction.attendanceEvent.findMany({
          where: { agencyId: context.agencyId, employeeId: employee.id },
          orderBy: { eventTime: 'desc' },
          take: 10,
          select: eventSelect,
        });
        return {
          asOf,
          enabled: false,
          employee: {
            id: employee.id,
            employeeNumber: employee.employeeNumber,
            legalName: employee.legalName,
          },
          nextEventType: null,
          association: null,
          exceptions: [],
          events: recent.map((record) => ({ ...eventSummary(record), presentation: null })),
        };
      }
      const now = new Date();
      const resolved = await this.resolveNow(
        transaction,
        context.agencyId,
        employee.id,
        now,
        timezone,
      );
      return {
        asOf,
        enabled: true,
        employee: {
          id: employee.id,
          employeeNumber: employee.employeeNumber,
          legalName: employee.legalName,
        },
        nextEventType: resolved.nextEventType,
        association: resolved.target ? associationOf(resolved.target.resolution) : null,
        exceptions: resolved.exceptions,
        events: resolved.events.map((record) => ({
          ...eventSummary(record),
          presentation: resolved.presentations.get(record.id) ?? null,
        })),
      };
    });
  }

  async clock(
    context: RequestContext,
    input: ClockAttendanceEventInput,
    rawIdempotencyKey?: string,
  ): Promise<AttendanceEventCaptureResult> {
    this.assertPermission(context, 'attendance.events.clock', 'ATTENDANCE_CLOCK_FORBIDDEN');
    const idempotencyKey = rawIdempotencyKey?.trim() || null;
    const fingerprint = JSON.stringify({
      command: 'ATTENDANCE_EVENT_CLOCKED',
      eventType: input.eventType ?? null,
    });
    return withDatabaseContext(this.databaseContext(context), async (transaction) => {
      const employee = await this.clockEmployee(transaction, context);
      await this.lockEmployee(transaction, context.agencyId, employee.id);
      if (idempotencyKey) {
        const completed = await this.completedWrite(transaction, context, {
          action: 'ATTENDANCE_EVENT_CLOCKED',
          idempotencyKey,
          fingerprint,
        });
        if (completed) return this.replayedCapture(completed.metadata);
      }
      const timezone = await this.agencyTimezone(transaction, context.agencyId);
      const now = new Date();
      const asOf = localDateValue(now, timezone);
      const version = await this.activeWebClockVersion(transaction, context.agencyId, asOf);
      if (!version?.enabled) throw this.webClockDisabled();
      const resolved = await this.resolveNow(
        transaction,
        context.agencyId,
        employee.id,
        now,
        timezone,
      );
      if (!resolved.serviceCovered) {
        throw new AttendanceExceptionError(
          'MISSING_SERVICE',
          'Web clocking applies only to Appointed Personnel covered by Attendance Applicability.',
          { employeeId: employee.id, eventTime: now.toISOString() },
        );
      }
      if (resolved.match.status === 'AMBIGUOUS') throw this.clockAmbiguous();
      if (resolved.nextEventType === null) throw this.clockComplete();
      if (input.eventType && input.eventType !== resolved.nextEventType) {
        throw this.clockSequenceConflict(resolved.nextEventType);
      }
      const result = await this.captureEvent(transaction, context, {
        employeeId: employee.id,
        eventType: input.eventType ?? resolved.nextEventType,
        eventTime: now,
        source: 'WEB_CLOCK',
        reason: null,
        sourceReference: context.requestId,
      });
      await this.writeCaptureAudit(transaction, context, {
        action: 'ATTENDANCE_EVENT_CLOCKED',
        idempotencyKey,
        fingerprint,
        reason: null,
        employeeId: employee.id,
        eventType: result.event.eventType,
        eventTime: result.event.eventTime,
        result,
      });
      return result;
    });
  }

  private async writeCaptureAudit(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    input: {
      action: string;
      idempotencyKey: string | null;
      fingerprint: string;
      reason: string | null;
      employeeId: string;
      eventType: AttendanceEventType;
      eventTime: string;
      result: AttendanceEventCaptureResult;
    },
  ): Promise<void> {
    await this.auditWriter.write(transaction, {
      agencyId: context.agencyId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      actorType: 'USER',
      action: input.action,
      entityType: 'AttendanceEvent',
      entityId: input.result.event.id,
      newStatus: input.result.event.eventType,
      ...(input.reason ? { reason: input.reason } : {}),
      requestId: context.requestId,
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      metadata: {
        fingerprint: input.fingerprint,
        eventId: input.result.event.id,
        employeeId: input.employeeId,
        eventType: input.eventType,
        eventTime: input.eventTime,
        matchStatus: input.result.match.status,
        workDate: input.result.match.workDate,
        capture: input.result as unknown as Prisma.InputJsonValue,
      },
    });
  }

  private async captureEvent(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    input: CapturedEventInput,
  ): Promise<AttendanceEventCaptureResult> {
    const employee = await transaction.employee.findFirst({
      where: { agencyId: context.agencyId, id: input.employeeId },
      select: { id: true },
    });
    if (!employee) throw this.employeeNotFound();
    const timezone = await this.agencyTimezone(transaction, context.agencyId);
    const eventLocalDate = localDateValue(input.eventTime, timezone);
    const candidateDates = [eventLocalDate, addDateValueDays(eventLocalDate, -1)];
    const candidates: AttendanceWorkDateCandidate[] = [];
    const exceptions: AttendanceCaptureException[] = [];
    for (const workDate of candidateDates) {
      try {
        const resolution = await this.assignments.resolveForWorkDateInTransaction(
          transaction,
          context.agencyId,
          input.employeeId,
          workDate,
        );
        candidates.push({
          workDate,
          resolution,
          window: eventCollectionWindow(
            resolution.dayRule,
            resolution.workDate,
            resolution.workScheduleVersion.timezone,
          ),
        });
      } catch (error: unknown) {
        const capture = attendanceExceptionDetails(error);
        if (!capture) throw error;
        exceptions.push(capture);
      }
    }
    const match = matchAttendanceEvent(input.eventTime, eventLocalDate, candidates);
    const created = await transaction.attendanceEvent.create({
      data: {
        agencyId: context.agencyId,
        employeeId: input.employeeId,
        eventTime: input.eventTime,
        eventType: input.eventType,
        source: input.source,
        sourceReference: input.sourceReference,
        enteredByMembershipId: context.membershipId,
        reason: input.reason,
      },
      select: eventSelect,
    });
    const summary = eventSummary(created);
    if (match.status === 'UNMATCHED') {
      exceptions.push(
        captureException(
          'UNMATCHED_ATTENDANCE_EVENT',
          'No Event Collection Window on the surrounding Work Dates contains the Attendance Event.',
          { employeeId: input.employeeId, eventTime: input.eventTime.toISOString() },
        ),
      );
      return { event: summary, match: this.matchSummary(match), exceptions, presentation: null };
    }
    if (match.status === 'AMBIGUOUS' || match.matches.length !== 1) {
      exceptions.push(
        captureException(
          'AMBIGUOUS_ATTENDANCE_EVENT',
          'More than one Work Date Event Collection Window contains the Attendance Event.',
          {
            employeeId: input.employeeId,
            eventTime: input.eventTime.toISOString(),
            workDates: match.matches.map((candidate) => candidate.workDate),
          },
        ),
      );
      return { event: summary, match: this.matchSummary(match), exceptions, presentation: null };
    }
    const candidate = match.matches[0]!;
    const records = await this.workDateEvents(
      transaction,
      context.agencyId,
      input.employeeId,
      candidate.resolution,
    );
    const presentations = presentWorkDateEvents(
      candidate.workDate,
      candidate.resolution.dayRule,
      records.map((record) => ({
        id: record.id,
        eventType: record.eventType as AttendanceEventType,
        eventTime: record.eventTime,
      })),
    );
    const issues = evaluateAttendanceSequence(
      records.map((record) => ({
        eventType: record.eventType as AttendanceEventType,
        eventTime: record.eventTime,
      })),
      candidate.resolution.dayRule,
    );
    for (const issue of issues) {
      exceptions.push(
        captureException(issue.type, this.sequenceMessage(issue.type), {
          employeeId: input.employeeId,
          workDate: candidate.workDate,
          eventType: issue.eventType,
          expectedCount: issue.expectedCount,
          actualCount: issue.actualCount,
          ...(issue.eventTime ? { eventTime: issue.eventTime } : {}),
        }),
      );
    }
    return {
      event: summary,
      match: this.matchSummary(match),
      exceptions,
      presentation: presentations.get(created.id) ?? null,
    };
  }

  private async resolveNow(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    employeeId: string,
    now: Date,
    timezone: string,
  ): Promise<ResolvedNow> {
    const eventLocalDate = localDateValue(now, timezone);
    const candidateDates = [eventLocalDate, addDateValueDays(eventLocalDate, -1)];
    const candidates: AttendanceWorkDateCandidate[] = [];
    const exceptions: AttendanceCaptureException[] = [];
    const eventDateException = new Map<string, AttendanceCaptureException>();
    for (const workDate of candidateDates) {
      try {
        const resolution = await this.assignments.resolveForWorkDateInTransaction(
          transaction,
          agencyId,
          employeeId,
          workDate,
        );
        candidates.push({
          workDate,
          resolution,
          window: eventCollectionWindow(
            resolution.dayRule,
            resolution.workDate,
            resolution.workScheduleVersion.timezone,
          ),
        });
      } catch (error: unknown) {
        const capture = attendanceExceptionDetails(error);
        if (!capture) throw error;
        exceptions.push(capture);
        eventDateException.set(workDate, capture);
      }
    }
    const match = matchAttendanceEvent(now, eventLocalDate, candidates);
    // Applicability is a property of the event's own local date. A prior-day
    // resolution must not let a separated Employee clock through yesterday's
    // overnight window; MISSING_SERVICE on the event date is the hard gate.
    const serviceCovered = eventDateException.get(eventLocalDate)?.type !== 'MISSING_SERVICE';
    let target: AttendanceWorkDateCandidate | null = null;
    let events: AttendanceEventRecord[] = [];
    let presentations = new Map<string, AttendanceEventPresentation>();
    let nextEventType: AttendanceEventType | null = serviceCovered ? 'TIME_IN' : null;
    if (match.matches.length === 1) {
      target = match.matches[0]!;
      events = await this.workDateEvents(transaction, agencyId, employeeId, target.resolution);
      presentations = presentWorkDateEvents(
        target.workDate,
        target.resolution.dayRule,
        events.map((record) => ({
          id: record.id,
          eventType: record.eventType as AttendanceEventType,
          eventTime: record.eventTime,
        })),
      );
      nextEventType = this.nextEventType(events, target.resolution);
    } else if (match.status === 'UNMATCHED') {
      events = await this.localDayEvents(
        transaction,
        agencyId,
        employeeId,
        eventLocalDate,
        timezone,
      );
      if (serviceCovered) nextEventType = this.fallbackNextEventType(events);
      exceptions.push(
        captureException(
          'UNMATCHED_ATTENDANCE_EVENT',
          'No Event Collection Window on the surrounding Work Dates contains the current time.',
          { employeeId, eventTime: now.toISOString() },
        ),
      );
    } else {
      nextEventType = null;
      exceptions.push(
        captureException(
          'AMBIGUOUS_ATTENDANCE_EVENT',
          'More than one Work Date Event Collection Window contains the current time.',
          {
            employeeId,
            eventTime: now.toISOString(),
            workDates: match.matches.map((candidate) => candidate.workDate),
          },
        ),
      );
    }
    return {
      candidates,
      exceptions,
      match,
      target,
      events,
      presentations,
      nextEventType,
      serviceCovered,
    };
  }

  private nextEventType(
    events: readonly AttendanceEventRecord[],
    resolution: AttendanceResolution,
  ): AttendanceEventType | null {
    return nextExpectedEventType(
      events.map((record) => ({
        eventType: record.eventType as AttendanceEventType,
        eventTime: record.eventTime,
      })),
      resolution.dayRule,
    );
  }

  /**
   * Without a matched Work Date the Day Rule cannot say what comes next. The
   * smallest model is an IN_OUT day: the clock takes one TIME_IN and closes on
   * its TIME_OUT so an unmatched capture cannot spam duplicate TIME_IN events.
   */
  private fallbackNextEventType(
    events: readonly AttendanceEventRecord[],
  ): AttendanceEventType | null {
    let hasIn = false;
    let hasOut = false;
    for (const event of events) {
      if (event.eventType === 'TIME_IN') hasIn = true;
      if (event.eventType === 'TIME_OUT') hasOut = true;
    }
    if (hasOut) return null;
    return hasIn ? 'TIME_OUT' : 'TIME_IN';
  }

  /**
   * Resolve which Work Date one proposed Attendance Event timestamp would join
   * inside a caller-owned transaction. Attendance Corrections use the same
   * collection windows the capture path uses so a previewed ADD or REPLACE
   * names the exact Work Dates, including the prior overnight Work Date.
   */
  async matchEventWorkDateInTransaction(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    employeeId: string,
    eventTime: Date,
  ): Promise<{ status: 'MATCHED' | 'UNMATCHED' | 'AMBIGUOUS'; workDate: string | null }> {
    const timezone = await this.agencyTimezone(transaction, agencyId);
    const eventLocalDate = localDateValue(eventTime, timezone);
    const candidateDates = [eventLocalDate, addDateValueDays(eventLocalDate, -1)];
    const candidates: AttendanceWorkDateCandidate[] = [];
    for (const workDate of candidateDates) {
      try {
        const resolution = await this.assignments.resolveForWorkDateInTransaction(
          transaction,
          agencyId,
          employeeId,
          workDate,
        );
        candidates.push({
          workDate,
          resolution,
          window: eventCollectionWindow(
            resolution.dayRule,
            resolution.workDate,
            resolution.workScheduleVersion.timezone,
          ),
        });
      } catch (error: unknown) {
        if (!attendanceExceptionDetails(error)) throw error;
      }
    }
    const match = matchAttendanceEvent(eventTime, eventLocalDate, candidates);
    if (match.status === 'MATCHED' && match.matches.length === 1) {
      return { status: 'MATCHED', workDate: match.matches[0]!.workDate };
    }
    return { status: match.status, workDate: null };
  }

  /**
   * Expose the exact Attendance Events of one resolved Work Date inside a
   * caller-owned transaction. Attendance Day calculation consumes the same
   * collection window the capture path uses, so both agree on what belongs to
   * the Work Date.
   */
  async workDateEventsInTransaction(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    employeeId: string,
    resolution: AttendanceResolution,
  ): Promise<AttendanceWorkDateEvent[]> {
    const records = await this.workDateEvents(transaction, agencyId, employeeId, resolution);
    return records.map((record) => ({
      id: record.id,
      eventType: record.eventType as AttendanceEventType,
      eventTime: record.eventTime,
    }));
  }

  private async localDayEvents(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    employeeId: string,
    eventLocalDate: string,
    timezone: string,
  ): Promise<AttendanceEventRecord[]> {
    const start = zonedTimeToInstant(eventLocalDate, '00:00', timezone);
    const end = zonedTimeToInstant(addDateValueDays(eventLocalDate, 1), '00:00', timezone);
    return transaction.attendanceEvent.findMany({
      where: { agencyId, employeeId, eventTime: { gte: start, lt: end } },
      orderBy: { eventTime: 'asc' },
      select: eventSelect,
    });
  }

  private async workDateEvents(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    employeeId: string,
    resolution: AttendanceResolution,
  ): Promise<AttendanceEventRecord[]> {
    const window = eventCollectionWindow(
      resolution.dayRule,
      resolution.workDate,
      resolution.workScheduleVersion.timezone,
    );
    if (window) {
      return transaction.attendanceEvent.findMany({
        where: {
          agencyId,
          employeeId,
          eventTime: { gte: window.start, lte: window.end },
        },
        orderBy: { eventTime: 'asc' },
        select: eventSelect,
      });
    }
    const start = zonedTimeToInstant(
      resolution.workDate,
      '00:00',
      resolution.workScheduleVersion.timezone,
    );
    const end = zonedTimeToInstant(
      addDateValueDays(resolution.workDate, 1),
      '00:00',
      resolution.workScheduleVersion.timezone,
    );
    return transaction.attendanceEvent.findMany({
      where: { agencyId, employeeId, eventTime: { gte: start, lt: end } },
      orderBy: { eventTime: 'asc' },
      select: eventSelect,
    });
  }

  private matchSummary(match: AttendanceEventMatch): AttendanceMatchSummary {
    const target = match.matches.length === 1 ? match.matches[0]! : null;
    return {
      status: match.status,
      workDate: target ? target.workDate : null,
      unscheduled: match.unscheduled,
      association: target ? associationOf(target.resolution) : null,
      matches: match.matches.map((candidate) => ({ workDate: candidate.workDate })),
    };
  }

  private async webClockStatus(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    asOf: string,
    asOfDate = toDatabaseDate(asOf),
  ): Promise<AttendanceWebClockStatusSummary> {
    const version = await this.activeWebClockVersion(transaction, agencyId, asOf, asOfDate);
    const history = await transaction.attendanceWebClockVersion.findMany({
      where: { agencyId },
      orderBy: { versionNo: 'desc' },
      take: 50,
      select: webClockSelect,
    });
    return {
      asOf,
      enabled: version?.enabled ?? false,
      version: version ? webClockSummary(version) : null,
      history: history.map(webClockSummary),
    };
  }

  /**
   * The version in effect on a date. Coverage, not status, answers an
   * effective-dated question: a superseded version still governs the days it
   * closed over, so `asOf` in the past must find it.
   */
  private async activeWebClockVersion(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    asOfValue = manilaToday(),
    asOfDate = toDatabaseDate(asOfValue),
  ): Promise<AttendanceWebClockVersionRecord | null> {
    return transaction.attendanceWebClockVersion.findFirst({
      where: {
        agencyId,
        effectiveFrom: { lte: asOfDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOfDate } }],
      },
      orderBy: { effectiveFrom: 'desc' },
      select: webClockSelect,
    });
  }

  /** The open-ended head a transition supersedes. */
  private async headWebClockVersion(
    transaction: Prisma.TransactionClient,
    agencyId: string,
  ): Promise<AttendanceWebClockVersionRecord | null> {
    return transaction.attendanceWebClockVersion.findFirst({
      where: { agencyId, status: 'ACTIVE' },
      orderBy: { effectiveFrom: 'desc' },
      select: webClockSelect,
    });
  }

  private eventTimeRange(
    timezone: string,
    from: Date | null,
    to: Date | null,
  ): { eventTime?: { gte?: Date; lt?: Date } } {
    if (!from && !to) return {};
    const range: { gte?: Date; lt?: Date } = {};
    if (from) range.gte = zonedTimeToInstant(formatDate(from), '00:00', timezone);
    if (to) {
      range.lt = zonedTimeToInstant(addDateValueDays(formatDate(to), 1), '00:00', timezone);
    }
    return { eventTime: range };
  }

  private async agencyTimezone(
    transaction: Prisma.TransactionClient,
    agencyId: string,
  ): Promise<string> {
    const agency = await transaction.agency.findFirst({
      where: { id: agencyId },
      select: { defaultTimezone: true },
    });
    return agency?.defaultTimezone ?? 'Asia/Manila';
  }

  private async readScope(context: RequestContext): Promise<ResolvedReadScope> {
    const grants = context.permissions.filter((grant) => grant.code === 'attendance.events.read');
    if (grants.some((grant) => grant.scopePolicy === 'AGENCY')) return { kind: 'AGENCY' };
    const employeeIds = new Set<string>();
    const scopePolicies = new Set(grants.map((grant) => grant.scopePolicy));
    await withDatabaseContext(this.databaseContext(context), async (transaction) => {
      if (scopePolicies.has('OWN')) {
        const membership = await transaction.agencyMembership.findFirst({
          where: { agencyId: context.agencyId, id: context.membershipId },
          select: { employeeId: true },
        });
        if (membership?.employeeId) employeeIds.add(membership.employeeId);
      }
      if (scopePolicies.has('ASSIGNED_OFFICE') && context.primaryOrganizationUnitId) {
        const segments = await transaction.serviceSegment.findMany({
          where: {
            agencyId: context.agencyId,
            organizationUnitId: context.primaryOrganizationUnitId,
            status: 'ACTIVE',
          },
          select: { employeeId: true },
        });
        for (const segment of segments) employeeIds.add(segment.employeeId);
      }
    });
    if (employeeIds.size === 0) throw this.readForbidden();
    return { kind: 'SCOPED', employeeIds: [...employeeIds] };
  }

  /**
   * AC1 reserves manual entry for the HR Administrator, so only an AGENCY
   * grant qualifies. A narrower grant is refused rather than silently scoped.
   */
  private assertManualScope(context: RequestContext): void {
    const authorized = context.permissions.some(
      (grant) => grant.code === 'attendance.events.create_manual' && grant.scopePolicy === 'AGENCY',
    );
    if (!authorized) throw this.createForbidden();
  }

  private async clockEmployee(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
  ): Promise<{ id: string; employeeNumber: string; legalName: string }> {
    const membership = await transaction.agencyMembership.findFirst({
      where: { agencyId: context.agencyId, id: context.membershipId },
      select: { employeeId: true },
    });
    if (!membership?.employeeId) throw this.clockEmployeeRequired();
    const employee = await transaction.employee.findFirst({
      where: { agencyId: context.agencyId, id: membership.employeeId },
      select: { id: true, employeeNumber: true, legalName: true },
    });
    if (!employee) throw this.clockEmployeeRequired();
    return employee;
  }

  private async lockEmployee(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    employeeId: string,
  ): Promise<void> {
    await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "employees" WHERE "agency_id" = CAST(${agencyId} AS uuid) AND "id" = CAST(${employeeId} AS uuid) FOR UPDATE`,
    );
  }

  private async lockAgency(transaction: Prisma.TransactionClient, agencyId: string): Promise<void> {
    await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "agencies" WHERE "id" = CAST(${agencyId} AS uuid) FOR UPDATE`,
    );
  }

  private async completedWrite(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    input: { action: string; idempotencyKey: string; fingerprint: string },
  ): Promise<{ metadata: Prisma.JsonValue } | null> {
    const completed = await transaction.auditEvent.findFirst({
      where: {
        agencyId: context.agencyId,
        action: input.action,
        idempotencyKey: input.idempotencyKey,
      },
      select: { metadata: true },
    });
    if (!completed) return null;
    if (this.metadataString(completed.metadata, 'fingerprint') !== input.fingerprint) {
      throw this.idempotencyConflict();
    }
    return completed;
  }

  private replayedCapture(metadata: Prisma.JsonValue): AttendanceEventCaptureResult {
    if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
      throw this.idempotencyConflict();
    }
    const capture = (metadata as Record<string, unknown>).capture;
    if (typeof capture !== 'object' || capture === null) throw this.idempotencyConflict();
    return capture as unknown as AttendanceEventCaptureResult;
  }

  private metadataString(value: Prisma.JsonValue, key: string): string | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const item = value[key];
    return typeof item === 'string' ? item : null;
  }

  private sequenceMessage(
    type:
      'DUPLICATE_ATTENDANCE_EVENT' | 'MISSING_ATTENDANCE_EVENT' | 'OUT_OF_ORDER_ATTENDANCE_EVENT',
  ): string {
    switch (type) {
      case 'DUPLICATE_ATTENDANCE_EVENT':
        return 'The Work Date holds more Attendance Events of one type than the Day Rule expects.';
      case 'MISSING_ATTENDANCE_EVENT':
        return 'The closed Work Date is missing an Attendance Event the Day Rule expects.';
      default:
        return 'The Attendance Events of the Work Date are out of sequence for the Day Rule.';
    }
  }

  private databaseContext(context: RequestContext, transition = false) {
    return requestDatabaseContext(
      context,
      ...(transition ? (['attendance-transition'] as const) : []),
    );
  }

  private assertPermission(context: RequestContext, permission: string, code: string): void {
    if (
      !context.agencyId ||
      !context.userId ||
      !context.membershipId ||
      !hasPermission(context, permission)
    ) {
      throw new AttendanceServiceError(
        'The current Agency Membership lacks the required permission.',
        403,
        code,
      );
    }
  }

  private readForbidden(): AttendanceServiceError {
    return new AttendanceServiceError(
      'The requested Attendance Events are outside the authorized scope.',
      403,
      'ATTENDANCE_EVENT_READ_FORBIDDEN',
    );
  }

  private createForbidden(): AttendanceServiceError {
    return new AttendanceServiceError(
      'Manual Attendance Events may only be recorded within the authorized scope.',
      403,
      'ATTENDANCE_EVENT_CREATE_FORBIDDEN',
    );
  }

  private employeeNotFound(): AttendanceServiceError {
    return new AttendanceServiceError(
      'The Employee could not be found in this Agency.',
      404,
      'ATTENDANCE_EMPLOYEE_NOT_FOUND',
    );
  }

  private reasonRequired(): AttendanceServiceError {
    return new AttendanceServiceError(
      'A reason for the Attendance Event is required.',
      400,
      'ATTENDANCE_EVENT_REASON_REQUIRED',
    );
  }

  private timeInvalid(): AttendanceServiceError {
    return new AttendanceServiceError(
      'The Attendance Event time is invalid.',
      400,
      'ATTENDANCE_EVENT_TIME_INVALID',
    );
  }

  private futureEvent(): AttendanceServiceError {
    return new AttendanceServiceError(
      'An Attendance Event cannot be recorded in the future.',
      400,
      'ATTENDANCE_EVENT_FUTURE',
    );
  }

  private rangeInvalid(): AttendanceServiceError {
    return new AttendanceServiceError(
      'The Attendance Event date range is invalid.',
      400,
      'ATTENDANCE_EVENT_RANGE_INVALID',
    );
  }

  private webClockDisabled(): AttendanceServiceError {
    return new AttendanceServiceError(
      'The Agency web clock is disabled.',
      409,
      'ATTENDANCE_WEB_CLOCK_DISABLED',
    );
  }

  private clockEmployeeRequired(): AttendanceServiceError {
    return new AttendanceServiceError(
      'The current Agency Membership is not linked to an Employee.',
      409,
      'ATTENDANCE_CLOCK_EMPLOYEE_REQUIRED',
    );
  }

  private clockComplete(): AttendanceServiceError {
    return new AttendanceServiceError(
      'The current Work Date already holds a complete Attendance Event sequence.',
      409,
      'ATTENDANCE_CLOCK_COMPLETE',
    );
  }

  private clockAmbiguous(): AttendanceServiceError {
    return new AttendanceServiceError(
      'The current time matches more than one Work Date, so the web clock will not guess.',
      409,
      'ATTENDANCE_CLOCK_AMBIGUOUS',
    );
  }

  private clockSequenceConflict(expected: AttendanceEventType): AttendanceServiceError {
    return new AttendanceServiceError(
      `The web clock expects ${expected} for the current Work Date.`,
      409,
      'ATTENDANCE_CLOCK_SEQUENCE_CONFLICT',
    );
  }

  private effectivePast(): AttendanceServiceError {
    return new AttendanceServiceError(
      'A web clock enablement change cannot be backdated.',
      400,
      'ATTENDANCE_WEB_CLOCK_EFFECTIVE_PAST',
    );
  }

  private effectiveConflict(): AttendanceServiceError {
    return new AttendanceServiceError(
      'A web clock enablement change must start after the active version.',
      409,
      'ATTENDANCE_WEB_CLOCK_EFFECTIVE_CONFLICT',
    );
  }

  private unchanged(): AttendanceServiceError {
    return new AttendanceServiceError(
      'The Agency web clock already has the requested enablement.',
      409,
      'ATTENDANCE_WEB_CLOCK_UNCHANGED',
    );
  }

  private idempotencyConflict(): AttendanceServiceError {
    return new AttendanceServiceError(
      'The Idempotency-Key was already used for a different Attendance request.',
      409,
      'ATTENDANCE_IDEMPOTENCY_CONFLICT',
    );
  }
}
