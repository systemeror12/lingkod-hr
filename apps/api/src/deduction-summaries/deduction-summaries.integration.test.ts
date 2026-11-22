import { createHash, randomUUID } from 'node:crypto';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import type { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cleanupPayrollTenants,
  cleanupPlatformFixtures,
  createAdminClient,
  createPayrollTenant,
  FIXTURE_PREFIX,
} from '../payroll-periods/payroll-periods.test-fixtures';
import type { PayrollTenant } from '../payroll-periods/payroll-periods.test-fixtures';
import { DEDUCTION_SUMMARIES_STATEMENT } from './deduction-summaries-contract';
import { DeductionSummariesService } from './deduction-summaries.service';

const enabled = process.env.DATABASE_E2E === 'true';

/** A Deduction Obligation applied in the period: [category, payee, due, deducted]. */
type LoanSpec = [string, string, string, string];

interface EmployeeSpec {
  number: string;
  /** [taxable, non-taxable, withholding tax]; none when the result has no Tax Line. */
  tax?: [string, string, string];
  loans?: LoanSpec[];
  /** Deduction Payroll Lines beyond the tax and loans, as [component code, amount]. */
  deductions?: [string, string][];
  /** A result of an earlier calculation version, whose lines no output may carry. */
  stale?: boolean;
}

const sha256 = (content: string) => createHash('sha256').update(content, 'utf8').digest('hex');

describe.skipIf(!enabled)('Deduction summaries in PostgreSQL', () => {
  const suffix = `${Date.now()}-deduction-summaries`;
  const service = new DeductionSummariesService();
  let admin: PrismaClient;
  let ruleVersionId: string;
  let contractVersionId: string;
  let components: Map<string, string>;
  const tenants: PayrollTenant[] = [];

  beforeAll(async () => {
    admin = await createAdminClient();
    const version = await admin.nationalPayrollRuleVersion.create({
      data: {
        ruleKind: 'COMPENSATION_WITHHOLDING_TAX',
        code: `${FIXTURE_PREFIX}TAX-${suffix}`,
        name: 'Test tax table',
        issuingAuthority: 'Test authority',
        issuanceReference: 'Test fixture, not an issuance',
        sourceUrl: 'https://example.test/tax',
        verifiedOn: new Date('2026-11-22'),
        verifiedBy: 'LingkodHR test fixture',
        effectiveFrom: new Date('2876-01-01'),
        effectiveTo: new Date('2876-12-31'),
      },
    });
    ruleVersionId = version.id;
    contractVersionId = (
      await admin.payrollExportContractVersion.findUniqueOrThrow({
        where: { code_version: { code: 'DEDUCTION_SUMMARIES', version: 1 } },
      })
    ).id;
    const catalogue = await admin.payComponent.findMany({
      where: {
        code: { in: ['BASIC_SALARY', 'GSIS_PERSONAL_SHARE', 'WITHHOLDING_TAX', 'LOAN_DEDUCTION'] },
      },
    });
    components = new Map(catalogue.map((component) => [component.code, component.id]));
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      for (const { agency } of tenants) {
        const where = { agencyId: agency.id };
        await transaction.deductionSummary.deleteMany({ where });
        await transaction.loanDeductionLine.deleteMany({ where });
        await transaction.deductionObligation.deleteMany({ where });
        await transaction.payrollLine.deleteMany({ where });
        await transaction.taxLine.deleteMany({ where });
        await transaction.payrollEmployee.deleteMany({ where });
        await transaction.employee.deleteMany({ where });
      }
    });
    await cleanupPayrollTenants(admin, tenants);
    await cleanupPlatformFixtures(admin, suffix);
    await admin.$disconnect();
  });

  /** Fixture rows written with triggers off, standing in for what finalization wrote. */
  const seed = <T>(run: (transaction: Prisma.TransactionClient) => Promise<T>) =>
    admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      return run(transaction);
    });

  /**
   * An Agency of its own with a REGULAR March 2876 period in `status` at
   * calculation version 2, one result per spec with its Tax Line, Loan
   * Deduction Lines, and Payroll Lines. Two people hold
   * `payroll.registers.generate`; a third holds only `payroll.periods.read`.
   */
  async function finalizedPayroll(label: string, specs: EmployeeSpec[], status = 'FINALIZED') {
    const tenant = await createPayrollTenant(admin, suffix, `DEDUCTION-${label}`, 3);
    tenants.push(tenant);
    const { agency, persons } = tenant;
    const membershipId = persons[0]!.membership.id;
    const as = (index: number, codes: string[]): RequestContext => ({
      ...persons[index]!.context,
      permissions: codes.map((code) => ({ code, scopePolicy: 'AGENCY' as const })),
    });
    const periodId = await seed(async (transaction) => {
      const period = await transaction.payrollPeriod.create({
        data: {
          agencyId: agency.id,
          code: `PAY-2876-03-${label}`,
          runType: 'REGULAR',
          periodFrom: new Date('2876-03-01'),
          periodTo: new Date('2876-03-31'),
          cutoffAt: new Date('2876-03-20T00:00:00Z'),
          paymentDate: new Date('2876-03-31'),
          status,
          calculationVersion: 2,
          finalizedAt: status === 'FINALIZED' ? new Date() : null,
        },
      });
      for (const spec of specs) {
        const employee = await transaction.employee.create({
          data: {
            agencyId: agency.id,
            employeeNumber: `${spec.number}-${label}`,
            legalName: `Member ${spec.number}`,
            birthDate: new Date('1990-01-01'),
            sex: 'FEMALE',
            civilStatus: 'SINGLE',
            contactEmail: `deduction-${label}-${spec.number}-${suffix}@example.test`.toLowerCase(),
            serviceStatus: 'ACTIVE',
            createdByMembershipId: membershipId,
            updatedByMembershipId: membershipId,
          },
        });
        const result = await transaction.payrollEmployee.create({
          data: {
            agencyId: agency.id,
            payrollPeriodId: period.id,
            calculationVersion: spec.stale ? 1 : 2,
            employeeId: employee.id,
            compensationBasisSnapshot: {},
            status: status === 'FINALIZED' && !spec.stale ? 'FINALIZED' : 'CALCULATED',
            grossAmount: '30000',
            totalDeductions: '0',
            netAmount: '30000',
            calculationHash: 'f'.repeat(64),
          },
        });
        const line = (code: string, lineType: string, amount: string) =>
          transaction.payrollLine.create({
            data: {
              agencyId: agency.id,
              payrollEmployeeId: result.id,
              payComponentId: components.get(code)!,
              lineType,
              amount,
              sourceSnapshot: {},
            },
          });
        // An earning, which the register never carries.
        await line('BASIC_SALARY', 'EARNING', '30000');
        if (spec.tax) {
          const [taxable, nonTaxable, withholdingTax] = spec.tax;
          await transaction.taxLine.create({
            data: {
              agencyId: agency.id,
              payrollEmployeeId: result.id,
              taxableCompensation: taxable,
              nonTaxableCompensation: nonTaxable,
              withholdingTax,
              ruleVersionId,
              yearToDateSnapshot: {},
            },
          });
          await line('WITHHOLDING_TAX', 'DEDUCTION', withholdingTax);
        }
        for (const [index, [category, payee, due, deducted]] of (spec.loans ?? []).entries()) {
          const obligation = await transaction.deductionObligation.create({
            data: {
              agencyId: agency.id,
              employeeId: employee.id,
              payeeCategory: category,
              payeeName: payee,
              issuerReference: `REF-${spec.number}-${index}`,
              incurredOn: new Date('2875-06-01'),
              outstandingBalance: '100000',
              scheduledAmount: due,
              authorityDocumentVersionId: randomUUID(),
              payeeRuleVersionId: ruleVersionId,
              effectiveFrom: new Date('2875-06-01'),
              status: 'ACTIVE',
              recordedByMembershipId: membershipId,
            },
          });
          await transaction.loanDeductionLine.create({
            data: {
              agencyId: agency.id,
              payrollEmployeeId: result.id,
              deductionObligationId: obligation.id,
              priority: index + 1,
              amountDue: due,
              deductedAmount: deducted,
              notDeductedAmount: (Number(due) - Number(deducted)).toFixed(4),
              ruleVersionId,
            },
          });
          if (Number(deducted) > 0) await line('LOAN_DEDUCTION', 'DEDUCTION', deducted);
        }
        for (const [code, amount] of spec.deductions ?? []) {
          await line(code, 'DEDUCTION', amount);
        }
      }
      return period.id;
    });
    return {
      tenant,
      periodId,
      preparer: as(0, ['payroll.registers.generate']),
      approver: as(1, ['payroll.registers.generate', 'payroll.periods.read']),
      reader: as(2, ['payroll.periods.read']),
    };
  }

  const summariesOf = (agencyId: string) => admin.deductionSummary.count({ where: { agencyId } });

  it('generates three artifacts whose totals equal their lines, and returns them again', async () => {
    const payroll = await finalizedPayroll('HAPPY', [
      {
        number: 'E-002',
        tax: ['20000', '2000', '1000.00'],
        loans: [['GSIS', 'GSIS', '1000', '1000']],
        deductions: [['GSIS_PERSONAL_SHARE', '1800.00']],
      },
      {
        number: 'E-001',
        tax: ['30000', '4000', '2500.50'],
        loans: [
          ['GSIS', 'gsis', '500', '500'],
          ['EMPLOYEE_COOPERATIVE_OR_ASSOCIATION', 'Kapwa Coop', '800', '300'],
          ['NATIONAL_GOVERNMENT_COA_DECISION', 'National Government', '750', '0'],
        ],
        deductions: [['GSIS_PERSONAL_SHARE', '2700.00']],
      },
      {
        number: 'E-003',
        stale: true,
        tax: ['99999', '0', '9999'],
        loans: [['GSIS', 'GSIS', '9999', '9999']],
      },
    ]);

    const generated = await service.generate(payroll.preparer, payroll.periodId);
    expect(generated).toMatchObject({
      payrollPeriodId: payroll.periodId,
      calculationVersion: 2,
      contract: { code: 'DEDUCTION_SUMMARIES', version: 1 },
      generatedByMembershipId: payroll.preparer.membershipId,
      taxSummary: {
        totals: {
          lineCount: 2,
          taxableCompensationTotal: '50000.0000',
          nonTaxableCompensationTotal: '6000.0000',
          withholdingTaxTotal: '3500.5000',
        },
      },
      loanRemittanceSummary: {
        totals: {
          lineCount: 4,
          amountDueTotal: '3050.0000',
          deductedTotal: '1800.0000',
          notDeductedTotal: '1250.0000',
        },
      },
      // Tax 3500.50, loans 1800, GSIS 4500: nothing of the stale result.
      deductionRegister: { totals: { lineCount: 7, amountTotal: '9800.5000' } },
    });
    for (const artifact of [
      generated.taxSummary,
      generated.loanRemittanceSummary,
      generated.deductionRegister,
    ]) {
      expect(sha256(artifact.content)).toBe(artifact.checksum);
      const parsed = JSON.parse(artifact.content) as { statement: string; totals: object };
      expect(parsed.statement).toBe(DEDUCTION_SUMMARIES_STATEMENT);
      expect(parsed.totals).toMatchObject(artifact.totals);
    }

    const loans = JSON.parse(generated.loanRemittanceSummary.content) as {
      payees: { payeeCategory: string; payeeName: string; totals: { deductedTotal: string } }[];
    };
    expect(
      loans.payees.map((payee) => [
        payee.payeeCategory,
        payee.payeeName,
        payee.totals.deductedTotal,
      ]),
    ).toEqual([
      ['EMPLOYEE_COOPERATIVE_OR_ASSOCIATION', 'Kapwa Coop', '300.0000'],
      ['GSIS', 'GSIS', '1500.0000'],
      ['NATIONAL_GOVERNMENT_COA_DECISION', 'National Government', '0.0000'],
    ]);

    // Generating again, by anyone permitted, returns the stored artifacts and writes nothing.
    const again = await service.generate(payroll.approver, payroll.periodId);
    expect(again).toEqual(generated);
    expect(await summariesOf(payroll.tenant.agency.id)).toBe(1);
    expect(await service.read(payroll.approver, payroll.periodId, generated.id)).toEqual(generated);

    const events = await admin.auditEvent.findMany({
      where: { agencyId: payroll.tenant.agency.id, entityId: generated.id },
      select: { action: true, actorMembershipId: true, metadata: true },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'DEDUCTION_SUMMARIES_GENERATED',
      actorMembershipId: payroll.preparer.membershipId,
      metadata: {
        payrollPeriodId: payroll.periodId,
        taxSummary: { checksum: generated.taxSummary.checksum },
        loanRemittanceSummary: { checksum: generated.loanRemittanceSummary.checksum },
        deductionRegister: { checksum: generated.deductionRegister.checksum },
      },
    });

    // The row never changes, even for the database owner.
    await expect(
      admin.deductionSummary.update({
        where: { id: generated.id },
        data: { calculationVersion: 1 },
      }),
    ).rejects.toThrow(/immutable/);
    await expect(
      admin.deductionSummary.deleteMany({ where: { id: generated.id } }),
    ).rejects.toThrow(/immutable/);
  });

  it('gives a payroll with no tax or deduction zero totals', async () => {
    const payroll = await finalizedPayroll('EMPTY', [{ number: 'E-001' }]);
    const generated = await service.generate(payroll.preparer, payroll.periodId);
    expect(generated.taxSummary.totals.lineCount).toBe(0);
    expect(generated.loanRemittanceSummary.totals.deductedTotal).toBe('0.0000');
    expect(generated.deductionRegister.totals).toEqual({ lineCount: 0, amountTotal: '0.0000' });
  });

  it('refuses a payroll that is not FINALIZED', async () => {
    const payroll = await finalizedPayroll(
      'APPROVED',
      [{ number: 'E-001', tax: ['100', '0', '10'] }],
      'APPROVED',
    );
    await expect(service.generate(payroll.preparer, payroll.periodId)).rejects.toMatchObject({
      statusCode: 409,
      code: 'DEDUCTION_SUMMARIES_PAYROLL_NOT_FINALIZED',
    });
    expect(await summariesOf(payroll.tenant.agency.id)).toBe(0);
  });

  it('needs payroll.registers.generate to generate or read', async () => {
    const payroll = await finalizedPayroll('FORBIDDEN', [{ number: 'E-001' }]);
    await expect(service.generate(payroll.reader, payroll.periodId)).rejects.toMatchObject({
      statusCode: 403,
      code: 'DEDUCTION_SUMMARIES_FORBIDDEN',
    });
    const generated = await service.generate(payroll.preparer, payroll.periodId);
    await expect(
      service.read(payroll.reader, payroll.periodId, generated.id),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.read(payroll.preparer, randomUUID(), generated.id)).rejects.toMatchObject({
      statusCode: 404,
      code: 'DEDUCTION_SUMMARY_NOT_FOUND',
    });
    await expect(service.generate(payroll.preparer, randomUUID())).rejects.toMatchObject({
      statusCode: 404,
      code: 'PAYROLL_PERIOD_NOT_FOUND',
    });
  });

  describe('database guard', () => {
    const content = '{}';
    const row = (
      payroll: Awaited<ReturnType<typeof finalizedPayroll>>,
      totals: Partial<Prisma.DeductionSummaryUncheckedCreateInput> = {},
    ): Prisma.DeductionSummaryUncheckedCreateInput => ({
      agencyId: payroll.tenant.agency.id,
      payrollPeriodId: payroll.periodId,
      calculationVersion: 2,
      payrollExportContractVersionId: contractVersionId,
      generatedByMembershipId: payroll.preparer.membershipId,
      generatedAt: new Date(),
      taxSummaryContent: content,
      taxSummaryChecksum: sha256(content),
      taxLineCount: 1,
      taxableCompensationTotal: '100',
      nonTaxableCompensationTotal: '0',
      withholdingTaxTotal: '10',
      loanRemittanceContent: content,
      loanRemittanceChecksum: sha256(content),
      loanLineCount: 1,
      loanAmountDueTotal: '200',
      loanDeductedTotal: '150',
      loanNotDeductedTotal: '50',
      deductionRegisterContent: content,
      deductionRegisterChecksum: sha256(content),
      deductionLineCount: 2,
      deductionTotal: '160',
      ...totals,
    });
    const insert = (
      payroll: Awaited<ReturnType<typeof finalizedPayroll>>,
      data: Prisma.DeductionSummaryUncheckedCreateInput,
    ) =>
      withDatabaseContext(payroll.tenant.persons[0]!.scope, (transaction) =>
        transaction.deductionSummary.create({ data }),
      );

    it('admits a row only when every total equals its source lines', async () => {
      const payroll = await finalizedPayroll('GUARD', [
        {
          number: 'E-001',
          tax: ['100', '0', '10'],
          loans: [['GSIS', 'GSIS', '200', '150']],
        },
      ]);
      await expect(insert(payroll, row(payroll, { withholdingTaxTotal: '10.01' }))).rejects.toThrow(
        /Tax Summary's totals equal the Tax Lines/,
      );
      await expect(
        insert(payroll, row(payroll, { loanDeductedTotal: '149', loanNotDeductedTotal: '51' })),
      ).rejects.toThrow(/Loan Remittance Summary's totals equal the Loan Deduction Lines/);
      await expect(insert(payroll, row(payroll, { deductionLineCount: 3 }))).rejects.toThrow(
        /Deduction Register's totals equal the DEDUCTION Payroll Lines/,
      );
      expect(await summariesOf(payroll.tenant.agency.id)).toBe(0);
      // The same row with the true totals is admitted.
      await insert(payroll, row(payroll));
      expect(await summariesOf(payroll.tenant.agency.id)).toBe(1);
    });
  });
});
