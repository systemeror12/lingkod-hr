import { PrismaClient } from '@prisma/client';
import { expect, it } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import { AuditService, sanitizeAuditValue } from './audit.service';

const enabled = process.env.DATABASE_E2E === 'true';

const context: RequestContext = {
  requestId: 'audit-service-test',
  userId: '00000000-0000-4000-8000-000000000001',
  agencyId: '00000000-0000-4000-8000-000000000002',
  membershipId: '00000000-0000-4000-8000-000000000003',
  primaryOrganizationUnitId: null,
  permissions: [{ code: 'audit.events.read', scopePolicy: 'AGENCY' }],
};

it('removes credentials, tokens, and unnecessary personal data from persisted metadata', () => {
  expect(
    sanitizeAuditValue({
      officialName: 'Records Management Division',
      code: 'RMD',
      password: 'do-not-show',
      sessionToken: 'do-not-show',
      email: 'unnecessary@example.test',
      nested: { apiKey: 'do-not-show', unitType: 'DIVISION' },
    }),
  ).toEqual({
    officialName: 'Records Management Division',
    code: 'RMD',
    nested: { unitType: 'DIVISION' },
  });
});

it('rechecks the read permission at the service boundary', async () => {
  const service = new AuditService();
  const denied = { ...context, permissions: [] };

  await expect(service.list(denied)).rejects.toMatchObject({
    statusCode: 403,
    code: 'AUDIT_EVENT_READ_FORBIDDEN',
  });
});

it.skipIf(!enabled)(
  'lists persisted Organization Unit evidence newest first and sanitizes detail data',
  async () => {
    const adminUrl = process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
    if (!adminUrl) throw new Error('An administrative database URL is required for the test.');
    const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
    const service = new AuditService();
    const suffix = `${Date.now()}`;
    const agency = await admin.agency.create({
      data: {
        code: `AUDIT-API-${suffix}`,
        name: 'Audit API Agency',
        agencyType: 'NGA',
        status: 'ACTIVE',
      },
    });
    const foreignAgency = await admin.agency.create({
      data: {
        code: `AUDIT-API-FOREIGN-${suffix}`,
        name: 'Foreign Audit API Agency',
        agencyType: 'NGA',
        status: 'ACTIVE',
      },
    });
    const user = await admin.user.create({
      data: {
        identityProvider: 'audit-api-e2e',
        externalSubject: `audit-api-${suffix}`,
        emailNormalized: `audit-api-${suffix}@example.test`,
        displayName: 'Audit API User',
        globalStatus: 'ACTIVE',
      },
    });
    const membership = await admin.agencyMembership.create({
      data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
    });
    const foreignMembership = await admin.agencyMembership.create({
      data: { agencyId: foreignAgency.id, userId: user.id, status: 'ACTIVE' },
    });
    const entityIds = [
      '00000000-0000-4000-8000-000000000011',
      '00000000-0000-4000-8000-000000000012',
      '00000000-0000-4000-8000-000000000013',
    ];
    const events = await Promise.all(
      entityIds.map((entityId, index) =>
        admin.auditEvent.create({
          data: {
            agencyId: agency.id,
            actorUserId: user.id,
            actorMembershipId: membership.id,
            actorType: 'USER',
            action: 'ORGANIZATION_UNIT_CREATED',
            entityType: 'OrganizationUnit',
            entityId,
            previousStatus: 'None',
            newStatus: 'DRAFT',
            requestId: `audit-api-request-${index}`,
            occurredAt: new Date(`2026-08-15T0${index + 1}:00:00.000Z`),
            metadata: {
              officialName: `Organization Unit ${index}`,
              code: `UNIT-${index}`,
              displayName: 'Private display name should not be exposed',
              email: 'private@example.test',
              sessionToken: 'private-token',
            },
          },
        }),
      ),
    );
    const foreignEvent = await admin.auditEvent.create({
      data: {
        agencyId: foreignAgency.id,
        actorMembershipId: foreignMembership.id,
        actorType: 'USER',
        action: 'ORGANIZATION_UNIT_CREATED',
        entityType: 'OrganizationUnit',
        entityId: '00000000-0000-4000-8000-000000000014',
        previousStatus: 'None',
        newStatus: 'DRAFT',
        metadata: { officialName: 'Foreign Unit' },
      },
    });
    const wrongTransitionEvent = await admin.auditEvent.create({
      data: {
        agencyId: agency.id,
        actorUserId: user.id,
        actorMembershipId: membership.id,
        actorType: 'USER',
        action: 'ORGANIZATION_UNIT_CREATED',
        entityType: 'OrganizationUnit',
        entityId: '00000000-0000-4000-8000-000000000015',
        previousStatus: 'DRAFT',
        newStatus: 'ACTIVE',
        metadata: { officialName: 'Wrong transition' },
      },
    });
    const otherActionEvent = await admin.auditEvent.create({
      data: {
        agencyId: agency.id,
        actorUserId: user.id,
        actorMembershipId: membership.id,
        actorType: 'USER',
        action: 'ORGANIZATION_UNIT_UPDATED',
        entityType: 'OrganizationUnit',
        entityId: entityIds[0]!,
        previousStatus: 'DRAFT',
        newStatus: 'ACTIVE',
        metadata: { officialName: 'Updated Unit' },
      },
    });
    const activationEvent = await admin.auditEvent.create({
      data: {
        agencyId: agency.id,
        actorUserId: user.id,
        actorMembershipId: membership.id,
        actorType: 'USER',
        action: 'ORGANIZATION_UNIT_ACTIVATED',
        entityType: 'OrganizationUnit',
        entityId: '00000000-0000-4000-8000-000000000016',
        previousStatus: 'DRAFT',
        newStatus: 'ACTIVE',
        reason: 'Approved reporting placement',
        requestId: 'audit-api-activation',
        occurredAt: new Date('2026-08-15T04:00:00.000Z'),
        metadata: {
          before: {
            officialName: 'Activated Unit',
            code: 'ACTIVE-UNIT',
            parentUnitId: null,
            versionState: 'DRAFT',
            lifecycleStatus: 'ACTIVE',
          },
          after: {
            officialName: 'Activated Unit',
            code: 'ACTIVE-UNIT',
            parentUnitId: entityIds[0],
            versionState: 'ACTIVE',
            lifecycleStatus: 'ACTIVE',
            sessionToken: 'private-token',
          },
        },
      },
    });

    try {
      const requestContext = {
        requestId: 'audit-api-read',
        userId: user.id,
        agencyId: agency.id,
        membershipId: membership.id,
        primaryOrganizationUnitId: null,
        permissions: [{ code: 'audit.events.read', scopePolicy: 'AGENCY' as const }],
      };
      const firstPage = await service.list(requestContext, { limit: 2 });
      expect(firstPage.events.map(({ entityId }) => entityId)).toEqual([
        activationEvent.entityId,
        entityIds[2],
      ]);
      expect(firstPage.hasMore).toBe(true);
      expect(firstPage.nextCursor).toEqual(expect.any(String));

      const secondPage = await service.list(requestContext, {
        limit: 2,
        cursor: firstPage.nextCursor ?? undefined,
      });
      expect(secondPage.events.map(({ entityId }) => entityId)).toEqual([
        entityIds[1],
        entityIds[0],
      ]);
      expect(secondPage.hasMore).toBe(false);
      await expect(service.findById(requestContext, foreignEvent.id)).resolves.toBeNull();
      await expect(service.findById(requestContext, wrongTransitionEvent.id)).resolves.toBeNull();
      await expect(service.findById(requestContext, otherActionEvent.id)).resolves.toBeNull();

      const detail = await service.findById(requestContext, events[2]!.id);
      expect(detail).toMatchObject({
        action: 'ORGANIZATION_UNIT_CREATED',
        previousStatus: 'None',
        newStatus: 'DRAFT',
        requestId: 'audit-api-request-2',
        before: null,
        after: { officialName: 'Organization Unit 2', code: 'UNIT-2' },
      });
      expect(JSON.stringify(detail)).not.toContain('Private display name');
      expect(JSON.stringify(detail)).not.toContain('private-token');
      expect(JSON.stringify(detail)).not.toContain('private@example.test');

      await expect(service.findById(requestContext, activationEvent.id)).resolves.toMatchObject({
        action: 'ORGANIZATION_UNIT_ACTIVATED',
        previousStatus: 'DRAFT',
        newStatus: 'ACTIVE',
        before: {
          officialName: 'Activated Unit',
          code: 'ACTIVE-UNIT',
          parentUnitId: null,
          versionState: 'DRAFT',
          lifecycleStatus: 'ACTIVE',
        },
        after: {
          officialName: 'Activated Unit',
          code: 'ACTIVE-UNIT',
          parentUnitId: entityIds[0],
          versionState: 'ACTIVE',
          lifecycleStatus: 'ACTIVE',
        },
      });
    } finally {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.auditEvent.deleteMany({
          where: { agencyId: { in: [agency.id, foreignAgency.id] } },
        });
      });
      await admin.agencyMembership.deleteMany({
        where: { agencyId: { in: [agency.id, foreignAgency.id] } },
      });
      await admin.user.delete({ where: { id: user.id } });
      await admin.agency.deleteMany({ where: { id: { in: [agency.id, foreignAgency.id] } } });
      await admin.$disconnect();
    }
  },
);
