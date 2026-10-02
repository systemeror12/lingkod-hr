import { PrismaClient, type Prisma } from '@prisma/client';
import { expect, it } from 'vitest';

const enabled = process.env.DATABASE_E2E === 'true';

async function withContext<T>(
  client: PrismaClient,
  values: { agencyId: string; userId: string; membershipId: string },
  work: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return client.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT
        set_config('app.agency_id', ${values.agencyId}, true),
        set_config('app.user_id', ${values.userId}, true),
        set_config('app.membership_id', ${values.membershipId}, true)
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
  'isolates Plantilla Positions and reserves Item Numbers per Agency',
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
            code: `POSITION-RLS-${label}-${suffix}`,
            name: `Position RLS ${label}`,
            agencyType: 'NGA',
            status: 'ACTIVE',
          },
        }),
      ),
    );
    const user = await admin.user.create({
      data: {
        emailNormalized: `plantilla-position-${suffix}@example.test`,
        displayName: 'Plantilla Position RLS User',
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
    if (!agencyA || !agencyB || !membershipA || !membershipB)
      throw new Error('Position fixtures were not created.');

    const foreign = await admin.plantillaPosition.create({
      data: {
        agencyId: agencyB.id,
        itemNumber: `SHARED-${suffix}`,
        status: 'PROPOSED',
        createdByMembershipId: membershipB.id,
        updatedByMembershipId: membershipB.id,
      },
    });
    const foreignDocument = await admin.document.create({
      data: {
        agencyId: agencyB.id,
        documentNo: `POSITION-RLS-DOCUMENT-${suffix}`,
        documentType: 'POSITION_DESCRIPTION',
        classification: 'CONFIDENTIAL',
        status: 'APPROVED',
        createdByMembershipId: membershipB.id,
      },
    });

    try {
      await expect(
        withContext(
          app,
          { agencyId: agencyA.id, userId: user.id, membershipId: membershipA.id },
          (transaction) => transaction.plantillaPosition.findMany({ where: { id: foreign.id } }),
        ),
      ).resolves.toHaveLength(0);

      const own = await withContext(
        app,
        { agencyId: agencyA.id, userId: user.id, membershipId: membershipA.id },
        (transaction) =>
          transaction.plantillaPosition.create({
            data: {
              agencyId: agencyA.id,
              itemNumber: `SHARED-${suffix}`,
              status: 'PROPOSED',
              createdByMembershipId: membershipA.id,
              updatedByMembershipId: membershipA.id,
            },
          }),
      );
      expect(own.itemNumber).toBe(`SHARED-${suffix}`);

      await expect(
        withContext(
          app,
          { agencyId: agencyA.id, userId: user.id, membershipId: membershipA.id },
          (transaction) =>
            transaction.plantillaPosition.create({
              data: {
                agencyId: agencyA.id,
                itemNumber: `SHARED-${suffix}`,
                status: 'PROPOSED',
                createdByMembershipId: membershipA.id,
                updatedByMembershipId: membershipA.id,
              },
            }),
        ),
      ).rejects.toThrow(/unique/i);

      await expect(
        withContext(
          app,
          { agencyId: agencyA.id, userId: user.id, membershipId: membershipA.id },
          (transaction) =>
            transaction.plantillaPosition.update({
              where: { agencyId_id: { agencyId: agencyA.id, id: own.id } },
              data: { status: 'ABOLISHED' },
            }),
        ),
      ).rejects.toThrow(/application service|projection/i);

      await expect(
        withContext(
          app,
          { agencyId: agencyA.id, userId: user.id, membershipId: membershipA.id },
          (transaction) =>
            transaction.positionDocument.findMany({ where: { documentId: foreignDocument.id } }),
        ),
      ).resolves.toHaveLength(0);
      await expect(
        withContext(
          app,
          { agencyId: agencyA.id, userId: user.id, membershipId: membershipA.id },
          (transaction) =>
            transaction.positionDocument.create({
              data: {
                agencyId: agencyB.id,
                positionId: foreign.id,
                documentId: foreignDocument.id,
                documentType: 'POSITION_DESCRIPTION',
              },
            }),
        ),
      ).rejects.toThrow();
    } finally {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.positionDocument.deleteMany({
          where: { agencyId: { in: agencies.map(({ id }) => id) } },
        });
        await transaction.plantillaPosition.deleteMany({
          where: { agencyId: { in: agencies.map(({ id }) => id) } },
        });
        await transaction.document.deleteMany({
          where: { agencyId: { in: agencies.map(({ id }) => id) } },
        });
      });
      await admin.agencyMembership.deleteMany({
        where: { id: { in: memberships.map(({ id }) => id) } },
      });
      await admin.agency.deleteMany({ where: { id: { in: agencies.map(({ id }) => id) } } });
      await admin.user.delete({ where: { id: user.id } });
      await app.$disconnect();
      await admin.$disconnect();
    }
  },
);
