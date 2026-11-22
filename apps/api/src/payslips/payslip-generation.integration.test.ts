import { createHash, randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { withDatabaseContext } from '@lingkod-hr/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { documentAuditWriter, DocumentsService } from '../documents/documents.service';
import type { DocumentStorage } from '../documents/documents.storage';
import {
  cleanupPayrollTenants,
  cleanupPlatformFixtures,
  createAdminClient,
  createPayrollTenant,
  FIXTURE_PREFIX,
  type PayrollTenant,
} from '../payroll-periods/payroll-periods.test-fixtures';
import { duePayslipPeriods } from './payslip-generation.job';
import { PayslipGenerationService } from './payslip-generation.service';

const enabled = process.env.DATABASE_E2E === 'true';

/** Test double of the S3 adapter: records each stored object, and fails while told to. */
class RecordedStorage implements DocumentStorage {
  objects = new Map<string, { body: Buffer; contentType: string; contentHash: string }>();
  puts = 0;
  failuresLeft = 0;
  delayMs = 0;

  async putObject(input: { key: string; body: Buffer; contentType: string; contentHash: string }) {
    this.puts += 1;
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    if (this.failuresLeft > 0) {
      this.failuresLeft -= 1;
      throw new Error('Test storage is unavailable.');
    }
    this.objects.set(input.key, input);
  }

  async deleteObject(key: string) {
    this.objects.delete(key);
  }

  async signedReadUrl(key: string) {
    return `https://storage.example.test/${key}`;
  }
}

describe.skipIf(!enabled)('Payslip generation in PostgreSQL', () => {
  const suffix = `${Date.now()}-payslips`;
  const ruleCode = `${FIXTURE_PREFIX}PAYSLIP-SCHEDULE-${suffix}`;
  const tenants: PayrollTenant[] = [];
  let admin: PrismaClient;
  let ruleVersionId: string;

  /** Fixture rows written with triggers off, standing in for what finalization (#335) writes. */
  const seed = <T>(run: (transaction: Prisma.TransactionClient) => Promise<T>) =>
    admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      return run(transaction);
    });

  /**
   * An Agency with a March 2874 regular period finalized at version 2 by its
   * one person. Its Employee's version-2 result is FINALIZED with a basic
   * salary and a day-without-pay line; the version-1 result it replaced is
   * not. Test fixture only: the amounts are not from any issuance.
   */
  async function finalizedPeriod(label: string) {
    const tenant = await createPayrollTenant(admin, suffix, `PAYSLIP-${label}`, 1);
    tenants.push(tenant);
    const agencyId = tenant.agency.id;
    const membershipId = tenant.persons[0]!.membership.id;
    const components = await admin.payComponent.findMany({
      where: { code: { in: ['BASIC_SALARY', 'DAYS_WITHOUT_PAY'] } },
    });
    const componentId = (code: string) => components.find((each) => each.code === code)!.id;
    return seed(async (transaction) => {
      const employee = await transaction.employee.create({
        data: {
          agencyId,
          employeeNumber: `PAYSLIP-${label}-${suffix}`,
          legalName: `Payslip ${label}`,
          birthDate: new Date('1990-01-01'),
          sex: 'FEMALE',
          civilStatus: 'SINGLE',
          contactEmail: `payslip-${label.toLowerCase()}-${suffix}@example.test`,
          serviceStatus: 'ACTIVE',
          createdByMembershipId: membershipId,
          updatedByMembershipId: membershipId,
        },
      });
      const period = await transaction.payrollPeriod.create({
        data: {
          agencyId,
          code: `PAYSLIP-2874-03-${label}`,
          runType: 'REGULAR',
          periodFrom: new Date('2874-03-01'),
          periodTo: new Date('2874-03-31'),
          cutoffAt: new Date('2874-03-10T00:00:00Z'),
          paymentDate: new Date('2874-03-15'),
          status: 'FINALIZED',
          calculationVersion: 2,
          finalizedAt: new Date('2874-03-14T02:00:00Z'),
        },
      });
      const result = (calculationVersion: number, status: string) =>
        transaction.payrollEmployee.create({
          data: {
            agencyId,
            payrollPeriodId: period.id,
            calculationVersion,
            employeeId: employee.id,
            compensationBasisSnapshot: {},
            status,
            grossAmount: '44000',
            totalDeductions: '2000',
            netAmount: '42000',
            calculationHash: 'f'.repeat(64),
          },
        });
      const replaced = await result(1, 'CALCULATED');
      const finalized = await result(2, 'FINALIZED');
      await transaction.payrollLine.createMany({
        data: [
          {
            agencyId,
            payrollEmployeeId: finalized.id,
            payComponentId: componentId('BASIC_SALARY'),
            ruleVersionId,
            lineType: 'EARNING',
            quantity: '1',
            rate: '44000',
            amount: '44000',
            sourceSnapshot: { unit: 'MONTH' },
          },
          {
            agencyId,
            payrollEmployeeId: finalized.id,
            payComponentId: componentId('DAYS_WITHOUT_PAY'),
            ruleVersionId,
            lineType: 'DEDUCTION',
            quantity: '1',
            rate: '44000',
            amount: '2000',
            sourceSnapshot: {
              unit: 'DAY',
              formula: 'quantity × monthly salary ÷ 22',
              authority: 'Test authority, not an issuance',
            },
          },
        ],
      });
      await transaction.auditEvent.create({
        data: {
          agencyId,
          actorUserId: tenant.persons[0]!.user.id,
          actorMembershipId: membershipId,
          actorType: 'USER',
          action: 'PAYROLL_PERIOD_FINALIZED',
          entityType: 'PayrollPeriod',
          entityId: period.id,
          previousStatus: 'APPROVED',
          newStatus: 'FINALIZED',
          idempotencyKey: 'finalized',
        },
      });
      await transaction.outboxEvent.create({
        data: {
          agencyId,
          eventType: 'PAYROLL_PERIOD_FINALIZED',
          aggregateType: 'PayrollPeriod',
          aggregateId: period.id,
          idempotencyKey: `payroll-period-finalized:${period.id}`,
          payload: { payrollPeriodId: period.id, calculationVersion: 2 },
        },
      });
      return { agencyId, membershipId, periodId: period.id, finalized, replaced };
    });
  }

  const generation = (storage: RecordedStorage) =>
    new PayslipGenerationService(new DocumentsService(storage, documentAuditWriter));
  const payslipsOf = (agencyId: string) => admin.payslip.findMany({ where: { agencyId } });
  const payslipDocuments = (agencyId: string) =>
    admin.document.findMany({
      where: { agencyId, documentType: 'PAYSLIP' },
      include: { versions: true },
    });
  const isDue = async (periodId: string) =>
    (await duePayslipPeriods()).some((due) => due.payrollPeriodId === periodId);

  beforeAll(async () => {
    admin = await createAdminClient();
    const version = await admin.nationalPayrollRuleVersion.create({
      data: {
        ruleKind: 'SALARY_SCHEDULE',
        code: ruleCode,
        name: 'Test salary schedule',
        issuingAuthority: 'Test authority',
        issuanceReference: 'Test fixture, not an issuance',
        sourceUrl: 'https://example.test/salary-schedule',
        verifiedOn: new Date('2026-11-21'),
        verifiedBy: 'LingkodHR test fixture',
        effectiveFrom: new Date('2874-01-01'),
        effectiveTo: new Date('2874-12-31'),
      },
    });
    ruleVersionId = version.id;
  });

  afterAll(async () => {
    if (!admin) return;
    await seed(async (transaction) => {
      const where = { agencyId: { in: tenants.map((each) => each.agency.id) } };
      await transaction.payslip.deleteMany({ where });
      await transaction.outboxEvent.deleteMany({ where });
      await transaction.document.updateMany({ where, data: { currentVersionId: null } });
      await transaction.documentVersion.deleteMany({ where });
      await transaction.document.deleteMany({ where });
      await transaction.payrollLine.deleteMany({ where });
      await transaction.payrollEmployee.deleteMany({ where });
      await transaction.employee.deleteMany({ where });
    });
    await cleanupPayrollTenants(admin, tenants);
    await cleanupPlatformFixtures(admin, suffix);
    await admin.$disconnect();
  });

  it('stores one READY Payslip per FINALIZED result, and retries a failed file without a second Payslip', async () => {
    const setup = await finalizedPeriod('RETRY');
    const storage = new RecordedStorage();
    storage.failuresLeft = 1;
    const service = generation(storage);

    expect(await isDue(setup.periodId)).toBe(true);
    expect(await service.generateForPeriod(setup.agencyId, setup.periodId)).toEqual({
      ready: 0,
      failed: 1,
    });
    // The failed store leaves the Payslip GENERATING, with no Document, and still due.
    const [generating, ...noOther] = await payslipsOf(setup.agencyId);
    expect(noOther).toEqual([]);
    expect(generating).toMatchObject({
      payrollEmployeeId: setup.finalized.id,
      status: 'GENERATING',
      documentId: null,
    });
    expect(await payslipDocuments(setup.agencyId)).toEqual([]);
    expect(await isDue(setup.periodId)).toBe(true);

    expect(await service.generateForPeriod(setup.agencyId, setup.periodId)).toEqual({
      ready: 1,
      failed: 0,
    });
    const [payslip, ...none] = await payslipsOf(setup.agencyId);
    expect(none).toEqual([]);
    expect(payslip).toMatchObject({ id: generating!.id, status: 'READY' });
    const [document, ...noSecond] = await payslipDocuments(setup.agencyId);
    expect(noSecond).toEqual([]);
    expect(document).toMatchObject({
      id: payslip!.documentId,
      classification: 'CONFIDENTIAL',
      status: 'APPROVED',
      createdByMembershipId: setup.membershipId,
    });
    const [version] = document!.versions;
    const stored = storage.objects.get(version!.storageKey)!;
    expect(version).toMatchObject({
      id: document!.currentVersionId,
      mimeType: 'application/pdf',
      contentHash: createHash('sha256').update(stored.body).digest('hex'),
      sizeBytes: BigInt(stored.body.byteLength),
    });
    expect(version!.issuedAt).not.toBeNull();

    // The file shows each line's amount and how it was reached.
    const pdf = stored.body.toString('latin1');
    expect(pdf.startsWith('%PDF-')).toBe(true);
    for (const shown of [
      '(Basic salary \\(BASIC_SALARY\\): PHP 44,000.00) Tj',
      '(    quantity 1 MONTH x rate 44000) Tj',
      '(Salary for days without pay \\(DAYS_WITHOUT_PAY\\): PHP 2,000.00) Tj',
      '(    Formula: quantity \xd7 monthly salary \xf7 22) Tj',
      // The fixture's long code wraps the rest of this line.
      `(    Rule: Test salary schedule \\(${ruleCode}\\), Test fixture`,
      '(Net pay: PHP 42,000.00) Tj',
    ]) {
      expect(pdf).toContain(shown);
    }

    const audit = await admin.auditEvent.findMany({
      where: { agencyId: setup.agencyId, entityId: payslip!.id },
    });
    expect(audit).toMatchObject([
      {
        action: 'PAYSLIP_READY',
        actorType: 'SYSTEM',
        previousStatus: 'GENERATING',
        newStatus: 'READY',
      },
    ]);
    expect(audit[0]!.metadata).toMatchObject({
      documentId: document!.id,
      payrollEmployeeId: setup.finalized.id,
    });

    // Nothing is due any more, and another run stores nothing.
    expect(await isDue(setup.periodId)).toBe(false);
    const puts = storage.puts;
    expect(await service.generateForPeriod(setup.agencyId, setup.periodId)).toEqual({
      ready: 0,
      failed: 0,
    });
    expect(storage.puts).toBe(puts);
  });

  it('makes one Payslip and one Document when two runs generate at once', async () => {
    const setup = await finalizedPeriod('CONCURRENT');
    const storage = new RecordedStorage();
    // Both runs store before either locks the Payslip.
    storage.delayMs = 100;
    const runs = await Promise.all([
      generation(storage).generateForPeriod(setup.agencyId, setup.periodId),
      generation(storage).generateForPeriod(setup.agencyId, setup.periodId),
    ]);
    expect(runs.every((run) => run.failed === 0)).toBe(true);
    expect(storage.puts).toBe(2);
    expect(storage.objects.size).toBe(1);

    const payslips = await payslipsOf(setup.agencyId);
    expect(payslips).toMatchObject([{ payrollEmployeeId: setup.finalized.id, status: 'READY' }]);
    const documents = await payslipDocuments(setup.agencyId);
    expect(documents.map((document) => document.id)).toEqual([payslips[0]!.documentId]);
    expect(
      await admin.auditEvent.count({
        where: { agencyId: setup.agencyId, action: 'PAYSLIP_READY' },
      }),
    ).toBe(1);
  });

  it('admits a Payslip only for a FINALIZED result, never moves it back, and only in its Agency', async () => {
    const setup = await finalizedPeriod('GUARD');
    const other = await finalizedPeriod('OTHER');
    await generation(new RecordedStorage()).generateForPeriod(setup.agencyId, setup.periodId);
    const [payslip] = await payslipsOf(setup.agencyId);
    const inAgency = (
      agencyId: string,
      statement: (transaction: Prisma.TransactionClient) => unknown,
    ) =>
      withDatabaseContext({ agencyId }, async (transaction) => {
        await statement(transaction);
      });

    await expect(
      inAgency(setup.agencyId, (transaction) =>
        transaction.payslip.create({
          data: {
            agencyId: setup.agencyId,
            payrollEmployeeId: setup.replaced.id,
            status: 'GENERATING',
          },
        }),
      ),
    ).rejects.toThrow(/only for a FINALIZED Payroll Employee Result/);
    await expect(
      inAgency(
        setup.agencyId,
        (transaction) =>
          transaction.$executeRaw`UPDATE payslips SET status = 'GENERATING' WHERE id = CAST(${payslip!.id} AS uuid)`,
      ),
    ).rejects.toThrow(/A Payslip changes only GENERATING → READY/);
    // Release and withholding columns change only with their transition (#640).
    await expect(
      inAgency(
        setup.agencyId,
        (transaction) =>
          transaction.$executeRaw`UPDATE payslips SET released_at = now() WHERE id = CAST(${payslip!.id} AS uuid)`,
      ),
    ).rejects.toThrow(/A Payslip changes only GENERATING → READY/);
    await expect(
      inAgency(
        setup.agencyId,
        (transaction) =>
          transaction.$executeRaw`DELETE FROM payslips WHERE id = CAST(${payslip!.id} AS uuid)`,
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      admin.$executeRaw`DELETE FROM payslips WHERE id = CAST(${payslip!.id} AS uuid)`,
    ).rejects.toThrow(/retained and cannot be deleted/);

    // Another Agency neither sees the Payslip nor can generate one for its result.
    expect(
      await withDatabaseContext({ agencyId: other.agencyId }, (transaction) =>
        transaction.payslip.findMany({ where: { id: payslip!.id } }),
      ),
    ).toEqual([]);
    await expect(
      inAgency(other.agencyId, (transaction) =>
        transaction.payslip.create({
          data: { agencyId: setup.agencyId, payrollEmployeeId: randomUUID(), status: 'GENERATING' },
        }),
      ),
    ).rejects.toThrow();
    const [forced] = await admin.$queryRaw<{ relforcerowsecurity: boolean }[]>`
      SELECT relforcerowsecurity FROM pg_class WHERE relname = 'payslips'
    `;
    expect(forced?.relforcerowsecurity).toBe(true);
  });
});
