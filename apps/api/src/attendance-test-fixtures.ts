import { PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import {
  approvalAuditWriter,
  ApprovalCompletionRegistry,
  ApprovalsService,
} from './approvals/approval.service';
import { attendanceConfigurationAuditWriter } from './attendance-configuration/attendance-configuration.audit';
import { HolidayCalendarsService } from './attendance-configuration/holiday-calendars.service';
import { ScheduleAssignmentsService } from './attendance-configuration/schedule-assignments.service';
import { WorkArrangementsService } from './attendance-configuration/work-arrangements.service';
import { WorkSchedulesService } from './attendance-configuration/work-schedules.service';
import { attendanceContextAuditWriter } from './attendance-contexts/attendance-contexts.audit';
import { AttendanceContextsService } from './attendance-contexts/attendance-contexts.service';
import { attendanceAuditWriter } from './attendance/attendance.audit';
import { AttendanceService } from './attendance/attendance.service';
import { attendanceDayAuditWriter } from './attendance-days/attendance-days.audit';
import { AttendanceDaysService } from './attendance-days/attendance-days.service';
import { attendancePeriodAuditWriter } from './attendance-periods/attendance-periods.audit';
import { AttendancePeriodsService } from './attendance-periods/attendance-periods.service';
import { attendanceSubmissionAuditWriter } from './attendance-submissions/attendance-submissions.audit';
import { AttendanceSubmissionsService } from './attendance-submissions/attendance-submissions.service';
import { documentAuditWriter, DocumentsService } from './documents/documents.service';
import { dtrAuditWriter } from './dtrs/dtrs.audit';
import { DtrsService } from './dtrs/dtrs.service';
import { AttendancePostedLeaveInputsService } from './attendance-posted-leave-inputs/attendance-posted-leave-inputs.service';

export function manilaDate(offsetDays = 0): string {
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

export function pastWeekday(target: number): string {
  for (let offset = -1; offset >= -30; offset -= 1) {
    const date = manilaDate(offset);
    if (new Date(`${date}T00:00:00.000Z`).getUTCDay() === target) return date;
  }
  throw new Error(`No weekday ${target} found in the last 30 days.`);
}

export function manilaInstant(dateValue: string, timeValue: string): Date {
  return new Date(`${dateValue}T${timeValue}:00+08:00`);
}

export async function createAdminClient(): Promise<PrismaClient> {
  const databaseUrl =
    process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
  if (!databaseUrl) throw new Error('A database owner URL is required for the integration test.');
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

export const attendanceAdministratorPermissions: RequestContext['permissions'] = [
  { code: 'attendance.configuration.read', scopePolicy: 'AGENCY' },
  { code: 'attendance.configuration.manage', scopePolicy: 'AGENCY' },
  { code: 'attendance.configuration.activate', scopePolicy: 'AGENCY' },
  { code: 'attendance.assignments.manage', scopePolicy: 'AGENCY' },
  { code: 'attendance.days.calculate', scopePolicy: 'AGENCY' },
  { code: 'attendance.days.read', scopePolicy: 'AGENCY' },
  { code: 'attendance.contexts.read', scopePolicy: 'AGENCY' },
  { code: 'attendance.submissions.create', scopePolicy: 'OWN' },
  { code: 'attendance.submissions.create_on_behalf', scopePolicy: 'AGENCY' },
  { code: 'attendance.submissions.submit', scopePolicy: 'AGENCY' },
  { code: 'attendance.submissions.return', scopePolicy: 'AGENCY' },
  { code: 'attendance.submissions.approve', scopePolicy: 'AGENCY' },
  { code: 'attendance.submissions.cancel', scopePolicy: 'AGENCY' },
  { code: 'attendance.reports.read', scopePolicy: 'AGENCY' },
  { code: 'attendance.dtr.generate', scopePolicy: 'AGENCY' },
  { code: 'attendance.periods.submit', scopePolicy: 'AGENCY' },
  { code: 'attendance.periods.return', scopePolicy: 'AGENCY' },
  { code: 'attendance.periods.approve', scopePolicy: 'AGENCY' },
  { code: 'attendance.periods.lock', scopePolicy: 'AGENCY' },
  { code: 'attendance.payroll_publications.read', scopePolicy: 'AGENCY' },
  { code: 'documents.evidence.read', scopePolicy: 'AGENCY' },
  { code: 'approvals.routes.create', scopePolicy: 'AGENCY' },
  { code: 'approvals.routes.activate', scopePolicy: 'AGENCY' },
  { code: 'approvals.routes.read', scopePolicy: 'AGENCY' },
];

export const attendanceOfficerPermissions: RequestContext['permissions'] = [
  { code: 'attendance.days.read', scopePolicy: 'ASSIGNED_OFFICE' },
  { code: 'attendance.submissions.create', scopePolicy: 'OWN' },
  { code: 'attendance.submissions.submit', scopePolicy: 'OWN' },
  { code: 'attendance.submissions.return', scopePolicy: 'ASSIGNED_OFFICE' },
  { code: 'attendance.submissions.approve', scopePolicy: 'ASSIGNED_OFFICE' },
  { code: 'attendance.submissions.cancel', scopePolicy: 'OWN' },
  { code: 'attendance.reports.read', scopePolicy: 'ASSIGNED_OFFICE' },
  { code: 'attendance.periods.return', scopePolicy: 'ASSIGNED_OFFICE' },
  { code: 'attendance.periods.approve', scopePolicy: 'ASSIGNED_OFFICE' },
  { code: 'attendance.payroll_publications.read', scopePolicy: 'ASSIGNED_OFFICE' },
  { code: 'approvals.routes.read', scopePolicy: 'OWN' },
];

export const attendanceEmployeePermissions: RequestContext['permissions'] = [
  { code: 'attendance.days.read', scopePolicy: 'OWN' },
  { code: 'attendance.submissions.create', scopePolicy: 'OWN' },
  { code: 'attendance.submissions.submit', scopePolicy: 'OWN' },
  { code: 'attendance.submissions.cancel', scopePolicy: 'OWN' },
  { code: 'attendance.reports.read', scopePolicy: 'OWN' },
];

function dayRules(collectionAfterMinutes = 0) {
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
          collectionAfterMinutes,
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
      storageKey: `attendance-workflow/${suffix}`,
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

async function createUser(
  admin: PrismaClient,
  suffix: string,
  label: string,
): Promise<{ id: string }> {
  return admin.user.create({
    data: {
      emailNormalized: `attendance-workflow-${label}-${suffix}@example.test`,
      displayName: `Attendance Workflow ${label}`,
      globalStatus: 'ACTIVE',
    },
    select: { id: true },
  });
}

export function attendanceWorkflowServices() {
  const documents = new DocumentsService({} as never, documentAuditWriter);
  const schedules = new WorkSchedulesService(attendanceConfigurationAuditWriter, documents);
  const arrangements = new WorkArrangementsService(attendanceConfigurationAuditWriter, documents);
  const calendars = new HolidayCalendarsService(attendanceConfigurationAuditWriter, documents);
  const assignments = new ScheduleAssignmentsService(
    attendanceConfigurationAuditWriter,
    documents,
    schedules,
    arrangements,
    calendars,
  );
  const attendance = new AttendanceService(attendanceAuditWriter, assignments);
  const contexts = new AttendanceContextsService(attendanceContextAuditWriter, documents);
  const postedLeaveInputs = new AttendancePostedLeaveInputsService();
  const days = new AttendanceDaysService(
    attendanceDayAuditWriter,
    assignments,
    attendance,
    contexts,
    postedLeaveInputs,
  );
  const submissions = new AttendanceSubmissionsService(
    attendanceSubmissionAuditWriter,
    documents,
    days,
  );
  const dtrs = new DtrsService(dtrAuditWriter, documents);
  const approvals = new ApprovalsService(approvalAuditWriter, new ApprovalCompletionRegistry());
  const periods = new AttendancePeriodsService(attendancePeriodAuditWriter, approvals, dtrs, days);
  return {
    documents,
    schedules,
    arrangements,
    calendars,
    assignments,
    attendance,
    contexts,
    postedLeaveInputs,
    days,
    submissions,
    dtrs,
    periods,
    approvals,
  };
}

export interface AttendanceWorkflowFixture {
  admin: PrismaClient;
  suffix: string;
  agencyId: string;
  unitId: string;
  employeeId: string;
  workDate: string;
  periodId: string;
  attendanceDayId: string;
  eventIds: Record<'TIME_IN' | 'BREAK_OUT' | 'BREAK_IN' | 'TIME_OUT', string>;
  administratorContext: RequestContext;
  officerContext: RequestContext;
  employeeContext: RequestContext;
  memberships: {
    administrator: string;
    officer: string;
    employee: string;
  };
  services: ReturnType<typeof attendanceWorkflowServices>;
  evidenceDocumentVersionId: string;
}

export async function createAttendanceWorkflowFixture(
  options: {
    periodDates?: string[];
    events?: boolean | 'partial';
    eventTimes?: ReadonlyArray<
      readonly ['TIME_IN' | 'BREAK_OUT' | 'BREAK_IN' | 'TIME_OUT', string]
    >;
    collectionAfterMinutes?: number;
    assignment?: boolean;
  } = {},
): Promise<AttendanceWorkflowFixture> {
  const admin = await createAdminClient();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-workflow`;
  const workDate = pastWeekday(3);
  const effectiveFrom = manilaDate(-30);
  const agency = await admin.agency.create({
    data: {
      code: `AWF-${suffix}`,
      name: 'Attendance Workflow Integration Agency',
      agencyType: 'NGA',
      status: 'ACTIVE',
    },
  });
  const administratorUser = await createUser(admin, suffix, 'administrator');
  const administratorMembership = await admin.agencyMembership.create({
    data: { agencyId: agency.id, userId: administratorUser.id, status: 'ACTIVE' },
  });
  const officerUser = await createUser(admin, suffix, 'officer');
  const officerMembership = await admin.agencyMembership.create({
    data: { agencyId: agency.id, userId: officerUser.id, status: 'ACTIVE' },
  });
  const employeeUser = await createUser(admin, suffix, 'employee');
  const employeeMembership = await admin.agencyMembership.create({
    data: { agencyId: agency.id, userId: employeeUser.id, status: 'ACTIVE' },
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
  const employee = await admin.employee.create({
    data: {
      agencyId: agency.id,
      employeeNumber: `AWF-${suffix}`,
      legalName: `Attendance Workflow ${suffix}`,
      birthDate: new Date('1990-01-01'),
      sex: 'FEMALE',
      civilStatus: 'SINGLE',
      contactEmail: `attendance-workflow-${suffix}@example.test`,
      serviceStatus: 'ACTIVE',
      createdByMembershipId: administratorMembership.id,
      updatedByMembershipId: administratorMembership.id,
    },
  });
  await withDatabaseContext(
    {
      agencyId: agency.id,
      membershipId: administratorMembership.id,
      capabilities: ['personnel-baseline-transition'],
    },
    (transaction) =>
      transaction.serviceSegment.create({
        data: {
          agencyId: agency.id,
          employeeId: employee.id,
          organizationUnitId: unit.id,
          appointmentStatus: 'PERMANENT',
          salaryGrade: 18,
          salaryStep: 2,
          effectiveFrom: new Date('2020-01-01'),
          status: 'ACTIVE',
          createdByMembershipId: administratorMembership.id,
        },
      }),
  );
  await withDatabaseContext(
    {
      agencyId: agency.id,
      membershipId: employeeMembership.id,
      capabilities: ['employee-membership-link'],
    },
    (transaction) =>
      transaction.agencyMembership.update({
        where: { agencyId_id: { agencyId: agency.id, id: employeeMembership.id } },
        data: { employeeId: employee.id },
      }),
  );
  const administratorContext: RequestContext = {
    requestId: `attendance-workflow-${suffix}-administrator`,
    userId: administratorUser.id,
    agencyId: agency.id,
    membershipId: administratorMembership.id,
    primaryOrganizationUnitId: unit.id,
    permissions: attendanceAdministratorPermissions,
  };
  const officerContext: RequestContext = {
    requestId: `attendance-workflow-${suffix}-officer`,
    userId: officerUser.id,
    agencyId: agency.id,
    membershipId: officerMembership.id,
    primaryOrganizationUnitId: unit.id,
    permissions: attendanceOfficerPermissions,
  };
  const employeeContext: RequestContext = {
    requestId: `attendance-workflow-${suffix}-employee`,
    userId: employeeUser.id,
    agencyId: agency.id,
    membershipId: employeeMembership.id,
    primaryOrganizationUnitId: null,
    permissions: attendanceEmployeePermissions,
  };
  const services = attendanceWorkflowServices();
  const scheduleEvidence = await createEvidence(
    admin,
    agency.id,
    administratorMembership.id,
    `${suffix}-schedule`,
    'WORK_SCHEDULE_AUTHORITY',
  );
  const arrangementEvidence = await createEvidence(
    admin,
    agency.id,
    administratorMembership.id,
    `${suffix}-arrangement`,
    'WORK_ARRANGEMENT_AUTHORITY',
  );
  const assignmentEvidence = await createEvidence(
    admin,
    agency.id,
    administratorMembership.id,
    `${suffix}-assignment`,
    'SCHEDULE_ASSIGNMENT_AUTHORITY',
  );
  const calendar = await services.calendars.create(administratorContext, {
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
  await services.calendars.activate(administratorContext, calendar.id, calendar.draft!.id, {
    authorityDocumentVersionId: scheduleEvidence.id,
    approvingAuthority: 'Office of the President',
    reason: 'Proclamation reviewed.',
  });
  const schedule = await services.schedules.create(administratorContext, {
    code: 'ORDINARY',
    name: 'Ordinary Work Schedule',
    scheduleType: 'REGULAR',
    effectiveDate: effectiveFrom,
    dayRules: dayRules(options.collectionAfterMinutes ?? 0),
  });
  const scheduleActive = await services.schedules.activate(
    administratorContext,
    schedule.id,
    schedule.draft!.id,
    {
      authorityDocumentVersionId: scheduleEvidence.id,
      approvingAuthority: 'Office of the President',
      reason: 'Schedule authority reviewed.',
    },
  );
  const arrangement = await services.arrangements.create(administratorContext, {
    code: 'ONSITE',
    name: 'Onsite Work Arrangement',
    arrangementType: 'ONSITE',
    permittedScheduleTypes: ['REGULAR'],
    holidayCalendarId: calendar.id,
    effectiveDate: effectiveFrom,
  });
  const arrangementActive = await services.arrangements.activate(
    administratorContext,
    arrangement.id,
    arrangement.draft!.id,
    {
      authorityDocumentVersionId: arrangementEvidence.id,
      approvingAuthority: 'Office of the President',
      reason: 'Arrangement authority reviewed.',
    },
  );
  if (options.assignment !== false) {
    await services.assignments.create(administratorContext, {
      employeeId: employee.id,
      workScheduleVersionId: scheduleActive.currentVersion!.id,
      workArrangementVersionId: arrangementActive.currentVersion!.id,
      authorityDocumentVersionId: assignmentEvidence.id,
      effectiveFrom,
    });
  }
  const eventIds = {} as Record<'TIME_IN' | 'BREAK_OUT' | 'BREAK_IN' | 'TIME_OUT', string>;
  if (options.events !== false) {
    const eventTimes =
      options.eventTimes ??
      (options.events === 'partial'
        ? ([['TIME_IN', '08:00']] as const)
        : ([
            ['TIME_IN', '08:00'],
            ['BREAK_OUT', '12:00'],
            ['BREAK_IN', '13:00'],
            ['TIME_OUT', '16:00'],
          ] as const));
    for (const [eventType, timeValue] of eventTimes) {
      const event = await admin.attendanceEvent.create({
        data: {
          agencyId: agency.id,
          employeeId: employee.id,
          eventTime: manilaInstant(workDate, timeValue),
          eventType,
          source: 'MANUAL',
          enteredByMembershipId: administratorMembership.id,
          reason: 'Attendance workflow integration fixture.',
        },
      });
      eventIds[eventType] = event.id;
    }
  }
  const periodDates = options.periodDates ?? [workDate];
  const calculated = await services.days.calculate(administratorContext, {
    periodCode: `AWF-${workDate.slice(0, 7)}-${suffix.slice(0, 4)}`,
    dateFrom: periodDates[0]!,
    dateTo: periodDates[periodDates.length - 1]!,
    employeeIds: [employee.id],
  });
  const evidenceVersion = await createEvidence(
    admin,
    agency.id,
    administratorMembership.id,
    `${suffix}-on-behalf`,
    'ATTENDANCE_SUBMISSION_EVIDENCE',
  );
  return {
    admin,
    suffix,
    agencyId: agency.id,
    unitId: unit.id,
    employeeId: employee.id,
    workDate,
    periodId: calculated.period.id,
    attendanceDayId: calculated.days[0]!.attendanceDayId!,
    eventIds,
    administratorContext,
    officerContext,
    employeeContext,
    memberships: {
      administrator: administratorMembership.id,
      officer: officerMembership.id,
      employee: employeeMembership.id,
    },
    services,
    evidenceDocumentVersionId: evidenceVersion.id,
  };
}

export async function cleanupAttendanceWorkflowAgency(
  admin: PrismaClient,
  agencyId: string,
  suffix: string,
): Promise<void> {
  await admin.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    await transaction.dtrDocument.deleteMany({ where: { agencyId } });
    await transaction.attendancePayrollFact.deleteMany({ where: { agencyId } });
    await transaction.attendancePayrollPublication.deleteMany({ where: { agencyId } });
    await transaction.attendancePeriodVersionDay.deleteMany({ where: { agencyId } });
    await transaction.attendancePeriodVersion.deleteMany({ where: { agencyId } });
    await transaction.employeeAttendanceSubmissionDay.deleteMany({ where: { agencyId } });
    await transaction.employeeAttendanceSubmission.deleteMany({ where: { agencyId } });
    await transaction.attendanceException.deleteMany({ where: { agencyId } });
    await transaction.attendanceDaySegment.deleteMany({ where: { agencyId } });
    await transaction.attendanceDay.deleteMany({ where: { agencyId } });
    await transaction.attendancePeriod.deleteMany({ where: { agencyId } });
    await transaction.attendanceEvent.deleteMany({ where: { agencyId } });
    await transaction.attendanceContext.deleteMany({ where: { agencyId } });
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
    await transaction.membershipRole.deleteMany({ where: { agencyId } });
    await transaction.employee.deleteMany({ where: { agencyId } });
    await transaction.agencyMembership.deleteMany({ where: { agencyId } });
    await transaction.agency.delete({ where: { id: agencyId } });
    await transaction.user.deleteMany({ where: { emailNormalized: { contains: suffix } } });
  });
}
