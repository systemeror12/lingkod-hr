import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hasPermission, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import { AttendanceContextsService } from '../attendance-contexts/attendance-contexts.service';
import { AttendanceService } from '../attendance/attendance.service';
import {
  AttendanceExceptionError,
  addDays,
  formatDate,
  toDatabaseDate,
} from '../attendance-configuration/attendance-configuration.types';
import {
  ScheduleAssignmentsService,
  type AttendanceResolution,
} from '../attendance-configuration/schedule-assignments.service';
import {
  eventCollectionWindow,
  localDateValue,
  zonedTimeToInstant,
  type AttendanceWorkDateEvent,
} from '../attendance/attendance.types';
import { LeaveAccountsService } from '../leave-accounts/leave-accounts.service';
import {
  applyEventCorrectionOverlays,
  parseAppliedCorrectionOverlays,
  type AppliedAttendanceCorrectionOverlays,
} from '../attendance-corrections/attendance-corrections.effects';
import {
  calculateAttendanceDay,
  fingerprintAttendanceDayInput,
  wholeWorkDateCoverageIntervals,
  type AttendanceCalculationCoverage,
  type AttendanceCalculationException,
  type AttendanceDayExceptionType,
} from './attendance-calculation';
import {
  ATTENDANCE_DAY_AUDIT_WRITER,
  type AttendanceDayAuditWriter,
} from './attendance-days.audit';
import {
  AttendanceDayServiceError,
  type AttendanceDayCalculationResultSummary,
  type AttendanceDayDetail,
  type AttendanceDayEmployeeSummary,
  type AttendanceDayListFilters,
  type AttendanceDayReadScope,
  type AttendanceDayRuleSnapshot,
  type AttendanceDaySegmentSummary,
  type AttendanceDayState,
  type AttendanceDaySummary,
  type AttendanceDayTotalsSummary,
  type AttendanceExceptionSummary,
  type AttendancePeriodSummary,
  type CalculateAttendanceDaysInput,
  type CalculateAttendanceDaysResult,
} from './attendance-days.types';

const MAX_BATCH_DAYS = 1000;
const MAX_LIST_LIMIT = 200;
const DEFAULT_LIST_LIMIT = 100;

const daySelect = {
  id: true,
  agencyId: true,
  attendancePeriodId: true,
  employeeId: true,
  workDate: true,
  scheduleAssignmentId: true,
  workScheduleVersionId: true,
  workArrangementVersionId: true,
  holidayCalendarVersionId: true,
  dayClassification: true,
  status: true,
  expectedMinutes: true,
  workedMinutes: true,
  coverageMinutes: true,
  lateMinutes: true,
  undertimeMinutes: true,
  absenceMinutes: true,
  officialBusinessMinutes: true,
  officialTravelMinutes: true,
  trainingMinutes: true,
  approvedAbsenceMinutes: true,
  postedLeaveMinutes: true,
  outsideScheduleMinutes: true,
  statutoryNightWindowMinutes: true,
  calculationVersion: true,
  ruleSnapshot: true,
  isCurrent: true,
  calculatedAt: true,
  createdAt: true,
  employee: { select: { id: true, employeeNumber: true, legalName: true } },
  exceptions: { where: { status: 'OPEN' }, select: { id: true } },
} as const;

const segmentSelect = {
  id: true,
  sequenceNo: true,
  startsAt: true,
  endsAt: true,
  dutyRelation: true,
  coverageType: true,
  deficitType: true,
  holidayClassification: true,
  sourceReferences: true,
} as const;

const exceptionSelect = {
  id: true,
  exceptionType: true,
  status: true,
  details: true,
  resolvedAt: true,
  resolvedByMembershipId: true,
  createdAt: true,
} as const;

const periodSelect = {
  id: true,
  code: true,
  dateFrom: true,
  dateTo: true,
  status: true,
  createdAt: true,
} as const;

type AttendanceDayRecord = Prisma.AttendanceDayGetPayload<{ select: typeof daySelect }>;
type AttendanceDaySegmentRecord = Prisma.AttendanceDaySegmentGetPayload<{
  select: typeof segmentSelect;
}>;
type AttendanceExceptionRecord = Prisma.AttendanceExceptionGetPayload<{
  select: typeof exceptionSelect;
}>;
type AttendancePeriodRecord = Prisma.AttendancePeriodGetPayload<{ select: typeof periodSelect }>;

function databaseContext(context: RequestContext) {
  return requestDatabaseContext(context);
}

function metadataString(metadata: Prisma.JsonValue, key: string): string | null {
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}

function holidayEffectRulesOf(value: Prisma.JsonValue): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function employeeSummary(record: AttendanceDayRecord): AttendanceDayEmployeeSummary {
  return {
    id: record.employee.id,
    employeeNumber: record.employee.employeeNumber,
    legalName: record.employee.legalName,
  };
}

function ruleSnapshotOf(value: Prisma.JsonValue): AttendanceDayRuleSnapshot {
  const snapshot = (value ?? {}) as Record<string, unknown>;
  return {
    fingerprint: typeof snapshot.fingerprint === 'string' ? snapshot.fingerprint : '',
    timezone: typeof snapshot.timezone === 'string' ? snapshot.timezone : '',
    assignmentId: typeof snapshot.assignmentId === 'string' ? snapshot.assignmentId : null,
    workScheduleVersionId:
      typeof snapshot.workScheduleVersionId === 'string' ? snapshot.workScheduleVersionId : null,
    workArrangementVersionId:
      typeof snapshot.workArrangementVersionId === 'string'
        ? snapshot.workArrangementVersionId
        : null,
    holidayCalendarVersionId:
      typeof snapshot.holidayCalendarVersionId === 'string'
        ? snapshot.holidayCalendarVersionId
        : null,
    dayRuleId: typeof snapshot.dayRuleId === 'string' ? snapshot.dayRuleId : null,
    holidayClassifications:
      snapshot.holidayClassifications !== null &&
      typeof snapshot.holidayClassifications === 'object' &&
      !Array.isArray(snapshot.holidayClassifications)
        ? (snapshot.holidayClassifications as Record<string, string>)
        : undefined,
    eventIds: Array.isArray(snapshot.eventIds)
      ? snapshot.eventIds.filter((item): item is string => typeof item === 'string')
      : undefined,
    coverageSources: Array.isArray(snapshot.coverageSources)
      ? (snapshot.coverageSources as AttendanceDayRuleSnapshot['coverageSources'])
      : undefined,
    resolutionException:
      snapshot.resolutionException !== null &&
      typeof snapshot.resolutionException === 'object' &&
      !Array.isArray(snapshot.resolutionException)
        ? (snapshot.resolutionException as AttendanceDayRuleSnapshot['resolutionException'])
        : undefined,
    capturedAt: typeof snapshot.capturedAt === 'string' ? snapshot.capturedAt : '',
  };
}

function daySummary(record: AttendanceDayRecord): AttendanceDaySummary {
  return {
    id: record.id,
    agencyId: record.agencyId,
    attendancePeriodId: record.attendancePeriodId,
    employee: employeeSummary(record),
    workDate: formatDate(record.workDate),
    dayClassification: record.dayClassification as AttendanceDaySummary['dayClassification'],
    status: record.status as AttendanceDayState,
    calculationVersion: record.calculationVersion,
    isCurrent: record.isCurrent,
    scheduleAssignmentId: record.scheduleAssignmentId,
    workScheduleVersionId: record.workScheduleVersionId,
    workArrangementVersionId: record.workArrangementVersionId,
    holidayCalendarVersionId: record.holidayCalendarVersionId,
    ruleSnapshot: ruleSnapshotOf(record.ruleSnapshot),
    totals: {
      expectedMinutes: record.expectedMinutes,
      workedMinutes: record.workedMinutes,
      coverageMinutes: record.coverageMinutes,
      lateMinutes: record.lateMinutes,
      undertimeMinutes: record.undertimeMinutes,
      absenceMinutes: record.absenceMinutes,
      officialBusinessMinutes: record.officialBusinessMinutes,
      officialTravelMinutes: record.officialTravelMinutes,
      trainingMinutes: record.trainingMinutes,
      approvedAbsenceMinutes: record.approvedAbsenceMinutes,
      postedLeaveMinutes: record.postedLeaveMinutes,
      outsideScheduleMinutes: record.outsideScheduleMinutes,
      statutoryNightWindowMinutes: record.statutoryNightWindowMinutes,
    },
    openExceptionCount: record.exceptions.length,
    calculatedAt: record.calculatedAt ? record.calculatedAt.toISOString() : null,
    createdAt: record.createdAt.toISOString(),
  };
}

function segmentSummary(record: AttendanceDaySegmentRecord): AttendanceDaySegmentSummary {
  return {
    id: record.id,
    sequenceNo: record.sequenceNo,
    startsAt: record.startsAt.toISOString(),
    endsAt: record.endsAt.toISOString(),
    dutyRelation: record.dutyRelation,
    coverageType: record.coverageType,
    deficitType: record.deficitType,
    holidayClassification: record.holidayClassification,
    sourceReferences: record.sourceReferences,
  };
}

function exceptionSummary(record: AttendanceExceptionRecord): AttendanceExceptionSummary {
  return {
    id: record.id,
    exceptionType: record.exceptionType,
    status: record.status as AttendanceExceptionSummary['status'],
    message: metadataString(record.details, 'message'),
    details: record.details,
    resolvedAt: record.resolvedAt ? record.resolvedAt.toISOString() : null,
    resolvedByMembershipId: record.resolvedByMembershipId,
    createdAt: record.createdAt.toISOString(),
  };
}

function periodSummary(record: AttendancePeriodRecord): AttendancePeriodSummary {
  return {
    id: record.id,
    code: record.code,
    dateFrom: formatDate(record.dateFrom),
    dateTo: formatDate(record.dateTo),
    status: record.status as AttendancePeriodSummary['status'],
    createdAt: record.createdAt.toISOString(),
  };
}

function resolutionFingerprint(
  employeeId: string,
  workDate: string,
  exception: AttendanceExceptionError,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        employeeId,
        workDate,
        exceptionType: exception.exceptionType,
        message: exception.message,
        details: exception.details,
      }),
    )
    .digest('hex');
}

/**
 * Attendance Day calculation turns the resolved schedule configuration,
 * immutable Attendance Events, Attendance Context, and Leave-owned posted
 * coverage of one Work Date into an immutable calculation version with exact
 * whole-minute segments and blocking Attendance Exceptions. Recalculation is
 * idempotent through the stored input fingerprint and creates a successor
 * version instead of editing history.
 */
@Injectable()
export class AttendanceDaysService {
  constructor(
    @Inject(ATTENDANCE_DAY_AUDIT_WRITER) private readonly auditWriter: AttendanceDayAuditWriter,
    @Inject(ScheduleAssignmentsService)
    private readonly assignments: ScheduleAssignmentsService,
    @Inject(AttendanceService) private readonly attendance: AttendanceService,
    @Inject(AttendanceContextsService) private readonly contexts: AttendanceContextsService,
    @Inject(LeaveAccountsService) private readonly leaveAccounts: LeaveAccountsService,
  ) {}

  async calculate(
    context: RequestContext,
    input: CalculateAttendanceDaysInput,
  ): Promise<CalculateAttendanceDaysResult> {
    if (!hasPermission(context, 'attendance.days.calculate')) {
      throw new AttendanceDayServiceError(
        'The attendance.days.calculate permission is required.',
        403,
        'ATTENDANCE_DAY_CALCULATE_FORBIDDEN',
      );
    }
    const dateCount =
      Math.floor(
        (toDatabaseDate(input.dateTo).getTime() - toDatabaseDate(input.dateFrom).getTime()) /
          (24 * 60 * 60 * 1000),
      ) + 1;
    if (dateCount < 1) {
      throw new AttendanceDayServiceError(
        'The calculation end date cannot precede its start date.',
        400,
        'ATTENDANCE_DAY_RANGE_INVALID',
      );
    }
    if (dateCount * input.employeeIds.length > MAX_BATCH_DAYS) {
      throw new AttendanceDayServiceError(
        `One calculation request covers at most ${MAX_BATCH_DAYS} Employee Work Dates.`,
        400,
        'ATTENDANCE_DAY_BATCH_TOO_LARGE',
      );
    }
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const now = new Date();
      const period = await this.findOrCreatePeriod(transaction, context, input);
      const days: AttendanceDayCalculationResultSummary[] = [];
      for (const employeeId of input.employeeIds) {
        for (let offset = 0; offset < dateCount; offset += 1) {
          const workDate = formatDate(addDays(toDatabaseDate(input.dateFrom), offset));
          days.push(
            await this.calculateOne(transaction, context, period, employeeId, workDate, now),
          );
        }
      }
      return {
        period: periodSummary(period),
        days,
        createdCount: days.filter((day) => day.outcome === 'CREATED').length,
        recalculatedCount: days.filter((day) => day.outcome === 'RECALCULATED').length,
        unchangedCount: days.filter((day) => day.outcome === 'UNCHANGED').length,
      };
    });
  }

  /**
   * Recalculate the affected Work Dates of one applied Attendance Correction
   * inside the caller-owned transaction. An applied correction is the only
   * authorized path that may supersede an APPROVED Attendance Day while the
   * original version and its segments stay retained.
   */
  async recalculateCorrectedWorkDates(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    input: { attendancePeriodId: string; employeeId: string; workDates: string[] },
  ): Promise<AttendanceDayCalculationResultSummary[]> {
    const period = await transaction.attendancePeriod.findFirst({
      where: { agencyId: context.agencyId, id: input.attendancePeriodId },
      select: periodSelect,
    });
    if (!period) {
      throw new AttendanceDayServiceError(
        'The requested Attendance Period could not be found.',
        404,
        'ATTENDANCE_PERIOD_NOT_FOUND',
      );
    }
    const now = new Date();
    const results: AttendanceDayCalculationResultSummary[] = [];
    for (const workDate of input.workDates) {
      results.push(
        await this.calculateOne(transaction, context, period, input.employeeId, workDate, now, {
          correctionRecalculation: true,
        }),
      );
    }
    return results;
  }

  private async appliedCorrectionOverlays(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    employeeId: string,
  ): Promise<AppliedAttendanceCorrectionOverlays> {
    const rows = await transaction.attendanceCorrectionEffect.findMany({
      where: { agencyId, correction: { employeeId } },
      orderBy: [{ appliedAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        effectAction: true,
        targetType: true,
        originalTargetId: true,
        replacementRecord: true,
        appliedByMembershipId: true,
        appliedAt: true,
      },
    });
    return parseAppliedCorrectionOverlays(rows);
  }

  async list(
    context: RequestContext,
    filters: AttendanceDayListFilters = {},
  ): Promise<AttendanceDaySummary[]> {
    const scope = await this.readScope(context);
    if (
      scope.kind === 'SCOPED' &&
      filters.employeeId !== undefined &&
      !scope.employeeIds.includes(filters.employeeId)
    ) {
      return [];
    }
    const limit = Math.min(Math.max(filters.limit ?? DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT);
    const employeeFilter =
      scope.kind === 'SCOPED'
        ? { employeeId: { in: filters.employeeId ? [filters.employeeId] : scope.employeeIds } }
        : filters.employeeId
          ? { employeeId: filters.employeeId }
          : {};
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const records = await transaction.attendanceDay.findMany({
        where: {
          agencyId: context.agencyId,
          isCurrent: true,
          ...(filters.attendancePeriodId ? { attendancePeriodId: filters.attendancePeriodId } : {}),
          ...employeeFilter,
          ...(filters.status ? { status: filters.status } : {}),
          ...(filters.workDateFrom || filters.workDateTo
            ? {
                workDate: {
                  ...(filters.workDateFrom ? { gte: toDatabaseDate(filters.workDateFrom) } : {}),
                  ...(filters.workDateTo ? { lte: toDatabaseDate(filters.workDateTo) } : {}),
                },
              }
            : {}),
        },
        orderBy: [{ workDate: 'desc' }, { employee: { legalName: 'asc' } }, { id: 'asc' }],
        take: limit,
        select: daySelect,
      });
      return records.map(daySummary);
    });
  }

  async listPeriods(context: RequestContext): Promise<AttendancePeriodSummary[]> {
    await this.readScope(context);
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const records = await transaction.attendancePeriod.findMany({
        where: { agencyId: context.agencyId },
        orderBy: [{ dateFrom: 'desc' }, { code: 'asc' }],
        take: MAX_LIST_LIMIT,
        select: periodSelect,
      });
      return records.map(periodSummary);
    });
  }

  async findById(context: RequestContext, attendanceDayId: string): Promise<AttendanceDayDetail> {
    const scope = await this.readScope(context);
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const record = await transaction.attendanceDay.findFirst({
        where: { agencyId: context.agencyId, id: attendanceDayId },
        select: daySelect,
      });
      if (!record) throw this.dayNotFound();
      if (scope.kind === 'SCOPED' && !scope.employeeIds.includes(record.employeeId)) {
        throw this.dayNotFound();
      }
      const [segments, exceptions] = await Promise.all([
        transaction.attendanceDaySegment.findMany({
          where: { agencyId: context.agencyId, attendanceDayId: record.id },
          orderBy: { sequenceNo: 'asc' },
          select: segmentSelect,
        }),
        transaction.attendanceException.findMany({
          where: { agencyId: context.agencyId, attendanceDayId: record.id },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: exceptionSelect,
        }),
      ]);
      return {
        day: daySummary(record),
        segments: segments.map(segmentSummary),
        exceptions: exceptions.map(exceptionSummary),
      };
    });
  }

  private async findOrCreatePeriod(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    input: CalculateAttendanceDaysInput,
  ): Promise<AttendancePeriodRecord> {
    const existing = await transaction.attendancePeriod.findUnique({
      where: { agencyId_code: { agencyId: context.agencyId, code: input.periodCode } },
      select: periodSelect,
    });
    if (existing) {
      if (existing.status === 'FINALIZED') {
        throw new AttendanceDayServiceError(
          'The Attendance Period is finalized and cannot accept new calculations.',
          409,
          'ATTENDANCE_PERIOD_FINALIZED',
        );
      }
      if (
        formatDate(existing.dateFrom) !== input.dateFrom ||
        formatDate(existing.dateTo) !== input.dateTo
      ) {
        throw new AttendanceDayServiceError(
          'The Attendance Period already covers a different date range.',
          409,
          'ATTENDANCE_PERIOD_RANGE_MISMATCH',
          [`PERIOD:${formatDate(existing.dateFrom)}..${formatDate(existing.dateTo)}`],
        );
      }
      return existing;
    }
    return transaction.attendancePeriod.create({
      data: {
        agencyId: context.agencyId,
        code: input.periodCode,
        dateFrom: toDatabaseDate(input.dateFrom),
        dateTo: toDatabaseDate(input.dateTo),
      },
      select: periodSelect,
    });
  }

  private async calculateOne(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    period: AttendancePeriodRecord,
    employeeId: string,
    workDate: string,
    now: Date,
    options: { correctionRecalculation?: boolean } = {},
  ): Promise<AttendanceDayCalculationResultSummary> {
    const current = await transaction.attendanceDay.findFirst({
      where: {
        agencyId: context.agencyId,
        employeeId,
        workDate: toDatabaseDate(workDate),
        isCurrent: true,
      },
      select: {
        id: true,
        attendancePeriodId: true,
        status: true,
        calculationVersion: true,
        ruleSnapshot: true,
      },
    });
    if (current && current.attendancePeriodId !== period.id) {
      throw new AttendanceDayServiceError(
        'The Work Date already belongs to another Attendance Period.',
        409,
        'ATTENDANCE_DAY_PERIOD_CONFLICT',
      );
    }

    let resolution: AttendanceResolution | null = null;
    let resolutionException: AttendanceExceptionError | null = null;
    try {
      resolution = await this.assignments.resolveForWorkDateInTransaction(
        transaction,
        context.agencyId,
        employeeId,
        workDate,
      );
    } catch (error: unknown) {
      if (error instanceof AttendanceExceptionError) {
        resolutionException = error;
      } else {
        throw error;
      }
    }

    const overlays = await this.appliedCorrectionOverlays(
      transaction,
      context.agencyId,
      employeeId,
    );
    const calculation = resolution
      ? await this.calculateResolved(transaction, context, resolution, workDate, overlays)
      : this.unresolvedCalculation(resolutionException!, employeeId, workDate, now);
    const fingerprint = calculation.fingerprint;
    const exceptionTypes = calculation.exceptions.map((exception) => exception.type);

    if (current && metadataString(current.ruleSnapshot, 'fingerprint') === fingerprint) {
      if (current.status === 'APPROVED') {
        return {
          employeeId,
          workDate,
          attendanceDayId: current.id,
          status: 'APPROVED',
          outcome: 'UNCHANGED',
          exceptionTypes: [],
        };
      }
      return {
        employeeId,
        workDate,
        attendanceDayId: current.id,
        status: current.status as AttendanceDayState,
        outcome: 'UNCHANGED',
        exceptionTypes,
      };
    }
    if (current && current.status === 'APPROVED' && !options.correctionRecalculation) {
      throw new AttendanceDayServiceError(
        'An approved Attendance Day cannot be recalculated.',
        409,
        'ATTENDANCE_DAY_APPROVED',
      );
    }

    const maxVersion = await transaction.attendanceDay.aggregate({
      where: {
        agencyId: context.agencyId,
        employeeId,
        workDate: toDatabaseDate(workDate),
      },
      _max: { calculationVersion: true },
    });
    const calculationVersion = (maxVersion._max.calculationVersion ?? 0) + 1;
    if (current) {
      await transaction.attendanceDay.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: current.id } },
        data: { isCurrent: false },
      });
      await transaction.attendanceException.updateMany({
        where: { agencyId: context.agencyId, attendanceDayId: current.id, status: 'OPEN' },
        data: {
          status: 'RESOLVED',
          resolvedAt: now,
          resolvedByMembershipId: context.membershipId,
        },
      });
    }

    const status: AttendanceDayState =
      calculation.exceptions.length > 0 ? 'EXCEPTION' : 'CALCULATED';
    const record = await transaction.attendanceDay.create({
      data: {
        agencyId: context.agencyId,
        attendancePeriodId: period.id,
        employeeId,
        workDate: toDatabaseDate(workDate),
        scheduleAssignmentId: calculation.snapshot.assignmentId ?? null,
        workScheduleVersionId: calculation.snapshot.workScheduleVersionId ?? null,
        workArrangementVersionId: calculation.snapshot.workArrangementVersionId ?? null,
        holidayCalendarVersionId: calculation.snapshot.holidayCalendarVersionId ?? null,
        dayClassification: calculation.dayClassification,
        status,
        ...calculation.totals,
        calculationVersion,
        ruleSnapshot: calculation.snapshot as unknown as Prisma.InputJsonValue,
        isCurrent: true,
        calculatedAt: now,
      },
      select: { id: true },
    });
    if (calculation.segments.length > 0) {
      await transaction.attendanceDaySegment.createMany({
        data: calculation.segments.map((segment, index) => ({
          agencyId: context.agencyId,
          attendanceDayId: record.id,
          sequenceNo: index + 1,
          startsAt: segment.startsAt,
          endsAt: segment.endsAt,
          dutyRelation: segment.dutyRelation,
          coverageType: segment.coverageType,
          deficitType: segment.deficitType,
          holidayClassification: segment.holidayClassification,
          sourceReferences: segment.sources as unknown as Prisma.InputJsonValue,
        })),
      });
    }
    if (calculation.exceptions.length > 0) {
      await transaction.attendanceException.createMany({
        data: calculation.exceptions.map((exception) => ({
          agencyId: context.agencyId,
          attendanceDayId: record.id,
          exceptionType: exception.type,
          status: 'OPEN',
          details: {
            message: exception.message,
            ...exception.details,
          } as Prisma.InputJsonValue,
        })),
      });
    }
    await this.auditWriter.write(transaction, {
      agencyId: context.agencyId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      actorType: 'USER',
      action: 'ATTENDANCE_DAY_CALCULATED',
      entityType: 'AttendanceDay',
      entityId: record.id,
      previousStatus: current ? current.status : null,
      newStatus: status,
      requestId: context.requestId,
      metadata: {
        employeeId,
        workDate,
        attendancePeriodId: period.id,
        calculationVersion,
        fingerprint,
        exceptionTypes,
      },
    });
    return {
      employeeId,
      workDate,
      attendanceDayId: record.id,
      status,
      outcome: current ? 'RECALCULATED' : 'CREATED',
      exceptionTypes,
    };
  }

  private async calculateResolved(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    resolution: AttendanceResolution,
    workDate: string,
    overlays: AppliedAttendanceCorrectionOverlays,
  ): Promise<{
    fingerprint: string;
    snapshot: AttendanceDayRuleSnapshot;
    dayClassification: AttendanceDaySummary['dayClassification'];
    totals: AttendanceDayTotalsSummary;
    segments: Array<{
      startsAt: Date;
      endsAt: Date;
      dutyRelation: string;
      coverageType: string;
      deficitType: string | null;
      holidayClassification: string | null;
      sources: Array<{ sourceType: string; id: string }>;
    }>;
    exceptions: AttendanceCalculationException[];
  }> {
    const { dayRule, workScheduleVersion } = resolution;
    const timezone = workScheduleVersion.timezone;
    const window = this.coverageWindow(dayRule, workDate, timezone);
    const rawEvents = await this.attendance.workDateEventsInTransaction(
      transaction,
      context.agencyId,
      resolution.employeeId,
      resolution,
    );
    const events = applyEventCorrectionOverlays(rawEvents, overlays.events, (eventTime) =>
      window
        ? eventTime.getTime() >= window.startsAt.getTime() &&
          eventTime.getTime() <= window.endsAt.getTime()
        : localDateValue(eventTime, timezone) === workDate,
    );
    const contexts = await this.contexts.resolveCoverageInTransaction(
      transaction,
      context.agencyId,
      resolution.employeeId,
      workDate,
      { startsAt: window.startsAt.toISOString(), endsAt: window.endsAt.toISOString() },
      overlays.contexts,
    );
    const coverage: AttendanceCalculationCoverage[] = [];
    for (const interval of contexts.intervals) {
      const summary = interval.context;
      if (summary.coverageMode === 'WHOLE_WORK_DATE') {
        for (const whole of wholeWorkDateCoverageIntervals(dayRule, workDate, timezone)) {
          coverage.push({
            sourceType: 'ATTENDANCE_CONTEXT',
            sourceId: summary.id,
            coverageType: summary.contextType,
            startsAt: whole.startsAt,
            endsAt: whole.endsAt,
          });
        }
        continue;
      }
      coverage.push({
        sourceType: 'ATTENDANCE_CONTEXT',
        sourceId: summary.id,
        coverageType: summary.contextType,
        startsAt: new Date(interval.startsAt),
        endsAt: new Date(interval.endsAt),
      });
    }
    const postedLeave = await this.leaveAccounts.postedLeaveCoverageInTransaction(
      transaction,
      context.agencyId,
      resolution.employeeId,
      workDate,
    );
    const leaveExceptions: AttendanceCalculationException[] = [];
    for (const entry of postedLeave) {
      if (entry.ambiguousReason !== null) {
        leaveExceptions.push({
          type: 'AMBIGUOUS_LEAVE_QUANTITY',
          message: entry.ambiguousReason,
          details: {
            ledgerEntryId: entry.ledgerEntryId,
            leaveApplicationId: entry.leaveApplicationId,
            quantity: entry.quantity,
          },
        });
        continue;
      }
      const wholeIntervals = wholeWorkDateCoverageIntervals(dayRule, workDate, timezone);
      for (const whole of wholeIntervals) {
        coverage.push({
          sourceType: 'POSTED_LEAVE',
          sourceId: entry.ledgerEntryId,
          coverageType: 'POSTED_LEAVE',
          startsAt: whole.startsAt,
          endsAt: whole.endsAt,
        });
      }
    }
    const holidayClassifications = new Map(
      resolution.holidayEntries.map((entry) => [entry.holidayDate, entry.dayType]),
    );
    const holidayEffectRules = holidayEffectRulesOf(workScheduleVersion.holidayEffectRules);
    const result = calculateAttendanceDay({
      timezone,
      workDate,
      dayRule,
      events,
      coverage,
      holidayClassifications,
      holidayEffectRules,
    });
    const exceptions = [...result.exceptions, ...leaveExceptions];
    const fingerprint = fingerprintAttendanceDayInput({
      timezone,
      workDate,
      dayRule,
      events,
      coverage,
      holidayClassifications,
      holidayEffectRules,
      governingVersions: {
        assignmentId: resolution.assignment.id,
        workScheduleVersionId: resolution.workScheduleVersion.id,
        workArrangementVersionId: resolution.workArrangementVersion.id,
        holidayCalendarVersionId: resolution.holidayCalendarVersion.id,
      },
    });
    return {
      fingerprint,
      snapshot: {
        fingerprint,
        timezone,
        assignmentId: resolution.assignment.id,
        workScheduleVersionId: resolution.workScheduleVersion.id,
        workArrangementVersionId: resolution.workArrangementVersion.id,
        holidayCalendarVersionId: resolution.holidayCalendarVersion.id,
        dayRuleId: dayRule.id,
        holidayClassifications: Object.fromEntries(holidayClassifications),
        eventIds: events.map((event: AttendanceWorkDateEvent) => event.id),
        coverageSources: coverage.map((item) => ({
          sourceType: item.sourceType,
          sourceId: item.sourceId,
          coverageType: item.coverageType,
        })),
        capturedAt: new Date().toISOString(),
      },
      dayClassification:
        dayRule.ruleType === 'REST' && result.totals.workedMinutes > 0
          ? 'UNSCHEDULED_SERVICE'
          : 'SCHEDULED',
      totals: result.totals,
      segments: result.segments,
      exceptions,
    };
  }

  private unresolvedCalculation(
    exception: AttendanceExceptionError,
    employeeId: string,
    workDate: string,
    now: Date,
  ): {
    fingerprint: string;
    snapshot: AttendanceDayRuleSnapshot;
    dayClassification: AttendanceDaySummary['dayClassification'];
    totals: AttendanceDayTotalsSummary;
    segments: [];
    exceptions: AttendanceCalculationException[];
  } {
    const fingerprint = resolutionFingerprint(employeeId, workDate, exception);
    return {
      fingerprint,
      snapshot: {
        fingerprint,
        timezone: '',
        resolutionException: {
          type: exception.exceptionType as AttendanceDayExceptionType,
          message: exception.message,
          details: exception.details,
        },
        capturedAt: now.toISOString(),
      },
      dayClassification: 'SCHEDULED',
      totals: {
        expectedMinutes: 0,
        workedMinutes: 0,
        coverageMinutes: 0,
        lateMinutes: 0,
        undertimeMinutes: 0,
        absenceMinutes: 0,
        officialBusinessMinutes: 0,
        officialTravelMinutes: 0,
        trainingMinutes: 0,
        approvedAbsenceMinutes: 0,
        postedLeaveMinutes: 0,
        outsideScheduleMinutes: 0,
        statutoryNightWindowMinutes: 0,
      },
      segments: [],
      exceptions: [
        {
          type: exception.exceptionType as AttendanceDayExceptionType,
          message: exception.message,
          details: exception.details,
        },
      ],
    };
  }

  private coverageWindow(
    dayRule: AttendanceResolution['dayRule'],
    workDate: string,
    timezone: string,
  ): { startsAt: Date; endsAt: Date } {
    const window = eventCollectionWindow(dayRule, workDate, timezone);
    if (window) return { startsAt: window.start, endsAt: window.end };
    return {
      startsAt: zonedTimeToInstant(workDate, '00:00', timezone),
      endsAt: zonedTimeToInstant(
        formatDate(addDays(toDatabaseDate(workDate), 1)),
        '00:00',
        timezone,
      ),
    };
  }

  /**
   * Resolve the exact Attendance Employee scope of the current Agency
   * Membership. Attendance Corrections reuse the Attendance Day read scope so
   * an Employee only lists their own requests while HR scopes stay unchanged.
   */
  async readScope(context: RequestContext): Promise<AttendanceDayReadScope> {
    const grants = context.permissions.filter((grant) => grant.code === 'attendance.days.read');
    if (grants.length === 0) throw this.readForbidden();
    if (grants.some((grant) => grant.scopePolicy === 'AGENCY')) {
      return { kind: 'AGENCY' };
    }
    const scopePolicies = new Set(grants.map((grant) => grant.scopePolicy));
    const employeeIds = new Set<string>();
    await withDatabaseContext(databaseContext(context), async (transaction) => {
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

  private dayNotFound(): AttendanceDayServiceError {
    return new AttendanceDayServiceError(
      'The requested Attendance Day could not be found.',
      404,
      'ATTENDANCE_DAY_NOT_FOUND',
    );
  }

  private readForbidden(): AttendanceDayServiceError {
    return new AttendanceDayServiceError(
      'The attendance.days.read permission is required.',
      403,
      'ATTENDANCE_DAY_READ_FORBIDDEN',
    );
  }
}
