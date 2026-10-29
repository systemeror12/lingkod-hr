import type { PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { expect, it } from 'vitest';
import {
  approvalAuditWriter,
  ApprovalCompletionRegistry,
  ApprovalsService,
} from '../approvals/approval.service';
import { attendanceCorrectionAuditWriter } from '../attendance-corrections/attendance-corrections.audit';
import { AttendanceCorrectionsService } from '../attendance-corrections/attendance-corrections.service';
import {
  ATTENDANCE_CORRECTION_LOCKED_ROUTE_CODE,
  ATTENDANCE_CORRECTION_ROUTE_CODE,
} from '../attendance-corrections/attendance-corrections.types';
import {
  attendanceAdministratorPermissions,
  cleanupAttendanceWorkflowAgency,
  createAttendanceWorkflowFixture,
  lockAttendancePeriod,
  manilaDate,
  manilaInstant,
  type AttendanceWorkflowFixture,
} from '../attendance-test-fixtures';
import { AttendanceLockedDaysService } from './attendance-locked-days.service';

const enabled = process.env.DATABASE_E2E === 'true';

const correctionPermissions: RequestContext['permissions'] = [
  { code: 'attendance.corrections.create', scopePolicy: 'AGENCY' },
  { code: 'attendance.corrections.submit', scopePolicy: 'AGENCY' },
  { code: 'attendance.corrections.approve', scopePolicy: 'AGENCY' },
  { code: 'attendance.corrections.authorize_locked', scopePolicy: 'AGENCY' },
  { code: 'approvals.requests.read', scopePolicy: 'AGENCY' },
  { code: 'approvals.requests.create', scopePolicy: 'AGENCY' },
  { code: 'approvals.requests.approve', scopePolicy: 'AGENCY' },
];

const lockedDays = new AttendanceLockedDaysService();

function read(fixture: AttendanceWorkflowFixture, employeeId: string, workDates: string[]) {
  return withDatabaseContext(
    { agencyId: fixture.agencyId, membershipId: fixture.memberships.administrator },
    (transaction) =>
      lockedDays.readInTransaction(transaction, fixture.agencyId, employeeId, workDates),
  );
}

/** Two HR Administrators besides the fixture's, so approval and authorization stay separate. */
async function correctionActors(fixture: AttendanceWorkflowFixture) {
  const { admin, agencyId, suffix } = fixture;
  const role = await admin.role.findFirstOrThrow({
    where: { agencyId: null, code: 'hrmo_administrator' },
  });
  const contexts: RequestContext[] = [];
  for (const label of ['approver', 'authorizer']) {
    const user = await admin.user.create({
      data: {
        emailNormalized: `attendance-locked-day-${label}-${suffix}@example.test`,
        displayName: `Attendance Locked Day ${label}`,
        globalStatus: 'ACTIVE',
      },
    });
    const membership = await admin.agencyMembership.create({
      data: { agencyId, userId: user.id, status: 'ACTIVE' },
    });
    await admin.membershipRole.create({
      data: {
        agencyId,
        membershipId: membership.id,
        roleId: role.id,
        effectiveFrom: new Date('2020-01-01'),
      },
    });
    contexts.push({
      ...fixture.administratorContext,
      requestId: `attendance-locked-day-${suffix}-${label}`,
      userId: user.id,
      membershipId: membership.id,
      permissions: [...attendanceAdministratorPermissions, ...correctionPermissions],
    });
  }
  const [approver, authorizer] = contexts as [RequestContext, RequestContext];
  const approvals = new ApprovalsService(approvalAuditWriter, new ApprovalCompletionRegistry());
  const step = (stepNo: number, permission: string, membershipId: string) => ({
    stepNo,
    stepMode: 'SEQUENTIAL' as const,
    requiredPermission: permission,
    assignment: { kind: 'MEMBERSHIP' as const, membershipId },
    requiresSeparateReview: true,
  });
  const routes = [
    {
      routeCode: ATTENDANCE_CORRECTION_ROUTE_CODE,
      steps: [step(1, 'attendance.corrections.approve', approver.membershipId)],
    },
    {
      routeCode: ATTENDANCE_CORRECTION_LOCKED_ROUTE_CODE,
      steps: [
        step(1, 'attendance.corrections.approve', approver.membershipId),
        step(2, 'attendance.corrections.authorize_locked', authorizer.membershipId),
      ],
    },
  ];
  const routeContext = {
    ...fixture.administratorContext,
    permissions: [
      ...attendanceAdministratorPermissions,
      { code: 'approvals.routes.create', scopePolicy: 'AGENCY' as const },
    ],
  };
  for (const { routeCode, steps } of routes) {
    const route = await approvals.createRoute(routeContext, {
      routeCode,
      domain: 'ATTENDANCE',
      versionNo: 1,
      effectiveFrom: manilaDate(-30),
      stepDefinition: { steps },
    });
    await approvals.activateRoute(routeContext, route.id, `Activate ${routeCode}.`);
  }
  return { approver, authorizer };
}

function correctionsService(fixture: AttendanceWorkflowFixture) {
  const registry = new ApprovalCompletionRegistry();
  const corrections = new AttendanceCorrectionsService(
    attendanceCorrectionAuditWriter,
    new ApprovalsService(approvalAuditWriter, registry),
    registry,
    fixture.services.days,
    fixture.services.attendance,
    fixture.services.documents,
    fixture.services.dtrs,
    fixture.services.periods,
  );
  corrections.onModuleInit();
  return corrections;
}

async function cleanup(fixture: AttendanceWorkflowFixture): Promise<void> {
  const { admin, agencyId } = fixture;
  await admin.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    await transaction.lockedAttendanceAdjustmentPeriod.deleteMany({ where: { agencyId } });
    await transaction.lockedAttendanceAdjustment.deleteMany({ where: { agencyId } });
    await transaction.attendanceCorrectionEffect.deleteMany({ where: { agencyId } });
    await transaction.attendanceCorrectionEvidence.deleteMany({ where: { agencyId } });
    await transaction.attendanceCorrection.deleteMany({ where: { agencyId } });
    await transaction.approvalDecision.deleteMany({ where: { agencyId } });
    await transaction.approvalStep.deleteMany({ where: { agencyId } });
    await transaction.approvalRequest.deleteMany({ where: { agencyId } });
    await transaction.approvalRouteVersion.deleteMany({ where: { agencyId } });
  });
  await cleanupAttendanceWorkflowAgency(admin, agencyId, fixture.suffix);
}

async function createOtherAgencyEmployee(admin: PrismaClient, suffix: string) {
  const agency = await admin.agency.create({
    data: {
      code: `ALD-OTHER-${suffix}`,
      name: 'Attendance Locked Day Other Agency',
      agencyType: 'NGA',
      status: 'ACTIVE',
    },
  });
  const user = await admin.user.create({
    data: {
      emailNormalized: `attendance-locked-day-other-${suffix}@example.test`,
      displayName: 'Attendance Locked Day Other',
      globalStatus: 'ACTIVE',
    },
  });
  const membership = await admin.agencyMembership.create({
    data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
  });
  const employee = await admin.employee.create({
    data: {
      agencyId: agency.id,
      employeeNumber: `ALD-OTHER-${suffix}`,
      legalName: 'Other Agency Employee',
      birthDate: new Date('1990-01-01'),
      sex: 'FEMALE',
      civilStatus: 'SINGLE',
      contactEmail: `attendance-locked-day-other-employee-${suffix}@example.test`,
      serviceStatus: 'ACTIVE',
      createdByMembershipId: membership.id,
      updatedByMembershipId: membership.id,
    },
  });
  return { agencyId: agency.id, employeeId: employee.id };
}

async function cleanupOtherAgency(admin: PrismaClient, agencyId: string, suffix: string) {
  await admin.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    await transaction.employee.deleteMany({ where: { agencyId } });
    await transaction.agencyMembership.deleteMany({ where: { agencyId } });
    await transaction.agency.delete({ where: { id: agencyId } });
    await transaction.user.deleteMany({
      where: { emailNormalized: `attendance-locked-day-other-${suffix}@example.test` },
    });
  });
}

it.skipIf(!enabled)(
  "reads an Employee's locked outside-schedule minutes and follows a Locked Attendance Adjustment's successor",
  async () => {
    const fixture = await createAttendanceWorkflowFixture({
      collectionAfterMinutes: 180,
      eventTimes: [
        ['TIME_IN', '08:00'],
        ['BREAK_OUT', '12:00'],
        ['BREAK_IN', '13:00'],
        ['TIME_OUT', '18:00'],
      ],
    });
    const { admin, workDate, employeeId } = fixture;
    const uncoveredDate = manilaDate(-60);
    try {
      const actors = await correctionActors(fixture);

      // Calculated but unlocked attendance is not a fact Overtime may read.
      expect(await read(fixture, employeeId, [workDate, uncoveredDate])).toEqual([
        { status: 'NOT_LOCKED', workDate },
        { status: 'NOT_LOCKED', workDate: uncoveredDate },
      ]);

      const predecessorVersionId = await lockAttendancePeriod(fixture, actors.authorizer);
      const arrangementVersion = await admin.attendanceDay.findUniqueOrThrow({
        where: { id: fixture.attendanceDayId },
        select: { workArrangementVersion: { select: { id: true } } },
      });
      const locked = await read(fixture, employeeId, [uncoveredDate, workDate]);
      expect(locked).toEqual([
        { status: 'NOT_LOCKED', workDate: uncoveredDate },
        {
          status: 'LOCKED',
          workDate,
          attendancePeriodVersionId: predecessorVersionId,
          attendanceDayId: fixture.attendanceDayId,
          calculationVersion: 1,
          outsideScheduleWorkedMinutes: 60,
          dayType: 'WORKDAY',
          holidayClassification: null,
          officialTravel: { minutes: 0, sourceIds: [] },
          workArrangementVersion: {
            id: arrangementVersion.workArrangementVersion!.id,
            arrangementType: 'ONSITE',
          },
        },
      ]);
      expect(JSON.stringify(locked)).not.toMatch(/rate|amount|money|ratio/i);

      const evidenceDocument = await admin.document.create({
        data: {
          agencyId: fixture.agencyId,
          documentNo: `ALD-${fixture.suffix}`,
          documentType: 'ATTENDANCE_CORRECTION_EVIDENCE',
          classification: 'INTERNAL',
          status: 'APPROVED',
          createdByMembershipId: fixture.memberships.administrator,
        },
      });
      const evidence = await admin.documentVersion.create({
        data: {
          agencyId: fixture.agencyId,
          documentId: evidenceDocument.id,
          versionNo: 1,
          storageKey: `attendance-locked-days/${fixture.suffix}`,
          contentHash: 'd'.repeat(64),
          mimeType: 'application/pdf',
          sizeBytes: 1,
          issuedAt: new Date(),
          createdByMembershipId: fixture.memberships.administrator,
        },
      });
      const corrections = correctionsService(fixture);
      const initiator: RequestContext = {
        ...fixture.administratorContext,
        permissions: [...attendanceAdministratorPermissions, ...correctionPermissions],
      };
      const created = await corrections.create(initiator, {
        employeeId,
        targetType: 'ATTENDANCE_EVENT',
        requestedAction: 'REPLACE',
        targetId: fixture.eventIds.TIME_OUT,
        requestedRecord: {
          eventType: 'TIME_OUT',
          eventTime: manilaInstant(workDate, '19:30').toISOString(),
        },
        reason: 'The Employee timed out after the overtime ended.',
        onBehalfReason: 'The Employee reported the missed time-out to HR.',
        evidence: [{ documentVersionId: evidence.id }],
      });
      await corrections.submit(initiator, created.correction.id);
      await corrections.approve(actors.approver, created.correction.id, 'Factual approval.');
      const applied = await corrections.authorizeLocked(
        actors.authorizer,
        created.correction.id,
        'Locked adjustment authorized.',
      );
      const successorVersionId = applied.lockedAdjustment!.periods[0]!.successorPeriodVersionId;

      const [successor] = await read(fixture, employeeId, [workDate]);
      expect(successor).toMatchObject({
        status: 'LOCKED',
        attendancePeriodVersionId: successorVersionId,
        calculationVersion: 2,
        outsideScheduleWorkedMinutes: 150,
        dayType: 'WORKDAY',
      });
      expect(successor).not.toMatchObject({ attendanceDayId: fixture.attendanceDayId });
    } finally {
      await cleanup(fixture);
      await admin.$disconnect();
    }
  },
);

it.skipIf(!enabled)("refuses another Agency's Employee and malformed Work Dates", async () => {
  const fixture = await createAttendanceWorkflowFixture();
  const other = await createOtherAgencyEmployee(fixture.admin, fixture.suffix);
  try {
    await expect(read(fixture, other.employeeId, [fixture.workDate])).rejects.toMatchObject({
      statusCode: 404,
      code: 'ATTENDANCE_LOCKED_DAY_EMPLOYEE_NOT_FOUND',
    });
    await expect(read(fixture, fixture.employeeId, ['2026-02-30'])).rejects.toMatchObject({
      statusCode: 400,
      code: 'ATTENDANCE_LOCKED_DAY_INVALID_DATE',
    });
  } finally {
    await cleanupOtherAgency(fixture.admin, other.agencyId, fixture.suffix);
    await cleanupAttendanceWorkflowAgency(fixture.admin, fixture.agencyId, fixture.suffix);
    await fixture.admin.$disconnect();
  }
});
