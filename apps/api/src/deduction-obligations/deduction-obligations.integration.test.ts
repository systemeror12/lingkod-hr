import { PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { getConfig } from '@lingkod-hr/config';
import { createOperationalDatabaseClient, withDatabaseContext } from '@lingkod-hr/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { documentAuditWriter, DocumentsService } from '../documents/documents.service';
import { loadNationalPayrollRuleVersion } from '../payroll-rule-versions/load-national-payroll-rule-version';
import type { RecordDeductionObligationInput } from './deduction-obligations.schemas';
import { DeductionObligationsService } from './deduction-obligations.service';

const enabled = process.env.DATABASE_E2E === 'true';

// Test fixture only, not the GAA: the code carries a prefix the cleanup
// removes, and the year sits far past any real version.
const rulePrefix = 'TEST-352-';

async function createTenant(admin: PrismaClient, suffix: string, label: string) {
  const agency = await admin.agency.create({
    data: {
      code: `DOB-${label}-${suffix}`,
      name: `Deduction Obligation ${label} Agency`,
      agencyType: 'NGA',
      status: 'ACTIVE',
    },
  });
  const user = await admin.user.create({
    data: {
      emailNormalized: `deduction-obligation-${label}-${suffix}@example.test`,
      displayName: `Deduction Obligation ${label} User`,
      globalStatus: 'ACTIVE',
    },
  });
  const membership = await admin.agencyMembership.create({
    data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
  });
  const employee = await admin.employee.create({
    data: {
      agencyId: agency.id,
      employeeNumber: `EMP-${label}-${suffix}`,
      legalName: `Employee ${label}`,
      birthDate: new Date('1990-01-01'),
      sex: 'FEMALE',
      civilStatus: 'SINGLE',
      contactEmail: `deduction-obligation-employee-${label}-${suffix}@example.test`,
      serviceStatus: 'ACTIVE',
      createdByMembershipId: membership.id,
      updatedByMembershipId: membership.id,
    },
  });
  const document = await admin.document.create({
    data: {
      agencyId: agency.id,
      documentType: 'SALARY_DEDUCTION_AUTHORITY',
      classification: 'INTERNAL',
      status: 'APPROVED',
      createdByMembershipId: membership.id,
    },
  });
  const version = await admin.documentVersion.create({
    data: {
      agencyId: agency.id,
      documentId: document.id,
      versionNo: 1,
      storageKey: `deduction-obligations/${label}-${suffix}`,
      contentHash: 'd'.repeat(64),
      mimeType: 'application/pdf',
      sizeBytes: 1,
      issuedAt: new Date(),
      createdByMembershipId: membership.id,
    },
  });
  await admin.document.update({
    where: { id: document.id },
    data: { currentVersionId: version.id },
  });
  const context: RequestContext = {
    requestId: 'deduction-obligations-integration',
    userId: user.id,
    agencyId: agency.id,
    membershipId: membership.id,
    primaryOrganizationUnitId: null,
    permissions: [{ code: 'payroll.deductions.manage', scopePolicy: 'AGENCY' }],
  };
  const authority = { authorityDocumentId: document.id, authorityDocumentVersionId: version.id };
  return { agency, user, membership, employee, authority, context };
}

type Tenant = Awaited<ReturnType<typeof createTenant>>;

describe.skipIf(!enabled)('Deduction Obligations in PostgreSQL', () => {
  let admin: PrismaClient;
  let operator: PrismaClient;
  let home: Tenant;
  let foreign: Tenant;
  let ruleVersionId: string;
  const service = new DeductionObligationsService(
    new DocumentsService({} as never, documentAuditWriter),
  );
  const suffix = `${Date.now()}`;

  const loan = (overrides: Partial<RecordDeductionObligationInput> = {}) => ({
    payeeCategory: 'GSIS' as const,
    payeeName: 'Government Service Insurance System',
    issuerReference: `LOAN-${suffix}`,
    incurredOn: '2960-01-15',
    outstandingBalance: '24000.00',
    scheduledAmount: '2000',
    effectiveFrom: '2960-02-01',
    ...home.authority,
    ...overrides,
  });

  async function removeRuleVersions(): Promise<void> {
    await admin.$transaction(async (transaction) => {
      // The rule-version immutability trigger is the point of the table; only the test lifts it.
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await transaction.$executeRaw`DELETE FROM deduction_obligations WHERE payee_rule_version_id IN (SELECT id FROM national_payroll_rule_versions WHERE code LIKE ${`${rulePrefix}%`})`;
      await transaction.$executeRaw`DELETE FROM national_payroll_rule_versions WHERE code LIKE ${`${rulePrefix}%`}`;
    });
  }

  beforeAll(async () => {
    const adminUrl = process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
    const operationalUrl = getConfig().DATABASE_OPERATIONAL_URL;
    if (!adminUrl || !operationalUrl) {
      throw new Error('DATABASE_E2E_ADMIN_URL and DATABASE_OPERATIONAL_URL are required.');
    }
    admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
    operator = createOperationalDatabaseClient(operationalUrl);
    await removeRuleVersions();
    home = await createTenant(admin, suffix, 'A');
    foreign = await createTenant(admin, suffix, 'B');
    // The 2960 version allows three categories; LICENSED_INSURER is not one.
    const loaded = await loadNationalPayrollRuleVersion(operator, {
      ruleKind: 'AUTHORIZED_DEDUCTIONS',
      code: `${rulePrefix}2960`,
      name: 'Test authorized deductions 2960',
      issuingAuthority: 'Test authority',
      issuanceReference: 'Test fixture, not an issuance',
      sourceUrl: 'https://example.test/gaa',
      researchRegister: 'docs/research/national-payroll-rule-versions-2027.md#R16',
      verifiedOn: '2026-11-15',
      verifiedBy: 'LingkodHR test fixture',
      effectiveFrom: '2960-01-01',
      effectiveTo: '2960-12-31',
      supersedesCode: null,
      parameters: {
        allowedPayeeCategories: ['GSIS', 'HDMF', 'EMPLOYEE_COOPERATIVE_OR_ASSOCIATION'],
      },
    });
    ruleVersionId = loaded.id;
  });

  afterAll(async () => {
    await admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      for (const { agency, user } of [home, foreign]) {
        await transaction.auditEvent.deleteMany({ where: { agencyId: agency.id } });
        await transaction.deductionObligation.deleteMany({ where: { agencyId: agency.id } });
        await transaction.document.updateMany({
          where: { agencyId: agency.id },
          data: { currentVersionId: null },
        });
        await transaction.documentVersion.deleteMany({ where: { agencyId: agency.id } });
        await transaction.document.deleteMany({ where: { agencyId: agency.id } });
        await transaction.employee.deleteMany({ where: { agencyId: agency.id } });
        await transaction.agencyMembership.deleteMany({ where: { agencyId: agency.id } });
        await transaction.agency.delete({ where: { id: agency.id } });
        await transaction.user.delete({ where: { id: user.id } });
      }
    });
    await removeRuleVersions();
    await Promise.all([admin.$disconnect(), operator.$disconnect()]);
  });

  const obligationCount = () =>
    admin.deductionObligation.count({ where: { agencyId: home.agency.id } });

  it('refuses a payee the rule version does not allow, and any payee with no version in effect', async () => {
    await expect(
      service.record(
        home.context,
        home.employee.id,
        loan({ payeeCategory: 'LICENSED_INSURER', payeeName: 'Insurer' }),
      ),
    ).rejects.toMatchObject({ code: 'DEDUCTION_PAYEE_NOT_ALLOWED', statusCode: 422 });
    await expect(
      service.record(home.context, home.employee.id, loan({ effectiveFrom: '2961-01-01' })),
    ).rejects.toMatchObject({ code: 'PAYROLL_RULE_VERSION_MISSING' });
    expect(await obligationCount()).toBe(0);
    expect(await admin.auditEvent.count({ where: { agencyId: home.agency.id } })).toBe(0);
  });

  it('keeps every version through a change and an end, with an Audit Event for each', async () => {
    const recorded = await service.record(home.context, home.employee.id, loan());
    expect(recorded).toMatchObject({
      status: 'ACTIVE',
      payeeCategory: 'GSIS',
      outstandingBalance: '24000.0000',
      scheduledAmount: '2000.0000',
      incurredOn: '2960-01-15',
      payeeRuleVersionId: ruleVersionId,
      supersedesObligationId: null,
    });
    await expect(
      service.record(home.context, home.employee.id, loan({ issuerReference: `loan-${suffix}` })),
    ).rejects.toMatchObject({ code: 'DEDUCTION_OBLIGATION_DUPLICATE' });

    const terms = { ...home.authority, outstandingBalance: '20000', scheduledAmount: '2000' };
    await expect(
      service.change(home.context, recorded.id, {
        ...terms,
        effectiveFrom: '2960-01-31',
        reason: 'Too early',
      }),
    ).rejects.toMatchObject({ code: 'DEDUCTION_OBLIGATION_EFFECTIVE_PERIOD_INVALID' });
    // A change into a year with no authorized-deductions version is refused.
    await expect(
      service.change(home.context, recorded.id, {
        ...terms,
        effectiveFrom: '2961-01-01',
        reason: 'Next year',
      }),
    ).rejects.toMatchObject({ code: 'PAYROLL_RULE_VERSION_MISSING' });

    const changed = await service.change(home.context, recorded.id, {
      ...terms,
      effectiveFrom: '2960-04-01',
      reason: 'Issuer statement of 2960-03-31',
    });
    expect(changed).toMatchObject({
      status: 'ACTIVE',
      supersedesObligationId: recorded.id,
      outstandingBalance: '20000.0000',
      issuerReference: recorded.issuerReference,
      incurredOn: '2960-01-15',
      changeReason: 'Issuer statement of 2960-03-31',
    });
    await expect(
      service.end(home.context, recorded.id, { effectiveTo: '2960-12-31', reason: 'Paid' }),
    ).rejects.toMatchObject({ code: 'DEDUCTION_OBLIGATION_NOT_ACTIVE' });

    const ended = await service.end(home.context, changed.id, {
      effectiveTo: '2960-10-31',
      reason: 'Paid in full per issuer notice',
    });
    expect(ended).toMatchObject({ status: 'ENDED', effectiveTo: '2960-10-31' });
    await expect(
      service.change(home.context, changed.id, {
        ...terms,
        effectiveFrom: '2960-11-01',
        reason: 'After end',
      }),
    ).rejects.toMatchObject({ code: 'DEDUCTION_OBLIGATION_NOT_ACTIVE' });

    const rows = await admin.deductionObligation.findMany({
      where: { agencyId: home.agency.id },
      orderBy: { recordedAt: 'asc' },
    });
    expect(rows.map((row) => [row.id, row.status])).toEqual([
      [recorded.id, 'SUPERSEDED'],
      [changed.id, 'ENDED'],
    ]);
    expect(rows[0]?.outstandingBalance.toFixed(4)).toBe('24000.0000');

    const events = await admin.auditEvent.findMany({
      where: { agencyId: home.agency.id, entityType: 'DeductionObligation' },
      orderBy: { occurredAt: 'asc' },
    });
    expect(events.map((event) => [event.action, event.entityId, event.newStatus])).toEqual([
      ['DEDUCTION_OBLIGATION_RECORDED', recorded.id, 'ACTIVE'],
      ['DEDUCTION_OBLIGATION_CHANGED', changed.id, 'ACTIVE'],
      ['DEDUCTION_OBLIGATION_ENDED', changed.id, 'ENDED'],
    ]);
    expect(events.every((event) => event.actorMembershipId === home.membership.id)).toBe(true);

    // The database keeps history even against a direct write.
    await expect(
      withDatabaseContext(home.context, (transaction) =>
        transaction.deductionObligation.update({
          where: { id: recorded.id },
          data: { outstandingBalance: 1 },
        }),
      ),
    ).rejects.toThrow(/cannot change/);
    await expect(
      withDatabaseContext(home.context, (transaction) =>
        transaction.deductionObligation.delete({ where: { id: changed.id } }),
      ),
    ).rejects.toThrow();
    // Superseding without a successor fails at commit.
    const lone = await service.record(
      home.context,
      home.employee.id,
      loan({ payeeCategory: 'HDMF', payeeName: 'Pag-IBIG Fund', issuerReference: 'MPL-1' }),
    );
    await expect(
      withDatabaseContext(home.context, (transaction) =>
        transaction.deductionObligation.update({
          where: { id: lone.id },
          data: { status: 'SUPERSEDED' },
        }),
      ),
    ).rejects.toThrow(/successor/);
  });

  it('rejects another Agency at the service and in the database', async () => {
    const homeObligation = await service.record(
      home.context,
      home.employee.id,
      loan({ payeeCategory: 'EMPLOYEE_COOPERATIVE_OR_ASSOCIATION', payeeName: 'Coop' }),
    );
    const before = await obligationCount();

    await expect(
      service.record(foreign.context, home.employee.id, loan(foreign.authority)),
    ).rejects.toMatchObject({ code: 'EMPLOYEE_NOT_FOUND' });
    await expect(
      service.record(foreign.context, foreign.employee.id, loan()),
    ).rejects.toMatchObject({ code: 'DEDUCTION_OBLIGATION_AUTHORITY_NOT_FOUND' });
    await expect(
      service.change(foreign.context, homeObligation.id, {
        ...foreign.authority,
        outstandingBalance: '1',
        scheduledAmount: '1',
        effectiveFrom: '2960-05-01',
        reason: 'Foreign',
      }),
    ).rejects.toMatchObject({ code: 'DEDUCTION_OBLIGATION_NOT_FOUND' });
    await expect(
      service.end(foreign.context, homeObligation.id, { effectiveTo: '2960-05-01', reason: 'x' }),
    ).rejects.toMatchObject({ code: 'DEDUCTION_OBLIGATION_NOT_FOUND' });

    // Under forced RLS a foreign context neither sees nor writes home rows.
    await expect(
      withDatabaseContext(foreign.context, (transaction) =>
        transaction.deductionObligation.count({ where: { agencyId: home.agency.id } }),
      ),
    ).resolves.toBe(0);
    await expect(
      withDatabaseContext(foreign.context, (transaction) =>
        transaction.deductionObligation.create({
          data: {
            agencyId: home.agency.id,
            employeeId: home.employee.id,
            payeeCategory: 'GSIS',
            payeeName: 'GSIS',
            issuerReference: 'FOREIGN',
            incurredOn: new Date('2960-01-01'),
            outstandingBalance: 1,
            scheduledAmount: 1,
            authorityDocumentVersionId: home.authority.authorityDocumentVersionId,
            payeeRuleVersionId: ruleVersionId,
            effectiveFrom: new Date('2960-02-01'),
            status: 'ACTIVE',
            recordedByMembershipId: foreign.membership.id,
          },
        }),
      ),
    ).rejects.toThrow();
    expect(await obligationCount()).toBe(before);

    // Without the permission held Agency-wide, nothing is recorded.
    await expect(
      service.record(
        { ...home.context, permissions: [] },
        home.employee.id,
        loan({ issuerReference: 'NO-PERMISSION' }),
      ),
    ).rejects.toMatchObject({ code: 'DEDUCTION_OBLIGATION_MANAGE_FORBIDDEN', statusCode: 403 });
  });
});
