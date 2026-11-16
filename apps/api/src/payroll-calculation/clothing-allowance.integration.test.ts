import { randomUUID } from 'node:crypto';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import type { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CompensationBasisService } from '../compensation-basis/compensation-basis.service';
import { PayrollPeriodsService } from '../payroll-periods/payroll-periods.service';
import {
  cleanupPayrollTenants,
  cleanupPlatformFixtures,
  createAdminClient,
  createPayrollTenant,
  FIXTURE_PREFIX,
  type PayrollTenant,
} from '../payroll-periods/payroll-periods.test-fixtures';
import { BasicSalaryCalculator } from './basic-salary.calculator';
import {
  CLOTHING_ALLOWANCE_COMPONENT_CODE,
  ClothingAllowanceCalculator,
} from './clothing-allowance.calculator';
import { CommutableRataCalculator } from './commutable-rata.calculator';
import {
  EmployeesCompensationCalculator,
  GsisContributionCalculator,
} from './contribution.calculators';
import { DaysWithoutPayCalculator } from './days-without-pay.calculator';
import { PayrollCalculationService } from './payroll-calculation.service';
import { payrollSourcesReader, RecordedPayBases } from './payroll-calculation.test-fixtures';
import { OvertimePayCalculator } from './overtime-pay.calculator';
import { PeraCalculator } from './pera.calculator';
import { YearEndBonusCalculator } from './year-end-bonus.calculator';

const enabled = process.env.DATABASE_E2E === 'true';

type RecordedBasis = { payBasis: string; employmentFraction: string | null };
const date = (value: string) => new Date(`${value}T00:00:00.000Z`);
const full: RecordedBasis = { payBasis: 'MONTHLY_FULL_TIME', employmentFraction: null };

describe.skipIf(!enabled)('Cash clothing allowance calculation in PostgreSQL', () => {
  // Test fixtures only: the rate is not from any issuance, the parameters
  // mirror the FY 2026 GAA sec. 64 and BC No. 2024-1 figures, and 2889 sits
  // clear of other tests.
  const suffix = `${Date.now()}-clothing`;
  const scheduleCode = `${FIXTURE_PREFIX}CLOTHING-SCHEDULE-${suffix}`;
  const ruleCode = `${FIXTURE_PREFIX}CLOTHING-RULE-${suffix}`;
  const periods = new PayrollPeriodsService();
  const facts = new RecordedPayBases();
  const basis = new CompensationBasisService(facts);
  const calculation = new PayrollCalculationService(
    basis,
    new BasicSalaryCalculator(),
    payrollSourcesReader(basis),
    new DaysWithoutPayCalculator(),
    new GsisContributionCalculator(),
    new EmployeesCompensationCalculator(),
    new YearEndBonusCalculator(),
    new PeraCalculator(),
    new CommutableRataCalculator(),
    new OvertimePayCalculator(),
    new ClothingAllowanceCalculator(),
  );
  let admin: PrismaClient;
  let ruleId: string;
  let componentId: string;
  const tenants: PayrollTenant[] = [];

  const preparer = (tenant: PayrollTenant): RequestContext => ({
    ...tenant.persons[0]!.context,
    permissions: [
      { code: 'payroll.periods.create', scopePolicy: 'AGENCY' },
      { code: 'payroll.periods.calculate', scopePolicy: 'AGENCY' },
    ],
  });

  /** Fixture rows written with triggers and foreign keys off, as the other payroll tests write them. */
  const seed = <T>(run: (transaction: Prisma.TransactionClient) => Promise<T>) =>
    admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      return run(transaction);
    });

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

  /** An issued appointment of `nature`, enough for Personnel's read of a segment's nature. */
  async function appointmentOf({ agency, persons }: PayrollTenant, nature: string) {
    const membershipId = persons[0]!.membership.id;
    return seed(async (transaction) => {
      const appointment = await transaction.appointment.create({
        data: {
          agencyId: agency.id,
          recruitmentHandoffId: randomUUID(),
          recruitmentSelectionPackage: {},
          positionId: randomUUID(),
          appointeePersonKey: randomUUID(),
          workflowStatus: 'ISSUED',
          issuedAt: new Date(),
          createdByMembershipId: membershipId,
          updatedByMembershipId: membershipId,
        },
      });
      const version = await transaction.appointmentVersion.create({
        data: {
          agencyId: agency.id,
          appointmentId: appointment.id,
          versionNo: 1,
          employmentStatus: 'PERMANENT',
          natureOfAppointment: nature,
          salaryGrade: 11,
          salaryStep: 1,
          effectivityDate: date('2889-01-01'),
          appointingAuthorityMembershipId: membershipId,
          formVariant: 'CS_FORM_33_A_2025',
          signatureMethod: 'WET_INK',
          appointmentDocumentVersionId: randomUUID(),
          status: 'ISSUED',
          issuedAt: new Date(),
          issuedByMembershipId: membershipId,
          createdByMembershipId: membershipId,
          updatedByMembershipId: membershipId,
        },
      });
      await transaction.appointment.update({
        where: { id: appointment.id },
        data: { currentVersionId: version.id },
      });
      return appointment.id;
    });
  }

  /** An SG-11 step 1 Employee serving from `from` to `to`, entered under `appointmentId` if given. */
  async function employeeWith(
    { agency, persons }: PayrollTenant,
    unitId: string,
    label: string,
    [from, to]: [string, string | null],
    recorded: RecordedBasis = full,
    appointmentId: string | null = null,
  ) {
    const membershipId = persons[0]!.membership.id;
    const employee = await admin.employee.create({
      data: {
        agencyId: agency.id,
        employeeNumber: `UCA-${label}-${suffix}`,
        legalName: `Clothing ${label}`,
        birthDate: date('1990-01-01'),
        sex: 'FEMALE',
        civilStatus: 'SINGLE',
        contactEmail: `uca-${label.toLowerCase()}-${suffix}@example.test`,
        serviceStatus: 'ACTIVE',
        createdByMembershipId: membershipId,
        updatedByMembershipId: membershipId,
      },
    });
    await withDatabaseContext(
      { ...persons[0]!.scope, capabilities: ['personnel-baseline-transition'] },
      (transaction) =>
        transaction.serviceSegment.create({
          data: {
            agencyId: agency.id,
            employeeId: employee.id,
            appointmentId,
            organizationUnitId: unitId,
            appointmentStatus: 'PERMANENT',
            salaryGrade: 11,
            salaryStep: 1,
            effectiveFrom: date(from),
            effectiveTo: to ? date(to) : null,
            status: to ? 'CLOSED' : 'ACTIVE',
            createdByMembershipId: membershipId,
          },
        }),
    );
    facts.bases.set(employee.id, recorded);
    return employee.id;
  }

  /** A cash grant recorded as an Agency Payroll Applicability (#618). */
  const grant = (
    { agency, persons }: PayrollTenant,
    employeeId: string | null,
    [from, to]: [string, string | null],
  ) =>
    seed((transaction) =>
      transaction.agencyPayrollApplicability.create({
        data: {
          agencyId: agency.id,
          payComponentId: componentId,
          scope: employeeId ? 'EMPLOYEE' : 'AGENCY',
          employeeId,
          authorityDocumentVersionId: randomUUID(),
          fundingReference: 'Test fixture funding',
          effectiveFrom: date(from),
          effectiveTo: to ? date(to) : null,
          recordedByMembershipId: persons[0]!.membership.id,
        },
      }),
    );

  const calculate = async (tenant: PayrollTenant, label: string) => {
    const draft = await periods.create(preparer(tenant), {
      code: `UCA-${label}-${suffix}`,
      runType: 'SPECIAL',
      periodFrom: '2889-01-01',
      periodTo: '2889-12-31',
      cutoffAt: '2026-01-01T00:00:00+08:00',
      paymentDate: '2889-05-15',
      payComponentIds: [componentId],
    });
    const started = await periods.startCalculation(preparer(tenant), draft.id, {
      rowVersion: draft.rowVersion,
    });
    const outcome = await calculation.run({
      agencyId: tenant.agency.id,
      payrollPeriodId: draft.id,
      calculationVersion: started.calculationVersion,
    });
    const results = await admin.payrollEmployee.findMany({
      where: { payrollPeriodId: draft.id },
      include: { lines: true },
    });
    const exceptions = await admin.payrollException.findMany({
      where: { payrollPeriodId: draft.id },
    });
    const period = await admin.payrollPeriod.findUniqueOrThrow({ where: { id: draft.id } });
    return { outcome, results: new Map(results.map((r) => [r.employeeId, r])), exceptions, period };
  };

  const paid = (
    result:
      | {
          lines: {
            amount: unknown;
            quantity: unknown;
            sourceSnapshot: unknown;
            ruleVersionId: string | null;
          }[];
        }
      | undefined,
  ) =>
    result?.lines.map((line) => [
      String(line.quantity),
      String(line.amount),
      (line.sourceSnapshot as { taxTreatment?: string }).taxTreatment,
      line.ruleVersionId,
    ]);

  beforeAll(async () => {
    admin = await createAdminClient();
    componentId = (
      await admin.payComponent.findUniqueOrThrow({
        where: { code: CLOTHING_ALLOWANCE_COMPONENT_CODE },
      })
    ).id;
    const rule = {
      issuingAuthority: 'Test authority',
      issuanceReference: 'Test fixture, not an issuance',
      sourceUrl: 'https://example.test/clothing-allowance',
      verifiedOn: date('2026-11-15'),
      verifiedBy: 'LingkodHR test fixture',
      effectiveFrom: date('2889-01-01'),
      effectiveTo: date('2889-12-31'),
    };
    await admin.$transaction(async (transaction) => {
      const schedule = await transaction.nationalPayrollRuleVersion.create({
        data: { ...rule, ruleKind: 'SALARY_SCHEDULE', code: scheduleCode, name: 'Test schedule' },
      });
      await transaction.salaryGradeRate.create({
        data: { ruleVersionId: schedule.id, salaryGrade: 11, salaryStep: 1, monthlyRate: '31705' },
      });
    });
    ruleId = (
      await admin.nationalPayrollRuleVersion.create({
        data: {
          ...rule,
          ruleKind: 'CLOTHING_ALLOWANCE',
          code: ruleCode,
          name: 'Test clothing allowance',
          parameters: { annualAmount: '7000.00', minimumServiceDays: 180 },
        },
      })
    ).id;
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      const where = { agencyId: { in: tenants.map((tenant) => tenant.agency.id) } };
      await transaction.agencyPayrollApplicability.deleteMany({ where });
      await transaction.serviceSegment.deleteMany({ where });
      await transaction.appointment.updateMany({ where, data: { currentVersionId: null } });
      await transaction.appointmentVersion.deleteMany({ where });
      await transaction.appointment.deleteMany({ where });
      await transaction.employee.deleteMany({ where });
      await transaction.organizationUnit.deleteMany({ where });
    });
    await cleanupPayrollTenants(admin, tenants);
    await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await transaction.$executeRaw`DELETE FROM salary_grade_rates WHERE rule_version_id IN (SELECT id FROM national_payroll_rule_versions WHERE code = ${scheduleCode})`;
    });
    await cleanupPlatformFixtures(admin, suffix);
    await admin.$disconnect();
  });

  it('pays an Agency-wide cash grant by the six-month rule and part-time share, and blocks a transfer', async () => {
    const { tenant, unitId } = await tenantWithUnit('UCA-MAIN');
    const fullYear = await employeeWith(tenant, unitId, 'FULL', ['2880-01-01', null]);
    const partTime = await employeeWith(tenant, unitId, 'PART', ['2880-01-01', null], {
      payBasis: 'PART_TIME_PROPORTIONAL',
      employmentFraction: '0.5',
    });
    // 1 January to 29 June 2889 is 180 days; to 28 June, 179.
    const atMinimum = await employeeWith(tenant, unitId, 'AT-180', ['2880-01-01', '2889-06-29']);
    const underMinimum = await employeeWith(tenant, unitId, 'AT-179', ['2880-01-01', '2889-06-28']);
    // A new hire from 1 April serves 275 days to 31 December (Annex A example 3).
    const newHire = await employeeWith(
      tenant,
      unitId,
      'HIRED',
      ['2889-04-01', null],
      full,
      await appointmentOf(tenant, 'ORIGINAL'),
    );
    const transferee = await employeeWith(
      tenant,
      unitId,
      'TRANSFER',
      ['2889-03-01', null],
      full,
      await appointmentOf(tenant, 'TRANSFER'),
    );
    await grant(tenant, null, ['2889-01-01', '2889-12-31']);

    const { outcome, results, exceptions, period } = await calculate(tenant, 'MAIN');
    expect(outcome).toEqual({ outcome: 'RETURNED', results: 6, blockingExceptions: 1 });
    expect(period.status).toBe('DRAFT');
    expect(paid(results.get(fullYear))).toEqual([['1', '7000', 'DE_MINIMIS', ruleId]]);
    expect(paid(results.get(partTime))).toEqual([['0.5', '3500', 'DE_MINIMIS', ruleId]]);
    expect(paid(results.get(atMinimum))).toEqual([['1', '7000', 'DE_MINIMIS', ruleId]]);
    expect(paid(results.get(underMinimum))).toEqual([]);
    expect(paid(results.get(newHire))).toEqual([['1', '7000', 'DE_MINIMIS', ruleId]]);
    expect(results.get(newHire)?.lines[0]?.sourceSnapshot).toMatchObject({ serviceDays: 275 });
    expect(paid(results.get(transferee))).toEqual([]);
    expect(exceptions.map((e) => [e.employeeId, e.exceptionType, e.severity])).toEqual([
      [transferee, 'CLOTHING_ALLOWANCE_TRANSFER_UNSETTLED', 'BLOCKING'],
    ]);
  });

  it('pays nothing without a cash grant in effect on the payment date, and only to a named Employee', async () => {
    const { tenant, unitId } = await tenantWithUnit('UCA-GRANT');
    const named = await employeeWith(tenant, unitId, 'NAMED', ['2880-01-01', null]);
    const other = await employeeWith(tenant, unitId, 'OTHER', ['2880-01-01', null]);

    // With no Applicability at all, nothing is paid and nothing blocks.
    const none = await calculate(tenant, 'NONE');
    expect(none.outcome).toEqual({ outcome: 'FOR_REVIEW', results: 2 });
    expect([...none.results.values()].flatMap((result) => result.lines)).toEqual([]);

    // An Agency-wide grant that ended before the 15 May payment date pays no one;
    // a grant for one named Employee pays only that Employee.
    await grant(tenant, null, ['2889-01-01', '2889-04-30']);
    const own = await grant(tenant, named, ['2889-05-01', '2889-12-31']);
    const granted = await calculate(tenant, 'NAMED');
    expect(granted.outcome).toEqual({ outcome: 'FOR_REVIEW', results: 2 });
    expect(paid(granted.results.get(named))).toEqual([['1', '7000', 'DE_MINIMIS', ruleId]]);
    expect(granted.results.get(named)?.lines[0]?.sourceSnapshot).toMatchObject({
      agencyPayrollApplicability: { agencyPayrollApplicabilityId: own.id, scope: 'EMPLOYEE' },
    });
    expect(paid(granted.results.get(other))).toEqual([]);
  });
});
