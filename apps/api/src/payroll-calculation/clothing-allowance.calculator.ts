import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  CompensationBasis,
  CompensationBasisStretch,
  PersonnelFacts,
} from '../compensation-basis/compensation-basis.service';
import { ruleVersionsInEffectDuring } from '../payroll-periods/payroll-rule-snapshots';
import {
  clothingAllowanceParameters,
  isoDateOf,
  type ClothingAllowanceParameters,
  type NationalPayrollRuleKind,
} from '../payroll-rule-versions/national-payroll-rule-versions';
import {
  blocking,
  type CalculatedLine,
  type CalculationContext,
  type CalculatorOutcome,
  type EmployeePayrollSources,
  type FrozenRuleVersion,
  type PayrollCalculator,
} from './payroll-calculator';
import type { TaxTreatment } from './year-end-bonus.calculator';

export const CLOTHING_ALLOWANCE_COMPONENT_CODE = 'CLOTHING_ALLOWANCE';
const CLOTHING_ALLOWANCE_RULE_KIND: NationalPayrollRuleKind = 'CLOTHING_ALLOWANCE';

const DAY_MS = 86_400_000;
const UNCOVERED_CASE =
  'BC No. 2024-1 item 13.0 refers cases its provisions do not cover to the DBM, so no clothing allowance is calculated.';

type ServedStretch = CompensationBasisStretch & { personnel: PersonnelFacts };
type ServiceRun = { from: string; to: string; serviceSegmentId: string };

/**
 * The cash uniform/clothing allowance of one fiscal year (FY 2026 GAA sec. 64;
 * DBM BC No. 2024-1; docs/research/clothing-allowance-authorities.md), paid in
 * a special Payroll Period that names it and covers the fiscal year, on the
 * payment date the Agency schedules (ADR 0015).
 *
 * The Agency chooses the form of the grant (item 7.1) and records a cash grant
 * as an Agency Payroll Applicability of `CLOTHING_ALLOWANCE`, for the whole
 * Agency or one named Employee (item 12.1). Without one in effect on the
 * payment date it writes nothing: a procured uniform is never a payroll
 * earning. With one, an Employee with at least the version's days of service
 * in the fiscal year, six months counted as 180 days (items 8.1 and 9.1;
 * Annex A example 3), gets one de minimis `EARNING` line of the version's
 * annual amount, or that amount times the employment fraction for part-time
 * service (item 6.2). Service is the calendar days of the Employee's Service
 * Segments in the year, including those still to come: "are to render"
 * (item 8.1). Under the minimum, there is no line. Every case no recorded
 * rule settles blocks and writes no line:
 *
 * - a period that is not one fiscal year;
 * - no rule version in effect on every date of the year, or one that changes
 *   in it;
 * - service that starts after 1 January by transfer, whose grant turns on
 *   whether the former agency paid one (item 9.3), or under any appointment
 *   that is not `ORIGINAL`, or none, which may follow government service
 *   earlier in the year that is not recorded (item 8.1);
 * - a casual daily wage, whose daily hours no record gives;
 * - a pay basis or employment fraction that changes inside the year, or none
 *   recorded;
 * - an amount that is not whole centavos.
 */
@Injectable()
export class ClothingAllowanceCalculator implements PayrollCalculator {
  calculate(
    basis: CompensationBasis,
    context: CalculationContext,
    _earlierLines: readonly CalculatedLine[],
    sources: EmployeePayrollSources,
  ): CalculatorOutcome {
    if (!context.componentCodes.has(CLOTHING_ALLOWANCE_COMPONENT_CODE)) return none();
    const grants = sources.clothingAllowanceGrants;
    // The Employee's own record is preferred over the Agency-wide one.
    const grant = grants.find((row) => row.scope === 'EMPLOYEE') ?? grants[0];
    if (!grant) return none();
    const served = basis.stretches.filter(
      (stretch): stretch is ServedStretch => stretch.personnel !== null,
    );
    if (served.length === 0) return none();

    const year = context.periodFrom.slice(0, 4);
    if (context.periodFrom !== `${year}-01-01` || context.periodTo !== `${year}-12-31`) {
      return refuse(
        'CLOTHING_ALLOWANCE_PERIOD_NOT_FISCAL_YEAR',
        `The period covers ${context.periodFrom} to ${context.periodTo}. BC No. 2024-1 item 8.1 reckons service over a fiscal year, so a special period that pays the clothing allowance covers 1 January to 31 December of one year.`,
      );
    }
    const rule = ruleFor(context);
    if ('exceptionType' in rule) return refuse(rule.exceptionType, rule.message, rule.details);
    const { version, parameters } = rule;

    const runs = serviceRuns(served);
    const natures = new Map(
      sources.serviceSegmentAppointments.map((row) => [
        row.serviceSegmentId,
        row.natureOfAppointment,
      ]),
    );
    for (const entry of runs.filter((run) => run.from > context.periodFrom)) {
      const nature = natures.get(entry.serviceSegmentId) ?? null;
      if (nature === 'ORIGINAL') continue;
      const details = { enteredOn: entry.from, natureOfAppointment: nature };
      if (nature === 'TRANSFER') {
        return refuse(
          'CLOTHING_ALLOWANCE_TRANSFER_UNSETTLED',
          `Entered the Agency's service by transfer on ${entry.from}. BC No. 2024-1 item 9.3 grants the clothing allowance to a transferee only if the former agency did not grant it this year, on a certification, or with the agency head's approval for one required to wear a uniform at all times, and no record shows either.`,
          details,
        );
      }
      return refuse(
        'CLOTHING_ALLOWANCE_ENTRY_UNSETTLED',
        `Entered the Agency's service on ${entry.from} under ${nature ? `a ${nature} appointment` : 'no recorded appointment'}. BC No. 2024-1 item 8.1 counts government service in the fiscal year, and any service or grant before ${entry.from} elsewhere in government is not recorded. ${UNCOVERED_CASE}`,
        details,
      );
    }

    const serviceDays = runs.reduce((sum, run) => sum + daysIn(run), 0);
    // Under the minimum, items 8.1 and 9.1 grant no clothing allowance.
    if (serviceDays < parameters.minimumServiceDays) return none();

    const share = fullTimeShare(served);
    if ('exceptionType' in share) return refuse(share.exceptionType, share.message, share.details);
    const amount = share.quantity.mul(parameters.annualAmount);
    if (!amount.equals(amount.toDecimalPlaces(2))) {
      return refuse(
        'CLOTHING_ALLOWANCE_ROUNDING_UNSETTLED',
        `${share.quantity.toString()} × ${parameters.annualAmount} is not a whole number of centavos, and no recorded rule rounds the clothing allowance.`,
        { quantity: share.quantity.toString(), annualAmount: parameters.annualAmount },
      );
    }
    const personnel = served[0]!.personnel;
    return {
      lines: [
        {
          componentCode: CLOTHING_ALLOWANCE_COMPONENT_CODE,
          lineType: 'EARNING',
          ruleVersionId: version.id,
          quantity: share.quantity.toFixed(4),
          rate: new Prisma.Decimal(parameters.annualAmount).toFixed(8),
          amount: amount.toFixed(4),
          source: {
            ruleVersionCode: version.code,
            fiscalYear: year,
            serviceDays,
            minimumServiceDays: parameters.minimumServiceDays,
            service: runs.map(({ from, to }) => ({ from, to })),
            payBasis: personnel.payBasis,
            employmentFraction: personnel.employmentFraction,
            agencyPayrollApplicability: grant,
            unit: share.unit,
            formula: share.formula,
            taxTreatment: 'DE_MINIMIS' satisfies TaxTreatment,
          },
        },
      ],
      exceptions: [],
    };
  }
}

function ruleFor(
  context: CalculationContext,
):
  | { version: FrozenRuleVersion; parameters: ClothingAllowanceParameters }
  | { exceptionType: string; message: string; details: Record<string, unknown> } {
  const versions = context.snapshotRuleVersions.filter(
    (version) => version.ruleKind === CLOTHING_ALLOWANCE_RULE_KIND,
  );
  const coverage = ruleVersionsInEffectDuring(
    CLOTHING_ALLOWANCE_RULE_KIND,
    versions,
    context.periodFrom,
    context.periodTo,
  );
  if (coverage.status === 'NOT_IN_EFFECT') {
    return {
      exceptionType: 'CLOTHING_ALLOWANCE_RULE_NOT_IN_EFFECT',
      message: `${coverage.reason} The clothing allowance is not calculated without it.`,
      details: { ruleKind: CLOTHING_ALLOWANCE_RULE_KIND },
    };
  }
  if (coverage.ruleVersionIds.length > 1) {
    return {
      exceptionType: 'CLOTHING_ALLOWANCE_RULE_CHANGE_IN_PERIOD',
      message: `The ${CLOTHING_ALLOWANCE_RULE_KIND} version changes inside ${context.periodFrom} to ${context.periodTo}. No recorded rule apportions the clothing allowance across a change inside the fiscal year.`,
      details: { ruleVersionIds: coverage.ruleVersionIds },
    };
  }
  const version = versions.find((candidate) => candidate.id === coverage.ruleVersionIds[0]);
  if (!version) throw new Error('A covered rule kind names a frozen version.');
  return { version, parameters: clothingAllowanceParameters.parse(version.parameters) };
}

/**
 * The share of the full-time annual amount: 1 for full-time service, or the
 * employment fraction for part-time service (BC No. 2024-1 item 6.2: hours of
 * part-time service a day over 8), when one basis holds every served day.
 */
function fullTimeShare(
  served: readonly ServedStretch[],
):
  | { quantity: Prisma.Decimal; unit: string; formula: string }
  | { exceptionType: string; message: string; details: Record<string, unknown> } {
  const bases = served.map(({ from, to, personnel }) => ({
    from,
    to,
    payBasis: personnel.payBasis,
    employmentFraction: personnel.employmentFraction,
  }));
  const casual = bases.find((stretch) => stretch.payBasis === 'CASUAL_DAILY_WAGE');
  if (casual) {
    return {
      exceptionType: 'CLOTHING_ALLOWANCE_CASUAL_UNSETTLED',
      message: `From ${casual.from} to ${casual.to} the Employee is paid a casual daily wage. BC No. 2024-1 items 6.1 and 6.2 set the clothing allowance by full-time or part-time hours, and no record gives a casual daily wage's hours a day.`,
      details: { payBasis: casual.payBasis },
    };
  }
  const unsettled = bases.find(
    (stretch) =>
      !(
        stretch.payBasis === 'MONTHLY_FULL_TIME' ||
        (stretch.payBasis === 'PART_TIME_PROPORTIONAL' && stretch.employmentFraction !== null)
      ),
  );
  if (unsettled) {
    return {
      exceptionType: 'CLOTHING_ALLOWANCE_PAY_BASIS_UNSETTLED',
      message: `From ${unsettled.from} to ${unsettled.to} Personnel records ${unsettled.payBasis === null ? 'no pay basis' : `a ${unsettled.payBasis} pay basis with no employment fraction`}, so full-time or part-time service is not known.`,
      details: { payBasis: unsettled.payBasis, employmentFraction: unsettled.employmentFraction },
    };
  }
  const shareOf = (stretch: (typeof bases)[number]) =>
    stretch.payBasis === 'MONTHLY_FULL_TIME'
      ? new Prisma.Decimal(1)
      : new Prisma.Decimal(stretch.employmentFraction!);
  const first = bases[0]!;
  const quantity = shareOf(first);
  if (bases.some((stretch) => !shareOf(stretch).equals(quantity))) {
    return {
      exceptionType: 'CLOTHING_ALLOWANCE_PAY_BASIS_CHANGE_UNSETTLED',
      message: `The Employee's full-time or part-time service changes inside the fiscal year. BC No. 2024-1 item 6.2 sets one proportion for part-time service, and no item apportions a year of mixed service.`,
      details: { bases },
    };
  }
  return first.payBasis === 'MONTHLY_FULL_TIME'
    ? {
        quantity,
        unit: 'FULL_TIME_ANNUAL_AMOUNT',
        formula: 'annual clothing allowance for full-time service (BC No. 2024-1 item 6.1)',
      }
    : {
        quantity,
        unit: 'EMPLOYMENT_FRACTION',
        formula: 'employment fraction × annual clothing allowance (BC No. 2024-1 item 6.2)',
      };
}

/** Served stretches joined where one ends the day before the next starts, each with the segment it starts on. */
function serviceRuns(served: readonly ServedStretch[]): ServiceRun[] {
  const runs: ServiceRun[] = [];
  for (const { from, to, personnel } of served) {
    const last = runs.at(-1);
    if (last && addDays(last.to, 1) === from) last.to = to;
    else runs.push({ from, to, serviceSegmentId: personnel.serviceSegmentId });
  }
  return runs;
}

const daysIn = ({ from, to }: { from: string; to: string }) =>
  (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS + 1;

const addDays = (value: string, days: number) =>
  isoDateOf(new Date(Date.parse(`${value}T00:00:00.000Z`) + days * DAY_MS));

const none = (): CalculatorOutcome => ({ lines: [], exceptions: [] });

const refuse = (
  exceptionType: string,
  message: string,
  details: Record<string, unknown> = {},
): CalculatorOutcome => ({ lines: [], exceptions: [blocking(exceptionType, message, details)] });
