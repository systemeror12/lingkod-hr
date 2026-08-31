import { PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { expect, it } from 'vitest';
import {
  OrganizationService,
  organizationAuditWriter,
  type CreateOrganizationUnitInput,
} from './organization.service';

const enabled = process.env.DATABASE_E2E === 'true';

function manilaDateOffset(days: number): string {
  const date = new Date(
    `${new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())}T00:00:00.000Z`,
  );
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const validInput: CreateOrganizationUnitInput = {
  officialName: 'Records Management Division',
  code: 'RMD',
  unitType: 'DIVISION',
  effectiveDate: '2026-08-15',
};

function context(
  agencyId: string,
  userId: string,
  membershipId: string,
  permissions: RequestContext['permissions'] = [
    { code: 'organization.units.read', scopePolicy: 'AGENCY' },
    { code: 'organization.units.create', scopePolicy: 'AGENCY' },
    { code: 'organization.units.activate', scopePolicy: 'AGENCY' },
    { code: 'organization.units.update', scopePolicy: 'AGENCY' },
    { code: 'organization.units.inactivate', scopePolicy: 'AGENCY' },
    { code: 'organization.units.abolish', scopePolicy: 'AGENCY' },
  ],
): RequestContext {
  return {
    requestId: `organization-${Date.now()}`,
    userId,
    agencyId,
    membershipId,
    primaryOrganizationUnitId: null,
    permissions,
  };
}

async function createAdminClient(): Promise<PrismaClient> {
  const databaseUrl =
    process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
  if (!databaseUrl) throw new Error('An administrative database URL is required for the test.');
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

async function cleanup(
  admin: PrismaClient,
  agencyIds: readonly string[],
  userIds: readonly string[],
): Promise<void> {
  await admin.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    await transaction.auditEvent.deleteMany({ where: { agencyId: { in: [...agencyIds] } } });
    await transaction.organizationUnitVersion.deleteMany({
      where: { agencyId: { in: [...agencyIds] } },
    });
    await transaction.organizationUnit.deleteMany({ where: { agencyId: { in: [...agencyIds] } } });
  });
  await admin.agencyMembership.deleteMany({ where: { agencyId: { in: [...agencyIds] } } });
  await admin.user.deleteMany({ where: { id: { in: [...userIds] } } });
  await admin.agency.deleteMany({ where: { id: { in: [...agencyIds] } } });
}

it('rechecks the create permission at the organization service boundary', async () => {
  const service = new OrganizationService(organizationAuditWriter);
  const denied = context(
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003',
    [{ code: 'organization.units.read', scopePolicy: 'AGENCY' }],
  );

  await expect(service.create(denied, validInput)).rejects.toMatchObject({
    code: 'ORGANIZATION_UNIT_CREATE_FORBIDDEN',
    statusCode: 403,
  });
});

it('rechecks the list permission at the organization service boundary', async () => {
  const service = new OrganizationService(organizationAuditWriter);
  const denied = context(
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003',
    [],
  );

  await expect(service.list(denied)).rejects.toMatchObject({
    code: 'ORGANIZATION_UNIT_READ_FORBIDDEN',
    statusCode: 403,
  });
});

it('requires an activation reason at the organization service boundary', async () => {
  const service = new OrganizationService(organizationAuditWriter);
  const allowed = context(
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003',
  );

  await expect(
    service.activate(allowed, '00000000-0000-4000-8000-000000000004', {
      parentUnitId: null,
      reason: ' ',
    }),
  ).rejects.toMatchObject({
    code: 'ORGANIZATION_UNIT_ACTIVATION_REASON_REQUIRED',
    statusCode: 400,
  });
});

it('rechecks the activate permission at the organization service boundary', async () => {
  const service = new OrganizationService(organizationAuditWriter);
  const denied = context(
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003',
    [{ code: 'organization.units.read', scopePolicy: 'AGENCY' }],
  );

  await expect(
    service.activate(denied, '00000000-0000-4000-8000-000000000004', {
      parentUnitId: null,
      reason: 'Unauthorized activation',
    }),
  ).rejects.toMatchObject({
    code: 'ORGANIZATION_UNIT_ACTIVATE_FORBIDDEN',
    statusCode: 403,
  });
});

it.skipIf(!enabled)('creates an Agency-scoped Draft and its audit event atomically', async () => {
  const admin = await createAdminClient();
  const suffix = `${Date.now()}`;
  const agency = await admin.agency.create({
    data: {
      code: `ORG-E2E-${suffix}`,
      name: 'Organization E2E Agency',
      agencyType: 'NGA',
      status: 'ACTIVE',
    },
  });
  const user = await admin.user.create({
    data: {
      identityProvider: 'organization-e2e',
      externalSubject: `organization-e2e-${suffix}`,
      emailNormalized: `organization-e2e-${suffix}@example.test`,
      displayName: 'Organization E2E User',
      globalStatus: 'ACTIVE',
    },
  });
  const membership = await admin.agencyMembership.create({
    data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
  });
  const secondAgency = await admin.agency.create({
    data: {
      code: `ORG-E2E-SECOND-${suffix}`,
      name: 'Second Organization E2E Agency',
      agencyType: 'NGA',
      status: 'ACTIVE',
    },
  });
  const secondUser = await admin.user.create({
    data: {
      identityProvider: 'organization-e2e',
      externalSubject: `organization-e2e-second-${suffix}`,
      emailNormalized: `organization-e2e-second-${suffix}@example.test`,
      displayName: 'Second Organization E2E User',
      globalStatus: 'ACTIVE',
    },
  });
  const secondMembership = await admin.agencyMembership.create({
    data: { agencyId: secondAgency.id, userId: secondUser.id, status: 'ACTIVE' },
  });
  const requestContext = context(agency.id, user.id, membership.id);
  const secondContext = context(secondAgency.id, secondUser.id, secondMembership.id);
  const service = new OrganizationService(organizationAuditWriter);

  try {
    const created = await service.create(requestContext, validInput);

    expect(created).toMatchObject({
      code: validInput.code,
      officialName: validInput.officialName,
      unitType: validInput.unitType,
      effectiveDate: validInput.effectiveDate,
      status: 'DRAFT',
    });
    await expect(
      admin.organizationUnit.findUniqueOrThrow({
        where: { id: created.id },
        include: { currentVersion: true },
      }),
    ).resolves.toMatchObject({
      agencyId: agency.id,
      code: validInput.code,
      unitType: validInput.unitType,
      status: 'DRAFT',
      currentVersion: {
        agencyId: agency.id,
        organizationUnitId: created.id,
        versionNo: 1,
        name: validInput.officialName,
        status: 'DRAFT',
      },
    });
    const auditEvent = await admin.auditEvent.findFirstOrThrow({
      where: { agencyId: agency.id, action: 'ORGANIZATION_UNIT_CREATED', entityId: created.id },
    });
    expect(auditEvent).toMatchObject({
      actorUserId: user.id,
      actorMembershipId: membership.id,
      actorType: 'USER',
      previousStatus: 'None',
      newStatus: 'DRAFT',
      requestId: requestContext.requestId,
      metadata: {
        code: validInput.code,
        officialName: validInput.officialName,
        unitType: validInput.unitType,
        effectiveDate: validInput.effectiveDate,
      },
    });
    await expect(
      admin.auditEvent.update({
        where: { id: auditEvent.id },
        data: { newStatus: 'ACTIVE' },
      }),
    ).rejects.toThrow(/append-only/i);

    await expect(service.create(requestContext, validInput)).rejects.toMatchObject({
      code: 'ORGANIZATION_UNIT_CODE_CONFLICT',
      statusCode: 409,
    });
    const secondCreated = await service.create(secondContext, validInput);
    await service.activate(secondContext, secondCreated.id, {
      parentUnitId: null,
      reason: 'Approved foreign root',
    });
    await expect(
      service.activate(requestContext, created.id, {
        parentUnitId: created.id,
        reason: 'Invalid direct self-parent',
      }),
    ).rejects.toMatchObject({ code: 'ORGANIZATION_UNIT_HIERARCHY_CYCLE', statusCode: 409 });
    await expect(
      service.activate(requestContext, created.id, {
        parentUnitId: secondCreated.id,
        reason: 'Invalid foreign parent',
      }),
    ).rejects.toMatchObject({ code: 'ORGANIZATION_UNIT_PARENT_INVALID', statusCode: 422 });
    await expect(service.list(requestContext)).resolves.toEqual({ units: [created] });
    await expect(service.findById(requestContext, secondCreated.id)).resolves.toBeNull();
  } finally {
    await cleanup(admin, [agency.id, secondAgency.id], [user.id, secondUser.id]);
    await admin.$disconnect();
  }
});

it.skipIf(!enabled)('rolls back the Draft when the audit write fails', async () => {
  const admin = await createAdminClient();
  const suffix = `${Date.now()}-rollback`;
  const agency = await admin.agency.create({
    data: {
      code: `ORG-E2E-${suffix}`,
      name: 'Organization Rollback Agency',
      agencyType: 'NGA',
      status: 'ACTIVE',
    },
  });
  const user = await admin.user.create({
    data: {
      identityProvider: 'organization-e2e',
      externalSubject: `organization-e2e-${suffix}`,
      emailNormalized: `organization-e2e-${suffix}@example.test`,
      displayName: 'Organization Rollback User',
      globalStatus: 'ACTIVE',
    },
  });
  const membership = await admin.agencyMembership.create({
    data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
  });
  const input = { ...validInput, code: `ROLLBACK-${suffix}` };
  const failingAuditWriter = {
    write: async () => {
      throw new Error('audit store unavailable');
    },
  };

  try {
    await expect(
      new OrganizationService(failingAuditWriter).create(
        context(agency.id, user.id, membership.id),
        input,
      ),
    ).rejects.toThrow('audit store unavailable');
    await expect(
      admin.organizationUnit.findFirst({ where: { agencyId: agency.id, code: input.code } }),
    ).resolves.toBeNull();
    await expect(
      admin.auditEvent.findFirst({
        where: { agencyId: agency.id, action: 'ORGANIZATION_UNIT_CREATED' },
      }),
    ).resolves.toBeNull();
  } finally {
    await cleanup(admin, [agency.id], [user.id]);
    await admin.$disconnect();
  }
});

it.skipIf(!enabled)('rolls back activation when its audit write fails', async () => {
  const admin = await createAdminClient();
  const suffix = `${Date.now()}-activation-rollback`;
  const agency = await admin.agency.create({
    data: {
      code: `ORG-E2E-${suffix}`,
      name: 'Organization Activation Rollback Agency',
      agencyType: 'NGA',
      status: 'ACTIVE',
    },
  });
  const user = await admin.user.create({
    data: {
      identityProvider: 'organization-e2e',
      externalSubject: `organization-e2e-${suffix}`,
      emailNormalized: `organization-e2e-${suffix}@example.test`,
      displayName: 'Organization Activation Rollback User',
      globalStatus: 'ACTIVE',
    },
  });
  const membership = await admin.agencyMembership.create({
    data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
  });
  const requestContext = context(agency.id, user.id, membership.id);
  const created = await new OrganizationService(organizationAuditWriter).create(
    requestContext,
    validInput,
  );
  const failingAuditWriter = {
    write: async () => {
      throw new Error('audit store unavailable');
    },
  };

  try {
    await expect(
      new OrganizationService(failingAuditWriter).activate(requestContext, created.id, {
        parentUnitId: null,
        reason: 'Approved root',
      }),
    ).rejects.toThrow('audit store unavailable');
    await expect(
      admin.organizationUnit.findUniqueOrThrow({
        where: { id: created.id },
        include: { currentVersion: true },
      }),
    ).resolves.toMatchObject({ status: 'DRAFT', currentVersion: { status: 'DRAFT' } });
    await expect(
      admin.auditEvent.findFirst({
        where: { agencyId: agency.id, action: 'ORGANIZATION_UNIT_ACTIVATED' },
      }),
    ).resolves.toBeNull();
  } finally {
    await cleanup(admin, [agency.id], [user.id]);
    await admin.$disconnect();
  }
});

it.skipIf(!enabled)('activates a same-Agency hierarchy and returns its dated shape', async () => {
  const admin = await createAdminClient();
  const suffix = `${Date.now()}-hierarchy`;
  const agency = await admin.agency.create({
    data: {
      code: `ORG-E2E-${suffix}`,
      name: 'Organization Hierarchy Agency',
      agencyType: 'NGA',
      status: 'ACTIVE',
    },
  });
  const user = await admin.user.create({
    data: {
      identityProvider: 'organization-e2e',
      externalSubject: `organization-e2e-${suffix}`,
      emailNormalized: `organization-e2e-${suffix}@example.test`,
      displayName: 'Organization Hierarchy User',
      globalStatus: 'ACTIVE',
    },
  });
  const membership = await admin.agencyMembership.create({
    data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
  });
  const requestContext = context(agency.id, user.id, membership.id);
  const service = new OrganizationService(organizationAuditWriter);

  try {
    const root = await service.create(requestContext, {
      ...validInput,
      officialName: 'Office of the Director',
      code: 'OD',
      unitType: 'OFFICE',
    });
    const child = await service.create(requestContext, validInput);

    const rootActivation = {
      parentUnitId: null,
      reason: 'Approved as the Agency root',
      idempotencyKey: `activate-root-${suffix}`,
    };
    await expect(service.activate(requestContext, root.id, rootActivation)).resolves.toMatchObject({
      status: 'ACTIVE',
      parentUnitId: null,
    });
    await expect(service.activate(requestContext, root.id, rootActivation)).resolves.toMatchObject({
      status: 'ACTIVE',
      parentUnitId: null,
    });
    await expect(
      service.activate(requestContext, root.id, {
        ...rootActivation,
        reason: 'Conflicting retry payload',
      }),
    ).rejects.toMatchObject({
      code: 'ORGANIZATION_UNIT_IDEMPOTENCY_CONFLICT',
      statusCode: 409,
    });
    await expect(
      service.activate(requestContext, root.id, {
        ...rootActivation,
        idempotencyKey: `different-root-request-${suffix}`,
      }),
    ).rejects.toMatchObject({ code: 'ORGANIZATION_UNIT_NOT_DRAFT', statusCode: 409 });
    await expect(
      service.activate(requestContext, child.id, {
        parentUnitId: root.id,
        reason: 'Approved reporting placement',
      }),
    ).resolves.toMatchObject({ status: 'ACTIVE', parentUnitId: root.id });

    const futureUnit = await service.create(requestContext, {
      ...validInput,
      officialName: 'Future Office',
      code: 'FUTURE',
      unitType: 'OFFICE',
      effectiveDate: '2099-01-01',
    });
    await expect(
      service.activate(requestContext, futureUnit.id, {
        parentUnitId: null,
        reason: 'Too early',
      }),
    ).rejects.toMatchObject({ code: 'ORGANIZATION_UNIT_NOT_EFFECTIVE', statusCode: 409 });

    await expect(
      admin.auditEvent.count({
        where: { agencyId: agency.id, action: 'ORGANIZATION_UNIT_ACTIVATED', entityId: root.id },
      }),
    ).resolves.toBe(1);

    await expect(service.hierarchy(requestContext, '2026-08-20')).resolves.toEqual({
      asOf: '2026-08-20',
      eligibleParentIds: [],
      units: [
        expect.objectContaining({
          id: root.id,
          parentUnitId: null,
          childCount: 1,
          lifecycleStatus: 'ACTIVE',
        }),
        expect.objectContaining({
          id: child.id,
          parentUnitId: root.id,
          childCount: 0,
          lifecycleStatus: 'ACTIVE',
        }),
      ],
    });
    await expect(
      admin.auditEvent.findFirstOrThrow({
        where: { agencyId: agency.id, action: 'ORGANIZATION_UNIT_ACTIVATED', entityId: child.id },
      }),
    ).resolves.toMatchObject({
      actorMembershipId: membership.id,
      previousStatus: 'DRAFT',
      newStatus: 'ACTIVE',
      reason: 'Approved reporting placement',
      metadata: expect.objectContaining({
        versionId: expect.any(String),
        effectiveDate: validInput.effectiveDate,
        before: expect.objectContaining({ parentUnitId: null }),
        after: expect.objectContaining({ parentUnitId: root.id }),
      }),
    });
  } finally {
    await cleanup(admin, [agency.id], [user.id]);
    await admin.$disconnect();
  }
});

it.skipIf(!enabled)(
  'rejects overlapping dated cycles but permits a non-overlapping historical relationship',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-cycles`;
    const agency = await admin.agency.create({
      data: {
        code: `ORG-E2E-${suffix}`,
        name: 'Organization Cycle Agency',
        agencyType: 'NGA',
        status: 'ACTIVE',
      },
    });
    const user = await admin.user.create({
      data: {
        identityProvider: 'organization-e2e',
        externalSubject: `organization-e2e-${suffix}`,
        emailNormalized: `organization-e2e-${suffix}@example.test`,
        displayName: 'Organization Cycle User',
        globalStatus: 'ACTIVE',
      },
    });
    const membership = await admin.agencyMembership.create({
      data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
    });
    const requestContext = context(agency.id, user.id, membership.id);
    const service = new OrganizationService(organizationAuditWriter);

    try {
      const target = await service.create(requestContext, {
        ...validInput,
        officialName: 'Target Division',
        code: 'TARGET',
      });
      const futureParent = await service.create(requestContext, {
        ...validInput,
        officialName: 'Future Parent Office',
        code: 'FUTURE-PARENT',
        unitType: 'OFFICE',
      });
      await service.activate(requestContext, futureParent.id, {
        parentUnitId: null,
        reason: 'Approved root',
      });
      const currentParentVersion = await admin.organizationUnitVersion.findFirstOrThrow({
        where: { organizationUnitId: futureParent.id, status: 'ACTIVE' },
      });
      await admin.organizationUnitVersion.update({
        where: { id: currentParentVersion.id },
        data: { status: 'SUPERSEDED', effectiveTo: new Date('2026-08-24') },
      });
      const futureParentVersion = await admin.organizationUnitVersion.create({
        data: {
          agencyId: agency.id,
          organizationUnitId: futureParent.id,
          versionNo: 2,
          name: 'Future Parent Office',
          parentUnitId: target.id,
          effectiveFrom: new Date('2026-08-25'),
          status: 'ACTIVE',
          domainStatus: 'ACTIVE',
        },
      });
      await admin.organizationUnit.update({
        where: { id: futureParent.id },
        data: { currentVersionId: futureParentVersion.id },
      });

      await expect(service.hierarchy(requestContext, '2026-08-20', target.id)).resolves.toEqual({
        asOf: '2026-08-20',
        eligibleParentIds: [futureParent.id],
        units: [expect.objectContaining({ id: futureParent.id, effectiveTo: '2026-08-24' })],
      });
      await expect(
        service.activate(requestContext, target.id, {
          parentUnitId: futureParent.id,
          reason: 'Would create a future cycle',
        }),
      ).rejects.toMatchObject({
        code: 'ORGANIZATION_UNIT_HIERARCHY_CYCLE',
        statusCode: 409,
      });

      const expiringParent = await service.create(requestContext, {
        ...validInput,
        officialName: 'Expiring Parent Office',
        code: 'EXPIRING-PARENT',
        unitType: 'OFFICE',
      });
      await service.activate(requestContext, expiringParent.id, {
        parentUnitId: null,
        reason: 'Approved temporary root',
      });
      const expiringVersion = await admin.organizationUnitVersion.findFirstOrThrow({
        where: { organizationUnitId: expiringParent.id, status: 'ACTIVE' },
      });
      await admin.organizationUnitVersion.update({
        where: { id: expiringVersion.id },
        data: { status: 'SUPERSEDED', effectiveTo: new Date('2026-08-24') },
      });
      await admin.organizationUnitVersion.create({
        data: {
          agencyId: agency.id,
          organizationUnitId: expiringParent.id,
          versionNo: 2,
          name: 'Expiring Parent Office',
          effectiveFrom: new Date('2026-08-25'),
          status: 'ACTIVE',
          domainStatus: 'INACTIVE',
        },
      });
      await expect(
        service.activate(requestContext, target.id, {
          parentUnitId: expiringParent.id,
          reason: 'Parent becomes ineligible during the affected interval',
        }),
      ).rejects.toMatchObject({
        code: 'ORGANIZATION_UNIT_PARENT_INVALID',
        statusCode: 422,
      });

      const historicalParent = await service.create(requestContext, {
        ...validInput,
        officialName: 'Historical Parent Office',
        code: 'HISTORICAL-PARENT',
        unitType: 'OFFICE',
      });
      await service.activate(requestContext, historicalParent.id, {
        parentUnitId: null,
        reason: 'Approved root',
      });
      await admin.organizationUnitVersion.create({
        data: {
          agencyId: agency.id,
          organizationUnitId: historicalParent.id,
          versionNo: 2,
          name: 'Historical Parent Office',
          parentUnitId: target.id,
          effectiveFrom: new Date('2026-08-01'),
          effectiveTo: new Date('2026-08-14'),
          status: 'SUPERSEDED',
          domainStatus: 'ACTIVE',
        },
      });
      await expect(
        service.activate(requestContext, target.id, {
          parentUnitId: historicalParent.id,
          reason: 'Approved after the reverse relationship ended',
        }),
      ).resolves.toMatchObject({ status: 'ACTIVE', parentUnitId: historicalParent.id });
    } finally {
      await cleanup(admin, [agency.id], [user.id]);
      await admin.$disconnect();
    }
  },
);

it.skipIf(!enabled)(
  'preserves successor values and an auditable Organization Unit history',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-successor`;
    const today = manilaDateOffset(0);
    const successorDate = manilaDateOffset(1);
    const backdatedDate = manilaDateOffset(-1);
    const agency = await admin.agency.create({
      data: {
        code: `ORG-E2E-${suffix}`,
        name: 'Organization Successor Agency',
        agencyType: 'NGA',
        status: 'ACTIVE',
      },
    });
    const user = await admin.user.create({
      data: {
        identityProvider: 'organization-e2e',
        externalSubject: `organization-e2e-${suffix}`,
        emailNormalized: `organization-e2e-${suffix}@example.test`,
        displayName: 'Organization Successor User',
        globalStatus: 'ACTIVE',
      },
    });
    const membership = await admin.agencyMembership.create({
      data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
    });
    const requestContext = context(agency.id, user.id, membership.id);
    const service = new OrganizationService(organizationAuditWriter);

    try {
      const unit = await service.create(requestContext, {
        ...validInput,
        code: `RMD-${suffix}`,
      });
      await service.activate(requestContext, unit.id, {
        parentUnitId: null,
        reason: 'Approved as the Agency root',
      });

      const parent = await service.create(requestContext, {
        ...validInput,
        officialName: 'Records Parent Office',
        code: `PARENT-${suffix}`,
        unitType: 'OFFICE',
      });
      await service.activate(requestContext, parent.id, {
        parentUnitId: null,
        reason: 'Approved as the parent office',
      });

      const prepared = await service.createSuccessor(requestContext, unit.id);
      expect(prepared.current).toMatchObject({
        officialName: validInput.officialName,
        lifecycleStatus: 'ACTIVE',
      });
      expect(prepared.draft).toMatchObject({
        officialName: validInput.officialName,
        parentUnitId: null,
        lifecycleStatus: 'ACTIVE',
      });
      await expect(
        service.hierarchy(requestContext, successorDate, unit.id),
      ).resolves.toMatchObject({
        eligibleParentIds: expect.arrayContaining([parent.id]),
      });
      await expect(
        service.updateDraft(requestContext, unit.id, prepared.draft.id, {
          officialName: 'Backdated successor',
          parentUnitId: null,
          costCenterCode: null,
          responsibilityCenterCode: null,
          effectiveDate: backdatedDate,
        }),
      ).rejects.toMatchObject({
        code: 'ORGANIZATION_UNIT_EFFECTIVE_DATE_INVALID',
        statusCode: 409,
      });

      const updated = await service.updateDraft(requestContext, unit.id, prepared.draft.id, {
        officialName: 'Records and Information Division',
        parentUnitId: parent.id,
        costCenterCode: 'CC-100',
        responsibilityCenterCode: 'RC-200',
        effectiveDate: successorDate,
      });
      expect(updated).toMatchObject({
        officialName: 'Records and Information Division',
        costCenterCode: 'CC-100',
        responsibilityCenterCode: 'RC-200',
        versionState: 'DRAFT',
      });

      await expect(
        service.activateSuccessor(requestContext, unit.id, updated.id, {
          reason: 'Approved prospective reorganization',
          idempotencyKey: `successor-activation-${suffix}`,
        }),
      ).resolves.toMatchObject({
        officialName: 'Records and Information Division',
        status: 'ACTIVE',
      });
      await expect(
        service.activateSuccessor(requestContext, unit.id, updated.id, {
          reason: 'Approved prospective reorganization',
          idempotencyKey: `successor-activation-${suffix}`,
        }),
      ).resolves.toMatchObject({
        officialName: 'Records and Information Division',
        status: 'ACTIVE',
      });

      const history = await service.history(requestContext, unit.id, successorDate);
      expect(history.effective).toMatchObject({
        officialName: 'Records and Information Division',
        costCenterCode: 'CC-100',
        responsibilityCenterCode: 'RC-200',
      });
      expect(history.versions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            officialName: validInput.officialName,
            effectiveTo: today,
            versionState: 'SUPERSEDED',
          }),
          expect.objectContaining({
            officialName: 'Records and Information Division',
            effectiveFrom: successorDate,
            versionState: 'ACTIVE',
          }),
        ]),
      );
      expect(history.transitions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'ORGANIZATION_UNIT_CHANGED',
            reason: 'Approved prospective reorganization',
          }),
        ]),
      );

      const activeVersion = history.versions.find(
        (version) =>
          version.officialName === 'Records and Information Division' &&
          version.versionState === 'ACTIVE',
      );
      expect(activeVersion).toBeDefined();
      if (!activeVersion) throw new Error('The activated successor was not returned in history.');
      await expect(
        service.correct(requestContext, unit.id, activeVersion.id, {
          officialName: 'Records & Information Division',
          parentUnitId: parent.id,
          costCenterCode: 'CC-100',
          responsibilityCenterCode: 'RC-200',
          reason: 'Corrected the official division name',
        }),
      ).resolves.toMatchObject({
        officialName: 'Records & Information Division',
        versionState: 'ACTIVE',
      });
      const correctedHistory = await service.history(requestContext, unit.id, successorDate);
      expect(correctedHistory.versions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            officialName: 'Records and Information Division',
            versionState: 'VOIDED',
          }),
          expect.objectContaining({
            officialName: 'Records & Information Division',
            versionState: 'ACTIVE',
          }),
        ]),
      );
      expect(correctedHistory.transitions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'ORGANIZATION_UNIT_CORRECTED',
            reason: 'Corrected the official division name',
          }),
        ]),
      );
    } finally {
      await cleanup(admin, [agency.id], [user.id]);
      await admin.$disconnect();
    }
  },
);

it.skipIf(!enabled)('blocks unresolved assignments and preserves lifecycle periods', async () => {
  const admin = await createAdminClient();
  const suffix = `${Date.now()}-lifecycle`;
  const inactivationDate = manilaDateOffset(1);
  const inactivationEndDate = manilaDateOffset(4);
  const reactivationDate = manilaDateOffset(5);
  const abolitionDate = manilaDateOffset(6);
  const agency = await admin.agency.create({
    data: {
      code: `ORG-E2E-${suffix}`,
      name: 'Organization Lifecycle Agency',
      agencyType: 'NGA',
      status: 'ACTIVE',
    },
  });
  const user = await admin.user.create({
    data: {
      identityProvider: 'organization-e2e',
      externalSubject: `organization-e2e-${suffix}`,
      emailNormalized: `organization-e2e-${suffix}@example.test`,
      displayName: 'Organization Lifecycle User',
      globalStatus: 'ACTIVE',
    },
  });
  const membership = await admin.agencyMembership.create({
    data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
  });
  const requestContext = context(agency.id, user.id, membership.id);
  const service = new OrganizationService(organizationAuditWriter);

  try {
    const unit = await service.create(requestContext, {
      ...validInput,
      code: `LIFE-${suffix}`,
    });
    await service.activate(requestContext, unit.id, {
      parentUnitId: null,
      reason: 'Approved as the Agency root',
    });
    await admin.agencyMembership.update({
      where: { id: membership.id },
      data: { primaryOrganizationUnitId: unit.id },
    });

    await expect(
      service.inactivate(requestContext, unit.id, {
        effectiveDate: inactivationDate,
        reason: 'Office temporarily closed',
      }),
    ).rejects.toMatchObject({
      code: 'ORGANIZATION_UNIT_DEPENDENCIES_UNRESOLVED',
      statusCode: 409,
    });

    await expect(
      service.inactivate(requestContext, unit.id, {
        effectiveDate: inactivationDate,
        reason: 'Office temporarily closed',
        migrationPlan: 'Reassign active memberships through HRMO review.',
      }),
    ).resolves.toMatchObject({ status: 'INACTIVE', lifecycleStatus: 'INACTIVE' });

    await expect(
      service.reactivate(requestContext, unit.id, {
        effectiveDate: reactivationDate,
        reason: 'Office reopened',
      }),
    ).rejects.toMatchObject({
      code: 'ORGANIZATION_UNIT_AUTHORITY_REQUIRED',
      statusCode: 400,
    });
    await expect(
      service.reactivate(requestContext, unit.id, {
        effectiveDate: reactivationDate,
        reason: 'Office reopened',
        authorityReference: 'AO-2026-25',
        idempotencyKey: `reactivation-${suffix}`,
      }),
    ).resolves.toMatchObject({ status: 'ACTIVE', lifecycleStatus: 'ACTIVE' });
    await expect(
      service.reactivate(requestContext, unit.id, {
        effectiveDate: reactivationDate,
        reason: 'Office reopened',
        authorityReference: 'AO-2026-25',
        idempotencyKey: `reactivation-${suffix}`,
      }),
    ).resolves.toMatchObject({ status: 'ACTIVE', lifecycleStatus: 'ACTIVE' });

    await expect(
      service.abolish(requestContext, unit.id, {
        effectiveDate: abolitionDate,
        reason: 'Office legally abolished',
        authorityReference: 'AO-2026-26',
        migrationPlan: 'Retain existing membership history; no new assignments.',
      }),
    ).resolves.toMatchObject({ status: 'ABOLISHED', lifecycleStatus: 'ABOLISHED' });

    await expect(service.createSuccessor(requestContext, unit.id)).rejects.toMatchObject({
      code: 'ORGANIZATION_UNIT_SUCCESSOR_NOT_ALLOWED',
      statusCode: 409,
    });

    const history = await service.history(requestContext, unit.id, reactivationDate);
    expect(history.effective).toMatchObject({ lifecycleStatus: 'ACTIVE' });
    expect(history.versions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          lifecycleStatus: 'INACTIVE',
          effectiveFrom: inactivationDate,
          effectiveTo: inactivationEndDate,
        }),
        expect.objectContaining({
          lifecycleStatus: 'ACTIVE',
          effectiveFrom: reactivationDate,
        }),
        expect.objectContaining({
          lifecycleStatus: 'ABOLISHED',
          effectiveFrom: abolitionDate,
        }),
      ]),
    );
    expect(history.transitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'ORGANIZATION_UNIT_INACTIVATED',
          migrationPlan: 'Reassign active memberships through HRMO review.',
        }),
        expect.objectContaining({
          action: 'ORGANIZATION_UNIT_REACTIVATED',
          authorityReference: 'AO-2026-25',
        }),
        expect.objectContaining({
          action: 'ORGANIZATION_UNIT_ABOLISHED',
          authorityReference: 'AO-2026-26',
        }),
      ]),
    );
  } finally {
    await cleanup(admin, [agency.id], [user.id]);
    await admin.$disconnect();
  }
});
