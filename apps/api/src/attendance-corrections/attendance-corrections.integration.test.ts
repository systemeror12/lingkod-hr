import { PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { expect, it } from 'vitest';
import {
  approvalAuditWriter,
  ApprovalCompletionRegistry,
  ApprovalsService,
} from '../approvals/approval.service';
import { finalizeAttendancePeriod } from '../attendance-test-fixtures';
import { attendanceConfigurationAuditWriter } from '../attendance-configuration/attendance-configuration.audit';
import { HolidayCalendarsService } from '../attendance-configuration/holiday-calendars.service';
import { ScheduleAssignmentsService } from '../attendance-configuration/schedule-assignments.service';
import { WorkArrangementsService } from '../attendance-configuration/work-arrangements.service';
import { WorkSchedulesService } from '../attendance-configuration/work-schedules.service';
import { attendanceContextAuditWriter } from '../attendance-contexts/attendance-contexts.audit';
import { AttendanceContextsService } from '../attendance-contexts/attendance-contexts.service';
import { attendanceAuditWriter } from '../attendance/attendance.audit';
import { AttendanceService } from '../attendance/attendance.service';
import { attendanceDayAuditWriter } from '../attendance-days/attendance-days.audit';
import { AttendanceDaysService } from '../attendance-days/attendance-days.service';
import { attendancePeriodAuditWriter } from '../attendance-periods/attendance-periods.audit';
import { AttendancePeriodsService } from '../attendance-periods/attendance-periods.service';
import { documentAuditWriter, DocumentsService } from '../documents/documents.service';
import { dtrAuditWriter } from '../dtrs/dtrs.audit';
import { DtrsService } from '../dtrs/dtrs.service';
import { AttendancePostedLeaveInputsService } from '../attendance-posted-leave-inputs/attendance-posted-leave-inputs.service';
import { attendanceCorrectionAuditWriter } from './attendance-corrections.audit';
import { AttendanceCorrectionsService } from './attendance-corrections.service';
import {
  ATTENDANCE_CORRECTION_LOCKED_ROUTE_CODE,
  ATTENDANCE_CORRECTION_ROUTE_CODE,
} from './attendance-corrections.types';

const enabled = process.env.DATABASE_E2E === 'true';

const agencyAdminPermissions: RequestContext['permissions'] = [
  { code: 'attendance.configuration.read', scopePolicy: 'AGENCY' },
  { code: 'attendance.configuration.manage', scopePolicy: 'AGENCY' },
  { code: 'attendance.configuration.activate', scopePolicy: 'AGENCY' },
  { code: 'attendance.assignments.manage', scopePolicy: 'AGENCY' },
  { code: 'attendance.contexts.read', scopePolicy: 'AGENCY' },
  { code: 'attendance.contexts.create', scopePolicy: 'AGENCY' },
  { code: 'attendance.days.calculate', scopePolicy: 'AGENCY' },
  { code: 'attendance.days.read', scopePolicy: 'AGENCY' },
  { code: 'attendance.reports.read', scopePolicy: 'AGENCY' },
  { code: 'attendance.dtr.generate', scopePolicy: 'AGENCY' },
  { code: 'attendance.corrections.create', scopePolicy: 'AGENCY' },
  { code: 'attendance.corrections.submit', scopePolicy: 'AGENCY' },
  { code: 'attendance.corrections.return', scopePolicy: 'AGENCY' },
  { code: 'attendance.corrections.approve', scopePolicy: 'AGENCY' },
  { code: 'attendance.corrections.reject', scopePolicy: 'AGENCY' },
  { code: 'attendance.corrections.authorize_locked', scopePolicy: 'AGENCY' },
  { code: 'attendance.corrections.cancel', scopePolicy: 'AGENCY' },
  { code: 'attendance.periods.submit', scopePolicy: 'AGENCY' },
  { code: 'attendance.periods.return', scopePolicy: 'AGENCY' },
  { code: 'attendance.periods.approve', scopePolicy: 'AGENCY' },
  { code: 'attendance.periods.lock', scopePolicy: 'AGENCY' },
  { code: 'attendance.payroll_publications.read', scopePolicy: 'AGENCY' },
  { code: 'approvals.routes.read', scopePolicy: 'AGENCY' },
  { code: 'approvals.routes.create', scopePolicy: 'AGENCY' },
  { code: 'approvals.routes.activate', scopePolicy: 'AGENCY' },
  { code: 'approvals.requests.read', scopePolicy: 'AGENCY' },
  { code: 'approvals.requests.create', scopePolicy: 'AGENCY' },
  { code: 'approvals.requests.approve', scopePolicy: 'AGENCY' },
  { code: 'approvals.requests.return', scopePolicy: 'AGENCY' },
  { code: 'approvals.requests.reject', scopePolicy: 'AGENCY' },
  { code: 'approvals.requests.cancel', scopePolicy: 'AGENCY' },
  { code: 'documents.evidence.read', scopePolicy: 'AGENCY' },
];

const employeePermissions: RequestContext['permissions'] = [
  { code: 'attendance.days.read', scopePolicy: 'OWN' },
  { code: 'attendance.corrections.create', scopePolicy: 'OWN' },
  { code: 'attendance.corrections.submit', scopePolicy: 'OWN' },
  { code: 'attendance.corrections.cancel', scopePolicy: 'OWN' },
  { code: 'approvals.routes.read', scopePolicy: 'OWN' },
  { code: 'approvals.requests.create', scopePolicy: 'OWN' },
  { code: 'approvals.requests.cancel', scopePolicy: 'OWN' },
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
      storageKey: `attendance-corrections/${suffix}`,
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
      emailNormalized: `attendance-correction-${label}-${suffix}@example.test`,
      displayName: `Attendance Correction ${label}`,
      globalStatus: 'ACTIVE',
    },
    select: { id: true },
  });
}

async function createAgency(admin: PrismaClient, suffix: string) {
  const agency = await admin.agency.create({
    data: {
      code: `ACOR-${suffix}`,
      name: 'Attendance Correction Integration Agency',
      agencyType: 'NGA',
      status: 'ACTIVE',
    },
  });
  const user = await createUser(admin, suffix, 'author');
  const membership = await admin.agencyMembership.create({
    data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
  });
  const employeeUser = await createUser(admin, suffix, 'employee');
  const employeeMembership = await admin.agencyMembership.create({
    data: { agencyId: agency.id, userId: employeeUser.id, status: 'ACTIVE' },
  });
  const approverUser = await createUser(admin, suffix, 'approver');
  const approverMembership = await admin.agencyMembership.create({
    data: { agencyId: agency.id, userId: approverUser.id, status: 'ACTIVE' },
  });
  const authorizerUser = await createUser(admin, suffix, 'authorizer');
  const authorizerMembership = await admin.agencyMembership.create({
    data: { agencyId: agency.id, userId: authorizerUser.id, status: 'ACTIVE' },
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
  const administrativeRole = await admin.role.findFirstOrThrow({
    where: { agencyId: null, code: 'hrmo_administrator' },
  });
  await admin.membershipRole.createMany({
    data: [approverMembership, authorizerMembership].map((target) => ({
      agencyId: agency.id,
      membershipId: target.id,
      roleId: administrativeRole.id,
      effectiveFrom: new Date('2020-01-01'),
    })),
  });
  const adminContext: RequestContext = {
    requestId: `attendance-correction-${suffix}-admin`,
    userId: user.id,
    agencyId: agency.id,
    membershipId: membership.id,
    primaryOrganizationUnitId: null,
    permissions: agencyAdminPermissions,
  };
  const employeeContext: RequestContext = {
    requestId: `attendance-correction-${suffix}-employee`,
    userId: employeeUser.id,
    agencyId: agency.id,
    membershipId: employeeMembership.id,
    primaryOrganizationUnitId: null,
    permissions: employeePermissions,
  };
  const approverContext: RequestContext = {
    ...adminContext,
    requestId: `attendance-correction-${suffix}-approver`,
    userId: approverUser.id,
    membershipId: approverMembership.id,
  };
  const authorizerContext: RequestContext = {
    ...adminContext,
    requestId: `attendance-correction-${suffix}-authorizer`,
    userId: authorizerUser.id,
    membershipId: authorizerMembership.id,
  };
  return {
    agency,
    membership,
    employeeMembership,
    approverMembership,
    authorizerMembership,
    unit,
    adminContext,
    employeeContext,
    approverContext,
    authorizerContext,
  };
}

async function createEmployee(
  admin: PrismaClient,
  values: { agencyId: string; membershipId: string; unitId: string; suffix: string },
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
      serviceStatus: 'ACTIVE',
      createdByMembershipId: values.membershipId,
      updatedByMembershipId: values.membershipId,
    },
  });
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
  return employee;
}

async function linkMembership(
  admin: PrismaClient,
  values: { agencyId: string; membershipId: string; employeeId: string },
): Promise<void> {
  await withDatabaseContext(
    {
      agencyId: values.agencyId,
      membershipId: values.membershipId,
      capabilities: ['employee-membership-link'],
    },
    (transaction) =>
      transaction.agencyMembership.update({
        where: { agencyId_id: { agencyId: values.agencyId, id: values.membershipId } },
        data: { employeeId: values.employeeId },
      }),
  );
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
  const registry = new ApprovalCompletionRegistry();
  const approvals = new ApprovalsService(approvalAuditWriter, registry);
  const dtrs = new DtrsService(dtrAuditWriter, documentsService);
  const periods = new AttendancePeriodsService(attendancePeriodAuditWriter, approvals, dtrs, days);
  const corrections = new AttendanceCorrectionsService(
    attendanceCorrectionAuditWriter,
    approvals,
    registry,
    days,
    attendance,
    documentsService,
    dtrs,
    periods,
  );
  corrections.onModuleInit();
  return {
    documentsService,
    schedules,
    arrangements,
    calendars,
    assignments,
    attendance,
    contexts,
    days,
    approvals,
    dtrs,
    periods,
    corrections,
  };
}

async function setupSchedule(
  admin: PrismaClient,
  values: {
    context: RequestContext;
    membershipId: string;
    suffix: string;
    effectiveFrom: string;
    services: ReturnType<typeof services>;
  },
) {
  const { context, membershipId, suffix, effectiveFrom } = values;
  const { schedules, arrangements, calendars } = values.services;
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
    assignmentEvidence,
    scheduleVersionId: scheduleActive.currentVersion!.id,
    arrangementVersionId: arrangementActive.currentVersion!.id,
  };
}

async function seedApprovalRoutes(
  admin: PrismaClient,
  values: {
    context: RequestContext;
    effectiveFrom: string;
    approverMembershipId: string;
    authorizerMembershipId: string;
  },
) {
  const { context } = values;
  const approvals = new ApprovalsService(approvalAuditWriter, new ApprovalCompletionRegistry());
  const open = await approvals.createRoute(context, {
    routeCode: ATTENDANCE_CORRECTION_ROUTE_CODE,
    domain: 'ATTENDANCE',
    versionNo: 1,
    effectiveFrom: values.effectiveFrom,
    stepDefinition: {
      steps: [
        {
          stepNo: 1,
          stepMode: 'SEQUENTIAL',
          requiredPermission: 'attendance.corrections.approve',
          assignment: { kind: 'MEMBERSHIP', membershipId: values.approverMembershipId },
          requiresSeparateReview: true,
        },
      ],
    },
  });
  await approvals.activateRoute(context, open.id, 'Activate the Attendance Correction route.');
  const locked = await approvals.createRoute(context, {
    routeCode: ATTENDANCE_CORRECTION_LOCKED_ROUTE_CODE,
    domain: 'ATTENDANCE',
    versionNo: 1,
    effectiveFrom: values.effectiveFrom,
    stepDefinition: {
      steps: [
        {
          stepNo: 1,
          stepMode: 'SEQUENTIAL',
          requiredPermission: 'attendance.corrections.approve',
          assignment: { kind: 'MEMBERSHIP', membershipId: values.approverMembershipId },
          requiresSeparateReview: true,
        },
        {
          stepNo: 2,
          stepMode: 'SEQUENTIAL',
          requiredPermission: 'attendance.corrections.authorize_locked',
          assignment: { kind: 'MEMBERSHIP', membershipId: values.authorizerMembershipId },
          requiresSeparateReview: true,
        },
      ],
    },
  });
  await approvals.activateRoute(
    context,
    locked.id,
    'Activate the locked Attendance Correction route.',
  );
  return { open, locked };
}

async function cleanupAgency(admin: PrismaClient, agencyId: string, suffix: string): Promise<void> {
  await admin.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    await transaction.lockedAttendanceAdjustmentPeriod.deleteMany({ where: { agencyId } });
    await transaction.lockedAttendanceAdjustment.deleteMany({ where: { agencyId } });
    await transaction.attendanceCorrectionEffect.deleteMany({ where: { agencyId } });
    await transaction.attendanceCorrectionEvidence.deleteMany({ where: { agencyId } });
    await transaction.attendanceCorrection.deleteMany({ where: { agencyId } });
    await transaction.attendancePayrollFact.deleteMany({ where: { agencyId } });
    await transaction.attendancePayrollPublication.deleteMany({ where: { agencyId } });
    await transaction.attendancePeriodVersionDay.deleteMany({ where: { agencyId } });
    await transaction.attendancePeriodVersion.deleteMany({ where: { agencyId } });
    await transaction.employeeAttendanceSubmissionDay.deleteMany({ where: { agencyId } });
    await transaction.employeeAttendanceSubmission.deleteMany({ where: { agencyId } });
    await transaction.approvalDecision.deleteMany({ where: { agencyId } });
    await transaction.approvalStep.deleteMany({ where: { agencyId } });
    await transaction.approvalRequest.deleteMany({ where: { agencyId } });
    await transaction.approvalRouteVersion.deleteMany({ where: { agencyId } });
    await transaction.attendanceException.deleteMany({ where: { agencyId } });
    await transaction.attendanceDaySegment.deleteMany({ where: { agencyId } });
    await transaction.attendanceDay.deleteMany({ where: { agencyId } });
    await transaction.attendancePeriod.deleteMany({ where: { agencyId } });
    await transaction.attendanceContext.deleteMany({ where: { agencyId } });
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
    await transaction.dtrDocument.deleteMany({ where: { agencyId } });
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

interface Fixture {
  admin: PrismaClient;
  suffix: string;
  employeeId: string;
  otherEmployeeId: string;
  workDate: string;
  periodId: string;
  attendanceDayId: string;
  eventIds: Record<'TIME_IN' | 'BREAK_OUT' | 'BREAK_IN' | 'TIME_OUT', string>;
  context: RequestContext;
  employeeContext: RequestContext;
  approverContext: RequestContext;
  authorizerContext: RequestContext;
  services: ReturnType<typeof services>;
  agencyId: string;
  membershipId: string;
  approverMembershipId: string;
  authorizerMembershipId: string;
}

async function createFixture(options: { seedDay?: boolean } = {}): Promise<Fixture> {
  const admin = await createAdminClient();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-correction`;
  const workDate = pastWeekday(3);
  const effectiveFrom = manilaDate(-30);
  const agencySetup = await createAgency(admin, suffix);
  const serviceSet = services();
  const employee = await createEmployee(admin, {
    agencyId: agencySetup.agency.id,
    membershipId: agencySetup.membership.id,
    unitId: agencySetup.unit.id,
    suffix,
  });
  const otherEmployee = await createEmployee(admin, {
    agencyId: agencySetup.agency.id,
    membershipId: agencySetup.membership.id,
    unitId: agencySetup.unit.id,
    suffix: `${suffix}-other`,
  });
  await linkMembership(admin, {
    agencyId: agencySetup.agency.id,
    membershipId: agencySetup.employeeMembership.id,
    employeeId: employee.id,
  });
  await linkMembership(admin, {
    agencyId: agencySetup.agency.id,
    membershipId: agencySetup.approverMembership.id,
    employeeId: otherEmployee.id,
  });
  const setup = await setupSchedule(admin, {
    context: agencySetup.adminContext,
    membershipId: agencySetup.membership.id,
    suffix,
    effectiveFrom,
    services: serviceSet,
  });
  await serviceSet.assignments.create(agencySetup.adminContext, {
    employeeId: employee.id,
    workScheduleVersionId: setup.scheduleVersionId,
    workArrangementVersionId: setup.arrangementVersionId,
    authorityDocumentVersionId: setup.assignmentEvidence.id,
    effectiveFrom,
  });
  await seedApprovalRoutes(admin, {
    context: agencySetup.adminContext,
    effectiveFrom,
    approverMembershipId: agencySetup.approverMembership.id,
    authorizerMembershipId: agencySetup.authorizerMembership.id,
  });
  const events = {} as Record<'TIME_IN' | 'BREAK_OUT' | 'BREAK_IN' | 'TIME_OUT', string>;
  for (const [eventType, timeValue] of [
    ['TIME_IN', '08:00'],
    ['BREAK_OUT', '12:00'],
    ['BREAK_IN', '13:00'],
    ['TIME_OUT', '16:00'],
  ] as const) {
    const event = await admin.attendanceEvent.create({
      data: {
        agencyId: agencySetup.agency.id,
        employeeId: employee.id,
        eventTime: manilaInstant(workDate, timeValue),
        eventType,
        source: 'MANUAL',
        enteredByMembershipId: agencySetup.membership.id,
        reason: 'Correction integration fixture.',
      },
    });
    events[eventType] = event.id;
  }
  let periodId = '';
  let attendanceDayId = '';
  if (options.seedDay !== false) {
    const calculated = await serviceSet.days.calculate(agencySetup.adminContext, {
      periodCode: `2026-${workDate.slice(5, 7)}`,
      dateFrom: workDate,
      dateTo: workDate,
      employeeIds: [employee.id],
    });
    periodId = calculated.period.id;
    attendanceDayId = calculated.days[0]!.attendanceDayId!;
  }
  return {
    admin,
    suffix,
    employeeId: employee.id,
    otherEmployeeId: otherEmployee.id,
    workDate,
    periodId,
    attendanceDayId,
    eventIds: events,
    context: agencySetup.adminContext,
    employeeContext: agencySetup.employeeContext,
    approverContext: agencySetup.approverContext,
    authorizerContext: agencySetup.authorizerContext,
    services: serviceSet,
    agencyId: agencySetup.agency.id,
    membershipId: agencySetup.membership.id,
    approverMembershipId: agencySetup.approverMembership.id,
    authorizerMembershipId: agencySetup.authorizerMembership.id,
  };
}

async function evidence(
  admin: PrismaClient,
  fixture: Fixture,
  label = 'evidence',
): Promise<string> {
  const version = await createEvidence(
    admin,
    fixture.agencyId,
    fixture.membershipId,
    `${fixture.suffix}-${label}`,
    'ATTENDANCE_CORRECTION_EVIDENCE',
  );
  return version.id;
}

it.skipIf(!enabled)(
  'applies an open-period Attendance Correction, preserves the original, and versions the Attendance Day',
  async () => {
    const fixture = await createFixture();
    const { admin, services } = fixture;
    try {
      const documentVersionId = await evidence(admin, fixture);
      const createInput = {
        targetType: 'ATTENDANCE_EVENT' as const,
        requestedAction: 'REPLACE' as const,
        targetId: fixture.eventIds.TIME_OUT,
        requestedRecord: {
          eventType: 'TIME_OUT' as const,
          eventTime: manilaInstant(fixture.workDate, '17:00').toISOString(),
        },
        reason: 'The Employee clocked out early but rendered full duty.',
        evidence: [{ documentVersionId }],
      };
      const created = await services.corrections.create(
        fixture.employeeContext,
        createInput,
        'open-correction-create',
      );
      expect(created.correction.status).toBe('DRAFT');
      expect(created.correction.employee.id).toBe(fixture.employeeId);
      expect(created.impactPreview.lockedPeriodVersionIds).toEqual([]);
      expect(created.impactPreview.days).toHaveLength(1);
      expect(created.impactPreview.days[0]?.attendanceDayId).toBe(fixture.attendanceDayId);

      const replayedCreate = await services.corrections.create(
        fixture.employeeContext,
        createInput,
        'open-correction-create',
      );
      expect(replayedCreate.correction.id).toBe(created.correction.id);
      const correctionCount = await admin.attendanceCorrection.count({
        where: { agencyId: fixture.agencyId },
      });
      expect(correctionCount).toBe(1);

      const draftSubmission = await admin.employeeAttendanceSubmission.create({
        data: {
          agencyId: fixture.agencyId,
          attendancePeriodId: fixture.periodId,
          employeeId: fixture.employeeId,
          versionNo: 1,
          status: 'DRAFT',
          submittedByMembershipId: fixture.employeeContext.membershipId,
        },
      });
      await admin.employeeAttendanceSubmissionDay.create({
        data: {
          agencyId: fixture.agencyId,
          employeeAttendanceSubmissionId: draftSubmission.id,
          attendanceDayId: fixture.attendanceDayId,
        },
      });

      const submitted = await services.corrections.submit(
        fixture.employeeContext,
        created.correction.id,
        'open-correction-submit',
      );
      expect(submitted.correction.status).toBe('SUBMITTED');
      expect(submitted.approval?.status).toBe('IN_PROGRESS');

      const replayedSubmit = await services.corrections.submit(
        fixture.employeeContext,
        created.correction.id,
        'open-correction-submit',
      );
      expect(replayedSubmit.correction.id).toBe(created.correction.id);
      const requestCount = await admin.approvalRequest.count({
        where: { agencyId: fixture.agencyId, subjectId: created.correction.id },
      });
      expect(requestCount).toBe(1);

      const applied = await services.corrections.approve(
        fixture.approverContext,
        created.correction.id,
        'Factual correction verified against the signed logbook.',
      );
      expect(applied.correction.status).toBe('APPLIED');
      expect(applied.effect?.effectAction).toBe('REPLACE');
      expect(applied.effect?.originalTargetId).toBe(fixture.eventIds.TIME_OUT);
      expect(applied.lockedAdjustment).toBeNull();

      const successorRecord = await admin.attendanceDay.findFirstOrThrow({
        where: { agencyId: fixture.agencyId, employeeId: fixture.employeeId, isCurrent: true },
      });
      expect(successorRecord.calculationVersion).toBe(2);
      const successor = await services.days.findById(fixture.context, successorRecord.id);
      expect(successor.day.calculationVersion).toBe(2);
      expect(successor.day.isCurrent).toBe(true);
      expect(successor.day.totals.undertimeMinutes).toBe(0);
      expect(successor.day.totals.workedMinutes).toBe(480);
      expect(successor.day.ruleSnapshot.eventIds).toContain(applied.effect!.id);

      const previous = await admin.attendanceDay.findUniqueOrThrow({
        where: { id: fixture.attendanceDayId },
      });
      expect(previous.isCurrent).toBe(false);
      expect(previous.calculationVersion).toBe(1);
      expect(previous.undertimeMinutes).toBe(60);

      const originalEvent = await admin.attendanceEvent.findUniqueOrThrow({
        where: { id: fixture.eventIds.TIME_OUT },
      });
      expect(originalEvent.eventTime.toISOString()).toBe(
        manilaInstant(fixture.workDate, '16:00').toISOString(),
      );

      const appliedAudit = await admin.auditEvent.findFirst({
        where: { agencyId: fixture.agencyId, action: 'ATTENDANCE_CORRECTION_APPLIED' },
      });
      expect(appliedAudit?.entityId).toBe(created.correction.id);
      expect(appliedAudit?.newStatus).toBe('APPLIED');

      const auditCount = await admin.auditEvent.count({
        where: { agencyId: fixture.agencyId, action: 'ATTENDANCE_CORRECTION_APPLIED' },
      });
      expect(auditCount).toBe(1);

      const staledSubmission = await admin.employeeAttendanceSubmission.findUniqueOrThrow({
        where: { id: draftSubmission.id },
      });
      expect(staledSubmission.status).toBe('STALE');
    } finally {
      await cleanupAgency(admin, fixture.agencyId, fixture.suffix);
      await admin.$disconnect();
    }
  },
);

it.skipIf(!enabled)(
  'rejects a stale Impact Preview without partial effects or a recorded decision',
  async () => {
    const fixture = await createFixture();
    const { admin, services } = fixture;
    try {
      const documentVersionId = await evidence(admin, fixture);
      const created = await services.corrections.create(fixture.employeeContext, {
        targetType: 'ATTENDANCE_EVENT',
        requestedAction: 'REPLACE',
        targetId: fixture.eventIds.TIME_OUT,
        requestedRecord: {
          eventType: 'TIME_OUT',
          eventTime: manilaInstant(fixture.workDate, '17:00').toISOString(),
        },
        reason: 'Full duty rendered.',
        evidence: [{ documentVersionId }],
      });
      await services.corrections.submit(fixture.employeeContext, created.correction.id);

      await admin.attendanceEvent.create({
        data: {
          agencyId: fixture.agencyId,
          employeeId: fixture.employeeId,
          eventTime: manilaInstant(fixture.workDate, '15:00'),
          eventType: 'BREAK_OUT',
          source: 'MANUAL',
          enteredByMembershipId: fixture.membershipId,
          reason: 'Intervening source change.',
        },
      });
      await services.days.calculate(fixture.context, {
        periodCode: `2026-${fixture.workDate.slice(5, 7)}`,
        dateFrom: fixture.workDate,
        dateTo: fixture.workDate,
        employeeIds: [fixture.employeeId],
      });

      await expect(
        services.corrections.approve(fixture.approverContext, created.correction.id, 'Approved.'),
      ).rejects.toMatchObject({ code: 'ATTENDANCE_CORRECTION_STALE_PREVIEW', statusCode: 409 });

      const effectCount = await admin.attendanceCorrectionEffect.count({
        where: { agencyId: fixture.agencyId },
      });
      expect(effectCount).toBe(0);
      const decisionCount = await admin.approvalDecision.count({
        where: { agencyId: fixture.agencyId },
      });
      expect(decisionCount).toBe(0);
      const record = await admin.attendanceCorrection.findUniqueOrThrow({
        where: { id: created.correction.id },
      });
      expect(record.status).toBe('SUBMITTED');
      const successDay = await admin.attendanceDay.findFirstOrThrow({
        where: { agencyId: fixture.agencyId, employeeId: fixture.employeeId, isCurrent: true },
      });
      expect(successDay.calculationVersion).toBe(2);
    } finally {
      await cleanupAgency(admin, fixture.agencyId, fixture.suffix);
      await admin.$disconnect();
    }
  },
);

it.skipIf(!enabled)(
  'serializes an Attendance Period lock against an open-period Attendance Correction',
  async () => {
    const fixture = await createFixture();
    const { admin, services } = fixture;
    try {
      const submission = await admin.employeeAttendanceSubmission.create({
        data: {
          agencyId: fixture.agencyId,
          attendancePeriodId: fixture.periodId,
          employeeId: fixture.employeeId,
          versionNo: 1,
          status: 'APPROVED',
          submittedByMembershipId: fixture.employeeContext.membershipId,
          submittedAt: new Date(),
          reviewedByMembershipId: fixture.approverMembershipId,
          reviewedAt: new Date(),
          reviewReason: 'Seed submission approved for the lock race.',
        },
      });
      await admin.employeeAttendanceSubmissionDay.create({
        data: {
          agencyId: fixture.agencyId,
          employeeAttendanceSubmissionId: submission.id,
          attendanceDayId: fixture.attendanceDayId,
        },
      });
      await admin.attendanceDay.update({
        where: { id: fixture.attendanceDayId },
        data: { status: 'APPROVED' },
      });
      const route = await services.approvals.createRoute(fixture.context, {
        routeCode: 'DTR-PERIOD-LOCK',
        domain: 'ATTENDANCE',
        versionNo: 1,
        effectiveFrom: manilaDate(-30),
        stepDefinition: {
          steps: [
            {
              stepNo: 1,
              stepMode: 'SEQUENTIAL',
              requiredPermission: 'attendance.periods.approve',
              assignment: { kind: 'MEMBERSHIP', membershipId: fixture.approverMembershipId },
              requiresSeparateReview: false,
            },
          ],
        },
      });
      await services.approvals.activateRoute(
        fixture.context,
        route.id,
        'Activate the Attendance Period lock route.',
      );
      const version = await services.periods.submitForReview(fixture.context, fixture.periodId);
      await services.periods.approve(fixture.approverContext, version.version.id, {});

      const documentVersionId = await evidence(admin, fixture);
      const created = await services.corrections.create(fixture.employeeContext, {
        targetType: 'ATTENDANCE_EVENT',
        requestedAction: 'REPLACE',
        targetId: fixture.eventIds.TIME_OUT,
        requestedRecord: {
          eventType: 'TIME_OUT',
          eventTime: manilaInstant(fixture.workDate, '17:00').toISOString(),
        },
        reason: 'The Employee clocked out early but rendered full duty.',
        evidence: [{ documentVersionId }],
      });
      await services.corrections.submit(fixture.employeeContext, created.correction.id);

      const [lockResult, correctionResult] = await Promise.allSettled([
        services.periods.lock(fixture.context, version.version.id),
        services.corrections.approve(fixture.approverContext, created.correction.id, 'Approved.'),
      ]);

      const lockedVersion = await admin.attendancePeriodVersion.findUniqueOrThrow({
        where: { id: version.version.id },
      });
      const correction = await admin.attendanceCorrection.findUniqueOrThrow({
        where: { id: created.correction.id },
      });
      const period = await admin.attendancePeriod.findUniqueOrThrow({
        where: { id: fixture.periodId },
      });
      if (lockResult.status === 'fulfilled') {
        expect(correctionResult.status).toBe('rejected');
        expect(lockedVersion.status).toBe('LOCKED');
        expect(period.status).toBe('FINALIZED');
        expect(correction.status).not.toBe('APPLIED');
        expect(
          await admin.attendancePayrollPublication.count({ where: { agencyId: fixture.agencyId } }),
        ).toBe(1);
        expect(await admin.dtrDocument.count({ where: { agencyId: fixture.agencyId } })).toBe(1);
      } else {
        expect(correctionResult.status).toBe('fulfilled');
        expect(lockedVersion.status).toBe('APPROVED');
        expect(period.status).toBe('OPEN');
        expect(correction.status).toBe('APPLIED');
        expect(
          await admin.attendancePayrollPublication.count({ where: { agencyId: fixture.agencyId } }),
        ).toBe(0);
        expect(await admin.dtrDocument.count({ where: { agencyId: fixture.agencyId } })).toBe(0);
      }
    } finally {
      await cleanupAgency(admin, fixture.agencyId, fixture.suffix);
      await admin.$disconnect();
    }
  },
);

it.skipIf(!enabled)(
  'requires a different HR Administrator for a locked-period correction and creates a successor Attendance Period Version',
  async () => {
    const fixture = await createFixture();
    const { admin, services } = fixture;
    try {
      const route = await admin.approvalRouteVersion.findFirstOrThrow({
        where: { agencyId: fixture.agencyId, routeCode: ATTENDANCE_CORRECTION_LOCKED_ROUTE_CODE },
      });
      const submission = await admin.employeeAttendanceSubmission.create({
        data: {
          agencyId: fixture.agencyId,
          attendancePeriodId: fixture.periodId,
          employeeId: fixture.employeeId,
          versionNo: 1,
          status: 'APPROVED',
          submittedByMembershipId: fixture.employeeContext.membershipId,
          submittedAt: new Date(),
          reviewedByMembershipId: fixture.approverMembershipId,
          reviewedAt: new Date(),
          reviewReason: 'Seed submission approved.',
        },
      });
      await admin.employeeAttendanceSubmissionDay.create({
        data: {
          agencyId: fixture.agencyId,
          employeeAttendanceSubmissionId: submission.id,
          attendanceDayId: fixture.attendanceDayId,
        },
      });
      const predecessor = await admin.attendancePeriodVersion.create({
        data: {
          agencyId: fixture.agencyId,
          attendancePeriodId: fixture.periodId,
          versionNo: 1,
          status: 'LOCKED',
          approvalRouteVersionId: route.id,
          submittedByMembershipId: fixture.membershipId,
          submittedAt: new Date(),
          reviewedByMembershipId: fixture.approverMembershipId,
          reviewedAt: new Date(),
          reviewReason: 'Seed period reviewed.',
          lockedByMembershipId: fixture.authorizerMembershipId,
          lockedAt: new Date(),
          reconciliation: { seed: true },
        },
      });
      await admin.attendancePeriodVersionDay.create({
        data: {
          agencyId: fixture.agencyId,
          attendancePeriodVersionId: predecessor.id,
          employeeAttendanceSubmissionId: submission.id,
          attendanceDayId: fixture.attendanceDayId,
        },
      });
      const predecessorPublication = await admin.attendancePayrollPublication.create({
        data: {
          agencyId: fixture.agencyId,
          attendancePeriodVersionId: predecessor.id,
          publicationType: 'ORIGINAL',
          idempotencyKey: `seed-original:${predecessor.id}`,
          publishedAt: new Date(),
        },
      });
      await admin.attendancePayrollFact.createMany({
        data: [
          {
            agencyId: fixture.agencyId,
            attendancePayrollPublicationId: predecessorPublication.id,
            attendanceDayId: fixture.attendanceDayId,
            employeeId: fixture.employeeId,
            workDate: new Date(`${fixture.workDate}T00:00:00.000Z`),
            factType: 'EXPECTED',
            holidayClassification: null,
            stableSourceKey: `${fixture.employeeId}|${fixture.workDate}|EXPECTED|NONE`,
            correctedMinutes: 480,
          },
          {
            agencyId: fixture.agencyId,
            attendancePayrollPublicationId: predecessorPublication.id,
            attendanceDayId: fixture.attendanceDayId,
            employeeId: fixture.employeeId,
            workDate: new Date(`${fixture.workDate}T00:00:00.000Z`),
            factType: 'WORKED',
            holidayClassification: null,
            stableSourceKey: `${fixture.employeeId}|${fixture.workDate}|WORKED|NONE`,
            correctedMinutes: 420,
          },
        ],
      });
      await finalizeAttendancePeriod(admin, fixture.periodId);
      const predecessorDtrs = await services.dtrs.materializeForLockedVersionInTransaction(
        admin,
        fixture.authorizerContext,
        predecessor.id,
      );
      expect(predecessorDtrs.dtrDocumentIds).toHaveLength(1);

      const documentVersionId = await evidence(admin, fixture);
      const created = await services.corrections.create(fixture.employeeContext, {
        targetType: 'ATTENDANCE_EVENT',
        requestedAction: 'REPLACE',
        targetId: fixture.eventIds.TIME_OUT,
        requestedRecord: {
          eventType: 'TIME_OUT',
          eventTime: manilaInstant(fixture.workDate, '17:00').toISOString(),
        },
        reason: 'Correcting a locked period needs authorization.',
        evidence: [{ documentVersionId }],
      });
      expect(created.impactPreview.lockedPeriodVersionIds).toEqual([predecessor.id]);
      expect(created.correction.approvalRouteVersionId).toBe(route.id);

      await services.corrections.submit(fixture.employeeContext, created.correction.id);
      const factual = await services.corrections.approve(
        fixture.approverContext,
        created.correction.id,
        'Factual approval recorded.',
      );
      expect(factual.correction.status).toBe('FOR_AUTHORIZATION');
      expect(factual.correction.decidedByMembershipId).toBe(fixture.approverMembershipId);

      await expect(
        services.corrections.authorizeLocked(
          fixture.approverContext,
          created.correction.id,
          'Self authorization attempt.',
        ),
      ).rejects.toMatchObject({
        code: 'ATTENDANCE_CORRECTION_SEPARATION_REQUIRED',
        statusCode: 403,
      });

      const applied = await services.corrections.authorizeLocked(
        fixture.authorizerContext,
        created.correction.id,
        'Authorization recorded.',
      );
      expect(applied.correction.status).toBe('APPLIED');
      expect(applied.lockedAdjustment?.periods).toEqual([
        {
          predecessorPeriodVersionId: predecessor.id,
          successorPeriodVersionId: applied.lockedAdjustment!.periods[0]!.successorPeriodVersionId,
        },
      ]);

      const successor = await admin.attendancePeriodVersion.findUniqueOrThrow({
        where: { id: applied.lockedAdjustment!.periods[0]!.successorPeriodVersionId },
        include: { days: true },
      });
      expect(successor.predecessorVersionId).toBe(predecessor.id);
      expect(successor.versionNo).toBe(2);
      expect(successor.status).toBe('LOCKED');
      expect(successor.days).toHaveLength(1);
      expect(successor.days[0]?.attendanceDayId).not.toBe(fixture.attendanceDayId);

      const successorPublication = await admin.attendancePayrollPublication.findFirstOrThrow({
        where: { attendancePeriodVersionId: successor.id },
        include: { facts: true },
      });
      expect(successorPublication.publicationType).toBe('ADJUSTMENT');
      expect(successorPublication.predecessorPublicationId).toBe(predecessorPublication.id);
      expect(successorPublication.facts.find((fact) => fact.factType === 'WORKED')).toMatchObject({
        priorMinutes: 420,
        correctedMinutes: 480,
        differenceDirection: 'INCREASE',
        differenceMinutes: 60,
      });
      expect(
        successorPublication.facts.find((fact) => fact.factType === 'EXPECTED'),
      ).toBeUndefined();
      expect(successorPublication.facts).toHaveLength(1);

      const staleSubmission = await admin.employeeAttendanceSubmission.findUniqueOrThrow({
        where: { id: submission.id },
      });
      expect(staleSubmission.status).toBe('STALE');

      const untouchedPredecessor = await admin.attendancePeriodVersion.findUniqueOrThrow({
        where: { id: predecessor.id },
      });
      expect(untouchedPredecessor.status).toBe('LOCKED');
      expect(untouchedPredecessor.reconciliation).toMatchObject({ seed: true });

      const correctedDtr = await admin.dtrDocument.findFirstOrThrow({
        where: {
          agencyId: fixture.agencyId,
          attendancePeriodVersionId: successor.id,
        },
      });
      expect(correctedDtr.classification).toBe('CORRECTED');
      expect(correctedDtr.predecessorDtrDocumentId).toBe(predecessorDtrs.dtrDocumentIds[0]);
      expect(correctedDtr.outputType).toBe('PRINTABLE_SYSTEM_VIEW');
      const correctedEffect = await admin.attendanceCorrectionEffect.findFirstOrThrow({
        where: { agencyId: fixture.agencyId, attendanceCorrectionId: created.correction.id },
      });
      expect(JSON.stringify(correctedDtr.sourceManifest)).toContain(correctedEffect.id);
      const currentDtrs = await services.dtrs.list(fixture.authorizerContext, {
        attendancePeriodId: fixture.periodId,
        currentOnly: true,
      });
      expect(currentDtrs).toHaveLength(1);
      expect(currentDtrs[0]!.id).toBe(correctedDtr.id);
      expect(currentDtrs[0]!.classification).toBe('CORRECTED');
      expect(currentDtrs[0]!.isCurrent).toBe(true);
      const allDtrs = await services.dtrs.list(fixture.authorizerContext, {
        attendancePeriodId: fixture.periodId,
      });
      expect(allDtrs).toHaveLength(2);
    } finally {
      await cleanupAgency(admin, fixture.agencyId, fixture.suffix);
      await admin.$disconnect();
    }
  },
);

it.skipIf(!enabled)(
  'carries the effective prior value into a chained successor Attendance Payroll Publication',
  async () => {
    const fixture = await createFixture();
    const { admin, services } = fixture;
    try {
      const route = await admin.approvalRouteVersion.findFirstOrThrow({
        where: { agencyId: fixture.agencyId, routeCode: ATTENDANCE_CORRECTION_LOCKED_ROUTE_CODE },
      });
      const submission = await admin.employeeAttendanceSubmission.create({
        data: {
          agencyId: fixture.agencyId,
          attendancePeriodId: fixture.periodId,
          employeeId: fixture.employeeId,
          versionNo: 1,
          status: 'APPROVED',
          submittedByMembershipId: fixture.employeeContext.membershipId,
          submittedAt: new Date(),
          reviewedByMembershipId: fixture.approverMembershipId,
          reviewedAt: new Date(),
          reviewReason: 'Seed submission approved.',
        },
      });
      await admin.employeeAttendanceSubmissionDay.create({
        data: {
          agencyId: fixture.agencyId,
          employeeAttendanceSubmissionId: submission.id,
          attendanceDayId: fixture.attendanceDayId,
        },
      });
      const predecessor = await admin.attendancePeriodVersion.create({
        data: {
          agencyId: fixture.agencyId,
          attendancePeriodId: fixture.periodId,
          versionNo: 1,
          status: 'LOCKED',
          approvalRouteVersionId: route.id,
          submittedByMembershipId: fixture.membershipId,
          submittedAt: new Date(),
          reviewedByMembershipId: fixture.approverMembershipId,
          reviewedAt: new Date(),
          reviewReason: 'Seed period reviewed.',
          lockedByMembershipId: fixture.authorizerMembershipId,
          lockedAt: new Date(),
          reconciliation: { seed: true },
        },
      });
      await admin.attendancePeriodVersionDay.create({
        data: {
          agencyId: fixture.agencyId,
          attendancePeriodVersionId: predecessor.id,
          employeeAttendanceSubmissionId: submission.id,
          attendanceDayId: fixture.attendanceDayId,
        },
      });
      const predecessorPublication = await admin.attendancePayrollPublication.create({
        data: {
          agencyId: fixture.agencyId,
          attendancePeriodVersionId: predecessor.id,
          publicationType: 'ORIGINAL',
          idempotencyKey: `seed-original:${predecessor.id}`,
          publishedAt: new Date(),
        },
      });
      await admin.attendancePayrollFact.createMany({
        data: [
          {
            agencyId: fixture.agencyId,
            attendancePayrollPublicationId: predecessorPublication.id,
            attendanceDayId: fixture.attendanceDayId,
            employeeId: fixture.employeeId,
            workDate: new Date(`${fixture.workDate}T00:00:00.000Z`),
            factType: 'EXPECTED',
            holidayClassification: null,
            stableSourceKey: `${fixture.employeeId}|${fixture.workDate}|EXPECTED|NONE`,
            correctedMinutes: 480,
          },
          {
            agencyId: fixture.agencyId,
            attendancePayrollPublicationId: predecessorPublication.id,
            attendanceDayId: fixture.attendanceDayId,
            employeeId: fixture.employeeId,
            workDate: new Date(`${fixture.workDate}T00:00:00.000Z`),
            factType: 'WORKED',
            holidayClassification: null,
            stableSourceKey: `${fixture.employeeId}|${fixture.workDate}|WORKED|NONE`,
            correctedMinutes: 420,
          },
          {
            agencyId: fixture.agencyId,
            attendancePayrollPublicationId: predecessorPublication.id,
            attendanceDayId: fixture.attendanceDayId,
            employeeId: fixture.employeeId,
            workDate: new Date(`${fixture.workDate}T00:00:00.000Z`),
            factType: 'UNDERTIME',
            holidayClassification: null,
            stableSourceKey: `${fixture.employeeId}|${fixture.workDate}|UNDERTIME|NONE`,
            correctedMinutes: 60,
          },
        ],
      });
      await finalizeAttendancePeriod(admin, fixture.periodId);
      await services.dtrs.materializeForLockedVersionInTransaction(
        admin,
        fixture.authorizerContext,
        predecessor.id,
      );

      const firstEvidence = await evidence(admin, fixture, 'evidence-first');
      const first = await services.corrections.create(fixture.employeeContext, {
        targetType: 'ATTENDANCE_EVENT',
        requestedAction: 'REPLACE',
        targetId: fixture.eventIds.TIME_IN,
        requestedRecord: {
          eventType: 'TIME_IN',
          eventTime: manilaInstant(fixture.workDate, '08:30').toISOString(),
        },
        reason: 'The Employee started duty late.',
        evidence: [{ documentVersionId: firstEvidence }],
      });
      await services.corrections.submit(fixture.employeeContext, first.correction.id);
      await services.corrections.approve(
        fixture.approverContext,
        first.correction.id,
        'Factual approval recorded.',
      );
      const firstApplied = await services.corrections.authorizeLocked(
        fixture.authorizerContext,
        first.correction.id,
        'Authorization recorded.',
      );
      expect(firstApplied.correction.status).toBe('APPLIED');
      const firstSuccessorId = firstApplied.lockedAdjustment!.periods[0]!.successorPeriodVersionId;
      const firstPublication = await admin.attendancePayrollPublication.findFirstOrThrow({
        where: { attendancePeriodVersionId: firstSuccessorId },
        include: { facts: true },
      });
      expect(firstPublication.publicationType).toBe('ADJUSTMENT');
      expect(firstPublication.facts.map((fact) => fact.factType).sort()).toEqual([
        'TARDINESS',
        'WORKED',
      ]);

      const secondEvidence = await evidence(admin, fixture, 'evidence-second');
      const second = await services.corrections.create(fixture.employeeContext, {
        targetType: 'ATTENDANCE_EVENT',
        requestedAction: 'REPLACE',
        targetId: fixture.eventIds.TIME_OUT,
        requestedRecord: {
          eventType: 'TIME_OUT',
          eventTime: manilaInstant(fixture.workDate, '16:30').toISOString(),
        },
        reason: 'The Employee clocked out later than recorded.',
        evidence: [{ documentVersionId: secondEvidence }],
      });
      await services.corrections.submit(fixture.employeeContext, second.correction.id);
      await services.corrections.approve(
        fixture.approverContext,
        second.correction.id,
        'Factual approval recorded.',
      );
      const secondApplied = await services.corrections.authorizeLocked(
        fixture.authorizerContext,
        second.correction.id,
        'Authorization recorded.',
      );
      expect(secondApplied.correction.status).toBe('APPLIED');
      const secondSuccessorId =
        secondApplied.lockedAdjustment!.periods[0]!.successorPeriodVersionId;
      const secondSuccessor = await admin.attendancePeriodVersion.findUniqueOrThrow({
        where: { id: secondSuccessorId },
      });
      expect(secondSuccessor.predecessorVersionId).toBe(firstSuccessorId);
      const secondPublication = await admin.attendancePayrollPublication.findFirstOrThrow({
        where: { attendancePeriodVersionId: secondSuccessorId },
        include: { facts: true },
      });
      expect(secondPublication.predecessorPublicationId).toBe(firstPublication.id);
      expect(secondPublication.facts.find((fact) => fact.factType === 'UNDERTIME')).toMatchObject({
        priorMinutes: 60,
        correctedMinutes: 30,
        differenceDirection: 'DECREASE',
        differenceMinutes: 30,
      });
      expect(secondPublication.facts.find((fact) => fact.factType === 'WORKED')).toMatchObject({
        priorMinutes: 390,
        correctedMinutes: 420,
        differenceDirection: 'INCREASE',
        differenceMinutes: 30,
      });
      expect(secondPublication.facts).toHaveLength(2);
    } finally {
      await cleanupAgency(admin, fixture.agencyId, fixture.suffix);
      await admin.$disconnect();
    }
  },
);

it.skipIf(!enabled)(
  'enforces separation of duties, on-behalf scope, own-record reads, and Cross-Agency rejection',
  async () => {
    const fixture = await createFixture();
    const { admin, services } = fixture;
    const foreign = await createAdminClient();
    try {
      const documentVersionId = await evidence(admin, fixture);
      await expect(
        services.corrections.create(fixture.employeeContext, {
          employeeId: fixture.otherEmployeeId,
          targetType: 'ATTENDANCE_EVENT',
          requestedAction: 'VOID',
          targetId: fixture.eventIds.BREAK_OUT,
          reason: 'Attempting on-behalf without scope.',
          evidence: [{ documentVersionId }],
        }),
      ).rejects.toMatchObject({ code: 'ATTENDANCE_CORRECTION_CREATE_FORBIDDEN', statusCode: 403 });

      const created = await services.corrections.create(fixture.employeeContext, {
        targetType: 'ATTENDANCE_EVENT',
        requestedAction: 'VOID',
        targetId: fixture.eventIds.BREAK_OUT,
        reason: 'Duplicate break event.',
        evidence: [{ documentVersionId }],
      });
      await services.corrections.submit(fixture.employeeContext, created.correction.id);

      await expect(
        services.corrections.approve(
          fixture.employeeContext,
          created.correction.id,
          'Self approval.',
        ),
      ).rejects.toMatchObject({ code: 'ATTENDANCE_CORRECTION_APPROVE_FORBIDDEN', statusCode: 403 });

      const subjectDecision = {
        ...fixture.employeeContext,
        permissions: [
          ...fixture.employeeContext.permissions,
          { code: 'attendance.corrections.approve', scopePolicy: 'AGENCY' as const },
        ],
      };
      await expect(
        services.corrections.approve(subjectDecision, created.correction.id, 'Subject approval.'),
      ).rejects.toMatchObject({
        code: 'ATTENDANCE_CORRECTION_SEPARATION_REQUIRED',
        statusCode: 403,
      });

      const ownList = await services.corrections.list(fixture.employeeContext);
      expect(ownList.map((item) => item.id)).toEqual([created.correction.id]);

      const foreignAgency = await foreign.agency.create({
        data: {
          code: `ACOR-FOREIGN-${fixture.suffix}`,
          name: 'Foreign Correction Agency',
          agencyType: 'NGA',
          status: 'ACTIVE',
        },
      });
      const foreignUser = await createUser(foreign, fixture.suffix, 'foreign');
      const foreignMembership = await foreign.agencyMembership.create({
        data: { agencyId: foreignAgency.id, userId: foreignUser.id, status: 'ACTIVE' },
      });
      const foreignContext: RequestContext = {
        requestId: `attendance-correction-${fixture.suffix}-foreign`,
        userId: foreignUser.id,
        agencyId: foreignAgency.id,
        membershipId: foreignMembership.id,
        primaryOrganizationUnitId: null,
        permissions: agencyAdminPermissions,
      };
      await expect(
        services.corrections.findById(foreignContext, created.correction.id),
      ).rejects.toMatchObject({ code: 'ATTENDANCE_CORRECTION_NOT_FOUND', statusCode: 404 });
      await foreign.agencyMembership.delete({ where: { id: foreignMembership.id } });
      await foreign.agency.delete({ where: { id: foreignAgency.id } });
      await foreign.user.delete({ where: { id: foreignUser.id } });
    } finally {
      await cleanupAgency(admin, fixture.agencyId, fixture.suffix);
      await admin.$disconnect();
      await foreign.$disconnect();
    }
  },
);

it.skipIf(!enabled)(
  'moves a corrected fact across an Attendance Period boundary and recalcs both sides',
  async () => {
    const fixture = await createFixture();
    const { admin, services } = fixture;
    try {
      let nextDate = fixture.workDate;
      do {
        const date = new Date(`${nextDate}T00:00:00.000Z`);
        date.setUTCDate(date.getUTCDate() + 1);
        nextDate = date.toISOString().slice(0, 10);
      } while ([0, 6].includes(new Date(`${nextDate}T00:00:00.000Z`).getUTCDay()));

      const second = await services.days.calculate(fixture.context, {
        periodCode: 'XP-2026-02',
        dateFrom: nextDate,
        dateTo: nextDate,
        employeeIds: [fixture.employeeId],
      });
      expect(second.period.id).not.toBe(fixture.periodId);
      const firstDayId = fixture.attendanceDayId;
      const secondDayId = second.days[0]!.attendanceDayId!;

      const documentVersionId = await evidence(admin, fixture);
      const created = await services.corrections.create(fixture.employeeContext, {
        targetType: 'ATTENDANCE_EVENT',
        requestedAction: 'REPLACE',
        targetId: fixture.eventIds.TIME_OUT,
        requestedRecord: {
          eventType: 'TIME_OUT',
          eventTime: manilaInstant(nextDate, '09:00').toISOString(),
        },
        reason: 'The clock-out was filed against the wrong Work Date.',
        evidence: [{ documentVersionId }],
      });
      const previewedDates = created.impactPreview.days.map((day) => day.workDate).sort();
      expect(previewedDates).toEqual([fixture.workDate, nextDate].sort());
      expect(created.impactPreview.periods).toHaveLength(2);
      expect(created.impactPreview.targetWorkDates).toEqual([fixture.workDate]);
      expect(created.impactPreview.proposedWorkDates).toEqual([nextDate]);

      await services.corrections.submit(fixture.employeeContext, created.correction.id);
      const applied = await services.corrections.approve(
        fixture.approverContext,
        created.correction.id,
        'Both sides of the boundary were reviewed.',
      );
      expect(applied.correction.status).toBe('APPLIED');

      const firstCurrent = await admin.attendanceDay.findFirstOrThrow({
        where: {
          agencyId: fixture.agencyId,
          employeeId: fixture.employeeId,
          workDate: new Date(`${fixture.workDate}T00:00:00.000Z`),
          isCurrent: true,
        },
      });
      const secondCurrent = await admin.attendanceDay.findFirstOrThrow({
        where: {
          agencyId: fixture.agencyId,
          employeeId: fixture.employeeId,
          workDate: new Date(`${nextDate}T00:00:00.000Z`),
          isCurrent: true,
        },
      });
      expect(firstCurrent.id).not.toBe(firstDayId);
      expect(firstCurrent.calculationVersion).toBe(2);
      expect(secondCurrent.id).not.toBe(secondDayId);
      expect(secondCurrent.calculationVersion).toBe(2);
      expect(secondCurrent.ruleSnapshot).toBeTruthy();
    } finally {
      await cleanupAgency(admin, fixture.agencyId, fixture.suffix);
      await admin.$disconnect();
    }
  },
);
