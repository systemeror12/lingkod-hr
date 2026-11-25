import { createHash, randomUUID } from 'node:crypto';
import type { RequestContext } from '@lingkod-hr/auth';
import { encryptProtectedValue, getConfig, parseProtectedValueKey } from '@lingkod-hr/config';
import { withDatabaseContext } from '@lingkod-hr/database';
import type { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DocumentsService } from '../documents/documents.service';
import {
  cleanupPayrollTenants,
  createAdminClient,
  createPayrollTenant,
  type PayrollTenant,
} from '../payroll-periods/payroll-periods.test-fixtures';
import {
  DisbursementOutcomesService,
  instructionsBlockingVoid,
  type DisbursementOutcomeKind,
} from './disbursement-outcomes.service';
import { PaymentExportsService, type PaymentExportView } from './payment-exports.service';

const enabled = process.env.DATABASE_E2E === 'true';

describe.skipIf(!enabled)('Payment Export retries in PostgreSQL', () => {
  const suffix = `${Date.now()}-retry`;
  const exports = new PaymentExportsService();
  const outcomes = new DisbursementOutcomesService(new DocumentsService({} as never, {} as never));
  const key = () => parseProtectedValueKey(getConfig().DATA_ENCRYPTION_KEY!);
  let admin: PrismaClient;
  let payComponentId: string;
  const tenants: PayrollTenant[] = [];

  beforeAll(async () => {
    admin = await createAdminClient();
    payComponentId = (await admin.payComponent.findFirstOrThrow({ select: { id: true } })).id;
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      const where = { agencyId: { in: tenants.map(({ agency }) => agency.id) } };
      await transaction.disbursementOutcome.deleteMany({ where });
      await transaction.paymentInstruction.deleteMany({ where });
      await transaction.paymentExport.deleteMany({ where });
      await transaction.payrollBankAccount.deleteMany({ where });
      await transaction.employee.deleteMany({ where });
    });
    await cleanupPayrollTenants(admin, tenants);
    await admin.$disconnect();
  });

  /** Fixture rows written with triggers off, standing in for what other commands wrote. */
  const seed = <T>(run: (transaction: Prisma.TransactionClient) => Promise<T>) =>
    admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      return run(transaction);
    });

  const sealed = (accountNumber: string, employeeId: string) =>
    encryptProtectedValue(accountNumber, key(), {
      metadata: JSON.stringify({ purpose: 'PAYROLL_BANK_ACCOUNT', employeeId, bankCode: 'LBP' }),
    });

  /**
   * An Agency of its own with a FINALIZED March 2876 payroll of `employees`
   * results, each paying 1,000.00 to a verified account, and its Payment
   * Export. Person 0 is the Cashier, who also generates and retries; person 1
   * holds only `payroll.periods.read`.
   */
  async function exportedPayroll(label: string, employees = 1) {
    const tenant = await createPayrollTenant(admin, suffix, `RETRY-${label}`, 2);
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
          status: 'FINALIZED',
          calculationVersion: 1,
          finalizedAt: new Date(),
        },
      });
      for (let index = 1; index <= employees; index += 1) {
        const number = `E-${String(index).padStart(3, '0')}-${label}`;
        const employee = await transaction.employee.create({
          data: {
            agencyId: agency.id,
            employeeNumber: number,
            legalName: `Payee ${number}`,
            birthDate: new Date('1990-01-01'),
            sex: 'FEMALE',
            civilStatus: 'SINGLE',
            contactEmail: `retry-${number}-${suffix}@example.test`.toLowerCase(),
            serviceStatus: 'ACTIVE',
            createdByMembershipId: membershipId,
            updatedByMembershipId: membershipId,
          },
        });
        const result = await transaction.payrollEmployee.create({
          data: {
            agencyId: agency.id,
            payrollPeriodId: period.id,
            calculationVersion: 1,
            employeeId: employee.id,
            compensationBasisSnapshot: {},
            status: 'FINALIZED',
            grossAmount: '1000.00',
            totalDeductions: '0',
            netAmount: '1000.00',
            calculationHash: 'f'.repeat(64),
          },
        });
        for (const [lineType, amount] of [
          ['EARNING', '1000.00'],
          ['DEDUCTION', '0'],
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
        const account = sealed(`00${index}0000001`, employee.id);
        await transaction.payrollBankAccount.create({
          data: {
            agencyId: agency.id,
            employeeId: employee.id,
            bankCode: 'LBP',
            accountName: `Holder ${number}`,
            encryptedAccountNumber: new Uint8Array(account.envelope),
            maskedAccountNumber: account.maskedValue,
            verificationState: 'VERIFIED',
            verifiedAt: new Date('2000-01-01T00:00:00Z'),
            status: 'ACTIVE',
            effectiveFrom: new Date('2000-01-01'),
            reason: 'Verified test fixture',
            createdByMembershipId: membershipId,
            updatedByMembershipId: membershipId,
          },
        });
      }
      return period.id;
    });
    const cashier = as(0, ['payroll.payment_exports.generate', 'payroll.disbursement.update']);
    const generated = await exports.generate(cashier, periodId);
    return { tenant, periodId, generated, cashier, reader: as(1, ['payroll.periods.read']) };
  }

  type Payroll = Awaited<ReturnType<typeof exportedPayroll>>;

  /** Record the instruction's outcomes in order, after the ones it already has. */
  async function recordOutcomes(
    payroll: Payroll,
    paymentExport: PaymentExportView,
    instructionId: string,
    kinds: DisbursementOutcomeKind[],
  ) {
    const recorded = await admin.disbursementOutcome.count({
      where: { paymentInstructionId: instructionId },
    });
    for (const [index, outcome] of kinds.entries()) {
      await outcomes.record(
        payroll.cashier,
        { periodId: payroll.periodId, exportId: paymentExport.id, instructionId },
        {
          outcome,
          sequence: recorded + index + 1,
          ...(['REJECTED', 'RETURNED'].includes(outcome) && { reason: `${outcome} by the bank` }),
        },
      );
    }
  }

  /**
   * Correct the Employee's destination: the account the instruction used
   * becomes CORRECTED and a verified successor with `accountNumber` is ACTIVE.
   */
  async function correctDestination(
    payroll: Payroll,
    instruction: { payrollEmployeeId: string; payrollBankAccountId: string },
    accountNumber: string,
  ) {
    const { employeeId } = await admin.payrollEmployee.findUniqueOrThrow({
      where: { id: instruction.payrollEmployeeId },
      select: { employeeId: true },
    });
    const membershipId = payroll.cashier.membershipId;
    const account = sealed(accountNumber, employeeId);
    return seed(async (transaction) => {
      await transaction.payrollBankAccount.update({
        where: { id: instruction.payrollBankAccountId },
        data: { status: 'CORRECTED' },
      });
      return transaction.payrollBankAccount.create({
        data: {
          agencyId: payroll.tenant.agency.id,
          employeeId,
          bankCode: 'LBP',
          accountName: 'Corrected holder',
          encryptedAccountNumber: new Uint8Array(account.envelope),
          maskedAccountNumber: account.maskedValue,
          verificationState: 'VERIFIED',
          verifiedAt: new Date('2000-01-01T00:00:00Z'),
          status: 'ACTIVE',
          effectiveFrom: new Date('2000-01-01'),
          reason: 'Corrected after a rejected payment',
          predecessorAccountId: instruction.payrollBankAccountId,
          transitionKind: 'CORRECTION',
          createdByMembershipId: membershipId,
          updatedByMembershipId: membershipId,
        },
      });
    });
  }

  const retry = (
    payroll: Payroll,
    paymentExport: PaymentExportView,
    instructionId: string,
    input: unknown = { reason: 'Destination corrected after the bank rejected it' },
    context = payroll.cashier,
  ) =>
    exports.retry(
      context,
      { periodId: payroll.periodId, exportId: paymentExport.id, instructionId },
      input,
    );

  const exportsOf = (payroll: Payroll) =>
    admin.paymentExport.count({ where: { agencyId: payroll.tenant.agency.id } });

  it('retries a REJECTED instruction to its corrected destination, then retries the RETURNED retry', async () => {
    const payroll = await exportedPayroll('CHAIN', 2);
    const original = payroll.generated;
    const [first, second] = original.instructions as [
      PaymentExportView['instructions'][number],
      PaymentExportView['instructions'][number],
    ];
    await recordOutcomes(payroll, original, first.id, ['SUBMITTED', 'REJECTED']);
    await recordOutcomes(payroll, original, second.id, ['SUBMITTED', 'SETTLED']);
    const corrected = await correctDestination(payroll, first, '0099000111');

    const retried = await retry(payroll, original, first.id, {
      reason: 'Account closed; the Employee gave a corrected account',
    });
    expect(retried).toMatchObject({
      payrollPeriodId: payroll.periodId,
      supersedesPaymentExportId: original.id,
      calculationVersion: 1,
      contract: { code: 'PAYMENT_EXPORT', version: 1 },
      controls: {
        sourceResultCount: 1,
        sourceNetTotal: '1000.00',
        instructionCount: 1,
        instructionTotal: '1000.00',
        excludedResultCount: 0,
        excludedResultTotal: '0.00',
      },
    });
    expect(retried.instructions).toHaveLength(1);
    expect(retried.instructions[0]).toEqual({
      ...first,
      id: retried.instructions[0]!.id,
      priorPaymentInstructionId: first.id,
      retryReason: 'Account closed; the Employee gave a corrected account',
      payrollBankAccountId: corrected.id,
      maskedAccountIdentifier: corrected.maskedAccountNumber,
      accountHolderName: 'Corrected holder',
    });
    expect(retried.instructions[0]!.id).not.toBe(first.id);

    // The original is never changed or resent: generating returns it as it was.
    expect(await exports.generate(payroll.cashier, payroll.periodId)).toEqual(original);
    const originalCsv = await exports.downloadCsv(payroll.cashier, payroll.periodId, original.id);
    expect(originalCsv.checksum).toBe(original.checksum);

    const csv = await exports.downloadCsv(payroll.cashier, payroll.periodId, retried.id);
    expect(createHash('sha256').update(csv.content, 'utf8').digest('hex')).toBe(retried.checksum);
    expect(csv.content.split('\r\n')).toHaveLength(3);
    expect(csv.content).toContain('"0099000111"');
    expect(csv.content).not.toContain('0010000001');
    const summary = await exports.downloadSummary(payroll.cashier, payroll.periodId, retried.id);
    expect(summary.content).toContain(`Supersedes Payment Export: ${original.id}`);
    expect(summary.content).toContain(`Retry of Payment Instruction: ${first.id}`);
    expect(summary.content).not.toContain('0099000111');

    const [event] = await admin.auditEvent.findMany({
      where: { agencyId: payroll.tenant.agency.id, entityId: retried.id },
      orderBy: { occurredAt: 'asc' },
      take: 1,
      select: { action: true, entityType: true, reason: true, metadata: true },
    });
    expect(event).toMatchObject({
      action: 'PAYMENT_EXPORT_RETRY_GENERATED',
      entityType: 'PaymentExport',
      reason: 'Account closed; the Employee gave a corrected account',
      metadata: {
        supersedesPaymentExportId: original.id,
        priorPaymentInstructionId: first.id,
        priorOutcome: 'REJECTED',
        paymentInstructionId: retried.instructions[0]!.id,
      },
    });

    // An attempt is retried once; the retry is the attempt that can be retried next.
    await expect(retry(payroll, original, first.id)).rejects.toMatchObject({
      statusCode: 409,
      code: 'PAYMENT_INSTRUCTION_ALREADY_RETRIED',
    });
    const retryInstruction = retried.instructions[0]!;
    await recordOutcomes(payroll, retried, retryInstruction.id, ['SUBMITTED']);
    expect(
      (
        await withDatabaseContext(payroll.tenant.persons[0]!.scope, (transaction) =>
          instructionsBlockingVoid(transaction, {
            agencyId: payroll.tenant.agency.id,
            payrollPeriodId: payroll.periodId,
          }),
        )
      ).map((row) => row.paymentInstructionId),
    ).toContain(retryInstruction.id);
    await recordOutcomes(payroll, retried, retryInstruction.id, ['ACCEPTED', 'RETURNED']);
    await correctDestination(payroll, retryInstruction, '0099000222');
    const again = await retry(payroll, retried, retryInstruction.id, {
      reason: 'Credit returned; second correction',
    });
    expect(again.supersedesPaymentExportId).toBe(retried.id);
    expect(again.instructions[0]).toMatchObject({
      priorPaymentInstructionId: retryInstruction.id,
      payrollEmployeeId: first.payrollEmployeeId,
      amount: '1000.00',
      paymentReference: first.paymentReference,
    });
    expect(await exportsOf(payroll)).toBe(3);
  });

  it('refuses a new handoff unless the latest outcome is REJECTED or RETURNED and the destination is corrected', async () => {
    const payroll = await exportedPayroll('REFUSED');
    const original = payroll.generated;
    const [instruction] = original.instructions as [PaymentExportView['instructions'][number]];
    const notRetryable = (latest: string) => ({
      statusCode: 409,
      code: 'PAYMENT_INSTRUCTION_NOT_RETRYABLE',
      message: `This Payment Instruction's latest Disbursement Outcome is ${latest}; it is handed off again only after it is REJECTED or RETURNED.`,
    });

    await expect(retry(payroll, original, instruction.id)).rejects.toMatchObject({
      statusCode: 409,
      code: 'PAYMENT_INSTRUCTION_NOT_RETRYABLE',
      message:
        'This Payment Instruction has no Disbursement Outcome yet; it is handed off again only after it is REJECTED or RETURNED.',
    });
    for (const outcome of ['SUBMITTED', 'ACCEPTED', 'SETTLED'] as const) {
      await recordOutcomes(payroll, original, instruction.id, [outcome]);
      await expect(retry(payroll, original, instruction.id)).rejects.toMatchObject(
        notRetryable(outcome),
      );
    }

    // REJECTED, but the destination was never corrected.
    await recordOutcomes(payroll, original, instruction.id, ['REJECTED']);
    await expect(retry(payroll, original, instruction.id)).rejects.toMatchObject({
      statusCode: 409,
      code: 'PAYMENT_RETRY_DESTINATION_UNCHANGED',
    });
    await correctDestination(payroll, instruction, '0099000333');

    // The retry needs a reason, and never changes the payee or amount.
    await expect(retry(payroll, original, instruction.id, {})).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_INPUT',
      message: 'reason: A retry needs a reason.',
    });
    await expect(retry(payroll, original, instruction.id, { reason: '  ' })).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_INPUT',
    });
    await expect(
      retry(payroll, original, instruction.id, { reason: 'Wrong amount', amount: '1200.00' }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'PAYMENT_RETRY_CHANGES_PAYEE_OR_AMOUNT',
      message:
        "A retry resends its prior attempt's payee and amount to a corrected destination, so it cannot set amount. A payee or amount change is a Payroll Adjustment against the finalized payroll (ADR 0016); nothing was generated.",
    });
    await expect(
      retry(payroll, original, instruction.id, { reason: 'Heir', payeeLegalName: 'Someone Else' }),
    ).rejects.toMatchObject({ code: 'PAYMENT_RETRY_CHANGES_PAYEE_OR_AMOUNT' });

    await expect(
      retry(payroll, original, instruction.id, undefined, payroll.reader),
    ).rejects.toMatchObject({ statusCode: 403, code: 'PAYMENT_EXPORT_FORBIDDEN' });
    const other = await exportedPayroll('REFUSED-OTHER');
    await expect(
      retry(payroll, original, instruction.id, undefined, other.cashier),
    ).rejects.toMatchObject({ statusCode: 404, code: 'PAYROLL_PERIOD_NOT_FOUND' });
    expect(await exportsOf(payroll)).toBe(1);

    // The database refuses a retry that changes the payee, even when the service is bypassed.
    const corrected = await admin.payrollBankAccount.findFirstOrThrow({
      where: { predecessorAccountId: instruction.payrollBankAccountId },
      select: { id: true },
    });
    const stored = await admin.paymentExport.findUniqueOrThrow({ where: { id: original.id } });
    await expect(
      withDatabaseContext(payroll.tenant.persons[0]!.scope, async (transaction) => {
        const forged = await transaction.paymentExport.create({
          data: {
            ...stored,
            id: randomUUID(),
            generatedAt: new Date(),
            supersedesPaymentExportId: original.id,
          },
        });
        await transaction.paymentInstruction.create({
          data: {
            agencyId: payroll.tenant.agency.id,
            paymentExportId: forged.id,
            payrollEmployeeId: instruction.payrollEmployeeId,
            payrollBankAccountId: corrected.id,
            agencyEmployeeNumber: instruction.agencyEmployeeNumber,
            payeeLegalName: 'Someone Else',
            destinationType: 'BANK_ACCOUNT',
            institutionIdentifierScheme: 'AGENCY_BANK_CODE',
            institutionIdentifier: 'LBP',
            institutionName: 'LBP',
            maskedAccountIdentifier: '******0333',
            accountHolderName: 'Someone Else',
            amount: instruction.amount,
            paymentReference: instruction.paymentReference,
            priorPaymentInstructionId: instruction.id,
            retryReason: 'Forged payee change',
          },
        });
      }),
    ).rejects.toThrow(/same payee and amount, to a corrected destination/);
    expect(await exportsOf(payroll)).toBe(1);

    // Corrected and REJECTED: the retry now goes through.
    await expect(retry(payroll, original, instruction.id)).resolves.toMatchObject({
      supersedesPaymentExportId: original.id,
    });
  });

  it('orders two retries at once: of one attempt, one lands; of two attempts, both land', async () => {
    const payroll = await exportedPayroll('RACE', 3);
    const original = payroll.generated;
    const [first, second, third] = original.instructions as [
      PaymentExportView['instructions'][number],
      PaymentExportView['instructions'][number],
      PaymentExportView['instructions'][number],
    ];
    for (const [index, instruction] of [first, second, third].entries()) {
      await recordOutcomes(payroll, original, instruction.id, ['SUBMITTED', 'RETURNED']);
      await correctDestination(payroll, instruction, `00990004${index}0`);
    }

    const same = await Promise.allSettled([
      retry(payroll, original, first.id, { reason: 'Cashier A' }),
      retry(payroll, original, first.id, { reason: 'Cashier B' }),
    ]);
    expect(same.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(same.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { statusCode: 409, code: 'PAYMENT_INSTRUCTION_ALREADY_RETRIED' },
    });
    expect(
      await admin.paymentInstruction.count({ where: { priorPaymentInstructionId: first.id } }),
    ).toBe(1);

    const different = await Promise.all([
      retry(payroll, original, second.id),
      retry(payroll, original, third.id),
    ]);
    expect(different.map((view) => view.instructions[0]!.priorPaymentInstructionId).sort()).toEqual(
      [second.id, third.id].sort(),
    );
    expect(await exportsOf(payroll)).toBe(4);
    // Each is a separate superseding export; the period still has one original.
    expect(await exports.generate(payroll.cashier, payroll.periodId)).toEqual(original);
  });

  it('lists the period’s exports, each instruction with its outcomes in order and whether it can be retried', async () => {
    const payroll = await exportedPayroll('LIST', 2);
    const original = payroll.generated;
    const [first, second] = original.instructions as [
      PaymentExportView['instructions'][number],
      PaymentExportView['instructions'][number],
    ];
    await recordOutcomes(payroll, original, first.id, ['SUBMITTED', 'REJECTED']);
    await recordOutcomes(payroll, original, second.id, ['SUBMITTED', 'RETURNED']);

    let [listed] = await exports.list(payroll.cashier, payroll.periodId);
    expect(listed).toMatchObject({ id: original.id, supersedesPaymentExportId: null });
    const [firstListed, secondListed] = listed!.instructions;
    expect(firstListed).toMatchObject({
      ...first,
      retriedByPaymentInstructionId: null,
      retryable: true,
    });
    expect(
      firstListed!.outcomes.map(({ sequence, outcome, reason }) => [sequence, outcome, reason]),
    ).toEqual([
      [1, 'SUBMITTED', null],
      [2, 'REJECTED', 'REJECTED by the bank'],
    ]);
    expect(secondListed!.retryable).toBe(true);

    await correctDestination(payroll, first, '0099000666');
    const retried = await retry(payroll, original, first.id);
    await recordOutcomes(payroll, original, second.id, ['SETTLED']);

    const all = await exports.list(payroll.cashier, payroll.periodId);
    expect(all.map((record) => record.id)).toEqual([original.id, retried.id]);
    [listed] = all;
    expect(listed!.instructions[0]).toMatchObject({
      retriedByPaymentInstructionId: retried.instructions[0]!.id,
      retryable: false,
    });
    // RETURNED, then SETTLED: only the latest outcome decides.
    expect(listed!.instructions[1]!.outcomes.map(({ outcome }) => outcome)).toEqual([
      'SUBMITTED',
      'RETURNED',
      'SETTLED',
    ]);
    expect(listed!.instructions[1]!.retryable).toBe(false);
    expect(all[1]!.instructions[0]).toMatchObject({
      priorPaymentInstructionId: first.id,
      outcomes: [],
      retryable: false,
    });

    await expect(exports.list(payroll.reader, payroll.periodId)).rejects.toMatchObject({
      statusCode: 403,
      code: 'PAYMENT_EXPORT_FORBIDDEN',
    });
    const other = await exportedPayroll('LIST-OTHER');
    await expect(exports.list(other.cashier, payroll.periodId)).rejects.toMatchObject({
      statusCode: 404,
      code: 'PAYROLL_PERIOD_NOT_FOUND',
    });
  });

  it('retries only on a FINALIZED payroll', async () => {
    const payroll = await exportedPayroll('VOIDED');
    const original = payroll.generated;
    const [instruction] = original.instructions as [PaymentExportView['instructions'][number]];
    await recordOutcomes(payroll, original, instruction.id, ['REJECTED']);
    await correctDestination(payroll, instruction, '0099000555');
    await seed((transaction) =>
      transaction.payrollPeriod.update({
        where: { id: payroll.periodId },
        data: {
          status: 'VOIDED',
          voidReason: 'Test fixture: the whole payroll was wrong',
          voidedByMembershipId: payroll.cashier.membershipId,
          voidedAt: new Date(),
        },
      }),
    );
    await expect(retry(payroll, original, instruction.id)).rejects.toMatchObject({
      statusCode: 409,
      code: 'PAYMENT_EXPORT_PAYROLL_NOT_FINALIZED',
    });
  });
});
