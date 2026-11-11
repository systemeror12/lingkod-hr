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

const window = { startsAt: '2026-01-05T00:00:00.000Z', endsAt: '2026-01-05T08:00:00.000Z' };

it.skipIf(!enabled)(
  "reads only a DIRECT_REPORTS reader's Direct Reports' Attendance Contexts",
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-context-reports`;
    const home = await createAgency(admin, suffix, 'ACR');
    const agencyId = home.agency.id;
    try {
      // The chief heads the division; the member reports to the chief, the outsider does not.
      const supervisor: RequestContext = await addMember(
        admin,
        home,
        suffix,
        'context-supervisor',
        'employee',
        [{ code: 'attendance.contexts.read', scopePolicy: 'DIRECT_REPORTS' }],
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
      for (const employeeId of [home.chief.id, home.member.id, home.outsider.id]) {
        await admin.attendanceContext.create({
          data: {
            agencyId,
            employeeId,
            contextType: 'TRAINING',
            coverageMode: 'WHOLE_WORK_DATE',
            workDate: new Date('2026-01-05'),
            reason: 'Direct Reports scope test.',
            sourceType: 'TrainingNomination',
            sourceId: '00000000-0000-4000-8000-000000000099',
            enteredByMembershipId: home.membership.id,
          },
        });
      }

      const { contexts } = attendanceWorkflowServices();
      const listed = await contexts.list(supervisor);
      expect(listed.map((record) => record.employee.id)).toEqual([home.member.id]);
      await expect(contexts.list(supervisor, { employeeId: home.outsider.id })).resolves.toEqual(
        [],
      );
      const covered = await contexts.resolveCoverage(
        supervisor,
        home.member.id,
        '2026-01-05',
        window,
      );
      expect(covered.intervals).toHaveLength(1);
      for (const employeeId of [home.chief.id, home.outsider.id]) {
        await expect(
          contexts.resolveCoverage(supervisor, employeeId, '2026-01-05', window),
        ).rejects.toMatchObject({ code: 'ATTENDANCE_CONTEXT_READ_FORBIDDEN', statusCode: 403 });
      }
    } finally {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.attendanceContext.deleteMany({ where: { agencyId } });
      });
      await cleanup(admin, [agencyId], suffix);
      await admin.$disconnect();
    }
  },
  120_000,
);
