import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import type { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CompensationBasisService } from '../compensation-basis/compensation-basis.service';
import { BasicSalaryCalculator } from '../payroll-calculation/basic-salary.calculator';
import { PayrollCalculationService } from '../payroll-calculation/payroll-calculation.service';
import { payrollSourcesReader } from '../payroll-calculation/payroll-calculation.test-fixtures';
import type { PayrollCalculator } from '../payroll-calculation/payroll-calculator';
import { PayrollPeriodsService } from '../payroll-periods/payroll-periods.service';
import {
  cleanupPayrollTenants,
  createAdminClient,
  createPayrollTenant,
  FIXTURE_PREFIX,
  type PayrollTenant,
} from '../payroll-periods/payroll-periods.test-fixtures';
import { PersonnelSalaryFactsService } from '../personnel-salary-facts/personnel-salary-facts.service';
import { PayrollExceptionsService } from './payroll-exceptions.service';

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

type Fault = 'NEGATIVE' | 'MISSING' | 'DUPLICATE';

/**
 * Basic salary with a fault per Employee, standing in for the calculator
 * faults and deductions the checks exist to catch: a deduction above gross, no
 * line at all, or the same line twice.
 */
class FaultyCalculator implements PayrollCalculator {
  readonly faults = new Map<string, Fault>();
  private readonly basic = new BasicSalaryCalculator();

  calculate(...args: Parameters<BasicSalaryCalculator['calculate']>) {
    const outcome = this.basic.calculate(...args);
    const [line] = outcome.lines;
    switch (this.faults.get(args[0].employeeId)) {
      case 'NEGATIVE':
        return {
          ...outcome,
          lines: [
            ...outcome.lines,
            { ...line!, lineType: 'DEDUCTION' as const, amount: '40000.0000', source: {} },
          ],
        };
      case 'MISSING':
        return { lines: [], exceptions: [] };
      case 'DUPLICATE':
        return { ...outcome, lines: [line!, line!] };
      default:
        return outcome;
    }
  }
}

describe.skipIf(!enabled)('Payroll checks and exception commands in PostgreSQL', () => {
  // Test fixtures only: the rates are not from any issuance, and 2885 sits
  // clear of every other test's rule versions.
  const suffix = `${Date.now()}-checks`;
  const scheduleCode = `${FIXTURE_PREFIX}CHECK-SCHEDULE-${suffix}`;
  const periods = new PayrollPeriodsService();
  const exceptions = new PayrollExceptionsService();
  const basis = new CompensationBasisService(new MonthlyFullTime());
  // The checks judge basic salary alone, so the later calculators write nothing here.
  const nothing = { calculate: () => ({ lines: [], exceptions: [] }) };
  const calculationWith = (basicSalary: BasicSalaryCalculator) =>
    new PayrollCalculationService(
      basis,
      basicSalary,
      payrollSourcesReader(basis),
      nothing,
      nothing,
      nothing,
      nothing,
      nothing,
      nothing,
    );
  const calculation = calculationWith(new BasicSalaryCalculator());
  const faulty = new FaultyCalculator();
  const faultyCalculation = calculationWith(faulty);
  let admin: PrismaClient;
  let scheduleId: string;
  const tenants: PayrollTenant[] = [];

  const preparer = (tenant: PayrollTenant): RequestContext => ({
    ...tenant.persons[0]!.context,
    permissions: [
      { code: 'payroll.periods.create', scopePolicy: 'AGENCY' },
      { code: 'payroll.periods.calculate', scopePolicy: 'AGENCY' },
      { code: 'payroll.periods.read', scopePolicy: 'AGENCY' },
    ],
  });

  const reader = (tenant: PayrollTenant): RequestContext => ({
    ...tenant.persons[1]!.context,
    permissions: [{ code: 'payroll.periods.read', scopePolicy: 'AGENCY' }],
  });

  async function tenant(label: string) {
    const created = await createPayrollTenant(admin, suffix, label, 2);
    tenants.push(created);
    const unit = await admin.organizationUnit.create({
      data: {
        agencyId: created.agency.id,
        code: `UNIT-${label}-${suffix}`,
        unitType: 'DIVISION',
        status: 'ACTIVE',
      },
    });
    return { tenant: created, unitId: unit.id };
  }

  /** An SG-11 Employee with one Service Segment per `[from, to, step]`. */
  async function employeeWith(
    { tenant: { agency, persons }, unitId }: Awaited<ReturnType<typeof tenant>>,
    label: string,
    segments: [string, string | null, number][],
  ) {
    const membershipId = persons[0]!.membership.id;
    const employee = await admin.employee.create({
      data: {
        agencyId: agency.id,
        employeeNumber: `CHECK-${label}-${suffix}`,
        legalName: `Check ${label}`,
        birthDate: new Date('1990-01-01'),
        sex: 'FEMALE',
        civilStatus: 'SINGLE',
        contactEmail: `check-${label.toLowerCase()}-${suffix}@example.test`,
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
    return employee.id;
  }

  /** Create the month's regular period, start its calculation, and run it. */
  async function calculate(
    payrollTenant: PayrollTenant,
    month: string,
    service = calculation,
    existing?: string,
  ) {
    const context = preparer(payrollTenant);
    const id =
      existing ??
      (
        await periods.create(context, {
          code: `CHECK-${month}-${suffix}`,
          runType: 'REGULAR',
          periodFrom: `${month}-01`,
          periodTo: new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0))
            .toISOString()
            .slice(0, 10),
          cutoffAt: '2026-01-01T00:00:00+08:00',
          paymentDate: `${month}-15`,
        })
      ).id;
    const { rowVersion } = await admin.payrollPeriod.findUniqueOrThrow({ where: { id } });
    const started = await periods.startCalculation(context, id, { rowVersion });
    const outcome = await service.run({
      agencyId: payrollTenant.agency.id,
      payrollPeriodId: id,
      calculationVersion: started.calculationVersion,
    });
    return { id, version: started.calculationVersion, outcome };
  }

  /** Finalization is not built yet (#334); the fixture sets the status directly. */
  async function finalize(periodId: string) {
    await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await transaction.payrollPeriod.update({
        where: { id: periodId },
        data: { status: 'FINALIZED', finalizedAt: new Date() },
      });
    });
  }

  const exceptionsOf = (payrollPeriodId: string, calculationVersion: number) =>
    admin.payrollException.findMany({
      where: { payrollPeriodId, calculationVersion },
      orderBy: { exceptionType: 'asc' },
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
          effectiveFrom: new Date('2885-01-01'),
          effectiveTo: new Date('2885-12-31'),
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
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      const where = { agencyId: { in: tenants.map((each) => each.agency.id) } };
      await transaction.serviceSegment.deleteMany({ where });
      await transaction.employee.deleteMany({ where });
      await transaction.organizationUnit.deleteMany({ where });
      await transaction.$executeRaw`DELETE FROM salary_grade_rates WHERE rule_version_id = CAST(${scheduleId} AS uuid)`;
      await transaction.$executeRaw`DELETE FROM national_payroll_rule_versions WHERE code = ${scheduleCode}`;
    });
    await cleanupPayrollTenants(admin, tenants);
    await admin.$disconnect();
  });

  it('warns on variance without returning the period, and acknowledges a warning with a reason', async () => {
    const agency = await tenant('VARIANCE');
    const steady = await employeeWith(agency, 'STEADY', [['2884-06-01', null, 1]]);
    // A step increment on 1 February: a whole month at each rate.
    const raised = await employeeWith(agency, 'RAISED', [
      ['2884-06-01', '2885-01-31', 1],
      ['2885-02-01', null, 2],
    ]);
    const hired = await employeeWith(agency, 'HIRED', [['2885-02-01', null, 1]]);

    // With no finalized prior period there is nothing to compare.
    const january = await calculate(agency.tenant, '2885-01');
    expect(january.outcome).toEqual({ outcome: 'FOR_REVIEW', results: 2 });
    expect(await exceptionsOf(january.id, january.version)).toEqual([]);
    await finalize(january.id);

    // A warning alone leaves the period FOR_REVIEW. The new hire has no prior result.
    const february = await calculate(agency.tenant, '2885-02');
    expect(february.outcome).toEqual({ outcome: 'FOR_REVIEW', results: 3 });
    const [variance, ...others] = await exceptionsOf(february.id, february.version);
    expect(others).toEqual([]);
    expect(variance).toMatchObject({
      employeeId: raised,
      exceptionType: 'NET_PAY_VARIANCE',
      severity: 'WARNING',
      status: 'OPEN',
      details: {
        netAmount: '32014',
        priorNetAmount: '31705',
        difference: '309',
        priorPayrollPeriodId: january.id,
      },
    });
    expect([steady, hired]).not.toContain(variance!.employeeId);

    // Migration 0167 grants the read to the baseline roles that exist (controls §6.10).
    const grants = await admin.rolePermission.findMany({
      where: { permission: { code: 'payroll.periods.read' }, role: { agencyId: null } },
      select: { scopePolicy: true, role: { select: { code: true } } },
    });
    expect(grants.map((grant) => `${grant.role.code}:${grant.scopePolicy}`).sort()).toEqual([
      'budget_officer:AGENCY',
      'internal_auditor:AGENCY',
      'payroll_preparer:AGENCY',
    ]);

    // The read lists the current version, filtered by severity or status.
    expect(await exceptions.list(reader(agency.tenant), february.id, {})).toEqual({
      calculationVersion: 1,
      exceptions: [expect.objectContaining({ id: variance!.id })],
    });
    expect(
      (await exceptions.list(reader(agency.tenant), february.id, { severity: 'BLOCKING' }))
        .exceptions,
    ).toEqual([]);

    // A reader cannot decide; a resolution waits for DRAFT; a reason is required.
    await expect(
      exceptions.acknowledge(reader(agency.tenant), february.id, variance!.id, { reason: 'x' }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      exceptions.resolve(preparer(agency.tenant), february.id, variance!.id, { reason: 'x' }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'PAYROLL_PERIOD_NOT_DRAFT' });
    await expect(
      exceptions.acknowledge(preparer(agency.tenant), february.id, variance!.id, { reason: ' ' }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_INPUT' });

    const acknowledged = await exceptions.acknowledge(
      preparer(agency.tenant),
      february.id,
      variance!.id,
      { reason: 'Step increment effective 1 February.' },
    );
    expect(acknowledged).toMatchObject({
      status: 'ACKNOWLEDGED',
      reason: 'Step increment effective 1 February.',
      resolvedByMembershipId: agency.tenant.persons[0]!.membership.id,
    });
    expect(
      await admin.auditEvent.findFirst({
        where: { entityId: variance!.id, action: 'PAYROLL_EXCEPTION_ACKNOWLEDGED' },
      }),
    ).toMatchObject({
      actorMembershipId: agency.tenant.persons[0]!.membership.id,
      actorType: 'USER',
      entityType: 'PayrollException',
      previousStatus: 'OPEN',
      newStatus: 'ACKNOWLEDGED',
      reason: 'Step increment effective 1 February.',
    });
    await expect(
      exceptions.acknowledge(preparer(agency.tenant), february.id, variance!.id, { reason: 'x' }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'PAYROLL_EXCEPTION_DECIDED' });

    // Another Agency sees neither the period nor its exception, through the API or the table.
    const other = await tenant('VARIANCE-OTHER');
    await expect(exceptions.list(reader(other.tenant), february.id, {})).rejects.toMatchObject({
      statusCode: 404,
      code: 'PAYROLL_PERIOD_NOT_FOUND',
    });
    await expect(
      exceptions.acknowledge(preparer(other.tenant), february.id, variance!.id, { reason: 'x' }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'PAYROLL_PERIOD_NOT_FOUND' });
    const crossAgency = await withDatabaseContext(other.tenant.persons[0]!.scope, (transaction) =>
      transaction.payrollException.updateMany({
        where: { id: variance!.id },
        data: {
          status: 'RESOLVED',
          reason: 'x',
          resolvedByMembershipId: other.tenant.persons[0]!.membership.id,
        },
      }),
    );
    expect(crossAgency.count).toBe(0);
  });

  it('blocks negative net pay, a missing basic salary, and a duplicate line, and never waives one', async () => {
    const agency = await tenant('BLOCKING');
    const clean = await employeeWith(agency, 'CLEAN', [['2884-06-01', null, 1]]);
    const negative = await employeeWith(agency, 'NEGATIVE', [['2884-06-01', null, 1]]);
    const missing = await employeeWith(agency, 'MISSING', [['2884-06-01', null, 1]]);
    const duplicate = await employeeWith(agency, 'DUPLICATE', [['2884-06-01', null, 1]]);
    faulty.faults.set(negative, 'NEGATIVE');
    faulty.faults.set(missing, 'MISSING');
    faulty.faults.set(duplicate, 'DUPLICATE');

    const first = await calculate(agency.tenant, '2885-03', faultyCalculation);
    expect(first.outcome).toEqual({ outcome: 'RETURNED', results: 4, blockingExceptions: 3 });
    expect((await admin.payrollPeriod.findUniqueOrThrow({ where: { id: first.id } })).status).toBe(
      'DRAFT',
    );
    const found = await exceptionsOf(first.id, first.version);
    expect(found.map((e) => [e.exceptionType, e.employeeId, e.severity])).toEqual([
      ['BASIC_SALARY_MISSING', missing, 'BLOCKING'],
      ['NET_PAY_NEGATIVE', negative, 'BLOCKING'],
      ['PAYROLL_LINE_DUPLICATE', duplicate, 'BLOCKING'],
    ]);
    expect(found.map((e) => e.employeeId)).not.toContain(clean);
    const byType = new Map(found.map((exception) => [exception.exceptionType, exception]));
    expect(byType.get('NET_PAY_NEGATIVE')?.details).toMatchObject({
      grossAmount: '31705',
      totalDeductions: '40000',
      netAmount: '-8295',
    });
    expect(byType.get('PAYROLL_LINE_DUPLICATE')?.details).toMatchObject({
      componentCode: 'BASIC_SALARY',
      lineType: 'EARNING',
      payrollLineIds: [expect.any(String), expect.any(String)],
    });
    const audit = await admin.auditEvent.findFirst({
      where: { entityId: first.id, action: 'PAYROLL_PERIOD_CALCULATION_RETURNED' },
    });
    expect(audit?.reason).toContain('3 blocking exceptions');

    // A blocking exception is never acknowledged, through the service or the table.
    const negativeId = byType.get('NET_PAY_NEGATIVE')!.id;
    await expect(
      exceptions.acknowledge(preparer(agency.tenant), first.id, negativeId, { reason: 'Waive.' }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'PAYROLL_EXCEPTION_BLOCKING' });
    const scope = agency.tenant.persons[0]!.scope;
    await expect(
      withDatabaseContext(scope, (transaction) =>
        transaction.payrollException.update({
          where: { id: negativeId },
          data: {
            status: 'ACKNOWLEDGED',
            reason: 'Waive.',
            resolvedByMembershipId: scope.membershipId,
          },
        }),
      ),
    ).rejects.toThrow(/payroll_exceptions_acknowledged_check/);
    await expect(
      withDatabaseContext(scope, (transaction) =>
        transaction.payrollException.update({
          where: { id: negativeId },
          data: { status: 'RESOLVED', reason: null, resolvedByMembershipId: scope.membershipId },
        }),
      ),
    ).rejects.toThrow(/payroll_exceptions_decision_check/);

    // Resolving records the fix in DRAFT, names the actor, and is audited.
    const resolved = await exceptions.resolve(preparer(agency.tenant), first.id, negativeId, {
      reason: 'Deduction obligation corrected.',
    });
    expect(resolved).toMatchObject({
      status: 'RESOLVED',
      severity: 'BLOCKING',
      reason: 'Deduction obligation corrected.',
      resolvedByMembershipId: scope.membershipId,
    });
    expect(
      await admin.auditEvent.findFirst({
        where: { entityId: negativeId, action: 'PAYROLL_EXCEPTION_RESOLVED' },
      }),
    ).toMatchObject({
      actorMembershipId: scope.membershipId,
      reason: 'Deduction obligation corrected.',
    });

    // The list ranks blocking first, then open before decided.
    const listed = await exceptions.list(reader(agency.tenant), first.id, {});
    expect(listed.exceptions.map((e) => [e.exceptionType, e.status])).toEqual([
      ['BASIC_SALARY_MISSING', 'OPEN'],
      ['PAYROLL_LINE_DUPLICATE', 'OPEN'],
      ['NET_PAY_NEGATIVE', 'RESOLVED'],
    ]);

    // Resolution lifts nothing: the next calculation checks the cause again,
    // and the earlier version's exceptions are history.
    const second = await calculate(agency.tenant, '2885-03', faultyCalculation, first.id);
    expect(second).toMatchObject({
      version: 2,
      outcome: { outcome: 'RETURNED', blockingExceptions: 3 },
    });
    const missingId = byType.get('BASIC_SALARY_MISSING')!.id;
    await expect(
      exceptions.resolve(preparer(agency.tenant), first.id, missingId, { reason: 'Old.' }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'PAYROLL_EXCEPTION_SUPERSEDED' });
    await expect(
      withDatabaseContext(scope, (transaction) =>
        transaction.payrollException.update({
          where: { id: missingId },
          data: { status: 'RESOLVED', reason: 'Old.', resolvedByMembershipId: scope.membershipId },
        }),
      ),
    ).rejects.toThrow(/earlier calculation version is history/);
    expect(
      (
        await exceptions.list(reader(agency.tenant), first.id, {
          calculationVersion: '1',
          status: 'RESOLVED',
        })
      ).exceptions.map((e) => e.id),
    ).toEqual([negativeId]);

    // Only a decision changes, and an exception is never deleted.
    const [current] = await exceptionsOf(first.id, 2);
    await expect(
      admin.payrollException.update({
        where: { id: current!.id },
        data: { exceptionType: 'OTHER' },
      }),
    ).rejects.toThrow(/Only the status, reason, and actor/);
    await expect(admin.payrollException.delete({ where: { id: current!.id } })).rejects.toThrow(
      /retained/,
    );
  });
});
