import { withDatabaseContext } from '@lingkod-hr/database';
import type { RequestContext } from '@lingkod-hr/auth';
import { expect, it } from 'vitest';
import { createAdminClient } from '../attendance-test-fixtures';
import {
  addMember,
  APPROVER_GRANTS,
  cleanup,
  context,
  createAgency,
  enabled,
  errorOf,
  grants,
  REVIEWER_GRANTS,
  seedEligibilityFacts,
  seedRoute,
  services,
} from './overtime-authority-test-fixtures';

const READ = (scopePolicy: 'AGENCY' | 'DIRECT_REPORTS'): RequestContext['permissions'] => [
  { code: 'overtime.authorities.read', scopePolicy },
];

it.skipIf(!enabled)(
  'reads Overtime Authorities with their pending action, review, decision, and history',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-overtime-read`;
    const home = await createAgency(admin, suffix, 'READ');
    const foreign = await createAgency(admin, suffix, 'READF');
    try {
      const { create, submit, review, approve, reject, read, controller } = services();
      const hr = context(home.agency.id, home.user.id, home.membership.id, [
        ...grants('AGENCY'),
        ...READ('AGENCY'),
      ]);
      const reviewer = await addMember(admin, home, suffix, 'reviewer', 'budget_officer', [
        ...REVIEWER_GRANTS,
        ...READ('AGENCY'),
      ]);
      const approver = await addMember(admin, home, suffix, 'approver', 'appointing_authority', [
        ...APPROVER_GRANTS,
        ...READ('AGENCY'),
      ]);
      await seedRoute(home, [approver.membershipId]);
      await seedEligibilityFacts(home);
      const attestations = [
        {
          employeeId: home.member.id,
          positionLevel: 'DIVISION_CHIEF_OR_BELOW' as const,
          noOtherBeyondHoursAllowance: true as const,
        },
      ];
      const prepare = (authorityNo: string) =>
        create.execute(hr, {
          authorityNo,
          requestingUnitId: home.division.id,
          purpose: 'Year-end closing of accounts.',
          workDateFrom: '2030-06-01',
          workDateTo: '2030-06-30',
          compensationMethod: 'COC',
          employees: [{ employeeId: home.member.id, authorizedHours: '16' }],
        });

      const approved = await prepare('READ-1');
      expect(await read.detail(hr, approved.id)).toMatchObject({
        status: 'DRAFT',
        requestingUnitName: 'DIV',
        pendingAction: { role: 'PREPARER', assigneeName: null },
        review: null,
        decision: null,
        history: [{ action: 'OVERTIME_AUTHORITY_CREATED', newStatus: 'DRAFT' }],
      });
      await submit.execute(hr, approved.id);
      expect((await read.detail(hr, approved.id)).pendingAction).toEqual({
        role: 'REVIEWER',
        assigneeName: null,
      });
      await review.execute(reviewer, approved.id, { attestations });
      const forReview = await read.detail(reviewer, approved.id);
      // The open Approval Request's current step names who holds the decision.
      expect(forReview.pendingAction).toEqual({
        role: 'APPROVING_OFFICIAL',
        assigneeName: 'Overtime approver',
      });
      expect(forReview.review).toMatchObject({ reviewedByName: 'Overtime reviewer', attestations });
      await approve.execute(approver, approved.id, {
        compensationMethod: 'COC',
        comments: 'Necessary for the closing.',
      });
      const detail = await controller.detail(home.agency.id, approved.id, approver);
      expect(detail).toMatchObject({
        status: 'APPROVED',
        pendingAction: null,
        decision: {
          decision: 'APPROVE',
          comments: 'Necessary for the closing.',
          decidedByName: 'Overtime approver',
        },
        history: [
          { action: 'OVERTIME_AUTHORITY_CREATED' },
          { action: 'OVERTIME_AUTHORITY_SUBMITTED' },
          { action: 'OVERTIME_AUTHORITY_REVIEWED', actorName: 'Overtime reviewer' },
          { action: 'OVERTIME_AUTHORITY_APPROVED', newStatus: 'APPROVED' },
        ],
      });
      expect(detail.employees[0]?.eligibilitySnapshot).not.toBeNull();
      expect(detail.updatedAt).toBe(detail.history.at(-1)?.occurredAt);

      const rejected = await prepare('READ-2');
      await submit.execute(hr, rejected.id);
      await review.execute(reviewer, rejected.id, { attestations });
      await reject.execute(approver, rejected.id, { reason: 'Not necessary this period.' });
      expect(await read.detail(approver, rejected.id)).toMatchObject({
        status: 'REJECTED',
        decision: { decision: 'REJECT', comments: 'Not necessary this period.' },
      });
      expect((await read.detail(approver, rejected.id)).history.at(-1)).toMatchObject({
        action: 'OVERTIME_AUTHORITY_REJECTED',
        reason: 'Not necessary this period.',
      });

      const all = await controller.list(home.agency.id, {}, hr);
      expect(all.authorities.map((row) => row.authorityNo).sort()).toEqual(['READ-1', 'READ-2']);
      const onlyRejected = await controller.list(home.agency.id, { status: 'REJECTED' }, hr);
      expect(onlyRejected.authorities.map((row) => row.authorityNo)).toEqual(['READ-2']);
      expect(await errorOf(controller.list(home.agency.id, { status: 'LOST' }, hr))).toMatchObject({
        status: 400,
        body: { error: { code: 'INVALID_INPUT' } },
      });

      // Without the read grant, both reads are refused.
      const noRead = context(home.agency.id, home.user.id, home.membership.id, grants('AGENCY'));
      expect(await errorOf(controller.list(home.agency.id, {}, noRead))).toMatchObject({
        status: 403,
        body: { error: { code: 'OVERTIME_AUTHORITY_FORBIDDEN' } },
      });
      expect(await errorOf(controller.detail(home.agency.id, approved.id, noRead))).toMatchObject({
        status: 403,
        body: { error: { code: 'OVERTIME_AUTHORITY_FORBIDDEN' } },
      });

      // Another Agency reads neither the authority nor the home register.
      const foreignHr = context(
        foreign.agency.id,
        foreign.user.id,
        foreign.membership.id,
        READ('AGENCY'),
      );
      expect(await errorOf(controller.list(home.agency.id, {}, foreignHr))).toMatchObject({
        status: 403,
        body: { error: { code: 'OVERTIME_AUTHORITY_READ_FORBIDDEN' } },
      });
      expect(
        await errorOf(controller.detail(foreign.agency.id, approved.id, foreignHr)),
      ).toMatchObject({ status: 404, body: { error: { code: 'OVERTIME_AUTHORITY_NOT_FOUND' } } });
      expect((await controller.list(foreign.agency.id, {}, foreignHr)).authorities).toEqual([]);
    } finally {
      await cleanup(admin, [home.agency.id, foreign.agency.id], suffix);
      await admin.$disconnect();
    }
  },
  60_000,
);

it.skipIf(!enabled)(
  'limits a Supervisor to reading authorities that cover only their direct reports',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-overtime-read-supervisor`;
    const home = await createAgency(admin, suffix, 'READS');
    try {
      const { create, read } = services();
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
      const supervisor = context(home.agency.id, home.user.id, home.membership.id, [
        ...grants('DIRECT_REPORTS'),
        ...READ('DIRECT_REPORTS'),
      ]);
      const hr = context(home.agency.id, home.user.id, home.membership.id, grants('AGENCY'));
      const draft = (authorityNo: string, employeeIds: string[]) => ({
        authorityNo,
        requestingUnitId: home.division.id,
        purpose: 'Disaster response logistics.',
        workDateFrom: '2030-07-01',
        workDateTo: '2030-07-02',
        compensationMethod: 'COC' as const,
        employees: employeeIds.map((employeeId) => ({ employeeId, authorizedHours: '6' })),
      });

      const own = await create.execute(supervisor, draft('SUPR-1', [home.member.id]));
      const wider = await create.execute(hr, draft('SUPR-2', [home.outsider.id]));
      const mixed = await create.execute(hr, draft('SUPR-3', [home.member.id, home.outsider.id]));

      const listed = await read.list(supervisor, {});
      expect(listed.map((row) => row.id)).toEqual([own.id]);
      expect((await read.detail(supervisor, own.id)).authorityNo).toBe('SUPR-1');
      for (const authority of [wider, mixed]) {
        await expect(read.detail(supervisor, authority.id)).rejects.toMatchObject({
          statusCode: 403,
          code: 'OVERTIME_AUTHORITY_SCOPE_FORBIDDEN',
        });
      }
    } finally {
      await cleanup(admin, [home.agency.id], suffix);
      await admin.$disconnect();
    }
  },
  60_000,
);
