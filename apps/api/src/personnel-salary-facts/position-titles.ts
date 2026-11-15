import type { Prisma } from '@prisma/client';

/**
 * One stretch of an Employee's primary Service Segment over which its
 * Plantilla Position carries one title. `positionTitle` is null where the
 * segment names no position or no position version covers the dates.
 */
export interface PositionTitleStretch {
  employeeId: string;
  from: string;
  to: string;
  serviceSegmentId: string;
  positionId: string | null;
  positionTitle: string | null;
}

const DAY_MS = 86_400_000;
const dateOf = (value: string) => new Date(`${value}T00:00:00.000Z`);
const isoDateOf = (value: Date) => value.toISOString().slice(0, 10);
const later = (a: Date, b: Date) => (a > b ? a : b);
const earlier = (a: Date, b: Date) => (a < b ? a : b);

/**
 * Personnel's read, for Payroll, of the title of the Plantilla Position each
 * Employee of the Agency holds from `from` through `to` (both inclusive ISO
 * dates), inside the caller's Agency transaction. It covers the dates of each
 * primary, non-voided Service Segment and splits them where the title
 * changes. A position keeps its earlier versions as `SUPERSEDED`; the latest
 * version covering a date describes the position on it.
 */
export async function readPositionTitlesInTransaction(
  transaction: Prisma.TransactionClient,
  agencyId: string,
  from: string,
  to: string,
): Promise<PositionTitleStretch[]> {
  const rangeFrom = dateOf(from);
  const rangeTo = dateOf(to);
  const overlapping = {
    effectiveFrom: { lte: rangeTo },
    OR: [{ effectiveTo: null }, { effectiveTo: { gte: rangeFrom } }],
  };
  const segments = await transaction.serviceSegment.findMany({
    where: {
      agencyId,
      segmentType: 'PRIMARY',
      status: { in: ['ACTIVE', 'CLOSED'] },
      ...overlapping,
    },
    orderBy: [{ employeeId: 'asc' }, { effectiveFrom: 'asc' }],
    select: {
      id: true,
      employeeId: true,
      positionId: true,
      effectiveFrom: true,
      effectiveTo: true,
    },
  });
  const positionIds = [...new Set(segments.flatMap((row) => row.positionId ?? []))];
  const versions = positionIds.length
    ? await transaction.plantillaPositionVersion.findMany({
        where: {
          agencyId,
          positionId: { in: positionIds },
          status: { in: ['ACTIVE', 'SUPERSEDED'] },
          ...overlapping,
        },
        orderBy: { versionNo: 'desc' },
        select: { positionId: true, positionTitle: true, effectiveFrom: true, effectiveTo: true },
      })
    : [];

  const stretches: PositionTitleStretch[] = [];
  for (const segment of segments) {
    const start = later(segment.effectiveFrom, rangeFrom);
    const end = segment.effectiveTo ? earlier(segment.effectiveTo, rangeTo) : rangeTo;
    const own = versions.filter((row) => row.positionId === segment.positionId);
    for (let day = start; day <= end; day = new Date(day.getTime() + DAY_MS)) {
      // The latest version covering the day describes the position on it.
      const positionTitle =
        own.find(
          (row) => row.effectiveFrom <= day && (row.effectiveTo === null || row.effectiveTo >= day),
        )?.positionTitle ?? null;
      const last = stretches.at(-1);
      if (
        last?.serviceSegmentId === segment.id &&
        last.positionTitle === positionTitle &&
        dateOf(last.to).getTime() + DAY_MS === day.getTime()
      ) {
        last.to = isoDateOf(day);
      } else {
        stretches.push({
          employeeId: segment.employeeId,
          from: isoDateOf(day),
          to: isoDateOf(day),
          serviceSegmentId: segment.id,
          positionId: segment.positionId,
          positionTitle,
        });
      }
    }
  }
  return stretches;
}
