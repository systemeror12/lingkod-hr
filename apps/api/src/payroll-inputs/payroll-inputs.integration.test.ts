import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { expect, it } from 'vitest';
import type { PayrollInputSubmission } from './payroll-inputs.schemas';
import { PayrollInputsService } from './payroll-inputs.service';

const enabled = process.env.DATABASE_E2E === 'true';

async function createAdminClient(): Promise<PrismaClient> {
  const databaseUrl =
    process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
  if (!databaseUrl) throw new Error('A database owner URL is required for the integration test.');
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

async function createTenant(admin: PrismaClient, suffix: string, label: string) {
  const agency = await admin.agency.create({
    data: {
      code: `PIN-${label}-${suffix}`,
      name: `Payroll Input ${label} Agency`,
      agencyType: 'NGA',
      status: 'ACTIVE',
    },
  });
  const user = await admin.user.create({
    data: {
      emailNormalized: `payroll-input-${label}-${suffix}@example.test`,
      displayName: `Payroll Input ${label} User`,
      globalStatus: 'ACTIVE',
    },
  });
  const membership = await admin.agencyMembership.create({
    data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
  });
  const employee = await admin.employee.create({
    data: {
      agencyId: agency.id,
      employeeNumber: `EMP-${label}-${suffix}`,
      legalName: `Employee ${label}`,
      birthDate: new Date('1990-01-01'),
      sex: 'FEMALE',
      civilStatus: 'SINGLE',
      contactEmail: `payroll-input-employee-${label}-${suffix}@example.test`,
      serviceStatus: 'ACTIVE',
      createdByMembershipId: membership.id,
      updatedByMembershipId: membership.id,
    },
  });
  const scope = { agencyId: agency.id, userId: user.id, membershipId: membership.id };
  return { agency, user, membership, employee, scope };
}

type Tenant = Awaited<ReturnType<typeof createTenant>>;

async function cleanup(admin: PrismaClient, tenants: Tenant[]) {
  await admin.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    for (const { agency, user } of tenants) {
      await transaction.payrollInput.deleteMany({ where: { agencyId: agency.id } });
      await transaction.employee.deleteMany({ where: { agencyId: agency.id } });
      await transaction.agencyMembership.deleteMany({ where: { agencyId: agency.id } });
      await transaction.agency.delete({ where: { id: agency.id } });
      await transaction.user.delete({ where: { id: user.id } });
    }
  });
}

function readerContext(tenant: Tenant, scopePolicy: 'AGENCY' | 'OWN'): RequestContext {
  return {
    requestId: 'payroll-inputs-integration',
    userId: tenant.user.id,
    agencyId: tenant.agency.id,
    membershipId: tenant.membership.id,
    primaryOrganizationUnitId: null,
    permissions: [{ code: 'payroll.inputs.read', scopePolicy }],
  };
}

it.skipIf(!enabled)(
  'accepts Payroll Inputs idempotently inside the caller transaction and isolates Agencies',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}`;
    const service = new PayrollInputsService();
    // Source references the test does not persist; fixed so retries match.
    const lineId = randomUUID();
    const overtimeRecordId = randomUUID();
    const home = await createTenant(admin, suffix, 'A');
    const foreign = await createTenant(admin, suffix, 'B');
    const submission = (
      overrides: Partial<PayrollInputSubmission> = {},
    ): PayrollInputSubmission => ({
      agencyId: home.agency.id,
      employeeId: home.employee.id,
      sourceModule: 'LEAVE',
      inputKind: 'LEAVE_WITHOUT_PAY',
      sourceKey: `${suffix}-lwop-1`,
      sourceType: 'LeaveApprovalAllocationLine',
      sourceId: lineId,
      effectiveDate: '2026-03-02',
      quantity: '2',
      payload: {
        workDates: [
          { date: '2026-03-02', days: '1' },
          { date: '2026-03-03', days: '1' },
        ],
      },
      ...overrides,
    });
    const accept = (tenant: Tenant, request: PayrollInputSubmission) =>
      withDatabaseContext(tenant.scope, (transaction) =>
        service.acceptInTransaction(transaction, request),
      );
    const homeCount = () => admin.payrollInput.count({ where: { agencyId: home.agency.id } });

    try {
      // A first submission is accepted PENDING with no period; a matching retry
      // returns it, and the same key with another payload is rejected.
      const first = await accept(home, submission());
      expect(first).toMatchObject({ outcome: 'ACCEPTED' });
      if (first.outcome !== 'ACCEPTED') throw new Error('expected an accepted input');
      const stored = await admin.payrollInput.findUniqueOrThrow({
        where: { id: first.payrollInputId },
      });
      expect(stored).toMatchObject({
        status: 'PENDING',
        consumedByPayrollPeriodId: null,
        amount: null,
        payloadSnapshot: submission().payload,
      });
      expect(stored.quantity?.toFixed(4)).toBe('2.0000');

      await expect(accept(home, submission({ quantity: '2.0000' }))).resolves.toEqual({
        outcome: 'ALREADY_ACCEPTED',
        payrollInputId: first.payrollInputId,
      });
      await expect(
        accept(home, submission({ sourceKey: `${suffix}-LWOP-1`.toUpperCase() })),
      ).resolves.toEqual({ outcome: 'ALREADY_ACCEPTED', payrollInputId: first.payrollInputId });
      await expect(accept(home, submission({ quantity: '3' }))).resolves.toMatchObject({
        outcome: 'REJECTED',
        code: 'PAYROLL_INPUT_SOURCE_KEY_CONFLICT',
      });
      await expect(
        accept(home, submission({ payload: { workDates: [{ date: '2026-03-02', days: '2' }] } })),
      ).resolves.toMatchObject({ outcome: 'REJECTED', code: 'PAYROLL_INPUT_SOURCE_KEY_CONFLICT' });
      expect(await homeCount()).toBe(1);

      // Rejected and retryable requests create no input.
      await expect(
        accept(home, submission({ sourceKey: `${suffix}-bad`, inputKind: 'OVERTIME_HOURS' })),
      ).resolves.toMatchObject({ outcome: 'REJECTED', code: 'PAYROLL_INPUT_INVALID' });
      await expect(
        accept(home, submission({ sourceKey: `${suffix}-zero`, quantity: '0' })),
      ).resolves.toMatchObject({ outcome: 'REJECTED', code: 'PAYROLL_INPUT_INVALID' });
      await expect(
        accept(
          home,
          submission({ sourceKey: `${suffix}-money`, inputKind: 'MONETIZATION_EARNING' }),
        ),
      ).resolves.toMatchObject({
        outcome: 'RETRYABLE_FAILURE',
        code: 'PAYROLL_INPUT_VALUATION_UNAVAILABLE',
      });
      expect(await homeCount()).toBe(1);

      // The input rolls back with the caller's transaction.
      await expect(
        withDatabaseContext(home.scope, async (transaction) => {
          const result = await service.acceptInTransaction(
            transaction,
            submission({ sourceKey: `${suffix}-rollback` }),
          );
          expect(result.outcome).toBe('ACCEPTED');
          throw new Error('caller failed after posting');
        }),
      ).rejects.toThrow('caller failed after posting');
      expect(await homeCount()).toBe(1);
      await expect(
        accept(home, submission({ sourceKey: `${suffix}-rollback` })),
      ).resolves.toMatchObject({ outcome: 'ACCEPTED' });

      // Two identical submissions at once converge on one input.
      const race = submission({
        sourceModule: 'OVERTIME',
        inputKind: 'OVERTIME_HOURS',
        sourceKey: `${suffix}-race`,
        quantity: '3.5',
        payload: { overtimeServiceRecordId: overtimeRecordId },
      });
      const results = await Promise.all([accept(home, race), accept(home, race)]);
      expect(results.map((result) => result.outcome).sort()).toEqual([
        'ACCEPTED',
        'ALREADY_ACCEPTED',
      ]);
      const ids = results.map((result) =>
        'payrollInputId' in result ? result.payrollInputId : null,
      );
      expect(ids[0]).not.toBeNull();
      expect(ids[0]).toBe(ids[1]);
      expect(await homeCount()).toBe(3);

      // Another Agency cannot post for this Agency or its Employee, and cannot see its inputs.
      await expect(
        accept(foreign, submission({ sourceKey: `${suffix}-x1` })),
      ).resolves.toMatchObject({ outcome: 'REJECTED', code: 'PAYROLL_INPUT_EMPLOYEE_NOT_FOUND' });
      await expect(
        accept(foreign, submission({ agencyId: foreign.agency.id, sourceKey: `${suffix}-x2` })),
      ).resolves.toMatchObject({ outcome: 'REJECTED', code: 'PAYROLL_INPUT_EMPLOYEE_NOT_FOUND' });
      // The same source key is independent in another Agency.
      await expect(
        accept(
          foreign,
          submission({ agencyId: foreign.agency.id, employeeId: foreign.employee.id }),
        ),
      ).resolves.toMatchObject({ outcome: 'ACCEPTED' });
      await expect(
        withDatabaseContext(foreign.scope, (transaction) =>
          transaction.payrollInput.count({ where: { agencyId: home.agency.id } }),
        ),
      ).resolves.toBe(0);
      await expect(
        withDatabaseContext(foreign.scope, (transaction) =>
          transaction.payrollInput.create({
            data: {
              agencyId: home.agency.id,
              employeeId: home.employee.id,
              sourceModule: 'LEAVE',
              inputKind: 'LEAVE_WITHOUT_PAY',
              sourceKey: `${suffix}-direct`,
              sourceType: 'LeaveApprovalAllocationLine',
              sourceId: lineId,
              effectiveDate: new Date('2026-03-02'),
              status: 'PENDING',
              payloadSnapshot: {},
              payloadHash: 'direct',
            },
          }),
        ),
      ).rejects.toThrow();
      expect(await homeCount()).toBe(3);

      // The read lists the acting Agency's inputs by source and status, agency-wide only.
      const homeReader = readerContext(home, 'AGENCY');
      expect(await service.list(homeReader, {})).toHaveLength(3);
      const overtime = await service.list(homeReader, {
        sourceModule: 'OVERTIME',
        status: 'PENDING',
      });
      expect(overtime).toEqual([
        expect.objectContaining({
          id: ids[0],
          sourceModule: 'OVERTIME',
          inputKind: 'OVERTIME_HOURS',
          quantity: '3.5000',
          amount: null,
          status: 'PENDING',
        }),
      ]);
      expect(await service.list(homeReader, { status: 'CONSUMED' })).toEqual([]);
      await expect(service.list(readerContext(home, 'OWN'), {})).rejects.toMatchObject({
        code: 'PAYROLL_INPUT_READ_FORBIDDEN',
      });

      // After acceptance only status and the consuming period change.
      await expect(
        admin.payrollInput.update({ where: { id: first.payrollInputId }, data: { quantity: '9' } }),
      ).rejects.toThrow(/changes only its status and consuming period/);
      await expect(
        admin.payrollInput.update({
          where: { id: first.payrollInputId },
          data: { status: 'CONSUMED' },
        }),
      ).rejects.toThrow();
      await admin.payrollInput.update({
        where: { id: first.payrollInputId },
        data: { status: 'CANCELLED' },
      });
      await expect(
        admin.payrollInput.update({
          where: { id: first.payrollInputId },
          data: { status: 'PENDING' },
        }),
      ).rejects.toThrow(/cannot move from CANCELLED to PENDING/);
      await expect(
        admin.payrollInput.delete({ where: { id: first.payrollInputId } }),
      ).rejects.toThrow(/cannot be deleted/);
    } finally {
      await cleanup(admin, [home, foreign]);
      await admin.$disconnect();
    }
  },
  60_000,
);
