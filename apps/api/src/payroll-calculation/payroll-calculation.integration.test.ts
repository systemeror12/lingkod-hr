import type { RequestContext } from '@lingkod-hr/auth';
import { prisma, setDatabaseContext, withDatabaseContext } from '@lingkod-hr/database';
import { Prisma, type PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CompensationBasisService } from '../compensation-basis/compensation-basis.service';
import { PersonnelSalaryFactsService } from '../personnel-salary-facts/personnel-salary-facts.service';
import { PayrollPeriodsService } from '../payroll-periods/payroll-periods.service';
import {
  cleanupPayrollTenants,
  createAdminClient,
  createPayrollTenant,
  FIXTURE_PREFIX,
  type PayrollTenant,
} from '../payroll-periods/payroll-periods.test-fixtures';
import { BasicSalaryCalculator } from './basic-salary.calculator';
import { YearEndBonusCalculator } from './year-end-bonus.calculator';
import { dueCalculations } from './payroll-calculation.job';
import { type CalculationJob, PayrollCalculationService } from './payroll-calculation.service';

const enabled = process.env.DATABASE_E2E === 'true';

type RecordedBasis = { payBasis: string; employmentFraction: string | null };

/**
 * Personnel records no pay basis yet (#619). This stands in for the facts it
 * will record, per Employee, on the same Service Segments.
 */
class RecordedPayBases extends PersonnelSalaryFactsService {
  readonly bases = new Map<string, RecordedBasis>();

  override async readInTransaction(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    employeeId: string,
    from: string,
    to: string,
  ) {
    const stretches = await super.readInTransaction(transaction, agencyId, employeeId, from, to);
    const basis = this.bases.get(employeeId);
    return stretches.map((stretch) =>
      stretch.status === 'IN_SERVICE' && basis ? { ...stretch, ...basis } : stretch,
    ) as never;
  }
}

describe.skipIf(!enabled)('Basic salary calculation in PostgreSQL', () => {
  // Test fixtures only: the rates are not from any issuance, and 2881 sits
  // clear of every other test's rule versions.
  const suffix = `${Date.now()}-calc`;
  const scheduleCode = `${FIXTURE_PREFIX}CALC-SCHEDULE-${suffix}`;
  const periods = new PayrollPeriodsService();
  const facts = new RecordedPayBases();
  const calculation = new PayrollCalculationService(
    new CompensationBasisService(facts),
    new BasicSalaryCalculator(),
    new YearEndBonusCalculator(),
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

  /** An Employee with one Service Segment per `[from, to, step]`, all SG-11. */
  async function employeeWith(
    tenant: PayrollTenant,
    unitId: string,
    label: string,
    segments: [string, string | null, number][],
    basis?: RecordedBasis,
  ) {
    const { agency, persons } = tenant;
    const membershipId = persons[0]!.membership.id;
    const employee = await admin.employee.create({
      data: {
        agencyId: agency.id,
        employeeNumber: `CALC-${label}-${suffix}`,
        legalName: `Calculation ${label}`,
        birthDate: new Date('1990-01-01'),
        sex: 'FEMALE',
        civilStatus: 'SINGLE',
        contactEmail: `calc-${label.toLowerCase()}-${suffix}@example.test`,
        serviceStatus: 'ACTIVE',
        createdByMembershipId: membershipId,
        updatedByMembershipId: membershipId,
      },
    });
    await withDatabaseContext(
      { ...persons[0]!.scope, capabilities: ['personnel-baseline-transition'] },
      async (transaction) => {
        for (const [from, to, salaryStep] of segments) {
          await transaction.serviceSegment.create({
            data: {
              agencyId: agency.id,
              employeeId: employee.id,
              organizationUnitId: unitId,
              appointmentStatus: 'PERMANENT',
              salaryGrade: 11,
              salaryStep,
              effectiveFrom: new Date(from),
              effectiveTo: to ? new Date(to) : null,
              status: to ? 'CLOSED' : 'ACTIVE',
              createdByMembershipId: membershipId,
            },
          });
        }
      },
    );
    if (basis) facts.bases.set(employee.id, basis);
    return employee.id;
  }

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

  const createPeriod = (tenant: PayrollTenant, month: string, cutoffAt: string) =>
    periods.create(preparer(tenant), {
      code: `CALC-${month}-${suffix}`,
      runType: 'REGULAR',
      periodFrom: `${month}-01`,
      periodTo: new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0))
        .toISOString()
        .slice(0, 10),
      cutoffAt,
      paymentDate: `${month}-15`,
    });

  const jobOf = (tenant: PayrollTenant, period: { id: string; calculationVersion: number }) => ({
    agencyId: tenant.agency.id,
    payrollPeriodId: period.id,
    calculationVersion: period.calculationVersion,
  });

  const periodRow = (id: string) => admin.payrollPeriod.findUniqueOrThrow({ where: { id } });

  const resultsOf = (job: CalculationJob) =>
    admin.payrollEmployee.findMany({
      where: { payrollPeriodId: job.payrollPeriodId, calculationVersion: job.calculationVersion },
      include: { lines: true },
    });

  const exceptionsOf = (job: CalculationJob) =>
    admin.payrollException.findMany({
      where: { payrollPeriodId: job.payrollPeriodId, calculationVersion: job.calculationVersion },
    });

  beforeAll(async () => {
    admin = await createAdminClient();
    // A schedule's rates are admitted only in the transaction that inserts it.
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
          effectiveFrom: new Date('2881-01-01'),
          effectiveTo: new Date('2881-12-31'),
        },
      });
      await transaction.salaryGradeRate.createMany({
        data: [
          { ruleVersionId: version.id, salaryGrade: 11, salaryStep: 1, monthlyRate: '31705' },
          { ruleVersionId: version.id, salaryGrade: 11, salaryStep: 2, monthlyRate: '32014' },
        ],
      });
      return version.id;
    });
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.$transaction(async (transaction) => {
      // The immutability triggers are the point of the tables; only the test lifts them.
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      const where = { agencyId: { in: tenants.map((tenant) => tenant.agency.id) } };
      await transaction.serviceSegment.deleteMany({ where });
      await transaction.employee.deleteMany({ where });
      await transaction.organizationUnit.deleteMany({ where });
      await transaction.$executeRaw`DELETE FROM salary_grade_rates WHERE rule_version_id = CAST(${scheduleId} AS uuid)`;
      await transaction.$executeRaw`DELETE FROM national_payroll_rule_versions WHERE code = ${scheduleCode}`;
    });
    await cleanupPayrollTenants(admin, tenants);
    await admin.$disconnect();
  });

  it('starts once under two starts, survives a crash and a retried job, and blocks what no rule settles', async () => {
    const { tenant, unitId } = await tenantWithUnit('CALC-MAIN');
    const full = await employeeWith(tenant, unitId, 'FULL', [['2880-06-01', null, 1]], {
      payBasis: 'MONTHLY_FULL_TIME',
      employmentFraction: null,
    });
    const part = await employeeWith(tenant, unitId, 'PART', [['2880-06-01', null, 1]], {
      payBasis: 'PART_TIME_PROPORTIONAL',
      employmentFraction: '0.5',
    });
    const casual = await employeeWith(tenant, unitId, 'CASUAL', [['2880-06-01', null, 1]], {
      payBasis: 'CASUAL_DAILY_WAGE',
      employmentFraction: null,
    });
    // A step increment on 10 March.
    const stepped = await employeeWith(
      tenant,
      unitId,
      'STEP',
      [
        ['2880-06-01', '2881-03-09', 1],
        ['2881-03-10', null, 2],
      ],
      { payBasis: 'MONTHLY_FULL_TIME', employmentFraction: null },
    );
    const partial = await employeeWith(tenant, unitId, 'PARTIAL', [['2881-03-16', null, 1]], {
      payBasis: 'MONTHLY_FULL_TIME',
      employmentFraction: null,
    });
    const noBasis = await employeeWith(tenant, unitId, 'NO-BASIS', [['2880-06-01', null, 1]]);
    const separated = await employeeWith(tenant, unitId, 'GONE', [['2880-06-01', '2881-02-28', 1]]);

    const draft = await createPeriod(tenant, '2881-03', '2026-01-01T00:00:00+08:00');
    const start = () =>
      periods.startCalculation(preparer(tenant), draft.id, { rowVersion: draft.rowVersion });

    // Two starts at once: one takes version 1, the other finds the period moved.
    const starts = await Promise.allSettled([start(), start()]);
    const started = starts.flatMap((settled) =>
      settled.status === 'fulfilled' ? [settled.value] : [],
    );
    const refused = starts.flatMap((settled) =>
      settled.status === 'rejected' ? [settled.reason as { statusCode: number }] : [],
    );
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ status: 'CALCULATING', calculationVersion: 1 });
    expect(refused).toEqual([expect.objectContaining({ statusCode: 409 })]);
    expect(await admin.payrollRuleSnapshot.count({ where: { payrollPeriodId: draft.id } })).toBe(1);

    const job = jobOf(tenant, started[0]!);
    expect(await dueCalculations()).toContainEqual(job);

    // A run that dies mid-transaction leaves nothing, and the period stays queued.
    await expect(
      prisma.$transaction(async (transaction) => {
        await setDatabaseContext(transaction, { agencyId: job.agencyId });
        await calculation.calculateInTransaction(transaction, job);
        throw new Error('process died');
      }),
    ).rejects.toThrow('process died');
    expect(await resultsOf(job)).toEqual([]);
    expect((await periodRow(draft.id)).status).toBe('CALCULATING');

    // The retried job runs twice at once and again later: it calculates once.
    const runs = await Promise.all([calculation.run(job), calculation.run(job)]);
    expect(runs.map((run) => run.outcome).sort()).toEqual(['RETURNED', 'SKIPPED']);
    expect(runs).toContainEqual({ outcome: 'RETURNED', results: 6, blockingExceptions: 4 });
    expect(await calculation.run(job)).toEqual({ outcome: 'SKIPPED' });

    // Blocking exceptions return the period to DRAFT with the reason.
    expect(await periodRow(draft.id)).toMatchObject({ status: 'DRAFT', calculationVersion: 1 });
    expect(await dueCalculations()).not.toContainEqual(job);
    const audit = await admin.auditEvent.findMany({
      where: { entityId: draft.id, action: { startsWith: 'PAYROLL_PERIOD_CALCULATION' } },
      orderBy: { occurredAt: 'asc' },
    });
    expect(audit.map((event) => [event.action, event.newStatus, event.actorType])).toEqual([
      ['PAYROLL_PERIOD_CALCULATION_STARTED', 'CALCULATING', 'USER'],
      ['PAYROLL_PERIOD_CALCULATION_RETURNED', 'DRAFT', 'SYSTEM'],
    ]);
    expect(audit[1]?.reason).toContain('4 blocking exceptions in calculation version 1');

    const results = new Map((await resultsOf(job)).map((result) => [result.employeeId, result]));
    expect(results.has(separated)).toBe(false);
    expect([...results.keys()].sort()).toEqual(
      [full, part, casual, stepped, partial, noBasis].sort(),
    );

    // Each line stores its source record, quantity, rate, amount, and rule version (PAY-007).
    const basicSalary = await admin.payComponent.findUniqueOrThrow({
      where: { code: 'BASIC_SALARY' },
    });
    for (const [employeeId, amount] of [
      [full, '31705'],
      [part, '15852.5'],
    ] as const) {
      const result = results.get(employeeId)!;
      expect(result).toMatchObject({ status: 'CALCULATED', calculationHash: /^[0-9a-f]{64}$/ });
      expect(result.grossAmount.toString()).toBe(amount);
      expect(result.netAmount.toString()).toBe(amount);
      expect(result.lines).toHaveLength(1);
      const [line] = result.lines;
      expect(line).toMatchObject({
        payComponentId: basicSalary.id,
        ruleVersionId: scheduleId,
        lineType: 'EARNING',
        sourceSnapshot: expect.objectContaining({
          unit: 'MONTH',
          serviceSegments: [expect.objectContaining({ from: '2881-03-01', to: '2881-03-31' })],
          salarySchedule: expect.objectContaining({ ruleVersionId: scheduleId }),
        }),
      });
      expect([line?.quantity?.toString(), line?.rate?.toString(), line?.amount.toString()]).toEqual(
        ['1', amount, amount],
      );
    }

    // Blocked Employees get a result with the frozen basis, an exception, and no line.
    const exceptions = await exceptionsOf(job);
    expect(
      exceptions.map((exception) => [exception.employeeId, exception.exceptionType]).sort(),
    ).toEqual(
      [
        [casual, 'BASIC_SALARY_CASUAL_DAYS_UNSETTLED'],
        [stepped, 'BASIC_SALARY_RATE_CHANGE_IN_PERIOD'],
        [partial, 'BASIC_SALARY_PARTIAL_MONTH'],
        [noBasis, 'COMPENSATION_BASIS_INDETERMINATE'],
      ].sort(),
    );
    expect(exceptions.every((e) => e.severity === 'BLOCKING' && e.status === 'OPEN')).toBe(true);
    for (const employeeId of [casual, stepped, partial, noBasis]) {
      expect(results.get(employeeId)).toMatchObject({ status: 'EXCEPTION', lines: [] });
    }
    // The mid-period step increment is frozen as two stretches with their own rates.
    expect(results.get(stepped)?.compensationBasisSnapshot).toMatchObject({
      status: 'RESOLVED',
      stretches: [
        { from: '2881-03-01', to: '2881-03-09', salarySchedule: { monthlyRate: '31705' } },
        { from: '2881-03-10', to: '2881-03-31', salarySchedule: { monthlyRate: '32014' } },
      ],
    });
    expect(exceptions.find((e) => e.employeeId === partial)?.details).toMatchObject({
      unservedDates: [{ from: '2881-03-01', to: '2881-03-15' }],
    });

    // A finished version takes no more rows, and its lines never change.
    await expect(
      withDatabaseContext({ agencyId: job.agencyId }, (transaction) =>
        transaction.payrollException.create({
          data: {
            agencyId: job.agencyId,
            payrollPeriodId: job.payrollPeriodId,
            calculationVersion: 1,
            exceptionType: 'LATE',
            severity: 'WARNING',
            status: 'OPEN',
            details: {},
          },
        }),
      ),
    ).rejects.toThrow(/written only by the running calculation/);
    await expect(
      admin.payrollLine.updateMany({
        where: { payrollEmployeeId: results.get(full)!.id },
        data: { amount: '1' },
      }),
    ).rejects.toThrow(/immutable/);
  });

  it('reports a failure, then reproduces the hash and ends FOR_REVIEW once the source is fixed', async () => {
    const { tenant, unitId } = await tenantWithUnit('CALC-CLEAN');
    const full = await employeeWith(tenant, unitId, 'CLEAN-FULL', [['2880-06-01', null, 1]], {
      payBasis: 'MONTHLY_FULL_TIME',
      employmentFraction: null,
    });
    const late = await employeeWith(tenant, unitId, 'CLEAN-LATE', [['2880-06-01', null, 2]]);

    // Calculation starts only once the cutoff has passed.
    let period = await createPeriod(tenant, '2881-04', '2881-04-30T17:00:00+08:00');
    await expect(
      periods.startCalculation(preparer(tenant), period.id, { rowVersion: period.rowVersion }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'PAYROLL_PERIOD_CUTOFF_NOT_PASSED' });
    period = await periods.moveCutoff(preparer(tenant), period.id, {
      cutoffAt: '2026-01-01T00:00:00+08:00',
      reason: 'Test: the cutoff is past.',
      rowVersion: period.rowVersion,
    });
    const startNext = async () => {
      const row = await periodRow(period.id);
      return periods.startCalculation(preparer(tenant), period.id, { rowVersion: row.rowVersion });
    };

    // Version 1: a technical failure returns the period to DRAFT with the reason and writes nothing.
    const broken = new PayrollCalculationService(
      new CompensationBasisService(facts),
      {
        calculate: () => {
          throw new Error('calculator unavailable');
        },
      },
      new YearEndBonusCalculator(),
    );
    const first = jobOf(tenant, await startNext());
    expect(await broken.run(first)).toEqual({
      outcome: 'FAILED',
      reason: 'calculator unavailable',
    });
    expect((await periodRow(period.id)).status).toBe('DRAFT');
    expect(await resultsOf(first)).toEqual([]);
    expect(
      await admin.auditEvent.findFirst({
        where: { entityId: period.id, action: 'PAYROLL_PERIOD_CALCULATION_FAILED' },
      }),
    ).toMatchObject({ newStatus: 'DRAFT', reason: 'calculator unavailable' });

    // Version 2: an Employee with no recorded pay basis blocks.
    const second = jobOf(tenant, await startNext());
    expect(await calculation.run(second)).toMatchObject({ outcome: 'RETURNED' });

    // The source is fixed, and version 3 is clean.
    facts.bases.set(late, { payBasis: 'MONTHLY_FULL_TIME', employmentFraction: null });
    const third = jobOf(tenant, await startNext());
    expect(await calculation.run(third)).toEqual({ outcome: 'FOR_REVIEW', results: 2 });
    expect(await periodRow(period.id)).toMatchObject({
      status: 'FOR_REVIEW',
      calculationVersion: 3,
    });
    expect(await exceptionsOf(third)).toEqual([]);

    // The same snapshot and inputs reproduce the hash; a changed input changes it.
    const hashes = async (job: CalculationJob) =>
      new Map((await resultsOf(job)).map((result) => [result.employeeId, result.calculationHash]));
    const [before, after] = [await hashes(second), await hashes(third)];
    expect(after.get(full)).toBe(before.get(full));
    expect(after.get(late)).not.toBe(before.get(late));
    const lateResult = (await resultsOf(third)).find((result) => result.employeeId === late);
    expect(lateResult?.grossAmount.toString()).toBe('32014');
  });
});
