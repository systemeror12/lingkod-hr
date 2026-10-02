import { Prisma, PrismaClient } from '@prisma/client';
import { expect, it } from 'vitest';

const enabled = process.env.DATABASE_E2E === 'true';

async function withContext<T>(
  client: PrismaClient,
  values: { agencyId: string; userId: string; membershipId: string; transition?: boolean },
  work: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return client.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT
        set_config('app.agency_id', ${values.agencyId}, true),
        set_config('app.user_id', ${values.userId}, true),
        set_config('app.membership_id', ${values.membershipId}, true),
        set_config(
          'app.employee_document_transition',
          ${values.transition ? 'on' : ''},
          true
        )
    `;
    return work(transaction);
  });
}

function adminUrl(): string {
  const url = process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
  if (!url) throw new Error('An administrative database URL is required for the test.');
  return url;
}

it.skipIf(!enabled)(
  'isolates Employee Document links and requires the transition context',
  async () => {
    const runtimeUrl = process.env.DATABASE_URL;
    if (!runtimeUrl) throw new Error('DATABASE_URL is required for the integration test.');
    const app = new PrismaClient({ datasources: { db: { url: runtimeUrl } } });
    const admin = new PrismaClient({ datasources: { db: { url: adminUrl() } } });
    const suffix = String(Date.now());
    const [agencyA, agencyB] = await Promise.all([
      admin.agency.create({
        data: {
          code: `ED-RLS-A-${suffix}`,
          name: 'Employee Document RLS A',
          agencyType: 'NGA',
          status: 'ACTIVE',
        },
      }),
      admin.agency.create({
        data: {
          code: `ED-RLS-B-${suffix}`,
          name: 'Employee Document RLS B',
          agencyType: 'NGA',
          status: 'ACTIVE',
        },
      }),
    ]);
    const user = await admin.user.create({
      data: {
        emailNormalized: `employee-document-rls-${suffix}@example.test`,
        displayName: 'Employee Document RLS User',
        globalStatus: 'ACTIVE',
      },
    });
    const membershipA = await admin.agencyMembership.create({
      data: { agencyId: agencyA.id, userId: user.id, status: 'ACTIVE' },
    });
    const membershipB = await admin.agencyMembership.create({
      data: { agencyId: agencyB.id, userId: user.id, status: 'ACTIVE' },
    });
    const employeeA = await admin.employee.create({
      data: {
        agencyId: agencyA.id,
        employeeNumber: `ED-RLS-A-${suffix}`,
        legalName: 'Employee Document RLS A',
        birthDate: new Date('1990-01-01'),
        sex: 'FEMALE',
        civilStatus: 'SINGLE',
        contactEmail: 'employee-a@example.test',
        createdByMembershipId: membershipA.id,
        updatedByMembershipId: membershipA.id,
      },
    });
    const employeeB = await admin.employee.create({
      data: {
        agencyId: agencyB.id,
        employeeNumber: `ED-RLS-B-${suffix}`,
        legalName: 'Employee Document RLS B',
        birthDate: new Date('1991-01-01'),
        sex: 'MALE',
        civilStatus: 'SINGLE',
        contactEmail: 'employee-b@example.test',
        createdByMembershipId: membershipB.id,
        updatedByMembershipId: membershipB.id,
      },
    });
    const documentA = await admin.document.create({
      data: {
        agencyId: agencyA.id,
        documentType: 'PDS',
        classification: 'CONFIDENTIAL',
        status: 'DRAFT',
        createdByMembershipId: membershipA.id,
      },
    });
    const versionA = await admin.documentVersion.create({
      data: {
        agencyId: agencyA.id,
        documentId: documentA.id,
        versionNo: 1,
        storageKey: `employee-document-rls/${suffix}/a`,
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
    await admin.document.update({ where: { id: documentA.id }, data: { status: 'ISSUED' } });
    try {
      const contextA = { agencyId: agencyA.id, userId: user.id, membershipId: membershipA.id };
      await expect(
        withContext(app, { ...contextA, transition: true }, (transaction) =>
          transaction.employeeDocument.findMany({ where: { employeeId: employeeB.id } }),
        ),
      ).resolves.toHaveLength(0);
      await expect(
        withContext(app, contextA, (transaction) =>
          transaction.employeeDocument.create({
            data: {
              agencyId: agencyA.id,
              employeeId: employeeA.id,
              documentId: documentA.id,
              documentVersionId: versionA.id,
              personnelClassification: 'PDS',
              purpose: 'PDS_SUPPORT',
              createdByMembershipId: membershipA.id,
            },
          }),
        ),
      ).rejects.toThrow(/application service/i);
      await expect(
        withContext(app, { ...contextA, transition: true }, (transaction) =>
          transaction.employeeDocument.create({
            data: {
              agencyId: agencyB.id,
              employeeId: employeeB.id,
              documentId: documentA.id,
              documentVersionId: versionA.id,
              personnelClassification: 'PDS',
              purpose: 'PDS_SUPPORT',
              createdByMembershipId: membershipA.id,
            },
          }),
        ),
      ).rejects.toThrow(/row-level security/i);
      const link = await withContext(app, { ...contextA, transition: true }, (transaction) =>
        transaction.employeeDocument.create({
          data: {
            agencyId: agencyA.id,
            employeeId: employeeA.id,
            documentId: documentA.id,
            documentVersionId: versionA.id,
            personnelClassification: 'PDS',
            purpose: 'PDS_SUPPORT',
            createdByMembershipId: membershipA.id,
          },
        }),
      );
      expect(link.employeeId).toBe(employeeA.id);
      await expect(
        withContext(app, contextA, (transaction) =>
          transaction.employeeDocument.findMany({ where: { id: link.id } }),
        ),
      ).resolves.toHaveLength(1);
    } finally {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.employeeDocument.deleteMany({
          where: { agencyId: { in: [agencyA.id, agencyB.id] } },
        });
        await transaction.documentVersion.deleteMany({ where: { agencyId: agencyA.id } });
        await transaction.document.deleteMany({ where: { agencyId: agencyA.id } });
        await transaction.employee.deleteMany({
          where: { agencyId: { in: [agencyA.id, agencyB.id] } },
        });
        await transaction.agencyMembership.deleteMany({
          where: { agencyId: { in: [agencyA.id, agencyB.id] } },
        });
        await transaction.agency.deleteMany({ where: { id: { in: [agencyA.id, agencyB.id] } } });
        await transaction.user.delete({ where: { id: user.id } });
      });
      await app.$disconnect();
      await admin.$disconnect();
    }
  },
);
