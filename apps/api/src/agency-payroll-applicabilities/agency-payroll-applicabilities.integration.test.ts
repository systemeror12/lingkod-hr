import { PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DocumentsService } from '../documents/documents.service';
import { findAgencyPayrollApplicability } from './agency-payroll-applicabilities.records';
import type { RecordApplicability } from './agency-payroll-applicabilities.schemas';
import { EndAgencyPayrollApplicabilityService } from './end-agency-payroll-applicability.service';
import { RecordAgencyPayrollApplicabilityService } from './record-agency-payroll-applicability.service';

const enabled = process.env.DATABASE_E2E === 'true';

// Test fixtures only: the components carry a prefix the cleanup removes and
// are not catalogue rows.
const prefix = 'TEST-618-';

function adminUrl(): string {
  const url = process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
  if (!url) throw new Error('A database owner URL is required for the integration test.');
  return url;
}

async function createTenant(admin: PrismaClient, suffix: string, label: string) {
  const agency = await admin.agency.create({
    data: {
      code: `APA-${label}-${suffix}`,
      name: `Applicability ${label} Agency`,
      agencyType: 'NGA',
      status: 'ACTIVE',
    },
  });
  const user = await admin.user.create({
    data: {
      emailNormalized: `apa-${label}-${suffix}@example.test`,
      displayName: `Applicability ${label}`,
      globalStatus: 'ACTIVE',
    },
  });
  const membership = await admin.agencyMembership.create({
    data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
  });
  const employee = (index: number) =>
    admin.employee.create({
      data: {
        agencyId: agency.id,
        employeeNumber: `EMP-${label}-${index}-${suffix}`,
        legalName: `Employee ${label} ${index}`,
        birthDate: new Date('1990-01-01'),
        sex: 'FEMALE',
        civilStatus: 'SINGLE',
        contactEmail: `apa-employee-${label}-${index}-${suffix}@example.test`,
        serviceStatus: 'ACTIVE',
        createdByMembershipId: membership.id,
        updatedByMembershipId: membership.id,
      },
    });
  const authority = async (issued: boolean) => {
    const document = await admin.document.create({
      data: {
        agencyId: agency.id,
        documentType: 'AGENCY_ISSUANCE',
        classification: 'INTERNAL',
        status: issued ? 'APPROVED' : 'DRAFT',
        createdByMembershipId: membership.id,
      },
    });
    const version = await admin.documentVersion.create({
      data: {
        agencyId: agency.id,
        documentId: document.id,
        versionNo: 1,
        storageKey: `apa/${label}-${suffix}/${issued ? 'issued' : 'draft'}`,
        contentHash: 'c'.repeat(64),
        mimeType: 'application/pdf',
        sizeBytes: 1,
        issuedAt: issued ? new Date() : null,
        createdByMembershipId: membership.id,
      },
    });
    await admin.document.update({
      where: { id: document.id },
      data: { currentVersionId: version.id },
    });
    return version;
  };
  return {
    agency,
    user,
    membership,
    employee: await employee(1),
    otherEmployee: await employee(2),
    authority: await authority(true),
    draftAuthority: await authority(false),
  };
}

type Tenant = Awaited<ReturnType<typeof createTenant>>;

function contextOf(
  tenant: Tenant,
  permissions: RequestContext['permissions'] = [
    { code: 'payroll.compensation.manage', scopePolicy: 'AGENCY' },
  ],
): RequestContext {
  return {
    requestId: 'applicability-integration',
    userId: tenant.user.id,
    agencyId: tenant.agency.id,
    membershipId: tenant.membership.id,
    primaryOrganizationUnitId: null,
    permissions,
  };
}

const scopeOf = (tenant: Tenant) => ({
  agencyId: tenant.agency.id,
  userId: tenant.user.id,
  membershipId: tenant.membership.id,
});

describe.skipIf(!enabled)('Agency Payroll Applicability in PostgreSQL', () => {
  let admin: PrismaClient;
  const suffix = `${Date.now()}`;
  const tenants: Tenant[] = [];
  let home: Tenant;
  let foreign: Tenant;
  const components = { conditional: '', gaa: '', unconditional: '' };
  const record = new RecordAgencyPayrollApplicabilityService(
    new DocumentsService({} as never, {} as never),
  );
  const end = new EndAgencyPayrollApplicabilityService();

  beforeAll(async () => {
    admin = new PrismaClient({ datasources: { db: { url: adminUrl() } } });
    home = await createTenant(admin, suffix, 'A');
    tenants.push(home);
    foreign = await createTenant(admin, suffix, 'B');
    tenants.push(foreign);
    const component = async (label: string, isConditional: boolean, isGaaRevalidated: boolean) =>
      (
        await admin.payComponent.create({
          data: {
            code: `${prefix}${label}-${suffix}`,
            name: `Test component ${label}`,
            category: 'EARNING',
            isConditional,
            isGaaRevalidated,
            acceptsAuthorizedInput: false,
          },
        })
      ).id;
    components.conditional = await component('CONDITIONAL', true, false);
    components.gaa = await component('GAA', true, true);
    components.unconditional = await component('UNCONDITIONAL', false, false);
  });

  afterAll(async () => {
    await admin.$transaction(async (transaction) => {
      // The retention guard is the point; only the test lifts it.
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      for (const { agency, user } of tenants) {
        const agencyId = agency.id;
        await transaction.agencyPayrollApplicability.deleteMany({ where: { agencyId } });
        await transaction.auditEvent.deleteMany({ where: { agencyId } });
        await transaction.document.updateMany({
          where: { agencyId },
          data: { currentVersionId: null },
        });
        await transaction.documentVersion.deleteMany({ where: { agencyId } });
        await transaction.document.deleteMany({ where: { agencyId } });
        await transaction.employee.deleteMany({ where: { agencyId } });
        await transaction.agencyMembership.deleteMany({ where: { agencyId } });
        await transaction.agency.delete({ where: { id: agencyId } });
        await transaction.user.delete({ where: { id: user.id } });
      }
      await transaction.payComponent.deleteMany({ where: { code: { startsWith: prefix } } });
    });
    await admin.$disconnect();
  });

  const submission = (overrides: Partial<RecordApplicability> = {}): RecordApplicability => ({
    payComponentId: components.conditional,
    scope: 'AGENCY',
    employeeId: null,
    authorityDocumentVersionId: home.authority.id,
    fundingReference: 'Test fixture, not an allotment',
    effectiveFrom: '2040-01-01',
    effectiveTo: null,
    ...overrides,
  });
  const homeCount = () =>
    admin.agencyPayrollApplicability.count({ where: { agencyId: home.agency.id } });
  const lookup = (payComponentId: string, employeeId: string | null, on: string) =>
    withDatabaseContext(scopeOf(home), (transaction) =>
      findAgencyPayrollApplicability(transaction, {
        agencyId: home.agency.id,
        payComponentId,
        employeeId,
        on,
      }),
    );

  it('records and ends a record with Audit Events, and the lookup follows it', async () => {
    const recorded = await record.execute(contextOf(home), submission());
    expect(recorded).toMatchObject({
      scope: 'AGENCY',
      employeeId: null,
      effectiveFrom: '2040-01-01',
      effectiveTo: null,
      recordedByMembershipId: home.membership.id,
    });
    const scoped = await record.execute(
      contextOf(home),
      submission({
        scope: 'EMPLOYEE',
        employeeId: home.employee.id,
        effectiveFrom: '2040-03-01',
        effectiveTo: '2040-03-31',
      }),
    );

    await expect(lookup(components.conditional, null, '2039-12-31')).resolves.toEqual({
      status: 'NOT_APPLICABLE',
    });
    await expect(lookup(components.conditional, null, '2040-02-01')).resolves.toEqual({
      status: 'APPLICABLE',
      applicabilityId: recorded.id,
    });
    // A named Employee's own record answers before the Agency-wide one.
    await expect(lookup(components.conditional, home.employee.id, '2040-03-15')).resolves.toEqual({
      status: 'APPLICABLE',
      applicabilityId: scoped.id,
    });
    // An unconditional component applies with no record.
    await expect(lookup(components.unconditional, null, '2040-02-01')).resolves.toEqual({
      status: 'APPLICABLE',
      applicabilityId: null,
    });

    const ended = await end.execute(contextOf(home), recorded.id, {
      effectiveTo: '2040-06-30',
      reason: 'Funding withdrawn',
    });
    expect(ended).toEqual({ ...recorded, effectiveTo: '2040-06-30' });
    await expect(lookup(components.conditional, null, '2040-07-01')).resolves.toEqual({
      status: 'EXPIRED',
      applicabilityId: recorded.id,
      endedOn: '2040-06-30',
    });
    await expect(lookup(components.conditional, home.employee.id, '2040-07-01')).resolves.toEqual({
      status: 'EXPIRED',
      applicabilityId: recorded.id,
      endedOn: '2040-06-30',
    });
    // Another Employee falls back to the Agency-wide record.
    await expect(
      lookup(components.conditional, home.otherEmployee.id, '2040-03-15'),
    ).resolves.toEqual({ status: 'APPLICABLE', applicabilityId: recorded.id });

    const events = await admin.auditEvent.findMany({
      where: { agencyId: home.agency.id, entityId: recorded.id },
      orderBy: { occurredAt: 'asc' },
    });
    expect(events.map((event) => [event.action, event.actorMembershipId, event.reason])).toEqual([
      ['AGENCY_PAYROLL_APPLICABILITY_RECORDED', home.membership.id, null],
      ['AGENCY_PAYROLL_APPLICABILITY_ENDED', home.membership.id, 'Funding withdrawn'],
    ]);
  });

  it('ends a record only by bringing its end forward', async () => {
    const recorded = await record.execute(
      contextOf(home),
      submission({ effectiveFrom: '2041-01-01', effectiveTo: '2041-12-31' }),
    );
    for (const effectiveTo of ['2041-12-31', '2042-01-31', '2040-12-31']) {
      await expect(
        end.execute(contextOf(home), recorded.id, { effectiveTo, reason: 'Test' }),
        effectiveTo,
      ).rejects.toMatchObject({ code: 'APPLICABILITY_END_INVALID' });
    }
    await expect(
      end.execute(contextOf(home), recorded.id, { effectiveTo: '2041-05-31' } as never),
    ).rejects.toMatchObject({ code: 'APPLICABILITY_INVALID' });
    await expect(
      end.execute(contextOf(home), recorded.id, { effectiveTo: '2041-01-01', reason: 'Test' }),
    ).resolves.toMatchObject({ effectiveTo: '2041-01-01' });
  });

  it('refuses a missing field, an unconditional component, and a GAA record past 31 December', async () => {
    const before = await homeCount();
    const required: (keyof RecordApplicability)[] = [
      'payComponentId',
      'scope',
      'employeeId',
      'authorityDocumentVersionId',
      'fundingReference',
      'effectiveFrom',
      'effectiveTo',
    ];
    for (const field of required) {
      const incomplete: Partial<RecordApplicability> = submission();
      delete incomplete[field];
      await expect(
        record.execute(contextOf(home), incomplete as RecordApplicability),
        field,
      ).rejects.toMatchObject({ code: 'APPLICABILITY_INVALID' });
    }
    for (const overrides of [
      { fundingReference: '   ' },
      { scope: 'EMPLOYEE' as const },
      { employeeId: home.employee.id },
      { effectiveFrom: '2042-02-01', effectiveTo: '2042-01-31' },
    ]) {
      await expect(
        record.execute(contextOf(home), submission(overrides)),
        JSON.stringify(overrides),
      ).rejects.toMatchObject({ code: 'APPLICABILITY_INVALID' });
    }
    await expect(
      record.execute(contextOf(home), { ...submission(), officeId: 'x' } as RecordApplicability),
    ).rejects.toMatchObject({ code: 'APPLICABILITY_INVALID' });

    await expect(
      record.execute(contextOf(home), submission({ payComponentId: components.unconditional })),
    ).rejects.toMatchObject({ code: 'APPLICABILITY_COMPONENT_UNCONDITIONAL' });
    await expect(
      record.execute(
        contextOf(home),
        submission({ payComponentId: '00000000-0000-4000-8000-000000000618' }),
      ),
    ).rejects.toMatchObject({ code: 'APPLICABILITY_COMPONENT_NOT_FOUND' });
    for (const effectiveTo of [null, '2043-01-01']) {
      await expect(
        record.execute(
          contextOf(home),
          submission({ payComponentId: components.gaa, effectiveFrom: '2042-01-01', effectiveTo }),
        ),
        String(effectiveTo),
      ).rejects.toMatchObject({
        code: 'APPLICABILITY_GAA_PERIOD_INVALID',
        message: expect.stringContaining('2042-12-31'),
      });
    }
    await expect(
      record.execute(
        contextOf(home),
        submission({ authorityDocumentVersionId: home.draftAuthority.id }),
      ),
    ).rejects.toMatchObject({ code: 'APPLICABILITY_AUTHORITY_INVALID' });
    expect(await homeCount()).toBe(before);

    // A GAA-revalidated record may run to 31 December, and renewal is a new record.
    const gaa = submission({
      payComponentId: components.gaa,
      effectiveFrom: '2042-01-01',
      effectiveTo: '2042-12-31',
    });
    await expect(record.execute(contextOf(home), gaa)).resolves.toMatchObject({
      effectiveTo: '2042-12-31',
    });
    await expect(
      record.execute(contextOf(home), {
        ...gaa,
        effectiveFrom: '2043-01-01',
        effectiveTo: '2043-12-31',
      }),
    ).resolves.toMatchObject({ effectiveFrom: '2043-01-01' });
  });

  it('never overlaps two records for one component and scope target', async () => {
    const component = { payComponentId: components.conditional };
    const employee = { scope: 'EMPLOYEE' as const, employeeId: home.employee.id };
    await record.execute(
      contextOf(home),
      submission({
        ...component,
        ...employee,
        effectiveFrom: '2050-01-01',
        effectiveTo: '2050-06-30',
      }),
    );
    const before = await homeCount();
    for (const [effectiveFrom, effectiveTo] of [
      ['2050-06-30', '2050-12-31'],
      ['2049-01-01', '2050-01-01'],
      ['2049-01-01', null],
    ] as const) {
      await expect(
        record.execute(contextOf(home), submission({ ...employee, effectiveFrom, effectiveTo })),
        `${effectiveFrom}..${effectiveTo}`,
      ).rejects.toMatchObject({ code: 'APPLICABILITY_OVERLAP', statusCode: 409 });
    }
    expect(await homeCount()).toBe(before);

    // The next day, another Employee, and the whole Agency are other targets or periods.
    await record.execute(
      contextOf(home),
      submission({ ...employee, effectiveFrom: '2050-07-01', effectiveTo: '2050-12-31' }),
    );
    await record.execute(
      contextOf(home),
      submission({
        scope: 'EMPLOYEE',
        employeeId: home.otherEmployee.id,
        effectiveFrom: '2050-01-01',
        effectiveTo: '2050-12-31',
      }),
    );
    // The first test's Agency-wide record ended 2040-06-30, so 2050 is free for the Agency.
    await record.execute(
      contextOf(home),
      submission({ effectiveFrom: '2050-01-01', effectiveTo: '2050-12-31' }),
    );
    await expect(
      record.execute(
        contextOf(home),
        submission({ effectiveFrom: '2050-12-31', effectiveTo: null }),
      ),
    ).rejects.toMatchObject({ code: 'APPLICABILITY_OVERLAP' });
    expect(await homeCount()).toBe(before + 3);
  });

  it('needs payroll.compensation.manage for the whole Agency to record or end', async () => {
    const existing = await record.execute(
      contextOf(home),
      submission({ effectiveFrom: '2060-01-01', effectiveTo: '2060-12-31' }),
    );
    for (const permissions of [
      [],
      [{ code: 'payroll.compensation.read', scopePolicy: 'AGENCY' as const }],
      [{ code: 'payroll.compensation.manage', scopePolicy: 'OWN' as const }],
    ]) {
      await expect(
        record.execute(contextOf(home, permissions), submission({ effectiveFrom: '2061-01-01' })),
      ).rejects.toMatchObject({ code: 'APPLICABILITY_FORBIDDEN' });
      await expect(
        end.execute(contextOf(home, permissions), existing.id, {
          effectiveTo: '2060-06-30',
          reason: 'Test',
        }),
      ).rejects.toMatchObject({ code: 'APPLICABILITY_FORBIDDEN' });
    }
    await expect(
      admin.agencyPayrollApplicability.findUniqueOrThrow({ where: { id: existing.id } }),
    ).resolves.toMatchObject({ effectiveTo: new Date('2060-12-31') });
  });

  it("rejects another Agency's Employee, authority, and record, and RLS isolates rows", async () => {
    const homeRecord = await record.execute(
      contextOf(home),
      submission({ effectiveFrom: '2070-01-01', effectiveTo: '2070-12-31' }),
    );
    const homeBefore = await homeCount();
    await expect(
      record.execute(
        contextOf(foreign),
        submission({
          authorityDocumentVersionId: foreign.authority.id,
          scope: 'EMPLOYEE',
          employeeId: home.employee.id,
        }),
      ),
    ).rejects.toMatchObject({ code: 'APPLICABILITY_EMPLOYEE_NOT_FOUND' });
    await expect(
      record.execute(
        contextOf(foreign),
        submission({ authorityDocumentVersionId: home.authority.id }),
      ),
    ).rejects.toMatchObject({ code: 'APPLICABILITY_AUTHORITY_INVALID' });
    await expect(
      end.execute(contextOf(foreign), homeRecord.id, { effectiveTo: '2070-06-30', reason: 'Test' }),
    ).rejects.toMatchObject({ code: 'APPLICABILITY_NOT_FOUND' });

    await expect(
      withDatabaseContext(scopeOf(foreign), (transaction) =>
        transaction.agencyPayrollApplicability.count({ where: { agencyId: home.agency.id } }),
      ),
    ).resolves.toBe(0);
    await expect(
      withDatabaseContext(scopeOf(foreign), (transaction) =>
        findAgencyPayrollApplicability(transaction, {
          agencyId: home.agency.id,
          payComponentId: components.conditional,
          employeeId: null,
          on: '2070-02-01',
        }),
      ),
    ).resolves.toEqual({ status: 'NOT_APPLICABLE' });
    await expect(
      withDatabaseContext(scopeOf(foreign), (transaction) =>
        transaction.agencyPayrollApplicability.create({
          data: { ...homeRow(), effectiveFrom: new Date('2071-01-01') },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withDatabaseContext(scopeOf(foreign), (transaction) =>
        transaction.agencyPayrollApplicability.updateMany({
          where: { id: homeRecord.id },
          data: { effectiveTo: new Date('2070-01-31') },
        }),
      ),
    ).resolves.toMatchObject({ count: 0 });
    // A cross-Agency Employee or authority is refused by the composite foreign keys.
    await expect(
      admin.agencyPayrollApplicability.create({
        data: {
          ...homeRow(),
          scope: 'EMPLOYEE',
          employeeId: foreign.employee.id,
          effectiveFrom: new Date('2072-01-01'),
        },
      }),
    ).rejects.toThrow();
    await expect(
      admin.agencyPayrollApplicability.create({
        data: {
          ...homeRow(),
          authorityDocumentVersionId: foreign.authority.id,
          effectiveFrom: new Date('2073-01-01'),
        },
      }),
    ).rejects.toThrow();
    expect(await homeCount()).toBe(homeBefore);
    await expect(
      admin.agencyPayrollApplicability.findUniqueOrThrow({ where: { id: homeRecord.id } }),
    ).resolves.toMatchObject({ effectiveTo: new Date('2070-12-31') });
  });

  function homeRow() {
    return {
      agencyId: home.agency.id,
      payComponentId: components.conditional,
      scope: 'AGENCY',
      authorityDocumentVersionId: home.authority.id,
      fundingReference: 'Direct write',
      effectiveFrom: new Date('2080-01-01'),
      effectiveTo: new Date('2080-12-31') as Date | null,
      recordedByMembershipId: home.membership.id,
    };
  }

  it('guards the table past the service: conditional, GAA year, earlier end only, no delete', async () => {
    await expect(
      admin.agencyPayrollApplicability.create({
        data: { ...homeRow(), payComponentId: components.unconditional },
      }),
    ).rejects.toThrow(/Only a conditional pay component/);
    for (const effectiveTo of [null, new Date('2081-01-01')]) {
      await expect(
        admin.agencyPayrollApplicability.create({
          data: { ...homeRow(), payComponentId: components.gaa, effectiveTo },
        }),
      ).rejects.toThrow(/31 December/);
    }
    await expect(
      admin.agencyPayrollApplicability.create({ data: { ...homeRow(), fundingReference: ' ' } }),
    ).rejects.toThrow();

    const row = await admin.agencyPayrollApplicability.create({ data: homeRow() });
    await expect(
      admin.agencyPayrollApplicability.create({
        data: { ...homeRow(), effectiveFrom: new Date('2080-12-31'), effectiveTo: null },
      }),
    ).rejects.toThrow(/agency_payroll_applicabilities_no_overlap/);

    const where = { id: row.id };
    for (const data of [
      { fundingReference: 'Changed' },
      { effectiveFrom: new Date('2079-01-01') },
      { authorityDocumentVersionId: home.draftAuthority.id },
      { effectiveTo: new Date('2081-06-30') },
      { effectiveTo: null },
    ]) {
      await expect(
        admin.agencyPayrollApplicability.update({ where, data }),
        JSON.stringify(data),
      ).rejects.toThrow();
    }
    await expect(
      admin.agencyPayrollApplicability.update({
        where,
        data: { effectiveTo: new Date('2080-03-31') },
      }),
    ).resolves.toMatchObject({ effectiveTo: new Date('2080-03-31') });
    await expect(admin.agencyPayrollApplicability.delete({ where })).rejects.toThrow(
      /cannot be deleted/,
    );
  });
});
