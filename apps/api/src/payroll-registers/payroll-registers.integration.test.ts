import { createHash, randomUUID } from 'node:crypto';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import type { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { documentAuditWriter, DocumentsService } from '../documents/documents.service';
import type { DocumentStorage } from '../documents/documents.storage';
import { payrollCalculationHash } from '../payroll-calculation/calculation-hash';
import {
  cleanupPayrollTenants,
  createAdminClient,
  createPayrollTenant,
  type PayrollTenant,
} from '../payroll-periods/payroll-periods.test-fixtures';
import { PayrollRegistersService } from './payroll-registers.service';

const enabled = process.env.DATABASE_E2E === 'true';

/** Test double of the S3 adapter: records each stored object, after an optional delay. */
class RecordedStorage implements DocumentStorage {
  objects = new Map<string, { body: Buffer; contentType: string; contentHash: string }>();
  puts = 0;
  delayMs = 0;

  async putObject(input: { key: string; body: Buffer; contentType: string; contentHash: string }) {
    this.puts += 1;
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    this.objects.set(input.key, input);
  }

  async deleteObject(key: string) {
    this.objects.delete(key);
  }

  async signedReadUrl(key: string) {
    return `https://storage.example.test/${key}`;
  }
}

/** One Employee's FINALIZED result. Amounts are test fixtures, not from any issuance. */
interface EmployeeSpec {
  number: string;
  basic: string;
  pera: string;
  gsis: string;
  governmentShare: string;
  /** Totals stored on the result, when they should differ from the lines. */
  gross?: string;
}

describe.skipIf(!enabled)('Payroll Register in PostgreSQL', () => {
  const suffix = `${Date.now()}-payroll-register`;
  const tenants: PayrollTenant[] = [];
  let admin: PrismaClient;
  let componentId: (code: string) => string;

  /** Fixture rows written with triggers off, standing in for what finalization (#335) wrote. */
  const seed = <T>(run: (transaction: Prisma.TransactionClient) => Promise<T>) =>
    admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      return run(transaction);
    });

  /**
   * An Agency with a March 2874 regular period in `status` at calculation
   * version 2, certified at the hash of its version-2 results. Each spec is a
   * version-2 result with basic salary, PERA, GSIS personal share, and GSIS
   * government share lines; a replaced version-1 result is not FINALIZED.
   * Two people hold `payroll.registers.generate`; a third holds only
   * `payroll.periods.read`.
   */
  async function finalizedPayroll(label: string, specs: EmployeeSpec[], status = 'FINALIZED') {
    const tenant = await createPayrollTenant(admin, suffix, `REGISTER-${label}`, 3);
    tenants.push(tenant);
    const { agency, persons } = tenant;
    const agencyId = agency.id;
    const membershipId = persons[0]!.membership.id;
    const as = (index: number, codes: string[]): RequestContext => ({
      ...persons[index]!.context,
      permissions: codes.map((code) => ({ code, scopePolicy: 'AGENCY' as const })),
    });
    const periodId = await seed(async (transaction) => {
      const period = await transaction.payrollPeriod.create({
        data: {
          agencyId,
          code: `REGISTER-2874-03-${label}`,
          runType: 'REGULAR',
          periodFrom: new Date('2874-03-01'),
          periodTo: new Date('2874-03-31'),
          cutoffAt: new Date('2874-03-10T00:00:00Z'),
          paymentDate: new Date('2874-03-15'),
          status,
          calculationVersion: 2,
          finalizedAt: status === 'FINALIZED' ? new Date('2874-03-14T02:00:00Z') : null,
        },
      });
      const hashed: { employeeId: string; calculationHash: string }[] = [];
      for (const spec of specs) {
        const employee = await transaction.employee.create({
          data: {
            agencyId,
            employeeNumber: `${spec.number}-${label}`,
            legalName: `Payee ${spec.number}`,
            birthDate: new Date('1990-01-01'),
            sex: 'FEMALE',
            civilStatus: 'SINGLE',
            contactEmail: `register-${label}-${spec.number}-${suffix}@example.test`.toLowerCase(),
            serviceStatus: 'ACTIVE',
            createdByMembershipId: membershipId,
            updatedByMembershipId: membershipId,
          },
        });
        const lineGross = (Number(spec.basic) + Number(spec.pera)).toFixed(4);
        const gross = spec.gross ?? lineGross;
        const net = (Number(gross) - Number(spec.gsis)).toFixed(4);
        const calculationHash = createHash('sha256')
          .update(`${label}:${spec.number}`)
          .digest('hex');
        const result = (calculationVersion: number, resultStatus: string) =>
          transaction.payrollEmployee.create({
            data: {
              agencyId,
              payrollPeriodId: period.id,
              calculationVersion,
              employeeId: employee.id,
              compensationBasisSnapshot: {},
              status: resultStatus,
              grossAmount: gross,
              totalDeductions: spec.gsis,
              netAmount: net,
              calculationHash,
            },
          });
        const finalized = await result(2, status === 'FINALIZED' ? 'FINALIZED' : 'CALCULATED');
        const replaced = await result(1, 'CALCULATED');
        hashed.push({ employeeId: employee.id, calculationHash });
        for (const payrollEmployeeId of [finalized.id, replaced.id]) {
          await transaction.payrollLine.createMany({
            data: (
              [
                ['BASIC_SALARY', 'EARNING', spec.basic],
                ['PERA', 'EARNING', spec.pera],
                ['GSIS_PERSONAL_SHARE', 'DEDUCTION', spec.gsis],
                ['GSIS_GOVERNMENT_SHARE', 'EMPLOYER_SHARE', spec.governmentShare],
              ] as const
            ).map(([code, lineType, amount]) => ({
              agencyId,
              payrollEmployeeId,
              payComponentId: componentId(code),
              lineType,
              amount,
              sourceSnapshot: {},
            })),
          });
        }
      }
      await transaction.payrollCertification.create({
        data: {
          agencyId,
          payrollPeriodId: period.id,
          calculationVersion: 2,
          calculationHash: payrollCalculationHash(hashed),
          certifiedByMembershipId: membershipId,
        },
      });
      return period.id;
    });
    return {
      agencyId,
      periodId,
      preparer: as(0, ['payroll.registers.generate']),
      cashier: as(1, ['payroll.registers.generate', 'payroll.periods.read']),
      reader: as(2, ['payroll.periods.read']),
    };
  }

  const service = (storage: RecordedStorage) =>
    new PayrollRegistersService(new DocumentsService(storage, documentAuditWriter));
  const registersOf = (agencyId: string) => admin.payrollRegister.findMany({ where: { agencyId } });
  const registerDocuments = (agencyId: string) =>
    admin.document.findMany({
      where: { agencyId, documentType: 'PAYROLL_REGISTER' },
      include: { versions: true },
    });
  const generatedAudits = (agencyId: string) =>
    admin.auditEvent.findMany({ where: { agencyId, action: 'PAYROLL_REGISTER_GENERATED' } });

  const twoEmployees: EmployeeSpec[] = [
    { number: 'E-002', basic: '44000', pera: '2000', gsis: '3960', governmentShare: '5280' },
    { number: 'E-001', basic: '30000.25', pera: '2000', gsis: '2700.5', governmentShare: '3600' },
  ];

  beforeAll(async () => {
    admin = await createAdminClient();
    const components = await admin.payComponent.findMany({
      where: {
        code: { in: ['BASIC_SALARY', 'PERA', 'GSIS_PERSONAL_SHARE', 'GSIS_GOVERNMENT_SHARE'] },
      },
    });
    componentId = (code) => components.find((each) => each.code === code)!.id;
  });

  afterAll(async () => {
    if (!admin) return;
    await seed(async (transaction) => {
      const where = { agencyId: { in: tenants.map((each) => each.agency.id) } };
      await transaction.payrollRegister.deleteMany({ where });
      await transaction.document.updateMany({ where, data: { currentVersionId: null } });
      await transaction.documentVersion.deleteMany({ where });
      await transaction.document.deleteMany({ where });
      await transaction.payrollLine.deleteMany({ where });
      await transaction.payrollEmployee.deleteMany({ where });
      await transaction.employee.deleteMany({ where });
    });
    await cleanupPayrollTenants(admin, tenants);
    await admin.$disconnect();
  });

  it('states the finalized results and lines, and a repeat generation returns the same register', async () => {
    const payroll = await finalizedPayroll('HAPPY', twoEmployees);
    const storage = new RecordedStorage();

    const register = await service(storage).generate(payroll.preparer, payroll.periodId);
    // The totals are the version-2 FINALIZED results' and their lines', not the replaced version's.
    expect(register).toMatchObject({
      payrollPeriodId: payroll.periodId,
      calculationVersion: 2,
      resultCount: 2,
      grossAmount: '78000.2500',
      totalDeductions: '6660.5000',
      netAmount: '71339.7500',
      generatedByMembershipId: payroll.preparer.membershipId,
    });

    const [document, ...noSecond] = await registerDocuments(payroll.agencyId);
    expect(noSecond).toEqual([]);
    expect(document).toMatchObject({
      id: register.documentId,
      classification: 'CONFIDENTIAL',
      status: 'APPROVED',
      createdByMembershipId: payroll.preparer.membershipId,
    });
    const [version] = document!.versions;
    const stored = storage.objects.get(version!.storageKey)!;
    expect(version!.storageKey).toMatch(
      new RegExp(`^payroll-registers/${payroll.agencyId}/${payroll.periodId}/[0-9a-f]{64}\\.pdf$`),
    );
    expect(version).toMatchObject({
      id: document!.currentVersionId,
      mimeType: 'application/pdf',
      contentHash: createHash('sha256').update(stored.body).digest('hex'),
    });
    expect(version!.issuedAt).not.toBeNull();

    const pdf = stored.body.toString('latin1');
    expect(pdf.startsWith('%PDF-')).toBe(true);
    expect(pdf).not.toMatch(/COA|BIR|Form No/);
    const shown = [
      '(PAYROLL REGISTER) Tj',
      '(EMPLOYEES \\(2\\)) Tj',
      '(E-001-HAPPY  Payee E-001) Tj',
      '(    Gross PHP 32,000.25  Deductions PHP 2,700.50  Net PHP 29,299.75) Tj',
      '(E-002-HAPPY  Payee E-002) Tj',
      '(    Gross PHP 46,000.00  Deductions PHP 3,960.00  Net PHP 42,040.00) Tj',
      '(    Basic salary \\(BASIC_SALARY\\): PHP 74,000.25, 2 lines) Tj',
      '(    GSIS government share \\(GSIS_GOVERNMENT_SHARE\\): PHP 8,880.00, 2 lines) Tj',
      '(Gross earnings: PHP 78,000.25) Tj',
      '(Total deductions: PHP 6,660.50) Tj',
      '(Net pay: PHP 71,339.75) Tj',
    ];
    for (const text of shown) expect(pdf).toContain(text);
    // Employees are listed in employee number order.
    expect(pdf.indexOf('(E-001-HAPPY')).toBeLessThan(pdf.indexOf('(E-002-HAPPY'));

    const [audit, ...noOtherAudit] = await generatedAudits(payroll.agencyId);
    expect(noOtherAudit).toEqual([]);
    expect(audit).toMatchObject({
      actorType: 'USER',
      actorMembershipId: payroll.preparer.membershipId,
      entityType: 'PayrollRegister',
      entityId: register.id,
      newStatus: 'GENERATED',
    });
    expect(audit!.metadata).toMatchObject({
      payrollPeriodId: payroll.periodId,
      documentId: document!.id,
      documentVersionId: version!.id,
      contentHash: version!.contentHash,
      resultCount: 2,
      grossAmount: '78000.2500',
      netAmount: '71339.7500',
      employerShareAmount: '8880.0000',
    });

    // Generating again, by anyone permitted, returns the same register and writes nothing.
    const puts = storage.puts;
    expect(await service(storage).generate(payroll.cashier, payroll.periodId)).toEqual(register);
    expect(await service(storage).generate(payroll.preparer, payroll.periodId)).toEqual(register);
    expect(storage.puts).toBe(puts);
    expect(await registersOf(payroll.agencyId)).toHaveLength(1);
    expect(await registerDocuments(payroll.agencyId)).toHaveLength(1);
    expect(await generatedAudits(payroll.agencyId)).toHaveLength(1);
  });

  it('makes one register and one Document when two generations run at once', async () => {
    const payroll = await finalizedPayroll('CONCURRENT', twoEmployees);
    const storage = new RecordedStorage();
    // Both store the same bytes before either locks the period.
    storage.delayMs = 100;
    const [first, second] = await Promise.all([
      service(storage).generate(payroll.preparer, payroll.periodId),
      service(storage).generate(payroll.cashier, payroll.periodId),
    ]);
    expect(second).toEqual(first);
    expect(storage.puts).toBe(2);
    expect(storage.objects.size).toBe(1);
    expect(await registersOf(payroll.agencyId)).toHaveLength(1);
    expect((await registerDocuments(payroll.agencyId)).map((each) => each.id)).toEqual([
      first.documentId,
    ]);
    expect(await generatedAudits(payroll.agencyId)).toHaveLength(1);
  });

  it('refuses a register whose results do not reconcile to their lines, storing nothing', async () => {
    const payroll = await finalizedPayroll('MISMATCH', [
      { ...twoEmployees[0]!, gross: '46000.01' },
      twoEmployees[1]!,
    ]);
    const storage = new RecordedStorage();
    await expect(
      service(storage).generate(payroll.preparer, payroll.periodId),
    ).rejects.toMatchObject({ statusCode: 409, code: 'PAYROLL_REGISTER_RECONCILIATION_FAILED' });
    expect(storage.puts).toBe(0);
    expect(await registersOf(payroll.agencyId)).toEqual([]);
    expect(await registerDocuments(payroll.agencyId)).toEqual([]);
    expect(await generatedAudits(payroll.agencyId)).toEqual([]);

    // The database refuses those totals too, whether taken from the results or the lines.
    const insert = (totals: { grossAmount: string; netAmount: string }) =>
      withDatabaseContext({ agencyId: payroll.agencyId }, (transaction) =>
        transaction.payrollRegister.create({
          data: {
            agencyId: payroll.agencyId,
            payrollPeriodId: payroll.periodId,
            calculationVersion: 2,
            documentId: randomUUID(),
            resultCount: 2,
            totalDeductions: '6660.5',
            generatedByMembershipId: payroll.preparer.membershipId,
            ...totals,
          },
        }),
      );
    await expect(insert({ grossAmount: '78000.26', netAmount: '71339.76' })).rejects.toThrow(
      /totals equal its finalized results and their lines/,
    );
    await expect(insert({ grossAmount: '78000.25', netAmount: '71339.75' })).rejects.toThrow(
      /totals equal its finalized results and their lines/,
    );
  });

  it('refuses results that no longer hash to the certification the period was finalized at', async () => {
    const payroll = await finalizedPayroll('REHASHED', twoEmployees);
    await seed((transaction) =>
      transaction.payrollCertification.updateMany({
        where: { agencyId: payroll.agencyId },
        data: { calculationHash: 'e'.repeat(64) },
      }),
    );
    await expect(
      service(new RecordedStorage()).generate(payroll.preparer, payroll.periodId),
    ).rejects.toMatchObject({ statusCode: 409, code: 'PAYROLL_REGISTER_RECONCILIATION_FAILED' });
    expect(await registersOf(payroll.agencyId)).toEqual([]);
  });

  it('needs the permission, a FINALIZED period, and the caller’s own Agency', async () => {
    const payroll = await finalizedPayroll('REFUSED', twoEmployees, 'APPROVED');
    const other = await finalizedPayroll('OTHER', twoEmployees);
    const storage = new RecordedStorage();
    await expect(service(storage).generate(payroll.reader, payroll.periodId)).rejects.toMatchObject(
      {
        statusCode: 403,
        code: 'PAYROLL_REGISTER_FORBIDDEN',
      },
    );
    await expect(
      service(storage).generate(payroll.preparer, payroll.periodId),
    ).rejects.toMatchObject({ statusCode: 409, code: 'PAYROLL_REGISTER_PAYROLL_NOT_FINALIZED' });
    await expect(service(storage).generate(payroll.preparer, other.periodId)).rejects.toMatchObject(
      {
        statusCode: 404,
        code: 'PAYROLL_PERIOD_NOT_FOUND',
      },
    );
    expect(storage.puts).toBe(0);
    expect(await registersOf(payroll.agencyId)).toEqual([]);
    expect(await registersOf(other.agencyId)).toEqual([]);
  });

  it('reads the register only once generated, and links its PDF through an audited access link', async () => {
    const payroll = await finalizedPayroll('READ', twoEmployees);
    const other = await finalizedPayroll('READ-OTHER', twoEmployees);
    const storage = new RecordedStorage();
    expect(await service(storage).read(payroll.preparer, payroll.periodId)).toBeNull();
    await expect(service(storage).file(payroll.preparer, payroll.periodId)).rejects.toMatchObject({
      statusCode: 404,
      code: 'PAYROLL_REGISTER_NOT_FOUND',
    });

    const register = await service(storage).generate(payroll.preparer, payroll.periodId);
    expect(await service(storage).read(payroll.cashier, payroll.periodId)).toEqual(register);
    const [document] = await registerDocuments(payroll.agencyId);
    const version = document!.versions[0]!;
    const { accessUrl, expiresAt } = await service(storage).file(payroll.cashier, payroll.periodId);
    expect(accessUrl).toBe(`https://storage.example.test/${version.storageKey}`);
    expect(Date.parse(expiresAt)).toBeGreaterThan(Date.now());
    const accesses = await admin.auditEvent.findMany({
      where: { agencyId: payroll.agencyId, action: 'DOCUMENT_ACCESS_LINK_ISSUED' },
    });
    expect(accesses).toEqual([
      expect.objectContaining({
        actorMembershipId: payroll.cashier.membershipId,
        entityId: version.id,
      }),
    ]);
    // Reading writes nothing.
    expect(await generatedAudits(payroll.agencyId)).toHaveLength(1);

    for (const read of ['read', 'file'] as const) {
      await expect(service(storage)[read](payroll.reader, payroll.periodId)).rejects.toMatchObject({
        statusCode: 403,
        code: 'PAYROLL_REGISTER_FORBIDDEN',
      });
      await expect(service(storage)[read](other.preparer, payroll.periodId)).rejects.toMatchObject({
        statusCode: 404,
        code: 'PAYROLL_PERIOD_NOT_FOUND',
      });
    }
  });

  it('keeps a register immutable and in its Agency', async () => {
    const payroll = await finalizedPayroll('GUARD', twoEmployees);
    const other = await finalizedPayroll('GUARD-OTHER', twoEmployees);
    const register = await service(new RecordedStorage()).generate(
      payroll.preparer,
      payroll.periodId,
    );
    await expect(
      admin.payrollRegister.update({ where: { id: register.id }, data: { resultCount: 3 } }),
    ).rejects.toThrow(/immutable and retained/);
    await expect(admin.payrollRegister.delete({ where: { id: register.id } })).rejects.toThrow(
      /immutable and retained/,
    );
    expect(
      await withDatabaseContext({ agencyId: other.agencyId }, (transaction) =>
        transaction.payrollRegister.findMany({ where: { id: register.id } }),
      ),
    ).toEqual([]);
  });
});
