import { randomUUID } from 'node:crypto';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import type { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApproveAuthorizedPayrollComponentInputService } from '../authorized-payroll-component-inputs/approve-authorized-payroll-component-input.service';
import { RecordAuthorizedPayrollComponentInputService } from '../authorized-payroll-component-inputs/record-authorized-payroll-component-input.service';
import { CompensationBasisService } from '../compensation-basis/compensation-basis.service';
import { DocumentsService } from '../documents/documents.service';
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
import {
  NIGHT_SHIFT_DIFFERENTIAL_COMPONENT_CODE,
  NIGHT_SHIFT_DIFFERENTIAL_RULE_KIND,
} from './night-shift-differential.calculator';
import { PayrollCalculationService } from './payroll-calculation.service';
import { payrollSourcesReader, RecordedPayBases } from './payroll-calculation.test-fixtures';
import { YearEndBonusCalculator } from './year-end-bonus.calculator';

const enabled = process.env.DATABASE_E2E === 'true';
const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

describe.skipIf(!enabled)('Night-shift differential in PostgreSQL', () => {
  // Test fixtures only: the rule values are RA No. 11701's, the 35,200 rate
  // makes the hourly basic rate 200 (20 an hour at 10%, 30 at 15%), and 2877
  // sits clear of every other test's rule versions.
  const suffix = `${Date.now()}-nsd`;
  const scheduleCode = `${FIXTURE_PREFIX}NSD-SCHEDULE-${suffix}`;
  const nightShiftCode = `${FIXTURE_PREFIX}NSD-RULE-${suffix}`;
  const periods = new PayrollPeriodsService();
  const facts = new RecordedPayBases();
  const basis = new CompensationBasisService(facts);
  const record = new RecordAuthorizedPayrollComponentInputService(
    new DocumentsService({} as never, {} as never),
  );
  const approve = new ApproveAuthorizedPayrollComponentInputService();
  // Contributions, PERA, RATA, and overtime have their own tests; these
  // fixtures freeze no version of theirs.
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
    nothing,
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
  const adjuster = (tenant: PayrollTenant, index: number): RequestContext => ({
    ...tenant.persons[index]!.context,
    permissions: [{ code: 'payroll.inputs.adjust', scopePolicy: 'AGENCY' }],
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
        sourceUrl: 'https://example.test/night-shift-differential',
        verifiedOn: date('2026-11-16'),
        verifiedBy: 'LingkodHR test fixture',
        effectiveFrom: date('2877-01-01'),
        effectiveTo: date('2877-12-31'),
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
          ruleKind: NIGHT_SHIFT_DIFFERENTIAL_RULE_KIND,
          code: nightShiftCode,
          name: 'Test night-shift differential',
          parameters: { rateCeiling: '0.20', workingDaysPerMonth: 22, workHoursPerDay: 8 },
        },
      });
    });
  });

  afterAll(async () => {
    if (!admin) return;
    const tables = [
      'payroll_line_sources',
      'payroll_consumed_attendance_facts',
      'authorized_payroll_component_inputs',
      'attendance_payroll_facts',
      'attendance_payroll_publications',
      'attendance_days',
      'attendance_period_versions',
      'attendance_periods',
      'service_segments',
      'employees',
      'document_versions',
      'documents',
    ];
    await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      for (const { agency } of tenants) {
        await transaction.$executeRawUnsafe(
          'UPDATE "documents" SET "current_version_id" = NULL WHERE "agency_id" = $1::uuid',
          agency.id,
        );
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
      await transaction.$executeRaw`DELETE FROM national_payroll_rule_versions WHERE code IN (${scheduleCode}, ${nightShiftCode})`;
    });
    await admin.$disconnect();
  });

  it('pays approved night hours at the rate in effect on each Work Date, once, and blocks night duty no rate covers', async () => {
    const tenant = await createPayrollTenant(admin, suffix, 'NSD', 2);
    tenants.push(tenant);
    const agencyId = tenant.agency.id;
    const membershipId = tenant.persons[0]!.membership.id;
    const unit = await admin.organizationUnit.create({
      data: { agencyId, code: `UNIT-NSD-${suffix}`, unitType: 'DIVISION', status: 'ACTIVE' },
    });

    /** An SG-11 Employee on the monthly full-time basis for all of 2877. */
    async function employee(label: string) {
      const row = await admin.employee.create({
        data: {
          agencyId,
          employeeNumber: `NSD-${label}-${suffix}`,
          legalName: `Night Shift ${label}`,
          birthDate: new Date('1990-01-01'),
          sex: 'FEMALE',
          civilStatus: 'SINGLE',
          contactEmail: `nsd-${label.toLowerCase()}-${suffix}@example.test`,
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
              effectiveFrom: date('2877-01-01'),
              status: 'ACTIVE',
              createdByMembershipId: membershipId,
            },
          }),
      );
      facts.bases.set(row.id, { payBasis: 'MONTHLY_FULL_TIME', employmentFraction: null });
      return row.id;
    }
    const covered = await employee('COVERED');
    const excluded = await employee('EXCLUDED');
    const daytime = await employee('DAYTIME');

    // The agency head's issuance, as a finalized Document Version of the Agency.
    const authority = await seed(async (transaction) => {
      const document = await transaction.document.create({
        data: {
          agencyId,
          documentType: 'AGENCY_ISSUANCE',
          classification: 'INTERNAL',
          status: 'APPROVED',
          createdByMembershipId: membershipId,
        },
      });
      const version = await transaction.documentVersion.create({
        data: {
          agencyId,
          documentId: document.id,
          versionNo: 1,
          storageKey: `nsd/${suffix}/issued`,
          contentHash: 'a'.repeat(64),
          mimeType: 'application/pdf',
          sizeBytes: 1,
          issuedAt: new Date(),
          createdByMembershipId: membershipId,
        },
      });
      await transaction.document.update({
        where: { id: document.id },
        data: { currentVersionId: version.id },
      });
      return version.id;
    });

    /** A night-shift differential rate for one Employee, recorded and, unless told, approved. */
    async function rate(
      employeeId: string,
      value: string,
      effectiveFrom: string,
      effectiveTo: string | null,
      approved = true,
    ) {
      const component = await admin.payComponent.findUniqueOrThrow({
        where: { code: NIGHT_SHIFT_DIFFERENTIAL_COMPONENT_CODE },
      });
      const recorded = await record.execute(adjuster(tenant, 0), {
        payComponentId: component.id,
        scope: 'EMPLOYEE',
        employeeId,
        valueKind: 'RATE',
        value,
        paymentSchedule: 'EACH_REGULAR_PERIOD',
        authorityDocumentVersionId: authority,
        sourceReference: `Office Order NSD-${value}, s. 2877`,
        effectiveFrom,
        effectiveTo,
      });
      if (approved) await approve.execute(adjuster(tenant, 1), recorded.id);
      return recorded.id;
    }
    // The rate changes inside March: 10% through the 15th, 15% from the 16th.
    const tenPercent = await rate(covered, '0.10', '2877-01-01', '2877-03-15');
    const fifteenPercent = await rate(covered, '0.15', '2877-03-16', null);
    // A rate recorded but never approved is no rate.
    await rate(excluded, '0.10', '2877-01-01', null, false);

    // Attendance's lock of March publishes the night duty and the worked minutes.
    const nightFacts = await seed(async (transaction) => {
      const attendancePeriod = await transaction.attendancePeriod.create({
        data: {
          agencyId,
          code: `P-NSD-${suffix}`,
          dateFrom: date('2877-03-01'),
          dateTo: date('2877-03-31'),
          status: 'FINALIZED',
        },
      });
      const publishedAt = new Date('2025-12-01T00:00:00Z');
      const version = await transaction.attendancePeriodVersion.create({
        data: {
          agencyId,
          attendancePeriodId: attendancePeriod.id,
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
      const ids = new Map<string, string>();
      const seeds: [string, string, 'WORKED' | 'NIGHT_DUTY', number][] = [
        [covered, '2877-03-10', 'NIGHT_DUTY', 480],
        [covered, '2877-03-11', 'NIGHT_DUTY', 480],
        [covered, '2877-03-20', 'NIGHT_DUTY', 240],
        [excluded, '2877-03-10', 'NIGHT_DUTY', 480],
        [daytime, '2877-03-10', 'WORKED', 480],
      ];
      for (const [employeeId, workDate, factType, minutes] of seeds) {
        const day = await transaction.attendanceDay.create({
          data: {
            agencyId,
            attendancePeriodId: attendancePeriod.id,
            employeeId,
            workDate: date(workDate),
            dayClassification: 'SCHEDULED',
            status: 'APPROVED',
            expectedMinutes: 480,
            calculationVersion: 1,
            ruleSnapshot: {},
          },
        });
        const fact = await transaction.attendancePayrollFact.create({
          data: {
            agencyId,
            attendancePayrollPublicationId: publication.id,
            attendanceDayId: day.id,
            employeeId,
            workDate: date(workDate),
            factType,
            stableSourceKey: `${employeeId}|${workDate}|${factType}|NONE`,
            correctedMinutes: minutes,
            createdAt: publishedAt,
          },
        });
        ids.set(`${employeeId}|${workDate}`, fact.id);
      }
      return ids;
    });
    const factOf = (employeeId: string, workDate: string) =>
      nightFacts.get(`${employeeId}|${workDate}`)!;

    const period = await periods.create(preparer(tenant), {
      code: `NSD-2877-03-${suffix}`,
      runType: 'REGULAR',
      periodFrom: '2877-03-01',
      periodTo: '2877-03-31',
      cutoffAt: '2026-01-01T00:00:00+08:00',
      paymentDate: '2877-03-31',
    });
    // A finalized payroll already consumed the 11 March night duty (ADR 0014).
    await seed((transaction) =>
      transaction.payrollConsumedAttendanceFact.create({
        data: {
          agencyId,
          attendancePayrollFactId: factOf(covered, '2877-03-11'),
          payrollPeriodId: period.id,
        },
      }),
    );
    const started = await periods.startCalculation(preparer(tenant), period.id, {
      rowVersion: period.rowVersion,
    });
    const job = {
      agencyId,
      payrollPeriodId: started.id,
      calculationVersion: started.calculationVersion,
    };
    expect(await calculation.run(job)).toEqual({
      outcome: 'RETURNED',
      results: 3,
      blockingExceptions: 1,
    });

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
            payrollPeriodId: job.payrollPeriodId,
            calculationVersion: job.calculationVersion,
          },
          include: { lines: true },
        })
      ).map((result) => [result.employeeId, result]),
    );
    const nightLines = (employeeId: string) =>
      results
        .get(employeeId)!
        .lines.filter(
          (line) => components.get(line.payComponentId) === NIGHT_SHIFT_DIFFERENTIAL_COMPONENT_CODE,
        );
    const sourcesOf = async (lineId: string) =>
      (await admin.payrollLineSource.findMany({ where: { payrollLineId: lineId } }))
        .map((row) => row.attendancePayrollFactId ?? row.authorizedPayrollComponentInputId)
        .sort();

    // One line per rate, each resting on its night-duty facts and its rate
    // input; the consumed 11 March fact is not paid again.
    expect(results.get(covered)!.status).toBe('CALCULATED');
    expect(
      (
        await Promise.all(
          nightLines(covered).map(async (line) => [
            String(line.quantity),
            String(line.amount),
            await sourcesOf(line.id),
          ]),
        )
      ).sort(),
    ).toEqual(
      [
        // 8 hours × 200 × 10%.
        ['480', '160', [factOf(covered, '2877-03-10'), tenPercent].sort()],
        // 4 hours × 200 × 15%.
        ['240', '120', [factOf(covered, '2877-03-20'), fifteenPercent].sort()],
      ].sort(),
    );
    expect(nightLines(covered)[0]!.sourceSnapshot).toMatchObject({
      taxTreatment: 'SUPPLEMENTARY_COMPENSATION',
    });
    expect(results.get(covered)!.grossAmount.toString()).toBe('35480');

    // No approved rate covers the excluded Employee's night duty: no line, one
    // blocking exception. The daytime Employee has no night duty and no exception.
    expect(results.get(excluded)!.status).toBe('EXCEPTION');
    expect(results.get(excluded)!.lines).toEqual([]);
    expect(results.get(daytime)!.status).toBe('CALCULATED');
    expect(nightLines(daytime)).toEqual([]);
    const exceptions = await admin.payrollException.findMany({
      where: { payrollPeriodId: job.payrollPeriodId, calculationVersion: job.calculationVersion },
    });
    expect(exceptions.map((row) => [row.employeeId, row.exceptionType, row.severity])).toEqual([
      [excluded, 'NIGHT_SHIFT_DIFFERENTIAL_RATE_NOT_IN_EFFECT', 'BLOCKING'],
    ]);
    expect(exceptions[0]!.details).toMatchObject({
      workDates: ['2877-03-10'],
      facts: [{ attendancePayrollFactId: factOf(excluded, '2877-03-10'), minutes: 480 }],
    });
  });
});
