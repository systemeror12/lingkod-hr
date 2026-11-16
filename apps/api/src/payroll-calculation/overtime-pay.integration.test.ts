import { randomUUID } from 'node:crypto';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import type { Prisma, PrismaClient } from '@prisma/client';
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
import { OVERTIME_PAY_RULE_KIND, OvertimePayCalculator } from './overtime-pay.calculator';
import { PayrollCalculationService } from './payroll-calculation.service';
import { payrollSourcesReader, RecordedPayBases } from './payroll-calculation.test-fixtures';
import { YearEndBonusCalculator } from './year-end-bonus.calculator';

const enabled = process.env.DATABASE_E2E === 'true';
const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

describe.skipIf(!enabled)('Overtime pay in PostgreSQL', () => {
  // Test fixtures only: the rule values are JC 2, s. 2015's, the 35,200 rate
  // makes the hourly rate 200 (250 at 125%, 300 at 150%), and 2888 sits clear
  // of every other test's rule versions.
  const suffix = `${Date.now()}-otpay`;
  const scheduleCode = `${FIXTURE_PREFIX}OTPAY-SCHEDULE-${suffix}`;
  const overtimeCode = `${FIXTURE_PREFIX}OTPAY-RULE-${suffix}`;
  const periods = new PayrollPeriodsService();
  const inputs = new PayrollInputsService();
  const facts = new RecordedPayBases();
  const basis = new CompensationBasisService(facts);
  // Contributions, PERA, and RATA have their own tests; these fixtures freeze
  // no GSIS, EC, PERA, or RATA version.
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
    new OvertimePayCalculator(),
    nothing,
    nothing,
    nothing,
  );
  let admin: PrismaClient;
  const tenants: PayrollTenant[] = [];

  const preparer = (tenant: PayrollTenant): RequestContext => ({
    ...tenant.persons[0]!.context,
    permissions: [
      { code: 'payroll.periods.create', scopePolicy: 'AGENCY' },
      { code: 'payroll.periods.calculate', scopePolicy: 'AGENCY' },
    ],
  });

  /** Fixture rows written with triggers off, as the other payroll tests write them. */
  const seed = <T>(run: (transaction: Prisma.TransactionClient) => Promise<T>) =>
    admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      return run(transaction);
    });

  beforeAll(async () => {
    admin = await createAdminClient();
    await admin.$transaction(async (transaction) => {
      const rule = {
        issuingAuthority: 'Test authority',
        issuanceReference: 'Test fixture, not an issuance',
        sourceUrl: 'https://example.test/overtime-pay',
        verifiedOn: date('2026-11-16'),
        verifiedBy: 'LingkodHR test fixture',
        effectiveFrom: date('2888-01-01'),
        effectiveTo: date('2888-12-31'),
      };
      const schedule = await transaction.nationalPayrollRuleVersion.create({
        data: { ...rule, ruleKind: 'SALARY_SCHEDULE', code: scheduleCode, name: 'Test schedule' },
      });
      await transaction.salaryGradeRate.create({
        data: { ruleVersionId: schedule.id, salaryGrade: 11, salaryStep: 1, monthlyRate: '35200' },
      });
      await transaction.nationalPayrollRuleVersion.create({
        data: {
          ...rule,
          ruleKind: OVERTIME_PAY_RULE_KIND,
          code: overtimeCode,
          name: 'Test overtime pay',
          parameters: {
            workingDaysPerMonth: 22,
            workHoursPerDay: 8,
            workdayPremium: '1.25',
            nonWorkdayPremium: '1.50',
            nonWorkdayPaidHoursLimit: 12,
            employeeAnnualCapShare: '0.50',
            agencyAnnualCapShare: '0.05',
          },
        },
      });
    });
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      for (const { agency } of tenants) {
        for (const table of ['payroll_line_sources', 'payroll_inputs', 'service_segments']) {
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
      await transaction.$executeRaw`DELETE FROM salary_grade_rates WHERE rule_version_id IN (SELECT id FROM national_payroll_rule_versions WHERE code = ${scheduleCode})`;
      await transaction.$executeRaw`DELETE FROM national_payroll_rule_versions WHERE code IN (${scheduleCode}, ${overtimeCode})`;
    });
    await admin.$disconnect();
  });

  it('pays each input once at its premium, warns past 12 hours, and blocks on both annual caps', async () => {
    const tenant = await createPayrollTenant(admin, suffix, 'OTPAY');
    tenants.push(tenant);
    const agencyId = tenant.agency.id;
    const membershipId = tenant.persons[0]!.membership.id;
    const unit = await admin.organizationUnit.create({
      data: { agencyId, code: `UNIT-OTPAY-${suffix}`, unitType: 'DIVISION', status: 'ACTIVE' },
    });

    /** An SG-11 Employee on the monthly full-time basis from `from`. */
    async function employee(label: string, from = '2887-01-01') {
      const row = await admin.employee.create({
        data: {
          agencyId,
          employeeNumber: `OTPAY-${label}-${suffix}`,
          legalName: `Overtime ${label}`,
          birthDate: new Date('1990-01-01'),
          sex: 'FEMALE',
          civilStatus: 'SINGLE',
          contactEmail: `otpay-${label.toLowerCase()}-${suffix}@example.test`,
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
              employeeId: row.id,
              organizationUnitId: unit.id,
              appointmentStatus: 'PERMANENT',
              salaryGrade: 11,
              salaryStep: 1,
              effectiveFrom: date(from),
              status: 'ACTIVE',
              createdByMembershipId: membershipId,
            },
          }),
      );
      facts.bases.set(row.id, { payBasis: 'MONTHLY_FULL_TIME', employmentFraction: null });
      return row.id;
    }

    /** Overtime's handoff of one certified record under an OVERTIME_PAY authority (#347). */
    async function certify(
      employeeId: string,
      workDate: string,
      certifiedMinutes: number,
      dayClassification: string,
    ) {
      const recordId = randomUUID();
      const answer = await withDatabaseContext({ agencyId }, (transaction) =>
        inputs.acceptInTransaction(transaction, {
          agencyId,
          employeeId,
          sourceModule: 'OVERTIME',
          inputKind: 'OVERTIME_HOURS',
          sourceKey: `overtime-service-record:${recordId}`,
          sourceType: 'OvertimeServiceRecord',
          sourceId: recordId,
          effectiveDate: workDate,
          quantity: String(certifiedMinutes),
          payload: {
            quantityUnit: 'MINUTE',
            certifiedMinutes,
            dayClassification,
            workDate,
            overtimeAuthorityId: randomUUID(),
            authorityNo: `OT-${suffix}`,
            sourceAttendanceDayId: randomUUID(),
            attendancePeriodVersionId: randomUUID(),
          },
        }),
      );
      if (!('payrollInputId' in answer)) throw new Error(`Payroll refused: ${answer.reason}`);
      return answer.payrollInputId;
    }
    const restDays = (employeeId: string, month: string, count: number) =>
      Promise.all(
        Array.from({ length: count }, (_, index) =>
          certify(
            employeeId,
            `2888-${month}-${String(index + 1).padStart(2, '0')}`,
            720,
            'REST_DAY',
          ),
        ),
      );

    async function calculate(month: string, to: string) {
      let period = await periods.create(preparer(tenant), {
        code: `OTPAY-2888-${month}-${suffix}`,
        runType: 'REGULAR',
        periodFrom: `2888-${month}-01`,
        periodTo: `2888-${month}-${to}`,
        cutoffAt: '2026-01-01T00:00:00+08:00',
        paymentDate: `2888-${month}-${to}`,
      });
      period = await periods.moveCutoff(preparer(tenant), period.id, {
        cutoffAt: new Date().toISOString(),
        reason: 'Test: the cutoff follows the certified overtime.',
        rowVersion: period.rowVersion,
      });
      const started = await periods.startCalculation(preparer(tenant), period.id, {
        rowVersion: period.rowVersion,
      });
      const job = {
        agencyId,
        payrollPeriodId: started.id,
        calculationVersion: started.calculationVersion,
      };
      return { job, outcome: await calculation.run(job) };
    }

    const steady = await employee('STEADY');
    const hired = await employee('HIRED', '2888-02-01');
    const relieved = await employee('RELIEVED');
    const repeat = await employee('REPEAT');

    // January: the repeat Employee is paid 4 rest days, 14,400, within 50% of
    // January's 35,200. The period is finalized as #626 will, consuming the inputs.
    const januaryInputs = await restDays(repeat, '01', 4);
    const january = await calculate('01', '31');
    expect(january.outcome).toMatchObject({ outcome: 'RETURNED' });
    await seed(async (transaction) => {
      await transaction.payrollPeriod.update({
        where: { id: january.job.payrollPeriodId },
        data: { status: 'FINALIZED', finalizedAt: new Date() },
      });
      await transaction.payrollInput.updateMany({
        where: { id: { in: januaryInputs } },
        data: { status: 'CONSUMED', consumedByPayrollPeriodId: january.job.payrollPeriodId },
      });
    });

    // February: 2 hours on a workday and 13 on a rest day; a new hire's 5 rest
    // days, 18,000, past 50% of the one month's salary paid in 2888; and 6 rest
    // days, 21,600, which January's finalized salary covers for one Employee but
    // not with January's overtime added.
    const workday = await certify(steady, '2888-02-02', 120, 'WORKDAY');
    const longRestDay = await certify(steady, '2888-02-05', 780, 'REST_DAY');
    await restDays(hired, '02', 5);
    await restDays(relieved, '02', 6);
    await restDays(repeat, '02', 6);
    const february = await calculate('02', '29');
    const components = new Map(
      (await admin.payComponent.findMany({ select: { id: true, code: true } })).map((row) => [
        row.id,
        row.code,
      ]),
    );
    const results = new Map(
      (
        await admin.payrollEmployee.findMany({
          where: {
            payrollPeriodId: february.job.payrollPeriodId,
            calculationVersion: february.job.calculationVersion,
          },
          include: { lines: true },
        })
      ).map((result) => [result.employeeId, result]),
    );
    const overtimeLines = (employeeId: string) =>
      results
        .get(employeeId)!
        .lines.filter((line) => components.get(line.payComponentId) === 'OVERTIME_PAY');

    const inputsOf = async (lineId: string) =>
      (await admin.payrollLineSource.findMany({ where: { payrollLineId: lineId } })).map(
        (row) => row.payrollInputId,
      );

    // Each line rests on its own input; the consumed January inputs are not paid again.
    expect(results.get(steady)!.status).toBe('CALCULATED');
    expect(
      (
        await Promise.all(
          overtimeLines(steady).map(async (line) => [
            String(line.quantity),
            String(line.amount),
            await inputsOf(line.id),
          ]),
        )
      ).sort(),
    ).toEqual([
      ['120', '500', [workday]],
      ['720', '3600', [longRestDay]],
    ]);
    expect(overtimeLines(steady)[0]!.sourceSnapshot).toMatchObject({
      taxTreatment: 'SUPPLEMENTARY_COMPENSATION',
    });
    expect(overtimeLines(repeat)).toHaveLength(6);
    expect(results.get(steady)!.grossAmount.toString()).toBe('39300');

    const exceptions = await admin.payrollException.findMany({
      where: {
        payrollPeriodId: february.job.payrollPeriodId,
        calculationVersion: february.job.calculationVersion,
        exceptionType: { startsWith: 'OVERTIME_PAY' },
      },
    });
    const raised = (employeeId: string) =>
      exceptions
        .filter((exception) => exception.employeeId === employeeId)
        .map((exception) => [exception.exceptionType, exception.severity])
        .sort();
    expect(raised(steady)).toEqual([
      ['OVERTIME_PAY_AGENCY_CAP_UNVERIFIED', 'BLOCKING'],
      ['OVERTIME_PAY_NON_WORKDAY_HOURS_EXCEEDED', 'WARNING'],
    ]);
    expect(raised(hired)).toEqual([
      ['OVERTIME_PAY_AGENCY_CAP_UNVERIFIED', 'BLOCKING'],
      ['OVERTIME_PAY_EMPLOYEE_ANNUAL_CAP', 'BLOCKING'],
    ]);
    expect(raised(relieved)).toEqual([['OVERTIME_PAY_AGENCY_CAP_UNVERIFIED', 'BLOCKING']]);
    expect(raised(repeat)).toEqual([
      ['OVERTIME_PAY_AGENCY_CAP_UNVERIFIED', 'BLOCKING'],
      ['OVERTIME_PAY_EMPLOYEE_ANNUAL_CAP', 'BLOCKING'],
    ]);
    const repeatCap = exceptions.find(
      (exception) =>
        exception.employeeId === repeat &&
        exception.exceptionType === 'OVERTIME_PAY_EMPLOYEE_ANNUAL_CAP',
    );
    expect(repeatCap?.details).toMatchObject({
      year: '2888',
      overtime: '21600',
      priorOvertime: '14400',
      yearBasicSalary: '70400',
    });
    expect(february.outcome).toEqual({
      outcome: 'RETURNED',
      results: 4,
      // The agency cap for each of the 4 paid, and the employee cap for 2.
      blockingExceptions: 6,
    });
  });
});
