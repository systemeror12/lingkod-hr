import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hasPermission, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import { resolveAttendanceEmployeeScope } from '../attendance-scope';
import { formatDate } from '../attendance-configuration/attendance-configuration.types';
import { AttendanceDaysService } from '../attendance-days/attendance-days.service';
import { DocumentsService } from '../documents/documents.service';
import {
  ATTENDANCE_SUBMISSION_AUDIT_WRITER,
  type AttendanceSubmissionAuditWriter,
} from './attendance-submissions.audit';
import {
  AttendanceSubmissionServiceError,
  type AttendanceSubmissionDetail,
  type AttendanceSubmissionDaySummary,
  type AttendanceSubmissionListFilters,
  type AttendanceSubmissionState,
  type AttendanceSubmissionSummary,
  type CreateAttendanceSubmissionInput,
} from './attendance-submissions.types';

const MAX_LIST_LIMIT = 200;
const DEFAULT_LIST_LIMIT = 100;

const submissionSelect = {
  id: true,
  agencyId: true,
  attendancePeriodId: true,
  employeeId: true,
  versionNo: true,
  status: true,
  submittedByMembershipId: true,
  submittedAt: true,
  onBehalfReason: true,
  evidenceDocumentVersionId: true,
  reviewedByMembershipId: true,
  reviewedAt: true,
  reviewReason: true,
  createdAt: true,
  attendancePeriod: {
    select: { id: true, code: true, dateFrom: true, dateTo: true, status: true },
  },
  employee: { select: { id: true, employeeNumber: true, legalName: true } },
  days: {
    select: {
      attendanceDayId: true,
      attendanceDay: {
        select: {
          id: true,
          workDate: true,
          status: true,
          calculationVersion: true,
          isCurrent: true,
          exceptions: { where: { status: 'OPEN' }, select: { id: true } },
        },
      },
    },
  },
} as const;

type SubmissionRecord = Prisma.EmployeeAttendanceSubmissionGetPayload<{
  select: typeof submissionSelect;
}>;

function metadataString(metadata: Prisma.JsonValue, key: string): string | null {
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}

function submissionSummary(record: SubmissionRecord): AttendanceSubmissionSummary {
  return {
    id: record.id,
    agencyId: record.agencyId,
    period: {
      id: record.attendancePeriod.id,
      code: record.attendancePeriod.code,
      dateFrom: formatDate(record.attendancePeriod.dateFrom),
      dateTo: formatDate(record.attendancePeriod.dateTo),
      status: record.attendancePeriod.status as AttendanceSubmissionSummary['period']['status'],
    },
    employee: {
      id: record.employee.id,
      employeeNumber: record.employee.employeeNumber,
      legalName: record.employee.legalName,
    },
    versionNo: record.versionNo,
    status: record.status as AttendanceSubmissionState,
    submittedByMembershipId: record.submittedByMembershipId,
    submittedAt: record.submittedAt ? record.submittedAt.toISOString() : null,
    onBehalfReason: record.onBehalfReason,
    evidenceDocumentVersionId: record.evidenceDocumentVersionId,
    reviewedByMembershipId: record.reviewedByMembershipId,
    reviewedAt: record.reviewedAt ? record.reviewedAt.toISOString() : null,
    reviewReason: record.reviewReason,
    dayCount: record.days.length,
    createdAt: record.createdAt.toISOString(),
  };
}

function submissionDaySummary(
  record: SubmissionRecord['days'][number],
): AttendanceSubmissionDaySummary {
  return {
    attendanceDayId: record.attendanceDayId,
    workDate: formatDate(record.attendanceDay.workDate),
    status: record.attendanceDay.status as AttendanceSubmissionDaySummary['status'],
    calculationVersion: record.attendanceDay.calculationVersion,
    isCurrent: record.attendanceDay.isCurrent,
    openExceptionCount: record.attendanceDay.exceptions.length,
  };
}

function submissionDetail(record: SubmissionRecord): AttendanceSubmissionDetail {
  return {
    submission: submissionSummary(record),
    days: [...record.days]
      .sort((left, right) =>
        formatDate(left.attendanceDay.workDate).localeCompare(
          formatDate(right.attendanceDay.workDate),
        ),
      )
      .map(submissionDaySummary),
  };
}

/**
 * An Employee Attendance Submission binds one Employee's exact Attendance Day
 * versions for one Attendance Period. The Employee submits their own
 * attendance; an HR Administrator may submit on behalf only with a reason and
 * immutable evidence. Approval marks only the exact submitted versions
 * APPROVED, and a reviewer must differ from the submitter. Recalculation marks
 * a pending submission STALE so a successor version is required.
 */
@Injectable()
export class AttendanceSubmissionsService {
  constructor(
    @Inject(ATTENDANCE_SUBMISSION_AUDIT_WRITER)
    private readonly auditWriter: AttendanceSubmissionAuditWriter,
    @Inject(DocumentsService) private readonly documents: DocumentsService,
    @Inject(AttendanceDaysService) private readonly days: AttendanceDaysService,
  ) {}

  async create(
    context: RequestContext,
    input: CreateAttendanceSubmissionInput,
    idempotencyKey?: string,
  ): Promise<AttendanceSubmissionDetail> {
    const command = 'ATTENDANCE_SUBMISSION_CREATED';
    if (!hasPermission(context, 'attendance.submissions.create')) {
      throw this.forbidden('ATTENDANCE_SUBMISSION_CREATE_FORBIDDEN');
    }
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      if (idempotencyKey) {
        const completed = await this.completedCommand(transaction, context, {
          action: command,
          idempotencyKey,
          command,
        });
        if (completed) return this.findByIdInTransaction(transaction, context, completed);
      }
      const ownEmployeeId = await this.ownEmployeeId(transaction, context);
      const subjectEmployeeId = input.employeeId ?? ownEmployeeId;
      if (!subjectEmployeeId) {
        throw new AttendanceSubmissionServiceError(
          'The Agency Membership is not linked to an Employee record.',
          409,
          'ATTENDANCE_SUBMISSION_SUBJECT_REQUIRED',
        );
      }
      const onBehalf = input.employeeId !== undefined && input.employeeId !== ownEmployeeId;
      if (onBehalf) {
        this.assertAgencyPermission(context, 'attendance.submissions.create_on_behalf');
        if (!input.onBehalfReason || !input.evidenceDocumentVersionId) {
          throw new AttendanceSubmissionServiceError(
            'An on-behalf submission requires a reason and immutable evidence.',
            400,
            'ATTENDANCE_SUBMISSION_ON_BEHALF_FACT_REQUIRED',
          );
        }
        const evidence = await this.documents.resolveFinalizedVersionInTransaction(
          transaction,
          { agencyId: context.agencyId },
          input.evidenceDocumentVersionId,
        );
        if (!evidence) {
          throw new AttendanceSubmissionServiceError(
            'The on-behalf evidence Document Version could not be found in this Agency.',
            409,
            'ATTENDANCE_SUBMISSION_EVIDENCE_INVALID',
          );
        }
      } else if (input.onBehalfReason || input.evidenceDocumentVersionId) {
        throw new AttendanceSubmissionServiceError(
          'An on-behalf reason and evidence belong only to a submission for another Employee.',
          400,
          'ATTENDANCE_SUBMISSION_ON_BEHALF_FACT_INVALID',
        );
      }
      const employee = await transaction.employee.findFirst({
        where: { agencyId: context.agencyId, id: subjectEmployeeId },
        select: { id: true },
      });
      if (!employee) {
        throw new AttendanceSubmissionServiceError(
          'The covered Employee could not be found in this Agency.',
          404,
          'ATTENDANCE_SUBMISSION_EMPLOYEE_NOT_FOUND',
        );
      }
      const period = await transaction.attendancePeriod.findFirst({
        where: { agencyId: context.agencyId, id: input.attendancePeriodId },
        select: { id: true, status: true },
      });
      if (!period) {
        throw new AttendanceSubmissionServiceError(
          'The requested Attendance Period could not be found.',
          404,
          'ATTENDANCE_SUBMISSION_PERIOD_NOT_FOUND',
        );
      }
      if (period.status !== 'OPEN') {
        throw new AttendanceSubmissionServiceError(
          'The Attendance Period is finalized and cannot accept a new submission.',
          409,
          'ATTENDANCE_SUBMISSION_PERIOD_FINALIZED',
        );
      }
      const active = await transaction.employeeAttendanceSubmission.findFirst({
        where: {
          agencyId: context.agencyId,
          attendancePeriodId: period.id,
          employeeId: subjectEmployeeId,
          status: { in: ['DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED'] },
        },
        select: { id: true, status: true, versionNo: true },
      });
      if (active) {
        throw new AttendanceSubmissionServiceError(
          'A current Employee Attendance Submission already exists for this Attendance Period.',
          409,
          'ATTENDANCE_SUBMISSION_EXISTS',
          [`SUBMISSION:${active.id}`, `STATUS:${active.status}`],
        );
      }
      const currentDays = await transaction.attendanceDay.findMany({
        where: {
          agencyId: context.agencyId,
          attendancePeriodId: period.id,
          employeeId: subjectEmployeeId,
          isCurrent: true,
        },
        orderBy: [{ workDate: 'asc' }, { id: 'asc' }],
        select: { id: true },
      });
      if (currentDays.length === 0) {
        throw new AttendanceSubmissionServiceError(
          'No current Attendance Day versions exist for this Employee and Attendance Period.',
          409,
          'ATTENDANCE_SUBMISSION_NO_DAYS',
        );
      }
      const maxVersion = await transaction.employeeAttendanceSubmission.aggregate({
        where: {
          agencyId: context.agencyId,
          attendancePeriodId: period.id,
          employeeId: subjectEmployeeId,
        },
        _max: { versionNo: true },
      });
      const now = new Date();
      const created = await transaction.employeeAttendanceSubmission.create({
        data: {
          agencyId: context.agencyId,
          attendancePeriodId: period.id,
          employeeId: subjectEmployeeId,
          versionNo: (maxVersion._max.versionNo ?? 0) + 1,
          status: 'DRAFT',
          submittedByMembershipId: context.membershipId,
          onBehalfReason: onBehalf ? (input.onBehalfReason ?? null) : null,
          evidenceDocumentVersionId: onBehalf ? (input.evidenceDocumentVersionId ?? null) : null,
          createdAt: now,
        },
        select: { id: true },
      });
      await transaction.employeeAttendanceSubmissionDay.createMany({
        data: currentDays.map((day) => ({
          agencyId: context.agencyId,
          employeeAttendanceSubmissionId: created.id,
          attendanceDayId: day.id,
        })),
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: command,
        entityType: 'EmployeeAttendanceSubmission',
        entityId: created.id,
        newStatus: 'DRAFT',
        requestId: context.requestId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        metadata: {
          command,
          employeeId: subjectEmployeeId,
          attendancePeriodId: period.id,
          onBehalf,
          attendanceDayIds: currentDays.map((day) => day.id),
        },
      });
      return this.findByIdInTransaction(transaction, context, created.id);
    });
  }

  async submit(
    context: RequestContext,
    submissionId: string,
    idempotencyKey?: string,
  ): Promise<AttendanceSubmissionDetail> {
    const command = 'ATTENDANCE_SUBMISSION_SUBMITTED';
    if (!hasPermission(context, 'attendance.submissions.submit')) {
      throw this.forbidden('ATTENDANCE_SUBMISSION_SUBMIT_FORBIDDEN');
    }
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      if (idempotencyKey) {
        const completed = await this.completedCommand(transaction, context, {
          action: command,
          idempotencyKey,
          command,
        });
        if (completed) return this.findByIdInTransaction(transaction, context, completed);
      }
      await this.lockSubmission(transaction, context.agencyId, submissionId);
      const record = await this.requireSubmission(transaction, context, submissionId);
      if (record.status !== 'DRAFT' && record.status !== 'RETURNED') {
        throw this.invalidState(record.status, 'submit');
      }
      if (record.submittedByMembershipId !== context.membershipId) {
        this.assertAgencyPermission(context, 'attendance.submissions.submit');
      }
      const superseded = record.days.filter((day) => !day.attendanceDay.isCurrent);
      if (superseded.length > 0) {
        await this.markStale(transaction, context, record, superseded);
        throw this.stale();
      }
      const now = new Date();
      await transaction.employeeAttendanceSubmission.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: record.id } },
        data: {
          status: 'SUBMITTED',
          submittedAt: now,
          reviewedByMembershipId: null,
          reviewedAt: null,
          reviewReason: null,
        },
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: command,
        entityType: 'EmployeeAttendanceSubmission',
        entityId: record.id,
        previousStatus: record.status,
        newStatus: 'SUBMITTED',
        requestId: context.requestId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        metadata: {
          command,
          employeeId: record.employeeId,
          attendancePeriodId: record.attendancePeriodId,
          attendanceDayIds: record.days.map((day) => day.attendanceDayId),
        },
      });
      return this.findByIdInTransaction(transaction, context, record.id);
    });
  }

  async returnForReason(
    context: RequestContext,
    submissionId: string,
    input: { reason: string },
  ): Promise<AttendanceSubmissionDetail> {
    if (!hasPermission(context, 'attendance.submissions.return')) {
      throw this.forbidden('ATTENDANCE_SUBMISSION_RETURN_FORBIDDEN');
    }
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const record = await this.requireSubmission(transaction, context, submissionId);
      await this.assertEmployeeInScope(context, record.employeeId, 'attendance.submissions.return');
      if (record.status !== 'SUBMITTED') throw this.invalidState(record.status, 'return');
      const now = new Date();
      await transaction.employeeAttendanceSubmission.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: record.id } },
        data: {
          status: 'RETURNED',
          reviewedByMembershipId: context.membershipId,
          reviewedAt: now,
          reviewReason: input.reason,
        },
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'ATTENDANCE_SUBMISSION_RETURNED',
        entityType: 'EmployeeAttendanceSubmission',
        entityId: record.id,
        previousStatus: record.status,
        newStatus: 'RETURNED',
        reason: input.reason,
        requestId: context.requestId,
        metadata: { command: 'ATTENDANCE_SUBMISSION_RETURNED', employeeId: record.employeeId },
      });
      return this.findByIdInTransaction(transaction, context, record.id);
    });
  }

  async approve(
    context: RequestContext,
    submissionId: string,
    input: { reason?: string | undefined },
    idempotencyKey?: string,
  ): Promise<AttendanceSubmissionDetail> {
    const command = 'ATTENDANCE_SUBMISSION_APPROVED';
    if (!hasPermission(context, 'attendance.submissions.approve')) {
      throw this.forbidden('ATTENDANCE_SUBMISSION_APPROVE_FORBIDDEN');
    }
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      if (idempotencyKey) {
        const completed = await this.completedCommand(transaction, context, {
          action: command,
          idempotencyKey,
          command,
        });
        if (completed) return this.findByIdInTransaction(transaction, context, completed);
      }
      await this.lockSubmission(transaction, context.agencyId, submissionId);
      const record = await this.requireSubmission(transaction, context, submissionId);
      await this.assertEmployeeInScope(
        context,
        record.employeeId,
        'attendance.submissions.approve',
      );
      if (record.status !== 'SUBMITTED') throw this.invalidState(record.status, 'approve');
      if (record.submittedByMembershipId === context.membershipId) {
        throw new AttendanceSubmissionServiceError(
          'The submitter cannot approve the same Employee Attendance Submission.',
          403,
          'ATTENDANCE_SUBMISSION_SEPARATION_REQUIRED',
        );
      }
      const superseded = record.days.filter((day) => !day.attendanceDay.isCurrent);
      if (superseded.length > 0) {
        await this.markStale(transaction, context, record, superseded);
        throw this.stale();
      }
      const blocked = record.days.filter(
        (day) =>
          day.attendanceDay.status !== 'CALCULATED' || day.attendanceDay.exceptions.length > 0,
      );
      if (blocked.length > 0) {
        throw new AttendanceSubmissionServiceError(
          'Every bound Attendance Day version must be current and calculated with no unresolved exception.',
          409,
          'ATTENDANCE_SUBMISSION_NOT_APPROVABLE',
          blocked.flatMap((day) => [
            `DAY:${formatDate(day.attendanceDay.workDate)}:${day.attendanceDay.status}`,
            ...(day.attendanceDay.exceptions.length > 0
              ? [`DAY:${formatDate(day.attendanceDay.workDate)}:OPEN_EXCEPTIONS`]
              : []),
          ]),
        );
      }
      const dayIds = record.days.map((day) => day.attendanceDayId);
      const approvedCount = await this.days.approveSubmittedVersionsInTransaction(
        transaction,
        context,
        dayIds,
      );
      if (approvedCount !== dayIds.length) {
        throw new AttendanceSubmissionServiceError(
          'The bound Attendance Day versions changed while the submission was being approved.',
          409,
          'ATTENDANCE_SUBMISSION_STALE',
        );
      }
      const now = new Date();
      const reason = input.reason ?? 'Employee Attendance Submission approved.';
      await transaction.employeeAttendanceSubmission.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: record.id } },
        data: {
          status: 'APPROVED',
          reviewedByMembershipId: context.membershipId,
          reviewedAt: now,
          reviewReason: reason,
        },
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: command,
        entityType: 'EmployeeAttendanceSubmission',
        entityId: record.id,
        previousStatus: record.status,
        newStatus: 'APPROVED',
        reason,
        requestId: context.requestId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        metadata: {
          command,
          employeeId: record.employeeId,
          attendancePeriodId: record.attendancePeriodId,
          approvedAttendanceDayIds: dayIds,
        },
      });
      return this.findByIdInTransaction(transaction, context, record.id);
    });
  }

  async cancel(
    context: RequestContext,
    submissionId: string,
    input: { reason?: string | undefined },
  ): Promise<AttendanceSubmissionDetail> {
    if (!hasPermission(context, 'attendance.submissions.cancel')) {
      throw this.forbidden('ATTENDANCE_SUBMISSION_CANCEL_FORBIDDEN');
    }
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      await this.lockSubmission(transaction, context.agencyId, submissionId);
      const record = await this.requireSubmission(transaction, context, submissionId);
      if (record.status !== 'DRAFT' && record.status !== 'SUBMITTED') {
        throw this.invalidState(record.status, 'cancel');
      }
      if (record.submittedByMembershipId !== context.membershipId) {
        this.assertAgencyPermission(context, 'attendance.submissions.cancel');
      }
      await transaction.employeeAttendanceSubmission.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: record.id } },
        data: { status: 'CANCELLED' },
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'ATTENDANCE_SUBMISSION_CANCELLED',
        entityType: 'EmployeeAttendanceSubmission',
        entityId: record.id,
        previousStatus: record.status,
        newStatus: 'CANCELLED',
        reason: input.reason ?? null,
        requestId: context.requestId,
        metadata: { command: 'ATTENDANCE_SUBMISSION_CANCELLED', employeeId: record.employeeId },
      });
      return this.findByIdInTransaction(transaction, context, record.id);
    });
  }

  async list(
    context: RequestContext,
    filters: AttendanceSubmissionListFilters = {},
  ): Promise<AttendanceSubmissionSummary[]> {
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
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const records = await transaction.employeeAttendanceSubmission.findMany({
        where: {
          agencyId: context.agencyId,
          ...(filters.attendancePeriodId ? { attendancePeriodId: filters.attendancePeriodId } : {}),
          ...employeeFilter,
          ...(filters.status ? { status: filters.status } : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: limit,
        select: submissionSelect,
      });
      return records.map(submissionSummary);
    });
  }

  async findById(
    context: RequestContext,
    submissionId: string,
  ): Promise<AttendanceSubmissionDetail> {
    const scope = await this.readScope(context);
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const record = await this.requireSubmission(transaction, context, submissionId);
      if (scope.kind === 'SCOPED' && !scope.employeeIds.includes(record.employeeId)) {
        throw this.notFound();
      }
      return submissionDetail(record);
    });
  }

  private async readScope(context: RequestContext) {
    const scope = await resolveAttendanceEmployeeScope(context, 'attendance.days.read');
    if (!scope) {
      throw new AttendanceSubmissionServiceError(
        'The attendance.days.read permission is required.',
        403,
        'ATTENDANCE_SUBMISSION_READ_FORBIDDEN',
      );
    }
    return scope;
  }

  private async findByIdInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    submissionId: string,
  ): Promise<AttendanceSubmissionDetail> {
    const record = await this.requireSubmission(transaction, context, submissionId);
    return submissionDetail(record);
  }

  private async requireSubmission(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    submissionId: string,
  ): Promise<SubmissionRecord> {
    const record = await transaction.employeeAttendanceSubmission.findFirst({
      where: { agencyId: context.agencyId, id: submissionId },
      select: submissionSelect,
    });
    if (!record) throw this.notFound();
    return record;
  }

  private async ownEmployeeId(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
  ): Promise<string | null> {
    const membership = await transaction.agencyMembership.findFirst({
      where: { agencyId: context.agencyId, id: context.membershipId },
      select: { employeeId: true },
    });
    return membership?.employeeId ?? null;
  }

  private async assertEmployeeInScope(
    context: RequestContext,
    employeeId: string,
    permissionCode: string,
  ): Promise<void> {
    const scope = await resolveAttendanceEmployeeScope(context, permissionCode);
    if (!scope) {
      throw new AttendanceSubmissionServiceError(
        `The ${permissionCode} permission is required.`,
        403,
        'ATTENDANCE_SUBMISSION_DECIDE_FORBIDDEN',
      );
    }
    if (scope.kind === 'SCOPED' && !scope.employeeIds.includes(employeeId)) {
      throw this.notFound();
    }
  }

  private async markStale(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    record: SubmissionRecord,
    superseded: readonly SubmissionRecord['days'][number][],
  ): Promise<void> {
    await transaction.employeeAttendanceSubmission.update({
      where: { agencyId_id: { agencyId: context.agencyId, id: record.id } },
      data: { status: 'STALE' },
    });
    await this.auditWriter.write(transaction, {
      agencyId: context.agencyId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      actorType: 'SYSTEM',
      action: 'ATTENDANCE_SUBMISSION_STALE',
      entityType: 'EmployeeAttendanceSubmission',
      entityId: record.id,
      previousStatus: record.status,
      newStatus: 'STALE',
      requestId: context.requestId,
      metadata: {
        command: 'ATTENDANCE_SUBMISSION_STALE',
        employeeId: record.employeeId,
        supersededAttendanceDayIds: superseded.map((day) => day.attendanceDayId),
      },
    });
  }

  private async lockSubmission(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    submissionId: string,
  ): Promise<void> {
    await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "employee_attendance_submissions" WHERE "agency_id" = CAST(${agencyId} AS uuid) AND "id" = CAST(${submissionId} AS uuid) FOR UPDATE`,
    );
  }

  private async completedCommand(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    input: { action: string; idempotencyKey: string; command: string },
  ): Promise<string | null> {
    const completed = await transaction.auditEvent.findFirst({
      where: {
        agencyId: context.agencyId,
        action: input.action,
        idempotencyKey: input.idempotencyKey,
      },
      select: { entityId: true, metadata: true },
    });
    if (!completed) return null;
    if (metadataString(completed.metadata, 'command') !== input.command) {
      throw new AttendanceSubmissionServiceError(
        'The Idempotency-Key was already used for a different Employee Attendance Submission command.',
        409,
        'ATTENDANCE_SUBMISSION_IDEMPOTENCY_CONFLICT',
      );
    }
    return completed.entityId;
  }

  private assertAgencyPermission(context: RequestContext, permissionCode: string): void {
    const granted = context.permissions.some(
      (grant) => grant.code === permissionCode && grant.scopePolicy === 'AGENCY',
    );
    if (!granted) {
      throw new AttendanceSubmissionServiceError(
        `The ${permissionCode} permission with Agency scope is required.`,
        403,
        'ATTENDANCE_SUBMISSION_SCOPE_FORBIDDEN',
      );
    }
  }

  private forbidden(code: string): AttendanceSubmissionServiceError {
    return new AttendanceSubmissionServiceError('The required permission is missing.', 403, code);
  }

  private notFound(): AttendanceSubmissionServiceError {
    return new AttendanceSubmissionServiceError(
      'The requested Employee Attendance Submission could not be found.',
      404,
      'ATTENDANCE_SUBMISSION_NOT_FOUND',
    );
  }

  private invalidState(status: string, action: string): AttendanceSubmissionServiceError {
    return new AttendanceSubmissionServiceError(
      `An Employee Attendance Submission in ${status} cannot ${action}.`,
      409,
      'ATTENDANCE_SUBMISSION_STATE_INVALID',
      [`STATUS:${status}`],
    );
  }

  private stale(): AttendanceSubmissionServiceError {
    return new AttendanceSubmissionServiceError(
      'A bound Attendance Day version was recalculated. The submission is stale and must be resubmitted.',
      409,
      'ATTENDANCE_SUBMISSION_STALE',
    );
  }
}
