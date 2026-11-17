import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import type { PrismaClient } from '@prisma/client';
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
import { DaysWithoutPayCalculator } from './days-without-pay.calculator';
import { PayrollCalculationService } from './payroll-calculation.service';
import { payrollSourcesReader, RecordedPayBases } from './payroll-calculation.test-fixtures';
import { YearEndBonusCalculator } from './year-end-bonus.calculator';

const enabled = process.env.DATABASE_E2E === 'true';
const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

describe.skipIf(!enabled)('Authorized deductions in PostgreSQL', () => {
  // Test fixtures only: the floor and order follow FY 2026 GAA sec. 62
  // (salary-overpayment-recovery-authorities.md R6), but no real version is
  // loaded. The salary rate is illustrative. 2896 sits clear of every other
  // test's rule versions.
  const suffix = `${Date.now()}-loan`;
  const codes = {
    schedule: `${FIXTURE_PREFIX}LOAN-SCHEDULE-${suffix}`,
    deductions: `${FIXTURE_PREFIX}LOAN-DEDUCTIONS-${suffix}`,
  };
  const periods = new PayrollPeriodsService();
  const facts = new RecordedPayBases();
  const basis = new CompensationBasisService(facts);
  // Only basic salary pays here; every other calculator has its own test.
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
  let deductionsId: string;
  const tenants: PayrollTenant[] = [];

  const preparer = (tenant: PayrollTenant): RequestContext => ({
    ...tenant.persons[0]!.context,
    permissions: [
      { code: 'payroll.periods.create', scopePolicy: 'AGENCY' },
      { code: 'payroll.periods.calculate', scopePolicy: 'AGENCY' },
    ],
  });

  beforeAll(async () => {
    admin = await createAdminClient();
    const rule = {
      issuingAuthority: 'Test authority',
      issuanceReference: 'Test fixture, not an issuance',
      sourceUrl: 'https://example.test/authorized-deductions',
      verifiedOn: date('2026-11-17'),
      verifiedBy: 'LingkodHR test fixture',
      effectiveFrom: date('2896-01-01'),
      effectiveTo: date('2896-12-31'),
    };
    await admin.$transaction(async (transaction) => {
      const schedule = await transaction.nationalPayrollRuleVersion.create({
        data: {
          ...rule,
          ruleKind: 'SALARY_SCHEDULE',
          code: codes.schedule,
          name: 'Test SALARY_SCHEDULE',
          parameters: {},
        },
      });
      await transaction.salaryGradeRate.create({
        data: { ruleVersionId: schedule.id, salaryGrade: 1, salaryStep: 1, monthlyRate: '10000' },
      });
      deductionsId = (
        await transaction.nationalPayrollRuleVersion.create({
          data: {
            ...rule,
            ruleKind: 'AUTHORIZED_DEDUCTIONS',
            code: codes.deductions,
            name: 'Test AUTHORIZED_DEDUCTIONS',
            parameters: {
              allowedPayeeCategories: [
                'GSIS',
                'EMPLOYEE_COOPERATIVE_OR_ASSOCIATION',
                'LICENSED_INSURER',
              ],
              priorityPayeeCategories: ['GSIS'],
              monthlyNetTakeHomeFloor: '5000.00',
            },
          },
        })
      ).id;
    });
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      const where = { agencyId: { in: tenants.map((tenant) => tenant.agency.id) } };
      await transaction.loanDeductionLine.deleteMany({ where });
      await transaction.deductionObligation.deleteMany({ where });
      await transaction.document.updateMany({ where, data: { currentVersionId: null } });
      await transaction.documentVersion.deleteMany({ where });
      await transaction.document.deleteMany({ where });
      await transaction.serviceSegment.deleteMany({ where });
      await transaction.employee.deleteMany({ where });
      await transaction.organizationUnit.deleteMany({ where });
    });
    await cleanupPayrollTenants(admin, tenants);
    await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await transaction.$executeRaw`DELETE FROM salary_grade_rates WHERE rule_version_id IN (SELECT id FROM national_payroll_rule_versions WHERE code = ${codes.schedule})`;
      for (const code of Object.values(codes)) {
        await transaction.$executeRaw`DELETE FROM national_payroll_rule_versions WHERE code = ${code}`;
      }
    });
    await admin.$disconnect();
  });

  it('applies the obligations in effect at month end as of the cutoff, by priority, stops them at the floor, and records each', async () => {
    const tenant = await createPayrollTenant(admin, suffix, 'LOAN');
    tenants.push(tenant);
    const agencyId = tenant.agency.id;
    const membershipId = tenant.persons[0]!.membership.id;
    const unit = await admin.organizationUnit.create({
      data: { agencyId, code: `UNIT-LOAN-${suffix}`, unitType: 'DIVISION', status: 'ACTIVE' },
    });
    const document = await admin.document.create({
      data: {
        agencyId,
        documentType: 'SALARY_DEDUCTION_AUTHORITY',
        classification: 'INTERNAL',
        status: 'APPROVED',
        createdByMembershipId: membershipId,
      },
    });
    const authority = await admin.documentVersion.create({
      data: {
        agencyId,
        documentId: document.id,
        versionNo: 1,
        storageKey: `authorized-deductions/${suffix}`,
        contentHash: 'd'.repeat(64),
        mimeType: 'application/pdf',
        sizeBytes: 1,
        issuedAt: new Date(),
        createdByMembershipId: membershipId,
      },
    });

    /** An SG-1 step-1 Employee, full-time since 2895. */
    async function employee(label: string) {
      const created = await admin.employee.create({
        data: {
          agencyId,
          employeeNumber: `LOAN-${label}-${suffix}`,
          legalName: `Deduction ${label}`,
          birthDate: new Date('1990-01-01'),
          sex: 'FEMALE',
          civilStatus: 'SINGLE',
          contactEmail: `loan-${label.toLowerCase()}-${suffix}@example.test`,
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
              employeeId: created.id,
              organizationUnitId: unit.id,
              appointmentStatus: 'PERMANENT',
              salaryGrade: 1,
              salaryStep: 1,
              effectiveFrom: date('2895-06-01'),
              status: 'ACTIVE',
              createdByMembershipId: membershipId,
            },
          }),
      );
      facts.bases.set(created.id, { payBasis: 'MONTHLY_FULL_TIME', employmentFraction: null });
      return created.id;
    }
    const borrower = await employee('BORROWER');
    const debtFree = await employee('DEBT-FREE');

    const obligation = (
      label: string,
      payeeCategory: string,
      incurredOn: string,
      scheduledAmount: string,
      effectiveFrom: string,
    ) =>
      admin.deductionObligation.create({
        data: {
          agencyId,
          employeeId: borrower,
          payeeCategory,
          payeeName: `Payee ${label}`,
          issuerReference: `${label}-${suffix}`,
          incurredOn: date(incurredOn),
          outstandingBalance: '50000',
          scheduledAmount,
          authorityDocumentVersionId: authority.id,
          payeeRuleVersionId: deductionsId,
          effectiveFrom: date(effectiveFrom),
          status: 'ACTIVE',
          recordedByMembershipId: membershipId,
        },
      });
    /** A change the obligations service would make: supersede, then a successor. */
    const change = (id: string, scheduledAmount: string, effectiveFrom: string) =>
      admin.$transaction(async (transaction) => {
        const current = await transaction.deductionObligation.update({
          where: { id },
          data: { status: 'SUPERSEDED' },
        });
        return transaction.deductionObligation.create({
          data: {
            agencyId,
            employeeId: current.employeeId,
            payeeCategory: current.payeeCategory,
            payeeName: current.payeeName,
            issuerReference: current.issuerReference,
            incurredOn: current.incurredOn,
            outstandingBalance: current.outstandingBalance,
            authorityDocumentVersionId: current.authorityDocumentVersionId,
            payeeRuleVersionId: current.payeeRuleVersionId,
            recordedByMembershipId: membershipId,
            scheduledAmount,
            effectiveFrom: date(effectiveFrom),
            status: 'ACTIVE',
            supersedesObligationId: id,
            changeReason: 'Issuer revised the schedule',
          },
        });
      });

    // GSIS ranks first, though incurred last.
    const gsis = await obligation('GSIS', 'GSIS', '2896-02-20', '500', '2896-01-01');
    // The cooperative's change takes effect inside March, so March deducts 3,000.
    const coopFirst = await obligation(
      'COOP',
      'EMPLOYEE_COOPERATIVE_OR_ASSOCIATION',
      '2896-01-10',
      '9000',
      '2896-01-01',
    );
    const coop = await change(coopFirst.id, '3000', '2896-03-15');
    // The insurer's change starts in April, so March deducts the 4,000 it replaces.
    const insurer = await obligation(
      'INSURER',
      'LICENSED_INSURER',
      '2896-03-01',
      '4000',
      '2896-03-01',
    );
    await change(insurer.id, '100', '2896-04-01');
    // Ended before the last day of March, so March deducts none of it.
    const ended = await obligation(
      'ENDED',
      'EMPLOYEE_COOPERATIVE_OR_ASSOCIATION',
      '2895-01-01',
      '700',
      '2896-01-01',
    );
    await admin.deductionObligation.update({
      where: { id: ended.id },
      data: {
        status: 'ENDED',
        effectiveTo: date('2896-03-20'),
        endReason: 'Paid in full',
        endedByMembershipId: membershipId,
        endedAt: new Date(),
      },
    });

    // The cutoff falls after the obligations above, by the database's clock.
    const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
    await tick();
    const [{ cutoffAt }] = await admin.$queryRaw<
      [{ cutoffAt: Date }]
    >`SELECT clock_timestamp() AS "cutoffAt"`;
    await tick();
    // Recorded after the cutoff, so March deducts neither the new obligation
    // nor the end of the GSIS one, though that end is dated inside March.
    await obligation(
      'AFTER-CUTOFF',
      'EMPLOYEE_COOPERATIVE_OR_ASSOCIATION',
      '2896-01-01',
      '800',
      '2896-01-01',
    );
    await admin.deductionObligation.update({
      where: { id: gsis.id },
      data: {
        status: 'ENDED',
        effectiveTo: date('2896-03-10'),
        endReason: 'Ended after the cutoff',
        endedByMembershipId: membershipId,
        endedAt: new Date(),
      },
    });

    const draft = await periods.create(preparer(tenant), {
      code: `LOAN-2896-03-${suffix}`,
      runType: 'REGULAR',
      periodFrom: '2896-03-01',
      periodTo: '2896-03-31',
      cutoffAt: cutoffAt.toISOString(),
      paymentDate: '2896-03-31',
    });
    const started = await periods.startCalculation(preparer(tenant), draft.id, {
      rowVersion: draft.rowVersion,
    });
    const job = {
      agencyId,
      payrollPeriodId: started.id,
      calculationVersion: started.calculationVersion,
    };
    // The floor's warning does not return the period.
    expect(await calculation.run(job)).toEqual({ outcome: 'FOR_REVIEW', results: 2 });

    const results = new Map(
      (
        await admin.payrollEmployee.findMany({
          where: { payrollPeriodId: job.payrollPeriodId, calculationVersion: 1 },
          include: { lines: true },
        })
      ).map((result) => [result.employeeId, result]),
    );
    // ₱10,000 less GSIS ₱500 and the cooperative's ₱3,000 leaves ₱6,500;
    // the insurer takes ₱1,500 of its ₱4,000, leaving net pay at the floor.
    const borrowed = results.get(borrower)!;
    expect(
      [borrowed.grossAmount, borrowed.totalDeductions, borrowed.netAmount].map(String),
    ).toEqual(['10000', '5000', '5000']);
    const loanComponent = await admin.payComponent.findUniqueOrThrow({
      where: { code: 'LOAN_DEDUCTION' },
    });
    expect(
      borrowed.lines
        .filter((line) => line.payComponentId === loanComponent.id)
        .map((line) => [line.lineType, line.ruleVersionId, String(line.amount)]),
    ).toEqual([
      ['DEDUCTION', deductionsId, '500'],
      ['DEDUCTION', deductionsId, '3000'],
      ['DEDUCTION', deductionsId, '1500'],
    ]);
    const loanLines = await admin.loanDeductionLine.findMany({
      where: { payrollEmployeeId: borrowed.id },
      orderBy: { priority: 'asc' },
    });
    expect(
      loanLines.map((row) => [
        row.deductionObligationId,
        row.priority,
        String(row.amountDue),
        String(row.deductedAmount),
        String(row.notDeductedAmount),
        row.ruleVersionId,
      ]),
    ).toEqual([
      [gsis.id, 1, '500', '500', '0', deductionsId],
      [coop.id, 2, '3000', '3000', '0', deductionsId],
      [insurer.id, 3, '4000', '1500', '2500', deductionsId],
    ]);
    const exceptions = await admin.payrollException.findMany({
      where: { payrollPeriodId: job.payrollPeriodId, employeeId: borrower },
    });
    expect(exceptions.map((exception) => [exception.exceptionType, exception.severity])).toEqual([
      ['NET_PAY_FLOOR_STOPPED_DEDUCTION', 'WARNING'],
    ]);
    expect(exceptions[0]!.details).toMatchObject({ notDeductedAmount: '2500.0000' });

    // An Employee with no obligation deducts nothing.
    const free = results.get(debtFree)!;
    expect(String(free.netAmount)).toBe('10000');
    await expect(
      admin.loanDeductionLine.count({ where: { payrollEmployeeId: free.id } }),
    ).resolves.toBe(0);

    // Loan deduction lines are isolated by Agency, immutable, and join only
    // their result's own transaction.
    const other = await createPayrollTenant(admin, suffix, 'LOAN-OTHER');
    tenants.push(other);
    await expect(
      withDatabaseContext({ agencyId: other.agency.id }, (transaction) =>
        transaction.loanDeductionLine.count({ where: { agencyId } }),
      ),
    ).resolves.toBe(0);
    await expect(
      admin.loanDeductionLine.update({
        where: { id: loanLines[0]!.id },
        data: { deductedAmount: '0', notDeductedAmount: '500' },
      }),
    ).rejects.toThrow();
    await expect(
      admin.loanDeductionLine.create({
        data: {
          agencyId,
          payrollEmployeeId: free.id,
          deductionObligationId: gsis.id,
          priority: 1,
          amountDue: '500',
          deductedAmount: '500',
          notDeductedAmount: '0',
          ruleVersionId: deductionsId,
        },
      }),
    ).rejects.toThrow(/joins its result only in the transaction/);
  });
});
