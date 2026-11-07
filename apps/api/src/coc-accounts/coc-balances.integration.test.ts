import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { expect, it } from 'vitest';
import { createAdminClient } from '../attendance-test-fixtures';
import { manilaToday } from '../employee-scope';
import {
  addMember,
  cleanup,
  context,
  createAgency,
  enabled,
  errorOf,
  type AgencyFixture,
} from '../overtime-authorities/overtime-authority-test-fixtures';
import { CocAccountsService } from './coc-accounts.service';
import { CocBalancesController } from './coc-balances.controller';
import { CocBalancesService } from './coc-balances.service';

const READ = 'overtime.coc.read';
const coc = new CocAccountsService();
const controller = new CocBalancesController(new CocBalancesService(coc));

/** hris-controls §6.9; the Leave Admin's `A` goes to both administrator roles. */
const MATRIX = {
  agency_administrator: 'AGENCY',
  appointing_authority: 'AGENCY',
  employee: 'OWN',
  hrmo_administrator: 'AGENCY',
  internal_auditor: 'AGENCY',
  payroll_preparer: 'AGENCY',
  supervisor: 'DIRECT_REPORTS',
};

/** What the migration grants, so each case runs on the real grant rather than a copy. */
async function migratedGrants(admin: PrismaClient) {
  const rows = await admin.rolePermission.findMany({
    where: { permission: { code: READ }, role: { agencyId: null } },
    select: { scopePolicy: true, role: { select: { code: true } } },
  });
  return Object.fromEntries(rows.map((row) => [row.role.code, row.scopePolicy]));
}

async function member(
  admin: PrismaClient,
  home: AgencyFixture,
  suffix: string,
  roleCode: string,
  employeeId?: string,
): Promise<RequestContext> {
  const grants = await migratedGrants(admin);
  const actor = await addMember(
    admin,
    home,
    suffix,
    `${roleCode}-${randomUUID().slice(0, 8)}`,
    roleCode,
    [
      {
        code: READ,
        scopePolicy: grants[roleCode] as RequestContext['permissions'][number]['scopePolicy'],
      },
    ],
  );
  if (employeeId) {
    await withDatabaseContext(
      {
        agencyId: home.agency.id,
        userId: home.user.id,
        membershipId: home.membership.id,
        capabilities: ['employee-membership-link'],
      },
      (transaction) =>
        transaction.agencyMembership.update({
          where: { agencyId_id: { agencyId: home.agency.id, id: actor.membershipId } },
          data: { employeeId },
        }),
    );
  }
  return actor;
}

/** Award `minutes` of COC earned in `earnedMonth`, approved today. */
function award(home: AgencyFixture, employeeId: string, earnedMonth: string, minutes: number) {
  return withDatabaseContext(
    { agencyId: home.agency.id, membershipId: home.membership.id },
    (transaction) =>
      coc.awardEarnedCocInTransaction(transaction, home.agency.id, {
        certificateId: randomUUID(),
        employeeId,
        earnedMonth: `${earnedMonth}-01`,
        approvalDate: manilaToday(),
        approvedByMembershipId: home.membership.id,
        lines: [
          {
            certificateLineId: randomUUID(),
            workDate: `${earnedMonth}-10`,
            certifiedMinutes: minutes,
            dayClassification: 'WORKDAY',
          },
        ],
      }),
  );
}

async function withAgencies(
  label: string,
  run: (fixture: {
    admin: PrismaClient;
    suffix: string;
    home: AgencyFixture;
    foreign: AgencyFixture;
  }) => Promise<void>,
) {
  const admin = await createAdminClient();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-cocbal-${label}`;
  const home = await createAgency(admin, suffix, `${label}H`);
  const foreign = await createAgency(admin, suffix, `${label}F`);
  try {
    await run({ admin, suffix, home, foreign });
  } finally {
    await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      const where = { agencyId: { in: [home.agency.id, foreign.agency.id] } };
      await transaction.cocLedgerEntry.deleteMany({ where });
      await transaction.cocAccount.deleteMany({ where });
    });
    await cleanup(admin, [home.agency.id, foreign.agency.id], suffix);
    await admin.$disconnect();
  }
}

const YEAR = Number(manilaToday().slice(0, 4));

it.skipIf(!enabled)('grants overtime.coc.read exactly as the §6.9 matrix states', async () => {
  const admin = await createAdminClient();
  try {
    expect(await migratedGrants(admin)).toEqual(MATRIX);
  } finally {
    await admin.$disconnect();
  }
});

it.skipIf(!enabled)(
  'derives the balance by Valid Until as of today, for every Agency-wide holder',
  () =>
    withAgencies('agency', async ({ admin, suffix, home }) => {
      const earlier = await award(home, home.member.id, `${YEAR - 1}-01`, 60);
      const later = await award(home, home.member.id, `${YEAR}-01`, 90);
      for (const roleCode of [
        'agency_administrator',
        'hrmo_administrator',
        'appointing_authority',
        'payroll_preparer',
        'internal_auditor',
      ]) {
        const actor = await member(admin, home, suffix, roleCode);
        expect(await controller.read(home.agency.id, home.member.id, actor)).toEqual({
          cocAccountId: earlier.cocAccountId,
          asOf: manilaToday(),
          byValidUntil: [
            { validUntil: earlier.validUntil, minutes: '60.0' },
            { validUntil: later.validUntil, minutes: '90.0' },
          ],
          totalMinutes: '150.0',
        });
      }
    }),
  120_000,
);

it.skipIf(!enabled)('limits a Supervisor to their direct reports', () =>
  withAgencies('supervisor', async ({ admin, suffix, home }) => {
    await award(home, home.member.id, `${YEAR}-01`, 60);
    const supervisor = await member(admin, home, suffix, 'supervisor', home.chief.id);
    expect((await controller.read(home.agency.id, home.member.id, supervisor)).totalMinutes).toBe(
      '60.0',
    );
    for (const employeeId of [home.outsider.id, home.chief.id]) {
      expect(await errorOf(controller.read(home.agency.id, employeeId, supervisor))).toMatchObject({
        status: 403,
        body: { error: { code: 'COC_BALANCE_FORBIDDEN' } },
      });
    }
  }),
);

it.skipIf(!enabled)('lets an Employee read only their own balance', () =>
  withAgencies('own', async ({ admin, suffix, home }) => {
    await award(home, home.member.id, `${YEAR}-01`, 60);
    const own = await member(admin, home, suffix, 'employee', home.member.id);
    expect((await controller.read(home.agency.id, home.member.id, own)).totalMinutes).toBe('60.0');
    expect(await errorOf(controller.read(home.agency.id, home.chief.id, own))).toMatchObject({
      status: 403,
      body: { error: { code: 'COC_BALANCE_FORBIDDEN' } },
    });
    // A Membership with no linked Employee has no own record to read.
    const unlinked = await member(admin, home, suffix, 'employee');
    expect(await errorOf(controller.read(home.agency.id, home.member.id, unlinked))).toMatchObject({
      status: 403,
      body: { error: { code: 'COC_BALANCE_FORBIDDEN' } },
    });
  }),
);

it.skipIf(!enabled)('refuses a caller without the grant and an Employee beyond reach', () =>
  withAgencies('refuse', async ({ admin, suffix, home, foreign }) => {
    const noGrant = context(home.agency.id, home.user.id, home.membership.id, []);
    expect(await errorOf(controller.read(home.agency.id, home.member.id, noGrant))).toMatchObject({
      status: 403,
      body: { error: { code: 'COC_BALANCE_FORBIDDEN' } },
    });

    await award(foreign, foreign.member.id, `${YEAR}-01`, 60);
    const hr = await member(admin, home, suffix, 'hrmo_administrator');
    // Another Agency in the path is refused; another Agency's Employee does not exist here.
    expect(await errorOf(controller.read(foreign.agency.id, foreign.member.id, hr))).toMatchObject({
      status: 403,
      body: { error: { code: 'COC_BALANCE_FORBIDDEN' } },
    });
    expect(await errorOf(controller.read(home.agency.id, foreign.member.id, hr))).toMatchObject({
      status: 404,
      body: { error: { code: 'COC_EMPLOYEE_NOT_FOUND' } },
    });
    // A scoped caller cannot tell a missing Employee from one beyond reach.
    const own = await member(admin, home, suffix, 'employee', home.member.id);
    expect(await errorOf(controller.read(home.agency.id, foreign.member.id, own))).toMatchObject({
      status: 403,
      body: { error: { code: 'COC_BALANCE_FORBIDDEN' } },
    });
    expect(await errorOf(controller.read(home.agency.id, 'not-a-uuid', hr))).toMatchObject({
      status: 404,
      body: { error: { code: 'COC_EMPLOYEE_NOT_FOUND' } },
    });
  }),
);

it.skipIf(!enabled)('reads a zero balance with no account, and a read writes nothing', () =>
  withAgencies('nowrite', async ({ admin, suffix, home }) => {
    const hr = await member(admin, home, suffix, 'hrmo_administrator');
    const trace = async () => {
      const where = { agencyId: home.agency.id };
      const accounts = await admin.cocAccount.findMany({ where, orderBy: { id: 'asc' } });
      const entries = await admin.cocLedgerEntry.findMany({ where, orderBy: { id: 'asc' } });
      const audits = await admin.auditEvent.count({ where });
      return { accounts, entries, audits };
    };

    const empty = await trace();
    expect(await controller.read(home.agency.id, home.member.id, hr)).toEqual({
      cocAccountId: null,
      asOf: manilaToday(),
      byValidUntil: [],
      totalMinutes: '0.0',
    });
    expect(await trace()).toEqual(empty);
    expect(empty.accounts).toEqual([]);

    await award(home, home.member.id, `${YEAR}-01`, 60);
    const held = await trace();
    await controller.read(home.agency.id, home.member.id, hr);
    expect(await trace()).toEqual(held);
    expect(held.entries).toHaveLength(1);
  }),
);
