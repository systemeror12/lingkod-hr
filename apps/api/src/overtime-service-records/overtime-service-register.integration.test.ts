import type { RequestContext } from '@lingkod-hr/auth';
import { expect, it } from 'vitest';
import { AttendanceLockedDaysService } from '../attendance-locked-days/attendance-locked-days.service';
import {
  attendanceAdministratorPermissions,
  createAttendanceWorkflowFixture,
  lockAttendancePeriod,
} from '../attendance-test-fixtures';
import { overtimeAuthorityAuditWriter } from '../overtime-authorities/overtime-authorities.audit';
import { enabled, errorOf } from '../overtime-authorities/overtime-authority-test-fixtures';
import { OvertimeServiceRecordsController } from './overtime-service-records.controller';
import { OvertimeServiceRecordsService } from './overtime-service-records.service';
import {
  approvedAuthority,
  cleanupAttendanceOvertime,
  serviceGrants,
} from './overtime-service-test-fixtures';

const service = new OvertimeServiceRecordsService(
  overtimeAuthorityAuditWriter,
  new AttendanceLockedDaysService(),
);
const controller = new OvertimeServiceRecordsController(service);

it.skipIf(!enabled)(
  "reads an authority's service by Employee, saying why a date without locked Attendance can't be submitted",
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
        authorityNo: `OT-REG-${fixture.suffix}`,
        workDateFrom: workDate,
        workDateTo: workDate,
        employeeIds: [employeeId],
      });
      const reader: RequestContext = {
        ...fixture.administratorContext,
        permissions: [
          ...attendanceAdministratorPermissions,
          { code: 'overtime.authorities.read', scopePolicy: 'AGENCY' },
        ],
      };
      const hr: RequestContext = {
        ...fixture.administratorContext,
        permissions: [
          ...attendanceAdministratorPermissions,
          ...serviceGrants('AGENCY', [
            'overtime.service.record',
            'overtime.service.submit',
            'overtime.service.certify',
          ]),
        ],
      };

      // A covered Employee without service still has a group.
      expect(await controller.listForAuthority(agencyId, authorityId, reader)).toMatchObject({
        overtimeAuthorityId: authorityId,
        employees: [
          {
            employeeId,
            authorizedHours: '16.0000',
            certifiedMinutes: 0,
            remainingMinutes: '960',
            records: [],
          },
        ],
      });

      const recorded = await service.record(hr, {
        overtimeAuthorityId: authorityId,
        employeeId,
        workDate,
        claimedHours: '1.5',
        accomplishment: 'Encoded the backlog of leave cards.',
      });
      const before = await controller.listForAuthority(agencyId, authorityId, reader);
      expect(before.employees[0]?.records).toEqual([
        expect.objectContaining({
          id: recorded.id,
          status: 'RENDERED',
          claimedHours: '1.5000',
          actualMinutes: null,
          certifiedMinutes: null,
          submitBlockedReason: `Attendance for ${workDate} is not locked yet, so its Actual Overtime Hours are not known. Submit once the Attendance Period covering it is locked.`,
        }),
      ]);
      // The reason is the refusal submission gives.
      await expect(service.submit(hr, recorded.id)).rejects.toMatchObject({
        message: before.employees[0]?.records[0]?.submitBlockedReason,
      });

      await lockAttendancePeriod(fixture, fixture.administratorContext);
      expect(
        (await controller.listForAuthority(agencyId, authorityId, reader)).employees[0]?.records[0],
      ).toMatchObject({ status: 'RENDERED', submitBlockedReason: null });

      await service.submit(hr, recorded.id);
      await service.certify(hr, recorded.id, { certifiedMinutes: 45 });
      expect(await controller.listForAuthority(agencyId, authorityId, reader)).toMatchObject({
        employees: [
          {
            certifiedMinutes: 45,
            remainingMinutes: '915',
            records: [
              {
                status: 'CERTIFIED',
                claimedHours: '1.5000',
                actualMinutes: 60,
                certifiedMinutes: 45,
                submitBlockedReason: null,
              },
            ],
          },
        ],
      });

      // Reading needs the authority read reaching every covered Employee, in the active Agency.
      const directReports: RequestContext = {
        ...reader,
        permissions: [{ code: 'overtime.authorities.read', scopePolicy: 'DIRECT_REPORTS' }],
      };
      await expect(service.listForAuthority(directReports, authorityId)).rejects.toMatchObject({
        statusCode: 403,
        code: 'OVERTIME_SERVICE_SCOPE_FORBIDDEN',
      });
      await expect(service.listForAuthority(hr, authorityId)).rejects.toMatchObject({
        statusCode: 403,
        code: 'OVERTIME_SERVICE_FORBIDDEN',
      });
      expect(
        await errorOf(
          controller.listForAuthority('00000000-0000-4000-8000-000000000000', authorityId, reader),
        ),
      ).toMatchObject({
        status: 403,
        body: { error: { code: 'OVERTIME_SERVICE_READ_FORBIDDEN' } },
      });
      expect(
        await errorOf(controller.listForAuthority(agencyId, 'not-an-id', reader)),
      ).toMatchObject({ status: 404, body: { error: { code: 'OVERTIME_AUTHORITY_NOT_FOUND' } } });
      expect(
        await errorOf(
          controller.listForAuthority(agencyId, '00000000-0000-4000-8000-000000000000', reader),
        ),
      ).toMatchObject({ status: 404, body: { error: { code: 'OVERTIME_AUTHORITY_NOT_FOUND' } } });
    } finally {
      await cleanupAttendanceOvertime(fixture);
      await admin.$disconnect();
    }
  },
);
