import type { RequestContext } from '@lingkod-hr/auth';
import { getConfig } from '@lingkod-hr/config';
import {
  createOperationalDatabaseClient,
  prisma,
  setDatabaseContext,
  withDatabaseContext,
} from '@lingkod-hr/database';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CompensationBasisService } from '../compensation-basis/compensation-basis.service';
import { BasicSalaryCalculator } from '../payroll-calculation/basic-salary.calculator';
import { PayrollCalculationService } from '../payroll-calculation/payroll-calculation.service';
import {
  payrollSourcesReader,
  RecordedPayBases,
} from '../payroll-calculation/payroll-calculation.test-fixtures';
import {
  loadNationalPayrollRuleVersion,
  type LoadedRuleVersion,
} from '../payroll-rule-versions/load-national-payroll-rule-version';
import { PayrollCertificationService } from './payroll-certification.service';
import { PayrollPeriodsService } from './payroll-periods.service';
import {
  cleanupPayrollTenants,
  createAdminClient,
  createPayrollTenant,
  FIXTURE_PREFIX,
  type PayrollTenant,
} from './payroll-periods.test-fixtures';
import { RULE_VERSION_LOADED_AFTER_SNAPSHOT } from './payroll-rule-snapshots';

const enabled = process.env.DATABASE_E2E === 'true';

describe.skipIf(!enabled)('Payroll recalculation in PostgreSQL', () => {
  // Test fixtures only: the rates are not from any issuance, and 2891 and 2892
  // sit clear of every other test's rule versions and periods.
  const suffix = `${Date.now()}-recalc`;
  const scheduleCode = (year: number) => `${FIXTURE_PREFIX}RECALC-SCHEDULE-${year}-${suffix}`;
  const raiseCode = (year: number) => `${FIXTURE_PREFIX}RECALC-RAISE-${year}-${suffix}`;
  const periods = new PayrollPeriodsService();
  const certification = new PayrollCertificationService();
  const payBases = new RecordedPayBases();
  const basis = new CompensationBasisService(payBases);
  // Basic salary is enough to show which rule version a version used.
  const nothing = { calculate: () => ({ lines: [], exceptions: [] }) };
  const calculation = new PayrollCalculationService(
    basis,
    new BasicSalaryCalculator(),
    payrollSourcesReader(basis),
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
  let operator: PrismaClient;
  const tenants: PayrollTenant[] = [];

  function roles(tenant: PayrollTenant) {
    const as = (index: number, codes: string[]): RequestContext => ({
      ...tenant.persons[index]!.context,
      permissions: codes.map((code) => ({ code, scopePolicy: 'AGENCY' as const })),
    });
    return {
      preparer: as(0, [
        'payroll.periods.create',
        'payroll.periods.calculate',
        'payroll.periods.read',
      ]),
      certifier: as(1, [
        'payroll.periods.read',
        'payroll.periods.certify',
        'payroll.periods.revoke_certification',
        'payroll.periods.return',
      ]),
      accountingReviewer: as(2, ['payroll.periods.read', 'payroll.periods.return']),
    };
  }

  /** An Agency with one monthly full-time SG-11 step-1 Employee in service from 2891. */
  async function tenant(label: string) {
    const created = await createPayrollTenant(admin, suffix, `RECALC-${label}`, 3);
    tenants.push(created);
    const { agency, persons } = created;
    const membershipId = persons[0]!.membership.id;
    const unit = await admin.organizationUnit.create({
      data: {
        agencyId: agency.id,
        code: `UNIT-${label}-${suffix}`,
        unitType: 'DIVISION',
        status: 'ACTIVE',
      },
    });
    const employee = await admin.employee.create({
      data: {
        agencyId: agency.id,
        employeeNumber: `RECALC-${label}-${suffix}`,
        legalName: `Recalculation ${label}`,
        birthDate: new Date('1990-01-01'),
        sex: 'FEMALE',
        civilStatus: 'SINGLE',
        contactEmail: `recalc-${label.toLowerCase()}-${suffix}@example.test`,
        serviceStatus: 'ACTIVE',
        createdByMembershipId: membershipId,
        updatedByMembershipId: membershipId,
      },
    });
    payBases.bases.set(employee.id, { payBasis: 'MONTHLY_FULL_TIME', employmentFraction: null });
    await withDatabaseContext(
      { ...persons[0]!.scope, capabilities: ['personnel-baseline-transition'] },
      (transaction) =>
        transaction.serviceSegment.create({
          data: {
            agencyId: agency.id,
            employeeId: employee.id,
            organizationUnitId: unit.id,
            appointmentStatus: 'PERMANENT',
            salaryGrade: 11,
            salaryStep: 1,
            effectiveFrom: new Date('2891-01-01'),
            effectiveTo: null,
            status: 'ACTIVE',
            createdByMembershipId: membershipId,
          },
        }),
    );
    return created;
  }

  /** The regular period of one month, its cutoff passed. */
  function createPeriod(payrollTenant: PayrollTenant, month: string) {
    const [year, number] = month.split('-');
    const last = new Date(Date.UTC(Number(year), Number(number), 0)).toISOString().slice(0, 10);
    return periods.create(roles(payrollTenant).preparer, {
      code: `RECALC-${month}-${suffix}`,
      runType: 'REGULAR',
      periodFrom: `${month}-01`,
      periodTo: last,
      cutoffAt: '2026-01-01T00:00:00+08:00',
      paymentDate: `${month}-15`,
    });
  }

  async function start(payrollTenant: PayrollTenant, periodId: string) {
    const { rowVersion } = await admin.payrollPeriod.findUniqueOrThrow({ where: { id: periodId } });
    const started = await periods.startCalculation(roles(payrollTenant).preparer, periodId, {
      rowVersion,
    });
    return {
      agencyId: payrollTenant.agency.id,
      payrollPeriodId: periodId,
      calculationVersion: started.calculationVersion,
    };
  }

  /** Start and run the next calculation of a DRAFT period. */
  async function calculate(payrollTenant: PayrollTenant, periodId: string) {
    return calculation.run(await start(payrollTenant, periodId));
  }

  /** A FOR_REVIEW period of `month`, calculated once. */
  async function reviewedPeriod(payrollTenant: PayrollTenant, month: string) {
    const period = await createPeriod(payrollTenant, month);
    await expect(calculate(payrollTenant, period.id)).resolves.toMatchObject({
      outcome: 'FOR_REVIEW',
    });
    return periods.read(roles(payrollTenant).certifier, period.id);
  }

  function returnForCorrection(payrollTenant: PayrollTenant, periodId: string, rowVersion: number) {
    return certification.returnForCorrection(roles(payrollTenant).accountingReviewer, periodId, {
      reason: 'Recalculate with the corrected source.',
      rowVersion,
    });
  }

  /** Everything one calculation version wrote, as stored. */
  async function versionRows(payrollPeriodId: string, calculationVersion: number) {
    const where = { payrollPeriodId, calculationVersion };
    return {
      results: await admin.payrollEmployee.findMany({
        where,
        orderBy: { employeeId: 'asc' },
        include: { lines: { orderBy: { id: 'asc' } } },
      }),
      exceptions: await admin.payrollException.findMany({ where, orderBy: { id: 'asc' } }),
      snapshot: await admin.payrollRuleSnapshot.findUnique({
        where: { payrollPeriodId_calculationVersion: where },
        include: { items: { orderBy: { id: 'asc' } } },
      }),
    };
  }

  /** The basic salary a version paid, and the rule version it was paid under. */
  async function basicSalaryOf(payrollPeriodId: string, calculationVersion: number) {
    const lines = await admin.payrollLine.findMany({
      where: { payrollEmployee: { payrollPeriodId, calculationVersion } },
      select: { amount: true, ruleVersionId: true },
    });
    return lines.map((line) => ({
      amount: line.amount.toFixed(4),
      ruleVersionId: line.ruleVersionId,
    }));
  }

  const marksOf = (payrollPeriodId: string) =>
    admin.payrollException.findMany({
      where: { payrollPeriodId, exceptionType: RULE_VERSION_LOADED_AFTER_SNAPSHOT },
      select: {
        calculationVersion: true,
        employeeId: true,
        severity: true,
        status: true,
        details: true,
      },
    });

  /** A reviewed file that raises SG-11 step 1 from March of `year`. */
  const loadRaise = (year: number) =>
    loadNationalPayrollRuleVersion(operator, {
      ruleKind: 'SALARY_SCHEDULE',
      code: raiseCode(year),
      name: 'Test salary schedule raise',
      issuingAuthority: 'Test authority',
      issuanceReference: 'Test fixture, not an issuance',
      sourceUrl: 'https://example.test/salary-schedule',
      researchRegister: 'docs/research/national-payroll-rule-versions-2027.md#S2',
      verifiedOn: '2026-11-15',
      verifiedBy: 'LingkodHR test fixture',
      effectiveFrom: `${year}-03-01`,
      effectiveTo: `${year}-12-31`,
      supersedesCode: scheduleCode(year),
      parameters: {},
      salaryGradeRates: [{ salaryGrade: 11, salaryStep: 1, monthlyRate: '33000.0000' }],
    });

  const scheduleIds = new Map<number, string>();

  beforeAll(async () => {
    admin = await createAdminClient();
    operator = createOperationalDatabaseClient(getConfig().DATABASE_OPERATIONAL_URL!);
    for (const year of [2891, 2892]) {
      const version = await admin.nationalPayrollRuleVersion.create({
        data: {
          ruleKind: 'SALARY_SCHEDULE',
          code: scheduleCode(year),
          name: 'Test salary schedule',
          issuingAuthority: 'Test authority',
          issuanceReference: 'Test fixture, not an issuance',
          sourceUrl: 'https://example.test/salary-schedule',
          verifiedOn: new Date('2026-11-15'),
          verifiedBy: 'LingkodHR test fixture',
          effectiveFrom: new Date(`${year}-01-01`),
          effectiveTo: new Date(`${year}-12-31`),
          salaryGradeRates: { create: { salaryGrade: 11, salaryStep: 1, monthlyRate: '31705' } },
        },
      });
      scheduleIds.set(year, version.id);
    }
  });

  afterAll(async () => {
    if (!admin) return;
    const codes = [2891, 2892].flatMap((year) => [scheduleCode(year), raiseCode(year)]);
    await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      const where = { agencyId: { in: tenants.map((each) => each.agency.id) } };
      await transaction.serviceSegment.deleteMany({ where });
      await transaction.employee.deleteMany({ where });
      await transaction.organizationUnit.deleteMany({ where });
      await transaction.$executeRaw`DELETE FROM salary_grade_rates WHERE rule_version_id IN (SELECT id FROM national_payroll_rule_versions WHERE code = ANY(${codes}))`;
      await transaction.$executeRaw`DELETE FROM national_payroll_rule_versions WHERE code = ANY(${codes})`;
    });
    await cleanupPayrollTenants(admin, tenants);
    await Promise.all([admin.$disconnect(), operator?.$disconnect()]);
  });

  it('recalculates a returned period into a new version, once when two start at once, and keeps the earlier version as it was', async () => {
    const payrollTenant = await tenant('TWICE');
    const people = roles(payrollTenant);
    const period = await reviewedPeriod(payrollTenant, '2891-01');
    const first = await versionRows(period.id, 1);
    expect(first.results).toHaveLength(1);
    expect(first.results[0]!.lines).toHaveLength(1);
    const returned = await returnForCorrection(payrollTenant, period.id, period.rowVersion);

    // Two recalculations at once: one starts version 2, the other is refused.
    const starts = await Promise.allSettled([
      periods.startCalculation(people.preparer, period.id, { rowVersion: returned.rowVersion }),
      periods.startCalculation(people.preparer, period.id, { rowVersion: returned.rowVersion }),
    ]);
    const started = starts.flatMap((each) => (each.status === 'fulfilled' ? [each.value] : []));
    expect(started).toEqual([
      expect.objectContaining({ status: 'CALCULATING', calculationVersion: 2 }),
    ]);
    const [refused] = starts.filter((each) => each.status === 'rejected');
    expect(refused).toMatchObject({ reason: { statusCode: 409 } });
    expect(['PAYROLL_PERIOD_STALE', 'PAYROLL_PERIOD_NOT_DRAFT']).toContain(
      (refused as PromiseRejectedResult).reason.code,
    );
    await expect(
      admin.payrollRuleSnapshot.count({ where: { payrollPeriodId: period.id } }),
    ).resolves.toBe(2);

    // Its job runs twice at once and calculates once.
    const job = {
      agencyId: payrollTenant.agency.id,
      payrollPeriodId: period.id,
      calculationVersion: 2,
    };
    const runs = await Promise.all([calculation.run(job), calculation.run(job)]);
    expect(runs.map((run) => run.outcome).sort()).toEqual(['FOR_REVIEW', 'SKIPPED']);

    // The new version has rows of its own; the same inputs reproduce the hash.
    const second = await versionRows(period.id, 2);
    expect(second.results).toHaveLength(1);
    expect(second.results[0]!.id).not.toBe(first.results[0]!.id);
    expect(second.results[0]!.calculationHash).toBe(first.results[0]!.calculationHash);
    expect(second.snapshot!.id).not.toBe(first.snapshot!.id);
    await expect(periods.read(people.certifier, period.id)).resolves.toMatchObject({
      status: 'FOR_REVIEW',
      calculationVersion: 2,
    });

    // Version 1 is exactly as it was, and neither the app nor the owner can change it.
    await expect(versionRows(period.id, 1)).resolves.toEqual(first);
    const earlier = first.results[0]!;
    await expect(
      withDatabaseContext({ agencyId: payrollTenant.agency.id }, (transaction) =>
        transaction.payrollEmployee.updateMany({
          where: { id: earlier.id },
          data: { status: 'REVIEWED' },
        }),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      admin.payrollEmployee.update({
        where: { id: earlier.id },
        data: { calculationHash: 'f'.repeat(64) },
      }),
    ).rejects.toThrow(/Only the status/);
    await expect(admin.payrollEmployee.delete({ where: { id: earlier.id } })).rejects.toThrow(
      /cannot be deleted/,
    );
    await expect(
      admin.payrollLine.deleteMany({ where: { payrollEmployeeId: earlier.id } }),
    ).rejects.toThrow(/immutable/);
  });

  it('marks the open payrolls a retroactive rule version affects, by status, and the next calculation uses it', async () => {
    const [draft, review, certified, queued, february] = await Promise.all(
      ['DRAFT', 'REVIEW', 'CERTIFIED', 'QUEUED', 'FEBRUARY'].map(tenant),
    );
    const baseline = scheduleIds.get(2891)!;

    // DRAFT: calculated once, then returned for correction.
    const draftPeriod = await reviewedPeriod(draft!, '2891-03');
    await returnForCorrection(draft!, draftPeriod.id, draftPeriod.rowVersion);
    const reviewPeriod = await reviewedPeriod(review!, '2891-03');
    const certifiedPeriod = await reviewedPeriod(certified!, '2891-03');
    await certification.certify(roles(certified!).certifier, certifiedPeriod.id, {
      calculationVersion: 1,
      calculationHash: certifiedPeriod.calculationHash,
    });
    const queuedPeriod = await createPeriod(queued!, '2891-03');
    const queuedJob = await start(queued!, queuedPeriod.id);
    // The raise starts in March, so February is not affected.
    const februaryPeriod = await reviewedPeriod(february!, '2891-02');

    const loaded = await loadRaise(2891);
    const mark = (severity: 'BLOCKING' | 'WARNING') => [
      {
        calculationVersion: 1,
        employeeId: null,
        severity,
        status: 'OPEN',
        details: expect.objectContaining({
          nationalPayrollRuleVersionId: loaded.id,
          ruleKind: 'SALARY_SCHEDULE',
          code: raiseCode(2891),
          effectiveFrom: '2891-03-01',
          message: expect.stringContaining(raiseCode(2891)),
        }),
      },
    ];
    await expect(marksOf(draftPeriod.id)).resolves.toEqual([]);
    await expect(marksOf(februaryPeriod.id)).resolves.toEqual([]);
    await expect(marksOf(reviewPeriod.id)).resolves.toEqual(mark('BLOCKING'));
    await expect(marksOf(queuedPeriod.id)).resolves.toEqual(mark('BLOCKING'));
    await expect(marksOf(certifiedPeriod.id)).resolves.toEqual(mark('WARNING'));

    // CERTIFIED: the snapshot stands, and recalculation is refused with the reason.
    await expect(
      periods.read(roles(certified!).certifier, certifiedPeriod.id),
    ).resolves.toMatchObject({
      status: 'CERTIFIED',
      calculationVersion: 1,
      certification: { calculationVersion: 1, calculationHash: certifiedPeriod.calculationHash },
    });
    await expect(start(certified!, certifiedPeriod.id)).rejects.toMatchObject({
      statusCode: 409,
      code: 'PAYROLL_PERIOD_NOT_DRAFT',
      message: expect.stringMatching(/CERTIFIED, and its certified calculation version stands/),
    });

    // FOR_REVIEW: certification is refused until the period is calculated again.
    await expect(
      certification.certify(roles(review!).certifier, reviewPeriod.id, {
        calculationVersion: 1,
        calculationHash: reviewPeriod.calculationHash,
      }),
    ).rejects.toMatchObject({ code: 'PAYROLL_PERIOD_BLOCKING_EXCEPTION' });
    await expect(start(review!, reviewPeriod.id)).rejects.toMatchObject({
      code: 'PAYROLL_PERIOD_NOT_DRAFT',
      message: expect.stringMatching(/returns it for correction/),
    });
    await returnForCorrection(review!, reviewPeriod.id, reviewPeriod.rowVersion);

    // CALCULATING: the queued calculation returns to DRAFT on the mark. Basic
    // salary also finds the raise outside the snapshot, for its one Employee.
    await expect(calculation.run(queuedJob)).resolves.toEqual({
      outcome: 'RETURNED',
      results: 1,
      blockingExceptions: 2,
    });
    await expect(
      admin.payrollException.findMany({
        where: { payrollPeriodId: queuedPeriod.id },
        select: { exceptionType: true },
        orderBy: { exceptionType: 'asc' },
      }),
    ).resolves.toEqual([
      { exceptionType: RULE_VERSION_LOADED_AFTER_SNAPSHOT },
      { exceptionType: 'SALARY_SCHEDULE_NOT_IN_SNAPSHOT' },
    ]);

    // Each recalculation's fresh snapshot uses the raise; version 1 keeps what
    // it paid: the old rate, or nothing for the blocked queued result.
    const oldRate = [{ amount: '31705.0000', ruleVersionId: baseline }];
    for (const [payrollTenant, periodId, firstPaid] of [
      [draft!, draftPeriod.id, oldRate],
      [review!, reviewPeriod.id, oldRate],
      [queued!, queuedPeriod.id, []],
    ] as const) {
      await expect(calculate(payrollTenant, periodId)).resolves.toMatchObject({
        outcome: 'FOR_REVIEW',
      });
      await expect(basicSalaryOf(periodId, 1)).resolves.toEqual(firstPaid);
      await expect(basicSalaryOf(periodId, 2)).resolves.toEqual([
        { amount: '33000.0000', ruleVersionId: loaded.id },
      ]);
      const { snapshot } = await versionRows(periodId, 2);
      expect(snapshot!.items.map((item) => item.nationalPayrollRuleVersionId)).toContain(loaded.id);
    }
    const recalculated = await periods.read(roles(review!).certifier, reviewPeriod.id);
    await expect(
      certification.certify(roles(review!).certifier, reviewPeriod.id, {
        calculationVersion: 2,
        calculationHash: recalculated.calculationHash,
      }),
    ).resolves.toMatchObject({ status: 'CERTIFIED', calculationVersion: 2 });
  });

  it('marks what a running calculation commits when the rule version loads during it', async () => {
    const payrollTenant = await tenant('RUNNING');
    const period = await createPeriod(payrollTenant, '2892-03');
    const job = await start(payrollTenant, period.id);

    let load: Promise<LoadedRuleVersion> | undefined;
    const outcome = await prisma.$transaction(
      async (transaction) => {
        await setDatabaseContext(transaction, { agencyId: job.agencyId });
        const calculated = await calculation.calculateInTransaction(transaction, job);
        load = loadRaise(2892);
        // The load waits on this period's row until the calculation commits.
        await expect
          .poll(() => operatorRowLockWaits(admin), { timeout: 10_000 })
          .toBeGreaterThan(0);
        return calculated;
      },
      { timeout: 30_000 },
    );
    expect(outcome).toMatchObject({ outcome: 'FOR_REVIEW' });
    const loaded = await load!;
    await expect(marksOf(period.id)).resolves.toEqual([
      expect.objectContaining({
        calculationVersion: 1,
        severity: 'BLOCKING',
        details: expect.objectContaining({ nationalPayrollRuleVersionId: loaded.id }),
      }),
    ]);
    const reviewed = await periods.read(roles(payrollTenant).certifier, period.id);
    await expect(
      certification.certify(roles(payrollTenant).certifier, period.id, {
        calculationVersion: 1,
        calculationHash: reviewed.calculationHash,
      }),
    ).rejects.toMatchObject({ code: 'PAYROLL_PERIOD_BLOCKING_EXCEPTION' });

    // Only a load writes the mark; the app cannot.
    await expect(
      withDatabaseContext({ agencyId: job.agencyId }, (transaction) =>
        transaction.payrollException.create({
          data: {
            ...job,
            exceptionType: RULE_VERSION_LOADED_AFTER_SNAPSHOT,
            severity: 'BLOCKING',
            status: 'OPEN',
            details: {},
          },
        }),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

/** How many `hris_operator` statements wait on a row lock. */
async function operatorRowLockWaits(admin: PrismaClient): Promise<number> {
  const [row] = await admin.$queryRaw<{ waiting: bigint }[]>`
    SELECT count(*) AS "waiting"
    FROM pg_locks l
    JOIN pg_stat_activity a ON a.pid = l.pid
    WHERE NOT l.granted
      AND l.locktype IN ('transactionid', 'tuple')
      AND a.usename = 'hris_operator'
  `;
  return Number(row?.waiting ?? 0);
}
