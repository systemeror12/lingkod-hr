import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { finalizeAttendancePeriod } from '../attendance-test-fixtures';
import { AttendancePostedLeaveInputsService } from '../attendance-posted-leave-inputs/attendance-posted-leave-inputs.service';
import { attendanceContextAuditWriter } from '../attendance-contexts/attendance-contexts.audit';
import { AttendanceContextsService } from '../attendance-contexts/attendance-contexts.service';
import { attendanceDayAuditWriter } from '../attendance-days/attendance-days.audit';
import { AttendanceDaysService } from '../attendance-days/attendance-days.service';
import { attendanceAuditWriter } from '../attendance/attendance.audit';
import { AttendanceService } from '../attendance/attendance.service';
import { attendanceCorrectionAuditWriter } from '../attendance-corrections/attendance-corrections.audit';
import { AttendanceCorrectionsService } from '../attendance-corrections/attendance-corrections.service';
import { ATTENDANCE_CORRECTION_POSTED_LEAVE_ROUTE_CODE } from '../attendance-corrections/attendance-corrections.types';
import { attendancePeriodAuditWriter } from '../attendance-periods/attendance-periods.audit';
import { attendanceSubmissionAuditWriter } from '../attendance-submissions/attendance-submissions.audit';
import { AttendanceSubmissionsService } from '../attendance-submissions/attendance-submissions.service';
import { AttendancePeriodsService } from '../attendance-periods/attendance-periods.service';
import { dtrAuditWriter } from '../dtrs/dtrs.audit';
import { DtrsService } from '../dtrs/dtrs.service';
import { expect, it } from 'vitest';
import {
  approvalAuditWriter,
  ApprovalCompletionRegistry,
  ApprovalsService,
} from '../approvals/approval.service';
import { attendanceConfigurationAuditWriter } from '../attendance-configuration/attendance-configuration.audit';
import { HolidayCalendarsService } from '../attendance-configuration/holiday-calendars.service';
import { ScheduleAssignmentsService } from '../attendance-configuration/schedule-assignments.service';
import { WorkArrangementsService } from '../attendance-configuration/work-arrangements.service';
import { WorkSchedulesService } from '../attendance-configuration/work-schedules.service';
import { documentAuditWriter, DocumentsService } from '../documents/documents.service';
import {
  leaveAccountAuditWriter,
  LeaveAccountsService,
} from '../leave-accounts/leave-accounts.service';
import {
  leavePolicyAuditWriter,
  LeavePoliciesService,
} from '../leave-policies/leave-policies.service';
import { LeaveApplicationsController } from './leave-applications.controller';
import {
  LEAVE_CANCELLATION_ROUTE_CODE,
  leaveApplicationAuditWriter,
  LeaveApplicationsService,
} from './leave-applications.service';
import {
  mandatoryLeaveAssessmentAuditWriter,
  MandatoryLeaveAssessmentsService,
} from '../mandatory-leave-assessments/mandatory-leave-assessments.service';

const enabled = process.env.DATABASE_E2E === 'true';

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

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function nextMonday(offsetDays: number): string {
  let value = manilaDate(offsetDays);
  while (new Date(`${value}T00:00:00.000Z`).getUTCDay() !== 1) {
    value = addDays(value, 1);
  }
  return value;
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

function context(
  agencyId: string,
  userId: string,
  membershipId: string,
  permissions: RequestContext['permissions'],
): RequestContext {
  return {
    requestId: 'leave-application-integration-test',
    userId,
    agencyId,
    membershipId,
    primaryOrganizationUnitId: null,
    permissions,
  };
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
      documentType: 'LEAVE_EVIDENCE',
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
      storageKey: `leave-application-integration/${suffix}`,
      contentHash: 'e'.repeat(64),
      mimeType: 'application/pdf',
      sizeBytes: 1,
      issuedAt: new Date(`${manilaDate(-30)}T00:00:00.000Z`),
      createdByMembershipId: membershipId,
    },
  });
  await admin.document.update({
    where: { id: document.id },
    data: { currentVersionId: version.id },
  });
  return { documentId: document.id, versionId: version.id };
}

it.skipIf(!enabled)(
  'prepares, reviews, cancels, and atomically posts Leave Applications under RLS',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-leave-application`;
    const agency = await admin.agency.create({
      data: {
        code: `LAPP-${suffix}`,
        name: 'Leave Application Integration Agency',
        agencyType: 'NGA',
        status: 'ACTIVE',
      },
    });
    const foreignAgency = await admin.agency.create({
      data: {
        code: `LAPP-F-${suffix}`,
        name: 'Foreign Leave Application Agency',
        agencyType: 'NGA',
        status: 'ACTIVE',
      },
    });
    const user = await admin.user.create({
      data: {
        emailNormalized: `leave-application-${suffix}@example.test`,
        displayName: 'Leave Application Employee',
        globalStatus: 'ACTIVE',
      },
    });
    const recorderUser = await admin.user.create({
      data: {
        emailNormalized: `leave-recorder-${suffix}@example.test`,
        displayName: 'Leave Application Recorder',
        globalStatus: 'ACTIVE',
      },
    });
    const foreignUser = await admin.user.create({
      data: {
        emailNormalized: `foreign-leave-application-${suffix}@example.test`,
        displayName: 'Foreign Leave Application Custodian',
        globalStatus: 'ACTIVE',
      },
    });
    const supervisorUser = await admin.user.create({
      data: {
        emailNormalized: `leave-supervisor-${suffix}@example.test`,
        displayName: 'Leave Application Supervisor',
        globalStatus: 'ACTIVE',
      },
    });
    const approverUser = await admin.user.create({
      data: {
        emailNormalized: `leave-approver-${suffix}@example.test`,
        displayName: 'Leave Application Approver',
        globalStatus: 'ACTIVE',
      },
    });
    const authorizerUser = await admin.user.create({
      data: {
        emailNormalized: `leave-attendance-authorizer-${suffix}@example.test`,
        displayName: 'Locked Attendance Authorizer',
        globalStatus: 'ACTIVE',
      },
    });
    const agencyIds = [agency.id, foreignAgency.id];
    const membership = await admin.agencyMembership.create({
      data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
    });
    const recorderMembership = await admin.agencyMembership.create({
      data: { agencyId: agency.id, userId: recorderUser.id, status: 'ACTIVE' },
    });
    const supervisorMembership = await admin.agencyMembership.create({
      data: { agencyId: agency.id, userId: supervisorUser.id, status: 'ACTIVE' },
    });
    const approverMembership = await admin.agencyMembership.create({
      data: { agencyId: agency.id, userId: approverUser.id, status: 'ACTIVE' },
    });
    const authorizerMembership = await admin.agencyMembership.create({
      data: { agencyId: agency.id, userId: authorizerUser.id, status: 'ACTIVE' },
    });
    const foreignMembership = await admin.agencyMembership.create({
      data: { agencyId: foreignAgency.id, userId: foreignUser.id, status: 'ACTIVE' },
    });
    const approverRole = await admin.role.findFirstOrThrow({
      where: { agencyId: null, code: 'hrmo_administrator' },
    });
    await admin.membershipRole.create({
      data: {
        agencyId: agency.id,
        membershipId: recorderMembership.id,
        roleId: approverRole.id,
        effectiveFrom: new Date('2020-01-01'),
      },
    });
    await admin.membershipRole.createMany({
      data: [supervisorMembership, approverMembership, authorizerMembership].map((target) => ({
        agencyId: agency.id,
        membershipId: target.id,
        roleId: approverRole.id,
        effectiveFrom: new Date('2020-01-01'),
      })),
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
        employeeNumber: `EMP-${suffix}`,
        legalName: 'Ana Reyes',
        birthDate: new Date('1990-01-01'),
        sex: 'FEMALE',
        civilStatus: 'SINGLE',
        contactEmail: `employee-${suffix}@example.test`,
        serviceStatus: 'ACTIVE',
        createdByMembershipId: membership.id,
        updatedByMembershipId: membership.id,
      },
    });
    await withDatabaseContext(
      {
        agencyId: agency.id,
        userId: user.id,
        membershipId: membership.id,
        capabilities: ['employee-membership-link'],
      },
      (transaction) =>
        transaction.agencyMembership.update({
          where: { agencyId_id: { agencyId: agency.id, id: membership.id } },
          data: { employeeId: employee.id },
        }),
    );
    await withDatabaseContext(
      {
        agencyId: agency.id,
        membershipId: membership.id,
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
            createdByMembershipId: membership.id,
          },
        }),
    );

    const documents = new DocumentsService({} as never, documentAuditWriter);
    const schedules = new WorkSchedulesService(attendanceConfigurationAuditWriter, documents);
    const arrangements = new WorkArrangementsService(attendanceConfigurationAuditWriter, documents);
    const calendars = new HolidayCalendarsService(attendanceConfigurationAuditWriter, documents);
    const completionRegistry = new ApprovalCompletionRegistry();
    const assignments = new ScheduleAssignmentsService(
      attendanceConfigurationAuditWriter,
      documents,
      schedules,
      arrangements,
      calendars,
    );
    const approvals = new ApprovalsService(approvalAuditWriter, completionRegistry);
    const policies = new LeavePoliciesService(
      leavePolicyAuditWriter,
      documents,
      new MandatoryLeaveAssessmentsService(mandatoryLeaveAssessmentAuditWriter),
    );
    const accounts = new LeaveAccountsService(
      leaveAccountAuditWriter,
      documents,
      new MandatoryLeaveAssessmentsService(mandatoryLeaveAssessmentAuditWriter),
    );
    const postedLeaveInputs = new AttendancePostedLeaveInputsService();
    const attendance = new AttendanceService(attendanceAuditWriter, assignments);
    const attendanceDays = new AttendanceDaysService(
      attendanceDayAuditWriter,
      assignments,
      attendance,
      new AttendanceContextsService(attendanceContextAuditWriter, documents, attendance),
      postedLeaveInputs,
    );
    const dtrs = new DtrsService(dtrAuditWriter, documents);
    const attendanceSubmissions = new AttendanceSubmissionsService(
      attendanceSubmissionAuditWriter,
      documents,
      attendanceDays,
    );
    const attendancePeriods = new AttendancePeriodsService(
      attendancePeriodAuditWriter,
      approvals,
      dtrs,
      attendanceDays,
    );
    const attendanceCorrections = new AttendanceCorrectionsService(
      attendanceCorrectionAuditWriter,
      approvals,
      completionRegistry,
      attendanceDays,
      attendance,
      documents,
      dtrs,
      attendancePeriods,
    );
    attendanceCorrections.onModuleInit();
    const applications = new LeaveApplicationsService(
      leaveApplicationAuditWriter,
      documents,
      approvals,
      completionRegistry,
      schedules,
      arrangements,
      calendars,
      postedLeaveInputs,
      attendanceCorrections,
      new MandatoryLeaveAssessmentsService(mandatoryLeaveAssessmentAuditWriter),
    );
    applications.onModuleInit();
    const applicationApi = new LeaveApplicationsController(applications);

    const agencyContext = context(agency.id, user.id, membership.id, [
      { code: 'attendance.configuration.read', scopePolicy: 'AGENCY' },
      { code: 'attendance.configuration.manage', scopePolicy: 'AGENCY' },
      { code: 'attendance.configuration.activate', scopePolicy: 'AGENCY' },
      { code: 'attendance.assignments.manage', scopePolicy: 'AGENCY' },
      { code: 'documents.evidence.read', scopePolicy: 'AGENCY' },
      { code: 'leave.types.read', scopePolicy: 'AGENCY' },
      { code: 'leave.types.manage', scopePolicy: 'AGENCY' },
      { code: 'leave.accounts.read', scopePolicy: 'AGENCY' },
      { code: 'leave.credits.adjust', scopePolicy: 'AGENCY' },
      { code: 'approvals.routes.read', scopePolicy: 'AGENCY' },
      { code: 'approvals.routes.create', scopePolicy: 'AGENCY' },
      { code: 'approvals.routes.activate', scopePolicy: 'AGENCY' },
      { code: 'approvals.requests.read', scopePolicy: 'AGENCY' },
      { code: 'leave.applications.create', scopePolicy: 'AGENCY' },
      { code: 'leave.applications.submit', scopePolicy: 'AGENCY' },
      { code: 'leave.applications.withdraw', scopePolicy: 'AGENCY' },
    ]);
    const employeeContext = context(agency.id, user.id, membership.id, [
      { code: 'leave.applications.create', scopePolicy: 'OWN' },
      { code: 'leave.applications.submit', scopePolicy: 'OWN' },
      { code: 'leave.applications.withdraw', scopePolicy: 'OWN' },
      { code: 'approvals.routes.read', scopePolicy: 'OWN' },
      { code: 'approvals.requests.create', scopePolicy: 'OWN' },
      { code: 'approvals.requests.cancel', scopePolicy: 'OWN' },
    ]);
    const recorderContext = context(agency.id, recorderUser.id, recorderMembership.id, [
      { code: 'documents.evidence.read', scopePolicy: 'AGENCY' },
      { code: 'approvals.routes.read', scopePolicy: 'AGENCY' },
      { code: 'approvals.requests.create', scopePolicy: 'AGENCY' },
      { code: 'approvals.requests.cancel', scopePolicy: 'AGENCY' },
      { code: 'leave.applications.create', scopePolicy: 'AGENCY' },
      { code: 'leave.applications.submit', scopePolicy: 'AGENCY' },
      { code: 'leave.applications.withdraw', scopePolicy: 'AGENCY' },
      { code: 'leave.applications.route', scopePolicy: 'AGENCY' },
      { code: 'leave.credits.certify', scopePolicy: 'AGENCY' },
    ]);
    const supervisorContext = context(agency.id, supervisorUser.id, supervisorMembership.id, [
      { code: 'approvals.requests.read', scopePolicy: 'AGENCY' },
      { code: 'leave.applications.recommend', scopePolicy: 'AGENCY' },
    ]);
    const approverContext = context(agency.id, approverUser.id, approverMembership.id, [
      { code: 'approvals.requests.read', scopePolicy: 'AGENCY' },
      { code: 'leave.applications.approve', scopePolicy: 'AGENCY' },
      { code: 'leave.applications.reject', scopePolicy: 'AGENCY' },
    ]);
    const foreignContext = context(foreignAgency.id, foreignUser.id, foreignMembership.id, [
      { code: 'leave.applications.create', scopePolicy: 'AGENCY' },
      { code: 'leave.applications.submit', scopePolicy: 'AGENCY' },
      { code: 'leave.applications.withdraw', scopePolicy: 'AGENCY' },
      { code: 'approvals.routes.read', scopePolicy: 'AGENCY' },
      { code: 'approvals.requests.create', scopePolicy: 'AGENCY' },
    ]);

    try {
      const nationalEvidence = await createEvidence(
        admin,
        agency.id,
        membership.id,
        `${suffix}-national`,
      );
      const accountEvidence = await createEvidence(
        admin,
        agency.id,
        membership.id,
        `${suffix}-account`,
      );
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
      );
      const calendarEvidence = await createEvidence(
        admin,
        agency.id,
        membership.id,
        `${suffix}-calendar`,
      );
      const assignmentEvidence = await createEvidence(
        admin,
        agency.id,
        membership.id,
        `${suffix}-assignment`,
      );
      const formEvidence = await createEvidence(admin, agency.id, membership.id, `${suffix}-form`);
      const templateEvidence = await createEvidence(
        admin,
        agency.id,
        membership.id,
        `${suffix}-template`,
      );
      const signedEvidence = await createEvidence(
        admin,
        agency.id,
        membership.id,
        `${suffix}-signed`,
      );

      const effectiveFrom = manilaDate(-30);
      const calendar = await calendars.create(agencyContext, {
        code: `PH-${suffix}`,
        name: 'Agency Holiday Calendar',
        scopeType: 'AGENCY',
        scopeReference: 'Agency-wide',
        effectiveDate: effectiveFrom,
        entries: [
          {
            holidayDate: manilaDate(-2),
            name: 'Agency Work Suspension',
            dayType: 'WORK_SUSPENSION',
            sourceReference: 'Memorandum Circular No. 1',
          },
          {
            holidayDate: manilaDate(-1),
            name: 'Special Non-Working Day',
            dayType: 'SPECIAL_NON_WORKING',
            sourceReference: 'Proclamation No. 45',
          },
        ],
      });
      const calendarActive = await calendars.activate(
        agencyContext,
        calendar.id,
        calendar.draft!.id,
        {
          authorityDocumentVersionId: calendarEvidence.versionId,
          approvingAuthority: 'Office of the President',
          reason: 'Holiday calendar reviewed.',
        },
      );
      expect(calendarActive.currentVersion?.versionState).toBe('ACTIVE');

      const schedule = await schedules.create(agencyContext, {
        code: `ORD-${suffix}`,
        name: 'Ordinary Work Schedule',
        scheduleType: 'REGULAR',
        effectiveDate: effectiveFrom,
        dayRules: dayRules(),
      });
      const scheduleActive = await schedules.activate(
        agencyContext,
        schedule.id,
        schedule.draft!.id,
        {
          authorityDocumentVersionId: scheduleEvidence.versionId,
          approvingAuthority: 'Office of the President',
          reason: 'Schedule authority reviewed.',
        },
      );
      const scheduleVersionId = scheduleActive.currentVersion?.id;
      if (!scheduleVersionId) throw new Error('The Work Schedule Version was not activated.');

      const arrangement = await arrangements.create(agencyContext, {
        code: `ONSITE-${suffix}`,
        name: 'Onsite Work Arrangement',
        arrangementType: 'ONSITE',
        permittedScheduleTypes: ['REGULAR'],
        holidayCalendarId: calendar.id,
        effectiveDate: effectiveFrom,
      });
      const arrangementActive = await arrangements.activate(
        agencyContext,
        arrangement.id,
        arrangement.draft!.id,
        {
          authorityDocumentVersionId: arrangementEvidence.versionId,
          approvingAuthority: 'Office of the President',
          reason: 'Arrangement authority reviewed.',
        },
      );
      const arrangementVersionId = arrangementActive.currentVersion?.id;
      if (!arrangementVersionId) {
        throw new Error('The Work Arrangement Version was not activated.');
      }

      const assignment = await assignments.create(
        agencyContext,
        {
          employeeId: employee.id,
          workScheduleVersionId: scheduleVersionId,
          workArrangementVersionId: arrangementVersionId,
          authorityDocumentVersionId: assignmentEvidence.versionId,
          effectiveFrom,
        },
        `assignment-${suffix}`,
      );
      expect(assignment.effectiveTo).toBeNull();

      const vacation = await policies.create(agencyContext, { catalogueCode: 'VACATION_LEAVE' });
      const routeCode = `LEAVE-ROUTE-${suffix}`;
      const policyVersion = await policies.createPolicyVersion(agencyContext, vacation.id, {
        effectiveDate: manilaDate(-10),
        approvalRouteCode: routeCode,
        applicability: { profiles: ['ORDINARY_CIVILIAN_NGA'] },
        documentRequirements: {},
        reason: 'Adopt the vacation leave policy for the integration test.',
      });
      await policies.linkAuthority(agencyContext, vacation.id, policyVersion.id, {
        authorityClass: 'NATIONAL_RULE',
        documentId: nationalEvidence.documentId,
        citation: 'Rule XVI, sections 1-3',
      });
      await policies.activate(
        agencyContext,
        vacation.id,
        policyVersion.id,
        'Activate vacation leave.',
      );

      const route = await approvals.createRoute(agencyContext, {
        routeCode,
        domain: 'LEAVE',
        versionNo: 1,
        effectiveFrom,
        stepDefinition: {
          steps: [
            {
              stepNo: 1,
              stepMode: 'SEQUENTIAL',
              requiredPermission: 'approvals.requests.approve',
              assignment: { kind: 'MEMBERSHIP', membershipId: recorderMembership.id },
              requiresSeparateReview: false,
            },
          ],
        },
      });
      await approvals.activateRoute(agencyContext, route.id, 'Activate the leave approval route.');

      const account = await accounts.open(
        agencyContext,
        {
          employeeId: employee.id,
          leaveTypeId: vacation.id,
          effectiveDate: manilaDate(-5),
          openingQuantity: 10,
          evidenceDocumentId: accountEvidence.documentId,
          reason: 'Opening balance carried from the service record.',
        },
        `open-account-${suffix}`,
      );
      expect(account.balances.availableQuantity).toBe('10.0000');

      const monday = nextMonday(1);
      const wednesday = addDays(monday, 2);
      const periodInput = [{ dateFrom: monday, dateTo: wednesday }];

      const created = await applications.create(
        agencyContext,
        { employeeId: employee.id, leaveTypeId: vacation.id },
        `create-${suffix}`,
      );
      const applicationId = created.application.id;
      expect(created.application.status).toBe('DRAFT');
      expect(created.application.employeeId).toBe(employee.id);

      const drafted = await applications.update(agencyContext, applicationId, {
        reason: 'Rest and recreation with family.',
        commutationChoice: 'NOT_REQUESTED',
        periods: periodInput,
      });
      expect(drafted.draftPeriods).toHaveLength(1);

      const missingEvidence = await applications.preview(employeeContext, applicationId);
      expect(missingEvidence.result).toBe('INDETERMINATE');
      expect(missingEvidence.missingFacts.map(({ fact }) => fact)).toContain(
        'MISSING_EVIDENCE:SIGNED_LEAVE_APPLICATION_FORM',
      );

      const submitInput = {
        formTemplateDocumentVersionId: templateEvidence.versionId,
        attestation: { type: 'AUTHENTICATED_SUBMISSION' as const },
      };
      await expect(
        applications.submit(employeeContext, applicationId, submitInput, `submit-${suffix}-early`),
      ).rejects.toMatchObject({
        code: 'LEAVE_APPLICATION_NOT_ELIGIBLE',
        statusCode: 400,
        reasons: ['MISSING_EVIDENCE:SIGNED_LEAVE_APPLICATION_FORM'],
      });
      await expect(
        admin.leaveApplicationVersion.count({
          where: { agencyId: agency.id, leaveApplicationId: applicationId },
        }),
      ).resolves.toBe(0);
      await expect(
        admin.approvalRequest.count({ where: { agencyId: agency.id, subjectId: applicationId } }),
      ).resolves.toBe(0);

      const withEvidence = await applications.update(agencyContext, applicationId, {
        documents: [
          { documentId: formEvidence.documentId, purposeCode: 'SIGNED_LEAVE_APPLICATION_FORM' },
        ],
      });
      expect(withEvidence.draftDocuments).toHaveLength(1);

      const preview = await applications.preview(employeeContext, applicationId);
      expect(preview.result).toBe('ELIGIBLE');
      expect(preview.requestedQuantity).toBe(3);
      expect(preview.requestedUnit).toBe('WORKING_DAY');
      expect(preview.segments).toHaveLength(1);
      expect(preview.segments[0]).toMatchObject({
        dateFrom: monday,
        dateTo: wednesday,
        requestedQuantity: 3,
      });

      await withDatabaseContext(
        {
          agencyId: agency.id,
          membershipId: membership.id,
          capabilities: ['personnel-baseline-transition'],
        },
        async (transaction) => {
          await transaction.serviceSegment.updateMany({
            where: { agencyId: agency.id, employeeId: employee.id, status: 'ACTIVE' },
            data: { status: 'CLOSED', effectiveTo: new Date(wednesday) },
          });
          await transaction.serviceSegment.create({
            data: {
              agencyId: agency.id,
              employeeId: employee.id,
              organizationUnitId: unit.id,
              appointmentStatus: 'PERMANENT',
              salaryGrade: 18,
              salaryStep: 3,
              effectiveFrom: new Date(addDays(wednesday, 1)),
              status: 'ACTIVE',
              createdByMembershipId: membership.id,
            },
          });
        },
      );
      const afterSupersession = await applications.preview(employeeContext, applicationId);
      expect(afterSupersession.result).toBe('ELIGIBLE');
      expect(afterSupersession.missingFacts.map(({ fact }) => fact)).not.toContain(
        'MISSING_SERVICE',
      );

      await expect(
        applications.submit(
          recorderContext,
          applicationId,
          submitInput,
          `submit-${suffix}-recorder`,
        ),
      ).rejects.toMatchObject({
        code: 'LEAVE_APPLICATION_ATTESTATION_FORBIDDEN',
        statusCode: 403,
      });

      const submitted = await applications.submit(
        employeeContext,
        applicationId,
        submitInput,
        `submit-${suffix}`,
      );
      expect(submitted.application.status).toBe('SUBMITTED');
      const version = submitted.versions.at(-1)!;
      expect(version.versionNo).toBe(1);
      expect(version.attestationType).toBe('AUTHENTICATED_SUBMISSION');
      expect(version.submissionMethod).toBe('SELF_SERVICE_AUTHENTICATED');
      expect(version.attestationDocumentVersionId).toBeNull();
      expect(version.employeeAttestedAt).not.toBeNull();
      expect(version.approvalRequestStatus).toBe('PENDING');
      expect(version.periods).toEqual([
        expect.objectContaining({ dateFrom: monday, dateTo: wednesday }),
      ]);
      expect(version.documents.map(({ purposeCode }) => purposeCode).sort()).toEqual([
        'RENDERED_FORM',
        'SIGNED_LEAVE_APPLICATION_FORM',
      ]);
      expect(version.assessments).toHaveLength(1);
      expect(version.assessments[0]).toMatchObject({ result: 'ELIGIBLE', assessmentNo: 1 });
      expect(version.calculationSegments).toHaveLength(1);
      expect(Number(version.calculationSegments[0]!.requestedQuantity)).toBe(3);
      expect(version.calculationSegments[0]!.requestedUnit).toBe('WORKING_DAY');

      const replay = await applications.submit(
        employeeContext,
        applicationId,
        submitInput,
        `submit-${suffix}`,
      );
      expect(replay.versions).toHaveLength(1);
      expect(replay.versions.at(-1)!.id).toBe(version.id);

      await expect(
        applications.submit(employeeContext, applicationId, submitInput, `submit-${suffix}-second`),
      ).rejects.toMatchObject({ code: 'LEAVE_APPLICATION_WORKFLOW_INVALID', statusCode: 409 });

      const appended = await applications.appendDocument(agencyContext, applicationId, {
        documentId: signedEvidence.documentId,
        purposeCode: 'SIGNED_FORM',
      });
      const appendedVersion = appended.versions.at(-1)!;
      expect(appendedVersion.id).toBe(version.id);
      expect(appendedVersion.documents.map(({ purposeCode }) => purposeCode).sort()).toEqual([
        'RENDERED_FORM',
        'SIGNED_FORM',
        'SIGNED_LEAVE_APPLICATION_FORM',
      ]);

      const ownList = await applications.list(employeeContext);
      expect(ownList.map(({ id }) => id)).toContain(applicationId);
      const agencyList = await applications.list(agencyContext, { status: 'SUBMITTED' });
      expect(agencyList.map(({ id }) => id)).toContain(applicationId);
      await expect(applications.findById(foreignContext, applicationId)).resolves.toBeNull();
      await expect(applications.preview(foreignContext, applicationId)).rejects.toMatchObject({
        code: 'LEAVE_APPLICATION_NOT_FOUND',
        statusCode: 404,
      });

      await expect(
        applications.withdraw(recorderContext, applicationId, {
          reason: 'Employee called to cancel the trip.',
        }),
      ).rejects.toMatchObject({
        code: 'LEAVE_APPLICATION_WITHDRAWAL_EVIDENCE_REQUIRED',
        statusCode: 400,
      });

      const withdrawn = await applications.withdraw(
        employeeContext,
        applicationId,
        { reason: 'The trip was cancelled by the employee.' },
        `withdraw-${suffix}`,
      );
      expect(withdrawn.application.status).toBe('WITHDRAWN');
      const withdrawnVersion = withdrawn.versions.at(-1)!;
      expect(withdrawnVersion.id).toBe(version.id);
      expect(withdrawnVersion.approvalRequestStatus).toBe('CANCELLED');
      await expect(
        admin.leaveApplicationVersion.count({
          where: { agencyId: agency.id, leaveApplicationId: applicationId },
        }),
      ).resolves.toBe(1);
      await expect(
        admin.auditEvent.count({
          where: {
            agencyId: agency.id,
            action: 'LEAVE_APPLICATION_SUBMITTED',
            entityId: applicationId,
          },
        }),
      ).resolves.toBe(1);
      await expect(
        admin.auditEvent.count({
          where: {
            agencyId: agency.id,
            action: 'LEAVE_APPLICATION_WITHDRAWN',
            entityId: applicationId,
          },
        }),
      ).resolves.toBe(1);

      const signedApplication = await applications.create(
        agencyContext,
        { employeeId: employee.id, leaveTypeId: vacation.id },
        `create-signed-${suffix}`,
      );
      const signedApplicationId = signedApplication.application.id;
      await applications.update(agencyContext, signedApplicationId, {
        periods: periodInput,
        documents: [
          { documentId: formEvidence.documentId, purposeCode: 'SIGNED_LEAVE_APPLICATION_FORM' },
        ],
      });
      const signedInput = {
        formTemplateDocumentVersionId: templateEvidence.versionId,
        attestation: {
          type: 'SIGNED_DOCUMENT' as const,
          documentId: signedEvidence.documentId,
          receivedAt: new Date().toISOString(),
        },
      };
      const signedResults = await Promise.allSettled([
        applications.submit(
          recorderContext,
          signedApplicationId,
          signedInput,
          `signed-${suffix}-a`,
        ),
        applications.submit(
          recorderContext,
          signedApplicationId,
          signedInput,
          `signed-${suffix}-b`,
        ),
      ]);
      const fulfilled = signedResults.filter(
        (
          result,
        ): result is PromiseFulfilledResult<Awaited<ReturnType<typeof applications.submit>>> =>
          result.status === 'fulfilled',
      );
      const rejected = signedResults.filter(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]!.reason).toMatchObject({
        code: 'LEAVE_APPLICATION_WORKFLOW_INVALID',
        statusCode: 409,
      });
      const signedVersion = fulfilled[0]!.value.versions.at(-1)!;
      expect(signedVersion.versionNo).toBe(1);
      expect(signedVersion.attestationType).toBe('SIGNED_DOCUMENT');
      expect(signedVersion.submissionMethod).toBe('ADMIN_RECORDED_SIGNED_FORM');
      expect(signedVersion.attestationDocumentVersionId).toBe(signedEvidence.versionId);
      expect(signedVersion.employeeAttestedAt).toBeNull();
      expect(signedVersion.documents.map(({ purposeCode }) => purposeCode).sort()).toEqual([
        'RENDERED_FORM',
        'SIGNED_FORM',
        'SIGNED_LEAVE_APPLICATION_FORM',
      ]);

      const recorded = await applications.withdraw(
        recorderContext,
        signedApplicationId,
        {
          reason: 'The signed form was withdrawn by the employee.',
          evidenceDocumentId: accountEvidence.documentId,
        },
        `withdraw-signed-${suffix}`,
      );
      expect(recorded.application.status).toBe('WITHDRAWN');
      expect(
        recorded.versions
          .at(-1)!
          .documents.map(({ purposeCode }) => purposeCode)
          .sort(),
      ).toEqual([
        'RENDERED_FORM',
        'SIGNED_FORM',
        'SIGNED_LEAVE_APPLICATION_FORM',
        'WITHDRAWAL_EVIDENCE',
      ]);

      // Certification, recommendation, and a partial approval under a three-step route.
      const specialLeave = await policies.create(agencyContext, {
        catalogueCode: 'SPECIAL_PRIVILEGE_LEAVE',
      });
      const reviewRouteCode = `LEAVE-REVIEW-ROUTE-${suffix}`;
      const reviewPolicyVersion = await policies.createPolicyVersion(
        agencyContext,
        specialLeave.id,
        {
          effectiveDate: manilaDate(-10),
          approvalRouteCode: reviewRouteCode,
          applicability: { profiles: ['ORDINARY_CIVILIAN_NGA'] },
          documentRequirements: {},
          reason: 'Adopt the special privilege leave policy for the review test.',
        },
      );
      await policies.linkAuthority(agencyContext, specialLeave.id, reviewPolicyVersion.id, {
        authorityClass: 'NATIONAL_RULE',
        documentId: nationalEvidence.documentId,
        citation: 'Rule XVI, section 5',
      });
      await policies.activate(
        agencyContext,
        specialLeave.id,
        reviewPolicyVersion.id,
        'Activate special privilege leave.',
      );
      const reviewRoute = await approvals.createRoute(agencyContext, {
        routeCode: reviewRouteCode,
        domain: 'LEAVE',
        versionNo: 1,
        effectiveFrom,
        stepDefinition: {
          steps: [
            {
              stepNo: 1,
              stepMode: 'SEQUENTIAL',
              requiredPermission: 'leave.credits.certify',
              assignment: { kind: 'MEMBERSHIP', membershipId: recorderMembership.id },
              requiresSeparateReview: true,
            },
            {
              stepNo: 2,
              stepMode: 'SEQUENTIAL',
              requiredPermission: 'leave.applications.recommend',
              assignment: { kind: 'MEMBERSHIP', membershipId: supervisorMembership.id },
              requiresSeparateReview: true,
            },
            {
              stepNo: 3,
              stepMode: 'SEQUENTIAL',
              requiredPermission: 'leave.applications.approve',
              assignment: { kind: 'MEMBERSHIP', membershipId: approverMembership.id },
              requiresSeparateReview: true,
            },
          ],
        },
      });
      await approvals.activateRoute(
        agencyContext,
        reviewRoute.id,
        'Activate the three-step leave review route.',
      );
      const specialAccount = await accounts.open(
        agencyContext,
        {
          employeeId: employee.id,
          leaveTypeId: specialLeave.id,
          effectiveDate: manilaDate(-5),
          openingQuantity: 5,
          evidenceDocumentId: accountEvidence.documentId,
          reason: 'Opening special privilege leave credits.',
        },
        `open-special-${suffix}`,
      );
      expect(specialAccount.balances.availableQuantity).toBe('5.0000');

      const reviewApplication = await applications.create(
        agencyContext,
        { employeeId: employee.id, leaveTypeId: specialLeave.id },
        `create-review-${suffix}`,
      );
      const reviewApplicationId = reviewApplication.application.id;
      await applications.update(agencyContext, reviewApplicationId, {
        reason: 'Special privilege leave for the review flow.',
        commutationChoice: 'NOT_REQUESTED',
        periods: periodInput,
        documents: [
          { documentId: formEvidence.documentId, purposeCode: 'SIGNED_LEAVE_APPLICATION_FORM' },
        ],
      });
      const reviewPreview = await applications.preview(employeeContext, reviewApplicationId);
      expect(reviewPreview.result, JSON.stringify(reviewPreview.missingFacts)).toBe('ELIGIBLE');
      const reviewSubmitted = await applications.submit(
        employeeContext,
        reviewApplicationId,
        submitInput,
        `submit-review-${suffix}`,
      );
      const reviewVersion = reviewSubmitted.versions.at(-1)!;
      expect(reviewVersion.approvalRequestStatus).toBe('PENDING');

      const routed = await applications.route(
        recorderContext,
        reviewApplicationId,
        `route-${suffix}`,
      );
      expect(routed.application.status).toBe('FOR_CERTIFICATION');
      expect(routed.versions.at(-1)!.approvalRequestStatus).toBe('IN_PROGRESS');
      expect(routed.versions.at(-1)!.approvalSteps.map(({ status }) => status)).toEqual([
        'ACTIVE',
        'PENDING',
        'PENDING',
      ]);

      await expect(
        applications.certify(
          employeeContext,
          reviewApplicationId,
          {},
          `certify-${suffix}-forbidden`,
        ),
      ).rejects.toMatchObject({
        code: 'LEAVE_APPLICATION_CERTIFY_FORBIDDEN',
        statusCode: 403,
      });

      const certified = await applications.certify(
        recorderContext,
        reviewApplicationId,
        { balanceAsOf: manilaDate(0) },
        `certify-${suffix}`,
      );
      expect(certified.application.status).toBe('FOR_RECOMMENDATION');
      const certification = certified.versions.at(-1)!.certification!;
      expect(certification.certifiedByMembershipId).toBe(recorderMembership.id);
      expect(certification.lines).toHaveLength(1);
      expect(certification.lines[0]).toMatchObject({
        postedBalance: '5.0000',
        activeCommitments: '0.0000',
        applicationQuantity: '3.0000',
        availableAfterApplication: '2.0000',
      });

      const recommendation = await applications.recommend(
        supervisorContext,
        reviewApplicationId,
        { outcome: 'RECOMMEND_APPROVAL', comments: 'Within the approved schedule.' },
        `recommend-${suffix}`,
      );
      expect(recommendation.application.status).toBe('FOR_APPROVAL');
      expect(recommendation.versions.at(-1)!.recommendation).toMatchObject({
        outcome: 'RECOMMEND_APPROVAL',
      });

      const segmentId = recommendation.versions.at(-1)!.calculationSegments[0]!.id;
      expect(recommendation.versions.at(-1)!.calculationSegments[0]!.allocationKinds).toEqual([
        'LEAVE_ACCOUNT',
        'LEAVE_WITHOUT_PAY',
      ]);
      const decided = await applications.decide(
        approverContext,
        reviewApplicationId,
        {
          decision: 'APPROVE',
          comments: 'Approved two days; the unused day is released.',
          allocations: [{ segmentId, quantity: '2' }],
        },
        `decide-${suffix}`,
      );
      expect(decided.application.status).toBe('APPROVED');
      const allocation = decided.versions.at(-1)!.approvalAllocation!;
      expect(allocation.lines).toHaveLength(1);
      expect(allocation.lines[0]).toMatchObject({
        allocationKind: 'LEAVE_ACCOUNT',
        policyVersionId: reviewPolicyVersion.id,
        quantity: '2.0000',
        unitCode: 'WORKING_DAY',
      });

      const commitments = await admin.leaveCreditCommitment.findMany({
        where: {
          agencyId: agency.id,
          sourceType: 'LeaveApplicationVersion',
          sourceId: reviewVersion.id,
        },
        orderBy: { effectiveFrom: 'asc' },
      });
      expect(
        commitments.map(({ sourceCommitmentKey, status, quantity }) => ({
          sourceCommitmentKey,
          status,
          quantity: quantity.toFixed(4),
        })),
      ).toEqual([
        { sourceCommitmentKey: 'CERTIFIED', status: 'RELEASED', quantity: '3.0000' },
        { sourceCommitmentKey: 'APPROVED', status: 'ACTIVE', quantity: '2.0000' },
      ]);
      await expect(
        admin.auditEvent.count({
          where: {
            agencyId: agency.id,
            action: 'LEAVE_APPLICATION_CERTIFIED',
            entityId: reviewApplicationId,
          },
        }),
      ).resolves.toBe(1);

      // A later certification counts the commitment the earlier same-day
      // approval left active, so only the excess over certified availability
      // becomes leave without pay.
      const excessMonday = nextMonday(8);
      const excessFriday = addDays(excessMonday, 4);
      const excessApplication = await applications.create(
        agencyContext,
        { employeeId: employee.id, leaveTypeId: specialLeave.id },
        `create-excess-${suffix}`,
      );
      const excessApplicationId = excessApplication.application.id;
      await applications.update(agencyContext, excessApplicationId, {
        reason: 'Special privilege leave beyond the remaining credits.',
        commutationChoice: 'NOT_REQUESTED',
        periods: [{ dateFrom: excessMonday, dateTo: excessFriday }],
        documents: [
          { documentId: formEvidence.documentId, purposeCode: 'SIGNED_LEAVE_APPLICATION_FORM' },
        ],
      });
      const excessSubmitted = await applications.submit(
        employeeContext,
        excessApplicationId,
        submitInput,
        `submit-excess-${suffix}`,
      );
      const excessVersion = excessSubmitted.versions.at(-1)!;
      expect(excessVersion.calculationSegments[0]!.requestedQuantity).toBe('5.0000');
      await applications.route(recorderContext, excessApplicationId, `route-excess-${suffix}`);
      const excessCertified = await applications.certify(
        recorderContext,
        excessApplicationId,
        { balanceAsOf: manilaDate(0) },
        `certify-excess-${suffix}`,
      );
      const excessCertification = excessCertified.versions.at(-1)!.certification!;
      expect(excessCertification.lines).toHaveLength(1);
      expect(excessCertification.lines[0]).toMatchObject({
        postedBalance: '5.0000',
        activeCommitments: '2.0000',
        applicationQuantity: '5.0000',
        availableAfterApplication: '-2.0000',
      });
      await applications.recommend(
        supervisorContext,
        excessApplicationId,
        { outcome: 'RECOMMEND_APPROVAL' },
        `recommend-excess-${suffix}`,
      );
      const excessDecided = await applications.decide(
        approverContext,
        excessApplicationId,
        { decision: 'APPROVE', comments: 'Three days charged; two days without pay.' },
        `decide-excess-${suffix}`,
      );
      expect(excessDecided.application.status).toBe('APPROVED');
      expect(
        excessDecided.versions
          .at(-1)!
          .approvalAllocation!.lines.map(({ allocationKind, policyVersionId, quantity }) => ({
            allocationKind,
            policyVersionId,
            quantity,
          })),
      ).toEqual([
        {
          allocationKind: 'LEAVE_ACCOUNT',
          policyVersionId: reviewPolicyVersion.id,
          quantity: '3.0000',
        },
        {
          allocationKind: 'LEAVE_WITHOUT_PAY',
          policyVersionId: reviewPolicyVersion.id,
          quantity: '2.0000',
        },
      ]);
      const excessCommitments = await admin.leaveCreditCommitment.findMany({
        where: {
          agencyId: agency.id,
          sourceType: 'LeaveApplicationVersion',
          sourceId: excessVersion.id,
        },
        orderBy: { effectiveFrom: 'asc' },
      });
      expect(
        excessCommitments.map(({ sourceCommitmentKey, status, quantity }) => ({
          sourceCommitmentKey,
          status,
          quantity: quantity.toFixed(4),
        })),
      ).toEqual([
        { sourceCommitmentKey: 'CERTIFIED', status: 'RELEASED', quantity: '5.0000' },
        { sourceCommitmentKey: 'APPROVED', status: 'ACTIVE', quantity: '3.0000' },
      ]);

      // An unpaid policy authorizes leave without pay without touching any
      // leave-credit account.
      const withoutPay = await policies.create(agencyContext, {
        catalogueCode: 'LEAVE_WITHOUT_PAY',
      });
      const withoutPayVersion = await policies.createPolicyVersion(agencyContext, withoutPay.id, {
        effectiveDate: manilaDate(-10),
        approvalRouteCode: reviewRouteCode,
        applicability: { profiles: ['ORDINARY_CIVILIAN_NGA'] },
        documentRequirements: {},
        reason: 'Adopt leave without pay for the allocation test.',
      });
      await policies.linkAuthority(agencyContext, withoutPay.id, withoutPayVersion.id, {
        authorityClass: 'NATIONAL_RULE',
        documentId: nationalEvidence.documentId,
        citation: 'section 50',
      });
      await policies.activate(
        agencyContext,
        withoutPay.id,
        withoutPayVersion.id,
        'Activate leave without pay.',
      );
      const unpaidMonday = nextMonday(15);
      const unpaidFriday = addDays(unpaidMonday, 4);
      const unpaidApplication = await applications.create(
        agencyContext,
        { employeeId: employee.id, leaveTypeId: withoutPay.id },
        `create-unpaid-${suffix}`,
      );
      const unpaidApplicationId = unpaidApplication.application.id;
      await applications.update(agencyContext, unpaidApplicationId, {
        reason: 'No remaining credits; unpaid leave requested.',
        periods: [{ dateFrom: unpaidMonday, dateTo: unpaidFriday }],
        documents: [
          { documentId: formEvidence.documentId, purposeCode: 'SIGNED_LEAVE_APPLICATION_FORM' },
        ],
      });
      const unpaidSubmitted = await applications.submit(
        employeeContext,
        unpaidApplicationId,
        submitInput,
        `submit-unpaid-${suffix}`,
      );
      const unpaidVersion = unpaidSubmitted.versions.at(-1)!;
      expect(unpaidVersion.calculationSegments[0]!.allocationKinds).toEqual(['LEAVE_WITHOUT_PAY']);
      await applications.route(recorderContext, unpaidApplicationId, `route-unpaid-${suffix}`);
      const unpaidCertified = await applications.certify(
        recorderContext,
        unpaidApplicationId,
        {},
        `certify-unpaid-${suffix}`,
      );
      expect(unpaidCertified.versions.at(-1)!.certification!.lines).toEqual([]);
      await applications.recommend(
        supervisorContext,
        unpaidApplicationId,
        { outcome: 'RECOMMEND_APPROVAL' },
        `recommend-unpaid-${suffix}`,
      );
      const unpaidDecided = await applications.decide(
        approverContext,
        unpaidApplicationId,
        { decision: 'APPROVE', comments: 'Approved as leave without pay.' },
        `decide-unpaid-${suffix}`,
      );
      expect(unpaidDecided.application.status).toBe('APPROVED');
      const postingContext = {
        ...recorderContext,
        permissions: [
          ...recorderContext.permissions,
          { code: 'leave.applications.post', scopePolicy: 'AGENCY' as const },
        ],
      };
      await expect(
        applications.post(postingContext, unpaidApplicationId, `post-unpaid-${suffix}`),
      ).rejects.toMatchObject({ code: 'LEAVE_POSTING_PAYROLL_OWNER_UNAVAILABLE' });
      expect(
        (await applications.findById(agencyContext, unpaidApplicationId))!.application.status,
      ).toBe('APPROVED');

      expect(unpaidDecided.versions.at(-1)!.approvalAllocation!.lines).toMatchObject([
        {
          allocationKind: 'LEAVE_WITHOUT_PAY',
          policyVersionId: withoutPayVersion.id,
          leaveAccountId: null,
          quantity: '5.0000',
          unitCode: 'WORKING_DAY',
        },
      ]);
      await expect(
        admin.leaveCreditCommitment.count({
          where: {
            agencyId: agency.id,
            sourceType: 'LeaveApplicationVersion',
            sourceId: unpaidVersion.id,
          },
        }),
      ).resolves.toBe(0);

      // Leave Cancellation: request and decide only. The cancellation is its
      // own record over exact scopes; no ledger or commitment effect occurs.
      const cancellationRoute = await approvals.createRoute(agencyContext, {
        routeCode: LEAVE_CANCELLATION_ROUTE_CODE,
        domain: 'LEAVE',
        versionNo: 1,
        effectiveFrom,
        stepDefinition: {
          steps: [
            {
              stepNo: 1,
              stepMode: 'SEQUENTIAL',
              requiredPermission: 'leave.applications.cancel',
              approvePermission: 'leave.applications.cancel',
              rejectPermission: 'leave.applications.reject_cancel',
              assignment: { kind: 'MEMBERSHIP', membershipId: approverMembership.id },
              requiresSeparateReview: true,
            },
          ],
        },
      });
      await approvals.activateRoute(
        agencyContext,
        cancellationRoute.id,
        'Activate the Leave Cancellation route.',
      );
      const requestCancelEmployee = {
        ...employeeContext,
        permissions: [
          ...employeeContext.permissions,
          { code: 'leave.applications.request_cancel', scopePolicy: 'OWN' as const },
        ],
      };
      const requestCancelRecorder = {
        ...recorderContext,
        permissions: [
          ...recorderContext.permissions,
          { code: 'leave.applications.request_cancel', scopePolicy: 'AGENCY' as const },
          { code: 'leave.applications.cancel', scopePolicy: 'AGENCY' as const },
        ],
      };
      const cancelApprover = context(agency.id, approverUser.id, approverMembership.id, [
        { code: 'approvals.requests.read', scopePolicy: 'AGENCY' },
        { code: 'leave.applications.cancel', scopePolicy: 'AGENCY' },
        { code: 'leave.applications.reject_cancel', scopePolicy: 'AGENCY' },
      ]);
      const unpaidLine = unpaidDecided.versions.at(-1)!.approvalAllocation!.lines[0]!;
      const excessLines = excessDecided.versions.at(-1)!.approvalAllocation!.lines;
      const ledgerBefore = await admin.leaveLedgerEntry.count({ where: { agencyId: agency.id } });
      const commitmentsBefore = await admin.leaveCreditCommitment.findMany({
        where: { agencyId: agency.id },
        orderBy: { id: 'asc' },
        select: { id: true, status: true, quantity: true },
      });
      const thursday = addDays(unpaidMonday, 3);

      await expect(
        applications.requestCancellation(agencyContext, unpaidApplicationId, {
          scopeType: 'WHOLE',
          reason: 'No cancellation permission.',
        }),
      ).rejects.toMatchObject({ code: 'LEAVE_APPLICATION_REQUEST_CANCEL_FORBIDDEN' });
      await expect(
        applications.requestCancellation(
          { ...requestCancelEmployee, agencyId: foreignAgency.id },
          unpaidApplicationId,
          { scopeType: 'WHOLE', reason: 'Cross-Agency attempt.' },
        ),
      ).rejects.toBeDefined();
      await expect(
        applications.requestCancellation(
          context(foreignAgency.id, foreignUser.id, foreignMembership.id, [
            { code: 'leave.applications.request_cancel', scopePolicy: 'AGENCY' },
            { code: 'approvals.routes.read', scopePolicy: 'AGENCY' },
            { code: 'approvals.requests.create', scopePolicy: 'AGENCY' },
          ]),
          unpaidApplicationId,
          { scopeType: 'WHOLE', reason: 'Foreign Agency attempt.' },
          `foreign-cancel-${suffix}`,
        ),
      ).rejects.toMatchObject({ code: 'LEAVE_APPLICATION_NOT_FOUND' });
      await expect(
        applications.requestCancellation(requestCancelRecorder, unpaidApplicationId, {
          scopeType: 'WHOLE',
          reason: 'Recorder without evidence.',
        }),
      ).rejects.toMatchObject({ code: 'LEAVE_CANCELLATION_EVIDENCE_REQUIRED' });
      for (const scopes of [
        [{ dateFrom: unpaidMonday, dateTo: unpaidFriday, quantity: '6' }],
        [{ dateFrom: addDays(unpaidMonday, -1), dateTo: thursday, quantity: '1' }],
        [{ dateFrom: addDays(unpaidMonday, 1), dateTo: thursday, quantity: '2' }],
        [{ dateFrom: thursday, dateTo: unpaidFriday, quantity: '3' }],
      ]) {
        await expect(
          applications.requestCancellation(requestCancelEmployee, unpaidApplicationId, {
            scopeType: 'PARTIAL',
            reason: 'Invalid scope.',
            scopes: scopes.map((scope) => ({ allocationLineId: unpaidLine.id, ...scope })),
          }),
        ).rejects.toMatchObject({ code: 'LEAVE_CANCELLATION_SCOPE_INVALID' });
      }
      await expect(
        applications.requestCancellation(requestCancelEmployee, unpaidApplicationId, {
          scopeType: 'PARTIAL',
          reason: 'A line of another application.',
          scopes: [
            {
              allocationLineId: excessLines[0]!.id,
              dateFrom: unpaidMonday,
              dateTo: thursday,
              quantity: '1',
            },
          ],
        }),
      ).rejects.toMatchObject({ code: 'LEAVE_CANCELLATION_SCOPE_INVALID' });
      await expect(admin.leaveCancellation.count({ where: { agencyId: agency.id } })).resolves.toBe(
        0,
      );

      // An Employee requests a partial cancellation; the application projects
      // CANCEL_REQUESTED and the exact scope is cancelRecorded.
      const cancelRequested = await applications.requestCancellation(
        requestCancelEmployee,
        unpaidApplicationId,
        {
          scopeType: 'PARTIAL',
          reason: 'Return to duty early.',
          scopes: [
            {
              allocationLineId: unpaidLine.id,
              dateFrom: thursday,
              dateTo: unpaidFriday,
              quantity: '2',
            },
          ],
        },
        `cancel-request-${suffix}`,
      );
      expect(cancelRequested.application.status).toBe('CANCEL_REQUESTED');
      expect(cancelRequested.cancellations).toHaveLength(1);
      const partialCancellation = cancelRequested.cancellations[0]!;
      expect(partialCancellation).toMatchObject({
        priorStatus: 'APPROVED',
        scopeType: 'PARTIAL',
        reason: 'Return to duty early.',
        decisionStatus: 'REQUESTED',
        effectStatus: 'NOT_READY',
        approvalRouteCode: LEAVE_CANCELLATION_ROUTE_CODE,
        approvalRouteVersionId: cancellationRoute.id,
        approvalRequestStatus: 'IN_PROGRESS',
        documents: [],
      });
      expect(partialCancellation.scopes).toMatchObject([
        {
          allocationLineId: unpaidLine.id,
          allocationKind: 'LEAVE_WITHOUT_PAY',
          dateFrom: thursday,
          dateTo: unpaidFriday,
          quantity: '2.0000',
        },
      ]);
      expect(partialCancellation.approvalSteps).toMatchObject([
        { stepNo: 1, status: 'ACTIVE', requiredPermission: 'leave.applications.cancel' },
      ]);
      const replayed = await applications.requestCancellation(
        requestCancelEmployee,
        unpaidApplicationId,
        {
          scopeType: 'PARTIAL',
          reason: 'Return to duty early.',
          scopes: [
            {
              allocationLineId: unpaidLine.id,
              dateFrom: thursday,
              dateTo: unpaidFriday,
              quantity: '2',
            },
          ],
        },
        `cancel-request-${suffix}`,
      );
      expect(replayed.cancellations).toHaveLength(1);
      await expect(
        applications.requestCancellation(
          requestCancelEmployee,
          unpaidApplicationId,
          { scopeType: 'WHOLE', reason: 'Different request, same key.' },
          `cancel-request-${suffix}`,
        ),
      ).rejects.toMatchObject({ code: 'LEAVE_APPLICATION_IDEMPOTENCY_CONFLICT' });
      await expect(
        applications.requestCancellation(requestCancelEmployee, unpaidApplicationId, {
          scopeType: 'WHOLE',
          reason: 'Already requested.',
        }),
      ).rejects.toMatchObject({ code: 'LEAVE_APPLICATION_WORKFLOW_INVALID' });

      // Self-approval prevention: neither the subject Employee nor the
      // requester decides, even when they hold the permission.
      await expect(
        applications.decideCancellation(
          {
            ...employeeContext,
            permissions: [{ code: 'leave.applications.cancel', scopePolicy: 'AGENCY' }],
          },
          unpaidApplicationId,
          { decision: 'APPROVE' },
        ),
      ).rejects.toMatchObject({ code: 'LEAVE_APPLICATION_SEPARATION_REQUIRED' });
      await expect(
        applications.decideCancellation(
          {
            ...cancelApprover,
            permissions: [{ code: 'leave.applications.reject_cancel', scopePolicy: 'AGENCY' }],
          },
          unpaidApplicationId,
          { decision: 'APPROVE' },
        ),
      ).rejects.toMatchObject({ code: 'LEAVE_APPLICATION_CANCELLATION_APPROVED_FORBIDDEN' });

      // Rejection needs a reason, then restores the exact prior state.
      const cancelRejected = await applications.decideCancellation(
        cancelApprover,
        unpaidApplicationId,
        { decision: 'REJECT', comments: 'The leave remains needed for coverage.' },
        `cancel-reject-${suffix}`,
      );
      expect(cancelRejected.application.status).toBe('APPROVED');
      expect(cancelRejected.cancellations[0]).toMatchObject({
        decisionStatus: 'REJECTED',
        effectStatus: 'NOT_READY',
        approvalRequestStatus: 'REJECTED',
      });
      expect(cancelRejected.cancellations[0]!.approvalSteps[0]!.decisions).toMatchObject([
        { decision: 'REJECT', comments: 'The leave remains needed for coverage.' },
      ]);
      expect(cancelRejected.versions.at(-1)!.approvalAllocation!.lines).toEqual(
        unpaidDecided.versions.at(-1)!.approvalAllocation!.lines,
      );
      await expect(
        applications.decideCancellation(cancelApprover, unpaidApplicationId, {
          decision: 'REJECT',
          comments: 'Second decision.',
        }),
      ).rejects.toMatchObject({ code: 'LEAVE_APPLICATION_WORKFLOW_INVALID' });

      // A new request after rejection is allowed; whole cancellation derives its
      // scope from every approved line. Approval records the decision with
      // effects pending and leaves the application CANCEL_REQUESTED.
      const wholeRequested = await applications.requestCancellation(
        requestCancelEmployee,
        unpaidApplicationId,
        { scopeType: 'WHOLE', reason: 'Leave no longer required.' },
        `cancel-whole-${suffix}`,
      );
      const wholeCancellation = wholeRequested.cancellations.at(-1)!;
      expect(wholeRequested.cancellations).toHaveLength(2);
      expect(wholeCancellation.scopes).toMatchObject([
        {
          allocationLineId: unpaidLine.id,
          dateFrom: unpaidMonday,
          dateTo: unpaidFriday,
          quantity: '5.0000',
        },
      ]);
      const cancelApproved = await applications.decideCancellation(
        cancelApprover,
        unpaidApplicationId,
        { decision: 'APPROVE', comments: 'Cancellation authorized.' },
        `cancel-approve-${suffix}`,
      );
      expect(cancelApproved.application.status).toBe('CANCEL_REQUESTED');
      expect(cancelApproved.cancellations.at(-1)).toMatchObject({
        decisionStatus: 'APPROVED',
        effectStatus: 'PENDING',
        approvalRequestStatus: 'APPROVED',
      });
      expect(cancelApproved.cancellations.at(-1)!.approvalSteps[0]!.decisions).toMatchObject([
        { decision: 'APPROVE', comments: 'Cancellation authorized.' },
      ]);
      await expect(
        applications.decideCancellation(cancelApprover, unpaidApplicationId, {
          decision: 'APPROVE',
        }),
      ).rejects.toMatchObject({ code: 'LEAVE_APPLICATION_WORKFLOW_INVALID' });
      await expect(
        applications.requestCancellation(requestCancelEmployee, unpaidApplicationId, {
          scopeType: 'WHOLE',
          reason: 'Cancellation already approved.',
        }),
      ).rejects.toMatchObject({ code: 'LEAVE_APPLICATION_WORKFLOW_INVALID' });

      // A recorder attaches exact evidence; a POSTED application returns to
      // POSTED when the cancellation is cancelRejected.
      await admin.leaveApplication.update({
        where: { agencyId_id: { agencyId: agency.id, id: excessApplicationId } },
        data: { status: 'POSTED' },
      });
      const cancelRecorded = await applications.requestCancellation(
        requestCancelRecorder,
        excessApplicationId,
        {
          scopeType: 'PARTIAL',
          reason: 'Recorded from a signed request.',
          evidenceDocumentId: signedEvidence.documentId,
          scopes: [
            {
              allocationLineId: excessLines.find(
                ({ allocationKind }) => allocationKind === 'LEAVE_WITHOUT_PAY',
              )!.id,
              dateFrom: addDays(excessMonday, 3),
              dateTo: addDays(excessMonday, 4),
              quantity: '1',
            },
          ],
        },
      );
      expect(cancelRecorded.cancellations[0]).toMatchObject({ priorStatus: 'POSTED' });
      expect(cancelRecorded.cancellations[0]!.documents).toMatchObject([
        { documentVersionId: signedEvidence.versionId, purposeCode: 'CANCELLATION_EVIDENCE' },
      ]);
      const postedRejected = await applications.decideCancellation(
        cancelApprover,
        excessApplicationId,
        {
          decision: 'REJECT',
          comments: 'Posted leave stands.',
        },
      );
      expect(postedRejected.application.status).toBe('POSTED');

      // No ledger or commitment effect occurred in any scenario.
      await expect(admin.leaveLedgerEntry.count({ where: { agencyId: agency.id } })).resolves.toBe(
        ledgerBefore,
      );
      await expect(
        admin.leaveCreditCommitment.findMany({
          where: { agencyId: agency.id },
          orderBy: { id: 'asc' },
          select: { id: true, status: true, quantity: true },
        }),
      ).resolves.toEqual(commitmentsBefore);

      // Immutability and forced RLS hold at the database.
      await expect(
        admin.leaveCancellation.update({
          where: { agencyId_id: { agencyId: agency.id, id: wholeCancellation.id } },
          data: { reason: 'Rewritten reason.' },
        }),
      ).rejects.toThrow(/immutable/);
      await expect(
        admin.leaveCancellation.update({
          where: { agencyId_id: { agencyId: agency.id, id: wholeCancellation.id } },
          data: { decisionStatus: 'REJECTED', effectStatus: 'NOT_READY' },
        }),
      ).rejects.toThrow(/immutable/);
      await expect(
        admin.leaveCancellation.delete({
          where: { agencyId_id: { agencyId: agency.id, id: wholeCancellation.id } },
        }),
      ).rejects.toThrow(/retained/);
      await expect(
        admin.leaveCancellationScope.create({
          data: {
            agencyId: agency.id,
            leaveCancellationId: wholeCancellation.id,
            approvalAllocationLineId: excessLines[0]!.id,
            dateFrom: new Date(`${excessMonday}T00:00:00.000Z`),
            dateTo: new Date(`${excessFriday}T00:00:00.000Z`),
            quantity: 1,
          },
        }),
      ).rejects.toThrow(/approved allocation line/);
      await expect(
        admin.leaveCancellationScope.create({
          data: {
            agencyId: agency.id,
            leaveCancellationId: wholeCancellation.id,
            approvalAllocationLineId: unpaidLine.id,
            dateFrom: new Date(`${unpaidMonday}T00:00:00.000Z`),
            dateTo: new Date(`${unpaidFriday}T00:00:00.000Z`),
            quantity: 6,
          },
        }),
      ).rejects.toThrow();
      const foreignView = await withDatabaseContext(
        { agencyId: foreignAgency.id, userId: foreignUser.id, membershipId: foreignMembership.id },
        async (transaction) => ({
          cancellations: await transaction.leaveCancellation.count(),
          scopes: await transaction.leaveCancellationScope.count(),
        }),
      );
      expect(foreignView).toEqual({ cancellations: 0, scopes: 0 });
      await expect(
        applications.decideCancellation(
          context(foreignAgency.id, foreignUser.id, foreignMembership.id, [
            { code: 'leave.applications.cancel', scopePolicy: 'AGENCY' },
            { code: 'leave.applications.reject_cancel', scopePolicy: 'AGENCY' },
          ]),
          unpaidApplicationId,
          { decision: 'REJECT', comments: 'Foreign Agency attempt.' },
        ),
      ).rejects.toMatchObject({ code: 'LEAVE_APPLICATION_NOT_FOUND' });

      const applyContext = {
        ...recorderContext,
        permissions: [
          ...recorderContext.permissions,
          { code: 'leave.applications.apply_cancellation', scopePolicy: 'AGENCY' as const },
        ],
      };
      const approvedLine = allocation.lines[0]!;
      const partialRequest = await applications.requestCancellation(
        requestCancelEmployee,
        reviewApplicationId,
        {
          scopeType: 'PARTIAL',
          reason: 'Return one day early.',
          scopes: [
            {
              allocationLineId: approvedLine.id,
              dateFrom: approvedLine.dateTo,
              dateTo: approvedLine.dateTo,
              quantity: '1',
            },
          ],
        },
      );
      const appliedCancellationId = partialRequest.cancellations[0]!.id;
      await applications.decideCancellation(cancelApprover, reviewApplicationId, {
        decision: 'APPROVE',
      });
      const failingApplications = new LeaveApplicationsService(
        {
          async write(transaction, event) {
            if (event.action === 'LEAVE_APPLICATION_CANCELLATION_APPLIED') {
              throw new Error('Injected audit storage outage.');
            }
            await leaveApplicationAuditWriter.write(transaction, event);
          },
        },
        documents,
        approvals,
        completionRegistry,
        schedules,
        arrangements,
        calendars,
        postedLeaveInputs,
        attendanceCorrections,
        new MandatoryLeaveAssessmentsService(mandatoryLeaveAssessmentAuditWriter),
      );
      await expect(
        failingApplications.applyCancellation(
          applyContext,
          reviewApplicationId,
          appliedCancellationId,
          `apply-partial-${suffix}`,
        ),
      ).rejects.toMatchObject({ code: 'LEAVE_CANCELLATION_APPLY_RETRYABLE', statusCode: 503 });
      const failed = await applications.findById(recorderContext, reviewApplicationId);
      expect(failed!.application.status).toBe('CANCEL_REQUESTED');
      expect(failed!.cancellations[0]).toMatchObject({
        decisionStatus: 'APPROVED',
        effectStatus: 'FAILED',
        lastEffectFailureKind: 'RETRYABLE',
        lastEffectFailureCode: 'LEAVE_CANCELLATION_APPLY_RETRYABLE',
        effects: [],
      });
      const afterRollback = await admin.leaveCreditCommitment.findMany({
        where: { agencyId: agency.id, sourceId: reviewVersion.id, status: 'ACTIVE' },
      });
      expect(
        afterRollback.map(({ id, quantity }) => ({ id, quantity: quantity.toFixed(4) })),
      ).toEqual([{ id: commitments[1]!.id, quantity: '2.0000' }]);
      await expect(
        admin.outboxEvent.count({
          where: { agencyId: agency.id, aggregateId: appliedCancellationId },
        }),
      ).resolves.toBe(0);
      const blockingApplications = new LeaveApplicationsService(
        {
          async write(transaction, event) {
            if (event.action === 'LEAVE_APPLICATION_CANCELLATION_APPLIED') {
              // A real SQL failure aborts the effect subtransaction in PostgreSQL.
              await transaction.$executeRaw`SELECT 1 / 0`;
            }
            await leaveApplicationAuditWriter.write(transaction, event);
          },
        },
        documents,
        approvals,
        completionRegistry,
        schedules,
        arrangements,
        calendars,
        postedLeaveInputs,
        attendanceCorrections,
        new MandatoryLeaveAssessmentsService(mandatoryLeaveAssessmentAuditWriter),
      );
      await expect(
        blockingApplications.applyCancellation(
          applyContext,
          reviewApplicationId,
          appliedCancellationId,
          `apply-partial-${suffix}`,
        ),
      ).rejects.toMatchObject({ code: 'LEAVE_CANCELLATION_APPLY_BLOCKED', statusCode: 409 });
      expect(
        (await applications.findById(recorderContext, reviewApplicationId))!.cancellations[0],
      ).toMatchObject({ effectStatus: 'FAILED', lastEffectFailureKind: 'BLOCKING', effects: [] });
      await expect(
        admin.auditEvent.count({
          where: {
            agencyId: agency.id,
            entityId: reviewApplicationId,
            action: 'LEAVE_APPLICATION_CANCELLATION_APPLY_FAILED',
          },
        }),
      ).resolves.toBe(2);
      await expect(
        applications.applyCancellation(
          applyContext,
          unpaidApplicationId,
          wholeCancellation.id,
          `apply-partial-${suffix}`,
        ),
      ).rejects.toMatchObject({ code: 'LEAVE_APPLICATION_IDEMPOTENCY_CONFLICT' });
      const expiringApplications = new LeaveApplicationsService(
        {
          async write(transaction, event) {
            if (event.action === 'LEAVE_APPLICATION_CANCELLATION_APPLIED') {
              // Prisma's default interactive transaction expires after five seconds.
              await new Promise((resolve) => setTimeout(resolve, 5_100));
            }
            await leaveApplicationAuditWriter.write(transaction, event);
          },
        },
        documents,
        approvals,
        completionRegistry,
        schedules,
        arrangements,
        calendars,
        postedLeaveInputs,
        attendanceCorrections,
        new MandatoryLeaveAssessmentsService(mandatoryLeaveAssessmentAuditWriter),
      );
      await expect(
        expiringApplications.applyCancellation(
          applyContext,
          reviewApplicationId,
          appliedCancellationId,
          `apply-partial-${suffix}`,
        ),
      ).rejects.toMatchObject({ code: 'LEAVE_CANCELLATION_APPLY_RETRYABLE', statusCode: 503 });
      const expired = await applications.findById(recorderContext, reviewApplicationId);
      expect(expired!.application.status).toBe('CANCEL_REQUESTED');
      expect(expired!.cancellations[0]).toMatchObject({
        effectStatus: 'FAILED',
        lastEffectFailureKind: 'RETRYABLE',
        effects: [],
      });
      await expect(
        admin.auditEvent.count({
          where: {
            agencyId: agency.id,
            entityId: reviewApplicationId,
            action: 'LEAVE_APPLICATION_CANCELLATION_APPLY_FAILED',
          },
        }),
      ).resolves.toBe(3);
      const competingKeys = await Promise.allSettled([
        applications.applyCancellation(
          applyContext,
          reviewApplicationId,
          appliedCancellationId,
          `shared-key-${suffix}`,
        ),
        applications.applyCancellation(
          applyContext,
          unpaidApplicationId,
          wholeCancellation.id,
          `shared-key-${suffix}`,
        ),
      ]);
      expect(competingKeys.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      expect(competingKeys.filter(({ status }) => status === 'rejected')).toMatchObject([
        { reason: { code: 'LEAVE_APPLICATION_IDEMPOTENCY_CONFLICT' } },
      ]);
      const [applied, concurrentRetry] = await Promise.all([
        applications.applyCancellation(
          applyContext,
          reviewApplicationId,
          appliedCancellationId,
          `apply-partial-${suffix}`,
        ),
        applications.applyCancellation(
          applyContext,
          reviewApplicationId,
          appliedCancellationId,
          `apply-partial-${suffix}`,
        ),
      ]);
      expect(concurrentRetry.cancellations).toEqual(applied.cancellations);
      expect(applied.application.status).toBe('CANCELLED');
      expect(applied.cancellations[0]).toMatchObject({
        decisionStatus: 'APPROVED',
        effectStatus: 'APPLIED',
        lastEffectFailureCode: null,
        effects: [
          {
            effectKind: 'COMMITMENT_RELEASE',
            ownerRecordId: commitments[1]!.id,
            ownerStatus: 'RELEASED',
          },
        ],
      });
      const retained = await admin.leaveCreditCommitment.findMany({
        where: { agencyId: agency.id, sourceId: reviewVersion.id, status: 'ACTIVE' },
      });
      expect(retained).toHaveLength(1);
      expect(retained[0]).toMatchObject({
        leaveAccountId: commitments[1]!.leaveAccountId,
        succeedsCommitmentId: commitments[1]!.id,
      });
      expect(retained[0]!.quantity.toFixed(4)).toBe('1.0000');
      expect(applied.versions.at(-1)!.approvalAllocation).toEqual(allocation);
      expect(
        (
          await applications.applyCancellation(
            applyContext,
            reviewApplicationId,
            appliedCancellationId,
            `apply-partial-${suffix}`,
          )
        ).cancellations,
      ).toEqual(applied.cancellations);
      // Whole unposted cancellation also applies when no account was charged.
      const noCreditApplied = await applications.applyCancellation(
        applyContext,
        unpaidApplicationId,
        wholeCancellation.id,
        `apply-unpaid-${suffix}`,
      );
      expect(noCreditApplied.application.status).toBe('CANCELLED');
      expect(noCreditApplied.cancellations.at(-1)).toMatchObject({
        effectStatus: 'APPLIED',
        effects: [],
      });

      // A fresh one-day approval exercises whole cancellation of a credit commitment.
      const wholeCredit = await applications.create(agencyContext, {
        employeeId: employee.id,
        leaveTypeId: specialLeave.id,
      });
      const wholeCreditId = wholeCredit.application.id;
      await applications.update(agencyContext, wholeCreditId, {
        reason: 'One day of special privilege leave.',
        commutationChoice: 'NOT_REQUESTED',
        periods: [{ dateFrom: approvedLine.dateFrom, dateTo: approvedLine.dateFrom }],
        documents: [
          { documentId: formEvidence.documentId, purposeCode: 'SIGNED_LEAVE_APPLICATION_FORM' },
        ],
      });
      await applications.submit(employeeContext, wholeCreditId, submitInput);
      await applications.route(recorderContext, wholeCreditId);
      await applications.certify(recorderContext, wholeCreditId, {});
      await applications.recommend(supervisorContext, wholeCreditId, {
        outcome: 'RECOMMEND_APPROVAL',
      });
      const wholeCreditApproved = await applications.decide(approverContext, wholeCreditId, {
        decision: 'APPROVE',
      });
      const wholeCreditVersionId = wholeCreditApproved.application.currentVersionId!;
      const wholeCreditRequest = await applications.requestCancellation(
        requestCancelEmployee,
        wholeCreditId,
        {
          scopeType: 'WHOLE',
          reason: 'Duty requires attendance.',
        },
      );
      await applications.decideCancellation(cancelApprover, wholeCreditId, { decision: 'APPROVE' });
      await applications.applyCancellation(
        applyContext,
        reviewApplicationId,
        appliedCancellationId,
        `new-replay-key-${suffix}`,
      );
      await expect(
        applications.applyCancellation(
          applyContext,
          wholeCreditId,
          wholeCreditRequest.cancellations[0]!.id,
          `new-replay-key-${suffix}`,
        ),
      ).rejects.toMatchObject({ code: 'LEAVE_APPLICATION_IDEMPOTENCY_CONFLICT' });
      const wholeApplied = await applications.applyCancellation(
        applyContext,
        wholeCreditId,
        wholeCreditRequest.cancellations[0]!.id,
        `apply-whole-credit-${suffix}`,
      );
      expect(wholeApplied.application.status).toBe('CANCELLED');
      expect(wholeApplied.cancellations[0]!.effects).toHaveLength(1);
      const wholeCreditCommitments = await admin.leaveCreditCommitment.findMany({
        where: { agencyId: agency.id, sourceId: wholeCreditVersionId },
      });
      expect(wholeCreditCommitments).toHaveLength(1);
      expect(wholeCreditCommitments[0]!.status).toBe('RELEASED');

      // A POSTED projection without its exact Leave Posting fails closed and records a blocking cause.
      const postedRequest = await applications.requestCancellation(
        requestCancelRecorder,
        excessApplicationId,
        {
          scopeType: 'WHOLE',
          reason: 'Recorded cancellation of posted leave.',
          evidenceDocumentId: signedEvidence.documentId,
        },
      );
      await applications.decideCancellation(cancelApprover, excessApplicationId, {
        decision: 'APPROVE',
      });
      await expect(
        applications.applyCancellation(
          applyContext,
          excessApplicationId,
          postedRequest.cancellations.at(-1)!.id,
          `apply-posted-${suffix}`,
        ),
      ).rejects.toMatchObject({ code: 'LEAVE_CANCELLATION_POSTING_REQUIRED' });
      const blocked = await applications.findById(recorderContext, excessApplicationId);
      expect(blocked!.application.status).toBe('CANCEL_REQUESTED');
      expect(blocked!.cancellations.at(-1)).toMatchObject({
        decisionStatus: 'APPROVED',
        effectStatus: 'FAILED',
        lastEffectFailureKind: 'BLOCKING',
        lastEffectFailureCode: 'LEAVE_CANCELLATION_POSTING_REQUIRED',
        effects: [],
      });

      const controller = new LeaveApplicationsController(applications);
      const apiReplay = await controller.applyCancellation(
        agency.id,
        reviewApplicationId,
        appliedCancellationId,
        `apply-partial-${suffix}`,
        applyContext,
      );
      expect(apiReplay.application.status).toBe('CANCELLED');
      expect(apiReplay.cancellations[0]!.effects).toEqual(applied.cancellations[0]!.effects);
      await expect(
        controller.applyCancellation(
          foreignAgency.id,
          reviewApplicationId,
          appliedCancellationId,
          `apply-partial-${suffix}`,
          applyContext,
        ),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        controller.applyCancellation(
          agency.id,
          reviewApplicationId,
          'malformed',
          `apply-partial-${suffix}`,
          applyContext,
        ),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        controller.applyCancellation(
          agency.id,
          reviewApplicationId,
          appliedCancellationId,
          undefined,
          applyContext,
        ),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        controller.applyCancellation(
          agency.id,
          reviewApplicationId,
          appliedCancellationId,
          'no-permission',
          employeeContext,
        ),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        applications.applyCancellation(
          {
            ...applyContext,
            agencyId: foreignAgency.id,
            membershipId: foreignMembership.id,
            userId: foreignUser.id,
          },
          reviewApplicationId,
          appliedCancellationId,
          `foreign-apply-${suffix}`,
        ),
      ).rejects.toMatchObject({ code: 'LEAVE_APPLICATION_NOT_FOUND' });
      await expect(
        admin.leaveCancellationEffect.update({
          where: { id: applied.cancellations[0]!.effects[0]!.id },
          data: { ownerStatus: 'ACTIVE' },
        }),
      ).rejects.toThrow(/immutable/);
      await expect(
        admin.leaveCancellationEffect.delete({
          where: { id: applied.cancellations[0]!.effects[0]!.id },
        }),
      ).rejects.toThrow(/retained/);
      await expect(
        admin.leaveCancellation.update({
          where: { id: appliedCancellationId },
          data: { lastEffectFailureCode: 'REWRITTEN' },
        }),
      ).rejects.toThrow(/immutable/);
      const foreignEffects = await withDatabaseContext(
        { agencyId: foreignAgency.id, userId: foreignUser.id, membershipId: foreignMembership.id },
        (transaction) => transaction.leaveCancellationEffect.count(),
      );
      expect(foreignEffects).toBe(0);
      const security = await admin.$queryRaw<
        Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>
      >`
        SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'leave_cancellation_effects'
      `;
      expect(security).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
      await expect(
        admin.outboxEvent.count({
          where: { agencyId: agency.id, aggregateId: appliedCancellationId },
        }),
      ).resolves.toBe(1);
      await expect(
        admin.auditEvent.count({
          where: {
            agencyId: agency.id,
            entityId: reviewApplicationId,
            action: 'LEAVE_APPLICATION_CANCELLATION_APPLIED',
          },
        }),
      ).resolves.toBe(1);
      await expect(admin.leaveLedgerEntry.count({ where: { agencyId: agency.id } })).resolves.toBe(
        ledgerBefore,
      );

      // Additional posted credits let this journey coexist with the earlier
      // active commitments rather than releasing another application's claim.
      await admin.leaveLedgerEntry.create({
        data: {
          agencyId: agency.id,
          leaveAccountId: specialAccount.id,
          quantity: 10,
          effectiveDate: new Date(`${manilaDate(-5)}T00:00:00.000Z`),
          sourceType: 'IntegrationFixture',
          sourceId: randomUUID(),
          sourcePostingKey: 'credits',
          policyVersionId: reviewPolicyVersion.id,
        },
      });
      const postingDraft = await applications.create(agencyContext, {
        employeeId: employee.id,
        leaveTypeId: specialLeave.id,
      });
      const postingApplicationId = postingDraft.application.id;
      await applications.update(agencyContext, postingApplicationId, {
        reason: 'Atomic posting journey.',
        commutationChoice: 'NOT_REQUESTED',
        periods: [{ dateFrom: nextMonday(20), dateTo: nextMonday(20) }],
        documents: [
          { documentId: formEvidence.documentId, purposeCode: 'SIGNED_LEAVE_APPLICATION_FORM' },
        ],
      });
      await applications.submit(employeeContext, postingApplicationId, submitInput);
      await applications.route(recorderContext, postingApplicationId);
      await applications.certify(recorderContext, postingApplicationId, {
        balanceAsOf: manilaDate(0),
      });
      await applications.recommend(supervisorContext, postingApplicationId, {
        outcome: 'RECOMMEND_APPROVAL',
      });
      await applications.decide(approverContext, postingApplicationId, { decision: 'APPROVE' });
      await expect(
        applicationApi.post(
          foreignAgency.id,
          postingApplicationId,
          {},
          'cross-agency-key',
          postingContext,
        ),
      ).rejects.toMatchObject({
        status: 403,
        response: { error: { code: 'LEAVE_APPLICATION_FORBIDDEN' } },
      });
      await expect(
        applicationApi.post(agency.id, postingApplicationId, {}, undefined, postingContext),
      ).rejects.toMatchObject({
        status: 400,
        response: {
          error: { code: 'LEAVE_POSTING_KEY_REQUIRED', requestId: postingContext.requestId },
        },
      });
      await expect(
        applicationApi.post(
          agency.id,
          postingApplicationId,
          { status: 'POSTED' },
          'invalid-body',
          postingContext,
        ),
      ).rejects.toMatchObject({
        status: 400,
        response: { error: { code: 'INVALID_INPUT', requestId: postingContext.requestId } },
      });
      for (const effectiveDate of [manilaDate(-2), nextMonday(15), nextMonday(30)]) {
        const changedBalance = await admin.leaveLedgerEntry.create({
          data: {
            agencyId: agency.id,
            leaveAccountId: specialAccount.id,
            quantity: -15,
            effectiveDate: new Date(`${effectiveDate}T00:00:00.000Z`),
            sourceType: 'IntegrationFixture',
            sourceId: randomUUID(),
            sourcePostingKey: 'changed-balance',
            policyVersionId: reviewPolicyVersion.id,
          },
        });
        await expect(
          applications.post(
            postingContext,
            postingApplicationId,
            `stale-${effectiveDate}-${suffix}`,
          ),
        ).rejects.toMatchObject({ code: 'LEAVE_POSTING_CREDITS_UNAVAILABLE' });
        expect(
          (await applications.findById(agencyContext, postingApplicationId))!.application.status,
        ).toBe('APPROVED');
        await admin.leaveLedgerEntry.create({
          data: {
            agencyId: agency.id,
            leaveAccountId: specialAccount.id,
            quantity: 15,
            effectiveDate: changedBalance.effectiveDate,
            sourceType: 'IntegrationFixture',
            sourceId: randomUUID(),
            sourcePostingKey: 'restore-balance',
            policyVersionId: reviewPolicyVersion.id,
            reversesEntryId: changedBalance.id,
          },
        });
      }
      const postingVersion = (await applications.findById(
        agencyContext,
        postingApplicationId,
      ))!.versions.at(-1)!;
      const sourceCommitment = await admin.leaveCreditCommitment.findFirstOrThrow({
        where: { agencyId: agency.id, sourceId: postingVersion.id, status: 'ACTIVE' },
      });
      // A late PostgreSQL rejection occurs after both owner effects and the
      // status projection. The complete authoritative transaction must roll back.
      const failureFunction = `fail_posting_${randomUUID().replaceAll('-', '')}`;
      await admin.$executeRawUnsafe(
        `CREATE FUNCTION ${failureFunction}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'intentional posting outbox failure'; END; $$`,
      );
      await admin.$executeRawUnsafe(
        `CREATE TRIGGER ${failureFunction} BEFORE INSERT ON outbox_events FOR EACH ROW WHEN (NEW.aggregate_id = '${postingApplicationId}'::uuid) EXECUTE FUNCTION ${failureFunction}()`,
      );
      const ledgerCount = await admin.leaveLedgerEntry.count({ where: { agencyId: agency.id } });
      try {
        await expect(
          applications.post(postingContext, postingApplicationId, `post-${suffix}`),
        ).rejects.toThrow(/intentional posting outbox failure/);
        const failed = (await applications.findById(agencyContext, postingApplicationId))!;
        expect(failed.application.status).toBe('APPROVED');
        expect(failed.versions.at(-1)!.posting).toBeNull();
        expect(await admin.leaveLedgerEntry.count({ where: { agencyId: agency.id } })).toBe(
          ledgerCount,
        );
        expect(
          await admin.attendancePostedLeaveInput.count({ where: { agencyId: agency.id } }),
        ).toBe(0);
        expect(await admin.leavePostingEffect.count({ where: { agencyId: agency.id } })).toBe(0);
        expect(
          await admin.outboxEvent.count({
            where: { agencyId: agency.id, aggregateId: postingApplicationId },
          }),
        ).toBe(0);
        expect(
          await admin.leaveCreditCommitment.findUnique({ where: { id: sourceCommitment.id } }),
        ).toMatchObject({ status: 'ACTIVE' });
        expect(
          await admin.auditEvent.count({
            where: {
              agencyId: agency.id,
              entityId: postingApplicationId,
              action: 'LEAVE_APPLICATION_POST_FAILED',
            },
          }),
        ).toBe(4);
      } finally {
        await admin.$executeRawUnsafe(`DROP TRIGGER ${failureFunction} ON outbox_events`);
        await admin.$executeRawUnsafe(`DROP FUNCTION ${failureFunction}()`);
      }
      const postingApprover = {
        ...approverContext,
        permissions: [
          ...approverContext.permissions,
          { code: 'leave.applications.post', scopePolicy: 'AGENCY' as const },
        ],
      };
      await expect(
        applications.post(postingApprover, postingApplicationId, `post-approver-${suffix}`),
      ).rejects.toMatchObject({ code: 'LEAVE_APPLICATION_SEPARATION_REQUIRED' });
      await expect(
        applications.post(
          {
            ...employeeContext,
            permissions: [{ code: 'leave.applications.post', scopePolicy: 'AGENCY' }],
          },
          postingApplicationId,
          `post-self-${suffix}`,
        ),
      ).rejects.toMatchObject({ code: 'LEAVE_APPLICATION_SEPARATION_REQUIRED' });
      await expect(
        applications.post(
          {
            ...foreignContext,
            permissions: [{ code: 'leave.applications.post', scopePolicy: 'AGENCY' }],
          },
          postingApplicationId,
          `post-foreign-${suffix}`,
        ),
      ).rejects.toMatchObject({ code: 'LEAVE_APPLICATION_NOT_FOUND' });
      const [posted, concurrentReplay] = await Promise.all([
        applicationApi.post(agency.id, postingApplicationId, {}, `post-${suffix}`, postingContext),
        applications.post(postingContext, postingApplicationId, `post-${suffix}`),
      ]);
      expect(concurrentReplay.versions.at(-1)!.posting!.id).toBe(
        posted.versions.at(-1)!.posting!.id,
      );
      expect(posted.application.status).toBe('POSTED');
      expect(
        posted.versions
          .at(-1)!
          .posting!.effects.map(({ effectKind }) => effectKind)
          .sort(),
      ).toEqual(['ATTENDANCE_INPUT', 'LEDGER_ENTRY']);
      expect(
        (
          await applications.post(postingContext, postingApplicationId, `post-${suffix}`)
        ).versions.at(-1)!.posting!.id,
      ).toBe(posted.versions.at(-1)!.posting!.id);

      const posting = posted.versions.at(-1)!.posting!;
      const ledgerEffect = posting.effects.find(({ effectKind }) => effectKind === 'LEDGER_ENTRY')!;
      expect(
        await admin.leaveLedgerEntry.findUnique({ where: { id: ledgerEffect.ownerRecordId } }),
      ).toMatchObject({
        sourceType: 'LeavePosting',
        sourceId: posting.id,
        policyVersionId: reviewPolicyVersion.id,
      });
      expect(
        (
          await admin.leaveLedgerEntry.findUniqueOrThrow({
            where: { id: ledgerEffect.ownerRecordId },
          })
        ).quantity.toFixed(4),
      ).toBe('-1.0000');
      expect(
        await admin.leaveCreditCommitment.findUnique({ where: { id: sourceCommitment.id } }),
      ).toMatchObject({ status: 'CONSUMED' });
      expect(
        await admin.auditEvent.count({
          where: {
            agencyId: agency.id,
            entityId: postingApplicationId,
            action: 'LEAVE_APPLICATION_POSTED',
          },
        }),
      ).toBe(1);
      expect(
        await admin.outboxEvent.count({
          where: { agencyId: agency.id, aggregateId: postingApplicationId, status: 'PENDING' },
        }),
      ).toBe(1);
      await expect(
        applications.post(postingContext, postingApplicationId, `another-key-${suffix}`),
      ).rejects.toMatchObject({ code: 'LEAVE_POSTING_SOURCE_DUPLICATE' });
      await expect(
        applications.post(postingContext, unpaidApplicationId, `post-${suffix}`),
      ).rejects.toMatchObject({ code: 'LEAVE_APPLICATION_IDEMPOTENCY_CONFLICT' });
      await expect(
        admin.leavePosting.update({
          where: { id: posting.id },
          data: { idempotencyKey: 'rewritten' },
        }),
      ).rejects.toThrow(/immutable/);
      await expect(admin.leavePosting.delete({ where: { id: posting.id } })).rejects.toThrow(
        /retained/,
      );
      const effect = await admin.leavePostingEffect.findFirstOrThrow({
        where: { leavePostingId: posting.id },
      });
      await expect(
        admin.leavePostingEffect.update({
          where: { id: effect.id },
          data: { effectKey: 'rewritten' },
        }),
      ).rejects.toThrow(/immutable/);
      await expect(admin.leavePostingEffect.delete({ where: { id: effect.id } })).rejects.toThrow(
        /retained/,
      );
      expect(
        await withDatabaseContext({ agencyId: foreignAgency.id }, async (tx) => ({
          postings: await tx.leavePosting.count(),
          effects: await tx.leavePostingEffect.count(),
        })),
      ).toEqual({ postings: 0, effects: 0 });
      const nonCreditType = await policies.create(agencyContext, {
        catalogueCode: 'SPECIAL_EMERGENCY_LEAVE',
      });
      const nonCreditPolicy = await policies.createPolicyVersion(agencyContext, nonCreditType.id, {
        effectiveDate: manilaDate(-10),
        approvalRouteCode: reviewRouteCode,
        applicability: { profiles: ['ORDINARY_CIVILIAN_NGA'] },
        documentRequirements: {},
        reason: 'Exercise the catalogue policy for paid non-credit leave.',
      });
      await policies.linkAuthority(agencyContext, nonCreditType.id, nonCreditPolicy.id, {
        authorityClass: 'NATIONAL_RULE',
        documentId: nationalEvidence.documentId,
        citation: 'CSC MC No. 2, s. 2012',
      });
      await policies.linkAuthority(agencyContext, nonCreditType.id, nonCreditPolicy.id, {
        authorityClass: 'AGENCY_CONFIGURATION',
        documentId: nationalEvidence.documentId,
        citation: 'Evidenced Agency calamity coverage',
        validationReason: 'Approved local coverage for the fixture.',
      });
      await policies.activate(
        agencyContext,
        nonCreditType.id,
        nonCreditPolicy.id,
        'Verified non-credit policy.',
      );
      const nonCreditDraft = await applications.create(agencyContext, {
        employeeId: employee.id,
        leaveTypeId: nonCreditType.id,
      });
      const nonCreditId = nonCreditDraft.application.id;
      await applications.update(agencyContext, nonCreditId, {
        reason: 'Paid non-credit leave.',
        policyDetails: { qualifyingEvent: 'DECLARED_CALAMITY' },
        commutationChoice: 'NOT_REQUESTED',
        periods: [{ dateFrom: nextMonday(25), dateTo: nextMonday(25) }],
        documents: [
          { documentId: formEvidence.documentId, purposeCode: 'CALAMITY_DECLARATION_EVIDENCE' },
        ],
      });
      await applications.submit(employeeContext, nonCreditId, submitInput);
      await applications.route(recorderContext, nonCreditId);
      await applications.certify(recorderContext, nonCreditId, {});
      await applications.recommend(supervisorContext, nonCreditId, {
        outcome: 'RECOMMEND_APPROVAL',
      });
      await applications.decide(approverContext, nonCreditId, { decision: 'APPROVE' });
      const nonCreditPosted = await applications.post(
        postingContext,
        nonCreditId,
        `non-credit-${suffix}`,
      );
      expect(
        nonCreditPosted.versions.at(-1)!.posting!.effects.map(({ effectKind }) => effectKind),
      ).toEqual(['ATTENDANCE_INPUT']);
      const attendanceEffect = nonCreditPosted.versions.at(-1)!.posting!.effects[0]!;
      expect(
        await admin.attendancePostedLeaveInput.findUnique({
          where: { id: attendanceEffect.ownerRecordId },
        }),
      ).toMatchObject({ allocationKind: 'NON_CREDIT', employeeId: employee.id });

      const changedDraft = await applications.create(agencyContext, {
        employeeId: employee.id,
        leaveTypeId: specialLeave.id,
      });
      const changedId = changedDraft.application.id;
      await applications.update(agencyContext, changedId, {
        reason: 'Commitment revalidation.',
        commutationChoice: 'NOT_REQUESTED',
        periods: [{ dateFrom: nextMonday(30), dateTo: nextMonday(30) }],
        documents: [
          { documentId: formEvidence.documentId, purposeCode: 'SIGNED_LEAVE_APPLICATION_FORM' },
        ],
      });
      const changedSubmitted = await applications.submit(employeeContext, changedId, submitInput);
      const changedVersionId = changedSubmitted.versions.at(-1)!.id;
      await applications.route(recorderContext, changedId);
      await applications.certify(recorderContext, changedId, {});
      await applications.recommend(supervisorContext, changedId, { outcome: 'RECOMMEND_APPROVAL' });
      await applications.decide(approverContext, changedId, { decision: 'APPROVE' });
      const originalCommitment = await admin.leaveCreditCommitment.findFirstOrThrow({
        where: { agencyId: agency.id, sourceId: changedVersionId, status: 'ACTIVE' },
      });
      await admin.leaveCreditCommitment.update({
        where: { id: originalCommitment.id },
        data: { status: 'RELEASED', endedAt: new Date() },
      });
      await expect(
        applications.post(postingContext, changedId, `released-${suffix}`),
      ).rejects.toMatchObject({ code: 'LEAVE_APPLICATION_RECERTIFICATION_REQUIRED' });
      await admin.leaveCreditCommitment.create({
        data: {
          agencyId: agency.id,
          leaveAccountId: specialAccount.id,
          quantity: 1,
          sourceType: 'LeaveApplicationVersion',
          sourceId: changedVersionId,
          sourceCommitmentKey: 'UNSUPPORTED_REPLACEMENT',
          succeedsCommitmentId: originalCommitment.id,
          status: 'ACTIVE',
          effectiveFrom: new Date(),
        },
      });
      const incompatible = await Promise.allSettled([
        applications.post(postingContext, changedId, `incompatible-a-${suffix}`),
        applications.post(postingContext, changedId, `incompatible-b-${suffix}`),
      ]);
      for (const result of incompatible) {
        expect(result.status).toBe('rejected');
        if (result.status === 'rejected')
          expect(result.reason).toMatchObject({
            code: 'LEAVE_APPLICATION_RECERTIFICATION_REQUIRED',
          });
      }
      expect((await applications.findById(agencyContext, changedId))!.application.status).toBe(
        'APPROVED',
      );
      expect(
        await admin.leavePosting.count({
          where: { agencyId: agency.id, leaveApplicationVersionId: changedVersionId },
        }),
      ).toBe(0);

      async function approveConcurrentApplication(date: string): Promise<string> {
        const draft = await applications.create(agencyContext, {
          employeeId: employee.id,
          leaveTypeId: specialLeave.id,
        });
        const id = draft.application.id;
        await applications.update(agencyContext, id, {
          reason: 'Concurrent account posting.',
          commutationChoice: 'NOT_REQUESTED',
          periods: [{ dateFrom: date, dateTo: date }],
          documents: [
            { documentId: formEvidence.documentId, purposeCode: 'SIGNED_LEAVE_APPLICATION_FORM' },
          ],
        });
        await applications.submit(employeeContext, id, submitInput);
        await applications.route(recorderContext, id);
        await applications.certify(recorderContext, id, {});
        await applications.recommend(supervisorContext, id, { outcome: 'RECOMMEND_APPROVAL' });
        await applications.decide(approverContext, id, { decision: 'APPROVE' });
        return id;
      }
      const competingIds = [
        await approveConcurrentApplication(nextMonday(35)),
        await approveConcurrentApplication(nextMonday(40)),
      ];
      const unavailableCredits = await admin.leaveLedgerEntry.create({
        data: {
          agencyId: agency.id,
          leaveAccountId: specialAccount.id,
          quantity: -10,
          effectiveDate: new Date(`${manilaDate(0)}T00:00:00.000Z`),
          sourceType: 'IntegrationFixture',
          sourceId: randomUUID(),
          sourcePostingKey: 'competing-balance',
          policyVersionId: reviewPolicyVersion.id,
        },
      });
      // Hold the shared account so both distinct applications reach PostgreSQL's
      // account lock together. Then release it with the changed balance visible.
      let notifyLocked = () => {};
      let releaseAccount = () => {};
      const locked = new Promise<void>((resolve) => {
        notifyLocked = resolve;
      });
      const released = new Promise<void>((resolve) => {
        releaseAccount = resolve;
      });
      const holdingAccount = admin.$transaction(
        async (transaction) => {
          await transaction.$queryRaw(
            Prisma.sql`SELECT id FROM leave_accounts WHERE id = CAST(${specialAccount.id} AS uuid) FOR UPDATE`,
          );
          notifyLocked();
          await released;
        },
        { timeout: 10_000 },
      );
      await locked;
      const competitors = Promise.allSettled(
        competingIds.map((id) => applications.post(postingContext, id, `competing-${id}`)),
      );
      try {
        await expect
          .poll(
            async () => {
              const waiting = await admin.$queryRaw<
                { count: number }[]
              >`SELECT COUNT(*)::integer AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%leave_accounts%' AND cardinality(pg_blocking_pids(pid)) > 0`;
              return waiting[0]!.count;
            },
            { timeout: 2_000, interval: 20 },
          )
          .toBe(2);
      } finally {
        releaseAccount();
      }
      await holdingAccount;
      const rejectedCompetitors = await competitors;
      for (const result of rejectedCompetitors) {
        expect(result.status).toBe('rejected');
        if (result.status === 'rejected')
          expect(result.reason).toMatchObject({ code: 'LEAVE_POSTING_CREDITS_UNAVAILABLE' });
      }
      for (const id of competingIds)
        expect((await applications.findById(agencyContext, id))!.application.status).toBe(
          'APPROVED',
        );
      await admin.leaveLedgerEntry.create({
        data: {
          agencyId: agency.id,
          leaveAccountId: specialAccount.id,
          quantity: 10,
          effectiveDate: unavailableCredits.effectiveDate,
          sourceType: 'IntegrationFixture',
          sourceId: randomUUID(),
          sourcePostingKey: 'competing-balance-restored',
          policyVersionId: reviewPolicyVersion.id,
          reversesEntryId: unavailableCredits.id,
        },
      });
      const settledCompetitors = await Promise.all(
        competingIds.map((id) => applications.post(postingContext, id, `competing-${id}`)),
      );
      expect(
        new Set(settledCompetitors.map((detail) => detail.versions.at(-1)!.posting!.id)).size,
      ).toBe(2);
      for (const result of settledCompetitors) {
        expect(result.application.status).toBe('POSTED');
        expect(result.versions.at(-1)!.posting!.effects).toHaveLength(2);
      }

      // Cancellation of posted leave while Attendance is unlocked.
      const attendanceContext = {
        ...agencyContext,
        permissions: [
          ...agencyContext.permissions,
          { code: 'attendance.days.calculate', scopePolicy: 'AGENCY' as const },
          { code: 'attendance.days.read', scopePolicy: 'AGENCY' as const },
        ],
      };
      const postedDayTotals = async (workDate: string) => {
        const [day] = await attendanceDays.list(attendanceContext, {
          employeeId: employee.id,
          workDateFrom: workDate,
          workDateTo: workDate,
        });
        return (await attendanceDays.findById(attendanceContext, day!.id)).day.totals;
      };
      const specialBalance = async (asOf: string, recordedThrough?: Date) => {
        const [summary] = await accounts.list(agencyContext, {
          employeeId: employee.id,
          leaveTypeId: specialLeave.id,
          asOf,
          ...(recordedThrough ? { recordedThrough: recordedThrough.toISOString() } : {}),
        });
        return summary!.balances.postedQuantity;
      };
      async function postSpecialLeave(date: string): Promise<string> {
        const id = await approveConcurrentApplication(date);
        await applications.post(postingContext, id, `post-${id}`);
        return id;
      }
      async function requestApprovedCancellation(
        id: string,
        input: Parameters<typeof applications.requestCancellation>[2],
      ): Promise<string> {
        const requested = await applications.requestCancellation(requestCancelRecorder, id, input);
        await applications.decideCancellation(cancelApprover, id, { decision: 'APPROVE' });
        return requested.cancellations.at(-1)!.id;
      }

      // Whole cancellation: a one-day posting whose Work Date has no other leave.
      const wholeTargetId = competingIds[0]!;
      const wholePosting = settledCompetitors[0]!.versions.at(-1)!.posting!;
      const postedDate = nextMonday(35);
      await attendanceDays.calculate(attendanceContext, {
        periodCode: `LEAVE-CANCEL-${suffix}`,
        dateFrom: postedDate,
        dateTo: postedDate,
        employeeIds: [employee.id],
      });
      expect(await postedDayTotals(postedDate)).toMatchObject({ postedLeaveMinutes: 480 });
      const balanceBefore = await specialBalance(postedDate);
      const wholePostedId = await requestApprovedCancellation(wholeTargetId, {
        scopeType: 'WHOLE',
        reason: 'Recalled to duty before the posted leave.',
        evidenceDocumentId: signedEvidence.documentId,
      });
      const postedLedgerEntry = await admin.leaveLedgerEntry.findUniqueOrThrow({
        where: {
          id: wholePosting.effects.find(({ effectKind }) => effectKind === 'LEDGER_ENTRY')!
            .ownerRecordId,
        },
      });
      // A late PostgreSQL rejection rolls back every reversal and owner handoff.
      const cancellationFailure = `fail_cancel_${randomUUID().replaceAll('-', '')}`;
      await admin.$executeRawUnsafe(
        `CREATE FUNCTION ${cancellationFailure}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'intentional cancellation outbox failure'; END; $$`,
      );
      await admin.$executeRawUnsafe(
        `CREATE TRIGGER ${cancellationFailure} BEFORE INSERT ON outbox_events FOR EACH ROW WHEN (NEW.aggregate_id = '${wholePostedId}'::uuid) EXECUTE FUNCTION ${cancellationFailure}()`,
      );
      try {
        await expect(
          applications.applyCancellation(
            applyContext,
            wholeTargetId,
            wholePostedId,
            `apply-posted-whole-${suffix}`,
          ),
        ).rejects.toMatchObject({ code: 'LEAVE_CANCELLATION_APPLY_BLOCKED' });
      } finally {
        await admin.$executeRawUnsafe(`DROP TRIGGER ${cancellationFailure} ON outbox_events`);
        await admin.$executeRawUnsafe(`DROP FUNCTION ${cancellationFailure}()`);
      }
      const rolledBack = (await applications.findById(agencyContext, wholeTargetId))!;
      expect(rolledBack.application.status).toBe('CANCEL_REQUESTED');
      expect(rolledBack.versions.at(-1)!.posting).toEqual(wholePosting);
      expect(rolledBack.cancellations.at(-1)).toMatchObject({
        decisionStatus: 'APPROVED',
        effectStatus: 'FAILED',
        lastEffectFailureKind: 'BLOCKING',
        effects: [],
      });
      expect(
        await admin.leaveLedgerEntry.count({
          where: { agencyId: agency.id, sourceId: wholePostedId },
        }),
      ).toBe(0);
      expect(
        await admin.attendancePostedLeaveInput.count({
          where: { agencyId: agency.id, sourceId: wholePostedId },
        }),
      ).toBe(0);
      expect(await postedDayTotals(postedDate)).toMatchObject({ postedLeaveMinutes: 480 });

      // The same key retries the command and applies every effect once.
      const beforeApply = new Date();
      const wholePosted = await applications.applyCancellation(
        applyContext,
        wholeTargetId,
        wholePostedId,
        `apply-posted-whole-${suffix}`,
      );
      expect(wholePosted.application.status).toBe('CANCELLED');
      const wholeEffects = wholePosted.cancellations.at(-1)!;
      expect(wholeEffects).toMatchObject({
        effectStatus: 'APPLIED',
        lastEffectFailureCode: null,
        lastEffectFailureKind: null,
      });
      expect(wholeEffects.effects.map(({ effectKind }) => effectKind).sort()).toEqual([
        'ATTENDANCE_CORRECTION',
        'LEDGER_REVERSAL',
      ]);
      const reversal = await admin.leaveLedgerEntry.findUniqueOrThrow({
        where: {
          id: wholeEffects.effects.find(({ effectKind }) => effectKind === 'LEDGER_REVERSAL')!
            .ownerRecordId,
        },
      });
      expect(reversal).toMatchObject({
        leaveAccountId: postedLedgerEntry.leaveAccountId,
        reversesEntryId: postedLedgerEntry.id,
        effectiveDate: postedLedgerEntry.effectiveDate,
        policyVersionId: postedLedgerEntry.policyVersionId,
        sourceType: 'LeaveCancellation',
        sourceId: wholePostedId,
      });
      expect(reversal.quantity.toFixed(4)).toBe(postedLedgerEntry.quantity.negated().toFixed(4));
      const withdrawnInput = await admin.attendancePostedLeaveInput.findUniqueOrThrow({
        where: {
          id: wholeEffects.effects.find(({ effectKind }) => effectKind === 'ATTENDANCE_CORRECTION')!
            .ownerRecordId,
        },
      });
      expect(withdrawnInput.predecessorInputId).toBe(
        wholePosting.effects.find(({ effectKind }) => effectKind === 'ATTENDANCE_INPUT')!
          .ownerRecordId,
      );
      expect(withdrawnInput.quantity.toFixed(4)).toBe('0.0000');
      expect(await postedDayTotals(postedDate)).toMatchObject({
        postedLeaveMinutes: 0,
        absenceMinutes: 480,
      });
      // The posted balance is restored now; history known before the apply is unchanged.
      expect(Number(await specialBalance(postedDate))).toBe(Number(balanceBefore) + 1);
      expect(await specialBalance(postedDate, beforeApply)).toBe(balanceBefore);
      const replayedWhole = await applications.applyCancellation(
        applyContext,
        wholeTargetId,
        wholePostedId,
        `apply-posted-whole-${suffix}`,
      );
      expect(replayedWhole.cancellations).toEqual(wholePosted.cancellations);
      expect(
        await admin.leaveLedgerEntry.count({
          where: { agencyId: agency.id, sourceId: wholePostedId },
        }),
      ).toBe(1);

      // Partial cancellation: reverse the three-day entry and replace the retained two days.
      await admin.leaveLedgerEntry.create({
        data: {
          agencyId: agency.id,
          leaveAccountId: specialAccount.id,
          quantity: 5,
          effectiveDate: new Date(`${manilaDate(-5)}T00:00:00.000Z`),
          sourceType: 'IntegrationFixture',
          sourceId: randomUUID(),
          sourcePostingKey: 'partial-cancellation-credits',
          policyVersionId: reviewPolicyVersion.id,
        },
      });
      const partialMonday = nextMonday(45);
      const partialWednesday = addDays(partialMonday, 2);
      const partialDraft = await applications.create(agencyContext, {
        employeeId: employee.id,
        leaveTypeId: specialLeave.id,
      });
      const partialPostedId = partialDraft.application.id;
      await applications.update(agencyContext, partialPostedId, {
        reason: 'Three days of special privilege leave.',
        commutationChoice: 'NOT_REQUESTED',
        periods: [{ dateFrom: partialMonday, dateTo: partialWednesday }],
        documents: [
          { documentId: formEvidence.documentId, purposeCode: 'SIGNED_LEAVE_APPLICATION_FORM' },
        ],
      });
      await applications.submit(employeeContext, partialPostedId, submitInput);
      await applications.route(recorderContext, partialPostedId);
      await applications.certify(recorderContext, partialPostedId, {});
      await applications.recommend(supervisorContext, partialPostedId, {
        outcome: 'RECOMMEND_APPROVAL',
      });
      await applications.decide(approverContext, partialPostedId, { decision: 'APPROVE' });
      const partialPosting = await applications.post(
        postingContext,
        partialPostedId,
        `post-partial-${suffix}`,
      );
      const partialLine = partialPosting.versions.at(-1)!.approvalAllocation!.lines[0]!;
      await attendanceDays.calculate(attendanceContext, {
        periodCode: `LEAVE-PARTIAL-${suffix}`,
        dateFrom: partialMonday,
        dateTo: partialWednesday,
        employeeIds: [employee.id],
      });
      expect(await postedDayTotals(partialWednesday)).toMatchObject({ postedLeaveMinutes: 480 });
      const partialCancellationId = await requestApprovedCancellation(partialPostedId, {
        scopeType: 'PARTIAL',
        reason: 'Returning to duty on the last day.',
        evidenceDocumentId: signedEvidence.documentId,
        scopes: [
          {
            allocationLineId: partialLine.id,
            dateFrom: partialWednesday,
            dateTo: partialWednesday,
            quantity: '1',
          },
        ],
      });
      const partialApplied = await applications.applyCancellation(
        applyContext,
        partialPostedId,
        partialCancellationId,
        `apply-posted-partial-${suffix}`,
      );
      expect(partialApplied.application.status).toBe('CANCELLED');
      const partialEffects = partialApplied.cancellations.at(-1)!.effects;
      expect(partialEffects.map(({ effectKind }) => effectKind).sort()).toEqual([
        'ATTENDANCE_CORRECTION',
        'LEDGER_REPLACEMENT',
        'LEDGER_REVERSAL',
      ]);
      const partialOriginal = await admin.leaveLedgerEntry.findUniqueOrThrow({
        where: {
          id: partialPosting.versions
            .at(-1)!
            .posting!.effects.find(({ effectKind }) => effectKind === 'LEDGER_ENTRY')!
            .ownerRecordId,
        },
      });
      const ownerOf = (kind: string) =>
        partialEffects.find(({ effectKind }) => effectKind === kind)!.ownerRecordId;
      const partialReversal = await admin.leaveLedgerEntry.findUniqueOrThrow({
        where: { id: ownerOf('LEDGER_REVERSAL') },
      });
      const replacement = await admin.leaveLedgerEntry.findUniqueOrThrow({
        where: { id: ownerOf('LEDGER_REPLACEMENT') },
      });
      expect(partialReversal.reversesEntryId).toBe(partialOriginal.id);
      expect(partialReversal.quantity.toFixed(4)).toBe('3.0000');
      expect(replacement).toMatchObject({
        leaveAccountId: partialOriginal.leaveAccountId,
        effectiveDate: partialOriginal.effectiveDate,
        policyVersionId: partialOriginal.policyVersionId,
        reversesEntryId: null,
      });
      expect(replacement.quantity.toFixed(4)).toBe('-2.0000');
      expect(replacement.postedAt.getTime()).toBeGreaterThan(partialOriginal.postedAt.getTime());
      const retainedInput = await admin.attendancePostedLeaveInput.findUniqueOrThrow({
        where: { id: ownerOf('ATTENDANCE_CORRECTION') },
      });
      expect(retainedInput).toMatchObject({
        dateFrom: new Date(`${partialMonday}T00:00:00.000Z`),
        dateTo: new Date(`${addDays(partialMonday, 1)}T00:00:00.000Z`),
        allocationKind: 'LEAVE_ACCOUNT',
      });
      expect(retainedInput.quantity.toFixed(4)).toBe('2.0000');
      expect(await postedDayTotals(partialMonday)).toMatchObject({ postedLeaveMinutes: 480 });
      expect(await postedDayTotals(partialWednesday)).toMatchObject({
        postedLeaveMinutes: 0,
        absenceMinutes: 480,
      });

      // Locked Attendance: Leave hands Attendance a pending correction instead.
      const authorizerContext = context(agency.id, authorizerUser.id, authorizerMembership.id, [
        { code: 'approvals.requests.read', scopePolicy: 'AGENCY' },
        { code: 'attendance.corrections.read', scopePolicy: 'AGENCY' },
        { code: 'attendance.corrections.authorize_locked', scopePolicy: 'AGENCY' },
        { code: 'attendance.days.read', scopePolicy: 'AGENCY' },
      ]);
      const approverAsAuthorizer = context(agency.id, approverUser.id, approverMembership.id, [
        { code: 'approvals.requests.read', scopePolicy: 'AGENCY' },
        { code: 'attendance.corrections.read', scopePolicy: 'AGENCY' },
        { code: 'attendance.corrections.authorize_locked', scopePolicy: 'AGENCY' },
      ]);
      const recorderAsAuthorizer = context(agency.id, recorderUser.id, recorderMembership.id, [
        { code: 'approvals.requests.read', scopePolicy: 'AGENCY' },
        { code: 'attendance.corrections.read', scopePolicy: 'AGENCY' },
        { code: 'attendance.corrections.authorize_locked', scopePolicy: 'AGENCY' },
      ]);
      await admin.leaveLedgerEntry.create({
        data: {
          agencyId: agency.id,
          leaveAccountId: specialAccount.id,
          quantity: 5,
          effectiveDate: new Date(`${manilaDate(-5)}T00:00:00.000Z`),
          sourceType: 'IntegrationFixture',
          sourceId: randomUUID(),
          sourcePostingKey: 'locked-cancellation-credits',
          policyVersionId: reviewPolicyVersion.id,
        },
      });
      // Lock the Work Dates' Attendance Period as approved and published.
      async function lockAttendance(dateFrom: string, dateTo: string) {
        const currentDays = () =>
          admin.attendanceDay.findMany({
            where: {
              agencyId: agency.id,
              employeeId: employee.id,
              workDate: {
                gte: new Date(`${dateFrom}T00:00:00.000Z`),
                lte: new Date(`${dateTo}T00:00:00.000Z`),
              },
              isCurrent: true,
            },
          });
        let days = await currentDays();
        if (days.length === 0) {
          await attendanceDays.calculate(attendanceContext, {
            periodCode: `LOCKED-${dateFrom}-${suffix}`,
            dateFrom,
            dateTo,
            employeeIds: [employee.id],
          });
          days = await currentDays();
        }
        const periodId = days[0]!.attendancePeriodId;
        const dayIds = days.map(({ id }) => id);
        const submission = await admin.employeeAttendanceSubmission.create({
          data: {
            agencyId: agency.id,
            attendancePeriodId: periodId,
            employeeId: employee.id,
            versionNo: 1,
            status: 'APPROVED',
            submittedByMembershipId: membership.id,
            submittedAt: new Date(),
            reviewedByMembershipId: supervisorMembership.id,
            reviewedAt: new Date(),
            reviewReason: 'Seed submission approved.',
          },
        });
        await admin.employeeAttendanceSubmissionDay.createMany({
          data: dayIds.map((attendanceDayId) => ({
            agencyId: agency.id,
            employeeAttendanceSubmissionId: submission.id,
            attendanceDayId,
          })),
        });
        const version = await admin.attendancePeriodVersion.create({
          data: {
            agencyId: agency.id,
            attendancePeriodId: periodId,
            versionNo: 1,
            status: 'LOCKED',
            approvalRouteVersionId: cancellationRoute.id,
            submittedByMembershipId: membership.id,
            submittedAt: new Date(),
            reviewedByMembershipId: supervisorMembership.id,
            reviewedAt: new Date(),
            reviewReason: 'Seed period reviewed.',
            lockedByMembershipId: approverMembership.id,
            lockedAt: new Date(),
            reconciliation: { seed: true },
          },
        });
        await admin.attendancePeriodVersionDay.createMany({
          data: dayIds.map((attendanceDayId) => ({
            agencyId: agency.id,
            attendancePeriodVersionId: version.id,
            employeeAttendanceSubmissionId: submission.id,
            attendanceDayId,
          })),
        });
        const publication = await admin.attendancePayrollPublication.create({
          data: {
            agencyId: agency.id,
            attendancePeriodVersionId: version.id,
            publicationType: 'ORIGINAL',
            idempotencyKey: `seed-original:${version.id}`,
            publishedAt: new Date(),
          },
        });
        await finalizeAttendancePeriod(admin, periodId);
        const originalDtrs = await dtrs.materializeForLockedVersionInTransaction(
          admin,
          agencyContext,
          version.id,
        );
        return { periodId, dayIds, version, publication, originalDtrs };
      }
      const lockedSnapshot = async (periodId: string, dayIds: string[]) => ({
        days: await admin.attendanceDay.findMany({
          where: { id: { in: dayIds } },
          orderBy: { id: 'asc' },
        }),
        versions: await admin.attendancePeriodVersion.findMany({
          where: { attendancePeriodId: periodId },
          orderBy: { id: 'asc' },
        }),
        dtrs: await admin.dtrDocument.findMany({
          where: { agencyId: agency.id, attendancePeriodVersion: { attendancePeriodId: periodId } },
          orderBy: { id: 'asc' },
        }),
      });

      // Whole cancellation after locking: a VOID handoff, refused until a route exists.
      const lockedDate = nextMonday(63);
      const lockedPostedId = await postSpecialLeave(lockedDate);
      const wholeLock = await lockAttendance(lockedDate, lockedDate);
      expect(await postedDayTotals(lockedDate)).toMatchObject({ postedLeaveMinutes: 480 });
      const lockedBefore = await lockedSnapshot(wholeLock.periodId, wholeLock.dayIds);
      const lockedCancellationId = await requestApprovedCancellation(lockedPostedId, {
        scopeType: 'WHOLE',
        reason: 'Recalled after the period locked.',
        evidenceDocumentId: signedEvidence.documentId,
      });
      await expect(
        applications.applyCancellation(
          applyContext,
          lockedPostedId,
          lockedCancellationId,
          `apply-locked-${suffix}`,
        ),
      ).rejects.toMatchObject({
        code: 'LEAVE_CANCELLATION_ATTENDANCE_REFUSED',
        reasons: ['APPROVAL_ROUTE_RESOLUTION_FAILED'],
      });
      const refused = (await applications.findById(agencyContext, lockedPostedId))!;
      expect(refused.application.status).toBe('CANCEL_REQUESTED');
      expect(refused.cancellations.at(-1)).toMatchObject({
        effectStatus: 'FAILED',
        lastEffectFailureKind: 'BLOCKING',
        lastEffectFailureCode: 'LEAVE_CANCELLATION_ATTENDANCE_REFUSED',
        effects: [],
      });
      expect(
        await admin.leaveLedgerEntry.count({
          where: { agencyId: agency.id, sourceId: lockedCancellationId },
        }),
      ).toBe(0);
      expect(await admin.attendanceCorrection.count({ where: { agencyId: agency.id } })).toBe(0);

      const postedLeaveRoute = await approvals.createRoute(agencyContext, {
        routeCode: ATTENDANCE_CORRECTION_POSTED_LEAVE_ROUTE_CODE,
        domain: 'ATTENDANCE',
        versionNo: 1,
        effectiveFrom,
        stepDefinition: {
          steps: [
            {
              stepNo: 1,
              stepMode: 'SEQUENTIAL',
              requiredPermission: 'attendance.corrections.authorize_locked',
              assignment: { kind: 'MEMBERSHIP', membershipId: authorizerMembership.id },
              requiresSeparateReview: true,
            },
          ],
        },
      });
      await approvals.activateRoute(
        agencyContext,
        postedLeaveRoute.id,
        'Activate the posted-leave Attendance Correction route.',
      );
      // A late PostgreSQL failure rolls back the accepted correction with the reversal.
      const lockedFailure = `fail_locked_${randomUUID().replaceAll('-', '')}`;
      await admin.$executeRawUnsafe(
        `CREATE FUNCTION ${lockedFailure}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'intentional locked handoff failure'; END; $$`,
      );
      await admin.$executeRawUnsafe(
        `CREATE TRIGGER ${lockedFailure} BEFORE INSERT ON outbox_events FOR EACH ROW WHEN (NEW.aggregate_id = '${lockedCancellationId}'::uuid) EXECUTE FUNCTION ${lockedFailure}()`,
      );
      try {
        await expect(
          applications.applyCancellation(
            applyContext,
            lockedPostedId,
            lockedCancellationId,
            `apply-locked-${suffix}`,
          ),
        ).rejects.toMatchObject({ code: 'LEAVE_CANCELLATION_APPLY_BLOCKED' });
      } finally {
        await admin.$executeRawUnsafe(`DROP TRIGGER ${lockedFailure} ON outbox_events`);
        await admin.$executeRawUnsafe(`DROP FUNCTION ${lockedFailure}()`);
      }
      expect(await admin.attendanceCorrection.count({ where: { agencyId: agency.id } })).toBe(0);
      expect(
        (await applications.findById(agencyContext, lockedPostedId))!.cancellations.at(-1)!.effects,
      ).toEqual([]);
      // The same key retries once Attendance can accept the handoff.
      const lockedApplied = await applications.applyCancellation(
        applyContext,
        lockedPostedId,
        lockedCancellationId,
        `apply-locked-${suffix}`,
      );
      expect(lockedApplied.application.status).toBe('CANCELLED');
      const lockedEffects = lockedApplied.cancellations.at(-1)!;
      expect(lockedEffects.effectStatus).toBe('APPLIED');
      expect(lockedEffects.effects.map(({ effectKind }) => effectKind).sort()).toEqual([
        'ATTENDANCE_LOCKED_CORRECTION',
        'LEDGER_REVERSAL',
      ]);
      const lockedHandoff = lockedEffects.effects.find(
        ({ effectKind }) => effectKind === 'ATTENDANCE_LOCKED_CORRECTION',
      )!;
      expect(lockedHandoff).toMatchObject({
        ownerStatus: 'FOR_AUTHORIZATION',
        attendanceHandoff: {
          correctionId: lockedHandoff.ownerRecordId,
          status: 'FOR_AUTHORIZATION',
          blockingReason: null,
          blockedAt: null,
        },
      });
      const voidCorrection = await admin.attendanceCorrection.findUniqueOrThrow({
        where: { id: lockedHandoff.ownerRecordId },
        include: { evidence: true },
      });
      expect(voidCorrection).toMatchObject({
        targetType: 'POSTED_LEAVE_INPUT',
        requestedAction: 'VOID',
        status: 'FOR_AUTHORIZATION',
        initiatedByMembershipId: recorderMembership.id,
        decidedByMembershipId: approverMembership.id,
      });
      expect(voidCorrection.evidence).toMatchObject([
        { sourceType: 'LeaveCancellation', sourceId: lockedCancellationId },
      ]);
      // Nothing locked moved, and Attendance still counts the posted leave.
      expect(await lockedSnapshot(wholeLock.periodId, wholeLock.dayIds)).toEqual(lockedBefore);
      expect(await postedDayTotals(lockedDate)).toMatchObject({ postedLeaveMinutes: 480 });
      expect(
        await admin.attendancePostedLeaveInput.count({
          where: {
            agencyId: agency.id,
            sourceType: 'LeaveCancellation',
            sourceId: lockedCancellationId,
          },
        }),
      ).toBe(0);

      // Only a different HR Administrator may authorize; the cancellation's people cannot.
      for (const separated of [approverAsAuthorizer, recorderAsAuthorizer]) {
        await expect(
          attendanceCorrections.authorizeLocked(
            separated,
            voidCorrection.id,
            'Self authorization.',
          ),
        ).rejects.toMatchObject({ code: 'ATTENDANCE_CORRECTION_SEPARATION_REQUIRED' });
        await expect(
          attendanceCorrections.recordBlockingReason(separated, voidCorrection.id, 'Blocked.'),
        ).rejects.toMatchObject({ code: 'ATTENDANCE_CORRECTION_SEPARATION_REQUIRED' });
      }
      // Another HR Administrator without the assigned step cannot record a blocker.
      const supervisorAsAuthorizer = context(
        agency.id,
        supervisorUser.id,
        supervisorMembership.id,
        [
          { code: 'approvals.requests.read', scopePolicy: 'AGENCY' },
          { code: 'attendance.corrections.read', scopePolicy: 'AGENCY' },
          { code: 'attendance.corrections.authorize_locked', scopePolicy: 'AGENCY' },
        ],
      );
      await expect(
        attendanceCorrections.recordBlockingReason(
          supervisorAsAuthorizer,
          voidCorrection.id,
          'Blocked.',
        ),
      ).rejects.toMatchObject({ code: 'APPROVAL_AUTHORITY_REQUIRED' });
      // A generic Approval rejection cannot strand the correction outside Attendance.
      const voidRequest = await admin.approvalRequest.findFirstOrThrow({
        where: { agencyId: agency.id, subjectId: voidCorrection.id },
      });
      await expect(
        approvals.reject(authorizerContext, voidRequest.id, 'Rejected outside Attendance.'),
      ).rejects.toMatchObject({ code: 'ATTENDANCE_CORRECTION_APPROVAL_EFFECT_REQUIRED' });
      // The authorizer cannot alter the Leave fact; they record why it is blocked.
      const blockedHandoff = await attendanceCorrections.recordBlockingReason(
        authorizerContext,
        voidCorrection.id,
        'Payroll for this period is under audit.',
      );
      expect(blockedHandoff.correction).toMatchObject({
        status: 'FOR_AUTHORIZATION',
        blockingReason: 'Payroll for this period is under audit.',
        blockedByMembershipId: authorizerMembership.id,
      });
      const blockedDetail = (await applications.findById(agencyContext, lockedPostedId))!;
      expect(
        blockedDetail.cancellations
          .at(-1)!
          .effects.find(({ effectKind }) => effectKind === 'ATTENDANCE_LOCKED_CORRECTION')!
          .attendanceHandoff,
      ).toMatchObject({
        status: 'FOR_AUTHORIZATION',
        blockingReason: 'Payroll for this period is under audit.',
      });

      const authorized = await attendanceCorrections.authorizeLocked(
        authorizerContext,
        voidCorrection.id,
        'Audit cleared; authorized.',
      );
      expect(authorized.correction.status).toBe('APPLIED');
      const [adjustedPeriod] = authorized.lockedAdjustment!.periods;
      expect(adjustedPeriod!.predecessorPeriodVersionId).toBe(wholeLock.version.id);
      const voidSuccessor = await admin.attendancePeriodVersion.findUniqueOrThrow({
        where: { id: adjustedPeriod!.successorPeriodVersionId },
      });
      expect(voidSuccessor).toMatchObject({
        predecessorVersionId: wholeLock.version.id,
        versionNo: 2,
        status: 'LOCKED',
      });
      expect(
        await admin.attendancePayrollPublication.findFirstOrThrow({
          where: { attendancePeriodVersionId: voidSuccessor.id },
        }),
      ).toMatchObject({
        publicationType: 'ADJUSTMENT',
        predecessorPublicationId: wholeLock.publication.id,
      });
      expect(
        await admin.dtrDocument.findFirstOrThrow({
          where: { agencyId: agency.id, attendancePeriodVersionId: voidSuccessor.id },
        }),
      ).toMatchObject({
        classification: 'CORRECTED',
        predecessorDtrDocumentId: wholeLock.originalDtrs.dtrDocumentIds[0],
      });
      const voidInput = await admin.attendancePostedLeaveInput.findFirstOrThrow({
        where: {
          agencyId: agency.id,
          sourceType: 'LeaveCancellation',
          sourceId: lockedCancellationId,
        },
      });
      expect(voidInput.quantity.toFixed(4)).toBe('0.0000');
      expect(voidInput.predecessorInputId).toBe(
        lockedApplied.versions
          .at(-1)!
          .posting!.effects.find(({ effectKind }) => effectKind === 'ATTENDANCE_INPUT')!
          .ownerRecordId,
      );
      expect(await postedDayTotals(lockedDate)).toMatchObject({
        postedLeaveMinutes: 0,
        absenceMinutes: 480,
      });
      // The predecessor locked records keep their facts; a successor Day supersedes each.
      const afterAuthorize = await lockedSnapshot(wholeLock.periodId, wholeLock.dayIds);
      expect(afterAuthorize.days).toEqual(
        lockedBefore.days.map((day) => ({ ...day, isCurrent: false })),
      );
      expect(afterAuthorize.versions).toContainEqual(lockedBefore.versions[0]);
      expect(afterAuthorize.dtrs).toContainEqual(lockedBefore.dtrs[0]);
      const authorizedDetail = (await applications.findById(agencyContext, lockedPostedId))!;
      expect(
        authorizedDetail.cancellations
          .at(-1)!
          .effects.find(({ effectKind }) => effectKind === 'ATTENDANCE_LOCKED_CORRECTION')!
          .attendanceHandoff,
      ).toMatchObject({ status: 'APPLIED' });

      // Partial cancellation after locking: a REPLACE handoff retaining two days.
      const lockedMonday = nextMonday(77);
      const lockedWednesday = addDays(lockedMonday, 2);
      const lockedPartialDraft = await applications.create(agencyContext, {
        employeeId: employee.id,
        leaveTypeId: specialLeave.id,
      });
      const lockedPartialId = lockedPartialDraft.application.id;
      await applications.update(agencyContext, lockedPartialId, {
        reason: 'Three days of special privilege leave.',
        commutationChoice: 'NOT_REQUESTED',
        periods: [{ dateFrom: lockedMonday, dateTo: lockedWednesday }],
        documents: [
          { documentId: formEvidence.documentId, purposeCode: 'SIGNED_LEAVE_APPLICATION_FORM' },
        ],
      });
      await applications.submit(employeeContext, lockedPartialId, submitInput);
      await applications.route(recorderContext, lockedPartialId);
      await applications.certify(recorderContext, lockedPartialId, {});
      await applications.recommend(supervisorContext, lockedPartialId, {
        outcome: 'RECOMMEND_APPROVAL',
      });
      await applications.decide(approverContext, lockedPartialId, { decision: 'APPROVE' });
      const lockedPartialPosting = await applications.post(
        postingContext,
        lockedPartialId,
        `post-locked-partial-${suffix}`,
      );
      const lockedPartialLine = lockedPartialPosting.versions.at(-1)!.approvalAllocation!.lines[0]!;
      const partialLocked = await lockAttendance(lockedMonday, lockedWednesday);
      const lockedPartialCancellationId = await requestApprovedCancellation(lockedPartialId, {
        scopeType: 'PARTIAL',
        reason: 'Returning to duty on the last day.',
        evidenceDocumentId: signedEvidence.documentId,
        scopes: [
          {
            allocationLineId: lockedPartialLine.id,
            dateFrom: lockedWednesday,
            dateTo: lockedWednesday,
            quantity: '1',
          },
        ],
      });
      const lockedPartialApplied = await applications.applyCancellation(
        applyContext,
        lockedPartialId,
        lockedPartialCancellationId,
        `apply-locked-partial-${suffix}`,
      );
      expect(lockedPartialApplied.application.status).toBe('CANCELLED');
      const partialHandoff = lockedPartialApplied.cancellations
        .at(-1)!
        .effects.find(({ effectKind }) => effectKind === 'ATTENDANCE_LOCKED_CORRECTION')!;
      expect(partialHandoff.attendanceHandoff).toMatchObject({ status: 'FOR_AUTHORIZATION' });
      const replaceCorrection = await admin.attendanceCorrection.findUniqueOrThrow({
        where: { id: partialHandoff.ownerRecordId },
      });
      expect(replaceCorrection).toMatchObject({
        targetType: 'POSTED_LEAVE_INPUT',
        requestedAction: 'REPLACE',
        requestedRecord: {
          dateFrom: lockedMonday,
          dateTo: addDays(lockedMonday, 1),
          quantity: 2,
          unitCode: 'WORKING_DAY',
          allocationKind: 'LEAVE_ACCOUNT',
        },
      });
      expect(await postedDayTotals(lockedWednesday)).toMatchObject({ postedLeaveMinutes: 480 });
      const partialAuthorized = await attendanceCorrections.authorizeLocked(
        authorizerContext,
        replaceCorrection.id,
        'Authorized.',
      );
      expect(partialAuthorized.lockedAdjustment!.periods).toMatchObject([
        { predecessorPeriodVersionId: partialLocked.version.id },
      ]);
      const replaceInput = await admin.attendancePostedLeaveInput.findFirstOrThrow({
        where: {
          agencyId: agency.id,
          sourceType: 'LeaveCancellation',
          sourceId: lockedPartialCancellationId,
        },
      });
      expect(replaceInput).toMatchObject({
        dateFrom: new Date(`${lockedMonday}T00:00:00.000Z`),
        dateTo: new Date(`${addDays(lockedMonday, 1)}T00:00:00.000Z`),
      });
      expect(replaceInput.quantity.toFixed(4)).toBe('2.0000');
      expect(await postedDayTotals(lockedMonday)).toMatchObject({ postedLeaveMinutes: 480 });
      expect(await postedDayTotals(lockedWednesday)).toMatchObject({
        postedLeaveMinutes: 0,
        absenceMinutes: 480,
      });

      // Two pending handoffs over one locked period both authorize: the second
      // applies against the version the first authorization produced.
      const sharedMonday = nextMonday(91);
      const sharedTuesday = addDays(sharedMonday, 1);
      const sharedPostedIds = [
        await postSpecialLeave(sharedMonday),
        await postSpecialLeave(sharedTuesday),
      ];
      const sharedLock = await lockAttendance(sharedMonday, sharedTuesday);
      const sharedCorrectionIds: string[] = [];
      for (const [index, postedId] of sharedPostedIds.entries()) {
        const cancellationId = await requestApprovedCancellation(postedId, {
          scopeType: 'WHOLE',
          reason: 'Recalled after the period locked.',
          evidenceDocumentId: signedEvidence.documentId,
        });
        const applied = await applications.applyCancellation(
          applyContext,
          postedId,
          cancellationId,
          `apply-shared-${index}-${suffix}`,
        );
        sharedCorrectionIds.push(
          applied.cancellations
            .at(-1)!
            .effects.find(({ effectKind }) => effectKind === 'ATTENDANCE_LOCKED_CORRECTION')!
            .ownerRecordId,
        );
      }
      const firstShared = await attendanceCorrections.authorizeLocked(
        authorizerContext,
        sharedCorrectionIds[0]!,
        'Authorized.',
      );
      const secondShared = await attendanceCorrections.authorizeLocked(
        authorizerContext,
        sharedCorrectionIds[1]!,
        'Authorized.',
      );
      expect(firstShared.lockedAdjustment!.periods).toMatchObject([
        { predecessorPeriodVersionId: sharedLock.version.id },
      ]);
      expect(secondShared.lockedAdjustment!.periods).toMatchObject([
        {
          predecessorPeriodVersionId:
            firstShared.lockedAdjustment!.periods[0]!.successorPeriodVersionId,
        },
      ]);
      expect(await postedDayTotals(sharedMonday)).toMatchObject({ postedLeaveMinutes: 0 });
      expect(await postedDayTotals(sharedTuesday)).toMatchObject({ postedLeaveMinutes: 0 });

      // Mandatory leave: posting and applied cancellation re-evaluate the
      // Employee's assessment inline. A posting dated next year cannot change
      // this year's assessment, so the block runs while the dates stay in-year.
      const vacationThursday = addDays(monday, 3);
      const vacationFriday = addDays(monday, 4);
      const assessmentYear = Number(manilaDate(0).slice(0, 4));
      if (vacationFriday.startsWith(`${assessmentYear}-`)) {
        const vacationReview = await policies.createPolicyVersion(agencyContext, vacation.id, {
          effectiveDate: manilaDate(0),
          approvalRouteCode: reviewRouteCode,
          applicability: { profiles: ['ORDINARY_CIVILIAN_NGA'] },
          documentRequirements: {},
          reason: 'Route vacation leave through the three-step review.',
        });
        await policies.linkAuthority(agencyContext, vacation.id, vacationReview.id, {
          authorityClass: 'NATIONAL_RULE',
          documentId: nationalEvidence.documentId,
          citation: 'Rule XVI, sections 1-3',
        });
        await policies.activate(
          agencyContext,
          vacation.id,
          vacationReview.id,
          'Route vacation leave through review.',
        );
        const mandatoryType = await policies.create(agencyContext, {
          catalogueCode: 'MANDATORY_LEAVE',
        });
        const mandatoryVersion = await policies.createPolicyVersion(
          agencyContext,
          mandatoryType.id,
          {
            effectiveDate: manilaDate(-10),
            approvalRouteCode: reviewRouteCode,
            applicability: { profiles: ['ORDINARY_CIVILIAN_NGA'] },
            documentRequirements: {},
            reason: 'Adopt mandatory leave for the integration test.',
          },
        );
        await policies.linkAuthority(agencyContext, mandatoryType.id, mandatoryVersion.id, {
          authorityClass: 'NATIONAL_RULE',
          documentId: nationalEvidence.documentId,
          citation: 'Section 25',
        });
        await policies.linkAuthority(agencyContext, mandatoryType.id, mandatoryVersion.id, {
          authorityClass: 'AGENCY_CONFIGURATION',
          documentId: accountEvidence.documentId,
          citation: 'Agency mandatory-leave configuration for the integration test.',
        });
        await policies.activate(
          agencyContext,
          mandatoryType.id,
          mandatoryVersion.id,
          'Activate mandatory leave.',
        );
        const mandatoryLeave = new MandatoryLeaveAssessmentsService(
          mandatoryLeaveAssessmentAuditWriter,
        );
        await mandatoryLeave.evaluateAgencyYear(
          {
            ...agencyContext,
            permissions: [
              ...agencyContext.permissions,
              { code: 'leave.mandatory_assessments.evaluate', scopePolicy: 'AGENCY' as const },
            ],
          },
          assessmentYear,
        );
        const assessmentChain = () =>
          admin.mandatoryLeaveAssessment.findMany({
            where: { agencyId: agency.id, employeeId: employee.id, assessmentYear },
            orderBy: { assessedAt: 'asc' },
          });
        const fulfilledQuantities = async () =>
          (await assessmentChain()).map((row) => row.fulfilledQuantity?.toFixed(4) ?? null);
        const seeded = (await assessmentChain()).at(-1)!;
        expect(seeded).toMatchObject({ result: 'SUBJECT', leaveAccountId: account.id });
        expect(seeded.fulfilledQuantity?.toFixed(4)).toBe('0.0000');
        const ledgerBeforeVacation = await admin.leaveLedgerEntry.count({
          where: { agencyId: agency.id },
        });

        async function postLeave(dateFrom: string, dateTo: string, leaveTypeId = vacation.id) {
          const draft = await applications.create(agencyContext, {
            employeeId: employee.id,
            leaveTypeId,
          });
          const id = draft.application.id;
          await applications.update(agencyContext, id, {
            reason: 'Vacation leave toward the mandatory leave obligation.',
            commutationChoice: 'NOT_REQUESTED',
            periods: [{ dateFrom, dateTo }],
            documents: [
              { documentId: formEvidence.documentId, purposeCode: 'SIGNED_LEAVE_APPLICATION_FORM' },
              ...(leaveTypeId === mandatoryType.id
                ? [
                    {
                      documentId: signedEvidence.documentId,
                      purposeCode: 'SCHEDULE_OR_CLEARANCE_EVIDENCE' as const,
                    },
                  ]
                : []),
            ],
          });
          await applications.submit(employeeContext, id, submitInput);
          await applications.route(recorderContext, id);
          await applications.certify(recorderContext, id, {});
          await applications.recommend(supervisorContext, id, { outcome: 'RECOMMEND_APPROVAL' });
          await applications.decide(approverContext, id, { decision: 'APPROVE' });
          return applications.post(postingContext, id, `post-vacation-${id}`);
        }

        // Posting raises fulfillment; a partial cancellation lowers it.
        const twoDays = await postLeave(vacationThursday, vacationFriday);
        expect(await fulfilledQuantities()).toEqual(['0.0000', '2.0000']);
        const twoDaysId = twoDays.application.id;
        const twoDaysCancellationId = await requestApprovedCancellation(twoDaysId, {
          scopeType: 'PARTIAL',
          reason: 'Returning to duty on Friday.',
          evidenceDocumentId: signedEvidence.documentId,
          scopes: [
            {
              allocationLineId: twoDays.versions.at(-1)!.approvalAllocation!.lines[0]!.id,
              dateFrom: vacationFriday,
              dateTo: vacationFriday,
              quantity: '1',
            },
          ],
        });
        await applications.applyCancellation(
          applyContext,
          twoDaysId,
          twoDaysCancellationId,
          `apply-vacation-partial-${suffix}`,
        );
        expect(await fulfilledQuantities()).toEqual(['0.0000', '2.0000', '1.0000']);

        // A Mandatory Leave posting charges the vacation account and raises it; a
        // whole cancellation lowers it again; a retried apply writes no row.
        const oneDay = await postLeave(vacationFriday, vacationFriday, mandatoryType.id);
        expect(await fulfilledQuantities()).toEqual(['0.0000', '2.0000', '1.0000', '2.0000']);
        const oneDayId = oneDay.application.id;
        const oneDayCancellationId = await requestApprovedCancellation(oneDayId, {
          scopeType: 'WHOLE',
          reason: 'Recalled to duty on Friday.',
          evidenceDocumentId: signedEvidence.documentId,
        });
        for (let attempt = 0; attempt < 2; attempt += 1) {
          await applications.applyCancellation(
            applyContext,
            oneDayId,
            oneDayCancellationId,
            `apply-vacation-whole-${suffix}`,
          );
        }
        const chain = await assessmentChain();
        expect(chain.map((row) => row.fulfilledQuantity?.toFixed(4))).toEqual([
          '0.0000',
          '2.0000',
          '1.0000',
          '2.0000',
          '1.0000',
        ]);
        expect(chain.map((row) => row.previousAssessmentId)).toEqual([
          null,
          ...chain.slice(0, -1).map((row) => row.id),
        ]);
        // Re-evaluation writes no ledger entry of its own: two postings, one
        // reversal and replacement, and one reversal.
        await expect(
          admin.leaveLedgerEntry.count({ where: { agencyId: agency.id } }),
        ).resolves.toBe(ledgerBeforeVacation + 5);
      }

      // A partial approval of two working days over three working dates has no
      // placement Attendance may assume, so every affected Day blocks instead of
      // excusing three dates, and the Employee's attendance cannot be approved.
      await admin.leaveLedgerEntry.create({
        data: {
          agencyId: agency.id,
          leaveAccountId: specialAccount.id,
          quantity: 3,
          effectiveDate: new Date(`${manilaDate(-5)}T00:00:00.000Z`),
          sourceType: 'IntegrationFixture',
          sourceId: randomUUID(),
          sourcePostingKey: 'narrowed-approval-credits',
          policyVersionId: reviewPolicyVersion.id,
        },
      });
      const narrowedMonday = nextMonday(98);
      const narrowedDates = [0, 1, 2].map((offset) => addDays(narrowedMonday, offset));
      const narrowedDraft = await applications.create(agencyContext, {
        employeeId: employee.id,
        leaveTypeId: specialLeave.id,
      });
      const narrowedId = narrowedDraft.application.id;
      await applications.update(agencyContext, narrowedId, {
        reason: 'Three days requested; two approved.',
        commutationChoice: 'NOT_REQUESTED',
        periods: [{ dateFrom: narrowedDates[0]!, dateTo: narrowedDates[2]! }],
        documents: [
          { documentId: formEvidence.documentId, purposeCode: 'SIGNED_LEAVE_APPLICATION_FORM' },
        ],
      });
      await applications.submit(employeeContext, narrowedId, submitInput);
      await applications.route(recorderContext, narrowedId);
      await applications.certify(recorderContext, narrowedId, {});
      const narrowedRecommended = await applications.recommend(supervisorContext, narrowedId, {
        outcome: 'RECOMMEND_APPROVAL',
      });
      await applications.decide(approverContext, narrowedId, {
        decision: 'APPROVE',
        allocations: [
          {
            segmentId: narrowedRecommended.versions.at(-1)!.calculationSegments[0]!.id,
            quantity: '2',
          },
        ],
      });
      const narrowedPosting = await applications.post(
        postingContext,
        narrowedId,
        `post-narrowed-${suffix}`,
      );
      expect(narrowedPosting.versions.at(-1)!.approvalAllocation!.lines).toMatchObject([
        { quantity: '2.0000', unitCode: 'WORKING_DAY' },
      ]);
      const narrowedPeriod = await attendanceDays.calculate(attendanceContext, {
        periodCode: `LEAVE-NARROWED-${suffix}`,
        dateFrom: narrowedDates[0]!,
        dateTo: narrowedDates[2]!,
        employeeIds: [employee.id],
      });
      expect(
        narrowedPeriod.days.map(({ workDate, status, exceptionTypes }) => ({
          workDate,
          status,
          ambiguous: exceptionTypes.includes('AMBIGUOUS_LEAVE_QUANTITY'),
        })),
      ).toEqual(
        narrowedDates.map((workDate) => ({ workDate, status: 'EXCEPTION', ambiguous: true })),
      );
      for (const workDate of narrowedDates) {
        expect(await postedDayTotals(workDate)).toMatchObject({ postedLeaveMinutes: 0 });
      }
      const submitterContext = context(agency.id, user.id, membership.id, [
        { code: 'attendance.submissions.create', scopePolicy: 'OWN' },
        { code: 'attendance.submissions.submit', scopePolicy: 'OWN' },
      ]);
      const reviewerContext = context(agency.id, supervisorUser.id, supervisorMembership.id, [
        { code: 'attendance.submissions.approve', scopePolicy: 'AGENCY' },
      ]);
      const narrowedSubmission = await attendanceSubmissions.create(submitterContext, {
        attendancePeriodId: narrowedPeriod.period.id,
      });
      await attendanceSubmissions.submit(submitterContext, narrowedSubmission.submission.id);
      await expect(
        attendanceSubmissions.approve(reviewerContext, narrowedSubmission.submission.id, {}),
      ).rejects.toMatchObject({
        code: 'ATTENDANCE_SUBMISSION_NOT_APPROVABLE',
        statusCode: 409,
      });

      await expect(applications.findById(agencyContext, randomUUID())).resolves.toBeNull();
    } finally {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.outboxEvent.deleteMany({ where: { agencyId: { in: agencyIds } } });
        await transaction.lockedAttendanceAdjustmentPeriod.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.lockedAttendanceAdjustment.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.attendanceCorrectionEffect.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.attendanceCorrectionEvidence.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.attendanceCorrection.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.attendancePayrollFact.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.attendancePayrollPublication.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.dtrDocument.deleteMany({ where: { agencyId: { in: agencyIds } } });
        await transaction.attendancePeriodVersionDay.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.attendancePeriodVersion.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.employeeAttendanceSubmissionDay.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.employeeAttendanceSubmission.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.attendanceException.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.attendanceDaySegment.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.attendanceDay.deleteMany({ where: { agencyId: { in: agencyIds } } });
        await transaction.attendancePeriod.deleteMany({ where: { agencyId: { in: agencyIds } } });
        await transaction.leavePostingEffect.deleteMany({ where: { agencyId: { in: agencyIds } } });
        await transaction.attendancePostedLeaveInput.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.leavePosting.deleteMany({ where: { agencyId: { in: agencyIds } } });
        await transaction.auditEvent.deleteMany({ where: { agencyId: { in: agencyIds } } });
        await transaction.outboxEvent.deleteMany({ where: { agencyId: { in: agencyIds } } });
        await transaction.leaveCancellationEffect.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.leaveCancellationScope.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.leaveCancellationDocument.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.leaveCancellation.deleteMany({ where: { agencyId: { in: agencyIds } } });
        await transaction.leaveApplicationVersionDocument.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.leaveApprovalAllocationLine.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.leaveApprovalAllocation.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.leaveRecommendation.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.leaveCreditCertificationLine.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.leaveCreditCertification.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.leaveCalculationSegment.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.leaveEligibilityAssessment.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.leaveApplicationPeriod.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.leaveApplicationVersion.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.leaveApplicationDraftDocument.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.leaveApplicationDraftPeriod.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.leaveApplication.deleteMany({ where: { agencyId: { in: agencyIds } } });
        await transaction.approvalDecision.deleteMany({
          where: { approvalStep: { agencyId: { in: agencyIds } } },
        });
        await transaction.approvalStep.deleteMany({ where: { agencyId: { in: agencyIds } } });
        await transaction.approvalRequest.deleteMany({ where: { agencyId: { in: agencyIds } } });
        await transaction.approvalRouteVersion.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.leaveCreditCommitment.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.leaveLedgerAdjustment.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.leaveLedgerEntry.deleteMany({ where: { agencyId: { in: agencyIds } } });
        await transaction.leaveAccountOpening.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.mandatoryLeaveAssessment.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.leaveAccount.deleteMany({ where: { agencyId: { in: agencyIds } } });
        await transaction.leavePolicyAuthority.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.leavePolicyVersion.deleteMany({ where: { agencyId: { in: agencyIds } } });
        await transaction.leaveType.deleteMany({ where: { agencyId: { in: agencyIds } } });
        await transaction.scheduleAssignment.deleteMany({ where: { agencyId: { in: agencyIds } } });
        await transaction.holidayCalendarEntry.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.holidayCalendarVersion.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.holidayCalendar.deleteMany({ where: { agencyId: { in: agencyIds } } });
        await transaction.workArrangementVersion.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.workArrangement.deleteMany({ where: { agencyId: { in: agencyIds } } });
        await transaction.workScheduleBreakInterval.deleteMany({
          where: { dayRule: { agencyId: { in: agencyIds } } },
        });
        await transaction.workScheduleDayRule.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.workScheduleVersion.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.workSchedule.deleteMany({ where: { agencyId: { in: agencyIds } } });
        await transaction.documentVersion.deleteMany({ where: { agencyId: { in: agencyIds } } });
        await transaction.document.deleteMany({ where: { agencyId: { in: agencyIds } } });
        await transaction.employee.updateMany({
          where: { agencyId: { in: agencyIds } },
          data: { currentServiceSegmentId: null },
        });
        await transaction.serviceSegment.deleteMany({ where: { agencyId: { in: agencyIds } } });
        await transaction.membershipRole.deleteMany({ where: { agencyId: { in: agencyIds } } });
        await transaction.agencyMembership.deleteMany({ where: { agencyId: { in: agencyIds } } });
        await transaction.employee.deleteMany({ where: { agencyId: { in: agencyIds } } });
        await transaction.organizationUnit.updateMany({
          where: { agencyId: { in: agencyIds } },
          data: { currentVersionId: null },
        });
        await transaction.organizationUnitVersion.deleteMany({
          where: { agencyId: { in: agencyIds } },
        });
        await transaction.organizationUnit.deleteMany({ where: { agencyId: { in: agencyIds } } });
        await transaction.agency.deleteMany({ where: { id: { in: agencyIds } } });
        await transaction.user.deleteMany({
          where: {
            id: {
              in: [
                user.id,
                recorderUser.id,
                foreignUser.id,
                supervisorUser.id,
                approverUser.id,
                authorizerUser.id,
              ],
            },
          },
        });
      });
      await admin.$disconnect();
    }
  },
  60_000,
);
