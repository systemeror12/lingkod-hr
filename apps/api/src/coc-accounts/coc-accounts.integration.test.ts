import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { withDatabaseContext } from '@lingkod-hr/database';
import { expect, it } from 'vitest';
import { createAdminClient } from '../attendance-test-fixtures';
import { CocAccountsService } from './coc-accounts.service';
import {
  CocServiceError,
  type CocEarnedCertificate,
  type CocEarnedCertificateLine,
} from './coc-accounts.types';

const enabled = process.env.DATABASE_E2E === 'true';
const coc = new CocAccountsService();

async function createAgency(admin: PrismaClient, suffix: string, label: string) {
  const agency = await admin.agency.create({
    data: {
      code: `COC-${label}-${suffix}`,
      name: `COC ${label}`,
      agencyType: 'NGA',
      status: 'ACTIVE',
    },
  });
  const user = await admin.user.create({
    data: {
      emailNormalized: `coc-${label.toLowerCase()}-${suffix}@example.test`,
      displayName: `COC ${label} Approver`,
      globalStatus: 'ACTIVE',
    },
  });
  const membership = await admin.agencyMembership.create({
    data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
  });
  let sequence = 0;
  const employee = () => {
    sequence += 1;
    return admin.employee.create({
      data: {
        agencyId: agency.id,
        employeeNumber: `COC-${label}-${sequence}-${suffix}`,
        legalName: `COC ${label} Employee ${sequence}`,
        birthDate: new Date('1990-01-01'),
        sex: 'FEMALE',
        civilStatus: 'SINGLE',
        contactEmail: `coc-${label.toLowerCase()}-${sequence}-${suffix}@example.test`,
        serviceStatus: 'ACTIVE',
        createdByMembershipId: membership.id,
        updatedByMembershipId: membership.id,
      },
    });
  };
  return { agencyId: agency.id, membershipId: membership.id, employee };
}

type Agency = Awaited<ReturnType<typeof createAgency>>;

function award(agency: Agency, input: CocEarnedCertificate) {
  return withDatabaseContext(
    { agencyId: agency.agencyId, membershipId: agency.membershipId },
    (transaction) => coc.awardEarnedCocInTransaction(transaction, agency.agencyId, input),
  );
}

function balance(agency: Agency, employeeId: string, asOf: string) {
  return withDatabaseContext(
    { agencyId: agency.agencyId, membershipId: agency.membershipId },
    (transaction) => coc.readBalanceInTransaction(transaction, agency.agencyId, employeeId, asOf),
  );
}

const line = (
  workDate: string,
  certifiedMinutes: number,
  dayClassification: CocEarnedCertificateLine['dayClassification'] = 'WORKDAY',
): CocEarnedCertificateLine => ({
  certificateLineId: randomUUID(),
  workDate,
  certifiedMinutes,
  dayClassification,
});

function certificate(
  agency: Agency,
  employeeId: string,
  earnedMonth: string,
  approvalDate: string,
  lines: CocEarnedCertificateLine[],
): CocEarnedCertificate {
  return {
    certificateId: randomUUID(),
    employeeId,
    earnedMonth,
    approvalDate,
    approvedByMembershipId: agency.membershipId,
    lines,
  };
}

async function refusal(promise: Promise<unknown>): Promise<CocServiceError> {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof CocServiceError) return error;
    throw error;
  }
  throw new Error('Expected the award to be refused.');
}

async function cleanup(admin: PrismaClient, agencyIds: string[], suffix: string) {
  await admin.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    const where = { agencyId: { in: agencyIds } };
    await transaction.cocLedgerEntry.deleteMany({ where });
    await transaction.cocAccount.deleteMany({ where });
    await transaction.employee.deleteMany({ where });
    await transaction.agencyMembership.deleteMany({ where });
    await transaction.agency.deleteMany({ where: { id: { in: agencyIds } } });
    await transaction.user.deleteMany({ where: { emailNormalized: { contains: suffix } } });
  });
}

it.skipIf(!enabled)(
  'awards earned COC into an immutable, agency-isolated ledger and replays a retry',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-coc-award`;
    const home = await createAgency(admin, suffix, 'HOME');
    const foreign = await createAgency(admin, suffix, 'FOREIGN');
    try {
      const employee = await home.employee();

      // First award opens the account; a rest day earns 1.5 and stays exact.
      const march = certificate(home, employee.id, '2026-03-01', '2026-04-06', [
        line('2026-03-14', 61, 'REST'),
        line('2026-03-02', 120),
      ]);
      const first = await award(home, march);
      expect(first).toMatchObject({ replayed: false, validUntil: '2027-12-31' });
      expect(first.lines.map((entry) => [entry.workDate, entry.creditedMinutes])).toEqual([
        ['2026-03-02', '120.0'],
        ['2026-03-14', '91.5'],
      ]);
      const account = await admin.cocAccount.findFirstOrThrow({
        where: { agencyId: home.agencyId, employeeId: employee.id },
      });
      expect(account).toMatchObject({ status: 'ACTIVE', id: first.cocAccountId });
      expect(account.openedAt.toISOString().slice(0, 10)).toBe('2026-04-06');

      // A retry returns the existing entries and writes nothing.
      const retry = await award(home, march);
      expect(retry).toMatchObject({ replayed: true, cocAccountId: first.cocAccountId });
      expect(retry.lines).toEqual(first.lines);
      expect(await admin.cocLedgerEntry.count({ where: { agencyId: home.agencyId } })).toBe(2);

      // The monthly cap counts the month's earlier certificate.
      const secondMarch = await award(
        home,
        certificate(home, employee.id, '2026-03-01', '2026-04-07', [line('2026-03-20', 2_400)]),
      );
      expect(secondMarch.lines[0]).toMatchObject({
        creditedMinutes: '2188.5',
        excessMinutes: '211.5',
      });

      // A later year's certificate groups under its own Valid Until; the cutoff excludes it.
      await award(
        home,
        certificate(home, employee.id, '2027-01-01', '2027-02-01', [line('2027-01-05', 30)]),
      );
      expect(await balance(home, employee.id, '2026-12-31')).toEqual({
        cocAccountId: first.cocAccountId,
        asOf: '2026-12-31',
        byValidUntil: [{ validUntil: '2027-12-31', minutes: '2400.0' }],
        totalMinutes: '2400.0',
      });
      expect((await balance(home, employee.id, '2027-02-01')).byValidUntil).toEqual([
        { validUntil: '2027-12-31', minutes: '2400.0' },
        { validUntil: '2028-12-31', minutes: '30.0' },
      ]);

      // Refusals: a passed Valid Until and a work suspension.
      expect(
        await refusal(
          award(
            home,
            certificate(home, employee.id, '2024-12-01', '2026-01-02', [line('2024-12-03', 60)]),
          ),
        ),
      ).toMatchObject({ code: 'COC_VALIDITY_PASSED' });
      const suspended = line('2026-05-04', 60, 'PARTIAL_DAY_WORK_SUSPENSION');
      expect(
        await refusal(
          award(
            home,
            certificate(home, employee.id, '2026-05-01', '2026-06-01', [
              line('2026-05-05', 60),
              suspended,
            ]),
          ),
        ),
      ).toMatchObject({
        code: 'COC_PARTIAL_DAY_WORK_SUSPENSION',
        lineIds: [suspended.certificateLineId],
      });

      // Another Agency can neither award to nor read this Employee's COC.
      expect(
        await refusal(
          award(
            foreign,
            certificate(foreign, employee.id, '2026-03-01', '2026-04-06', [line('2026-03-03', 60)]),
          ),
        ),
      ).toMatchObject({ code: 'COC_EMPLOYEE_NOT_FOUND' });
      expect(
        await withDatabaseContext({ agencyId: foreign.agencyId }, (transaction) =>
          transaction.cocLedgerEntry.count({ where: { cocAccountId: first.cocAccountId } }),
        ),
      ).toBe(0);
      expect(
        await admin.cocAccount.count({
          where: { agencyId: foreign.agencyId },
        }),
      ).toBe(0);

      // Entries can't be updated or deleted, by the application or the owner.
      const entryId = first.lines[0]!.ledgerEntryId!;
      await expect(
        withDatabaseContext({ agencyId: home.agencyId }, (transaction) =>
          transaction.cocLedgerEntry.update({ where: { id: entryId }, data: { reason: 'edit' } }),
        ),
      ).rejects.toThrow();
      await expect(
        withDatabaseContext({ agencyId: home.agencyId }, (transaction) =>
          transaction.cocLedgerEntry.delete({ where: { id: entryId } }),
        ),
      ).rejects.toThrow();
      await expect(
        admin.cocLedgerEntry.update({ where: { id: entryId }, data: { reason: 'edit' } }),
      ).rejects.toThrow(/immutable/);
      await expect(admin.cocLedgerEntry.delete({ where: { id: entryId } })).rejects.toThrow(
        /cannot be deleted/,
      );
    } finally {
      await cleanup(admin, [home.agencyId, foreign.agencyId], suffix);
      await admin.$disconnect();
    }
  },
  60_000,
);

it.skipIf(!enabled)(
  'serializes concurrent awards on one account under both caps',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-coc-concurrent`;
    const home = await createAgency(admin, suffix, 'CONC');
    try {
      const employee = await home.employee();

      // Two first awards for one month race to open the account and spend the cap.
      const results = await Promise.all([
        award(
          home,
          certificate(home, employee.id, '2026-03-01', '2026-04-06', [line('2026-03-02', 2_000)]),
        ),
        award(
          home,
          certificate(home, employee.id, '2026-03-01', '2026-04-06', [line('2026-03-03', 2_000)]),
        ),
      ]);
      expect(new Set(results.map((result) => result.cocAccountId)).size).toBe(1);
      expect(results.map((result) => result.lines[0]!.creditedMinutes).sort()).toEqual([
        '2000.0',
        '400.0',
      ]);
      expect(await admin.cocAccount.count({ where: { agencyId: home.agencyId } })).toBe(1);

      // The same certificate awarded twice at once posts its entries once.
      const april = certificate(home, employee.id, '2026-04-01', '2026-05-04', [
        line('2026-04-06', 600),
      ]);
      const [left, right] = await Promise.all([award(home, april), award(home, april)]);
      expect([left.replayed, right.replayed].sort()).toEqual([false, true]);
      expect(left.lines).toEqual(right.lines);
      expect(
        await admin.cocLedgerEntry.count({
          where: { agencyId: home.agencyId, sourceId: april.certificateId },
        }),
      ).toBe(1);

      // Two months at once cannot push the balance past 7,200 minutes.
      const months = ['2026-05', '2026-06', '2026-07', '2026-08'].map((month) =>
        award(
          home,
          certificate(home, employee.id, `${month}-01`, '2026-09-01', [line(`${month}-04`, 2_400)]),
        ),
      );
      await Promise.all(months);
      expect((await balance(home, employee.id, '2026-09-01')).totalMinutes).toBe('7200.0');
    } finally {
      await cleanup(admin, [home.agencyId], suffix);
      await admin.$disconnect();
    }
  },
  60_000,
);

it.skipIf(!enabled)(
  'replays a certificate only for the same Employee, earned month, and lines',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-coc-replay`;
    const home = await createAgency(admin, suffix, 'REPLAY');
    try {
      const employee = await home.employee();
      const other = await home.employee();
      const first = line('2026-03-02', 120);
      const second = line('2026-03-03', 60);
      const march = certificate(home, employee.id, '2026-03-01', '2026-04-06', [first, second]);
      const awarded = await award(home, march);

      expect(await refusal(award(home, { ...march, employeeId: other.id }))).toMatchObject({
        statusCode: 409,
        code: 'COC_CERTIFICATE_OF_ANOTHER_EMPLOYEE',
      });
      for (const changed of [
        // A credited line dropped.
        { ...march, lines: [first] },
        // A line's COC lowered below what it was credited.
        { ...march, lines: [{ ...first, certifiedMinutes: 100 }, second] },
        // A line added ahead of credited lines.
        { ...march, lines: [line('2026-03-01', 30), first, second] },
        // Another earned month.
        {
          ...march,
          earnedMonth: '2026-04-01',
          lines: [first, second].map((entry) => ({
            ...entry,
            workDate: entry.workDate.replace('2026-03', '2026-04'),
          })),
        },
      ]) {
        expect(await refusal(award(home, changed))).toMatchObject({
          statusCode: 409,
          code: 'COC_AWARD_REPLAY_MISMATCH',
        });
      }
      expect(await award(home, march)).toEqual({ ...awarded, replayed: true });

      // Fill the month, then a certificate the cap credits nothing leaves no
      // ledger trace, so a repeat recomputes; #538's status transition stops it.
      await award(
        home,
        certificate(home, employee.id, '2026-03-01', '2026-04-07', [line('2026-03-04', 2_220)]),
      );
      const zero = certificate(home, employee.id, '2026-03-01', '2026-04-08', [
        line('2026-03-05', 60),
      ]);
      const once = await award(home, zero);
      const again = await award(home, zero);
      for (const result of [once, again]) {
        expect(result).toMatchObject({ replayed: false });
        expect(result.lines[0]).toMatchObject({ creditedMinutes: '0.0', ledgerEntryId: null });
      }

      // A reversal may only negate a negative entry, so a certificate entry can't be reversed.
      const credited = await admin.cocLedgerEntry.findFirstOrThrow({
        where: { id: awarded.lines[0]!.ledgerEntryId! },
      });
      await expect(
        admin.cocLedgerEntry.create({
          data: {
            agencyId: home.agencyId,
            cocAccountId: credited.cocAccountId,
            minutes: credited.minutes.negated(),
            effectiveDate: credited.effectiveDate,
            validUntil: credited.validUntil,
            sourceType: 'COC_REVERSAL',
            sourceId: randomUUID(),
            sourcePostingKey: credited.id,
            ruleCode: 'TEST',
            reason: 'Reverse a certificate entry.',
            reversesEntryId: credited.id,
          },
        }),
      ).rejects.toThrow(/may only negate a negative/);
    } finally {
      await cleanup(admin, [home.agencyId], suffix);
      await admin.$disconnect();
    }
  },
  60_000,
);

it.skipIf(!enabled)(
  'caps against unexpired credit, in approval order, within one employment period',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-coc-periods`;
    const home = await createAgency(admin, suffix, 'PERIOD');
    try {
      const employee = await home.employee();
      // 6,900 minutes valid until 2025-12-31.
      for (const [month, workDate, minutes] of [
        ['2024-10-01', '2024-10-07', 2_400],
        ['2024-11-01', '2024-11-04', 2_400],
        ['2024-12-01', '2024-12-02', 2_100],
      ] as const) {
        await award(
          home,
          certificate(home, employee.id, month, '2025-01-05', [line(workDate, minutes)]),
        );
      }

      // The balance cap holds the first December 2025 certificate back.
      const heldBack = await award(
        home,
        certificate(home, employee.id, '2025-12-01', '2025-12-31', [line('2025-12-01', 1_000)]),
      );
      expect(heldBack.lines[0]).toMatchObject({ creditedMinutes: '300.0', excessMinutes: '700.0' });

      // Once 2025-12-31 passes, that COC neither counts in the balance nor
      // against the cap, though no expiry entry exists yet.
      expect((await balance(home, employee.id, '2026-01-02')).byValidUntil).toEqual([
        { validUntil: '2026-12-31', minutes: '300.0' },
      ]);
      // The monthly cap counts the 300 minutes credited, not the 1,000 earned.
      const second = await award(
        home,
        certificate(home, employee.id, '2025-12-01', '2026-01-02', [line('2025-12-02', 2_400)]),
      );
      expect(second.lines[0]).toMatchObject({ creditedMinutes: '2100.0', excessMinutes: '300.0' });

      // An approval dated before the account's latest certificate is refused.
      expect(
        await refusal(
          award(
            home,
            certificate(home, employee.id, '2025-12-01', '2026-01-01', [line('2025-12-03', 60)]),
          ),
        ),
      ).toMatchObject({ statusCode: 409, code: 'COC_APPROVAL_BEFORE_LATEST_CERTIFICATE' });

      // Service inside a closed account's period is refused; later service opens a new account.
      const leaver = await home.employee();
      const closedAccount = await award(
        home,
        certificate(home, leaver.id, '2026-03-01', '2026-04-06', [line('2026-03-02', 60)]),
      );
      await admin.cocAccount.update({
        where: { id: closedAccount.cocAccountId },
        data: { status: 'CLOSED', closedAt: new Date('2026-04-30') },
      });
      expect(
        await refusal(
          award(
            home,
            certificate(home, leaver.id, '2026-04-01', '2026-05-04', [line('2026-04-10', 60)]),
          ),
        ),
      ).toMatchObject({ statusCode: 409, code: 'COC_SERVICE_IN_CLOSED_ACCOUNT' });
      const reemployed = await award(
        home,
        certificate(home, leaver.id, '2026-05-01', '2026-06-01', [line('2026-05-04', 60)]),
      );
      expect(reemployed.cocAccountId).not.toBe(closedAccount.cocAccountId);
      expect(reemployed.lines[0]).toMatchObject({ creditedMinutes: '60.0' });
    } finally {
      await cleanup(admin, [home.agencyId], suffix);
      await admin.$disconnect();
    }
  },
  60_000,
);
