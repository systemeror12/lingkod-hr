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

async function createAdminClient(): Promise<PrismaClient> {
  const databaseUrl =
    process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
  if (!databaseUrl) throw new Error('A database owner URL is required for the integration test.');
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

it.skipIf(!enabled)(
  'isolates Staffing Authorities and guards runtime lifecycle transitions',
  async () => {
    const runtimeUrl = process.env.DATABASE_URL;
    if (!runtimeUrl) throw new Error('DATABASE_URL is required for the integration test.');
    const app = new PrismaClient({ datasources: { db: { url: runtimeUrl } } });
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-staffing-authority`;
    const agencies = await Promise.all(
      ['A', 'B'].map((label) =>
        admin.agency.create({
          data: {
            code: `SA-RLS-${label}-${suffix}`,
            name: `Staffing Authority RLS ${label}`,
            agencyType: 'NGA',
            status: 'ACTIVE',
          },
        }),
      ),
    );
    const user = await admin.user.create({
      data: {
        identityProvider: 'staffing-authority-rls-e2e',
        externalSubject: `staffing-authority-${suffix}`,
        emailNormalized: `staffing-authority-${suffix}@example.test`,
        displayName: 'Staffing Authority RLS User',
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
      throw new Error('Staffing Authority RLS fixtures were not created.');
    }

    const authorityB = await admin.staffingAuthority.create({
      data: {
        agencyId: agencyB.id,
        authorityType: 'LAW',
        referenceNo: `SHARED-${suffix}`,
        issuedDate: new Date('2026-08-01'),
        effectiveDate: new Date('2026-08-15'),
        status: 'DRAFT',
        createdByMembershipId: membershipB.id,
        updatedByMembershipId: membershipB.id,
      },
    });

    try {
      await expect(
        withContext(
          app,
          { agencyId: agencyA.id, userId: user.id, membershipId: membershipA.id },
          (transaction) => transaction.staffingAuthority.findMany({ where: { id: authorityB.id } }),
        ),
      ).resolves.toHaveLength(0);

      const authorityA = await withContext(
        app,
        { agencyId: agencyA.id, userId: user.id, membershipId: membershipA.id },
        (transaction) =>
          transaction.staffingAuthority.create({
            data: {
              agencyId: agencyA.id,
              authorityType: 'LAW',
              referenceNo: `SHARED-${suffix}`,
              issuedDate: new Date('2026-08-01'),
              effectiveDate: new Date('2026-08-15'),
              status: 'DRAFT',
              createdByMembershipId: membershipA.id,
              updatedByMembershipId: membershipA.id,
            },
          }),
      );
      expect(authorityA.referenceNo).toBe(authorityB.referenceNo);

      await expect(
        withContext(
          app,
          { agencyId: agencyA.id, userId: user.id, membershipId: membershipA.id },
          (transaction) =>
            transaction.staffingAuthority.create({
              data: {
                agencyId: agencyB.id,
                authorityType: 'LAW',
                referenceNo: `FOREIGN-${suffix}`,
                issuedDate: new Date('2026-08-01'),
                effectiveDate: new Date('2026-08-15'),
                status: 'DRAFT',
                createdByMembershipId: membershipA.id,
                updatedByMembershipId: membershipA.id,
              },
            }),
        ),
      ).rejects.toThrow(/row-level security/i);

      await expect(
        withContext(
          app,
          { agencyId: agencyA.id, userId: user.id, membershipId: membershipA.id },
          (transaction) =>
            transaction.staffingAuthority.update({
              where: { agencyId_id: { agencyId: agencyA.id, id: authorityA.id } },
              data: { status: 'ACTIVE', updatedByMembershipId: membershipA.id },
            }),
        ),
      ).rejects.toThrow(/created as Draft|application service|evidence/i);
    } finally {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.staffingAuthority.deleteMany({
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
  },
);
