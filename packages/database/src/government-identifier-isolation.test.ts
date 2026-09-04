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
          'app.government_identifier_transition',
          ${values.transition ? 'on' : ''},
          true
        )
    `;
    return work(transaction);
  });
}

function adminUrl(): string {
  const url = process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
  if (!url) throw new Error('An administrative database URL is required for the integration test.');
  return url;
}

function identifierData(values: {
  agencyId: string;
  employeeId: string;
  membershipId: string;
  maskedValue: string;
  identifierType?: string;
  effectiveFrom?: string;
  replacesIdentifierId?: string;
  reason?: string;
}) {
  return {
    agencyId: values.agencyId,
    employeeId: values.employeeId,
    identifierType: values.identifierType ?? 'TIN',
    encryptedValue: Buffer.from(values.maskedValue),
    maskedValue: values.maskedValue,
    effectiveFrom: new Date(values.effectiveFrom ?? '2024-01-01'),
    replacesIdentifierId: values.replacesIdentifierId,
    reason: values.reason,
    createdByMembershipId: values.membershipId,
    updatedByMembershipId: values.membershipId,
  };
}

it.skipIf(!enabled)(
  'isolates Government Identifiers and enforces replacement retention guards',
  async () => {
    const runtimeUrl = process.env.DATABASE_URL;
    if (!runtimeUrl) throw new Error('DATABASE_URL is required for the integration test.');
    const app = new PrismaClient({ datasources: { db: { url: runtimeUrl } } });
    const admin = new PrismaClient({ datasources: { db: { url: adminUrl() } } });
    const suffix = String(Date.now());
    const [agencyA, agencyB] = await Promise.all([
      admin.agency.create({
        data: {
          code: `GOV-ID-RLS-A-${suffix}`,
          name: 'Government Identifier RLS A',
          agencyType: 'NGA',
          status: 'ACTIVE',
        },
      }),
      admin.agency.create({
        data: {
          code: `GOV-ID-RLS-B-${suffix}`,
          name: 'Government Identifier RLS B',
          agencyType: 'NGA',
          status: 'ACTIVE',
        },
      }),
    ]);
    const user = await admin.user.create({
      data: {
        identityProvider: 'government-identifier-rls-e2e',
        externalSubject: `government-identifier-rls-${suffix}`,
        emailNormalized: `government-identifier-rls-${suffix}@example.test`,
        displayName: 'Government Identifier RLS User',
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
        employeeNumber: `GOV-ID-A-${suffix}`,
        legalName: 'Government Identifier A',
        birthDate: new Date('1990-01-01'),
        sex: 'FEMALE',
        civilStatus: 'SINGLE',
        contactEmail: `government-identifier-a-${suffix}@example.test`,
        createdByMembershipId: membershipA.id,
        updatedByMembershipId: membershipA.id,
      },
    });
    const secondEmployeeA = await admin.employee.create({
      data: {
        agencyId: agencyA.id,
        employeeNumber: `GOV-ID-A2-${suffix}`,
        legalName: 'Government Identifier A2',
        birthDate: new Date('1991-01-01'),
        sex: 'MALE',
        civilStatus: 'SINGLE',
        contactEmail: `government-identifier-a2-${suffix}@example.test`,
        createdByMembershipId: membershipA.id,
        updatedByMembershipId: membershipA.id,
      },
    });
    const employeeB = await admin.employee.create({
      data: {
        agencyId: agencyB.id,
        employeeNumber: `GOV-ID-B-${suffix}`,
        legalName: 'Government Identifier B',
        birthDate: new Date('1992-01-01'),
        sex: 'FEMALE',
        civilStatus: 'SINGLE',
        contactEmail: `government-identifier-b-${suffix}@example.test`,
        createdByMembershipId: membershipB.id,
        updatedByMembershipId: membershipB.id,
      },
    });

    try {
      const contextA = { agencyId: agencyA.id, userId: user.id, membershipId: membershipA.id };
      const contextB = { agencyId: agencyB.id, userId: user.id, membershipId: membershipB.id };
      const foreign = await withContext(app, { ...contextB, transition: true }, (transaction) =>
        transaction.governmentIdentifier.create({
          data: identifierData({
            agencyId: agencyB.id,
            employeeId: employeeB.id,
            membershipId: membershipB.id,
            maskedValue: `TIN-B-${suffix}`,
          }),
        }),
      );

      await expect(
        withContext(app, contextA, (transaction) =>
          transaction.governmentIdentifier.findMany({ where: { id: foreign.id } }),
        ),
      ).resolves.toHaveLength(0);

      const active = await withContext(app, { ...contextA, transition: true }, (transaction) =>
        transaction.governmentIdentifier.create({
          data: identifierData({
            agencyId: agencyA.id,
            employeeId: employeeA.id,
            membershipId: membershipA.id,
            maskedValue: `TIN-A-${suffix}`,
          }),
        }),
      );
      await expect(
        withContext(app, { ...contextA, transition: true }, (transaction) =>
          transaction.governmentIdentifier.create({
            data: identifierData({
              agencyId: agencyA.id,
              employeeId: employeeA.id,
              membershipId: membershipA.id,
              maskedValue: `TIN-A-DUP-${suffix}`,
            }),
          }),
        ),
      ).rejects.toThrow(/unique/i);
      await expect(
        withContext(app, { ...contextA, transition: true }, (transaction) =>
          transaction.governmentIdentifier.create({
            data: identifierData({
              agencyId: agencyB.id,
              employeeId: employeeB.id,
              membershipId: membershipB.id,
              maskedValue: `TIN-CROSS-${suffix}`,
            }),
          }),
        ),
      ).rejects.toThrow(/row-level security/i);
      await expect(
        withContext(app, { ...contextA, transition: true }, (transaction) =>
          transaction.governmentIdentifier.update({
            where: { id: active.id },
            data: { status: 'REPLACED', updatedByMembershipId: membershipA.id },
          }),
        ),
      ).rejects.toThrow(/end date and reason/i);

      const replaced = await withContext(app, { ...contextA, transition: true }, (transaction) =>
        transaction.governmentIdentifier.update({
          where: { id: active.id },
          data: {
            status: 'REPLACED',
            effectiveTo: new Date('2024-12-31'),
            reason: 'Corrected value',
            updatedByMembershipId: membershipA.id,
          },
        }),
      );
      expect(replaced.status).toBe('REPLACED');

      await expect(
        withContext(app, { ...contextA, transition: true }, (transaction) =>
          transaction.governmentIdentifier.create({
            data: identifierData({
              agencyId: agencyA.id,
              employeeId: employeeA.id,
              membershipId: membershipA.id,
              maskedValue: `TIN-A-GAP-${suffix}`,
              effectiveFrom: '2025-01-02',
              replacesIdentifierId: active.id,
              reason: 'Corrected value',
            }),
          }),
        ),
      ).rejects.toThrow(/continue the replaced effective period/i);

      await expect(
        withContext(app, { ...contextA, transition: true }, (transaction) =>
          transaction.governmentIdentifier.create({
            data: identifierData({
              agencyId: agencyA.id,
              employeeId: secondEmployeeA.id,
              membershipId: membershipA.id,
              maskedValue: `TIN-WRONG-EMP-${suffix}`,
              replacesIdentifierId: active.id,
              reason: 'Wrong employee',
            }),
          }),
        ),
      ).rejects.toThrow(/same employee and identifier type/i);
      await expect(
        withContext(app, { ...contextA, transition: true }, (transaction) =>
          transaction.governmentIdentifier.create({
            data: identifierData({
              agencyId: agencyA.id,
              employeeId: employeeA.id,
              membershipId: membershipA.id,
              maskedValue: `UMID-WRONG-TYPE-${suffix}`,
              identifierType: 'UMID',
              replacesIdentifierId: active.id,
              reason: 'Wrong type',
            }),
          }),
        ),
      ).rejects.toThrow(/same employee and identifier type/i);

      const replacement = await withContext(app, { ...contextA, transition: true }, (transaction) =>
        transaction.governmentIdentifier.create({
          data: identifierData({
            agencyId: agencyA.id,
            employeeId: employeeA.id,
            membershipId: membershipA.id,
            maskedValue: `TIN-A-NEW-${suffix}`,
            effectiveFrom: '2025-01-01',
            replacesIdentifierId: active.id,
            reason: 'Corrected value',
          }),
        }),
      );
      expect(replacement.replacesIdentifierId).toBe(active.id);
      await expect(
        withContext(app, { ...contextA, transition: true }, (transaction) =>
          transaction.governmentIdentifier.delete({ where: { id: replacement.id } }),
        ),
      ).rejects.toThrow(/permission denied|retained/i);
    } finally {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.governmentIdentifier.deleteMany({
          where: { agencyId: { in: [agencyA.id, agencyB.id] } },
        });
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
