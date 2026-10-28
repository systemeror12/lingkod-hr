/**
 * The national COC earning rule (JC 2, s. 2004 items 5.4–5.8; JC 2-A, s. 2005
 * item 2.0), fixed in code as ADR 0006 does for holidays. Quantities are
 * integer tenths of a minute, so certified whole minutes × 1.0 or × 1.5 stay
 * exact (ADR 0009) and the ledger stores them at one decimal place.
 */

/** Recorded on every award entry as the rule version it applied. */
export const COC_EARNING_RULE_CODE = 'JC2_2004_COC_EARNING';

/** The 40-hour monthly cap, after the ratio, across a month's approved certificates. */
export const MONTHLY_CAP_TENTHS = 2_400 * 10;

/** The 120-hour cap on the account's balance as of the approval date. */
export const BALANCE_CAP_TENTHS = 7_200 * 10;

/**
 * A certificate line's Work Date classification: its Day Rule, or the Holiday
 * Calendar classification that governs it. A CWW non-working day is `REST`.
 * A whole-day suspension is the Holiday Calendar's `WORK_SUSPENSION`; a
 * partial-day suspension is recorded as Attendance Context (ADR 0006).
 */
export const COC_DAY_CLASSIFICATIONS = [
  'WORKDAY',
  'SPECIAL_WORKING',
  'REST',
  'REGULAR_HOLIDAY',
  'SPECIAL_NON_WORKING',
  'LOCAL_HOLIDAY',
  'WORK_SUSPENSION',
  'PARTIAL_DAY_WORK_SUSPENSION',
] as const;
export type CocDayClassification = (typeof COC_DAY_CLASSIFICATIONS)[number];

/** No authority sets a ratio for service during a work suspension, so it earns none. */
export type CocEarningRefusalCode =
  'COC_WHOLE_DAY_WORK_SUSPENSION' | 'COC_PARTIAL_DAY_WORK_SUSPENSION';

export type CocEarning =
  { earns: true; cocTenths: number } | { earns: false; code: CocEarningRefusalCode };

/** Ratio in tenths: 1.0 on a scheduled workday, 1.5 on a rest day or non-working holiday. */
const RATIO_TENTHS: Record<CocDayClassification, number | CocEarningRefusalCode> = {
  WORKDAY: 10,
  SPECIAL_WORKING: 10,
  REST: 15,
  REGULAR_HOLIDAY: 15,
  SPECIAL_NON_WORKING: 15,
  LOCAL_HOLIDAY: 15,
  WORK_SUSPENSION: 'COC_WHOLE_DAY_WORK_SUSPENSION',
  PARTIAL_DAY_WORK_SUSPENSION: 'COC_PARTIAL_DAY_WORK_SUSPENSION',
};

/** The COC, before caps, that certified whole minutes earn on a classified Work Date. */
export function earnCoc(
  certifiedMinutes: number,
  classification: CocDayClassification,
): CocEarning {
  const ratio = RATIO_TENTHS[classification];
  if (typeof ratio === 'string') return { earns: false, code: ratio };
  return { earns: true, cocTenths: certifiedMinutes * ratio };
}

/** December 31 of the year after the earned month (`YYYY-MM-01`). */
export function cocValidUntil(earnedMonth: string): string {
  return `${Number(earnedMonth.slice(0, 4)) + 1}-12-31`;
}

export interface CocAwardLineCoc {
  certificateLineId: string;
  workDate: string;
  cocTenths: number;
}

export interface CocAwardLineAllocation extends CocAwardLineCoc {
  creditedTenths: number;
  excessTenths: number;
}

/**
 * Credit each line, in Work Date order, the least of its COC, the month's
 * remaining 2,400 minutes, and 7,200 minutes less the running balance. The
 * rest of the line's COC is excess, which stays certified but uncredited.
 */
export function allocateCocAward(
  lines: readonly CocAwardLineCoc[],
  monthCreditedTenths: number,
  balanceTenths: number,
): CocAwardLineAllocation[] {
  let month = monthCreditedTenths;
  let balance = balanceTenths;
  return inWorkDateOrder(lines).map((line) => {
    const creditedTenths = Math.max(
      0,
      Math.min(line.cocTenths, MONTHLY_CAP_TENTHS - month, BALANCE_CAP_TENTHS - balance),
    );
    month += creditedTenths;
    balance += creditedTenths;
    return { ...line, creditedTenths, excessTenths: line.cocTenths - creditedTenths };
  });
}

/** Lines by Work Date, then line id, so equal dates allocate deterministically. */
export function inWorkDateOrder<T extends { workDate: string; certificateLineId: string }>(
  lines: readonly T[],
): T[] {
  return [...lines].sort(
    (left, right) =>
      left.workDate.localeCompare(right.workDate) ||
      left.certificateLineId.localeCompare(right.certificateLineId),
  );
}

/** Tenths of a minute as the ledger's one-decimal string, e.g. `135` → `"13.5"`. */
export function formatCocMinutes(tenths: number): string {
  const sign = tenths < 0 ? '-' : '';
  const magnitude = Math.abs(tenths);
  return `${sign}${Math.trunc(magnitude / 10)}.${magnitude % 10}`;
}
