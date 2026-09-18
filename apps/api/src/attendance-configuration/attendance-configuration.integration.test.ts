import { PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { expect, it } from 'vitest';
import { documentAuditWriter, DocumentsService } from '../documents/documents.service';
import { attendanceConfigurationAuditWriter } from './attendance-configuration.audit';
import { HolidayCalendarsService } from './holiday-calendars.service';
import { WorkArrangementsService } from './work-arrangements.service';
import { WorkSchedulesService } from './work-schedules.service';

const enabled = process.env.DATABASE_E2E === 'true';

const permissions: RequestContext['permissions'] = [
  { code: 'attendance.configuration.read', scopePolicy: 'AGENCY' },
  { code: 'attendance.configuration.manage', scopePolicy: 'AGENCY' },
  { code: 'attendance.configuration.activate', scopePolicy: 'AGENCY' },
  { code: 'documents.evidence.read', scopePolicy: 'AGENCY' },
  { code: 'documents.evidence.read_sensitive', scopePolicy: 'AGENCY' },
];

function createContext(agencyId: string, userId: string, membershipId: string): RequestContext {
  return {
    requestId: 'attendance-configuration-integration-test',
    userId,
    agencyId,
    membershipId,
    primaryOrganizationUnitId: null,
    permissions,
  };
}

function manilaDate(offsetDays = 0): string {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const date = new Date(`${today}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function dayRules() {
  return [1, 2, 3, 4, 5, 6, 7].map((weekday) =>
    weekday <= 5
      ? {
          weekday,
          ruleType: 'FIXED' as const,
          dutyStartTime: '08:00',
          dutyEndTime: '17:00',
          requiredMinutes: 480,
          eventPattern: 'IN_OUT' as const,
          collectionBeforeMinutes: 0,
          collectionAfterMinutes: 0,
          breaks: [{ breakStartTime: '12:00', breakEndTime: '13:00' }],
        }
      : {
          weekday,
          ruleType: 'REST' as const,
          requiredMinutes: 0,
          eventPattern: 'IN_OUT' as const,
          collectionBeforeMinutes: 0,
          collectionAfterMinutes: 0,
          breaks: [],
        },
  );
}

async function createAdminClient(): Promise<PrismaClient> {
  const databaseUrl =
    process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
  if (!databaseUrl) throw new Error('A database owner URL is required for the integration test.');
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
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
      documentType: 'WORK_SCHEDULE_AUTHORITY',
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
      storageKey: `integration/${suffix}`,
      contentHash: 'b'.repeat(64),
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

async function cleanupAttendanceData(admin: PrismaClient, agencyId: string): Promise<void> {
  await admin.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    await transaction.auditEvent.deleteMany({ where: { agencyId } });
    await transaction.workScheduleBreakInterval.deleteMany({ where: { agencyId } });
    await transaction.workScheduleDayRule.deleteMany({ where: { agencyId } });
    await transaction.workSchedule.updateMany({
      where: { agencyId },
      data: { currentVersionId: null },
    });
    await transaction.workScheduleVersion.deleteMany({ where: { agencyId } });
    await transaction.workSchedule.deleteMany({ where: { agencyId } });
    await transaction.workArrangement.updateMany({
      where: { agencyId },
      data: { currentVersionId: null },
    });
    await transaction.workArrangementVersion.deleteMany({ where: { agencyId } });
    await transaction.workArrangement.deleteMany({ where: { agencyId } });
    await transaction.holidayCalendar.deleteMany({ where: { agencyId } });
    await transaction.documentVersion.deleteMany({ where: { agencyId } });
    await transaction.document.deleteMany({ where: { agencyId } });
  });
}

it.skipIf(!enabled)(
  'rejects a backdated successor and serializes concurrent activation',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-attendance-guards`;
    const agency = await admin.agency.create({
      data: {
        code: `AG-${suffix}`,
        name: 'Attendance Guards Integration Agency',
        agencyType: 'NGA',
        status: 'ACTIVE',
      },
    });
    const user = await admin.user.create({
      data: {
        identityProvider: 'attendance-guards-integration',
        externalSubject: `attendance-guards-${suffix}`,
        emailNormalized: `attendance-guards-${suffix}@example.test`,
        displayName: 'Attendance Guards Integration User',
        globalStatus: 'ACTIVE',
      },
    });
    const membership = await admin.agencyMembership.create({
      data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
    });
    const context = createContext(agency.id, user.id, membership.id);
    const documentsService = new DocumentsService({} as never, documentAuditWriter);
    const schedules = new WorkSchedulesService(
      attendanceConfigurationAuditWriter,
      documentsService,
    );
    const evidence = await createEvidence(admin, agency.id, membership.id, suffix);

    try {
      const created = await schedules.create(context, {
        code: 'ORDINARY',
        name: 'Ordinary Work Schedule',
        scheduleType: 'REGULAR',
        effectiveDate: manilaDate(-1),
        dayRules: dayRules(),
      });
      if (!created.draft) throw new Error('The initial Draft was not created.');
      const active = await schedules.activate(context, created.id, created.draft.id, {
        authorityDocumentVersionId: evidence.id,
        approvingAuthority: 'Office of the President',
        reason: 'Authority reviewed.',
      });
      const predecessorId = active.currentVersion?.id;
      if (!predecessorId) throw new Error('The initial version was not activated.');

      const successor = await schedules.createSuccessor(context, created.id);
      const backdated = await schedules.updateDraft(context, created.id, successor.draft.id, {
        scheduleType: 'REGULAR',
        effectiveDate: manilaDate(0),
        dayRules: dayRules(),
      });
      expect(backdated.effectiveFrom).toBe(manilaDate(0));
      await expect(
        schedules.activate(context, created.id, successor.draft.id, {
          authorityDocumentVersionId: evidence.id,
          approvingAuthority: 'Office of the President',
          reason: 'Retroactive successor.',
        }),
      ).rejects.toMatchObject({ code: 'WORK_SCHEDULE_PROSPECTIVE_REQUIRED' });

      const predecessor = await admin.workScheduleVersion.findFirstOrThrow({
        where: { id: predecessorId },
      });
      expect(predecessor.status).toBe('ACTIVE');
      expect(predecessor.effectiveTo).toBeNull();
      const untouchedDraft = await admin.workScheduleVersion.findFirstOrThrow({
        where: { id: successor.draft.id },
      });
      expect(untouchedDraft.status).toBe('DRAFT');
      await expect(
        admin.auditEvent.count({
          where: { agencyId: agency.id, action: 'WORK_SCHEDULE_VERSION_ACTIVATED' },
        }),
      ).resolves.toBe(1);

      const contested = await schedules.create(context, {
        code: 'SHIFT',
        name: 'Shift Work Schedule',
        scheduleType: 'SHIFT',
        effectiveDate: manilaDate(0),
        dayRules: dayRules(),
      });
      if (!contested.draft) throw new Error('The contested Draft was not created.');
      const attempts = await Promise.allSettled([
        schedules.activate(
          context,
          contested.id,
          contested.draft.id,
          {
            authorityDocumentVersionId: evidence.id,
            approvingAuthority: 'Office of the President',
            reason: 'Concurrent activation one.',
          },
          'concurrent-activation-one',
        ),
        schedules.activate(
          context,
          contested.id,
          contested.draft.id,
          {
            authorityDocumentVersionId: evidence.id,
            approvingAuthority: 'Office of the President',
            reason: 'Concurrent activation two.',
          },
          'concurrent-activation-two',
        ),
      ]);
      expect(attempts.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      const rejection = attempts.find(({ status }) => status === 'rejected');
      expect((rejection as PromiseRejectedResult).reason).toMatchObject({
        code: 'WORK_SCHEDULE_DRAFT_NOT_FOUND',
      });
      await expect(
        admin.workScheduleVersion.count({
          where: {
            agencyId: agency.id,
            workScheduleId: contested.id,
            status: 'ACTIVE',
          },
        }),
      ).resolves.toBe(1);
      await expect(
        admin.auditEvent.count({
          where: {
            agencyId: agency.id,
            entityId: contested.id,
            action: 'WORK_SCHEDULE_VERSION_ACTIVATED',
          },
        }),
      ).resolves.toBe(1);
    } finally {
      await cleanupAttendanceData(admin, agency.id);
      await admin.agencyMembership.deleteMany({ where: { agencyId: agency.id } });
      await admin.agency.delete({ where: { id: agency.id } });
      await admin.user.delete({ where: { id: user.id } });
      await admin.$disconnect();
    }
  },
);

it.skipIf(!enabled)(
  'activates, supersedes, and protects Work Schedules and Work Arrangements',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-attendance-configuration`;
    const agency = await admin.agency.create({
      data: {
        code: `AC-${suffix}`,
        name: 'Attendance Configuration Integration Agency',
        agencyType: 'NGA',
        status: 'ACTIVE',
      },
    });
    const user = await admin.user.create({
      data: {
        identityProvider: 'attendance-configuration-integration',
        externalSubject: `attendance-configuration-${suffix}`,
        emailNormalized: `attendance-configuration-${suffix}@example.test`,
        displayName: 'Attendance Configuration Integration User',
        globalStatus: 'ACTIVE',
      },
    });
    const membership = await admin.agencyMembership.create({
      data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
    });
    const context = createContext(agency.id, user.id, membership.id);
    const documentsService = new DocumentsService({} as never, documentAuditWriter);
    const schedules = new WorkSchedulesService(
      attendanceConfigurationAuditWriter,
      documentsService,
    );
    const arrangements = new WorkArrangementsService(
      attendanceConfigurationAuditWriter,
      documentsService,
    );
    const holidayCalendars = new HolidayCalendarsService(
      attendanceConfigurationAuditWriter,
      documentsService,
    );
    const initialEvidence = await createEvidence(admin, agency.id, membership.id, `${suffix}-1`);
    const successorEvidence = await createEvidence(admin, agency.id, membership.id, `${suffix}-2`);
    const arrangementEvidence = await createEvidence(
      admin,
      agency.id,
      membership.id,
      `${suffix}-3`,
    );
    const calendar = await admin.holidayCalendar.create({
      data: {
        agencyId: agency.id,
        code: `PH-NATIONAL-${suffix}`,
        name: 'Philippine National Holidays',
        scopeType: 'AGENCY',
        scopeReference: 'Agency-wide',
      },
    });

    try {
      const created = await schedules.create(context, {
        code: 'ORDINARY',
        name: 'Ordinary Work Schedule',
        scheduleType: 'REGULAR',
        effectiveDate: manilaDate(-1),
        dayRules: dayRules(),
      });
      if (!created.draft) throw new Error('The initial Draft was not created.');
      expect(created.draft.dayRules).toHaveLength(7);
      expect(created.draft.dayRules[0]).toMatchObject({
        weekday: 1,
        ruleType: 'FIXED',
        requiredMinutes: 480,
        breaks: [{ sequenceNo: 1, breakStartTime: '12:00', breakEndTime: '13:00' }],
      });
      await expect(schedules.list(context)).resolves.toHaveLength(1);

      await expect(
        schedules.activate(context, created.id, created.draft.id, {
          authorityDocumentVersionId: '00000000-0000-4000-8000-0000000000ff',
          approvingAuthority: 'Office of the President',
          reason: 'Authority reviewed.',
        }),
      ).rejects.toMatchObject({ code: 'WORK_SCHEDULE_EVIDENCE_REQUIRED' });

      const active = await schedules.activate(
        context,
        created.id,
        created.draft.id,
        {
          authorityDocumentVersionId: initialEvidence.id,
          approvingAuthority: 'Office of the President',
          reason: 'Authority reviewed.',
        },
        'activate-ordinary',
      );
      if (!active.currentVersion) throw new Error('The initial version was not projected current.');
      const activeVersionId = active.currentVersion.id;
      const activeVersionNo = active.currentVersion.versionNo;
      expect(active.currentVersion.versionState).toBe('ACTIVE');
      expect(active.currentVersion.activatedAt).not.toBeNull();

      const replayed = await schedules.activate(
        context,
        created.id,
        created.draft.id,
        {
          authorityDocumentVersionId: initialEvidence.id,
          approvingAuthority: 'Office of the President',
          reason: 'Authority reviewed.',
        },
        'activate-ordinary',
      );
      expect(replayed.currentVersion?.id).toBe(activeVersionId);
      await expect(
        schedules.activate(
          context,
          created.id,
          created.draft.id,
          {
            authorityDocumentVersionId: initialEvidence.id,
            approvingAuthority: 'Office of the President',
            reason: 'A different reason.',
          },
          'activate-ordinary',
        ),
      ).rejects.toMatchObject({ code: 'WORK_SCHEDULE_IDEMPOTENCY_CONFLICT' });
      await expect(
        admin.auditEvent.count({
          where: {
            agencyId: agency.id,
            action: 'WORK_SCHEDULE_VERSION_ACTIVATED',
          },
        }),
      ).resolves.toBe(1);

      await expect(
        withDatabaseContext(
          { agencyId: agency.id, userId: user.id, membershipId: membership.id },
          (transaction) =>
            transaction.workScheduleVersion.update({
              where: { agencyId_id: { agencyId: agency.id, id: activeVersionId } },
              data: { scheduleType: 'SHIFT' },
            }),
        ),
      ).rejects.toThrow(/application service|immutable/i);

      const successor = await schedules.createSuccessor(context, created.id);
      expect(successor.draft.effectiveFrom).toBe(manilaDate(1));
      const updatedDraft = await schedules.updateDraft(context, created.id, successor.draft.id, {
        scheduleType: 'REGULAR',
        effectiveDate: successor.draft.effectiveFrom,
        dayRules: dayRules().map((rule) =>
          rule.weekday === 1
            ? {
                ...rule,
                breaks: [
                  { breakStartTime: '12:00', breakEndTime: '12:30' },
                  { breakStartTime: '15:00', breakEndTime: '15:30' },
                ],
                requiredMinutes: 480,
              }
            : rule,
        ),
      });
      expect(updatedDraft.dayRules[0]?.breaks).toHaveLength(2);
      await expect(
        schedules.updateDraft(context, created.id, successor.draft.id, {
          scheduleType: 'REGULAR',
          effectiveDate: successor.draft.effectiveFrom,
          dayRules: dayRules(),
          rowVersion: 1,
        }),
      ).rejects.toMatchObject({ code: 'WORK_SCHEDULE_DRAFT_CONFLICT' });

      const successorActive = await schedules.activate(context, created.id, successor.draft.id, {
        authorityDocumentVersionId: successorEvidence.id,
        approvingAuthority: 'Office of the President',
        reason: 'Successor authority reviewed.',
      });
      expect(successorActive.currentVersion?.versionNo).toBe(activeVersionNo);
      const predecessor = await admin.workScheduleVersion.findFirstOrThrow({
        where: { id: activeVersionId },
      });
      expect(predecessor.status).toBe('SUPERSEDED');
      expect(predecessor.effectiveTo?.toISOString().slice(0, 10)).toBe(manilaDate(0));

      const detail = await schedules.findById(context, created.id, manilaDate(1));
      const successorVersion = detail?.versions.find(
        ({ versionState }) => versionState === 'ACTIVE',
      );
      expect(successorVersion?.versionNo).toBe(activeVersionNo + 1);
      expect(detail?.effective?.id).toBe(successorVersion?.id);
      expect(detail?.versions.map(({ versionState }) => versionState)).toEqual(
        expect.arrayContaining(['SUPERSEDED', 'ACTIVE']),
      );
      expect(detail?.history.map(({ action }) => action)).toEqual(
        expect.arrayContaining([
          'WORK_SCHEDULE_CREATED',
          'WORK_SCHEDULE_VERSION_ACTIVATED',
          'WORK_SCHEDULE_SUCCESSOR_CREATED',
        ]),
      );
      expect(detail?.schedule.draft).toBeNull();

      const arrangement = await arrangements.create(context, {
        code: 'HYBRID',
        name: 'Hybrid Work Arrangement',
        arrangementType: 'HYBRID',
        permittedScheduleTypes: ['REGULAR'],
        holidayCalendarId: calendar.id,
        effectiveDate: manilaDate(-1),
      });
      if (!arrangement.draft) throw new Error('The Work Arrangement Draft was not created.');
      const arrangementActive = await arrangements.activate(
        context,
        arrangement.id,
        arrangement.draft.id,
        {
          authorityDocumentVersionId: arrangementEvidence.id,
          approvingAuthority: 'Office of the President',
          reason: 'Arrangement authority reviewed.',
        },
        'activate-hybrid',
      );
      expect(arrangementActive.currentVersion?.arrangementType).toBe('HYBRID');
      expect(arrangementActive.currentVersion?.permittedScheduleTypes).toEqual(['REGULAR']);
      await expect(holidayCalendars.list(context)).resolves.toHaveLength(1);
      const arrangementDetail = await arrangements.findById(context, arrangement.id);
      expect(arrangementDetail?.history.map(({ action }) => action)).toEqual(
        expect.arrayContaining(['WORK_ARRANGEMENT_CREATED', 'WORK_ARRANGEMENT_VERSION_ACTIVATED']),
      );

      await expect(admin.workSchedule.delete({ where: { id: created.id } })).rejects.toThrow(
        /retained|deleted/i,
      );
      await expect(
        schedules.create(context, {
          code: 'ORDINARY',
          name: 'Duplicate Ordinary Work Schedule',
          scheduleType: 'REGULAR',
          effectiveDate: manilaDate(-1),
          dayRules: dayRules(),
        }),
      ).rejects.toMatchObject({ code: 'WORK_SCHEDULE_CODE_CONFLICT' });
    } finally {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.auditEvent.deleteMany({ where: { agencyId: agency.id } });
        await transaction.workScheduleBreakInterval.deleteMany({
          where: { agencyId: agency.id },
        });
        await transaction.workScheduleDayRule.deleteMany({ where: { agencyId: agency.id } });
        await transaction.workSchedule.updateMany({
          where: { agencyId: agency.id },
          data: { currentVersionId: null },
        });
        await transaction.workScheduleVersion.deleteMany({ where: { agencyId: agency.id } });
        await transaction.workSchedule.deleteMany({ where: { agencyId: agency.id } });
        await transaction.workArrangement.updateMany({
          where: { agencyId: agency.id },
          data: { currentVersionId: null },
        });
        await transaction.workArrangementVersion.deleteMany({ where: { agencyId: agency.id } });
        await transaction.workArrangement.deleteMany({ where: { agencyId: agency.id } });
        await transaction.holidayCalendar.deleteMany({ where: { agencyId: agency.id } });
        await transaction.documentVersion.deleteMany({ where: { agencyId: agency.id } });
        await transaction.document.deleteMany({ where: { agencyId: agency.id } });
      });
      await admin.agencyMembership.deleteMany({ where: { agencyId: agency.id } });
      await admin.agency.delete({ where: { id: agency.id } });
      await admin.user.delete({ where: { id: user.id } });
      await admin.$disconnect();
    }
  },
);
