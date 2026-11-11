import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { expect, it } from 'vitest';
import { attendanceWorkflowServices, createAdminClient } from '../attendance-test-fixtures';
import {
  addMember,
  cleanup,
  createAgency,
  enabled,
} from '../overtime-authorities/overtime-authority-test-fixtures';

it.skipIf(!enabled)(
  "reads only a DIRECT_REPORTS reader's Direct Reports' Attendance Events",
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-event-reports`;
    const home = await createAgency(admin, suffix, 'AER');
    const agencyId = home.agency.id;
    try {
      // The chief heads the division; the member reports to the chief, the outsider does not.
      const supervisor: RequestContext = await addMember(
        admin,
        home,
        suffix,
        'event-supervisor',
        'employee',
        [{ code: 'attendance.events.read', scopePolicy: 'DIRECT_REPORTS' }],
      );
      await withDatabaseContext(
        {
          agencyId,
          userId: home.user.id,
          membershipId: home.membership.id,
          capabilities: ['employee-membership-link'],
        },
        (transaction) =>
          transaction.agencyMembership.update({
            where: { agencyId_id: { agencyId, id: supervisor.membershipId } },
            data: { employeeId: home.chief.id },
          }),
      );
      const eventTime = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      for (const employeeId of [home.chief.id, home.member.id, home.outsider.id]) {
        await admin.attendanceEvent.create({
          data: {
            agencyId,
            employeeId,
            eventTime,
            eventType: 'TIME_IN',
            source: 'MANUAL',
            enteredByMembershipId: home.membership.id,
            reason: 'Direct Reports scope test.',
          },
        });
      }

      const { attendance } = attendanceWorkflowServices();
      const listed = await attendance.listEvents(supervisor, {});
      expect(listed.map((event) => event.employeeId)).toEqual([home.member.id]);
      await expect(
        attendance.listEvents(supervisor, { employeeId: home.outsider.id }),
      ).rejects.toMatchObject({ code: 'ATTENDANCE_EVENT_READ_FORBIDDEN', statusCode: 403 });
      await expect(
        attendance.getEventContext(supervisor, home.chief.id, '2026-01-05'),
      ).rejects.toMatchObject({ code: 'ATTENDANCE_EVENT_READ_FORBIDDEN', statusCode: 403 });
    } finally {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.attendanceEvent.deleteMany({ where: { agencyId } });
      });
      await cleanup(admin, [agencyId], suffix);
      await admin.$disconnect();
    }
  },
  120_000,
);
