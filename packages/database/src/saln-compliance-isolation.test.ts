import { Prisma, PrismaClient } from '@prisma/client';
import { expect, it } from 'vitest';

const enabled = process.env.DATABASE_E2E === 'true';

function adminUrl(): string {
  const value = process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
  if (!value) throw new Error('An administrative database URL is required.');
  return value;
}

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
        set_config('app.saln_compliance_transition', ${values.transition ? 'on' : ''}, true),
        set_config('app.employee_document_transition', ${values.transition ? 'on' : ''}, true)
    `;
    return work(transaction);
  });
}

it.skipIf(!enabled)(
  'forces SALN compliance Agency isolation and append-only correction history',
  async () => {
    const runtimeUrl = process.env.DATABASE_URL;
    if (!runtimeUrl) throw new Error('DATABASE_URL is required.');
    const app = new PrismaClient({ datasources: { db: { url: runtimeUrl } } });
    const admin = new PrismaClient({ datasources: { db: { url: adminUrl() } } });
    const suffix = String(Date.now());
    const [agencyA, agencyB] = await Promise.all(
      ['A', 'B'].map((label) =>
        admin.agency.create({
          data: {
            code: `SALN-RLS-${label}-${suffix}`,
            name: `SALN RLS ${label}`,
            agencyType: 'NGA',
            status: 'ACTIVE',
          },
        }),
      ),
    );
    const user = await admin.user.create({
      data: {
        emailNormalized: `saln-rls-${suffix}@example.test`,
        displayName: 'SALN RLS User',
        globalStatus: 'ACTIVE',
      },
    });
    const [membershipA, membershipB] = await Promise.all([
      admin.agencyMembership.create({
        data: { agencyId: agencyA.id, userId: user.id, status: 'ACTIVE' },
      }),
      admin.agencyMembership.create({
        data: { agencyId: agencyB.id, userId: user.id, status: 'ACTIVE' },
      }),
    ]);
    const [employeeA, employeeB] = await Promise.all([
      admin.employee.create({
        data: {
          agencyId: agencyA.id,
          employeeNumber: `SALN-A-${suffix}`,
          legalName: `SALN A ${suffix}`,
          birthDate: new Date('1990-01-01'),
          sex: 'FEMALE',
          civilStatus: 'SINGLE',
          contactEmail: `saln-a-${suffix}@example.test`,
          createdByMembershipId: membershipA.id,
          updatedByMembershipId: membershipA.id,
        },
      }),
      admin.employee.create({
        data: {
          agencyId: agencyB.id,
          employeeNumber: `SALN-B-${suffix}`,
          legalName: `SALN B ${suffix}`,
          birthDate: new Date('1991-01-01'),
          sex: 'MALE',
          civilStatus: 'SINGLE',
          contactEmail: `saln-b-${suffix}@example.test`,
          createdByMembershipId: membershipB.id,
          updatedByMembershipId: membershipB.id,
        },
      }),
    ]);
    const document = await admin.document.create({
      data: {
        agencyId: agencyA.id,
        documentType: 'SALN',
        classification: 'HIGHLY_SENSITIVE',
        status: 'DRAFT',
        createdByMembershipId: membershipA.id,
      },
    });
    const documentVersion = await admin.documentVersion.create({
      data: {
        agencyId: agencyA.id,
        documentId: document.id,
        versionNo: 1,
        storageKey: `saln-rls/${suffix}`,
        contentHash: 'a'.repeat(64),
        mimeType: 'application/pdf',
        sizeBytes: 1,
        createdByMembershipId: membershipA.id,
      },
    });
    const data = (agencyId: string, employeeId: string, membershipId: string) => ({
      agencyId,
      employeeId,
      requirementReference: 'Externally authorized requirement',
      filingYear: 2026,
      filingType: 'ANNUAL',
      status: 'NOT_SUBMITTED',
      createdByMembershipId: membershipId,
    });
    try {
      const foreign = await withContext(
        app,
        { agencyId: agencyB.id, userId: user.id, membershipId: membershipB.id, transition: true },
        (transaction) =>
          transaction.salnComplianceRecord.create({
            data: data(agencyB.id, employeeB.id, membershipB.id),
          }),
      );
      await expect(
        withContext(
          app,
          { agencyId: agencyA.id, userId: user.id, membershipId: membershipA.id },
          (transaction) => transaction.salnComplianceRecord.findMany({ where: { id: foreign.id } }),
        ),
      ).resolves.toEqual([]);
      await expect(
        withContext(
          app,
          { agencyId: agencyA.id, userId: user.id, membershipId: membershipA.id },
          (transaction) =>
            transaction.salnComplianceRecord.create({
              data: data(agencyA.id, employeeA.id, membershipA.id),
            }),
        ),
      ).rejects.toThrow(/application service/i);
      await expect(
        withContext(
          app,
          { agencyId: agencyA.id, userId: user.id, membershipId: membershipA.id, transition: true },
          (transaction) =>
            transaction.salnComplianceRecord.create({
              data: data(agencyB.id, employeeB.id, membershipB.id),
            }),
        ),
      ).rejects.toThrow(/row-level security/i);
      const local = await withContext(
        app,
        { agencyId: agencyA.id, userId: user.id, membershipId: membershipA.id, transition: true },
        (transaction) =>
          transaction.salnComplianceRecord.create({
            data: data(agencyA.id, employeeA.id, membershipA.id),
          }),
      );
      await expect(
        withContext(
          app,
          { agencyId: agencyA.id, userId: user.id, membershipId: membershipA.id, transition: true },
          (transaction) =>
            transaction.salnComplianceRecord.updateMany({
              where: { agencyId: agencyA.id, id: local.id },
              data: { filingType: 'CHANGED' },
            }),
        ),
      ).resolves.toEqual({ count: 0 });
      await expect(
        admin.salnComplianceRecord.update({
          where: { id: local.id },
          data: { filingType: 'CHANGED' },
        }),
      ).rejects.toThrow(/append-only/i);
      await expect(
        withContext(
          app,
          { agencyId: agencyA.id, userId: user.id, membershipId: membershipA.id, transition: true },
          (transaction) =>
            transaction.salnComplianceRecord.create({
              data: {
                ...data(agencyA.id, employeeA.id, membershipA.id),
                correctsRecordId: foreign.id,
                correctionReason: 'Invalid cross-Agency correction.',
              },
            }),
        ),
      ).rejects.toThrow();
      await expect(
        withContext(
          app,
          { agencyId: agencyA.id, userId: user.id, membershipId: membershipA.id, transition: true },
          (transaction) =>
            transaction.employeeDocument.create({
              data: {
                agencyId: agencyA.id,
                employeeId: employeeA.id,
                documentId: document.id,
                documentVersionId: documentVersion.id,
                personnelClassification: 'SALN',
                purpose: 'COMPLIANCE_SUPPORT',
                releaseState: 'WITHHELD',
                createdByMembershipId: membershipA.id,
              },
            }),
        ),
      ).rejects.toThrow(/cannot be stored/i);
    } finally {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.salnComplianceRecord.deleteMany({
          where: { agencyId: { in: [agencyA.id, agencyB.id] } },
        });
        await transaction.documentVersion.delete({ where: { id: documentVersion.id } });
        await transaction.document.delete({ where: { id: document.id } });
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
