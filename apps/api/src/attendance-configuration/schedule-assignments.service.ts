import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { holdsAgencyWide, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import { DocumentsService } from '../documents/documents.service';
import {
  ATTENDANCE_CONFIGURATION_AUDIT_WRITER,
  type AttendanceConfigurationAuditWriter,
} from './attendance-configuration.audit';
import {
  AttendanceConfigurationServiceError,
  AttendanceExceptionError,
  addDays,
  formatDate,
  manilaToday,
  toDatabaseDate,
  WORK_SCHEDULE_TYPES,
  type AttendanceExceptionType,
  type CreateScheduleAssignmentInput,
  type EndScheduleAssignmentInput,
  type WorkArrangementType,
  type WorkScheduleType,
} from './attendance-configuration.types';
import { isNonWorkingHoliday } from './holiday-effect-rules';
import {
  HolidayCalendarsService,
  type HolidayCalendarEntrySummary,
  type HolidayCalendarVersionSummary,
} from './holiday-calendars.service';
import {
  WorkSchedulesService,
  type WorkScheduleDayRuleSummary,
  type WorkScheduleVersionSummary,
} from './work-schedules.service';
import {
  WorkArrangementsService,
  type WorkArrangementVersionSummary,
} from './work-arrangements.service';

export interface ScheduleAssignmentEmployeeSummary {
  id: string;
  employeeNumber: string;
  legalName: string;
}

export interface ScheduleAssignmentSummary {
  id: string;
  employee: ScheduleAssignmentEmployeeSummary;
  workScheduleVersionId: string;
  workScheduleVersionNo: number;
  scheduleType: WorkScheduleType;
  workScheduleCode: string;
  workScheduleName: string;
  workArrangementVersionId: string;
  workArrangementVersionNo: number;
  arrangementType: WorkArrangementType;
  workArrangementCode: string;
  workArrangementName: string;
  holidayCalendarId: string;
  authorityDocumentVersionId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  assignedByMembershipId: string;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}

export interface AttendanceResolution {
  employeeId: string;
  workDate: string;
  assignment: ScheduleAssignmentSummary;
  workScheduleVersion: WorkScheduleVersionSummary;
  workArrangementVersion: WorkArrangementVersionSummary;
  holidayCalendarVersion: HolidayCalendarVersionSummary;
  dayRule: WorkScheduleDayRuleSummary;
  holidayEntries: HolidayCalendarEntrySummary[];
}

/**
 * Whether a resolved Work Date counts as a working date the way Leave counts
 * working days: neither a REST Day Rule nor a non-working holiday.
 */
export function isWorkingDate(resolution: AttendanceResolution): boolean {
  return (
    resolution.dayRule.ruleType !== 'REST' &&
    !resolution.holidayEntries.some((entry) => isNonWorkingHoliday(entry.dayType))
  );
}

export interface ScheduleAssignmentListFilter {
  employeeId?: string | undefined;
  asOf?: string | undefined;
}

const assignmentSelect = {
  id: true,
  employeeId: true,
  workScheduleVersionId: true,
  workArrangementVersionId: true,
  authorityDocumentVersionId: true,
  effectiveFrom: true,
  effectiveTo: true,
  assignedByMembershipId: true,
  createdAt: true,
  updatedAt: true,
  rowVersion: true,
  employee: { select: { id: true, employeeNumber: true, legalName: true } },
  workScheduleVersion: {
    select: {
      versionNo: true,
      scheduleType: true,
      workSchedule: { select: { code: true, name: true } },
    },
  },
  workArrangementVersion: {
    select: {
      versionNo: true,
      arrangementType: true,
      holidayCalendarId: true,
      workArrangement: { select: { code: true, name: true } },
    },
  },
} as const;

type ScheduleAssignmentRecord = Prisma.ScheduleAssignmentGetPayload<{
  select: typeof assignmentSelect;
}>;

function databaseContext(context: RequestContext, transition = false) {
  return requestDatabaseContext(
    context,
    ...(transition ? (['schedule-assignment-transition'] as const) : []),
  );
}

function formatDateTime(value: Date): string {
  return value.toISOString();
}

function isoWeekday(value: Date): number {
  const day = value.getUTCDay();
  return day === 0 ? 7 : day;
}

function assignmentSummary(record: ScheduleAssignmentRecord): ScheduleAssignmentSummary {
  return {
    id: record.id,
    employee: {
      id: record.employee.id,
      employeeNumber: record.employee.employeeNumber,
      legalName: record.employee.legalName,
    },
    workScheduleVersionId: record.workScheduleVersionId,
    workScheduleVersionNo: record.workScheduleVersion.versionNo,
    scheduleType: record.workScheduleVersion.scheduleType as WorkScheduleType,
    workScheduleCode: record.workScheduleVersion.workSchedule.code,
    workScheduleName: record.workScheduleVersion.workSchedule.name,
    workArrangementVersionId: record.workArrangementVersionId,
    workArrangementVersionNo: record.workArrangementVersion.versionNo,
    arrangementType: record.workArrangementVersion.arrangementType as WorkArrangementType,
    workArrangementCode: record.workArrangementVersion.workArrangement.code,
    workArrangementName: record.workArrangementVersion.workArrangement.name,
    holidayCalendarId: record.workArrangementVersion.holidayCalendarId,
    authorityDocumentVersionId: record.authorityDocumentVersionId,
    effectiveFrom: formatDate(record.effectiveFrom),
    effectiveTo: record.effectiveTo ? formatDate(record.effectiveTo) : null,
    assignedByMembershipId: record.assignedByMembershipId,
    createdAt: formatDateTime(record.createdAt),
    updatedAt: formatDateTime(record.updatedAt),
    rowVersion: record.rowVersion,
  };
}

@Injectable()
export class ScheduleAssignmentsService {
  constructor(
    @Inject(ATTENDANCE_CONFIGURATION_AUDIT_WRITER)
    private readonly auditWriter: AttendanceConfigurationAuditWriter,
    @Inject(DocumentsService) private readonly documentsService: DocumentsService,
    @Inject(WorkSchedulesService) private readonly workSchedules: WorkSchedulesService,
    @Inject(WorkArrangementsService)
    private readonly workArrangements: WorkArrangementsService,
    @Inject(HolidayCalendarsService)
    private readonly holidayCalendars: HolidayCalendarsService,
  ) {}

  async list(
    context: RequestContext,
    filter: ScheduleAssignmentListFilter = {},
  ): Promise<ScheduleAssignmentSummary[]> {
    this.assertPermission(
      context,
      'attendance.configuration.read',
      'SCHEDULE_ASSIGNMENT_READ_FORBIDDEN',
    );
    const asOf = filter.asOf ? toDatabaseDate(filter.asOf) : null;
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const records = await transaction.scheduleAssignment.findMany({
        where: {
          agencyId: context.agencyId,
          ...(filter.employeeId ? { employeeId: filter.employeeId } : {}),
          ...(asOf
            ? {
                effectiveFrom: { lte: asOf },
                OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }],
              }
            : {}),
        },
        orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
        select: assignmentSelect,
      });
      return records.map(assignmentSummary);
    });
  }

  async create(
    context: RequestContext,
    input: CreateScheduleAssignmentInput,
    rawIdempotencyKey?: string,
  ): Promise<ScheduleAssignmentSummary> {
    this.assertPermission(
      context,
      'attendance.assignments.manage',
      'SCHEDULE_ASSIGNMENT_MANAGE_FORBIDDEN',
    );
    const effectiveFrom = toDatabaseDate(input.effectiveFrom);
    const idempotencyKey = rawIdempotencyKey?.trim() || null;
    return withDatabaseContext(databaseContext(context, true), async (transaction) => {
      if (idempotencyKey) {
        const completed = await transaction.auditEvent.findFirst({
          where: {
            agencyId: context.agencyId,
            action: 'SCHEDULE_ASSIGNMENT_CREATED',
            idempotencyKey,
          },
          select: { metadata: true },
        });
        if (completed) {
          const assignmentId = this.metadataString(completed.metadata, 'assignmentId');
          if (
            !assignmentId ||
            this.metadataString(completed.metadata, 'employeeId') !== input.employeeId ||
            this.metadataString(completed.metadata, 'effectiveFrom') !==
              formatDate(effectiveFrom) ||
            this.metadataString(completed.metadata, 'workScheduleVersionId') !==
              input.workScheduleVersionId ||
            this.metadataString(completed.metadata, 'workArrangementVersionId') !==
              input.workArrangementVersionId ||
            this.metadataString(completed.metadata, 'authorityDocumentVersionId') !==
              input.authorityDocumentVersionId
          ) {
            throw this.idempotencyConflict();
          }
          const existing = await transaction.scheduleAssignment.findFirst({
            where: { agencyId: context.agencyId, id: assignmentId },
            select: assignmentSelect,
          });
          if (!existing) throw this.idempotencyConflict();
          return assignmentSummary(existing);
        }
      }
      await this.assertApplicable(transaction, context.agencyId, input.employeeId, effectiveFrom);
      const scheduleVersion = await transaction.workScheduleVersion.findFirst({
        where: { agencyId: context.agencyId, id: input.workScheduleVersionId },
        select: {
          id: true,
          status: true,
          scheduleType: true,
          effectiveFrom: true,
          effectiveTo: true,
        },
      });
      if (!scheduleVersion) throw this.scheduleVersionNotFound();
      if (scheduleVersion.status !== 'ACTIVE') throw this.versionNotActive('Work Schedule');
      if (
        effectiveFrom < scheduleVersion.effectiveFrom ||
        (scheduleVersion.effectiveTo && effectiveFrom > scheduleVersion.effectiveTo)
      ) {
        throw this.versionPeriodInvalid('Work Schedule');
      }
      const arrangementVersion = await transaction.workArrangementVersion.findFirst({
        where: { agencyId: context.agencyId, id: input.workArrangementVersionId },
        select: {
          id: true,
          status: true,
          permittedScheduleTypes: true,
          effectiveFrom: true,
          effectiveTo: true,
        },
      });
      if (!arrangementVersion) throw this.arrangementVersionNotFound();
      if (arrangementVersion.status !== 'ACTIVE') {
        throw this.versionNotActive('Work Arrangement');
      }
      if (
        effectiveFrom < arrangementVersion.effectiveFrom ||
        (arrangementVersion.effectiveTo && effectiveFrom > arrangementVersion.effectiveTo)
      ) {
        throw this.versionPeriodInvalid('Work Arrangement');
      }
      const permitted = Array.isArray(arrangementVersion.permittedScheduleTypes)
        ? arrangementVersion.permittedScheduleTypes
        : [];
      if (
        !permitted.some(
          (value) =>
            typeof value === 'string' &&
            (WORK_SCHEDULE_TYPES as readonly string[]).includes(value) &&
            value === scheduleVersion.scheduleType,
        )
      ) {
        throw this.incompatibleVersions();
      }
      const evidence = await this.documentsService.resolveFinalizedVersionInTransaction(
        transaction,
        { agencyId: context.agencyId },
        input.authorityDocumentVersionId,
      );
      if (!evidence) throw this.evidenceRequired();
      await this.assertNoOverlap(
        transaction,
        context.agencyId,
        input.employeeId,
        effectiveFrom,
        null,
      );
      let assignment: ScheduleAssignmentRecord;
      try {
        const created = await transaction.scheduleAssignment.create({
          data: {
            agencyId: context.agencyId,
            employeeId: input.employeeId,
            workScheduleVersionId: input.workScheduleVersionId,
            workArrangementVersionId: input.workArrangementVersionId,
            authorityDocumentVersionId: evidence.id,
            effectiveFrom,
            assignedByMembershipId: context.membershipId,
          },
          select: { id: true },
        });
        const record = await transaction.scheduleAssignment.findFirstOrThrow({
          where: { agencyId: context.agencyId, id: created.id },
          select: assignmentSelect,
        });
        assignment = record;
      } catch (error: unknown) {
        if (this.isOverlapViolation(error)) throw this.periodOverlap();
        throw error;
      }
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'SCHEDULE_ASSIGNMENT_CREATED',
        entityType: 'ScheduleAssignment',
        entityId: assignment.id,
        previousStatus: 'None',
        newStatus: 'ACTIVE',
        requestId: context.requestId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        metadata: {
          assignmentId: assignment.id,
          employeeId: input.employeeId,
          employeeNumber: assignment.employee.employeeNumber,
          effectiveFrom: formatDate(effectiveFrom),
          workScheduleVersionId: input.workScheduleVersionId,
          workArrangementVersionId: input.workArrangementVersionId,
          holidayCalendarId: assignment.workArrangementVersion.holidayCalendarId,
          authorityDocumentVersionId: evidence.id,
        },
      });
      return assignmentSummary(assignment);
    });
  }

  async end(
    context: RequestContext,
    assignmentId: string,
    input: EndScheduleAssignmentInput,
  ): Promise<ScheduleAssignmentSummary> {
    this.assertPermission(
      context,
      'attendance.assignments.manage',
      'SCHEDULE_ASSIGNMENT_MANAGE_FORBIDDEN',
    );
    const reason = input.reason.trim();
    if (!reason) throw this.endReasonRequired();
    const effectiveTo = toDatabaseDate(input.effectiveTo);
    return withDatabaseContext(databaseContext(context, true), async (transaction) => {
      await this.lockAssignment(transaction, context.agencyId, assignmentId);
      const current = await transaction.scheduleAssignment.findFirst({
        where: { agencyId: context.agencyId, id: assignmentId },
        select: assignmentSelect,
      });
      if (!current) throw this.notFound();
      if (current.effectiveTo) {
        if (current.effectiveTo.getTime() === effectiveTo.getTime()) {
          return assignmentSummary(current);
        }
        throw this.endedConflict();
      }
      if (effectiveTo < current.effectiveFrom) throw this.periodInvalid();
      if (effectiveTo < toDatabaseDate(manilaToday())) throw this.prospectiveRequired();
      await transaction.scheduleAssignment.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: assignmentId } },
        data: { effectiveTo },
      });
      const result = await transaction.scheduleAssignment.findFirstOrThrow({
        where: { agencyId: context.agencyId, id: assignmentId },
        select: assignmentSelect,
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'SCHEDULE_ASSIGNMENT_ENDED',
        entityType: 'ScheduleAssignment',
        entityId: assignmentId,
        previousStatus: 'ACTIVE',
        newStatus: 'ENDED',
        reason,
        requestId: context.requestId,
        metadata: {
          assignmentId,
          employeeId: current.employeeId,
          effectiveFrom: formatDate(current.effectiveFrom),
          effectiveTo: formatDate(effectiveTo),
        },
      });
      return assignmentSummary(result);
    });
  }

  /**
   * Resolve the exact assignment, Work Schedule Version, Work Arrangement
   * Version, and Holiday Calendar Version for one Employee Work Date. Any
   * missing or ambiguous input raises a blocking Attendance Exception.
   */
  async resolveForWorkDate(
    context: RequestContext,
    employeeId: string,
    workDateValue: string,
  ): Promise<AttendanceResolution> {
    this.assertPermission(
      context,
      'attendance.configuration.read',
      'SCHEDULE_ASSIGNMENT_READ_FORBIDDEN',
    );
    return withDatabaseContext(databaseContext(context), (transaction) =>
      this.resolveForWorkDateInTransaction(
        transaction,
        context.agencyId,
        employeeId,
        workDateValue,
      ),
    );
  }

  /**
   * Resolve one Work Date inside a caller-owned transaction. Attendance
   * capture uses this seam so Employees without configuration read access can
   * still resolve their own governing schedule and fail closed identically.
   */
  async resolveForWorkDateInTransaction(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    employeeId: string,
    workDateValue: string,
  ): Promise<AttendanceResolution> {
    const workDate = toDatabaseDate(workDateValue);
    const employee = await transaction.employee.findFirst({
      where: { agencyId, id: employeeId },
      select: { id: true, employeeNumber: true, legalName: true },
    });
    if (!employee) throw this.employeeNotFound();
    const segment = await transaction.serviceSegment.findFirst({
      where: {
        agencyId,
        employeeId,
        status: 'ACTIVE',
        effectiveFrom: { lte: workDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: workDate } }],
      },
      select: { id: true },
    });
    if (!segment) {
      throw this.attendanceException(
        'MISSING_SERVICE',
        'No qualifying Appointed Personnel service covers the Work Date.',
        { employeeId, workDate: workDateValue },
      );
    }
    const assignments = await transaction.scheduleAssignment.findMany({
      where: {
        agencyId,
        employeeId,
        effectiveFrom: { lte: workDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: workDate } }],
      },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
      select: assignmentSelect,
    });
    if (assignments.length === 0) {
      throw this.attendanceException(
        'MISSING_SCHEDULE_ASSIGNMENT',
        'No Schedule Assignment is effective on the Work Date.',
        { employeeId, workDate: workDateValue },
      );
    }
    if (assignments.length > 1) {
      throw this.attendanceException(
        'OVERLAPPING_SCHEDULE_ASSIGNMENT',
        'More than one Schedule Assignment is effective on the Work Date.',
        {
          employeeId,
          workDate: workDateValue,
          assignmentIds: assignments.map((assignment) => assignment.id),
        },
      );
    }
    const assignment = assignmentSummary(assignments[0]!);
    const workScheduleVersion = await this.workSchedules.findVersionInTransaction(
      transaction,
      agencyId,
      assignment.workScheduleVersionId,
      workDate,
    );
    if (!workScheduleVersion) {
      throw this.attendanceException(
        'MISSING_WORK_SCHEDULE_VERSION',
        'The assigned Work Schedule Version is not available for the Work Date.',
        {
          employeeId,
          workDate: workDateValue,
          assignmentId: assignment.id,
          workScheduleVersionId: assignment.workScheduleVersionId,
        },
      );
    }
    const workArrangementVersion = await this.workArrangements.findVersionInTransaction(
      transaction,
      agencyId,
      assignment.workArrangementVersionId,
      workDate,
    );
    if (!workArrangementVersion) {
      throw this.attendanceException(
        'MISSING_WORK_ARRANGEMENT_VERSION',
        'The assigned Work Arrangement Version is not available for the Work Date.',
        {
          employeeId,
          workDate: workDateValue,
          assignmentId: assignment.id,
          workArrangementVersionId: assignment.workArrangementVersionId,
        },
      );
    }
    if (!workArrangementVersion.permittedScheduleTypes.includes(workScheduleVersion.scheduleType)) {
      throw this.attendanceException(
        'INCOMPATIBLE_SCHEDULE_ARRANGEMENT',
        'The assigned Work Arrangement Version does not permit the Work Schedule type.',
        {
          employeeId,
          workDate: workDateValue,
          assignmentId: assignment.id,
          scheduleType: workScheduleVersion.scheduleType,
          permittedScheduleTypes: workArrangementVersion.permittedScheduleTypes,
        },
      );
    }
    const candidates = await this.holidayCalendars.findPublishedCandidates(
      transaction,
      agencyId,
      workArrangementVersion.holidayCalendarId,
      workDate,
    );
    if (candidates.length === 0) {
      throw this.attendanceException(
        'MISSING_HOLIDAY_CALENDAR_VERSION',
        'No Holiday Calendar Version is effective on the Work Date.',
        {
          employeeId,
          workDate: workDateValue,
          holidayCalendarId: workArrangementVersion.holidayCalendarId,
        },
      );
    }
    if (candidates.length > 1) {
      throw this.attendanceException(
        'AMBIGUOUS_HOLIDAY_CALENDAR_VERSION',
        'More than one Holiday Calendar Version is effective on the Work Date.',
        {
          employeeId,
          workDate: workDateValue,
          holidayCalendarId: workArrangementVersion.holidayCalendarId,
          versionIds: candidates.map((candidate) => candidate.id),
        },
      );
    }
    const holidayCalendarVersion = candidates[0]!;
    const dayRule = workScheduleVersion.dayRules.find(
      (rule) => rule.weekday === isoWeekday(workDate),
    );
    if (!dayRule) {
      throw this.attendanceException(
        'MISSING_WORK_SCHEDULE_VERSION',
        'The assigned Work Schedule Version has no Day Rule for the Work Date weekday.',
        {
          employeeId,
          workDate: workDateValue,
          workScheduleVersionId: workScheduleVersion.id,
          weekday: isoWeekday(workDate),
        },
      );
    }
    const holidayDate = formatDate(workDate);
    return {
      employeeId,
      workDate: holidayDate,
      assignment,
      workScheduleVersion,
      workArrangementVersion,
      holidayCalendarVersion,
      dayRule,
      holidayEntries: holidayCalendarVersion.entries.filter(
        (entry) => entry.holidayDate === holidayDate,
      ),
    };
  }

  /**
   * Count the working dates from `dateFromValue` through `dateToValue` under
   * the Employee's resolved schedule; see `isWorkingDate`. Returns
   * null when any date in the range cannot be resolved, so callers fail closed.
   */
  async workingDatesInTransaction(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    employeeId: string,
    dateFromValue: string,
    dateToValue: string,
  ): Promise<number | null> {
    let workingDates = 0;
    const dateTo = toDatabaseDate(dateToValue);
    for (
      let date = toDatabaseDate(dateFromValue);
      date.getTime() <= dateTo.getTime();
      date = addDays(date, 1)
    ) {
      let resolution: AttendanceResolution;
      try {
        resolution = await this.resolveForWorkDateInTransaction(
          transaction,
          agencyId,
          employeeId,
          formatDate(date),
        );
      } catch (error: unknown) {
        if (error instanceof AttendanceExceptionError) return null;
        throw error;
      }
      if (isWorkingDate(resolution)) workingDates += 1;
    }
    return workingDates;
  }

  private async assertApplicable(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    employeeId: string,
    effectiveFrom: Date,
  ): Promise<void> {
    const employee = await transaction.employee.findFirst({
      where: { agencyId, id: employeeId },
      select: { id: true, serviceStatus: true },
    });
    if (!employee) throw this.employeeNotFound();
    if (['PREBOARDING', 'SEPARATED', 'DECEASED'].includes(employee.serviceStatus)) {
      throw this.notApplicable();
    }
    const segment = await transaction.serviceSegment.findFirst({
      where: {
        agencyId,
        employeeId,
        status: 'ACTIVE',
        effectiveFrom: { lte: effectiveFrom },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }],
      },
      select: { id: true },
    });
    if (!segment) throw this.notApplicable();
  }

  private async assertNoOverlap(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    employeeId: string,
    effectiveFrom: Date,
    effectiveTo: Date | null,
  ): Promise<void> {
    const existing = await transaction.scheduleAssignment.findMany({
      where: { agencyId, employeeId },
      select: { id: true, effectiveFrom: true, effectiveTo: true },
    });
    const end = effectiveTo?.getTime() ?? Number.POSITIVE_INFINITY;
    const overlapping = existing.filter((assignment) => {
      const candidateEnd = assignment.effectiveTo?.getTime() ?? Number.POSITIVE_INFINITY;
      return assignment.effectiveFrom.getTime() <= end && effectiveFrom.getTime() <= candidateEnd;
    });
    if (overlapping.length > 0) throw this.periodOverlap();
  }

  private isOverlapViolation(error: unknown): boolean {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2004') return true;
      return (
        error.code === 'P2010' &&
        typeof error.meta?.message === 'string' &&
        error.meta.message.includes('schedule_assignments_effective_excl')
      );
    }
    return (
      error instanceof Prisma.PrismaClientUnknownRequestError &&
      error.message.includes('schedule_assignments_effective_excl')
    );
  }

  private async lockAssignment(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    assignmentId: string,
  ): Promise<void> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "schedule_assignments" WHERE "agency_id" = CAST(${agencyId} AS uuid) AND "id" = CAST(${assignmentId} AS uuid) FOR UPDATE`,
    );
    if (rows.length !== 1) throw this.notFound();
  }

  private assertPermission(context: RequestContext, permission: string, code: string): void {
    if (
      !context.agencyId ||
      !context.userId ||
      !context.membershipId ||
      !holdsAgencyWide(context, permission)
    ) {
      throw new AttendanceConfigurationServiceError(
        'The current Agency Membership lacks the required permission.',
        403,
        code,
      );
    }
  }

  private metadataString(value: Prisma.JsonValue, key: string): string | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const item = value[key];
    return typeof item === 'string' ? item : null;
  }

  private attendanceException(
    exceptionType: AttendanceExceptionType,
    message: string,
    details: Record<string, unknown>,
  ): AttendanceExceptionError {
    return new AttendanceExceptionError(exceptionType, message, details);
  }

  private employeeNotFound(): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      'The Employee could not be found in this Agency.',
      404,
      'SCHEDULE_ASSIGNMENT_EMPLOYEE_NOT_FOUND',
    );
  }

  private notApplicable(): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      'Schedule Assignments apply only to Appointed Personnel covered by Attendance Applicability.',
      409,
      'SCHEDULE_ASSIGNMENT_NOT_APPLICABLE',
    );
  }

  private scheduleVersionNotFound(): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      'The Work Schedule Version could not be found.',
      404,
      'SCHEDULE_ASSIGNMENT_SCHEDULE_VERSION_NOT_FOUND',
    );
  }

  private arrangementVersionNotFound(): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      'The Work Arrangement Version could not be found.',
      404,
      'SCHEDULE_ASSIGNMENT_ARRANGEMENT_VERSION_NOT_FOUND',
    );
  }

  private versionNotActive(label: string): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      `A Schedule Assignment may reference only an active ${label} Version.`,
      409,
      'SCHEDULE_ASSIGNMENT_VERSION_NOT_ACTIVE',
    );
  }

  private versionPeriodInvalid(label: string): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      `The ${label} Version is not effective on the requested Schedule Assignment start date.`,
      409,
      'SCHEDULE_ASSIGNMENT_VERSION_PERIOD_INVALID',
    );
  }

  private incompatibleVersions(): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      'The Work Arrangement Version does not permit the Work Schedule type.',
      409,
      'SCHEDULE_ASSIGNMENT_INCOMPATIBLE_VERSIONS',
    );
  }

  private evidenceRequired(): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      'A finalized assignment authority Document Version is required.',
      409,
      'SCHEDULE_ASSIGNMENT_EVIDENCE_REQUIRED',
    );
  }

  private periodOverlap(): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      'Schedule Assignments cannot overlap for the same Appointed Personnel.',
      409,
      'SCHEDULE_ASSIGNMENT_PERIOD_OVERLAP',
    );
  }

  private periodInvalid(): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      'The Schedule Assignment end date cannot precede its start date.',
      400,
      'SCHEDULE_ASSIGNMENT_PERIOD_INVALID',
    );
  }

  private prospectiveRequired(): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      'Ending a Schedule Assignment cannot rewrite a Work Date before today.',
      409,
      'SCHEDULE_ASSIGNMENT_PROSPECTIVE_REQUIRED',
    );
  }

  private endedConflict(): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      'The Schedule Assignment was already ended with a different date.',
      409,
      'SCHEDULE_ASSIGNMENT_ENDED_CONFLICT',
    );
  }

  private endReasonRequired(): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      'A reason for ending the Schedule Assignment is required.',
      400,
      'SCHEDULE_ASSIGNMENT_END_REASON_REQUIRED',
    );
  }

  private notFound(): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      'The Schedule Assignment could not be found.',
      404,
      'SCHEDULE_ASSIGNMENT_NOT_FOUND',
    );
  }

  private idempotencyConflict(): AttendanceConfigurationServiceError {
    return new AttendanceConfigurationServiceError(
      'The Idempotency-Key was already used for a different Schedule Assignment request.',
      409,
      'SCHEDULE_ASSIGNMENT_IDEMPOTENCY_CONFLICT',
    );
  }
}
