import { PrismaClient } from '@prisma/client';
import { expect, it } from 'vitest';

const enabled = process.env.DATABASE_E2E === 'true';

async function withContext<T>(
  client: PrismaClient,
  values: {
    agencyId: string;
    userId: string;
    membershipId: string;
    employeeMembershipLink?: boolean;
  },
  work: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return client.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT
        set_config('app.agency_id', ${values.agencyId}, true),
        set_config('app.user_id', ${values.userId}, true),
        set_config('app.membership_id', ${values.membershipId}, true),
        set_config(
          'app.employee_membership_link',
          ${values.employeeMembershipLink ? 'on' : ''},
          true
        )
    `;
    return work(transaction);
  });
}

function adminUrl(): string {
  const url = process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
  if (!url) throw new Error('An administrative database URL is required for the integration test.');
  return url;
}

it.skipIf(!enabled)(
  'isolates Employees and enforces Agency-scoped identity and membership linkage',
  async () => {
    const runtimeUrl = process.env.DATABASE_URL;
    if (!runtimeUrl) throw new Error('DATABASE_URL is required for the integration test.');
    const app = new PrismaClient({ datasources: { db: { url: runtimeUrl } } });
    const admin = new PrismaClient({ datasources: { db: { url: adminUrl() } } });
    const suffix = String(Date.now());
    const agencies = await Promise.all(
      ['A', 'B'].map((label) =>
        admin.agency.create({
          data: {
            code: `EMPLOYEE-RLS-${label}-${suffix}`,
            name: `Employee RLS ${label}`,
            agencyType: 'NGA',
            status: 'ACTIVE',
          },
        }),
      ),
    );
    const user = await admin.user.create({
      data: {
        identityProvider: 'employee-rls-e2e',
        externalSubject: `employee-rls-${suffix}`,
        emailNormalized: `employee-rls-${suffix}@example.test`,
        displayName: 'Employee RLS User',
        globalStatus: 'ACTIVE',
      },
    });
    const secondUser = await admin.user.create({
      data: {
        identityProvider: 'employee-rls-e2e',
        externalSubject: `employee-rls-second-${suffix}`,
        emailNormalized: `employee-rls-second-${suffix}@example.test`,
        displayName: 'Employee RLS Second User',
        globalStatus: 'ACTIVE',
      },
    });
    const agencyA = agencies[0];
    const agencyB = agencies[1];
    if (!agencyA || !agencyB) {
      throw new Error('Employee isolation fixtures were not created.');
    }
    const [firstA, secondA, firstB] = await Promise.all([
      admin.agencyMembership.create({
        data: { agencyId: agencyA.id, userId: user.id, status: 'ACTIVE' },
      }),
      admin.agencyMembership.create({
        data: { agencyId: agencyA.id, userId: secondUser.id, status: 'ACTIVE' },
      }),
      admin.agencyMembership.create({
        data: { agencyId: agencyB.id, userId: user.id, status: 'ACTIVE' },
      }),
    ]);
    if (!firstA || !secondA || !firstB) {
      throw new Error('Employee isolation fixtures were not created.');
    }

    const foreign = await admin.employee.create({
      data: {
        agencyId: agencyB.id,
        employeeNumber: `EMP-${suffix}`,
        legalName: 'Foreign Employee',
        birthDate: new Date('1990-01-01'),
        sex: 'FEMALE',
        civilStatus: 'SINGLE',
        contactEmail: 'foreign@example.test',
        createdByMembershipId: firstB.id,
        updatedByMembershipId: firstB.id,
      },
    });

    try {
      const contextA = {
        agencyId: agencyA.id,
        userId: user.id,
        membershipId: firstA.id,
      } as const;

      // A foreign Employee is absent, and its identity number can be reused
      // in the active Agency without a cross-Agency conflict.
      await expect(
        withContext(app, contextA, (transaction) =>
          transaction.employee.findMany({ where: { id: foreign.id } }),
        ),
      ).resolves.toHaveLength(0);

      const own = await withContext(app, contextA, (transaction) =>
        transaction.employee.create({
          data: {
            agencyId: agencyA.id,
            employeeNumber: `EMP-${suffix}`,
            legalName: 'Local Employee',
            birthDate: new Date('1990-01-01'),
            sex: 'FEMALE',
            civilStatus: 'SINGLE',
            contactEmail: 'local@example.test',
            createdByMembershipId: firstA.id,
            updatedByMembershipId: firstA.id,
          },
        }),
      );
      expect(own.employeeNumber).toBe(`EMP-${suffix}`);
      expect(own.serviceStatus).toBe('PREBOARDING');

      // Employee numbers and person identities stay unique within the Agency.
      await expect(
        withContext(app, contextA, (transaction) =>
          transaction.employee.create({
            data: {
              agencyId: agencyA.id,
              employeeNumber: `EMP-${suffix}`,
              legalName: 'Another Person',
              birthDate: new Date('1991-02-02'),
              sex: 'MALE',
              civilStatus: 'MARRIED',
              contactEmail: 'another@example.test',
              createdByMembershipId: firstA.id,
              updatedByMembershipId: firstA.id,
            },
          }),
        ),
      ).rejects.toThrow(/unique/i);

      await expect(
        withContext(app, contextA, (transaction) =>
          transaction.employee.create({
            data: {
              agencyId: agencyA.id,
              employeeNumber: `EMP2-${suffix}`,
              legalName: 'local employee',
              birthDate: new Date('1990-01-01'),
              sex: 'FEMALE',
              civilStatus: 'SINGLE',
              contactEmail: 'duplicate@example.test',
              createdByMembershipId: firstA.id,
              updatedByMembershipId: firstA.id,
            },
          }),
        ),
      ).rejects.toThrow(/unique/i);

      // Writes outside the active Agency context are rejected.
      await expect(
        withContext(app, contextA, (transaction) =>
          transaction.employee.create({
            data: {
              agencyId: agencyB.id,
              employeeNumber: `EMP-B-${suffix}`,
              legalName: 'Cross Agency Write',
              birthDate: new Date('1992-03-03'),
              sex: 'MALE',
              civilStatus: 'SINGLE',
              contactEmail: 'cross@example.test',
              createdByMembershipId: firstB.id,
              updatedByMembershipId: firstB.id,
            },
          }),
        ),
      ).rejects.toThrow();

      // An Employee links to at most one same-Agency Agency Membership.
      // Link writes go through the application-service guard context.
      await expect(
        withContext(app, contextA, (transaction) =>
          transaction.agencyMembership.update({
            where: { agencyId_id: { agencyId: agencyA.id, id: secondA.id } },
            data: { employeeId: own.id },
          }),
        ),
      ).rejects.toThrow(/application service/);

      await withContext(app, { ...contextA, employeeMembershipLink: true }, (transaction) =>
        transaction.agencyMembership.update({
          where: { agencyId_id: { agencyId: agencyA.id, id: firstA.id } },
          data: { employeeId: own.id },
        }),
      );
      await expect(
        withContext(app, { ...contextA, employeeMembershipLink: true }, (transaction) =>
          transaction.agencyMembership.update({
            where: { agencyId_id: { agencyId: agencyA.id, id: secondA.id } },
            data: { employeeId: own.id },
          }),
        ),
      ).rejects.toThrow(/unique/i);

      // A cross-Agency link cannot reference a foreign Employee.
      await expect(
        withContext(app, { ...contextA, employeeMembershipLink: true }, (transaction) =>
          transaction.agencyMembership.update({
            where: { agencyId_id: { agencyId: agencyA.id, id: secondA.id } },
            data: { employeeId: foreign.id },
          }),
        ),
      ).rejects.toThrow();

      // Employees are retained and cannot be deleted.
      await expect(
        withContext(app, contextA, (transaction) =>
          transaction.employee.delete({ where: { id: own.id } }),
        ),
      ).rejects.toThrow(/retained/i);
    } finally {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.agencyMembership.deleteMany({
          where: { agencyId: { in: agencies.map(({ id }) => id) } },
        });
        await transaction.employee.deleteMany({
          where: { agencyId: { in: agencies.map(({ id }) => id) } },
        });
      });
      await admin.agency.deleteMany({ where: { id: { in: agencies.map(({ id }) => id) } } });
      await admin.user.delete({ where: { id: user.id } });
      await admin.user.delete({ where: { id: secondUser.id } });
      await app.$disconnect();
      await admin.$disconnect();
    }
  },
);
