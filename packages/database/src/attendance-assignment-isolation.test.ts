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
        "', true), set_config('app.holiday_calendar_transition', '" +
        (values.capabilities?.includes('holiday-calendar-transition') ? 'on' : 'off') +
        "', true), set_config('app.schedule_assignment_transition', '" +
        (values.capabilities?.includes('schedule-assignment-transition') ? 'on' : 'off') +
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

async function createEvidence(
  admin: PrismaClient,
  agencyId: string,
  membershipId: string,
  suffix: string,
) {
  const document = await admin.document.create({
    data: {
      agencyId,
      documentType: 'SCHEDULE_ASSIGNMENT_AUTHORITY',
      classification: 'INTERNAL',
      status: 'APPROVED',
      createdByMembershipId: membershipId,
    },
  });
  const version = await admin.documentVersion.create({
    data: {
      agencyId,
      documentId: document.id,
      versionNo: 1,
      storageKey: 'assignment-rls/' + suffix,
      contentHash: 'c'.repeat(64),
      mimeType: 'application/pdf',
      sizeBytes: 1,
      issuedAt: new Date(),
      createdByMembershipId: membershipId,
    },
  });
  await admin.document.update({
    where: { id: document.id },
    data: { currentVersionId: version.id },
  });
  return version;
}

async function createAgencyFixtures(
  admin: PrismaClient,
  values: { agencyId: string; membershipId: string; suffix: string },
) {
  const employee = await admin.employee.create({
    data: {
      agencyId: values.agencyId,
      employeeNumber: 'EMP-' + values.suffix,
      legalName: 'Assignment RLS Employee',
      birthDate: new Date('1990-01-01'),
      sex: 'FEMALE',
      civilStatus: 'SINGLE',
      contactEmail: 'assignment-rls-' + values.suffix + '@example.test',
      serviceStatus: 'ACTIVE',
      createdByMembershipId: values.membershipId,
      updatedByMembershipId: values.membershipId,
    },
  });
  const schedule = await admin.workSchedule.create({
    data: {
      agencyId: values.agencyId,
      code: 'WS-' + values.suffix,
      name: 'Assignment RLS Schedule',
    },
  });
  const scheduleVersion = await admin.workScheduleVersion.create({
    data: {
      agencyId: values.agencyId,
      workScheduleId: schedule.id,
      versionNo: 1,
      scheduleType: 'REGULAR',
      effectiveFrom: new Date('2026-01-01'),
      status: 'DRAFT',
    },
  });
  const calendar = await admin.holidayCalendar.create({
    data: {
      agencyId: values.agencyId,
      code: 'HC-' + values.suffix,
      name: 'Assignment RLS Calendar',
      scopeType: 'AGENCY',
      scopeReference: 'Agency-wide',
    },
  });
  const calendarVersion = await admin.holidayCalendarVersion.create({
    data: {
      agencyId: values.agencyId,
      holidayCalendarId: calendar.id,
      versionNo: 1,
      effectiveFrom: new Date('2026-01-01'),
      status: 'DRAFT',
    },
  });
  const arrangement = await admin.workArrangement.create({
    data: {
      agencyId: values.agencyId,
      code: 'WA-' + values.suffix,
      name: 'Assignment RLS Arrangement',
    },
  });
  const arrangementVersion = await admin.workArrangementVersion.create({
    data: {
      agencyId: values.agencyId,
      workArrangementId: arrangement.id,
      versionNo: 1,
      arrangementType: 'ONSITE',
      permittedScheduleTypes: ['REGULAR'],
      holidayCalendarId: calendar.id,
      effectiveFrom: new Date('2026-01-01'),
      status: 'DRAFT',
    },
  });
  const evidence = await createEvidence(admin, values.agencyId, values.membershipId, values.suffix);
  return {
    employee,
    calendar,
    calendarVersion,
    scheduleVersion,
    arrangementVersion,
    evidence,
  };
}

it.skipIf(!enabled)(
  'isolates Holiday Calendar Versions and guards Schedule Assignments',
  async () => {
    const runtimeUrl = process.env.DATABASE_URL;
    if (!runtimeUrl) throw new Error('DATABASE_URL is required for the integration test.');
    const app = new PrismaClient({ datasources: { db: { url: runtimeUrl } } });
    const admin = await adminClient();
    const suffix = String(Date.now()) + '-assignment';
    const agencies = await Promise.all(
      ['A', 'B'].map((label) =>
        admin.agency.create({
          data: {
            code: 'ASG-RLS-' + label + '-' + suffix,
            name: 'Assignment RLS ' + label,
            agencyType: 'NGA',
            status: 'ACTIVE',
          },
        }),
      ),
    );
    const user = await admin.user.create({
      data: {
        emailNormalized: 'assignment-' + suffix + '@example.test',
        displayName: 'Assignment RLS User',
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
      throw new Error('Assignment fixtures were not created.');
    }

    const contextA = {
      agencyId: agencyA.id,
      userId: user.id,
      membershipId: membershipA.id,
    };
    const fixturesA = await createAgencyFixtures(admin, {
      agencyId: agencyA.id,
      membershipId: membershipA.id,
      suffix: suffix + '-a',
    });
    const fixturesB = await createAgencyFixtures(admin, {
      agencyId: agencyB.id,
      membershipId: membershipB.id,
      suffix: suffix + '-b',
    });
    await admin.holidayCalendarEntry.create({
      data: {
        agencyId: agencyB.id,
        holidayCalendarVersionId: fixturesB.calendarVersion.id,
        holidayDate: new Date('2026-12-25'),
        name: 'Christmas Day',
        dayType: 'REGULAR_HOLIDAY',
        sourceReference: 'Proclamation No. 123',
      },
    });
    const assignmentB = await withContext(
      app,
      {
        ...contextA,
        agencyId: agencyB.id,
        membershipId: membershipB.id,
        capabilities: ['schedule-assignment-transition'],
      },
      (transaction) =>
        transaction.scheduleAssignment.create({
          data: {
            agencyId: agencyB.id,
            employeeId: fixturesB.employee.id,
            workScheduleVersionId: fixturesB.scheduleVersion.id,
            workArrangementVersionId: fixturesB.arrangementVersion.id,
            authorityDocumentVersionId: fixturesB.evidence.id,
            effectiveFrom: new Date('2026-01-01'),
            assignedByMembershipId: membershipB.id,
          },
        }),
    );

    try {
      await expect(
        withContext(app, contextA, (transaction) =>
          transaction.holidayCalendarVersion.findMany({
            where: { id: fixturesB.calendarVersion.id },
          }),
        ),
      ).resolves.toHaveLength(0);
      await expect(
        withContext(app, contextA, (transaction) =>
          transaction.holidayCalendarEntry.findMany({
            where: { holidayCalendarVersionId: fixturesB.calendarVersion.id },
          }),
        ),
      ).resolves.toHaveLength(0);
      await expect(
        withContext(app, contextA, (transaction) =>
          transaction.scheduleAssignment.findMany({ where: { id: assignmentB.id } }),
        ),
      ).resolves.toHaveLength(0);

      await expect(
        withContext(app, contextA, (transaction) =>
          transaction.scheduleAssignment.create({
            data: {
              agencyId: agencyA.id,
              employeeId: fixturesA.employee.id,
              workScheduleVersionId: fixturesA.scheduleVersion.id,
              workArrangementVersionId: fixturesA.arrangementVersion.id,
              authorityDocumentVersionId: fixturesA.evidence.id,
              effectiveFrom: new Date('2026-01-01'),
              assignedByMembershipId: membershipA.id,
            },
          }),
        ),
      ).rejects.toThrow(/application service/i);

      await expect(
        withContext(
          app,
          { ...contextA, capabilities: ['schedule-assignment-transition'] },
          (transaction) =>
            transaction.scheduleAssignment.create({
              data: {
                agencyId: agencyA.id,
                employeeId: fixturesA.employee.id,
                workScheduleVersionId: fixturesA.scheduleVersion.id,
                workArrangementVersionId: fixturesA.arrangementVersion.id,
                authorityDocumentVersionId: fixturesA.evidence.id,
                effectiveFrom: new Date('2026-01-01'),
                effectiveTo: new Date('2026-12-31'),
                assignedByMembershipId: membershipA.id,
              },
            }),
        ),
      ).rejects.toThrow(/open-ended/i);

      await expect(
        withContext(
          app,
          { ...contextA, capabilities: ['schedule-assignment-transition'] },
          (transaction) =>
            transaction.scheduleAssignment.create({
              data: {
                agencyId: agencyA.id,
                employeeId: fixturesA.employee.id,
                workScheduleVersionId: fixturesB.scheduleVersion.id,
                workArrangementVersionId: fixturesA.arrangementVersion.id,
                authorityDocumentVersionId: fixturesA.evidence.id,
                effectiveFrom: new Date('2026-01-01'),
                assignedByMembershipId: membershipA.id,
              },
            }),
        ),
      ).rejects.toThrow(/foreign key|violates/i);

      const assignmentA = await withContext(
        app,
        { ...contextA, capabilities: ['schedule-assignment-transition'] },
        (transaction) =>
          transaction.scheduleAssignment.create({
            data: {
              agencyId: agencyA.id,
              employeeId: fixturesA.employee.id,
              workScheduleVersionId: fixturesA.scheduleVersion.id,
              workArrangementVersionId: fixturesA.arrangementVersion.id,
              authorityDocumentVersionId: fixturesA.evidence.id,
              effectiveFrom: new Date('2026-01-01'),
              assignedByMembershipId: membershipA.id,
            },
          }),
      );
      expect(assignmentA.effectiveTo).toBeNull();

      await expect(
        withContext(app, contextA, (transaction) =>
          transaction.scheduleAssignment.delete({ where: { id: assignmentA.id } }),
        ),
      ).rejects.toThrow(/retained|deleted|permission denied/i);

      await expect(
        withContext(
          app,
          { ...contextA, capabilities: ['schedule-assignment-transition'] },
          (transaction) =>
            transaction.scheduleAssignment.update({
              where: { agencyId_id: { agencyId: agencyA.id, id: assignmentA.id } },
              data: { effectiveFrom: new Date('2026-02-01') },
            }),
        ),
      ).rejects.toThrow(/only set the effective end date/i);

      await expect(
        withContext(
          app,
          { ...contextA, capabilities: ['schedule-assignment-transition'] },
          (transaction) =>
            transaction.scheduleAssignment.create({
              data: {
                agencyId: agencyA.id,
                employeeId: fixturesA.employee.id,
                workScheduleVersionId: fixturesA.scheduleVersion.id,
                workArrangementVersionId: fixturesA.arrangementVersion.id,
                authorityDocumentVersionId: fixturesA.evidence.id,
                effectiveFrom: new Date('2026-06-01'),
                assignedByMembershipId: membershipA.id,
              },
            }),
        ),
      ).rejects.toThrow(/exclusion constraint|overlap/i);

      const ended = await withContext(
        app,
        { ...contextA, capabilities: ['schedule-assignment-transition'] },
        (transaction) =>
          transaction.scheduleAssignment.update({
            where: { agencyId_id: { agencyId: agencyA.id, id: assignmentA.id } },
            data: { effectiveTo: new Date('2026-06-30') },
          }),
      );
      expect(ended.effectiveTo?.toISOString().slice(0, 10)).toBe('2026-06-30');

      await expect(
        withContext(
          app,
          { ...contextA, capabilities: ['schedule-assignment-transition'] },
          (transaction) =>
            transaction.scheduleAssignment.update({
              where: { agencyId_id: { agencyId: agencyA.id, id: assignmentA.id } },
              data: { effectiveTo: null },
            }),
        ),
      ).rejects.toThrow(/immutable/i);

      await expect(
        withContext(
          app,
          { ...contextA, capabilities: ['schedule-assignment-transition'] },
          (transaction) =>
            transaction.scheduleAssignment.update({
              where: { agencyId_id: { agencyId: agencyA.id, id: assignmentA.id } },
              data: { effectiveTo: new Date('2026-07-31') },
            }),
        ),
      ).rejects.toThrow(/immutable/i);

      await expect(
        withContext(app, contextA, (transaction) =>
          transaction.holidayCalendarVersion.update({
            where: {
              agencyId_id: { agencyId: agencyA.id, id: fixturesA.calendarVersion.id },
            },
            data: { status: 'ACTIVE' },
          }),
        ),
      ).rejects.toThrow(/application service/i);

      const published = await withContext(
        app,
        { ...contextA, capabilities: ['holiday-calendar-transition'] },
        (transaction) =>
          transaction.holidayCalendarVersion.update({
            where: {
              agencyId_id: { agencyId: agencyA.id, id: fixturesA.calendarVersion.id },
            },
            data: {
              status: 'ACTIVE',
              authorityDocumentVersionId: fixturesA.evidence.id,
              approvingAuthority: 'Office of the President',
              activatedByMembershipId: membershipA.id,
              activatedAt: new Date(),
            },
          }),
      );
      expect(published.status).toBe('ACTIVE');

      await expect(
        withContext(app, contextA, (transaction) =>
          transaction.holidayCalendarEntry.create({
            data: {
              agencyId: agencyA.id,
              holidayCalendarVersionId: published.id,
              holidayDate: new Date('2026-12-25'),
              name: 'Christmas Day',
              dayType: 'REGULAR_HOLIDAY',
              sourceReference: 'Proclamation No. 123',
            },
          }),
        ),
      ).rejects.toThrow(/draft/i);

      const duplicateCalendarVersion = await admin.holidayCalendarVersion.create({
        data: {
          agencyId: agencyA.id,
          holidayCalendarId: fixturesA.calendar.id,
          versionNo: 2,
          effectiveFrom: new Date('2026-06-01'),
          status: 'DRAFT',
        },
      });
      await expect(
        withContext(
          app,
          { ...contextA, capabilities: ['holiday-calendar-transition'] },
          (transaction) =>
            transaction.holidayCalendarVersion.update({
              where: {
                agencyId_id: { agencyId: agencyA.id, id: duplicateCalendarVersion.id },
              },
              data: {
                status: 'ACTIVE',
                authorityDocumentVersionId: fixturesA.evidence.id,
                approvingAuthority: 'Office of the President',
                activatedByMembershipId: membershipA.id,
                activatedAt: new Date(),
              },
            }),
        ),
      ).rejects.toThrow(/exclusion constraint|overlap/i);
    } finally {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.scheduleAssignment.deleteMany({
          where: { agencyId: { in: [agencyA.id, agencyB.id] } },
        });
        await transaction.holidayCalendarEntry.deleteMany({
          where: { agencyId: { in: [agencyA.id, agencyB.id] } },
        });
        await transaction.workArrangementVersion.deleteMany({
          where: { agencyId: { in: [agencyA.id, agencyB.id] } },
        });
        await transaction.workArrangement.updateMany({
          where: { agencyId: { in: [agencyA.id, agencyB.id] } },
          data: { currentVersionId: null },
        });
        await transaction.workArrangement.deleteMany({
          where: { agencyId: { in: [agencyA.id, agencyB.id] } },
        });
        await transaction.holidayCalendarVersion.deleteMany({
          where: { agencyId: { in: [agencyA.id, agencyB.id] } },
        });
        await transaction.holidayCalendar.updateMany({
          where: { agencyId: { in: [agencyA.id, agencyB.id] } },
          data: { currentVersionId: null },
        });
        await transaction.holidayCalendar.deleteMany({
          where: { agencyId: { in: [agencyA.id, agencyB.id] } },
        });
        await transaction.workScheduleVersion.deleteMany({
          where: { agencyId: { in: [agencyA.id, agencyB.id] } },
        });
        await transaction.workSchedule.updateMany({
          where: { agencyId: { in: [agencyA.id, agencyB.id] } },
          data: { currentVersionId: null },
        });
        await transaction.workSchedule.deleteMany({
          where: { agencyId: { in: [agencyA.id, agencyB.id] } },
        });
        await transaction.documentVersion.deleteMany({
          where: { agencyId: { in: [agencyA.id, agencyB.id] } },
        });
        await transaction.document.updateMany({
          where: { agencyId: { in: [agencyA.id, agencyB.id] } },
          data: { currentVersionId: null },
        });
        await transaction.document.deleteMany({
          where: { agencyId: { in: [agencyA.id, agencyB.id] } },
        });
        await transaction.employee.deleteMany({
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
  },
);
