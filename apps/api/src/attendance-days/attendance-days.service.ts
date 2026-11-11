import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hasPermission, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import { resolveEmployeeScope } from '../employee-scope';
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
  isWorkingDate,
  type AttendanceResolution,
} from '../attendance-configuration/schedule-assignments.service';
import {
  addDateValueDays,
  eventCollectionWindow,
  localDateValue,
  zonedTimeToInstant,
  type AttendanceWorkDateEvent,
} from '../attendance/attendance.types';
import { ctoCoverageInTransaction } from '../attendance-cto-inputs/attendance-cto-inputs.coverage';
import { AttendancePostedLeaveInputsService } from '../attendance-posted-leave-inputs/attendance-posted-leave-inputs.service';
import {
  AttendancePostedLeaveInputError,
  type CreatePostedLeaveInput,
} from '../attendance-posted-leave-inputs/attendance-posted-leave-inputs.types';
import {
  applyEventCorrectionOverlays,
  parseAppliedCorrectionOverlays,
  type AppliedAttendanceCorrectionOverlays,
} from '../attendance-corrections/attendance-corrections.effects';
import {
  calculateAttendanceDay,
  ATTENDANCE_MINUTE_RULE,
  fingerprintAttendanceDayInput,
  unplacedCtoInputIds,
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
  ctoMinutes: true,
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
type WorkingDateCounter = (
  employeeId: string,
  dateFrom: string,
  dateTo: string,
) => Promise<number | null>;

function databaseContext(context: RequestContext) {
  return requestDatabaseContext(context);
}

function metadataString(metadata: Prisma.JsonValue, key: string): string | null {
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
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
    minuteRule: snapshot.minuteRule === ATTENDANCE_MINUTE_RULE ? ATTENDANCE_MINUTE_RULE : undefined,
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
      ctoMinutes: record.ctoMinutes,
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

/**
 * The whole-Work-Date coverage window of a resolved Work Date, none on a
 * non-working date. A flexible Day Rule's window is wider than the expected duty
 * the calculation anchors, so it bounds expected duty without being it.
 */
function wholeWorkDateCoverageWindow(
  resolution: AttendanceResolution,
  workDate: string,
): Array<{ startsAt: Date; endsAt: Date }> {
  if (!isWorkingDate(resolution)) return [];
  return wholeWorkDateCoverageIntervals(
    resolution.dayRule,
    workDate,
    resolution.workScheduleVersion.timezone,
  );
}

/**
 * Every calendar date the Day's expected duty reaches, so an overnight shift
 * sees a holiday on its second date. `holidayEntries` keeps the Work Date alone
 * because Leave counts working days from it.
 */
function dutyDateHolidays(resolution: AttendanceResolution, workDate: string) {
  const dutyDates = resolution.dayRule.endNextCalendarDay
    ? [workDate, addDateValueDays(workDate, 1)]
    : [workDate];
  return new Map(
    resolution.holidayCalendarVersion.entries
      .filter((entry) => dutyDates.includes(entry.holidayDate))
      .map((entry) => [entry.holidayDate, entry.dayType]),
  );
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
 * immutable Attendance Events, Attendance Context, and Attendance-owned
 * posted-leave and CTO coverage of one Work Date into an immutable calculation
 * version with exact whole-minute segments and blocking Attendance Exceptions.
 * Recalculation is idempotent through the stored input fingerprint and creates
 * a successor version instead of editing history.
 */
@Injectable()
export class AttendanceDaysService {
  constructor(
    @Inject(ATTENDANCE_DAY_AUDIT_WRITER) private readonly auditWriter: AttendanceDayAuditWriter,
    @Inject(ScheduleAssignmentsService)
    private readonly assignments: ScheduleAssignmentsService,
    @Inject(AttendanceService) private readonly attendance: AttendanceService,
    @Inject(AttendanceContextsService) private readonly contexts: AttendanceContextsService,
    @Inject(AttendancePostedLeaveInputsService)
    private readonly postedLeaveInputs: AttendancePostedLeaveInputsService,
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
      const workingDates = this.workingDateCounter(transaction, context.agencyId);
      const days: AttendanceDayCalculationResultSummary[] = [];
      for (const employeeId of input.employeeIds) {
        for (let offset = 0; offset < dateCount; offset += 1) {
          const workDate = formatDate(addDays(toDatabaseDate(input.dateFrom), offset));
          days.push(
            await this.calculateOne(
              transaction,
              context,
              period,
              employeeId,
              workDate,
              now,
              workingDates,
            ),
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
   * Internal contract: recompute each Attendance Day's input fingerprint from
   * its current sources without writing, and return the ids of the days whose
   * stored fingerprint no longer matches. Attendance Period Reconciliation
   * uses it to refuse a lock over sources that changed after approval.
   */
  async changedInputDayIdsInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    attendanceDayIds: readonly string[],
  ): Promise<string[]> {
    if (attendanceDayIds.length === 0) return [];
    const days = await transaction.attendanceDay.findMany({
      where: { agencyId: context.agencyId, id: { in: [...attendanceDayIds] } },
      orderBy: [{ workDate: 'asc' }, { id: 'asc' }],
      select: { id: true, employeeId: true, workDate: true, ruleSnapshot: true },
    });
    const now = new Date();
    const workingDates = this.workingDateCounter(transaction, context.agencyId);
    const changed: string[] = [];
    for (const day of days) {
      const calculation = await this.calculationOf(
        transaction,
        context,
        day.employeeId,
        formatDate(day.workDate),
        now,
        workingDates,
      );
      if (metadataString(day.ruleSnapshot, 'fingerprint') !== calculation.fingerprint) {
        changed.push(day.id);
      }
    }
    return changed;
  }

  /**
   * Internal contract: Employee Attendance Submission approval marks only the
   * exact bound Attendance Day versions APPROVED. A concurrent recalculation
   * changes the current pointer instead, so the caller sees a short count.
   */
  async approveSubmittedVersionsInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    attendanceDayIds: readonly string[],
  ): Promise<number> {
    if (attendanceDayIds.length === 0) return 0;
    const approved = await transaction.attendanceDay.updateMany({
      where: {
        agencyId: context.agencyId,
        id: { in: [...attendanceDayIds] },
        status: 'CALCULATED',
        isCurrent: true,
      },
      data: { status: 'APPROVED' },
    });
    return approved.count;
  }

  /**
   * Recalculate the affected Work Dates of one applied Attendance Correction
   * inside the caller-owned transaction. Unlike an ordinary calculation, it
   * also recalculates Work Dates of a finalized Attendance Period. A superseded
   * APPROVED version and its segments stay retained.
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
    const workingDates = this.workingDateCounter(transaction, context.agencyId);
    const results: AttendanceDayCalculationResultSummary[] = [];
    for (const workDate of input.workDates) {
      results.push(
        await this.calculateOne(
          transaction,
          context,
          period,
          input.employeeId,
          workDate,
          now,
          workingDates,
        ),
      );
    }
    return results;
  }

  /**
   * Leave's handoff when an applied Leave Cancellation changes posted leave.
   * Inside the caller-owned transaction it creates the successor input, which
   * withdraws coverage when its quantity is zero, and recalculates every
   * current Attendance Day across the predecessor's dates. A Work Date inside a
   * finalized Attendance Period is refused, because locked attendance changes
   * only through a Locked Attendance Adjustment. A retry with the same source
   * key returns the same successor and leaves the recalculated days unchanged.
   */
  async supersedePostedLeaveInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    input: CreatePostedLeaveInput & { predecessorInputId: string },
  ): Promise<{ id: string; recalculatedWorkDates: string[] }> {
    const predecessor = await transaction.attendancePostedLeaveInput.findFirst({
      where: {
        agencyId: context.agencyId,
        employeeId: input.employeeId,
        id: input.predecessorInputId,
      },
      select: { dateFrom: true, dateTo: true },
    });
    if (!predecessor) {
      throw new AttendancePostedLeaveInputError(
        'The predecessor is not a posted-leave input for this Employee.',
        404,
        'POSTED_LEAVE_INPUT_PREDECESSOR_NOT_FOUND',
      );
    }
    const dateFrom =
      formatDate(predecessor.dateFrom) < input.dateFrom
        ? formatDate(predecessor.dateFrom)
        : input.dateFrom;
    const dateTo =
      formatDate(predecessor.dateTo) > input.dateTo ? formatDate(predecessor.dateTo) : input.dateTo;
    // Hold every overlapping period so a concurrent lock waits for this handoff.
    const periods = await transaction.$queryRaw<Array<{ code: string; status: string }>>(
      Prisma.sql`SELECT "code", "status" FROM "attendance_periods"
        WHERE "agency_id" = CAST(${context.agencyId} AS uuid)
          AND "date_from" <= CAST(${dateTo} AS date)
          AND "date_to" >= CAST(${dateFrom} AS date)
        ORDER BY "id"
        FOR UPDATE`,
    );
    const locked = periods.filter(({ status }) => status === 'FINALIZED');
    if (locked.length > 0) {
      throw new AttendanceDayServiceError(
        'An affected Work Date is in a locked Attendance Period. It changes only through a Locked Attendance Adjustment.',
        409,
        'ATTENDANCE_PERIOD_LOCKED',
        locked.map(({ code }) => `PERIOD:${code}`),
      );
    }
    const successor = await this.postedLeaveInputs.createInTransaction(
      transaction,
      context.agencyId,
      input,
    );
    const days = await transaction.attendanceDay.findMany({
      where: {
        agencyId: context.agencyId,
        employeeId: input.employeeId,
        isCurrent: true,
        workDate: { gte: toDatabaseDate(dateFrom), lte: toDatabaseDate(dateTo) },
      },
      orderBy: { workDate: 'asc' },
      select: { workDate: true, attendancePeriod: { select: periodSelect } },
    });
    const now = new Date();
    const workingDates = this.workingDateCounter(transaction, context.agencyId);
    for (const day of days) {
      await this.calculateOne(
        transaction,
        context,
        day.attendancePeriod,
        input.employeeId,
        formatDate(day.workDate),
        now,
        workingDates,
      );
    }
    return {
      id: successor.id,
      recalculatedWorkDates: days.map(({ workDate }) => formatDate(workDate)),
    };
  }

  /**
   * Recalculate the Employee's current Attendance Day for one Work Date inside
   * the caller-owned transaction, after an Attendance-owned input changed. A
   * Work Date with no Attendance Day yet is left for its first calculation.
   */
  async recalculateCurrentWorkDateInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    employeeId: string,
    workDate: string,
  ): Promise<AttendanceDayCalculationResultSummary | null> {
    const day = await transaction.attendanceDay.findFirst({
      where: {
        agencyId: context.agencyId,
        employeeId,
        workDate: toDatabaseDate(workDate),
        isCurrent: true,
      },
      select: { attendancePeriod: { select: periodSelect } },
    });
    if (!day) return null;
    return this.calculateOne(
      transaction,
      context,
      day.attendancePeriod,
      employeeId,
      workDate,
      new Date(),
      this.workingDateCounter(transaction, context.agencyId),
    );
  }

  /**
   * The whole-Work-Date coverage window of one Work Date, the coverage whole-day
   * leave and CTO receive: empty on a REST Day Rule or a non-working holiday.
   * It bounds expected duty without being it: a flexible Day Rule's window is
   * wider, and an overnight window keeps a Non-Working Holiday after midnight
   * that the calculation drops. Null when the Employee's schedule for the date
   * cannot be resolved.
   */
  async workDateCoverageWindowInTransaction(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    employeeId: string,
    workDate: string,
  ): Promise<Array<{ startsAt: Date; endsAt: Date }> | null> {
    let resolution: AttendanceResolution;
    try {
      resolution = await this.assignments.resolveForWorkDateInTransaction(
        transaction,
        agencyId,
        employeeId,
        workDate,
      );
    } catch (error: unknown) {
      if (error instanceof AttendanceExceptionError) return null;
      throw error;
    }
    return wholeWorkDateCoverageWindow(resolution, workDate);
  }

  /**
   * One Work Date's expected-duty minutes under the Employee's Work Schedule
   * Version, as the calculation counts them: zero on a REST Day Rule or a
   * Non-Working Holiday, and without breaks. Given a timed interval, also the
   * minutes the calculation would place from it as CTO, or null when it would leave
   * the interval unplaced. A flexible Day is judged with no Attendance Events, since
   * CTO precedes the date; events that later anchor it elsewhere can still unplace
   * the interval, which the Day reports as `UNPLACED_CTO_INPUT`. Null when the
   * Employee's schedule for the date cannot be resolved.
   */
  async expectedDutyInTransaction(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    employeeId: string,
    workDate: string,
    timed?: { startsAt: Date; endsAt: Date },
  ): Promise<{ minutes: number; timedCtoMinutes: number | null } | null> {
    let resolution: AttendanceResolution;
    try {
      resolution = await this.assignments.resolveForWorkDateInTransaction(
        transaction,
        agencyId,
        employeeId,
        workDate,
      );
    } catch (error: unknown) {
      if (error instanceof AttendanceExceptionError) return null;
      throw error;
    }
    const calculate = (coverage: AttendanceCalculationCoverage[]) =>
      calculateAttendanceDay({
        timezone: resolution.workScheduleVersion.timezone,
        workDate,
        dayRule: resolution.dayRule,
        events: [],
        coverage,
        holidayClassifications: dutyDateHolidays(resolution, workDate),
      });
    const minutes = calculate([]).totals.expectedMinutes;
    if (!timed) return { minutes, timedCtoMinutes: null };
    const inputId = 'candidate';
    const result = calculate([
      { sourceType: 'CTO_INPUT', sourceId: inputId, coverageType: 'CTO', ...timed },
    ]);
    const placed = unplacedCtoInputIds(result.segments, [{ inputId, timed: true }]).length === 0;
    return { minutes, timedCtoMinutes: placed ? result.totals.ctoMinutes : null };
  }

  /**
   * Creates the successor posted-leave input an authorized Locked Attendance
   * Adjustment carries. The caller recalculates the affected Work Dates.
   */
  async createPostedLeaveSuccessorInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    input: CreatePostedLeaveInput & { predecessorInputId: string },
  ): Promise<{ id: string }> {
    return this.postedLeaveInputs.createInTransaction(transaction, context.agencyId, input);
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
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const scope = await this.readScope(transaction, context);
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
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      await this.readScope(transaction, context);
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
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const scope = await this.readScope(transaction, context);
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
    // Hold the period so a concurrent lock either waits for this calculation,
    // then fails reconciliation, or finalizes first and refuses it below.
    await transaction.$queryRaw`SELECT "id" FROM "attendance_periods"
      WHERE "agency_id" = CAST(${context.agencyId} AS uuid) AND "code" = ${input.periodCode}
      FOR SHARE`;
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

  /**
   * Working-date counts for one operation's transaction, memoized per
   * Employee and range so each Work Date of a long leave range reuses one count.
   */
  private workingDateCounter(
    transaction: Prisma.TransactionClient,
    agencyId: string,
  ): WorkingDateCounter {
    const counts = new Map<string, Promise<number | null>>();
    return (employeeId, dateFrom, dateTo) => {
      const key = `${employeeId}/${dateFrom}/${dateTo}`;
      let count = counts.get(key);
      if (!count) {
        count = this.assignments.workingDatesInTransaction(
          transaction,
          agencyId,
          employeeId,
          dateFrom,
          dateTo,
        );
        counts.set(key, count);
      }
      return count;
    };
  }

  private async calculateOne(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    period: AttendancePeriodRecord,
    employeeId: string,
    workDate: string,
    now: Date,
    workingDates: WorkingDateCounter,
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

    const calculation = await this.calculationOf(
      transaction,
      context,
      employeeId,
      workDate,
      now,
      workingDates,
    );
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
    const maxVersion = await transaction.attendanceDay.aggregate({
      where: {
        agencyId: context.agencyId,
        employeeId,
        workDate: toDatabaseDate(workDate),
      },
      _max: { calculationVersion: true },
    });
    const calculationVersion = (maxVersion._max.calculationVersion ?? 0) + 1;
    let staleSubmissionIds: string[] = [];
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
      staleSubmissionIds = await this.markSubmissionsStale(transaction, context, [current.id]);
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
        staleSubmissionIds,
      },
    });
    return {
      employeeId,
      workDate,
      attendanceDayId: record.id,
      status,
      outcome: current ? 'RECALCULATED' : 'CREATED',
      exceptionTypes,
      staleSubmissionIds,
    };
  }

  /**
   * Reads the current sources of one Work Date and calculates it without
   * writing. The fingerprint identifies those sources, so it changes whenever
   * an Attendance Event, Attendance Context, posted-leave input, applied
   * correction, or schedule binding the Day depends on changes.
   */
  private async calculationOf(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    employeeId: string,
    workDate: string,
    now: Date,
    workingDates: WorkingDateCounter,
  ) {
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
    return resolution
      ? this.calculateResolved(transaction, context, resolution, workDate, overlays, workingDates)
      : this.unresolvedCalculation(resolutionException!, employeeId, workDate, now);
  }

  /**
   * Any Employee Attendance Submission bound to a superseded Attendance Day
   * version stops being current and must be resubmitted. A STALE submission
   * never returns to an active state.
   */
  private async markSubmissionsStale(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    supersededDayIds: readonly string[],
  ): Promise<string[]> {
    if (supersededDayIds.length === 0) return [];
    const links = await transaction.employeeAttendanceSubmissionDay.findMany({
      where: { agencyId: context.agencyId, attendanceDayId: { in: [...supersededDayIds] } },
      select: { employeeAttendanceSubmissionId: true },
    });
    const submissionIds = [...new Set(links.map((link) => link.employeeAttendanceSubmissionId))];
    if (submissionIds.length === 0) return [];
    await transaction.employeeAttendanceSubmission.updateMany({
      where: {
        agencyId: context.agencyId,
        id: { in: submissionIds },
        status: { in: ['DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED'] },
      },
      data: { status: 'STALE' },
    });
    return submissionIds;
  }

  private async calculateResolved(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    resolution: AttendanceResolution,
    workDate: string,
    overlays: AppliedAttendanceCorrectionOverlays,
    workingDates: WorkingDateCounter,
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
    let coverage: AttendanceCalculationCoverage[] = [];
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
    const postedLeave = await this.postedLeaveInputs.coverageInTransaction(
      transaction,
      context.agencyId,
      resolution.employeeId,
      workDate,
      (dateFrom, dateTo) => workingDates(resolution.employeeId, dateFrom, dateTo),
    );
    // Leave counts no working day here, so placed leave covers nothing.
    const placesLeave = isWorkingDate(resolution);
    const sourceExceptions: AttendanceCalculationException[] = [];
    for (const entry of postedLeave) {
      if (entry.ambiguousReason !== null) {
        sourceExceptions.push({
          type: 'AMBIGUOUS_LEAVE_QUANTITY',
          message: entry.ambiguousReason,
          details: {
            postedLeaveInputId: entry.inputId,
            leaveSourceType: entry.sourceType,
            leaveSourceId: entry.sourceId,
            quantity: entry.quantity,
          },
        });
        continue;
      }
      if (!placesLeave) continue;
      const wholeIntervals = wholeWorkDateCoverageIntervals(dayRule, workDate, timezone);
      for (const whole of wholeIntervals) {
        coverage.push({
          sourceType: 'POSTED_LEAVE',
          sourceId: entry.inputId,
          coverageType: 'POSTED_LEAVE',
          startsAt: whole.startsAt,
          endsAt: whole.endsAt,
        });
      }
    }
    // CTO pays expected duty only: whole-day CTO covers the coverage window and
    // timed CTO its interval. The calculated Day decides whether each input lies
    // in expected duty; one it leaves unpaid is a blocking exception and is
    // placed nowhere, so the Day is recalculated without it.
    const ctoEntries = await ctoCoverageInTransaction(
      transaction,
      context.agencyId,
      resolution.employeeId,
      workDate,
    );
    const coverageWindow = wholeWorkDateCoverageWindow(resolution, workDate);
    for (const entry of ctoEntries) {
      for (const interval of entry.interval ? [entry.interval] : coverageWindow) {
        coverage.push({
          sourceType: 'CTO_INPUT',
          sourceId: entry.inputId,
          coverageType: 'CTO',
          startsAt: interval.startsAt,
          endsAt: interval.endsAt,
        });
      }
    }
    const holidayClassifications = dutyDateHolidays(resolution, workDate);
    const calculate = () =>
      calculateAttendanceDay({
        timezone,
        workDate,
        dayRule,
        events,
        coverage,
        holidayClassifications,
      });
    let result = calculate();
    const unplacedCto = unplacedCtoInputIds(
      result.segments,
      ctoEntries.map((entry) => ({ inputId: entry.inputId, timed: entry.interval !== null })),
    );
    if (unplacedCto.length > 0) {
      coverage = coverage.filter(
        (item) => item.sourceType !== 'CTO_INPUT' || !unplacedCto.includes(item.sourceId),
      );
      result = calculate();
    }
    for (const ctoInputId of unplacedCto) {
      sourceExceptions.push({
        type: 'UNPLACED_CTO_INPUT',
        message: "A current CTO input lies outside the Work Date's expected duty.",
        details: { ctoInputId },
      });
    }
    const exceptions = [...result.exceptions, ...sourceExceptions];
    const fingerprint = fingerprintAttendanceDayInput({
      timezone,
      workDate,
      dayRule,
      events,
      coverage,
      holidayClassifications,
      governingVersions: {
        assignmentId: resolution.assignment.id,
        workScheduleVersionId: resolution.workScheduleVersion.id,
        workArrangementVersionId: resolution.workArrangementVersion.id,
        holidayCalendarVersionId: resolution.holidayCalendarVersion.id,
      },
      unplacedSources: [
        ...postedLeave
          .filter((entry) => entry.ambiguousReason !== null)
          .map((entry) => ({ sourceType: 'POSTED_LEAVE', sourceId: entry.inputId })),
        ...unplacedCto.map((sourceId) => ({ sourceType: 'CTO_INPUT', sourceId })),
      ],
    });
    return {
      fingerprint,
      snapshot: {
        fingerprint,
        minuteRule: ATTENDANCE_MINUTE_RULE,
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
      // Service on a rest day or a Non-Working Holiday is outside any expected duty.
      dayClassification:
        result.totals.expectedMinutes === 0 && result.totals.workedMinutes > 0
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
        ctoMinutes: 0,
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
   * Resolve the Attendance Day read scope of the current Agency Membership in
   * the caller's transaction, denying a scope that reaches no Employee.
   * Attendance Corrections reuse it so an Employee only lists their own
   * requests while HR scopes stay unchanged.
   */
  async readScope(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
  ): Promise<AttendanceDayReadScope> {
    const scope = await resolveEmployeeScope(transaction, context, 'attendance.days.read');
    if (scope.kind === 'NONE' || (scope.kind === 'SCOPED' && scope.employeeIds.length === 0)) {
      throw this.readForbidden();
    }
    return scope;
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
