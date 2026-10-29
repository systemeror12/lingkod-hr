/** Shared fixtures for the Overtime Authority DB-backed integration tests. */
import { HttpException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import {
  approvalAuditWriter,
  ApprovalCompletionRegistry,
  ApprovalsService,
} from '../approvals/approval.service';
import { ApproveOvertimeAuthorityService } from './approve-overtime-authority.service';
import { CancelOvertimeAuthorityService } from './cancel-overtime-authority.service';
import { CreateOvertimeAuthorityService } from './create-overtime-authority.service';
import { overtimeAuthorityAuditWriter } from './overtime-authorities.audit';
import { OvertimeAuthoritiesController } from './overtime-authorities.controller';
import { registerOvertimeAuthorityApproval } from './overtime-authority-approval';
import { OVERTIME_AUTHORITY_ROUTE_CODE } from './overtime-authorities.types';
import { ReadOvertimeAuthoritiesService } from './read-overtime-authorities.service';
import { RejectOvertimeAuthorityService } from './reject-overtime-authority.service';
import { ReviewOvertimeAuthorityService } from './review-overtime-authority.service';
import { SubmitOvertimeAuthorityService } from './submit-overtime-authority.service';
import { UpdateOvertimeAuthorityService } from './update-overtime-authority.service';

export const enabled = process.env.DATABASE_E2E === 'true';

const COMMANDS = [
  'overtime.authorities.create',
  'overtime.authorities.submit',
  'overtime.authorities.cancel',
] as const;

export function grants(scopePolicy: 'AGENCY' | 'DIRECT_REPORTS'): RequestContext['permissions'] {
  return COMMANDS.map((code) => ({ code, scopePolicy }));
}

export function context(
  agencyId: string,
  userId: string,
  membershipId: string,
  permissions: RequestContext['permissions'],
): RequestContext {
  return {
    requestId: 'overtime-authority-integration-test',
    userId,
    agencyId,
    membershipId,
    primaryOrganizationUnitId: null,
    permissions,
  };
}

export function services() {
  const registry = new ApprovalCompletionRegistry();
  registerOvertimeAuthorityApproval(registry);
  const approvals = new ApprovalsService(approvalAuditWriter, registry);
  const create = new CreateOvertimeAuthorityService(overtimeAuthorityAuditWriter);
  const update = new UpdateOvertimeAuthorityService(overtimeAuthorityAuditWriter);
  const submit = new SubmitOvertimeAuthorityService(overtimeAuthorityAuditWriter);
  const cancel = new CancelOvertimeAuthorityService(overtimeAuthorityAuditWriter);
  const review = new ReviewOvertimeAuthorityService(overtimeAuthorityAuditWriter, approvals);
  const approve = new ApproveOvertimeAuthorityService(overtimeAuthorityAuditWriter, approvals);
  const reject = new RejectOvertimeAuthorityService(overtimeAuthorityAuditWriter, approvals);
  const read = new ReadOvertimeAuthoritiesService();
  return {
    approvals,
    create,
    update,
    submit,
    cancel,
    review,
    approve,
    reject,
    read,
    controller: new OvertimeAuthoritiesController(
      create,
      update,
      submit,
      cancel,
      review,
      approve,
      reject,
      read,
    ),
  };
}

export async function errorOf(
  promise: Promise<unknown>,
): Promise<{ status: number; body: unknown }> {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof HttpException) {
      return { status: error.getStatus(), body: error.getResponse() };
    }
    throw error;
  }
  throw new Error('Expected the command to be refused.');
}

/** Build one Agency with a division headed by a chief, a member, and an outsider. */
export async function createAgency(admin: PrismaClient, suffix: string, label: string) {
  const agency = await admin.agency.create({
    data: {
      code: `OT-${label}-${suffix}`,
      name: `Overtime ${label}`,
      agencyType: 'NGA',
      status: 'ACTIVE',
    },
  });
  const user = await admin.user.create({
    data: {
      emailNormalized: `overtime-${label.toLowerCase()}-${suffix}@example.test`,
      displayName: `Overtime ${label} Administrator`,
      globalStatus: 'ACTIVE',
    },
  });
  const membership = await admin.agencyMembership.create({
    data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
  });
  const asReplica = <T>(write: (transaction: Prisma.TransactionClient) => Promise<T>) =>
    admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      return write(transaction);
    });
  const chiefPosition = await asReplica((transaction) =>
    transaction.plantillaPosition.create({
      data: {
        agencyId: agency.id,
        itemNumber: `CHIEF-${label}-${suffix}`,
        status: 'OCCUPIED',
        createdByMembershipId: membership.id,
        updatedByMembershipId: membership.id,
      },
    }),
  );
  const unit = async (code: string, headPositionId: string | null) => {
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
  const division = await unit('DIV', chiefPosition.id);
  const otherDivision = await unit('OTHER', null);
  let sequence = 0;
  const employee = (name: string) => {
    sequence += 1;
    return admin.employee.create({
      data: {
        agencyId: agency.id,
        employeeNumber: `OT-${label}-${sequence}-${suffix}`,
        legalName: name,
        birthDate: new Date('1990-01-01'),
        sex: 'FEMALE',
        civilStatus: 'SINGLE',
        contactEmail: `ot-${label.toLowerCase()}-${sequence}-${suffix}@example.test`,
        serviceStatus: 'ACTIVE',
        createdByMembershipId: membership.id,
        updatedByMembershipId: membership.id,
      },
    });
  };
  const serve = (
    employeeId: string,
    organizationUnitId: string,
    options: { positionId?: string; effectiveTo?: string } = {},
  ) =>
    withDatabaseContext(
      {
        agencyId: agency.id,
        membershipId: membership.id,
        capabilities: ['personnel-baseline-transition'],
      },
      async (transaction) => {
        const segment = await transaction.serviceSegment.create({
          data: {
            agencyId: agency.id,
            employeeId,
            organizationUnitId,
            positionId: options.positionId ?? null,
            appointmentStatus: 'PERMANENT',
            salaryGrade: 18,
            salaryStep: 1,
            effectiveFrom: new Date('2020-01-01'),
            effectiveTo: options.effectiveTo ? new Date(options.effectiveTo) : null,
            status: options.effectiveTo ? 'CLOSED' : 'ACTIVE',
            createdByMembershipId: membership.id,
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
              createdByMembershipId: membership.id,
            },
          });
        }
      },
    );
  const chief = await employee('Dana Chief');
  const member = await employee('Eli Member');
  const outsider = await employee('Olive Outsider');
  const unserved = await employee('Paz Preboarding');
  const leaver = await employee('Lino Leaver');
  await serve(chief.id, division.id, { positionId: chiefPosition.id });
  await serve(member.id, division.id);
  await serve(outsider.id, otherDivision.id);
  await serve(leaver.id, division.id, { effectiveTo: '2030-06-15' });
  return {
    agency,
    user,
    membership,
    asReplica,
    chiefPosition,
    division,
    chief,
    member,
    outsider,
    unserved,
    leaver,
  };
}

export async function cleanup(admin: PrismaClient, agencyIds: string[], suffix: string) {
  await admin.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    const where = { agencyId: { in: agencyIds } };
    await transaction.auditEvent.deleteMany({ where });
    await transaction.approvalDecision.deleteMany({ where });
    await transaction.approvalStep.deleteMany({ where });
    await transaction.approvalRequest.deleteMany({ where });
    await transaction.approvalRouteVersion.deleteMany({ where });
    await transaction.scheduleAssignment.deleteMany({ where });
    await transaction.workArrangementVersion.deleteMany({ where });
    await transaction.workArrangement.deleteMany({ where });
    await transaction.workScheduleVersion.deleteMany({ where });
    await transaction.workSchedule.deleteMany({ where });
    await transaction.plantillaPositionVersion.deleteMany({ where });
    await transaction.membershipRole.deleteMany({ where });
    await transaction.overtimeAuthorityEmployee.deleteMany({ where });
    await transaction.overtimeAuthority.deleteMany({ where });
    await transaction.positionIncumbency.deleteMany({ where });
    await transaction.employee.updateMany({ where, data: { currentServiceSegmentId: null } });
    await transaction.serviceSegment.deleteMany({ where });
    await transaction.organizationUnit.updateMany({ where, data: { currentVersionId: null } });
    await transaction.organizationUnitVersion.deleteMany({ where });
    await transaction.organizationUnit.deleteMany({ where });
    await transaction.plantillaPosition.deleteMany({ where });
    await transaction.agencyMembership.updateMany({ where, data: { employeeId: null } });
    await transaction.employee.deleteMany({ where });
    await transaction.agencyMembership.deleteMany({ where });
    await transaction.agency.deleteMany({ where: { id: { in: agencyIds } } });
    await transaction.user.deleteMany({ where: { emailNormalized: { contains: suffix } } });
  });
}

export type AgencyFixture = Awaited<ReturnType<typeof createAgency>>;

export const REVIEWER_GRANTS: RequestContext['permissions'] = [
  'overtime.authorities.review',
  'approvals.routes.read',
  'approvals.requests.create',
  'approvals.requests.submit',
].map((code) => ({ code, scopePolicy: 'AGENCY' }));

export const APPROVER_GRANTS: RequestContext['permissions'] = [
  'overtime.authorities.approve',
  'overtime.authorities.reject',
  'overtime.authorities.cancel',
  'approvals.requests.approve',
].map((code) => ({ code, scopePolicy: 'AGENCY' }));

/** Add a User whose Agency Membership holds one baseline role. */
export async function addMember(
  admin: PrismaClient,
  home: AgencyFixture,
  suffix: string,
  label: string,
  roleCode: string,
  permissions: RequestContext['permissions'],
) {
  const user = await admin.user.create({
    data: {
      emailNormalized: `overtime-${label}-${suffix}@example.test`,
      displayName: `Overtime ${label}`,
      globalStatus: 'ACTIVE',
    },
  });
  const membership = await admin.agencyMembership.create({
    data: { agencyId: home.agency.id, userId: user.id, status: 'ACTIVE' },
  });
  await giveRole(admin, home.agency.id, membership.id, roleCode);
  return context(home.agency.id, user.id, membership.id, permissions);
}

export async function giveRole(
  admin: PrismaClient,
  agencyId: string,
  membershipId: string,
  roleCode: string,
) {
  const role = await admin.role.findFirstOrThrow({ where: { agencyId: null, code: roleCode } });
  await admin.membershipRole.create({
    data: { agencyId, membershipId, roleId: role.id, effectiveFrom: new Date('2020-01-01') },
  });
}

/**
 * Activate the Overtime Authority route, one step per approver given. `step`
 * overrides the permissions each step assigns and decides with.
 */
export async function seedRoute(
  home: AgencyFixture,
  approverMembershipIds: string[],
  step: { requiredPermission?: string; approvePermission?: string } = {},
) {
  const routeAdmin = context(
    home.agency.id,
    home.user.id,
    home.membership.id,
    ['approvals.routes.create', 'approvals.routes.activate'].map((code) => ({
      code,
      scopePolicy: 'AGENCY' as const,
    })),
  );
  const approvals = new ApprovalsService(approvalAuditWriter, new ApprovalCompletionRegistry());
  const route = await approvals.createRoute(routeAdmin, {
    routeCode: OVERTIME_AUTHORITY_ROUTE_CODE,
    domain: 'OVERTIME',
    versionNo: 1,
    effectiveFrom: '2020-01-01',
    stepDefinition: {
      steps: approverMembershipIds.map((membershipId, index) => ({
        stepNo: index + 1,
        stepMode: 'SEQUENTIAL' as const,
        requiredPermission: 'overtime.authorities.approve',
        rejectPermission: 'overtime.authorities.reject',
        ...step,
        assignment: { kind: 'MEMBERSHIP' as const, membershipId },
        requiresSeparateReview: true,
      })),
    },
  });
  await approvals.activateRoute(routeAdmin, route.id, 'Activate the Overtime Authority route.');
}

/**
 * Give the chief's position a version superseded after the Work Dates by an
 * ACTIVE successor, and the member a Work Arrangement Version.
 */
export async function seedEligibilityFacts(home: AgencyFixture) {
  const ids = {
    workArrangementVersionId: '',
  };
  await home.asReplica(async (transaction) => {
    const positionVersion = {
      agencyId: home.agency.id,
      positionId: home.chiefPosition.id,
      organizationUnitId: home.division.id,
      qualificationStandardVersionId: home.division.id,
      staffingAuthorityId: home.division.id,
      salaryGrade: 24,
      fundingSource: 'GAA',
      domainStatus: 'OCCUPIED',
      createdByMembershipId: home.membership.id,
      updatedByMembershipId: home.membership.id,
    };
    await transaction.plantillaPositionVersion.createMany({
      data: [
        {
          ...positionVersion,
          versionNo: 1,
          positionTitle: 'Chief Administrative Officer',
          employmentCategory: 'PLANTILLA',
          effectiveFrom: new Date('2020-01-01'),
          effectiveTo: new Date('2030-12-31'),
          status: 'SUPERSEDED',
        },
        {
          ...positionVersion,
          versionNo: 2,
          positionTitle: 'Director II',
          employmentCategory: 'OTHER',
          effectiveFrom: new Date('2031-01-01'),
          status: 'ACTIVE',
        },
      ],
    });
    const arrangement = await transaction.workArrangement.create({
      data: { agencyId: home.agency.id, code: 'ONSITE', name: 'On-site' },
    });
    const arrangementVersion = await transaction.workArrangementVersion.create({
      data: {
        agencyId: home.agency.id,
        workArrangementId: arrangement.id,
        versionNo: 1,
        arrangementType: 'ONSITE',
        permittedScheduleTypes: ['REGULAR'],
        holidayCalendarId: home.division.id,
        status: 'DRAFT',
        effectiveFrom: new Date('2020-01-01'),
      },
    });
    ids.workArrangementVersionId = arrangementVersion.id;
    const schedule = await transaction.workSchedule.create({
      data: { agencyId: home.agency.id, code: 'REGULAR', name: 'Regular' },
    });
    const scheduleVersion = await transaction.workScheduleVersion.create({
      data: {
        agencyId: home.agency.id,
        workScheduleId: schedule.id,
        versionNo: 1,
        scheduleType: 'REGULAR',
        status: 'DRAFT',
        effectiveFrom: new Date('2020-01-01'),
      },
    });
    await transaction.scheduleAssignment.create({
      data: {
        agencyId: home.agency.id,
        employeeId: home.member.id,
        workScheduleVersionId: scheduleVersion.id,
        workArrangementVersionId: arrangementVersion.id,
        authorityDocumentVersionId: home.division.id,
        effectiveFrom: new Date('2030-01-01'),
        assignedByMembershipId: home.membership.id,
      },
    });
  });
  return ids;
}
