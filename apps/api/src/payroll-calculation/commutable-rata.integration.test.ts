import { randomUUID } from 'node:crypto';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import type { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CompensationBasisService } from '../compensation-basis/compensation-basis.service';
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
  COMMUTABLE_RATA_RULE_KIND,
  CommutableRataCalculator,
  OFFICIAL_VEHICLE_ASSIGNMENT_COMPONENT_CODE,
} from './commutable-rata.calculator';
import { DaysWithoutPayCalculator } from './days-without-pay.calculator';
import { PayrollCalculationService } from './payroll-calculation.service';
import { payrollSourcesReader, RecordedPayBases } from './payroll-calculation.test-fixtures';
import { YearEndBonusCalculator } from './year-end-bonus.calculator';

const enabled = process.env.DATABASE_E2E === 'true';
const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

describe.skipIf(!enabled)('Commutable RATA in PostgreSQL', () => {
  // Test fixtures only: the division-chief rate is the FY 2026 GAA sec. 71(g)
  // figure the research register records, the band days are illustrative, and
  // 2887 sits clear of every other test's rule versions.
  const suffix = `${Date.now()}-rata`;
  const scheduleCode = `${FIXTURE_PREFIX}RATA-SCHEDULE-${suffix}`;
  const rataCode = `${FIXTURE_PREFIX}RATA-RULE-${suffix}`;
  const periods = new PayrollPeriodsService();
  const facts = new RecordedPayBases();
  const basis = new CompensationBasisService(facts);
  // Contributions and PERA have their own tests; these fixtures freeze no GSIS,
  // EC, or PERA version.
  const noContribution = { calculate: () => ({ lines: [], exceptions: [] }) };
  const calculation = new PayrollCalculationService(
    basis,
    new BasicSalaryCalculator(),
    payrollSourcesReader(basis),
    new DaysWithoutPayCalculator(),
    noContribution,
    noContribution,
    new YearEndBonusCalculator(),
    noContribution,
    new CommutableRataCalculator(),
    noContribution,
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

  /** March 2887's weekdays. */
  const weekdays = Array.from(
    { length: 31 },
    (_, index) => `2887-03-${String(index + 1).padStart(2, '0')}`,
  ).filter((day) => ![0, 6].includes(date(day).getUTCDay()));

  beforeAll(async () => {
    admin = await createAdminClient();
    await admin.$transaction(async (transaction) => {
      const rule = {
        issuingAuthority: 'Test authority',
        issuanceReference: 'Test fixture, not an issuance',
        sourceUrl: 'https://example.test/rata',
        verifiedOn: date('2026-11-15'),
        verifiedBy: 'LingkodHR test fixture',
        effectiveFrom: date('2887-01-01'),
        effectiveTo: date('2887-12-31'),
      };
      const schedule = await transaction.nationalPayrollRuleVersion.create({
        data: { ...rule, ruleKind: 'SALARY_SCHEDULE', code: scheduleCode, name: 'Test schedule' },
      });
      await transaction.salaryGradeRate.create({
        data: { ruleVersionId: schedule.id, salaryGrade: 24, salaryStep: 1, monthlyRate: '88000' },
      });
      await transaction.nationalPayrollRuleVersion.create({
        data: {
          ...rule,
          ruleKind: COMMUTABLE_RATA_RULE_KIND,
          code: rataCode,
          name: 'Test commutable RATA',
          parameters: {
            ranks: [
              {
                rank: 'Chief of Division',
                positionTitles: ['Chief of Division'],
                representationAllowance: '6000.00',
                transportationAllowance: '6000.00',
              },
            ],
            actualWorkSchedule: [
              { minimumDays: 1, share: '0.25' },
              { minimumDays: 6, share: '0.5' },
              { minimumDays: 12, share: '0.75' },
              { minimumDays: 17, share: '1' },
            ],
          },
        },
      });
    });
  });

  afterAll(async () => {
    if (!admin) return;
    const tables = [
      'agency_payroll_applicabilities',
      'attendance_payroll_facts',
      'attendance_payroll_publications',
      'attendance_days',
      'attendance_period_versions',
      'attendance_periods',
      'service_segments',
      'plantilla_position_versions',
      'plantilla_positions',
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
      await transaction.$executeRaw`DELETE FROM salary_grade_rates WHERE rule_version_id IN (SELECT id FROM national_payroll_rule_versions WHERE code = ${scheduleCode})`;
      await transaction.$executeRaw`DELETE FROM national_payroll_rule_versions WHERE code IN (${scheduleCode}, ${rataCode})`;
    });
    await admin.$disconnect();
  });

  it('pays an eligible incumbent by actual work, leaves out TA under an official vehicle, and nothing to other positions', async () => {
    const tenant = await createPayrollTenant(admin, suffix, 'RATA');
    tenants.push(tenant);
    const agencyId = tenant.agency.id;
    const membershipId = tenant.persons[0]!.membership.id;
    const unit = await admin.organizationUnit.create({
      data: { agencyId, code: `UNIT-RATA-${suffix}`, unitType: 'DIVISION', status: 'ACTIVE' },
    });

    /** An SG-24 Employee holding a position with this title since 2886. */
    async function incumbent(label: string, positionTitle: string) {
      const position = await seed(async (transaction) => {
        const row = await transaction.plantillaPosition.create({
          data: {
            agencyId,
            itemNumber: `RATA-${label}-${suffix}`,
            status: 'OCCUPIED',
            createdByMembershipId: membershipId,
            updatedByMembershipId: membershipId,
          },
        });
        await transaction.plantillaPositionVersion.create({
          data: {
            agencyId,
            positionId: row.id,
            organizationUnitId: unit.id,
            qualificationStandardVersionId: randomUUID(),
            staffingAuthorityId: randomUUID(),
            versionNo: 1,
            positionTitle,
            salaryGrade: 24,
            fundingSource: 'GAA',
            employmentCategory: 'PLANTILLA',
            domainStatus: 'OCCUPIED',
            effectiveFrom: date('2886-01-01'),
            status: 'ACTIVE',
            createdByMembershipId: membershipId,
            updatedByMembershipId: membershipId,
          },
        });
        return row.id;
      });
      const employee = await admin.employee.create({
        data: {
          agencyId,
          employeeNumber: `RATA-${label}-${suffix}`,
          legalName: `RATA ${label}`,
          birthDate: new Date('1980-01-01'),
          sex: 'FEMALE',
          civilStatus: 'SINGLE',
          contactEmail: `rata-${label.toLowerCase()}-${suffix}@example.test`,
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
              positionId: position,
              organizationUnitId: unit.id,
              appointmentStatus: 'PERMANENT',
              salaryGrade: 24,
              salaryStep: 1,
              effectiveFrom: date('2886-01-01'),
              status: 'ACTIVE',
              createdByMembershipId: membershipId,
            },
          }),
      );
      facts.bases.set(employee.id, { payBasis: 'MONTHLY_FULL_TIME', employmentFraction: null });
      return employee.id;
    }
    const chief = await incumbent('CHIEF', 'Chief of Division');
    const driven = await incumbent('DRIVEN', 'chief of  division');
    const officer = await incumbent('OFFICER', 'Administrative Officer V');

    // March's Attendance, locked and published: the chief worked 14 weekdays and
    // was on posted leave for the rest; the others worked every weekday.
    await seed(async (transaction) => {
      const period = await transaction.attendancePeriod.create({
        data: {
          agencyId,
          code: `P-RATA-${suffix}`,
          dateFrom: date('2887-03-01'),
          dateTo: date('2887-03-31'),
          status: 'FINALIZED',
        },
      });
      const publishedAt = new Date('2026-01-01T00:00:00Z');
      const version = await transaction.attendancePeriodVersion.create({
        data: {
          agencyId,
          attendancePeriodId: period.id,
          versionNo: 1,
          status: 'LOCKED',
          approvalRouteVersionId: randomUUID(),
          submittedByMembershipId: membershipId,
          submittedAt: publishedAt,
          reviewedByMembershipId: randomUUID(),
          reviewedAt: publishedAt,
          lockedByMembershipId: membershipId,
          lockedAt: publishedAt,
          reconciliation: {},
        },
      });
      const publication = await transaction.attendancePayrollPublication.create({
        data: {
          agencyId,
          attendancePeriodVersionId: version.id,
          publicationType: 'ORIGINAL',
          idempotencyKey: `publication:${version.id}`,
          publishedAt,
        },
      });
      for (const employeeId of [chief, driven, officer]) {
        for (const [index, workDate] of weekdays.entries()) {
          const day = await transaction.attendanceDay.create({
            data: {
              agencyId,
              attendancePeriodId: period.id,
              employeeId,
              workDate: date(workDate),
              dayClassification: 'SCHEDULED',
              status: 'APPROVED',
              expectedMinutes: 480,
              calculationVersion: 1,
              ruleSnapshot: {},
            },
          });
          const coverage = employeeId === chief && index >= 14 ? 'POSTED_LEAVE' : 'WORKED';
          await transaction.attendancePayrollFact.createMany({
            data: ['EXPECTED', coverage].map((factType) => ({
              agencyId,
              attendancePayrollPublicationId: publication.id,
              attendanceDayId: day.id,
              employeeId,
              workDate: date(workDate),
              factType,
              stableSourceKey: `${employeeId}|${workDate}|${factType}|NONE`,
              correctedMinutes: 480,
            })),
          });
        }
      }
    });

    // The driven chief's official-vehicle assignment, recorded through #618.
    const vehicleComponent = await admin.payComponent.findUniqueOrThrow({
      where: { code: OFFICIAL_VEHICLE_ASSIGNMENT_COMPONENT_CODE },
    });
    const vehicle = await seed((transaction) =>
      transaction.agencyPayrollApplicability.create({
        data: {
          agencyId,
          payComponentId: vehicleComponent.id,
          scope: 'EMPLOYEE',
          employeeId: driven,
          authorityDocumentVersionId: randomUUID(),
          fundingReference: 'Not applicable to a vehicle assignment',
          effectiveFrom: date('2887-02-01'),
          recordedByMembershipId: membershipId,
        },
      }),
    );

    let period = await periods.create(preparer(tenant), {
      code: `RATA-2887-03-${suffix}`,
      runType: 'REGULAR',
      periodFrom: '2887-03-01',
      periodTo: '2887-03-31',
      cutoffAt: '2026-01-01T00:00:00+08:00',
      paymentDate: '2887-03-31',
    });
    period = await periods.moveCutoff(preparer(tenant), period.id, {
      cutoffAt: new Date().toISOString(),
      reason: 'Test: the cutoff follows the Attendance.',
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
    expect(await calculation.run(job)).toEqual({ outcome: 'FOR_REVIEW', results: 3 });

    const components = new Map(
      (await admin.payComponent.findMany({ select: { id: true, code: true } })).map((row) => [
        row.id,
        row.code,
      ]),
    );
    const results = await admin.payrollEmployee.findMany({
      where: { payrollPeriodId: job.payrollPeriodId, calculationVersion: job.calculationVersion },
      include: { lines: true },
    });
    const linesOf = (employeeId: string) =>
      results
        .find((result) => result.employeeId === employeeId)!
        .lines.map((line) => [
          components.get(line.payComponentId),
          line.lineType,
          String(line.quantity),
          String(line.amount),
        ])
        .sort();
    // 14 days of actual work reach the 75% band.
    expect(linesOf(chief)).toEqual([
      ['BASIC_SALARY', 'EARNING', '1', '88000'],
      ['REPRESENTATION_ALLOWANCE', 'EARNING', '0.75', '4500'],
      ['TRANSPORTATION_ALLOWANCE', 'EARNING', '0.75', '4500'],
    ]);
    expect(linesOf(driven)).toEqual([
      ['BASIC_SALARY', 'EARNING', '1', '88000'],
      ['REPRESENTATION_ALLOWANCE', 'EARNING', '1', '6000'],
    ]);
    expect(linesOf(officer)).toEqual([['BASIC_SALARY', 'EARNING', '1', '88000']]);

    const drivenRepresentation = results
      .find((result) => result.employeeId === driven)!
      .lines.find((line) => components.get(line.payComponentId) === 'REPRESENTATION_ALLOWANCE');
    expect(drivenRepresentation?.sourceSnapshot).toMatchObject({
      rank: 'Chief of Division',
      actualWorkDays: weekdays.length,
      taxTreatment: 'NON_TAXABLE',
      officialVehicleAssignment: { agencyPayrollApplicabilityIds: [vehicle.id] },
    });
  });
});
