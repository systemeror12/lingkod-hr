import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import type { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CompensationBasisService } from '../compensation-basis/compensation-basis.service';
import { BasicSalaryCalculator } from '../payroll-calculation/basic-salary.calculator';
import { PayrollCalculationService } from '../payroll-calculation/payroll-calculation.service';
import type { CalculatorOutcome } from '../payroll-calculation/payroll-calculator';
import { payrollSourcesReader } from '../payroll-calculation/payroll-calculation.test-fixtures';
import { PayrollPeriodsService } from '../payroll-periods/payroll-periods.service';
import {
  cleanupPayrollTenants,
  createAdminClient,
  createPayrollTenant,
  FIXTURE_PREFIX,
  type PayrollTenant,
} from '../payroll-periods/payroll-periods.test-fixtures';
import { PersonnelSalaryFactsService } from '../personnel-salary-facts/personnel-salary-facts.service';
import { PayrollResultsService } from './payroll-results.service';

const enabled = process.env.DATABASE_E2E === 'true';

/** Personnel records no pay basis yet (#619); every fixture Employee is monthly full-time. */
class MonthlyFullTime extends PersonnelSalaryFactsService {
  override async readInTransaction(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    employeeId: string,
    from: string,
    to: string,
  ) {
    const stretches = await super.readInTransaction(transaction, agencyId, employeeId, from, to);
    return stretches.map((stretch) =>
      stretch.status === 'IN_SERVICE'
        ? { ...stretch, payBasis: 'MONTHLY_FULL_TIME', employmentFraction: null }
        : stretch,
    ) as never;
  }
}

describe.skipIf(!enabled)('Payroll workspace reads in PostgreSQL', () => {
  // Test fixtures only: the rate is not from any issuance, and 2876 sits clear
  // of every other test's rule versions.
  const suffix = `${Date.now()}-results`;
  const scheduleCode = `${FIXTURE_PREFIX}RESULTS-SCHEDULE-${suffix}`;
  const periods = new PayrollPeriodsService();
  const reads = new PayrollResultsService();
  const basis = new CompensationBasisService(new MonthlyFullTime());
  const nothing = { calculate: () => ({ lines: [], exceptions: [] }) };
  // Writes one Contribution Line, the Tax Line, and one Loan Deduction Line with
  // fixture amounts, so the read can be checked without the rules behind them.
  const recordedLines = {
    calculate: (): CalculatorOutcome => ({
      lines: [],
      exceptions: [],
      contributions: [
        {
          contributionType: 'PHILHEALTH',
          employeeShare: '792.6250',
          employerShare: '792.6250',
          compensationBase: '31705.0000',
          ruleVersionId: scheduleId,
        },
      ],
      tax: {
        taxableCompensation: '30912.3750',
        nonTaxableCompensation: '792.6250',
        withholdingTax: '1234.5000',
        ruleVersionId: scheduleId,
        yearToDateSnapshot: {
          taxYear: 2876,
          payrollPeriodIds: [],
          taxableCompensation: '61824.7500',
          nonTaxableCompensation: '1585.2500',
          withholdingTax: '2469.0000',
          deMinimisBenefits: {},
          thirteenthMonthAndOtherBenefits: '0.0000',
        },
      },
      loanDeductions: [
        {
          deductionObligationId: obligationId,
          priority: 1,
          amountDue: '2000.0000',
          deductedAmount: '1500.0000',
          notDeductedAmount: '500.0000',
          ruleVersionId: scheduleId,
        },
      ],
    }),
  };
  const calculation = new PayrollCalculationService(
    basis,
    new BasicSalaryCalculator(),
    payrollSourcesReader(basis),
    recordedLines,
    nothing,
    nothing,
    nothing,
    nothing,
    nothing,
    nothing,
    nothing,
    nothing,
    nothing,
    nothing,
  );
  let admin: PrismaClient;
  let scheduleId: string;
  let tenant: PayrollTenant;
  let employeeId: string;
  let obligationId: string;
  let other: PayrollTenant;

  const preparer = (): RequestContext => ({
    ...tenant.persons[0]!.context,
    permissions: [
      { code: 'payroll.periods.create', scopePolicy: 'AGENCY' },
      { code: 'payroll.periods.calculate', scopePolicy: 'AGENCY' },
      { code: 'payroll.periods.read', scopePolicy: 'AGENCY' },
    ],
  });

  beforeAll(async () => {
    admin = await createAdminClient();
    scheduleId = await admin.$transaction(async (transaction) => {
      const version = await transaction.nationalPayrollRuleVersion.create({
        data: {
          ruleKind: 'SALARY_SCHEDULE',
          code: scheduleCode,
          name: 'Test salary schedule',
          issuingAuthority: 'Test authority',
          issuanceReference: 'Test fixture, not an issuance',
          sourceUrl: 'https://example.test/salary-schedule',
          verifiedOn: new Date('2026-11-15'),
          verifiedBy: 'LingkodHR test fixture',
          effectiveFrom: new Date('2876-01-01'),
          effectiveTo: new Date('2876-12-31'),
        },
      });
      await transaction.salaryGradeRate.create({
        data: { ruleVersionId: version.id, salaryGrade: 11, salaryStep: 1, monthlyRate: '31705' },
      });
      return version.id;
    });
    tenant = await createPayrollTenant(admin, suffix, 'RESULTS');
    const { agency, persons } = tenant;
    const membershipId = persons[0]!.membership.id;
    const unit = await admin.organizationUnit.create({
      data: {
        agencyId: agency.id,
        code: `UNIT-RESULTS-${suffix}`,
        unitType: 'DIVISION',
        status: 'ACTIVE',
      },
    });
    const employee = await admin.employee.create({
      data: {
        agencyId: agency.id,
        employeeNumber: `RESULTS-${suffix}`,
        legalName: 'Results Employee',
        birthDate: new Date('1990-01-01'),
        sex: 'FEMALE',
        civilStatus: 'SINGLE',
        contactEmail: `results-${suffix}@example.test`,
        serviceStatus: 'ACTIVE',
        createdByMembershipId: membershipId,
        updatedByMembershipId: membershipId,
      },
    });
    employeeId = employee.id;
    // The obligation's authority and payee rule are not what this test reads, so
    // the fixture skips their foreign keys.
    obligationId = await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      const obligation = await transaction.deductionObligation.create({
        data: {
          agencyId: agency.id,
          employeeId,
          payeeCategory: 'GSIS',
          payeeName: 'Government Service Insurance System',
          issuerReference: `RESULTS-LOAN-${suffix}`,
          incurredOn: new Date('2876-01-15'),
          outstandingBalance: '24000',
          scheduledAmount: '2000',
          authorityDocumentVersionId: '00000000-0000-4000-8000-000000000001',
          payeeRuleVersionId: scheduleId,
          effectiveFrom: new Date('2876-01-01'),
          status: 'ACTIVE',
          recordedByMembershipId: membershipId,
        },
      });
      return obligation.id;
    });
    other = await createPayrollTenant(admin, suffix, 'RESULTS-OTHER');
    await withDatabaseContext(
      { ...persons[0]!.scope, capabilities: ['personnel-baseline-transition'] },
      (transaction) =>
        transaction.serviceSegment.create({
          data: {
            agencyId: agency.id,
            employeeId,
            organizationUnitId: unit.id,
            appointmentStatus: 'PERMANENT',
            salaryGrade: 11,
            salaryStep: 1,
            effectiveFrom: new Date('2876-01-01'),
            effectiveTo: null,
            status: 'ACTIVE',
            createdByMembershipId: membershipId,
          },
        }),
    );
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      const where = { agencyId: tenant.agency.id };
      await transaction.serviceSegment.deleteMany({ where });
      await transaction.loanDeductionLine.deleteMany({ where });
      await transaction.deductionObligation.deleteMany({ where });
      await transaction.employee.deleteMany({ where });
      await transaction.organizationUnit.deleteMany({ where });
      await transaction.salaryGradeRate.deleteMany({ where: { ruleVersionId: scheduleId } });
      await transaction.nationalPayrollRuleVersion.deleteMany({ where: { id: scheduleId } });
    });
    await cleanupPayrollTenants(admin, [tenant, other]);
    await admin.$disconnect();
  });

  it('lists periods with current totals, hides them while calculating, and reads lines with provenance', async () => {
    const context = preparer();
    const created = await periods.create(context, {
      code: `RESULTS-2876-03-${suffix}`,
      runType: 'REGULAR',
      periodFrom: '2876-03-01',
      periodTo: '2876-03-31',
      cutoffAt: '2026-01-01T00:00:00+08:00',
      paymentDate: '2876-03-15',
    });

    const draft = await reads.listPeriods(context);
    expect(draft.periods).toEqual([expect.objectContaining({ id: created.id, totals: null })]);
    expect(draft.payComponents).toContainEqual(
      expect.objectContaining({ code: 'BASIC_SALARY', name: expect.any(String) }),
    );

    const started = await periods.startCalculation(context, created.id, {
      rowVersion: created.rowVersion,
    });
    const calculating = await reads.listPeriods(context);
    expect(calculating.periods[0]).toMatchObject({ status: 'CALCULATING', totals: null });

    const outcome = await calculation.run({
      agencyId: tenant.agency.id,
      payrollPeriodId: created.id,
      calculationVersion: started.calculationVersion,
    });
    expect(outcome).toEqual({ outcome: 'FOR_REVIEW', results: 1 });

    const calculated = await reads.listPeriods(context);
    expect(calculated.periods[0]).toMatchObject({
      status: 'FOR_REVIEW',
      calculationVersion: 1,
      totals: {
        resultCount: 1,
        grossAmount: '31705.0000',
        totalDeductions: '0.0000',
        netAmount: '31705.0000',
      },
    });

    const { calculationVersion, results } = await reads.listResults(context, created.id, {});
    expect(calculationVersion).toBe(1);
    expect(results).toEqual([
      expect.objectContaining({ employeeId, status: 'CALCULATED', netAmount: '31705.0000' }),
    ]);

    const detail = await reads.readResult(context, created.id, results[0]!.id);
    expect(detail.calculationHash).toMatch(/^[0-9a-f]{64}$/);
    expect(detail.lines).toEqual([
      expect.objectContaining({
        payComponent: expect.objectContaining({ code: 'BASIC_SALARY' }),
        lineType: 'EARNING',
        quantity: '1.0000',
        rate: '31705.00000000',
        amount: '31705.0000',
        ruleVersion: { id: scheduleId, code: scheduleCode, name: 'Test salary schedule' },
        sources: [],
        sourceSnapshot: expect.objectContaining({ unit: 'MONTH', salaryGrade: 11 }),
      }),
    ]);
    const ruleVersion = { id: scheduleId, code: scheduleCode, name: 'Test salary schedule' };
    expect(detail.contributions).toEqual([
      {
        id: expect.any(String),
        contributionType: 'PHILHEALTH',
        employeeShare: '792.6250',
        employerShare: '792.6250',
        compensationBase: '31705.0000',
        ruleVersion,
      },
    ]);
    expect(detail.taxLine).toEqual({
      id: expect.any(String),
      taxableCompensation: '30912.3750',
      nonTaxableCompensation: '792.6250',
      withholdingTax: '1234.5000',
      ruleVersion,
      yearToDateSnapshot: expect.objectContaining({
        taxYear: 2876,
        taxableCompensation: '61824.7500',
        withholdingTax: '2469.0000',
      }),
    });
    expect(detail.loanDeductions).toEqual([
      {
        id: expect.any(String),
        deductionObligationId: obligationId,
        payeeCategory: 'GSIS',
        payeeName: 'Government Service Insurance System',
        issuerReference: `RESULTS-LOAN-${suffix}`,
        priority: 1,
        amountDue: '2000.0000',
        deductedAmount: '1500.0000',
        notDeductedAmount: '500.0000',
        ruleVersion,
      },
    ]);

    // Another Agency's reader finds neither the period nor the result.
    const foreign: RequestContext = {
      ...other.persons[0]!.context,
      permissions: [{ code: 'payroll.periods.read', scopePolicy: 'AGENCY' }],
    };
    await expect(reads.readResult(foreign, created.id, results[0]!.id)).rejects.toMatchObject({
      code: 'PAYROLL_RESULT_NOT_FOUND',
    });
  });

  it('refuses a reader without payroll.periods.read and a result of another period', async () => {
    const noRead = { ...preparer(), permissions: [] };
    await expect(reads.listPeriods(noRead)).rejects.toMatchObject({
      code: 'PAYROLL_PERIOD_READ_FORBIDDEN',
    });
    const [period] = (await reads.listPeriods(preparer())).periods;
    await expect(
      reads.readResult(preparer(), period!.id, '00000000-0000-4000-8000-000000000000'),
    ).rejects.toMatchObject({ code: 'PAYROLL_RESULT_NOT_FOUND' });
    await expect(
      reads.listResults(preparer(), '00000000-0000-4000-8000-000000000000', {}),
    ).rejects.toMatchObject({ code: 'PAYROLL_PERIOD_NOT_FOUND' });
  });
});
