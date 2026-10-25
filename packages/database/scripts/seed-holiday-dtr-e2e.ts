import { PrismaClient } from '@prisma/client';
import { loadRootEnvironment } from './load-root-env';

/**
 * Year-end duty for the Daily Time Record journey in
 * `apps/web/e2e/phase-7-holiday-effects.spec.ts`. Run it after the protected-shell seed and after
 * the browser activates the Holiday Calendar named by the first argument.
 *
 * The API cannot record this setup itself: Schedule Assignments open without an end and can only
 * be ended prospectively, so a past period before the seeded 2026-01-01 assignment is unreachable.
 * The period-lock Approval Route gets a December version for the same reason. The rows live in the
 * DTR fixture agency, whose reset removes them.
 */

if (process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production') {
  throw new Error('The holiday DTR fixture is local-only and refuses production.');
}

const holidayCalendarCode = process.argv[2];
if (!holidayCalendarCode) throw new Error('A Holiday Calendar code is required.');

loadRootEnvironment();
const databaseUrl =
  process.env.DATABASE_E2E_ADMIN_URL ??
  process.env.DATABASE_MIGRATION_OWNER_URL ??
  'postgresql://hris_local:local_only@localhost:55432/hris';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

const agencyId = 'd7a00000-0000-4000-8000-000000000001';
const membershipId = 'd7a00000-0000-4000-8000-000000000002';
const employeeId = 'd7a00000-0000-4000-8000-000000000003';
const effectiveFrom = new Date('2025-12-01');

async function seed(calendarCode: string): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    // Like the protected-shell seed, write activated versions without the service transition guards.
    await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    const calendar = await transaction.holidayCalendar.findFirstOrThrow({
      where: { agencyId, code: calendarCode },
    });
    const authorityVersion = await transaction.documentVersion.findFirstOrThrow({
      where: { agencyId, document: { documentType: 'SCHEDULE_ASSIGNMENT_AUTHORITY' } },
    });
    const activation = {
      authorityDocumentVersionId: authorityVersion.id,
      approvingAuthority: 'Office of the President',
      status: 'ACTIVE',
      effectiveFrom,
      activatedByMembershipId: membershipId,
      activatedAt: effectiveFrom,
    } as const;

    const schedule = await transaction.workSchedule.create({
      data: { agencyId, code: 'DTR-YEAR-END', name: 'DTR Year-End Work Schedule' },
    });
    const scheduleVersion = await transaction.workScheduleVersion.create({
      data: {
        agencyId,
        workScheduleId: schedule.id,
        versionNo: 1,
        scheduleType: 'REGULAR',
        timezone: 'Asia/Manila',
        ...activation,
      },
    });
    for (const weekday of [1, 2, 3, 4, 5, 6, 7]) {
      const duty = weekday <= 5;
      await transaction.workScheduleDayRule.create({
        data: {
          agencyId,
          workScheduleVersionId: scheduleVersion.id,
          weekday,
          ruleType: duty ? 'FIXED' : 'REST',
          dutyStartTime: duty ? new Date(Date.UTC(1970, 0, 1, 8, 0)) : null,
          dutyEndTime: duty ? new Date(Date.UTC(1970, 0, 1, 17, 0)) : null,
          requiredMinutes: duty ? 480 : 0,
          eventPattern: 'IN_OUT',
          collectionBeforeMinutes: 0,
          collectionAfterMinutes: duty ? 60 : 0,
          ...(duty
            ? {
                breaks: {
                  create: [
                    {
                      sequenceNo: 1,
                      breakStartTime: new Date(Date.UTC(1970, 0, 1, 12, 0)),
                      breakEndTime: new Date(Date.UTC(1970, 0, 1, 13, 0)),
                    },
                  ],
                },
              }
            : {}),
        },
      });
    }
    await transaction.workSchedule.update({
      where: { id: schedule.id },
      data: { currentVersionId: scheduleVersion.id },
    });

    const arrangement = await transaction.workArrangement.create({
      data: { agencyId, code: 'DTR-YEAR-END', name: 'DTR Year-End Work Arrangement' },
    });
    const arrangementVersion = await transaction.workArrangementVersion.create({
      data: {
        agencyId,
        workArrangementId: arrangement.id,
        versionNo: 1,
        arrangementType: 'ONSITE',
        permittedScheduleTypes: ['REGULAR'],
        holidayCalendarId: calendar.id,
        ...activation,
      },
    });
    await transaction.workArrangement.update({
      where: { id: arrangement.id },
      data: { currentVersionId: arrangementVersion.id },
    });

    await transaction.scheduleAssignment.create({
      data: {
        agencyId,
        employeeId,
        workScheduleVersionId: scheduleVersion.id,
        workArrangementVersionId: arrangementVersion.id,
        authorityDocumentVersionId: authorityVersion.id,
        effectiveFrom,
        effectiveTo: new Date('2025-12-31'),
        assignedByMembershipId: membershipId,
      },
    });

    // The lock route resolves on the period's first date, and the seeded route starts in 2026.
    const lockRoute = await transaction.approvalRouteVersion.findFirstOrThrow({
      where: { agencyId, routeCode: 'DTR-PERIOD-LOCK' },
    });
    await transaction.approvalRouteVersion.create({
      data: {
        agencyId,
        routeCode: lockRoute.routeCode,
        versionNo: lockRoute.versionNo + 1,
        domain: lockRoute.domain,
        stepDefinition: lockRoute.stepDefinition as object,
        effectiveFrom,
        effectiveTo: new Date('2025-12-31'),
        status: 'ACTIVE',
      },
    });
  });
}

seed(holidayCalendarCode)
  .finally(() => prisma.$disconnect())
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
