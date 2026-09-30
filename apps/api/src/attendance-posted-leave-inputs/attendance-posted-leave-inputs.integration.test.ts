import { PrismaClient } from '@prisma/client';
import { withDatabaseContext } from '@lingkod-hr/database';
import { expect, it } from 'vitest';
import { AttendancePostedLeaveInputsService } from './attendance-posted-leave-inputs.service';
import type { CreatePostedLeaveInput } from './attendance-posted-leave-inputs.types';

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
      code: `PLI-${label}-${suffix}`,
      name: `Posted Leave Input ${label} Agency`,
      agencyType: 'NGA',
      status: 'ACTIVE',
    },
  });
  const user = await admin.user.create({
    data: {
      identityProvider: 'posted-leave-input-integration',
      externalSubject: `posted-leave-input-${label}-${suffix}`,
      emailNormalized: `posted-leave-input-${label}-${suffix}@example.test`,
      displayName: `Posted Leave Input ${label} User`,
      globalStatus: 'ACTIVE',
    },
  });
  const membership = await admin.agencyMembership.create({
    data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
  });
  const employees = [];
  for (const number of [1, 2]) {
    employees.push(
      await admin.employee.create({
        data: {
          agencyId: agency.id,
          employeeNumber: `EMP-${label}-${number}-${suffix}`,
          legalName: `Employee ${label} ${number}`,
          birthDate: new Date('1990-01-01'),
          sex: 'FEMALE',
          civilStatus: 'SINGLE',
          contactEmail: `employee-${label}-${number}-${suffix}@example.test`,
          serviceStatus: 'ACTIVE',
          createdByMembershipId: membership.id,
          updatedByMembershipId: membership.id,
        },
      }),
    );
  }
  return { agency, user, membership, employees };
}

async function cleanup(admin: PrismaClient, tenants: Awaited<ReturnType<typeof createTenant>>[]) {
  await admin.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    for (const { agency, user } of tenants) {
      await transaction.attendancePostedLeaveInput.deleteMany({ where: { agencyId: agency.id } });
      await transaction.employee.deleteMany({ where: { agencyId: agency.id } });
      await transaction.agencyMembership.deleteMany({ where: { agencyId: agency.id } });
      await transaction.agency.delete({ where: { id: agency.id } });
      await transaction.user.delete({ where: { id: user.id } });
    }
  });
}

it.skipIf(!enabled)(
  'creates posted-leave inputs idempotently, supersedes them, and isolates Agencies',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}`;
    const service = new AttendancePostedLeaveInputsService();
    const home = await createTenant(admin, suffix, 'A');
    const foreign = await createTenant(admin, suffix, 'B');
    const [employee, otherEmployee] = home.employees as [
      (typeof home.employees)[number],
      (typeof home.employees)[number],
    ];
    const homeScope = { agencyId: home.agency.id, membershipId: home.membership.id };
    const foreignScope = { agencyId: foreign.agency.id, membershipId: foreign.membership.id };
    const base: CreatePostedLeaveInput = {
      sourceKey: `${suffix}-line-1`,
      employeeId: employee.id,
      sourceType: 'LeaveApprovalAllocationLine',
      sourceId: employee.id,
      dateFrom: '2026-03-02',
      dateTo: '2026-03-04',
      unitCode: 'WORKING_DAY',
      quantity: 3,
      allocationKind: 'LEAVE_WITHOUT_PAY',
    };
    const inHome = <T>(
      run: (transaction: Parameters<Parameters<typeof withDatabaseContext>[1]>[0]) => Promise<T>,
    ) => withDatabaseContext(homeScope, run);
    const coverage = (workDate: string) =>
      inHome((transaction) =>
        service.coverageInTransaction(transaction, home.agency.id, employee.id, workDate),
      );

    try {
      // Idempotent by stable source key; the same key with other facts conflicts.
      const first = await inHome((transaction) =>
        service.createInTransaction(transaction, home.agency.id, base),
      );
      const replay = await inHome((transaction) =>
        service.createInTransaction(transaction, home.agency.id, base),
      );
      expect(replay.id).toBe(first.id);
      await expect(
        inHome((transaction) =>
          service.createInTransaction(transaction, home.agency.id, { ...base, quantity: 2 }),
        ),
      ).rejects.toMatchObject({ code: 'POSTED_LEAVE_INPUT_SOURCE_KEY_CONFLICT' });
      expect(
        await admin.attendancePostedLeaveInput.count({ where: { agencyId: home.agency.id } }),
      ).toBe(1);

      // Concurrent retries with one key converge on one input.
      const [raceA, raceB] = await Promise.all(
        [1, 2].map(() =>
          inHome((transaction) =>
            service.createInTransaction(transaction, home.agency.id, {
              ...base,
              sourceKey: `${suffix}-race`,
              employeeId: otherEmployee.id,
            }),
          ),
        ),
      );
      expect(raceA?.id).toBeDefined();
      expect(raceA?.id).toBe(raceB?.id);

      // Every allocation kind is carried and covers only its own dates.
      expect(await coverage('2026-03-03')).toMatchObject([
        { inputId: first.id, allocationKind: 'LEAVE_WITHOUT_PAY', ambiguousReason: null },
      ]);
      expect(await coverage('2026-03-05')).toEqual([]);

      // A successor supersedes without editing; only it is current.
      const successor = await inHome((transaction) =>
        service.createInTransaction(transaction, home.agency.id, {
          ...base,
          sourceKey: `${suffix}-line-1-successor`,
          dateTo: '2026-03-03',
          quantity: 2,
          allocationKind: 'NON_CREDIT',
          predecessorInputId: first.id,
        }),
      );
      expect(successor.id).not.toBe(first.id);
      expect(await coverage('2026-03-03')).toMatchObject([
        { inputId: successor.id, allocationKind: 'NON_CREDIT' },
      ]);
      expect(await coverage('2026-03-04')).toEqual([]);
      const untouched = await admin.attendancePostedLeaveInput.findUniqueOrThrow({
        where: { id: first.id },
      });
      expect(untouched.allocationKind).toBe('LEAVE_WITHOUT_PAY');
      await expect(
        inHome((transaction) =>
          service.createInTransaction(transaction, home.agency.id, {
            ...base,
            sourceKey: `${suffix}-line-1-second-successor`,
            predecessorInputId: first.id,
          }),
        ),
      ).rejects.toMatchObject({ code: 'POSTED_LEAVE_INPUT_ALREADY_SUPERSEDED' });

      // A successor must supersede the same Employee's input.
      await expect(
        inHome((transaction) =>
          service.createInTransaction(transaction, home.agency.id, {
            ...base,
            sourceKey: `${suffix}-other-employee`,
            employeeId: otherEmployee.id,
            predecessorInputId: successor.id,
          }),
        ),
      ).rejects.toMatchObject({ code: 'POSTED_LEAVE_INPUT_PREDECESSOR_NOT_FOUND' });
      await expect(
        admin.$executeRaw`INSERT INTO attendance_posted_leave_inputs
          (agency_id, employee_id, source_key, source_type, source_id, date_from, date_to,
           unit_code, quantity, allocation_kind, predecessor_input_id)
          VALUES (${home.agency.id}::uuid, ${otherEmployee.id}::uuid, ${`${suffix}-fk`}, 'X',
           ${otherEmployee.id}::uuid, '2026-03-02', '2026-03-02', 'WORKING_DAY', 1,
           'NON_CREDIT', ${successor.id}::uuid)`,
      ).rejects.toThrow();

      // Cross-Agency: another Agency cannot read, reference, or create into this one.
      expect(
        await withDatabaseContext(foreignScope, (transaction) =>
          transaction.attendancePostedLeaveInput.count(),
        ),
      ).toBe(0);
      await expect(
        withDatabaseContext(foreignScope, (transaction) =>
          service.createInTransaction(transaction, foreign.agency.id, {
            ...base,
            sourceKey: `${suffix}-foreign-employee`,
          }),
        ),
      ).rejects.toMatchObject({ code: 'POSTED_LEAVE_INPUT_EMPLOYEE_NOT_FOUND' });
      await expect(
        withDatabaseContext(foreignScope, (transaction) =>
          service.createInTransaction(transaction, foreign.agency.id, {
            ...base,
            sourceKey: `${suffix}-foreign-predecessor`,
            employeeId: foreign.employees[0]!.id,
            predecessorInputId: successor.id,
          }),
        ),
      ).rejects.toMatchObject({ code: 'POSTED_LEAVE_INPUT_PREDECESSOR_NOT_FOUND' });
      await expect(
        withDatabaseContext(foreignScope, (transaction) =>
          service.createInTransaction(transaction, home.agency.id, {
            ...base,
            sourceKey: `${suffix}-forged-agency`,
          }),
        ),
      ).rejects.toThrow();

      // Immutable and retained, even for the table owner.
      await expect(
        admin.$executeRaw`UPDATE attendance_posted_leave_inputs SET quantity = 9 WHERE id = ${first.id}::uuid`,
      ).rejects.toThrow(/immutable/);
      await expect(
        admin.$executeRaw`DELETE FROM attendance_posted_leave_inputs WHERE id = ${first.id}::uuid`,
      ).rejects.toThrow(/cannot be deleted/);
      const rls = await admin.$queryRaw<{ forced: boolean }[]>`
        SELECT relforcerowsecurity AS forced FROM pg_class
        WHERE relname = 'attendance_posted_leave_inputs'`;
      expect(rls[0]?.forced).toBe(true);
    } finally {
      await cleanup(admin, [home, foreign]);
      await admin.$disconnect();
    }
  },
);
