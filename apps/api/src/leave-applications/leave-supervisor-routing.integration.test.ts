import { Prisma, PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { expect, it } from 'vitest';
import { requestDatabaseContext } from '../database-context';
import { findDirectReportEmployeeIds, findSupervisorEmployeeIds } from '../direct-reports';
import { AttendancePostedLeaveInputsService } from '../attendance-posted-leave-inputs/attendance-posted-leave-inputs.service';
import { attendanceContextAuditWriter } from '../attendance-contexts/attendance-contexts.audit';
import { AttendanceContextsService } from '../attendance-contexts/attendance-contexts.service';
import { attendanceDayAuditWriter } from '../attendance-days/attendance-days.audit';
import { AttendanceDaysService } from '../attendance-days/attendance-days.service';
import { attendanceAuditWriter } from '../attendance/attendance.audit';
import { AttendanceService } from '../attendance/attendance.service';
import { attendanceCorrectionAuditWriter } from '../attendance-corrections/attendance-corrections.audit';
import { AttendanceCorrectionsService } from '../attendance-corrections/attendance-corrections.service';
import { attendancePeriodAuditWriter } from '../attendance-periods/attendance-periods.audit';
import { AttendancePeriodsService } from '../attendance-periods/attendance-periods.service';
import { dtrAuditWriter } from '../dtrs/dtrs.audit';
import { DtrsService } from '../dtrs/dtrs.service';
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
import {
  mandatoryLeaveAssessmentAuditWriter,
  MandatoryLeaveAssessmentsService,
} from '../mandatory-leave-assessments/mandatory-leave-assessments.service';
import {
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
    requestId: 'leave-supervisor-routing-integration-test',
    userId,
    agencyId,
    membershipId,
    primaryOrganizationUnitId: null,
    permissions,
  };
}

const OWN_APPLICATION_PERMISSIONS: RequestContext['permissions'] = [
  { code: 'leave.applications.create', scopePolicy: 'OWN' },
  { code: 'leave.applications.submit', scopePolicy: 'OWN' },
  { code: 'approvals.routes.read', scopePolicy: 'OWN' },
  { code: 'approvals.requests.create', scopePolicy: 'OWN' },
];

async function createAdminClient(): Promise<PrismaClient> {
  const databaseUrl =
    process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
  if (!databaseUrl) throw new Error('A database owner URL is required for the integration test.');
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

it.skipIf(!enabled)(
  "routes Leave recommendation to the applicant's Supervisor, falling back to the Agency role",
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-leave-supervisor`;
    const agency = await admin.agency.create({
      data: {
        code: `LSUP-${suffix}`,
        name: 'Leave Supervisor Routing Agency',
        agencyType: 'NGA',
        status: 'ACTIVE',
      },
    });
    const userIds: string[] = [];
    const member = async (name: string) => {
      const user = await admin.user.create({
        data: {
          emailNormalized: `${name.toLowerCase().replace(/\W+/g, '-')}-${suffix}@example.test`,
          displayName: name,
          globalStatus: 'ACTIVE',
        },
      });
      userIds.push(user.id);
      const membership = await admin.agencyMembership.create({
        data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
      });
      return { userId: user.id, membershipId: membership.id };
    };
    const grantRole = (membershipId: string, roleId: string) =>
      admin.membershipRole.create({
        data: { agencyId: agency.id, membershipId, roleId, effectiveFrom: new Date('2020-01-01') },
      });

    const hr = await member('Leave HR Officer');
    const approver = await member('Leave Approving Officer');
    const fallback = await member('Leave Fallback Recommender');
    const hrmoRole = await admin.role.findFirstOrThrow({
      where: { agencyId: null, code: 'hrmo_administrator' },
    });
    const supervisorRole = await admin.role.findFirstOrThrow({
      where: { agencyId: null, code: 'supervisor' },
    });
    // The fallback role is held by exactly one Membership, so the ROLE step resolves.
    const fallbackRole = await admin.role.create({
      data: {
        agencyId: agency.id,
        code: `leave_recommender_${suffix}`,
        name: 'Leave Recommender',
        status: 'ACTIVE',
      },
    });
    const recommendPermissions = await admin.permission.findMany({
      where: { code: { in: ['leave.applications.recommend', 'leave.applications.return'] } },
    });
    await admin.rolePermission.createMany({
      data: recommendPermissions.map((permission) => ({
        roleId: fallbackRole.id,
        permissionId: permission.id,
        scopePolicy: 'AGENCY',
      })),
    });
    await grantRole(hr.membershipId, hrmoRole.id);
    await grantRole(approver.membershipId, hrmoRole.id);
    await grantRole(fallback.membershipId, fallbackRole.id);

    try {
      const unit = async (code: string, parentUnitId: string | null, headPositionId: string) => {
        const record = await admin.organizationUnit.create({
          data: {
            agencyId: agency.id,
            code: `${code}-${suffix}`,
            unitType: 'DIVISION',
            status: 'ACTIVE',
          },
        });
        const version = await admin.organizationUnitVersion.create({
          data: {
            agencyId: agency.id,
            organizationUnitId: record.id,
            versionNo: 1,
            name: code,
            parentUnitId,
            headPositionId,
            effectiveFrom: new Date('2020-01-01'),
            status: 'ACTIVE',
            domainStatus: 'ACTIVE',
          },
        });
        await admin.organizationUnit.update({
          where: { id: record.id },
          data: { currentVersionId: version.id },
        });
        return record;
      };
      // Plantilla Position projections normally require the application service.
      const position = (itemNumber: string) =>
        admin.$transaction(async (transaction) => {
          await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
          return transaction.plantillaPosition.create({
            data: {
              agencyId: agency.id,
              itemNumber: `${itemNumber}-${suffix}`,
              status: 'OCCUPIED',
              createdByMembershipId: hr.membershipId,
              updatedByMembershipId: hr.membershipId,
            },
          });
        });
      const personnel = <T>(work: (transaction: Prisma.TransactionClient) => Promise<T>) =>
        withDatabaseContext(
          {
            agencyId: agency.id,
            membershipId: hr.membershipId,
            capabilities: ['personnel-baseline-transition'],
          },
          work,
        );
      const serve = (
        employeeId: string,
        organizationUnitId: string,
        options: { positionId?: string; segmentType?: string } = {},
      ) =>
        personnel(async (transaction) => {
          const segment = await transaction.serviceSegment.create({
            data: {
              agencyId: agency.id,
              employeeId,
              organizationUnitId,
              positionId: options.positionId ?? null,
              segmentType: options.segmentType ?? 'PRIMARY',
              appointmentStatus: 'PERMANENT',
              salaryGrade: 18,
              salaryStep: 2,
              effectiveFrom: new Date('2020-01-01'),
              status: 'ACTIVE',
              createdByMembershipId: hr.membershipId,
            },
          });
          if (options.positionId) {
            await transaction.positionIncumbency.create({
              data: {
                agencyId: agency.id,
                positionId: options.positionId,
                employeeId,
                serviceSegmentId: segment.id,
                effectiveFrom: new Date('2020-01-01'),
                status: 'ACTIVE',
                createdByMembershipId: hr.membershipId,
              },
            });
          }
        });
      const employee = async (name: string) => {
        const record = await admin.employee.create({
          data: {
            agencyId: agency.id,
            employeeNumber: `EMP-${name.replace(/\W+/g, '')}-${suffix}`,
            legalName: name,
            birthDate: new Date('1990-01-01'),
            sex: 'FEMALE',
            civilStatus: 'SINGLE',
            contactEmail: `${name.toLowerCase().replace(/\W+/g, '-')}-${suffix}@example.test`,
            serviceStatus: 'ACTIVE',
            createdByMembershipId: hr.membershipId,
            updatedByMembershipId: hr.membershipId,
          },
        });
        const account = await member(name);
        await withDatabaseContext(
          {
            agencyId: agency.id,
            userId: account.userId,
            membershipId: account.membershipId,
            capabilities: ['employee-membership-link'],
          },
          (transaction) =>
            transaction.agencyMembership.update({
              where: { agencyId_id: { agencyId: agency.id, id: account.membershipId } },
              data: { employeeId: record.id },
            }),
        );
        return { id: record.id, ...account };
      };

      // Division (Chief) > Section (Section Head); a unit with a vacant head; another
      // division whose Chief also heads Dual's concurrent SECONDARY segment.
      const chiefPosition = await position('CHIEF');
      const sectionHeadPosition = await position('SECTION-HEAD');
      const vacantHeadPosition = await position('VACANT-HEAD');
      const otherChiefPosition = await position('OTHER-CHIEF');
      const division = await unit('DIV', null, chiefPosition.id);
      const section = await unit('SEC', division.id, sectionHeadPosition.id);
      const vacantUnit = await unit('VACANT', null, vacantHeadPosition.id);
      const otherDivision = await unit('OTHER', null, otherChiefPosition.id);

      const chief = await employee('Dana Chief');
      const sectionHead = await employee('Sam Section Head');
      const otherChief = await employee('Olive Other Chief');
      const report = await employee('Rina Report');
      const transferred = await employee('Tomas Transferred');
      const orphan = await employee('Vera Vacant');
      const dual = await employee('Dino Dual');
      await serve(chief.id, division.id, { positionId: chiefPosition.id });
      await serve(sectionHead.id, section.id, { positionId: sectionHeadPosition.id });
      await serve(otherChief.id, otherDivision.id, { positionId: otherChiefPosition.id });
      await serve(report.id, division.id);
      await serve(transferred.id, division.id);
      await serve(orphan.id, vacantUnit.id);
      await serve(dual.id, division.id);
      await serve(dual.id, otherDivision.id, { segmentType: 'SECONDARY' });
      await grantRole(chief.membershipId, supervisorRole.id);
      await grantRole(otherChief.membershipId, supervisorRole.id);
      const employees = [chief, sectionHead, otherChief, report, transferred, orphan, dual];

      const hrContext = context(agency.id, hr.userId, hr.membershipId, [
        { code: 'attendance.configuration.read', scopePolicy: 'AGENCY' },
        { code: 'attendance.configuration.manage', scopePolicy: 'AGENCY' },
        { code: 'attendance.configuration.activate', scopePolicy: 'AGENCY' },
        { code: 'attendance.assignments.manage', scopePolicy: 'AGENCY' },
        { code: 'documents.evidence.read', scopePolicy: 'AGENCY' },
        { code: 'leave.types.read', scopePolicy: 'AGENCY' },
        { code: 'leave.types.manage', scopePolicy: 'AGENCY' },
        { code: 'leave.accounts.read', scopePolicy: 'AGENCY' },
        { code: 'leave.credits.adjust', scopePolicy: 'AGENCY' },
        { code: 'leave.credits.certify', scopePolicy: 'AGENCY' },
        { code: 'approvals.routes.read', scopePolicy: 'AGENCY' },
        { code: 'approvals.routes.create', scopePolicy: 'AGENCY' },
        { code: 'approvals.routes.activate', scopePolicy: 'AGENCY' },
        { code: 'approvals.requests.read', scopePolicy: 'AGENCY' },
        { code: 'leave.applications.create', scopePolicy: 'AGENCY' },
        { code: 'leave.applications.route', scopePolicy: 'AGENCY' },
      ]);
      const employeeContext = (target: { userId: string; membershipId: string }) =>
        context(agency.id, target.userId, target.membershipId, OWN_APPLICATION_PERMISSIONS);
      const chiefContext = context(agency.id, chief.userId, chief.membershipId, [
        ...OWN_APPLICATION_PERMISSIONS,
        { code: 'leave.applications.recommend', scopePolicy: 'DIRECT_REPORTS' },
        { code: 'leave.applications.return', scopePolicy: 'DIRECT_REPORTS' },
      ]);
      const fallbackContext = context(agency.id, fallback.userId, fallback.membershipId, [
        { code: 'approvals.requests.read', scopePolicy: 'AGENCY' },
        { code: 'leave.applications.recommend', scopePolicy: 'AGENCY' },
        { code: 'leave.applications.return', scopePolicy: 'AGENCY' },
      ]);

      // The inverse lookup agrees with the direct-report lookup on the same data.
      const today = manilaDate(0);
      await withDatabaseContext(requestDatabaseContext(hrContext), async (transaction) => {
        for (const supervisor of employees) {
          const reports = await findDirectReportEmployeeIds(
            transaction,
            agency.id,
            supervisor.id,
            today,
          );
          for (const subject of employees) {
            const supervisors = await findSupervisorEmployeeIds(
              transaction,
              agency.id,
              subject.id,
              today,
            );
            expect(supervisors.includes(supervisor.id)).toBe(reports.includes(subject.id));
          }
        }
        await expect(
          findSupervisorEmployeeIds(transaction, agency.id, report.id, today),
        ).resolves.toEqual([chief.id]);
        await expect(
          findSupervisorEmployeeIds(transaction, agency.id, sectionHead.id, today),
        ).resolves.toEqual([chief.id]);
        await expect(
          findSupervisorEmployeeIds(transaction, agency.id, chief.id, today),
        ).resolves.toEqual([]);
        await expect(
          findSupervisorEmployeeIds(transaction, agency.id, orphan.id, today),
        ).resolves.toEqual([]);
        expect(
          (await findSupervisorEmployeeIds(transaction, agency.id, dual.id, today)).sort(),
        ).toEqual([chief.id, otherChief.id].sort());
      });

      const documents = new DocumentsService({} as never, documentAuditWriter);
      const schedules = new WorkSchedulesService(attendanceConfigurationAuditWriter, documents);
      const arrangements = new WorkArrangementsService(
        attendanceConfigurationAuditWriter,
        documents,
      );
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
      const mandatoryLeave = new MandatoryLeaveAssessmentsService(
        mandatoryLeaveAssessmentAuditWriter,
      );
      const policies = new LeavePoliciesService(leavePolicyAuditWriter, documents, mandatoryLeave);
      const accounts = new LeaveAccountsService(leaveAccountAuditWriter, documents, mandatoryLeave);
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
        mandatoryLeave,
      );
      applications.onModuleInit();

      const evidence = async (name: string) => {
        const document = await admin.document.create({
          data: {
            agencyId: agency.id,
            documentType: 'LEAVE_EVIDENCE',
            classification: 'INTERNAL',
            status: 'APPROVED',
            createdByMembershipId: hr.membershipId,
          },
        });
        const version = await admin.documentVersion.create({
          data: {
            agencyId: agency.id,
            documentId: document.id,
            versionNo: 1,
            storageKey: `leave-supervisor-routing/${suffix}-${name}`,
            contentHash: 'f'.repeat(64),
            mimeType: 'application/pdf',
            sizeBytes: 1,
            issuedAt: new Date(`${manilaDate(-30)}T00:00:00.000Z`),
            createdByMembershipId: hr.membershipId,
          },
        });
        await admin.document.update({
          where: { id: document.id },
          data: { currentVersionId: version.id },
        });
        return { documentId: document.id, versionId: version.id };
      };
      const authority = {
        approvingAuthority: 'Office of the President',
        reason: 'Authority reviewed.',
      };

      const effectiveFrom = manilaDate(-30);
      const calendar = await calendars.create(hrContext, {
        code: `PH-${suffix}`,
        name: 'Agency Holiday Calendar',
        scopeType: 'AGENCY',
        scopeReference: 'Agency-wide',
        effectiveDate: effectiveFrom,
        entries: [
          {
            holidayDate: manilaDate(-1),
            name: 'Special Non-Working Day',
            dayType: 'SPECIAL_NON_WORKING',
            sourceReference: 'Proclamation No. 45',
          },
        ],
      });
      await calendars.activate(hrContext, calendar.id, calendar.draft!.id, {
        authorityDocumentVersionId: (await evidence('calendar')).versionId,
        ...authority,
      });
      const schedule = await schedules.create(hrContext, {
        code: `ORD-${suffix}`,
        name: 'Ordinary Work Schedule',
        scheduleType: 'REGULAR',
        effectiveDate: effectiveFrom,
        dayRules: dayRules(),
      });
      const scheduleActive = await schedules.activate(hrContext, schedule.id, schedule.draft!.id, {
        authorityDocumentVersionId: (await evidence('schedule')).versionId,
        ...authority,
      });
      const arrangement = await arrangements.create(hrContext, {
        code: `ONSITE-${suffix}`,
        name: 'Onsite Work Arrangement',
        arrangementType: 'ONSITE',
        permittedScheduleTypes: ['REGULAR'],
        holidayCalendarId: calendar.id,
        effectiveDate: effectiveFrom,
      });
      const arrangementActive = await arrangements.activate(
        hrContext,
        arrangement.id,
        arrangement.draft!.id,
        { authorityDocumentVersionId: (await evidence('arrangement')).versionId, ...authority },
      );

      const routeCode = `LEAVE-SUPERVISOR-ROUTE-${suffix}`;
      const leaveType = await policies.create(hrContext, {
        catalogueCode: 'SPECIAL_PRIVILEGE_LEAVE',
      });
      const policyVersion = await policies.createPolicyVersion(hrContext, leaveType.id, {
        effectiveDate: manilaDate(-10),
        approvalRouteCode: routeCode,
        applicability: { profiles: ['ORDINARY_CIVILIAN_NGA'] },
        documentRequirements: {},
        reason: 'Adopt the special privilege leave policy for the routing test.',
      });
      const nationalEvidence = await evidence('national');
      await policies.linkAuthority(hrContext, leaveType.id, policyVersion.id, {
        authorityClass: 'NATIONAL_RULE',
        documentId: nationalEvidence.documentId,
        citation: 'Rule XVI, section 5',
      });
      await policies.activate(
        hrContext,
        leaveType.id,
        policyVersion.id,
        'Activate special privilege leave.',
      );
      const route = await approvals.createRoute(hrContext, {
        routeCode,
        domain: 'LEAVE',
        versionNo: 1,
        effectiveFrom,
        stepDefinition: {
          steps: [
            {
              stepNo: 1,
              stepMode: 'SEQUENTIAL',
              requiredPermission: 'leave.credits.certify',
              assignment: { kind: 'MEMBERSHIP', membershipId: hr.membershipId },
              requiresSeparateReview: true,
            },
            {
              stepNo: 2,
              stepMode: 'SEQUENTIAL',
              requiredPermission: 'leave.applications.recommend',
              returnPermission: 'leave.applications.return',
              assignment: { kind: 'SUBJECT_SUPERVISOR', roleCode: fallbackRole.code },
              requiresSeparateReview: true,
            },
            {
              stepNo: 3,
              stepMode: 'SEQUENTIAL',
              requiredPermission: 'leave.applications.approve',
              assignment: { kind: 'MEMBERSHIP', membershipId: approver.membershipId },
              requiresSeparateReview: true,
            },
          ],
        },
      });
      await approvals.activateRoute(hrContext, route.id, 'Activate the supervisor leave route.');

      const formEvidence = await evidence('form');
      const templateEvidence = await evidence('template');
      const assignmentEvidence = await evidence('assignment');
      const accountEvidence = await evidence('account');
      const monday = nextMonday(1);
      for (const target of employees) {
        await assignments.create(
          hrContext,
          {
            employeeId: target.id,
            workScheduleVersionId: scheduleActive.currentVersion!.id,
            workArrangementVersionId: arrangementActive.currentVersion!.id,
            authorityDocumentVersionId: assignmentEvidence.versionId,
            effectiveFrom,
          },
          `assignment-${target.id}`,
        );
        await accounts.open(
          hrContext,
          {
            employeeId: target.id,
            leaveTypeId: leaveType.id,
            effectiveDate: manilaDate(-5),
            openingQuantity: 5,
            evidenceDocumentId: accountEvidence.documentId,
            reason: 'Opening special privilege leave credits.',
          },
          `open-${target.id}`,
        );
      }

      // Submit through certification; the recommendation step is then active.
      const certifiedApplication = async (target: (typeof employees)[number]) => {
        const created = await applications.create(hrContext, {
          employeeId: target.id,
          leaveTypeId: leaveType.id,
        });
        const applicationId = created.application.id;
        await applications.update(hrContext, applicationId, {
          reason: 'Special privilege leave.',
          commutationChoice: 'NOT_REQUESTED',
          periods: [{ dateFrom: monday, dateTo: monday }],
          documents: [
            { documentId: formEvidence.documentId, purposeCode: 'SIGNED_LEAVE_APPLICATION_FORM' },
          ],
        });
        await applications.submit(
          target === chief ? chiefContext : employeeContext(target),
          applicationId,
          {
            formTemplateDocumentVersionId: templateEvidence.versionId,
            attestation: { type: 'AUTHENTICATED_SUBMISSION' },
          },
        );
        await applications.route(hrContext, applicationId);
        const certified = await applications.certify(hrContext, applicationId, {});
        expect(certified.application.status).toBe('FOR_RECOMMENDATION');
        return {
          applicationId,
          recommendationStep: certified.versions.at(-1)!.approvalSteps[1]!,
        };
      };

      // A direct report's application is assigned to and recommended by their Supervisor.
      const fromReport = await certifiedApplication(report);
      expect(fromReport.recommendationStep).toMatchObject({
        assignedMembershipId: chief.membershipId,
        assignedRoleCode: 'supervisor',
        status: 'ACTIVE',
      });
      await expect(
        applications.recommend(fallbackContext, fromReport.applicationId, {
          outcome: 'RECOMMEND_APPROVAL',
        }),
      ).rejects.toMatchObject({ code: 'APPROVAL_AUTHORITY_REQUIRED', statusCode: 403 });
      const recommended = await applications.recommend(chiefContext, fromReport.applicationId, {
        outcome: 'RECOMMEND_APPROVAL',
        comments: 'Within the approved schedule.',
      });
      expect(recommended.application.status).toBe('FOR_APPROVAL');
      expect(recommended.versions.at(-1)!.recommendation).toMatchObject({
        outcome: 'RECOMMEND_APPROVAL',
      });
      expect(recommended.versions.at(-1)!.approvalSteps[1]!.decisions).toMatchObject([
        { decidedByMembershipId: chief.membershipId, decision: 'APPROVE' },
      ]);

      // A unit head reports to the head of the parent unit.
      const fromSectionHead = await certifiedApplication(sectionHead);
      expect(fromSectionHead.recommendationStep.assignedMembershipId).toBe(chief.membershipId);
      await expect(
        applications.recommend(chiefContext, fromSectionHead.applicationId, {
          outcome: 'RECOMMEND_APPROVAL',
        }),
      ).resolves.toMatchObject({ application: { status: 'FOR_APPROVAL' } });

      // With a vacant unit head, or more than one Supervisor, the Agency role holder recommends.
      for (const target of [orphan, dual]) {
        const fallbackApplication = await certifiedApplication(target);
        expect(fallbackApplication.recommendationStep).toMatchObject({
          assignedMembershipId: fallback.membershipId,
          assignedRoleCode: fallbackRole.code,
        });
        await expect(
          applications.recommend(fallbackContext, fallbackApplication.applicationId, {
            outcome: 'RECOMMEND_APPROVAL',
          }),
        ).resolves.toMatchObject({ application: { status: 'FOR_APPROVAL' } });
      }

      // A Supervisor's own application never routes to themselves (ADR 0007 excludes self).
      const fromChief = await certifiedApplication(chief);
      expect(fromChief.recommendationStep.assignedMembershipId).toBe(fallback.membershipId);
      await expect(
        applications.recommend(chiefContext, fromChief.applicationId, {
          outcome: 'RECOMMEND_APPROVAL',
        }),
      ).rejects.toMatchObject({ code: 'LEAVE_APPLICATION_SEPARATION_REQUIRED', statusCode: 403 });

      // An Employee who has left the unit by the decision date is no longer a direct report.
      const fromTransferred = await certifiedApplication(transferred);
      expect(fromTransferred.recommendationStep.assignedMembershipId).toBe(chief.membershipId);
      await personnel(async (transaction) => {
        await transaction.serviceSegment.updateMany({
          where: { agencyId: agency.id, employeeId: transferred.id, status: 'ACTIVE' },
          data: { status: 'CLOSED', effectiveTo: new Date(manilaDate(-1)) },
        });
        await transaction.serviceSegment.create({
          data: {
            agencyId: agency.id,
            employeeId: transferred.id,
            organizationUnitId: otherDivision.id,
            appointmentStatus: 'PERMANENT',
            salaryGrade: 18,
            salaryStep: 2,
            effectiveFrom: new Date(today),
            status: 'ACTIVE',
            createdByMembershipId: hr.membershipId,
          },
        });
      });
      await expect(
        applications.recommend(chiefContext, fromTransferred.applicationId, {
          outcome: 'RECOMMEND_APPROVAL',
        }),
      ).rejects.toMatchObject({ code: 'APPROVAL_AUTHORITY_REQUIRED', statusCode: 403 });
      await expect(
        applications.returnToApplicant(chiefContext, fromTransferred.applicationId, {
          reason: 'Attach the approved leave schedule.',
        }),
      ).rejects.toMatchObject({ code: 'APPROVAL_AUTHORITY_REQUIRED', statusCode: 403 });
      await expect(
        admin.leaveApplication.findUniqueOrThrow({
          where: { id: fromTransferred.applicationId },
          select: { status: true },
        }),
      ).resolves.toEqual({ status: 'FOR_RECOMMENDATION' });

      // The Supervisor role carries both grants with direct-report scope only.
      const grants = await admin.rolePermission.findMany({
        where: {
          roleId: supervisorRole.id,
          permission: {
            code: { in: ['leave.applications.recommend', 'leave.applications.return'] },
          },
        },
        select: { scopePolicy: true, permission: { select: { code: true } } },
      });
      expect(grants.map((grant) => `${grant.permission.code}:${grant.scopePolicy}`).sort()).toEqual(
        ['leave.applications.recommend:DIRECT_REPORTS', 'leave.applications.return:DIRECT_REPORTS'],
      );
    } finally {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        const scoped = { where: { agencyId: agency.id } };
        await transaction.outboxEvent.deleteMany(scoped);
        await transaction.auditEvent.deleteMany(scoped);
        await transaction.leaveApplicationVersionDocument.deleteMany(scoped);
        await transaction.leaveApprovalAllocationLine.deleteMany(scoped);
        await transaction.leaveApprovalAllocation.deleteMany(scoped);
        await transaction.leaveRecommendation.deleteMany(scoped);
        await transaction.leaveCreditCertificationLine.deleteMany(scoped);
        await transaction.leaveCreditCertification.deleteMany(scoped);
        await transaction.leaveCalculationSegment.deleteMany(scoped);
        await transaction.leaveEligibilityAssessment.deleteMany(scoped);
        await transaction.leaveApplicationPeriod.deleteMany(scoped);
        await transaction.leaveApplicationVersion.deleteMany(scoped);
        await transaction.leaveApplicationDraftDocument.deleteMany(scoped);
        await transaction.leaveApplicationDraftPeriod.deleteMany(scoped);
        await transaction.leaveApplication.deleteMany(scoped);
        await transaction.approvalDecision.deleteMany({
          where: { approvalStep: { agencyId: agency.id } },
        });
        await transaction.approvalStep.deleteMany(scoped);
        await transaction.approvalRequest.deleteMany(scoped);
        await transaction.approvalRouteVersion.deleteMany(scoped);
        await transaction.leaveCreditCommitment.deleteMany(scoped);
        await transaction.leaveLedgerAdjustment.deleteMany(scoped);
        await transaction.leaveLedgerEntry.deleteMany(scoped);
        await transaction.leaveAccountOpening.deleteMany(scoped);
        await transaction.mandatoryLeaveAssessment.deleteMany(scoped);
        await transaction.leaveAccount.deleteMany(scoped);
        await transaction.leavePolicyAuthority.deleteMany(scoped);
        await transaction.leavePolicyVersion.deleteMany(scoped);
        await transaction.leaveType.deleteMany(scoped);
        await transaction.scheduleAssignment.deleteMany(scoped);
        await transaction.holidayCalendarEntry.deleteMany(scoped);
        await transaction.holidayCalendarVersion.deleteMany(scoped);
        await transaction.holidayCalendar.deleteMany(scoped);
        await transaction.workArrangementVersion.deleteMany(scoped);
        await transaction.workArrangement.deleteMany(scoped);
        await transaction.workScheduleBreakInterval.deleteMany({
          where: { dayRule: { agencyId: agency.id } },
        });
        await transaction.workScheduleDayRule.deleteMany(scoped);
        await transaction.workScheduleVersion.deleteMany(scoped);
        await transaction.workSchedule.deleteMany(scoped);
        await transaction.documentVersion.deleteMany(scoped);
        await transaction.document.deleteMany(scoped);
        await transaction.agencyMembership.updateMany({
          where: { agencyId: agency.id },
          data: { employeeId: null },
        });
        await transaction.employee.updateMany({
          where: { agencyId: agency.id },
          data: { currentServiceSegmentId: null },
        });
        await transaction.positionIncumbency.deleteMany(scoped);
        await transaction.serviceSegment.deleteMany(scoped);
        await transaction.organizationUnit.updateMany({
          where: { agencyId: agency.id },
          data: { currentVersionId: null },
        });
        await transaction.organizationUnitVersion.deleteMany(scoped);
        await transaction.organizationUnit.deleteMany(scoped);
        await transaction.plantillaPosition.deleteMany(scoped);
        await transaction.membershipRole.deleteMany(scoped);
        await transaction.rolePermission.deleteMany({ where: { role: { agencyId: agency.id } } });
        await transaction.role.deleteMany(scoped);
        await transaction.agencyMembership.deleteMany(scoped);
        await transaction.employee.deleteMany(scoped);
        await transaction.agency.deleteMany({ where: { id: agency.id } });
        await transaction.user.deleteMany({ where: { id: { in: userIds } } });
      });
      await admin.$disconnect();
    }
  },
  120_000,
);
