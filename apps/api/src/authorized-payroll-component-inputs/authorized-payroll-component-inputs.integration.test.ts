import { PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DocumentsService } from '../documents/documents.service';
import { ApproveAuthorizedPayrollComponentInputService } from './approve-authorized-payroll-component-input.service';
import { REIMBURSABLE_RATA_COMPONENT_CODE } from './authorized-payroll-component-inputs.records';
import type { RecordAuthorizedInput } from './authorized-payroll-component-inputs.schemas';
import { ListAuthorizedPayrollComponentInputsService } from './list-authorized-payroll-component-inputs.service';
import { RecordAuthorizedPayrollComponentInputService } from './record-authorized-payroll-component-input.service';

const enabled = process.env.DATABASE_E2E === 'true';

// Test fixtures only: the components carry a prefix the cleanup removes and
// are not catalogue rows.
const prefix = 'TEST-346-';

function adminUrl(): string {
  const url = process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
  if (!url) throw new Error('A database owner URL is required for the integration test.');
  return url;
}

async function createUser(admin: PrismaClient, agencyId: string, label: string) {
  const user = await admin.user.create({
    data: {
      emailNormalized: `apci-${label}@example.test`,
      displayName: `Authorized input ${label}`,
      globalStatus: 'ACTIVE',
    },
  });
  const membership = await admin.agencyMembership.create({
    data: { agencyId, userId: user.id, status: 'ACTIVE' },
  });
  return { user, membership };
}

async function createAuthority(
  admin: PrismaClient,
  agencyId: string,
  membershipId: string,
  storageKey: string,
  issued: boolean,
) {
  const document = await admin.document.create({
    data: {
      agencyId,
      documentType: 'AGENCY_ISSUANCE',
      classification: 'INTERNAL',
      status: issued ? 'APPROVED' : 'DRAFT',
      createdByMembershipId: membershipId,
    },
  });
  const version = await admin.documentVersion.create({
    data: {
      agencyId,
      documentId: document.id,
      versionNo: 1,
      storageKey,
      contentHash: 'a'.repeat(64),
      mimeType: 'application/pdf',
      sizeBytes: 1,
      issuedAt: issued ? new Date() : null,
      createdByMembershipId: membershipId,
    },
  });
  await admin.document.update({
    where: { id: document.id },
    data: { currentVersionId: version.id },
  });
  return version;
}

async function createTenant(admin: PrismaClient, suffix: string, label: string) {
  const agency = await admin.agency.create({
    data: {
      code: `APCI-${label}-${suffix}`,
      name: `Authorized Input ${label} Agency`,
      agencyType: 'NGA',
      status: 'ACTIVE',
    },
  });
  const recorder = await createUser(admin, agency.id, `${label}-recorder-${suffix}`);
  const approver = await createUser(admin, agency.id, `${label}-approver-${suffix}`);
  const employee = await admin.employee.create({
    data: {
      agencyId: agency.id,
      employeeNumber: `EMP-${label}-${suffix}`,
      legalName: `Employee ${label}`,
      birthDate: new Date('1990-01-01'),
      sex: 'FEMALE',
      civilStatus: 'SINGLE',
      contactEmail: `apci-employee-${label}-${suffix}@example.test`,
      serviceStatus: 'ACTIVE',
      createdByMembershipId: recorder.membership.id,
      updatedByMembershipId: recorder.membership.id,
    },
  });
  const authority = await createAuthority(
    admin,
    agency.id,
    recorder.membership.id,
    `apci/${label}-${suffix}/issued`,
    true,
  );
  const draftAuthority = await createAuthority(
    admin,
    agency.id,
    recorder.membership.id,
    `apci/${label}-${suffix}/draft`,
    false,
  );
  return { agency, recorder, approver, employee, authority, draftAuthority };
}

type Tenant = Awaited<ReturnType<typeof createTenant>>;
type Actor = Tenant['recorder'];

function contextOf(
  tenant: Tenant,
  actor: Actor,
  permissions: RequestContext['permissions'] = [
    { code: 'payroll.inputs.adjust', scopePolicy: 'AGENCY' },
  ],
): RequestContext {
  return {
    requestId: 'authorized-inputs-integration',
    userId: actor.user.id,
    agencyId: tenant.agency.id,
    membershipId: actor.membership.id,
    primaryOrganizationUnitId: null,
    permissions,
  };
}

describe.skipIf(!enabled)('Authorized Payroll Component Inputs in PostgreSQL', () => {
  let admin: PrismaClient;
  const suffix = `${Date.now()}`;
  const tenants: Tenant[] = [];
  let home: Tenant;
  let foreign: Tenant;
  const components: Record<'honoraria' | 'basic' | 'rata', string> = {
    honoraria: '',
    basic: '',
    rata: '',
  };
  let createdRata = false;
  const record = new RecordAuthorizedPayrollComponentInputService(
    new DocumentsService({} as never, {} as never),
  );
  const approve = new ApproveAuthorizedPayrollComponentInputService();
  const list = new ListAuthorizedPayrollComponentInputsService();

  async function cleanup(): Promise<void> {
    await admin.$transaction(async (transaction) => {
      // The retention and append-only triggers are the point; only the test lifts them.
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      for (const { agency, recorder, approver } of tenants) {
        const agencyId = agency.id;
        await transaction.authorizedPayrollComponentInput.deleteMany({ where: { agencyId } });
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
        await transaction.user.deleteMany({
          where: { id: { in: [recorder.user.id, approver.user.id] } },
        });
      }
      await transaction.payComponent.deleteMany({ where: { code: { startsWith: prefix } } });
      if (createdRata) {
        await transaction.payComponent.deleteMany({
          where: { code: REIMBURSABLE_RATA_COMPONENT_CODE },
        });
      }
    });
  }

  beforeAll(async () => {
    admin = new PrismaClient({ datasources: { db: { url: adminUrl() } } });
    home = await createTenant(admin, suffix, 'A');
    tenants.push(home);
    foreign = await createTenant(admin, suffix, 'B');
    tenants.push(foreign);
    const component = (code: string, acceptsAuthorizedInput: boolean) =>
      admin.payComponent.create({
        data: {
          code,
          name: `Test component ${code}`,
          category: 'EARNING',
          isConditional: true,
          isGaaRevalidated: false,
          acceptsAuthorizedInput,
        },
      });
    components.honoraria = (await component(`${prefix}HONORARIA-${suffix}`, true)).id;
    components.basic = (await component(`${prefix}BASIC-${suffix}`, false)).id;
    const rata = await admin.payComponent.findUnique({
      where: { code: REIMBURSABLE_RATA_COMPONENT_CODE },
    });
    if (rata) {
      components.rata = rata.id;
    } else {
      components.rata = (await component(REIMBURSABLE_RATA_COMPONENT_CODE, true)).id;
      createdRata = true;
    }
  });

  afterAll(async () => {
    await cleanup();
    await admin.$disconnect();
  });

  const submission = (overrides: Partial<RecordAuthorizedInput> = {}): RecordAuthorizedInput => ({
    payComponentId: components.honoraria,
    scope: 'AGENCY',
    employeeId: null,
    valueKind: 'AMOUNT',
    value: '1500.00',
    paymentSchedule: 'ONCE',
    authorityDocumentVersionId: home.authority.id,
    sourceReference: 'Agency Office Order No. 1, s. 2030',
    effectiveFrom: '2030-01-01',
    effectiveTo: '2030-12-31',
    ...overrides,
  });
  const homeCount = () =>
    admin.authorizedPayrollComponentInput.count({ where: { agencyId: home.agency.id } });

  it('records an input, approves it by another person, and writes Audit Events', async () => {
    const recorded = await record.execute(contextOf(home, home.recorder), submission());
    expect(recorded).toMatchObject({
      status: 'RECORDED',
      scope: 'AGENCY',
      employeeId: null,
      value: '1500.00000000',
      paymentSchedule: 'ONCE',
      effectiveFrom: '2030-01-01',
      effectiveTo: '2030-12-31',
      recordedByMembershipId: home.recorder.membership.id,
      approvedByMembershipId: null,
      approvedAt: null,
      rowVersion: 1,
    });

    await expect(
      approve.execute(contextOf(home, home.recorder), recorded.id),
    ).rejects.toMatchObject({ code: 'AUTHORIZED_INPUT_SELF_APPROVAL' });

    const approved = await approve.execute(contextOf(home, home.approver), recorded.id);
    expect(approved).toMatchObject({
      status: 'APPROVED',
      approvedByMembershipId: home.approver.membership.id,
      rowVersion: 2,
    });
    expect(approved.approvedAt).not.toBeNull();
    await expect(
      approve.execute(contextOf(home, home.approver), recorded.id),
    ).rejects.toMatchObject({ code: 'AUTHORIZED_INPUT_STATUS_INVALID' });

    const events = await admin.auditEvent.findMany({
      where: { agencyId: home.agency.id, entityId: recorded.id },
      orderBy: { occurredAt: 'asc' },
    });
    expect(events.map((event) => [event.action, event.actorMembershipId])).toEqual([
      ['AUTHORIZED_PAYROLL_COMPONENT_INPUT_RECORDED', home.recorder.membership.id],
      ['AUTHORIZED_PAYROLL_COMPONENT_INPUT_APPROVED', home.approver.membership.id],
    ]);

    // An Employee-scoped input names an Employee of the Agency.
    const scoped = await record.execute(
      contextOf(home, home.approver),
      submission({
        scope: 'EMPLOYEE',
        employeeId: home.employee.id,
        valueKind: 'RATE',
        value: '0.1',
        paymentSchedule: 'EACH_REGULAR_PERIOD',
        effectiveTo: null,
      }),
    );
    expect(scoped).toMatchObject({ scope: 'EMPLOYEE', employeeId: home.employee.id });
    await expect(approve.execute(contextOf(home, home.recorder), scoped.id)).resolves.toMatchObject(
      { status: 'APPROVED' },
    );
  });

  it('refuses an input missing any required field, or with a free-form formula', async () => {
    const before = await homeCount();
    const required: (keyof RecordAuthorizedInput)[] = [
      'payComponentId',
      'scope',
      'employeeId',
      'valueKind',
      'value',
      'paymentSchedule',
      'authorityDocumentVersionId',
      'sourceReference',
      'effectiveFrom',
      'effectiveTo',
    ];
    for (const field of required) {
      const incomplete: Partial<RecordAuthorizedInput> = submission();
      delete incomplete[field];
      await expect(
        record.execute(contextOf(home, home.recorder), incomplete as RecordAuthorizedInput),
        field,
      ).rejects.toMatchObject({ code: 'AUTHORIZED_INPUT_INVALID' });
    }
    const invalid: Partial<RecordAuthorizedInput>[] = [
      { sourceReference: '   ' },
      { value: '0' },
      { value: '-5' },
      { scope: 'EMPLOYEE' },
      { employeeId: home.employee.id },
      { effectiveFrom: '2030-02-01', effectiveTo: '2030-01-31' },
    ];
    for (const overrides of invalid) {
      await expect(
        record.execute(contextOf(home, home.recorder), submission(overrides)),
        JSON.stringify(overrides),
      ).rejects.toMatchObject({ code: 'AUTHORIZED_INPUT_INVALID' });
    }
    await expect(
      record.execute(contextOf(home, home.recorder), {
        ...submission(),
        formula: 'basic * 0.1',
      } as RecordAuthorizedInput),
    ).rejects.toMatchObject({ code: 'AUTHORIZED_INPUT_INVALID' });
    expect(await homeCount()).toBe(before);
  });

  it('refuses a component that takes no input, reimbursable RATA, and a bad authority', async () => {
    const before = await homeCount();
    const recorder = contextOf(home, home.recorder);
    await expect(
      record.execute(recorder, submission({ payComponentId: components.basic })),
    ).rejects.toMatchObject({ code: 'AUTHORIZED_INPUT_COMPONENT_NOT_ACCEPTED' });
    await expect(
      record.execute(
        recorder,
        submission({ payComponentId: '00000000-0000-4000-8000-000000000346' }),
      ),
    ).rejects.toMatchObject({ code: 'AUTHORIZED_INPUT_COMPONENT_NOT_FOUND' });
    // No rule carries the RATA ceiling, so no amount can be shown within it.
    await expect(
      record.execute(recorder, submission({ payComponentId: components.rata, value: '1' })),
    ).rejects.toMatchObject({ code: 'AUTHORIZED_INPUT_CEILING_RULE_MISSING' });
    await expect(
      record.execute(recorder, submission({ authorityDocumentVersionId: home.draftAuthority.id })),
    ).rejects.toMatchObject({ code: 'AUTHORIZED_INPUT_AUTHORITY_INVALID' });
    expect(await homeCount()).toBe(before);
  });

  it('needs payroll.inputs.adjust for the whole Agency to record or approve', async () => {
    const pending = await record.execute(contextOf(home, home.recorder), submission());
    for (const permissions of [
      [],
      [{ code: 'payroll.inputs.read', scopePolicy: 'AGENCY' as const }],
      [{ code: 'payroll.inputs.adjust', scopePolicy: 'OWN' as const }],
    ]) {
      await expect(
        record.execute(contextOf(home, home.recorder, permissions), submission()),
      ).rejects.toMatchObject({ code: 'AUTHORIZED_INPUT_FORBIDDEN' });
      await expect(
        approve.execute(contextOf(home, home.approver, permissions), pending.id),
      ).rejects.toMatchObject({ code: 'AUTHORIZED_INPUT_FORBIDDEN' });
    }
    await expect(
      admin.authorizedPayrollComponentInput.findUniqueOrThrow({ where: { id: pending.id } }),
    ).resolves.toMatchObject({ status: 'RECORDED' });
  });

  it("rejects another Agency's Employee, authority, and input", async () => {
    const homeBefore = await homeCount();
    const recorder = contextOf(foreign, foreign.recorder);
    await expect(
      record.execute(
        recorder,
        submission({
          authorityDocumentVersionId: foreign.authority.id,
          scope: 'EMPLOYEE',
          employeeId: home.employee.id,
        }),
      ),
    ).rejects.toMatchObject({ code: 'AUTHORIZED_INPUT_EMPLOYEE_NOT_FOUND' });
    await expect(
      record.execute(recorder, submission({ authorityDocumentVersionId: home.authority.id })),
    ).rejects.toMatchObject({ code: 'AUTHORIZED_INPUT_AUTHORITY_INVALID' });

    const homeInput = await record.execute(contextOf(home, home.recorder), submission());
    await expect(
      approve.execute(contextOf(foreign, foreign.approver), homeInput.id),
    ).rejects.toMatchObject({ code: 'AUTHORIZED_INPUT_NOT_FOUND' });
    const foreignScope = {
      agencyId: foreign.agency.id,
      userId: foreign.recorder.user.id,
      membershipId: foreign.recorder.membership.id,
    };
    await expect(
      withDatabaseContext(foreignScope, (transaction) =>
        transaction.authorizedPayrollComponentInput.count({
          where: { agencyId: home.agency.id },
        }),
      ),
    ).resolves.toBe(0);
    await expect(
      withDatabaseContext(foreignScope, (transaction) =>
        transaction.authorizedPayrollComponentInput.create({
          data: {
            ...homeRow(),
            agencyId: home.agency.id,
            recordedByMembershipId: home.recorder.membership.id,
          },
        }),
      ),
    ).rejects.toThrow();
    expect(await homeCount()).toBe(homeBefore + 1);
    await expect(
      admin.authorizedPayrollComponentInput.findUniqueOrThrow({ where: { id: homeInput.id } }),
    ).resolves.toMatchObject({ status: 'RECORDED' });
  });

  function homeRow() {
    return {
      agencyId: home.agency.id,
      payComponentId: components.honoraria,
      scope: 'AGENCY',
      valueKind: 'AMOUNT',
      value: '10',
      paymentSchedule: 'EACH_REGULAR_PERIOD',
      authorityDocumentVersionId: home.authority.id,
      sourceReference: 'Direct write',
      effectiveFrom: new Date('2030-01-01'),
      effectiveTo: new Date('2030-06-30'),
      status: 'RECORDED',
      recordedByMembershipId: home.recorder.membership.id,
    };
  }

  it('keeps an approved input unedited except for an earlier end, and never deletes one', async () => {
    const homeScope = {
      agencyId: home.agency.id,
      userId: home.recorder.user.id,
      membershipId: home.recorder.membership.id,
    };
    // The guard refuses a component that takes no input even past the service.
    await expect(
      withDatabaseContext(homeScope, (transaction) =>
        transaction.authorizedPayrollComponentInput.create({
          data: { ...homeRow(), payComponentId: components.basic },
        }),
      ),
    ).rejects.toThrow(/does not accept an Authorized Payroll Component Input/);
    await expect(
      admin.authorizedPayrollComponentInput.create({
        data: { ...homeRow(), status: 'APPROVED', approvedAt: new Date() },
      }),
    ).rejects.toThrow();

    const row = await admin.authorizedPayrollComponentInput.create({ data: homeRow() });
    const where = { id: row.id };
    // The recorder cannot be the approver, even written directly.
    await expect(
      admin.authorizedPayrollComponentInput.update({
        where,
        data: {
          status: 'APPROVED',
          approvedByMembershipId: home.recorder.membership.id,
          approvedAt: new Date(),
        },
      }),
    ).rejects.toThrow();
    await admin.authorizedPayrollComponentInput.update({
      where,
      data: {
        status: 'APPROVED',
        approvedByMembershipId: home.approver.membership.id,
        approvedAt: new Date(),
      },
    });

    for (const data of [
      { value: '20' },
      { sourceReference: 'Changed' },
      { effectiveFrom: new Date('2029-01-01') },
      { effectiveTo: new Date('2030-07-31') },
      { effectiveTo: null },
      { status: 'CANCELLED' },
      { approvedAt: new Date('2031-01-01') },
    ]) {
      await expect(
        admin.authorizedPayrollComponentInput.update({ where, data }),
        JSON.stringify(data),
      ).rejects.toThrow();
    }
    await expect(
      admin.authorizedPayrollComponentInput.update({
        where,
        data: { effectiveTo: new Date('2030-03-31') },
      }),
    ).resolves.toMatchObject({ effectiveTo: new Date('2030-03-31') });
    await expect(admin.authorizedPayrollComponentInput.delete({ where })).rejects.toThrow(
      /cannot be deleted/,
    );
  });

  it("lists the Agency's inputs with their names, and the components that accept one", async () => {
    const reader = [{ code: 'payroll.inputs.read', scopePolicy: 'AGENCY' as const }];
    const recorded = await record.execute(
      contextOf(home, home.recorder),
      submission({ sourceReference: 'Listed Office Order' }),
    );
    await approve.execute(contextOf(home, home.approver), recorded.id);
    const foreignInput = await record.execute(contextOf(foreign, foreign.recorder), {
      ...submission(),
      authorityDocumentVersionId: foreign.authority.id,
    });

    const listed = await list.execute(contextOf(home, home.recorder, reader));
    expect(listed.inputs.map(({ id }) => id)).toContain(recorded.id);
    expect(listed.inputs.map(({ id }) => id)).not.toContain(foreignInput.id);
    expect(listed.inputs.find(({ id }) => id === recorded.id)).toMatchObject({
      status: 'APPROVED',
      sourceReference: 'Listed Office Order',
      payComponentCode: `${prefix}HONORARIA-${suffix}`,
      payComponentName: `Test component ${prefix}HONORARIA-${suffix}`,
      recordedByName: home.recorder.user.displayName,
      approvedByName: home.approver.user.displayName,
    });
    const componentIds = listed.payComponents.map(({ id }) => id);
    expect(componentIds).toContain(components.honoraria);
    expect(componentIds).not.toContain(components.basic);

    for (const permissions of [
      [],
      [{ code: 'payroll.inputs.adjust', scopePolicy: 'AGENCY' as const }],
      [{ code: 'payroll.inputs.read', scopePolicy: 'OWN' as const }],
    ]) {
      await expect(list.execute(contextOf(home, home.recorder, permissions))).rejects.toMatchObject(
        { code: 'AUTHORIZED_INPUT_READ_FORBIDDEN' },
      );
    }
  });
});
