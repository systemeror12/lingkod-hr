import { PrismaClient } from '@prisma/client';
import { hashSessionToken, type OidcIdentity, type RequestContext } from '@lingkod-hr/auth';
import type { ExecutionContext } from '@nestjs/common';
import type { Request, Response } from 'express';
import { expect, it, vi } from 'vitest';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService, AuthServiceError } from './auth.service';

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
  userIds: readonly string[],
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
  await admin.userSession.deleteMany({ where: { userId: { in: [...userIds] } } });
  await admin.membershipRole.deleteMany({ where: { agencyId: { in: [...agencyIds] } } });
  await admin.externalIdentityLink.deleteMany({ where: { userId: { in: [...userIds] } } });
  await admin.invitation.deleteMany({ where: { agencyId: { in: [...agencyIds] } } });
  await admin.agencyMembership.deleteMany({ where: { userId: { in: [...userIds] } } });
  await admin.user.deleteMany({ where: { id: { in: [...userIds] } } });
  await admin.role.deleteMany({ where: { agencyId: { in: [...agencyIds] } } });
  await admin.agency.deleteMany({ where: { id: { in: [...agencyIds] } } });
}

it('records an OIDC callback failure once with its reason and client IP', async () => {
  const recordLoginFailure = vi.fn().mockResolvedValue(undefined);
  const authService = {
    assertLoginAllowed: vi.fn().mockResolvedValue(undefined),
    completeLogin: vi
      .fn()
      .mockRejectedValue(new AuthServiceError('Membership denied.', 403, 'MEMBERSHIP_DENIED')),
    recordLoginFailure,
  } as unknown as AuthService;
  const request = {
    headers: { cookie: 'hris_oidc_flow=flow-cookie' },
    header: () => 'request-callback-failure',
    ip: '203.0.113.1',
  } as unknown as Request;

  await expect(
    new AuthController(authService).callback('state', 'code', request, {} as Response),
  ).rejects.toMatchObject({ status: 403 });
  expect(recordLoginFailure).toHaveBeenCalledOnce();
  expect(recordLoginFailure).toHaveBeenCalledWith(
    'request-callback-failure',
    'MEMBERSHIP_DENIED',
    '203.0.113.1',
  );
});

it('rejects an untrusted cookie origin before refreshing the session', async () => {
  const authenticateSession = vi.fn();
  const request = {
    headers: { cookie: 'hris_session=session-token' },
    header: (name: string) =>
      name === 'origin'
        ? 'https://attacker.example'
        : name === 'x-request-id'
          ? 'request-cross-site'
          : undefined,
  } as unknown as Request;
  const executionContext = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  await expect(
    new AuthGuard({ authenticateSession } as unknown as AuthService).canActivate(executionContext),
  ).rejects.toMatchObject({ status: 403 });
  expect(authenticateSession).not.toHaveBeenCalled();
});

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
    const inviter = await admin.user.create({
      data: {
        identityProvider: process.env.OIDC_ISSUER ?? 'https://example.invalid',
        externalSubject: `inviter-${suffix}`,
        emailNormalized: `inviter-${suffix}@example.test`,
        displayName: 'E2E User',
        globalStatus: 'ACTIVE',
      },
    });
    const membership = await admin.agencyMembership.create({
      data: { agencyId: agency.id, userId: inviter.id, status: 'ACTIVE' },
    });
    const inviteeEmail = `expired-${suffix}@example.test`;
    const token = `expired-token-${suffix}`;
    const invitation = await admin.invitation.create({
      data: {
        agencyId: agency.id,
        emailNormalized: inviteeEmail,
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
          identity(`subject-${suffix}`, inviteeEmail),
          null,
          token,
          `request-${suffix}`,
        ),
      ).rejects.toMatchObject({ code: 'INVITATION_EXPIRED' });
      await expect(
        admin.invitation.findUniqueOrThrow({ where: { id: invitation.id } }),
      ).resolves.toMatchObject({ status: 'EXPIRED' });
      await expect(
        admin.securityEvent.findFirstOrThrow({
          where: {
            agencyId: agency.id,
            eventType: 'INVITATION_EXPIRED',
            requestId: `request-${suffix}`,
          },
        }),
      ).resolves.toMatchObject({ details: { invitationId: invitation.id } });
      await expect(
        admin.auditEvent.findFirstOrThrow({
          where: {
            agencyId: agency.id,
            action: 'INVITATION_EXPIRED',
            requestId: `request-${suffix}`,
          },
        }),
      ).resolves.toMatchObject({
        actorType: 'SYSTEM',
        entityId: invitation.id,
        previousStatus: 'PENDING',
        newStatus: 'EXPIRED',
      });
      await expect(
        admin.user.findUnique({ where: { emailNormalized: inviteeEmail } }),
      ).resolves.toBeNull();
    } finally {
      await cleanup(admin, [agency.id], [inviter.id]);
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
  const context: RequestContext = {
    requestId,
    userId: user.id,
    agencyId: agency.id,
    membershipId: membership.id,
    primaryOrganizationUnitId: null,
    permissions: [
      { code: 'security.users.invite', scopePolicy: 'AGENCY' },
      { code: 'security.users.update_roles', scopePolicy: 'AGENCY' },
    ],
  };

  try {
    await expect(
      new AuthService().createInvitation(
        context,
        user.emailNormalized,
        ['agency_administrator'],
        requestId,
      ),
    ).rejects.toMatchObject({ code: 'MEMBERSHIP_EXISTS', statusCode: 409 });
    await expect(
      new AuthService().createInvitation(context, email, ['agency_administrator'], requestId),
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
    await cleanup(admin, [agency.id], [user.id]);
    await admin.$disconnect();
  }
});

it.skipIf(!enabled)(
  'reconciles linked verified emails and rejects ownership conflicts',
  async () => {
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-email-change`;
    const issuer = process.env.OIDC_ISSUER ?? 'https://example.invalid';
    const newEmail = `updated-${suffix}@example.test`;
    const agency = await admin.agency.create({
      data: { code: `E2E-${suffix}`, name: 'E2E Agency', agencyType: 'NGA', status: 'ACTIVE' },
    });
    const users = await Promise.all(
      ['first', 'second'].map((label) =>
        admin.user.create({
          data: {
            identityProvider: issuer,
            externalSubject: `${label}-${suffix}`,
            emailNormalized: `${label}-${suffix}@example.test`,
            displayName: `E2E ${label}`,
            globalStatus: 'ACTIVE',
          },
        }),
      ),
    );
    const firstUser = users[0];
    const secondUser = users[1];
    if (!firstUser || !secondUser) throw new Error('The E2E Users were not created.');
    await Promise.all(
      users.map(async (user) => {
        await admin.agencyMembership.create({
          data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
        });
        await admin.externalIdentityLink.create({
          data: { userId: user.id, issuer, subject: user.externalSubject, status: 'ACTIVE' },
        });
      }),
    );

    try {
      await new AuthService().signIn(identity(firstUser.externalSubject, newEmail));
      await expect(
        admin.user.findUniqueOrThrow({ where: { id: firstUser.id } }),
      ).resolves.toMatchObject({ emailNormalized: newEmail });
      await expect(
        new AuthService().signIn(identity(secondUser.externalSubject, newEmail)),
      ).rejects.toMatchObject({ code: 'EMAIL_ALREADY_IN_USE', statusCode: 401 });
    } finally {
      await cleanup(
        admin,
        [agency.id],
        users.map(({ id }) => id),
      );
      await admin.$disconnect();
    }
  },
);

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
    const subject = `subject-${suffix}`;
    const user = await admin.user.create({
      data: {
        identityProvider: process.env.OIDC_ISSUER ?? 'https://example.invalid',
        externalSubject: subject,
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
    const sourceAgency = agencies[0];
    const sourceMembership = memberships[0];
    const targetMembership = memberships[1];
    if (!sourceAgency || !sourceMembership || !targetMembership) {
      throw new Error('The E2E Agencies and Memberships were not created.');
    }

    try {
      const service = new AuthService();
      const login = await service.signIn(
        identity(subject, user.emailNormalized, authTime),
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
      await expect(
        admin.auditEvent.findFirstOrThrow({
          where: {
            agencyId: login.context.agencyId,
            action: 'SESSION_REVOKED',
            entityId: login.sessionId,
          },
        }),
      ).resolves.toMatchObject({ reason: 'AGENCY_CONTEXT_SWITCHED' });
      await expect(
        admin.securityEvent.findFirstOrThrow({
          where: {
            agencyId: login.context.agencyId,
            eventType: 'SESSION_REVOKED',
            requestId: `switch-${suffix}`,
          },
        }),
      ).resolves.toMatchObject({ details: { reason: 'AGENCY_CONTEXT_SWITCHED' } });
      await expect(
        service.revokeSession(login.token, login, 'USER_LOGOUT', `stale-logout-${suffix}`),
      ).resolves.toBeNull();
      await expect(
        admin.auditEvent.findFirst({ where: { requestId: `stale-logout-${suffix}` } }),
      ).resolves.toBeNull();
      const expiredToken = `expired-session-${suffix}`;
      const expiredSession = await admin.userSession.create({
        data: {
          userId: user.id,
          agencyId: login.context.agencyId,
          agencyMembershipId: login.context.membershipId,
          sessionTokenHash: databaseBytes(hashSessionToken(expiredToken)),
          createdAt: new Date('2026-08-01T00:00:00.000Z'),
          lastSeenAt: new Date('2026-08-01T00:00:00.000Z'),
          expiresAt: new Date('2026-08-02T00:00:00.000Z'),
        },
      });
      await expect(
        service.authenticateSession(expiredToken, `expired-${suffix}`),
      ).resolves.toBeNull();
      await expect(
        admin.auditEvent.findFirstOrThrow({
          where: {
            agencyId: login.context.agencyId,
            action: 'SESSION_REVOKED',
            entityId: expiredSession.id,
          },
        }),
      ).resolves.toMatchObject({
        actorType: 'SYSTEM',
        reason: 'SESSION_EXPIRED_OR_ACCESS_REMOVED',
      });
      Object.defineProperty(service, 'oidc', {
        value: {
          verifyLogoutToken: async () => ({
            eventId: `backchannel-${suffix}`,
            subject,
            providerSid: null,
          }),
        },
      });
      await service.handleBackChannelLogout('verified-by-test-double', `backchannel-${suffix}`);
      await expect(
        admin.userSession.findUniqueOrThrow({ where: { id: switched.sessionId } }),
      ).resolves.toMatchObject({
        revocationReason: 'OIDC_BACKCHANNEL_LOGOUT',
      });
      await expect(
        admin.auditEvent.findFirstOrThrow({
          where: {
            agencyId: switched.context.agencyId,
            action: 'SESSION_REVOKED',
            entityId: switched.sessionId,
          },
        }),
      ).resolves.toMatchObject({ actorType: 'SYSTEM', reason: 'OIDC_BACKCHANNEL_LOGOUT' });

      const inactiveAgencyToken = `inactive-agency-${suffix}`;
      const inactiveAgencySession = await admin.userSession.create({
        data: {
          userId: user.id,
          agencyId: sourceAgency.id,
          agencyMembershipId: sourceMembership.id,
          sessionTokenHash: databaseBytes(hashSessionToken(inactiveAgencyToken)),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });
      await admin.agency.update({
        where: { id: sourceAgency.id },
        data: { status: 'SUSPENDED' },
      });
      await expect(
        new AuthService().authenticateSession(inactiveAgencyToken, `inactive-agency-${suffix}`),
      ).resolves.toBeNull();
      await expect(
        admin.userSession.findUniqueOrThrow({ where: { id: inactiveAgencySession.id } }),
      ).resolves.toMatchObject({ revocationReason: 'SESSION_EXPIRED_OR_ACCESS_REMOVED' });
      await expect(
        new AuthService().signIn(
          identity(subject, user.emailNormalized, authTime),
          sourceMembership.id,
        ),
      ).rejects.toMatchObject({ code: 'MEMBERSHIP_DENIED' });
    } finally {
      await cleanup(
        admin,
        agencies.map(({ id }) => id),
        [user.id],
      );
      await admin.$disconnect();
    }
  },
);

it.skipIf(!enabled)('prefers Agency roles and audits invitation role assignments', async () => {
  const admin = await createAdminClient();
  const suffix = `${Date.now()}-role-override`;
  const requestId = `request-${suffix}`;
  const agency = await admin.agency.create({
    data: { code: `E2E-${suffix}`, name: 'E2E Agency', agencyType: 'NGA', status: 'ACTIVE' },
  });
  const priorAgency = await admin.agency.create({
    data: {
      code: `E2E-PRIOR-${suffix}`,
      name: 'Prior E2E Agency',
      agencyType: 'NGA',
      status: 'ACTIVE',
    },
  });
  const inviter = await admin.user.create({
    data: {
      identityProvider: process.env.OIDC_ISSUER ?? 'https://example.invalid',
      externalSubject: `inviter-${suffix}`,
      emailNormalized: `inviter-${suffix}@example.test`,
      displayName: 'E2E User',
      globalStatus: 'ACTIVE',
    },
  });
  const inviterMembership = await admin.agencyMembership.create({
    data: { agencyId: agency.id, userId: inviter.id, status: 'ACTIVE' },
  });
  const agencyRole = await admin.role.create({
    data: {
      agencyId: agency.id,
      code: 'agency_administrator',
      name: 'Agency override',
      status: 'ACTIVE',
    },
  });
  const inviteeEmail = `invitee-${suffix}@example.test`;
  const invitee = await admin.user.create({
    data: {
      identityProvider: process.env.OIDC_ISSUER ?? 'https://example.invalid',
      externalSubject: `invitee-${suffix}`,
      emailNormalized: inviteeEmail,
      displayName: 'E2E Invitee',
      globalStatus: 'ACTIVE',
    },
  });
  await admin.agencyMembership.create({
    data: { agencyId: priorAgency.id, userId: invitee.id, status: 'ACTIVE' },
  });

  try {
    const invitation = await new AuthService().createInvitation(
      {
        requestId,
        userId: inviter.id,
        agencyId: agency.id,
        membershipId: inviterMembership.id,
        primaryOrganizationUnitId: null,
        permissions: [
          { code: 'security.users.invite', scopePolicy: 'AGENCY' },
          { code: 'security.users.update_roles', scopePolicy: 'AGENCY' },
        ],
      },
      inviteeEmail,
      ['agency_administrator'],
      requestId,
    );
    const login = await new AuthService().signIn(
      identity(`invitee-${suffix}`, inviteeEmail),
      null,
      invitation.activationToken,
      requestId,
    );
    const membership = await admin.agencyMembership.findFirstOrThrow({
      where: { agencyId: agency.id, userId: invitee.id },
    });
    expect(login.context).toMatchObject({ agencyId: agency.id, membershipId: membership.id });

    await expect(
      admin.membershipRole.findFirstOrThrow({
        where: { agencyId: agency.id, membershipId: membership.id },
      }),
    ).resolves.toMatchObject({
      roleId: agencyRole.id,
      assignedByMembershipId: inviterMembership.id,
    });
    await expect(
      admin.auditEvent.findFirstOrThrow({
        where: { agencyId: agency.id, action: 'INVITATION_ACCEPTED', requestId },
      }),
    ).resolves.toMatchObject({
      metadata: {
        invitationId: invitation.id,
        roleCodes: ['agency_administrator'],
        assignedByMembershipId: inviterMembership.id,
      },
    });
  } finally {
    await cleanup(admin, [agency.id, priorAgency.id], [inviter.id, invitee.id]);
    await admin.$disconnect();
  }
});
