import { withDatabaseContext } from '@lingkod-hr/database';
import { expect, it } from 'vitest';
import { createAdminClient } from '../attendance-test-fixtures';
import type { EligibilitySnapshot } from './overtime-authorities.types';
import {
  addMember,
  APPROVER_GRANTS,
  cleanup,
  context,
  createAgency,
  enabled,
  errorOf,
  giveRole,
  grants,
  REVIEWER_GRANTS,
  seedEligibilityFacts,
  seedRoute,
  services,
} from './overtime-authority-test-fixtures';

const attestationsFor = (memberId: string, chiefId: string) => [
  {
    employeeId: memberId,
    positionLevel: 'DIVISION_CHIEF_OR_BELOW' as const,
    noOtherBeyondHoursAllowance: true as const,
  },
  {
    employeeId: chiefId,
    positionLevel: 'OIC_OF_HIGHER_POSITION' as const,
    noOtherBeyondHoursAllowance: true as const,
  },
];

/**
 * One home Agency with a preparer (who also holds the Approving Official role,
 * so only segregation stops them), a Budget Officer reviewer, an Approving
 * Official on the route, and a foreign Agency. `route` overrides who the
 * route's steps are assigned to.
 */
async function setup(
  label: string,
  options: { route?: 'approver' | 'preparer' | 'two-steps' } = {},
) {
  const admin = await createAdminClient();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-ot-${label}`;
  const home = await createAgency(admin, suffix, `${label}H`);
  const foreign = await createAgency(admin, suffix, `${label}F`);
  const teardown = async () => {
    await cleanup(admin, [home.agency.id, foreign.agency.id], suffix);
    await admin.$disconnect();
  };
  const all = services();
  const reviewer = await addMember(admin, home, suffix, 'reviewer', 'budget_officer', [
    ...REVIEWER_GRANTS,
    { code: 'approvals.requests.cancel', scopePolicy: 'AGENCY' },
  ]);
  await giveRole(admin, home.agency.id, home.membership.id, 'appointing_authority');
  const preparer = context(home.agency.id, home.user.id, home.membership.id, [
    ...grants('AGENCY'),
    ...REVIEWER_GRANTS,
    ...APPROVER_GRANTS,
  ]);
  const route = options.route ?? 'approver';
  const approver =
    route === 'preparer'
      ? preparer
      : await addMember(admin, home, suffix, 'approver', 'appointing_authority', APPROVER_GRANTS);
  if (route === 'two-steps') {
    const second = await addMember(
      admin,
      home,
      suffix,
      'second',
      'appointing_authority',
      APPROVER_GRANTS,
    );
    await seedRoute(home, approver.membershipId, second.membershipId);
  } else {
    await seedRoute(home, approver.membershipId);
  }
  const facts = await seedEligibilityFacts(home);
  const foreignApprover = context(foreign.agency.id, foreign.user.id, foreign.membership.id, [
    ...REVIEWER_GRANTS,
    ...APPROVER_GRANTS,
  ]);
  const attestations = attestationsFor(home.member.id, home.chief.id);

  const prepare = async (authorityNo: string) => {
    const draft = await all.create.execute(preparer, {
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
    await all.submit.execute(preparer, draft.id);
    return draft;
  };
  const prepareReviewed = async (authorityNo: string) => {
    const draft = await prepare(authorityNo);
    await all.review.execute(reviewer, draft.id, { attestations });
    const request = await admin.approvalRequest.findFirstOrThrow({
      where: { agencyId: home.agency.id, subjectType: 'OVERTIME_AUTHORITY', subjectId: draft.id },
    });
    return { draft, request };
  };
  return {
    ...all,
    admin,
    home,
    foreign,
    reviewer,
    approver,
    preparer,
    foreignApprover,
    facts,
    attestations,
    prepare,
    prepareReviewed,
    teardown,
  };
}

it.skipIf(!enabled)(
  'reviews a submitted authority and opens its Approval Request',
  async () => {
    const f = await setup('REV');
    try {
      const authority = await f.prepare('OT-REV-1');
      // Nobody reviews an authority they prepared or submitted.
      expect(
        await errorOf(
          f.controller.review(
            f.home.agency.id,
            authority.id,
            { attestations: f.attestations },
            f.preparer,
          ),
        ),
      ).toMatchObject({
        status: 403,
        body: { error: { code: 'OVERTIME_AUTHORITY_SEGREGATION_REQUIRED' } },
      });
      // Every covered Employee, and only them, is attested.
      expect(
        await errorOf(
          f.controller.review(
            f.home.agency.id,
            authority.id,
            { attestations: f.attestations.slice(0, 1) },
            f.reviewer,
          ),
        ),
      ).toMatchObject({
        status: 422,
        body: { error: { code: 'OVERTIME_AUTHORITY_ATTESTATIONS_MISMATCH' } },
      });
      // Approval waits for review.
      expect(
        await errorOf(
          f.controller.approve(
            f.home.agency.id,
            authority.id,
            { compensationMethod: 'COC' },
            f.approver,
          ),
        ),
      ).toMatchObject({
        status: 409,
        body: { error: { code: 'OVERTIME_AUTHORITY_STATUS_INVALID' } },
      });

      const reviewed = await f.controller.review(
        f.home.agency.id,
        authority.id,
        { attestations: f.attestations },
        f.reviewer,
      );
      expect(reviewed.status).toBe('FOR_REVIEW');
      const request = await f.admin.approvalRequest.findFirstOrThrow({
        where: { agencyId: f.home.agency.id, subjectId: authority.id },
      });
      expect(request).toMatchObject({
        status: 'IN_PROGRESS',
        requestedByMembershipId: f.reviewer.membershipId,
      });
    } finally {
      await f.teardown();
    }
  },
  60_000,
);

it.skipIf(!enabled)(
  'refuses a review when the Overtime Authority route has more than one step',
  async () => {
    const f = await setup('TWO', { route: 'two-steps' });
    try {
      const authority = await f.prepare('OT-TWO-1');
      await expect(
        f.review.execute(f.reviewer, authority.id, { attestations: f.attestations }),
      ).rejects.toMatchObject({ statusCode: 409, code: 'OVERTIME_AUTHORITY_ROUTE_INVALID' });
      expect(
        await f.admin.overtimeAuthority.findUniqueOrThrow({ where: { id: authority.id } }),
      ).toMatchObject({ status: 'SUBMITTED' });
    } finally {
      await f.teardown();
    }
  },
  60_000,
);

it.skipIf(!enabled)(
  'refuses a review when only the preparer could approve',
  async () => {
    const f = await setup('SOLE', { route: 'preparer' });
    try {
      const authority = await f.prepare('OT-SOLE-1');
      await expect(
        f.review.execute(f.reviewer, authority.id, { attestations: f.attestations }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'OVERTIME_AUTHORITY_NO_ELIGIBLE_APPROVER',
      });
    } finally {
      await f.teardown();
    }
  },
  60_000,
);

it.skipIf(!enabled)(
  'refuses the generic Approval API and keeps the authority decidable',
  async () => {
    const f = await setup('GEN');
    try {
      const { draft, request } = await f.prepareReviewed('OT-GEN-1');
      await expect(f.approvals.approve(f.approver, request.id)).rejects.toMatchObject({
        code: 'OVERTIME_AUTHORITY_APPROVAL_EFFECT_REQUIRED',
      });
      await expect(f.approvals.reject(f.approver, request.id, 'Bypass.')).rejects.toMatchObject({
        code: 'OVERTIME_AUTHORITY_APPROVAL_EFFECT_REQUIRED',
      });
      // The reviewer drafted the request and holds the cancel grant, yet cannot cancel it.
      await expect(
        f.approvals.cancel(f.reviewer, request.id, 'Strand the authority.'),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'OVERTIME_AUTHORITY_APPROVAL_CANCEL_FORBIDDEN',
      });
      expect(
        await f.admin.approvalRequest.findUniqueOrThrow({ where: { id: request.id } }),
      ).toMatchObject({ status: 'IN_PROGRESS' });
      expect(
        await f.approve.execute(f.approver, draft.id, { compensationMethod: 'COC' }),
      ).toMatchObject({ status: 'APPROVED' });
    } finally {
      await f.teardown();
    }
  },
  60_000,
);

it.skipIf(!enabled)(
  'approves as COC, refusing self-approval and overtime pay, and snapshots eligibility',
  async () => {
    const f = await setup('APR');
    try {
      const { draft, request } = await f.prepareReviewed('OT-APR-1');
      expect(
        await errorOf(
          f.controller.approve(
            f.home.agency.id,
            draft.id,
            { compensationMethod: 'COC' },
            f.preparer,
          ),
        ),
      ).toMatchObject({
        status: 403,
        body: { error: { code: 'OVERTIME_AUTHORITY_SEGREGATION_REQUIRED' } },
      });
      // Overtime pay waits for Payroll (#347).
      expect(
        await errorOf(
          f.controller.approve(
            f.home.agency.id,
            draft.id,
            { compensationMethod: 'OVERTIME_PAY' },
            f.approver,
          ),
        ),
      ).toMatchObject({
        status: 409,
        body: { error: { code: 'OVERTIME_AUTHORITY_OVERTIME_PAY_BLOCKED_BY_PAYROLL' } },
      });

      const approved = await f.controller.approve(
        f.home.agency.id,
        draft.id,
        { compensationMethod: 'COC', comments: 'Approved as COC.' },
        f.approver,
      );
      expect(approved).toMatchObject({
        status: 'APPROVED',
        compensationMethod: 'COC',
        approvedByMembershipId: f.approver.membershipId,
      });
      expect(approved.approvedAt).not.toBeNull();
      const snapshot = (employeeId: string) =>
        approved.employees.find((row) => row.employeeId === employeeId)
          ?.eligibilitySnapshot as EligibilitySnapshot;
      expect(snapshot(f.home.member.id)).toMatchObject({
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
            workArrangementVersionId: f.facts.workArrangementVersionId,
            arrangementType: 'ONSITE',
            effectiveFrom: '2030-01-01',
            effectiveTo: null,
          },
        ],
        attestation: {
          positionLevel: 'DIVISION_CHIEF_OR_BELOW',
          noOtherBeyondHoursAllowance: true,
          reviewedByMembershipId: f.reviewer.membershipId,
        },
      });
      // The position version over the Work Dates is SUPERSEDED by a later one, and still counts.
      expect(snapshot(f.home.chief.id)).toMatchObject({
        service: [
          {
            positionId: f.home.chiefPosition.id,
            positionItemNumber: f.home.chiefPosition.itemNumber,
            positionTitle: 'Chief Administrative Officer',
            personnelCategory: 'PLANTILLA',
          },
        ],
        workArrangements: [],
        attestation: { positionLevel: 'OIC_OF_HIGHER_POSITION' },
      });
      expect(
        await f.admin.approvalRequest.findUniqueOrThrow({ where: { id: request.id } }),
      ).toMatchObject({ status: 'APPROVED' });
    } finally {
      await f.teardown();
    }
  },
  60_000,
);

it.skipIf(!enabled)(
  'gives an approved authority no edit path',
  async () => {
    const f = await setup('IMM');
    try {
      const { draft } = await f.prepareReviewed('OT-IMM-1');
      await f.approve.execute(f.approver, draft.id, { compensationMethod: 'COC' });
      expect(
        await errorOf(
          f.controller.update(
            f.home.agency.id,
            draft.id,
            {
              authorityNo: 'OT-IMM-1',
              requestingUnitId: f.home.division.id,
              purpose: 'Rewritten.',
              workDateFrom: '2030-06-01',
              workDateTo: '2030-06-30',
              compensationMethod: 'COC',
              employees: [{ employeeId: f.home.member.id, authorizedHours: '16' }],
            },
            f.preparer,
          ),
        ),
      ).toMatchObject({ status: 409, body: { error: { code: 'OVERTIME_AUTHORITY_NOT_DRAFT' } } });
      const homeDatabase = {
        agencyId: f.home.agency.id,
        userId: f.home.user.id,
        membershipId: f.home.membership.id,
      };
      await expect(
        withDatabaseContext(homeDatabase, (transaction) =>
          transaction.overtimeAuthority.update({
            where: { agencyId_id: { agencyId: f.home.agency.id, id: draft.id } },
            data: { compensationMethod: 'OVERTIME_PAY' },
          }),
        ),
      ).rejects.toThrow(/An APPROVED Overtime Authority is immutable/);
      await expect(
        withDatabaseContext(homeDatabase, (transaction) =>
          transaction.overtimeAuthorityEmployee.updateMany({
            where: { overtimeAuthorityId: draft.id },
            data: { eligibilitySnapshot: {} },
          }),
        ),
      ).rejects.toThrow(/Covered Employees change only while/);
      expect(
        await errorOf(
          f.controller.reject(f.home.agency.id, draft.id, { reason: 'Late.' }, f.approver),
        ),
      ).toMatchObject({
        status: 409,
        body: { error: { code: 'OVERTIME_AUTHORITY_STATUS_INVALID' } },
      });
    } finally {
      await f.teardown();
    }
  },
  60_000,
);

it.skipIf(!enabled)(
  'lets only the Approving Official cancel an approved authority',
  async () => {
    const f = await setup('CAN');
    try {
      const { draft } = await f.prepareReviewed('OT-CAN-1');
      await f.approve.execute(f.approver, draft.id, { compensationMethod: 'COC' });
      const hrOnly = context(
        f.home.agency.id,
        f.home.user.id,
        f.home.membership.id,
        grants('AGENCY'),
      );
      expect(await errorOf(f.controller.cancel(f.home.agency.id, draft.id, hrOnly))).toMatchObject({
        status: 403,
      });
      expect(
        await errorOf(f.controller.cancel(f.home.agency.id, draft.id, f.foreignApprover)),
      ).toMatchObject({ status: 403 });
      expect(await f.controller.cancel(f.home.agency.id, draft.id, f.approver)).toMatchObject({
        status: 'CANCELLED',
        compensationMethod: 'COC',
        approvedByMembershipId: f.approver.membershipId,
      });
      const events = await f.admin.auditEvent.findMany({
        where: { agencyId: f.home.agency.id, entityType: 'OvertimeAuthority', entityId: draft.id },
        orderBy: { occurredAt: 'asc' },
        select: { action: true },
      });
      expect(events.map((event) => event.action)).toEqual([
        'OVERTIME_AUTHORITY_CREATED',
        'OVERTIME_AUTHORITY_SUBMITTED',
        'OVERTIME_AUTHORITY_REVIEWED',
        'OVERTIME_AUTHORITY_APPROVED',
        'OVERTIME_AUTHORITY_CANCELLED',
      ]);
    } finally {
      await f.teardown();
    }
  },
  60_000,
);

it.skipIf(!enabled)(
  'rejects with a required reason, and the rejection is final',
  async () => {
    const f = await setup('REJ');
    try {
      const { draft, request } = await f.prepareReviewed('OT-REJ-1');
      expect(
        await errorOf(
          f.controller.reject(f.home.agency.id, draft.id, { reason: '  ' }, f.approver),
        ),
      ).toMatchObject({ status: 400, body: { error: { fields: { reason: expect.any(String) } } } });
      expect(
        await f.reject.execute(f.approver, draft.id, { reason: 'Not necessary this month.' }),
      ).toMatchObject({ status: 'REJECTED' });
      expect(
        await f.admin.approvalRequest.findUniqueOrThrow({ where: { id: request.id } }),
      ).toMatchObject({ status: 'REJECTED' });
      await expect(f.cancel.execute(f.approver, draft.id)).rejects.toMatchObject({
        statusCode: 409,
      });
      expect(
        await f.admin.auditEvent.findFirst({
          where: { entityId: draft.id, action: 'OVERTIME_AUTHORITY_REJECTED' },
          select: { reason: true },
        }),
      ).toEqual({ reason: 'Not necessary this month.' });
    } finally {
      await f.teardown();
    }
  },
  60_000,
);

it.skipIf(!enabled)(
  'decides only the Approval Request the review opened',
  async () => {
    const f = await setup('BIND');
    try {
      const { draft, request } = await f.prepareReviewed('OT-BIND-1');
      await f.home.asReplica((transaction) =>
        transaction.approvalRequest.update({
          where: { id: request.id },
          data: { status: 'CANCELLED', currentStepNo: null, completedAt: new Date() },
        }),
      );
      await expect(
        f.approve.execute(f.approver, draft.id, { compensationMethod: 'COC' }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'OVERTIME_AUTHORITY_APPROVAL_REQUEST_MISSING',
      });
      await expect(
        f.reject.execute(f.approver, draft.id, { reason: 'No request.' }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'OVERTIME_AUTHORITY_APPROVAL_REQUEST_MISSING',
      });
    } finally {
      await f.teardown();
    }
  },
  60_000,
);

it.skipIf(!enabled)(
  'hides an authority from another Agency',
  async () => {
    const f = await setup('XAG');
    try {
      const submitted = await f.prepare('OT-XAG-1');
      await expect(
        f.review.execute(f.foreignApprover, submitted.id, { attestations: f.attestations }),
      ).rejects.toMatchObject({ statusCode: 404, code: 'OVERTIME_AUTHORITY_NOT_FOUND' });
      expect(
        await errorOf(
          f.controller.review(
            f.home.agency.id,
            submitted.id,
            { attestations: f.attestations },
            f.foreignApprover,
          ),
        ),
      ).toMatchObject({
        status: 403,
        body: { error: { code: 'OVERTIME_AUTHORITY_WRITE_FORBIDDEN' } },
      });
      const { draft } = await f.prepareReviewed('OT-XAG-2');
      await expect(
        f.approve.execute(f.foreignApprover, draft.id, { compensationMethod: 'COC' }),
      ).rejects.toMatchObject({ statusCode: 404 });
      await expect(
        f.reject.execute(f.foreignApprover, draft.id, { reason: 'Not ours.' }),
      ).rejects.toMatchObject({ statusCode: 404 });
      await expect(f.cancel.execute(f.foreignApprover, draft.id)).rejects.toMatchObject({
        statusCode: 404,
      });
    } finally {
      await f.teardown();
    }
  },
  60_000,
);

it.skipIf(!enabled)(
  'lets exactly one of a racing approve and reject decide an Overtime Authority',
  async () => {
    const f = await setup('RACE');
    try {
      for (const authorityNo of ['RACE-1', 'RACE-2', 'RACE-3']) {
        const { draft, request } = await f.prepareReviewed(authorityNo);
        const results = await Promise.allSettled([
          f.approve.execute(f.approver, draft.id, { compensationMethod: 'COC' }),
          f.reject.execute(f.approver, draft.id, { reason: 'Racing rejection.' }),
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
        const stored = await f.admin.overtimeAuthority.findUniqueOrThrow({
          where: { id: draft.id },
        });
        const decided = await f.admin.approvalRequest.findUniqueOrThrow({
          where: { id: request.id },
          include: { steps: { include: { decisions: true } } },
        });
        expect(stored.status).toBe(winner);
        expect(decided.status).toBe(winner);
        expect(decided.steps.flatMap((step) => step.decisions)).toHaveLength(1);
      }
    } finally {
      await f.teardown();
    }
  },
  60_000,
);
