import { Prisma } from '@prisma/client';
import { expect, it } from 'vitest';
import {
  leaveAccountAuditWriter,
  LeaveAccountsService,
  type PostedLeaveDayCoverage,
} from './leave-accounts.service';

interface EntryRow {
  id: string;
  leaveAccountId: string;
  quantity: Prisma.Decimal;
  sourceId: string;
  policyVersionId: string;
}

interface VersionRow {
  id: string;
  leaveApplicationId: string;
}

interface SegmentRow {
  requestedUnit: string;
}

function service(): LeaveAccountsService {
  return new LeaveAccountsService(leaveAccountAuditWriter, {} as never);
}

function transactionWith(values: {
  entries: EntryRow[];
  versions: VersionRow[];
  segments: SegmentRow[];
}): Prisma.TransactionClient {
  return {
    leaveLedgerEntry: { findMany: async () => values.entries },
    leaveApplicationVersion: {
      findFirst: async ({ where }: { where: { id: string } }) =>
        values.versions.find((version) => version.id === where.id) ?? null,
    },
    leaveCalculationSegment: { findMany: async () => values.segments },
  } as unknown as Prisma.TransactionClient;
}

function entry(overrides: Partial<EntryRow> = {}): EntryRow {
  return {
    id: 'e1',
    leaveAccountId: 'a1',
    quantity: new Prisma.Decimal(1),
    sourceId: 'v1',
    policyVersionId: 'p1',
    ...overrides,
  };
}

async function coverageFor(values: {
  entries: EntryRow[];
  versions: VersionRow[];
  segments: SegmentRow[];
}): Promise<PostedLeaveDayCoverage[]> {
  return service().postedLeaveCoverageInTransaction(
    transactionWith(values),
    'agency-1',
    'employee-1',
    '2026-01-02',
  );
}

const version: VersionRow = { id: 'v1', leaveApplicationId: 'app-1' };

it('maps a whole-day working-day posting to whole Work Date coverage', async () => {
  const coverage = await coverageFor({
    entries: [entry()],
    versions: [version],
    segments: [{ requestedUnit: 'WORKING_DAY' }],
  });

  expect(coverage).toEqual([
    {
      ledgerEntryId: 'e1',
      leaveAccountId: 'a1',
      leaveApplicationId: 'app-1',
      policyVersionId: 'p1',
      quantity: 1,
      wholeDay: true,
      ambiguousReason: null,
    },
  ]);
});

it('reports a posting that carries no clock placement as ambiguous', async () => {
  const scheduled = await coverageFor({
    entries: [entry()],
    versions: [version],
    segments: [{ requestedUnit: 'SCHEDULED_TIME' }],
  });
  expect(scheduled[0]?.wholeDay).toBe(false);
  expect(scheduled[0]?.ambiguousReason).toMatch(/clock placement/);

  const partial = await coverageFor({
    entries: [entry({ quantity: new Prisma.Decimal('0.5') })],
    versions: [version],
    segments: [{ requestedUnit: 'CALENDAR_DAY' }],
  });
  expect(partial[0]?.wholeDay).toBe(false);
  expect(partial[0]?.ambiguousReason).toMatch(/fraction of the Work Date/);
});

it('reports a posting without one matching Leave Calculation Segment as ambiguous', async () => {
  const missingVersion = await coverageFor({
    entries: [entry()],
    versions: [],
    segments: [{ requestedUnit: 'WORKING_DAY' }],
  });
  expect(missingVersion[0]?.ambiguousReason).toMatch(/no Leave Application Version/);

  const noSegment = await coverageFor({
    entries: [entry()],
    versions: [version],
    segments: [],
  });
  expect(noSegment[0]?.ambiguousReason).toMatch(/no unique accepted Leave Calculation Segment/);
});

it('reads no coverage when the Work Date has no posted leave', async () => {
  expect(await coverageFor({ entries: [], versions: [], segments: [] })).toEqual([]);
});
