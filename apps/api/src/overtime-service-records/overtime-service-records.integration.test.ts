import type { PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { expect, it } from 'vitest';
import { AttendanceLockedDaysService } from '../attendance-locked-days/attendance-locked-days.service';
import {
  attendanceAdministratorPermissions,
  cleanupAttendanceWorkflowAgency,
  createAdminClient,
  createAttendanceWorkflowFixture,
  lockAttendancePeriod,
} from '../attendance-test-fixtures';
import { overtimeAuthorityAuditWriter } from '../overtime-authorities/overtime-authorities.audit';
import {
  APPROVER_GRANTS,
  addMember,
  cleanup,
  context,
  createAgency,
  enabled,
  errorOf,
  services as authorityServices,
  type AgencyFixture,
} from '../overtime-authorities/overtime-authority-test-fixtures';
import { OvertimeServiceRecordsController } from './overtime-service-records.controller';
import { OvertimeServiceRecordsService } from './overtime-service-records.service';
import type { OvertimeServiceRecordInput } from './overtime-service-records.types';

const service = new OvertimeServiceRecordsService(
  overtimeAuthorityAuditWriter,
  new AttendanceLockedDaysService(),
);
const controller = new OvertimeServiceRecordsController(service);

function serviceGrants(
  scopePolicy: 'AGENCY' | 'DIRECT_REPORTS' | 'OWN',
  codes = ['overtime.service.record', 'overtime.service.submit'],
): RequestContext['permissions'] {
  return codes.map((code) => ({ code, scopePolicy }));
}

/**
 * Create an authority as a DRAFT, the only status that accepts covered
 * Employees, then approve it directly; approval itself is #532's to test.
 */
async function approvedAuthority(
  admin: PrismaClient,
  options: {
    agencyId: string;
    requestingUnitId: string;
    approverMembershipId: string;
    authorityNo: string;
    workDateFrom: string;
    workDateTo: string;
    employeeIds: string[];
    status?: 'APPROVED' | 'DRAFT';
  },
): Promise<string> {
  const authority = await admin.overtimeAuthority.create({
    data: {
      agencyId: options.agencyId,
      requestingUnitId: options.requestingUnitId,
      authorityNo: options.authorityNo,
      purpose: 'Year-end closing of accounts.',
      workDateFrom: new Date(options.workDateFrom),
      workDateTo: new Date(options.workDateTo),
      compensationMethod: 'COC',
      status: 'DRAFT',
    },
  });
  await admin.overtimeAuthorityEmployee.createMany({
    data: options.employeeIds.map((employeeId) => ({
      agencyId: options.agencyId,
      overtimeAuthorityId: authority.id,
      employeeId,
      authorizedHours: '16',
    })),
  });
  if (options.status !== 'DRAFT') {
    await admin.overtimeAuthority.update({
      where: { id: authority.id },
      data: {
        status: 'APPROVED',
        approvedByMembershipId: options.approverMembershipId,
        approvedAt: new Date(),
      },
    });
  }
  return authority.id;
}

/** Link an Agency Membership to an Employee, as the Membership's own User. */
function linkEmployee(home: AgencyFixture, membershipId: string, employeeId: string) {
  return withDatabaseContext(
    {
      agencyId: home.agency.id,
      membershipId: home.membership.id,
      capabilities: ['employee-membership-link'],
    },
    (transaction) =>
      transaction.agencyMembership.update({
        where: { agencyId_id: { agencyId: home.agency.id, id: membershipId } },
        data: { employeeId },
      }),
  );
}

it.skipIf(!enabled)(
  'records service only under an approved authority covering the Employee and Work Date, within scope and Agency',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-overtime-service`;
    const home = await createAgency(admin, suffix, 'SVC');
    const foreign = await createAgency(admin, suffix, 'SVCFOREIGN');
    try {
      const authority = (
        authorityNo: string,
        extra: Partial<Parameters<typeof approvedAuthority>[1]> = {},
      ) =>
        approvedAuthority(admin, {
          agencyId: home.agency.id,
          requestingUnitId: home.division.id,
          approverMembershipId: home.membership.id,
          authorityNo,
          workDateFrom: '2030-06-01',
          workDateTo: '2030-06-30',
          employeeIds: [home.member.id, home.outsider.id],
          ...extra,
        });
      const approvedId = await authority('OT-SVC-001');
      const draftId = await authority('OT-SVC-002', { status: 'DRAFT' });
      const hr = context(home.agency.id, home.user.id, home.membership.id, serviceGrants('AGENCY'));
      const claim = (overrides: Partial<OvertimeServiceRecordInput> = {}) => ({
        overtimeAuthorityId: approvedId,
        employeeId: home.member.id,
        workDate: '2030-06-10',
        claimedHours: '3.5',
        accomplishment: 'Reconciled the June disbursement vouchers.',
        ...overrides,
      });

      // No approved authority covering the Employee and Work Date, no record.
      for (const [input, reason] of [
        [claim({ overtimeAuthorityId: draftId }), 'is DRAFT, not APPROVED'],
        [claim({ workDate: '2030-07-01' }), 'does not cover this Work Date'],
        [claim({ employeeId: home.chief.id }), 'does not cover this Employee'],
      ] as const) {
        await expect(service.record(hr, input)).rejects.toMatchObject({
          statusCode: 422,
          code: 'OVERTIME_SERVICE_NOT_AUTHORIZED',
          message: expect.stringContaining(reason),
        });
      }
      // The database refuses the same, whoever writes.
      const draftCoverage = await admin.overtimeAuthorityEmployee.findFirstOrThrow({
        where: { overtimeAuthorityId: draftId, employeeId: home.member.id },
      });
      await expect(
        admin.overtimeServiceRecord.create({
          data: {
            agencyId: home.agency.id,
            overtimeAuthorityEmployeeId: draftCoverage.id,
            employeeId: home.member.id,
            workDate: new Date('2030-06-10'),
            claimedHours: '1',
            accomplishment: 'Unauthorized.',
            status: 'RENDERED',
            recordedByMembershipId: home.membership.id,
          },
        }),
      ).rejects.toThrow(/No APPROVED Overtime Authority covers/);
      expect(await admin.overtimeServiceRecord.count({ where: { agencyId: home.agency.id } })).toBe(
        0,
      );

      // An Employee records only their own service.
      const memberContext = await addMember(
        admin,
        home,
        suffix,
        'svc-member',
        'employee',
        serviceGrants('OWN'),
      );
      await linkEmployee(home, memberContext.membershipId, home.member.id);
      await expect(
        service.record(memberContext, claim({ employeeId: home.outsider.id })),
      ).rejects.toMatchObject({ statusCode: 403, code: 'OVERTIME_SERVICE_SCOPE_FORBIDDEN' });
      const recorded = await controller.record(home.agency.id, claim(), memberContext);
      expect(recorded).toMatchObject({
        overtimeAuthorityId: approvedId,
        authorityNo: 'OT-SVC-001',
        employeeId: home.member.id,
        workDate: '2030-06-10',
        claimedHours: '3.5000',
        authorizedHours: '16.0000',
        accomplishment: 'Reconciled the June disbursement vouchers.',
        actualMinutes: null,
        sourceAttendanceDayId: null,
        dayClassification: null,
        status: 'RENDERED',
        recordedByMembershipId: memberContext.membershipId,
      });
      expect(
        await admin.auditEvent.count({
          where: { entityId: recorded.id, action: 'OVERTIME_SERVICE_RECORDED' },
        }),
      ).toBe(1);

      // A Supervisor records for a direct report, not for anyone else.
      await linkEmployee(home, home.membership.id, home.chief.id);
      const supervisor = context(
        home.agency.id,
        home.user.id,
        home.membership.id,
        serviceGrants('DIRECT_REPORTS'),
      );
      await expect(
        service.record(supervisor, claim({ employeeId: home.outsider.id })),
      ).rejects.toMatchObject({ statusCode: 403, code: 'OVERTIME_SERVICE_SCOPE_FORBIDDEN' });
      await expect(
        service.record(supervisor, claim({ workDate: '2030-06-11' })),
      ).resolves.toMatchObject({ status: 'RENDERED', recordedByMembershipId: home.membership.id });

      // Submitting needs `overtime.service.submit`.
      const recordOnly = context(
        home.agency.id,
        home.user.id,
        home.membership.id,
        serviceGrants('AGENCY', ['overtime.service.record']),
      );
      await expect(service.submit(recordOnly, recorded.id)).rejects.toMatchObject({
        statusCode: 403,
        code: 'OVERTIME_SERVICE_FORBIDDEN',
      });

      // A Work Date without locked Attendance cannot be submitted, and says so.
      await expect(service.submit(memberContext, recorded.id)).rejects.toMatchObject({
        statusCode: 409,
        code: 'OVERTIME_SERVICE_ATTENDANCE_NOT_LOCKED',
        message: expect.stringContaining('Attendance for 2030-06-10 is not locked'),
      });

      // Another Agency sees neither the authority nor the record.
      const foreignHr = context(
        foreign.agency.id,
        foreign.user.id,
        foreign.membership.id,
        serviceGrants('AGENCY'),
      );
      await expect(
        service.record(foreignHr, claim({ workDate: '2030-06-12' })),
      ).rejects.toMatchObject({
        statusCode: 404,
        code: 'OVERTIME_AUTHORITY_NOT_FOUND',
      });
      await expect(service.submit(foreignHr, recorded.id)).rejects.toMatchObject({
        statusCode: 404,
        code: 'OVERTIME_SERVICE_RECORD_NOT_FOUND',
      });
      expect(await errorOf(controller.record(home.agency.id, claim(), foreignHr))).toMatchObject({
        status: 403,
        body: { error: { code: 'OVERTIME_SERVICE_WRITE_FORBIDDEN' } },
      });
      expect(
        await withDatabaseContext(
          { agencyId: foreign.agency.id, membershipId: foreign.membership.id },
          (transaction) => transaction.overtimeServiceRecord.count(),
        ),
      ).toBe(0);

      // What was recorded is retained and never rewritten.
      await expect(
        admin.overtimeServiceRecord.update({
          where: { id: recorded.id },
          data: { claimedHours: '8' },
        }),
      ).rejects.toThrow(/cannot be rewritten/);
      await expect(
        admin.overtimeServiceRecord.delete({ where: { id: recorded.id } }),
      ).rejects.toThrow(/cannot be deleted/);
    } finally {
      await cleanup(admin, [home.agency.id, foreign.agency.id], suffix);
      await admin.$disconnect();
    }
  },
);

it.skipIf(!enabled)(
  'keeps one live record per Employee and Work Date across authorities when two race',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-overtime-service-race`;
    const home = await createAgency(admin, suffix, 'RACE');
    try {
      const authority = (authorityNo: string) =>
        approvedAuthority(admin, {
          agencyId: home.agency.id,
          requestingUnitId: home.division.id,
          approverMembershipId: home.membership.id,
          authorityNo,
          workDateFrom: '2030-06-01',
          workDateTo: '2030-06-30',
          employeeIds: [home.member.id],
        });
      const [first, second] = [await authority('OT-RACE-001'), await authority('OT-RACE-002')];
      const hr = context(home.agency.id, home.user.id, home.membership.id, serviceGrants('AGENCY'));
      const claim = (overtimeAuthorityId: string) => ({
        overtimeAuthorityId,
        employeeId: home.member.id,
        workDate: '2030-06-10',
        claimedHours: '2',
        accomplishment: 'Prepared the procurement report.',
      });

      const results = await Promise.allSettled([
        service.record(hr, claim(first)),
        service.record(hr, claim(second)),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const [refused] = results.filter((result) => result.status === 'rejected');
      expect(refused?.reason).toMatchObject({
        statusCode: 409,
        code: 'OVERTIME_SERVICE_DATE_TAKEN',
      });
      expect(
        await admin.overtimeServiceRecord.count({
          where: { agencyId: home.agency.id, employeeId: home.member.id },
        }),
      ).toBe(1);
    } finally {
      await cleanup(admin, [home.agency.id], suffix);
      await admin.$disconnect();
    }
  },
);

it.skipIf(!enabled)(
  'refuses to cancel an approved authority once service is recorded, even when the two race',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-overtime-service-cancel`;
    const home = await createAgency(admin, suffix, 'CANCEL');
    try {
      const { cancel } = authorityServices();
      const approver = await addMember(
        admin,
        home,
        suffix,
        'svc-approver',
        'appointing_authority',
        APPROVER_GRANTS,
      );
      const authority = (authorityNo: string) =>
        approvedAuthority(admin, {
          agencyId: home.agency.id,
          requestingUnitId: home.division.id,
          approverMembershipId: approver.membershipId,
          authorityNo,
          workDateFrom: '2030-06-01',
          workDateTo: '2030-06-30',
          employeeIds: [home.member.id],
        });
      const hr = context(home.agency.id, home.user.id, home.membership.id, serviceGrants('AGENCY'));
      const claim = (overtimeAuthorityId: string, workDate: string) => ({
        overtimeAuthorityId,
        employeeId: home.member.id,
        workDate,
        claimedHours: '2',
        accomplishment: 'Prepared the procurement report.',
      });

      const recordedId = await authority('OT-CANCEL-001');
      await service.record(hr, claim(recordedId, '2030-06-10'));
      await expect(cancel.execute(approver, recordedId)).rejects.toMatchObject({
        statusCode: 409,
        code: 'OVERTIME_AUTHORITY_SERVICE_RECORDED',
      });

      // Whichever wins, an authority is never both cancelled and recorded under.
      const racedId = await authority('OT-CANCEL-002');
      const [recording, cancelling] = await Promise.allSettled([
        service.record(hr, claim(racedId, '2030-06-11')),
        cancel.execute(approver, racedId),
      ]);
      expect([recording.status, cancelling.status].sort()).toEqual(['fulfilled', 'rejected']);
      const raced = await admin.overtimeAuthority.findUniqueOrThrow({ where: { id: racedId } });
      const records = await admin.overtimeServiceRecord.count({
        where: { authorityEmployee: { overtimeAuthorityId: racedId } },
      });
      expect({ status: raced.status, records }).toEqual(
        cancelling.status === 'fulfilled'
          ? { status: 'CANCELLED', records: 0 }
          : { status: 'APPROVED', records: 1 },
      );

      // With no service recorded, the Approving Official may still cancel.
      const unusedId = await authority('OT-CANCEL-003');
      await expect(cancel.execute(approver, unusedId)).resolves.toMatchObject({
        status: 'CANCELLED',
      });
    } finally {
      await cleanup(admin, [home.agency.id], suffix);
      await admin.$disconnect();
    }
  },
);

it.skipIf(!enabled)(
  'submits for certification with the Actual Overtime Hours of the locked Attendance Day',
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
    const { admin, agencyId, employeeId, workDate } = fixture;
    try {
      const authorityId = await approvedAuthority(admin, {
        agencyId,
        requestingUnitId: fixture.unitId,
        approverMembershipId: fixture.memberships.officer,
        authorityNo: `OT-ATT-${fixture.suffix}`,
        workDateFrom: workDate,
        workDateTo: workDate,
        employeeIds: [employeeId],
      });
      const hr: RequestContext = {
        ...fixture.administratorContext,
        permissions: [...attendanceAdministratorPermissions, ...serviceGrants('AGENCY')],
      };
      const recorded = await service.record(hr, {
        overtimeAuthorityId: authorityId,
        employeeId,
        workDate,
        claimedHours: '1.5',
        accomplishment: 'Encoded the backlog of leave cards.',
      });

      // Calculated but unlocked Attendance is not enough.
      await expect(service.submit(hr, recorded.id)).rejects.toMatchObject({
        code: 'OVERTIME_SERVICE_ATTENDANCE_NOT_LOCKED',
      });

      await lockAttendancePeriod(fixture, fixture.administratorContext);
      const submitted = await service.submit(hr, recorded.id);
      expect(submitted).toMatchObject({
        status: 'FOR_CERTIFICATION',
        claimedHours: '1.5000',
        authorizedHours: '16.0000',
        actualMinutes: 60,
        sourceAttendanceDayId: fixture.attendanceDayId,
        dayClassification: 'WORKDAY',
      });
      await expect(service.submit(hr, recorded.id)).rejects.toMatchObject({
        statusCode: 409,
        code: 'OVERTIME_SERVICE_STATUS_INVALID',
      });
      expect(
        await admin.auditEvent.count({
          where: { entityId: recorded.id, action: 'OVERTIME_SERVICE_SUBMITTED' },
        }),
      ).toBe(1);
    } finally {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.overtimeServiceRecord.deleteMany({ where: { agencyId } });
        await transaction.overtimeAuthorityEmployee.deleteMany({ where: { agencyId } });
        await transaction.overtimeAuthority.deleteMany({ where: { agencyId } });
        await transaction.approvalDecision.deleteMany({ where: { agencyId } });
        await transaction.approvalStep.deleteMany({ where: { agencyId } });
        await transaction.approvalRequest.deleteMany({ where: { agencyId } });
        await transaction.approvalRouteVersion.deleteMany({ where: { agencyId } });
      });
      await cleanupAttendanceWorkflowAgency(admin, agencyId, fixture.suffix);
      await admin.$disconnect();
    }
  },
);
