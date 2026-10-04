import { Prisma } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { expect, it } from 'vitest';
import {
  createAttendanceWorkflowFixture,
  cleanupAttendanceWorkflowAgency,
  manilaDate,
  type AttendanceWorkflowFixture,
} from '../attendance-test-fixtures';
import { attendancePeriodAuditWriter } from './attendance-periods.audit';
import { AttendancePeriodsService } from './attendance-periods.service';

const enabled = process.env.DATABASE_E2E === 'true';

async function activateLockRoute(fixture: AttendanceWorkflowFixture): Promise<string> {
  const route = await fixture.services.approvals.createRoute(fixture.administratorContext, {
    routeCode: 'DTR-PERIOD-LOCK',
    domain: 'ATTENDANCE',
    versionNo: 1,
    effectiveFrom: manilaDate(-30),
    stepDefinition: {
      steps: [
        {
          stepNo: 1,
          stepMode: 'SEQUENTIAL',
          requiredPermission: 'attendance.periods.approve',
          assignment: { kind: 'MEMBERSHIP', membershipId: fixture.memberships.officer },
          requiresSeparateReview: false,
        },
      ],
    },
  });
  await fixture.services.approvals.activateRoute(
    fixture.administratorContext,
    route.id,
    'Activate the Attendance Period lock route.',
  );
  const version = await fixture.admin.approvalRouteVersion.findFirstOrThrow({
    where: { agencyId: fixture.agencyId, routeCode: 'DTR-PERIOD-LOCK', status: 'ACTIVE' },
  });
  return version.id;
}

async function approveSubmission(fixture: AttendanceWorkflowFixture): Promise<void> {
  const submission = await fixture.services.submissions.create(fixture.employeeContext, {
    attendancePeriodId: fixture.periodId,
  });
  await fixture.services.submissions.submit(fixture.employeeContext, submission.submission.id);
  await fixture.services.submissions.approve(fixture.officerContext, submission.submission.id, {});
}

async function createSecondAdministrator(
  fixture: AttendanceWorkflowFixture,
): Promise<RequestContext> {
  const user = await fixture.admin.user.create({
    data: {
      emailNormalized: `attendance-workflow-admin-two-${fixture.suffix}@example.test`,
      displayName: 'Attendance Workflow Admin Two',
      globalStatus: 'ACTIVE',
    },
  });
  const membership = await fixture.admin.agencyMembership.create({
    data: { agencyId: fixture.agencyId, userId: user.id, status: 'ACTIVE' },
  });
  return {
    ...fixture.administratorContext,
    requestId: `attendance-workflow-${fixture.suffix}-administrator-two`,
    membershipId: membership.id,
  };
}

function failingDtrsService() {
  return {
    materializeForLockedVersionInTransaction: async () => {
      throw new Error('Injected Finalized Daily Time Record failure.');
    },
  } as never;
}

it.skipIf(!enabled)(
  'submits, returns, approves, and locks an Attendance Period into one publication and DTR per covered Employee',
  async () => {
    const fixture = await createAttendanceWorkflowFixture();
    const { admin, services } = fixture;
    try {
      await activateLockRoute(fixture);
      await approveSubmission(fixture);

      const submitted = await services.periods.submitForReview(
        fixture.administratorContext,
        fixture.periodId,
      );
      expect(submitted.version.status).toBe('FOR_REVIEW');
      expect(submitted.version.versionNo).toBe(1);
      expect(submitted.version.coveredEmployeeCount).toBe(1);
      expect(submitted.version.coveredWorkDateCount).toBe(1);
      expect(submitted.version.publication).toBeNull();

      const reconciliation = await services.periods.reconcile(
        fixture.administratorContext,
        submitted.version.id,
      );
      expect(reconciliation.ok).toBe(true);
      expect(reconciliation.population).toMatchObject({
        employeeCount: 1,
        workDateCount: 1,
        membershipCount: 1,
      });
      expect(reconciliation.payroll.factCount).toBe(3);
      expect(reconciliation.payroll.expectedMinutes).toBe(480);
      expect(reconciliation.payroll.factTypeMinutes).toMatchObject({
        EXPECTED: 480,
        WORKED: 420,
        UNDERTIME: 60,
      });
      expect(reconciliation.payroll.excludedOutsideScheduleMinutes).toBe(0);

      const returned = await services.periods.returnForReason(
        fixture.officerContext,
        submitted.version.id,
        { reason: 'The Work Date needs another look.' },
      );
      expect(returned.version.status).toBe('RETURNED');
      expect(returned.version.reviewedByMembershipId).toBe(fixture.memberships.officer);

      const resubmitted = await services.periods.submitForReview(
        fixture.administratorContext,
        fixture.periodId,
      );
      expect(resubmitted.version.versionNo).toBe(2);
      expect(resubmitted.version.status).toBe('FOR_REVIEW');

      const secondAdministrator = await createSecondAdministrator(fixture);
      await expect(
        services.periods.lock(fixture.administratorContext, resubmitted.version.id),
      ).rejects.toMatchObject({
        code: 'ATTENDANCE_PERIOD_INVALID_STATE',
        statusCode: 409,
      });

      const approved = await services.periods.approve(
        fixture.officerContext,
        resubmitted.version.id,
        {},
      );
      expect(approved.version.status).toBe('APPROVED');
      expect(approved.version.reviewedByMembershipId).toBe(fixture.memberships.officer);

      await expect(
        services.periods.lock(fixture.officerContext, resubmitted.version.id),
      ).rejects.toMatchObject({ code: 'ATTENDANCE_PERIOD_LOCK_FORBIDDEN', statusCode: 403 });

      const locked = await services.periods.lock(secondAdministrator, resubmitted.version.id);
      expect(locked.replay).toBe(false);
      expect(locked.dtrDocumentIds).toHaveLength(1);
      expect(locked.publication.publicationType).toBe('ORIGINAL');
      expect(locked.publication.factCount).toBe(3);
      expect(locked.publication.factMinutes).toBe(960);

      const period = await admin.attendancePeriod.findUniqueOrThrow({
        where: { id: fixture.periodId },
      });
      expect(period.status).toBe('FINALIZED');
      const version = await admin.attendancePeriodVersion.findUniqueOrThrow({
        where: { id: resubmitted.version.id },
      });
      expect(version.status).toBe('LOCKED');
      expect(version.lockedByMembershipId).toBe(secondAdministrator.membershipId);
      expect(version.reviewedByMembershipId).toBe(fixture.memberships.officer);
      expect(version.reconciliation).toMatchObject({ ok: true });

      const publication = await services.periods.findPublication(
        fixture.administratorContext,
        resubmitted.version.id,
      );
      expect(publication.publication.id).toBe(locked.publication.id);
      expect(publication.facts.map((fact) => fact.factType).sort()).toEqual([
        'EXPECTED',
        'UNDERTIME',
        'WORKED',
      ]);
      expect(publication.facts.every((fact) => fact.priorMinutes === null)).toBe(true);
      expect(publication.facts.every((fact) => fact.differenceDirection === null)).toBe(true);

      const dtrs = await services.dtrs.list(fixture.administratorContext, {
        attendancePeriodId: fixture.periodId,
      });
      expect(dtrs).toHaveLength(1);
      expect(dtrs[0]?.classification).toBe('ORIGINAL');

      const auditActions = await admin.auditEvent.findMany({
        where: { agencyId: fixture.agencyId, entityType: 'AttendancePeriodVersion' },
        select: { action: true },
        orderBy: { occurredAt: 'asc' },
      });
      expect(auditActions.map((event) => event.action)).toEqual([
        'ATTENDANCE_PERIOD_VERSION_SUBMITTED',
        'ATTENDANCE_PERIOD_VERSION_RETURNED',
        'ATTENDANCE_PERIOD_VERSION_SUBMITTED',
        'ATTENDANCE_PERIOD_VERSION_APPROVED',
        'ATTENDANCE_PERIOD_LOCKED',
      ]);
      const outbox = await admin.outboxEvent.findMany({
        where: { agencyId: fixture.agencyId, eventType: 'ATTENDANCE_PERIOD_LOCKED' },
      });
      expect(outbox).toHaveLength(1);
      expect(outbox[0]?.idempotencyKey).toBe(`attendance-period-lock:${resubmitted.version.id}`);

      const replay = await services.periods.lock(
        fixture.administratorContext,
        resubmitted.version.id,
      );
      expect(replay.replay).toBe(true);
      expect(replay.publication.id).toBe(locked.publication.id);
      expect(replay.dtrDocumentIds).toHaveLength(0);
      expect(replay.existingDtrDocumentIds).toEqual(locked.dtrDocumentIds);
      expect(
        await admin.attendancePayrollPublication.count({ where: { agencyId: fixture.agencyId } }),
      ).toBe(1);
      expect(
        await admin.attendancePayrollFact.count({ where: { agencyId: fixture.agencyId } }),
      ).toBe(3);
      expect(await admin.dtrDocument.count({ where: { agencyId: fixture.agencyId } })).toBe(1);

      await expect(
        admin.attendancePayrollPublication.update({
          where: { id: locked.publication.id },
          data: { publishedAt: new Date() },
        }),
      ).rejects.toThrow(/immutable/i);

      const foreignContext = {
        ...fixture.administratorContext,
        requestId: 'foreign-attendance-period',
        agencyId: '00000000-0000-4000-8000-000000000999',
      };
      await expect(
        services.periods.findById(foreignContext, resubmitted.version.id),
      ).rejects.toMatchObject({ code: 'ATTENDANCE_PERIOD_VERSION_NOT_FOUND' });
      await expect(
        services.periods.lock(foreignContext, resubmitted.version.id),
      ).rejects.toMatchObject({ code: 'ATTENDANCE_PERIOD_VERSION_NOT_FOUND' });
    } finally {
      await cleanupAttendanceWorkflowAgency(admin, fixture.agencyId, fixture.suffix);
      await admin.$disconnect();
    }
  },
);

it.skipIf(!enabled)(
  'keeps outside-schedule minutes out of the publication and serializes concurrent locks',
  async () => {
    const fixture = await createAttendanceWorkflowFixture({
      collectionAfterMinutes: 180,
      eventTimes: [
        ['TIME_IN', '08:00'],
        ['BREAK_OUT', '12:00'],
        ['BREAK_IN', '13:00'],
        ['TIME_OUT', '19:00'],
      ],
    });
    const { admin, services } = fixture;
    try {
      await activateLockRoute(fixture);
      await approveSubmission(fixture);
      const submitted = await services.periods.submitForReview(
        fixture.administratorContext,
        fixture.periodId,
      );
      const reconciliation = await services.periods.reconcile(
        fixture.administratorContext,
        submitted.version.id,
      );
      expect(reconciliation.ok).toBe(true);
      expect(reconciliation.payroll.factTypeMinutes).toMatchObject({
        EXPECTED: 480,
        WORKED: 480,
      });
      expect(reconciliation.payroll.excludedOutsideScheduleMinutes).toBe(120);

      await services.periods.approve(fixture.officerContext, submitted.version.id, {});
      const [first, second] = await Promise.all([
        services.periods.lock(fixture.administratorContext, submitted.version.id),
        services.periods.lock(fixture.administratorContext, submitted.version.id),
      ]);
      const replays = [first.replay, second.replay].sort();
      expect(replays).toEqual([false, true]);
      expect(first.publication.id).toBe(second.publication.id);
      const publication = await services.periods.findPublication(
        fixture.administratorContext,
        submitted.version.id,
      );
      expect(publication.facts.map((fact) => fact.factType).sort()).toEqual(['EXPECTED', 'WORKED']);
      expect(
        await admin.attendancePayrollFact.count({ where: { agencyId: fixture.agencyId } }),
      ).toBe(2);
      expect(await admin.dtrDocument.count({ where: { agencyId: fixture.agencyId } })).toBe(1);
    } finally {
      await cleanupAttendanceWorkflowAgency(admin, fixture.agencyId, fixture.suffix);
      await admin.$disconnect();
    }
  },
);

it.skipIf(!enabled)(
  'rejects a stale source binding at lock and leaves the version APPROVED with no partial outputs',
  async () => {
    const fixture = await createAttendanceWorkflowFixture();
    const { admin, services } = fixture;
    try {
      await activateLockRoute(fixture);
      await approveSubmission(fixture);
      const submitted = await services.periods.submitForReview(
        fixture.administratorContext,
        fixture.periodId,
      );
      await services.periods.approve(fixture.officerContext, submitted.version.id, {});

      const day = await admin.attendanceDay.findUniqueOrThrow({
        where: { id: fixture.attendanceDayId },
      });
      await admin.attendanceDay.update({
        where: { id: day.id },
        data: { isCurrent: false },
      });
      await admin.attendanceDay.create({
        data: {
          agencyId: day.agencyId,
          attendancePeriodId: day.attendancePeriodId,
          employeeId: day.employeeId,
          workDate: day.workDate,
          scheduleAssignmentId: day.scheduleAssignmentId,
          workScheduleVersionId: day.workScheduleVersionId,
          workArrangementVersionId: day.workArrangementVersionId,
          holidayCalendarVersionId: day.holidayCalendarVersionId,
          dayClassification: day.dayClassification,
          status: 'CALCULATED',
          expectedMinutes: day.expectedMinutes,
          workedMinutes: day.workedMinutes,
          coverageMinutes: day.coverageMinutes,
          lateMinutes: day.lateMinutes,
          undertimeMinutes: day.undertimeMinutes,
          absenceMinutes: day.absenceMinutes,
          officialBusinessMinutes: day.officialBusinessMinutes,
          officialTravelMinutes: day.officialTravelMinutes,
          trainingMinutes: day.trainingMinutes,
          approvedAbsenceMinutes: day.approvedAbsenceMinutes,
          postedLeaveMinutes: day.postedLeaveMinutes,
          outsideScheduleMinutes: day.outsideScheduleMinutes,
          statutoryNightWindowMinutes: day.statutoryNightWindowMinutes,
          calculationVersion: day.calculationVersion + 1,
          ruleSnapshot: day.ruleSnapshot as Prisma.InputJsonValue,
          isCurrent: true,
          calculatedAt: new Date(),
        },
      });

      const reconciliation = await services.periods.reconcile(
        fixture.administratorContext,
        submitted.version.id,
      );
      expect(reconciliation.ok).toBe(false);
      expect(reconciliation.failures.map((failure) => failure.code)).toContain(
        'SOURCE_BINDING_CHANGED',
      );

      await expect(
        services.periods.lock(fixture.administratorContext, submitted.version.id),
      ).rejects.toMatchObject({
        code: 'ATTENDANCE_PERIOD_RECONCILIATION_FAILED',
        statusCode: 409,
      });
      const version = await admin.attendancePeriodVersion.findUniqueOrThrow({
        where: { id: submitted.version.id },
      });
      expect(version.status).toBe('APPROVED');
      expect(version.lockedAt).toBeNull();
      const period = await admin.attendancePeriod.findUniqueOrThrow({
        where: { id: fixture.periodId },
      });
      expect(period.status).toBe('OPEN');
      expect(
        await admin.attendancePayrollPublication.count({ where: { agencyId: fixture.agencyId } }),
      ).toBe(0);
      expect(
        await admin.attendancePayrollFact.count({ where: { agencyId: fixture.agencyId } }),
      ).toBe(0);
      expect(await admin.dtrDocument.count({ where: { agencyId: fixture.agencyId } })).toBe(0);
      expect(await admin.outboxEvent.count({ where: { agencyId: fixture.agencyId } })).toBe(0);
    } finally {
      await cleanupAttendanceWorkflowAgency(admin, fixture.agencyId, fixture.suffix);
      await admin.$disconnect();
    }
  },
);

it.skipIf(!enabled)(
  'rolls back a failed lock transaction and leaves the version APPROVED',
  async () => {
    const fixture = await createAttendanceWorkflowFixture();
    const { admin, services } = fixture;
    try {
      await activateLockRoute(fixture);
      await approveSubmission(fixture);
      const submitted = await services.periods.submitForReview(
        fixture.administratorContext,
        fixture.periodId,
      );
      await services.periods.approve(fixture.officerContext, submitted.version.id, {});

      const failingPeriods = new AttendancePeriodsService(
        attendancePeriodAuditWriter,
        services.approvals,
        failingDtrsService(),
        services.days,
      );

      await expect(
        failingPeriods.lock(fixture.administratorContext, submitted.version.id),
      ).rejects.toThrow('Injected Finalized Daily Time Record failure.');

      const version = await admin.attendancePeriodVersion.findUniqueOrThrow({
        where: { id: submitted.version.id },
      });
      expect(version.status).toBe('APPROVED');
      expect(version.lockedAt).toBeNull();
      const period = await admin.attendancePeriod.findUniqueOrThrow({
        where: { id: fixture.periodId },
      });
      expect(period.status).toBe('OPEN');
      expect(
        await admin.attendancePayrollPublication.count({ where: { agencyId: fixture.agencyId } }),
      ).toBe(0);
      expect(
        await admin.attendancePayrollFact.count({ where: { agencyId: fixture.agencyId } }),
      ).toBe(0);
      expect(await admin.dtrDocument.count({ where: { agencyId: fixture.agencyId } })).toBe(0);
    } finally {
      await cleanupAttendanceWorkflowAgency(admin, fixture.agencyId, fixture.suffix);
      await admin.$disconnect();
    }
  },
);

it.skipIf(!enabled)(
  'refuses to lock when an approved Day gains an Attendance Context, then locks the corrected facts after recalculation and re-approval',
  async () => {
    const fixture = await createAttendanceWorkflowFixture();
    const { admin, services } = fixture;
    try {
      await activateLockRoute(fixture);
      await approveSubmission(fixture);
      const first = await services.periods.submitForReview(
        fixture.administratorContext,
        fixture.periodId,
      );
      await services.periods.approve(fixture.officerContext, first.version.id, {});

      const contextRecorder = {
        ...fixture.administratorContext,
        permissions: [
          ...fixture.administratorContext.permissions,
          { code: 'attendance.contexts.create', scopePolicy: 'AGENCY' as const },
        ],
      };
      await services.contexts.record(contextRecorder, {
        employeeId: fixture.employeeId,
        contextType: 'OFFICIAL_BUSINESS',
        coverageMode: 'TIMED',
        startsAt: `${fixture.workDate}T16:00:00+08:00`,
        endsAt: `${fixture.workDate}T17:00:00+08:00`,
        reason: 'Authorized official business after the approval.',
        evidenceDocumentVersionId: fixture.evidenceDocumentVersionId,
      });

      const employee = await admin.employee.findUniqueOrThrow({
        where: { id: fixture.employeeId },
        select: { employeeNumber: true },
      });
      const reconciliation = await services.periods.reconcile(
        fixture.administratorContext,
        first.version.id,
      );
      expect(reconciliation.ok).toBe(false);
      const changed = reconciliation.failures.find(
        (failure) => failure.code === 'DAY_INPUTS_CHANGED',
      );
      expect(changed?.message).toContain(employee.employeeNumber);
      expect(changed?.message).toContain(fixture.workDate);
      expect(changed?.details).toEqual({
        days: [
          {
            attendanceDayId: fixture.attendanceDayId,
            employeeId: fixture.employeeId,
            workDate: fixture.workDate,
          },
        ],
      });
      await expect(
        services.periods.lock(fixture.administratorContext, first.version.id),
      ).rejects.toMatchObject({
        code: 'ATTENDANCE_PERIOD_RECONCILIATION_FAILED',
        statusCode: 409,
        reasons: ['DAY_INPUTS_CHANGED'],
      });

      const period = await admin.attendancePeriod.findUniqueOrThrow({
        where: { id: fixture.periodId },
      });
      const recalculated = await services.days.calculate(fixture.administratorContext, {
        periodCode: period.code,
        dateFrom: fixture.workDate,
        dateTo: fixture.workDate,
        employeeIds: [fixture.employeeId],
      });
      expect(recalculated.recalculatedCount).toBe(1);
      const staleSubmissionIds = recalculated.days[0]?.staleSubmissionIds ?? [];
      expect(staleSubmissionIds).toHaveLength(1);
      expect(
        await admin.employeeAttendanceSubmission.findUniqueOrThrow({
          where: { id: staleSubmissionIds[0]! },
          select: { status: true },
        }),
      ).toEqual({ status: 'STALE' });

      const superseded = await services.periods.findById(
        fixture.administratorContext,
        first.version.id,
      );
      expect(superseded.version).toMatchObject({ status: 'APPROVED', supersededDayCount: 1 });

      await approveSubmission(fixture);
      const second = await services.periods.submitForReview(
        fixture.administratorContext,
        fixture.periodId,
      );
      expect(second.version.versionNo).toBe(2);
      await services.periods.approve(fixture.officerContext, second.version.id, {});
      const locked = await services.periods.lock(fixture.administratorContext, second.version.id);
      expect(locked.replay).toBe(false);

      const publication = await services.periods.findPublication(
        fixture.administratorContext,
        second.version.id,
      );
      const minutes = Object.fromEntries(
        publication.facts.map((fact) => [fact.factType, fact.correctedMinutes]),
      );
      expect(minutes).toEqual({ EXPECTED: 480, WORKED: 420, OFFICIAL_BUSINESS: 60 });

      await expect(
        services.periods.lock(fixture.administratorContext, first.version.id),
      ).rejects.toMatchObject({ code: 'ATTENDANCE_PERIOD_RECONCILIATION_FAILED' });
    } finally {
      await cleanupAttendanceWorkflowAgency(admin, fixture.agencyId, fixture.suffix);
      await admin.$disconnect();
    }
  },
);

it.skipIf(!enabled)(
  'makes a recalculation racing a lock wait, then refuses it once the period finalizes',
  async () => {
    const fixture = await createAttendanceWorkflowFixture();
    const { admin, services } = fixture;
    try {
      await approveSubmission(fixture);
      const period = await admin.attendancePeriod.findUniqueOrThrow({
        where: { id: fixture.periodId },
      });
      let settled = false;
      let recalculation: Promise<unknown> | undefined;
      // The admin transaction stands in for a lock holding the period row.
      await admin.$transaction(
        async (transaction) => {
          await transaction.$queryRaw`SELECT "id" FROM "attendance_periods"
            WHERE "id" = CAST(${fixture.periodId} AS uuid) FOR UPDATE`;
          recalculation = services.days
            .calculate(fixture.administratorContext, {
              periodCode: period.code,
              dateFrom: fixture.workDate,
              dateTo: fixture.workDate,
              employeeIds: [fixture.employeeId],
            })
            .finally(() => {
              settled = true;
            });
          recalculation.catch(() => undefined);
          await new Promise((resolve) => setTimeout(resolve, 500));
          expect(settled).toBe(false);
          await transaction.attendancePeriod.update({
            where: { id: fixture.periodId },
            data: { status: 'FINALIZED' },
          });
        },
        { timeout: 10_000 },
      );
      await expect(recalculation).rejects.toMatchObject({ code: 'ATTENDANCE_PERIOD_FINALIZED' });
      expect(
        await admin.attendanceDay.findUniqueOrThrow({
          where: { id: fixture.attendanceDayId },
          select: { isCurrent: true, status: true },
        }),
      ).toEqual({ isCurrent: true, status: 'APPROVED' });
    } finally {
      await cleanupAttendanceWorkflowAgency(admin, fixture.agencyId, fixture.suffix);
      await admin.$disconnect();
    }
  },
);
