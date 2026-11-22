import { randomUUID } from 'node:crypto';
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
  type DisbursementOutcomeInput,
} from './disbursement-outcomes.service';
import { PaymentExportsService } from './payment-exports.service';

const enabled = process.env.DATABASE_E2E === 'true';

describe.skipIf(!enabled)('Disbursement Outcomes in PostgreSQL', () => {
  const suffix = `${Date.now()}-disbursement`;
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
      await transaction.documentVersion.deleteMany({ where });
      await transaction.document.deleteMany({ where });
      await transaction.employee.deleteMany({ where });
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
   * An Agency of its own with a FINALIZED March 2875 payroll of `employees`
   * results, each paying 1,000.00 to a verified account, and its Payment
   * Export. Person 0 is the Cashier; person 1 finalized the period, so holds
   * APPROVAL there, and also holds `payroll.disbursement.update`; person 2
   * holds only `payroll.periods.read`.
   */
  async function exportedPayroll(label: string, employees = 3) {
    const tenant = await createPayrollTenant(admin, suffix, `DISBURSEMENT-${label}`, 3);
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
          code: `PAY-2875-03-${label}`,
          runType: 'REGULAR',
          periodFrom: new Date('2875-03-01'),
          periodTo: new Date('2875-03-31'),
          cutoffAt: new Date('2875-03-20T00:00:00Z'),
          paymentDate: new Date('2875-03-31'),
          status: 'FINALIZED',
          calculationVersion: 1,
          finalizedAt: new Date(),
        },
      });
      await transaction.payrollPeriodActor.create({
        data: {
          agencyId: agency.id,
          payrollPeriodId: period.id,
          membershipId: persons[1]!.membership.id,
          payrollFunction: 'APPROVAL',
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
            contactEmail: `disbursement-${number}-${suffix}@example.test`.toLowerCase(),
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
        const sealed = encryptProtectedValue(`00${index}1234567`, key(), {
          metadata: JSON.stringify({
            purpose: 'PAYROLL_BANK_ACCOUNT',
            employeeId: employee.id,
            bankCode: 'LBP',
          }),
        });
        await transaction.payrollBankAccount.create({
          data: {
            agencyId: agency.id,
            employeeId: employee.id,
            bankCode: 'LBP',
            accountName: `Holder ${number}`,
            encryptedAccountNumber: new Uint8Array(sealed.envelope),
            maskedAccountNumber: sealed.maskedValue,
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
    const generated = await exports.generate(as(0, ['payroll.payment_exports.generate']), periodId);
    return {
      tenant,
      periodId,
      generated,
      exportId: generated.id,
      instructionIds: generated.instructions.map((instruction) => instruction.id),
      cashier: as(0, ['payroll.disbursement.update', 'payroll.payment_exports.generate']),
      approver: as(1, ['payroll.disbursement.update']),
      reader: as(2, ['payroll.periods.read']),
    };
  }

  type Payroll = Awaited<ReturnType<typeof exportedPayroll>>;

  const record = (
    payroll: Payroll,
    instructionId: string,
    input: DisbursementOutcomeInput,
    context = payroll.cashier,
  ) =>
    outcomes.record(
      context,
      { periodId: payroll.periodId, exportId: payroll.exportId, instructionId },
      input,
    );

  const blocking = (payroll: Payroll) =>
    withDatabaseContext(payroll.tenant.persons[0]!.scope, (transaction) =>
      instructionsBlockingVoid(transaction, {
        agencyId: payroll.tenant.agency.id,
        payrollPeriodId: payroll.periodId,
      }),
    );

  /** A finalized External Evidence Document Version, such as a bank's acknowledgement. */
  async function evidenceVersion(tenant: PayrollTenant) {
    const { agency, persons } = tenant;
    const document = await admin.document.create({
      data: {
        agencyId: agency.id,
        documentType: 'EXTERNAL_EVIDENCE',
        classification: 'INTERNAL',
        status: 'APPROVED',
        createdByMembershipId: persons[0]!.membership.id,
      },
    });
    const version = await admin.documentVersion.create({
      data: {
        agencyId: agency.id,
        documentId: document.id,
        versionNo: 1,
        storageKey: `disbursement/${agency.id}/${document.id}`,
        contentHash: 'd'.repeat(64),
        mimeType: 'application/pdf',
        sizeBytes: 1,
        issuedAt: new Date(),
        createdByMembershipId: persons[0]!.membership.id,
      },
    });
    await admin.document.update({
      where: { id: document.id },
      data: { currentVersionId: version.id },
    });
    return version.id;
  }

  it('keeps each instruction’s outcomes in order, mixed within one export, and reads the latest for a void', async () => {
    const payroll = await exportedPayroll('ORDER');
    const [first, second, third] = payroll.instructionIds as [string, string, string];
    const evidence = await evidenceVersion(payroll.tenant);
    expect(await blocking(payroll)).toEqual([]);

    const submitted = await record(payroll, first, {
      outcome: 'SUBMITTED',
      sequence: 1,
      externalReference: 'LBP-BATCH-0001',
      evidenceDocumentVersionId: evidence,
    });
    expect(submitted).toMatchObject({
      paymentInstructionId: first,
      sequence: 1,
      outcome: 'SUBMITTED',
      externalReference: 'LBP-BATCH-0001',
      evidenceDocumentVersionId: evidence,
      reason: null,
      recordedByMembershipId: payroll.cashier.membershipId,
    });
    await record(payroll, first, { outcome: 'ACCEPTED', sequence: 2 });
    await record(payroll, second, { outcome: 'SUBMITTED', sequence: 1 });
    await record(payroll, second, {
      outcome: 'REJECTED',
      sequence: 2,
      reason: 'Account closed',
    });

    // ACCEPTED does not imply SETTLED; the third instruction has no outcome.
    expect(await blocking(payroll)).toEqual([{ paymentInstructionId: first, outcome: 'ACCEPTED' }]);
    await record(payroll, first, { outcome: 'SETTLED', sequence: 3 });
    expect(await blocking(payroll)).toEqual([{ paymentInstructionId: first, outcome: 'SETTLED' }]);
    await record(payroll, third, { outcome: 'SUBMITTED', sequence: 1 });
    expect((await blocking(payroll)).map((row) => row.paymentInstructionId).sort()).toEqual(
      [first, third].sort(),
    );
    await record(payroll, first, { outcome: 'RETURNED', sequence: 4, reason: 'Credit reversed' });
    expect(await blocking(payroll)).toEqual([
      { paymentInstructionId: third, outcome: 'SUBMITTED' },
    ]);

    // A stale or skipped place in the order is refused and writes nothing.
    await expect(
      record(payroll, second, { outcome: 'SETTLED', sequence: 2 }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'DISBURSEMENT_OUTCOME_STALE' });
    await expect(
      record(payroll, second, { outcome: 'SETTLED', sequence: 4 }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'DISBURSEMENT_OUTCOME_STALE' });

    const history = await admin.disbursementOutcome.findMany({
      where: { paymentInstructionId: first },
      orderBy: { sequence: 'asc' },
      select: { sequence: true, outcome: true, reason: true },
    });
    expect(history).toEqual([
      { sequence: 1, outcome: 'SUBMITTED', reason: null },
      { sequence: 2, outcome: 'ACCEPTED', reason: null },
      { sequence: 3, outcome: 'SETTLED', reason: null },
      { sequence: 4, outcome: 'RETURNED', reason: 'Credit reversed' },
    ]);
    const events = await admin.auditEvent.findMany({
      where: { agencyId: payroll.tenant.agency.id, entityId: first },
      orderBy: { occurredAt: 'asc' },
      select: { action: true, entityType: true, previousStatus: true, newStatus: true },
    });
    expect(events.map((event) => [event.previousStatus, event.newStatus])).toEqual([
      [null, 'SUBMITTED'],
      ['SUBMITTED', 'ACCEPTED'],
      ['ACCEPTED', 'SETTLED'],
      ['SETTLED', 'RETURNED'],
    ]);
    expect(new Set(events.map((event) => `${event.entityType}:${event.action}`))).toEqual(
      new Set(['PaymentInstruction:DISBURSEMENT_OUTCOME_RECORDED']),
    );

    // Outcomes change neither the export nor the payroll.
    expect(await exports.generate(payroll.cashier, payroll.periodId)).toEqual(payroll.generated);
    expect(
      await admin.payrollPeriod.findUniqueOrThrow({
        where: { id: payroll.periodId },
        select: { status: true },
      }),
    ).toEqual({ status: 'FINALIZED' });

    // Append-only, even for the database owner; the order has no gaps.
    await expect(
      admin.disbursementOutcome.updateMany({
        where: { paymentInstructionId: first },
        data: { outcome: 'SETTLED' },
      }),
    ).rejects.toThrow(/append-only/);
    await expect(
      admin.disbursementOutcome.deleteMany({ where: { paymentInstructionId: first } }),
    ).rejects.toThrow(/append-only/);
    await expect(
      withDatabaseContext(payroll.tenant.persons[0]!.scope, (transaction) =>
        transaction.disbursementOutcome.create({
          data: {
            agencyId: payroll.tenant.agency.id,
            paymentInstructionId: second,
            sequence: 7,
            outcome: 'SETTLED',
            recordedByMembershipId: payroll.cashier.membershipId,
          },
        }),
      ),
    ).rejects.toThrow(/follows its instruction's latest outcome/);
  });

  it('orders two concurrent recordings of the same place: one is recorded, one is stale', async () => {
    const payroll = await exportedPayroll('RACE', 1);
    const [instruction] = payroll.instructionIds as [string];
    const results = await Promise.allSettled([
      record(payroll, instruction, { outcome: 'SUBMITTED', sequence: 1 }),
      record(payroll, instruction, { outcome: 'REJECTED', sequence: 1, reason: 'Duplicate' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 'DISBURSEMENT_OUTCOME_STALE' },
    });
    expect(
      await admin.disbursementOutcome.count({ where: { paymentInstructionId: instruction } }),
    ).toBe(1);
  });

  it('needs a reason for REJECTED and RETURNED, and only for them', async () => {
    const payroll = await exportedPayroll('REASON', 1);
    const [instruction] = payroll.instructionIds as [string];
    for (const outcome of ['REJECTED', 'RETURNED'] as const) {
      await expect(record(payroll, instruction, { outcome, sequence: 1 })).rejects.toMatchObject({
        statusCode: 400,
        code: 'INVALID_INPUT',
        message: `reason: A ${outcome} outcome needs a reason.`,
      });
      await expect(
        record(payroll, instruction, { outcome, sequence: 1, reason: '   ' }),
      ).rejects.toMatchObject({ statusCode: 400 });
    }
    await expect(
      record(payroll, instruction, { outcome: 'SETTLED', sequence: 1, reason: 'Paid' }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_INPUT' });
    await expect(
      withDatabaseContext(payroll.tenant.persons[0]!.scope, (transaction) =>
        transaction.disbursementOutcome.create({
          data: {
            agencyId: payroll.tenant.agency.id,
            paymentInstructionId: instruction,
            sequence: 1,
            outcome: 'RETURNED',
            recordedByMembershipId: payroll.cashier.membershipId,
          },
        }),
      ),
    ).rejects.toThrow(/disbursement_outcomes_reason_check/);
    expect(
      await admin.disbursementOutcome.count({ where: { paymentInstructionId: instruction } }),
    ).toBe(0);
  });

  it('claims DISBURSEMENT, refusing the period’s Payroll Approver and anyone without the permission', async () => {
    const payroll = await exportedPayroll('FUNCTION', 1);
    const [instruction] = payroll.instructionIds as [string];
    const submit = { outcome: 'SUBMITTED' as const, sequence: 1 };

    await expect(record(payroll, instruction, submit, payroll.approver)).rejects.toMatchObject({
      statusCode: 409,
      code: 'PAYROLL_FUNCTION_CONFLICT',
      message:
        'You act in APPROVAL on this Payroll Period, so you cannot also act in DISBURSEMENT.',
    });
    await expect(record(payroll, instruction, submit, payroll.reader)).rejects.toMatchObject({
      statusCode: 403,
      code: 'DISBURSEMENT_OUTCOME_FORBIDDEN',
    });
    await expect(
      record(payroll, instruction, { ...submit, evidenceDocumentVersionId: randomUUID() }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'DISBURSEMENT_OUTCOME_EVIDENCE_INVALID' });
    expect(
      await admin.disbursementOutcome.count({ where: { paymentInstructionId: instruction } }),
    ).toBe(0);

    await record(payroll, instruction, submit);
    expect(
      await admin.payrollPeriodActor.findMany({
        where: { payrollPeriodId: payroll.periodId },
        orderBy: { payrollFunction: 'asc' },
        select: { membershipId: true, payrollFunction: true },
      }),
    ).toEqual([
      { membershipId: payroll.approver.membershipId, payrollFunction: 'APPROVAL' },
      { membershipId: payroll.cashier.membershipId, payrollFunction: 'DISBURSEMENT' },
    ]);
    await expect(
      record(payroll, randomUUID(), { outcome: 'SUBMITTED', sequence: 1 }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'PAYMENT_INSTRUCTION_NOT_FOUND' });
  });

  it('records outcomes only on a FINALIZED payroll', async () => {
    const payroll = await exportedPayroll('VOIDED', 1);
    const [instruction] = payroll.instructionIds as [string];
    await seed((transaction) =>
      transaction.payrollPeriod.update({
        where: { id: payroll.periodId },
        data: {
          status: 'VOIDED',
          voidReason: 'Test fixture: the whole payroll was wrong',
          voidedByMembershipId: payroll.approver.membershipId,
          voidedAt: new Date(),
        },
      }),
    );
    await expect(
      record(payroll, instruction, { outcome: 'SUBMITTED', sequence: 1 }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'DISBURSEMENT_OUTCOME_PAYROLL_NOT_FINALIZED',
    });
    await expect(
      withDatabaseContext(payroll.tenant.persons[0]!.scope, (transaction) =>
        transaction.disbursementOutcome.create({
          data: {
            agencyId: payroll.tenant.agency.id,
            paymentInstructionId: instruction,
            sequence: 1,
            outcome: 'SUBMITTED',
            recordedByMembershipId: payroll.cashier.membershipId,
          },
        }),
      ),
    ).rejects.toThrow(/only on a Payment Instruction of a FINALIZED payroll/);
  });

  it('keeps another Agency from recording, reading, or naming an instruction', async () => {
    const owner = await exportedPayroll('OWNER', 1);
    const other = await exportedPayroll('OTHER', 1);
    const [instruction] = owner.instructionIds as [string];
    await record(owner, instruction, { outcome: 'SUBMITTED', sequence: 1 });

    await expect(
      outcomes.record(
        other.cashier,
        { periodId: owner.periodId, exportId: owner.exportId, instructionId: instruction },
        { outcome: 'SETTLED', sequence: 2 },
      ),
    ).rejects.toMatchObject({ statusCode: 404, code: 'PAYROLL_PERIOD_NOT_FOUND' });
    // The other Agency's own period cannot reach the owner's export either.
    await expect(
      outcomes.record(
        other.cashier,
        { periodId: other.periodId, exportId: owner.exportId, instructionId: instruction },
        { outcome: 'SETTLED', sequence: 2 },
      ),
    ).rejects.toMatchObject({ statusCode: 404, code: 'PAYMENT_INSTRUCTION_NOT_FOUND' });

    const otherScope = other.tenant.persons[0]!.scope;
    expect(
      await withDatabaseContext(otherScope, (transaction) =>
        transaction.disbursementOutcome.findMany({ where: { paymentInstructionId: instruction } }),
      ),
    ).toEqual([]);
    expect(
      await withDatabaseContext(otherScope, (transaction) =>
        instructionsBlockingVoid(transaction, {
          agencyId: owner.tenant.agency.id,
          payrollPeriodId: owner.periodId,
        }),
      ),
    ).toEqual([]);
    for (const agencyId of [owner.tenant.agency.id, other.tenant.agency.id]) {
      await expect(
        withDatabaseContext(otherScope, (transaction) =>
          transaction.disbursementOutcome.create({
            data: {
              agencyId,
              paymentInstructionId: instruction,
              sequence: 2,
              outcome: 'SETTLED',
              recordedByMembershipId: other.cashier.membershipId,
            },
          }),
        ),
      ).rejects.toThrow(/FINALIZED payroll|row-level security/);
    }
    expect(await blocking(owner)).toEqual([
      { paymentInstructionId: instruction, outcome: 'SUBMITTED' },
    ]);
  });
});
