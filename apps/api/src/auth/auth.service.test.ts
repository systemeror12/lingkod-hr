import { PrismaClient } from '@prisma/client';
import { hashSessionToken, type OidcIdentity, type RequestContext } from '@lingkod-hr/auth';
import { expect, it } from 'vitest';
import { AuthService } from './auth.service';

const enabled = process.env.DATABASE_E2E === 'true';

function identity(subject: string, email: string, authTime: Date | null = null): OidcIdentity {
  return {
    issuer: process.env.OIDC_ISSUER ?? 'https://example.invalid',
    subject,
    email,
    displayName: 'E2E User',
    emailVerified: true,
    providerSid: null,
    authTime,
    authenticationMethods: [],
  };
}

function databaseBytes(value: Buffer): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(value.byteLength));
  bytes.set(value);
  return bytes;
}

async function createAdminClient(): Promise<PrismaClient> {
  const databaseUrl = process.env.DATABASE_E2E_ADMIN_URL;
  if (!databaseUrl) throw new Error('DATABASE_E2E_ADMIN_URL is required for the integration test.');
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

async function cleanup(
  admin: PrismaClient,
  agencyIds: readonly string[],
  userId: string,
): Promise<void> {
  await admin.$executeRawUnsafe(
    'ALTER TABLE "security_events" DISABLE TRIGGER "security_events_append_only_trigger"',
  );
  await admin.$executeRawUnsafe(
    'ALTER TABLE "audit_events" DISABLE TRIGGER "audit_events_append_only_trigger"',
  );
  try {
    await admin.securityEvent.deleteMany({ where: { agencyId: { in: [...agencyIds] } } });
    await admin.auditEvent.deleteMany({ where: { agencyId: { in: [...agencyIds] } } });
  } finally {
    await admin.$executeRawUnsafe(
      'ALTER TABLE "security_events" ENABLE TRIGGER "security_events_append_only_trigger"',
    );
    await admin.$executeRawUnsafe(
      'ALTER TABLE "audit_events" ENABLE TRIGGER "audit_events_append_only_trigger"',
    );
  }
  await admin.userSession.deleteMany({ where: { userId } });
  await admin.externalIdentityLink.deleteMany({ where: { userId } });
  await admin.invitation.deleteMany({ where: { agencyId: { in: [...agencyIds] } } });
  await admin.agencyMembership.deleteMany({ where: { userId } });
  await admin.user.delete({ where: { id: userId } });
  await admin.agency.deleteMany({ where: { id: { in: [...agencyIds] } } });
}

it('rejects invitation role assignment without Agency-scoped role-management permission', async () => {
  const context: RequestContext = {
    requestId: 'request-role-authorization',
    userId: '00000000-0000-4000-8000-000000000001',
    agencyId: '00000000-0000-4000-8000-000000000002',
    membershipId: '00000000-0000-4000-8000-000000000003',
    primaryOrganizationUnitId: null,
    permissions: [
      { code: 'security.users.invite', scopePolicy: 'AGENCY' },
      { code: 'security.users.update_roles', scopePolicy: 'RESTRICTED' },
    ],
  };

  await expect(
    new AuthService().createInvitation(
      context,
      'invitee@example.test',
      ['security_administrator'],
      context.requestId,
    ),
  ).rejects.toMatchObject({ code: 'ROLE_ASSIGNMENT_FORBIDDEN', statusCode: 403 });
});

it.skipIf(!enabled)(
  'commits an expired invitation before returning its authentication error',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-expired`;
    const agency = await admin.agency.create({
      data: { code: `E2E-${suffix}`, name: 'E2E Agency', agencyType: 'NGA', status: 'ACTIVE' },
    });
    const user = await admin.user.create({
      data: {
        identityProvider: process.env.OIDC_ISSUER ?? 'https://example.invalid',
        externalSubject: `subject-${suffix}`,
        emailNormalized: `expired-${suffix}@example.test`,
        displayName: 'E2E User',
        globalStatus: 'ACTIVE',
      },
    });
    const membership = await admin.agencyMembership.create({
      data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
    });
    const token = `expired-token-${suffix}`;
    const invitation = await admin.invitation.create({
      data: {
        agencyId: agency.id,
        emailNormalized: user.emailNormalized,
        invitedByMembershipId: membership.id,
        tokenHash: databaseBytes(hashSessionToken(token)),
        requestedRoleCodes: [],
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        expiresAt: new Date('2026-08-02T00:00:00.000Z'),
        status: 'PENDING',
      },
    });

    try {
      await expect(
        new AuthService().signIn(
          identity(`subject-${suffix}`, user.emailNormalized),
          null,
          token,
          `request-${suffix}`,
        ),
      ).rejects.toMatchObject({ code: 'INVITATION_EXPIRED' });
      await expect(
        admin.invitation.findUniqueOrThrow({ where: { id: invitation.id } }),
      ).resolves.toMatchObject({ status: 'EXPIRED' });
    } finally {
      await cleanup(admin, [agency.id], user.id);
      await admin.$disconnect();
    }
  },
);

it.skipIf(!enabled)('allows a replacement after a pending invitation expires', async () => {
  const admin = await createAdminClient();
  const suffix = `${Date.now()}-replacement`;
  const email = `replacement-${suffix}@example.test`;
  const requestId = `request-${suffix}`;
  const agency = await admin.agency.create({
    data: { code: `E2E-${suffix}`, name: 'E2E Agency', agencyType: 'NGA', status: 'ACTIVE' },
  });
  const user = await admin.user.create({
    data: {
      identityProvider: process.env.OIDC_ISSUER ?? 'https://example.invalid',
      externalSubject: `subject-${suffix}`,
      emailNormalized: `inviter-${suffix}@example.test`,
      displayName: 'E2E User',
      globalStatus: 'ACTIVE',
    },
  });
  const membership = await admin.agencyMembership.create({
    data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
  });
  const staleInvitation = await admin.invitation.create({
    data: {
      agencyId: agency.id,
      emailNormalized: email,
      invitedByMembershipId: membership.id,
      tokenHash: databaseBytes(hashSessionToken(`stale-token-${suffix}`)),
      requestedRoleCodes: ['agency_administrator'],
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      expiresAt: new Date('2026-08-02T00:00:00.000Z'),
      status: 'PENDING',
    },
  });

  try {
    await expect(
      new AuthService().createInvitation(
        {
          requestId,
          userId: user.id,
          agencyId: agency.id,
          membershipId: membership.id,
          primaryOrganizationUnitId: null,
          permissions: [
            { code: 'security.users.invite', scopePolicy: 'AGENCY' },
            { code: 'security.users.update_roles', scopePolicy: 'AGENCY' },
          ],
        },
        email,
        ['agency_administrator'],
        requestId,
      ),
    ).resolves.toMatchObject({ email });
    await expect(
      admin.securityEvent.findFirst({
        where: { agencyId: agency.id, eventType: 'INVITATION_EXPIRED', requestId },
      }),
    ).resolves.toMatchObject({ details: { invitationId: staleInvitation.id } });
    await expect(
      admin.auditEvent.findFirst({
        where: { agencyId: agency.id, action: 'INVITATION_EXPIRED', requestId },
      }),
    ).resolves.toMatchObject({
      entityId: staleInvitation.id,
      previousStatus: 'PENDING',
      newStatus: 'EXPIRED',
    });
  } finally {
    await cleanup(admin, [agency.id], user.id);
    await admin.$disconnect();
  }
});

it.skipIf(!enabled)(
  'keeps absolute expiry and authentication time when switching agencies',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-switch`;
    const agencies = await Promise.all(
      ['A', 'B'].map((code) =>
        admin.agency.create({
          data: {
            code: `E2E-${code}-${suffix}`,
            name: `E2E Agency ${code}`,
            agencyType: 'NGA',
            status: 'ACTIVE',
          },
        }),
      ),
    );
    const authTime = new Date('2026-08-10T23:00:00.000Z');
    const user = await admin.user.create({
      data: {
        identityProvider: process.env.OIDC_ISSUER ?? 'https://example.invalid',
        externalSubject: `subject-${suffix}`,
        emailNormalized: `switch-${suffix}@example.test`,
        displayName: 'E2E User',
        globalStatus: 'ACTIVE',
      },
    });
    const memberships = await Promise.all(
      agencies.map(({ id }) =>
        admin.agencyMembership.create({
          data: { agencyId: id, userId: user.id, status: 'ACTIVE' },
        }),
      ),
    );
    const targetMembership = memberships[1];
    if (!targetMembership) throw new Error('The target E2E Agency Membership was not created.');

    try {
      const login = await new AuthService().signIn(
        identity(`subject-${suffix}`, user.emailNormalized, authTime),
        null,
        null,
        `request-${suffix}`,
      );
      const original = await admin.userSession.findUniqueOrThrow({
        where: { id: login.sessionId },
      });
      const switched = await new AuthService().switchAgency(
        login.token,
        login,
        targetMembership.id,
        `switch-${suffix}`,
      );
      const rotated = await admin.userSession.findUniqueOrThrow({
        where: { id: switched.sessionId },
      });
      const revoked = await admin.userSession.findUniqueOrThrow({
        where: { id: login.sessionId },
      });

      expect(rotated.createdAt).toEqual(original.createdAt);
      expect(rotated.expiresAt).toEqual(original.expiresAt);
      expect(rotated.authTime).toEqual(original.authTime);
      expect(revoked.revokedAt).not.toBeNull();
    } finally {
      await cleanup(
        admin,
        agencies.map(({ id }) => id),
        user.id,
      );
      await admin.$disconnect();
    }
  },
);
