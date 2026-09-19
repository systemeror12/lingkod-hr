import { PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { expect, it } from 'vitest';
import { documentAuditWriter, DocumentsService } from '../documents/documents.service';
import { attendanceConfigurationAuditWriter } from './attendance-configuration.audit';
import { HolidayCalendarsService } from './holiday-calendars.service';
import { ScheduleAssignmentsService } from './schedule-assignments.service';
import { WorkArrangementsService } from './work-arrangements.service';
import { WorkSchedulesService } from './work-schedules.service';

const enabled = process.env.DATABASE_E2E === 'true';

const permissions: RequestContext['permissions'] = [
  { code: 'attendance.configuration.read', scopePolicy: 'AGENCY' },
  { code: 'attendance.configuration.manage', scopePolicy: 'AGENCY' },
  { code: 'attendance.configuration.activate', scopePolicy: 'AGENCY' },
  { code: 'attendance.assignments.manage', scopePolicy: 'AGENCY' },
  { code: 'documents.evidence.read', scopePolicy: 'AGENCY' },
  { code: 'documents.evidence.read_sensitive', scopePolicy: 'AGENCY' },
];

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

function overnightDayRules() {
  return [1, 2, 3, 4, 5, 6, 7].map((weekday) =>
    weekday <= 5
      ? {
          weekday,
          ruleType: 'FIXED' as const,
          dutyStartTime: '22:00',
          dutyEndTime: '06:00',
          endNextCalendarDay: true,
          requiredMinutes: 480,
          eventPattern: 'IN_OUT' as const,
          collectionBeforeMinutes: 0,
          collectionAfterMinutes: 0,
          breaks: [],
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

function recentWeekday(target: number): string {
  for (let offset = 0; offset >= -30; offset -= 1) {
    const date = manilaDate(offset);
    if (new Date(`${date}T00:00:00.000Z`).getUTCDay() === target) return date;
  }
  throw new Error(`No weekday ${target} found in the last 30 days.`);
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
  documentType = 'WORK_SCHEDULE_AUTHORITY',
) {
  const document = await admin.document.create({
    data: {
      agencyId,
      documentType,
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
      storageKey: `assignments/${suffix}`,
      contentHash: 'd'.repeat(64),
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

async function createAgency(admin: PrismaClient, suffix: string) {
  const agency = await admin.agency.create({
    data: {
      code: `AG-${suffix}`,
      name: 'Assignment Flow Integration Agency',
      agencyType: 'NGA',
      status: 'ACTIVE',
    },
  });
  const user = await admin.user.create({
    data: {
      identityProvider: 'assignment-flow-integration',
      externalSubject: `assignment-flow-${suffix}`,
      emailNormalized: `assignment-flow-${suffix}@example.test`,
      displayName: 'Assignment Flow Integration User',
      globalStatus: 'ACTIVE',
    },
  });
  const membership = await admin.agencyMembership.create({
    data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
  });
  const unit = await admin.organizationUnit.create({
    data: { agencyId: agency.id, code: `UNIT-${suffix}`, unitType: 'DIVISION', status: 'ACTIVE' },
  });
  const unitVersion = await admin.organizationUnitVersion.create({
    data: {
      agencyId: agency.id,
      organizationUnitId: unit.id,
      versionNo: 1,
      name: 'Administrative Division',
      effectiveFrom: new Date('2020-01-01'),
      status: 'ACTIVE',
      domainStatus: 'ACTIVE',
    },
  });
  await admin.organizationUnit.update({
    where: { id: unit.id },
    data: { currentVersionId: unitVersion.id },
  });
  const context: RequestContext = {
    requestId: 'attendance-assignment-flow-integration',
    userId: user.id,
    agencyId: agency.id,
    membershipId: membership.id,
    primaryOrganizationUnitId: null,
    permissions,
  };
  return { agency, user, membership, unit, context };
}

async function createEmployee(
  admin: PrismaClient,
  values: {
    agencyId: string;
    membershipId: string;
    unitId: string;
    suffix: string;
    withSegment: boolean;
  },
) {
  const employee = await admin.employee.create({
    data: {
      agencyId: values.agencyId,
      employeeNumber: `EMP-${values.suffix}`,
      legalName: `Employee ${values.suffix}`,
      birthDate: new Date('1990-01-01'),
      sex: 'FEMALE',
      civilStatus: 'SINGLE',
      contactEmail: `employee-${values.suffix}@example.test`,
      serviceStatus: values.withSegment ? 'ACTIVE' : 'PREBOARDING',
      createdByMembershipId: values.membershipId,
      updatedByMembershipId: values.membershipId,
    },
  });
  if (values.withSegment) {
    await withDatabaseContext(
      {
        agencyId: values.agencyId,
        membershipId: values.membershipId,
        capabilities: ['personnel-baseline-transition'],
      },
      (transaction) =>
        transaction.serviceSegment.create({
          data: {
            agencyId: values.agencyId,
            employeeId: employee.id,
            organizationUnitId: values.unitId,
            appointmentStatus: 'PERMANENT',
            salaryGrade: 18,
            salaryStep: 2,
            effectiveFrom: new Date('2020-01-01'),
            status: 'ACTIVE',
            createdByMembershipId: values.membershipId,
          },
        }),
    );
  }
  return employee;
}

async function cleanupAgency(admin: PrismaClient, agencyId: string, userId: string): Promise<void> {
  await admin.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    await transaction.scheduleAssignment.deleteMany({ where: { agencyId } });
    await transaction.holidayCalendarEntry.deleteMany({ where: { agencyId } });
    await transaction.workArrangementVersion.deleteMany({ where: { agencyId } });
    await transaction.workArrangement.updateMany({
      where: { agencyId },
      data: { currentVersionId: null },
    });
    await transaction.workArrangement.deleteMany({ where: { agencyId } });
    await transaction.holidayCalendarVersion.deleteMany({ where: { agencyId } });
    await transaction.holidayCalendar.updateMany({
      where: { agencyId },
      data: { currentVersionId: null },
    });
    await transaction.holidayCalendar.deleteMany({ where: { agencyId } });
    await transaction.workScheduleBreakInterval.deleteMany({ where: { agencyId } });
    await transaction.workScheduleDayRule.deleteMany({ where: { agencyId } });
    await transaction.workScheduleVersion.deleteMany({ where: { agencyId } });
    await transaction.workSchedule.updateMany({
      where: { agencyId },
      data: { currentVersionId: null },
    });
    await transaction.workSchedule.deleteMany({ where: { agencyId } });
    await transaction.documentVersion.deleteMany({ where: { agencyId } });
    await transaction.document.updateMany({
      where: { agencyId },
      data: { currentVersionId: null },
    });
    await transaction.document.deleteMany({ where: { agencyId } });
    await transaction.employee.updateMany({
      where: { agencyId },
      data: { currentServiceSegmentId: null },
    });
    await transaction.serviceSegment.deleteMany({ where: { agencyId } });
    await transaction.organizationUnit.updateMany({
      where: { agencyId },
      data: { currentVersionId: null },
    });
    await transaction.organizationUnitVersion.deleteMany({ where: { agencyId } });
    await transaction.organizationUnit.deleteMany({ where: { agencyId } });
    await transaction.employee.deleteMany({ where: { agencyId } });
    await transaction.agencyMembership.deleteMany({ where: { agencyId } });
    await transaction.agency.delete({ where: { id: agencyId } });
    await transaction.user.delete({ where: { id: userId } });
  });
}

function services() {
  const documentsService = new DocumentsService({} as never, documentAuditWriter);
  const schedules = new WorkSchedulesService(attendanceConfigurationAuditWriter, documentsService);
  const arrangements = new WorkArrangementsService(
    attendanceConfigurationAuditWriter,
    documentsService,
  );
  const calendars = new HolidayCalendarsService(
    attendanceConfigurationAuditWriter,
    documentsService,
  );
  const assignments = new ScheduleAssignmentsService(
    attendanceConfigurationAuditWriter,
    documentsService,
    schedules,
    arrangements,
    calendars,
  );
  return { schedules, arrangements, calendars, assignments };
}

it.skipIf(!enabled)(
  'activates Holiday Calendar versions and supersedes the predecessor prospectively',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-calendar-flow`;
    const { agency, user, membership, context } = await createAgency(admin, suffix);
    const { calendars } = services();
    const evidence = await createEvidence(admin, agency.id, membership.id, suffix);

    try {
      const created = await calendars.create(context, {
        code: 'PH-NATIONAL',
        name: 'Philippine National Holidays',
        scopeType: 'AGENCY',
        scopeReference: 'Agency-wide',
        effectiveDate: manilaDate(-30),
        entries: [
          {
            holidayDate: '2026-12-25',
            name: 'Christmas Day',
            dayType: 'REGULAR_HOLIDAY',
            sourceReference: 'Proclamation No. 123',
          },
          {
            holidayDate: '2026-01-01',
            name: 'New Year',
            dayType: 'REGULAR_HOLIDAY',
            sourceReference: 'Proclamation No. 123',
          },
        ],
      });
      expect(created.currentVersion).toBeNull();
      expect(created.draft).toMatchObject({ versionState: 'DRAFT', versionNo: 1 });
      expect(created.draft?.entries.map(({ holidayDate }) => holidayDate)).toEqual([
        '2026-01-01',
        '2026-12-25',
      ]);

      const updated = await calendars.updateDraft(context, created.id, created.draft!.id, {
        effectiveDate: manilaDate(-30),
        entries: [
          {
            holidayDate: '2026-12-25',
            name: 'Christmas Day',
            dayType: 'REGULAR_HOLIDAY',
            sourceReference: 'Proclamation No. 123',
          },
        ],
        rowVersion: created.draft!.rowVersion,
      });
      expect(updated.entries).toHaveLength(1);

      const active = await calendars.activate(
        context,
        created.id,
        created.draft!.id,
        {
          authorityDocumentVersionId: evidence.id,
          approvingAuthority: 'Office of the President',
          reason: 'Proclamation reviewed.',
        },
        `calendar-activate-${suffix}`,
      );
      expect(active.currentVersion).toMatchObject({ versionState: 'ACTIVE', versionNo: 1 });
      expect(active.currentVersion?.effectiveTo).toBeNull();

      const replayed = await calendars.activate(
        context,
        created.id,
        created.draft!.id,
        {
          authorityDocumentVersionId: evidence.id,
          approvingAuthority: 'Office of the President',
          reason: 'Proclamation reviewed.',
        },
        `calendar-activate-${suffix}`,
      );
      expect(replayed.currentVersion?.id).toBe(active.currentVersion?.id);

      const successor = await calendars.createSuccessor(context, created.id);
      expect(successor.current.id).toBe(active.currentVersion?.id);
      expect(successor.draft).toMatchObject({ versionState: 'DRAFT', versionNo: 2 });
      expect(successor.draft.entries.map(({ holidayDate }) => holidayDate)).toEqual(['2026-12-25']);

      const successorFrom = manilaDate(30);
      await calendars.updateDraft(context, created.id, successor.draft.id, {
        effectiveDate: successorFrom,
        entries: successor.draft.entries.map(({ holidayDate, name, dayType, sourceReference }) => ({
          holidayDate,
          name,
          dayType,
          sourceReference,
        })),
        rowVersion: successor.draft.rowVersion,
      });
      const published = await calendars.activate(context, created.id, successor.draft.id, {
        authorityDocumentVersionId: evidence.id,
        approvingAuthority: 'Office of the President',
        reason: 'Annual calendar approved.',
      });
      expect(published.currentVersion).toMatchObject({ versionNo: 1, versionState: 'SUPERSEDED' });
      expect(published.currentVersion?.effectiveTo).toBe(
        new Date(new Date(`${successorFrom}T00:00:00.000Z`).getTime() - 86_400_000)
          .toISOString()
          .slice(0, 10),
      );
      expect(published.draft).toBeNull();

      const detail = await calendars.findById(context, created.id, successorFrom);
      expect(detail?.effective).toMatchObject({ versionNo: 2, versionState: 'ACTIVE' });
      expect(detail?.versions.map(({ versionState }) => versionState)).toEqual([
        'ACTIVE',
        'SUPERSEDED',
      ]);
      expect(detail?.history.map(({ action }) => action)).toEqual(
        expect.arrayContaining([
          'HOLIDAY_CALENDAR_CREATED',
          'HOLIDAY_CALENDAR_DRAFT_UPDATED',
          'HOLIDAY_CALENDAR_VERSION_ACTIVATED',
          'HOLIDAY_CALENDAR_SUCCESSOR_CREATED',
        ]),
      );
      await expect(calendars.list(context)).resolves.toHaveLength(1);
    } finally {
      await cleanupAgency(admin, agency.id, user.id);
      await admin.$disconnect();
    }
  },
);

it.skipIf(!enabled)(
  'binds Schedule Assignments and resolves one Work Date or fails closed',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-assignment-flow`;
    const { agency, user, membership, unit, context } = await createAgency(admin, suffix);
    const { schedules, arrangements, calendars, assignments } = services();
    const effectiveFrom = manilaDate(-30);
    const scheduleEvidence = await createEvidence(
      admin,
      agency.id,
      membership.id,
      `${suffix}-schedule`,
    );
    const arrangementEvidence = await createEvidence(
      admin,
      agency.id,
      membership.id,
      `${suffix}-arrangement`,
      'WORK_ARRANGEMENT_AUTHORITY',
    );
    const assignmentEvidence = await createEvidence(
      admin,
      agency.id,
      membership.id,
      `${suffix}-assignment`,
      'SCHEDULE_ASSIGNMENT_AUTHORITY',
    );

    try {
      const calendar = await calendars.create(context, {
        code: 'PH-NATIONAL',
        name: 'Philippine National Holidays',
        scopeType: 'AGENCY',
        scopeReference: 'Agency-wide',
        effectiveDate: effectiveFrom,
        entries: [
          {
            holidayDate: manilaDate(0),
            name: 'Agency Work Suspension',
            dayType: 'WORK_SUSPENSION',
            sourceReference: 'Memorandum Circular No. 1',
          },
        ],
      });
      const calendarActive = await calendars.activate(context, calendar.id, calendar.draft!.id, {
        authorityDocumentVersionId: scheduleEvidence.id,
        approvingAuthority: 'Office of the President',
        reason: 'Proclamation reviewed.',
      });
      expect(calendarActive.currentVersion).not.toBeNull();

      const schedule = await schedules.create(context, {
        code: 'ORDINARY',
        name: 'Ordinary Work Schedule',
        scheduleType: 'REGULAR',
        effectiveDate: effectiveFrom,
        dayRules: dayRules(),
      });
      const scheduleActive = await schedules.activate(context, schedule.id, schedule.draft!.id, {
        authorityDocumentVersionId: scheduleEvidence.id,
        approvingAuthority: 'Office of the President',
        reason: 'Schedule authority reviewed.',
      });
      const scheduleVersionId = scheduleActive.currentVersion?.id;
      if (!scheduleVersionId) throw new Error('The Work Schedule Version was not activated.');

      const arrangement = await arrangements.create(context, {
        code: 'ONSITE',
        name: 'Onsite Work Arrangement',
        arrangementType: 'ONSITE',
        permittedScheduleTypes: ['REGULAR'],
        holidayCalendarId: calendar.id,
        effectiveDate: effectiveFrom,
      });
      const arrangementActive = await arrangements.activate(
        context,
        arrangement.id,
        arrangement.draft!.id,
        {
          authorityDocumentVersionId: arrangementEvidence.id,
          approvingAuthority: 'Office of the President',
          reason: 'Arrangement authority reviewed.',
        },
      );
      const arrangementVersionId = arrangementActive.currentVersion?.id;
      if (!arrangementVersionId) throw new Error('The Work Arrangement Version was not activated.');

      const employee = await createEmployee(admin, {
        agencyId: agency.id,
        membershipId: membership.id,
        unitId: unit.id,
        suffix,
        withSegment: true,
      });
      const withoutSegment = await createEmployee(admin, {
        agencyId: agency.id,
        membershipId: membership.id,
        unitId: unit.id,
        suffix: `${suffix}-none`,
        withSegment: false,
      });

      await expect(
        assignments.create(context, {
          employeeId: withoutSegment.id,
          workScheduleVersionId: scheduleVersionId,
          workArrangementVersionId: arrangementVersionId,
          authorityDocumentVersionId: assignmentEvidence.id,
          effectiveFrom,
        }),
      ).rejects.toMatchObject({ code: 'SCHEDULE_ASSIGNMENT_NOT_APPLICABLE', statusCode: 409 });

      const idempotencyKey = `assignment-create-${suffix}`;
      const assignment = await assignments.create(
        context,
        {
          employeeId: employee.id,
          workScheduleVersionId: scheduleVersionId,
          workArrangementVersionId: arrangementVersionId,
          authorityDocumentVersionId: assignmentEvidence.id,
          effectiveFrom,
        },
        idempotencyKey,
      );
      expect(assignment).toMatchObject({
        employee: { id: employee.id },
        scheduleType: 'REGULAR',
        arrangementType: 'ONSITE',
        holidayCalendarId: calendar.id,
        effectiveFrom,
        effectiveTo: null,
      });

      await expect(
        assignments.create(
          context,
          {
            employeeId: employee.id,
            workScheduleVersionId: scheduleVersionId,
            workArrangementVersionId: arrangementVersionId,
            authorityDocumentVersionId: assignmentEvidence.id,
            effectiveFrom,
          },
          idempotencyKey,
        ),
      ).resolves.toMatchObject({ id: assignment.id });
      await expect(
        assignments.create(
          context,
          {
            employeeId: employee.id,
            workScheduleVersionId: scheduleVersionId,
            workArrangementVersionId: arrangementVersionId,
            authorityDocumentVersionId: assignmentEvidence.id,
            effectiveFrom: manilaDate(0),
          },
          idempotencyKey,
        ),
      ).rejects.toMatchObject({
        code: 'SCHEDULE_ASSIGNMENT_IDEMPOTENCY_CONFLICT',
        statusCode: 409,
      });
      await expect(
        assignments.create(context, {
          employeeId: employee.id,
          workScheduleVersionId: scheduleVersionId,
          workArrangementVersionId: arrangementVersionId,
          authorityDocumentVersionId: assignmentEvidence.id,
          effectiveFrom: manilaDate(0),
        }),
      ).rejects.toMatchObject({ code: 'SCHEDULE_ASSIGNMENT_PERIOD_OVERLAP', statusCode: 409 });

      const resolution = await assignments.resolveForWorkDate(context, employee.id, manilaDate(0));
      expect(resolution).toMatchObject({
        employeeId: employee.id,
        workDate: manilaDate(0),
        assignment: { id: assignment.id },
        workScheduleVersion: { id: scheduleVersionId },
        workArrangementVersion: { id: arrangementVersionId },
        holidayCalendarVersion: { id: calendarActive.currentVersion?.id },
      });
      expect(resolution.holidayEntries).toEqual([
        expect.objectContaining({ dayType: 'WORK_SUSPENSION' }),
      ]);
      expect(resolution.dayRule.weekday).toBeGreaterThanOrEqual(1);

      const restResolution = await assignments.resolveForWorkDate(
        context,
        employee.id,
        recentWeekday(6),
      );
      expect(restResolution.dayRule).toMatchObject({ weekday: 6, ruleType: 'REST' });
      expect(restResolution).toMatchObject({
        assignment: { id: assignment.id },
        workScheduleVersion: { id: scheduleVersionId, versionNo: 1 },
      });

      const successorCalendar = await calendars.createSuccessor(context, calendar.id);
      const calendarSuccessorFrom = manilaDate(15);
      await calendars.updateDraft(context, calendar.id, successorCalendar.draft.id, {
        effectiveDate: calendarSuccessorFrom,
        entries: [
          {
            holidayDate: manilaDate(20),
            name: 'Agency Foundation Day',
            dayType: 'LOCAL_HOLIDAY',
            sourceReference: 'Ordinance No. 2',
          },
        ],
        rowVersion: successorCalendar.draft.rowVersion,
      });
      const supersedingCalendar = await calendars.activate(
        context,
        calendar.id,
        successorCalendar.draft.id,
        {
          authorityDocumentVersionId: scheduleEvidence.id,
          approvingAuthority: 'Office of the President',
          reason: 'Annual calendar approved.',
        },
      );
      expect(supersedingCalendar.currentVersion).toMatchObject({
        versionNo: 1,
        versionState: 'SUPERSEDED',
      });

      const historicalResolution = await assignments.resolveForWorkDate(
        context,
        employee.id,
        manilaDate(0),
      );
      expect(historicalResolution).toMatchObject({
        assignment: { id: assignment.id },
        workScheduleVersion: { id: scheduleVersionId },
        workArrangementVersion: { id: arrangementVersionId },
        holidayCalendarVersion: { id: calendarActive.currentVersion?.id, versionNo: 1 },
      });
      expect(historicalResolution.holidayEntries).toEqual([
        expect.objectContaining({ dayType: 'WORK_SUSPENSION' }),
      ]);

      const supersededCalendarResolution = await assignments.resolveForWorkDate(
        context,
        employee.id,
        manilaDate(20),
      );
      expect(supersededCalendarResolution).toMatchObject({
        assignment: { id: assignment.id },
        holidayCalendarVersion: { versionNo: 2, versionState: 'ACTIVE' },
      });
      expect(supersededCalendarResolution.holidayEntries).toEqual([
        expect.objectContaining({ dayType: 'LOCAL_HOLIDAY', name: 'Agency Foundation Day' }),
      ]);

      const concurrentEmployee = await createEmployee(admin, {
        agencyId: agency.id,
        membershipId: membership.id,
        unitId: unit.id,
        suffix: `${suffix}-race`,
        withSegment: true,
      });
      const raceResults = await Promise.allSettled([
        assignments.create(context, {
          employeeId: concurrentEmployee.id,
          workScheduleVersionId: scheduleVersionId,
          workArrangementVersionId: arrangementVersionId,
          authorityDocumentVersionId: assignmentEvidence.id,
          effectiveFrom: manilaDate(10),
        }),
        assignments.create(context, {
          employeeId: concurrentEmployee.id,
          workScheduleVersionId: scheduleVersionId,
          workArrangementVersionId: arrangementVersionId,
          authorityDocumentVersionId: assignmentEvidence.id,
          effectiveFrom: manilaDate(10),
        }),
      ]);
      const raceOutcomes = raceResults.map((result) =>
        result.status === 'fulfilled'
          ? 'fulfilled'
          : `rejected:${(result.reason as { code?: string }).code ?? (result.reason as Error).message}`,
      );
      expect(raceOutcomes.sort()).toEqual([
        'fulfilled',
        'rejected:SCHEDULE_ASSIGNMENT_PERIOD_OVERLAP',
      ]);

      const successorSchedule = await schedules.createSuccessor(context, schedule.id);
      await schedules.updateDraft(context, schedule.id, successorSchedule.draft.id, {
        scheduleType: 'REGULAR',
        effectiveDate: manilaDate(15),
        dayRules: dayRules(),
        rowVersion: successorSchedule.draft.rowVersion,
      });
      const supersedingSchedule = await schedules.activate(
        context,
        schedule.id,
        successorSchedule.draft.id,
        {
          authorityDocumentVersionId: scheduleEvidence.id,
          approvingAuthority: 'Office of the President',
          reason: 'Annual schedule approved.',
        },
      );
      expect(supersedingSchedule.currentVersion).toMatchObject({
        versionNo: 1,
        versionState: 'SUPERSEDED',
      });
      await expect(
        assignments.resolveForWorkDate(context, employee.id, manilaDate(20)),
      ).rejects.toMatchObject({
        code: 'ATTENDANCE_EXCEPTION',
        exceptionType: 'MISSING_WORK_SCHEDULE_VERSION',
      });
      await expect(
        assignments.resolveForWorkDate(context, employee.id, manilaDate(0)),
      ).resolves.toMatchObject({
        workScheduleVersion: { id: scheduleVersionId, versionNo: 1 },
      });

      const overnightSchedule = await schedules.create(context, {
        code: 'NIGHT',
        name: 'Night Shift Work Schedule',
        scheduleType: 'SHIFT',
        effectiveDate: effectiveFrom,
        dayRules: overnightDayRules(),
      });
      const overnightActive = await schedules.activate(
        context,
        overnightSchedule.id,
        overnightSchedule.draft!.id,
        {
          authorityDocumentVersionId: scheduleEvidence.id,
          approvingAuthority: 'Office of the President',
          reason: 'Night shift authority reviewed.',
        },
      );
      const overnightArrangement = await arrangements.create(context, {
        code: 'NIGHT-ONSITE',
        name: 'Night Onsite Work Arrangement',
        arrangementType: 'ONSITE',
        permittedScheduleTypes: ['SHIFT'],
        holidayCalendarId: calendar.id,
        effectiveDate: effectiveFrom,
      });
      const overnightArrangementActive = await arrangements.activate(
        context,
        overnightArrangement.id,
        overnightArrangement.draft!.id,
        {
          authorityDocumentVersionId: arrangementEvidence.id,
          approvingAuthority: 'Office of the President',
          reason: 'Night shift arrangement authority reviewed.',
        },
      );
      const overnightEmployee = await createEmployee(admin, {
        agencyId: agency.id,
        membershipId: membership.id,
        unitId: unit.id,
        suffix: `${suffix}-night`,
        withSegment: true,
      });
      const overnightAssignment = await assignments.create(context, {
        employeeId: overnightEmployee.id,
        workScheduleVersionId: overnightActive.currentVersion!.id,
        workArrangementVersionId: overnightArrangementActive.currentVersion!.id,
        authorityDocumentVersionId: assignmentEvidence.id,
        effectiveFrom,
      });
      const overnightResolution = await assignments.resolveForWorkDate(
        context,
        overnightEmployee.id,
        recentWeekday(5),
      );
      expect(overnightResolution).toMatchObject({
        assignment: { id: overnightAssignment.id },
        workScheduleVersion: { id: overnightActive.currentVersion?.id },
        dayRule: { endNextCalendarDay: true, dutyStartTime: '22:00', dutyEndTime: '06:00' },
      });

      await expect(
        assignments.resolveForWorkDate(context, withoutSegment.id, manilaDate(0)),
      ).rejects.toMatchObject({
        code: 'ATTENDANCE_EXCEPTION',
        statusCode: 409,
        exceptionType: 'MISSING_SERVICE',
      });

      const shiftSchedule = await schedules.create(context, {
        code: 'SHIFT',
        name: 'Shift Work Schedule',
        scheduleType: 'SHIFT',
        effectiveDate: effectiveFrom,
        dayRules: dayRules(),
      });
      const shiftActive = await schedules.activate(
        context,
        shiftSchedule.id,
        shiftSchedule.draft!.id,
        {
          authorityDocumentVersionId: scheduleEvidence.id,
          approvingAuthority: 'Office of the President',
          reason: 'Shift schedule authority reviewed.',
        },
      );
      await expect(
        assignments.create(context, {
          employeeId: employee.id,
          workScheduleVersionId: shiftActive.currentVersion!.id,
          workArrangementVersionId: arrangementVersionId,
          authorityDocumentVersionId: assignmentEvidence.id,
          effectiveFrom: manilaDate(0),
        }),
      ).rejects.toMatchObject({
        code: 'SCHEDULE_ASSIGNMENT_INCOMPATIBLE_VERSIONS',
        statusCode: 409,
      });

      const ended = await assignments.end(context, assignment.id, {
        effectiveTo: manilaDate(0),
        reason: 'Reassignment prepared.',
      });
      expect(ended.effectiveTo).toBe(manilaDate(0));
      await expect(
        assignments.end(context, assignment.id, {
          effectiveTo: manilaDate(0),
          reason: 'Reassignment prepared.',
        }),
      ).resolves.toMatchObject({ id: assignment.id });
      await expect(
        assignments.end(context, assignment.id, {
          effectiveTo: manilaDate(1),
          reason: 'Different end date.',
        }),
      ).rejects.toMatchObject({ code: 'SCHEDULE_ASSIGNMENT_ENDED_CONFLICT', statusCode: 409 });
      await expect(
        assignments.resolveForWorkDate(context, employee.id, manilaDate(1)),
      ).rejects.toMatchObject({
        code: 'ATTENDANCE_EXCEPTION',
        exceptionType: 'MISSING_SCHEDULE_ASSIGNMENT',
      });

      const listed = await assignments.list(context, {
        employeeId: employee.id,
        asOf: manilaDate(0),
      });
      expect(listed.map(({ id }) => id)).toEqual([assignment.id]);
      await expect(
        assignments.list(context, { employeeId: employee.id, asOf: manilaDate(1) }),
      ).resolves.toHaveLength(0);
    } finally {
      await cleanupAgency(admin, agency.id, user.id);
      await admin.$disconnect();
    }
  },
);
