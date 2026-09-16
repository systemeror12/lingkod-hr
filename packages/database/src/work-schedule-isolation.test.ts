import { PrismaClient, type Prisma } from '@prisma/client';
import { expect, it } from 'vitest';

const enabled = process.env.DATABASE_E2E === 'true';

async function withContext<T>(
  client: PrismaClient,
  values: { agencyId: string; userId: string; membershipId: string; capabilities?: string[] },
  work: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return client.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe(
      "SELECT set_config('app.agency_id', '" +
        values.agencyId +
        "', true), set_config('app.user_id', '" +
        values.userId +
        "', true), set_config('app.membership_id', '" +
        values.membershipId +
        "', true), set_config('app.work_schedule_transition', '" +
        (values.capabilities?.includes('work-schedule-transition') ? 'on' : 'off') +
        "', true), set_config('app.work_arrangement_transition', '" +
        (values.capabilities?.includes('work-arrangement-transition') ? 'on' : 'off') +
        "', true)",
    );
    return work(transaction);
  });
}

async function adminClient(): Promise<PrismaClient> {
  const url = process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
  if (!url) throw new Error('A database owner URL is required for the integration test.');
  return new PrismaClient({ datasources: { db: { url } } });
}

it.skipIf(!enabled)('isolates Work Schedules and guards their published history', async () => {
  const runtimeUrl = process.env.DATABASE_URL;
  if (!runtimeUrl) throw new Error('DATABASE_URL is required for the integration test.');
  const app = new PrismaClient({ datasources: { db: { url: runtimeUrl } } });
  const admin = await adminClient();
  const suffix = String(Date.now()) + '-work-schedule';
  const agencies = await Promise.all(
    ['A', 'B'].map((label) =>
      admin.agency.create({
        data: {
          code: 'WS-RLS-' + label + '-' + suffix,
          name: 'Work Schedule RLS ' + label,
          agencyType: 'NGA',
          status: 'ACTIVE',
        },
      }),
    ),
  );
  const user = await admin.user.create({
    data: {
      identityProvider: 'work-schedule-rls-e2e',
      externalSubject: 'work-schedule-' + suffix,
      emailNormalized: 'work-schedule-' + suffix + '@example.test',
      displayName: 'Work Schedule RLS User',
      globalStatus: 'ACTIVE',
    },
  });
  const memberships = await Promise.all(
    agencies.map(({ id }) =>
      admin.agencyMembership.create({
        data: { agencyId: id, userId: user.id, status: 'ACTIVE' },
      }),
    ),
  );
  const agencyA = agencies[0];
  const agencyB = agencies[1];
  const membershipA = memberships[0];
  const membershipB = memberships[1];
  if (!agencyA || !agencyB || !membershipA || !membershipB) {
    throw new Error('Work Schedule fixtures were not created.');
  }

  const contextA = {
    agencyId: agencyA.id,
    userId: user.id,
    membershipId: membershipA.id,
  };
  const foreignSchedule = await admin.workSchedule.create({
    data: { agencyId: agencyB.id, code: 'WS-' + suffix, name: 'Foreign Schedule' },
  });
  const foreignVersion = await admin.workScheduleVersion.create({
    data: {
      agencyId: agencyB.id,
      workScheduleId: foreignSchedule.id,
      versionNo: 1,
      scheduleType: 'REGULAR',
      effectiveFrom: new Date('2026-01-01'),
      status: 'DRAFT',
    },
  });
  const foreignCalendar = await admin.holidayCalendar.create({
    data: {
      agencyId: agencyB.id,
      code: 'HC-' + suffix,
      name: 'Foreign Calendar',
      scopeType: 'AGENCY',
      scopeReference: 'Agency-wide',
    },
  });
  const foreignArrangement = await admin.workArrangement.create({
    data: { agencyId: agencyB.id, code: 'WA-' + suffix, name: 'Foreign Arrangement' },
  });
  const foreignArrangementVersion = await admin.workArrangementVersion.create({
    data: {
      agencyId: agencyB.id,
      workArrangementId: foreignArrangement.id,
      versionNo: 1,
      arrangementType: 'ONSITE',
      permittedScheduleTypes: ['REGULAR'],
      holidayCalendarId: foreignCalendar.id,
      effectiveFrom: new Date('2026-01-01'),
      status: 'DRAFT',
    },
  });

  try {
    await expect(
      withContext(app, contextA, (transaction) =>
        transaction.workSchedule.findMany({ where: { id: foreignSchedule.id } }),
      ),
    ).resolves.toHaveLength(0);
    await expect(
      withContext(app, contextA, (transaction) =>
        transaction.workScheduleVersion.findMany({ where: { id: foreignVersion.id } }),
      ),
    ).resolves.toHaveLength(0);
    await expect(
      withContext(app, contextA, (transaction) =>
        transaction.holidayCalendar.findMany({ where: { id: foreignCalendar.id } }),
      ),
    ).resolves.toHaveLength(0);
    await expect(
      withContext(app, contextA, (transaction) =>
        transaction.workArrangement.findMany({ where: { id: foreignArrangement.id } }),
      ),
    ).resolves.toHaveLength(0);
    await expect(
      withContext(app, contextA, (transaction) =>
        transaction.workArrangementVersion.findMany({
          where: { id: foreignArrangementVersion.id },
        }),
      ),
    ).resolves.toHaveLength(0);

    const schedule = await withContext(app, contextA, (transaction) =>
      transaction.workSchedule.create({
        data: { agencyId: agencyA.id, code: 'WS-' + suffix, name: 'Agency Schedule' },
      }),
    );
    const draft = await withContext(app, contextA, (transaction) =>
      transaction.workScheduleVersion.create({
        data: {
          agencyId: agencyA.id,
          workScheduleId: schedule.id,
          versionNo: 1,
          scheduleType: 'REGULAR',
          effectiveFrom: new Date('2026-01-01'),
          status: 'DRAFT',
        },
      }),
    );
    expect(draft.status).toBe('DRAFT');

    await expect(
      withContext(app, { ...contextA, capabilities: ['work-schedule-transition'] }, (transaction) =>
        transaction.workScheduleVersion.update({
          where: { agencyId_id: { agencyId: agencyA.id, id: draft.id } },
          data: { status: 'ACTIVE' },
        }),
      ),
    ).rejects.toThrow(/authority evidence|activated_evidence/i);

    await expect(
      withContext(app, contextA, (transaction) =>
        transaction.workScheduleVersion.update({
          where: { agencyId_id: { agencyId: agencyA.id, id: draft.id } },
          data: { status: 'ACTIVE' },
        }),
      ),
    ).rejects.toThrow(/application service|transition/i);

    await expect(
      withContext(app, contextA, (transaction) =>
        transaction.workScheduleVersion.create({
          data: {
            agencyId: agencyA.id,
            workScheduleId: foreignSchedule.id,
            versionNo: 2,
            scheduleType: 'REGULAR',
            effectiveFrom: new Date('2026-02-01'),
            status: 'DRAFT',
          },
        }),
      ),
    ).rejects.toThrow(/foreign key|violates/i);

    await expect(
      withContext(app, contextA, (transaction) =>
        transaction.workSchedule.update({
          where: { agencyId_id: { agencyId: agencyA.id, id: schedule.id } },
          data: { code: 'RENAMED' },
        }),
      ),
    ).rejects.toThrow(/identity|immutable/i);

    await expect(
      withContext(app, contextA, (transaction) =>
        transaction.workSchedule.delete({ where: { id: schedule.id } }),
      ),
    ).rejects.toThrow(/retained|deleted|permission denied/i);

    const arrangement = await withContext(app, contextA, (transaction) =>
      transaction.workArrangement.create({
        data: { agencyId: agencyA.id, code: 'WA-' + suffix, name: 'Agency Arrangement' },
      }),
    );
    await expect(
      withContext(app, contextA, (transaction) =>
        transaction.workArrangementVersion.create({
          data: {
            agencyId: agencyA.id,
            workArrangementId: arrangement.id,
            versionNo: 1,
            arrangementType: 'ONSITE',
            permittedScheduleTypes: ['REGULAR'],
            holidayCalendarId: foreignCalendar.id,
            effectiveFrom: new Date('2026-01-01'),
            status: 'DRAFT',
          },
        }),
      ),
    ).rejects.toThrow(/foreign key|violates/i);

    await expect(
      withContext(app, contextA, (transaction) =>
        transaction.workArrangement.update({
          where: { agencyId_id: { agencyId: agencyA.id, id: arrangement.id } },
          data: { code: 'RENAMED' },
        }),
      ),
    ).rejects.toThrow(/identity|immutable/i);

    await expect(
      withContext(app, contextA, (transaction) =>
        transaction.workArrangement.delete({ where: { id: arrangement.id } }),
      ),
    ).rejects.toThrow(/retained|deleted|permission denied/i);
  } finally {
    await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await transaction.workScheduleBreakInterval.deleteMany({
        where: { agencyId: { in: [agencyA.id, agencyB.id] } },
      });
      await transaction.workScheduleDayRule.deleteMany({
        where: { agencyId: { in: [agencyA.id, agencyB.id] } },
      });
      await transaction.workSchedule.updateMany({
        where: { agencyId: { in: [agencyA.id, agencyB.id] } },
        data: { currentVersionId: null },
      });
      await transaction.workScheduleVersion.deleteMany({
        where: { agencyId: { in: [agencyA.id, agencyB.id] } },
      });
      await transaction.workSchedule.deleteMany({
        where: { agencyId: { in: [agencyA.id, agencyB.id] } },
      });
      await transaction.workArrangement.updateMany({
        where: { agencyId: { in: [agencyA.id, agencyB.id] } },
        data: { currentVersionId: null },
      });
      await transaction.workArrangementVersion.deleteMany({
        where: { agencyId: { in: [agencyA.id, agencyB.id] } },
      });
      await transaction.workArrangement.deleteMany({
        where: { agencyId: { in: [agencyA.id, agencyB.id] } },
      });
      await transaction.holidayCalendar.deleteMany({
        where: { agencyId: { in: [agencyA.id, agencyB.id] } },
      });
    });
    await admin.agencyMembership.deleteMany({
      where: { agencyId: { in: [agencyA.id, agencyB.id] } },
    });
    await admin.agency.deleteMany({ where: { id: { in: [agencyA.id, agencyB.id] } } });
    await admin.user.delete({ where: { id: user.id } });
    await app.$disconnect();
    await admin.$disconnect();
  }
});
