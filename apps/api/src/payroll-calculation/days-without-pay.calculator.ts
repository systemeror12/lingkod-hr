import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  type CompensationBasis,
  type CompensationBasisStretch,
  WORKING_DAYS_PER_MONTH,
} from '../compensation-basis/compensation-basis.service';
import {
  blocking,
  type CalculatedException,
  type CalculatedLine,
  type CalculationContext,
  type CalculatorOutcome,
  type EmployeePayrollSources,
  type LineSourceRecord,
  type PayrollCalculator,
} from './payroll-calculator';
import type { TaxTreatment } from './year-end-bonus.calculator';

export const DAYS_WITHOUT_PAY_COMPONENT_CODE = 'DAYS_WITHOUT_PAY';

const LWOP_AUTHORITY =
  'CSC MC No. 8, s. 2014: SALARY = NO. OF DAYS PAID STATUS X MONTHLY SALARY / 22 DAYS';
const FRACTIONAL_DAY_SALARY_RULE = 'FRACTIONAL_DAY_SALARY_RULE';
const FRACTIONAL_DAY_GAP =
  'No recorded authority values a fraction of a day without pay: CSC MC No. 8, s. 2014 counts days without pay, and MC 41 Table II converts minutes to fractions of a day only to charge leave credits (#329, #341).';

/** One Work Date's days without pay and the source behind them. */
interface DayEntry {
  workDate: string;
  days: Prisma.Decimal;
  kind: 'LEAVE_WITHOUT_PAY' | 'ABSENCE';
  sources: LineSourceRecord[];
  publicationId?: string;
}

/**
 * The Work Dates and day quantities a `LEAVE_WITHOUT_PAY` input's payload
 * freezes (payroll-schema.md §4), or null when the payload cannot be read.
 */
export function leaveWithoutPayDays(
  payload: unknown,
): { unitCode: string; workDates: { workDate: string; quantity: string }[] } | null {
  if (payload === null || typeof payload !== 'object') return null;
  const { unitCode, workDates } = payload as Record<string, unknown>;
  if (typeof unitCode !== 'string' || !Array.isArray(workDates) || workDates.length === 0) {
    return null;
  }
  const parsed: { workDate: string; quantity: string }[] = [];
  for (const entry of workDates as unknown[]) {
    if (entry === null || typeof entry !== 'object') return null;
    const { workDate, quantity } = entry as Record<string, unknown>;
    if (typeof workDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(workDate)) return null;
    if (typeof quantity !== 'string' || !/^\d+(\.\d+)?$/.test(quantity)) return null;
    parsed.push({ workDate, quantity });
  }
  return { unitCode, workDates: parsed };
}

/**
 * Salary for days without pay (BRD PAY-004): leave without pay from Leave's
 * Payroll Inputs and whole-day `ABSENCE` from Attendance (MC 41 sections 50
 * and 56), less basic salary as `days × monthly salary ÷ 22` (CSC MC No. 8,
 * s. 2014). One `DEDUCTION` line per calendar month and salary in effect, so a
 * June day deducted in July is valued at June's salary (ADR 0014); each line
 * rests on the inputs and facts behind it. With the basic salary line, paid
 * salary for a month is `(22 − days) / 22 × monthly salary`.
 *
 * An adjustment publication's facts count as their own deltas, so a withdrawn
 * absence that a finalized payroll deducted is a negative line. Payroll never
 * deducts `TARDINESS` or `UNDERTIME` facts: Leave charges them (ADR 0012).
 * Every case no recorded rule settles blocks and writes no line:
 *
 * - an Unpaid Deficit Remainder, or an absence of part of a day: no authority
 *   values a fraction of a day without pay;
 * - a deficit fact Leave has not charged (ADR 0012);
 * - leave without pay counted in calendar days, which include days outside
 *   MC 8's 22-workday month;
 * - more than 22 days in one month, which the formula would make negative pay;
 * - a Work Date whose compensation basis is `INDETERMINATE`, or is a casual
 *   daily wage, which has no monthly salary;
 * - an amount that is not whole centavos, which no recorded rule rounds.
 */
@Injectable()
export class DaysWithoutPayCalculator implements PayrollCalculator {
  calculate(
    basis: CompensationBasis,
    _context: CalculationContext,
    _earlierLines: readonly CalculatedLine[],
    sources: EmployeePayrollSources,
  ): CalculatorOutcome {
    const exceptions: CalculatedException[] = [];
    const entries: DayEntry[] = [];

    const remainders = sources.payrollInputs.filter(
      (input) => input.inputKind === 'UNPAID_DEFICIT_REMAINDER',
    );
    if (remainders.length > 0) {
      exceptions.push(
        blocking(
          'UNPAID_DEFICIT_REMAINDER_SALARY_RULE_UNSETTLED',
          `${remainders.length} Unpaid Deficit Remainder input${remainders.length === 1 ? '' : 's'} from Leave cannot be valued. ${FRACTIONAL_DAY_GAP}`,
          {
            missingFacts: [FRACTIONAL_DAY_SALARY_RULE],
            payrollInputs: remainders.map(({ id, effectiveDate, quantity }) => ({
              payrollInputId: id,
              workDate: effectiveDate,
              quantity,
            })),
          },
        ),
      );
    }

    if (sources.unchargedDeficitFacts.length > 0) {
      const facts = sources.unchargedDeficitFacts;
      exceptions.push(
        blocking(
          'ATTENDANCE_DEFICIT_UNCHARGED',
          `Leave has not charged ${facts.length} tardiness or undertime fact${facts.length === 1 ? '' : 's'}: ${[
            ...new Set(facts.map((fact) => fact.reason.message)),
          ].join(' ')} Payroll cannot settle the Employee until each is charged (ADR 0012).`,
          {
            facts: facts.map((fact) => ({
              attendancePayrollPublicationId: fact.publicationId,
              attendancePayrollFactId: fact.attendancePayrollFactId,
              workDate: fact.workDate,
              deficitType: fact.deficitType,
              minutes: fact.minutes,
              reason: fact.reason,
            })),
          },
        ),
      );
    }

    for (const input of sources.payrollInputs) {
      if (input.inputKind !== 'LEAVE_WITHOUT_PAY') continue;
      const refusal = leaveWithoutPayRefusal(input);
      if (refusal) {
        exceptions.push(refusal);
        continue;
      }
      for (const { workDate, quantity } of leaveWithoutPayDays(input.payloadSnapshot)!.workDates) {
        entries.push({
          workDate,
          days: new Prisma.Decimal(quantity),
          kind: 'LEAVE_WITHOUT_PAY',
          sources: [{ payrollInputId: input.id }],
        });
      }
    }

    const absence = absenceEntries(sources);
    entries.push(...absence.entries);
    if (absence.partial.length > 0) {
      exceptions.push(
        blocking(
          'ABSENCE_PARTIAL_DAY_SALARY_RULE_UNSETTLED',
          `Absence of part of a Work Date on ${absence.partial.map((day) => day.workDate).join(', ')} cannot be valued. ${FRACTIONAL_DAY_GAP}`,
          { missingFacts: [FRACTIONAL_DAY_SALARY_RULE], workDates: absence.partial },
        ),
      );
    }

    const valued = valueByMonth(entries, [basis, ...sources.valuationBases]);
    return {
      lines: valued.lines,
      exceptions: [...exceptions, ...valued.exceptions],
    };
  }
}

function leaveWithoutPayRefusal(input: EmployeePayrollSources['payrollInputs'][number]) {
  const parsed = leaveWithoutPayDays(input.payloadSnapshot);
  const total = parsed?.workDates.reduce(
    (sum, { quantity }) => sum.add(quantity),
    new Prisma.Decimal(0),
  );
  if (!parsed || input.quantity === null || !total?.equals(input.quantity)) {
    return blocking(
      'LEAVE_WITHOUT_PAY_INPUT_UNREADABLE',
      `The leave without pay input from ${input.effectiveDate} does not freeze a day quantity for each Work Date that adds up to its ${input.quantity ?? 'missing'} days.`,
      { payrollInputId: input.id },
    );
  }
  if (parsed.unitCode !== 'WORKING_DAY') {
    return blocking(
      'LEAVE_WITHOUT_PAY_CALENDAR_DAYS_UNSETTLED',
      `The leave without pay from ${input.effectiveDate} is counted in ${parsed.unitCode} units. CSC MC No. 8, s. 2014 values days without pay against 22 workdays a month, exclusive of Saturdays and Sundays, and no recorded rule says how calendar days count against them.`,
      { payrollInputId: input.id, unitCode: parsed.unitCode },
    );
  }
  const fractional = parsed.workDates.filter(
    ({ quantity }) => !new Prisma.Decimal(quantity).equals(1),
  );
  if (fractional.length > 0) {
    return blocking(
      'LEAVE_WITHOUT_PAY_FRACTIONAL_DAY_UNSETTLED',
      `The leave without pay from ${input.effectiveDate} has less or more than one day on ${fractional.map(({ workDate }) => workDate).join(', ')}. ${FRACTIONAL_DAY_GAP}`,
      {
        payrollInputId: input.id,
        missingFacts: [FRACTIONAL_DAY_SALARY_RULE],
        workDates: fractional,
      },
    );
  }
  return null;
}

/**
 * Whole days of absence, one entry per publication and Work Date. A fact
 * counts as its delta, `corrected − prior`, so an original publication counts
 * its minutes and an adjustment only its change. A delta of the Work Date's
 * whole expected duty is one day either way; any other nonzero delta is part
 * of a day.
 */
function absenceEntries(sources: EmployeePayrollSources) {
  const groups = new Map<string, EmployeePayrollSources['absenceFacts']>();
  for (const fact of sources.absenceFacts) {
    const key = `${fact.publicationId}|${fact.workDate}`;
    groups.set(key, [...(groups.get(key) ?? []), fact]);
  }
  const entries: DayEntry[] = [];
  const partial: {
    workDate: string;
    publicationId: string;
    deltaMinutes: number;
    expectedMinutes: number;
  }[] = [];
  for (const facts of groups.values()) {
    const [first] = facts;
    if (!first) continue;
    const delta = facts.reduce(
      (sum, fact) => sum + fact.correctedMinutes - (fact.priorMinutes ?? 0),
      0,
    );
    if (delta === 0) continue;
    const expected = facts.every((fact) => fact.expectedMinutes === first.expectedMinutes)
      ? first.expectedMinutes
      : 0;
    if (expected > 0 && Math.abs(delta) === expected) {
      entries.push({
        workDate: first.workDate,
        days: new Prisma.Decimal(Math.sign(delta)),
        kind: 'ABSENCE',
        sources: facts.map((fact) => ({ attendancePayrollFactId: fact.id })),
        publicationId: first.publicationId,
      });
    } else {
      partial.push({
        workDate: first.workDate,
        publicationId: first.publicationId,
        deltaMinutes: delta,
        expectedMinutes: first.expectedMinutes,
      });
    }
  }
  return { entries, partial };
}

/**
 * One line per calendar month and salary in effect on its Work Dates. A
 * month's days net across sources, so an adjustment that withdraws a day
 * offsets it, and a month that nets to zero writes no line.
 */
function valueByMonth(
  entries: readonly DayEntry[],
  bases: readonly CompensationBasis[],
): CalculatorOutcome {
  const groups = new Map<string, { stretch: CompensationBasisStretch; entries: DayEntry[] }>();
  const indeterminate = new Set<string>();
  const casual = new Set<string>();
  for (const entry of [...entries].sort(byWorkDate)) {
    const stretch = stretchOn(bases, entry.workDate);
    if (!stretch) {
      throw new Error(`No compensation basis was resolved for ${entry.workDate}.`);
    }
    if (stretch.status === 'INDETERMINATE') {
      indeterminate.add(entry.workDate);
      continue;
    }
    if (stretch.rate.monthlyRate === null) {
      casual.add(entry.workDate);
      continue;
    }
    const key = [
      entry.workDate.slice(0, 7),
      stretch.salarySchedule.ruleVersionId,
      stretch.personnel.payBasis,
      stretch.personnel.employmentFraction,
      stretch.rate.monthlyRate,
    ].join('|');
    const group = groups.get(key) ?? { stretch, entries: [] };
    group.entries.push(entry);
    groups.set(key, group);
  }

  const exceptions: CalculatedException[] = [];
  if (indeterminate.size > 0) {
    exceptions.push(
      blocking(
        'DAYS_WITHOUT_PAY_BASIS_INDETERMINATE',
        `The compensation basis is INDETERMINATE on ${[...indeterminate].join(', ')}, so no monthly salary values those days without pay.`,
        { workDates: [...indeterminate] },
      ),
    );
  }
  if (casual.size > 0) {
    exceptions.push(
      blocking(
        'DAYS_WITHOUT_PAY_CASUAL_UNSETTLED',
        `The casual daily wage on ${[...casual].join(', ')} has no monthly salary, and no recorded rule values its days without pay.`,
        { workDates: [...casual] },
      ),
    );
  }

  const lines: CalculatedLine[] = [];
  for (const { stretch, entries: monthEntries } of groups.values()) {
    if (stretch.status !== 'RESOLVED' || stretch.rate.monthlyRate === null) continue;
    const month = monthEntries[0]!.workDate.slice(0, 7);
    const days = monthEntries.reduce((sum, entry) => sum.add(entry.days), new Prisma.Decimal(0));
    if (days.isZero()) continue;
    if (days.abs().greaterThan(WORKING_DAYS_PER_MONTH)) {
      exceptions.push(
        blocking(
          'DAYS_WITHOUT_PAY_EXCEED_MONTH',
          `${days.toString()} days without pay in ${month} exceed the 22 days of CSC MC No. 8, s. 2014, and no recorded rule settles a month past them.`,
          { month, days: days.toFixed(4) },
        ),
      );
      continue;
    }
    const monthlyRate = new Prisma.Decimal(stretch.rate.monthlyRate);
    const amount = days.mul(monthlyRate).div(WORKING_DAYS_PER_MONTH);
    if (!amount.equals(amount.toDecimalPlaces(2))) {
      exceptions.push(
        blocking(
          'DAYS_WITHOUT_PAY_ROUNDING_UNSETTLED',
          `${days.toString()} days × ${stretch.rate.monthlyRate} ÷ 22 for ${month} is not a whole number of centavos, and no recorded rule rounds it.`,
          { month, days: days.toFixed(4), monthlyRate: stretch.rate.monthlyRate },
        ),
      );
      continue;
    }
    const sourceRecords = uniqueSources(monthEntries);
    lines.push({
      componentCode: DAYS_WITHOUT_PAY_COMPONENT_CODE,
      lineType: 'DEDUCTION',
      ruleVersionId: stretch.salarySchedule.ruleVersionId,
      quantity: days.toFixed(4),
      rate: monthlyRate.toFixed(8),
      amount: amount.toFixed(4),
      source: {
        unit: 'DAY',
        month,
        formula: 'quantity × monthly salary ÷ 22',
        taxTreatment: 'REGULAR_COMPENSATION' satisfies TaxTreatment,
        authority: LWOP_AUTHORITY,
        payBasis: stretch.personnel.payBasis,
        employmentFraction: stretch.personnel.employmentFraction,
        salaryGrade: stretch.personnel.salaryGrade,
        salaryStep: stretch.personnel.salaryStep,
        serviceSegmentId: stretch.personnel.serviceSegmentId,
        salarySchedule: {
          ruleVersionId: stretch.salarySchedule.ruleVersionId,
          ruleVersionCode: stretch.salarySchedule.ruleVersionCode,
          monthlyRate: stretch.salarySchedule.monthlyRate,
        },
        derivation: stretch.rate.derivation,
        days: monthEntries.map((entry) => ({
          workDate: entry.workDate,
          days: entry.days.toFixed(4),
          kind: entry.kind,
          sources: entry.sources,
          ...(entry.publicationId ? { attendancePayrollPublicationId: entry.publicationId } : {}),
        })),
      },
      sourceRecords,
    });
  }
  return { lines, exceptions };
}

function stretchOn(bases: readonly CompensationBasis[], workDate: string) {
  for (const basis of bases) {
    const stretch = basis.stretches.find(({ from, to }) => from <= workDate && workDate <= to);
    if (stretch) return stretch;
  }
  return null;
}

function uniqueSources(entries: readonly DayEntry[]): LineSourceRecord[] {
  const seen = new Map<string, LineSourceRecord>();
  for (const record of entries.flatMap((entry) => entry.sources)) {
    const key =
      'payrollInputId' in record
        ? `input:${record.payrollInputId}`
        : `fact:${record.attendancePayrollFactId}`;
    seen.set(key, record);
  }
  return [...seen.values()];
}

const byWorkDate = (left: DayEntry, right: DayEntry) =>
  left.workDate < right.workDate ? -1 : left.workDate > right.workDate ? 1 : 0;
