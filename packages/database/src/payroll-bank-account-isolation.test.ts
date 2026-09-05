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
          'app.payroll_bank_account_transition',
          ${values.transition ? 'on' : ''},
          true
        )
    `;
    return work(transaction);
  });
}

function adminUrl(): string {
  const value = process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
  if (!value) throw new Error('An administrative database URL is required.');
  return value;
}

function accountData(values: {
  agencyId: string;
  employeeId: string;
  membershipId: string;
  effectiveFrom: string;
  masked: string;
}) {
  return {
    agencyId: values.agencyId,
    employeeId: values.employeeId,
    bankCode: 'LBP',
    accountName: 'Database Test Employee',
    encryptedAccountNumber: new Uint8Array(Buffer.from(values.masked)),
    maskedAccountNumber: values.masked,
    effectiveFrom: new Date(values.effectiveFrom),
    createdByMembershipId: values.membershipId,
    updatedByMembershipId: values.membershipId,
  };
}

it.skipIf(!enabled)(
  'forces payroll bank account Agency isolation, retention, and non-overlapping active periods',
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
            code: `BANK-RLS-${label}-${suffix}`,
            name: `Bank RLS ${label}`,
            agencyType: 'NGA',
            status: 'ACTIVE',
          },
        }),
      ),
    );
    const user = await admin.user.create({
      data: {
        identityProvider: 'bank-account-rls-e2e',
        externalSubject: `bank-account-rls-${suffix}`,
        emailNormalized: `bank-account-rls-${suffix}@example.test`,
        displayName: 'Bank Account RLS User',
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
          employeeNumber: `BANK-A-${suffix}`,
          legalName: 'Bank Account A',
          birthDate: new Date('1990-01-01'),
          sex: 'FEMALE',
          civilStatus: 'SINGLE',
          contactEmail: `bank-a-${suffix}@example.test`,
          createdByMembershipId: membershipA.id,
          updatedByMembershipId: membershipA.id,
        },
      }),
      admin.employee.create({
        data: {
          agencyId: agencyB.id,
          employeeNumber: `BANK-B-${suffix}`,
          legalName: 'Bank Account B',
          birthDate: new Date('1991-01-01'),
          sex: 'MALE',
          civilStatus: 'SINGLE',
          contactEmail: `bank-b-${suffix}@example.test`,
          createdByMembershipId: membershipB.id,
          updatedByMembershipId: membershipB.id,
        },
      }),
    ]);

    try {
      const contextA = { agencyId: agencyA.id, userId: user.id, membershipId: membershipA.id };
      const contextB = { agencyId: agencyB.id, userId: user.id, membershipId: membershipB.id };
      const foreign = await withContext(app, { ...contextB, transition: true }, (transaction) =>
        transaction.payrollBankAccount.create({
          data: accountData({
            agencyId: agencyB.id,
            employeeId: employeeB.id,
            membershipId: membershipB.id,
            effectiveFrom: '2026-01-01',
            masked: '******0002',
          }),
        }),
      );

      await expect(
        withContext(app, contextA, (transaction) =>
          transaction.payrollBankAccount.findMany({ where: { id: foreign.id } }),
        ),
      ).resolves.toHaveLength(0);
      await expect(
        withContext(app, contextA, (transaction) =>
          transaction.payrollBankAccount.create({
            data: accountData({
              agencyId: agencyA.id,
              employeeId: employeeA.id,
              membershipId: membershipA.id,
              effectiveFrom: '2026-01-01',
              masked: '******0001',
            }),
          }),
        ),
      ).rejects.toThrow(/application service/i);
      await expect(
        withContext(app, { ...contextA, transition: true }, (transaction) =>
          transaction.payrollBankAccount.create({
            data: accountData({
              agencyId: agencyB.id,
              employeeId: employeeB.id,
              membershipId: membershipB.id,
              effectiveFrom: '2026-01-01',
              masked: '******9999',
            }),
          }),
        ),
      ).rejects.toThrow(/row-level security/i);

      const first = await withContext(app, { ...contextA, transition: true }, (transaction) =>
        transaction.payrollBankAccount.create({
          data: accountData({
            agencyId: agencyA.id,
            employeeId: employeeA.id,
            membershipId: membershipA.id,
            effectiveFrom: '2026-01-01',
            masked: '******0001',
          }),
        }),
      );
      await withContext(app, { ...contextA, transition: true }, (transaction) =>
        transaction.payrollBankAccount.update({
          where: { agencyId_id: { agencyId: agencyA.id, id: first.id } },
          data: {
            verificationState: 'VERIFIED',
            verifiedAt: new Date('2025-12-15'),
            status: 'ACTIVE',
            reason: 'Evidence verified.',
            updatedByMembershipId: membershipA.id,
          },
        }),
      );
      const overlapping = await withContext(app, { ...contextA, transition: true }, (transaction) =>
        transaction.payrollBankAccount.create({
          data: accountData({
            agencyId: agencyA.id,
            employeeId: employeeA.id,
            membershipId: membershipA.id,
            effectiveFrom: '2026-06-01',
            masked: '******0003',
          }),
        }),
      );
      await expect(
        withContext(app, { ...contextA, transition: true }, (transaction) =>
          transaction.payrollBankAccount.update({
            where: { agencyId_id: { agencyId: agencyA.id, id: overlapping.id } },
            data: {
              verificationState: 'VERIFIED',
              verifiedAt: new Date('2026-05-15'),
              status: 'ACTIVE',
              reason: 'Evidence verified.',
              updatedByMembershipId: membershipA.id,
            },
          }),
        ),
      ).rejects.toThrow(/primary_period_excl|exclusion/i);
      await expect(
        withContext(app, { ...contextA, transition: true }, (transaction) =>
          transaction.payrollBankAccount.delete({ where: { id: first.id } }),
        ),
      ).rejects.toThrow(/permission denied|retained/i);
    } finally {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.payrollBankAccount.deleteMany({
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
