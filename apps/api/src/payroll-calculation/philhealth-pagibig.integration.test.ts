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
  PagIbigContributionCalculator,
  PhilHealthContributionCalculator,
} from './contribution.calculators';
import { DaysWithoutPayCalculator } from './days-without-pay.calculator';
import { PayrollCalculationService } from './payroll-calculation.service';
import { payrollSourcesReader, RecordedPayBases } from './payroll-calculation.test-fixtures';
import { YearEndBonusCalculator } from './year-end-bonus.calculator';

const enabled = process.env.DATABASE_E2E === 'true';
const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

describe.skipIf(!enabled)('PhilHealth and Pag-IBIG contributions in PostgreSQL', () => {
  // Test fixtures only: the rates, floor, ceiling, band, and Maximum Fund
  // Salary follow research R19 to R21, but no real version is loaded. The
  // salary rates are illustrative, and 2893 sits clear of every other test's
  // rule versions.
  const suffix = `${Date.now()}-phpi`;
  const scheduleCode = `${FIXTURE_PREFIX}PHPI-SCHEDULE-${suffix}`;
  const philHealthCode = `${FIXTURE_PREFIX}PHPI-PHILHEALTH-${suffix}`;
  const pagIbigCode = `${FIXTURE_PREFIX}PHPI-PAGIBIG-${suffix}`;
  const periods = new PayrollPeriodsService();
  const facts = new RecordedPayBases();
  const basis = new CompensationBasisService(facts);
  // GSIS, EC, PERA, RATA, and the withholding tax have their own tests; these
  // fixtures freeze none of them.
  const nothing = { calculate: () => ({ lines: [], exceptions: [] }) };
  const calculation = new PayrollCalculationService(
    basis,
    new BasicSalaryCalculator(),
    payrollSourcesReader(basis),
    new DaysWithoutPayCalculator(),
    nothing,
    nothing,
    new YearEndBonusCalculator(),
    nothing,
    nothing,
    nothing,
    nothing,
    new PhilHealthContributionCalculator(),
    new PagIbigContributionCalculator(),
    nothing,
  );
  let admin: PrismaClient;
  let philHealthId: string;
  let pagIbigId: string;
  const tenants: PayrollTenant[] = [];

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
        sourceUrl: 'https://example.test/contribution',
        verifiedOn: date('2026-11-15'),
        verifiedBy: 'LingkodHR test fixture',
        effectiveFrom: date('2893-01-01'),
        effectiveTo: date('2893-12-31'),
      };
      const schedule = await transaction.nationalPayrollRuleVersion.create({
        data: { ...rule, ruleKind: 'SALARY_SCHEDULE', code: scheduleCode, name: 'Test schedule' },
      });
      // Step 1 is below PhilHealth's floor and at Pag-IBIG's lower band, step
      // 2 between the floor and the ceiling, and step 3 above the ceiling.
      await transaction.salaryGradeRate.createMany({
        data: [
          { ruleVersionId: schedule.id, salaryGrade: 1, salaryStep: 1, monthlyRate: '1500' },
          { ruleVersionId: schedule.id, salaryGrade: 1, salaryStep: 2, monthlyRate: '30000' },
          { ruleVersionId: schedule.id, salaryGrade: 1, salaryStep: 3, monthlyRate: '120000' },
        ],
      });
      philHealthId = (
        await transaction.nationalPayrollRuleVersion.create({
          data: {
            ...rule,
            ruleKind: 'PHILHEALTH_CONTRIBUTION',
            code: philHealthCode,
            name: 'Test PhilHealth premium',
            parameters: {
              employeeRate: '0.025',
              employerRate: '0.025',
              monthlyIncomeFloor: '10000',
              monthlyIncomeCeiling: '100000',
            },
          },
        })
      ).id;
      pagIbigId = (
        await transaction.nationalPayrollRuleVersion.create({
          data: {
            ...rule,
            ruleKind: 'PAGIBIG_CONTRIBUTION',
            code: pagIbigCode,
            name: 'Test Pag-IBIG contribution',
            parameters: {
              employeeRate: '0.02',
              lowerBandEmployeeRate: '0.01',
              lowerBandMonthlyCompensation: '1500',
              employerRate: '0.02',
              maximumFundSalary: '10000',
            },
          },
        })
      ).id;
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
      await transaction.$executeRaw`DELETE FROM salary_grade_rates WHERE rule_version_id IN (SELECT id FROM national_payroll_rule_versions WHERE code = ${scheduleCode})`;
      await transaction.$executeRaw`DELETE FROM national_payroll_rule_versions WHERE code IN (${scheduleCode}, ${philHealthCode}, ${pagIbigCode})`;
    });
    await admin.$disconnect();
  });

  it('writes both contributions at the floor, the ceiling, and the lower band, and blocks a partial month', async () => {
    const tenant = await createPayrollTenant(admin, suffix, 'PHPI');
    tenants.push(tenant);
    const agencyId = tenant.agency.id;
    const membershipId = tenant.persons[0]!.membership.id;
    const unit = await admin.organizationUnit.create({
      data: { agencyId, code: `UNIT-PHPI-${suffix}`, unitType: 'DIVISION', status: 'ACTIVE' },
    });

    /** An SG-1 Employee at `salaryStep` from `from`, full-time. */
    async function employeeAt(label: string, salaryStep: number, from: string) {
      const employee = await admin.employee.create({
        data: {
          agencyId,
          employeeNumber: `PHPI-${label}-${suffix}`,
          legalName: `Contribution ${label}`,
          birthDate: new Date('1990-01-01'),
          sex: 'FEMALE',
          civilStatus: 'SINGLE',
          contactEmail: `phpi-${label.toLowerCase()}-${suffix}@example.test`,
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
              effectiveFrom: date(from),
              status: 'ACTIVE',
              createdByMembershipId: membershipId,
            },
          }),
      );
      facts.bases.set(employee.id, { payBasis: 'MONTHLY_FULL_TIME', employmentFraction: null });
      return employee.id;
    }
    const low = await employeeAt('LOW', 1, '2892-06-01');
    const middle = await employeeAt('MIDDLE', 2, '2892-06-01');
    const high = await employeeAt('HIGH', 3, '2892-06-01');
    const partial = await employeeAt('PARTIAL', 2, '2893-03-16');

    const draft = await periods.create(preparer(tenant), {
      code: `PHPI-2893-03-${suffix}`,
      runType: 'REGULAR',
      periodFrom: '2893-03-01',
      periodTo: '2893-03-31',
      cutoffAt: '2026-01-01T00:00:00+08:00',
      paymentDate: '2893-03-31',
    });
    const started = await periods.startCalculation(preparer(tenant), draft.id, {
      rowVersion: draft.rowVersion,
    });
    const job = {
      agencyId,
      payrollPeriodId: started.id,
      calculationVersion: started.calculationVersion,
    };
    // The partial month blocks basic salary, PhilHealth, and Pag-IBIG.
    expect(await calculation.run(job)).toEqual({
      outcome: 'RETURNED',
      results: 4,
      blockingExceptions: 3,
    });

    const results = new Map(
      (
        await admin.payrollEmployee.findMany({
          where: { payrollPeriodId: job.payrollPeriodId, calculationVersion: 1 },
          include: { lines: true, contributions: true },
        })
      ).map((result) => [result.employeeId, result]),
    );
    const components = new Map(
      (await admin.payComponent.findMany()).map((component) => [component.id, component.code]),
    );
    const linesOf = (employeeId: string) =>
      results
        .get(employeeId)!
        .lines.map((line) => [
          components.get(line.payComponentId),
          line.lineType,
          String(line.quantity),
          String(line.amount),
        ])
        .sort();
    const contributionsOf = (employeeId: string) =>
      results
        .get(employeeId)!
        .contributions.map((contribution) => [
          contribution.contributionType,
          contribution.employeeShare.toString(),
          contribution.employerShare.toString(),
          contribution.compensationBase.toString(),
          contribution.ruleVersionId,
        ])
        .sort();

    // ₱1,500: PhilHealth on the ₱10,000 floor; Pag-IBIG at the lower band's 1%.
    expect(linesOf(low)).toEqual(
      [
        ['BASIC_SALARY', 'EARNING', '1', '1500'],
        ['PAGIBIG_EMPLOYEE_SHARE', 'DEDUCTION', '1500', '15'],
        ['PAGIBIG_EMPLOYER_SHARE', 'EMPLOYER_SHARE', '1500', '30'],
        ['PHILHEALTH_EMPLOYEE_SHARE', 'DEDUCTION', '10000', '250'],
        ['PHILHEALTH_EMPLOYER_SHARE', 'EMPLOYER_SHARE', '10000', '250'],
      ].sort(),
    );
    expect(contributionsOf(low)).toEqual([
      ['PAGIBIG', '15', '30', '1500', pagIbigId],
      ['PHILHEALTH', '250', '250', '10000', philHealthId],
    ]);
    // ₱30,000: PhilHealth on the whole salary; Pag-IBIG on the ₱10,000 fund salary.
    expect(contributionsOf(middle)).toEqual([
      ['PAGIBIG', '200', '200', '10000', pagIbigId],
      ['PHILHEALTH', '750', '750', '30000', philHealthId],
    ]);
    // ₱120,000: PhilHealth held at the ₱100,000 ceiling.
    expect(contributionsOf(high)).toEqual([
      ['PAGIBIG', '200', '200', '10000', pagIbigId],
      ['PHILHEALTH', '2500', '2500', '100000', philHealthId],
    ]);
    // Only the employee shares reduce pay.
    expect(
      [low, middle, high].map((employeeId) => {
        const result = results.get(employeeId)!;
        return [result.totalDeductions.toString(), result.netAmount.toString()];
      }),
    ).toEqual([
      ['265', '1235'],
      ['950', '29050'],
      ['2700', '117300'],
    ]);

    expect(results.get(partial)).toMatchObject({
      status: 'EXCEPTION',
      lines: [],
      contributions: [],
    });
    const exceptions = await admin.payrollException.findMany({
      where: { payrollPeriodId: job.payrollPeriodId, calculationVersion: 1 },
    });
    expect(
      exceptions.map((exception) => [exception.employeeId, exception.exceptionType]).sort(),
    ).toEqual(
      [
        [partial, 'BASIC_SALARY_PARTIAL_MONTH'],
        [partial, 'PAGIBIG_PARTIAL_MONTH'],
        [partial, 'PHILHEALTH_PARTIAL_MONTH'],
      ].sort(),
    );
  });
});
