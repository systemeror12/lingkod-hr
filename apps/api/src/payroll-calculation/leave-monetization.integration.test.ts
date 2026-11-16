import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { Prisma, type PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CompensationBasisService } from '../compensation-basis/compensation-basis.service';
import type { PayrollMonetizationCalculator } from '../payroll-monetization/payroll-monetization.calculator';
import type { PayrollInputSubmission } from '../payroll-inputs/payroll-inputs.schemas';
import { PayrollInputsService } from '../payroll-inputs/payroll-inputs.service';
import { PayrollPeriodsService } from '../payroll-periods/payroll-periods.service';
import {
  cleanupPayrollTenants,
  createAdminClient,
  createPayrollTenant,
  FIXTURE_PREFIX,
  type PayrollTenant,
} from '../payroll-periods/payroll-periods.test-fixtures';
import { BasicSalaryCalculator } from './basic-salary.calculator';
import { DaysWithoutPayCalculator } from './days-without-pay.calculator';
import { LEAVE_MONETIZATION_COMPONENT_CODE } from './leave-monetization.calculator';
import { type CalculationJob, PayrollCalculationService } from './payroll-calculation.service';
import { payrollSourcesReader, RecordedPayBases } from './payroll-calculation.test-fixtures';
import { YearEndBonusCalculator } from './year-end-bonus.calculator';

const enabled = process.env.DATABASE_E2E === 'true';

describe.skipIf(!enabled)('Leave monetization in calculation in PostgreSQL', () => {
  // Test fixtures only: the rate is not from any issuance, and 2888 sits clear
  // of every other test's rule versions.
  const suffix = `${Date.now()}-monetize`;
  const scheduleCode = `${FIXTURE_PREFIX}MONETIZE-SCHEDULE-${suffix}`;
  const periods = new PayrollPeriodsService();
  // Valuing a monetization has its own test (#339); here every credit is 1,000.25.
  const inputs = new PayrollInputsService({
    valueInTransaction: async (_transaction: unknown, request: PayrollInputSubmission) => ({
      ok: true,
      amount: new Prisma.Decimal(request.quantity!).times('1000.25').toFixed(2),
      valuation: { test: 'Fixture valuation, not an authority' },
    }),
  } as unknown as PayrollMonetizationCalculator);
  const facts = new RecordedPayBases();
  const basis = new CompensationBasisService(facts);
  // Contributions, PERA, and RATA have their own tests; no fixture freezes their versions.
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
  );
  let admin: PrismaClient;
  let scheduleId: string;
  const tenants: PayrollTenant[] = [];

  const preparer = (tenant: PayrollTenant): RequestContext => ({
    ...tenant.persons[0]!.context,
    permissions: [
      { code: 'payroll.periods.create', scopePolicy: 'AGENCY' },
      { code: 'payroll.periods.calculate', scopePolicy: 'AGENCY' },
    ],
  });

  /** Rows a later ticket's command will write, written here with triggers off. */
  const seed = (run: (transaction: Prisma.TransactionClient) => Promise<unknown>) =>
    admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await run(transaction);
    });

  /** An SG-11 step 1 Employee on the monthly full-time basis from `from`. */
  async function employeeFrom(tenant: PayrollTenant, unitId: string, label: string, from: string) {
    const agencyId = tenant.agency.id;
    const membershipId = tenant.persons[0]!.membership.id;
    const employee = await admin.employee.create({
      data: {
        agencyId,
        employeeNumber: `MON-${label}-${suffix}`,
        legalName: `Monetization ${label}`,
        birthDate: new Date('1990-01-01'),
        sex: 'FEMALE',
        civilStatus: 'SINGLE',
        contactEmail: `mon-${label.toLowerCase()}-${suffix}@example.test`,
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
            organizationUnitId: unitId,
            appointmentStatus: 'PERMANENT',
            salaryGrade: 11,
            salaryStep: 1,
            effectiveFrom: new Date(from),
            status: 'ACTIVE',
            createdByMembershipId: membershipId,
          },
        }),
    );
    facts.bases.set(employee.id, { payBasis: 'MONTHLY_FULL_TIME', employmentFraction: null });
    return employee.id;
  }

  /** Leave's Monetization Posting handoff of `credits` credits. */
  const monetization = (
    agencyId: string,
    employeeId: string,
    label: string,
    credits: string,
  ): PayrollInputSubmission => ({
    agencyId,
    employeeId,
    sourceModule: 'LEAVE',
    inputKind: 'MONETIZATION_EARNING',
    sourceKey: `MONETIZATION:${label}-${suffix}`,
    sourceType: 'MONETIZATION_POSTING',
    sourceId: crypto.randomUUID(),
    effectiveDate: '2888-02-20',
    quantity: credits,
    payload: {
      calculatorKind: 'MCL_FIXED_FACTOR_0_0481927',
      factor: '0.0481927',
      valuationDate: '2888-02-20',
    },
  });

  const idOf = (answer: Awaited<ReturnType<PayrollInputsService['acceptInTransaction']>>) => {
    if (!('payrollInputId' in answer)) throw new Error(`Payroll refused: ${answer.reason}`);
    return answer.payrollInputId;
  };

  const accept = (submission: PayrollInputSubmission) =>
    withDatabaseContext({ agencyId: submission.agencyId }, async (transaction) =>
      idOf(await inputs.acceptInTransaction(transaction, submission)),
    );

  /** The Employee's monetization lines in one version, as `[payroll_input_id, quantity, amount]`. */
  async function monetizationLines(job: CalculationJob, employeeId: string) {
    const component = await admin.payComponent.findUniqueOrThrow({
      where: { code: LEAVE_MONETIZATION_COMPONENT_CODE },
    });
    const result = await admin.payrollEmployee.findFirst({
      where: {
        payrollPeriodId: job.payrollPeriodId,
        calculationVersion: job.calculationVersion,
        employeeId,
      },
      include: { lines: { where: { payComponentId: component.id } } },
    });
    const rows = [];
    for (const line of result?.lines ?? []) {
      expect(line).toMatchObject({ lineType: 'EARNING', ruleVersionId: null, rate: null });
      expect(line.sourceSnapshot).toMatchObject({ taxTreatment: 'NON_TAXABLE' });
      const sources = await admin.payrollLineSource.findMany({ where: { payrollLineId: line.id } });
      rows.push([
        sources.map((source) => source.payrollInputId).join(','),
        line.quantity?.toString(),
        line.amount.toString(),
      ]);
    }
    return rows.sort();
  }

  const statusOf = async (id: string) =>
    (await admin.payrollInput.findUniqueOrThrow({ where: { id } })).status;

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
          effectiveFrom: new Date('2888-01-01'),
          effectiveTo: new Date('2888-12-31'),
        },
      });
      await transaction.salaryGradeRate.create({
        data: { ruleVersionId: version.id, salaryGrade: 11, salaryStep: 1, monthlyRate: '44000' },
      });
      return version.id;
    });
  });

  afterAll(async () => {
    if (!admin) return;
    await seed(async (transaction) => {
      for (const { agency } of tenants) {
        await transaction.payrollLineSource.deleteMany({ where: { agencyId: agency.id } });
        await transaction.payrollInput.deleteMany({ where: { agencyId: agency.id } });
        await transaction.outboxEvent.deleteMany({ where: { agencyId: agency.id } });
      }
    });
    await cleanupPayrollTenants(admin, tenants);
    await seed(async (transaction) => {
      await transaction.$executeRaw`DELETE FROM salary_grade_rates WHERE rule_version_id = CAST(${scheduleId} AS uuid)`;
      await transaction.$executeRaw`DELETE FROM national_payroll_rule_versions WHERE code = ${scheduleCode}`;
    });
    await admin.$disconnect();
  });

  it('pays each input taken by the cutoff once per version, and never one cancelled, late, or consumed', async () => {
    const tenant = await createPayrollTenant(admin, suffix, 'MON');
    tenants.push(tenant);
    const agencyId = tenant.agency.id;
    const unit = await admin.organizationUnit.create({
      data: { agencyId, code: `UNIT-MON-${suffix}`, unitType: 'DIVISION', status: 'ACTIVE' },
    });
    const paid = await employeeFrom(tenant, unit.id, 'PAID', '2887-06-01');
    // Hired mid-March: a partial month blocks, so March returns to DRAFT for recalculation.
    const partial = await employeeFrom(tenant, unit.id, 'PARTIAL', '2888-03-16');

    const kept = await accept(monetization(agencyId, paid, 'KEPT', '10'));
    const withdrawn = await accept(monetization(agencyId, paid, 'WITHDRAWN', '5'));

    let march = await periods.create(preparer(tenant), {
      code: `MON-2888-03-${suffix}`,
      runType: 'REGULAR',
      periodFrom: '2888-03-01',
      periodTo: '2888-03-31',
      cutoffAt: '2026-01-01T00:00:00+08:00',
      paymentDate: '2888-03-31',
    });
    const start = async (periodId: string) => {
      const row = await admin.payrollPeriod.findUniqueOrThrow({ where: { id: periodId } });
      const started = await periods.startCalculation(preparer(tenant), periodId, {
        rowVersion: row.rowVersion,
      });
      return {
        agencyId,
        payrollPeriodId: periodId,
        calculationVersion: started.calculationVersion,
      };
    };

    // An input accepted before the cutoff whose transaction is still open when
    // calculation starts: the start waits for it, so the calculation and every
    // recalculation at that cutoff take it.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let inserted!: (id: string) => void;
    const insertedId = new Promise<string>((resolve) => (inserted = resolve));
    const holding = withDatabaseContext({ agencyId }, async (transaction) => {
      const id = idOf(
        await inputs.acceptInTransaction(transaction, monetization(agencyId, paid, 'OPEN', '2')),
      );
      inserted(id);
      await gate;
    });
    const open = await insertedId;
    march = await periods.moveCutoff(preparer(tenant), march.id, {
      cutoffAt: new Date().toISOString(),
      reason: 'Test: the cutoff follows the inputs.',
      rowVersion: march.rowVersion,
    });
    const starting = start(march.id);
    const raced = await Promise.race([
      starting.then(() => 'started'),
      new Promise((resolve) => setTimeout(() => resolve('waiting'), 500)),
    ]);
    expect(raced).toBe('waiting');
    release();
    await holding;
    const first = await starting;

    // Accepted while March is CALCULATING, after its cutoff: it waits for a later cutoff.
    const late = await accept(monetization(agencyId, paid, 'LATE', '3'));

    expect(await calculation.run(first)).toEqual({
      outcome: 'RETURNED',
      results: 2,
      blockingExceptions: 1,
    });
    expect(await monetizationLines(first, paid)).toEqual(
      [
        [kept, '10', '10002.5'],
        [withdrawn, '5', '5001.25'],
        [open, '2', '2000.5'],
      ].sort(),
    );
    const result = await admin.payrollEmployee.findFirstOrThrow({
      where: { payrollPeriodId: march.id, calculationVersion: 1, employeeId: paid },
    });
    expect([result.grossAmount, result.netAmount].map(String)).toEqual(['61004.25', '61004.25']);
    expect(await monetizationLines(first, partial)).toEqual([]);
    for (const id of [kept, withdrawn, open, late]) expect(await statusOf(id)).toBe('PENDING');

    // Leave withdraws one input while March is DRAFT again: the recalculation
    // pays the rest once each, and still not the late one.
    expect(
      await withDatabaseContext({ agencyId }, (transaction) =>
        inputs.withdrawInTransaction(transaction, {
          agencyId,
          sourceModule: 'LEAVE',
          payrollInputId: withdrawn,
          correctionKey: `MONETIZATION_ADJUSTMENT:${suffix}`,
        }),
      ),
    ).toEqual({ outcome: 'WITHDRAWN', payrollInputId: withdrawn });
    const second = await start(march.id);
    expect(await calculation.run(second)).toMatchObject({ outcome: 'RETURNED' });
    expect(await monetizationLines(second, paid)).toEqual(
      [
        [kept, '10', '10002.5'],
        [open, '2', '2000.5'],
      ].sort(),
    );
    for (const id of [kept, open, late]) expect(await statusOf(id)).toBe('PENDING');

    // March is finalized and consumes what it paid (standing in for #335).
    // April's cutoff also passes after those inputs, but it takes only the late one.
    await seed(async (transaction) => {
      await transaction.payrollPeriod.update({
        where: { id: march.id },
        data: { status: 'FINALIZED' },
      });
      await transaction.payrollInput.updateMany({
        where: { id: { in: [kept, open] } },
        data: { status: 'CONSUMED', consumedByPayrollPeriodId: march.id },
      });
    });
    const april = await periods.create(preparer(tenant), {
      code: `MON-2888-04-${suffix}`,
      runType: 'REGULAR',
      periodFrom: '2888-04-01',
      periodTo: '2888-04-30',
      cutoffAt: new Date().toISOString(),
      paymentDate: '2888-04-30',
    });
    const third = await start(april.id);
    expect(await calculation.run(third)).toEqual({ outcome: 'FOR_REVIEW', results: 2 });
    expect(await monetizationLines(third, paid)).toEqual([[late, '3', '3000.75']]);
    expect(await statusOf(late)).toBe('PENDING');
  });
});
