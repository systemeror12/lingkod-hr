import { PrismaClient, type Prisma } from '@prisma/client';
import { expect, it } from 'vitest';

const enabled = process.env.DATABASE_E2E === 'true';

async function withContext<T>(
  client: PrismaClient,
  values: { agencyId: string; userId: string; membershipId: string; pdsMutation?: boolean },
  work: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return client.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT
        set_config('app.agency_id', ${values.agencyId}, true),
        set_config('app.user_id', ${values.userId}, true),
        set_config('app.membership_id', ${values.membershipId}, true),
        set_config('app.pds_mutation', ${values.pdsMutation ? 'on' : ''}, true)
    `;
    return work(transaction);
  });
}

async function adminClient(): Promise<PrismaClient> {
  const url = process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
  if (!url) throw new Error('A database owner URL is required for the integration test.');
  return new PrismaClient({ datasources: { db: { url } } });
}

it.skipIf(!enabled)('isolates PDS sections and enforces draft-only mutations', async () => {
  const runtimeUrl = process.env.DATABASE_URL;
  if (!runtimeUrl) throw new Error('DATABASE_URL is required for the integration test.');
  const app = new PrismaClient({ datasources: { db: { url: runtimeUrl } } });
  const admin = await adminClient();
  const suffix = `${Date.now()}-pds`;
  const agencyA = await admin.agency.create({
    data: { code: `PDS-A-${suffix}`, name: 'PDS Agency A', agencyType: 'NGA', status: 'ACTIVE' },
  });
  const agencyB = await admin.agency.create({
    data: { code: `PDS-B-${suffix}`, name: 'PDS Agency B', agencyType: 'NGA', status: 'ACTIVE' },
  });
  const user = await admin.user.create({
    data: {
      identityProvider: 'pds-rls-e2e',
      externalSubject: `pds-${suffix}`,
      emailNormalized: `pds-${suffix}@example.test`,
      displayName: 'PDS RLS User',
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
      employeeNumber: `PDS-A-${suffix}`,
      legalName: 'PDS Agency A Employee',
      birthDate: new Date('1990-01-01'),
      sex: 'FEMALE',
      civilStatus: 'SINGLE',
      contactEmail: `pds-a-${suffix}@example.test`,
      createdByMembershipId: membershipA.id,
      updatedByMembershipId: membershipA.id,
    },
  });
  const employeeB = await admin.employee.create({
    data: {
      agencyId: agencyB.id,
      employeeNumber: `PDS-B-${suffix}`,
      legalName: 'PDS Agency B Employee',
      birthDate: new Date('1990-01-01'),
      sex: 'MALE',
      civilStatus: 'SINGLE',
      contactEmail: `pds-b-${suffix}@example.test`,
      createdByMembershipId: membershipB.id,
      updatedByMembershipId: membershipB.id,
    },
  });
  const pdsB = await admin.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    const version = await transaction.pdsVersion.create({
      data: {
        agencyId: agencyB.id,
        employeeId: employeeB.id,
        versionNo: 1,
        formVersion: 'CS_FORM_212_REVISED_2026',
        asOfDate: new Date('2026-08-31'),
        status: 'DRAFT',
        createdByMembershipId: membershipB.id,
        updatedByMembershipId: membershipB.id,
      },
    });
    await transaction.pdsPersonalDetails.create({
      data: { agencyId: agencyB.id, pdsVersionId: version.id, surname: 'Foreign' },
    });
    return version;
  });

  try {
    await expect(
      withContext(
        app,
        { agencyId: agencyA.id, userId: user.id, membershipId: membershipA.id },
        (transaction) => transaction.pdsVersion.findMany({ where: { id: pdsB.id } }),
      ),
    ).resolves.toHaveLength(0);

    const pdsA = await withContext(
      app,
      {
        agencyId: agencyA.id,
        userId: user.id,
        membershipId: membershipA.id,
        pdsMutation: true,
      },
      async (transaction) => {
        const version = await transaction.pdsVersion.create({
          data: {
            agencyId: agencyA.id,
            employeeId: employeeA.id,
            versionNo: 1,
            formVersion: 'CS_FORM_212_REVISED_2026',
            asOfDate: new Date('2026-08-31'),
            status: 'DRAFT',
            createdByMembershipId: membershipA.id,
            updatedByMembershipId: membershipA.id,
          },
        });
        await transaction.pdsPersonalDetails.create({
          data: { agencyId: agencyA.id, pdsVersionId: version.id, surname: 'Local' },
        });
        await transaction.pdsFamilyRecord.create({
          data: {
            agencyId: agencyA.id,
            pdsVersionId: version.id,
            relationshipType: 'CHILD',
            sequenceNo: 1,
            fullName: 'Local Child',
            birthDate: new Date('2020-01-01'),
          },
        });
        return version;
      },
    );

    await expect(
      withContext(
        app,
        { agencyId: agencyA.id, userId: user.id, membershipId: membershipA.id },
        (transaction) =>
          transaction.pdsPersonalDetails.update({
            where: { pdsVersionId: pdsA.id },
            data: { surname: 'Blocked' },
          }),
      ),
    ).rejects.toThrow(/application service|section rows/i);

    await expect(
      withContext(
        app,
        {
          agencyId: agencyA.id,
          userId: user.id,
          membershipId: membershipA.id,
          pdsMutation: true,
        },
        (transaction) =>
          transaction.pdsPersonalDetails.update({
            where: { pdsVersionId: pdsA.id },
            data: { surname: 'Updated' },
          }),
      ),
    ).resolves.toMatchObject({ surname: 'Updated' });

    await expect(
      withContext(
        app,
        {
          agencyId: agencyA.id,
          userId: user.id,
          membershipId: membershipA.id,
          pdsMutation: true,
        },
        (transaction) =>
          transaction.pdsVersion.create({
            data: {
              agencyId: agencyB.id,
              employeeId: employeeB.id,
              versionNo: 2,
              formVersion: 'CS_FORM_212_REVISED_2026',
              asOfDate: new Date('2026-08-31'),
              status: 'DRAFT',
              createdByMembershipId: membershipB.id,
              updatedByMembershipId: membershipB.id,
            },
          }),
      ),
    ).rejects.toThrow(/row-level security/i);

    await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await transaction.pdsVersion.update({
        where: { id: pdsA.id },
        data: { status: 'CERTIFIED' },
      });
    });
    await expect(
      withContext(
        app,
        {
          agencyId: agencyA.id,
          userId: user.id,
          membershipId: membershipA.id,
          pdsMutation: true,
        },
        (transaction) =>
          transaction.pdsFamilyRecord.deleteMany({ where: { pdsVersionId: pdsA.id } }),
      ),
    ).rejects.toThrow(/immutable/i);
  } finally {
    await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await transaction.pdsFamilyRecord.deleteMany({
        where: { pdsVersion: { agencyId: { in: [agencyA.id, agencyB.id] } } },
      });
      await transaction.pdsPersonalDetails.deleteMany({
        where: { agencyId: { in: [agencyA.id, agencyB.id] } },
      });
      await transaction.pdsVersion.deleteMany({
        where: { agencyId: { in: [agencyA.id, agencyB.id] } },
      });
      await transaction.agencyMembership.deleteMany({
        where: { agencyId: { in: [agencyA.id, agencyB.id] } },
      });
      await transaction.employee.deleteMany({
        where: { agencyId: { in: [agencyA.id, agencyB.id] } },
      });
    });
    await admin.agency.deleteMany({ where: { id: { in: [agencyA.id, agencyB.id] } } });
    await admin.user.delete({ where: { id: user.id } });
    await app.$disconnect();
    await admin.$disconnect();
  }
});
