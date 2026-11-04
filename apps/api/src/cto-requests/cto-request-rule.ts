import type { CocAvailable } from '../coc-accounts/coc-accounts.types';

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

/**
 * The first Work Date the available COC can't cover, or null. Walks the dates in
 * order, each drawing first from the earliest-expiring COC still valid on it
 * (hris-controls, COC Ledger Entry). COC past its Valid Until never covers a date,
 * and what an earlier date draws is gone for later ones.
 */
export function firstUncoveredWorkDate(
  available: readonly CocAvailable[],
  dates: readonly { workDate: string; chargedMinutes: number }[],
): string | null {
  const remaining = [...available]
    .sort((left, right) => left.validUntil.localeCompare(right.validUntil))
    .map((bucket) => ({ ...bucket }));
  for (const { workDate, chargedMinutes } of [...dates].sort((left, right) =>
    left.workDate.localeCompare(right.workDate),
  )) {
    let due = chargedMinutes * 10;
    for (const bucket of remaining) {
      if (bucket.validUntil < workDate || bucket.tenths <= 0) continue;
      const drawn = Math.min(due, bucket.tenths);
      bucket.tenths -= drawn;
      due -= drawn;
      if (due === 0) break;
    }
    if (due > 0) return workDate;
  }
  return null;
}
