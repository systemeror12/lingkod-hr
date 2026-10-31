import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { expect, it } from 'vitest';
import { manilaToday } from '../attendance-configuration/attendance-configuration.types';
import { createAdminClient } from '../attendance-test-fixtures';
import { documentAuditWriter, DocumentsService } from '../documents/documents.service';
import { CocAccountsService } from './coc-accounts.service';
import { CocLedgerCorrectionsController } from './coc-ledger-corrections.controller';
import { CocLedgerCorrectionsService } from './coc-ledger-corrections.service';

const enabled = process.env.DATABASE_E2E === 'true';
const accounts = new CocAccountsService();
const service = new CocLedgerCorrectionsService(
  accounts,
  new DocumentsService({} as never, documentAuditWriter),
);
const controller = new CocLedgerCorrectionsController(service);

// Far enough ahead to stay valid, and far enough back to have passed, whenever this runs.
const LIVE = '2099-12-31';
const LATER = '2100-12-31';
const PASSED = '2005-12-31';

const GRANTS = ['overtime.coc.adjust', 'overtime.coc.reverse', 'documents.evidence.read'].map(
  (code) => ({ code, scopePolicy: 'AGENCY' as const }),
);

async function createAgency(admin: PrismaClient, suffix: string, label: string) {
  const agency = await admin.agency.create({
    data: {
      code: `COCFIX-${label}-${suffix}`,
      name: `COC Fix ${label}`,
      agencyType: 'NGA',
      status: 'ACTIVE',
    },
  });
  const user = await admin.user.create({
    data: {
      emailNormalized: `cocfix-${label.toLowerCase()}-${suffix}@example.test`,
      displayName: `COC Fix ${label}`,
      globalStatus: 'ACTIVE',
    },
  });
  const membership = await admin.agencyMembership.create({
    data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
  });
  const context: RequestContext = {
    requestId: `request-${label}`,
    userId: user.id,
    agencyId: agency.id,
    membershipId: membership.id,
    primaryOrganizationUnitId: null,
    permissions: GRANTS,
  };
  return { agencyId: agency.id, membershipId: membership.id, context };
}

type Agency = Awaited<ReturnType<typeof createAgency>>;

let sequence = 0;
async function createEmployee(admin: PrismaClient, agency: Agency, suffix: string) {
  sequence += 1;
  return admin.employee.create({
    data: {
      agencyId: agency.agencyId,
      employeeNumber: `COCFIX-${sequence}-${suffix}`,
      legalName: `COC Fix Employee ${sequence}`,
      birthDate: new Date('1990-01-01'),
      sex: 'FEMALE',
      civilStatus: 'SINGLE',
      contactEmail: `cocfix-${sequence}-${suffix}@example.test`,
      serviceStatus: 'ACTIVE',
      createdByMembershipId: agency.membershipId,
      updatedByMembershipId: agency.membershipId,
    },
  });
}

async function createEvidence(
  admin: PrismaClient,
  agency: Agency,
  options: { classification?: string; finalized?: boolean } = {},
) {
  const finalized = options.finalized ?? true;
  const document = await admin.document.create({
    data: {
      agencyId: agency.agencyId,
      documentType: 'COC_CORRECTION_BASIS',
      classification: options.classification ?? 'INTERNAL',
      status: finalized ? 'APPROVED' : 'DRAFT',
      createdByMembershipId: agency.membershipId,
    },
  });
  const version = await admin.documentVersion.create({
    data: {
      agencyId: agency.agencyId,
      documentId: document.id,
      versionNo: 1,
      storageKey: `coc-corrections/${document.id}`,
      contentHash: 'c'.repeat(64),
      mimeType: 'application/pdf',
      sizeBytes: 1,
      ...(finalized ? { issuedAt: new Date() } : {}),
      createdByMembershipId: agency.membershipId,
    },
  });
  await admin.document.update({
    where: { id: document.id },
    data: { currentVersionId: version.id },
  });
  return version.id;
}

/** An account holding certificate COC, each amount under its own Valid Until. */
async function seedAccount(
  admin: PrismaClient,
  agency: Agency,
  suffix: string,
  credits: { validUntil: string; minutes: number }[],
) {
  const employee = await createEmployee(admin, agency, suffix);
  const cocAccountId = await withDatabaseContext(
    { agencyId: agency.agencyId },
    async (transaction) => {
      const account = await transaction.cocAccount.create({
        data: {
          agencyId: agency.agencyId,
          employeeId: employee.id,
          status: 'ACTIVE',
          openedAt: new Date('2001-01-01'),
        },
      });
      return account.id;
    },
  );
  const certificateEntryIds: string[] = [];
  for (const { validUntil, minutes } of credits) {
    const year = Number(validUntil.slice(0, 4));
    const entry = await post(agency, {
      cocAccountId,
      minutes,
      effectiveDate: `${year - 1}-12-15`,
      validUntil,
      earnedMonth: new Date(`${year - 1}-12-01`),
      sourceType: 'COC_EARNED_CERTIFICATE',
    });
    certificateEntryIds.push(entry.id);
  }
  return { cocAccountId, employeeId: employee.id, certificateEntryIds };
}

/** Write an entry directly, for states the API cannot reach with today's clock. */
function post(
  agency: Agency,
  entry: {
    cocAccountId: string;
    minutes: number;
    effectiveDate: string;
    validUntil: string;
    sourceType: string;
    earnedMonth?: Date;
    reason?: string;
    supportingDocumentVersionId?: string;
    postedByMembershipId?: string;
  },
) {
  return withDatabaseContext({ agencyId: agency.agencyId }, (transaction) =>
    transaction.cocLedgerEntry.create({
      data: {
        ...entry,
        agencyId: agency.agencyId,
        effectiveDate: new Date(entry.effectiveDate),
        validUntil: new Date(entry.validUntil),
        sourceId: randomUUID(),
        sourcePostingKey: randomUUID(),
        ruleCode: 'TEST',
      },
    }),
  );
}

function expire(agency: Agency, cocAccountId: string, validUntil: string, asOf: string) {
  return withDatabaseContext({ agencyId: agency.agencyId }, (transaction) =>
    accounts.expireCocInTransaction(transaction, agency.agencyId, {
      cocAccountId,
      validUntil,
      asOf,
    }),
  );
}

const remaining = async (admin: PrismaClient, cocAccountId: string, validUntil: string) => {
  const sum = await admin.cocLedgerEntry.aggregate({
    where: { cocAccountId, validUntil: new Date(validUntil) },
    _sum: { minutes: true },
  });
  return sum._sum.minutes?.toString() ?? '0';
};

const expiries = (admin: PrismaClient, cocAccountId: string) =>
  admin.cocLedgerEntry.findMany({
    where: { cocAccountId, sourceType: 'COC_EXPIRY' },
    orderBy: { postedAt: 'asc' },
  });

const isDue = async (admin: PrismaClient, cocAccountId: string, asOf: string) => {
  const due = await admin.$queryRaw<{ coc_account_id: string }[]>`
    SELECT "coc_account_id" FROM coc_expiries_due(CAST(${asOf} AS date))
  `;
  return due.some((row) => row.coc_account_id === cocAccountId);
};

async function cleanup(admin: PrismaClient, agencyIds: string[], suffix: string) {
  await admin.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    const where = { agencyId: { in: agencyIds } };
    await transaction.auditEvent.deleteMany({ where });
    await transaction.cocLedgerEntry.deleteMany({ where });
    await transaction.cocAccount.deleteMany({ where });
    await transaction.documentVersion.deleteMany({ where });
    await transaction.document.deleteMany({ where });
    await transaction.employee.deleteMany({ where });
    await transaction.agencyMembership.deleteMany({ where });
    await transaction.agency.deleteMany({ where: { id: { in: agencyIds } } });
    await transaction.user.deleteMany({ where: { emailNormalized: { contains: suffix } } });
  });
}

/** A test with one home and one foreign Agency, cleaned up afterwards. */
function scenario(
  name: string,
  run: (fixture: {
    admin: PrismaClient;
    suffix: string;
    home: Agency;
    foreign: Agency;
    evidence: string;
  }) => Promise<void>,
) {
  it.skipIf(!enabled)(
    name,
    async () => {
      const admin = await createAdminClient();
      const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}-cocfix`;
      const home = await createAgency(admin, suffix, 'HOME');
      const foreign = await createAgency(admin, suffix, 'FOREIGN');
      try {
        const evidence = await createEvidence(admin, home);
        await run({ admin, suffix, home, foreign, evidence });
      } finally {
        await cleanup(admin, [home.agencyId, foreign.agencyId], suffix);
        await admin.$disconnect();
      }
    },
    60_000,
  );
}

scenario(
  'adjusts negative only, from the earliest-expiring or chosen Valid Until, never below zero',
  async ({ admin, suffix, home, evidence }) => {
    const { cocAccountId } = await seedAccount(admin, home, suffix, [
      { validUntil: LATER, minutes: 200 },
      { validUntil: LIVE, minutes: 100 },
      { validUntil: PASSED, minutes: 50 },
    ]);
    const body = { reason: 'Overstated certificate.', supportingDocumentVersionId: evidence };
    const adjust = (input: object, key?: string) =>
      controller.adjust(home.agencyId, cocAccountId, { ...body, ...input }, key, home.context);

    // By default it draws the earliest-expiring COC still valid, not the passed one.
    const first = await adjust({ minutes: '-30.5' });
    expect(first).toMatchObject({ minutes: '-30.5', validUntil: LIVE });
    const stored = await admin.cocLedgerEntry.findUniqueOrThrow({ where: { id: first.id } });
    expect(stored).toMatchObject({
      sourceType: 'COC_ADJUSTMENT',
      reason: body.reason,
      supportingDocumentVersionId: evidence,
      postedByMembershipId: home.membershipId,
      reversesEntryId: null,
    });
    expect(first.effectiveDate).toBe(manilaToday());

    expect(await adjust({ minutes: '-50', validUntil: LATER })).toMatchObject({
      validUntil: LATER,
    });
    expect(await remaining(admin, cocAccountId, LATER)).toBe('150');

    // It cannot spill over into another Valid Until or take one below zero.
    await expect(adjust({ minutes: '-69.6' })).rejects.toMatchObject({ status: 409 });
    await expect(adjust({ minutes: '-69.6', validUntil: LIVE })).rejects.toMatchObject({
      response: { error: { code: 'COC_INSUFFICIENT_BALANCE' } },
    });
    await expect(adjust({ minutes: '-1', validUntil: PASSED })).rejects.toMatchObject({
      response: { error: { code: 'COC_VALIDITY_PASSED' } },
    });
    expect(await remaining(admin, cocAccountId, LIVE)).toBe('69.5');

    // The rest of it can go.
    await adjust({ minutes: '-69.5' });
    expect(await adjust({ minutes: '-1' })).toMatchObject({ validUntil: LATER });

    // Positive, zero, reasonless, and evidenceless requests never reach the ledger.
    for (const invalid of [
      { minutes: '30' },
      { minutes: '-0' },
      { minutes: '-1.25' },
      { minutes: '-1', reason: '   ' },
      { minutes: '-1', supportingDocumentVersionId: undefined },
    ]) {
      await expect(adjust(invalid)).rejects.toMatchObject({ status: 400 });
    }

    // A retry under the same key returns the stored entry; another command under it is refused.
    const keyed = await adjust({ minutes: '-5' }, 'retry-key');
    expect(await adjust({ minutes: '-5' }, 'retry-key')).toEqual(keyed);
    await expect(adjust({ minutes: '-6' }, 'retry-key')).rejects.toMatchObject({
      response: { error: { code: 'COC_IDEMPOTENCY_CONFLICT' } },
    });
    expect(await admin.cocLedgerEntry.count({ where: { id: keyed.id } })).toBe(1);

    const audit = await admin.auditEvent.findFirstOrThrow({
      where: { agencyId: home.agencyId, action: 'COC_ADJUSTED', entityId: first.id },
    });
    expect(audit).toMatchObject({
      actorType: 'USER',
      actorMembershipId: home.membershipId,
      entityType: 'CocLedgerEntry',
      reason: body.reason,
    });
    expect(audit.metadata).toMatchObject({
      cocAccountId,
      minutes: '-30.5',
      supportingDocumentVersionId: evidence,
    });
  },
);

scenario(
  'reverses only an unreversed adjustment or expiry, exactly and once',
  async ({ admin, suffix, home, evidence }) => {
    const {
      cocAccountId,
      certificateEntryIds: [certificateEntryId],
    } = await seedAccount(admin, home, suffix, [{ validUntil: LIVE, minutes: 100 }]);
    const body = { reason: 'Posted in error.', supportingDocumentVersionId: evidence };
    const reverse = (entryId: string) =>
      controller.reverse(home.agencyId, cocAccountId, entryId, body, home.context);

    const adjustment = await controller.adjust(
      home.agencyId,
      cocAccountId,
      { ...body, minutes: '-40' },
      undefined,
      home.context,
    );
    const reversed = await reverse(adjustment.id);
    expect(reversed).toEqual({
      expiryEntryId: null,
      entry: {
        id: expect.any(String),
        cocAccountId,
        minutes: '40.0',
        effectiveDate: adjustment.effectiveDate,
        validUntil: LIVE,
      },
    });
    expect(await remaining(admin, cocAccountId, LIVE)).toBe('100');
    const stored = await admin.cocLedgerEntry.findUniqueOrThrow({
      where: { id: reversed.entry.id },
    });
    expect(stored).toMatchObject({
      sourceType: 'COC_REVERSAL',
      sourceId: adjustment.id,
      sourcePostingKey: adjustment.id,
      reversesEntryId: adjustment.id,
      reason: body.reason,
      supportingDocumentVersionId: evidence,
    });
    expect(
      await admin.auditEvent.count({
        where: { agencyId: home.agencyId, action: 'COC_REVERSED', entityId: reversed.entry.id },
      }),
    ).toBe(1);

    const refusedWith = (code: string) => ({ response: { error: { code } } });
    await expect(reverse(adjustment.id)).rejects.toMatchObject(
      refusedWith('COC_ENTRY_ALREADY_REVERSED'),
    );
    // A certificate and a reversal are positive, so neither is reversible.
    await expect(reverse(certificateEntryId ?? '')).rejects.toMatchObject(
      refusedWith('COC_REVERSAL_NOT_NEGATIVE'),
    );
    await expect(reverse(reversed.entry.id)).rejects.toMatchObject(
      refusedWith('COC_REVERSAL_NOT_NEGATIVE'),
    );
    await expect(reverse(randomUUID())).rejects.toMatchObject(refusedWith('COC_ENTRY_NOT_FOUND'));

    // CTO usage returns through cancellation, and any source not yet decided is refused alike.
    for (const sourceType of ['CTO_REQUEST', 'CTO_USAGE', 'SEPARATION_CASE']) {
      const entry = await post(home, {
        cocAccountId,
        minutes: -10,
        effectiveDate: '2026-01-05',
        validUntil: LIVE,
        sourceType,
      });
      await expect(reverse(entry.id)).rejects.toMatchObject(
        refusedWith('COC_REVERSAL_SOURCE_NOT_ALLOWED'),
      );
    }

    // The database refuses a correction without its evidence or a positive adjustment.
    await expect(
      post(home, {
        cocAccountId,
        minutes: -1,
        effectiveDate: '2026-01-05',
        validUntil: LIVE,
        sourceType: 'COC_ADJUSTMENT',
      }),
    ).rejects.toThrow(/coc_ledger_entries_correction_check/);
  },
);

scenario('lets one of two racing reversals win', async ({ admin, suffix, home, evidence }) => {
  const { cocAccountId } = await seedAccount(admin, home, suffix, [
    { validUntil: LIVE, minutes: 100 },
  ]);
  const body = { reason: 'Posted in error.', supportingDocumentVersionId: evidence };
  const adjustment = await service.adjust(home.context, cocAccountId, {
    ...body,
    minutes: '-40',
  });

  const results = await Promise.allSettled([
    service.reverse(home.context, cocAccountId, adjustment.id, body),
    service.reverse(home.context, cocAccountId, adjustment.id, body),
  ]);
  const refused = results.filter((result) => result.status === 'rejected');
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(refused).toHaveLength(1);
  expect(refused[0]?.reason).toMatchObject({ code: 'COC_ENTRY_ALREADY_REVERSED' });
  expect(await admin.cocLedgerEntry.count({ where: { reversesEntryId: adjustment.id } })).toBe(1);
  expect(await remaining(admin, cocAccountId, LIVE)).toBe('100');
});

scenario(
  'expires restored COC again in the same transaction, through repeated reversals',
  async ({ admin, suffix, home, evidence }) => {
    const { cocAccountId } = await seedAccount(admin, home, suffix, [
      { validUntil: PASSED, minutes: 100 },
    ]);
    const body = { reason: 'Expired in error.', supportingDocumentVersionId: evidence };
    const reverse = (entryId: string) => service.reverse(home.context, cocAccountId, entryId, body);

    const firstExpiry = await expire(home, cocAccountId, PASSED, '2006-01-01');
    if (!firstExpiry) throw new Error('Expected the first expiry.');

    // Reverse the expiry: the restored COC expires again before the commit.
    const firstReversal = await reverse(firstExpiry);
    expect(firstReversal.entry).toMatchObject({
      minutes: '100.0',
      effectiveDate: '2006-01-01',
      validUntil: PASSED,
    });
    const secondExpiry = firstReversal.expiryEntryId;
    expect(secondExpiry).toEqual(expect.any(String));
    expect(await remaining(admin, cocAccountId, PASSED)).toBe('0');

    // A re-expiry is itself reversible, and its own re-expiry takes a new key.
    const secondReversal = await reverse(secondExpiry ?? '');
    const thirdExpiry = secondReversal.expiryEntryId;
    expect(thirdExpiry).toEqual(expect.any(String));
    expect(await remaining(admin, cocAccountId, PASSED)).toBe('0');

    expect((await expiries(admin, cocAccountId)).map((entry) => entry.sourcePostingKey)).toEqual([
      PASSED,
      `${PASSED}#2`,
      `${PASSED}#3`,
    ]);
    const lastExpiry = await admin.cocLedgerEntry.findUniqueOrThrow({
      where: { id: thirdExpiry ?? '' },
    });
    expect(lastExpiry).toMatchObject({
      effectiveDate: new Date('2006-01-01'),
      postedByMembershipId: null,
      ruleCode: 'JC2A_2005_COC_VALIDITY',
    });
    expect(
      await admin.auditEvent.count({
        where: { agencyId: home.agencyId, action: 'COC_EXPIRED', actorType: 'SYSTEM' },
      }),
    ).toBe(3);

    // What the job would do next: nothing is due, and a direct call posts nothing.
    expect(await isDue(admin, cocAccountId, '2030-01-01')).toBe(false);
    expect(await expire(home, cocAccountId, PASSED, '2030-01-01')).toBeNull();
    expect(await expiries(admin, cocAccountId)).toHaveLength(3);

    // An entry already reversed stays that way.
    await expect(reverse(firstExpiry)).rejects.toMatchObject({
      code: 'COC_ENTRY_ALREADY_REVERSED',
    });
  },
);

scenario(
  'expires what reversing an adjustment restores after the Valid Until has passed',
  async ({ admin, suffix, home, evidence }) => {
    const { cocAccountId } = await seedAccount(admin, home, suffix, [
      { validUntil: PASSED, minutes: 100 },
    ]);
    const body = { reason: 'Adjusted in error.', supportingDocumentVersionId: evidence };
    const adjustment = await post(home, {
      cocAccountId,
      minutes: -30,
      effectiveDate: '2005-06-01',
      validUntil: PASSED,
      sourceType: 'COC_ADJUSTMENT',
      ...body,
      postedByMembershipId: home.membershipId,
    });
    await expire(home, cocAccountId, PASSED, '2006-01-01');
    expect(await remaining(admin, cocAccountId, PASSED)).toBe('0');

    // This re-expiry follows no reversed expiry, so its key still cannot collide.
    const { entry, expiryEntryId } = await service.reverse(
      home.context,
      cocAccountId,
      adjustment.id,
      body,
    );
    expect(entry).toMatchObject({ minutes: '30.0', effectiveDate: '2005-06-01' });
    const reExpiry = await admin.cocLedgerEntry.findUniqueOrThrow({
      where: { id: expiryEntryId ?? '' },
    });
    expect(reExpiry.minutes.toString()).toBe('-30');
    expect(reExpiry.sourcePostingKey).toBe(`${PASSED}#2`);
    expect(await remaining(admin, cocAccountId, PASSED)).toBe('0');
    expect(await isDue(admin, cocAccountId, '2030-01-01')).toBe(false);
  },
);

scenario(
  "keeps corrections inside the Agency, its evidence, and away from one's own account",
  async ({ admin, suffix, home, foreign, evidence }) => {
    const { cocAccountId, employeeId } = await seedAccount(admin, home, suffix, [
      { validUntil: LIVE, minutes: 100 },
    ]);
    const body = { reason: 'Correction.', supportingDocumentVersionId: evidence };
    const adjustment = { ...body, minutes: '-10' };
    const refusedWith = (code: string, status: number) => ({
      status,
      response: { error: { code } },
    });

    // Another Agency's context cannot name this Agency, nor reach its account or entry.
    await expect(
      controller.adjust(home.agencyId, cocAccountId, adjustment, undefined, foreign.context),
    ).rejects.toMatchObject(refusedWith('COC_WRITE_FORBIDDEN', 403));
    await expect(
      controller.adjust(foreign.agencyId, cocAccountId, adjustment, undefined, foreign.context),
    ).rejects.toMatchObject(refusedWith('COC_ACCOUNT_NOT_FOUND', 404));
    const entry = await service.adjust(home.context, cocAccountId, adjustment);
    await expect(
      controller.reverse(foreign.agencyId, cocAccountId, entry.id, body, foreign.context),
    ).rejects.toMatchObject(refusedWith('COC_ACCOUNT_NOT_FOUND', 404));

    // Evidence from another Agency, not yet finalized, or too sensitive is refused.
    const invalidEvidence = [
      [await createEvidence(admin, foreign), 'COC_EVIDENCE_INVALID', 409],
      [await createEvidence(admin, home, { finalized: false }), 'COC_EVIDENCE_INVALID', 409],
      [
        await createEvidence(admin, home, { classification: 'HIGHLY_SENSITIVE' }),
        'COC_EVIDENCE_FORBIDDEN',
        403,
      ],
    ] as const;
    for (const [supportingDocumentVersionId, code, status] of invalidEvidence) {
      await expect(
        controller.adjust(
          home.agencyId,
          cocAccountId,
          { ...adjustment, supportingDocumentVersionId },
          undefined,
          home.context,
        ),
      ).rejects.toMatchObject(refusedWith(code, status));
      await expect(
        controller.reverse(
          home.agencyId,
          cocAccountId,
          entry.id,
          { ...body, supportingDocumentVersionId },
          home.context,
        ),
      ).rejects.toMatchObject(refusedWith(code, status));
    }

    // Each command needs its own permission at Agency scope.
    const without = (code: string): RequestContext => ({
      ...home.context,
      permissions: GRANTS.filter((grant) => grant.code !== code),
    });
    await expect(
      service.adjust(without('overtime.coc.adjust'), cocAccountId, adjustment),
    ).rejects.toMatchObject({ code: 'COC_CORRECTION_FORBIDDEN' });
    await expect(
      service.reverse(without('overtime.coc.reverse'), cocAccountId, entry.id, body),
    ).rejects.toMatchObject({ code: 'COC_CORRECTION_FORBIDDEN' });
    await expect(
      service.adjust(without('documents.evidence.read'), cocAccountId, adjustment),
    ).rejects.toMatchObject({ code: 'COC_EVIDENCE_FORBIDDEN' });

    // A closed account takes no correction, so a forfeiture is not undone here.
    const closed = await seedAccount(admin, home, suffix, [{ validUntil: LIVE, minutes: 20 }]);
    const forfeiture = await post(home, {
      cocAccountId: closed.cocAccountId,
      minutes: -20,
      effectiveDate: '2026-01-05',
      validUntil: LIVE,
      sourceType: 'SEPARATION_CASE',
    });
    await withDatabaseContext({ agencyId: home.agencyId }, (transaction) =>
      transaction.cocAccount.update({
        where: { id: closed.cocAccountId },
        data: { status: 'CLOSED', closedAt: new Date('2026-01-05') },
      }),
    );
    await expect(
      service.reverse(home.context, closed.cocAccountId, forfeiture.id, body),
    ).rejects.toMatchObject({ code: 'COC_ACCOUNT_CLOSED' });
    await expect(
      service.adjust(home.context, closed.cocAccountId, adjustment),
    ).rejects.toMatchObject({ code: 'COC_ACCOUNT_CLOSED' });

    // Nobody corrects their own account, with every permission in hand.
    await withDatabaseContext(
      {
        agencyId: home.agencyId,
        membershipId: home.membershipId,
        capabilities: ['employee-membership-link'],
      },
      (transaction) =>
        transaction.agencyMembership.update({
          where: { agencyId_id: { agencyId: home.agencyId, id: home.membershipId } },
          data: { employeeId },
        }),
    );
    await expect(
      controller.adjust(home.agencyId, cocAccountId, adjustment, undefined, home.context),
    ).rejects.toMatchObject(refusedWith('COC_OWN_ACCOUNT_FORBIDDEN', 403));
    await expect(
      controller.reverse(home.agencyId, cocAccountId, entry.id, body, home.context),
    ).rejects.toMatchObject(refusedWith('COC_OWN_ACCOUNT_FORBIDDEN', 403));
    expect(await remaining(admin, cocAccountId, LIVE)).toBe('90');
  },
);

scenario(
  'replays a posted adjustment after its account closes or its caller becomes its Employee',
  async ({ admin, suffix, home, evidence }) => {
    const body = {
      reason: 'Overstated certificate.',
      supportingDocumentVersionId: evidence,
      minutes: '-10',
    };
    const closing = await seedAccount(admin, home, suffix, [{ validUntil: LIVE, minutes: 100 }]);
    const owned = await seedAccount(admin, home, suffix, [{ validUntil: LIVE, minutes: 100 }]);
    const first = await service.adjust(home.context, closing.cocAccountId, body, 'closed-key');
    const second = await service.adjust(home.context, owned.cocAccountId, body, 'owned-key');

    await admin.cocAccount.update({
      where: { id: closing.cocAccountId },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
    await withDatabaseContext(
      {
        agencyId: home.agencyId,
        membershipId: home.membershipId,
        capabilities: ['employee-membership-link'],
      },
      (transaction) =>
        transaction.agencyMembership.update({
          where: { agencyId_id: { agencyId: home.agencyId, id: home.membershipId } },
          data: { employeeId: owned.employeeId },
        }),
    );

    expect(await service.adjust(home.context, closing.cocAccountId, body, 'closed-key')).toEqual(
      first,
    );
    expect(await service.adjust(home.context, owned.cocAccountId, body, 'owned-key')).toEqual(
      second,
    );
    expect(await remaining(admin, closing.cocAccountId, LIVE)).toBe('90');
    expect(await remaining(admin, owned.cocAccountId, LIVE)).toBe('90');

    // A new key is a new command, so the refusals still apply, and no permission means no replay.
    await expect(
      service.adjust(home.context, closing.cocAccountId, body, 'new-key'),
    ).rejects.toMatchObject({ code: 'COC_ACCOUNT_CLOSED' });
    await expect(
      service.adjust(home.context, owned.cocAccountId, body, 'new-key'),
    ).rejects.toMatchObject({ code: 'COC_OWN_ACCOUNT_FORBIDDEN' });
    await expect(
      service.adjust(
        { ...home.context, permissions: [] },
        closing.cocAccountId,
        body,
        'closed-key',
      ),
    ).rejects.toMatchObject({ code: 'COC_CORRECTION_FORBIDDEN' });
  },
);

scenario(
  'refuses a reversal retry as already reversed after its account closes or its caller becomes its Employee',
  async ({ admin, suffix, home, evidence }) => {
    const body = { reason: 'Posted in error.', supportingDocumentVersionId: evidence };
    const closing = await seedAccount(admin, home, suffix, [{ validUntil: LIVE, minutes: 100 }]);
    const owned = await seedAccount(admin, home, suffix, [{ validUntil: LIVE, minutes: 100 }]);
    const closingAdjustment = await service.adjust(home.context, closing.cocAccountId, {
      ...body,
      minutes: '-10',
    });
    const ownedAdjustment = await service.adjust(home.context, owned.cocAccountId, {
      ...body,
      minutes: '-10',
    });
    await service.reverse(home.context, closing.cocAccountId, closingAdjustment.id, body);
    await service.reverse(home.context, owned.cocAccountId, ownedAdjustment.id, body);

    await admin.cocAccount.update({
      where: { id: closing.cocAccountId },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
    await withDatabaseContext(
      {
        agencyId: home.agencyId,
        membershipId: home.membershipId,
        capabilities: ['employee-membership-link'],
      },
      (transaction) =>
        transaction.agencyMembership.update({
          where: { agencyId_id: { agencyId: home.agencyId, id: home.membershipId } },
          data: { employeeId: owned.employeeId },
        }),
    );

    await expect(
      service.reverse(home.context, closing.cocAccountId, closingAdjustment.id, body),
    ).rejects.toMatchObject({ code: 'COC_ENTRY_ALREADY_REVERSED' });
    await expect(
      service.reverse(home.context, owned.cocAccountId, ownedAdjustment.id, body),
    ).rejects.toMatchObject({ code: 'COC_ENTRY_ALREADY_REVERSED' });
    for (const adjustment of [closingAdjustment, ownedAdjustment]) {
      expect(await admin.cocLedgerEntry.count({ where: { reversesEntryId: adjustment.id } })).toBe(
        1,
      );
    }
  },
);

scenario(
  'lets one of two racing adjustments win rather than overdraw',
  async ({ admin, suffix, home, evidence }) => {
    const { cocAccountId } = await seedAccount(admin, home, suffix, [
      { validUntil: LIVE, minutes: 100 },
    ]);
    const body = {
      reason: 'Overstated certificate.',
      supportingDocumentVersionId: evidence,
      minutes: '-60',
    };

    const results = await Promise.allSettled([
      service.adjust(home.context, cocAccountId, body),
      service.adjust(home.context, cocAccountId, body),
    ]);
    const refused = results.filter((result) => result.status === 'rejected');
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(refused[0]?.reason).toMatchObject({ code: 'COC_INSUFFICIENT_BALANCE' });
    expect(await remaining(admin, cocAccountId, LIVE)).toBe('40');
  },
);

scenario(
  'keeps an adjustment off COC a future-dated use already claims',
  async ({ admin, suffix, home, evidence }) => {
    // The credit is already in effect, so only the future-dated use can refuse -30.
    const { cocAccountId } = await seedAccount(admin, home, suffix, []);
    await post(home, {
      cocAccountId,
      minutes: 100,
      effectiveDate: '2026-01-05',
      validUntil: LIVE,
      earnedMonth: new Date('2098-12-01'),
      sourceType: 'COC_EARNED_CERTIFICATE',
    });
    await post(home, {
      cocAccountId,
      minutes: -80,
      effectiveDate: '2090-01-05',
      validUntil: LIVE,
      sourceType: 'CTO_REQUEST',
    });
    const body = { reason: 'Overstated.', supportingDocumentVersionId: evidence };

    await expect(
      service.adjust(home.context, cocAccountId, { ...body, minutes: '-30', validUntil: LIVE }),
    ).rejects.toMatchObject({ code: 'COC_INSUFFICIENT_BALANCE' });
    await service.adjust(home.context, cocAccountId, { ...body, minutes: '-20', validUntil: LIVE });
    expect(await remaining(admin, cocAccountId, LIVE)).toBe('0');
  },
);
