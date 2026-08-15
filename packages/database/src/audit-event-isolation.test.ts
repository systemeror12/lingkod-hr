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

it.skipIf(!enabled)('hides foreign Audit Events and keeps the store append-only', async () => {
  const runtimeUrl = process.env.DATABASE_URL;
  const adminUrl = process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
  if (!runtimeUrl || !adminUrl)
    throw new Error('Runtime and administrative database URLs are required.');

  const app = new PrismaClient({ datasources: { db: { url: runtimeUrl } } });
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const suffix = `${Date.now()}`;
  const agencies = await Promise.all(
    ['A', 'B'].map((label) =>
      admin.agency.create({
        data: {
          code: `AUDIT-RLS-${label}-${suffix}`,
          name: `Audit RLS ${label}`,
          agencyType: 'NGA',
          status: 'ACTIVE',
        },
      }),
    ),
  );
  const user = await admin.user.create({
    data: {
      identityProvider: 'audit-rls-e2e',
      externalSubject: `audit-rls-${suffix}`,
      emailNormalized: `audit-rls-${suffix}@example.test`,
      displayName: 'Audit RLS User',
      globalStatus: 'ACTIVE',
    },
  });
  const memberships = await Promise.all(
    agencies.map(({ id }) =>
      admin.agencyMembership.create({ data: { agencyId: id, userId: user.id, status: 'ACTIVE' } }),
    ),
  );
  const agencyA = agencies[0];
  const agencyB = agencies[1];
  const membershipA = memberships[0];
  if (!agencyA || !agencyB || !membershipA) throw new Error('Audit RLS fixtures were not created.');

  const ownEvent = await admin.auditEvent.create({
    data: {
      agencyId: agencyA.id,
      actorUserId: user.id,
      actorMembershipId: membershipA.id,
      actorType: 'USER',
      action: 'ORGANIZATION_UNIT_CREATED',
      entityType: 'OrganizationUnit',
      entityId: '00000000-0000-4000-8000-000000000001',
      previousStatus: 'None',
      newStatus: 'DRAFT',
      metadata: { officialName: 'Own Unit' },
    },
  });
  const foreignEvent = await admin.auditEvent.create({
    data: {
      agencyId: agencyB.id,
      actorType: 'SYSTEM',
      action: 'ORGANIZATION_UNIT_CREATED',
      entityType: 'OrganizationUnit',
      entityId: '00000000-0000-4000-8000-000000000002',
      previousStatus: 'None',
      newStatus: 'DRAFT',
      metadata: { officialName: 'Foreign Unit' },
    },
  });

  try {
    await expect(
      withContext(
        app,
        { agencyId: agencyA.id, userId: user.id, membershipId: membershipA.id },
        (t) => t.auditEvent.findMany({ where: { id: foreignEvent.id } }),
      ),
    ).resolves.toHaveLength(0);
    await expect(
      withContext(
        app,
        { agencyId: agencyA.id, userId: user.id, membershipId: membershipA.id },
        (t) => t.auditEvent.findMany({ where: { id: ownEvent.id } }),
      ),
    ).resolves.toHaveLength(1);
    await expect(
      withContext(
        app,
        { agencyId: agencyA.id, userId: user.id, membershipId: membershipA.id },
        (t) =>
          t.auditEvent.create({
            data: {
              agencyId: agencyB.id,
              actorType: 'SYSTEM',
              action: 'ORGANIZATION_UNIT_CREATED',
              entityType: 'OrganizationUnit',
              entityId: '00000000-0000-4000-8000-000000000003',
              metadata: {},
            },
          }),
      ),
    ).rejects.toThrow(/row-level security/i);
    await expect(
      withContext(
        app,
        { agencyId: agencyA.id, userId: user.id, membershipId: membershipA.id },
        (t) => t.auditEvent.update({ where: { id: ownEvent.id }, data: { action: 'MUTATED' } }),
      ),
    ).rejects.toThrow(/permission denied|append-only/i);
    await expect(
      withContext(
        app,
        { agencyId: agencyA.id, userId: user.id, membershipId: membershipA.id },
        (t) => t.auditEvent.delete({ where: { id: ownEvent.id } }),
      ),
    ).rejects.toThrow(/permission denied|append-only/i);
  } finally {
    await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await transaction.auditEvent.deleteMany({
        where: { agencyId: { in: agencies.map(({ id }) => id) } },
      });
    });
    await admin.agencyMembership.deleteMany({
      where: { agencyId: { in: agencies.map(({ id }) => id) } },
    });
    await admin.user.delete({ where: { id: user.id } });
    await admin.agency.deleteMany({ where: { id: { in: agencies.map(({ id }) => id) } } });
    await app.$disconnect();
    await admin.$disconnect();
  }
});
