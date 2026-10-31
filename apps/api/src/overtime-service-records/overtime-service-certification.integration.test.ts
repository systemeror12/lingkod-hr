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
import { AttendanceLockedDaysService } from '../attendance-locked-days/attendance-locked-days.service';
import type { LockedAttendanceDay } from '../attendance-locked-days/attendance-locked-days.types';
import {
  attendanceAdministratorPermissions,
  createAdminClient,
  createAttendanceWorkflowFixture,
  lockAttendancePeriod,
  manilaDate,
  manilaInstant,
  type AttendanceWorkflowFixture,
} from '../attendance-test-fixtures';
import { overtimeAuthorityAuditWriter } from '../overtime-authorities/overtime-authorities.audit';
import {
  cleanup,
  context,
  createAgency,
  enabled,
  errorOf,
} from '../overtime-authorities/overtime-authority-test-fixtures';
import { OvertimeServiceRecordsController } from './overtime-service-records.controller';
import { OvertimeServiceRecordsService } from './overtime-service-records.service';
import {
  approvedAuthority,
  cleanupAttendanceOvertime,
  linkEmployee,
  serviceGrants,
} from './overtime-service-test-fixtures';

const service = new OvertimeServiceRecordsService(
  overtimeAuthorityAuditWriter,
  new AttendanceLockedDaysService(),
);
const controller = new OvertimeServiceRecordsController(service);

const CERTIFIER_GRANTS = ['overtime.service.certify', 'overtime.service.reject'];
const OVERTIME_EVENTS = [
  ['TIME_IN', '08:00'],
  ['BREAK_OUT', '12:00'],
  ['BREAK_IN', '13:00'],
  ['TIME_OUT', '18:00'],
] as const;

/**
 * A service whose Attendance read returns the same locked facts for any Work
 * Date, so a test can reach facts a fixture cannot easily lock. Everything else,
 * including the certification write and its locks, stays real.
 */
function serviceReading(fixture: AttendanceWorkflowFixture, facts: Partial<LockedAttendanceDay>) {
  const lockedDays = {
    readInTransaction: async (
      _transaction: unknown,
      _agencyId: string,
      _employeeId: string,
      [workDate]: readonly string[],
    ) => [
      {
        status: 'LOCKED',
        workDate,
        attendancePeriodVersionId: fixture.periodId,
        attendanceDayId: fixture.attendanceDayId,
        calculationVersion: 1,
        outsideScheduleWorkedMinutes: 60,
        dayType: 'WORKDAY',
        holidayClassification: null,
        officialTravel: { minutes: 0, sourceIds: [] },
        workArrangementVersion: { id: fixture.attendanceDayId, arrangementType: 'ONSITE' },
        ...facts,
      },
    ],
  } as unknown as AttendanceLockedDaysService;
  return new OvertimeServiceRecordsService(overtimeAuthorityAuditWriter, lockedDays);
}

/** The fixture's HR Administrator, who is not the Employee, holding every service permission. */
function hrOf(fixture: AttendanceWorkflowFixture): RequestContext {
  return {
    ...fixture.administratorContext,
    permissions: [
      ...attendanceAdministratorPermissions,
      ...serviceGrants('AGENCY', [
        'overtime.service.record',
        'overtime.service.submit',
        ...CERTIFIER_GRANTS,
      ]),
    ],
  };
}

function authorityFor(fixture: AttendanceWorkflowFixture, authorizedHours?: string) {
  const dateFrom = manilaDate(-29);
  return approvedAuthority(fixture.admin, {
    agencyId: fixture.agencyId,
    requestingUnitId: fixture.unitId,
    approverMembershipId: fixture.memberships.officer,
    authorityNo: `OT-${fixture.suffix}`,
    workDateFrom: dateFrom < fixture.workDate ? dateFrom : fixture.workDate,
    workDateTo: manilaDate(0),
    employeeIds: [fixture.employeeId],
    ...(authorizedHours ? { authorizedHours } : {}),
  });
}

function recordFor(
  writer: OvertimeServiceRecordsService,
  fixture: AttendanceWorkflowFixture,
  overtimeAuthorityId: string,
  workDate = fixture.workDate,
) {
  return writer.record(hrOf(fixture), {
    overtimeAuthorityId,
    employeeId: fixture.employeeId,
    workDate,
    claimedHours: '1.5',
    accomplishment: 'Encoded the backlog of leave cards.',
  });
}

/** Two HR Administrators besides the fixture's, so correction approval and authorization stay separate. */
async function correctionActors(fixture: AttendanceWorkflowFixture) {
  const { admin, agencyId, suffix } = fixture;
  const permissions: RequestContext['permissions'] = [
    ...attendanceAdministratorPermissions,
    { code: 'attendance.corrections.create', scopePolicy: 'AGENCY' },
    { code: 'attendance.corrections.submit', scopePolicy: 'AGENCY' },
    { code: 'attendance.corrections.approve', scopePolicy: 'AGENCY' },
    { code: 'attendance.corrections.authorize_locked', scopePolicy: 'AGENCY' },
    { code: 'approvals.requests.read', scopePolicy: 'AGENCY' },
    { code: 'approvals.requests.create', scopePolicy: 'AGENCY' },
    { code: 'approvals.requests.approve', scopePolicy: 'AGENCY' },
  ];
  const role = await admin.role.findFirstOrThrow({
    where: { agencyId: null, code: 'hrmo_administrator' },
  });
  const contexts: RequestContext[] = [];
  for (const label of ['approver', 'authorizer']) {
    const user = await admin.user.create({
      data: {
        emailNormalized: `overtime-recheck-${label}-${suffix}@example.test`,
        displayName: `Overtime Recheck ${label}`,
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
      requestId: `overtime-recheck-${suffix}-${label}`,
      userId: user.id,
      membershipId: membership.id,
      permissions,
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
  const routeContext = {
    ...fixture.administratorContext,
    permissions: [
      ...attendanceAdministratorPermissions,
      { code: 'approvals.routes.create', scopePolicy: 'AGENCY' as const },
    ],
  };
  for (const { routeCode, steps } of [
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
  ]) {
    const route = await approvals.createRoute(routeContext, {
      routeCode,
      domain: 'ATTENDANCE',
      versionNo: 1,
      effectiveFrom: manilaDate(-30),
      stepDefinition: { steps },
    });
    await approvals.activateRoute(routeContext, route.id, `Activate ${routeCode}.`);
  }
  return { approver, authorizer, initiator: { ...fixture.administratorContext, permissions } };
}

/** Lengthen the fixture's time-out to 19:30 through an authorized Locked Attendance Adjustment. */
async function adjustLockedAttendance(
  fixture: AttendanceWorkflowFixture,
  actors: Awaited<ReturnType<typeof correctionActors>>,
) {
  const { admin, agencyId, suffix, memberships } = fixture;
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
  const document = await admin.document.create({
    data: {
      agencyId,
      documentNo: `OTR-${suffix}`,
      documentType: 'ATTENDANCE_CORRECTION_EVIDENCE',
      classification: 'INTERNAL',
      status: 'APPROVED',
      createdByMembershipId: memberships.administrator,
    },
  });
  const evidence = await admin.documentVersion.create({
    data: {
      agencyId,
      documentId: document.id,
      versionNo: 1,
      storageKey: `overtime-recheck/${suffix}`,
      contentHash: 'd'.repeat(64),
      mimeType: 'application/pdf',
      sizeBytes: 1,
      issuedAt: new Date(),
      createdByMembershipId: memberships.administrator,
    },
  });
  const created = await corrections.create(actors.initiator, {
    employeeId: fixture.employeeId,
    targetType: 'ATTENDANCE_EVENT',
    requestedAction: 'REPLACE',
    targetId: fixture.eventIds.TIME_OUT,
    requestedRecord: {
      eventType: 'TIME_OUT',
      eventTime: manilaInstant(fixture.workDate, '19:30').toISOString(),
    },
    reason: 'The Employee timed out after the overtime ended.',
    onBehalfReason: 'The Employee reported the missed time-out to HR.',
    evidence: [{ documentVersionId: evidence.id }],
  });
  await corrections.submit(actors.initiator, created.correction.id);
  await corrections.approve(actors.approver, created.correction.id, 'Factual approval.');
  await corrections.authorizeLocked(
    actors.authorizer,
    created.correction.id,
    'Locked adjustment authorized.',
  );
}

it.skipIf(!enabled)(
  'certifies within actual hours, refuses the Employee, and stops at CERTIFIED',
  async () => {
    const fixture = await createAttendanceWorkflowFixture({
      collectionAfterMinutes: 180,
      eventTimes: OVERTIME_EVENTS,
    });
    const { admin, agencyId, employeeId, memberships } = fixture;
    try {
      const authorityId = await authorityFor(fixture);
      const recorded = await recordFor(service, fixture, authorityId);
      const hr = hrOf(fixture);

      // Not yet submitted.
      await expect(
        service.certify(hr, recorded.id, { certifiedMinutes: 30 }),
      ).rejects.toMatchObject({ statusCode: 409, code: 'OVERTIME_SERVICE_STATUS_INVALID' });

      await lockAttendancePeriod(fixture, fixture.administratorContext);
      await service.submit(hr, recorded.id);

      // Holding only the other permission is not enough.
      const declineOnly = {
        ...hr,
        permissions: serviceGrants('AGENCY', ['overtime.service.reject']),
      };
      await expect(
        service.certify(declineOnly, recorded.id, { certifiedMinutes: 30 }),
      ).rejects.toMatchObject({ statusCode: 403, code: 'OVERTIME_SERVICE_FORBIDDEN' });
      const certifyOnly = {
        ...hr,
        permissions: serviceGrants('AGENCY', ['overtime.service.certify']),
      };
      await expect(
        service.decline(certifyOnly, recorded.id, { declineReason: 'No.' }),
      ).rejects.toMatchObject({ statusCode: 403, code: 'OVERTIME_SERVICE_FORBIDDEN' });

      // The Employee never decides their own service, even with an Agency grant.
      const self = {
        ...fixture.employeeContext,
        permissions: serviceGrants('AGENCY', CERTIFIER_GRANTS),
      };
      await expect(
        service.certify(self, recorded.id, { certifiedMinutes: 30 }),
      ).rejects.toMatchObject({ statusCode: 403, code: 'OVERTIME_SERVICE_SELF_CERTIFICATION' });
      await expect(
        service.decline(self, recorded.id, { declineReason: 'Mine.' }),
      ).rejects.toMatchObject({ statusCode: 403, code: 'OVERTIME_SERVICE_SELF_CERTIFICATION' });

      // Above actual hours (60 minutes) is refused, by the service and the database.
      await expect(
        service.certify(hr, recorded.id, { certifiedMinutes: 61 }),
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'OVERTIME_SERVICE_CERTIFIED_EXCEEDS_ACTUAL',
      });
      await expect(
        admin.overtimeServiceRecord.update({
          where: { id: recorded.id },
          data: {
            status: 'CERTIFIED',
            certifiedMinutes: 61,
            certifiedByMembershipId: memberships.officer,
            certifiedAt: new Date(),
          },
        }),
      ).rejects.toThrow(/certified_within_actual/);
      // A certification always names its certifier.
      await expect(
        admin.overtimeServiceRecord.update({
          where: { id: recorded.id },
          data: { status: 'CERTIFIED', certifiedMinutes: 30 },
        }),
      ).rejects.toThrow(/certifier_check/);

      // Malformed input stops at the controller.
      expect(
        await errorOf(controller.certify(agencyId, recorded.id, { certifiedMinutes: 0 }, hr)),
      ).toMatchObject({ status: 400, body: { error: { code: 'INVALID_INPUT' } } });

      // The recorder may certify; the certifier attests time net of breaks.
      const certified = await controller.certify(
        agencyId,
        recorded.id,
        { certifiedMinutes: 45 },
        hr,
      );
      expect(certified).toMatchObject({
        status: 'CERTIFIED',
        employeeId,
        actualMinutes: 60,
        certifiedMinutes: 45,
        declineReason: null,
        recordedByMembershipId: memberships.administrator,
        certifiedByMembershipId: memberships.administrator,
      });
      expect(certified.certifiedAt).not.toBeNull();
      expect(
        await admin.auditEvent.count({
          where: { entityId: recorded.id, action: 'OVERTIME_SERVICE_CERTIFIED' },
        }),
      ).toBe(1);

      // CERTIFIED is final.
      await expect(
        service.certify(hr, recorded.id, { certifiedMinutes: 45 }),
      ).rejects.toMatchObject({ statusCode: 409, code: 'OVERTIME_SERVICE_STATUS_INVALID' });
      await expect(
        service.decline(hr, recorded.id, { declineReason: 'Too late.' }),
      ).rejects.toMatchObject({ statusCode: 409, code: 'OVERTIME_SERVICE_STATUS_INVALID' });
    } finally {
      await cleanupAttendanceOvertime(fixture);
      await admin.$disconnect();
    }
  },
);

it.skipIf(!enabled)(
  'refuses certification after a Locked Attendance Adjustment, then declines to free the Work Date',
  async () => {
    const fixture = await createAttendanceWorkflowFixture({
      collectionAfterMinutes: 180,
      eventTimes: OVERTIME_EVENTS,
    });
    const { admin, workDate } = fixture;
    try {
      const actors = await correctionActors(fixture);
      const authorityId = await authorityFor(fixture);
      const recorded = await recordFor(service, fixture, authorityId);
      const hr = hrOf(fixture);
      await lockAttendancePeriod(fixture, actors.authorizer);
      await service.submit(hr, recorded.id);

      await adjustLockedAttendance(fixture, actors);

      // The reason names the change: 60 minutes at submission, 150 now.
      await expect(
        service.certify(hr, recorded.id, { certifiedMinutes: 30 }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'OVERTIME_SERVICE_ATTENDANCE_CHANGED',
        message: expect.stringMatching(new RegExp(`${workDate}.*60 actual.*150 minutes`)),
      });
      const unchanged = await admin.overtimeServiceRecord.findUniqueOrThrow({
        where: { id: recorded.id },
      });
      expect(unchanged).toMatchObject({
        status: 'FOR_CERTIFICATION',
        actualMinutes: 60,
        certifiedMinutes: null,
      });

      // A blank reason is refused, by the controller and the database.
      expect(
        await errorOf(
          controller.decline(fixture.agencyId, recorded.id, { declineReason: '   ' }, hr),
        ),
      ).toMatchObject({ status: 400, body: { error: { code: 'INVALID_INPUT' } } });
      await expect(
        admin.overtimeServiceRecord.update({
          where: { id: recorded.id },
          data: { status: 'NOT_CERTIFIED', declineReason: '   ' },
        }),
      ).rejects.toThrow(/decline_reason_check/);

      const declined = await controller.decline(
        fixture.agencyId,
        recorded.id,
        { declineReason: 'Attendance changed after submission.' },
        hr,
      );
      expect(declined).toMatchObject({
        status: 'NOT_CERTIFIED',
        declineReason: 'Attendance changed after submission.',
        certifiedMinutes: null,
        certifiedByMembershipId: null,
        certifiedAt: null,
      });
      expect(
        await admin.auditEvent.count({
          where: {
            entityId: recorded.id,
            action: 'OVERTIME_SERVICE_DECLINED',
            actorMembershipId: hr.membershipId,
          },
        }),
      ).toBe(1);

      // NOT_CERTIFIED is final, and the date is free for service read fresh.
      await expect(
        service.decline(hr, recorded.id, { declineReason: 'Again.' }),
      ).rejects.toMatchObject({ statusCode: 409, code: 'OVERTIME_SERVICE_STATUS_INVALID' });
      const again = await recordFor(service, fixture, authorityId);
      await expect(service.submit(hr, again.id)).resolves.toMatchObject({ actualMinutes: 150 });
      await expect(service.certify(hr, again.id, { certifiedMinutes: 150 })).resolves.toMatchObject(
        { status: 'CERTIFIED', certifiedMinutes: 150 },
      );
    } finally {
      await cleanupAttendanceOvertime(fixture);
      await admin.$disconnect();
    }
  },
);

it.skipIf(!enabled)(
  'refuses official travel and Work Arrangements without physical reporting, each with its reason',
  async () => {
    const fixture = await createAttendanceWorkflowFixture();
    const { admin } = fixture;
    try {
      const authorityId = await authorityFor(fixture);
      const recorded = await recordFor(service, fixture, authorityId);
      const hr = hrOf(fixture);
      await serviceReading(fixture, {}).submit(hr, recorded.id);
      const certify = (facts: Partial<LockedAttendanceDay>) =>
        serviceReading(fixture, facts).certify(hr, recorded.id, { certifiedMinutes: 30 });
      const arrangement = (arrangementType: string) => ({
        workArrangementVersion: { id: fixture.attendanceDayId, arrangementType },
      });

      const refusals: Array<[Partial<LockedAttendanceDay>, string]> = [
        [
          { officialTravel: { minutes: 240, sourceIds: [fixture.attendanceDayId] } },
          'OVERTIME_SERVICE_OFFICIAL_TRAVEL',
        ],
        [arrangement('WORK_FROM_HOME'), 'OVERTIME_SERVICE_ARRANGEMENT_NOT_PHYSICAL'],
        [arrangement('HYBRID'), 'OVERTIME_SERVICE_ARRANGEMENT_NOT_PHYSICAL'],
        [arrangement('OTHER'), 'OVERTIME_SERVICE_ARRANGEMENT_NO_AUTHORITY'],
      ];
      for (const [facts, code] of refusals) {
        await expect(certify(facts)).rejects.toMatchObject({ statusCode: 422, code });
      }
      await expect(certify(arrangement('OTHER'))).rejects.toThrow(/No authority was found/);
      await expect(certify(arrangement('FIELD'))).resolves.toMatchObject({ status: 'CERTIFIED' });
    } finally {
      await cleanupAttendanceOvertime(fixture);
      await admin.$disconnect();
    }
  },
);

it.skipIf(!enabled)(
  "keeps an Employee's certified total within authorized hours when two certifications race",
  async () => {
    const fixture = await createAttendanceWorkflowFixture();
    const { admin, agencyId, workDate } = fixture;
    try {
      // 90 authorized minutes: either 60-minute certification fits, both do not.
      const authorityId = await authorityFor(fixture, '1.5');
      const reading = serviceReading(fixture, {});
      const hr = hrOf(fixture);
      const earlier = manilaDate(-1) === workDate ? manilaDate(-2) : manilaDate(-1);
      const later = manilaDate(0);
      const records = await Promise.all(
        [earlier, later].map((date) => recordFor(reading, fixture, authorityId, date)),
      );
      for (const record of records) await reading.submit(hr, record.id);

      const results = await Promise.allSettled(
        records.map((record) => reading.certify(hr, record.id, { certifiedMinutes: 60 })),
      );
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const [refused] = results.filter((result) => result.status === 'rejected');
      expect(refused?.reason).toMatchObject({
        statusCode: 422,
        code: 'OVERTIME_SERVICE_CERTIFIED_EXCEEDS_AUTHORIZED',
        message: expect.stringMatching(/60 minutes.*60 already.*90 authorized/),
      });
      const certified = await admin.overtimeServiceRecord.aggregate({
        where: { agencyId, status: 'CERTIFIED' },
        _sum: { certifiedMinutes: true },
      });
      expect(certified._sum.certifiedMinutes).toBe(60);

      // What remains of the authorized hours can still be certified.
      const remaining = records.find((_, index) => results[index]?.status === 'rejected')!;
      await expect(
        reading.certify(hr, remaining.id, { certifiedMinutes: 30 }),
      ).resolves.toMatchObject({ status: 'CERTIFIED', certifiedMinutes: 30 });
    } finally {
      await cleanupAttendanceOvertime(fixture);
      await admin.$disconnect();
    }
  },
);

it.skipIf(!enabled)(
  'reaches a Supervisor only for Direct Reports, and no other Agency at all',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-overtime-certify`;
    const home = await createAgency(admin, suffix, 'CERT');
    const foreign = await createAgency(admin, suffix, 'CERTFOREIGN');
    try {
      const authorityId = await approvedAuthority(admin, {
        agencyId: home.agency.id,
        requestingUnitId: home.division.id,
        approverMembershipId: home.membership.id,
        authorityNo: 'OT-CERT-001',
        workDateFrom: '2026-06-01',
        workDateTo: '2026-06-30',
        employeeIds: [home.member.id, home.outsider.id],
      });
      const hr = context(home.agency.id, home.user.id, home.membership.id, serviceGrants('AGENCY'));
      const claim = (employeeId: string) => ({
        overtimeAuthorityId: authorityId,
        employeeId,
        workDate: '2026-06-10',
        claimedHours: '2',
        accomplishment: 'Prepared the procurement report.',
      });
      const report = await service.record(hr, claim(home.member.id));
      const outsider = await service.record(hr, claim(home.outsider.id));

      // Past the scope check the record is refused only for its status.
      await linkEmployee(home, home.membership.id, home.chief.id);
      const supervisor = context(
        home.agency.id,
        home.user.id,
        home.membership.id,
        serviceGrants('DIRECT_REPORTS', CERTIFIER_GRANTS),
      );
      await expect(
        service.certify(supervisor, report.id, { certifiedMinutes: 30 }),
      ).rejects.toMatchObject({ code: 'OVERTIME_SERVICE_STATUS_INVALID' });
      await expect(
        service.certify(supervisor, outsider.id, { certifiedMinutes: 30 }),
      ).rejects.toMatchObject({ statusCode: 403, code: 'OVERTIME_SERVICE_SCOPE_FORBIDDEN' });
      await expect(
        service.decline(supervisor, outsider.id, { declineReason: 'Not mine.' }),
      ).rejects.toMatchObject({ statusCode: 403, code: 'OVERTIME_SERVICE_SCOPE_FORBIDDEN' });

      // Migration 0138's baseline: Supervisors hold both, for Direct Reports only.
      const baseline = await admin.rolePermission.findMany({
        where: {
          role: { agencyId: null },
          permission: { code: { in: CERTIFIER_GRANTS } },
        },
        select: { scopePolicy: true, role: { select: { code: true } } },
      });
      expect(baseline).toHaveLength(2);
      expect(
        baseline.every(
          (grant) => grant.role.code === 'supervisor' && grant.scopePolicy === 'DIRECT_REPORTS',
        ),
      ).toBe(true);

      // Another Agency cannot reach the record, even with an Agency grant.
      const foreignHr = context(
        foreign.agency.id,
        foreign.user.id,
        foreign.membership.id,
        serviceGrants('AGENCY', CERTIFIER_GRANTS),
      );
      await expect(
        service.certify(foreignHr, report.id, { certifiedMinutes: 30 }),
      ).rejects.toMatchObject({ statusCode: 404, code: 'OVERTIME_SERVICE_RECORD_NOT_FOUND' });
      await expect(
        service.decline(foreignHr, report.id, { declineReason: 'Not ours.' }),
      ).rejects.toMatchObject({ statusCode: 404, code: 'OVERTIME_SERVICE_RECORD_NOT_FOUND' });
      expect(
        await errorOf(
          controller.certify(home.agency.id, report.id, { certifiedMinutes: 30 }, foreignHr),
        ),
      ).toMatchObject({
        status: 403,
        body: { error: { code: 'OVERTIME_SERVICE_WRITE_FORBIDDEN' } },
      });
      expect(
        await withDatabaseContext(
          { agencyId: foreign.agency.id, membershipId: foreign.membership.id },
          (transaction) => transaction.overtimeServiceRecord.count(),
        ),
      ).toBe(0);
    } finally {
      await cleanup(admin, [home.agency.id, foreign.agency.id], suffix);
      await admin.$disconnect();
    }
  },
);
