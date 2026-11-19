import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CompensationBasis } from '../compensation-basis/compensation-basis.service';
import { ruleVersionsInEffectDuring } from '../payroll-periods/payroll-rule-snapshots';
import {
  compensationWithholdingTaxParameters,
  type CompensationWithholdingTaxParameters,
  type DeMinimisBenefit,
  deMinimisBenefitsParameters,
  type NationalPayrollRuleKind,
} from '../payroll-rule-versions/national-payroll-rule-versions';
import {
  blocking,
  type CalculatedException,
  type CalculatedLine,
  type CalculationContext,
  type CalculatorOutcome,
  type EmployeePayrollSources,
  type EmployeeSeparation,
  type FrozenRuleVersion,
  type PayrollCalculator,
  type YearEndAdjustment,
} from './payroll-calculator';
import type { TaxTreatment } from './year-end-bonus.calculator';

export const WITHHOLDING_TAX_COMPONENT_CODE = 'WITHHOLDING_TAX';
const WITHHOLDING_TAX_RULE_KIND = 'COMPENSATION_WITHHOLDING_TAX';
const DE_MINIMIS_RULE_KIND = 'DE_MINIMIS_BENEFITS';

type Bracket = CompensationWithholdingTaxParameters['monthlyTable'][number];

/**
 * The tax Annex E's table withholds from a month's taxable compensation: the
 * bracket with the highest compensation level the amount reaches, its base
 * tax, and its rate of the amount over that level. The table is continuous
 * (the rule version's schema checks it), so an amount on a level is taxed the
 * same by either bracket. An amount below zero is taxed as zero.
 */
export function withholdingTaxDue(
  taxableCompensation: Prisma.Decimal,
  table: readonly Bracket[],
): { bracket: Bracket; tax: Prisma.Decimal } {
  let bracket = table[0]!;
  for (const candidate of table) {
    if (taxableCompensation.gte(candidate.compensationLevel)) bracket = candidate;
  }
  const excess = Prisma.Decimal.max(taxableCompensation.sub(bracket.compensationLevel), 0);
  return {
    bracket,
    tax: new Prisma.Decimal(bracket.baseTax).add(excess.mul(bracket.rateOverCompensationLevel)),
  };
}

/**
 * Compensation withholding tax (BRD PAY-004; BIR RR No. 11-2018, secs.
 * 2.78.1(B)(11) and 2.79, and Annex E;
 * docs/research/native-payroll-component-authorities.md, "Tax treatment").
 * It runs last in a regular period and in a special one, and reads each
 * earlier line's `source.taxTreatment`:
 *
 * - `REGULAR_COMPENSATION` earnings, less the salary deducted for days
 *   without pay, are taxable regular compensation;
 * - `MANDATORY_CONTRIBUTION` deductions, the employee's GSIS, PhilHealth, and
 *   Pag-IBIG shares, are excluded from it;
 * - `SUPPLEMENTARY_COMPENSATION` earnings, overtime and night-shift
 *   differential, are taxable supplementary compensation;
 * - `THIRTEENTH_MONTH_AND_OTHER_BENEFITS` earnings are not taxable up to what
 *   the tax year leaves of the version's exclusion, after the benefits the
 *   year's finalized payrolls already paid; the excess is supplementary
 *   compensation (#351);
 * - `NON_TAXABLE` earnings, such as PERA and RATA, are not taxable;
 * - `DE_MINIMIS` earnings are not, up to their benefit's annual ceiling in
 *   the `DE_MINIMIS_BENEFITS` version, counting what the year's finalized
 *   payrolls already paid.
 *
 * The tax is the monthly table's, of the `COMPENSATION_WITHHOLDING_TAX`
 * version (ADR 0015: a regular period is one calendar month), as RR No.
 * 11-2018 sec. 2.79(B)(3) steps 3 and 4 and Illustration 9 compute it: the
 * bracket is the one taxable regular compensation reaches, and its rate
 * taxes the regular compensation over the bracket's level and all the
 * supplementary compensation. It writes the tax as a `WITHHOLDING_TAX`
 * deduction, zero included, and a Tax Line with the taxable and non-taxable
 * compensation and the year-to-date figures it read. Taxable compensation is
 * the regular and supplementary; non-taxable is the non-taxable earnings, the
 * excluded benefits, and the excluded contributions, so the two add up to the
 * compensation paid.
 *
 * A regular period of December, or one in which the Employee's service ends,
 * makes the year-end adjustment instead (RR No. 11-2018 sec. 2.79(B)(5)(b);
 * #633). The year's taxable compensation is the finalized year to date plus
 * this period's; the version's annual table taxes it; and the period withholds
 * the difference from what the year's finalized payrolls withheld, a negative
 * tax when it refunds the excess. The monthly table and the cumulative
 * average method play no part, and the Tax Line stores the basis.
 *
 * Every case it does not settle blocks:
 *
 * - no withholding tax version in effect on every date of the period, or one
 *   that changes inside it, and the same for the de minimis version when a
 *   line is de minimis;
 * - supplementary compensation with regular compensation the table does not
 *   tax, or with no more regular than supplementary compensation, as in a
 *   special period: sec. 2.79(B)(5)(a) then requires the cumulative average
 *   method, which this calculation does not apply;
 * - a line with no tax treatment, or one its line type does not admit;
 * - a de minimis benefit the version does not list, or one over its ceiling;
 * - a tax that is not whole centavos, which no recorded rule rounds;
 * - a year-end adjustment with a version that has no annual table, or in a
 *   period paid after the calendar year it closes.
 *
 * With no earning it writes nothing and needs no rule version: in a regular
 * period, basic salary's own exception already blocks the Employee; in a
 * special one, nothing is paid.
 */
@Injectable()
export class WithholdingTaxCalculator implements PayrollCalculator {
  calculate(
    _basis: CompensationBasis,
    context: CalculationContext,
    earlierLines: readonly CalculatedLine[],
    sources: EmployeePayrollSources,
  ): CalculatorOutcome {
    const compensation = earlierLines.filter(
      (line) => line.lineType === 'EARNING' || line.lineType === 'DEDUCTION',
    );
    // Nothing is paid, so nothing is withheld and no version is needed.
    if (!compensation.some((line) => line.lineType === 'EARNING')) {
      return { lines: [], exceptions: [] };
    }
    const exceptions: CalculatedException[] = [];
    const withholding = ruleVersionFor(WITHHOLDING_TAX_RULE_KIND, context, exceptions);

    let regularPaid = new Prisma.Decimal(0);
    let supplementary = new Prisma.Decimal(0);
    let benefits = new Prisma.Decimal(0);
    let nonTaxableEarnings = new Prisma.Decimal(0);
    let contributions = new Prisma.Decimal(0);
    const deMinimis = new Map<string, Prisma.Decimal>();
    const unsettled: { componentCode: string; lineType: string; taxTreatment: unknown }[] = [];
    for (const line of compensation) {
      const amount = new Prisma.Decimal(line.amount);
      const earning = line.lineType === 'EARNING';
      const treatment = line.source.taxTreatment as TaxTreatment | undefined;
      if (treatment === 'REGULAR_COMPENSATION') {
        regularPaid = earning ? regularPaid.add(amount) : regularPaid.sub(amount);
      } else if (treatment === 'MANDATORY_CONTRIBUTION' && !earning) {
        contributions = contributions.add(amount);
      } else if (treatment === 'SUPPLEMENTARY_COMPENSATION' && earning) {
        supplementary = supplementary.add(amount);
      } else if (treatment === 'THIRTEENTH_MONTH_AND_OTHER_BENEFITS' && earning) {
        benefits = benefits.add(amount);
      } else if (treatment === 'NON_TAXABLE' && earning) {
        nonTaxableEarnings = nonTaxableEarnings.add(amount);
      } else if (treatment === 'DE_MINIMIS' && earning) {
        const benefit = String(line.source.deMinimisBenefit ?? '');
        deMinimis.set(benefit, (deMinimis.get(benefit) ?? new Prisma.Decimal(0)).add(amount));
      } else {
        unsettled.push({
          componentCode: line.componentCode,
          lineType: line.lineType,
          taxTreatment: line.source.taxTreatment ?? null,
        });
      }
    }
    if (unsettled.length > 0) {
      exceptions.push(
        blocking(
          'WITHHOLDING_TAX_TREATMENT_UNSETTLED',
          `No tax treatment settles ${unsettled.map((line) => `${line.componentCode} (${line.lineType}, ${String(line.taxTreatment)})`).join(', ')}, so its taxable compensation is not calculated.`,
          { lines: unsettled },
        ),
      );
    }

    const yearToDate = sources.taxYearToDate;
    const version =
      deMinimis.size > 0 ? ruleVersionFor(DE_MINIMIS_RULE_KIND, context, exceptions) : null;
    if (version) {
      const ceilings = new Map<string, string | null>(
        deMinimisBenefitsParameters
          .parse(version.parameters)
          .benefits.map(({ benefit, annualCeiling }) => [benefit, annualCeiling]),
      );
      for (const [benefit, amount] of deMinimis) {
        const ceiling = ceilings.get(benefit);
        const paid = new Prisma.Decimal(
          yearToDate.deMinimisBenefits[benefit as DeMinimisBenefit] ?? 0,
        );
        if (ceiling === undefined) {
          exceptions.push(
            blocking(
              'DE_MINIMIS_BENEFIT_NOT_IN_RULE',
              `De minimis version ${version.code} does not list the benefit "${benefit}", so its ${amount.toFixed(2)} is not classified.`,
              { benefit, amount: amount.toFixed(4), ruleVersionCode: version.code },
            ),
          );
        } else if (ceiling !== null && paid.add(amount).gt(ceiling)) {
          exceptions.push(
            blocking(
              'DE_MINIMIS_CEILING_EXCEEDED',
              `${benefit} of ${amount.toFixed(2)}, with ${paid.toFixed(2)} already paid in ${yearToDate.taxYear}, is over its annual ceiling of ${ceiling} in de minimis version ${version.code}, and no recorded rule counts the excess toward the exclusion for 13th-month pay and other benefits.`,
              {
                benefit,
                amount: amount.toFixed(4),
                yearToDate: paid.toFixed(4),
                annualCeiling: ceiling,
                ruleVersionCode: version.code,
              },
            ),
          );
        } else {
          nonTaxableEarnings = nonTaxableEarnings.add(amount);
        }
      }
    }

    if (exceptions.length > 0 || !withholding) return { lines: [], exceptions };

    const regular = regularPaid.sub(contributions);
    const parameters = compensationWithholdingTaxParameters.parse(withholding.parameters);
    const exclusion = parameters.thirteenthMonthAndOtherBenefitsExclusion;
    const counted = new Prisma.Decimal(yearToDate.thirteenthMonthAndOtherBenefits);
    const left = Prisma.Decimal.max(new Prisma.Decimal(exclusion).sub(counted), 0);
    const excluded = Prisma.Decimal.min(benefits, left);
    supplementary = supplementary.add(benefits.sub(excluded));
    const taxable = regular.add(supplementary);

    const yearEnd = yearEndAdjustmentOf(context, sources);
    let computed: { tax: Prisma.Decimal; table: 'MONTHLY' | 'ANNUAL'; bracket: Bracket };
    let yearEndAdjustment: YearEndAdjustment | undefined;
    if (yearEnd) {
      const periodYear = Number(context.periodFrom.slice(0, 4));
      if (yearToDate.taxYear !== periodYear) {
        return {
          lines: [],
          exceptions: [
            blocking(
              'WITHHOLDING_TAX_YEAR_END_OUTSIDE_TAX_YEAR',
              `The period ${context.periodFrom} to ${context.periodTo} makes the year-end adjustment for ${periodYear} but pays in ${yearToDate.taxYear}. RR No. 11-2018 sec. 2.79(B)(5)(b) adjusts the tax on the last compensation paid in the calendar year, and no recorded rule settles one paid after it.`,
              { periodYear, taxYear: yearToDate.taxYear },
            ),
          ],
        };
      }
      const annualTable = parameters.annualTable;
      if (!annualTable) {
        return {
          lines: [],
          exceptions: [
            blocking(
              'WITHHOLDING_TAX_ANNUAL_TABLE_MISSING',
              `Withholding tax version ${withholding.code} has no annual table, so the year-end adjustment of RR No. 11-2018 sec. 2.79(B)(5)(b) is not calculated. Load a version with the annual schedule of its step 3.`,
              { ruleVersionCode: withholding.code },
            ),
          ],
        };
      }
      // Steps 1 and 3: the year's taxable compensation, by the annual schedule.
      const yearToDateTaxable = new Prisma.Decimal(yearToDate.taxableCompensation);
      const annualTaxable = yearToDateTaxable.add(taxable);
      const annual = withholdingTaxDue(annualTaxable, annualTable);
      // Step 4: the deficiency is withheld, and the excess refunded, now.
      const withheld = new Prisma.Decimal(yearToDate.withholdingTax);
      computed = { tax: annual.tax.sub(withheld), table: 'ANNUAL', bracket: annual.bracket };
      yearEndAdjustment = {
        authority: 'BIR RR No. 11-2018 sec. 2.79(B)(5)(b)',
        reason: yearEnd.separation ? 'SEPARATION' : 'YEAR_END',
        separation: yearEnd.separation,
        taxYear: yearToDate.taxYear,
        yearToDateTaxableCompensation: yearToDateTaxable.toFixed(4),
        periodTaxableCompensation: taxable.toFixed(4),
        annualTaxableCompensation: annualTaxable.toFixed(4),
        bracket: annual.bracket,
        annualTaxDue: annual.tax.toFixed(4),
        yearToDateWithholdingTax: withheld.toFixed(4),
        withholdingTax: computed.tax.toFixed(4),
      };
    } else {
      const onRegular = withholdingTaxDue(regular, parameters.monthlyTable);
      if (supplementary.gt(0) && (onRegular.tax.isZero() || supplementary.gte(regular))) {
        return {
          lines: [],
          exceptions: [
            blocking(
              'WITHHOLDING_TAX_CUMULATIVE_AVERAGE_UNSETTLED',
              `Supplementary compensation of ${supplementary.toFixed(2)} is paid with taxable regular compensation of ${regular.toFixed(2)}, ${onRegular.tax.isZero() ? 'which the monthly table does not tax' : 'no more than the supplementary'}. RR No. 11-2018 sec. 2.79(B)(5)(a) then requires the cumulative average method, which this calculation does not apply.`,
              {
                regularCompensation: regular.toFixed(4),
                supplementaryCompensation: supplementary.toFixed(4),
              },
            ),
          ],
        };
      }
      computed = {
        tax: onRegular.tax.add(supplementary.mul(onRegular.bracket.rateOverCompensationLevel)),
        table: 'MONTHLY',
        bracket: onRegular.bracket,
      };
    }
    const { tax, table, bracket } = computed;
    if (!tax.equals(tax.toDecimalPlaces(2))) {
      return {
        lines: [],
        exceptions: [
          blocking(
            'WITHHOLDING_TAX_ROUNDING_UNSETTLED',
            `The tax ${tax.toString()} on taxable compensation ${taxable.toFixed(2)} is not a whole number of centavos, and no recorded rule rounds it.`,
            { taxableCompensation: taxable.toFixed(4), tax: tax.toString() },
          ),
        ],
      };
    }
    const nonTaxable = nonTaxableEarnings.add(excluded).add(contributions);
    return {
      lines: [
        {
          componentCode: WITHHOLDING_TAX_COMPONENT_CODE,
          lineType: 'DEDUCTION',
          ruleVersionId: withholding.id,
          quantity: null,
          rate: null,
          amount: tax.toFixed(4),
          source: {
            ruleVersionCode: withholding.code,
            table,
            regularCompensation: regular.toFixed(4),
            supplementaryCompensation: supplementary.toFixed(4),
            taxableCompensation: taxable.toFixed(4),
            nonTaxableCompensation: nonTaxable.toFixed(4),
            excludedContributions: contributions.toFixed(4),
            thirteenthMonthAndOtherBenefits: {
              paid: benefits.toFixed(4),
              yearToDate: counted.toFixed(4),
              exclusion,
              excluded: excluded.toFixed(4),
              taxable: benefits.sub(excluded).toFixed(4),
            },
            bracket,
            formula: yearEndAdjustment
              ? "annual table's tax on the year's taxable compensation − tax the year's finalized payrolls withheld"
              : 'base tax + rate × (regular compensation − compensation level + supplementary compensation)',
            ...(yearEndAdjustment ? { yearEndAdjustment } : {}),
            lines: compensation.map((line) => ({
              componentCode: line.componentCode,
              lineType: line.lineType,
              amount: line.amount,
              taxTreatment: line.source.taxTreatment,
              ...(line.source.deMinimisBenefit
                ? { deMinimisBenefit: line.source.deMinimisBenefit }
                : {}),
            })),
          },
        },
      ],
      exceptions: [],
      tax: {
        taxableCompensation: taxable.toFixed(4),
        nonTaxableCompensation: nonTaxable.toFixed(4),
        withholdingTax: tax.toFixed(4),
        ruleVersionId: withholding.id,
        yearToDateSnapshot: yearToDate,
        ...(yearEndAdjustment ? { yearEndAdjustment } : {}),
      },
    };
  }
}

/**
 * The one version of a kind in effect on every date of the month, or null
 * with a blocking exception: none in effect, or one that changes in the month.
 */
function ruleVersionFor(
  ruleKind: NationalPayrollRuleKind,
  context: CalculationContext,
  exceptions: CalculatedException[],
): FrozenRuleVersion | null {
  const prefix = ruleKind === WITHHOLDING_TAX_RULE_KIND ? 'WITHHOLDING_TAX' : 'DE_MINIMIS';
  const versions = context.snapshotRuleVersions.filter((version) => version.ruleKind === ruleKind);
  const coverage = ruleVersionsInEffectDuring(
    ruleKind,
    versions,
    context.periodFrom,
    context.periodTo,
  );
  if (coverage.status === 'NOT_IN_EFFECT') {
    exceptions.push(
      blocking(
        `${prefix}_RULE_NOT_IN_EFFECT`,
        `${coverage.reason} Withholding tax is not calculated without it.`,
        { ruleKind },
      ),
    );
    return null;
  }
  if (coverage.ruleVersionIds.length > 1) {
    exceptions.push(
      blocking(
        `${prefix}_RULE_CHANGE_IN_PERIOD`,
        `The ${ruleKind} version changes inside ${context.periodFrom} to ${context.periodTo}. No recorded rule apportions the month's withholding tax across a change.`,
        { ruleVersionIds: coverage.ruleVersionIds },
      ),
    );
    return null;
  }
  return versions.find((version) => version.id === coverage.ruleVersionIds[0]) ?? null;
}

/**
 * Whether the period makes the Employee's year-end adjustment (RR No. 11-2018
 * sec. 2.79(B)(5)(b)): a regular period whose month is December, or one in
 * which the Employee's service ends. A special period never does; it pays no
 * regular compensation.
 */
function yearEndAdjustmentOf(
  context: CalculationContext,
  sources: EmployeePayrollSources,
): { separation: EmployeeSeparation | null } | null {
  if (context.componentCodes.size > 0) return null;
  if (sources.separation) return { separation: sources.separation };
  return context.periodFrom.slice(5, 7) === '12' ? { separation: null } : null;
}
