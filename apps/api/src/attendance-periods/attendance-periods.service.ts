import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { holdsAgencyWide, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import { resolveEmployeeScope, type EmployeeScope } from '../employee-scope';
import {
  formatDate,
  toDatabaseDate,
} from '../attendance-configuration/attendance-configuration.types';
import { AttendanceDaysService } from '../attendance-days/attendance-days.service';
import type { AttendancePeriodState } from '../attendance-days/attendance-days.types';
import { ApprovalsService } from '../approvals/approval.service';
import { DtrsService } from '../dtrs/dtrs.service';
import { DtrServiceError } from '../dtrs/dtrs.types';
import {
  ATTENDANCE_PERIOD_AUDIT_WRITER,
  type AttendancePeriodAuditWriter,
} from './attendance-periods.audit';
import {
  buildAttendancePayrollAdjustmentLines,
  deriveAttendancePayrollFactLines,
  summarizeAttendancePayrollFactMinutes,
  type AttendancePayrollFactLine,
  type PayrollFactSourceDay,
} from './attendance-periods.payroll';
import {
  ATTENDANCE_PERIOD_LOCK_ROUTE_CODE,
  ATTENDANCE_PERIOD_RECONCILIATION_SOURCE,
  AttendancePeriodServiceError,
  type AttendancePayrollFactSummary,
  type AttendancePayrollFactType,
  type AttendancePayrollPublicationDetail,
  type AttendancePayrollPublicationSummary,
  type AttendancePayrollPublicationType,
  type AttendancePeriodListFilters,
  type AttendancePeriodLockResult,
  type AttendancePeriodReconciliation,
  type AttendancePeriodReconciliationFailure,
  type AttendancePeriodVersionDetail,
  type AttendancePeriodVersionState,
  type AttendancePeriodVersionSummary,
} from './attendance-periods.types';

const MAX_LIST_LIMIT = 200;
const DEFAULT_LIST_LIMIT = 100;

const versionSelect = {
  id: true,
  agencyId: true,
  attendancePeriodId: true,
  versionNo: true,
  predecessorVersionId: true,
  status: true,
  approvalRouteVersionId: true,
  submittedByMembershipId: true,
  submittedAt: true,
  reviewedByMembershipId: true,
  reviewedAt: true,
  reviewReason: true,
  lockedByMembershipId: true,
  lockedAt: true,
  reconciliation: true,
  attendancePeriod: {
    select: { id: true, code: true, dateFrom: true, dateTo: true, status: true },
  },
  _count: {
    select: {
      dtrDocuments: true,
      days: { where: { attendanceDay: { isCurrent: false } } },
    },
  },
  payrollPublications: {
    select: {
      id: true,
      publicationType: true,
      predecessorPublicationId: true,
      idempotencyKey: true,
      publishedAt: true,
      _count: { select: { facts: true } },
    },
  },
} as const;

type VersionRecord = Prisma.AttendancePeriodVersionGetPayload<{ select: typeof versionSelect }>;

const daySelect = {
  id: true,
  employeeId: true,
  workDate: true,
  status: true,
  isCurrent: true,
  expectedMinutes: true,
  workedMinutes: true,
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
} as const;

type DayRecord = Prisma.AttendanceDayGetPayload<{ select: typeof daySelect }>;

const segmentSelect = {
  attendanceDayId: true,
  dutyRelation: true,
  coverageType: true,
  deficitType: true,
  holidayClassification: true,
  startsAt: true,
  endsAt: true,
} as const;

const membershipSelect = {
  employeeAttendanceSubmissionId: true,
  attendanceDayId: true,
  submission: { select: { id: true, employeeId: true, status: true } },
  attendanceDay: {
    select: {
      ...daySelect,
      employee: { select: { employeeNumber: true, legalName: true } },
      segments: {
        orderBy: { sequenceNo: 'asc' },
        select: segmentSelect,
      },
    },
  },
} as const;

type MembershipRecord = Prisma.AttendancePeriodVersionDayGetPayload<{
  select: typeof membershipSelect;
}>;

const DAY_COVERAGE_COLUMNS: Readonly<Record<string, keyof DayRecord>> = {
  WORKED: 'workedMinutes',
  OFFICIAL_BUSINESS: 'officialBusinessMinutes',
  OFFICIAL_TRAVEL: 'officialTravelMinutes',
  TRAINING: 'trainingMinutes',
  APPROVED_ABSENCE: 'approvedAbsenceMinutes',
  POSTED_LEAVE: 'postedLeaveMinutes',
  CTO: 'ctoMinutes',
  TARDINESS: 'lateMinutes',
  UNDERTIME: 'undertimeMinutes',
  ABSENCE: 'absenceMinutes',
};

interface PopulationSources {
  currentDays: DayRecord[];
  applicableEmployeeIds: string[];
  openExceptions: Array<{ id: string; attendanceDayId: string }>;
  approvedSubmissions: Array<{
    id: string;
    employeeId: string;
    days: Array<{
      attendanceDayId: string;
      attendanceDay: { isCurrent: boolean; status: string; workDate: Date };
    }>;
  }>;
  unresolvedCorrections: Array<{ id: string; status: string; employeeId: string }>;
}

/**
 * Attendance Period review, lock, and payroll publication. An Attendance
 * Period stays the stable OPEN or FINALIZED interval; every review snapshot is
 * an immutable Attendance Period Version. Lock is one idempotent transaction
 * that validates Attendance Period Reconciliation, finalizes the stable
 * period when first locked, materializes Finalized Daily Time Records, and
 * publishes exactly one Attendance Payroll Publication before any audit or
 * outbox record is appended.
 */
@Injectable()
export class AttendancePeriodsService {
  constructor(
    @Inject(ATTENDANCE_PERIOD_AUDIT_WRITER)
    private readonly auditWriter: AttendancePeriodAuditWriter,
    @Inject(ApprovalsService) private readonly approvals: ApprovalsService,
    @Inject(DtrsService) private readonly dtrs: DtrsService,
    @Inject(AttendanceDaysService) private readonly days: AttendanceDaysService,
  ) {}

  async list(
    context: RequestContext,
    filters: AttendancePeriodListFilters = {},
  ): Promise<AttendancePeriodVersionSummary[]> {
    const limit = Math.min(Math.max(filters.limit ?? DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT);
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const scope = await this.readScope(transaction, context);
      const records = await transaction.attendancePeriodVersion.findMany({
        where: {
          agencyId: context.agencyId,
          ...(filters.attendancePeriodId ? { attendancePeriodId: filters.attendancePeriodId } : {}),
          ...(filters.status ? { status: filters.status } : {}),
        },
        orderBy: [{ versionNo: 'desc' }, { id: 'asc' }],
        take: limit,
        select: versionSelect,
      });
      const visible =
        scope.kind === 'SCOPED'
          ? await this.filterVersionsInScope(
              transaction,
              context.agencyId,
              records,
              scope.employeeIds,
            )
          : records;
      const counts = await this.membershipCounts(
        transaction,
        context.agencyId,
        visible.map((record) => record.id),
      );
      const minutes = await this.publicationMinutes(
        transaction,
        context.agencyId,
        visible.map((record) => record.id),
      );
      return visible.map((record) =>
        versionSummary(record, counts.get(record.id) ?? emptyCounts(), minutes.get(record.id) ?? 0),
      );
    });
  }

  async findById(
    context: RequestContext,
    versionId: string,
  ): Promise<AttendancePeriodVersionDetail> {
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const scope = await this.readScope(transaction, context);
      const record = await this.requireVersion(transaction, context, versionId);
      await this.assertVersionInScope(transaction, context.agencyId, record.id, scope);
      const counts = await this.membershipCounts(transaction, context.agencyId, [record.id]);
      const minutes = await this.publicationMinutes(transaction, context.agencyId, [record.id]);
      return {
        version: versionSummary(
          record,
          counts.get(record.id) ?? emptyCounts(),
          minutes.get(record.id) ?? 0,
        ),
        reconciliation: parseReconciliation(record.reconciliation),
      };
    });
  }

  async submitForReview(
    context: RequestContext,
    attendancePeriodId: string,
    idempotencyKey?: string,
  ): Promise<AttendancePeriodVersionDetail> {
    this.assertAgencyPermission(
      context,
      'attendance.periods.submit',
      'ATTENDANCE_PERIOD_SUBMIT_FORBIDDEN',
    );
    const command = 'ATTENDANCE_PERIOD_VERSION_SUBMITTED';
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      if (idempotencyKey) {
        const completed = await this.completedCommand(transaction, context, {
          action: command,
          idempotencyKey,
          command,
        });
        if (completed) return this.detailInTransaction(transaction, context, completed);
      }
      await this.lockAttendancePeriodsInTransaction(transaction, context.agencyId, [
        attendancePeriodId,
      ]);
      const period = await transaction.attendancePeriod.findFirst({
        where: { agencyId: context.agencyId, id: attendancePeriodId },
        select: { id: true, code: true, dateFrom: true, dateTo: true, status: true },
      });
      if (!period) throw this.periodNotFound();
      if (period.status !== 'OPEN') {
        throw new AttendancePeriodServiceError(
          'The Attendance Period is finalized and cannot open another review snapshot.',
          409,
          'ATTENDANCE_PERIOD_FINALIZED',
        );
      }
      // An APPROVED version whose bound Attendance Day was since recalculated
      // can never lock, so it no longer blocks a new snapshot.
      const pending = await transaction.attendancePeriodVersion.findFirst({
        where: {
          agencyId: context.agencyId,
          attendancePeriodId: period.id,
          OR: [
            { status: 'FOR_REVIEW' },
            { status: 'APPROVED', days: { none: { attendanceDay: { isCurrent: false } } } },
          ],
        },
        select: { id: true, status: true },
      });
      if (pending) {
        throw new AttendancePeriodServiceError(
          'An Attendance Period Version is already under review or approved.',
          409,
          'ATTENDANCE_PERIOD_VERSION_PENDING',
          [`VERSION:${pending.id}`, `STATUS:${pending.status}`],
        );
      }
      const route = await this.requireActiveRoute(
        transaction,
        context,
        formatDate(period.dateFrom),
      );
      const population = await this.loadPopulation(transaction, context.agencyId, period.id);
      const completion = this.completePopulation(population);
      const reasons = [
        ...completion.reasons,
        ...population.openExceptions.map((row) => `EXCEPTION_${row.id}_OPEN`),
        ...population.unresolvedCorrections.map((row) => `CORRECTION_${row.id}_${row.status}`),
      ];
      if (reasons.length > 0) {
        throw new AttendancePeriodServiceError(
          'The applicable population is not complete or its approved sources are unresolved.',
          409,
          'ATTENDANCE_PERIOD_SOURCES_INCOMPLETE',
          reasons,
        );
      }
      const maxVersion = await transaction.attendancePeriodVersion.aggregate({
        where: { agencyId: context.agencyId, attendancePeriodId: period.id },
        _max: { versionNo: true },
      });
      const now = new Date();
      const created = await transaction.attendancePeriodVersion.create({
        data: {
          agencyId: context.agencyId,
          attendancePeriodId: period.id,
          versionNo: (maxVersion._max.versionNo ?? 0) + 1,
          status: 'FOR_REVIEW',
          approvalRouteVersionId: route.id,
          submittedByMembershipId: context.membershipId,
          submittedAt: now,
        },
        select: { id: true },
      });
      await transaction.attendancePeriodVersionDay.createMany({
        data: completion.memberships.map((row) => ({
          agencyId: context.agencyId,
          attendancePeriodVersionId: created.id,
          employeeAttendanceSubmissionId: row.submissionId,
          attendanceDayId: row.attendanceDayId,
        })),
      });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: command,
        entityType: 'AttendancePeriodVersion',
        entityId: created.id,
        previousStatus: null,
        newStatus: 'FOR_REVIEW',
        requestId: context.requestId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        metadata: {
          command: 'ATTENDANCE_PERIOD_VERSION_SUBMITTED',
          attendancePeriodId: period.id,
          versionNo: (maxVersion._max.versionNo ?? 0) + 1,
          approvalRouteVersionId: route.id,
          employeeCount: completion.employees.length,
          workDateCount: completion.workDates.length,
          attendanceDayIds: completion.memberships.map((row) => row.attendanceDayId),
        },
      });
      return this.detailInTransaction(transaction, context, created.id);
    });
  }

  async returnForReason(
    context: RequestContext,
    versionId: string,
    input: { reason: string },
    idempotencyKey?: string,
  ): Promise<AttendancePeriodVersionDetail> {
    const command = 'ATTENDANCE_PERIOD_VERSION_RETURNED';
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const scope = await this.decideScope(transaction, context, 'attendance.periods.return');
      if (idempotencyKey) {
        const completed = await this.completedCommand(transaction, context, {
          action: command,
          idempotencyKey,
          command,
        });
        if (completed) return this.detailInTransaction(transaction, context, completed);
      }
      const record = await this.requireVersion(transaction, context, versionId);
      await this.assertVersionInScope(transaction, context.agencyId, record.id, scope);
      if (record.status !== 'FOR_REVIEW') {
        throw this.invalidState(record.status, 'return');
      }
      const now = new Date();
      const updated = await transaction.attendancePeriodVersion.updateMany({
        where: {
          agencyId: context.agencyId,
          id: record.id,
          status: 'FOR_REVIEW',
        },
        data: {
          status: 'RETURNED',
          reviewedByMembershipId: context.membershipId,
          reviewedAt: now,
          reviewReason: input.reason,
        },
      });
      if (updated.count !== 1) throw this.invalidState(record.status, 'return');
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: command,
        entityType: 'AttendancePeriodVersion',
        entityId: record.id,
        previousStatus: 'FOR_REVIEW',
        newStatus: 'RETURNED',
        reason: input.reason,
        requestId: context.requestId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        metadata: {
          command: 'ATTENDANCE_PERIOD_VERSION_RETURNED',
          attendancePeriodId: record.attendancePeriodId,
        },
      });
      return this.detailInTransaction(transaction, context, record.id);
    });
  }

  async approve(
    context: RequestContext,
    versionId: string,
    input: { reason?: string | undefined },
    idempotencyKey?: string,
  ): Promise<AttendancePeriodVersionDetail> {
    const command = 'ATTENDANCE_PERIOD_VERSION_APPROVED';
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const scope = await this.decideScope(transaction, context, 'attendance.periods.approve');
      if (idempotencyKey) {
        const completed = await this.completedCommand(transaction, context, {
          action: command,
          idempotencyKey,
          command,
        });
        if (completed) return this.detailInTransaction(transaction, context, completed);
      }
      const record = await this.requireVersion(transaction, context, versionId);
      await this.assertVersionInScope(transaction, context.agencyId, record.id, scope);
      if (record.status !== 'FOR_REVIEW') {
        throw this.invalidState(record.status, 'approve');
      }
      await this.lockAttendancePeriodsInTransaction(transaction, context.agencyId, [
        record.attendancePeriodId,
      ]);
      const reconciliation = await this.reconcileInTransaction(transaction, context, record);
      if (!reconciliation.ok) {
        throw new AttendancePeriodServiceError(
          'The Attendance Period Version changed and cannot be approved.',
          409,
          'ATTENDANCE_PERIOD_RECONCILIATION_FAILED',
          reconciliation.failures.map((failure) => failure.code),
        );
      }
      const now = new Date();
      const reason = input.reason ?? 'Attendance Period Version approved.';
      const updated = await transaction.attendancePeriodVersion.updateMany({
        where: { agencyId: context.agencyId, id: record.id, status: 'FOR_REVIEW' },
        data: {
          status: 'APPROVED',
          reviewedByMembershipId: context.membershipId,
          reviewedAt: now,
          reviewReason: reason,
        },
      });
      if (updated.count !== 1) throw this.invalidState(record.status, 'approve');
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: command,
        entityType: 'AttendancePeriodVersion',
        entityId: record.id,
        previousStatus: 'FOR_REVIEW',
        newStatus: 'APPROVED',
        reason,
        requestId: context.requestId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        metadata: {
          command: 'ATTENDANCE_PERIOD_VERSION_APPROVED',
          attendancePeriodId: record.attendancePeriodId,
          approvalRouteVersionId: record.approvalRouteVersionId,
        },
      });
      return this.detailInTransaction(transaction, context, record.id);
    });
  }

  async reconcile(
    context: RequestContext,
    versionId: string,
  ): Promise<AttendancePeriodReconciliation> {
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const scope = await this.readScope(transaction, context);
      const record = await this.requireVersion(transaction, context, versionId);
      await this.assertVersionInScope(transaction, context.agencyId, record.id, scope);
      return this.reconcileInTransaction(transaction, context, record);
    });
  }

  /**
   * Lock one approved Attendance Period Version. The transaction records the
   * lock, finalizes the stable period when it is first locked, materializes
   * the Finalized Daily Time Records, and creates exactly one Attendance
   * Payroll Publication. A replay of an already locked version reports the
   * retained artifacts instead of duplicating an economic effect.
   */
  async lock(context: RequestContext, versionId: string): Promise<AttendancePeriodLockResult> {
    this.assertAgencyPermission(
      context,
      'attendance.periods.lock',
      'ATTENDANCE_PERIOD_LOCK_FORBIDDEN',
    );
    return withDatabaseContext(
      requestDatabaseContext(context, 'attendance-transition'),
      async (transaction) => {
        const located = await transaction.attendancePeriodVersion.findFirst({
          where: { agencyId: context.agencyId, id: versionId },
          select: { attendancePeriodId: true },
        });
        if (!located) throw this.versionNotFound();
        await this.lockAttendancePeriodsInTransaction(transaction, context.agencyId, [
          located.attendancePeriodId,
        ]);
        const record = await this.requireVersion(transaction, context, versionId);
        if (record.status === 'LOCKED') {
          return this.replayLockInTransaction(transaction, context, record);
        }
        if (record.status !== 'APPROVED') {
          throw this.invalidState(record.status, 'lock');
        }
        if (record.reviewedByMembershipId === null) {
          throw new AttendancePeriodServiceError(
            'The Attendance Period Version has no reviewer to separate from the locker.',
            409,
            'ATTENDANCE_PERIOD_REVIEW_REQUIRED',
          );
        }
        if (record.reviewedByMembershipId === context.membershipId) {
          throw new AttendancePeriodServiceError(
            'The reviewer of an Attendance Period Version cannot lock the same version.',
            403,
            'ATTENDANCE_PERIOD_LOCK_SEPARATION_REQUIRED',
          );
        }
        const reconciliation = await this.reconcileInTransaction(transaction, context, record);
        if (!reconciliation.ok) {
          throw new AttendancePeriodServiceError(
            'Attendance Period Reconciliation failed and the version stays APPROVED.',
            409,
            'ATTENDANCE_PERIOD_RECONCILIATION_FAILED',
            reconciliation.failures.map((failure) => failure.code),
          );
        }
        const now = new Date();
        const updated = await transaction.attendancePeriodVersion.updateMany({
          where: { agencyId: context.agencyId, id: record.id, status: 'APPROVED' },
          data: {
            status: 'LOCKED',
            lockedByMembershipId: context.membershipId,
            lockedAt: now,
            reconciliation: reconciliation as unknown as Prisma.InputJsonValue,
          },
        });
        if (updated.count !== 1) throw this.invalidState(record.status, 'lock');
        await transaction.attendancePeriod.updateMany({
          where: { agencyId: context.agencyId, id: record.attendancePeriodId, status: 'OPEN' },
          data: { status: 'FINALIZED' },
        });
        const dtr = await this.materializeDtrsInTransaction(transaction, context, record.id);
        const publication = await this.materializePublicationInTransaction(
          transaction,
          context,
          record.id,
          now,
        );
        await this.auditWriter.write(transaction, {
          agencyId: context.agencyId,
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          actorType: 'USER',
          action: 'ATTENDANCE_PERIOD_LOCKED',
          entityType: 'AttendancePeriodVersion',
          entityId: record.id,
          previousStatus: 'APPROVED',
          newStatus: 'LOCKED',
          requestId: context.requestId,
          metadata: {
            command: 'ATTENDANCE_PERIOD_LOCKED',
            attendancePeriodId: record.attendancePeriodId,
            versionNo: record.versionNo,
            reviewedByMembershipId: record.reviewedByMembershipId,
            reconciliationOk: reconciliation.ok,
            payrollPublicationId: publication.publication.id,
            payrollFactCount: publication.publication.factCount,
            payrollFactMinutes: publication.publication.factMinutes,
            dtrDocumentIds: dtr.dtrDocumentIds,
            existingDtrDocumentIds: dtr.existingDtrDocumentIds,
          },
        });
        await transaction.outboxEvent.create({
          data: {
            agencyId: context.agencyId,
            eventType: 'ATTENDANCE_PERIOD_LOCKED',
            aggregateType: 'AttendancePeriodVersion',
            aggregateId: record.id,
            idempotencyKey: `attendance-period-lock:${record.id}`,
            payload: {
              attendancePeriodId: record.attendancePeriodId,
              versionNo: record.versionNo,
              reconciliation,
              payrollPublicationId: publication.publication.id,
              dtrDocumentIds: dtr.dtrDocumentIds,
            } as unknown as Prisma.InputJsonValue,
          },
        });
        const detail = await this.detailInTransaction(transaction, context, record.id);
        return {
          version: detail.version,
          dtrDocumentIds: dtr.dtrDocumentIds,
          existingDtrDocumentIds: dtr.existingDtrDocumentIds,
          publication: publication.publication,
          replay: false,
        };
      },
    );
  }

  async findPublication(
    context: RequestContext,
    versionId: string,
  ): Promise<AttendancePayrollPublicationDetail> {
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const scope = await this.publicationScope(transaction, context);
      const record = await this.requireVersion(transaction, context, versionId);
      await this.assertVersionInScope(transaction, context.agencyId, record.id, scope);
      const publication = await transaction.attendancePayrollPublication.findFirst({
        where: { agencyId: context.agencyId, attendancePeriodVersionId: record.id },
        select: { id: true },
      });
      if (!publication) throw this.publicationNotFound();
      return this.publicationDetail(transaction, context.agencyId, publication.id);
    });
  }

  /**
   * Internal contract: a locked Attendance Period Version owns exactly one
   * publication. The Attendance Period lock and the Locked Attendance
   * Adjustment create it in the same transaction as the DTRs, so a retry or a
   * correction successor cannot duplicate an economic effect.
   */
  async materializePublicationForLockedVersionInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    versionId: string,
  ): Promise<AttendancePayrollPublicationDetail> {
    const now = new Date();
    await this.materializePublicationInTransaction(transaction, context, versionId, now);
    const publication = await transaction.attendancePayrollPublication.findFirstOrThrow({
      where: { agencyId: context.agencyId, attendancePeriodVersionId: versionId },
      select: { id: true },
    });
    return this.publicationDetail(transaction, context.agencyId, publication.id);
  }

  /** Internal contract: serialize a correction against a concurrent period lock. */
  async lockAttendancePeriodsInTransaction(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    attendancePeriodIds: readonly string[],
  ): Promise<void> {
    const ids = [...new Set(attendancePeriodIds)].sort();
    if (ids.length === 0) return;
    await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "attendance_periods"
        WHERE "agency_id" = CAST(${agencyId} AS uuid)
          AND "id" IN (${Prisma.join(ids.map((id) => Prisma.sql`CAST(${id} AS uuid)`))})
        ORDER BY "id"
        FOR UPDATE`,
    );
  }

  private async replayLockInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    record: VersionRecord,
  ): Promise<AttendancePeriodLockResult> {
    const publication = await transaction.attendancePayrollPublication.findFirst({
      where: { agencyId: context.agencyId, attendancePeriodVersionId: record.id },
      select: { id: true },
    });
    if (!publication) {
      throw new AttendancePeriodServiceError(
        'The locked Attendance Period Version holds no Attendance Payroll Publication.',
        409,
        'ATTENDANCE_PERIOD_LOCK_INCOMPLETE',
      );
    }
    const memberships = await this.loadMembershipDays(transaction, context.agencyId, record.id);
    const coveredEmployeeIds = [...new Set(memberships.map((row) => row.attendanceDay.employeeId))];
    const dtrDocuments = await transaction.dtrDocument.findMany({
      where: { agencyId: context.agencyId, attendancePeriodVersionId: record.id },
      orderBy: { id: 'asc' },
      select: { id: true, employeeId: true },
    });
    const missingEmployeeIds = coveredEmployeeIds.filter(
      (employeeId) => !dtrDocuments.some((document) => document.employeeId === employeeId),
    );
    if (missingEmployeeIds.length > 0) {
      throw new AttendancePeriodServiceError(
        'A covered Employee of the locked Attendance Period Version holds no Finalized Daily Time Record.',
        409,
        'ATTENDANCE_PERIOD_LOCK_INCOMPLETE',
        missingEmployeeIds.map((employeeId) => `EMPLOYEE:${employeeId}`),
      );
    }
    const detail = await this.detailInTransaction(transaction, context, record.id);
    return {
      version: detail.version,
      dtrDocumentIds: [],
      existingDtrDocumentIds: dtrDocuments.map((document) => document.id),
      publication: detail.version.publication!,
      replay: true,
    };
  }

  private async materializePublicationInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    versionId: string,
    now: Date,
  ): Promise<{ publication: AttendancePayrollPublicationSummary }> {
    const version = await transaction.attendancePeriodVersion.findFirst({
      where: { agencyId: context.agencyId, id: versionId },
      select: {
        id: true,
        attendancePeriodId: true,
        predecessorVersionId: true,
        status: true,
      },
    });
    if (!version) throw this.versionNotFound();
    if (version.status !== 'LOCKED') {
      throw new AttendancePeriodServiceError(
        'Only a locked Attendance Period Version publishes payroll inputs.',
        409,
        'ATTENDANCE_PERIOD_NOT_LOCKED',
      );
    }
    const existing = await transaction.attendancePayrollPublication.findFirst({
      where: { agencyId: context.agencyId, attendancePeriodVersionId: version.id },
      select: { id: true },
    });
    if (existing) {
      const detail = await this.publicationDetail(transaction, context.agencyId, existing.id);
      return { publication: detail.publication };
    }
    const predecessor = version.predecessorVersionId
      ? await transaction.attendancePayrollPublication.findFirst({
          where: {
            agencyId: context.agencyId,
            attendancePeriodVersion: { id: version.predecessorVersionId },
          },
          select: { id: true },
        })
      : null;
    if (version.predecessorVersionId && !predecessor) {
      throw new AttendancePeriodServiceError(
        'The corrected successor requires the predecessor Attendance Payroll Publication.',
        409,
        'ATTENDANCE_PAYROLL_PREDECESSOR_MISSING',
      );
    }
    const memberships = await this.loadMembershipDays(transaction, context.agencyId, version.id);
    const successorLines = deriveAttendancePayrollFactLines(
      memberships.map((row) => payrollSourceDay(row)),
    );
    const publicationType: AttendancePayrollPublicationType = predecessor
      ? 'ADJUSTMENT'
      : 'ORIGINAL';
    const lines = predecessor
      ? buildAttendancePayrollAdjustmentLines(
          await this.loadEffectivePriorFactLines(transaction, context.agencyId, predecessor.id),
          successorLines,
        )
      : successorLines;
    const created = await transaction.attendancePayrollPublication.create({
      data: {
        id: randomUUID(),
        agencyId: context.agencyId,
        attendancePeriodVersionId: version.id,
        predecessorPublicationId: predecessor?.id ?? null,
        publicationType,
        idempotencyKey: `attendance-period-publication:${version.id}`,
        publishedAt: now,
      },
      select: { id: true },
    });
    if (lines.length > 0) {
      await transaction.attendancePayrollFact.createMany({
        data: lines.map((line) => ({
          id: randomUUID(),
          agencyId: context.agencyId,
          attendancePayrollPublicationId: created.id,
          attendanceDayId: line.attendanceDayId,
          employeeId: line.employeeId,
          workDate: toDatabaseDate(line.workDate),
          factType: line.factType,
          holidayClassification: line.holidayClassification,
          stableSourceKey: line.stableSourceKey,
          correctedMinutes: line.minutes,
          priorMinutes: 'priorMinutes' in line ? (line.priorMinutes as number) : null,
          differenceDirection:
            'differenceDirection' in line ? (line.differenceDirection as string) : null,
          differenceMinutes:
            'differenceMinutes' in line ? (line.differenceMinutes as number) : null,
        })),
      });
    }
    const detail = await this.publicationDetail(transaction, context.agencyId, created.id);
    return { publication: detail.publication };
  }

  /**
   * The effective prior value of a stable fact key is the corrected value of
   * the nearest publication in the predecessor chain that carries the key. An
   * adjustment publication stores only changed facts, so reading just the
   * immediate predecessor would report a carried-forward fact as zero and
   * inflate the published difference.
   */
  private async loadEffectivePriorFactLines(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    predecessorPublicationId: string,
  ): Promise<AttendancePayrollFactLine[]> {
    const byKey = new Map<string, AttendancePayrollFactLine>();
    const visited = new Set<string>();
    let publicationId: string | null = predecessorPublicationId;
    while (publicationId && !visited.has(publicationId)) {
      visited.add(publicationId);
      const publication: { predecessorPublicationId: string | null } | null =
        await transaction.attendancePayrollPublication.findFirst({
          where: { agencyId, id: publicationId },
          select: { predecessorPublicationId: true },
        });
      if (!publication) break;
      for (const fact of await this.loadPublicationFactLines(
        transaction,
        agencyId,
        publicationId,
      )) {
        if (!byKey.has(fact.stableSourceKey)) byKey.set(fact.stableSourceKey, fact);
      }
      publicationId = publication.predecessorPublicationId;
    }
    return [...byKey.values()];
  }

  private async loadPublicationFactLines(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    publicationId: string,
  ): Promise<AttendancePayrollFactLine[]> {
    const facts = await transaction.attendancePayrollFact.findMany({
      where: { agencyId, attendancePayrollPublicationId: publicationId },
      orderBy: { stableSourceKey: 'asc' },
      select: {
        attendanceDayId: true,
        employeeId: true,
        workDate: true,
        factType: true,
        holidayClassification: true,
        stableSourceKey: true,
        correctedMinutes: true,
      },
    });
    return facts.map((fact) => ({
      employeeId: fact.employeeId,
      workDate: formatDate(fact.workDate),
      attendanceDayId: fact.attendanceDayId,
      factType: fact.factType as AttendancePayrollFactType,
      holidayClassification: fact.holidayClassification,
      stableSourceKey: fact.stableSourceKey,
      minutes: fact.correctedMinutes,
    }));
  }

  private async reconcileInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    version: VersionRecord,
  ): Promise<AttendancePeriodReconciliation> {
    const failures: AttendancePeriodReconciliationFailure[] = [];
    const memberships = await this.loadMembershipDays(transaction, context.agencyId, version.id);
    const population = await this.loadPopulation(
      transaction,
      context.agencyId,
      version.attendancePeriodId,
    );
    const completion = this.completePopulation(population);
    if (completion.reasons.length > 0) {
      failures.push({
        code: 'POPULATION_INCOMPLETE',
        message:
          'The applicable population, its approved submissions, or its current approved Attendance Days are incomplete.',
        details: { reasons: completion.reasons },
      });
    }
    const missingApplicableEmployeeIds = population.applicableEmployeeIds.filter(
      (employeeId) => !completion.employees.includes(employeeId),
    );
    if (missingApplicableEmployeeIds.length > 0) {
      failures.push({
        code: 'APPLICABILITY_INCOMPLETE',
        message:
          'An Employee with an applicable Schedule Assignment holds no current Attendance Day in the period.',
        details: { employeeIds: missingApplicableEmployeeIds },
      });
    }
    const changedBindings = changedSourceBindings(memberships, completion.memberships);
    if (changedBindings.length > 0) {
      failures.push({
        code: 'SOURCE_BINDING_CHANGED',
        message:
          'An Attendance Period Version membership no longer binds the exact approved sources.',
        details: { bindings: changedBindings },
      });
    }
    const changedInputDayIds = new Set(
      await this.days.changedInputDayIdsInTransaction(
        transaction,
        context,
        memberships.map((row) => row.attendanceDayId),
      ),
    );
    const changedInputDays = memberships.filter((row) =>
      changedInputDayIds.has(row.attendanceDayId),
    );
    if (changedInputDays.length > 0) {
      const named = changedInputDays.map(
        ({ attendanceDay: day }) =>
          `${day.employee.legalName} (${day.employee.employeeNumber}) on ${formatDate(day.workDate)}`,
      );
      failures.push({
        code: 'DAY_INPUTS_CHANGED',
        message: `The sources of an approved Attendance Day changed after approval. Recalculate, resubmit, and re-approve: ${named.join('; ')}.`,
        details: {
          days: changedInputDays.map(({ attendanceDay: day }) => ({
            attendanceDayId: day.id,
            employeeId: day.employeeId,
            workDate: formatDate(day.workDate),
          })),
        },
      });
    }
    if (population.openExceptions.length > 0) {
      failures.push({
        code: 'OPEN_EXCEPTIONS',
        message: 'Unresolved Attendance Exceptions block the Attendance Period lock.',
        details: { attendanceExceptionIds: population.openExceptions.map((row) => row.id) },
      });
    }
    if (population.unresolvedCorrections.length > 0) {
      failures.push({
        code: 'UNRESOLVED_CORRECTIONS',
        message: 'Unresolved Attendance Corrections block the Attendance Period lock.',
        details: {
          corrections: population.unresolvedCorrections.map((row) => ({
            id: row.id,
            status: row.status,
          })),
        },
      });
    }
    const authority = await this.authorityCheck(transaction, context, version);
    if (!authority.unchanged) {
      failures.push({
        code: 'ROUTED_AUTHORITY_CHANGED',
        message: 'The bound Approval Route Version is no longer the active routed authority.',
        details: {
          approvalRouteVersionId: authority.approvalRouteVersionId,
          activeRouteVersionId: authority.activeRouteVersionId,
        },
      });
    }
    const payroll = this.payrollReconciliation(memberships);
    failures.push(...payroll.failures);
    const coveredEmployeeIds = [...new Set(memberships.map((row) => row.attendanceDay.employeeId))];
    const dtrDocuments = await transaction.dtrDocument.findMany({
      where: { agencyId: context.agencyId, attendancePeriodVersionId: version.id },
      select: { employeeId: true },
    });
    const dtrEmployeeIds = new Set(dtrDocuments.map((document) => document.employeeId));
    const missingDtrEmployeeIds = coveredEmployeeIds.filter(
      (employeeId) => !dtrEmployeeIds.has(employeeId),
    );
    if (version.status === 'LOCKED' && missingDtrEmployeeIds.length > 0) {
      failures.push({
        code: 'DTR_MISSING',
        message: 'A covered Employee holds no Finalized Daily Time Record.',
        details: { employeeIds: missingDtrEmployeeIds },
      });
    }
    const workDates = new Set(memberships.map((row) => formatDate(row.attendanceDay.workDate)));
    return {
      source: ATTENDANCE_PERIOD_RECONCILIATION_SOURCE,
      checkedAt: new Date().toISOString(),
      ok: failures.length === 0,
      failures,
      population: {
        employeeCount: coveredEmployeeIds.length,
        workDateCount: workDates.size,
        membershipCount: memberships.length,
      },
      applicability: {
        applicableEmployeeCount: population.applicableEmployeeIds.length,
        missingEmployeeIds: missingApplicableEmployeeIds,
      },
      submissions: {
        approvedCount: population.approvedSubmissions.length,
        approvedDayCount: population.approvedSubmissions.reduce(
          (total, submission) => total + submission.days.length,
          0,
        ),
        missingEmployeeIds: coveredEmployeeIds.filter(
          (employeeId) =>
            !population.approvedSubmissions.some(
              (submission) => submission.employeeId === employeeId,
            ),
        ),
      },
      days: {
        currentDayCount: population.currentDays.length,
        approvedDayCount: population.currentDays.filter((day) => day.status === 'APPROVED').length,
        unresolvedExceptionCount: population.openExceptions.length,
        exceptionIds: population.openExceptions.map((row) => row.id),
      },
      corrections: {
        unresolvedCount: population.unresolvedCorrections.length,
        correctionIds: population.unresolvedCorrections.map((row) => row.id),
      },
      sources: {
        changedBindingCount: changedBindings.length,
        changedBindings,
      },
      authority,
      dtrs: {
        expectedCount: coveredEmployeeIds.length,
        existingCount: dtrDocuments.length,
        missingEmployeeIds: missingDtrEmployeeIds,
      },
      payroll: {
        factCount: payroll.lines.length,
        factMinutes: payroll.factMinutes,
        factTypeMinutes: payroll.factTypeMinutes,
        expectedMinutes: payroll.expectedMinutes,
        excludedOutsideScheduleMinutes: payroll.excludedOutsideScheduleMinutes,
        excludedStatutoryNightWindowMinutes: payroll.excludedStatutoryNightWindowMinutes,
      },
    };
  }

  private payrollReconciliation(memberships: readonly MembershipRecord[]): {
    failures: AttendancePeriodReconciliationFailure[];
    lines: AttendancePayrollFactLine[];
    factMinutes: number;
    factTypeMinutes: Record<AttendancePayrollFactType, number>;
    expectedMinutes: number;
    excludedOutsideScheduleMinutes: number;
    excludedStatutoryNightWindowMinutes: number;
  } {
    const lines = deriveAttendancePayrollFactLines(memberships.map((row) => payrollSourceDay(row)));
    const factTypeMinutes = summarizeAttendancePayrollFactMinutes(lines);
    const expectedMinutes = memberships.reduce(
      (total, row) => total + row.attendanceDay.expectedMinutes,
      0,
    );
    const failures: AttendancePeriodReconciliationFailure[] = [];
    if (factTypeMinutes.EXPECTED !== expectedMinutes) {
      failures.push({
        code: 'PAYROLL_EXPECTED_MISMATCH',
        message:
          'The published expected minutes do not reconcile with the retained Attendance Day totals.',
        details: { factExpectedMinutes: factTypeMinutes.EXPECTED, expectedMinutes },
      });
    }
    const minutesByDay = new Map<string, Map<string, number>>();
    for (const line of lines) {
      const byType = minutesByDay.get(line.attendanceDayId) ?? new Map<string, number>();
      byType.set(line.factType, (byType.get(line.factType) ?? 0) + line.minutes);
      minutesByDay.set(line.attendanceDayId, byType);
    }
    for (const row of memberships) {
      const byType = minutesByDay.get(row.attendanceDayId) ?? new Map<string, number>();
      for (const [factType, column] of Object.entries(DAY_COVERAGE_COLUMNS)) {
        const derived = byType.get(factType) ?? 0;
        const stored = row.attendanceDay[column] as number;
        if (derived > stored) {
          failures.push({
            code: 'PAYROLL_CLASSIFICATION_MISMATCH',
            message: 'A published classification exceeds the retained Attendance Day total.',
            details: {
              attendanceDayId: row.attendanceDayId,
              factType,
              derivedMinutes: derived,
              storedMinutes: stored,
            },
          });
        }
      }
    }
    return {
      failures,
      lines,
      factMinutes: Object.values(factTypeMinutes).reduce((total, value) => total + value, 0),
      factTypeMinutes,
      expectedMinutes,
      excludedOutsideScheduleMinutes: memberships.reduce(
        (total, row) => total + row.attendanceDay.outsideScheduleMinutes,
        0,
      ),
      excludedStatutoryNightWindowMinutes: memberships.reduce(
        (total, row) => total + row.attendanceDay.statutoryNightWindowMinutes,
        0,
      ),
    };
  }

  private async authorityCheck(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    version: VersionRecord,
  ): Promise<AttendancePeriodReconciliation['authority']> {
    let activeRouteVersionId: string | null = null;
    try {
      const route = await this.requireActiveRoute(
        transaction,
        context,
        formatDate(version.attendancePeriod.dateFrom),
      );
      activeRouteVersionId = route.id;
    } catch {
      // The reconciliation reports the missing routed authority as a failure.
    }
    return {
      approvalRouteVersionId: version.approvalRouteVersionId,
      activeRouteVersionId,
      unchanged: activeRouteVersionId === version.approvalRouteVersionId,
    };
  }

  private async requireActiveRoute(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    effectiveDate: string,
  ): Promise<{ id: string }> {
    try {
      return await this.approvals.resolveActiveRouteInTransaction(
        transaction,
        context,
        ATTENDANCE_PERIOD_LOCK_ROUTE_CODE,
        effectiveDate,
      );
    } catch (error: unknown) {
      throw new AttendancePeriodServiceError(
        `No active ${ATTENDANCE_PERIOD_LOCK_ROUTE_CODE} Approval Route Version is configured for the Attendance Period.`,
        409,
        'ATTENDANCE_PERIOD_ROUTE_UNAVAILABLE',
        [error instanceof Error ? error.message : 'APPROVAL_ROUTE_RESOLUTION_FAILED'],
      );
    }
  }

  private async materializeDtrsInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    versionId: string,
  ) {
    try {
      return await this.dtrs.materializeForLockedVersionInTransaction(
        transaction,
        context,
        versionId,
      );
    } catch (error: unknown) {
      if (error instanceof DtrServiceError) {
        throw new AttendancePeriodServiceError(
          error.message,
          error.statusCode,
          'ATTENDANCE_PERIOD_DTR_FAILED',
          error.reasons,
        );
      }
      throw error;
    }
  }

  private async loadMembershipDays(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    versionId: string,
  ): Promise<MembershipRecord[]> {
    return transaction.attendancePeriodVersionDay.findMany({
      where: { agencyId, attendancePeriodVersionId: versionId },
      orderBy: [{ attendanceDayId: 'asc' }],
      select: membershipSelect,
    });
  }

  private async loadPopulation(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    attendancePeriodId: string,
  ): Promise<PopulationSources> {
    const currentDays = await transaction.attendanceDay.findMany({
      where: { agencyId, attendancePeriodId, isCurrent: true },
      orderBy: [{ workDate: 'asc' }, { id: 'asc' }],
      select: daySelect,
    });
    const dayIds = currentDays.map((day) => day.id);
    const [period, assignments, openExceptions, approvedSubmissions, unresolvedCorrections] =
      await Promise.all([
        transaction.attendancePeriod.findFirst({
          where: { agencyId, id: attendancePeriodId },
          select: { dateFrom: true, dateTo: true },
        }),
        transaction.scheduleAssignment.findMany({
          where: { agencyId },
          select: { employeeId: true, effectiveFrom: true, effectiveTo: true },
        }),
        dayIds.length > 0
          ? transaction.attendanceException.findMany({
              where: { agencyId, attendanceDayId: { in: dayIds }, status: 'OPEN' },
              select: { id: true, attendanceDayId: true },
            })
          : Promise.resolve([]),
        transaction.employeeAttendanceSubmission.findMany({
          where: { agencyId, attendancePeriodId, status: 'APPROVED' },
          select: {
            id: true,
            employeeId: true,
            days: {
              select: {
                attendanceDayId: true,
                attendanceDay: { select: { isCurrent: true, status: true, workDate: true } },
              },
            },
          },
        }),
        transaction.attendanceCorrection.findMany({
          where: {
            agencyId,
            employeeId: { in: [...new Set(currentDays.map((day) => day.employeeId))] },
            status: { in: ['SUBMITTED', 'NEEDS_INFORMATION', 'FOR_AUTHORIZATION'] },
          },
          select: { id: true, status: true, employeeId: true },
        }),
      ]);
    const applicableEmployeeIds = period
      ? [
          ...new Set(
            assignments
              .filter(
                (assignment) =>
                  assignment.effectiveFrom.getTime() <= period.dateTo.getTime() &&
                  (assignment.effectiveTo === null ||
                    assignment.effectiveTo.getTime() >= period.dateFrom.getTime()),
              )
              .map((assignment) => assignment.employeeId),
          ),
        ]
      : [];
    return {
      currentDays,
      applicableEmployeeIds,
      openExceptions,
      approvedSubmissions,
      unresolvedCorrections,
    };
  }

  /**
   * The applicable population is every Employee and Work Date with a current
   * Attendance Day in the period. Each Employee must have one approved
   * Employee Attendance Submission binding exactly those current APPROVED
   * versions.
   */
  private completePopulation(population: PopulationSources): {
    ok: boolean;
    reasons: string[];
    memberships: Array<{ submissionId: string; attendanceDayId: string }>;
    employees: string[];
    workDates: string[];
  } {
    const reasons: string[] = [];
    const memberships: Array<{ submissionId: string; attendanceDayId: string }> = [];
    const employees = [...new Set(population.currentDays.map((day) => day.employeeId))].sort();
    const workDates = [
      ...new Set(population.currentDays.map((day) => formatDate(day.workDate))),
    ].sort();
    if (population.currentDays.length === 0) {
      reasons.push('POPULATION_EMPTY');
    }
    for (const employeeId of population.applicableEmployeeIds) {
      if (!employees.includes(employeeId)) {
        reasons.push(`EMPLOYEE_${employeeId}_NO_APPLICABLE_DAY`);
      }
    }
    const submissionsByEmployee = new Map<string, PopulationSources['approvedSubmissions']>();
    for (const submission of population.approvedSubmissions) {
      const list = submissionsByEmployee.get(submission.employeeId) ?? [];
      list.push(submission);
      submissionsByEmployee.set(submission.employeeId, list);
    }
    const currentDayIds = new Set(population.currentDays.map((day) => day.id));
    for (const employeeId of employees) {
      const submissions = submissionsByEmployee.get(employeeId) ?? [];
      if (submissions.length === 0) {
        reasons.push(`EMPLOYEE_${employeeId}_NO_APPROVED_SUBMISSION`);
        continue;
      }
      if (submissions.length > 1) {
        reasons.push(`EMPLOYEE_${employeeId}_MULTIPLE_APPROVED_SUBMISSIONS`);
      }
      const submission = submissions[0]!;
      const bound = new Map(submission.days.map((day) => [day.attendanceDayId, day.attendanceDay]));
      for (const dayId of bound.keys()) {
        if (!currentDayIds.has(dayId)) {
          reasons.push(`DAY_${dayId}_BINDING_NOT_APPLICABLE`);
        }
      }
      for (const day of population.currentDays) {
        if (day.employeeId !== employeeId) continue;
        const boundDay = bound.get(day.id);
        if (!boundDay) {
          reasons.push(`DAY_${day.id}_UNBOUND`);
          continue;
        }
        if (day.status !== 'APPROVED') {
          reasons.push(`DAY_${day.id}_STATUS_${day.status}`);
        }
        memberships.push({ submissionId: submission.id, attendanceDayId: day.id });
      }
    }
    return {
      ok: reasons.length === 0,
      reasons,
      memberships,
      employees,
      workDates,
    };
  }

  private async requireVersion(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    versionId: string,
  ): Promise<VersionRecord> {
    const record = await transaction.attendancePeriodVersion.findFirst({
      where: { agencyId: context.agencyId, id: versionId },
      select: versionSelect,
    });
    if (!record) throw this.versionNotFound();
    return record;
  }

  private async detailInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    versionId: string,
  ): Promise<AttendancePeriodVersionDetail> {
    const record = await this.requireVersion(transaction, context, versionId);
    const counts = await this.membershipCounts(transaction, context.agencyId, [record.id]);
    const minutes = await this.publicationMinutes(transaction, context.agencyId, [record.id]);
    return {
      version: versionSummary(
        record,
        counts.get(record.id) ?? emptyCounts(),
        minutes.get(record.id) ?? 0,
      ),
      reconciliation: parseReconciliation(record.reconciliation),
    };
  }

  private async publicationDetail(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    publicationId: string,
  ): Promise<AttendancePayrollPublicationDetail> {
    const publication = await transaction.attendancePayrollPublication.findFirst({
      where: { agencyId, id: publicationId },
      select: {
        id: true,
        attendancePeriodVersionId: true,
        predecessorPublicationId: true,
        publicationType: true,
        idempotencyKey: true,
        publishedAt: true,
      },
    });
    if (!publication) throw this.publicationNotFound();
    const facts = await transaction.attendancePayrollFact.findMany({
      where: { agencyId, attendancePayrollPublicationId: publication.id },
      orderBy: [{ employeeId: 'asc' }, { workDate: 'asc' }, { stableSourceKey: 'asc' }],
      select: {
        id: true,
        employeeId: true,
        workDate: true,
        attendanceDayId: true,
        factType: true,
        holidayClassification: true,
        stableSourceKey: true,
        correctedMinutes: true,
        priorMinutes: true,
        differenceDirection: true,
        differenceMinutes: true,
      },
    });
    const summaries: AttendancePayrollFactSummary[] = facts.map((fact) => ({
      id: fact.id,
      employeeId: fact.employeeId,
      workDate: formatDate(fact.workDate),
      attendanceDayId: fact.attendanceDayId,
      factType: fact.factType as AttendancePayrollFactType,
      holidayClassification: fact.holidayClassification,
      stableSourceKey: fact.stableSourceKey,
      correctedMinutes: fact.correctedMinutes,
      priorMinutes: fact.priorMinutes,
      differenceDirection: fact.differenceDirection as 'INCREASE' | 'DECREASE' | null,
      differenceMinutes: fact.differenceMinutes,
    }));
    return {
      publication: {
        id: publication.id,
        attendancePeriodVersionId: publication.attendancePeriodVersionId,
        predecessorPublicationId: publication.predecessorPublicationId,
        publicationType: publication.publicationType as AttendancePayrollPublicationType,
        idempotencyKey: publication.idempotencyKey,
        publishedAt: publication.publishedAt.toISOString(),
        factCount: summaries.length,
        factMinutes: summaries.reduce((total, fact) => total + fact.correctedMinutes, 0),
      },
      facts: summaries,
    };
  }

  private async membershipCounts(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    versionIds: readonly string[],
  ): Promise<Map<string, { employees: number; workDates: number; memberships: number }>> {
    const ids = [...new Set(versionIds)];
    if (ids.length === 0) return new Map();
    const rows = await transaction.$queryRaw<
      Array<{
        version_id: string;
        employee_count: bigint;
        work_date_count: bigint;
        membership_count: bigint;
      }>
    >(Prisma.sql`
      SELECT d."attendance_period_version_id" AS version_id,
             COUNT(DISTINCT ad."employee_id") AS employee_count,
             COUNT(DISTINCT ad."work_date") AS work_date_count,
             COUNT(*) AS membership_count
      FROM "attendance_period_version_days" d
      JOIN "attendance_days" ad
        ON ad."agency_id" = d."agency_id" AND ad."id" = d."attendance_day_id"
      WHERE d."agency_id" = CAST(${agencyId} AS uuid)
        AND d."attendance_period_version_id" IN (${Prisma.join(
          ids.map((id) => Prisma.sql`CAST(${id} AS uuid)`),
        )})
      GROUP BY 1
    `);
    return new Map(
      rows.map((row) => [
        row.version_id,
        {
          employees: Number(row.employee_count),
          workDates: Number(row.work_date_count),
          memberships: Number(row.membership_count),
        },
      ]),
    );
  }

  private async publicationMinutes(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    versionIds: readonly string[],
  ): Promise<Map<string, number>> {
    const ids = [...new Set(versionIds)];
    if (ids.length === 0) return new Map();
    const rows = await transaction.$queryRaw<
      Array<{ version_id: string; fact_minutes: bigint | null }>
    >(Prisma.sql`
      SELECT p."attendance_period_version_id" AS version_id,
             COALESCE(SUM(f."corrected_minutes"), 0) AS fact_minutes
      FROM "attendance_payroll_publications" p
      LEFT JOIN "attendance_payroll_facts" f
        ON f."agency_id" = p."agency_id" AND f."attendance_payroll_publication_id" = p."id"
      WHERE p."agency_id" = CAST(${agencyId} AS uuid)
        AND p."attendance_period_version_id" IN (${Prisma.join(
          ids.map((id) => Prisma.sql`CAST(${id} AS uuid)`),
        )})
      GROUP BY 1
    `);
    return new Map(rows.map((row) => [row.version_id, Number(row.fact_minutes ?? 0)]));
  }

  private async filterVersionsInScope(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    records: readonly VersionRecord[],
    employeeIds: readonly string[],
  ): Promise<VersionRecord[]> {
    if (records.length === 0) return [];
    const outside = await transaction.$queryRaw<Array<{ version_id: string }>>(Prisma.sql`
      SELECT DISTINCT d."attendance_period_version_id" AS version_id
      FROM "attendance_period_version_days" d
      JOIN "attendance_days" ad
        ON ad."agency_id" = d."agency_id" AND ad."id" = d."attendance_day_id"
      WHERE d."agency_id" = CAST(${agencyId} AS uuid)
        AND d."attendance_period_version_id" IN (${Prisma.join(
          records.map((record) => Prisma.sql`CAST(${record.id} AS uuid)`),
        )})
        AND ad."employee_id" NOT IN (${Prisma.join(
          employeeIds.map((employeeId) => Prisma.sql`CAST(${employeeId} AS uuid)`),
        )})
    `);
    const excluded = new Set(outside.map((row) => row.version_id));
    return records.filter((record) => !excluded.has(record.id));
  }

  private async assertVersionInScope(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    versionId: string,
    scope: Exclude<EmployeeScope, { kind: 'NONE' }>,
  ): Promise<void> {
    if (scope.kind === 'AGENCY') return;
    const outside = await transaction.attendancePeriodVersionDay.findFirst({
      where: {
        agencyId,
        attendancePeriodVersionId: versionId,
        attendanceDay: { employeeId: { notIn: scope.employeeIds } },
      },
      select: { attendanceDayId: true },
    });
    if (outside) throw this.versionNotFound();
  }

  private async readScope(transaction: Prisma.TransactionClient, context: RequestContext) {
    return this.employeeScope(
      transaction,
      context,
      'attendance.reports.read',
      'ATTENDANCE_PERIOD_READ_FORBIDDEN',
    );
  }

  private async publicationScope(transaction: Prisma.TransactionClient, context: RequestContext) {
    return this.employeeScope(
      transaction,
      context,
      'attendance.payroll_publications.read',
      'ATTENDANCE_PAYROLL_PUBLICATION_READ_FORBIDDEN',
    );
  }

  private async decideScope(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    permissionCode: string,
  ) {
    return this.employeeScope(
      transaction,
      context,
      permissionCode,
      'ATTENDANCE_PERIOD_DECIDE_FORBIDDEN',
    );
  }

  /** Resolve one permission's Employee Scope, denying a scope that reaches no Employee. */
  private async employeeScope(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    permissionCode: string,
    forbiddenCode: string,
  ) {
    const scope = await resolveEmployeeScope(transaction, context, permissionCode);
    if (scope.kind === 'NONE' || (scope.kind === 'SCOPED' && scope.employeeIds.length === 0)) {
      throw new AttendancePeriodServiceError(
        `The ${permissionCode} permission is required.`,
        403,
        forbiddenCode,
      );
    }
    return scope;
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
    const metadata = completed.metadata;
    const command =
      metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>).command
        : null;
    if (command !== input.command) {
      throw new AttendancePeriodServiceError(
        'The Idempotency-Key was already used for a different Attendance Period command.',
        409,
        'ATTENDANCE_PERIOD_IDEMPOTENCY_CONFLICT',
      );
    }
    return completed.entityId;
  }

  private assertAgencyPermission(
    context: RequestContext,
    permissionCode: string,
    code: string,
  ): void {
    if (!holdsAgencyWide(context, permissionCode)) {
      throw new AttendancePeriodServiceError(
        `The ${permissionCode} permission with Agency scope is required.`,
        403,
        code,
      );
    }
  }

  private invalidState(status: string, action: string): AttendancePeriodServiceError {
    return new AttendancePeriodServiceError(
      `The Attendance Period Version cannot ${action} while it is ${status}.`,
      409,
      'ATTENDANCE_PERIOD_INVALID_STATE',
      [`STATUS:${status}`],
    );
  }

  private versionNotFound(): AttendancePeriodServiceError {
    return new AttendancePeriodServiceError(
      'The requested Attendance Period Version could not be found.',
      404,
      'ATTENDANCE_PERIOD_VERSION_NOT_FOUND',
    );
  }

  private periodNotFound(): AttendancePeriodServiceError {
    return new AttendancePeriodServiceError(
      'The requested Attendance Period could not be found.',
      404,
      'ATTENDANCE_PERIOD_NOT_FOUND',
    );
  }

  private publicationNotFound(): AttendancePeriodServiceError {
    return new AttendancePeriodServiceError(
      'The Attendance Payroll Publication could not be found.',
      404,
      'ATTENDANCE_PAYROLL_PUBLICATION_NOT_FOUND',
    );
  }
}

function emptyCounts(): { employees: number; workDates: number; memberships: number } {
  return { employees: 0, workDates: 0, memberships: 0 };
}

function payrollSourceDay(row: MembershipRecord): PayrollFactSourceDay {
  return {
    attendanceDayId: row.attendanceDayId,
    employeeId: row.attendanceDay.employeeId,
    workDate: formatDate(row.attendanceDay.workDate),
    segments: row.attendanceDay.segments.map((segment) => ({
      dutyRelation: segment.dutyRelation,
      coverageType: segment.coverageType,
      deficitType: segment.deficitType,
      holidayClassification: segment.holidayClassification,
      startsAt: segment.startsAt,
      endsAt: segment.endsAt,
    })),
  };
}

function versionSummary(
  record: VersionRecord,
  counts: { employees: number; workDates: number; memberships: number },
  publicationMinutes: number,
): AttendancePeriodVersionSummary {
  const publication = record.payrollPublications[0];
  return {
    id: record.id,
    attendancePeriodId: record.attendancePeriodId,
    period: {
      id: record.attendancePeriod.id,
      code: record.attendancePeriod.code,
      dateFrom: formatDate(record.attendancePeriod.dateFrom),
      dateTo: formatDate(record.attendancePeriod.dateTo),
      status: record.attendancePeriod.status as AttendancePeriodState,
    },
    versionNo: record.versionNo,
    status: record.status as AttendancePeriodVersionState,
    predecessorVersionId: record.predecessorVersionId,
    approvalRouteVersionId: record.approvalRouteVersionId,
    submittedByMembershipId: record.submittedByMembershipId,
    submittedAt: record.submittedAt.toISOString(),
    reviewedByMembershipId: record.reviewedByMembershipId,
    reviewedAt: record.reviewedAt ? record.reviewedAt.toISOString() : null,
    reviewReason: record.reviewReason,
    lockedByMembershipId: record.lockedByMembershipId,
    lockedAt: record.lockedAt ? record.lockedAt.toISOString() : null,
    coveredEmployeeCount: counts.employees,
    coveredWorkDateCount: counts.workDates,
    dtrCount: record._count.dtrDocuments,
    supersededDayCount: record._count.days,
    publication: publication
      ? {
          id: publication.id,
          attendancePeriodVersionId: record.id,
          predecessorPublicationId: publication.predecessorPublicationId,
          publicationType: publication.publicationType as AttendancePayrollPublicationType,
          idempotencyKey: publication.idempotencyKey,
          publishedAt: publication.publishedAt.toISOString(),
          factCount: publication._count.facts,
          factMinutes: publicationMinutes,
        }
      : null,
  };
}

function changedSourceBindings(
  memberships: readonly MembershipRecord[],
  expected: readonly { submissionId: string; attendanceDayId: string }[],
): string[] {
  const changed = new Set<string>();
  const expectedKeys = new Set(expected.map((row) => `${row.submissionId}:${row.attendanceDayId}`));
  const membershipKeys = new Set<string>();
  for (const row of memberships) {
    const key = `${row.employeeAttendanceSubmissionId}:${row.attendanceDayId}`;
    membershipKeys.add(key);
    if (row.submission.employeeId !== row.attendanceDay.employeeId) {
      changed.add(`DAY:${row.attendanceDayId}:EMPLOYEE_MISMATCH`);
    }
    if (!row.attendanceDay.isCurrent) {
      changed.add(`DAY:${row.attendanceDayId}:NOT_CURRENT`);
    }
    if (row.attendanceDay.status !== 'APPROVED') {
      changed.add(`DAY:${row.attendanceDayId}:STATUS:${row.attendanceDay.status}`);
    }
    if (row.submission.status !== 'APPROVED') {
      changed.add(`SUBMISSION:${row.submission.id}:STATUS:${row.submission.status}`);
    }
    if (!expectedKeys.has(key)) {
      changed.add(`DAY:${row.attendanceDayId}:BINDING_CHANGED`);
    }
  }
  for (const key of expectedKeys) {
    if (!membershipKeys.has(key)) {
      const attendanceDayId = key.slice(key.indexOf(':') + 1);
      changed.add(`DAY:${attendanceDayId}:BINDING_MISSING`);
    }
  }
  return [...changed].sort();
}

function parseReconciliation(
  value: Prisma.JsonValue | null,
): AttendancePeriodReconciliation | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.source !== ATTENDANCE_PERIOD_RECONCILIATION_SOURCE) return null;
  return record as unknown as AttendancePeriodReconciliation;
}
