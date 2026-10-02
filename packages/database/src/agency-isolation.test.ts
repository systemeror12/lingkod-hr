import { PrismaClient, type Prisma } from '@prisma/client';
import { expect, it } from 'vitest';

const enabled = process.env.DATABASE_E2E === 'true';

function contextValues(agencyId: string, userId: string) {
  return { agencyId, userId };
}

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

it.skipIf(!enabled)('prevents a runtime role from reading or writing another Agency', async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the integration test.');
  const app = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const admin = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_E2E_ADMIN_URL ?? databaseUrl } },
  });
  const agencyA = await admin.agency.create({
    data: { code: `E2E-A-${Date.now()}`, name: 'E2E A', agencyType: 'NGA', status: 'ACTIVE' },
  });
  const agencyB = await admin.agency.create({
    data: { code: `E2E-B-${Date.now()}`, name: 'E2E B', agencyType: 'NGA', status: 'ACTIVE' },
  });
  const user = await admin.user.create({
    data: {
      emailNormalized: `e2e-${Date.now()}@example.test`,
      displayName: 'E2E User',
      globalStatus: 'ACTIVE',
    },
  });
  const targetUser = await admin.user.create({
    data: {
      emailNormalized: `e2e-target-${Date.now()}@example.test`,
      displayName: 'E2E Target User',
      globalStatus: 'ACTIVE',
    },
  });
  const membershipA = await admin.agencyMembership.create({
    data: { agencyId: agencyA.id, userId: user.id, status: 'ACTIVE' },
  });
  const membershipB = await admin.agencyMembership.create({
    data: { agencyId: agencyB.id, userId: user.id, status: 'ACTIVE' },
  });
  const targetMembershipA = await admin.agencyMembership.create({
    data: { agencyId: agencyA.id, userId: targetUser.id, status: 'ACTIVE' },
  });
  let securityEventId: string | undefined;

  try {
    await withContext(app, contextValues(agencyA.id, user.id), (transaction) =>
      transaction.agencyProfileVersion.create({
        data: {
          agencyId: agencyA.id,
          versionNo: 1,
          officialName: agencyA.name,
          deploymentProfile: 'SHARED_SAAS',
          effectiveFrom: new Date('2026-01-01'),
          status: 'ACTIVE',
        },
      }),
    );
    const agencyBProfile = await admin.agencyProfileVersion.create({
      data: {
        agencyId: agencyB.id,
        versionNo: 1,
        officialName: agencyB.name,
        deploymentProfile: 'SHARED_SAAS',
        effectiveFrom: new Date('2026-01-01'),
        status: 'ACTIVE',
      },
    });
    await expect(
      admin.agencyProfileVersion.create({
        data: {
          agencyId: agencyA.id,
          versionNo: 2,
          officialName: agencyA.name,
          deploymentProfile: 'SHARED_SAAS',
          effectiveFrom: new Date('2026-06-01'),
          status: 'ACTIVE',
        },
      }),
    ).rejects.toThrow(/exclusion|agency_profile_versions_active_no_overlap/i);

    const visibleRows = await withContext(app, contextValues(agencyA.id, user.id), (transaction) =>
      transaction.agencyProfileVersion.findMany({ where: { id: agencyBProfile.id } }),
    );
    expect(visibleRows).toHaveLength(0);
    const securityEvent = await withContext(
      app,
      contextValues(agencyA.id, user.id),
      (transaction) =>
        transaction.securityEvent.create({
          data: { agencyId: agencyA.id, eventType: 'E2E_TEST', details: {} },
        }),
    );
    securityEventId = securityEvent.id;
    await expect(
      withContext(app, contextValues(agencyA.id, user.id), (transaction) =>
        transaction.securityEvent.update({
          where: { id: securityEvent.id },
          data: { eventType: 'MUTATED' },
        }),
      ),
    ).rejects.toThrow(/append-only/i);
    await expect(
      withContext(app, contextValues(agencyA.id, user.id), (transaction) =>
        transaction.agencyProfileVersion.create({
          data: {
            agencyId: agencyB.id,
            versionNo: 2,
            officialName: agencyB.name,
            deploymentProfile: 'SHARED_SAAS',
            effectiveFrom: new Date('2026-01-01'),
            status: 'ACTIVE',
          },
        }),
      ),
    ).rejects.toThrow(/row-level security/i);

    await withContext(app, contextValues(agencyA.id, user.id), async (transaction) => {
      expect(
        await transaction.$executeRaw`
          UPDATE "agency_memberships"
          SET "agency_id" = ${agencyA.id}::uuid, "user_id" = ${targetUser.id}::uuid
          WHERE "id" = ${membershipB.id}::uuid
        `,
      ).toBe(0);
    });
    const sessionB = await admin.userSession.create({
      data: {
        userId: user.id,
        agencyId: agencyB.id,
        agencyMembershipId: membershipB.id,
        sessionTokenHash: Buffer.from(`e2e-session-${Date.now()}`),
        expiresAt: new Date('2099-12-31'),
      },
    });
    await expect(
      withContext(
        app,
        contextValues(agencyA.id, user.id),
        (transaction) =>
          transaction.$executeRaw`
          UPDATE "user_sessions"
          SET "agency_id" = ${agencyA.id}::uuid,
              "agency_membership_id" = ${targetMembershipA.id}::uuid,
              "user_id" = ${targetUser.id}::uuid
          WHERE "id" = ${sessionB.id}::uuid
        `,
      ),
    ).rejects.toThrow(/permission denied/i);

    const globalRole = await admin.role.findFirstOrThrow({
      where: { code: 'agency_administrator', agencyId: null },
    });
    const globalGrant = await admin.rolePermission.findFirstOrThrow({
      where: { roleId: globalRole.id },
    });
    await withContext(app, contextValues(agencyA.id, user.id), async (transaction) => {
      expect(
        await transaction.$executeRaw`
          UPDATE "roles"
          SET "agency_id" = ${agencyA.id}::uuid, "is_system_template" = FALSE
          WHERE "id" = ${globalRole.id}::uuid
        `,
      ).toBe(0);
      expect(
        await transaction.$executeRaw`
          UPDATE "role_permissions"
          SET "scope_policy" = 'OWN'
          WHERE "role_id" = ${globalGrant.roleId}::uuid
            AND "permission_id" = ${globalGrant.permissionId}::uuid
            AND "scope_policy" = ${globalGrant.scopePolicy}
        `,
      ).toBe(0);
    });
    await expect(
      admin.membershipRole.create({
        data: {
          agencyId: agencyA.id,
          membershipId: membershipB.id,
          roleId: globalRole.id,
          effectiveFrom: new Date(),
          assignedByMembershipId: membershipA.id,
        },
      }),
    ).rejects.toThrow(/foreign key|agency/i);
    await expect(
      admin.delegatedAuthority.create({
        data: {
          agencyId: agencyA.id,
          delegatorMembershipId: membershipA.id,
          delegateMembershipId: membershipB.id,
          permissionCode: 'security.events.read',
          effectiveFrom: new Date('2026-01-01'),
          effectiveTo: new Date('2026-12-31'),
          status: 'ACTIVE',
        },
      }),
    ).rejects.toThrow(/foreign key|agency/i);
    await expect(
      admin.userSession.create({
        data: {
          userId: user.id,
          agencyId: agencyA.id,
          agencyMembershipId: membershipB.id,
          sessionTokenHash: Buffer.from('e2e-wrong-agency'),
          createdAt: new Date('2026-01-01'),
          lastSeenAt: new Date('2026-01-01'),
          expiresAt: new Date('2026-12-31'),
        },
      }),
    ).rejects.toThrow(/foreign key|agency/i);
  } finally {
    if (securityEventId) {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.securityEvent.delete({ where: { id: securityEventId } });
      });
    }
    await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await transaction.agencyProfileVersion.deleteMany({
        where: { agencyId: { in: [agencyA.id, agencyB.id] } },
      });
    });
    await admin.userSession.deleteMany({ where: { userId: { in: [user.id, targetUser.id] } } });
    await admin.membershipRole.deleteMany({
      where: { membershipId: { in: [membershipA.id, membershipB.id] } },
    });
    await admin.delegatedAuthority.deleteMany({
      where: { agencyId: { in: [agencyA.id, agencyB.id] } },
    });
    await admin.agencyMembership.deleteMany({
      where: { id: { in: [membershipA.id, membershipB.id, targetMembershipA.id] } },
    });
    await admin.agency.deleteMany({ where: { id: { in: [agencyA.id, agencyB.id] } } });
    await admin.user.deleteMany({ where: { id: { in: [user.id, targetUser.id] } } });
    await app.$disconnect();
    await admin.$disconnect();
  }
});
