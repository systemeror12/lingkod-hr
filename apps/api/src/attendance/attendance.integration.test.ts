import { PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { expect, it } from 'vitest';
import { documentAuditWriter, DocumentsService } from '../documents/documents.service';
import { attendanceConfigurationAuditWriter } from '../attendance-configuration/attendance-configuration.audit';
import { HolidayCalendarsService } from '../attendance-configuration/holiday-calendars.service';
import { ScheduleAssignmentsService } from '../attendance-configuration/schedule-assignments.service';
import { WorkArrangementsService } from '../attendance-configuration/work-arrangements.service';
import { WorkSchedulesService } from '../attendance-configuration/work-schedules.service';
import { attendanceAuditWriter } from './attendance.audit';
import { AttendanceService } from './attendance.service';
import type { AttendanceCaptureException } from './attendance.types';

const enabled = process.env.DATABASE_E2E === 'true';

const permissions: RequestContext['permissions'] = [
  { code: 'attendance.configuration.read', scopePolicy: 'AGENCY' },
  { code: 'attendance.configuration.manage', scopePolicy: 'AGENCY' },
  { code: 'attendance.configuration.activate', scopePolicy: 'AGENCY' },
  { code: 'attendance.assignments.manage', scopePolicy: 'AGENCY' },
  { code: 'documents.evidence.read', scopePolicy: 'AGENCY' },
  { code: 'documents.evidence.read_sensitive', scopePolicy: 'AGENCY' },
  { code: 'attendance.events.read', scopePolicy: 'AGENCY' },
  { code: 'attendance.events.create_manual', scopePolicy: 'AGENCY' },
  { code: 'attendance.events.clock', scopePolicy: 'AGENCY' },
];

const ownPermissions: RequestContext['permissions'] = [
  { code: 'attendance.events.read', scopePolicy: 'OWN' },
  { code: 'attendance.events.create_manual', scopePolicy: 'OWN' },
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

function pastWeekday(target: number): string {
  for (let offset = -1; offset >= -30; offset -= 1) {
    const date = manilaDate(offset);
    if (new Date(`${date}T00:00:00.000Z`).getUTCDay() === target) return date;
  }
  throw new Error(`No weekday ${target} found in the last 30 days.`);
}

function manilaInstant(dateValue: string, timeValue: string): string {
  return `${dateValue}T${timeValue}:00+08:00`;
}

async function createAdminClient(): Promise<PrismaClient> {
  const databaseUrl =
    process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
  if (!databaseUrl) throw new Error('A database owner URL is required for the integration test.');
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
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
          eventPattern: 'WITH_BREAK_EVENTS' as const,
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

async function createEvidence(
  admin: PrismaClient,
  agencyId: string,
  membershipId: string,
  suffix: string,
  documentType: string,
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
      storageKey: `attendance/${suffix}`,
      contentHash: 'a'.repeat(64),
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
      name: 'Attendance Capture Integration Agency',
      agencyType: 'NGA',
      status: 'ACTIVE',
    },
  });
  const user = await admin.user.create({
    data: {
      emailNormalized: `attendance-capture-${suffix}@example.test`,
      displayName: 'Attendance Capture Integration User',
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
    requestId: 'attendance-capture-integration',
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

async function createMembership(admin: PrismaClient, values: { agencyId: string; suffix: string }) {
  const user = await admin.user.create({
    data: {
      emailNormalized: `attendance-capture-${values.suffix}@example.test`,
      displayName: 'Attendance Capture Integration User',
      globalStatus: 'ACTIVE',
    },
  });
  const membership = await admin.agencyMembership.create({
    data: {
      agencyId: values.agencyId,
      userId: user.id,
      status: 'ACTIVE',
    },
  });
  return { user, membership };
}

async function linkMembership(values: {
  agencyId: string;
  actorMembershipId: string;
  membershipId: string;
  employeeId: string;
}): Promise<void> {
  await withDatabaseContext(
    {
      agencyId: values.agencyId,
      membershipId: values.actorMembershipId,
      capabilities: ['employee-membership-link'],
    },
    (transaction) =>
      transaction.agencyMembership.update({
        where: { id: values.membershipId },
        data: { employeeId: values.employeeId },
      }),
  );
}

async function cleanupAgency(admin: PrismaClient, agencyId: string, suffix: string): Promise<void> {
  await admin.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    await transaction.attendanceEvent.deleteMany({ where: { agencyId } });
    await transaction.attendanceWebClockVersion.deleteMany({ where: { agencyId } });
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
    await transaction.user.deleteMany({
      where: { emailNormalized: { contains: suffix } },
    });
  });
}

function configurationServices() {
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

function exceptionTypes(exceptions: AttendanceCaptureException[]): string[] {
  return exceptions.map(({ type }) => type);
}

it.skipIf(!enabled)(
  'captures manual and web clock Attendance Events under an effective-dated enablement',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-attendance-capture`;
    const { agency, membership, unit, context } = await createAgency(admin, suffix);
    const { schedules, arrangements, calendars, assignments } = configurationServices();
    const attendance = new AttendanceService(attendanceAuditWriter, assignments);
    const effectiveFrom = manilaDate(-30);
    const scheduleEvidence = await createEvidence(
      admin,
      agency.id,
      membership.id,
      `${suffix}-schedule`,
      'WORK_SCHEDULE_AUTHORITY',
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
            holidayDate: '2026-12-25',
            name: 'Christmas Day',
            dayType: 'REGULAR_HOLIDAY',
            sourceReference: 'Proclamation No. 123',
          },
        ],
      });
      await calendars.activate(context, calendar.id, calendar.draft!.id, {
        authorityDocumentVersionId: scheduleEvidence.id,
        approvingAuthority: 'Office of the President',
        reason: 'Proclamation reviewed.',
      });

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

      const employee = await createEmployee(admin, {
        agencyId: agency.id,
        membershipId: membership.id,
        unitId: unit.id,
        suffix,
        withSegment: true,
      });
      await linkMembership({
        agencyId: agency.id,
        actorMembershipId: membership.id,
        membershipId: membership.id,
        employeeId: employee.id,
      });
      const assignment = await assignments.create(context, {
        employeeId: employee.id,
        workScheduleVersionId: scheduleActive.currentVersion!.id,
        workArrangementVersionId: arrangementActive.currentVersion!.id,
        authorityDocumentVersionId: assignmentEvidence.id,
        effectiveFrom,
      });

      const withoutSegment = await createEmployee(admin, {
        agencyId: agency.id,
        membershipId: membership.id,
        unitId: unit.id,
        suffix: `${suffix}-preboarding`,
        withSegment: false,
      });
      const unassigned = await createEmployee(admin, {
        agencyId: agency.id,
        membershipId: membership.id,
        unitId: unit.id,
        suffix: `${suffix}-unassigned`,
        withSegment: true,
      });
      const withoutSegmentMembership = await createMembership(admin, {
        agencyId: agency.id,
        suffix: `${suffix}-preboarding`,
      });
      await linkMembership({
        agencyId: agency.id,
        actorMembershipId: membership.id,
        membershipId: withoutSegmentMembership.membership.id,
        employeeId: withoutSegment.id,
      });
      const unlinkedMembership = await createMembership(admin, {
        agencyId: agency.id,
        suffix: `${suffix}-unlinked`,
      });
      const ownMembership = await createMembership(admin, {
        agencyId: agency.id,
        suffix: `${suffix}-own`,
      });
      const withoutSegmentContext: RequestContext = {
        ...context,
        requestId: 'attendance-preboarding-context',
        userId: withoutSegmentMembership.user.id,
        membershipId: withoutSegmentMembership.membership.id,
      };
      const unlinkedContext: RequestContext = {
        ...context,
        requestId: 'attendance-unlinked-context',
        userId: unlinkedMembership.user.id,
        membershipId: unlinkedMembership.membership.id,
      };
      const ownContext: RequestContext = {
        ...context,
        requestId: 'attendance-own-context',
        userId: ownMembership.user.id,
        membershipId: ownMembership.membership.id,
        permissions: ownPermissions,
      };

      const initialStatus = await attendance.getWebClockStatus(context);
      expect(initialStatus).toMatchObject({ enabled: false, version: null, history: [] });

      await expect(attendance.getClockState(context)).resolves.toMatchObject({
        enabled: false,
        nextEventType: null,
        events: [],
      });
      await expect(attendance.clock(context, {})).rejects.toMatchObject({
        code: 'ATTENDANCE_WEB_CLOCK_DISABLED',
        statusCode: 409,
      });
      await expect(
        attendance.setWebClockEnablement(context, {
          enabled: true,
          effectiveFrom: manilaDate(-1),
          reason: 'Backdated approval.',
        }),
      ).rejects.toMatchObject({ code: 'ATTENDANCE_WEB_CLOCK_EFFECTIVE_PAST', statusCode: 400 });

      const enableKey = `enable-web-clock-${suffix}`;
      const enabledStatus = await attendance.setWebClockEnablement(
        context,
        { enabled: true, effectiveFrom: manilaDate(0), reason: 'Approved web clock.' },
        enableKey,
      );
      expect(enabledStatus).toMatchObject({
        enabled: true,
        version: { versionNo: 1, status: 'ACTIVE' },
      });
      const replayed = await attendance.setWebClockEnablement(
        context,
        { enabled: true, effectiveFrom: manilaDate(0), reason: 'Approved web clock.' },
        enableKey,
      );
      expect(replayed.version?.id).toBe(enabledStatus.version?.id);
      await expect(
        attendance.setWebClockEnablement(
          context,
          { enabled: true, effectiveFrom: manilaDate(1), reason: 'A different command.' },
          enableKey,
        ),
      ).rejects.toMatchObject({ code: 'ATTENDANCE_IDEMPOTENCY_CONFLICT', statusCode: 409 });
      await expect(
        attendance.setWebClockEnablement(context, {
          enabled: true,
          effectiveFrom: manilaDate(1),
          reason: 'Repeated enablement.',
        }),
      ).rejects.toMatchObject({ code: 'ATTENDANCE_WEB_CLOCK_UNCHANGED', statusCode: 409 });

      const workDate = pastWeekday(5);
      const timeIn = await attendance.captureManual(context, {
        employeeId: employee.id,
        eventType: 'TIME_IN',
        eventTime: manilaInstant(workDate, '08:00'),
        reason: 'Biometric outage.',
      });
      expect(timeIn.match).toMatchObject({
        status: 'MATCHED',
        workDate,
        association: { scheduleAssignmentId: assignment.id, workDate },
      });
      expect(timeIn.exceptions).toEqual([]);

      const breakOut = await attendance.captureManual(context, {
        employeeId: employee.id,
        eventType: 'BREAK_OUT',
        eventTime: manilaInstant(workDate, '12:00'),
        reason: 'Biometric outage.',
      });
      expect(exceptionTypes(breakOut.exceptions)).toEqual([]);
      await attendance.captureManual(context, {
        employeeId: employee.id,
        eventType: 'BREAK_IN',
        eventTime: manilaInstant(workDate, '13:00'),
        reason: 'Biometric outage.',
      });
      const timeOut = await attendance.captureManual(context, {
        employeeId: employee.id,
        eventType: 'TIME_OUT',
        eventTime: manilaInstant(workDate, '17:00'),
        reason: 'Biometric outage.',
      });
      expect(exceptionTypes(timeOut.exceptions)).toEqual([]);

      const duplicate = await attendance.captureManual(context, {
        employeeId: employee.id,
        eventType: 'TIME_IN',
        eventTime: manilaInstant(workDate, '08:30'),
        reason: 'Duplicate control.',
      });
      expect(exceptionTypes(duplicate.exceptions)).toContain('DUPLICATE_ATTENDANCE_EVENT');

      const restTimeIn = await attendance.captureManual(context, {
        employeeId: employee.id,
        eventType: 'TIME_IN',
        eventTime: manilaInstant(pastWeekday(6), '10:00'),
        reason: 'Rest day service.',
      });
      expect(restTimeIn.match).toMatchObject({ status: 'MATCHED', unscheduled: true });
      expect(restTimeIn.presentation).toMatchObject({
        slot: null,
        label: 'Unscheduled time in',
      });

      const contextView = await attendance.getEventContext(context, employee.id, workDate);
      expect(contextView.association).toMatchObject({
        workDate,
        scheduleAssignmentId: assignment.id,
      });
      expect(contextView.exceptions).toEqual([]);
      expect(contextView.events).toHaveLength(5);
      expect(
        contextView.events.map(({ presentation }) => presentation?.slot).filter(Boolean),
      ).toEqual(['AM_IN', 'AM_OUT', 'PM_IN', 'PM_OUT']);

      const listed = await attendance.listEvents(context, {
        employeeId: employee.id,
        from: workDate,
        to: workDate,
      });
      expect(listed).toHaveLength(5);
      expect(listed.every((event) => event.employeeId === employee.id)).toBe(true);
      await expect(
        attendance.listEvents(context, { from: manilaDate(0), to: manilaDate(-1) }),
      ).rejects.toMatchObject({ code: 'ATTENDANCE_EVENT_RANGE_INVALID', statusCode: 400 });

      await expect(
        attendance.captureManual(context, {
          employeeId: employee.id,
          eventType: 'TIME_OUT',
          eventTime: new Date(Date.now() + 600_000).toISOString(),
          reason: 'Future entry.',
        }),
      ).rejects.toMatchObject({ code: 'ATTENDANCE_EVENT_FUTURE', statusCode: 400 });

      const restKey = `rest-entry-${suffix}`;
      const restDate = pastWeekday(6);
      const restCapture = await attendance.captureManual(
        context,
        {
          employeeId: employee.id,
          eventType: 'TIME_OUT',
          eventTime: manilaInstant(restDate, '11:00'),
          reason: 'Rest day service.',
        },
        restKey,
      );
      expect(exceptionTypes(restCapture.exceptions)).toEqual([]);
      await expect(
        attendance.captureManual(
          context,
          {
            employeeId: employee.id,
            eventType: 'TIME_OUT',
            eventTime: manilaInstant(restDate, '11:00'),
            reason: 'Rest day service.',
          },
          restKey,
        ),
      ).resolves.toMatchObject({ event: { id: restCapture.event.id } });
      await expect(
        attendance.captureManual(
          context,
          {
            employeeId: employee.id,
            eventType: 'TIME_OUT',
            eventTime: manilaInstant(restDate, '15:00'),
            reason: 'Different end time.',
          },
          restKey,
        ),
      ).rejects.toMatchObject({ code: 'ATTENDANCE_IDEMPOTENCY_CONFLICT', statusCode: 409 });

      const unmatched = await attendance.captureManual(context, {
        employeeId: unassigned.id,
        eventType: 'TIME_IN',
        eventTime: manilaInstant(manilaDate(-1), '09:00'),
        reason: 'No assignment yet.',
      });
      expect(unmatched.match.status).toBe('UNMATCHED');
      expect(exceptionTypes(unmatched.exceptions)).toEqual(
        expect.arrayContaining(['UNMATCHED_ATTENDANCE_EVENT', 'MISSING_SCHEDULE_ASSIGNMENT']),
      );

      await expect(
        attendance.listEvents(
          { ...ownContext, permissions: [{ code: 'attendance.events.read', scopePolicy: 'OWN' }] },
          {},
        ),
      ).rejects.toMatchObject({ code: 'ATTENDANCE_EVENT_READ_FORBIDDEN', statusCode: 403 });
      await expect(
        attendance.captureManual(ownContext, {
          employeeId: employee.id,
          eventType: 'TIME_IN',
          eventTime: manilaInstant(workDate, '09:00'),
          reason: 'Someone else records this.',
        }),
      ).rejects.toMatchObject({ code: 'ATTENDANCE_EVENT_CREATE_FORBIDDEN', statusCode: 403 });
      await linkMembership({
        agencyId: agency.id,
        actorMembershipId: membership.id,
        membershipId: ownMembership.membership.id,
        employeeId: unassigned.id,
      });
      await expect(
        attendance.captureManual(ownContext, {
          employeeId: unassigned.id,
          eventType: 'TIME_IN',
          eventTime: manilaInstant(workDate, '09:15'),
          reason: 'Own record.',
        }),
      ).rejects.toMatchObject({ code: 'ATTENDANCE_EVENT_CREATE_FORBIDDEN', statusCode: 403 });
      const ownListed = await attendance.listEvents(ownContext, {});
      expect(ownListed).not.toHaveLength(0);
      expect(ownListed.every((event) => event.employeeId === unassigned.id)).toBe(true);

      const clockState = await attendance.getClockState(context);
      expect(clockState).toMatchObject({ enabled: true, employee: { id: employee.id } });
      expect(clockState.nextEventType).toBe('TIME_IN');
      await expect(attendance.clock(context, { eventType: 'TIME_OUT' })).rejects.toMatchObject({
        code: 'ATTENDANCE_CLOCK_SEQUENCE_CONFLICT',
        statusCode: 409,
      });

      const clockKey = `clock-${suffix}`;
      const [clocked, concurrentReplay] = await Promise.all([
        attendance.clock(context, {}, clockKey),
        attendance.clock(context, {}, clockKey),
      ]);
      expect(clocked.event.id).toBe(concurrentReplay.event.id);
      expect(clocked).toMatchObject({
        event: {
          employeeId: employee.id,
          eventType: 'TIME_IN',
          source: 'WEB_CLOCK',
          reason: null,
          sourceReference: context.requestId,
          enteredByMembershipId: context.membershipId,
        },
      });
      await expect(
        attendance.clock(context, { eventType: 'BREAK_IN' }, clockKey),
      ).rejects.toMatchObject({ code: 'ATTENDANCE_IDEMPOTENCY_CONFLICT', statusCode: 409 });

      await expect(attendance.clock(withoutSegmentContext, {})).rejects.toMatchObject({
        code: 'ATTENDANCE_EXCEPTION',
        statusCode: 409,
        exceptionType: 'MISSING_SERVICE',
      });
      await expect(attendance.clock(unlinkedContext, {})).rejects.toMatchObject({
        code: 'ATTENDANCE_CLOCK_EMPLOYEE_REQUIRED',
        statusCode: 409,
      });

      const superseded = await attendance.setWebClockEnablement(context, {
        enabled: false,
        effectiveFrom: manilaDate(1),
        reason: 'Web clock suspended.',
      });
      expect(superseded.history.map(({ versionNo }) => versionNo)).toEqual([2, 1]);
      expect(superseded.history[1]).toMatchObject({
        versionNo: 1,
        status: 'SUPERSEDED',
        effectiveTo: manilaDate(0),
      });
      await expect(attendance.getWebClockStatus(context, manilaDate(1))).resolves.toMatchObject({
        enabled: false,
      });
      await expect(attendance.getWebClockStatus(context, manilaDate(0))).resolves.toMatchObject({
        enabled: true,
      });
      await expect(
        attendance.setWebClockEnablement(context, {
          enabled: true,
          effectiveFrom: manilaDate(0),
          reason: 'Retroactive change.',
        }),
      ).rejects.toMatchObject({
        code: 'ATTENDANCE_WEB_CLOCK_EFFECTIVE_CONFLICT',
        statusCode: 409,
      });

      await expect(
        admin.$executeRawUnsafe(
          'UPDATE attendance_events SET reason = $1 WHERE id = $2::uuid',
          'Tampered.',
          timeIn.event.id,
        ),
      ).rejects.toThrow();
      await expect(
        admin.$executeRawUnsafe(
          `INSERT INTO attendance_web_clock_versions
             (agency_id, version_no, enabled, effective_from, status, reason,
              activated_by_membership_id, activated_at)
           VALUES ($1::uuid, 9, true, CURRENT_DATE, 'ACTIVE', 'Direct insert.',
                   $2::uuid, CURRENT_TIMESTAMP)`,
          agency.id,
          membership.id,
        ),
      ).rejects.toThrow();
    } finally {
      await cleanupAgency(admin, agency.id, suffix);
      await admin.$disconnect();
    }
  },
  60_000,
);
