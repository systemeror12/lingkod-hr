import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CompensationBasisService } from '../compensation-basis/compensation-basis.service';
import { PayrollPeriodsService } from '../payroll-periods/payroll-periods.service';
import {
  cleanupPayrollTenants,
  cleanupPlatformFixtures,
  createAdminClient,
  createPayComponent,
  createPayrollTenant,
  FIXTURE_PREFIX,
  type PayrollTenant,
} from '../payroll-periods/payroll-periods.test-fixtures';
import { BasicSalaryCalculator } from './basic-salary.calculator';
import {
  EmployeesCompensationCalculator,
  GsisContributionCalculator,
} from './contribution.calculators';
import { DaysWithoutPayCalculator } from './days-without-pay.calculator';
import { CommutableRataCalculator } from './commutable-rata.calculator';
import { PayrollCalculationService } from './payroll-calculation.service';
import { payrollSourcesReader, RecordedPayBases } from './payroll-calculation.test-fixtures';
import { PeraCalculator } from './pera.calculator';
import { YearEndBonusCalculator } from './year-end-bonus.calculator';

const enabled = process.env.DATABASE_E2E === 'true';

type RecordedBasis = { payBasis: string; employmentFraction: string | null };

describe.skipIf(!enabled)('Year-end bonus and cash gift calculation in PostgreSQL', () => {
  // Test fixtures only: the rate is not from any issuance, the parameters
  // mirror the FY 2026 GAA sec. 75 figures, and 2882 sits clear of other tests.
  const suffix = `${Date.now()}-yeb`;
  const scheduleCode = `${FIXTURE_PREFIX}YEB-SCHEDULE-${suffix}`;
  const ruleCode = `${FIXTURE_PREFIX}YEB-RULE-${suffix}`;
  const periods = new PayrollPeriodsService();
  const facts = new RecordedPayBases();
  const basis = new CompensationBasisService(facts);
  const calculation = new PayrollCalculationService(
    basis,
    new BasicSalaryCalculator(),
    payrollSourcesReader(basis),
    new DaysWithoutPayCalculator(),
    new GsisContributionCalculator(),
    new EmployeesCompensationCalculator(),
    new YearEndBonusCalculator(),
    new PeraCalculator(),
    new CommutableRataCalculator(),
  );
  let admin: PrismaClient;
  let ruleId: string;
  const tenants: PayrollTenant[] = [];

  const preparer = (tenant: PayrollTenant): RequestContext => ({
    ...tenant.persons[0]!.context,
    permissions: [
      { code: 'payroll.periods.create', scopePolicy: 'AGENCY' },
      { code: 'payroll.periods.calculate', scopePolicy: 'AGENCY' },
    ],
  });

  async function tenantWithUnit(label: string) {
    const tenant = await createPayrollTenant(admin, suffix, label);
    tenants.push(tenant);
    const unit = await admin.organizationUnit.create({
      data: {
        agencyId: tenant.agency.id,
        code: `UNIT-${label}-${suffix}`,
        unitType: 'DIVISION',
        status: 'ACTIVE',
      },
    });
    return { tenant, unitId: unit.id };
  }

  /** An SG-11 step 1 Employee serving from `from` to `to` on the recorded pay basis. */
  async function employeeWith(
    { agency, persons }: PayrollTenant,
    unitId: string,
    label: string,
    [from, to]: [string, string | null],
    basis: RecordedBasis,
  ) {
    const membershipId = persons[0]!.membership.id;
    const employee = await admin.employee.create({
      data: {
        agencyId: agency.id,
        employeeNumber: `YEB-${label}-${suffix}`,
        legalName: `Year-end ${label}`,
        birthDate: new Date('1990-01-01'),
        sex: 'FEMALE',
        civilStatus: 'SINGLE',
        contactEmail: `yeb-${label.toLowerCase()}-${suffix}@example.test`,
        serviceStatus: 'ACTIVE',
        createdByMembershipId: membershipId,
        updatedByMembershipId: membershipId,
      },
    });
    await withDatabaseContext(
      { ...persons[0]!.scope, capabilities: ['personnel-baseline-transition'] },
      (transaction) =>
        transaction.serviceSegment.create({
          data: {
            agencyId: agency.id,
            employeeId: employee.id,
            organizationUnitId: unitId,
            appointmentStatus: 'PERMANENT',
            salaryGrade: 11,
            salaryStep: 1,
            effectiveFrom: new Date(from),
            effectiveTo: to ? new Date(to) : null,
            status: to ? 'CLOSED' : 'ACTIVE',
            createdByMembershipId: membershipId,
          },
        }),
    );
    facts.bases.set(employee.id, basis);
    return employee.id;
  }

  const components = async (...codes: string[]) =>
    (await admin.payComponent.findMany({ where: { code: { in: codes } } })).map(({ id }) => id);

  const createSpecial = async (tenant: PayrollTenant, label: string, payComponentIds: string[]) =>
    periods.create(preparer(tenant), {
      code: `YEB-${label}-${suffix}`,
      runType: 'SPECIAL',
      periodFrom: '2882-01-01',
      periodTo: '2882-10-31',
      cutoffAt: '2026-01-01T00:00:00+08:00',
      paymentDate: '2882-11-15',
      payComponentIds,
    });

  const start = (tenant: PayrollTenant, period: { id: string; rowVersion: number }) =>
    periods.startCalculation(preparer(tenant), period.id, { rowVersion: period.rowVersion });

  const jobOf = (tenant: PayrollTenant, period: { id: string; calculationVersion: number }) => ({
    agencyId: tenant.agency.id,
    payrollPeriodId: period.id,
    calculationVersion: period.calculationVersion,
  });

  beforeAll(async () => {
    admin = await createAdminClient();
    await admin.$transaction(async (transaction) => {
      const schedule = await transaction.nationalPayrollRuleVersion.create({
        data: {
          ruleKind: 'SALARY_SCHEDULE',
          code: scheduleCode,
          name: 'Test salary schedule',
          issuingAuthority: 'Test authority',
          issuanceReference: 'Test fixture, not an issuance',
          sourceUrl: 'https://example.test/salary-schedule',
          verifiedOn: new Date('2026-11-15'),
          verifiedBy: 'LingkodHR test fixture',
          effectiveFrom: new Date('2882-01-01'),
          effectiveTo: new Date('2882-12-31'),
        },
      });
      await transaction.salaryGradeRate.create({
        data: { ruleVersionId: schedule.id, salaryGrade: 11, salaryStep: 1, monthlyRate: '31705' },
      });
    });
    const rule = await admin.nationalPayrollRuleVersion.create({
      data: {
        ruleKind: 'YEAR_END_BONUS_AND_CASH_GIFT',
        code: ruleCode,
        name: 'Test year-end bonus and cash gift',
        issuingAuthority: 'Test authority',
        issuanceReference: 'Test fixture, not an issuance',
        sourceUrl: 'https://example.test/year-end-bonus',
        verifiedOn: new Date('2026-11-15'),
        verifiedBy: 'LingkodHR test fixture',
        effectiveFrom: new Date('2882-01-01'),
        effectiveTo: new Date('2882-12-31'),
        parameters: {
          serviceFrom: '2882-01-01',
          asOf: '2882-10-31',
          minimumServiceMonths: 4,
          bonusMonthsOfBasicSalary: 1,
          cashGiftAmount: '5000.00',
          grantsSeparatedBeforeAsOf: true,
        },
      },
    });
    ruleId = rule.id;
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
      await transaction.$executeRaw`DELETE FROM salary_grade_rates WHERE rule_version_id IN (SELECT id FROM national_payroll_rule_versions WHERE code = ${scheduleCode})`;
    });
    await cleanupPlatformFixtures(admin, suffix);
    await admin.$disconnect();
  });

  it('pays the named components in a special period over the service window, and blocks what no rule settles', async () => {
    const { tenant, unitId } = await tenantWithUnit('YEB-MAIN');
    const full = { payBasis: 'MONTHLY_FULL_TIME', employmentFraction: null };
    const onTime = await employeeWith(tenant, unitId, 'JUL-1', ['2882-07-01', null], full);
    const late = await employeeWith(tenant, unitId, 'JUL-2', ['2882-07-02', null], full);
    const partTime = await employeeWith(tenant, unitId, 'PART', ['2880-01-01', null], {
      payBasis: 'PART_TIME_PROPORTIONAL',
      employmentFraction: '0.5',
    });
    const separated = await employeeWith(
      tenant,
      unitId,
      'GONE',
      ['2880-01-01', '2882-05-31'],
      full,
    );
    const hiredAfter = await employeeWith(tenant, unitId, 'NOV', ['2882-11-01', null], full);

    // A special period naming a component with no calculator is refused.
    const other = await createPayComponent(admin, suffix);
    const uncalculable = await createSpecial(tenant, 'OTHER', [other.id]);
    await expect(start(tenant, uncalculable)).rejects.toMatchObject({
      statusCode: 409,
      code: 'PAYROLL_PERIOD_SPECIAL_NOT_CALCULABLE',
    });

    const draft = await createSpecial(
      tenant,
      'BOTH',
      await components('YEAR_END_BONUS', 'CASH_GIFT'),
    );
    const started = await start(tenant, draft);
    expect(started).toMatchObject({ status: 'CALCULATING', calculationVersion: 1 });
    const snapshot = await admin.payrollRuleSnapshot.findFirstOrThrow({
      where: { payrollPeriodId: draft.id },
      include: { items: true },
    });
    expect(snapshot.items.map((item) => item.nationalPayrollRuleVersionId)).toContain(ruleId);

    const job = jobOf(tenant, started);
    expect(await calculation.run(job)).toEqual({
      outcome: 'RETURNED',
      results: 4,
      blockingExceptions: 4,
    });

    const results = new Map(
      (
        await admin.payrollEmployee.findMany({
          where: { payrollPeriodId: draft.id },
          include: { lines: true },
        })
      ).map((result) => [result.employeeId, result]),
    );
    // Service from 1 November is outside the window; no basic salary is paid.
    expect(results.has(hiredAfter)).toBe(false);
    const catalogue = new Map(
      (await admin.payComponent.findMany()).map((component) => [component.id, component.code]),
    );
    const paid = (employeeId: string) =>
      results
        .get(employeeId)!
        .lines.map((line) => [
          catalogue.get(line.payComponentId),
          line.amount.toString(),
          (line.sourceSnapshot as { taxTreatment?: string }).taxTreatment,
          line.ruleVersionId,
        ]);
    expect(paid(onTime)).toEqual([
      ['YEAR_END_BONUS', '31705', 'THIRTEENTH_MONTH_AND_OTHER_BENEFITS', ruleId],
      ['CASH_GIFT', '5000', 'DE_MINIMIS', ruleId],
    ]);
    expect(results.get(onTime)).toMatchObject({ status: 'CALCULATED' });
    expect(results.get(onTime)?.grossAmount.toString()).toBe('36705');
    // The unsettled part-time cash gift blocks the result, so its bonus line is not kept either.
    expect(results.get(partTime)).toMatchObject({ status: 'EXCEPTION' });
    expect(paid(partTime)).toEqual([]);
    expect(paid(late)).toEqual([]);
    expect(paid(separated)).toEqual([]);

    const exceptions = await admin.payrollException.findMany({
      where: { payrollPeriodId: draft.id },
    });
    expect(exceptions.map((e) => [e.employeeId, e.exceptionType, e.severity]).sort()).toEqual(
      [
        [late, 'CASH_GIFT_UNDER_MINIMUM_SERVICE_UNSETTLED', 'BLOCKING'],
        [partTime, 'CASH_GIFT_PART_TIME_UNSETTLED', 'BLOCKING'],
        [separated, 'YEAR_END_BONUS_SEPARATED_UNSETTLED', 'BLOCKING'],
        [separated, 'CASH_GIFT_SEPARATED_UNSETTLED', 'BLOCKING'],
      ].sort(),
    );
    expect(await admin.payrollPeriod.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({
      status: 'DRAFT',
    });
  });

  it('ends FOR_REVIEW when every Employee is settled, paying only the named cash gift', async () => {
    const { tenant, unitId } = await tenantWithUnit('YEB-CLEAN');
    const employee = await employeeWith(tenant, unitId, 'CLEAN', ['2880-01-01', null], {
      payBasis: 'MONTHLY_FULL_TIME',
      employmentFraction: null,
    });
    const draft = await createSpecial(tenant, 'GIFT', await components('CASH_GIFT'));
    const job = jobOf(tenant, await start(tenant, draft));
    expect(await calculation.run(job)).toEqual({ outcome: 'FOR_REVIEW', results: 1 });
    const [result] = await admin.payrollEmployee.findMany({
      where: { payrollPeriodId: draft.id },
      include: { lines: true },
    });
    expect(result).toMatchObject({ employeeId: employee, status: 'CALCULATED' });
    expect(result?.lines.map((line) => line.amount.toString())).toEqual(['5000']);
  });
});
