import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { prisma, withDatabaseContext } from '@lingkod-hr/database';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { runCocExpiry } from './coc-expiry.job';

// Every sweep here runs on a session west of UTC, where a JS Date bound as a
// `date` lands on the day before.
vi.hoisted(() => {
  const url = new URL(process.env.DATABASE_URL ?? 'postgresql://unset');
  url.searchParams.set('options', '-c TimeZone=America/New_York');
  process.env.DATABASE_URL = url.toString();
});

const enabled = process.env.DATABASE_E2E === 'true';
const suffix = `${Date.now()}-coc-job`;
const agencyIds: string[] = [];
let admin: PrismaClient;

/**
 * An Agency whose one account holds `minutes` of COC valid until 2001-12-31.
 * The job sweeps the whole database, so these dates keep it off other test files' COC.
 */
async function seedAccount(label: string, minutes: number) {
  const agency = await admin.agency.create({
    data: {
      code: `JOB-${label}-${suffix}`,
      name: `Job ${label}`,
      agencyType: 'NGA',
      status: 'ACTIVE',
    },
  });
  agencyIds.push(agency.id);
  const user = await admin.user.create({
    data: {
      emailNormalized: `job-user-${label.toLowerCase()}-${suffix}@example.test`,
      displayName: `Job ${label}`,
      globalStatus: 'ACTIVE',
    },
  });
  const membership = await admin.agencyMembership.create({
    data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
  });
  const employee = await admin.employee.create({
    data: {
      agencyId: agency.id,
      employeeNumber: `JOB-${label}-${suffix}`,
      legalName: `Job ${label}`,
      birthDate: new Date('1990-01-01'),
      sex: 'FEMALE',
      civilStatus: 'SINGLE',
      contactEmail: `job-${label.toLowerCase()}-${suffix}@example.test`,
      serviceStatus: 'ACTIVE',
      createdByMembershipId: membership.id,
      updatedByMembershipId: membership.id,
    },
  });
  return withDatabaseContext({ agencyId: agency.id }, async (transaction) => {
    const account = await transaction.cocAccount.create({
      data: {
        agencyId: agency.id,
        employeeId: employee.id,
        status: 'ACTIVE',
        openedAt: new Date('2001-02-01'),
      },
    });
    await transaction.cocLedgerEntry.create({
      data: {
        agencyId: agency.id,
        cocAccountId: account.id,
        minutes,
        effectiveDate: new Date('2001-02-01'),
        validUntil: new Date('2001-12-31'),
        earnedMonth: new Date('2000-12-01'),
        sourceType: 'COC_EARNED_CERTIFICATE',
        sourceId: randomUUID(),
        sourcePostingKey: randomUUID(),
        ruleCode: 'JC2_2004_COC_EARNING',
      },
    });
    return { agencyId: agency.id, cocAccountId: account.id };
  });
}

const expiries = (cocAccountId: string) =>
  admin.cocLedgerEntry.findMany({ where: { cocAccountId, sourceType: 'COC_EXPIRY' } });

beforeAll(() => {
  if (enabled) {
    admin = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_E2E_ADMIN_URL ?? '' } },
    });
  }
});

afterAll(async () => {
  if (!enabled) return;
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
  await admin.$disconnect();
});

it.skipIf(!enabled)(
  'expires each Agency under its own context, once across concurrent runs',
  async () => {
    const first = await seedAccount('FIRST', 90);
    const second = await seedAccount('SECOND', 45.5);

    // Nothing is due on the last valid day.
    await runCocExpiry('2001-12-31');
    expect(await expiries(first.cocAccountId)).toEqual([]);

    // Two runs at once post one entry per account, and the job can run with no Agency Context.
    const runs = await Promise.all([runCocExpiry('2002-01-01'), runCocExpiry('2002-01-01')]);
    expect(runs.every((run) => run.failed === 0)).toBe(true);

    for (const [account, minutes] of [
      [first, '-90'],
      [second, '-45.5'],
    ] as const) {
      const [entry, ...rest] = await expiries(account.cocAccountId);
      expect(rest).toEqual([]);
      expect(entry?.agencyId).toBe(account.agencyId);
      expect(entry?.minutes.toString()).toBe(minutes);
      expect(entry?.postedByMembershipId).toBeNull();
      expect(entry?.ruleCode).toBe('JC2A_2005_COC_VALIDITY');
    }

    // A later run finds these accounts no longer due.
    await runCocExpiry('2002-01-09');
    expect(await expiries(first.cocAccountId)).toHaveLength(1);
  },
);

it.skipIf(!enabled)(
  'posts a first run days late, effective the day after Valid Until, west of UTC',
  async () => {
    expect(await prisma.$queryRaw`SELECT current_setting('TimeZone') AS zone`).toEqual([
      { zone: 'America/New_York' },
    ]);
    const late = await seedAccount('LATE', 30);

    const run = await runCocExpiry('2002-01-06');

    expect(run).toEqual({ posted: 1, failed: 0 });
    const [entry, ...rest] = await expiries(late.cocAccountId);
    expect(rest).toEqual([]);
    expect(entry?.minutes.toString()).toBe('-30');
    expect(entry?.effectiveDate.toISOString().slice(0, 10)).toBe('2002-01-01');
    expect(entry?.sourcePostingKey).toBe('2001-12-31');
  },
);
