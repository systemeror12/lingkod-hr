import { PrismaClient, type Prisma } from '@prisma/client';
import { expect, it } from 'vitest';

const enabled = process.env.DATABASE_E2E === 'true';

async function withContext<T>(
  client: PrismaClient,
  values: { agencyId: string; userId: string; membershipId: string },
  work: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return client.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe(
      "SELECT set_config('app.agency_id', '" +
        values.agencyId +
        "', true), set_config('app.user_id', '" +
        values.userId +
        "', true), set_config('app.membership_id', '" +
        values.membershipId +
        "', true)",
    );
    return work(transaction);
  });
}

async function adminClient(): Promise<PrismaClient> {
  const url = process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
  if (!url) throw new Error('A database owner URL is required for the integration test.');
  return new PrismaClient({ datasources: { db: { url } } });
}

it.skipIf(!enabled)('isolates Qualification Standards and guards version state', async () => {
  const runtimeUrl = process.env.DATABASE_URL;
  if (!runtimeUrl) throw new Error('DATABASE_URL is required for the integration test.');
  const app = new PrismaClient({ datasources: { db: { url: runtimeUrl } } });
  const admin = await adminClient();
  const suffix = String(Date.now()) + '-qualification-standard';
  const agencies = await Promise.all(
    ['A', 'B'].map((label) =>
      admin.agency.create({
        data: {
          code: 'QS-RLS-' + label + '-' + suffix,
          name: 'Qualification Standard RLS ' + label,
          agencyType: 'NGA',
          status: 'ACTIVE',
        },
      }),
    ),
  );
  const user = await admin.user.create({
    data: {
      identityProvider: 'qualification-standard-rls-e2e',
      externalSubject: 'qualification-standard-' + suffix,
      emailNormalized: 'qualification-standard-' + suffix + '@example.test',
      displayName: 'Qualification Standard RLS User',
      globalStatus: 'ACTIVE',
    },
  });
  const memberships = await Promise.all(
    agencies.map(({ id }) =>
      admin.agencyMembership.create({
        data: { agencyId: id, userId: user.id, status: 'ACTIVE' },
      }),
    ),
  );
  const agencyA = agencies[0];
  const agencyB = agencies[1];
  const membershipA = memberships[0];
  const membershipB = memberships[1];
  if (!agencyA || !agencyB || !membershipA || !membershipB) {
    throw new Error('Qualification Standard fixtures were not created.');
  }

  const standardB = await admin.qualificationStandard.create({
    data: {
      agencyId: agencyB.id,
      code: 'QS-' + suffix,
      name: 'Foreign Standard',
      status: 'INACTIVE',
      createdByMembershipId: membershipB.id,
      updatedByMembershipId: membershipB.id,
    },
  });

  try {
    await expect(
      withContext(
        app,
        { agencyId: agencyA.id, userId: user.id, membershipId: membershipA.id },
        (transaction) =>
          transaction.qualificationStandard.findMany({ where: { id: standardB.id } }),
      ),
    ).resolves.toHaveLength(0);

    const standardA = await withContext(
      app,
      { agencyId: agencyA.id, userId: user.id, membershipId: membershipA.id },
      (transaction) =>
        transaction.qualificationStandard.create({
          data: {
            agencyId: agencyA.id,
            code: 'QS-' + suffix,
            name: 'Agency Standard',
            status: 'INACTIVE',
            createdByMembershipId: membershipA.id,
            updatedByMembershipId: membershipA.id,
          },
        }),
    );
    await expect(
      withContext(
        app,
        { agencyId: agencyA.id, userId: user.id, membershipId: membershipA.id },
        (transaction) =>
          transaction.qualificationStandard.create({
            data: {
              agencyId: agencyA.id,
              code: 'QS-' + suffix + '-OTHER',
              name: 'Agency Standard',
              status: 'INACTIVE',
              createdByMembershipId: membershipA.id,
              updatedByMembershipId: membershipA.id,
            },
          }),
      ),
    ).rejects.toThrow(/unique|name/i);
    const draft = await withContext(
      app,
      { agencyId: agencyA.id, userId: user.id, membershipId: membershipA.id },
      (transaction) =>
        transaction.qualificationStandardVersion.create({
          data: {
            agencyId: agencyA.id,
            qualificationStandardId: standardA.id,
            versionNo: 1,
            effectiveFrom: new Date('2026-08-15'),
            status: 'DRAFT',
            createdByMembershipId: membershipA.id,
            updatedByMembershipId: membershipA.id,
          },
        }),
    );
    expect(draft.status).toBe('DRAFT');

    await expect(
      withContext(
        app,
        { agencyId: agencyA.id, userId: user.id, membershipId: membershipA.id },
        (transaction) =>
          transaction.qualificationStandardVersion.create({
            data: {
              agencyId: agencyA.id,
              qualificationStandardId: standardA.id,
              versionNo: 2,
              effectiveFrom: new Date('2026-08-16'),
              status: 'DRAFT',
              createdByMembershipId: membershipA.id,
              updatedByMembershipId: membershipA.id,
            },
          }),
      ),
    ).rejects.toThrow(/unique|draft/i);

    await expect(
      withContext(
        app,
        { agencyId: agencyA.id, userId: user.id, membershipId: membershipA.id },
        (transaction) =>
          transaction.qualificationStandardVersion.update({
            where: { agencyId_id: { agencyId: agencyA.id, id: draft.id } },
            data: { status: 'ACTIVE' },
          }),
      ),
    ).rejects.toThrow(/application service|transition/i);
  } finally {
    await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await transaction.qualificationStandard.updateMany({
        where: { agencyId: { in: agencies.map(({ id }) => id) } },
        data: { currentVersionId: null },
      });
      await transaction.qualificationStandardVersion.deleteMany({
        where: { agencyId: { in: agencies.map(({ id }) => id) } },
      });
      await transaction.qualificationStandard.deleteMany({
        where: { agencyId: { in: agencies.map(({ id }) => id) } },
      });
    });
    await admin.agencyMembership.deleteMany({
      where: { agencyId: { in: agencies.map(({ id }) => id) } },
    });
    await admin.agency.deleteMany({ where: { id: { in: agencies.map(({ id }) => id) } } });
    await admin.user.delete({ where: { id: user.id } });
    await app.$disconnect();
    await admin.$disconnect();
  }
});
