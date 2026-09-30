import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
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
  'prepares, submits, records, and withdraws Leave Applications under RLS',
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
        identityProvider: 'leave-application-integration',
        externalSubject: `leave-application-${suffix}`,
        emailNormalized: `leave-application-${suffix}@example.test`,
        displayName: 'Leave Application Employee',
        globalStatus: 'ACTIVE',
      },
    });
    const recorderUser = await admin.user.create({
      data: {
        identityProvider: 'leave-application-integration',
        externalSubject: `leave-recorder-${suffix}`,
        emailNormalized: `leave-recorder-${suffix}@example.test`,
        displayName: 'Leave Application Recorder',
        globalStatus: 'ACTIVE',
      },
    });
    const foreignUser = await admin.user.create({
      data: {
        identityProvider: 'leave-application-integration',
        externalSubject: `foreign-leave-application-${suffix}`,
        emailNormalized: `foreign-leave-application-${suffix}@example.test`,
        displayName: 'Foreign Leave Application Custodian',
        globalStatus: 'ACTIVE',
      },
    });
    const supervisorUser = await admin.user.create({
      data: {
        identityProvider: 'leave-application-integration',
        externalSubject: `leave-supervisor-${suffix}`,
        emailNormalized: `leave-supervisor-${suffix}@example.test`,
        displayName: 'Leave Application Supervisor',
        globalStatus: 'ACTIVE',
      },
    });
    const approverUser = await admin.user.create({
      data: {
        identityProvider: 'leave-application-integration',
        externalSubject: `leave-approver-${suffix}`,
        emailNormalized: `leave-approver-${suffix}@example.test`,
        displayName: 'Leave Application Approver',
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
      data: [supervisorMembership, approverMembership].map((target) => ({
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
    const policies = new LeavePoliciesService(leavePolicyAuditWriter, documents);
    const accounts = new LeaveAccountsService(leaveAccountAuditWriter, documents);
    const applications = new LeaveApplicationsService(
      leaveApplicationAuditWriter,
      documents,
      approvals,
      completionRegistry,
      schedules,
      arrangements,
      calendars,
    );
    applications.onModuleInit();

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

      // Applying posted leave through the unposted command fails closed and records a blocking cause.
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
      ).rejects.toMatchObject({ code: 'LEAVE_CANCELLATION_POSTED_EFFECTS_REQUIRED' });
      const blocked = await applications.findById(recorderContext, excessApplicationId);
      expect(blocked!.application.status).toBe('CANCEL_REQUESTED');
      expect(blocked!.cancellations.at(-1)).toMatchObject({
        decisionStatus: 'APPROVED',
        effectStatus: 'FAILED',
        lastEffectFailureKind: 'BLOCKING',
        lastEffectFailureCode: 'LEAVE_CANCELLATION_POSTED_EFFECTS_REQUIRED',
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

      await expect(applications.findById(agencyContext, randomUUID())).resolves.toBeNull();
    } finally {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
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
              in: [user.id, recorderUser.id, foreignUser.id, supervisorUser.id, approverUser.id],
            },
          },
        });
      });
      await admin.$disconnect();
    }
  },
);
