import { createHash, randomUUID } from 'node:crypto';
import type { RequestContext } from '@lingkod-hr/auth';
import { encryptProtectedValue, getConfig, parseProtectedValueKey } from '@lingkod-hr/config';
import { withDatabaseContext } from '@lingkod-hr/database';
import type { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cleanupPayrollTenants,
  createAdminClient,
  createPayrollTenant,
  type PayrollTenant,
} from '../payroll-periods/payroll-periods.test-fixtures';
import { PaymentExportsService } from './payment-exports.service';

const enabled = process.env.DATABASE_E2E === 'true';

/** One Employee of a seeded finalized payroll: their result and their bank accounts. */
interface EmployeeSpec {
  number: string;
  gross: string;
  deductions: string;
  net?: string;
  earningLines?: string;
  accounts?: {
    status: 'ACTIVE' | 'PENDING_VERIFICATION' | 'INACTIVE';
    accountNumber: string;
    effectiveFrom: string;
    effectiveTo?: string;
  }[];
}

describe.skipIf(!enabled)('Payment Export in PostgreSQL', () => {
  const suffix = `${Date.now()}-payment-export`;
  const service = new PaymentExportsService();
  const key = () => parseProtectedValueKey(getConfig().DATA_ENCRYPTION_KEY!);
  let admin: PrismaClient;
  let payComponentId: string;
  const tenants: PayrollTenant[] = [];

  beforeAll(async () => {
    admin = await createAdminClient();
    payComponentId = (await admin.payComponent.findFirstOrThrow({ select: { id: true } })).id;
  });

  afterAll(async () => {
    await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      for (const { agency } of tenants) {
        const where = { agencyId: agency.id };
        await transaction.paymentInstruction.deleteMany({ where });
        await transaction.paymentExport.deleteMany({ where });
        await transaction.payrollBankAccount.deleteMany({ where });
        await transaction.employee.deleteMany({ where });
      }
    });
    await cleanupPayrollTenants(admin, tenants);
    await admin.$disconnect();
  });

  /** Fixture rows written with triggers off, standing in for what finalization wrote. */
  const seed = <T>(run: (transaction: Prisma.TransactionClient) => Promise<T>) =>
    admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      return run(transaction);
    });

  /**
   * An Agency of its own with a REGULAR March 2874 period in `status` at
   * calculation version 1, and one result per spec with an earning line and a
   * deduction line. Two people hold `payroll.payment_exports.generate`; a third
   * holds only `payroll.periods.read`.
   */
  async function finalizedPayroll(label: string, specs: EmployeeSpec[], status = 'FINALIZED') {
    const tenant = await createPayrollTenant(admin, suffix, `PAYMENT-EXPORT-${label}`, 3);
    tenants.push(tenant);
    const { agency, persons } = tenant;
    const membershipId = persons[0]!.membership.id;
    const as = (index: number, codes: string[]): RequestContext => ({
      ...persons[index]!.context,
      permissions: codes.map((code) => ({ code, scopePolicy: 'AGENCY' as const })),
    });
    const ids = await seed(async (transaction) => {
      const period = await transaction.payrollPeriod.create({
        data: {
          agencyId: agency.id,
          code: `PAY-2874-03-${label}`,
          runType: 'REGULAR',
          periodFrom: new Date('2874-03-01'),
          periodTo: new Date('2874-03-31'),
          cutoffAt: new Date('2874-03-20T00:00:00Z'),
          paymentDate: new Date('2874-03-31'),
          status,
          calculationVersion: 1,
          finalizedAt: status === 'FINALIZED' ? new Date() : null,
        },
      });
      const employees: Record<string, { employeeId: string; resultId: string }> = {};
      for (const spec of specs) {
        const employee = await transaction.employee.create({
          data: {
            agencyId: agency.id,
            employeeNumber: `${spec.number}-${label}`,
            legalName: `Payee ${spec.number}`,
            birthDate: new Date('1990-01-01'),
            sex: 'FEMALE',
            civilStatus: 'SINGLE',
            contactEmail:
              `payment-export-${label}-${spec.number}-${suffix}@example.test`.toLowerCase(),
            serviceStatus: 'ACTIVE',
            createdByMembershipId: membershipId,
            updatedByMembershipId: membershipId,
          },
        });
        const net = spec.net ?? (Number(spec.gross) - Number(spec.deductions)).toFixed(4);
        const result = await transaction.payrollEmployee.create({
          data: {
            agencyId: agency.id,
            payrollPeriodId: period.id,
            calculationVersion: 1,
            employeeId: employee.id,
            compensationBasisSnapshot: {},
            status: status === 'FINALIZED' ? 'FINALIZED' : 'CALCULATED',
            grossAmount: spec.gross,
            totalDeductions: spec.deductions,
            netAmount: net,
            calculationHash: 'f'.repeat(64),
          },
        });
        for (const [lineType, amount] of [
          ['EARNING', spec.earningLines ?? spec.gross],
          ['DEDUCTION', spec.deductions],
        ] as const) {
          await transaction.payrollLine.create({
            data: {
              agencyId: agency.id,
              payrollEmployeeId: result.id,
              payComponentId,
              lineType,
              amount,
              sourceSnapshot: {},
            },
          });
        }
        for (const [index, destination] of (spec.accounts ?? []).entries()) {
          const bankCode = 'LBP';
          const sealed = encryptProtectedValue(destination.accountNumber, key(), {
            metadata: JSON.stringify({
              purpose: 'PAYROLL_BANK_ACCOUNT',
              employeeId: employee.id,
              bankCode,
            }),
          });
          const verified = destination.status !== 'PENDING_VERIFICATION';
          await transaction.payrollBankAccount.create({
            data: {
              agencyId: agency.id,
              employeeId: employee.id,
              bankCode,
              accountName: `Holder ${spec.number} ${index}`,
              encryptedAccountNumber: new Uint8Array(sealed.envelope),
              maskedAccountNumber: sealed.maskedValue,
              verificationState: verified ? 'VERIFIED' : 'PENDING',
              verifiedAt: verified ? new Date('2000-01-01T00:00:00Z') : null,
              status: destination.status,
              effectiveFrom: new Date(destination.effectiveFrom),
              effectiveTo: destination.effectiveTo ? new Date(destination.effectiveTo) : null,
              reason: verified ? 'Verified test fixture' : null,
              createdByMembershipId: membershipId,
              updatedByMembershipId: membershipId,
            },
          });
        }
        employees[spec.number] = { employeeId: employee.id, resultId: result.id };
      }
      return { periodId: period.id, employees };
    });
    return {
      tenant,
      ...ids,
      cashier: as(0, ['payroll.payment_exports.generate']),
      approver: as(1, ['payroll.payment_exports.generate', 'payroll.periods.read']),
      reader: as(2, ['payroll.periods.read']),
    };
  }

  const active = (accountNumber: string) => ({
    status: 'ACTIVE' as const,
    accountNumber,
    effectiveFrom: '2000-01-01',
  });

  const exportsOf = (agencyId: string) => admin.paymentExport.count({ where: { agencyId } });

  it('generates one instruction per positive net, counts the rest, and returns the same artifact again', async () => {
    const payroll = await finalizedPayroll('HAPPY', [
      {
        number: 'E-001',
        gross: '30000.00',
        deductions: '4500.25',
        accounts: [active('0001234567')],
      },
      {
        number: 'E-002',
        gross: '20000.00',
        deductions: '0',
        accounts: [
          {
            status: 'INACTIVE',
            accountNumber: '9999000011',
            effectiveFrom: '2000-01-01',
            effectiveTo: '2009-12-31',
          },
          active('0099887766'),
        ],
      },
      { number: 'E-003', gross: '1000.00', deductions: '1000.00' },
    ]);

    const generated = await service.generate(payroll.cashier, payroll.periodId);
    expect(generated).toMatchObject({
      payrollPeriodId: payroll.periodId,
      calculationVersion: 1,
      paymentDate: '2874-03-31',
      contract: { code: 'PAYMENT_EXPORT', version: 1 },
      currency: 'PHP',
      generatedByMembershipId: payroll.cashier.membershipId,
      controls: {
        sourceResultCount: 3,
        sourceNetTotal: '45499.75',
        instructionCount: 2,
        instructionTotal: '45499.75',
        excludedResultCount: 1,
        excludedResultTotal: '0.00',
      },
    });
    expect(
      generated.instructions.map((instruction) => [
        instruction.agencyEmployeeNumber,
        instruction.amount,
        instruction.maskedAccountIdentifier,
        instruction.accountHolderName,
      ]),
    ).toEqual([
      ['E-001-HAPPY', '25499.75', '******4567', 'Holder E-001 0'],
      ['E-002-HAPPY', '20000.00', '******7766', 'Holder E-002 1'],
    ]);
    expect(JSON.stringify(generated)).not.toContain('0001234567');

    // Generating again, by anyone permitted, returns the stored artifact and writes nothing.
    const again = await service.generate(payroll.approver, payroll.periodId);
    expect(again).toEqual(generated);
    expect(await exportsOf(payroll.tenant.agency.id)).toBe(1);

    const csv = await service.downloadCsv(payroll.cashier, payroll.periodId, generated.id);
    expect(csv.checksum).toBe(generated.checksum);
    expect(createHash('sha256').update(csv.content, 'utf8').digest('hex')).toBe(generated.checksum);
    expect(csv.contentType).toBe('text/csv; charset=utf-8');
    expect(csv.content).toContain('"0001234567"');
    expect(csv.content).toContain('"0099887766"');
    expect(csv.content).not.toContain('9999000011');
    expect(csv.content.split('\r\n')).toHaveLength(4);
    expect(
      (await service.downloadCsv(payroll.approver, payroll.periodId, generated.id)).content,
    ).toBe(csv.content);

    const summary = await service.downloadSummary(payroll.approver, payroll.periodId, generated.id);
    expect(createHash('sha256').update(summary.content, 'utf8').digest('hex')).toBe(
      generated.summaryChecksum,
    );
    expect(summary.content).toContain(`CSV SHA-256: ${generated.checksum}`);
    expect(summary.content).toContain('******4567');
    expect(summary.content).not.toContain('0001234567');
    expect(summary.content).toContain('E-003-HAPPY | Payee E-003 | 0.00');

    const events = await admin.auditEvent.findMany({
      where: { agencyId: payroll.tenant.agency.id, entityId: generated.id },
      orderBy: { occurredAt: 'asc' },
      select: { action: true, actorMembershipId: true, metadata: true },
    });
    expect(events.map((event) => event.action)).toEqual([
      'PAYMENT_EXPORT_GENERATED',
      'PAYMENT_EXPORT_DOWNLOADED',
      'PAYMENT_EXPORT_DOWNLOADED',
      'PAYMENT_EXPORT_DOWNLOADED',
    ]);
    expect(
      events.slice(1).map((event) => (event.metadata as { artifact: string }).artifact),
    ).toEqual(['CSV', 'CSV', 'SUMMARY']);

    // The export and its instructions never change, even for the database owner.
    await expect(
      admin.paymentExport.update({ where: { id: generated.id }, data: { currency: 'USD' } }),
    ).rejects.toThrow(/immutable/);
    await expect(
      admin.paymentInstruction.deleteMany({ where: { paymentExportId: generated.id } }),
    ).rejects.toThrow(/immutable/);
  });

  it('blocks the whole export for a missing, ineffective, or unverified destination', async () => {
    const payroll = await finalizedPayroll('BLOCKED', [
      { number: 'E-001', gross: '100.00', deductions: '0', accounts: [active('1111222233')] },
      { number: 'E-002', gross: '100.00', deductions: '0' },
      {
        number: 'E-003',
        gross: '100.00',
        deductions: '0',
        accounts: [{ status: 'ACTIVE', accountNumber: '3333444455', effectiveFrom: '2999-01-01' }],
      },
      {
        number: 'E-004',
        gross: '100.00',
        deductions: '0',
        accounts: [
          {
            status: 'PENDING_VERIFICATION',
            accountNumber: '5555666677',
            effectiveFrom: '2000-01-01',
          },
        ],
      },
    ]);
    await expect(service.generate(payroll.cashier, payroll.periodId)).rejects.toMatchObject({
      statusCode: 409,
      code: 'PAYMENT_EXPORT_DESTINATION_BLOCKED',
      message:
        'The Payment Export is blocked: no Payroll Bank Account for E-002-BLOCKED; no Payroll Bank Account effective today for E-003-BLOCKED; an unverified Payroll Bank Account for E-004-BLOCKED. Nothing was generated.',
    });
    expect(await exportsOf(payroll.tenant.agency.id)).toBe(0);
  });

  it.each([
    ['missing', 'MISSING', undefined],
    [
      'ended',
      'ENDED',
      [
        {
          status: 'ACTIVE' as const,
          accountNumber: '1234567890',
          effectiveFrom: '2000-01-01',
          effectiveTo: '2001-01-01',
        },
      ],
    ],
    [
      'unverified',
      'UNVERIFIED',
      [
        {
          status: 'PENDING_VERIFICATION' as const,
          accountNumber: '1234567890',
          effectiveFrom: '2000-01-01',
        },
      ],
    ],
  ])('blocks on a single %s destination', async (_name, label, accounts) => {
    const payroll = await finalizedPayroll(label, [
      { number: 'E-001', gross: '500.00', deductions: '0', ...(accounts && { accounts }) },
    ]);
    await expect(service.generate(payroll.cashier, payroll.periodId)).rejects.toMatchObject({
      code: 'PAYMENT_EXPORT_DESTINATION_BLOCKED',
    });
    expect(await exportsOf(payroll.tenant.agency.id)).toBe(0);
  });

  it('blocks on a result whose totals do not reconcile with its lines', async () => {
    const payroll = await finalizedPayroll('MISMATCH', [
      { number: 'E-001', gross: '100.00', deductions: '0', accounts: [active('1111222233')] },
      {
        number: 'E-002',
        gross: '100.00',
        deductions: '0',
        earningLines: '99.00',
        accounts: [active('2222333344')],
      },
    ]);
    await expect(service.generate(payroll.cashier, payroll.periodId)).rejects.toMatchObject({
      statusCode: 409,
      code: 'PAYMENT_EXPORT_RECONCILIATION_FAILED',
      message: expect.stringContaining('E-002-MISMATCH'),
    });
    expect(await exportsOf(payroll.tenant.agency.id)).toBe(0);
  });

  it('blocks on a net pay that is not whole centavos', async () => {
    const payroll = await finalizedPayroll('CENTAVO', [
      {
        number: 'E-001',
        gross: '100.0050',
        deductions: '0',
        accounts: [active('1111222233')],
      },
    ]);
    await expect(service.generate(payroll.cashier, payroll.periodId)).rejects.toMatchObject({
      code: 'PAYMENT_EXPORT_RECONCILIATION_FAILED',
    });
    expect(await exportsOf(payroll.tenant.agency.id)).toBe(0);
  });

  it('refuses a payroll that is not FINALIZED', async () => {
    const payroll = await finalizedPayroll(
      'APPROVED',
      [{ number: 'E-001', gross: '100.00', deductions: '0', accounts: [active('1111222233')] }],
      'APPROVED',
    );
    await expect(service.generate(payroll.cashier, payroll.periodId)).rejects.toMatchObject({
      statusCode: 409,
      code: 'PAYMENT_EXPORT_PAYROLL_NOT_FINALIZED',
    });
    expect(await exportsOf(payroll.tenant.agency.id)).toBe(0);
  });

  it('needs payroll.payment_exports.generate to generate or download', async () => {
    const payroll = await finalizedPayroll('FORBIDDEN', [
      { number: 'E-001', gross: '100.00', deductions: '0', accounts: [active('1111222233')] },
    ]);
    await expect(service.generate(payroll.reader, payroll.periodId)).rejects.toMatchObject({
      statusCode: 403,
      code: 'PAYMENT_EXPORT_FORBIDDEN',
    });
    const generated = await service.generate(payroll.cashier, payroll.periodId);
    await expect(
      service.downloadCsv(payroll.reader, payroll.periodId, generated.id),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      service.downloadSummary(payroll.reader, payroll.periodId, generated.id),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      service.downloadCsv(payroll.cashier, randomUUID(), generated.id),
    ).rejects.toMatchObject({ statusCode: 404, code: 'PAYMENT_EXPORT_NOT_FOUND' });
  });

  it('admits an instruction only for its new export, paying the result its net', async () => {
    const payroll = await finalizedPayroll('GUARD', [
      { number: 'E-001', gross: '100.00', deductions: '0', accounts: [active('1111222233')] },
    ]);
    const generated = await service.generate(payroll.cashier, payroll.periodId);
    const { persons } = payroll.tenant;
    const account = await admin.payrollBankAccount.findFirstOrThrow({
      where: { agencyId: payroll.tenant.agency.id },
      select: { id: true },
    });
    await expect(
      withDatabaseContext(persons[0]!.scope, (transaction) =>
        transaction.paymentInstruction.create({
          data: {
            agencyId: payroll.tenant.agency.id,
            paymentExportId: generated.id,
            payrollEmployeeId: payroll.employees['E-001']!.resultId,
            payrollBankAccountId: account.id,
            agencyEmployeeNumber: 'E-001-GUARD',
            payeeLegalName: 'Payee E-001',
            destinationType: 'BANK_ACCOUNT',
            institutionIdentifierScheme: 'AGENCY_BANK_CODE',
            institutionIdentifier: 'LBP',
            institutionName: 'LBP',
            maskedAccountIdentifier: '******2233',
            accountHolderName: 'Holder',
            amount: '100.00',
            paymentReference: 'again',
          },
        }),
      ),
    ).rejects.toThrow(/Payment Instruction pays a FINALIZED result of its new export/);
  });
});
