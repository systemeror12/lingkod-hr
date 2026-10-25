import { Prisma } from '@prisma/client';

export const ATTENDANCE_WORK_DATE_LOCKED = 'ATTENDANCE_WORK_DATE_LOCKED';

export interface LockedWorkDate {
  workDate: string;
  periodCode: string;
}

/**
 * Find the first of these Work Dates that sits in a locked Attendance Period.
 * Ordinary recording never adds a source to a locked Work Date; Attendance
 * Correction owns those changes. Every covering period is held FOR SHARE, so a
 * concurrent period lock waits for the caller's write to commit.
 */
export async function findLockedWorkDate(
  transaction: Prisma.TransactionClient,
  agencyId: string,
  workDates: readonly string[],
): Promise<LockedWorkDate | null> {
  if (workDates.length === 0) return null;
  const sorted = [...workDates].sort();
  const periods = await transaction.$queryRaw<
    Array<{ code: string; status: string; dateFrom: string; dateTo: string }>
  >(
    Prisma.sql`SELECT "code", "status",
        to_char("date_from", 'YYYY-MM-DD') AS "dateFrom",
        to_char("date_to", 'YYYY-MM-DD') AS "dateTo"
      FROM "attendance_periods"
      WHERE "agency_id" = CAST(${agencyId} AS uuid)
        AND "date_from" <= CAST(${sorted[sorted.length - 1]} AS date)
        AND "date_to" >= CAST(${sorted[0]} AS date)
      ORDER BY "id"
      FOR SHARE`,
  );
  for (const workDate of sorted) {
    const period = periods.find(
      (candidate) =>
        candidate.status === 'FINALIZED' &&
        candidate.dateFrom <= workDate &&
        candidate.dateTo >= workDate,
    );
    if (period) return { workDate, periodCode: period.code };
  }
  return null;
}

export function lockedWorkDateMessage(locked: LockedWorkDate): string {
  return `Work Date ${locked.workDate} is in locked Attendance Period ${locked.periodCode}. Record this change through an Attendance Correction.`;
}
