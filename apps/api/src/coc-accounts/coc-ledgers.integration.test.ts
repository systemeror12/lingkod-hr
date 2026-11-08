import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { expect, it } from 'vitest';
import { createAdminClient } from '../attendance-test-fixtures';
import {
  addMember,
  cleanup,
  context,
  createAgency,
  enabled,
  errorOf,
  type AgencyFixture,
} from '../overtime-authorities/overtime-authority-test-fixtures';
import { CocLedgersController } from './coc-ledgers.controller';
import { CocLedgersService } from './coc-ledgers.service';

const READ = 'overtime.coc.read';
const controller = new CocLedgersController(new CocLedgersService());

// Far enough ahead to stay valid whenever this runs.
const LIVE = '2099-12-31';

function member(
  admin: PrismaClient,
  home: AgencyFixture,
  suffix: string,
  scopePolicy: RequestContext['permissions'][number]['scopePolicy'],
  employeeId?: string,
): Promise<RequestContext> {
  return addMember(admin, home, suffix, `reader-${randomUUID().slice(0, 8)}`, 'employee', [
    { code: READ, scopePolicy },
  ]).then(async (actor) => {
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
  });
}

function openAccount(home: AgencyFixture, employeeId: string) {
  return withDatabaseContext({ agencyId: home.agency.id }, (transaction) =>
    transaction.cocAccount.create({
      data: {
        agencyId: home.agency.id,
        employeeId,
        status: 'ACTIVE',
        openedAt: new Date('2001-01-01'),
      },
      select: { id: true },
    }),
  );
}

/** Write an entry directly; the commands that post entries have their own tests. */
function post(
  home: AgencyFixture,
  entry: {
    cocAccountId: string;
    minutes: string;
    effectiveDate: string;
    sourceType: string;
    sourceId?: string;
    sourcePostingKey?: string;
    reason?: string;
    reversesEntryId?: string;
    /** A correction's Document Version and poster. */
    correction?: { supportingDocumentVersionId: string; postedByMembershipId: string };
  },
) {
  return withDatabaseContext({ agencyId: home.agency.id }, (transaction) =>
    transaction.cocLedgerEntry.create({
      data: {
        agencyId: home.agency.id,
        cocAccountId: entry.cocAccountId,
        minutes: entry.minutes,
        effectiveDate: new Date(entry.effectiveDate),
        validUntil: new Date(LIVE),
        sourceType: entry.sourceType,
        sourceId: entry.sourceId ?? randomUUID(),
        sourcePostingKey: entry.sourcePostingKey ?? randomUUID(),
        // A certificate's COC earned in 2098 is valid until LIVE.
        earnedMonth: entry.sourceType === 'COC_EARNED_CERTIFICATE' ? new Date('2098-01-01') : null,
        ruleCode: 'TEST',
        reason: entry.reason ?? null,
        reversesEntryId: entry.reversesEntryId ?? null,
        ...entry.correction,
      },
      select: { id: true },
    }),
  );
}

/** A finalized Document Version to support a correction. */
async function createEvidence(admin: PrismaClient, home: AgencyFixture) {
  const document = await admin.document.create({
    data: {
      agencyId: home.agency.id,
      documentType: 'COC_CORRECTION_BASIS',
      classification: 'INTERNAL',
      status: 'APPROVED',
      createdByMembershipId: home.membership.id,
    },
  });
  const version = await admin.documentVersion.create({
    data: {
      agencyId: home.agency.id,
      documentId: document.id,
      versionNo: 1,
      storageKey: `coc-ledgers/${document.id}`,
      contentHash: 'c'.repeat(64),
      mimeType: 'application/pdf',
      sizeBytes: 1,
      issuedAt: new Date(),
      createdByMembershipId: home.membership.id,
    },
  });
  return version.id;
}

/** A certificate line whose certified service sits on an Overtime Authority. */
async function certificateLine(
  home: AgencyFixture,
  employeeId: string,
  authorityNo: string,
  approverMembershipId: string,
) {
  return home.asReplica(async (transaction) => {
    const authority = await transaction.overtimeAuthority.create({
      data: {
        agencyId: home.agency.id,
        requestingUnitId: home.division.id,
        authorityNo,
        purpose: 'Ledger read fixture.',
        workDateFrom: new Date('2098-01-05'),
        workDateTo: new Date('2098-01-05'),
        compensationMethod: 'COC',
        status: 'APPROVED',
        approvedByMembershipId: home.membership.id,
        approvedAt: new Date(),
      },
    });
    const coverage = await transaction.overtimeAuthorityEmployee.create({
      data: {
        agencyId: home.agency.id,
        overtimeAuthorityId: authority.id,
        employeeId,
        authorizedHours: '2',
      },
    });
    const record = await transaction.overtimeServiceRecord.create({
      data: {
        agencyId: home.agency.id,
        overtimeAuthorityEmployeeId: coverage.id,
        employeeId,
        workDate: new Date('2098-01-05'),
        claimedHours: '1',
        accomplishment: 'Ledger read fixture.',
        actualMinutes: 60,
        sourceAttendanceDayId: randomUUID(),
        status: 'CERTIFIED',
        certifiedMinutes: 60,
        dayClassification: 'WORKDAY',
        recordedByMembershipId: home.membership.id,
        certifiedByMembershipId: home.membership.id,
        certifiedAt: new Date(),
      },
    });
    const certificate = await transaction.cocEarnedCertificate.create({
      data: {
        agencyId: home.agency.id,
        employeeId,
        earnedMonth: new Date('2098-01-01'),
        status: 'APPROVED',
        preparedByMembershipId: home.membership.id,
        approvedByMembershipId: approverMembershipId,
        approvedAt: new Date(),
      },
    });
    const line = await transaction.cocEarnedCertificateLine.create({
      data: {
        agencyId: home.agency.id,
        cocEarnedCertificateId: certificate.id,
        overtimeServiceRecordId: record.id,
        certifiedMinutes: 60,
        creditedMinutes: '60.0',
      },
    });
    return { authorityId: authority.id, certificateId: certificate.id, lineId: line.id };
  });
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
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-cocled-${label}`;
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
      await transaction.cocEarnedCertificateLine.deleteMany({ where });
      await transaction.cocEarnedCertificate.deleteMany({ where });
      await transaction.document.updateMany({ where, data: { currentVersionId: null } });
      await transaction.documentVersion.deleteMany({ where });
      await transaction.document.deleteMany({ where });
    });
    await cleanup(admin, [home.agency.id, foreign.agency.id], suffix);
    await admin.$disconnect();
  }
}

it.skipIf(!enabled)(
  'lists the ledger with its sources, linking each reversal to the entry it reverses',
  () =>
    withAgencies('ledger', async ({ admin, suffix, home }) => {
      const account = await openAccount(home, home.member.id);
      const authorityNo = `OT-LEDGER-${suffix}`;
      const hr = await member(admin, home, suffix, 'AGENCY');
      const line = await certificateLine(home, home.member.id, authorityNo, hr.membershipId);
      const earned = await post(home, {
        cocAccountId: account.id,
        minutes: '60.0',
        effectiveDate: '2098-02-01',
        sourceType: 'COC_EARNED_CERTIFICATE',
        sourceId: line.certificateId,
        sourcePostingKey: line.lineId,
      });
      const correction = {
        supportingDocumentVersionId: await createEvidence(admin, home),
        postedByMembershipId: hr.membershipId,
      };
      const adjusted = await post(home, {
        cocAccountId: account.id,
        minutes: '-15.0',
        effectiveDate: '2098-02-02',
        sourceType: 'COC_ADJUSTMENT',
        reason: 'Recorded in error.',
        correction,
      });
      const reversal = await post(home, {
        cocAccountId: account.id,
        minutes: '15.0',
        effectiveDate: '2098-02-02',
        sourceType: 'COC_REVERSAL',
        sourceId: adjusted.id,
        sourcePostingKey: adjusted.id,
        reason: 'The adjustment was wrong.',
        reversesEntryId: adjusted.id,
        correction,
      });

      const ledger = await controller.ledger(home.agency.id, account.id, hr);
      expect(ledger.account).toMatchObject({
        id: account.id,
        employeeId: home.member.id,
        employeeName: 'Eli Member',
        status: 'ACTIVE',
      });
      expect(
        ledger.entries.map((entry) => ({
          id: entry.id,
          minutes: entry.minutes,
          sourceType: entry.sourceType,
          reversesEntryId: entry.reversesEntryId,
          reversedByEntryId: entry.reversedByEntryId,
          overtimeAuthority: entry.overtimeAuthority,
        })),
      ).toEqual([
        {
          id: earned.id,
          minutes: '60.0',
          sourceType: 'COC_EARNED_CERTIFICATE',
          reversesEntryId: null,
          reversedByEntryId: null,
          overtimeAuthority: { id: line.authorityId, authorityNo },
        },
        {
          id: adjusted.id,
          minutes: '-15.0',
          sourceType: 'COC_ADJUSTMENT',
          reversesEntryId: null,
          reversedByEntryId: reversal.id,
          overtimeAuthority: null,
        },
        {
          id: reversal.id,
          minutes: '15.0',
          sourceType: 'COC_REVERSAL',
          reversesEntryId: adjusted.id,
          reversedByEntryId: null,
          overtimeAuthority: null,
        },
      ]);
      expect(ledger.entries[1]).toMatchObject({
        effectiveDate: '2098-02-02',
        validUntil: LIVE,
        reason: 'Recorded in error.',
        supportingDocumentVersionId: correction.supportingDocumentVersionId,
      });
    }),
  120_000,
);

it.skipIf(!enabled)('lists accounts with today’s balance, only within scope', () =>
  withAgencies('list', async ({ admin, suffix, home }) => {
    const mine = await openAccount(home, home.member.id);
    const theirs = await openAccount(home, home.outsider.id);
    await post(home, {
      cocAccountId: mine.id,
      minutes: '60.0',
      effectiveDate: '2001-01-01',
      sourceType: 'COC_EARNED_CERTIFICATE',
    });
    // Effective after today, so today's balance does not count it.
    await post(home, {
      cocAccountId: mine.id,
      minutes: '30.0',
      effectiveDate: '2098-01-01',
      sourceType: 'COC_EARNED_CERTIFICATE',
    });

    const hr = await member(admin, home, suffix, 'AGENCY');
    const all = await controller.list(home.agency.id, hr);
    expect(all.accounts.map((account) => [account.employeeName, account.balanceMinutes])).toEqual([
      ['Eli Member', '60.0'],
      ['Olive Outsider', '0.0'],
    ]);

    // An Employee reads only their own account and its ledger.
    const own = await member(admin, home, suffix, 'OWN', home.member.id);
    expect((await controller.list(home.agency.id, own)).accounts.map(({ id }) => id)).toEqual([
      mine.id,
    ]);
    expect((await controller.ledger(home.agency.id, mine.id, own)).entries).toHaveLength(2);
    expect(await errorOf(controller.ledger(home.agency.id, theirs.id, own))).toMatchObject({
      status: 403,
      body: { error: { code: 'COC_BALANCE_FORBIDDEN' } },
    });
    // A Membership with no linked Employee has no own account.
    const unlinked = await member(admin, home, suffix, 'OWN');
    expect((await controller.list(home.agency.id, unlinked)).accounts).toEqual([]);
  }),
);

it.skipIf(!enabled)('refuses a caller without the grant and an account beyond reach', () =>
  withAgencies('refuse', async ({ admin, suffix, home, foreign }) => {
    const account = await openAccount(home, home.member.id);
    const noGrant = context(home.agency.id, home.user.id, home.membership.id, []);
    for (const read of [
      () => controller.list(home.agency.id, noGrant),
      () => controller.ledger(home.agency.id, account.id, noGrant),
    ]) {
      expect(await errorOf(read())).toMatchObject({
        status: 403,
        body: { error: { code: 'COC_BALANCE_FORBIDDEN' } },
      });
    }

    const foreignAccount = await openAccount(foreign, foreign.member.id);
    const hr = await member(admin, home, suffix, 'AGENCY');
    expect(await errorOf(controller.list(foreign.agency.id, hr))).toMatchObject({
      status: 403,
      body: { error: { code: 'COC_BALANCE_FORBIDDEN' } },
    });
    expect(await errorOf(controller.ledger(home.agency.id, foreignAccount.id, hr))).toMatchObject({
      status: 404,
      body: { error: { code: 'COC_ACCOUNT_NOT_FOUND' } },
    });
    expect(await errorOf(controller.ledger(home.agency.id, 'not-a-uuid', hr))).toMatchObject({
      status: 404,
      body: { error: { code: 'COC_ACCOUNT_NOT_FOUND' } },
    });
    // A scoped caller cannot tell a missing account from one beyond reach.
    const own = await member(admin, home, suffix, 'OWN', home.member.id);
    expect(await errorOf(controller.ledger(home.agency.id, foreignAccount.id, own))).toMatchObject({
      status: 403,
      body: { error: { code: 'COC_BALANCE_FORBIDDEN' } },
    });
  }),
);
