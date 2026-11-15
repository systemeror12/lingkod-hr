import { randomUUID } from 'node:crypto';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { Prisma, type PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CompensationBasisService } from '../compensation-basis/compensation-basis.service';
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
import { type CalculationJob, PayrollCalculationService } from './payroll-calculation.service';
import { attendanceAndLeave, RecordedPayBases } from './payroll-calculation.test-fixtures';
import { PayrollSourcesReader } from './payroll-sources.reader';
import { YearEndBonusCalculator } from './year-end-bonus.calculator';

const enabled = process.env.DATABASE_E2E === 'true';
const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

interface FactSeed {
  employeeId: string;
  workDate: string;
  factType: 'TARDINESS' | 'ABSENCE';
  minutes: number;
  prior?: number;
  expectedMinutes?: number;
  scheduleType?: 'COMPRESSED';
}

describe.skipIf(!enabled)('Salary for days without pay in PostgreSQL', () => {
  // Test fixtures only: the rates are not from any issuance. 44,000 and 46,200
  // divide by 22 into whole pesos, and 2884 sits clear of every other test's
  // rule versions.
  const suffix = `${Date.now()}-dwp`;
  const scheduleCode = `${FIXTURE_PREFIX}DWP-SCHEDULE-${suffix}`;
  const periods = new PayrollPeriodsService();
  const inputs = new PayrollInputsService();
  const facts = new RecordedPayBases();
  const basis = new CompensationBasisService(facts);
  const { attendance, deficitCharges } = attendanceAndLeave();
  // Contributions, PERA, and RATA have their own tests; these fixtures freeze
  // no GSIS, EC, PERA, or RATA version.
  const noContribution = { calculate: () => ({ lines: [], exceptions: [] }) };
  const calculation = new PayrollCalculationService(
    basis,
    new BasicSalaryCalculator(),
    new PayrollSourcesReader(attendance, deficitCharges, basis),
    new DaysWithoutPayCalculator(),
    noContribution,
    noContribution,
    new YearEndBonusCalculator(),
    noContribution,
    noContribution,
  );
  let admin: PrismaClient;
  let scheduleId: string;
  const tenants: PayrollTenant[] = [];

  const preparer = (tenant: PayrollTenant): RequestContext => ({
    ...tenant.persons[0]!.context,
    permissions: [
      { code: 'payroll.periods.create', scopePolicy: 'AGENCY' },
      { code: 'payroll.periods.calculate', scopePolicy: 'AGENCY' },
      { code: 'leave.deficit_charges.run', scopePolicy: 'AGENCY' },
    ],
  });

  /** Fixture rows written with triggers off, as the deficit charge test writes them. */
  const seed = <T>(run: (transaction: Prisma.TransactionClient) => Promise<T>) =>
    admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      return run(transaction);
    });

  async function setUp() {
    const tenant = await createPayrollTenant(admin, suffix, 'DWP');
    tenants.push(tenant);
    const agencyId = tenant.agency.id;
    const membershipId = tenant.persons[0]!.membership.id;
    const unit = await admin.organizationUnit.create({
      data: { agencyId, code: `UNIT-DWP-${suffix}`, unitType: 'DIVISION', status: 'ACTIVE' },
    });
    const leave = await seed(async (transaction) => {
      const leaveType = await transaction.leaveType.create({
        data: {
          agencyId,
          code: 'VACATION_LEAVE',
          name: 'Vacation Leave',
          status: 'ACTIVE',
          createdByMembershipId: membershipId,
          updatedByMembershipId: membershipId,
        },
      });
      const policy = await transaction.leavePolicyVersion.create({
        data: {
          agencyId,
          leaveTypeId: leaveType.id,
          versionNo: 1,
          entitlementBasis: 'ACCRUED_ACCOUNT',
          calendarBasis: 'WORKING_DAY',
          evaluatorKind: 'SERVICE_ACCRUAL',
          approvalRouteCode: 'LEAVE',
          effectiveFrom: date('2884-01-01'),
          status: 'ACTIVE',
          createdByMembershipId: membershipId,
          updatedByMembershipId: membershipId,
        },
      });
      const period = await transaction.attendancePeriod.create({
        data: {
          agencyId,
          code: `P-DWP-${suffix}`,
          dateFrom: date('2884-03-01'),
          dateTo: date('2884-03-15'),
          status: 'FINALIZED',
        },
      });
      return { leaveTypeId: leaveType.id, policyVersionId: policy.id, periodId: period.id };
    });
    return { tenant, unitId: unit.id, membershipId, ...leave, publications: 0 };
  }
  type Setup = Awaited<ReturnType<typeof setUp>>;

  /** An SG-11 Employee on the monthly full-time basis, one Service Segment per `[from, to, step]`. */
  async function employeeWith(
    setup: Setup,
    label: string,
    segments: [string, string | null, number][],
  ) {
    const agencyId = setup.tenant.agency.id;
    const employee = await admin.employee.create({
      data: {
        agencyId,
        employeeNumber: `DWP-${label}-${suffix}`,
        legalName: `Days Without Pay ${label}`,
        birthDate: new Date('1990-01-01'),
        sex: 'FEMALE',
        civilStatus: 'SINGLE',
        contactEmail: `dwp-${label.toLowerCase()}-${suffix}@example.test`,
        serviceStatus: 'ACTIVE',
        createdByMembershipId: setup.membershipId,
        updatedByMembershipId: setup.membershipId,
      },
    });
    await withDatabaseContext(
      { ...setup.tenant.persons[0]!.scope, capabilities: ['personnel-baseline-transition'] },
      async (transaction) => {
        for (const [from, to, salaryStep] of segments) {
          await transaction.serviceSegment.create({
            data: {
              agencyId,
              employeeId: employee.id,
              organizationUnitId: setup.unitId,
              appointmentStatus: 'PERMANENT',
              salaryGrade: 11,
              salaryStep,
              effectiveFrom: new Date(from),
              effectiveTo: to ? new Date(to) : null,
              status: to ? 'CLOSED' : 'ACTIVE',
              createdByMembershipId: setup.membershipId,
            },
          });
        }
      },
    );
    facts.bases.set(employee.id, { payBasis: 'MONTHLY_FULL_TIME', employmentFraction: null });
    return employee.id;
  }

  /** A vacation Leave Account with a posted opening balance. */
  const openVacation = (setup: Setup, employeeId: string, balance: string) =>
    seed(async (transaction) => {
      const account = await transaction.leaveAccount.create({
        data: {
          agencyId: setup.tenant.agency.id,
          employeeId,
          leaveTypeId: setup.leaveTypeId,
          unitCode: 'CREDIT_DAY',
          status: 'ACTIVE',
          // Leave charges the lower of the balance on the Work Date and today's.
          openedAt: date('2026-01-01'),
        },
      });
      // A ledger entry is never zero: an empty account has none.
      if (new Prisma.Decimal(balance).isZero()) return;
      await transaction.leaveLedgerEntry.create({
        data: {
          agencyId: setup.tenant.agency.id,
          leaveAccountId: account.id,
          quantity: new Prisma.Decimal(balance),
          effectiveDate: date('2026-01-01'),
          sourceType: 'TEST_OPENING',
          sourceId: randomUUID(),
          sourcePostingKey: 'OPENING',
          policyVersionId: setup.policyVersionId,
        },
      });
    });

  /** A locked Attendance Period Version and its publication, as lock or adjustment writes them. */
  async function publish(
    setup: Setup,
    seeds: FactSeed[],
    publishedAt: Date,
    predecessorPublicationId: string | null = null,
  ) {
    setup.publications += 1;
    const versionNo = setup.publications;
    const agencyId = setup.tenant.agency.id;
    return seed(async (transaction) => {
      const version = await transaction.attendancePeriodVersion.create({
        data: {
          agencyId,
          attendancePeriodId: setup.periodId,
          versionNo,
          status: 'LOCKED',
          approvalRouteVersionId: randomUUID(),
          submittedByMembershipId: setup.membershipId,
          submittedAt: publishedAt,
          reviewedByMembershipId: randomUUID(),
          reviewedAt: publishedAt,
          lockedByMembershipId: setup.membershipId,
          lockedAt: publishedAt,
          reconciliation: {},
        },
      });
      const publication = await transaction.attendancePayrollPublication.create({
        data: {
          agencyId,
          attendancePeriodVersionId: version.id,
          predecessorPublicationId,
          publicationType: predecessorPublicationId ? 'ADJUSTMENT' : 'ORIGINAL',
          idempotencyKey: `publication:${version.id}`,
          publishedAt,
        },
      });
      const ids: string[] = [];
      for (const fact of seeds) {
        let workScheduleVersionId: string | null = null;
        if (fact.scheduleType) {
          const schedule = await transaction.workSchedule.create({
            data: { agencyId, code: `WS-${randomUUID()}`, name: 'Schedule' },
          });
          workScheduleVersionId = (
            await transaction.workScheduleVersion.create({
              data: {
                agencyId,
                workScheduleId: schedule.id,
                versionNo: 1,
                scheduleType: fact.scheduleType,
                status: 'DRAFT',
                effectiveFrom: date('2884-01-01'),
              },
            })
          ).id;
        }
        await transaction.attendanceDay.updateMany({
          where: { agencyId, employeeId: fact.employeeId, workDate: date(fact.workDate) },
          data: { isCurrent: false },
        });
        const day = await transaction.attendanceDay.create({
          data: {
            agencyId,
            attendancePeriodId: setup.periodId,
            employeeId: fact.employeeId,
            workDate: date(fact.workDate),
            workScheduleVersionId,
            dayClassification: 'SCHEDULED',
            status: 'APPROVED',
            expectedMinutes: fact.expectedMinutes ?? 480,
            calculationVersion: versionNo,
            ruleSnapshot: {},
          },
        });
        const row = await transaction.attendancePayrollFact.create({
          data: {
            agencyId,
            attendancePayrollPublicationId: publication.id,
            attendanceDayId: day.id,
            employeeId: fact.employeeId,
            workDate: date(fact.workDate),
            factType: fact.factType,
            stableSourceKey: `${fact.employeeId}|${fact.workDate}|${fact.factType}|NONE`,
            correctedMinutes: fact.minutes,
            priorMinutes: fact.prior ?? null,
            differenceDirection:
              fact.prior === undefined ? null : fact.minutes > fact.prior ? 'INCREASE' : 'DECREASE',
            differenceMinutes:
              fact.prior === undefined ? null : Math.abs(fact.minutes - fact.prior),
            createdAt: publishedAt,
          },
        });
        ids.push(row.id);
      }
      return { publicationId: publication.id, factIds: ids };
    });
  }

  /** Leave's handoff of one leave-without-pay allocation line, as Leave posts it. */
  async function postLeaveWithoutPay(setup: Setup, employeeId: string, workDates: string[]) {
    const answer = await withDatabaseContext({ agencyId: setup.tenant.agency.id }, (transaction) =>
      inputs.acceptInTransaction(transaction, {
        agencyId: setup.tenant.agency.id,
        employeeId,
        sourceModule: 'LEAVE',
        inputKind: 'LEAVE_WITHOUT_PAY',
        sourceKey: `leave-posting:${randomUUID()}:payroll`,
        sourceType: 'LeavePosting',
        sourceId: randomUUID(),
        effectiveDate: workDates[0]!,
        quantity: `${workDates.length}`,
        payload: {
          unitCode: 'WORKING_DAY',
          workDates: workDates.map((workDate) => ({ workDate, quantity: '1.0000' })),
        },
      }),
    );
    if (!('payrollInputId' in answer)) throw new Error(`Payroll refused: ${answer.reason}`);
    return answer.payrollInputId;
  }

  const resultsOf = async (job: CalculationJob) =>
    new Map(
      (
        await admin.payrollEmployee.findMany({
          where: {
            payrollPeriodId: job.payrollPeriodId,
            calculationVersion: job.calculationVersion,
          },
          include: { lines: { orderBy: { createdAt: 'asc' } } },
        })
      ).map((result) => [result.employeeId, result]),
    );

  const exceptionsOf = (job: CalculationJob) =>
    admin.payrollException.findMany({
      where: { payrollPeriodId: job.payrollPeriodId, calculationVersion: job.calculationVersion },
    });

  const sourcesOf = async (lineId: string) =>
    (await admin.payrollLineSource.findMany({ where: { payrollLineId: lineId } }))
      .map((row) => row.payrollInputId ?? row.attendancePayrollFactId)
      .sort();

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
          effectiveFrom: new Date('2883-01-01'),
          effectiveTo: new Date('2884-12-31'),
        },
      });
      await transaction.salaryGradeRate.createMany({
        data: [
          { ruleVersionId: version.id, salaryGrade: 11, salaryStep: 1, monthlyRate: '44000' },
          { ruleVersionId: version.id, salaryGrade: 11, salaryStep: 2, monthlyRate: '46200' },
        ],
      });
      return version.id;
    });
  });

  afterAll(async () => {
    if (!admin) return;
    const tables = [
      'payroll_line_sources',
      'payroll_consumed_attendance_facts',
      'attendance_deficit_charges',
      'payroll_inputs',
      'mandatory_leave_assessments',
      'leave_ledger_entries',
      'leave_accounts',
      'leave_policy_versions',
      'leave_types',
      'attendance_payroll_facts',
      'attendance_payroll_publications',
      'attendance_days',
      'attendance_period_versions',
      'attendance_periods',
      'work_schedule_versions',
      'work_schedules',
      'outbox_events',
    ];
    await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      for (const { agency } of tenants) {
        for (const table of tables) {
          await transaction.$executeRawUnsafe(
            `DELETE FROM "${table}" WHERE "agency_id" = $1::uuid`,
            agency.id,
          );
        }
      }
    });
    await cleanupPayrollTenants(admin, tenants);
    await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await transaction.$executeRaw`DELETE FROM salary_grade_rates WHERE rule_version_id = CAST(${scheduleId} AS uuid)`;
      await transaction.$executeRaw`DELETE FROM national_payroll_rule_versions WHERE code = ${scheduleCode}`;
    });
    await admin.$disconnect();
  });

  it('deducts leave without pay and whole-day absence by cutoff, never tardiness, and takes an adjustment as its delta', async () => {
    const setup = await setUp();
    const { tenant } = setup;
    const agencyId = tenant.agency.id;
    const mixed = await employeeWith(setup, 'MIXED', [['2883-06-01', null, 1]]);
    const short = await employeeWith(setup, 'SHORT', [['2883-06-01', null, 1]]);
    const compressed = await employeeWith(setup, 'CWW', [['2883-06-01', null, 1]]);
    // A step increment on 1 March, after February's leave and before its deduction.
    const spanning = await employeeWith(setup, 'SPAN', [
      ['2883-06-01', '2884-02-29', 1],
      ['2884-03-01', null, 2],
    ]);
    await openVacation(setup, mixed, '1.000');
    await openVacation(setup, short, '0.000');

    // One publication: tardiness for three Employees and a whole day of absence.
    const original = await publish(
      setup,
      [
        { employeeId: mixed, workDate: '2884-03-02', factType: 'TARDINESS', minutes: 37 },
        { employeeId: mixed, workDate: '2884-03-03', factType: 'ABSENCE', minutes: 480 },
        { employeeId: short, workDate: '2884-03-02', factType: 'TARDINESS', minutes: 37 },
        {
          employeeId: compressed,
          workDate: '2884-03-02',
          factType: 'TARDINESS',
          minutes: 20,
          expectedMinutes: 600,
          scheduleType: 'COMPRESSED',
        },
      ],
      new Date('2025-12-01T00:00:00Z'),
    );
    const absenceFactId = original.factIds[1]!;
    // Leave charges the tardiness: covered for MIXED, a .077 remainder for SHORT,
    // and nothing for the 600-minute day.
    await deficitCharges.run(preparer(tenant), original.publicationId);
    const remainder = await admin.payrollInput.findFirstOrThrow({
      where: { agencyId, employeeId: short, inputKind: 'UNPAID_DEFICIT_REMAINDER' },
    });
    expect(remainder.quantity?.toString()).toBe('0.077');

    const leave = await postLeaveWithoutPay(setup, mixed, ['2884-03-06', '2884-03-07']);
    const spanningLeave = await postLeaveWithoutPay(setup, spanning, [
      '2884-02-28',
      '2884-02-29',
      '2884-03-01',
    ]);

    // The cutoff passes after those inputs; an input accepted later waits for the next period.
    let period = await periods.create(preparer(tenant), {
      code: `DWP-2884-03-${suffix}`,
      runType: 'REGULAR',
      periodFrom: '2884-03-01',
      periodTo: '2884-03-31',
      cutoffAt: '2026-01-01T00:00:00+08:00',
      paymentDate: '2884-03-15',
    });
    period = await periods.moveCutoff(preparer(tenant), period.id, {
      cutoffAt: new Date().toISOString(),
      reason: 'Test: the cutoff follows the inputs.',
      rowVersion: period.rowVersion,
    });
    const late = await postLeaveWithoutPay(setup, mixed, ['2884-03-08']);

    const start = async () => {
      const row = await admin.payrollPeriod.findUniqueOrThrow({ where: { id: period.id } });
      const started = await periods.startCalculation(preparer(tenant), period.id, {
        rowVersion: row.rowVersion,
      });
      return {
        agencyId,
        payrollPeriodId: started.id,
        calculationVersion: started.calculationVersion,
      };
    };
    const first = await start();
    expect(await calculation.run(first)).toEqual({
      outcome: 'RETURNED',
      results: 4,
      blockingExceptions: 2,
    });

    const exceptions = await exceptionsOf(first);
    expect(exceptions.map((e) => [e.employeeId, e.exceptionType]).sort()).toEqual(
      [
        [short, 'UNPAID_DEFICIT_REMAINDER_SALARY_RULE_UNSETTLED'],
        [compressed, 'ATTENDANCE_DEFICIT_UNCHARGED'],
      ].sort(),
    );
    expect(exceptions.find((e) => e.employeeId === short)?.details).toMatchObject({
      missingFacts: ['FRACTIONAL_DAY_SALARY_RULE'],
      payrollInputs: [{ payrollInputId: remainder.id, quantity: '0.0770' }],
    });
    expect(exceptions.find((e) => e.employeeId === compressed)?.details).toMatchObject({
      facts: [{ attendancePayrollFactId: original.factIds[3], deficitType: 'TARDINESS' }],
    });

    const component = await admin.payComponent.findUniqueOrThrow({
      where: { code: 'DAYS_WITHOUT_PAY' },
    });
    const results = await resultsOf(first);
    for (const employeeId of [short, compressed]) {
      expect(results.get(employeeId)).toMatchObject({ status: 'EXCEPTION', lines: [] });
    }

    // Two days of leave and one of absence in March; the tardiness was charged to leave.
    const mixedResult = results.get(mixed)!;
    expect(mixedResult.status).toBe('CALCULATED');
    expect(
      [mixedResult.grossAmount, mixedResult.totalDeductions, mixedResult.netAmount].map(String),
    ).toEqual(['44000', '6000', '38000']);
    const mixedLine = mixedResult.lines.find((line) => line.payComponentId === component.id);
    expect(mixedLine).toMatchObject({
      payComponentId: component.id,
      lineType: 'DEDUCTION',
      ruleVersionId: scheduleId,
    });
    expect([mixedLine?.quantity, mixedLine?.rate, mixedLine?.amount].map(String)).toEqual([
      '3',
      '44000',
      '6000',
    ]);
    expect(await sourcesOf(mixedLine!.id)).toEqual([leave, absenceFactId].sort());
    expect(await sourcesOf(mixedLine!.id)).not.toContain(late);

    // Leave across February and March: each month at the salary on its Work Dates.
    const spanResult = results.get(spanning)!;
    const byMonth = (line: { sourceSnapshot: Prisma.JsonValue }) =>
      (line.sourceSnapshot as { month?: string }).month ?? 'BASIC';
    spanResult.lines.sort((a, b) => byMonth(a).localeCompare(byMonth(b)));
    expect(
      spanResult.lines.map((line) => [
        byMonth(line),
        String(line.quantity),
        String(line.rate),
        String(line.amount),
      ]),
    ).toEqual([
      ['2884-02', '2', '44000', '4000'],
      ['2884-03', '1', '46200', '2100'],
      ['BASIC', '1', '46200', '46200'],
    ]);
    for (const line of spanResult.lines.slice(0, 2)) {
      expect(await sourcesOf(line.id)).toEqual([spanningLeave]);
    }
    expect(String(spanResult.netAmount)).toBe('40100');

    // Lines and their sources never change.
    await expect(
      admin.payrollLineSource.updateMany({
        where: { payrollLineId: mixedLine!.id },
        data: { payrollInputId: late },
      }),
    ).rejects.toThrow(/immutable/);

    // A finalized payroll consumed the absence (standing in for finalization,
    // which writes this row), and an adjustment published before the cutoff
    // withdraws it: the recalculation takes only the delta.
    await seed((transaction) =>
      transaction.payrollConsumedAttendanceFact.create({
        data: { agencyId, attendancePayrollFactId: absenceFactId, payrollPeriodId: period.id },
      }),
    );
    const adjustment = await publish(
      setup,
      [{ employeeId: mixed, workDate: '2884-03-03', factType: 'ABSENCE', minutes: 0, prior: 480 }],
      new Date('2025-12-15T00:00:00Z'),
      original.publicationId,
    );
    const second = await start();
    expect(await calculation.run(second)).toMatchObject({ outcome: 'RETURNED' });
    const recalculated = await resultsOf(second);
    const withdrawn = recalculated
      .get(mixed)!
      .lines.find((line) => line.payComponentId === component.id);
    // Two days of leave less the day given back.
    expect([withdrawn?.quantity, withdrawn?.amount].map(String)).toEqual(['1', '2000']);
    expect(await sourcesOf(withdrawn!.id)).toEqual([leave, adjustment.factIds[0]].sort());
    // The same snapshot inputs reproduce the hash; the changed sources change it.
    expect(recalculated.get(spanning)?.calculationHash).toBe(spanResult.calculationHash);
    expect(recalculated.get(mixed)?.calculationHash).not.toBe(mixedResult.calculationHash);
  });
});
