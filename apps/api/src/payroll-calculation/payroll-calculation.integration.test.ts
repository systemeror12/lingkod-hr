import type { RequestContext } from '@lingkod-hr/auth';
import { prisma, setDatabaseContext, withDatabaseContext } from '@lingkod-hr/database';
import { Prisma, type PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CompensationBasisService } from '../compensation-basis/compensation-basis.service';
import { DaysWithoutPayCalculator } from './days-without-pay.calculator';
import { payrollSourcesReader } from './payroll-calculation.test-fixtures';
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
import {
  EmployeesCompensationCalculator,
  GsisContributionCalculator,
} from './contribution.calculators';
import { OvertimePayCalculator } from './overtime-pay.calculator';
import { PeraCalculator } from './pera.calculator';
import { ClothingAllowanceCalculator } from './clothing-allowance.calculator';
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

describe.skipIf(!enabled)('Basic salary and contribution calculation in PostgreSQL', () => {
  // Test fixtures only: the rates, limit, and ceiling are not from any
  // issuance, and 2881 sits clear of every other test's rule versions.
  const suffix = `${Date.now()}-calc`;
  const scheduleCode = `${FIXTURE_PREFIX}CALC-SCHEDULE-${suffix}`;
  const gsisCode = `${FIXTURE_PREFIX}CALC-GSIS-${suffix}`;
  const ecCode = `${FIXTURE_PREFIX}CALC-EC-${suffix}`;
  const peraCode = `${FIXTURE_PREFIX}CALC-PERA-${suffix}`;
  const periods = new PayrollPeriodsService();
  const facts = new RecordedPayBases();
  const basis = new CompensationBasisService(facts);
  const contributions = [
    new GsisContributionCalculator(),
    new EmployeesCompensationCalculator(),
  ] as const;
  // RATA has its own test; here no RATA rule is loaded, so it would block everyone.
  const noRata = { calculate: () => ({ lines: [], exceptions: [] }) };
  // PhilHealth and Pag-IBIG have their own test; no version of either is loaded here.
  const noPhilHealthOrPagIbig = [noRata, noRata] as const;
  const calculation = new PayrollCalculationService(
    basis,
    new BasicSalaryCalculator(),
    payrollSourcesReader(basis),
    new DaysWithoutPayCalculator(),
    ...contributions,
    new YearEndBonusCalculator(),
    new PeraCalculator(),
    noRata,
    new OvertimePayCalculator(),
    new ClothingAllowanceCalculator(),
    ...noPhilHealthOrPagIbig,
  );
  let admin: PrismaClient;
  let scheduleId: string;
  let gsisId: string;
  let ecId: string;
  let peraId: string;
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
      include: { lines: true, contributions: true },
    });

  const ruleVersion = (ruleKind: string, code: string, effectiveTo: string, parameters: object) =>
    admin.nationalPayrollRuleVersion.create({
      data: {
        ruleKind,
        code,
        name: `Test ${ruleKind}`,
        issuingAuthority: 'Test authority',
        issuanceReference: 'Test fixture, not an issuance',
        sourceUrl: 'https://example.test/contribution',
        verifiedOn: new Date('2026-11-15'),
        verifiedBy: 'LingkodHR test fixture',
        effectiveFrom: new Date('2881-01-01'),
        effectiveTo: new Date(effectiveTo),
        parameters,
      },
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
    // GSIS ends with October, so November has no GSIS version in effect.
    gsisId = (
      await ruleVersion('GSIS_CONTRIBUTION', gsisCode, '2881-10-31', {
        employeeRate: '0.09',
        employerRate: '0.12',
        monthlyCompensationLimit: '100000',
      })
    ).id;
    ecId = (
      await ruleVersion('EMPLOYEES_COMPENSATION', ecCode, '2881-12-31', {
        employerRate: '0.01',
        monthlySalaryCreditCeiling: '20000',
      })
    ).id;
    peraId = (
      await ruleVersion('PERA', peraCode, '2881-12-31', {
        monthlyAmount: '2000.00',
        dailyAmount: '90.91',
      })
    ).id;
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
      await transaction.$executeRaw`DELETE FROM national_payroll_rule_versions WHERE code IN (${scheduleCode}, ${gsisCode}, ${ecCode}, ${peraCode})`;
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
    // Step 2, so half its rate is whole pesos and every share whole centavos.
    const part = await employeeWith(tenant, unitId, 'PART', [['2880-06-01', null, 2]], {
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
    expect(runs).toContainEqual({ outcome: 'RETURNED', results: 6, blockingExceptions: 7 });
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
    expect(audit[1]?.reason).toContain('7 blocking exceptions in calculation version 1');

    const results = new Map((await resultsOf(job)).map((result) => [result.employeeId, result]));
    expect(results.has(separated)).toBe(false);
    expect([...results.keys()].sort()).toEqual(
      [full, part, casual, stepped, partial, noBasis].sort(),
    );

    // Each line stores its source record, quantity, rate, amount, and rule version (PAY-007).
    const basicSalary = await admin.payComponent.findUniqueOrThrow({
      where: { code: 'BASIC_SALARY' },
    });
    for (const [employeeId, amount, gross] of [
      [full, '31705', '33705'],
      [part, '16007', '17007'],
    ] as const) {
      const result = results.get(employeeId)!;
      expect(result).toMatchObject({ status: 'CALCULATED', calculationHash: /^[0-9a-f]{64}$/ });
      // Gross is basic salary and PERA.
      expect(result.grossAmount.toString()).toBe(gross);
      const line = result.lines.find((candidate) => candidate.payComponentId === basicSalary.id);
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

    // GSIS takes 9% and 12% of the basic salary; Employees' Compensation 1% of
    // it up to the 20,000 ceiling, from the employer only.
    const components = new Map(
      (await admin.payComponent.findMany()).map((component) => [component.id, component.code]),
    );
    const linesOf = (employeeId: string) =>
      results
        .get(employeeId)!
        .lines.map((line) => [
          components.get(line.payComponentId),
          line.lineType,
          line.amount.toString(),
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
    expect(linesOf(full)).toEqual(
      [
        ['BASIC_SALARY', 'EARNING', '31705'],
        ['EMPLOYEES_COMPENSATION', 'EMPLOYER_SHARE', '200'],
        ['GSIS_GOVERNMENT_SHARE', 'EMPLOYER_SHARE', '3804.6'],
        ['GSIS_PERSONAL_SHARE', 'DEDUCTION', '2853.45'],
        ['PERA', 'EARNING', '2000'],
      ].sort(),
    );
    // PERA is the version's monthly amount, or its share for part-time
    // service, and is not subject to income tax.
    const pera = await admin.payComponent.findUniqueOrThrow({ where: { code: 'PERA' } });
    for (const [employeeId, quantity, amount] of [
      [full, '1', '2000'],
      [part, '0.5', '1000'],
    ] as const) {
      const line = results
        .get(employeeId)!
        .lines.find((candidate) => candidate.payComponentId === pera.id);
      expect(line).toMatchObject({
        ruleVersionId: peraId,
        lineType: 'EARNING',
        sourceSnapshot: expect.objectContaining({ taxTreatment: 'NON_TAXABLE' }),
      });
      expect([line?.quantity?.toString(), line?.rate?.toString(), line?.amount.toString()]).toEqual(
        [quantity, '2000', amount],
      );
    }
    expect(contributionsOf(full)).toEqual([
      ['EMPLOYEES_COMPENSATION', '0', '200', '20000', ecId],
      ['GSIS', '2853.45', '3804.6', '31705', gsisId],
    ]);
    expect(contributionsOf(part)).toEqual([
      ['EMPLOYEES_COMPENSATION', '0', '160.07', '16007', ecId],
      ['GSIS', '1440.63', '1920.84', '16007', gsisId],
    ]);
    // Contribution lines are isolated by Agency.
    const other = await tenantWithUnit('CALC-MAIN-OTHER');
    await expect(
      withDatabaseContext({ agencyId: other.tenant.agency.id }, (transaction) =>
        transaction.contributionLine.count({ where: { agencyId: tenant.agency.id } }),
      ),
    ).resolves.toBe(0);
    // Only the GSIS personal share reduces pay; employer shares never do.
    for (const [employeeId, deductions, net] of [
      [full, '2853.45', '30851.55'],
      [part, '1440.63', '15566.37'],
    ] as const) {
      const result = results.get(employeeId)!;
      expect([result.totalDeductions.toString(), result.netAmount.toString()]).toEqual([
        deductions,
        net,
      ]);
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
        [partial, 'EMPLOYEES_COMPENSATION_PARTIAL_MONTH'],
        [partial, 'GSIS_PARTIAL_MONTH'],
        [partial, 'PERA_PARTIAL_MONTH'],
        [noBasis, 'COMPENSATION_BASIS_INDETERMINATE'],
      ].sort(),
    );
    expect(exceptions.every((e) => e.severity === 'BLOCKING' && e.status === 'OPEN')).toBe(true);
    for (const employeeId of [casual, stepped, partial, noBasis]) {
      expect(results.get(employeeId)).toMatchObject({
        status: 'EXCEPTION',
        lines: [],
        contributions: [],
      });
    }
    // The mid-period step increment is frozen as two stretches with their own rates.
    expect(results.get(stepped)?.compensationBasisSnapshot).toMatchObject({
      status: 'RESOLVED',
      stretches: [
        { from: '2881-03-01', to: '2881-03-09', salarySchedule: { monthlyRate: '31705' } },
        { from: '2881-03-10', to: '2881-03-31', salarySchedule: { monthlyRate: '32014' } },
      ],
    });
    expect(
      exceptions.find((e) => e.exceptionType === 'BASIC_SALARY_PARTIAL_MONTH')?.details,
    ).toMatchObject({
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
    await expect(
      admin.contributionLine.updateMany({
        where: { payrollEmployeeId: results.get(full)!.id },
        data: { employeeShare: '1' },
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
      basis,
      {
        calculate: () => {
          throw new Error('calculator unavailable');
        },
      },
      payrollSourcesReader(basis),
      new DaysWithoutPayCalculator(),
      ...contributions,
      new YearEndBonusCalculator(),
      new PeraCalculator(),
      noRata,
      new OvertimePayCalculator(),
      new ClothingAllowanceCalculator(),
      ...noPhilHealthOrPagIbig,
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
    expect(lateResult?.grossAmount.toString()).toBe('34014');
  });

  it('blocks GSIS once its version expired, keeps no contribution line, and leaves an excluded Employee out', async () => {
    const { tenant, unitId } = await tenantWithUnit('CALC-CONTRIB');
    const covered = await employeeWith(tenant, unitId, 'CONTRIB-FULL', [['2880-06-01', null, 1]], {
      payBasis: 'MONTHLY_FULL_TIME',
      employmentFraction: null,
    });
    // Separated before November: no Service Segment covers the month.
    const excluded = await employeeWith(
      tenant,
      unitId,
      'CONTRIB-GONE',
      [['2880-06-01', '2881-10-31', 1]],
      { payBasis: 'MONTHLY_FULL_TIME', employmentFraction: null },
    );

    const draft = await createPeriod(tenant, '2881-11', '2026-01-01T00:00:00+08:00');
    // Neither contribution kind is required to freeze the snapshot.
    const job = jobOf(
      tenant,
      await periods.startCalculation(preparer(tenant), draft.id, { rowVersion: draft.rowVersion }),
    );
    expect(await calculation.run(job)).toEqual({
      outcome: 'RETURNED',
      results: 1,
      blockingExceptions: 1,
    });

    const results = await resultsOf(job);
    expect(results.map((result) => result.employeeId)).toEqual([covered]);
    expect(results.some((result) => result.employeeId === excluded)).toBe(false);
    expect(
      await admin.contributionLine.count({
        where: { payrollEmployee: { employeeId: excluded } },
      }),
    ).toBe(0);

    // Employees' Compensation still calculates, but a blocked result keeps no line (§7).
    const [result] = results;
    expect(result).toMatchObject({ status: 'EXCEPTION', lines: [], contributions: [] });
    const [exception] = await exceptionsOf(job);
    expect(exception).toMatchObject({
      employeeId: covered,
      exceptionType: 'GSIS_RULE_NOT_IN_EFFECT',
      severity: 'BLOCKING',
    });
    // The snapshot froze no GSIS version: the one that ended in October is not in it.
    expect((exception?.details as { message: string }).message).toBe(
      'No GSIS_CONTRIBUTION version is in effect on 2881-11-01. GSIS is not calculated without it.',
    );

    // Contribution lines are written only with their result.
    const agencyId = tenant.agency.id;
    await expect(
      withDatabaseContext({ agencyId }, (transaction) =>
        transaction.contributionLine.create({
          data: {
            agencyId,
            payrollEmployeeId: result!.id,
            contributionType: 'GSIS',
            employeeShare: '1',
            employerShare: '1',
            compensationBase: '1',
            ruleVersionId: gsisId,
          },
        }),
      ),
    ).rejects.toThrow(/joins its result only in the transaction/);
    // Employees' Compensation never takes an employee share, however it is written.
    await expect(
      admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.contributionLine.create({
          data: {
            agencyId,
            payrollEmployeeId: result!.id,
            contributionType: 'EMPLOYEES_COMPENSATION',
            employeeShare: '1',
            employerShare: '1',
            compensationBase: '1',
            ruleVersionId: ecId,
          },
        });
      }),
    ).rejects.toThrow(/contribution_lines_employer_only_check/);
  });
});
