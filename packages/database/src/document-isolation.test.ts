import { Prisma, PrismaClient } from '@prisma/client';
import { expect, it } from 'vitest';

const enabled = process.env.DATABASE_E2E === 'true';

async function withContext<T>(
  client: PrismaClient,
  agencyId: string,
  userId: string,
  work: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return client.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT
        set_config('app.agency_id', ${agencyId}, true),
        set_config('app.user_id', ${userId}, true)
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
  'isolates Documents and Document Versions and rejects foreign relationships',
  async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL is required for the integration test.');
    const app = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-document-isolation`;
    const agencyA = await admin.agency.create({
      data: {
        code: `DOC-A-${suffix}`,
        name: 'Document Agency A',
        agencyType: 'NGA',
        status: 'ACTIVE',
      },
    });
    const agencyB = await admin.agency.create({
      data: {
        code: `DOC-B-${suffix}`,
        name: 'Document Agency B',
        agencyType: 'NGA',
        status: 'ACTIVE',
      },
    });
    const user = await admin.user.create({
      data: {
        emailNormalized: `document-isolation-${suffix}@example.test`,
        displayName: 'Document Isolation User',
        globalStatus: 'ACTIVE',
      },
    });
    const membershipA = await admin.agencyMembership.create({
      data: { agencyId: agencyA.id, userId: user.id, status: 'ACTIVE' },
    });
    const membershipB = await admin.agencyMembership.create({
      data: { agencyId: agencyB.id, userId: user.id, status: 'ACTIVE' },
    });
    const documentA = await admin.document.create({
      data: {
        agencyId: agencyA.id,
        documentType: 'STAFFING_AUTHORITY',
        classification: 'CONFIDENTIAL',
        status: 'DRAFT',
        createdByMembershipId: membershipA.id,
      },
    });
    const documentB = await admin.document.create({
      data: {
        agencyId: agencyB.id,
        documentType: 'STAFFING_AUTHORITY',
        classification: 'CONFIDENTIAL',
        status: 'DRAFT',
        createdByMembershipId: membershipB.id,
      },
    });
    const versionA = await admin.documentVersion.create({
      data: {
        agencyId: agencyA.id,
        documentId: documentA.id,
        versionNo: 1,
        storageKey: `test/${suffix}/a`,
        contentHash: 'a'.repeat(64),
        mimeType: 'application/pdf',
        sizeBytes: 1,
        createdByMembershipId: membershipA.id,
      },
    });
    await admin.document.update({
      where: { id: documentA.id },
      data: { currentVersionId: versionA.id },
    });

    try {
      await expect(
        withContext(app, agencyA.id, user.id, (transaction) =>
          transaction.document.findMany({ where: { id: documentB.id } }),
        ),
      ).resolves.toHaveLength(0);
      await expect(
        withContext(app, agencyA.id, user.id, (transaction) =>
          transaction.documentVersion.findMany({ where: { documentId: documentB.id } }),
        ),
      ).resolves.toHaveLength(0);
      await expect(
        withContext(app, agencyA.id, user.id, (transaction) =>
          transaction.document.create({
            data: {
              agencyId: agencyB.id,
              documentType: 'STAFFING_AUTHORITY',
              classification: 'CONFIDENTIAL',
              status: 'DRAFT',
              createdByMembershipId: membershipA.id,
            },
          }),
        ),
      ).rejects.toThrow(/row-level security/i);
      await expect(
        withContext(app, agencyA.id, user.id, (transaction) =>
          transaction.documentVersion.create({
            data: {
              agencyId: agencyA.id,
              documentId: documentB.id,
              versionNo: 1,
              storageKey: `test/${suffix}/foreign`,
              contentHash: 'b'.repeat(64),
              mimeType: 'application/pdf',
              sizeBytes: 1,
              createdByMembershipId: membershipA.id,
            },
          }),
        ),
      ).rejects.toThrow(/row-level security|foreign key/i);
      await expect(
        admin.document.create({
          data: {
            agencyId: agencyA.id,
            documentType: 'STAFFING_AUTHORITY',
            classification: 'CONFIDENTIAL',
            status: 'DRAFT',
            createdByMembershipId: membershipB.id,
          },
        }),
      ).rejects.toThrow(/foreign key|agency/i);
    } finally {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.documentVersion.deleteMany({
          where: { agencyId: { in: [agencyA.id, agencyB.id] } },
        });
        await transaction.document.deleteMany({
          where: { agencyId: { in: [agencyA.id, agencyB.id] } },
        });
      });
      await admin.agencyMembership.deleteMany({
        where: { agencyId: { in: [agencyA.id, agencyB.id] } },
      });
      await admin.agency.deleteMany({ where: { id: { in: [agencyA.id, agencyB.id] } } });
      await admin.user.delete({ where: { id: user.id } });
      await app.$disconnect();
      await admin.$disconnect();
    }
  },
);
