import type { RequestContext } from '@lingkod-hr/auth';
import { prisma, setDatabaseContext, withDatabaseContext } from '@lingkod-hr/database';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CompensationBasisService } from '../compensation-basis/compensation-basis.service';
import { BasicSalaryCalculator } from '../payroll-calculation/basic-salary.calculator';
import { PayrollCalculationService } from '../payroll-calculation/payroll-calculation.service';
import {
  payrollSourcesReader,
  RecordedPayBases,
} from '../payroll-calculation/payroll-calculation.test-fixtures';
import { PayrollCertificationService } from '../payroll-periods/payroll-certification.service';
import { PayrollPeriodsService } from '../payroll-periods/payroll-periods.service';
import {
  cleanupPayrollTenants,
  createAdminClient,
  createPayrollTenant,
  FIXTURE_PREFIX,
  type PayrollTenant,
} from '../payroll-periods/payroll-periods.test-fixtures';
import { PAYROLL_INPUT_WITHDRAWN, PayrollInputsService } from './payroll-inputs.service';

const enabled = process.env.DATABASE_E2E === 'true';

describe.skipIf(!enabled)('Correcting a Payroll Input an open payroll uses (#649)', () => {
  // Test fixtures only: the rate is not from any issuance, and 2878 sits clear
  // of every other test's rule versions and periods.
  const suffix = `${Date.now()}-live-input`;
  const scheduleCode = `${FIXTURE_PREFIX}LIVE-INPUT-SCHEDULE-2878-${suffix}`;
  const inputs = new PayrollInputsService();
  const periods = new PayrollPeriodsService();
  const certification = new PayrollCertificationService();
  const payBases = new RecordedPayBases();
  const basis = new CompensationBasisService(payBases);
  // Basic salary is enough to calculate a version; the input's own line does not matter here.
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
    nothing,
  );
  let admin: PrismaClient;
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
      ]),
      accountingReviewer: as(2, ['payroll.periods.read', 'payroll.periods.return']),
    };
  }

  /** An Agency with one monthly full-time SG-11 step-1 Employee in service from 2878. */
  async function tenant(label: string) {
    const created = await createPayrollTenant(admin, suffix, `LIVE-${label}`, 3);
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
        employeeNumber: `LIVE-${label}-${suffix}`,
        legalName: `Live Input ${label}`,
        birthDate: new Date('1990-01-01'),
        sex: 'FEMALE',
        civilStatus: 'SINGLE',
        contactEmail: `live-input-${label.toLowerCase()}-${suffix}@example.test`,
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
            effectiveFrom: new Date('2878-01-01'),
            effectiveTo: null,
            status: 'ACTIVE',
            createdByMembershipId: membershipId,
          },
        }),
    );
    return { ...created, employee };
  }

  type Tenant = Awaited<ReturnType<typeof tenant>>;

  /** Leave's one day without pay in `month`, accepted PENDING. */
  async function accept(payrollTenant: Tenant, month: string, key: string) {
    const answer = await withDatabaseContext(payrollTenant.persons[0]!.scope, (transaction) =>
      inputs.acceptInTransaction(transaction, {
        agencyId: payrollTenant.agency.id,
        employeeId: payrollTenant.employee.id,
        sourceModule: 'LEAVE',
        inputKind: 'LEAVE_WITHOUT_PAY',
        sourceKey: `${suffix}-${key}`,
        sourceType: 'LeaveApprovalAllocationLine',
        sourceId: payrollTenant.employee.id,
        effectiveDate: `${month}-02`,
        quantity: '1',
        payload: { workDates: [{ date: `${month}-02`, days: '1' }] },
      }),
    );
    if (answer.outcome !== 'ACCEPTED') throw new Error(`not accepted: ${answer.outcome}`);
    return admin.payrollInput.findUniqueOrThrow({ where: { id: answer.payrollInputId } });
  }

  function withdraw(payrollTenant: Tenant, payrollInputId: string, key: string) {
    return withDatabaseContext(payrollTenant.persons[0]!.scope, (transaction) =>
      inputs.withdrawInTransaction(transaction, {
        agencyId: payrollTenant.agency.id,
        sourceModule: 'LEAVE',
        payrollInputId,
        correctionKey: `${suffix}-${key}`,
      }),
    );
  }

  /** The regular period of `month`, whose cutoff has just passed the inputs accepted so far. */
  async function createPeriod(payrollTenant: Tenant, month: string) {
    const [{ now }] = await admin.$queryRaw<[{ now: Date }]>`SELECT clock_timestamp() AS "now"`;
    const [year, number] = month.split('-');
    const last = new Date(Date.UTC(Number(year), Number(number), 0)).toISOString().slice(0, 10);
    const period = await periods.create(roles(payrollTenant).preparer, {
      code: `LIVE-${month}-${suffix}`,
      runType: 'REGULAR',
      periodFrom: `${month}-01`,
      periodTo: last,
      cutoffAt: now.toISOString(),
      paymentDate: `${month}-15`,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    return period;
  }

  async function start(payrollTenant: Tenant, periodId: string) {
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

  async function calculate(payrollTenant: Tenant, periodId: string) {
    return calculation.run(await start(payrollTenant, periodId));
  }

  async function certify(payrollTenant: Tenant, periodId: string) {
    const reviewed = await periods.read(roles(payrollTenant).certifier, periodId);
    return certification.certify(roles(payrollTenant).certifier, periodId, {
      calculationVersion: reviewed.calculationVersion,
      calculationHash: reviewed.calculationHash,
    });
  }

  /** Move the period's status as a later command would, under the Agency's context. */
  async function moveStatus(payrollTenant: Tenant, periodId: string, status: string) {
    const { rowVersion } = await admin.payrollPeriod.findUniqueOrThrow({ where: { id: periodId } });
    return withDatabaseContext({ agencyId: payrollTenant.agency.id }, (transaction) =>
      transaction.payrollPeriod.update({
        where: { id: periodId },
        data: { status, rowVersion: rowVersion + 1 },
      }),
    );
  }

  const blocksOf = (payrollPeriodId: string) =>
    admin.payrollException.findMany({
      where: { payrollPeriodId, exceptionType: PAYROLL_INPUT_WITHDRAWN },
      orderBy: { calculationVersion: 'asc' },
      select: {
        calculationVersion: true,
        employeeId: true,
        severity: true,
        status: true,
        details: true,
      },
    });

  const blockOf = (calculationVersion: number, employeeId: string, payrollInputId: string) => ({
    calculationVersion,
    employeeId,
    severity: 'BLOCKING',
    status: 'OPEN',
    details: expect.objectContaining({
      payrollInputId,
      sourceModule: 'LEAVE',
      inputKind: 'LEAVE_WITHOUT_PAY',
      message: expect.stringContaining('Return the period and calculate it again'),
    }),
  });

  /** The input as accepted, apart from the status and key a withdrawal sets. */
  const unchanged = (input: Awaited<ReturnType<typeof accept>>) => ({
    ...input,
    status: 'CANCELLED',
    sourceCorrectionKey: expect.any(String),
  });

  beforeAll(async () => {
    admin = await createAdminClient();
    await admin.nationalPayrollRuleVersion.create({
      data: {
        ruleKind: 'SALARY_SCHEDULE',
        code: scheduleCode,
        name: 'Test salary schedule',
        issuingAuthority: 'Test authority',
        issuanceReference: 'Test fixture, not an issuance',
        sourceUrl: 'https://example.test/salary-schedule',
        verifiedOn: new Date('2026-11-19'),
        verifiedBy: 'LingkodHR test fixture',
        effectiveFrom: new Date('2878-01-01'),
        effectiveTo: new Date('2878-12-31'),
        salaryGradeRates: { create: { salaryGrade: 11, salaryStep: 1, monthlyRate: '31705' } },
      },
    });
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      const where = { agencyId: { in: tenants.map((each) => each.agency.id) } };
      await transaction.payrollInput.deleteMany({ where });
      await transaction.serviceSegment.deleteMany({ where });
      await transaction.employee.deleteMany({ where });
      await transaction.organizationUnit.deleteMany({ where });
      await transaction.$executeRaw`DELETE FROM salary_grade_rates WHERE rule_version_id IN (SELECT id FROM national_payroll_rule_versions WHERE code = ${scheduleCode})`;
      await transaction.$executeRaw`DELETE FROM national_payroll_rule_versions WHERE code = ${scheduleCode}`;
    });
    await cleanupPayrollTenants(admin, tenants);
    await admin.$disconnect();
  });

  it('cancels an input a running calculation uses, and the period is blocked until it is calculated again', async () => {
    const payrollTenant = await tenant('RUNNING');
    const input = await accept(payrollTenant, '2878-01', 'running');
    const period = await createPeriod(payrollTenant, '2878-01');
    const job = await start(payrollTenant, period.id);

    // The withdrawal waits out the running calculation, then marks the
    // version it committed.
    let withdrawal: ReturnType<typeof withdraw> | undefined;
    const outcome = await prisma.$transaction(
      async (transaction) => {
        await setDatabaseContext(transaction, { agencyId: job.agencyId });
        const calculated = await calculation.calculateInTransaction(transaction, job);
        withdrawal = withdraw(payrollTenant, input.id, 'running');
        await expect.poll(() => periodRowLockWaits(admin), { timeout: 10_000 }).toBeGreaterThan(0);
        return calculated;
      },
      { timeout: 30_000 },
    );
    expect(outcome).toMatchObject({ outcome: 'FOR_REVIEW' });
    await expect(withdrawal!).resolves.toEqual({
      outcome: 'WITHDRAWN',
      payrollInputId: input.id,
    });
    await expect(
      admin.payrollInput.findUniqueOrThrow({ where: { id: input.id } }),
    ).resolves.toEqual(unchanged(input));
    await expect(blocksOf(period.id)).resolves.toEqual([
      blockOf(1, payrollTenant.employee.id, input.id),
    ]);

    // A retry answers the same and marks nothing more.
    await expect(withdraw(payrollTenant, input.id, 'running')).resolves.toMatchObject({
      outcome: 'ALREADY_WITHDRAWN',
    });
    await expect(blocksOf(period.id)).resolves.toHaveLength(1);

    // Certification is refused, by the command and by the database.
    await expect(certify(payrollTenant, period.id)).rejects.toMatchObject({
      code: 'PAYROLL_PERIOD_BLOCKING_EXCEPTION',
    });
    await expect(moveStatus(payrollTenant, period.id, 'CERTIFIED')).rejects.toThrow(
      /open blocking exception/,
    );

    // Returned and calculated again, the next version no longer reads the
    // cancelled input and is not blocked.
    const reviewed = await periods.read(roles(payrollTenant).certifier, period.id);
    await certification.returnForCorrection(roles(payrollTenant).accountingReviewer, period.id, {
      reason: 'Leave withdrew a day without pay.',
      rowVersion: reviewed.rowVersion,
    });
    await expect(calculate(payrollTenant, period.id)).resolves.toMatchObject({
      outcome: 'FOR_REVIEW',
    });
    await expect(blocksOf(period.id)).resolves.toHaveLength(1);
    await expect(certify(payrollTenant, period.id)).resolves.toMatchObject({
      status: 'CERTIFIED',
      calculationVersion: 2,
    });
  });

  it('cancels an input a queued calculation uses, and the calculation returns to DRAFT', async () => {
    const payrollTenant = await tenant('QUEUED');
    const input = await accept(payrollTenant, '2878-03', 'queued');
    const period = await createPeriod(payrollTenant, '2878-03');
    const job = await start(payrollTenant, period.id);

    await expect(withdraw(payrollTenant, input.id, 'queued')).resolves.toMatchObject({
      outcome: 'WITHDRAWN',
    });
    await expect(blocksOf(period.id)).resolves.toEqual([
      blockOf(1, payrollTenant.employee.id, input.id),
    ]);
    await expect(calculation.run(job)).resolves.toEqual({
      outcome: 'RETURNED',
      results: 1,
      blockingExceptions: 1,
    });
    await expect(periods.read(roles(payrollTenant).certifier, period.id)).resolves.toMatchObject({
      status: 'DRAFT',
      calculationVersion: 1,
    });
    await expect(calculate(payrollTenant, period.id)).resolves.toMatchObject({
      outcome: 'FOR_REVIEW',
    });
  });

  it('cancels an input a certified or approved payroll uses, and refuses approval and finalization until it is returned and recalculated', async () => {
    const payrollTenant = await tenant('CERTIFIED');
    const people = roles(payrollTenant);
    const first = await accept(payrollTenant, '2878-02', 'certified');
    const second = await accept(payrollTenant, '2878-02', 'approved');
    const period = await createPeriod(payrollTenant, '2878-02');
    await expect(calculate(payrollTenant, period.id)).resolves.toMatchObject({
      outcome: 'FOR_REVIEW',
    });
    const certified = await certify(payrollTenant, period.id);

    // CERTIFIED: the input is cancelled and the certification stands, but
    // approval is refused.
    await expect(withdraw(payrollTenant, first.id, 'certified')).resolves.toEqual({
      outcome: 'WITHDRAWN',
      payrollInputId: first.id,
    });
    await expect(
      admin.payrollInput.findUniqueOrThrow({ where: { id: first.id } }),
    ).resolves.toEqual(unchanged(first));
    await expect(blocksOf(period.id)).resolves.toEqual([
      blockOf(1, payrollTenant.employee.id, first.id),
    ]);
    await expect(periods.read(people.certifier, period.id)).resolves.toMatchObject({
      status: 'CERTIFIED',
      calculationVersion: 1,
      certification: { calculationVersion: 1 },
    });
    await expect(moveStatus(payrollTenant, period.id, 'APPROVED')).rejects.toThrow(
      /cannot become APPROVED while calculation version 1 has an open blocking exception/,
    );
    await expect(start(payrollTenant, period.id)).rejects.toMatchObject({
      code: 'PAYROLL_PERIOD_NOT_DRAFT',
    });

    // Revoked, returned, and recalculated, the new version is certified and approved.
    const revoked = await certification.revokeCertification(people.certifier, period.id, {
      reason: 'Leave withdrew a day without pay.',
      rowVersion: certified.rowVersion,
    });
    await certification.returnForCorrection(people.accountingReviewer, period.id, {
      reason: 'Leave withdrew a day without pay.',
      rowVersion: revoked.rowVersion,
    });
    await expect(calculate(payrollTenant, period.id)).resolves.toMatchObject({
      outcome: 'FOR_REVIEW',
    });
    await expect(certify(payrollTenant, period.id)).resolves.toMatchObject({
      status: 'CERTIFIED',
      calculationVersion: 2,
    });
    await expect(moveStatus(payrollTenant, period.id, 'APPROVED')).resolves.toMatchObject({
      status: 'APPROVED',
    });

    // APPROVED: a second withdrawal blocks version 2, and finalization is refused.
    await expect(withdraw(payrollTenant, second.id, 'approved')).resolves.toMatchObject({
      outcome: 'WITHDRAWN',
    });
    await expect(blocksOf(period.id)).resolves.toEqual([
      blockOf(1, payrollTenant.employee.id, first.id),
      blockOf(2, payrollTenant.employee.id, second.id),
    ]);
    await expect(moveStatus(payrollTenant, period.id, 'FINALIZED')).rejects.toThrow(
      /cannot become FINALIZED while calculation version 2 has an open blocking exception/,
    );

    // Only a withdrawal of a cancelled input writes the mark, on the current version.
    await expect(
      withDatabaseContext({ agencyId: payrollTenant.agency.id }, (transaction) =>
        transaction.payrollException.create({
          data: {
            agencyId: payrollTenant.agency.id,
            payrollPeriodId: period.id,
            calculationVersion: 1,
            employeeId: payrollTenant.employee.id,
            exceptionType: PAYROLL_INPUT_WITHDRAWN,
            severity: 'BLOCKING',
            status: 'OPEN',
            details: { payrollInputId: first.id },
          },
        }),
      ),
    ).rejects.toThrow(/blocks only the current version of a live period/);
  });
});

/** How many statements wait on a row lock while locking Payroll Periods. */
async function periodRowLockWaits(admin: PrismaClient): Promise<number> {
  const [row] = await admin.$queryRaw<{ waiting: bigint }[]>`
    SELECT count(*) AS "waiting"
    FROM pg_locks l
    JOIN pg_stat_activity a ON a.pid = l.pid
    WHERE NOT l.granted
      AND l.locktype IN ('transactionid', 'tuple')
      AND a.datname = current_database()
      AND a.query LIKE '%FOR SHARE OF p%'
  `;
  return Number(row?.waiting ?? 0);
}
