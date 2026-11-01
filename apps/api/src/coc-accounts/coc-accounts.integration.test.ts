import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { withDatabaseContext } from '@lingkod-hr/database';
import { expect, it } from 'vitest';
import { createAdminClient } from '../attendance-test-fixtures';
import { CocAccountsService } from './coc-accounts.service';
import {
  COC_EXPIRY_RULE_CODE,
  COC_EXPIRY_SOURCE_TYPE,
  CocServiceError,
  type CocEarnedCertificate,
  type CocEarnedCertificateLine,
  type CocEarnedCertificateLineCredit,
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

/** An award expected to be the certificate's first, with every line reported. */
async function awardNew(agency: Agency, input: CocEarnedCertificate) {
  const result = await award(agency, input);
  if (result.replayed) throw new Error('Expected a first award.');
  return result;
}

/** The entries a replay returns for a first award's credited lines. */
const storedEntries = (lines: CocEarnedCertificateLineCredit[]) =>
  lines
    .filter((entry) => entry.ledgerEntryId)
    .map((entry) => ({
      certificateLineId: entry.certificateLineId,
      creditedMinutes: entry.creditedMinutes,
      ledgerEntryId: entry.ledgerEntryId,
    }))
    .sort((left, right) => left.certificateLineId.localeCompare(right.certificateLineId));

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
    await transaction.auditEvent.deleteMany({ where });
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
      const first = await awardNew(home, march);
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
      expect(retry).toEqual({
        replayed: true,
        cocAccountId: first.cocAccountId,
        validUntil: '2027-12-31',
        entries: storedEntries(first.lines),
      });
      expect(await admin.cocLedgerEntry.count({ where: { agencyId: home.agencyId } })).toBe(2);

      // The monthly cap counts the month's earlier certificate.
      const secondMarch = await awardNew(
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

      // Refusals: a passed Valid Until and work suspensions, each line with its own reason.
      expect(
        await refusal(
          award(
            home,
            certificate(home, employee.id, '2024-12-01', '2026-01-02', [line('2024-12-03', 60)]),
          ),
        ),
      ).toMatchObject({ code: 'COC_VALIDITY_PASSED' });
      const wholeDay = line('2026-05-04', 60, 'WORK_SUSPENSION');
      const partialDay = line('2026-05-06', 60, 'PARTIAL_DAY_WORK_SUSPENSION');
      expect(
        await refusal(
          award(
            home,
            certificate(home, employee.id, '2026-05-01', '2026-06-01', [
              line('2026-05-05', 60),
              wholeDay,
              partialDay,
            ]),
          ),
        ),
      ).toMatchObject({
        code: 'COC_WHOLE_DAY_WORK_SUSPENSION',
        refusals: [
          { certificateLineId: wholeDay.certificateLineId, code: 'COC_WHOLE_DAY_WORK_SUSPENSION' },
          {
            certificateLineId: partialDay.certificateLineId,
            code: 'COC_PARTIAL_DAY_WORK_SUSPENSION',
          },
        ],
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
        awardNew(
          home,
          certificate(home, employee.id, '2026-03-01', '2026-04-06', [line('2026-03-02', 2_000)]),
        ),
        awardNew(
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
      const fresh = [left, right].find((result) => !result.replayed);
      const replayed = [left, right].find((result) => result.replayed);
      expect(replayed).toEqual({
        replayed: true,
        cocAccountId: fresh?.cocAccountId,
        validUntil: fresh?.validUntil,
        entries: storedEntries(fresh && !fresh.replayed ? fresh.lines : []),
      });
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
  "replays a certificate's stored entries only for its Employee and lines",
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
      const awarded = await awardNew(home, march);

      expect(await refusal(award(home, { ...march, employeeId: other.id }))).toMatchObject({
        statusCode: 409,
        code: 'COC_CERTIFICATE_OF_ANOTHER_EMPLOYEE',
      });
      // A credited line dropped.
      expect(await refusal(award(home, { ...march, lines: [first] }))).toMatchObject({
        statusCode: 409,
        code: 'COC_AWARD_REPLAY_MISMATCH',
      });
      expect(await award(home, march)).toEqual({
        replayed: true,
        cocAccountId: awarded.cocAccountId,
        validUntil: awarded.validUntil,
        entries: storedEntries(awarded.lines),
      });
      expect(await admin.cocLedgerEntry.count({ where: { sourceId: march.certificateId } })).toBe(
        2,
      );

      // Fill the month, then a certificate the cap credits nothing leaves no
      // ledger trace, so a repeat recomputes; #538's status transition stops it.
      await award(
        home,
        certificate(home, employee.id, '2026-03-01', '2026-04-07', [line('2026-03-04', 2_220)]),
      );
      const zero = certificate(home, employee.id, '2026-03-01', '2026-04-08', [
        line('2026-03-05', 60),
      ]);
      const once = await awardNew(home, zero);
      const again = await awardNew(home, zero);
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
      const heldBack = await awardNew(
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
      const second = await awardNew(
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
      const reemployed = await awardNew(
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

it.skipIf(!enabled)(
  'refuses service in an account closed while the award opens one, and keeps no new account',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-coc-close-race`;
    const home = await createAgency(admin, suffix, 'RACE');
    try {
      const leaver = await home.employee();
      const first = await awardNew(
        home,
        certificate(home, leaver.id, '2026-03-01', '2026-04-06', [line('2026-03-02', 60)]),
      );

      // Close the account in an open transaction, so the award reads it as
      // ACTIVE and then waits on the close at the account insert.
      let notifyClosed = () => {};
      let commitClose = () => {};
      const closed = new Promise<void>((resolve) => {
        notifyClosed = resolve;
      });
      const committed = new Promise<void>((resolve) => {
        commitClose = resolve;
      });
      const closing = admin.$transaction(
        async (transaction) => {
          await transaction.cocAccount.update({
            where: { id: first.cocAccountId },
            data: { status: 'CLOSED', closedAt: new Date('2026-04-30') },
          });
          notifyClosed();
          await committed;
        },
        { timeout: 10_000 },
      );
      await closed;
      const racing = refusal(
        award(
          home,
          certificate(home, leaver.id, '2026-04-01', '2026-05-04', [line('2026-04-30', 60)]),
        ),
      );
      try {
        await expect
          .poll(
            async () => {
              const waiting = await admin.$queryRaw<
                { count: number }[]
              >`SELECT COUNT(*)::integer AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%coc_accounts%' AND cardinality(pg_blocking_pids(pid)) > 0`;
              return waiting[0]!.count;
            },
            { timeout: 2_000, interval: 20 },
          )
          .toBe(1);
      } finally {
        commitClose();
      }
      await closing;

      expect(await racing).toMatchObject({
        statusCode: 409,
        code: 'COC_SERVICE_IN_CLOSED_ACCOUNT',
        message: "The Employee's COC Account closed on 2026-04-30, on or after this service.",
      });
      expect(
        await admin.cocAccount.count({
          where: { agencyId: home.agencyId, employeeId: leaver.id, status: 'ACTIVE' },
        }),
      ).toBe(0);
    } finally {
      await cleanup(admin, [home.agencyId], suffix);
      await admin.$disconnect();
    }
  },
  60_000,
);

it.skipIf(!enabled)(
  'expires the remainder once, the day after Valid Until, counting a use on the last valid day',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-coc-expiry`;
    const home = await createAgency(admin, suffix, 'HOME');
    const foreign = await createAgency(admin, suffix, 'FOREIGN');
    const inHome = <T>(work: (transaction: Prisma.TransactionClient) => Promise<T>) =>
      withDatabaseContext({ agencyId: home.agencyId }, work);
    const dueAsOf = (asOf: string) =>
      inHome(
        (transaction) => transaction.$queryRaw<{ coc_account_id: string }[]>`
          SELECT coc_account_id FROM coc_expiries_due(CAST(${asOf} AS date))
        `,
      );
    try {
      const employee = await home.employee();
      const awarded = await awardNew(
        home,
        certificate(home, employee.id, '2024-12-01', '2025-02-03', [line('2024-12-02', 200)]),
      );
      const cocAccountId = awarded.cocAccountId;
      const validUntil = '2025-12-31';
      const expire = (asOf: string) =>
        inHome((transaction) =>
          coc.expireCocInTransaction(transaction, home.agencyId, {
            cocAccountId,
            validUntil,
            asOf,
          }),
        );
      const isDue = async (asOf: string) =>
        (await dueAsOf(asOf)).some((row) => row.coc_account_id === cocAccountId);
      const expiries = () =>
        admin.cocLedgerEntry.findMany({
          where: { cocAccountId, sourceType: COC_EXPIRY_SOURCE_TYPE },
        });

      // A CTO on the last valid day reduces what expires.
      await inHome((transaction) =>
        transaction.cocLedgerEntry.create({
          data: {
            agencyId: home.agencyId,
            cocAccountId,
            minutes: -80,
            effectiveDate: new Date(validUntil),
            validUntil: new Date(validUntil),
            sourceType: 'CTO_REQUEST',
            sourceId: randomUUID(),
            sourcePostingKey: `${validUntil}:${validUntil}`,
            ruleCode: 'JC2_2004_CTO',
          },
        }),
      );

      // The day before and on Valid Until, nothing is due and nothing posts.
      for (const asOf of ['2025-12-30', validUntil]) {
        expect(await isDue(asOf)).toBe(false);
        expect(await expire(asOf)).toBeNull();
      }
      expect(await expiries()).toEqual([]);

      // Another Agency's context cannot reach the account.
      await expect(
        withDatabaseContext({ agencyId: foreign.agencyId }, (transaction) =>
          coc.expireCocInTransaction(transaction, home.agencyId, {
            cocAccountId,
            validUntil,
            asOf: '2026-01-01',
          }),
        ),
      ).rejects.toThrow('does not belong to the Agency in context');

      // The day after, the remainder posts, effective that day, as System.
      expect(await isDue('2026-01-01')).toBe(true);
      const entryId = await expire('2026-01-01');
      const [entry, ...others] = await expiries();
      expect(others).toEqual([]);
      expect(entry).toMatchObject({
        id: entryId,
        sourceId: cocAccountId,
        sourcePostingKey: validUntil,
        ruleCode: COC_EXPIRY_RULE_CODE,
        postedByMembershipId: null,
        reversesEntryId: null,
      });
      expect(entry?.minutes.toString()).toBe('-120');
      expect(entry?.effectiveDate.toISOString().slice(0, 10)).toBe('2026-01-01');
      expect(
        await admin.auditEvent.findMany({
          where: { agencyId: home.agencyId, action: 'COC_EXPIRED' },
          select: { actorType: true, actorMembershipId: true, entityId: true },
        }),
      ).toEqual([{ actorType: 'SYSTEM', actorMembershipId: null, entityId: entryId }]);

      // A retry, even days late, finds nothing due and posts nothing.
      expect(await isDue('2026-01-09')).toBe(false);
      expect(await expire('2026-01-09')).toBeNull();
      expect(await expiries()).toHaveLength(1);

      // Every entry for the Valid Until now nets to zero.
      const sum = await admin.cocLedgerEntry.aggregate({
        where: { cocAccountId, validUntil: new Date(validUntil) },
        _sum: { minutes: true },
      });
      expect(sum._sum.minutes?.toString()).toBe('0');

      // A first run days late posts the same entry, effective the day after Valid Until.
      const lateEmployee = await home.employee();
      const lateAward = await awardNew(
        home,
        certificate(home, lateEmployee.id, '2024-12-01', '2025-02-03', [line('2024-12-02', 50)]),
      );
      const lateEntryId = await inHome((transaction) =>
        coc.expireCocInTransaction(transaction, home.agencyId, {
          cocAccountId: lateAward.cocAccountId,
          validUntil,
          asOf: '2026-01-06',
        }),
      );
      const lateEntry = await admin.cocLedgerEntry.findUniqueOrThrow({
        where: { id: lateEntryId ?? '' },
      });
      expect(lateEntry.minutes.toString()).toBe('-50');
      expect(lateEntry.effectiveDate.toISOString().slice(0, 10)).toBe('2026-01-01');
      expect(lateEntry.sourcePostingKey).toBe(validUntil);
    } finally {
      await cleanup(admin, [home.agencyId, foreign.agencyId], suffix);
      await admin.$disconnect();
    }
  },
  60_000,
);

it.skipIf(!enabled)(
  'keeps COC still within its Valid Until out of the due sweep, whatever date the caller names',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-coc-due-policy`;
    const home = await createAgency(admin, suffix, 'HOME');
    const foreign = await createAgency(admin, suffix, 'FOREIGN');
    try {
      const manilaYear = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Manila',
        year: 'numeric',
      }).format(new Date());
      // Earned this year, so it stays valid through the end of next year.
      const valid = await awardNew(
        home,
        certificate(
          home,
          (await home.employee()).id,
          `${manilaYear}-01-01`,
          `${manilaYear}-02-02`,
          [line(`${manilaYear}-01-05`, 60)],
        ),
      );
      const passed = await awardNew(
        home,
        certificate(home, (await home.employee()).id, '2024-12-01', '2025-02-03', [
          line('2024-12-02', 60),
        ]),
      );

      // From another Agency: the isolation policy still shows a caller its own rows.
      const due = await withDatabaseContext(
        { agencyId: foreign.agencyId },
        (transaction) => transaction.$queryRaw<{ coc_account_id: string }[]>`
          SELECT coc_account_id FROM coc_expiries_due(CAST('2999-01-01' AS date))
        `,
      );

      const accounts = due.map((row) => row.coc_account_id);
      expect(accounts).toContain(passed.cocAccountId);
      expect(accounts).not.toContain(valid.cocAccountId);
    } finally {
      await cleanup(admin, [home.agencyId, foreign.agencyId], suffix);
      await admin.$disconnect();
    }
  },
  60_000,
);
