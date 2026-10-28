import { withDatabaseContext } from '@lingkod-hr/database';
import { expect, it } from 'vitest';
import { createAdminClient } from '../attendance-test-fixtures';
import type { OvertimeAuthorityDraftInput } from './overtime-authorities.types';
import {
  cleanup,
  context,
  createAgency,
  enabled,
  errorOf,
  grants,
  services,
} from './overtime-authority-test-fixtures';

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
