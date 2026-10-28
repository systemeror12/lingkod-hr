import { HttpException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { expect, it } from 'vitest';
import {
  approvalAuditWriter,
  ApprovalCompletionRegistry,
  ApprovalsService,
} from '../approvals/approval.service';
import { createAdminClient } from '../attendance-test-fixtures';
import { ApproveOvertimeAuthorityService } from './approve-overtime-authority.service';
import { CancelOvertimeAuthorityService } from './cancel-overtime-authority.service';
import { CreateOvertimeAuthorityService } from './create-overtime-authority.service';
import { overtimeAuthorityAuditWriter } from './overtime-authorities.audit';
import { OvertimeAuthoritiesController } from './overtime-authorities.controller';
import { registerOvertimeAuthorityApproval } from './overtime-authority-approval';
import {
  OVERTIME_AUTHORITY_ROUTE_CODE,
  type EligibilitySnapshot,
  type OvertimeAuthorityDraftInput,
} from './overtime-authorities.types';
import { RejectOvertimeAuthorityService } from './reject-overtime-authority.service';
import { ReviewOvertimeAuthorityService } from './review-overtime-authority.service';
import { SubmitOvertimeAuthorityService } from './submit-overtime-authority.service';
import { UpdateOvertimeAuthorityService } from './update-overtime-authority.service';

const enabled = process.env.DATABASE_E2E === 'true';

const COMMANDS = [
  'overtime.authorities.create',
  'overtime.authorities.submit',
  'overtime.authorities.cancel',
] as const;

function grants(scopePolicy: 'AGENCY' | 'DIRECT_REPORTS'): RequestContext['permissions'] {
  return COMMANDS.map((code) => ({ code, scopePolicy }));
}

function context(
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

function services() {
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
  return {
    approvals,
    create,
    update,
    submit,
    cancel,
    review,
    approve,
    reject,
    controller: new OvertimeAuthoritiesController(
      create,
      update,
      submit,
      cancel,
      review,
      approve,
      reject,
    ),
  };
}

async function errorOf(promise: Promise<unknown>): Promise<{ status: number; body: unknown }> {
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
async function createAgency(admin: PrismaClient, suffix: string, label: string) {
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

async function cleanup(admin: PrismaClient, agencyIds: string[], suffix: string) {
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

it.skipIf(!enabled)(
  'prepares, edits, submits, and cancels draft Overtime Authorities under RLS',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-overtime-authority`;
    const home = await createAgency(admin, suffix, 'HOME');
    const foreign = await createAgency(admin, suffix, 'FOREIGN');
    try {
      const { create, update, submit, cancel, controller } = services();
      const hr = context(home.agency.id, home.user.id, home.membership.id, grants('AGENCY'));
      const foreignHr = context(
        foreign.agency.id,
        foreign.user.id,
        foreign.membership.id,
        grants('AGENCY'),
      );
      const draft = (overrides: Partial<OvertimeAuthorityDraftInput> = {}) => ({
        authorityNo: 'OT-2030-001',
        requestingUnitId: home.division.id,
        purpose: 'Year-end closing of accounts.',
        workDateFrom: '2030-06-01',
        workDateTo: '2030-06-30',
        compensationMethod: 'COC' as const,
        employees: [{ employeeId: home.member.id, authorizedHours: '16' }],
        ...overrides,
      });

      const created = await controller.create(home.agency.id, draft(), hr);
      expect(created).toMatchObject({
        authorityNo: 'OT-2030-001',
        status: 'DRAFT',
        compensationMethod: 'COC',
        fundingReference: null,
        workDateFrom: '2030-06-01',
        workDateTo: '2030-06-30',
        employees: [{ employeeId: home.member.id, authorizedHours: '16.0000' }],
      });

      // authority_no is unique per Agency, case-insensitively, and only per Agency.
      expect(
        await errorOf(controller.create(home.agency.id, draft({ authorityNo: 'ot-2030-001' }), hr)),
      ).toMatchObject({
        status: 409,
        body: { error: { code: 'OVERTIME_AUTHORITY_NUMBER_CONFLICT' } },
      });
      const foreignDraft = await create.execute(
        foreignHr,
        draft({
          requestingUnitId: foreign.division.id,
          employees: [{ employeeId: foreign.member.id, authorizedHours: '8' }],
        }),
      );
      expect(foreignDraft.authorityNo).toBe('OT-2030-001');

      // Another Agency's Employee or unit is refused.
      expect(
        await errorOf(
          controller.create(
            home.agency.id,
            draft({
              authorityNo: 'OT-2030-002',
              employees: [{ employeeId: foreign.member.id, authorizedHours: '8' }],
            }),
            hr,
          ),
        ),
      ).toMatchObject({
        status: 422,
        body: {
          error: {
            code: 'OVERTIME_AUTHORITY_EMPLOYEE_INELIGIBLE',
            refusals: [{ employeeId: foreign.member.id, code: 'EMPLOYEE_NOT_FOUND' }],
          },
        },
      });
      expect(
        await errorOf(
          controller.create(
            home.agency.id,
            draft({ authorityNo: 'OT-2030-002', requestingUnitId: foreign.division.id }),
            hr,
          ),
        ),
      ).toMatchObject({
        status: 422,
        body: { error: { code: 'OVERTIME_AUTHORITY_UNIT_NOT_FOUND' } },
      });

      // Only Appointed Personnel serving on every Work Date may be covered.
      expect(
        await errorOf(
          controller.create(
            home.agency.id,
            draft({
              authorityNo: 'OT-2030-002',
              employees: [
                { employeeId: home.member.id, authorizedHours: '8' },
                { employeeId: home.unserved.id, authorizedHours: '8' },
                { employeeId: home.leaver.id, authorizedHours: '8' },
              ],
            }),
            hr,
          ),
        ),
      ).toMatchObject({
        status: 422,
        body: {
          error: {
            refusals: [
              { employeeId: home.unserved.id, code: 'NOT_APPOINTED_PERSONNEL' },
              { employeeId: home.leaver.id, code: 'NOT_APPOINTED_PERSONNEL' },
            ],
          },
        },
      });
      const beforeLeaving = await create.execute(
        hr,
        draft({
          authorityNo: 'OT-2030-003',
          workDateTo: '2030-06-15',
          employees: [{ employeeId: home.leaver.id, authorizedHours: '4' }],
        }),
      );
      expect(beforeLeaving.employees).toHaveLength(1);

      // Editing replaces the draft, keeping a retained Employee's coverage row.
      const keptRowId = created.employees[0]?.id;
      const edited = await update.execute(
        hr,
        created.id,
        draft({
          purpose: 'Year-end closing and audit preparation.',
          compensationMethod: 'OVERTIME_PAY',
          fundingReference: 'GAA 2030 MOOE',
          employees: [
            { employeeId: home.member.id, authorizedHours: '20.5', taskDescription: 'Ledger' },
            { employeeId: home.chief.id, authorizedHours: '10' },
          ],
        }),
      );
      expect(edited).toMatchObject({
        purpose: 'Year-end closing and audit preparation.',
        compensationMethod: 'OVERTIME_PAY',
        fundingReference: 'GAA 2030 MOOE',
      });
      expect(edited.employees.find((row) => row.employeeId === home.member.id)).toMatchObject({
        id: keptRowId,
        authorizedHours: '20.5000',
        taskDescription: 'Ledger',
      });
      const narrowed = await update.execute(hr, created.id, draft());
      expect(narrowed.employees.map((row) => row.employeeId)).toEqual([home.member.id]);

      // Another Agency cannot see or act on it.
      expect(
        await errorOf(controller.submit(foreign.agency.id, created.id, foreignHr)),
      ).toMatchObject({ status: 404, body: { error: { code: 'OVERTIME_AUTHORITY_NOT_FOUND' } } });
      expect(await errorOf(controller.submit(home.agency.id, created.id, foreignHr))).toMatchObject(
        { status: 403 },
      );
      const visibleToForeign = await withDatabaseContext(
        {
          agencyId: foreign.agency.id,
          userId: foreign.user.id,
          membershipId: foreign.membership.id,
        },
        async (transaction) => ({
          authorities: await transaction.overtimeAuthority.findMany({
            where: { id: created.id },
          }),
          employees: await transaction.overtimeAuthorityEmployee.findMany({
            where: { overtimeAuthorityId: created.id },
          }),
        }),
      );
      expect(visibleToForeign).toEqual({ authorities: [], employees: [] });

      // Submitting freezes it: no more edits or draft cancellation.
      expect(await submit.execute(hr, created.id)).toMatchObject({ status: 'SUBMITTED' });
      expect(
        await errorOf(controller.update(home.agency.id, created.id, draft(), hr)),
      ).toMatchObject({
        status: 409,
        body: { error: { code: 'OVERTIME_AUTHORITY_NOT_DRAFT' } },
      });
      expect(await errorOf(controller.cancel(home.agency.id, created.id, hr))).toMatchObject({
        status: 409,
        body: { error: { code: 'OVERTIME_AUTHORITY_NOT_DRAFT' } },
      });
      await expect(
        withDatabaseContext(
          { agencyId: home.agency.id, userId: home.user.id, membershipId: home.membership.id },
          (transaction) =>
            transaction.overtimeAuthority.update({
              where: { agencyId_id: { agencyId: home.agency.id, id: created.id } },
              data: { purpose: 'Rewritten after submission.' },
            }),
        ),
      ).rejects.toThrow(/Only a DRAFT Overtime Authority can be edited/);
      await expect(
        withDatabaseContext(
          { agencyId: home.agency.id, userId: home.user.id, membershipId: home.membership.id },
          (transaction) =>
            transaction.overtimeAuthorityEmployee.updateMany({
              where: { overtimeAuthorityId: created.id },
              data: { authorizedHours: '99' },
            }),
        ),
      ).rejects.toThrow(/Covered Employees change only while/);

      // A draft that was never submitted can be cancelled, and then it is final.
      expect(await cancel.execute(hr, beforeLeaving.id)).toMatchObject({ status: 'CANCELLED' });
      expect(await errorOf(controller.submit(home.agency.id, beforeLeaving.id, hr))).toMatchObject({
        status: 409,
        body: { error: { code: 'OVERTIME_AUTHORITY_NOT_DRAFT' } },
      });

      // The database refuses overtime pay without a funding reference.
      await expect(
        withDatabaseContext(
          { agencyId: home.agency.id, userId: home.user.id, membershipId: home.membership.id },
          (transaction) =>
            transaction.overtimeAuthority.create({
              data: {
                agencyId: home.agency.id,
                requestingUnitId: home.division.id,
                authorityNo: 'OT-2030-004',
                purpose: 'Unfunded overtime pay.',
                workDateFrom: new Date('2030-06-01'),
                workDateTo: new Date('2030-06-01'),
                compensationMethod: 'OVERTIME_PAY',
                status: 'DRAFT',
              },
            }),
        ),
      ).rejects.toThrow(/overtime_authorities_funding_check/);

      const events = await admin.auditEvent.findMany({
        where: { agencyId: home.agency.id, entityType: 'OvertimeAuthority' },
        orderBy: { occurredAt: 'asc' },
        select: { action: true, entityId: true, previousStatus: true, newStatus: true },
      });
      expect(events.filter((event) => event.entityId === created.id)).toEqual([
        {
          action: 'OVERTIME_AUTHORITY_CREATED',
          entityId: created.id,
          previousStatus: 'None',
          newStatus: 'DRAFT',
        },
        {
          action: 'OVERTIME_AUTHORITY_UPDATED',
          entityId: created.id,
          previousStatus: 'DRAFT',
          newStatus: 'DRAFT',
        },
        {
          action: 'OVERTIME_AUTHORITY_UPDATED',
          entityId: created.id,
          previousStatus: 'DRAFT',
          newStatus: 'DRAFT',
        },
        {
          action: 'OVERTIME_AUTHORITY_SUBMITTED',
          entityId: created.id,
          previousStatus: 'DRAFT',
          newStatus: 'SUBMITTED',
        },
      ]);
      expect(
        events.filter((event) => event.entityId === beforeLeaving.id).map((e) => e.action),
      ).toEqual(['OVERTIME_AUTHORITY_CREATED', 'OVERTIME_AUTHORITY_CANCELLED']);
    } finally {
      await cleanup(admin, [home.agency.id, foreign.agency.id], suffix);
      await admin.$disconnect();
    }
  },
  60_000,
);

it.skipIf(!enabled)(
  'limits a Supervisor to Overtime Authorities covering their direct reports',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-overtime-supervisor`;
    const home = await createAgency(admin, suffix, 'SUP');
    try {
      const { create, update, submit, cancel } = services();
      await withDatabaseContext(
        {
          agencyId: home.agency.id,
          userId: home.user.id,
          membershipId: home.membership.id,
          capabilities: ['employee-membership-link'],
        },
        (transaction) =>
          transaction.agencyMembership.update({
            where: { agencyId_id: { agencyId: home.agency.id, id: home.membership.id } },
            data: { employeeId: home.chief.id },
          }),
      );
      const supervisor = context(
        home.agency.id,
        home.user.id,
        home.membership.id,
        grants('DIRECT_REPORTS'),
      );
      const draft = (employeeId: string, authorityNo: string) => ({
        authorityNo,
        requestingUnitId: home.division.id,
        purpose: 'Disaster response logistics.',
        workDateFrom: '2030-07-01',
        workDateTo: '2030-07-02',
        compensationMethod: 'COC' as const,
        employees: [{ employeeId, authorizedHours: '6' }],
      });

      const own = await create.execute(supervisor, draft(home.member.id, 'SUP-1'));
      expect(own.status).toBe('DRAFT');
      await expect(
        create.execute(supervisor, draft(home.outsider.id, 'SUP-2')),
      ).rejects.toMatchObject({ statusCode: 403, code: 'OVERTIME_AUTHORITY_SCOPE_FORBIDDEN' });
      await expect(
        update.execute(supervisor, own.id, draft(home.outsider.id, 'SUP-1')),
      ).rejects.toMatchObject({ statusCode: 403, code: 'OVERTIME_AUTHORITY_SCOPE_FORBIDDEN' });

      // An HR Administrator's draft covering someone outside the Supervisor's reports.
      const hr = context(home.agency.id, home.user.id, home.membership.id, grants('AGENCY'));
      const wider = await create.execute(hr, draft(home.outsider.id, 'SUP-3'));
      await expect(submit.execute(supervisor, wider.id)).rejects.toMatchObject({ statusCode: 403 });
      await expect(cancel.execute(supervisor, wider.id)).rejects.toMatchObject({ statusCode: 403 });

      expect(await submit.execute(supervisor, own.id)).toMatchObject({ status: 'SUBMITTED' });

      const none = context(home.agency.id, home.user.id, home.membership.id, []);
      await expect(create.execute(none, draft(home.member.id, 'SUP-4'))).rejects.toMatchObject({
        statusCode: 403,
        code: 'OVERTIME_AUTHORITY_FORBIDDEN',
      });
    } finally {
      await cleanup(admin, [home.agency.id], suffix);
      await admin.$disconnect();
    }
  },
  60_000,
);

type AgencyFixture = Awaited<ReturnType<typeof createAgency>>;

const REVIEWER_GRANTS: RequestContext['permissions'] = [
  'overtime.authorities.review',
  'approvals.routes.read',
  'approvals.requests.create',
  'approvals.requests.submit',
].map((code) => ({ code, scopePolicy: 'AGENCY' }));

const APPROVER_GRANTS: RequestContext['permissions'] = [
  'overtime.authorities.approve',
  'overtime.authorities.reject',
  'overtime.authorities.cancel',
  'approvals.requests.approve',
].map((code) => ({ code, scopePolicy: 'AGENCY' }));

/** Add a User whose Agency Membership holds one baseline role. */
async function addMember(
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

async function giveRole(
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

async function seedRoute(home: AgencyFixture, approverMembershipId: string) {
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
      steps: [
        {
          stepNo: 1,
          stepMode: 'SEQUENTIAL',
          requiredPermission: 'overtime.authorities.approve',
          rejectPermission: 'overtime.authorities.reject',
          assignment: { kind: 'MEMBERSHIP', membershipId: approverMembershipId },
          requiresSeparateReview: true,
        },
      ],
    },
  });
  await approvals.activateRoute(routeAdmin, route.id, 'Activate the Overtime Authority route.');
}

/** Give the chief's position a version and the member a Work Arrangement Version. */
async function seedEligibilityFacts(home: AgencyFixture) {
  const ids = {
    workArrangementVersionId: '',
  };
  await home.asReplica(async (transaction) => {
    await transaction.plantillaPositionVersion.create({
      data: {
        agencyId: home.agency.id,
        positionId: home.chiefPosition.id,
        organizationUnitId: home.division.id,
        qualificationStandardVersionId: home.division.id,
        staffingAuthorityId: home.division.id,
        versionNo: 1,
        positionTitle: 'Chief Administrative Officer',
        salaryGrade: 24,
        fundingSource: 'GAA',
        employmentCategory: 'PLANTILLA',
        effectiveFrom: new Date('2020-01-01'),
        status: 'ACTIVE',
        domainStatus: 'OCCUPIED',
        createdByMembershipId: home.membership.id,
        updatedByMembershipId: home.membership.id,
      },
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

it.skipIf(!enabled)(
  'reviews, approves, rejects, and cancels Overtime Authorities on the shared Approval Route',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-overtime-approval`;
    const home = await createAgency(admin, suffix, 'APR');
    const foreign = await createAgency(admin, suffix, 'APRF');
    try {
      const { approvals, create, submit, review, approve, reject, cancel, controller } = services();
      const reviewer = await addMember(
        admin,
        home,
        suffix,
        'reviewer',
        'budget_officer',
        REVIEWER_GRANTS,
      );
      const approver = await addMember(
        admin,
        home,
        suffix,
        'approver',
        'appointing_authority',
        APPROVER_GRANTS,
      );
      // The preparer holds every grant, so only segregation stops them.
      await giveRole(admin, home.agency.id, home.membership.id, 'appointing_authority');
      const preparer = context(home.agency.id, home.user.id, home.membership.id, [
        ...grants('AGENCY'),
        ...REVIEWER_GRANTS,
        ...APPROVER_GRANTS,
      ]);
      const foreignApprover = context(foreign.agency.id, foreign.user.id, foreign.membership.id, [
        ...REVIEWER_GRANTS,
        ...APPROVER_GRANTS,
      ]);
      await seedRoute(home, approver.membershipId);
      const facts = await seedEligibilityFacts(home);

      const prepare = async (authorityNo: string) => {
        const draft = await create.execute(preparer, {
          authorityNo,
          requestingUnitId: home.division.id,
          purpose: 'Year-end closing of accounts.',
          workDateFrom: '2030-06-01',
          workDateTo: '2030-06-30',
          compensationMethod: 'OVERTIME_PAY',
          fundingReference: 'GAA 2030 MOOE',
          employees: [
            { employeeId: home.member.id, authorizedHours: '16' },
            { employeeId: home.chief.id, authorizedHours: '8' },
          ],
        });
        await submit.execute(preparer, draft.id);
        return draft;
      };
      const attestations = [
        {
          employeeId: home.member.id,
          positionLevel: 'DIVISION_CHIEF_OR_BELOW' as const,
          noOtherBeyondHoursAllowance: true as const,
        },
        {
          employeeId: home.chief.id,
          positionLevel: 'OIC_OF_HIGHER_POSITION' as const,
          noOtherBeyondHoursAllowance: true as const,
        },
      ];

      const first = await prepare('OT-APR-1');

      // Nobody reviews an authority they prepared or submitted.
      expect(
        await errorOf(controller.review(home.agency.id, first.id, { attestations }, preparer)),
      ).toMatchObject({
        status: 403,
        body: { error: { code: 'OVERTIME_AUTHORITY_SEGREGATION_REQUIRED' } },
      });
      // Every covered Employee, and only them, is attested.
      expect(
        await errorOf(
          controller.review(
            home.agency.id,
            first.id,
            { attestations: attestations.slice(0, 1) },
            reviewer,
          ),
        ),
      ).toMatchObject({
        status: 422,
        body: { error: { code: 'OVERTIME_AUTHORITY_ATTESTATIONS_MISMATCH' } },
      });
      // Another Agency cannot see or review it.
      await expect(
        review.execute(foreignApprover, first.id, { attestations }),
      ).rejects.toMatchObject({ statusCode: 404, code: 'OVERTIME_AUTHORITY_NOT_FOUND' });
      expect(
        await errorOf(
          controller.review(home.agency.id, first.id, { attestations }, foreignApprover),
        ),
      ).toMatchObject({
        status: 403,
        body: { error: { code: 'OVERTIME_AUTHORITY_WRITE_FORBIDDEN' } },
      });
      // Approval waits for review.
      expect(
        await errorOf(
          controller.approve(home.agency.id, first.id, { compensationMethod: 'COC' }, approver),
        ),
      ).toMatchObject({
        status: 409,
        body: { error: { code: 'OVERTIME_AUTHORITY_STATUS_INVALID' } },
      });

      const reviewed = await controller.review(
        home.agency.id,
        first.id,
        { attestations },
        reviewer,
      );
      expect(reviewed.status).toBe('FOR_REVIEW');
      const request = await admin.approvalRequest.findFirstOrThrow({
        where: { agencyId: home.agency.id, subjectType: 'OVERTIME_AUTHORITY', subjectId: first.id },
      });
      expect(request).toMatchObject({
        status: 'IN_PROGRESS',
        requestedByMembershipId: reviewer.membershipId,
      });

      // The generic Approval API cannot decide it around the Overtime module.
      await expect(approvals.approve(approver, request.id)).rejects.toMatchObject({
        code: 'OVERTIME_AUTHORITY_APPROVAL_EFFECT_REQUIRED',
      });
      await expect(approvals.reject(approver, request.id, 'Bypass.')).rejects.toMatchObject({
        code: 'OVERTIME_AUTHORITY_APPROVAL_EFFECT_REQUIRED',
      });
      // Self-approval by the preparer is refused, and another Agency cannot approve.
      expect(
        await errorOf(
          controller.approve(home.agency.id, first.id, { compensationMethod: 'COC' }, preparer),
        ),
      ).toMatchObject({
        status: 403,
        body: { error: { code: 'OVERTIME_AUTHORITY_SEGREGATION_REQUIRED' } },
      });
      await expect(
        approve.execute(foreignApprover, first.id, { compensationMethod: 'COC' }),
      ).rejects.toMatchObject({ statusCode: 404 });
      await expect(
        reject.execute(foreignApprover, first.id, { reason: 'Not ours.' }),
      ).rejects.toMatchObject({ statusCode: 404 });
      // Overtime pay waits for Payroll (#347).
      expect(
        await errorOf(
          controller.approve(
            home.agency.id,
            first.id,
            { compensationMethod: 'OVERTIME_PAY' },
            approver,
          ),
        ),
      ).toMatchObject({
        status: 409,
        body: { error: { code: 'OVERTIME_AUTHORITY_OVERTIME_PAY_BLOCKED_BY_PAYROLL' } },
      });
      // Reject needs a reason.
      expect(
        await errorOf(controller.reject(home.agency.id, first.id, { reason: '  ' }, approver)),
      ).toMatchObject({ status: 400, body: { error: { fields: { reason: expect.any(String) } } } });

      const approved = await controller.approve(
        home.agency.id,
        first.id,
        { compensationMethod: 'COC', comments: 'Approved as COC.' },
        approver,
      );
      expect(approved).toMatchObject({
        status: 'APPROVED',
        compensationMethod: 'COC',
        approvedByMembershipId: approver.membershipId,
      });
      expect(approved.approvedAt).not.toBeNull();
      const snapshot = (employeeId: string) =>
        approved.employees.find((row) => row.employeeId === employeeId)
          ?.eligibilitySnapshot as EligibilitySnapshot;
      expect(snapshot(home.member.id)).toMatchObject({
        workDateFrom: '2030-06-01',
        workDateTo: '2030-06-30',
        service: [
          {
            appointmentStatus: 'PERMANENT',
            salaryGrade: 18,
            positionId: null,
            personnelCategory: null,
          },
        ],
        workArrangements: [
          {
            workArrangementVersionId: facts.workArrangementVersionId,
            arrangementType: 'ONSITE',
            effectiveFrom: '2030-01-01',
            effectiveTo: null,
          },
        ],
        attestation: {
          positionLevel: 'DIVISION_CHIEF_OR_BELOW',
          noOtherBeyondHoursAllowance: true,
          reviewedByMembershipId: reviewer.membershipId,
        },
      });
      expect(snapshot(home.chief.id)).toMatchObject({
        service: [
          {
            positionId: home.chiefPosition.id,
            positionItemNumber: home.chiefPosition.itemNumber,
            positionTitle: 'Chief Administrative Officer',
            personnelCategory: 'PLANTILLA',
          },
        ],
        workArrangements: [],
        attestation: { positionLevel: 'OIC_OF_HIGHER_POSITION' },
      });
      expect(
        await admin.approvalRequest.findUniqueOrThrow({ where: { id: request.id } }),
      ).toMatchObject({ status: 'APPROVED' });

      // An approved authority has no edit path and keeps its snapshot.
      expect(
        await errorOf(
          controller.update(
            home.agency.id,
            first.id,
            {
              authorityNo: 'OT-APR-1',
              requestingUnitId: home.division.id,
              purpose: 'Rewritten.',
              workDateFrom: '2030-06-01',
              workDateTo: '2030-06-30',
              compensationMethod: 'COC',
              employees: [{ employeeId: home.member.id, authorizedHours: '16' }],
            },
            preparer,
          ),
        ),
      ).toMatchObject({ status: 409, body: { error: { code: 'OVERTIME_AUTHORITY_NOT_DRAFT' } } });
      const homeDatabase = {
        agencyId: home.agency.id,
        userId: home.user.id,
        membershipId: home.membership.id,
      };
      await expect(
        withDatabaseContext(homeDatabase, (transaction) =>
          transaction.overtimeAuthority.update({
            where: { agencyId_id: { agencyId: home.agency.id, id: first.id } },
            data: { compensationMethod: 'OVERTIME_PAY' },
          }),
        ),
      ).rejects.toThrow(/An APPROVED Overtime Authority is immutable/);
      await expect(
        withDatabaseContext(homeDatabase, (transaction) =>
          transaction.overtimeAuthorityEmployee.updateMany({
            where: { overtimeAuthorityId: first.id },
            data: { eligibilitySnapshot: {} },
          }),
        ),
      ).rejects.toThrow(/Covered Employees change only while/);
      expect(
        await errorOf(controller.reject(home.agency.id, first.id, { reason: 'Late.' }, approver)),
      ).toMatchObject({
        status: 409,
        body: { error: { code: 'OVERTIME_AUTHORITY_STATUS_INVALID' } },
      });

      // Only the Approving Official cancels an approved authority.
      const hrOnly = context(home.agency.id, home.user.id, home.membership.id, grants('AGENCY'));
      expect(await errorOf(controller.cancel(home.agency.id, first.id, hrOnly))).toMatchObject({
        status: 403,
      });
      expect(
        await errorOf(controller.cancel(home.agency.id, first.id, foreignApprover)),
      ).toMatchObject({ status: 403 });
      expect(await controller.cancel(home.agency.id, first.id, approver)).toMatchObject({
        status: 'CANCELLED',
        compensationMethod: 'COC',
        approvedByMembershipId: approver.membershipId,
      });

      // Rejection records the reason and is final.
      const second = await prepare('OT-APR-2');
      await review.execute(reviewer, second.id, { attestations });
      expect(
        await reject.execute(approver, second.id, { reason: 'Not necessary this month.' }),
      ).toMatchObject({ status: 'REJECTED' });
      expect(
        await admin.approvalRequest.findFirstOrThrow({
          where: { agencyId: home.agency.id, subjectId: second.id },
        }),
      ).toMatchObject({ status: 'REJECTED' });
      await expect(cancel.execute(approver, second.id)).rejects.toMatchObject({ statusCode: 409 });

      const events = await admin.auditEvent.findMany({
        where: { agencyId: home.agency.id, entityType: 'OvertimeAuthority' },
        orderBy: { occurredAt: 'asc' },
        select: { action: true, entityId: true, newStatus: true, reason: true },
      });
      expect(events.filter((event) => event.entityId === first.id).map((e) => e.action)).toEqual([
        'OVERTIME_AUTHORITY_CREATED',
        'OVERTIME_AUTHORITY_SUBMITTED',
        'OVERTIME_AUTHORITY_REVIEWED',
        'OVERTIME_AUTHORITY_APPROVED',
        'OVERTIME_AUTHORITY_CANCELLED',
      ]);
      expect(events.find((event) => event.action === 'OVERTIME_AUTHORITY_REJECTED')).toMatchObject({
        entityId: second.id,
        reason: 'Not necessary this month.',
      });
    } finally {
      await cleanup(admin, [home.agency.id, foreign.agency.id], suffix);
      await admin.$disconnect();
    }
  },
  60_000,
);

it.skipIf(!enabled)(
  'lets exactly one of a racing approve and reject decide an Overtime Authority',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-overtime-race`;
    const home = await createAgency(admin, suffix, 'RACE');
    try {
      const { create, submit, review, approve, reject } = services();
      const reviewer = await addMember(
        admin,
        home,
        suffix,
        'reviewer',
        'budget_officer',
        REVIEWER_GRANTS,
      );
      const approver = await addMember(
        admin,
        home,
        suffix,
        'approver',
        'appointing_authority',
        APPROVER_GRANTS,
      );
      await seedRoute(home, approver.membershipId);
      const preparer = context(home.agency.id, home.user.id, home.membership.id, grants('AGENCY'));

      for (const authorityNo of ['RACE-1', 'RACE-2', 'RACE-3']) {
        const draft = await create.execute(preparer, {
          authorityNo,
          requestingUnitId: home.division.id,
          purpose: 'Disaster response logistics.',
          workDateFrom: '2030-07-01',
          workDateTo: '2030-07-02',
          compensationMethod: 'COC',
          employees: [{ employeeId: home.member.id, authorizedHours: '6' }],
        });
        await submit.execute(preparer, draft.id);
        await review.execute(reviewer, draft.id, {
          attestations: [
            {
              employeeId: home.member.id,
              positionLevel: 'DIVISION_CHIEF_OR_BELOW',
              noOtherBeyondHoursAllowance: true,
            },
          ],
        });

        const results = await Promise.allSettled([
          approve.execute(approver, draft.id, { compensationMethod: 'COC' }),
          reject.execute(approver, draft.id, { reason: 'Racing rejection.' }),
        ]);
        const fulfilled = results.filter((result) => result.status === 'fulfilled');
        const refused = results.filter((result) => result.status === 'rejected');
        expect(fulfilled).toHaveLength(1);
        expect(refused).toHaveLength(1);
        expect(refused[0]?.reason).toMatchObject({
          statusCode: 409,
          code: 'OVERTIME_AUTHORITY_STATUS_INVALID',
        });
        const winner = fulfilled[0]?.value.status;
        const stored = await admin.overtimeAuthority.findUniqueOrThrow({ where: { id: draft.id } });
        const request = await admin.approvalRequest.findFirstOrThrow({
          where: { agencyId: home.agency.id, subjectId: draft.id },
          include: { steps: { include: { decisions: true } } },
        });
        expect(stored.status).toBe(winner);
        expect(request.status).toBe(winner);
        expect(request.steps.flatMap((step) => step.decisions)).toHaveLength(1);
      }
    } finally {
      await cleanup(admin, [home.agency.id], suffix);
      await admin.$disconnect();
    }
  },
  60_000,
);
