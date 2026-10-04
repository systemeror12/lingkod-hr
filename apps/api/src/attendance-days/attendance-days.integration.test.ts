import { PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { expect, it } from 'vitest';
import { attendanceConfigurationAuditWriter } from '../attendance-configuration/attendance-configuration.audit';
import { HolidayCalendarsService } from '../attendance-configuration/holiday-calendars.service';
import { ScheduleAssignmentsService } from '../attendance-configuration/schedule-assignments.service';
import { WorkArrangementsService } from '../attendance-configuration/work-arrangements.service';
import { WorkSchedulesService } from '../attendance-configuration/work-schedules.service';
import { attendanceContextAuditWriter } from '../attendance-contexts/attendance-contexts.audit';
import { AttendanceContextsService } from '../attendance-contexts/attendance-contexts.service';
import { attendanceAuditWriter } from '../attendance/attendance.audit';
import { AttendanceService } from '../attendance/attendance.service';
import { documentAuditWriter, DocumentsService } from '../documents/documents.service';
import { AttendancePostedLeaveInputsService } from '../attendance-posted-leave-inputs/attendance-posted-leave-inputs.service';
import { attendanceDayAuditWriter } from './attendance-days.audit';
import { AttendanceDaysService } from './attendance-days.service';

const enabled = process.env.DATABASE_E2E === 'true';

const permissions: RequestContext['permissions'] = [
  { code: 'attendance.configuration.read', scopePolicy: 'AGENCY' },
  { code: 'attendance.configuration.manage', scopePolicy: 'AGENCY' },
  { code: 'attendance.configuration.activate', scopePolicy: 'AGENCY' },
  { code: 'attendance.assignments.manage', scopePolicy: 'AGENCY' },
  { code: 'attendance.contexts.read', scopePolicy: 'AGENCY' },
  { code: 'attendance.contexts.create', scopePolicy: 'AGENCY' },
  { code: 'attendance.days.calculate', scopePolicy: 'AGENCY' },
  { code: 'attendance.days.read', scopePolicy: 'AGENCY' },
  { code: 'documents.evidence.read', scopePolicy: 'AGENCY' },
];

const ownPermissions: RequestContext['permissions'] = [
  { code: 'attendance.days.read', scopePolicy: 'OWN' },
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

function pastWeekend(): string {
  for (let offset = -1; offset >= -30; offset -= 1) {
    const date = manilaDate(offset);
    if ([0, 6].includes(new Date(`${date}T00:00:00.000Z`).getUTCDay())) return date;
  }
  throw new Error('No weekend day found in the last 30 days.');
}

function manilaInstant(dateValue: string, timeValue: string): Date {
  return new Date(`${dateValue}T${timeValue}:00+08:00`);
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
      storageKey: `attendance-days/${suffix}`,
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

async function createAgency(admin: PrismaClient, suffix: string) {
  const agency = await admin.agency.create({
    data: {
      code: `ADAY-${suffix}`,
      name: 'Attendance Day Integration Agency',
      agencyType: 'NGA',
      status: 'ACTIVE',
    },
  });
  const user = await admin.user.create({
    data: {
      emailNormalized: `attendance-day-${suffix}@example.test`,
      displayName: 'Attendance Day Integration User',
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
    requestId: 'attendance-day-integration',
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
  const attendance = new AttendanceService(attendanceAuditWriter, assignments);
  const contexts = new AttendanceContextsService(
    attendanceContextAuditWriter,
    documentsService,
    attendance,
  );
  const postedLeaveInputs = new AttendancePostedLeaveInputsService();
  const days = new AttendanceDaysService(
    attendanceDayAuditWriter,
    assignments,
    attendance,
    contexts,
    postedLeaveInputs,
  );
  return {
    schedules,
    arrangements,
    calendars,
    assignments,
    attendance,
    contexts,
    postedLeaveInputs,
    days,
  };
}

async function setupSchedule(
  admin: PrismaClient,
  values: {
    context: RequestContext;
    membershipId: string;
    suffix: string;
    effectiveFrom: string;
  },
) {
  const { context, membershipId, suffix, effectiveFrom } = values;
  const services = configurationServices();
  const { schedules, arrangements, calendars, assignments } = services;
  const scheduleEvidence = await createEvidence(
    admin,
    context.agencyId,
    membershipId,
    `${suffix}-schedule`,
    'WORK_SCHEDULE_AUTHORITY',
  );
  const arrangementEvidence = await createEvidence(
    admin,
    context.agencyId,
    membershipId,
    `${suffix}-arrangement`,
    'WORK_ARRANGEMENT_AUTHORITY',
  );
  const assignmentEvidence = await createEvidence(
    admin,
    context.agencyId,
    membershipId,
    `${suffix}-assignment`,
    'SCHEDULE_ASSIGNMENT_AUTHORITY',
  );
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
  return {
    ...services,
    schedules,
    arrangements,
    calendars,
    assignments,
    scheduleEvidence,
    arrangementEvidence,
    assignmentEvidence,
    scheduleVersionId: scheduleActive.currentVersion!.id,
    arrangementVersionId: arrangementActive.currentVersion!.id,
  };
}

async function cleanupAgency(admin: PrismaClient, agencyId: string, suffix: string): Promise<void> {
  await admin.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    await transaction.attendanceException.deleteMany({ where: { agencyId } });
    await transaction.attendanceDaySegment.deleteMany({ where: { agencyId } });
    await transaction.attendanceDay.deleteMany({ where: { agencyId } });
    await transaction.attendancePeriod.deleteMany({ where: { agencyId } });
    await transaction.attendanceContext.deleteMany({ where: { agencyId } });
    await transaction.attendancePostedLeaveInput.deleteMany({ where: { agencyId } });
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
    await transaction.user.deleteMany({ where: { emailNormalized: { contains: suffix } } });
  });
}

it.skipIf(!enabled)(
  'calculates a fixed Attendance Day, keeps recalculation idempotent, and versions changes',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-attendance-day`;
    const { agency, membership, unit, context } = await createAgency(admin, suffix);
    const workDate = pastWeekday(1);
    const effectiveFrom = manilaDate(-30);

    try {
      const setup = await setupSchedule(admin, {
        context,
        membershipId: membership.id,
        suffix,
        effectiveFrom,
      });
      const employee = await createEmployee(admin, {
        agencyId: agency.id,
        membershipId: membership.id,
        unitId: unit.id,
        suffix,
        withSegment: true,
      });
      await withDatabaseContext(
        {
          agencyId: agency.id,
          membershipId: membership.id,
          capabilities: ['employee-membership-link'],
        },
        (transaction) =>
          transaction.agencyMembership.update({
            where: { agencyId_id: { agencyId: agency.id, id: membership.id } },
            data: { employeeId: employee.id },
          }),
      );
      await setup.assignments.create(context, {
        employeeId: employee.id,
        workScheduleVersionId: setup.scheduleVersionId,
        workArrangementVersionId: setup.arrangementVersionId,
        authorityDocumentVersionId: setup.assignmentEvidence.id,
        effectiveFrom,
      });
      for (const [eventType, timeValue] of [
        ['TIME_IN', '08:00'],
        ['BREAK_OUT', '12:00'],
        ['BREAK_IN', '13:00'],
        ['TIME_OUT', '17:00'],
      ] as const) {
        await admin.attendanceEvent.create({
          data: {
            agencyId: agency.id,
            employeeId: employee.id,
            eventTime: manilaInstant(workDate, timeValue),
            eventType,
            source: 'MANUAL',
            enteredByMembershipId: membership.id,
            reason: 'Integration test capture.',
          },
        });
      }

      const first = await setup.days.calculate(context, {
        periodCode: '2026-01',
        dateFrom: workDate,
        dateTo: workDate,
        employeeIds: [employee.id],
      });
      expect(first.createdCount).toBe(1);
      expect(first.days[0]?.status).toBe('CALCULATED');
      expect(first.days[0]?.exceptionTypes).toEqual([]);
      const dayId = first.days[0]!.attendanceDayId!;
      const detail = await setup.days.findById(context, dayId);
      expect(detail.day.workDate).toBe(workDate);
      expect(detail.day.totals).toMatchObject({
        expectedMinutes: 480,
        workedMinutes: 480,
        coverageMinutes: 480,
        lateMinutes: 0,
        undertimeMinutes: 0,
        absenceMinutes: 0,
      });
      expect(detail.segments).toHaveLength(2);
      expect(detail.day.ruleSnapshot.fingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(detail.day.ruleSnapshot.workScheduleVersionId).toBe(setup.scheduleVersionId);
      expect(detail.day.ruleSnapshot.eventIds).toHaveLength(4);

      const second = await setup.days.calculate(context, {
        periodCode: '2026-01',
        dateFrom: workDate,
        dateTo: workDate,
        employeeIds: [employee.id],
      });
      expect(second.unchangedCount).toBe(1);
      expect(second.days[0]?.attendanceDayId).toBe(dayId);

      await admin.attendanceEvent.create({
        data: {
          agencyId: agency.id,
          employeeId: employee.id,
          eventTime: manilaInstant(workDate, '16:00'),
          eventType: 'TIME_OUT',
          source: 'MANUAL',
          enteredByMembershipId: membership.id,
          reason: 'Correction capture.',
        },
      });
      const third = await setup.days.calculate(context, {
        periodCode: '2026-01',
        dateFrom: workDate,
        dateTo: workDate,
        employeeIds: [employee.id],
      });
      expect(third.recalculatedCount).toBe(1);
      expect(third.days[0]?.status).toBe('EXCEPTION');
      expect(third.days[0]?.exceptionTypes).toContain('DUPLICATE_ATTENDANCE_EVENT');
      const successor = await setup.days.findById(context, third.days[0]!.attendanceDayId!);
      expect(successor.day.calculationVersion).toBe(2);
      expect(successor.day.status).toBe('EXCEPTION');
      expect(successor.day.openExceptionCount).toBe(1);
      expect(successor.day.totals.workedMinutes).toBe(480);
      expect(successor.exceptions[0]?.exceptionType).toBe('DUPLICATE_ATTENDANCE_EVENT');
      const previous = await admin.attendanceDay.findUniqueOrThrow({ where: { id: dayId } });
      expect(previous.isCurrent).toBe(false);
      expect(previous.calculationVersion).toBe(1);

      const audit = await admin.auditEvent.findFirst({
        where: { agencyId: agency.id, action: 'ATTENDANCE_DAY_CALCULATED' },
        orderBy: { occurredAt: 'asc' },
      });
      expect(audit?.entityId).toBe(dayId);
      expect(audit?.newStatus).toBe('CALCULATED');
    } finally {
      await cleanupAgency(admin, agency.id, suffix);
      await admin.$disconnect();
    }
  },
);

it.skipIf(!enabled)(
  'places current posted-leave inputs, blocks on unplaceable quantity, and ignores superseded inputs',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-attendance-day-leave`;
    const { agency, membership, unit, context } = await createAgency(admin, suffix);
    const coveredDate = pastWeekday(1);
    const ambiguousDate = pastWeekday(2);
    const effectiveFrom = manilaDate(-30);

    try {
      const setup = await setupSchedule(admin, {
        context,
        membershipId: membership.id,
        suffix,
        effectiveFrom,
      });
      const employee = await createEmployee(admin, {
        agencyId: agency.id,
        membershipId: membership.id,
        unitId: unit.id,
        suffix,
        withSegment: true,
      });
      await setup.assignments.create(context, {
        employeeId: employee.id,
        workScheduleVersionId: setup.scheduleVersionId,
        workArrangementVersionId: setup.arrangementVersionId,
        authorityDocumentVersionId: setup.assignmentEvidence.id,
        effectiveFrom,
      });
      const createInput = (
        input: Parameters<typeof setup.postedLeaveInputs.createInTransaction>[2],
      ) =>
        withDatabaseContext({ agencyId: agency.id, membershipId: membership.id }, (transaction) =>
          setup.postedLeaveInputs.createInTransaction(transaction, agency.id, input),
        );
      const calculate = (workDate: string) =>
        setup.days.calculate(context, {
          periodCode: `LEAVE-${workDate}`,
          dateFrom: workDate,
          dateTo: workDate,
          employeeIds: [employee.id],
        });
      const sourceId = employee.id;

      // Leave without pay never touches the ledger; its input alone covers the day.
      const first = await createInput({
        sourceKey: `${suffix}-lwop`,
        employeeId: employee.id,
        sourceType: 'LeaveApprovalAllocationLine',
        sourceId,
        dateFrom: coveredDate,
        dateTo: coveredDate,
        unitCode: 'WORKING_DAY',
        quantity: 1,
        allocationKind: 'LEAVE_WITHOUT_PAY',
      });
      const covered = await calculate(coveredDate);
      expect(covered.days[0]?.status).toBe('CALCULATED');
      const coveredDetail = await setup.days.findById(context, covered.days[0]!.attendanceDayId!);
      expect(coveredDetail.day.totals).toMatchObject({
        expectedMinutes: 480,
        postedLeaveMinutes: 480,
        absenceMinutes: 0,
      });

      // A successor supersedes the input; only it contributes coverage now.
      await createInput({
        sourceKey: `${suffix}-lwop-successor`,
        employeeId: employee.id,
        sourceType: 'LeaveApprovalAllocationLine',
        sourceId,
        dateFrom: manilaDate(1),
        dateTo: manilaDate(1),
        unitCode: 'CALENDAR_DAY',
        quantity: 1,
        allocationKind: 'NON_CREDIT',
        predecessorInputId: first.id,
      });
      const superseded = await calculate(coveredDate);
      expect(superseded.days[0]?.status).toBe('CALCULATED');
      const supersededDetail = await setup.days.findById(
        context,
        superseded.days[0]!.attendanceDayId!,
      );
      expect(supersededDetail.day.totals).toMatchObject({
        postedLeaveMinutes: 0,
        absenceMinutes: 480,
      });

      // A half-day quantity has no clock placement, so the day blocks. The
      // unplaceable input still changes the Day's sources, so it recalculates.
      const beforeLeave = await calculate(ambiguousDate);
      expect(beforeLeave.days[0]?.outcome).toBe('CREATED');
      await createInput({
        sourceKey: `${suffix}-half-day`,
        employeeId: employee.id,
        sourceType: 'LeaveApprovalAllocationLine',
        sourceId,
        dateFrom: ambiguousDate,
        dateTo: ambiguousDate,
        unitCode: 'WORKING_DAY',
        quantity: 0.5,
        allocationKind: 'LEAVE_ACCOUNT',
      });
      const ambiguous = await calculate(ambiguousDate);
      expect(ambiguous.days[0]?.outcome).toBe('RECALCULATED');
      expect(ambiguous.days[0]?.status).toBe('EXCEPTION');
      expect(ambiguous.days[0]?.exceptionTypes).toContain('AMBIGUOUS_LEAVE_QUANTITY');
    } finally {
      await cleanupAgency(admin, agency.id, suffix);
      await admin.$disconnect();
    }
  },
);

it.skipIf(!enabled)(
  'supersedes posted leave for Leave, recalculates unlocked Work Dates, and refuses locked ones',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-attendance-day-supersede`;
    const { agency, membership, unit, context } = await createAgency(admin, suffix);
    const shift = (value: string, days: number) =>
      new Date(new Date(`${value}T00:00:00.000Z`).getTime() + days * 86_400_000)
        .toISOString()
        .slice(0, 10);
    const monday = shift(pastWeekday(1), -7);
    const tuesday = shift(monday, 1);
    const thursday = shift(monday, 3);
    const effectiveFrom = manilaDate(-30);

    try {
      const setup = await setupSchedule(admin, {
        context,
        membershipId: membership.id,
        suffix,
        effectiveFrom,
      });
      const employee = await createEmployee(admin, {
        agencyId: agency.id,
        membershipId: membership.id,
        unitId: unit.id,
        suffix,
        withSegment: true,
      });
      await setup.assignments.create(context, {
        employeeId: employee.id,
        workScheduleVersionId: setup.scheduleVersionId,
        workArrangementVersionId: setup.arrangementVersionId,
        authorityDocumentVersionId: setup.assignmentEvidence.id,
        effectiveFrom,
      });
      const inAgency = <T>(
        run: (transaction: Parameters<Parameters<typeof withDatabaseContext>[1]>[0]) => Promise<T>,
      ) => withDatabaseContext({ agencyId: agency.id, membershipId: membership.id }, run);
      const base = {
        employeeId: employee.id,
        sourceType: 'LeaveCancellation',
        sourceId: employee.id,
        unitCode: 'WORKING_DAY' as const,
        allocationKind: 'LEAVE_ACCOUNT' as const,
      };
      const original = await inAgency((transaction) =>
        setup.postedLeaveInputs.createInTransaction(transaction, agency.id, {
          ...base,
          sourceKey: `${suffix}-original`,
          dateFrom: monday,
          dateTo: tuesday,
          quantity: 2,
        }),
      );
      await setup.days.calculate(context, {
        periodCode: `SUPERSEDE-${suffix}`,
        dateFrom: monday,
        dateTo: tuesday,
        employeeIds: [employee.id],
      });
      const totals = async (workDate: string) => {
        const [day] = await setup.days.list(context, {
          employeeId: employee.id,
          workDateFrom: workDate,
          workDateTo: workDate,
        });
        return (await setup.days.findById(context, day!.id)).day.totals;
      };
      expect(await totals(tuesday)).toMatchObject({ postedLeaveMinutes: 480, absenceMinutes: 0 });

      // A retained successor keeps Monday and returns Tuesday to absence.
      const retained = {
        ...base,
        sourceKey: `${suffix}-retained`,
        dateFrom: monday,
        dateTo: monday,
        quantity: 1,
        predecessorInputId: original.id,
      };
      const partial = await inAgency((transaction) =>
        setup.days.supersedePostedLeaveInTransaction(transaction, context, retained),
      );
      expect(partial.recalculatedWorkDates).toEqual([monday, tuesday]);
      expect(await totals(monday)).toMatchObject({ postedLeaveMinutes: 480 });
      expect(await totals(tuesday)).toMatchObject({ postedLeaveMinutes: 0, absenceMinutes: 480 });
      // A retry returns the same successor and changes no Attendance Day.
      const replay = await inAgency((transaction) =>
        setup.days.supersedePostedLeaveInTransaction(transaction, context, retained),
      );
      expect(replay.id).toBe(partial.id);

      // A zero-quantity successor withdraws the remaining coverage.
      await inAgency((transaction) =>
        setup.days.supersedePostedLeaveInTransaction(transaction, context, {
          ...base,
          sourceKey: `${suffix}-withdrawn`,
          dateFrom: monday,
          dateTo: monday,
          quantity: 0,
          predecessorInputId: partial.id,
        }),
      );
      expect(await totals(monday)).toMatchObject({ postedLeaveMinutes: 0, absenceMinutes: 480 });
      await expect(
        inAgency((transaction) =>
          setup.postedLeaveInputs.createInTransaction(transaction, agency.id, {
            ...base,
            sourceKey: `${suffix}-zero-original`,
            dateFrom: monday,
            dateTo: monday,
            quantity: 0,
          }),
        ),
      ).rejects.toMatchObject({ code: 'POSTED_LEAVE_INPUT_INVALID' });

      // A Work Date in a finalized period is refused and nothing is superseded.
      const locked = await inAgency((transaction) =>
        setup.postedLeaveInputs.createInTransaction(transaction, agency.id, {
          ...base,
          sourceKey: `${suffix}-locked`,
          dateFrom: thursday,
          dateTo: thursday,
          quantity: 1,
        }),
      );
      await admin.attendancePeriod.create({
        data: {
          agencyId: agency.id,
          code: `LOCKED-${suffix}`,
          dateFrom: new Date(`${thursday}T00:00:00.000Z`),
          dateTo: new Date(`${thursday}T00:00:00.000Z`),
          status: 'FINALIZED',
        },
      });
      await expect(
        inAgency((transaction) =>
          setup.days.supersedePostedLeaveInTransaction(transaction, context, {
            ...base,
            sourceKey: `${suffix}-locked-withdrawn`,
            dateFrom: thursday,
            dateTo: thursday,
            quantity: 0,
            predecessorInputId: locked.id,
          }),
        ),
      ).rejects.toMatchObject({ code: 'ATTENDANCE_PERIOD_LOCKED' });
      expect(
        await admin.attendancePostedLeaveInput.count({
          where: { agencyId: agency.id, predecessorInputId: locked.id },
        }),
      ).toBe(0);
    } finally {
      await cleanupAgency(admin, agency.id, suffix);
      await admin.$disconnect();
    }
  },
);

it.skipIf(!enabled)(
  'records an Attendance Exception for an unresolvable Work Date and scopes reads',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-attendance-day-exception`;
    const { agency, membership, unit, context } = await createAgency(admin, suffix);
    const workDate = pastWeekday(2);
    const effectiveFrom = manilaDate(-30);

    try {
      const setup = await setupSchedule(admin, {
        context,
        membershipId: membership.id,
        suffix,
        effectiveFrom,
      });
      const employee = await createEmployee(admin, {
        agencyId: agency.id,
        membershipId: membership.id,
        unitId: unit.id,
        suffix,
        withSegment: true,
      });
      await withDatabaseContext(
        {
          agencyId: agency.id,
          membershipId: membership.id,
          capabilities: ['employee-membership-link'],
        },
        (transaction) =>
          transaction.agencyMembership.update({
            where: { agencyId_id: { agencyId: agency.id, id: membership.id } },
            data: { employeeId: employee.id },
          }),
      );
      const other = await createEmployee(admin, {
        agencyId: agency.id,
        membershipId: membership.id,
        unitId: unit.id,
        suffix: `${suffix}-other`,
        withSegment: true,
      });

      const result = await setup.days.calculate(context, {
        periodCode: '2026-01',
        dateFrom: workDate,
        dateTo: workDate,
        employeeIds: [employee.id, other.id],
      });
      expect(result.createdCount).toBe(2);
      expect(result.days.map((day) => day.status)).toEqual(['EXCEPTION', 'EXCEPTION']);
      expect(result.days[0]?.exceptionTypes).toEqual(['MISSING_SCHEDULE_ASSIGNMENT']);

      const detail = await setup.days.findById(context, result.days[0]!.attendanceDayId!);
      expect(detail.day.scheduleAssignmentId).toBeNull();
      expect(detail.day.ruleSnapshot.resolutionException?.type).toBe('MISSING_SCHEDULE_ASSIGNMENT');
      expect(detail.segments).toEqual([]);
      expect(detail.exceptions[0]?.exceptionType).toBe('MISSING_SCHEDULE_ASSIGNMENT');
      expect(detail.exceptions[0]?.status).toBe('OPEN');

      const agencyList = await setup.days.list(context, { status: 'EXCEPTION' });
      expect(agencyList).toHaveLength(2);

      const ownContext: RequestContext = { ...context, permissions: ownPermissions };
      const ownList = await setup.days.list(ownContext, {});
      expect(ownList).toHaveLength(1);
      expect(ownList[0]?.employee.id).toBe(employee.id);
      const ownFiltered = await setup.days.list(ownContext, { employeeId: employee.id });
      expect(ownFiltered).toHaveLength(1);
      const ownExcluded = await setup.days.list(ownContext, { employeeId: other.id });
      expect(ownExcluded).toEqual([]);
    } finally {
      await cleanupAgency(admin, agency.id, suffix);
      await admin.$disconnect();
    }
  },
);

it.skipIf(!enabled)(
  'counts whole-day Attendance Context and rest-day service without deficits',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-attendance-day-context`;
    const { agency, membership, unit, context } = await createAgency(admin, suffix);
    const workDate = pastWeekday(3);
    const restDate = pastWeekend();
    const effectiveFrom = manilaDate(-30);

    try {
      const setup = await setupSchedule(admin, {
        context,
        membershipId: membership.id,
        suffix,
        effectiveFrom,
      });
      const employee = await createEmployee(admin, {
        agencyId: agency.id,
        membershipId: membership.id,
        unitId: unit.id,
        suffix,
        withSegment: true,
      });
      await withDatabaseContext(
        {
          agencyId: agency.id,
          membershipId: membership.id,
          capabilities: ['employee-membership-link'],
        },
        (transaction) =>
          transaction.agencyMembership.update({
            where: { agencyId_id: { agencyId: agency.id, id: membership.id } },
            data: { employeeId: employee.id },
          }),
      );
      await setup.assignments.create(context, {
        employeeId: employee.id,
        workScheduleVersionId: setup.scheduleVersionId,
        workArrangementVersionId: setup.arrangementVersionId,
        authorityDocumentVersionId: setup.assignmentEvidence.id,
        effectiveFrom,
      });
      const evidence = await createEvidence(
        admin,
        agency.id,
        membership.id,
        `${suffix}-context`,
        'ATTENDANCE_CONTEXT_AUTHORITY',
      );
      await setup.contexts.record(context, {
        employeeId: employee.id,
        contextType: 'OFFICIAL_BUSINESS',
        coverageMode: 'WHOLE_WORK_DATE',
        workDate,
        reason: 'Authorized field work.',
        evidenceDocumentVersionId: evidence.id,
      });
      await admin.attendanceEvent.create({
        data: {
          agencyId: agency.id,
          employeeId: employee.id,
          eventTime: manilaInstant(restDate, '10:00'),
          eventType: 'TIME_IN',
          source: 'MANUAL',
          enteredByMembershipId: membership.id,
          reason: 'Weekend duty.',
        },
      });
      await admin.attendanceEvent.create({
        data: {
          agencyId: agency.id,
          employeeId: employee.id,
          eventTime: manilaInstant(restDate, '12:00'),
          eventType: 'TIME_OUT',
          source: 'MANUAL',
          enteredByMembershipId: membership.id,
          reason: 'Weekend duty.',
        },
      });

      const result = await setup.days.calculate(context, {
        periodCode: '2026-01',
        dateFrom: restDate < workDate ? restDate : workDate,
        dateTo: workDate < restDate ? restDate : workDate,
        employeeIds: [employee.id],
      });
      expect(result.days.every((day) => day.status === 'CALCULATED')).toBe(true);

      const contextDayId = result.days.find((day) => day.workDate === workDate)!.attendanceDayId!;
      const restDayId = result.days.find((day) => day.workDate === restDate)!.attendanceDayId!;
      const contextDay = await setup.days.findById(context, contextDayId);
      expect(contextDay.day.totals).toMatchObject({
        expectedMinutes: 480,
        coverageMinutes: 480,
        officialBusinessMinutes: 480,
        absenceMinutes: 0,
        lateMinutes: 0,
        undertimeMinutes: 0,
        postedLeaveMinutes: 0,
      });

      const restDay = await setup.days.findById(context, restDayId);
      expect(restDay.day.dayClassification).toBe('UNSCHEDULED_SERVICE');
      expect(restDay.day.totals).toMatchObject({
        expectedMinutes: 0,
        workedMinutes: 120,
        outsideScheduleMinutes: 120,
        absenceMinutes: 0,
        undertimeMinutes: 0,
      });
    } finally {
      await cleanupAgency(admin, agency.id, suffix);
      await admin.$disconnect();
    }
  },
);

it.skipIf(!enabled)('rolls back the whole batch when one Employee cannot be resolved', async () => {
  const admin = await createAdminClient();
  const suffix = `${Date.now()}-attendance-day-rollback`;
  const { agency, membership, unit, context } = await createAgency(admin, suffix);
  const workDate = pastWeekday(4);
  const effectiveFrom = manilaDate(-30);

  try {
    const setup = await setupSchedule(admin, {
      context,
      membershipId: membership.id,
      suffix,
      effectiveFrom,
    });
    const employee = await createEmployee(admin, {
      agencyId: agency.id,
      membershipId: membership.id,
      unitId: unit.id,
      suffix,
      withSegment: true,
    });
    await withDatabaseContext(
      {
        agencyId: agency.id,
        membershipId: membership.id,
        capabilities: ['employee-membership-link'],
      },
      (transaction) =>
        transaction.agencyMembership.update({
          where: { agencyId_id: { agencyId: agency.id, id: membership.id } },
          data: { employeeId: employee.id },
        }),
    );
    await setup.assignments.create(context, {
      employeeId: employee.id,
      workScheduleVersionId: setup.scheduleVersionId,
      workArrangementVersionId: setup.arrangementVersionId,
      authorityDocumentVersionId: setup.assignmentEvidence.id,
      effectiveFrom,
    });

    await expect(
      setup.days.calculate(context, {
        periodCode: '2026-01',
        dateFrom: workDate,
        dateTo: workDate,
        employeeIds: [employee.id, '00000000-0000-4000-8000-000000000000'],
      }),
    ).rejects.toThrow('The Employee could not be found in this Agency.');

    expect(await admin.attendancePeriod.count({ where: { agencyId: agency.id } })).toBe(0);
    expect(await admin.attendanceDay.count({ where: { agencyId: agency.id } })).toBe(0);
    expect(
      await admin.auditEvent.count({
        where: { agencyId: agency.id, action: 'ATTENDANCE_DAY_CALCULATED' },
      }),
    ).toBe(0);
  } finally {
    await cleanupAgency(admin, agency.id, suffix);
    await admin.$disconnect();
  }
});
