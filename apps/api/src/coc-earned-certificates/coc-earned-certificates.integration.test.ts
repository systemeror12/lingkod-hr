import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { expect, it } from 'vitest';
import {
  approvalAuditWriter,
  ApprovalCompletionRegistry,
  ApprovalsService,
} from '../approvals/approval.service';
import { createAdminClient } from '../attendance-test-fixtures';
import { overtimeAuthorityAuditWriter } from '../overtime-authorities/overtime-authorities.audit';
import {
  addMember,
  cleanup,
  context,
  createAgency,
  enabled,
  errorOf,
  type AgencyFixture,
} from '../overtime-authorities/overtime-authority-test-fixtures';
import { approvedAuthority } from '../overtime-service-records/overtime-service-test-fixtures';
import { registerCocEarnedCertificateApproval } from './coc-earned-certificate-approval';
import { CocEarnedCertificatesController } from './coc-earned-certificates.controller';
import { CocEarnedCertificatesService } from './coc-earned-certificates.service';
import { COC_EARNED_CERTIFICATE_ROUTE_CODE } from './coc-earned-certificates.types';

const PREPARER_GRANTS: RequestContext['permissions'] = [
  'overtime.coc_certificates.prepare',
  'approvals.routes.read',
  'approvals.requests.create',
  'approvals.requests.submit',
].map((code) => ({ code, scopePolicy: 'AGENCY' }));

const APPROVER_GRANTS: RequestContext['permissions'] = [
  'overtime.coc_certificates.approve',
  'approvals.requests.approve',
  'approvals.requests.reject',
  'approvals.requests.cancel',
].map((code) => ({ code, scopePolicy: 'AGENCY' }));

function services() {
  const registry = new ApprovalCompletionRegistry();
  registerCocEarnedCertificateApproval(registry);
  const approvals = new ApprovalsService(approvalAuditWriter, registry);
  const service = new CocEarnedCertificatesService(overtimeAuthorityAuditWriter, approvals);
  return { approvals, service, controller: new CocEarnedCertificatesController(service) };
}

/** Activate the certificate route with one step assigned to `approverMembershipId`. */
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
    routeCode: COC_EARNED_CERTIFICATE_ROUTE_CODE,
    domain: 'OVERTIME',
    versionNo: 1,
    effectiveFrom: '2020-01-01',
    stepDefinition: {
      steps: [
        {
          stepNo: 1,
          stepMode: 'SEQUENTIAL' as const,
          requiredPermission: 'overtime.coc_certificates.approve',
          assignment: { kind: 'MEMBERSHIP' as const, membershipId: approverMembershipId },
          requiresSeparateReview: true,
        },
      ],
    },
  });
  await approvals.activateRoute(routeAdmin, route.id, 'Activate the certificate route.');
}

/**
 * Write a service record straight into `status`. The record's own workflow is
 * #320's and #535's to test, so triggers are bypassed here.
 */
function serviceRecord(
  home: AgencyFixture,
  options: {
    authorityId: string;
    employeeId: string;
    workDate: string;
    status?: 'CERTIFIED' | 'FOR_CERTIFICATION';
    certifiedMinutes?: number;
  },
) {
  const status = options.status ?? 'CERTIFIED';
  return home.asReplica(async (transaction) => {
    const coverage = await transaction.overtimeAuthorityEmployee.findFirstOrThrow({
      where: { overtimeAuthorityId: options.authorityId, employeeId: options.employeeId },
    });
    return transaction.overtimeServiceRecord.create({
      data: {
        agencyId: home.agency.id,
        overtimeAuthorityEmployeeId: coverage.id,
        employeeId: options.employeeId,
        workDate: new Date(options.workDate),
        claimedHours: '2',
        accomplishment: 'Prepared the closing schedules.',
        actualMinutes: 180,
        sourceAttendanceDayId: randomUUID(),
        dayClassification: 'WORKDAY',
        status,
        recordedByMembershipId: home.membership.id,
        ...(status === 'CERTIFIED'
          ? {
              certifiedMinutes: options.certifiedMinutes ?? 120,
              certifiedByMembershipId: home.membership.id,
              certifiedAt: new Date('2026-07-01T00:00:00+08:00'),
            }
          : {}),
      },
    });
  });
}

async function setup(label: string) {
  const admin = await createAdminClient();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-coc-${label}`;
  const home = await createAgency(admin, suffix, `${label}H`);
  const foreign = await createAgency(admin, suffix, `${label}F`);
  const teardown = async () => {
    await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      const where = { agencyId: { in: [home.agency.id, foreign.agency.id] } };
      await transaction.cocEarnedCertificateLine.deleteMany({ where });
      await transaction.cocEarnedCertificate.deleteMany({ where });
    });
    await cleanup(admin, [home.agency.id, foreign.agency.id], suffix);
    await admin.$disconnect();
  };
  const preparer = context(home.agency.id, home.user.id, home.membership.id, PREPARER_GRANTS);
  const approver = await addMember(
    admin,
    home,
    suffix,
    'approver',
    'appointing_authority',
    APPROVER_GRANTS,
  );
  await seedRoute(home, approver.membershipId);
  const cocAuthority = await approvedAuthority(admin, {
    agencyId: home.agency.id,
    requestingUnitId: home.division.id,
    approverMembershipId: approver.membershipId,
    authorityNo: `COC-${suffix}`,
    workDateFrom: '2026-06-01',
    workDateTo: '2026-07-31',
    employeeIds: [home.member.id, home.chief.id],
  });
  const payAuthority = await approvedAuthority(admin, {
    agencyId: home.agency.id,
    requestingUnitId: home.division.id,
    approverMembershipId: approver.membershipId,
    authorityNo: `PAY-${suffix}`,
    workDateFrom: '2026-06-01',
    workDateTo: '2026-06-30',
    employeeIds: [home.member.id],
  });
  await home.asReplica((transaction) =>
    transaction.overtimeAuthority.update({
      where: { id: payAuthority },
      data: { compensationMethod: 'OVERTIME_PAY', fundingReference: 'MOOE 2026' },
    }),
  );
  return {
    admin,
    home,
    foreign,
    preparer,
    approver,
    cocAuthority,
    payAuthority,
    teardown,
    ...services(),
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

function activeLines(admin: PrismaClient, overtimeServiceRecordId: string) {
  return admin.cocEarnedCertificateLine.count({
    where: { overtimeServiceRecordId, releasedAt: null },
  });
}

function auditActions(admin: PrismaClient, certificateId: string) {
  return admin.auditEvent
    .findMany({
      where: { entityType: 'CocEarnedCertificate', entityId: certificateId },
      orderBy: { occurredAt: 'asc' },
      select: { action: true, previousStatus: true, newStatus: true, reason: true },
    })
    .then((events) => events.map((event) => event.action));
}

async function withSetup(label: string, run: (fixture: Setup) => Promise<void>) {
  const fixture = await setup(label);
  try {
    await run(fixture);
  } finally {
    await fixture.teardown();
  }
}

it.skipIf(!enabled)(
  "prepares a draft from the Employee's certified COC service in the month, and only that",
  () =>
    withSetup('prepare', async ({ admin, home, preparer, cocAuthority, payAuthority, service }) => {
      const june10 = await serviceRecord(home, {
        authorityId: cocAuthority,
        employeeId: home.member.id,
        workDate: '2026-06-10',
      });
      const june03 = await serviceRecord(home, {
        authorityId: cocAuthority,
        employeeId: home.member.id,
        workDate: '2026-06-03',
        certifiedMinutes: 90,
      });
      // Not lines: another month, an Overtime Pay authority, not yet
      // certified, certified at zero minutes, and another Employee.
      await serviceRecord(home, {
        authorityId: cocAuthority,
        employeeId: home.member.id,
        workDate: '2026-07-01',
      });
      await serviceRecord(home, {
        authorityId: payAuthority,
        employeeId: home.member.id,
        workDate: '2026-06-11',
      });
      await serviceRecord(home, {
        authorityId: cocAuthority,
        employeeId: home.member.id,
        workDate: '2026-06-12',
        status: 'FOR_CERTIFICATION',
      });
      await serviceRecord(home, {
        authorityId: cocAuthority,
        employeeId: home.member.id,
        workDate: '2026-06-13',
        certifiedMinutes: 0,
      });
      await serviceRecord(home, {
        authorityId: cocAuthority,
        employeeId: home.chief.id,
        workDate: '2026-06-10',
      });

      const certificate = await service.prepare(preparer, {
        employeeId: home.member.id,
        earnedMonth: '2026-06',
      });

      expect(certificate).toMatchObject({
        employeeId: home.member.id,
        earnedMonth: '2026-06-01',
        status: 'DRAFT',
        preparedByMembershipId: home.membership.id,
        approvedByMembershipId: null,
      });
      expect(
        certificate.lines.map((line) => [
          line.overtimeServiceRecordId,
          line.workDate,
          line.certifiedMinutes,
        ]),
      ).toEqual([
        [june03.id, '2026-06-03', 90],
        [june10.id, '2026-06-10', 120],
      ]);
      expect(await auditActions(admin, certificate.id)).toEqual([
        'COC_EARNED_CERTIFICATE_PREPARED',
      ]);

      // Everything eligible is taken, so a second draft for the month is refused.
      expect(
        await errorOf(
          services().controller.prepare(
            home.agency.id,
            {
              employeeId: home.member.id,
              earnedMonth: '2026-06',
            },
            preparer,
          ),
        ),
      ).toMatchObject({
        status: 422,
        body: { error: { code: 'COC_EARNED_CERTIFICATE_NO_ELIGIBLE_SERVICE' } },
      });

      // Service certified later goes on another certificate for the same month.
      const june20 = await serviceRecord(home, {
        authorityId: cocAuthority,
        employeeId: home.member.id,
        workDate: '2026-06-20',
      });
      const second = await service.prepare(preparer, {
        employeeId: home.member.id,
        earnedMonth: '2026-06',
      });
      expect(second.lines.map((line) => line.overtimeServiceRecordId)).toEqual([june20.id]);
    }),
);

it.skipIf(!enabled)('leaves exactly one line when two drafts race for one record', () =>
  withSetup('race', async ({ admin, home, preparer, cocAuthority }) => {
    const record = await serviceRecord(home, {
      authorityId: cocAuthority,
      employeeId: home.member.id,
      workDate: '2026-06-10',
    });
    const results = await Promise.allSettled([
      services().service.prepare(preparer, { employeeId: home.member.id, earnedMonth: '2026-06' }),
      services().service.prepare(preparer, { employeeId: home.member.id, earnedMonth: '2026-06' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const [refused] = results.filter((result) => result.status === 'rejected');
    expect([
      'COC_EARNED_CERTIFICATE_SERVICE_TAKEN',
      'COC_EARNED_CERTIFICATE_NO_ELIGIBLE_SERVICE',
    ]).toContain((refused as PromiseRejectedResult).reason.code);
    expect(await activeLines(admin, record.id)).toBe(1);
    expect(await admin.cocEarnedCertificate.count({ where: { agencyId: home.agency.id } })).toBe(1);

    // The database refuses a second unreleased line for the record outright.
    const other = await admin.cocEarnedCertificate.create({
      data: {
        agencyId: home.agency.id,
        employeeId: home.member.id,
        earnedMonth: new Date('2026-06-01'),
        status: 'DRAFT',
        preparedByMembershipId: home.membership.id,
      },
    });
    await expect(
      admin.cocEarnedCertificateLine.create({
        data: {
          agencyId: home.agency.id,
          cocEarnedCertificateId: other.id,
          overtimeServiceRecordId: record.id,
          certifiedMinutes: 120,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(await activeLines(admin, record.id)).toBe(1);
  }),
);

it.skipIf(!enabled)(
  'submits to the Approval Route, returns with a reason, resubmits, and discards releasing its lines',
  () =>
    withSetup(
      'flow',
      async ({ admin, home, preparer, approver, cocAuthority, service, approvals, controller }) => {
        const record = await serviceRecord(home, {
          authorityId: cocAuthority,
          employeeId: home.member.id,
          workDate: '2026-06-10',
        });
        const draft = await service.prepare(preparer, {
          employeeId: home.member.id,
          earnedMonth: '2026-06',
        });

        const submitted = await service.submit(preparer, draft.id);
        expect(submitted.status).toBe('FOR_APPROVAL');
        const request = await admin.approvalRequest.findFirstOrThrow({
          where: { subjectType: 'COC_EARNED_CERTIFICATE', subjectId: draft.id },
        });
        expect(request.status).toBe('IN_PROGRESS');

        // A submitted certificate cannot be discarded or submitted again.
        expect(await errorOf(controller.discard(home.agency.id, draft.id, preparer))).toMatchObject(
          {
            status: 409,
            body: { error: { code: 'COC_EARNED_CERTIFICATE_NOT_DRAFT' } },
          },
        );

        // The generic Approval API cannot decide or cancel it.
        for (const decide of [
          () => approvals.approve(approver, request.id),
          () => approvals.returnRequest(approver, request.id, 'Use the Overtime module.'),
          () => approvals.reject(approver, request.id, 'Use the Overtime module.'),
        ]) {
          await expect(decide()).rejects.toMatchObject({
            code: 'COC_EARNED_CERTIFICATE_APPROVAL_EFFECT_REQUIRED',
          });
        }
        await expect(
          approvals.cancel(
            context(home.agency.id, home.user.id, home.membership.id, [
              { code: 'approvals.requests.cancel', scopePolicy: 'AGENCY' },
            ]),
            request.id,
            'Withdraw it.',
          ),
        ).rejects.toMatchObject({ code: 'COC_EARNED_CERTIFICATE_APPROVAL_CANCEL_FORBIDDEN' });

        // Return needs the approve permission and a reason.
        expect(
          await errorOf(
            controller.return(home.agency.id, draft.id, { reason: 'Recheck June.' }, preparer),
          ),
        ).toMatchObject({
          status: 403,
          body: { error: { code: 'COC_EARNED_CERTIFICATE_FORBIDDEN' } },
        });
        await expect(
          controller.return(home.agency.id, draft.id, { reason: '  ' }, approver),
        ).rejects.toMatchObject({ response: { error: { code: 'INVALID_INPUT' } } });

        const returned = await controller.return(
          home.agency.id,
          draft.id,
          { reason: 'Recheck the June 10 hours.' },
          approver,
        );
        expect(returned.status).toBe('DRAFT');
        expect(
          (await admin.approvalRequest.findUniqueOrThrow({ where: { id: request.id } })).status,
        ).toBe('RETURNED');

        // The preparer, the request's drafter, cannot resume it through the generic Approval API.
        await expect(approvals.submit(preparer, request.id)).rejects.toMatchObject({
          code: 'APPROVAL_DOMAIN_RECORD_FORBIDDEN',
          statusCode: 400,
        });
        expect(
          (await admin.approvalRequest.findUniqueOrThrow({ where: { id: request.id } })).status,
        ).toBe('RETURNED');
        expect(
          (await admin.cocEarnedCertificate.findUniqueOrThrow({ where: { id: draft.id } })).status,
        ).toBe('DRAFT');

        const returnEvent = await admin.auditEvent.findFirstOrThrow({
          where: { entityId: draft.id, action: 'COC_EARNED_CERTIFICATE_RETURNED' },
        });
        expect(returnEvent).toMatchObject({
          actorMembershipId: approver.membershipId,
          previousStatus: 'FOR_APPROVAL',
          newStatus: 'DRAFT',
          reason: 'Recheck the June 10 hours.',
        });

        // Resubmitting resumes the request it was returned on.
        await service.submit(preparer, draft.id);
        expect(
          (await admin.approvalRequest.findUniqueOrThrow({ where: { id: request.id } })).status,
        ).toBe('IN_PROGRESS');
        await service.return(approver, draft.id, { reason: 'Discard and prepare again.' });

        const discarded = await service.discard(preparer, draft.id);
        expect(discarded.status).toBe('DISCARDED');
        expect(discarded.lines.every((line) => line.releasedAt !== null)).toBe(true);
        expect(
          (await admin.approvalRequest.findUniqueOrThrow({ where: { id: request.id } })).status,
        ).toBe('CANCELLED');
        expect(await auditActions(admin, draft.id)).toEqual([
          'COC_EARNED_CERTIFICATE_PREPARED',
          'COC_EARNED_CERTIFICATE_SUBMITTED',
          'COC_EARNED_CERTIFICATE_RETURNED',
          'COC_EARNED_CERTIFICATE_SUBMITTED',
          'COC_EARNED_CERTIFICATE_RETURNED',
          'COC_EARNED_CERTIFICATE_DISCARDED',
        ]);

        // The released record goes on a new certificate.
        const again = await service.prepare(preparer, {
          employeeId: home.member.id,
          earnedMonth: '2026-06',
        });
        expect(again.lines.map((line) => line.overtimeServiceRecordId)).toEqual([record.id]);
        expect(await activeLines(admin, record.id)).toBe(1);

        // A discarded certificate stays discarded, and its released lines stay released.
        await expect(
          admin.cocEarnedCertificate.update({ where: { id: draft.id }, data: { status: 'DRAFT' } }),
        ).rejects.toThrow(/cannot move from DISCARDED to DRAFT/);
        await expect(
          admin.cocEarnedCertificateLine.updateMany({
            where: { cocEarnedCertificateId: again.id },
            data: { releasedAt: new Date() },
          }),
        ).rejects.toThrow(/Only a DISCARDED Certificate of COC Earned releases its lines/);
      },
    ),
);

it.skipIf(!enabled)('refuses to submit a draft without lines', () =>
  withSetup('empty', async ({ admin, home, preparer, service }) => {
    const empty = await admin.cocEarnedCertificate.create({
      data: {
        agencyId: home.agency.id,
        employeeId: home.member.id,
        earnedMonth: new Date('2026-06-01'),
        status: 'DRAFT',
        preparedByMembershipId: home.membership.id,
      },
    });
    await expect(service.submit(preparer, empty.id)).rejects.toMatchObject({
      code: 'COC_EARNED_CERTIFICATE_NO_LINES',
    });
    expect(await admin.approvalRequest.count({ where: { subjectId: empty.id } })).toBe(0);
  }),
);

it.skipIf(!enabled)("keeps each Agency's certificates and Employees to itself", () =>
  withSetup('agency', async ({ admin, home, foreign, preparer, cocAuthority, controller }) => {
    await serviceRecord(home, {
      authorityId: cocAuthority,
      employeeId: home.member.id,
      workDate: '2026-06-10',
    });
    const certificate = await controller.prepare(
      home.agency.id,
      { employeeId: home.member.id, earnedMonth: '2026-06' },
      preparer,
    );
    const outsider = context(foreign.agency.id, foreign.user.id, foreign.membership.id, [
      ...PREPARER_GRANTS,
      ...APPROVER_GRANTS,
    ]);

    // The other Agency's path is refused before any read.
    expect(
      await errorOf(controller.submit(home.agency.id, certificate.id, outsider)),
    ).toMatchObject({
      status: 403,
      body: { error: { code: 'COC_EARNED_CERTIFICATE_WRITE_FORBIDDEN' } },
    });
    // In its own Agency's context, the certificate and the Employee do not exist.
    for (const command of [
      () => controller.submit(foreign.agency.id, certificate.id, outsider),
      () => controller.discard(foreign.agency.id, certificate.id, outsider),
      () => controller.return(foreign.agency.id, certificate.id, { reason: 'Not ours.' }, outsider),
    ]) {
      expect(await errorOf(command())).toMatchObject({
        status: 404,
        body: { error: { code: 'COC_EARNED_CERTIFICATE_NOT_FOUND' } },
      });
    }
    expect(
      await errorOf(
        controller.prepare(
          foreign.agency.id,
          { employeeId: home.member.id, earnedMonth: '2026-06' },
          outsider,
        ),
      ),
    ).toMatchObject({
      status: 404,
      body: { error: { code: 'COC_EARNED_CERTIFICATE_EMPLOYEE_NOT_FOUND' } },
    });
    const stored = await admin.cocEarnedCertificate.findUniqueOrThrow({
      where: { id: certificate.id },
    });
    expect(stored.status).toBe('DRAFT');
    expect(await admin.cocEarnedCertificate.count({ where: { agencyId: foreign.agency.id } })).toBe(
      0,
    );
  }),
);
