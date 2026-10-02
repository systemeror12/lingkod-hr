import { argon2Sync, randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import {
  generateRecoveryCodes,
  generateTotpSecret,
  hashEmail,
  hashPassword,
  hashSessionToken,
  normalizeRecoveryCode,
  type OidcIdentity,
  type RequestContext,
  sealTotpSecret,
  totpCode,
  verifyPassword,
  verifyPasswordAgainstDummy,
} from '@lingkod-hr/auth';
import { getConfig, parseProtectedValueKey } from '@lingkod-hr/config';
import { EventEmitter } from 'node:events';
import { type ExecutionContext, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { expect, it, vi } from 'vitest';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService, AuthServiceError } from './auth.service';
import type { MailDelivery, MailMessage } from '../invitations/mail';

vi.mock('@lingkod-hr/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lingkod-hr/auth')>();
  return {
    ...actual,
    verifyPasswordAgainstDummy: vi.fn(actual.verifyPasswordAgainstDummy),
  };
});

const enabled = process.env.DATABASE_E2E === 'true';
const issuer = getConfig().OIDC_ISSUER;

function identity(subject: string, email: string, authTime: Date | null = null): OidcIdentity {
  return {
    issuer,
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
  await admin.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    await transaction.securityEvent.deleteMany({ where: { agencyId: { in: [...agencyIds] } } });
    await transaction.auditEvent.deleteMany({ where: { agencyId: { in: [...agencyIds] } } });
  });
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

it('keeps the HRMO invitation workflow to exactly one eligible role', async () => {
  const context: RequestContext = {
    requestId: 'request-hrmo-role-policy',
    userId: '00000000-0000-4000-8000-000000000001',
    agencyId: '00000000-0000-4000-8000-000000000002',
    membershipId: '00000000-0000-4000-8000-000000000003',
    primaryOrganizationUnitId: null,
    permissions: [
      { code: 'security.users.invite', scopePolicy: 'AGENCY' },
      { code: 'security.users.update_roles', scopePolicy: 'AGENCY' },
    ],
  };

  await expect(
    new AuthService().createHrmoAdministratorInvitation(
      context,
      'invitee@example.test',
      ['agency_administrator'],
      context.requestId,
    ),
  ).rejects.toMatchObject({ code: 'ROLE_NOT_ALLOWED', statusCode: 400 });
  await expect(
    new AuthService().createHrmoAdministratorInvitation(
      context,
      'invitee@example.test',
      ['hrmo_administrator', 'hrmo_administrator'],
      context.requestId,
    ),
  ).rejects.toMatchObject({ code: 'ROLE_NOT_ALLOWED', statusCode: 400 });
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
        identityProvider: issuer,
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
      identityProvider: issuer,
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
      new AuthService().createInvitation(context, email, ['agency_administrator'], requestId),
    ).rejects.toMatchObject({ code: 'INVITATION_PENDING', statusCode: 409 });
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
          data: { userId: user.id, issuer, subject: user.externalSubject ?? '', status: 'ACTIVE' },
        });
      }),
    );

    try {
      await new AuthService().signIn(identity(firstUser.externalSubject ?? '', newEmail));
      await expect(
        admin.user.findUniqueOrThrow({ where: { id: firstUser.id } }),
      ).resolves.toMatchObject({ emailNormalized: newEmail });
      await expect(
        new AuthService().signIn(identity(secondUser.externalSubject ?? '', newEmail)),
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
        identityProvider: issuer,
        externalSubject: subject,
        emailNormalized: `switch-${suffix}@example.test`,
        displayName: 'E2E User',
        globalStatus: 'ACTIVE',
      },
    });
    await admin.externalIdentityLink.create({
      data: { userId: user.id, issuer, subject, status: 'ACTIVE' },
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
      identityProvider: issuer,
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
      identityProvider: issuer,
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

interface OwnedLoginFixture {
  admin: PrismaClient;
  agencyIds: string[];
  membershipIds: string[];
  user: {
    id: string;
    email: string;
    password: string;
    totpSecret: string | null;
    recoveryCodes: string[];
  };
  cleanup: () => Promise<void>;
}

/**
 * An Agency Administrator (an MFA-Required User) in two Agencies, with a password and, unless
 * `withTotp` is false, a TOTP factor sealed with the run's `DATA_ENCRYPTION_KEY`, plus
 * `recoveryCodes` Recovery Codes stored as Argon2id hashes.
 */
async function ownedLoginFixture(
  options: {
    withTotp?: boolean;
    mfaRequired?: boolean;
    passwordHash?: string;
    recoveryCodes?: number;
  } = {},
): Promise<OwnedLoginFixture> {
  const admin = await createAdminClient();
  const suffix = `${Date.now()}-${randomBytes(4).toString('hex')}`;
  const email = `owned-login-${suffix}@example.test`;
  const password = `owned login passphrase ${suffix}`;
  const agencies = await Promise.all(
    ['A', 'B'].map((label) =>
      admin.agency.create({
        data: {
          code: `OWNED-LOGIN-${label}-${suffix}`,
          name: `Owned Login ${label}`,
          agencyType: 'NGA',
          status: 'ACTIVE',
        },
      }),
    ),
  );
  const user = await admin.user.create({
    data: { emailNormalized: email, displayName: 'Owned Login User', globalStatus: 'ACTIVE' },
  });
  const memberships = [];
  for (const agency of agencies) {
    memberships.push(
      await admin.agencyMembership.create({
        data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE', activatedAt: new Date() },
      }),
    );
  }
  if (options.mfaRequired ?? true) {
    const role = await admin.role.findFirstOrThrow({
      where: { code: 'agency_administrator', agencyId: null },
    });
    for (const membership of memberships) {
      await admin.membershipRole.create({
        data: {
          agencyId: membership.agencyId,
          membershipId: membership.id,
          roleId: role.id,
          effectiveFrom: new Date(Date.now() - 60_000),
          reason: 'Owned login fixture',
        },
      });
    }
  }
  await admin.userPassword.create({
    data: { userId: user.id, passwordHash: options.passwordHash ?? (await hashPassword(password)) },
  });
  let totpSecret: string | null = null;
  if (options.withTotp ?? true) {
    totpSecret = generateTotpSecret();
    const factorId = randomUUID();
    await admin.userTotpFactor.create({
      data: {
        id: factorId,
        userId: user.id,
        secretEnvelope: databaseBytes(
          sealTotpSecret(totpSecret, parseProtectedValueKey(getConfig().DATA_ENCRYPTION_KEY), {
            userId: user.id,
            factorId,
          }),
        ),
      },
    });
  }
  const recoveryCodes = generateRecoveryCodes().slice(0, options.recoveryCodes ?? 0);
  for (const code of recoveryCodes) {
    await admin.userRecoveryCode.create({
      data: { userId: user.id, codeHash: await hashPassword(normalizeRecoveryCode(code) ?? '') },
    });
  }
  const agencyIds = agencies.map(({ id }) => id);
  return {
    admin,
    agencyIds,
    membershipIds: memberships.map(({ id }) => id),
    user: { id: user.id, email, password, totpSecret, recoveryCodes },
    cleanup: async () => {
      const emailHash = databaseBytes(hashEmail(email, getConfig().BLIND_INDEX_KEY));
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.securityEvent.deleteMany({
          where: {
            OR: [
              { userId: user.id },
              { emailHash },
              { userId: null, requestId: { startsWith: 'owned-login-' } },
            ],
          },
        });
      });
      await cleanup(admin, agencyIds, [user.id]);
      await admin.$disconnect();
    },
  };
}

function signInRequest(label: string) {
  return { requestId: `owned-login-${label}-${randomUUID()}`, ipAddress: '198.51.100.7' };
}

it.skipIf(!enabled)(
  'signs an MFA-Required User in with password and TOTP into the requested Agency Membership',
  async () => {
    const fixture = await ownedLoginFixture();
    const { admin, user } = fixture;
    try {
      const service = new AuthService();
      const started = await service.signInWithPassword(
        user.email,
        user.password,
        fixture.membershipIds[1] ?? null,
        signInRequest('password'),
      );
      if (started.status !== 'TOTP_REQUIRED') throw new Error('Expected a TOTP challenge.');

      const pending = await admin.pendingAuthentication.findMany({ where: { userId: user.id } });
      expect(pending).toHaveLength(1);
      expect(Buffer.from(pending[0]?.tokenHash ?? [])).toEqual(
        hashSessionToken(started.pendingToken),
      );
      expect(pending[0]).toMatchObject({ purpose: 'SIGN_IN', verifiedMethods: ['pwd'] });
      const lifetime = (pending[0]?.expiresAt.getTime() ?? 0) - Date.now();
      expect(lifetime).toBeGreaterThan(4 * 60 * 1000);
      expect(lifetime).toBeLessThanOrEqual(5 * 60 * 1000);

      const before = Date.now();
      const session = await service.completeTotpSignIn(
        started.pendingToken,
        totpCode(user.totpSecret ?? ''),
        signInRequest('totp'),
      );
      expect(session.authenticationMethods).toEqual(['pwd', 'totp']);
      expect(session.authTime?.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(session.context).toMatchObject({
        userId: user.id,
        agencyId: fixture.agencyIds[1],
        membershipId: fixture.membershipIds[1],
      });
      await expect(admin.pendingAuthentication.count({ where: { userId: user.id } })).resolves.toBe(
        0,
      );
      // The owned methods count as MFA evidence, so the MFA-Required session stays active.
      await expect(
        service.authenticateSession(session.token, 'request-owned-me'),
      ).resolves.toMatchObject({ sessionId: session.sessionId });
    } finally {
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)(
  'gives a wrong password and an unknown email the same answer after a dummy verification',
  async () => {
    const fixture = await ownedLoginFixture();
    try {
      const service = new AuthService();
      const wrongPassword = await service
        .signInWithPassword(
          fixture.user.email,
          'not the right passphrase',
          null,
          signInRequest('a'),
        )
        .catch((error: unknown) => error);
      vi.mocked(verifyPasswordAgainstDummy).mockClear();
      const unknownEmail = await service
        .signInWithPassword(
          `nobody-${randomUUID()}@example.test`,
          fixture.user.password,
          null,
          signInRequest('b'),
        )
        .catch((error: unknown) => error);

      expect(wrongPassword).toBeInstanceOf(AuthServiceError);
      expect(unknownEmail).toBeInstanceOf(AuthServiceError);
      for (const error of [wrongPassword, unknownEmail] as AuthServiceError[]) {
        expect({ code: error.code, statusCode: error.statusCode, message: error.message }).toEqual({
          code: 'INVALID_CREDENTIALS',
          statusCode: 401,
          message: 'The email or password is incorrect.',
        });
      }
      expect(verifyPasswordAgainstDummy).toHaveBeenCalledOnce();
    } finally {
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)(
  'signs a User without a factor straight in and rehashes a password with old parameters',
  async () => {
    const salt = Buffer.alloc(16, 5);
    const password = `legacy passphrase ${randomUUID()}`;
    const legacyTag = argon2Sync('argon2id', {
      message: password,
      nonce: salt,
      memory: 19456,
      passes: 2,
      parallelism: 1,
      tagLength: 32,
    });
    const unpadded = (value: Buffer) => value.toString('base64').replace(/=+$/, '');
    const legacyHash = `$argon2id$v=19$m=19456,t=2,p=1$${unpadded(salt)}$${unpadded(legacyTag)}`;
    const fixture = await ownedLoginFixture({
      withTotp: false,
      mfaRequired: false,
      passwordHash: legacyHash,
    });
    try {
      const result = await new AuthService().signInWithPassword(
        fixture.user.email,
        password,
        null,
        signInRequest('legacy'),
      );
      if (result.status !== 'SIGNED_IN') throw new Error('Expected a session.');
      expect(result.session.authenticationMethods).toEqual(['pwd']);

      const stored = await fixture.admin.userPassword.findUniqueOrThrow({
        where: { userId: fixture.user.id },
      });
      expect(stored.passwordHash).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
      await expect(verifyPassword(stored.passwordHash, password)).resolves.toBe(true);
    } finally {
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)(
  'accepts exactly one of two concurrent submissions of a TOTP code, then refuses its replay',
  async () => {
    const fixture = await ownedLoginFixture();
    const { user } = fixture;
    try {
      const service = new AuthService();
      const started = await service.signInWithPassword(
        user.email,
        user.password,
        null,
        signInRequest('race'),
      );
      if (started.status !== 'TOTP_REQUIRED') throw new Error('Expected a TOTP challenge.');
      const code = totpCode(user.totpSecret ?? '');

      const results = await Promise.allSettled([
        service.completeTotpSignIn(started.pendingToken, code, signInRequest('race-1')),
        service.completeTotpSignIn(started.pendingToken, code, signInRequest('race-2')),
      ]);
      expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
      await expect(fixture.admin.userSession.count({ where: { userId: user.id } })).resolves.toBe(
        1,
      );

      const again = await service.signInWithPassword(
        user.email,
        user.password,
        null,
        signInRequest('replay'),
      );
      if (again.status !== 'TOTP_REQUIRED') throw new Error('Expected a TOTP challenge.');
      await expect(
        service.completeTotpSignIn(again.pendingToken, code, signInRequest('replay-code')),
      ).rejects.toMatchObject({ code: 'INVALID_CODE', statusCode: 401 });
    } finally {
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)(
  'replaces a pending sign-in when the User starts over and refuses an expired one',
  async () => {
    const fixture = await ownedLoginFixture();
    const { admin, user } = fixture;
    try {
      const service = new AuthService();
      const first = await service.signInWithPassword(
        user.email,
        user.password,
        null,
        signInRequest('first'),
      );
      const second = await service.signInWithPassword(
        user.email,
        user.password,
        null,
        signInRequest('second'),
      );
      if (first.status !== 'TOTP_REQUIRED' || second.status !== 'TOTP_REQUIRED') {
        throw new Error('Expected TOTP challenges.');
      }
      await expect(admin.pendingAuthentication.count({ where: { userId: user.id } })).resolves.toBe(
        1,
      );
      const replacedRequest = signInRequest('first-code');
      await expect(
        service.completeTotpSignIn(
          first.pendingToken,
          totpCode(user.totpSecret ?? ''),
          replacedRequest,
        ),
      ).rejects.toMatchObject({ code: 'SIGN_IN_EXPIRED', statusCode: 401 });
      // A token that opens no pending sign-in is still a recorded attempt.
      await expect(
        admin.securityEvent.findMany({
          where: { requestId: replacedRequest.requestId },
          select: { eventType: true, userId: true, ipAddress: true, details: true },
        }),
      ).resolves.toEqual([
        {
          eventType: 'LOGIN_FAILURE',
          userId: null,
          ipAddress: '198.51.100.7',
          details: { reason: 'SIGN_IN_EXPIRED', method: 'totp' },
        },
      ]);

      await admin.pendingAuthentication.updateMany({
        where: { userId: user.id },
        data: {
          createdAt: new Date(Date.now() - 10 * 60 * 1000),
          expiresAt: new Date(Date.now() - 1000),
        },
      });
      await expect(
        service.completeTotpSignIn(
          second.pendingToken,
          totpCode(user.totpSecret ?? ''),
          signInRequest('second-code'),
        ),
      ).rejects.toMatchObject({ code: 'SIGN_IN_EXPIRED', statusCode: 401 });
      await expect(admin.pendingAuthentication.count({ where: { userId: user.id } })).resolves.toBe(
        0,
      );
      await expect(admin.userSession.count({ where: { userId: user.id } })).resolves.toBe(0);
    } finally {
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)(
  'records every sign-in attempt with the email hash and never a password, code, token, or email',
  async () => {
    const fixture = await ownedLoginFixture();
    const { admin, user } = fixture;
    try {
      const service = new AuthService();
      const requests = ['wrong-password', 'password', 'wrong-code', 'code'].map(signInRequest);
      const [wrongPasswordRequest, passwordRequest, wrongCodeRequest, codeRequest] = requests;
      if (!wrongPasswordRequest || !passwordRequest || !wrongCodeRequest || !codeRequest) {
        throw new Error('Requests were not prepared.');
      }
      await expect(
        service.signInWithPassword(
          user.email,
          'a wrong passphrase here',
          null,
          wrongPasswordRequest,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
      const started = await service.signInWithPassword(
        user.email.toUpperCase(),
        user.password,
        null,
        passwordRequest,
      );
      if (started.status !== 'TOTP_REQUIRED') throw new Error('Expected a TOTP challenge.');
      const code = totpCode(user.totpSecret ?? '');
      const wrongCode = code === '000000' ? '000001' : '000000';
      await expect(
        service.completeTotpSignIn(started.pendingToken, wrongCode, wrongCodeRequest),
      ).rejects.toMatchObject({ code: 'INVALID_CODE' });
      const session = await service.completeTotpSignIn(started.pendingToken, code, codeRequest);

      const events = await admin.securityEvent.findMany({
        where: { requestId: { in: requests.map(({ requestId }) => requestId) } },
        orderBy: { occurredAt: 'asc' },
      });
      expect(events.map(({ requestId, eventType }) => [requestId, eventType])).toEqual([
        [wrongPasswordRequest.requestId, 'LOGIN_FAILURE'],
        [passwordRequest.requestId, 'SIGN_IN_PASSWORD_VERIFIED'],
        [wrongCodeRequest.requestId, 'LOGIN_FAILURE'],
        [codeRequest.requestId, 'LOGIN_SUCCESS'],
      ]);
      const emailHash = hashEmail(user.email, getConfig().BLIND_INDEX_KEY);
      for (const event of events) {
        expect(Buffer.from(event.emailHash ?? [])).toEqual(emailHash);
        expect(event.ipAddress).toBe('198.51.100.7');
        const serialized = JSON.stringify(event).toLowerCase();
        for (const secret of [
          user.password,
          user.email,
          code,
          started.pendingToken,
          session.token,
        ]) {
          expect(serialized).not.toContain(secret.toLowerCase());
        }
      }
    } finally {
      await fixture.cleanup();
    }
  },
);

/** Opens a pending sign-in for the fixture User and returns its token. */
async function passwordVerified(service: AuthService, fixture: OwnedLoginFixture, label: string) {
  const started = await service.signInWithPassword(
    fixture.user.email,
    fixture.user.password,
    null,
    signInRequest(label),
  );
  if (started.status !== 'TOTP_REQUIRED') throw new Error('Expected a second-factor challenge.');
  return started.pendingToken;
}

it.skipIf(!enabled)(
  'signs in with a Recovery Code in any case or spacing, deletes it, and reports the codes left',
  async () => {
    const fixture = await ownedLoginFixture({ recoveryCodes: 3 });
    const { admin, user } = fixture;
    try {
      const service = new AuthService();
      const [code] = user.recoveryCodes;
      if (!code) throw new Error('Expected a Recovery Code.');
      const pendingToken = await passwordVerified(service, fixture, 'recovery');

      const typed = ` ${code.replace('-', ' ').toUpperCase()} `;
      const result = await service.completeRecoveryCodeSignIn(
        pendingToken,
        typed,
        signInRequest('recovery-code'),
      );
      expect(result.recoveryCodesRemaining).toBe(2);
      expect(result.session.authenticationMethods).toEqual(['pwd', 'recovery_code']);
      await expect(
        service.authenticateSession(result.session.token, 'request-recovery-me'),
      ).resolves.toMatchObject({ sessionId: result.session.sessionId });
      await expect(admin.userRecoveryCode.count({ where: { userId: user.id } })).resolves.toBe(2);
      await expect(admin.pendingAuthentication.count({ where: { userId: user.id } })).resolves.toBe(
        0,
      );

      // The used code is gone: a second sign-in can't spend it again.
      const again = await passwordVerified(service, fixture, 'recovery-again');
      await expect(
        service.completeRecoveryCodeSignIn(again, code, signInRequest('recovery-reuse')),
      ).rejects.toMatchObject({ code: 'INVALID_CODE', statusCode: 401 });
    } finally {
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)(
  'accepts exactly one of two concurrent submissions of one Recovery Code',
  async () => {
    const fixture = await ownedLoginFixture({ recoveryCodes: 2 });
    const { admin, user } = fixture;
    try {
      const service = new AuthService();
      const [code] = user.recoveryCodes;
      if (!code) throw new Error('Expected a Recovery Code.');
      const pendingToken = await passwordVerified(service, fixture, 'recovery-race');

      const results = await Promise.allSettled([
        service.completeRecoveryCodeSignIn(pendingToken, code, signInRequest('recovery-race-1')),
        service.completeRecoveryCodeSignIn(pendingToken, code, signInRequest('recovery-race-2')),
      ]);
      expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      await expect(admin.userSession.count({ where: { userId: user.id } })).resolves.toBe(1);
      await expect(admin.userRecoveryCode.count({ where: { userId: user.id } })).resolves.toBe(1);
    } finally {
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)(
  "revokes the User's other sessions in every Agency when a Recovery Code signs them in",
  async () => {
    const fixture = await ownedLoginFixture({ recoveryCodes: 1 });
    const { admin, user } = fixture;
    try {
      const service = new AuthService();
      const others = [];
      for (const [index, membershipId] of fixture.membershipIds.entries()) {
        const started = await service.signInWithPassword(
          user.email,
          user.password,
          membershipId,
          signInRequest(`other-${index}`),
        );
        if (started.status !== 'TOTP_REQUIRED') throw new Error('Expected a TOTP challenge.');
        // Each sign-in needs an unused time step, so the second one uses the next step's code.
        const at = new Date(Date.now() + index * 30_000);
        others.push(
          await service.completeTotpSignIn(
            started.pendingToken,
            totpCode(user.totpSecret ?? '', at),
            signInRequest(`other-totp-${index}`),
          ),
        );
      }

      const pendingToken = await passwordVerified(service, fixture, 'recovery-revoke');
      const recoveryRequest = signInRequest('recovery-revoke-code');
      const result = await service.completeRecoveryCodeSignIn(
        pendingToken,
        user.recoveryCodes[0] ?? '',
        recoveryRequest,
      );

      for (const other of others) {
        await expect(
          service.authenticateSession(other.token, 'request-revoked-me'),
        ).resolves.toBeNull();
      }
      await expect(
        service.authenticateSession(result.session.token, 'request-recovery-me'),
      ).resolves.toMatchObject({ sessionId: result.session.sessionId });
      const revoked = await admin.userSession.findMany({
        where: { userId: user.id, revokedAt: { not: null } },
        select: { id: true, revocationReason: true },
      });
      expect(revoked.map(({ id }) => id).sort()).toEqual(
        others.map(({ sessionId }) => sessionId).sort(),
      );
      expect(revoked.map(({ revocationReason }) => revocationReason)).toEqual([
        'RECOVERY_CODE_SIGN_IN',
        'RECOVERY_CODE_SIGN_IN',
      ]);
      await expect(
        admin.securityEvent.count({
          where: { requestId: recoveryRequest.requestId, eventType: 'SESSION_REVOKED' },
        }),
      ).resolves.toBe(2);
    } finally {
      await fixture.cleanup();
    }
  },
);

function enrollmentSecret(otpauthUri: string): string {
  return new URL(otpauthUri).searchParams.get('secret') ?? '';
}

async function enrollmentWrites(admin: PrismaClient, userId: string) {
  const [factors, codes, sessions] = await Promise.all([
    admin.userTotpFactor.count({ where: { userId } }),
    admin.userRecoveryCode.count({ where: { userId } }),
    admin.userSession.count({ where: { userId } }),
  ]);
  return { factors, codes, sessions };
}

it.skipIf(!enabled)(
  'enrolls an MFA-Required User without a factor, writing the factor, codes, and session only at the end',
  async () => {
    const fixture = await ownedLoginFixture({ withTotp: false });
    const { admin, user } = fixture;
    try {
      const service = new AuthService({ send: vi.fn().mockResolvedValue(undefined) });
      const started = await service.signInWithPassword(
        user.email,
        user.password,
        fixture.membershipIds[1] ?? null,
        signInRequest('enroll-password'),
      );
      if (started.status !== 'ENROLLMENT_REQUIRED') throw new Error('Expected enrollment.');
      expect(started.enrollment.account).toBe(user.email);
      expect(started.enrollment.otpauthUri).toMatch(/^otpauth:\/\/totp\/LingkodHR:/);
      const secret = enrollmentSecret(started.enrollment.otpauthUri);

      const pending = await admin.pendingAuthentication.findFirstOrThrow({
        where: { userId: user.id },
      });
      expect(pending).toMatchObject({ purpose: 'SIGN_IN', stage: 'ENROLL_SCAN' });
      expect(pending.expiresAt).toEqual(started.enrollment.expiresAt);
      // The secret is only held sealed.
      expect(pending.enrollmentSecretEnvelope).not.toBeNull();
      expect(Buffer.from(pending.enrollmentSecretEnvelope ?? []).toString('latin1')).not.toContain(
        secret,
      );
      await expect(enrollmentWrites(admin, user.id)).resolves.toEqual({
        factors: 0,
        codes: 0,
        sessions: 0,
      });

      // Steps out of order are refused without ending the enrollment.
      await expect(
        service.completeTotpEnrollment(started.pendingToken, signInRequest('enroll-early')),
      ).rejects.toMatchObject({ code: 'SIGN_IN_EXPIRED' });
      await expect(
        service.completeTotpSignIn(
          started.pendingToken,
          totpCode(secret),
          signInRequest('enroll-as-totp'),
        ),
      ).rejects.toMatchObject({ code: 'SIGN_IN_EXPIRED' });

      const code = totpCode(secret);
      const wrongCode = code === '000000' ? '000001' : '000000';
      await expect(
        service.confirmTotpEnrollment(started.pendingToken, wrongCode, signInRequest('enroll-x')),
      ).rejects.toMatchObject({ code: 'INVALID_CODE', statusCode: 401 });
      const confirmed = await service.confirmTotpEnrollment(
        started.pendingToken,
        code,
        signInRequest('enroll-code'),
      );
      expect(confirmed.recoveryCodes).toHaveLength(10);
      await expect(
        service.confirmTotpEnrollment(started.pendingToken, code, signInRequest('enroll-again')),
      ).rejects.toMatchObject({ code: 'SIGN_IN_EXPIRED' });
      const codesStage = await admin.pendingAuthentication.findFirstOrThrow({
        where: { userId: user.id },
      });
      expect(codesStage).toMatchObject({ stage: 'ENROLL_CODES', verifiedMethods: ['pwd', 'totp'] });
      expect(codesStage.recoveryCodeHashes).toHaveLength(10);
      await expect(enrollmentWrites(admin, user.id)).resolves.toEqual({
        factors: 0,
        codes: 0,
        sessions: 0,
      });

      const session = await service.completeTotpEnrollment(
        started.pendingToken,
        signInRequest('enroll-finish'),
      );
      expect(session.authenticationMethods).toEqual(['pwd', 'totp']);
      expect(session.context).toMatchObject({ userId: user.id, agencyId: fixture.agencyIds[1] });
      expect(session.notice.to).toBe(user.email);
      expect(session.notice.text).toContain('Agency Administrator');
      expect(session.notice.text).not.toMatch(/https?:|\d{6}/);
      await expect(enrollmentWrites(admin, user.id)).resolves.toEqual({
        factors: 1,
        codes: 10,
        sessions: 1,
      });
      await expect(admin.pendingAuthentication.count({ where: { userId: user.id } })).resolves.toBe(
        0,
      );
      const storedCodes = await admin.userRecoveryCode.findMany({ where: { userId: user.id } });
      const firstCode = confirmed.recoveryCodes[0] ?? '';
      const matches = await Promise.all(
        storedCodes.map(({ codeHash }) =>
          verifyPassword(codeHash, firstCode.replace('-', '').toUpperCase()),
        ),
      );
      expect(matches.filter(Boolean)).toHaveLength(1);
      await expect(
        admin.securityEvent.count({ where: { userId: user.id, eventType: 'TOTP_ENROLLED' } }),
      ).resolves.toBe(1);

      // The enrolled factor signs in, and the confirming code can't be replayed.
      const again = await service.signInWithPassword(
        user.email,
        user.password,
        null,
        signInRequest('enroll-replay'),
      );
      if (again.status !== 'TOTP_REQUIRED') throw new Error('Expected a TOTP challenge.');
      await expect(
        service.completeTotpSignIn(again.pendingToken, code, signInRequest('enroll-replay-code')),
      ).rejects.toMatchObject({ code: 'INVALID_CODE' });
    } finally {
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)(
  'refuses an unknown or malformed Recovery Code and records the attempt without the code',
  async () => {
    const fixture = await ownedLoginFixture({ recoveryCodes: 1 });
    const { admin, user } = fixture;
    try {
      const service = new AuthService();
      const pendingToken = await passwordVerified(service, fixture, 'recovery-wrong');
      const unknown = 'aaaaa-bbbbb';
      const requests = ['recovery-unknown', 'recovery-malformed'].map(signInRequest);
      for (const [index, code] of [unknown, 'not a code'].entries()) {
        await expect(
          service.completeRecoveryCodeSignIn(
            pendingToken,
            code,
            requests[index] ?? signInRequest('x'),
          ),
        ).rejects.toMatchObject({ code: 'INVALID_CODE', statusCode: 401 });
      }

      const events = await admin.securityEvent.findMany({
        where: { requestId: { in: requests.map(({ requestId }) => requestId) } },
      });
      expect(events).toHaveLength(2);
      const emailHash = hashEmail(user.email, getConfig().BLIND_INDEX_KEY);
      for (const event of events) {
        expect(event).toMatchObject({
          eventType: 'LOGIN_FAILURE',
          userId: user.id,
          details: { reason: 'INVALID_CODE', method: 'recovery_code' },
        });
        expect(Buffer.from(event.emailHash ?? [])).toEqual(emailHash);
        const serialized = JSON.stringify(event).toLowerCase();
        for (const secret of [unknown, 'aaaaabbbbb', user.recoveryCodes[0] ?? '', pendingToken]) {
          expect(serialized).not.toContain(secret.toLowerCase());
        }
      }
      // A refused code leaves the pending sign-in usable and the stored code unspent.
      await expect(admin.userRecoveryCode.count({ where: { userId: user.id } })).resolves.toBe(1);
      await expect(admin.pendingAuthentication.count({ where: { userId: user.id } })).resolves.toBe(
        1,
      );
    } finally {
      await fixture.cleanup();
    }
  },
);

class RecordingMailDelivery implements MailDelivery {
  readonly messages: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.messages.push(message);
  }
}

/** Just enough of an Express response for the sign-in endpoints; `close` fires on `finish()`. */
function fakeResponse() {
  const events = new EventEmitter();
  const response = {
    cookie: vi.fn(),
    clearCookie: vi.fn(),
    status: vi.fn(() => response),
    json: vi.fn(() => response),
    once: (event: string, listener: () => void) => {
      events.once(event, listener);
      return response;
    },
    finish: () => events.emit('close'),
  };
  return response;
}

function pendingRequest(pendingToken: string) {
  return {
    headers: { cookie: `hris_pending_auth=${pendingToken}` },
    header: (name: string) =>
      name === 'x-request-id' ? `owned-login-endpoint-${randomUUID()}` : undefined,
    ip: '198.51.100.7',
  } as unknown as Request;
}

it.skipIf(!enabled)(
  'sends the Recovery Code notice only after the response, and a failed send changes nothing',
  async () => {
    const fixture = await ownedLoginFixture({ recoveryCodes: 2 });
    const { user } = fixture;
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const mail = new RecordingMailDelivery();
      const controller = new AuthController(new AuthService(mail));
      const pendingToken = await passwordVerified(new AuthService(mail), fixture, 'notice');
      const response = fakeResponse();

      await controller.signInWithRecoveryCode(
        { code: user.recoveryCodes[0] },
        pendingRequest(pendingToken),
        response as unknown as Response,
      );
      expect(response.json).toHaveBeenCalledWith({
        status: 'SIGNED_IN',
        recoveryCodesRemaining: 1,
      });
      expect(mail.messages).toEqual([]);
      response.finish();
      await vi.waitFor(() => expect(mail.messages).toHaveLength(1));
      const [notice] = mail.messages;
      expect(notice).toMatchObject({ to: user.email });
      expect(notice?.text).toContain('Agency Administrator');
      expect(notice?.text).toContain('1 Recovery Code left');
      for (const code of user.recoveryCodes) {
        expect(JSON.stringify(notice).toLowerCase()).not.toContain(code);
      }
      expect(notice?.text).not.toMatch(/https?:/);

      const failing = new AuthController(
        new AuthService({ send: () => Promise.reject(new Error(`smtp down for ${user.email}`)) }),
      );
      const secondToken = await passwordVerified(new AuthService(mail), fixture, 'notice-fail');
      const failedResponse = fakeResponse();
      await failing.signInWithRecoveryCode(
        { code: user.recoveryCodes[1] },
        pendingRequest(secondToken),
        failedResponse as unknown as Response,
      );
      expect(failedResponse.json).toHaveBeenCalledWith({
        status: 'SIGNED_IN',
        recoveryCodesRemaining: 0,
      });
      failedResponse.finish();
      await vi.waitFor(() => expect(warn).toHaveBeenCalledOnce());
      expect(JSON.stringify(warn.mock.calls)).not.toContain(user.email);
    } finally {
      warn.mockRestore();
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)('writes nothing when an enrollment is abandoned or expires', async () => {
  const fixture = await ownedLoginFixture({ withTotp: false });
  const { admin, user } = fixture;
  try {
    const service = new AuthService({ send: vi.fn().mockResolvedValue(undefined) });
    const abandoned = await service.signInWithPassword(
      user.email,
      user.password,
      null,
      signInRequest('enroll-abandon'),
    );
    if (abandoned.status !== 'ENROLLMENT_REQUIRED') throw new Error('Expected enrollment.');
    await service.confirmTotpEnrollment(
      abandoned.pendingToken,
      totpCode(enrollmentSecret(abandoned.enrollment.otpauthUri)),
      signInRequest('enroll-abandon-code'),
    );

    // Starting over replaces the pending row with a new secret.
    const restarted = await service.signInWithPassword(
      user.email,
      user.password,
      null,
      signInRequest('enroll-restart'),
    );
    if (restarted.status !== 'ENROLLMENT_REQUIRED') throw new Error('Expected enrollment.');
    expect(restarted.enrollment.otpauthUri).not.toBe(abandoned.enrollment.otpauthUri);
    await expect(
      service.completeTotpEnrollment(abandoned.pendingToken, signInRequest('enroll-stale')),
    ).rejects.toMatchObject({ code: 'SIGN_IN_EXPIRED' });
    await expect(admin.pendingAuthentication.count({ where: { userId: user.id } })).resolves.toBe(
      1,
    );

    await service.confirmTotpEnrollment(
      restarted.pendingToken,
      totpCode(enrollmentSecret(restarted.enrollment.otpauthUri)),
      signInRequest('enroll-restart-code'),
    );
    await admin.pendingAuthentication.updateMany({
      where: { userId: user.id },
      data: {
        createdAt: new Date(Date.now() - 10 * 60 * 1000),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    await expect(
      service.completeTotpEnrollment(restarted.pendingToken, signInRequest('enroll-expired')),
    ).rejects.toMatchObject({ code: 'SIGN_IN_EXPIRED', statusCode: 401 });
    await expect(admin.pendingAuthentication.count({ where: { userId: user.id } })).resolves.toBe(
      0,
    );
    await expect(enrollmentWrites(admin, user.id)).resolves.toEqual({
      factors: 0,
      codes: 0,
      sessions: 0,
    });
  } finally {
    await fixture.cleanup();
  }
});

it.skipIf(!enabled)(
  'refuses an expired enrollment code step without writing a factor',
  async () => {
    const fixture = await ownedLoginFixture({ withTotp: false });
    const { admin, user } = fixture;
    try {
      const service = new AuthService({ send: vi.fn().mockResolvedValue(undefined) });
      const started = await service.signInWithPassword(
        user.email,
        user.password,
        null,
        signInRequest('enroll-late'),
      );
      if (started.status !== 'ENROLLMENT_REQUIRED') throw new Error('Expected enrollment.');
      await admin.pendingAuthentication.updateMany({
        where: { userId: user.id },
        data: {
          createdAt: new Date(Date.now() - 10 * 60 * 1000),
          expiresAt: new Date(Date.now() - 1000),
        },
      });
      await expect(
        service.confirmTotpEnrollment(
          started.pendingToken,
          totpCode(enrollmentSecret(started.enrollment.otpauthUri)),
          signInRequest('enroll-late-code'),
        ),
      ).rejects.toMatchObject({ code: 'SIGN_IN_EXPIRED' });
      await expect(admin.pendingAuthentication.count({ where: { userId: user.id } })).resolves.toBe(
        0,
      );
      await expect(enrollmentWrites(admin, user.id)).resolves.toEqual({
        factors: 0,
        codes: 0,
        sessions: 0,
      });
    } finally {
      await fixture.cleanup();
    }
  },
);

it('sends the enrollment notice only after the response', async () => {
  const notice = { to: 'a@example.test', subject: 'Notice', text: 'Notice' };
  const sendNotice = vi.fn().mockResolvedValue(undefined);
  const authService = {
    assertLoginAllowed: vi.fn().mockResolvedValue(undefined),
    completeTotpEnrollment: vi.fn().mockResolvedValue({ token: 'session-token', notice }),
    sendNotice,
  } as unknown as AuthService;
  const response = fakeResponse();

  await new AuthController(authService).finishEnrollment(
    { acknowledged: true },
    pendingRequest('pending-token'),
    response as unknown as Response,
  );
  expect(response.json).toHaveBeenCalledWith({ status: 'SIGNED_IN' });
  expect(sendNotice).not.toHaveBeenCalled();
  response.finish();
  expect(sendNotice).toHaveBeenCalledWith(notice);
});
