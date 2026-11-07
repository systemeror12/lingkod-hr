import type { CocAvailable, CocDraw } from '../coc-accounts/coc-accounts.types';
import { CtoRequestError, type CtoRequestDateSummary } from './cto-requests.types';

/** The calendar dates strictly between two `YYYY-MM-DD` dates, earliest first. */
export function* datesBetween(from: string, to: string): Generator<string> {
  const date = new Date(`${from}T00:00:00.000Z`);
  for (;;) {
    date.setUTCDate(date.getUTCDate() + 1);
    const value = date.toISOString().slice(0, 10);
    if (value >= to) return;
    yield value;
  }
}

/** One Work Date draws from at most two Valid Until dates (ADR 0009). */
const MAX_DRAWS_PER_WORK_DATE = 2;

/**
 * Draw the dates' charges from the available COC, in Work Date order: each draws
 * first from the earliest-expiring COC still valid on it (hris-controls, COC Ledger
 * Entry). COC past its Valid Until never covers a date, and what an earlier date
 * draws is gone for later ones. `uncovered` names the first date the COC can't cover,
 * and the draws then stop.
 */
export function drawCtoUsage(
  available: readonly CocAvailable[],
  dates: readonly { workDate: string; chargedMinutes: number }[],
): { draws: CocDraw[]; uncovered: string | null } {
  const remaining = [...available]
    .sort((left, right) => left.validUntil.localeCompare(right.validUntil))
    .map((bucket) => ({ ...bucket }));
  const draws: CocDraw[] = [];
  for (const { workDate, chargedMinutes } of [...dates].sort((left, right) =>
    left.workDate.localeCompare(right.workDate),
  )) {
    let due = chargedMinutes * 10;
    const sources = remaining
      .filter((bucket) => bucket.validUntil >= workDate && bucket.tenths > 0)
      .slice(0, MAX_DRAWS_PER_WORK_DATE);
    for (const bucket of sources) {
      const tenths = Math.min(due, bucket.tenths);
      if (tenths === 0) break;
      bucket.tenths -= tenths;
      due -= tenths;
      draws.push({ workDate, validUntil: bucket.validUntil, tenths });
    }
    if (due > 0) return { draws, uncovered: workDate };
  }
  return { draws, uncovered: null };
}

/** The first Work Date the available COC can't cover, or null. */
export function firstUncoveredWorkDate(
  available: readonly CocAvailable[],
  dates: readonly { workDate: string; chargedMinutes: number }[],
): string | null {
  return drawCtoUsage(available, dates).uncovered;
}

/**
 * The request's dates a cancellation takes, in Work Date order: the named ones, or
 * every uncancelled one when none are named. A named date must be on the request and
 * not already cancelled.
 */
export function datesToCancel<
  T extends Pick<CtoRequestDateSummary, 'workDate' | 'cancelledByCtoCancellationId'>,
>(dates: readonly T[], workDates: readonly string[] | undefined): T[] {
  const uncancelled = dates.filter((date) => date.cancelledByCtoCancellationId === null);
  if (!workDates) return uncancelled;
  for (const workDate of workDates) {
    const date = dates.find((candidate) => candidate.workDate === workDate);
    if (!date) {
      throw new CtoRequestError(
        `${workDate} is not a Work Date of this CTO Request.`,
        422,
        'CTO_WORK_DATE_NOT_ON_REQUEST',
      );
    }
    if (date.cancelledByCtoCancellationId !== null) {
      throw new CtoRequestError(
        `The CTO on ${workDate} is already cancelled.`,
        409,
        'CTO_WORK_DATE_ALREADY_CANCELLED',
      );
    }
  }
  return uncancelled.filter((date) => workDates.includes(date.workDate));
}
