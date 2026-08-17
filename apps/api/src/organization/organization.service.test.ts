import { PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { expect, it } from 'vitest';
import {
  OrganizationService,
  organizationAuditWriter,
  type CreateOrganizationUnitInput,
} from './organization.service';

const enabled = process.env.DATABASE_E2E === 'true';

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
  const databaseUrl = process.env.DATABASE_E2E_ADMIN_URL;
  if (!databaseUrl) throw new Error('DATABASE_E2E_ADMIN_URL is required for the integration test.');
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
