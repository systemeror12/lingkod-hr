import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CompensationBasis } from '../compensation-basis/compensation-basis.service';
import {
  isInEffectOn,
  overtimePayParameters,
  type NationalPayrollRuleKind,
} from '../payroll-rule-versions/national-payroll-rule-versions';
import {
  blocking,
  type CalculatedException,
  type CalculatedLine,
  type CalculationContext,
  type CalculatorOutcome,
  type EmployeePayrollSources,
  type PayrollCalculator,
  type PendingPayrollInput,
} from './payroll-calculator';
import type { TaxTreatment } from './year-end-bonus.calculator';

export const OVERTIME_PAY_COMPONENT_CODE = 'OVERTIME_PAY';
export const OVERTIME_PAY_RULE_KIND: NationalPayrollRuleKind = 'OVERTIME_PAY';
/** The Payroll Input Overtime posts for certified service under an `OVERTIME_PAY` authority (#347). */
export const OVERTIME_HOURS_INPUT_KIND = 'OVERTIME_HOURS';

const AUTHORITY = 'CSC-DBM JC No. 2, s. 2015';

/**
 * The premium each Work Date classification Overtime records pays, from the
 * research day-type map: a scheduled workday, and a special working day as
 * one, at the workday premium; a Day Rule rest day (a CWW non-working day
 * among them), a regular holiday, a special non-working day, and a local
 * holiday at the non-workday premium. No source sets one for a whole-day work
 * suspension.
 */
const DAY_CLASSES: Record<string, 'WORKDAY' | 'NON_WORKDAY'> = {
  WORKDAY: 'WORKDAY',
  SPECIAL_WORKING: 'WORKDAY',
  REST_DAY: 'NON_WORKDAY',
  REGULAR_HOLIDAY: 'NON_WORKDAY',
  SPECIAL_NON_WORKING: 'NON_WORKDAY',
  LOCAL_HOLIDAY: 'NON_WORKDAY',
};

interface OvertimeHours {
  certifiedMinutes: number;
  dayClassification: string | null;
  workDate: string;
  overtimeAuthorityId: unknown;
  authorityNo: unknown;
}

/**
 * The certified minutes, day classification, and Work Date an
 * `OVERTIME_HOURS` input's payload freezes (payroll-schema.md §4), or null
 * when they do not agree with the input's own quantity and date.
 */
export function overtimeHours(input: PendingPayrollInput): OvertimeHours | null {
  const payload = input.payloadSnapshot;
  if (payload === null || typeof payload !== 'object') return null;
  const { quantityUnit, certifiedMinutes, dayClassification, workDate, ...rest } =
    payload as Record<string, unknown>;
  if (
    quantityUnit !== 'MINUTE' ||
    !Number.isInteger(certifiedMinutes) ||
    (certifiedMinutes as number) <= 0 ||
    input.quantity === null ||
    !new Prisma.Decimal(input.quantity).equals(certifiedMinutes as number) ||
    workDate !== input.effectiveDate ||
    (dayClassification !== null && typeof dayClassification !== 'string')
  ) {
    return null;
  }
  return {
    certifiedMinutes: certifiedMinutes as number,
    dayClassification,
    workDate,
    overtimeAuthorityId: rest.overtimeAuthorityId ?? null,
    authorityNo: rest.authorityNo ?? null,
  };
}

/**
 * Overtime pay (CSC-DBM JC No. 2, s. 2015): one taxable `EARNING` line for each
 * `OVERTIME_HOURS` Payroll Input, resting on that input. Its Certified
 * Overtime Hours are paid at the monthly salary on the Work Date ÷ 22 ÷ 8 an
 * hour (item 9.3), times 125% on a scheduled workday or 150% on a rest day,
 * holiday, or special non-working day (item 9.4), all from the rule version in
 * effect on the Work Date. A non-workday pays at most 12 hours; the circular
 * sends the excess to CTO (item 10.5), which Payroll cannot grant, so the
 * excess is unpaid and a warning names it. The annual caps of items 10.6 and
 * 10.7 span periods and the Agency, so `OvertimePayCapsCheck` judges them once
 * the lines are stored.
 *
 * An input is paid once: the calculation reads only `PENDING` inputs, each
 * gives at most one line, and finalization consumes the inputs its lines rest
 * on (ADR 0014). Every case the recorded rules do not settle blocks and writes
 * no line:
 *
 * - no rule version in effect on the Work Date in the period's snapshot;
 * - a payload whose minutes or Work Date disagree with the input;
 * - a whole-day work suspension, or a classification the research does not map;
 * - an `INDETERMINATE` basis on the Work Date, part-time service, which the
 *   circular does not cover, or a casual daily wage, which has no monthly salary;
 * - an amount that is not whole centavos, which no recorded rule rounds.
 */
@Injectable()
export class OvertimePayCalculator implements PayrollCalculator {
  calculate(
    basis: CompensationBasis,
    context: CalculationContext,
    _earlierLines: readonly CalculatedLine[],
    sources: EmployeePayrollSources,
  ): CalculatorOutcome {
    const lines: CalculatedLine[] = [];
    const exceptions: CalculatedException[] = [];
    const bases = [basis, ...sources.valuationBases];
    for (const input of sources.payrollInputs) {
      if (input.inputKind !== OVERTIME_HOURS_INPUT_KIND) continue;
      const outcome = payInput(input, bases, context);
      lines.push(...outcome.lines);
      exceptions.push(...outcome.exceptions);
    }
    return { lines, exceptions };
  }
}

function payInput(
  input: PendingPayrollInput,
  bases: readonly CompensationBasis[],
  context: CalculationContext,
): CalculatorOutcome {
  const inputRef = { payrollInputId: input.id, workDate: input.effectiveDate };
  const hours = overtimeHours(input);
  if (!hours) {
    return refuse(
      'OVERTIME_PAY_INPUT_UNREADABLE',
      `The overtime input from ${input.effectiveDate} does not freeze whole certified minutes and a Work Date that match its quantity of ${input.quantity ?? 'none'} and its date.`,
      inputRef,
    );
  }
  const { workDate, dayClassification } = hours;
  if (dayClassification === 'WORK_SUSPENSION') {
    return refuse(
      'OVERTIME_PAY_WORK_SUSPENSION_UNSETTLED',
      `Overtime on ${workDate} was rendered on a whole-day work suspension. ${AUTHORITY} names no premium for it, and no recorded rule sets one.`,
      inputRef,
    );
  }
  const dayClass =
    dayClassification !== null && Object.hasOwn(DAY_CLASSES, dayClassification)
      ? DAY_CLASSES[dayClassification]
      : undefined;
  if (!dayClass) {
    return refuse(
      'OVERTIME_PAY_DAY_CLASSIFICATION_UNSETTLED',
      `Overtime on ${workDate} is classified ${dayClassification ?? 'nowhere'}, and no recorded rule sets its premium.`,
      { ...inputRef, dayClassification },
    );
  }

  const version = context.snapshotRuleVersions.find(
    (candidate) =>
      candidate.ruleKind === OVERTIME_PAY_RULE_KIND && isInEffectOn(candidate, workDate),
  );
  if (!version) {
    return refuse(
      'OVERTIME_PAY_RULE_NOT_IN_EFFECT',
      `The period's rule snapshot holds no ${OVERTIME_PAY_RULE_KIND} version in effect on ${workDate}, so its overtime is not paid.`,
      { ...inputRef, ruleKind: OVERTIME_PAY_RULE_KIND },
    );
  }
  const parameters = overtimePayParameters.parse(version.parameters);

  const stretch = bases
    .flatMap((basis) => basis.stretches)
    .find(({ from, to }) => from <= workDate && workDate <= to);
  if (!stretch) throw new Error(`No compensation basis was resolved for ${workDate}.`);
  if (stretch.status === 'INDETERMINATE') {
    return refuse(
      'OVERTIME_PAY_BASIS_INDETERMINATE',
      `The compensation basis is INDETERMINATE on ${workDate}, so no monthly salary values its overtime.`,
      { ...inputRef, reasons: stretch.reasons },
    );
  }
  if (stretch.personnel.payBasis === 'PART_TIME_PROPORTIONAL') {
    return refuse(
      'OVERTIME_PAY_PART_TIME_UNSETTLED',
      `The Employee serves part-time on ${workDate}. ${AUTHORITY} items 8.2 and 9.3 define the overtime period and hourly rate only for a full-time employee, and no recorded rule covers part-time service.`,
      { ...inputRef, employmentFraction: stretch.personnel.employmentFraction },
    );
  }
  const monthlyRate = stretch.rate.monthlyRate;
  if (monthlyRate === null) {
    return refuse(
      'OVERTIME_PAY_CASUAL_DAILY_WAGE_UNSETTLED',
      `The Employee is paid a casual daily wage on ${workDate}. ${AUTHORITY} item 9.3 sets the hourly rate from a monthly salary, and no recorded rule sets it from a daily wage.`,
      inputRef,
    );
  }

  const exceptions: CalculatedException[] = [];
  const limitMinutes = parameters.nonWorkdayPaidHoursLimit * 60;
  const paidMinutes =
    dayClass === 'NON_WORKDAY'
      ? Math.min(hours.certifiedMinutes, limitMinutes)
      : hours.certifiedMinutes;
  if (paidMinutes < hours.certifiedMinutes) {
    exceptions.push({
      exceptionType: 'OVERTIME_PAY_NON_WORKDAY_HOURS_EXCEEDED',
      severity: 'WARNING',
      details: {
        message: `${hours.certifiedMinutes} certified minutes on ${workDate}, a ${dayClassification} day, exceed the ${parameters.nonWorkdayPaidHoursLimit} hours ${AUTHORITY} item 10.5 pays on a non-workday. ${limitMinutes} minutes are paid; the circular compensates the other ${hours.certifiedMinutes - limitMinutes} through CTO, which Payroll does not grant.`,
        ...inputRef,
        certifiedMinutes: hours.certifiedMinutes,
        paidMinutes,
      },
    });
  }

  const premium = dayClass === 'WORKDAY' ? parameters.workdayPremium : parameters.nonWorkdayPremium;
  const minutesPerMonth = parameters.workingDaysPerMonth * parameters.workHoursPerDay * 60;
  const amount = new Prisma.Decimal(paidMinutes).mul(monthlyRate).mul(premium).div(minutesPerMonth);
  if (!amount.equals(amount.toDecimalPlaces(2))) {
    return refuse(
      'OVERTIME_PAY_ROUNDING_UNSETTLED',
      `${paidMinutes} minutes on ${workDate} at ${monthlyRate} ÷ ${parameters.workingDaysPerMonth} ÷ ${parameters.workHoursPerDay} an hour × ${premium} is ${amount.toString()}, not a whole number of centavos, and no recorded rule rounds overtime pay.`,
      { ...inputRef, paidMinutes, monthlyRate, premium },
    );
  }

  return {
    lines: [
      {
        componentCode: OVERTIME_PAY_COMPONENT_CODE,
        lineType: 'EARNING',
        ruleVersionId: version.id,
        quantity: new Prisma.Decimal(paidMinutes).toFixed(4),
        rate: new Prisma.Decimal(monthlyRate).toFixed(8),
        amount: amount.toFixed(4),
        source: {
          unit: 'MINUTE',
          workDate,
          dayClassification,
          certifiedMinutes: hours.certifiedMinutes,
          paidMinutes,
          premium,
          monthlyRate,
          salarySchedule: stretch.salarySchedule,
          serviceSegmentId: stretch.personnel.serviceSegmentId,
          overtimeAuthorityId: hours.overtimeAuthorityId,
          authorityNo: hours.authorityNo,
          ruleVersionCode: version.code,
          parameters,
          formula: `minutes ÷ 60 × monthly salary ÷ ${parameters.workingDaysPerMonth} ÷ ${parameters.workHoursPerDay} × premium (${AUTHORITY} items 9.3–9.4)`,
          taxTreatment: 'SUPPLEMENTARY_COMPENSATION' satisfies TaxTreatment,
        },
        sourceRecords: [{ payrollInputId: input.id }],
      },
    ],
    exceptions,
  };
}

const refuse = (
  exceptionType: string,
  message: string,
  details: Record<string, unknown>,
): CalculatorOutcome => ({ lines: [], exceptions: [blocking(exceptionType, message, details)] });
