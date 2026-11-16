import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CompensationBasisService } from '../compensation-basis/compensation-basis.service';
import { documentAuditWriter, DocumentsService } from '../documents/documents.service';
import { BasicSalaryCalculator } from '../payroll-calculation/basic-salary.calculator';
import { CONTRIBUTION_BILLING_DIFFERENCE } from '../payroll-calculation/contribution-billing.check';
import { PhilHealthContributionCalculator } from '../payroll-calculation/contribution.calculators';
import { DaysWithoutPayCalculator } from '../payroll-calculation/days-without-pay.calculator';
import { PayrollCalculationService } from '../payroll-calculation/payroll-calculation.service';
import {
  payrollSourcesReader,
  RecordedPayBases,
} from '../payroll-calculation/payroll-calculation.test-fixtures';
import { YearEndBonusCalculator } from '../payroll-calculation/year-end-bonus.calculator';
import { PayrollExceptionsService } from '../payroll-exceptions/payroll-exceptions.service';
import { PayrollPeriodsService } from '../payroll-periods/payroll-periods.service';
import {
  cleanupPayrollTenants,
  createAdminClient,
  createPayrollTenant,
  FIXTURE_PREFIX,
  type PayrollTenant,
} from '../payroll-periods/payroll-periods.test-fixtures';
import { ContributionBillingsService } from './contribution-billings.service';

const enabled = process.env.DATABASE_E2E === 'true';
const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

describe.skipIf(!enabled)('Contribution billing reconciliation in PostgreSQL', () => {
  // Test fixtures only: illustrative rates, and 2894 sits clear of every other
  // test's rule versions.
  const suffix = `${Date.now()}-cbil`;
  const scheduleCode = `${FIXTURE_PREFIX}CBIL-SCHEDULE-${suffix}`;
  const philHealthCode = `${FIXTURE_PREFIX}CBIL-PHILHEALTH-${suffix}`;
  const periods = new PayrollPeriodsService();
  const exceptions = new PayrollExceptionsService();
  const billings = new ContributionBillingsService(
    new DocumentsService({} as never, documentAuditWriter),
  );
  const facts = new RecordedPayBases();
  const basis = new CompensationBasisService(facts);
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
    new PhilHealthContributionCalculator(),
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
      { code: 'payroll.deductions.manage', scopePolicy: 'AGENCY' },
    ],
  });

  beforeAll(async () => {
    admin = await createAdminClient();
    await admin.$transaction(async (transaction) => {
      const rule = {
        issuingAuthority: 'Test authority',
        issuanceReference: 'Test fixture, not an issuance',
        sourceUrl: 'https://example.test/contribution',
        verifiedOn: date('2026-11-16'),
        verifiedBy: 'LingkodHR test fixture',
        effectiveFrom: date('2894-01-01'),
        effectiveTo: date('2894-12-31'),
      };
      const schedule = await transaction.nationalPayrollRuleVersion.create({
        data: { ...rule, ruleKind: 'SALARY_SCHEDULE', code: scheduleCode, name: 'Test schedule' },
      });
      await transaction.salaryGradeRate.create({
        data: { ruleVersionId: schedule.id, salaryGrade: 1, salaryStep: 1, monthlyRate: '30000' },
      });
      await transaction.nationalPayrollRuleVersion.create({
        data: {
          ...rule,
          ruleKind: 'PHILHEALTH_CONTRIBUTION',
          code: philHealthCode,
          name: 'Test PhilHealth premium',
          parameters: {
            employeeRate: '0.025',
            employerRate: '0.025',
            monthlyIncomeFloor: '10000',
            monthlyIncomeCeiling: '100000',
          },
        },
      });
    });
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      const where = { agencyId: { in: tenants.map((tenant) => tenant.agency.id) } };
      await transaction.documentVersion.deleteMany({ where });
      await transaction.document.deleteMany({ where });
      await transaction.serviceSegment.deleteMany({ where });
      await transaction.employee.deleteMany({ where });
      await transaction.organizationUnit.deleteMany({ where });
    });
    await cleanupPayrollTenants(admin, tenants);
    await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await transaction.$executeRaw`DELETE FROM salary_grade_rates WHERE rule_version_id IN (SELECT id FROM national_payroll_rule_versions WHERE code = ${scheduleCode})`;
      await transaction.$executeRaw`DELETE FROM national_payroll_rule_versions WHERE code IN (${scheduleCode}, ${philHealthCode})`;
    });
    await admin.$disconnect();
  });

  /** A tenant with `count` SG-1 Employees paid ₱30,000, so PhilHealth is 750 and 750. */
  async function payrollWith(label: string, count: number) {
    const tenant = await createPayrollTenant(admin, suffix, label);
    tenants.push(tenant);
    const agencyId = tenant.agency.id;
    const membershipId = tenant.persons[0]!.membership.id;
    const unit = await admin.organizationUnit.create({
      data: { agencyId, code: `UNIT-${label}-${suffix}`, unitType: 'DIVISION', status: 'ACTIVE' },
    });
    const employeeIds: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const employee = await admin.employee.create({
        data: {
          agencyId,
          employeeNumber: `${label}-${index}-${suffix}`,
          legalName: `Billing ${label} ${index}`,
          birthDate: new Date('1990-01-01'),
          sex: 'FEMALE',
          civilStatus: 'SINGLE',
          contactEmail: `${label.toLowerCase()}-${index}-${suffix}@example.test`,
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
              organizationUnitId: unit.id,
              appointmentStatus: 'PERMANENT',
              salaryGrade: 1,
              salaryStep: 1,
              effectiveFrom: date('2893-06-01'),
              status: 'ACTIVE',
              createdByMembershipId: membershipId,
            },
          }),
      );
      facts.bases.set(employee.id, { payBasis: 'MONTHLY_FULL_TIME', employmentFraction: null });
      employeeIds.push(employee.id);
    }
    const period = await periods.create(preparer(tenant), {
      code: `CBIL-${label}-2894-03-${suffix}`,
      runType: 'REGULAR',
      periodFrom: '2894-03-01',
      periodTo: '2894-03-31',
      cutoffAt: '2026-01-01T00:00:00+08:00',
      paymentDate: '2894-03-31',
    });
    return { tenant, employeeIds, period };
  }

  /** An issuer billing statement as a Document; `finalized` gives it an issued version. */
  async function evidence(tenant: PayrollTenant, label: string, finalized = true) {
    const membershipId = tenant.persons[0]!.membership.id;
    const document = await admin.document.create({
      data: {
        agencyId: tenant.agency.id,
        documentType: 'CONTRIBUTION_BILLING',
        classification: 'INTERNAL',
        status: finalized ? 'APPROVED' : 'DRAFT',
        createdByMembershipId: membershipId,
      },
    });
    const version = await admin.documentVersion.create({
      data: {
        agencyId: tenant.agency.id,
        documentId: document.id,
        versionNo: 1,
        storageKey: `contribution-billings/${label}-${suffix}`,
        contentHash: 'c'.repeat(64),
        mimeType: 'application/pdf',
        sizeBytes: 1,
        issuedAt: finalized ? new Date() : null,
        createdByMembershipId: membershipId,
      },
    });
    await admin.document.update({
      where: { id: document.id },
      data: { currentVersionId: version.id },
    });
    return { evidenceDocumentId: document.id, evidenceDocumentVersionId: version.id };
  }

  async function calculate(tenant: PayrollTenant, periodId: string) {
    const draft = await admin.payrollPeriod.findUniqueOrThrow({ where: { id: periodId } });
    const started = await periods.startCalculation(preparer(tenant), periodId, {
      rowVersion: draft.rowVersion,
    });
    return calculation.run({
      agencyId: tenant.agency.id,
      payrollPeriodId: periodId,
      calculationVersion: started.calculationVersion,
    });
  }

  const differences = (periodId: string, calculationVersion: number) =>
    admin.payrollException.findMany({
      where: {
        payrollPeriodId: periodId,
        calculationVersion,
        exceptionType: CONTRIBUTION_BILLING_DIFFERENCE,
      },
    });

  it('passes a match, blocks a difference until it is explained, and keeps the billing out of the lines', async () => {
    const { tenant, employeeIds, period } = await payrollWith('FLOW', 3);
    const [matched, explained, unresolved] = employeeIds as [string, string, string];
    const statement = await evidence(tenant, 'FLOW');

    const recorded = await billings.record(preparer(tenant), period.id, {
      contributionType: 'PHILHEALTH',
      ...statement,
      lines: [
        { employeeId: matched, employeeShare: '750', employerShare: '750.00' },
        { employeeId: explained, employeeShare: '800', employerShare: '800' },
        { employeeId: unresolved, employeeShare: '750', employerShare: '700' },
      ],
    });
    expect(recorded.billings).toHaveLength(3);

    // Version 1: the match raises nothing; both differences block.
    expect(await calculate(tenant, period.id)).toEqual({
      outcome: 'RETURNED',
      results: 3,
      blockingExceptions: 2,
    });
    const first = await differences(period.id, 1);
    expect(
      first
        .map((exception) => {
          const details = exception.details as Record<string, unknown>;
          return [
            exception.employeeId,
            exception.severity,
            exception.status,
            details.contributionType,
            details.billedEmployeeShare,
            details.billedEmployerShare,
            details.calculatedEmployeeShare,
            details.calculatedEmployerShare,
          ];
        })
        .sort(),
    ).toEqual(
      [
        [explained, 'BLOCKING', 'OPEN', 'PHILHEALTH', '800', '800', '750', '750'],
        [unresolved, 'BLOCKING', 'OPEN', 'PHILHEALTH', '750', '700', '750', '750'],
      ].sort(),
    );
    // The billing never replaces the rule: the lines keep the calculated shares.
    const contributions = await admin.contributionLine.findMany({
      where: { payrollEmployee: { payrollPeriodId: period.id, calculationVersion: 1 } },
    });
    expect(contributions.map((line) => line.employeeShare.toString())).toEqual([
      '750',
      '750',
      '750',
    ]);

    // The Payroll Preparer explains one difference by resolving its exception.
    const toExplain = first.find((exception) => exception.employeeId === explained)!;
    await exceptions.resolve(preparer(tenant), period.id, toExplain.id, {
      reason: 'The issuer billed March arrears with this month; remitted separately.',
    });

    // Version 2: the explained difference stays explained; the other still blocks.
    expect(await calculate(tenant, period.id)).toEqual({
      outcome: 'RETURNED',
      results: 3,
      blockingExceptions: 1,
    });
    expect((await differences(period.id, 2)).map((exception) => exception.employeeId)).toEqual([
      unresolved,
    ]);
    // An unresolved difference keeps the period from review, so it cannot be finalized.
    expect((await admin.payrollPeriod.findUniqueOrThrow({ where: { id: period.id } })).status).toBe(
      'DRAFT',
    );

    // Correcting the billing supersedes the earlier row and settles the difference.
    const corrected = await billings.record(preparer(tenant), period.id, {
      contributionType: 'PHILHEALTH',
      ...(await evidence(tenant, 'FLOW-CORRECTED')),
      lines: [{ employeeId: unresolved, employeeShare: '750', employerShare: '750' }],
    });
    const earlier = recorded.billings.find((billing) => billing.employeeId === unresolved)!;
    expect(corrected.billings[0]!.supersedesContributionBillingId).toBe(earlier.id);

    expect(await calculate(tenant, period.id)).toEqual({ outcome: 'FOR_REVIEW', results: 3 });
    expect(await differences(period.id, 3)).toEqual([]);
  });

  it('needs payroll.deductions.manage, a finalized evidence version, and a DRAFT period', async () => {
    const { tenant, employeeIds, period } = await payrollWith('GUARD', 1);
    const line = { employeeId: employeeIds[0]!, employeeShare: '750', employerShare: '750' };
    const input = { contributionType: 'PHILHEALTH' as const, lines: [line] };

    const withoutPermission: RequestContext = {
      ...preparer(tenant),
      permissions: [{ code: 'payroll.periods.calculate', scopePolicy: 'AGENCY' }],
    };
    await expect(
      billings.record(withoutPermission, period.id, {
        ...input,
        ...(await evidence(tenant, 'GUARD')),
      }),
    ).rejects.toMatchObject({ statusCode: 403, code: 'CONTRIBUTION_BILLING_RECORD_FORBIDDEN' });

    await expect(
      billings.record(preparer(tenant), period.id, {
        ...input,
        ...(await evidence(tenant, 'GUARD-DRAFT', false)),
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'CONTRIBUTION_BILLING_EVIDENCE_INELIGIBLE' });

    const recorded = await billings.record(preparer(tenant), period.id, {
      ...input,
      ...(await evidence(tenant, 'GUARD-OK')),
    });
    expect(await calculate(tenant, period.id)).toEqual({ outcome: 'FOR_REVIEW', results: 1 });

    // Once calculated, a billing waits for the period to return to DRAFT.
    await expect(
      billings.record(preparer(tenant), period.id, {
        ...input,
        ...(await evidence(tenant, 'GUARD-LATE')),
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'CONTRIBUTION_BILLING_PERIOD_NOT_DRAFT' });

    // A recorded billing never changes.
    await expect(
      admin.contributionBilling.update({
        where: { id: recorded.billings[0]!.id },
        data: { employeeShare: '1' },
      }),
    ).rejects.toThrow(/never change/);
  });
});
