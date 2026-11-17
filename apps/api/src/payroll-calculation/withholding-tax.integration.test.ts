import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CompensationBasisService } from '../compensation-basis/compensation-basis.service';
import { PayrollPeriodsService } from '../payroll-periods/payroll-periods.service';
import {
  cleanupPayrollTenants,
  createAdminClient,
  createPayrollTenant,
  FIXTURE_PREFIX,
  type PayrollTenant,
} from '../payroll-periods/payroll-periods.test-fixtures';
import { BasicSalaryCalculator } from './basic-salary.calculator';
import {
  GsisContributionCalculator,
  PagIbigContributionCalculator,
  PhilHealthContributionCalculator,
} from './contribution.calculators';
import { DaysWithoutPayCalculator } from './days-without-pay.calculator';
import { PayrollCalculationService } from './payroll-calculation.service';
import { payrollSourcesReader, RecordedPayBases } from './payroll-calculation.test-fixtures';
import { PeraCalculator } from './pera.calculator';
import { WithholdingTaxCalculator } from './withholding-tax.calculator';
import { YearEndBonusCalculator } from './year-end-bonus.calculator';

const enabled = process.env.DATABASE_E2E === 'true';
const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

describe.skipIf(!enabled)('Withholding tax in PostgreSQL', () => {
  // Test fixtures only: the tax table follows Annex E's monthly table (research
  // R24), the exclusion RR No. 11-2018 sec. 2.78.1(B)(11) (R26), and the
  // contribution rates research R17 to R21, but no real version is loaded.
  // The salary rates are illustrative. 2894 and 2895 sit clear of every
  // other test's rule versions; the tax, de minimis, and year-end bonus
  // versions cover only 2894.
  const suffix = `${Date.now()}-wtax`;
  const codes = {
    schedule: `${FIXTURE_PREFIX}WTAX-SCHEDULE-${suffix}`,
    gsis: `${FIXTURE_PREFIX}WTAX-GSIS-${suffix}`,
    philHealth: `${FIXTURE_PREFIX}WTAX-PHILHEALTH-${suffix}`,
    pagIbig: `${FIXTURE_PREFIX}WTAX-PAGIBIG-${suffix}`,
    pera: `${FIXTURE_PREFIX}WTAX-PERA-${suffix}`,
    tax: `${FIXTURE_PREFIX}WTAX-TAX-${suffix}`,
    deMinimis: `${FIXTURE_PREFIX}WTAX-DE-MINIMIS-${suffix}`,
    yearEndBonus: `${FIXTURE_PREFIX}WTAX-YEB-${suffix}`,
  };
  const periods = new PayrollPeriodsService();
  const facts = new RecordedPayBases();
  const basis = new CompensationBasisService(facts);
  // Employees' Compensation, RATA, overtime, and the special-period
  // calculators have their own tests; these fixtures freeze none of them.
  const nothing = { calculate: () => ({ lines: [], exceptions: [] }) };
  const calculation = new PayrollCalculationService(
    basis,
    new BasicSalaryCalculator(),
    payrollSourcesReader(basis),
    new DaysWithoutPayCalculator(),
    new GsisContributionCalculator(),
    nothing,
    new YearEndBonusCalculator(),
    new PeraCalculator(),
    nothing,
    nothing,
    nothing,
    new PhilHealthContributionCalculator(),
    new PagIbigContributionCalculator(),
    new WithholdingTaxCalculator(),
  );
  let admin: PrismaClient;
  let taxId: string;
  const tenants: PayrollTenant[] = [];
  const withholding = async () =>
    (await admin.payComponent.findUniqueOrThrow({ where: { code: 'WITHHOLDING_TAX' } })).id;

  const preparer = (tenant: PayrollTenant): RequestContext => ({
    ...tenant.persons[0]!.context,
    permissions: [
      { code: 'payroll.periods.create', scopePolicy: 'AGENCY' },
      { code: 'payroll.periods.calculate', scopePolicy: 'AGENCY' },
    ],
  });

  beforeAll(async () => {
    admin = await createAdminClient();
    await admin.$transaction(async (transaction) => {
      const rule = {
        issuingAuthority: 'Test authority',
        issuanceReference: 'Test fixture, not an issuance',
        sourceUrl: 'https://example.test/withholding-tax',
        verifiedOn: date('2026-11-16'),
        verifiedBy: 'LingkodHR test fixture',
        effectiveFrom: date('2894-01-01'),
        effectiveTo: date('2895-12-31'),
      };
      const version = async (ruleKind: string, code: string, parameters: object, to?: string) =>
        (
          await transaction.nationalPayrollRuleVersion.create({
            data: {
              ...rule,
              ...(to ? { effectiveTo: date(to) } : {}),
              ruleKind,
              code,
              name: `Test ${ruleKind}`,
              parameters,
            },
          })
        ).id;
      const schedule = await version('SALARY_SCHEDULE', codes.schedule, {});
      await transaction.salaryGradeRate.createMany({
        data: [
          { ruleVersionId: schedule, salaryGrade: 1, salaryStep: 1, monthlyRate: '40000' },
          { ruleVersionId: schedule, salaryGrade: 1, salaryStep: 2, monthlyRate: '20000' },
          { ruleVersionId: schedule, salaryGrade: 1, salaryStep: 3, monthlyRate: '100000' },
        ],
      });
      await version('GSIS_CONTRIBUTION', codes.gsis, {
        employeeRate: '0.09',
        employerRate: '0.12',
        monthlyCompensationLimit: null,
      });
      await version('PHILHEALTH_CONTRIBUTION', codes.philHealth, {
        employeeRate: '0.025',
        employerRate: '0.025',
        monthlyIncomeFloor: '10000',
        monthlyIncomeCeiling: '100000',
      });
      await version('PAGIBIG_CONTRIBUTION', codes.pagIbig, {
        employeeRate: '0.02',
        lowerBandEmployeeRate: '0.01',
        lowerBandMonthlyCompensation: '1500',
        employerRate: '0.02',
        maximumFundSalary: '10000',
      });
      await version('PERA', codes.pera, { monthlyAmount: '2000', dailyAmount: '90.91' });
      taxId = await version(
        'COMPENSATION_WITHHOLDING_TAX',
        codes.tax,
        {
          thirteenthMonthAndOtherBenefitsExclusion: '90000',
          monthlyTable: [
            { compensationLevel: '0', baseTax: '0', rateOverCompensationLevel: '0' },
            { compensationLevel: '20833', baseTax: '0', rateOverCompensationLevel: '0.15' },
            { compensationLevel: '33333', baseTax: '1875', rateOverCompensationLevel: '0.20' },
            { compensationLevel: '66667', baseTax: '8541.80', rateOverCompensationLevel: '0.25' },
            { compensationLevel: '166667', baseTax: '33541.80', rateOverCompensationLevel: '0.30' },
            {
              compensationLevel: '666667',
              baseTax: '183541.80',
              rateOverCompensationLevel: '0.35',
            },
          ],
        },
        '2894-12-31',
      );
      await version(
        'DE_MINIMIS_BENEFITS',
        codes.deMinimis,
        { benefits: [{ benefit: 'CHRISTMAS_GIFT', annualCeiling: '6000' }] },
        '2894-12-31',
      );
      await version(
        'YEAR_END_BONUS_AND_CASH_GIFT',
        codes.yearEndBonus,
        {
          serviceFrom: '2894-01-01',
          asOf: '2894-10-31',
          minimumServiceMonths: 4,
          bonusMonthsOfBasicSalary: 1,
          cashGiftAmount: '5000.00',
          grantsSeparatedBeforeAsOf: false,
        },
        '2894-12-31',
      );
    });
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      const where = { agencyId: { in: tenants.map((tenant) => tenant.agency.id) } };
      await transaction.serviceSegment.deleteMany({ where });
      await transaction.employee.deleteMany({ where });
      await transaction.organizationUnit.deleteMany({ where });
    });
    await cleanupPayrollTenants(admin, tenants);
    await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await transaction.$executeRaw`DELETE FROM salary_grade_rates WHERE rule_version_id IN (SELECT id FROM national_payroll_rule_versions WHERE code = ${codes.schedule})`;
      for (const code of Object.values(codes)) {
        await transaction.$executeRaw`DELETE FROM national_payroll_rule_versions WHERE code = ${code}`;
      }
    });
    await admin.$disconnect();
  });

  /** A tenant with one organization unit, and its SG-1 Employees and periods. */
  async function payrollTenant(label: string) {
    const tenant = await createPayrollTenant(admin, suffix, label);
    tenants.push(tenant);
    const agencyId = tenant.agency.id;
    const membershipId = tenant.persons[0]!.membership.id;
    const unit = await admin.organizationUnit.create({
      data: { agencyId, code: `UNIT-${label}-${suffix}`, unitType: 'DIVISION', status: 'ACTIVE' },
    });

    /** An SG-1 Employee at `salaryStep`, full-time since 2893. */
    async function employeeAt(employeeLabel: string, salaryStep: number) {
      const name = `${label}-${employeeLabel}`;
      const employee = await admin.employee.create({
        data: {
          agencyId,
          employeeNumber: `${name}-${suffix}`,
          legalName: `Withholding ${name}`,
          birthDate: new Date('1990-01-01'),
          sex: 'FEMALE',
          civilStatus: 'SINGLE',
          contactEmail: `${name.toLowerCase()}-${suffix}@example.test`,
          serviceStatus: 'ACTIVE',
          createdByMembershipId: membershipId,
          updatedByMembershipId: membershipId,
        },
      });
      await withDatabaseContext(
        { ...tenant.persons[0]!.scope, capabilities: ['personnel-baseline-transition'] },
        (transaction) =>
          transaction.serviceSegment.create({
            data: {
              agencyId,
              employeeId: employee.id,
              organizationUnitId: unit.id,
              appointmentStatus: 'PERMANENT',
              salaryGrade: 1,
              salaryStep,
              effectiveFrom: date('2893-06-01'),
              status: 'ACTIVE',
              createdByMembershipId: membershipId,
            },
          }),
      );
      facts.bases.set(employee.id, { payBasis: 'MONTHLY_FULL_TIME', employmentFraction: null });
      return employee.id;
    }

    async function calculate(
      month: string,
      last: string,
      special?: { periodFrom: string; periodTo: string; payComponentIds: string[] },
    ) {
      const draft = await periods.create(preparer(tenant), {
        code: `${label}-${month}-${special ? 'SPECIAL' : 'REGULAR'}-${suffix}`,
        runType: special ? 'SPECIAL' : 'REGULAR',
        periodFrom: `${month}-01`,
        periodTo: `${month}-${last}`,
        cutoffAt: '2026-01-01T00:00:00+08:00',
        paymentDate: `${month}-${last}`,
        ...special,
      });
      const started = await periods.startCalculation(preparer(tenant), draft.id, {
        rowVersion: draft.rowVersion,
      });
      const job = {
        agencyId,
        payrollPeriodId: started.id,
        calculationVersion: started.calculationVersion,
      };
      return { job, outcome: await calculation.run(job) };
    }
    /** Finalization is not built yet; the fixture sets the status directly. */
    async function finalize(payrollPeriodId: string) {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.payrollPeriod.update({
          where: { id: payrollPeriodId },
          data: { status: 'FINALIZED', finalizedAt: new Date() },
        });
      });
    }
    const resultsOf = async (payrollPeriodId: string) =>
      new Map(
        (
          await admin.payrollEmployee.findMany({
            where: { payrollPeriodId, calculationVersion: 1 },
            include: { lines: true, taxLine: true },
          })
        ).map((result) => [result.employeeId, result]),
      );
    return { tenant, employeeAt, calculate, finalize, resultsOf };
  }

  it('withholds on salary less contributions, reads the finalized year to date, and blocks without a version', async () => {
    const { tenant, employeeAt, calculate, finalize, resultsOf } = await payrollTenant('WTAX');
    const agencyId = tenant.agency.id;
    const taxed = await employeeAt('TAXED', 1);
    const untaxed = await employeeAt('UNTAXED', 2);

    const january = await calculate('2894-01', '31');
    expect(january.outcome).toEqual({ outcome: 'FOR_REVIEW', results: 2 });
    const januaryResults = await resultsOf(january.job.payrollPeriodId);

    // ₱40,000 less GSIS ₱3,600, PhilHealth ₱1,000, and Pag-IBIG ₱200 is
    // ₱35,200: ₱1,875 + 20% of ₱1,867. PERA is non-taxable.
    const taxedJanuary = januaryResults.get(taxed)!;
    const withholdingId = await withholding();
    const taxLine = taxedJanuary.lines.find((line) => line.payComponentId === withholdingId);
    expect(taxLine).toMatchObject({ lineType: 'DEDUCTION', ruleVersionId: taxId });
    expect(String(taxLine?.amount)).toBe('2248.4');
    expect(taxedJanuary.taxLine).toMatchObject({ ruleVersionId: taxId });
    expect(
      [
        taxedJanuary.taxLine!.taxableCompensation,
        taxedJanuary.taxLine!.nonTaxableCompensation,
        taxedJanuary.taxLine!.withholdingTax,
      ].map(String),
    ).toEqual(['35200', '6800', '2248.4']);
    expect([String(taxedJanuary.totalDeductions), String(taxedJanuary.netAmount)]).toEqual([
      '7048.4',
      '34951.6',
    ]);
    // ₱20,000 less ₱2,500 of shares is ₱17,500, below the first taxed level.
    const untaxedJanuary = januaryResults.get(untaxed)!;
    expect(
      [untaxedJanuary.taxLine!.taxableCompensation, untaxedJanuary.taxLine!.withholdingTax].map(
        String,
      ),
    ).toEqual(['17500', '0']);
    expect(taxedJanuary.taxLine!.yearToDateSnapshot).toEqual({
      taxYear: 2894,
      payrollPeriodIds: [],
      taxableCompensation: '0.0000',
      nonTaxableCompensation: '0.0000',
      withholdingTax: '0.0000',
      deMinimisBenefits: {},
      thirteenthMonthAndOtherBenefits: '0.0000',
    });
    // Tax lines are isolated by Agency, and immutable.
    const other = await createPayrollTenant(admin, suffix, 'WTAX-OTHER');
    tenants.push(other);
    await expect(
      withDatabaseContext({ agencyId: other.agency.id }, (transaction) =>
        transaction.taxLine.count({ where: { agencyId } }),
      ),
    ).resolves.toBe(0);
    await expect(
      admin.taxLine.update({
        where: { id: taxedJanuary.taxLine!.id },
        data: { withholdingTax: '0' },
      }),
    ).rejects.toThrow();

    // February reads January, once it is finalized, as its year to date.
    await finalize(january.job.payrollPeriodId);
    const february = await calculate('2894-02', '28');
    expect(february.outcome).toEqual({ outcome: 'FOR_REVIEW', results: 2 });
    const taxedFebruary = (await resultsOf(february.job.payrollPeriodId)).get(taxed)!;
    expect(String(taxedFebruary.taxLine!.withholdingTax)).toBe('2248.4');
    expect(taxedFebruary.taxLine!.yearToDateSnapshot).toEqual({
      taxYear: 2894,
      payrollPeriodIds: [january.job.payrollPeriodId],
      taxableCompensation: '35200.0000',
      nonTaxableCompensation: '6800.0000',
      withholdingTax: '2248.4000',
      deMinimisBenefits: {},
      thirteenthMonthAndOtherBenefits: '0.0000',
    });

    // 2895 has no withholding tax version: every Employee blocks, and no
    // tax line is written.
    await finalize(february.job.payrollPeriodId);
    const unruled = await calculate('2895-01', '31');
    expect(unruled.outcome).toEqual({ outcome: 'RETURNED', results: 2, blockingExceptions: 2 });
    const exceptions = await admin.payrollException.findMany({
      where: { payrollPeriodId: unruled.job.payrollPeriodId, calculationVersion: 1 },
    });
    expect(exceptions.map((exception) => exception.exceptionType)).toEqual([
      'WITHHOLDING_TAX_RULE_NOT_IN_EFFECT',
      'WITHHOLDING_TAX_RULE_NOT_IN_EFFECT',
    ]);
    const unruledResults = await resultsOf(unruled.job.payrollPeriodId);
    expect([...unruledResults.values()].map((result) => [result.status, result.taxLine])).toEqual([
      ['EXCEPTION', null],
      ['EXCEPTION', null],
    ]);
  });

  it('excludes the year-end bonus in a special period, counts it in the next year to date, and blocks an excess paid alone', async () => {
    const { employeeAt, calculate, finalize, resultsOf } = await payrollTenant('WTAX-BONUS');
    const within = await employeeAt('WITHIN', 1);
    const over = await employeeAt('OVER', 3);
    const payComponentIds = (
      await admin.payComponent.findMany({
        where: { code: { in: ['YEAR_END_BONUS', 'CASH_GIFT'] } },
      })
    ).map((component) => component.id);

    // The bonus is one month's salary as of 31 October, and the cash gift a
    // de minimis Christmas gift. ₱40,000 is within the ₱90,000 exclusion, so
    // nothing is taxed. ₱100,000 leaves ₱10,000 of supplementary compensation
    // paid with no regular compensation, which only the cumulative average
    // method withholds.
    const special = await calculate('2894-11', '15', {
      periodFrom: '2894-01-01',
      periodTo: '2894-10-31',
      payComponentIds,
    });
    expect(special.outcome).toEqual({ outcome: 'RETURNED', results: 2, blockingExceptions: 1 });
    const specialResults = await resultsOf(special.job.payrollPeriodId);
    const bonus = specialResults.get(within)!;
    const withholdingId = await withholding();
    expect(
      bonus.lines
        .filter((line) => line.payComponentId === withholdingId)
        .map((line) => String(line.amount)),
    ).toEqual(['0']);
    expect(
      [
        bonus.taxLine!.taxableCompensation,
        bonus.taxLine!.nonTaxableCompensation,
        bonus.taxLine!.withholdingTax,
      ].map(String),
    ).toEqual(['0', '45000', '0']);
    expect(specialResults.get(over)).toMatchObject({ status: 'EXCEPTION', taxLine: null });
    const exceptions = await admin.payrollException.findMany({
      where: { payrollPeriodId: special.job.payrollPeriodId, calculationVersion: 1 },
    });
    expect(exceptions.map((exception) => [exception.employeeId, exception.exceptionType])).toEqual([
      [over, 'WITHHOLDING_TAX_CUMULATIVE_AVERAGE_UNSETTLED'],
    ]);

    // Once the special period is finalized, December reads the bonus toward
    // the exclusion and the cash gift toward its ceiling.
    await finalize(special.job.payrollPeriodId);
    const december = await calculate('2894-12', '31');
    expect(december.outcome).toEqual({ outcome: 'FOR_REVIEW', results: 2 });
    const decemberResults = await resultsOf(december.job.payrollPeriodId);
    expect(decemberResults.get(within)!.taxLine!.yearToDateSnapshot).toEqual({
      taxYear: 2894,
      payrollPeriodIds: [special.job.payrollPeriodId],
      taxableCompensation: '0.0000',
      nonTaxableCompensation: '45000.0000',
      withholdingTax: '0.0000',
      deMinimisBenefits: { CHRISTMAS_GIFT: '5000.0000' },
      thirteenthMonthAndOtherBenefits: '40000.0000',
    });
    // The blocked result paid nothing, so nothing counts for it.
    expect(decemberResults.get(over)!.taxLine!.yearToDateSnapshot).toMatchObject({
      payrollPeriodIds: [special.job.payrollPeriodId],
      thirteenthMonthAndOtherBenefits: '0.0000',
    });
  });
});
