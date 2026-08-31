import { PrismaClient, type Prisma } from '@prisma/client';
import { expect, it } from 'vitest';

const enabled = process.env.DATABASE_E2E === 'true';

async function withContext<T>(
  client: PrismaClient,
  values: { agencyId: string; userId: string },
  work: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return client.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT
        set_config('app.agency_id', ${values.agencyId}, true),
        set_config('app.user_id', ${values.userId}, true)
    `;
    return work(transaction);
  });
}

async function createAdminClient(): Promise<PrismaClient> {
  const databaseUrl =
    process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
  if (!databaseUrl)
    throw new Error('An administrative database URL is required for the integration test.');
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

it.skipIf(!enabled)(
  'hides foreign units and rejects cross-Agency inserts and parent links',
  async () => {
    const runtimeUrl = process.env.DATABASE_URL;
    if (!runtimeUrl) throw new Error('DATABASE_URL is required for the integration test.');
    const app = new PrismaClient({ datasources: { db: { url: runtimeUrl } } });
    const admin = await createAdminClient();
    const auditorReadPermission = await admin.$queryRaw<Array<{ id: string }>>`
      SELECT rp."permission_id" AS id
      FROM "role_permissions" rp
      JOIN "roles" r ON r."id" = rp."role_id"
      JOIN "permissions" p ON p."id" = rp."permission_id"
      WHERE r."code" = 'internal_auditor'
        AND r."agency_id" IS NULL
        AND p."code" = 'organization.units.read'
        AND rp."scope_policy" = 'AGENCY'
    `;
    expect(auditorReadPermission).toHaveLength(1);
    const suffix = `${Date.now()}`;
    const agencies = await Promise.all(
      ['A', 'B'].map((label) =>
        admin.agency.create({
          data: {
            code: `ORG-RLS-${label}-${suffix}`,
            name: `Organization RLS ${label}`,
            agencyType: 'NGA',
            status: 'ACTIVE',
          },
        }),
      ),
    );
    const user = await admin.user.create({
      data: {
        identityProvider: 'organization-rls-e2e',
        externalSubject: `organization-rls-${suffix}`,
        emailNormalized: `organization-rls-${suffix}@example.test`,
        displayName: 'Organization RLS User',
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
    if (!agencyA || !agencyB || !membershipA) throw new Error('RLS fixtures were not created.');

    const foreignUnit = await admin.organizationUnit.create({
      data: {
        agencyId: agencyB.id,
        code: 'SHARED-CODE',
        unitType: 'OFFICE',
        status: 'DRAFT',
      },
    });

    try {
      await expect(
        withContext(app, { agencyId: agencyA.id, userId: user.id }, (transaction) =>
          transaction.organizationUnit.findMany({ where: { id: foreignUnit.id } }),
        ),
      ).resolves.toHaveLength(0);
      await expect(
        withContext(app, { agencyId: agencyA.id, userId: user.id }, (transaction) =>
          transaction.organizationUnit.create({
            data: {
              agencyId: agencyB.id,
              code: 'CROSS-AGENCY',
              unitType: 'OFFICE',
              status: 'DRAFT',
            },
          }),
        ),
      ).rejects.toThrow(/row-level security/i);

      const ownUnit = await withContext(
        app,
        { agencyId: agencyA.id, userId: user.id },
        (transaction) =>
          transaction.organizationUnit.create({
            data: {
              agencyId: agencyA.id,
              code: 'SHARED-CODE',
              unitType: 'OFFICE',
              status: 'DRAFT',
            },
          }),
      );
      await expect(
        withContext(app, { agencyId: agencyA.id, userId: user.id }, (transaction) =>
          transaction.organizationUnitVersion.create({
            data: {
              agencyId: agencyA.id,
              organizationUnitId: ownUnit.id,
              versionNo: 1,
              name: 'Own Unit',
              parentUnitId: foreignUnit.id,
              effectiveFrom: new Date('2026-08-15'),
              status: 'DRAFT',
            },
          }),
        ),
      ).rejects.toThrow(/foreign key|row-level security/i);

      const ownVersion = await withContext(
        app,
        { agencyId: agencyA.id, userId: user.id },
        (transaction) =>
          transaction.organizationUnitVersion.create({
            data: {
              agencyId: agencyA.id,
              organizationUnitId: ownUnit.id,
              versionNo: 1,
              name: 'Own Unit',
              effectiveFrom: new Date('2026-08-15'),
              status: 'DRAFT',
              domainStatus: 'ACTIVE',
            },
          }),
      );
      await expect(
        withContext(app, { agencyId: agencyA.id, userId: user.id }, (transaction) =>
          transaction.organizationUnitVersion.create({
            data: {
              agencyId: agencyA.id,
              organizationUnitId: ownUnit.id,
              versionNo: 2,
              name: 'Second Draft',
              effectiveFrom: new Date('2026-09-01'),
              status: 'DRAFT',
              domainStatus: 'ACTIVE',
            },
          }),
        ),
      ).rejects.toThrow(/unique/i);

      const selfParentUnit = await withContext(
        app,
        { agencyId: agencyA.id, userId: user.id },
        (transaction) =>
          transaction.organizationUnit.create({
            data: {
              agencyId: agencyA.id,
              code: 'SELF-PARENT',
              unitType: 'OFFICE',
              status: 'DRAFT',
            },
          }),
      );
      await expect(
        withContext(app, { agencyId: agencyA.id, userId: user.id }, (transaction) =>
          transaction.organizationUnitVersion.create({
            data: {
              agencyId: agencyA.id,
              organizationUnitId: selfParentUnit.id,
              versionNo: 1,
              name: 'Self Parent',
              parentUnitId: selfParentUnit.id,
              effectiveFrom: new Date('2026-08-15'),
              status: 'DRAFT',
              domainStatus: 'ACTIVE',
            },
          }),
        ),
      ).rejects.toThrow(/check constraint/i);

      await withContext(app, { agencyId: agencyA.id, userId: user.id }, (transaction) =>
        transaction.organizationUnitVersion.update({
          where: { id: ownVersion.id },
          data: { status: 'ACTIVE' },
        }),
      );
      await expect(
        withContext(app, { agencyId: agencyA.id, userId: user.id }, (transaction) =>
          transaction.agencyMembership.update({
            where: { id: membershipA.id },
            data: { primaryOrganizationUnitId: ownUnit.id },
          }),
        ),
      ).resolves.toMatchObject({ primaryOrganizationUnitId: ownUnit.id });
      await expect(
        withContext(app, { agencyId: agencyA.id, userId: user.id }, (transaction) =>
          transaction.agencyMembership.update({
            where: { id: membershipA.id },
            data: { primaryOrganizationUnitId: foreignUnit.id },
          }),
        ),
      ).rejects.toThrow(/foreign key|row-level security|active Organization Unit/i);
      await expect(
        withContext(app, { agencyId: agencyA.id, userId: user.id }, (transaction) =>
          transaction.organizationUnitVersion.update({
            where: { id: ownVersion.id },
            data: { name: 'Silently Rewritten Unit' },
          }),
        ),
      ).rejects.toThrow(/immutable/i);
      await expect(
        withContext(app, { agencyId: agencyA.id, userId: user.id }, (transaction) =>
          transaction.organizationUnitVersion.update({
            where: { id: ownVersion.id },
            data: { status: 'VOIDED' },
          }),
        ),
      ).rejects.toThrow(/correction transaction/i);
      await expect(
        withContext(app, { agencyId: agencyA.id, userId: user.id }, (transaction) =>
          transaction.organizationUnitVersion.create({
            data: {
              agencyId: agencyA.id,
              organizationUnitId: ownUnit.id,
              versionNo: 2,
              name: 'Overlapping Unit',
              effectiveFrom: new Date('2026-08-20'),
              status: 'ACTIVE',
              domainStatus: 'ACTIVE',
            },
          }),
        ),
      ).rejects.toThrow(/exclusion|overlap/i);
    } finally {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.organizationUnitVersion.deleteMany({
          where: { agencyId: { in: agencies.map(({ id }) => id) } },
        });
        await transaction.organizationUnit.deleteMany({
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
