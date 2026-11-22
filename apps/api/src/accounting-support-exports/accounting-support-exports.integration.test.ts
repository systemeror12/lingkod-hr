import type { RequestContext } from '@lingkod-hr/auth';
import type { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DocumentsService } from '../documents/documents.service';
import { payrollCalculationHash } from '../payroll-calculation/calculation-hash';
import {
  cleanupPayrollTenants,
  createAdminClient,
  createPayrollTenant,
  type PayrollTenant,
} from '../payroll-periods/payroll-periods.test-fixtures';
import {
  ACCOUNTING_SUPPORT_EXPORT_DOWNLOADED,
  ACCOUNTING_SUPPORT_EXPORT_GENERATED,
  AccountingSupportExportsService,
} from './accounting-support-exports.service';

const enabled = process.env.DATABASE_E2E === 'true';

/** One Employee of a seeded finalized payroll. `earningLine` defaults to `gross`. */
interface EmployeeSpec {
  number: string;
  gross: string;
  deductions: string;
  earningLine?: string;
}

describe.skipIf(!enabled)('Finalized Payroll Accounting Support Export in PostgreSQL', () => {
  const suffix = `${Date.now()}-accounting-export`;
  const service = new AccountingSupportExportsService(
    new DocumentsService({} as never, {} as never),
  );
  let admin: PrismaClient;
  let earningComponentId: string;
  let deductionComponentId: string;
  const tenants: PayrollTenant[] = [];

  beforeAll(async () => {
    admin = await createAdminClient();
    const component = async (category: string) =>
      (await admin.payComponent.findFirstOrThrow({ where: { category }, select: { id: true } })).id;
    earningComponentId = await component('EARNING');
    deductionComponentId = await component('DEDUCTION');
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      const where = { agencyId: { in: tenants.map((each) => each.agency.id) } };
      await transaction.payrollExportExternalOutcome.deleteMany({ where });
      await transaction.finalizedPayrollAccountingSupportExport.deleteMany({ where });
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
   * An Agency of its own with a REGULAR March 2873 period in `status` at
   * calculation version 1, certified, with one result per spec carrying an
   * earning line and a deduction line. Person 0 generates, person 1 holds the
   * companion permission, person 2 records outcomes.
   */
  async function finalizedPayroll(label: string, specs: EmployeeSpec[], status = 'FINALIZED') {
    const tenant = await createPayrollTenant(admin, suffix, `ACCOUNTING-EXPORT-${label}`, 3);
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
          code: `PAY-2873-03-${label}`,
          runType: 'REGULAR',
          periodFrom: new Date('2873-03-01'),
          periodTo: new Date('2873-03-31'),
          cutoffAt: new Date('2873-03-20T00:00:00Z'),
          paymentDate: new Date('2873-03-31'),
          status,
          calculationVersion: 1,
          finalizedAt: status === 'FINALIZED' ? new Date() : null,
        },
      });
      const hashes = [];
      for (const [index, spec] of specs.entries()) {
        const employee = await transaction.employee.create({
          data: {
            agencyId: agency.id,
            employeeNumber: `${spec.number}-${label}`,
            legalName: `Accounting Payee ${spec.number}`,
            birthDate: new Date('1990-01-01'),
            sex: 'FEMALE',
            civilStatus: 'SINGLE',
            contactEmail:
              `accounting-export-${label}-${spec.number}-${suffix}@example.test`.toLowerCase(),
            serviceStatus: 'ACTIVE',
            createdByMembershipId: membershipId,
            updatedByMembershipId: membershipId,
          },
        });
        const calculationHash = String(index).repeat(64);
        hashes.push({ employeeId: employee.id, calculationHash });
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
            netAmount: (Number(spec.gross) - Number(spec.deductions)).toFixed(4),
            calculationHash,
          },
        });
        for (const [payComponentId, lineType, amount] of [
          [earningComponentId, 'EARNING', spec.earningLine ?? spec.gross],
          [deductionComponentId, 'DEDUCTION', spec.deductions],
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
      }
      await transaction.payrollCertification.create({
        data: {
          agencyId: agency.id,
          payrollPeriodId: period.id,
          calculationVersion: 1,
          calculationHash: payrollCalculationHash(hashes),
          certifiedByMembershipId: persons[1]!.membership.id,
        },
      });
      return period.id;
    });
    return {
      tenant,
      periodId,
      generator: as(0, ['payroll.accounting_exports.generate']),
      detailReader: as(1, ['payroll.accounting_exports.generate', 'payroll.export_detail.read']),
      recorder: as(2, ['payroll.export_outcomes.record']),
    };
  }

  /** A Document Version standing for External Evidence such as a JEV. */
  async function evidenceVersion(tenant: PayrollTenant, label: string, issued: boolean) {
    const { agency, persons } = tenant;
    const document = await admin.document.create({
      data: {
        agencyId: agency.id,
        documentType: 'EXTERNAL_EVIDENCE',
        classification: 'INTERNAL',
        status: issued ? 'APPROVED' : 'DRAFT',
        createdByMembershipId: persons[0]!.membership.id,
      },
    });
    const version = await admin.documentVersion.create({
      data: {
        agencyId: agency.id,
        documentId: document.id,
        versionNo: 1,
        storageKey: `accounting-export/${agency.id}/${label}`,
        contentHash: 'c'.repeat(64),
        mimeType: 'application/pdf',
        sizeBytes: 1,
        issuedAt: issued ? new Date() : null,
        createdByMembershipId: persons[0]!.membership.id,
      },
    });
    await admin.document.update({
      where: { id: document.id },
      data: { currentVersionId: version.id },
    });
    return version.id;
  }

  const auditOf = (agencyId: string, action: string) =>
    admin.auditEvent.findMany({ where: { agencyId, action }, orderBy: { occurredAt: 'asc' } });

  const specs: EmployeeSpec[] = [
    { number: 'E-001', gross: '30000.0000', deductions: '4500.2500' },
    { number: 'E-002', gross: '21000.5000', deductions: '0.0000' },
  ];

  it('generates once from the finalized payroll and returns the same artifact again', async () => {
    const payroll = await finalizedPayroll('REPEAT', specs);
    const agencyId = payroll.tenant.agency.id;

    const first = await service.generate(payroll.generator, payroll.periodId);
    expect(first).toMatchObject({
      payrollPeriodId: payroll.periodId,
      calculationVersion: 1,
      contract: { code: 'FINALIZED_PAYROLL_ACCOUNTING_SUPPORT_EXPORT', version: 1 },
      reconciliation: {
        resultCount: 2,
        sourceLineCount: 4,
        classifiedSourceLineCount: 4,
        grossAmount: '51000.5000',
        totalDeductions: '4500.2500',
        netAmount: '46500.2500',
      },
      externalOutcomes: [],
    });

    const again = await service.generate(payroll.generator, payroll.periodId);
    const byAnother = await service.generate(payroll.detailReader, payroll.periodId);
    expect(again).toEqual(first);
    expect(byAnother).toEqual(first);
    expect(await admin.finalizedPayrollAccountingSupportExport.count({ where: { agencyId } })).toBe(
      1,
    );
    const generated = await auditOf(agencyId, ACCOUNTING_SUPPORT_EXPORT_GENERATED);
    expect(generated).toHaveLength(1);
    expect(generated[0]).toMatchObject({ entityId: first.id, idempotencyKey: 'generated' });

    const stored = await admin.finalizedPayrollAccountingSupportExport.findUniqueOrThrow({
      where: { id: first.id },
    });
    const content = JSON.parse(stored.content);
    expect(content.statement).toContain('not a journal entry');
    expect(content.employeeDetailChecksum).toBe(stored.employeeDetailChecksum);
    expect(stored.content).not.toContain('Accounting Payee');
  });

  it('refuses a payroll that does not reconcile and stores nothing', async () => {
    const payroll = await finalizedPayroll('UNRECONCILED', [
      specs[0]!,
      { number: 'E-002', gross: '21000.5000', deductions: '0.0000', earningLine: '21000.0000' },
    ]);
    const agencyId = payroll.tenant.agency.id;

    await expect(service.generate(payroll.generator, payroll.periodId)).rejects.toMatchObject({
      statusCode: 409,
      code: 'PAYROLL_EXPORT_RECONCILIATION_FAILED',
    });
    expect(await admin.finalizedPayrollAccountingSupportExport.count({ where: { agencyId } })).toBe(
      0,
    );
    expect(await auditOf(agencyId, ACCOUNTING_SUPPORT_EXPORT_GENERATED)).toHaveLength(0);
  });

  it('refuses a payroll that is not FINALIZED, and the database refuses one too', async () => {
    const payroll = await finalizedPayroll('APPROVED', specs, 'APPROVED');
    await expect(service.generate(payroll.generator, payroll.periodId)).rejects.toMatchObject({
      statusCode: 409,
      code: 'PAYROLL_ACCOUNTING_EXPORT_PAYROLL_NOT_FINALIZED',
    });
    const contract = await admin.payrollExportContractVersion.findFirstOrThrow({
      where: { code: 'FINALIZED_PAYROLL_ACCOUNTING_SUPPORT_EXPORT' },
    });
    await expect(
      admin.finalizedPayrollAccountingSupportExport.create({
        data: {
          agencyId: payroll.tenant.agency.id,
          payrollPeriodId: payroll.periodId,
          calculationVersion: 1,
          calculationHash: 'a'.repeat(64),
          payrollExportContractVersionId: contract.id,
          content: '{}',
          checksum: '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
          employeeDetailContent: '{}',
          employeeDetailChecksum:
            '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
          generatedByMembershipId: payroll.tenant.persons[0]!.membership.id,
        },
      }),
    ).rejects.toThrow(/only from a FINALIZED payroll/);
  });

  it('keeps the companion behind its own permission, with totals equal to the export', async () => {
    const payroll = await finalizedPayroll('COMPANION', specs);
    const generated = await service.generate(payroll.generator, payroll.periodId);

    await expect(
      service.downloadEmployeeDetail(payroll.generator, payroll.periodId, generated.id),
    ).rejects.toMatchObject({ statusCode: 403, code: 'PAYROLL_ACCOUNTING_EXPORT_FORBIDDEN' });

    const exported = await service.downloadExport(
      payroll.generator,
      payroll.periodId,
      generated.id,
    );
    const companion = await service.downloadEmployeeDetail(
      payroll.detailReader,
      payroll.periodId,
      generated.id,
    );
    expect(exported.checksum).toBe(generated.checksum);
    expect(companion.checksum).toBe(generated.employeeDetailChecksum);
    const content = JSON.parse(exported.content);
    const detail = JSON.parse(companion.content);
    expect(detail.accountingSupportExportId).toBe(generated.id);
    expect(detail.employees).toHaveLength(2);
    expect(detail.employees[0]).toMatchObject({
      employeeNumber: 'E-001-COMPANION',
      legalName: 'Accounting Payee E-001',
      netAmount: '25499.7500',
    });
    expect(detail.totals).toEqual({
      classifiedLines: content.classifiedLines,
      reconciliation: content.reconciliation,
    });
  });

  it('audits a download and records no outcome for it', async () => {
    const payroll = await finalizedPayroll('DOWNLOAD', specs);
    const agencyId = payroll.tenant.agency.id;
    const generated = await service.generate(payroll.generator, payroll.periodId);

    await service.downloadExport(payroll.generator, payroll.periodId, generated.id);
    await service.downloadEmployeeDetail(payroll.detailReader, payroll.periodId, generated.id);

    const downloads = await auditOf(agencyId, ACCOUNTING_SUPPORT_EXPORT_DOWNLOADED);
    expect(downloads.map((event) => event.metadata)).toEqual([
      { payrollPeriodId: payroll.periodId, artifact: 'EXPORT', checksum: generated.checksum },
      {
        payrollPeriodId: payroll.periodId,
        artifact: 'EMPLOYEE_DETAIL',
        checksum: generated.employeeDetailChecksum,
      },
    ]);
    expect(await admin.payrollExportExternalOutcome.count({ where: { agencyId } })).toBe(0);
    expect((await service.generate(payroll.generator, payroll.periodId)).externalOutcomes).toEqual(
      [],
    );
  });

  it('records External Outcomes as append-only evidence that never changes the export', async () => {
    const payroll = await finalizedPayroll('OUTCOMES', specs);
    const generated = await service.generate(payroll.generator, payroll.periodId);
    const evidence = await evidenceVersion(payroll.tenant, 'jev', true);
    const draft = await evidenceVersion(payroll.tenant, 'draft', false);
    const record = (context: RequestContext, input: unknown) =>
      service.recordOutcome(context, payroll.periodId, generated.id, input);

    await expect(record(payroll.generator, { outcome: 'HANDED_OFF' })).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(
      record(payroll.recorder, { outcome: 'POSTED', externalReference: 'JEV-1' }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_INPUT' });
    await expect(
      record(payroll.recorder, {
        outcome: 'POSTED',
        externalReference: 'JEV-1',
        evidenceDocumentVersionId: draft,
      }),
    ).rejects.toMatchObject({ code: 'PAYROLL_EXPORT_OUTCOME_EVIDENCE_INVALID' });

    const handedOff = await record(payroll.recorder, { outcome: 'HANDED_OFF' });
    const returned = await record(payroll.recorder, {
      outcome: 'RETURNED',
      externalReference: 'RET-2873-03',
      evidenceDocumentVersionId: evidence,
      reason: 'Accounting asked for the March payroll to be handed off again.',
    });
    const posted = await record(payroll.recorder, {
      outcome: 'POSTED',
      externalReference: 'JEV-2873-03-0001',
      evidenceDocumentVersionId: evidence,
    });
    expect(posted).toMatchObject({
      accountingSupportExportId: generated.id,
      outcome: 'POSTED',
      externalReference: 'JEV-2873-03-0001',
      evidenceDocumentVersionId: evidence,
      reason: null,
      recordedByMembershipId: payroll.recorder.membershipId,
    });

    const after = await service.generate(payroll.generator, payroll.periodId);
    expect(after.externalOutcomes.map((outcome) => outcome.id)).toEqual([
      handedOff.id,
      returned.id,
      posted.id,
    ]);
    expect({ ...after, externalOutcomes: [] }).toEqual(generated);

    await expect(
      admin.payrollExportExternalOutcome.update({
        where: { id: posted.id },
        data: { outcome: 'RECEIVED' },
      }),
    ).rejects.toThrow(/append-only/);
    await expect(
      admin.payrollExportExternalOutcome.delete({ where: { id: handedOff.id } }),
    ).rejects.toThrow(/append-only/);
    await expect(
      admin.finalizedPayrollAccountingSupportExport.update({
        where: { id: generated.id },
        data: { generatedAt: new Date() },
      }),
    ).rejects.toThrow(/immutable/);
  });

  it('seeds the three permissions for the Accounting Reviewer only', async () => {
    const grants = await admin.$queryRaw<{ role: string; permission: string }[]>`
      SELECT r."code" AS "role", p."code" AS "permission"
      FROM "role_permissions" rp
      JOIN "roles" r ON r."id" = rp."role_id" AND r."agency_id" IS NULL
      JOIN "permissions" p ON p."id" = rp."permission_id"
      WHERE p."code" IN ('payroll.accounting_exports.generate',
                         'payroll.export_detail.read',
                         'payroll.export_outcomes.record')
      ORDER BY p."code"
    `;
    expect(grants).toEqual([
      { role: 'accounting_reviewer', permission: 'payroll.accounting_exports.generate' },
      { role: 'accounting_reviewer', permission: 'payroll.export_detail.read' },
      { role: 'accounting_reviewer', permission: 'payroll.export_outcomes.record' },
    ]);
  });
});
