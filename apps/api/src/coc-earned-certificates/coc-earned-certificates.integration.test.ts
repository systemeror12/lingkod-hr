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
import { CocAccountsService } from '../coc-accounts/coc-accounts.service';
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

/** Valid Until is December 31 of the next year, so this month's COC stays awardable. */
const YEAR = new Date().getUTCFullYear();
const EARNED_MONTH = `${YEAR}-06`;

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
  const service = new CocEarnedCertificatesService(
    overtimeAuthorityAuditWriter,
    approvals,
    new CocAccountsService(),
  );
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
    dayClassification?: string;
  },
) {
  const status = options.status ?? 'CERTIFIED';
  const certifiedMinutes = options.certifiedMinutes ?? 120;
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
        actualMinutes: Math.max(180, certifiedMinutes),
        sourceAttendanceDayId: randomUUID(),
        dayClassification: options.dayClassification ?? 'WORKDAY',
        status,
        recordedByMembershipId: home.membership.id,
        ...(status === 'CERTIFIED'
          ? {
              certifiedMinutes,
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
      await transaction.cocLedgerEntry.deleteMany({ where });
      await transaction.cocAccount.deleteMany({ where });
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

/** Prepare and submit a certificate for the fixture's member over `lines`. */
async function submitted(
  { home, preparer, cocAuthority, service }: Setup,
  lines: { day: string; certifiedMinutes?: number; dayClassification?: string }[],
  month = EARNED_MONTH,
) {
  for (const { day, ...line } of lines) {
    await serviceRecord(home, {
      authorityId: cocAuthority,
      employeeId: home.member.id,
      workDate: `${month}-${day}`,
      ...line,
    });
  }
  const draft = await service.prepare(preparer, {
    employeeId: home.member.id,
    earnedMonth: month,
  });
  return service.submit(preparer, draft.id);
}

/** Everything an approval writes, to prove a refusal or failure left none of it. */
async function approvalTrace(admin: PrismaClient, agencyId: string, certificateId: string) {
  const certificate = await admin.cocEarnedCertificate.findUniqueOrThrow({
    where: { id: certificateId },
    select: {
      status: true,
      approvedByMembershipId: true,
      approvedAt: true,
      lines: { select: { creditedMinutes: true, excessMinutes: true } },
    },
  });
  const request = await admin.approvalRequest.findFirstOrThrow({
    where: { subjectType: 'COC_EARNED_CERTIFICATE', subjectId: certificateId },
    select: { status: true },
  });
  return {
    certificate,
    requestStatus: request.status,
    decisions: await admin.approvalDecision.count({ where: { agencyId } }),
    entries: await admin.cocLedgerEntry.count({ where: { agencyId } }),
    accounts: await admin.cocAccount.count({ where: { agencyId } }),
    approvedEvents: await admin.auditEvent.count({
      where: { entityId: certificateId, action: 'COC_EARNED_CERTIFICATE_APPROVED' },
    }),
  };
}

async function expectNothingApproved(admin: PrismaClient, agencyId: string, certificateId: string) {
  const trace = await approvalTrace(admin, agencyId, certificateId);
  expect(trace).toMatchObject({
    certificate: { status: 'FOR_APPROVAL', approvedByMembershipId: null, approvedAt: null },
    requestStatus: 'IN_PROGRESS',
    decisions: 0,
    entries: 0,
    accounts: 0,
    approvedEvents: 0,
  });
  expect(
    trace.certificate.lines.every(
      (line) => line.creditedMinutes === null && line.excessMinutes === null,
    ),
  ).toBe(true);
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
    expect(
      await errorOf(controller.approve(home.agency.id, certificate.id, outsider)),
    ).toMatchObject({
      status: 403,
      body: { error: { code: 'COC_EARNED_CERTIFICATE_WRITE_FORBIDDEN' } },
    });
    // In its own Agency's context, the certificate and the Employee do not exist.
    for (const command of [
      () => controller.submit(foreign.agency.id, certificate.id, outsider),
      () => controller.discard(foreign.agency.id, certificate.id, outsider),
      () => controller.approve(foreign.agency.id, certificate.id, outsider),
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

it.skipIf(!enabled)(
  'approves through the Approval Route, awards COC once, freezes the amounts, and replays a retry',
  () =>
    withSetup('approve', async (fixture) => {
      const { admin, home, approver, controller } = fixture;
      const certificate = await submitted(fixture, [
        { day: '03', certifiedMinutes: 120 },
        { day: '10', certifiedMinutes: 90, dayClassification: 'REST_DAY' },
        { day: '20', certifiedMinutes: 2000, dayClassification: 'REGULAR_HOLIDAY' },
      ]);

      const approved = await controller.approve(home.agency.id, certificate.id, approver);

      expect(approved).toMatchObject({
        status: 'APPROVED',
        approvedByMembershipId: approver.membershipId,
      });
      expect(approved.approvedAt).not.toBeNull();
      // 1.0 on a workday, 1.5 on a rest day or holiday, and the 2,400-minute
      // monthly cap leaves the last line 2,145 of its 3,000.
      expect(approved.lines.map((line) => [line.creditedMinutes, line.excessMinutes])).toEqual([
        ['120.0', '0.0'],
        ['135.0', '0.0'],
        ['2145.0', '855.0'],
      ]);

      const entries = await admin.cocLedgerEntry.findMany({
        where: { agencyId: home.agency.id, sourceId: certificate.id },
        orderBy: { minutes: 'asc' },
      });
      expect(
        entries.map((entry) => [
          entry.sourceType,
          entry.sourcePostingKey,
          entry.minutes.toFixed(1),
          entry.postedByMembershipId,
          entry.validUntil.toISOString().slice(0, 10),
          entry.earnedMonth?.toISOString().slice(0, 10),
        ]),
      ).toEqual(
        approved.lines.map((line) => [
          'COC_EARNED_CERTIFICATE',
          line.id,
          line.creditedMinutes,
          approver.membershipId,
          `${YEAR + 1}-12-31`,
          `${EARNED_MONTH}-01`,
        ]),
      );

      const request = await admin.approvalRequest.findFirstOrThrow({
        where: { subjectType: 'COC_EARNED_CERTIFICATE', subjectId: certificate.id },
      });
      expect(request.status).toBe('APPROVED');
      expect(await auditActions(admin, certificate.id)).toEqual([
        'COC_EARNED_CERTIFICATE_PREPARED',
        'COC_EARNED_CERTIFICATE_SUBMITTED',
        'COC_EARNED_CERTIFICATE_APPROVED',
      ]);
      const event = await admin.auditEvent.findFirstOrThrow({
        where: { entityId: certificate.id, action: 'COC_EARNED_CERTIFICATE_APPROVED' },
      });
      expect(event).toMatchObject({
        actorMembershipId: approver.membershipId,
        previousStatus: 'FOR_APPROVAL',
        newStatus: 'APPROVED',
      });
      expect(event.metadata).toMatchObject({
        approvalRequestId: request.id,
        validUntil: `${YEAR + 1}-12-31`,
      });

      // A retry returns the first result and writes nothing.
      const before = await approvalTrace(admin, home.agency.id, certificate.id);
      expect(await controller.approve(home.agency.id, certificate.id, approver)).toEqual(approved);
      expect(await approvalTrace(admin, home.agency.id, certificate.id)).toEqual(before);

      // Only the approver retries. Anyone else finds it already decided.
      const other = await addMember(
        admin,
        home,
        `${Date.now()}-other`,
        'other',
        'appointing_authority',
        APPROVER_GRANTS,
      );
      expect(
        await errorOf(controller.approve(home.agency.id, certificate.id, other)),
      ).toMatchObject({
        status: 409,
        body: { error: { code: 'COC_EARNED_CERTIFICATE_NOT_FOR_APPROVAL' } },
      });

      // A later certificate past the monthly cap credits nothing, which leaves
      // no ledger trace, and its retry still awards nothing.
      const full = await submitted(fixture, [{ day: '25', certifiedMinutes: 60 }]);
      const uncredited = await controller.approve(home.agency.id, full.id, approver);
      expect(uncredited.lines.map((line) => [line.creditedMinutes, line.excessMinutes])).toEqual([
        ['0.0', '60.0'],
      ]);
      expect(await controller.approve(home.agency.id, full.id, approver)).toEqual(uncredited);
      expect(await admin.cocLedgerEntry.count({ where: { sourceId: full.id } })).toBe(0);

      // The approved certificate and its frozen amounts are immutable.
      await expect(
        admin.cocEarnedCertificate.update({
          where: { id: certificate.id },
          data: { status: 'DRAFT' },
        }),
      ).rejects.toThrow(/cannot move from APPROVED to DRAFT/);
      await expect(
        admin.cocEarnedCertificateLine.update({
          where: { id: approved.lines[0]!.id },
          data: { creditedMinutes: '1.0' },
        }),
      ).rejects.toThrow(/line can only be released/);
    }),
);

it.skipIf(!enabled)('awards once when two approvals of one certificate race', () =>
  withSetup('approve-race', async (fixture) => {
    const { admin, home, approver } = fixture;
    const certificate = await submitted(fixture, [
      { day: '03', certifiedMinutes: 120 },
      { day: '10', certifiedMinutes: 60 },
    ]);

    const [first, second] = await Promise.all([
      services().service.approve(approver, certificate.id),
      services().service.approve(approver, certificate.id),
    ]);

    expect(second).toEqual(first);
    expect(first.lines.map((line) => line.creditedMinutes)).toEqual(['120.0', '60.0']);
    const trace = await approvalTrace(admin, home.agency.id, certificate.id);
    expect(trace).toMatchObject({
      requestStatus: 'APPROVED',
      decisions: 1,
      entries: 2,
      accounts: 1,
      approvedEvents: 1,
    });
  }),
);

it.skipIf(!enabled)('refuses a line on a work suspension with a typed reason per line', () =>
  withSetup('suspension', async (fixture) => {
    const { admin, home, approver, controller } = fixture;
    const certificate = await submitted(fixture, [
      { day: '03' },
      { day: '10', dayClassification: 'WORK_SUSPENSION' },
      { day: '17', dayClassification: 'PARTIAL_DAY_WORK_SUSPENSION' },
    ]);
    const [, wholeDay, partialDay] = certificate.lines;

    expect(await errorOf(controller.approve(home.agency.id, certificate.id, approver))).toEqual({
      status: 409,
      body: {
        error: {
          code: 'COC_WHOLE_DAY_WORK_SUSPENSION',
          message: 'Service during a work suspension earns no COC.',
          refusals: [
            { certificateLineId: wholeDay!.id, code: 'COC_WHOLE_DAY_WORK_SUSPENSION' },
            { certificateLineId: partialDay!.id, code: 'COC_PARTIAL_DAY_WORK_SUSPENSION' },
          ],
          requestId: approver.requestId,
        },
      },
    });
    await expectNothingApproved(admin, home.agency.id, certificate.id);
  }),
);

it.skipIf(!enabled)("refuses approval once the certificate's Valid Until has passed", () =>
  withSetup('validity', async (fixture) => {
    const { admin, home, approver, controller } = fixture;
    const certificate = await submitted(fixture, [{ day: '03' }], `${YEAR - 2}-06`);

    expect(
      await errorOf(controller.approve(home.agency.id, certificate.id, approver)),
    ).toMatchObject({ status: 409, body: { error: { code: 'COC_VALIDITY_PASSED' } } });
    await expectNothingApproved(admin, home.agency.id, certificate.id);
  }),
);

it.skipIf(!enabled)(
  'lets only an independent, assigned approver approve a submitted certificate',
  () =>
    withSetup('authority', async (fixture) => {
      const { admin, home, preparer, approver, controller, service } = fixture;
      const refused = (status: number, code: string) => ({ status, body: { error: { code } } });
      const certificate = await submitted(fixture, [{ day: '03' }]);

      // Without the permission.
      expect(
        await errorOf(controller.approve(home.agency.id, certificate.id, preparer)),
      ).toMatchObject(refused(403, 'COC_EARNED_CERTIFICATE_FORBIDDEN'));
      // The preparer, even holding the permission.
      const preparerWithGrant = { ...preparer, permissions: APPROVER_GRANTS };
      expect(
        await errorOf(controller.approve(home.agency.id, certificate.id, preparerWithGrant)),
      ).toMatchObject(refused(403, 'COC_EARNED_CERTIFICATE_APPROVER_NOT_INDEPENDENT'));
      // Holding the permission, but not assigned the route's step.
      const unassigned = await addMember(
        admin,
        home,
        `${Date.now()}-unassigned`,
        'unassigned',
        'appointing_authority',
        APPROVER_GRANTS,
      );
      await expect(service.approve(unassigned, certificate.id)).rejects.toMatchObject({
        statusCode: 403,
      });
      // The covered Employee, though assigned the route's step.
      const linkApprover = (employeeId: string | null) =>
        home.asReplica((transaction) =>
          transaction.agencyMembership.update({
            where: { id: approver.membershipId },
            data: { employeeId },
          }),
        );
      await linkApprover(home.member.id);
      expect(
        await errorOf(controller.approve(home.agency.id, certificate.id, approver)),
      ).toMatchObject(refused(403, 'COC_EARNED_CERTIFICATE_APPROVER_NOT_INDEPENDENT'));
      await expectNothingApproved(admin, home.agency.id, certificate.id);

      // Unlinked, the approver can return it and approve it, but not while it is a draft.
      await linkApprover(null);
      await service.return(approver, certificate.id, { reason: 'Recheck June 3.' });
      expect(
        await errorOf(controller.approve(home.agency.id, certificate.id, approver)),
      ).toMatchObject(refused(409, 'COC_EARNED_CERTIFICATE_NOT_FOR_APPROVAL'));
      await service.submit(preparer, certificate.id);
      expect((await service.approve(approver, certificate.id)).status).toBe('APPROVED');
    }),
);

it.skipIf(!enabled)('rolls back the approval and the award when a later step fails', () =>
  withSetup('rollback', async (fixture) => {
    const { admin, home, approver, approvals } = fixture;
    const certificate = await submitted(fixture, [{ day: '03' }]);
    const failing = new CocEarnedCertificatesService(
      {
        write: async (transaction, event) => {
          if (event.action === 'COC_EARNED_CERTIFICATE_APPROVED') {
            throw new Error('The audit store is unavailable.');
          }
          await overtimeAuthorityAuditWriter.write(transaction, event);
        },
      },
      approvals,
      new CocAccountsService(),
    );

    await expect(failing.approve(approver, certificate.id)).rejects.toThrow(
      'The audit store is unavailable.',
    );
    await expectNothingApproved(admin, home.agency.id, certificate.id);

    // Only approval freezes amounts, so a line awaiting approval refuses them.
    await expect(
      admin.cocEarnedCertificateLine.update({
        where: { id: certificate.lines[0]!.id },
        data: { creditedMinutes: '120.0', excessMinutes: '0.0' },
      }),
    ).rejects.toThrow(/line can only be released/);

    // The certificate is still approvable once the failure clears.
    const approved = await fixture.service.approve(approver, certificate.id);
    expect(approved.lines.map((line) => line.creditedMinutes)).toEqual(['120.0']);
  }),
);

it.skipIf(!enabled)('refuses to approve a certificate the ledger already holds entries for', () =>
  withSetup('awarded', async (fixture) => {
    const { admin, home, approver, service } = fixture;
    const certificate = await submitted(fixture, [{ day: '03' }]);
    const [line] = certificate.lines;
    const award = {
      certificateId: certificate.id,
      employeeId: home.member.id,
      earnedMonth: `${EARNED_MONTH}-01`,
      approvalDate: `${YEAR}-06-30`,
      approvedByMembershipId: approver.membershipId,
      lines: [
        {
          certificateLineId: line!.id,
          workDate: line!.workDate,
          certifiedMinutes: line!.certifiedMinutes,
          dayClassification: 'WORKDAY' as const,
        },
      ],
    };
    await home.asReplica((transaction) =>
      new CocAccountsService().awardEarnedCocInTransaction(transaction, home.agency.id, award),
    );

    await expect(service.approve(approver, certificate.id)).rejects.toMatchObject({
      code: 'COC_EARNED_CERTIFICATE_ALREADY_AWARDED',
    });
    const trace = await approvalTrace(admin, home.agency.id, certificate.id);
    expect(trace).toMatchObject({
      certificate: { status: 'FOR_APPROVAL' },
      requestStatus: 'IN_PROGRESS',
      decisions: 0,
      entries: 1,
    });
  }),
);

it.skipIf(!enabled)(
  'lists and reads certificates for a preparer or an approver, with each line as the API holds it',
  () =>
    withSetup('read', async (fixture) => {
      const { admin, home, foreign, preparer, approver, controller, service } = fixture;
      const submittedCertificate = await submitted(fixture, [
        { day: '03', certifiedMinutes: 2000 },
        { day: '20', certifiedMinutes: 500 },
      ]);
      await serviceRecord(home, {
        authorityId: fixture.cocAuthority,
        employeeId: home.chief.id,
        workDate: `${EARNED_MONTH}-05`,
      });
      const draft = await service.prepare(preparer, {
        employeeId: home.chief.id,
        earnedMonth: EARNED_MONTH,
      });

      // An approver finds a certificate someone else prepared, before it credits anything.
      const awaiting = await controller.list(home.agency.id, { status: 'FOR_APPROVAL' }, approver);
      expect(awaiting.certificates.map((row) => row.id)).toEqual([submittedCertificate.id]);
      expect(awaiting.certificates[0]).toMatchObject({
        employeeId: home.member.id,
        employeeNumber: home.member.employeeNumber,
        employeeName: home.member.legalName,
        preparedByMembershipId: preparer.membershipId,
        status: 'FOR_APPROVAL',
      });
      expect(
        awaiting.certificates[0]?.lines.map((line) => [
          line.certifiedMinutes,
          line.creditedMinutes,
          line.excessMinutes,
        ]),
      ).toEqual([
        [2000, null, null],
        [500, null, null],
      ]);

      // A preparer holds only `.prepare`, and an approver only `.approve`; each reads all.
      for (const reader of [preparer, approver]) {
        const all = await controller.list(home.agency.id, {}, reader);
        expect(all.certificates.map((row) => row.id).sort()).toEqual(
          [submittedCertificate.id, draft.id].sort(),
        );
        expect(await controller.detail(home.agency.id, draft.id, reader)).toMatchObject({
          employeeNumber: home.chief.employeeNumber,
          employeeName: home.chief.legalName,
          status: 'DRAFT',
        });
      }

      // After approval, each line shows what was frozen: 2,400 minutes is the monthly cap.
      await controller.approve(home.agency.id, submittedCertificate.id, approver);
      const approved = await controller.detail(home.agency.id, submittedCertificate.id, preparer);
      expect(
        approved.lines.map((line) => [
          line.certifiedMinutes,
          line.creditedMinutes,
          line.excessMinutes,
        ]),
      ).toEqual([
        [2000, '2000.0', '0.0'],
        [500, '400.0', '100.0'],
      ]);
      const onlyApproved = await controller.list(home.agency.id, { status: 'APPROVED' }, preparer);
      expect(onlyApproved.certificates.map((row) => row.id)).toEqual([submittedCertificate.id]);
      expect(
        await errorOf(controller.list(home.agency.id, { status: 'LOST' }, preparer)),
      ).toMatchObject({ status: 400, body: { error: { code: 'INVALID_INPUT' } } });
      expect(
        await errorOf(controller.detail(home.agency.id, 'not-a-uuid', preparer)),
      ).toMatchObject({
        status: 404,
        body: { error: { code: 'COC_EARNED_CERTIFICATE_NOT_FOUND' } },
      });

      // Neither `overtime.coc.read` nor a grant short of Agency-wide reads a certificate.
      const refused: RequestContext['permissions'][] = [
        [],
        [{ code: 'overtime.coc.read', scopePolicy: 'AGENCY' }],
        [{ code: 'overtime.coc_certificates.approve', scopePolicy: 'DIRECT_REPORTS' }],
        [{ code: 'overtime.coc_certificates.prepare', scopePolicy: 'OWN' }],
      ];
      for (const permissions of refused) {
        const actor = context(home.agency.id, home.user.id, home.membership.id, permissions);
        for (const read of [
          controller.list(home.agency.id, {}, actor),
          controller.detail(home.agency.id, draft.id, actor),
        ]) {
          expect(await errorOf(read)).toMatchObject({
            status: 403,
            body: { error: { code: 'COC_EARNED_CERTIFICATE_FORBIDDEN' } },
          });
        }
      }

      // Another Agency reads neither the home register nor a home certificate.
      const foreignPreparer = context(
        foreign.agency.id,
        foreign.user.id,
        foreign.membership.id,
        PREPARER_GRANTS,
      );
      expect(await errorOf(controller.list(home.agency.id, {}, foreignPreparer))).toMatchObject({
        status: 403,
        body: { error: { code: 'COC_EARNED_CERTIFICATE_READ_FORBIDDEN' } },
      });
      expect(
        await errorOf(controller.detail(home.agency.id, draft.id, foreignPreparer)),
      ).toMatchObject({
        status: 403,
        body: { error: { code: 'COC_EARNED_CERTIFICATE_READ_FORBIDDEN' } },
      });
      expect(
        await errorOf(controller.detail(foreign.agency.id, draft.id, foreignPreparer)),
      ).toMatchObject({
        status: 404,
        body: { error: { code: 'COC_EARNED_CERTIFICATE_NOT_FOUND' } },
      });
      expect((await controller.list(foreign.agency.id, {}, foreignPreparer)).certificates).toEqual(
        [],
      );

      // A read leaves no Audit Event behind.
      const audits = await admin.auditEvent.count({ where: { agencyId: home.agency.id } });
      await controller.list(home.agency.id, {}, approver);
      await controller.detail(home.agency.id, draft.id, approver);
      expect(await admin.auditEvent.count({ where: { agencyId: home.agency.id } })).toBe(audits);
    }),
  120_000,
);
