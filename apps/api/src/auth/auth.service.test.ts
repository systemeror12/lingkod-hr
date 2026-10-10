import { argon2Sync, randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import {
  generateRecoveryCodes,
  generateTotpSecret,
  hashEmail,
  hashPassword,
  hashSessionToken,
  normalizeRecoveryCode,
  type RequestContext,
  sealTotpSecret,
  totpCode,
  verifyPassword,
  verifyPasswordAgainstDummy,
} from '@lingkod-hr/auth';
import { getConfig, parseProtectedValueKey } from '@lingkod-hr/config';
import { EventEmitter } from 'node:events';
import { type ExecutionContext, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { expect, it, vi } from 'vitest';
import { AuthController } from './auth.controller';
import { AgencyController } from './agency.controller';
import { AuthGuard } from './auth.guard';
import { AuthService, AuthServiceError } from './auth.service';
import { CredentialProof } from './credential-proof';
import { ReauthenticationGuard } from './reauthentication.guard';
import type { MailDelivery, MailMessage } from '../invitations/mail';

vi.mock('@lingkod-hr/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lingkod-hr/auth')>();
  return {
    ...actual,
    verifyPassword: vi.fn(actual.verifyPassword),
    verifyPasswordAgainstDummy: vi.fn(actual.verifyPasswordAgainstDummy),
  };
});

const enabled = process.env.DATABASE_E2E === 'true';
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
  await admin.invitation.deleteMany({ where: { agencyId: { in: [...agencyIds] } } });
  await admin.agencyMembership.deleteMany({ where: { userId: { in: [...userIds] } } });
  await admin.user.deleteMany({ where: { id: { in: [...userIds] } } });
  await admin.role.deleteMany({ where: { agencyId: { in: [...agencyIds] } } });
  await admin.agency.deleteMany({ where: { id: { in: [...agencyIds] } } });
}

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
    new AuthGuard({ authenticateSession } as unknown as AuthService, new Reflector()).canActivate(
      executionContext,
    ),
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
  'keeps absolute expiry and authentication time when switching agencies',
  async () => {
    const fixture = await ownedLoginFixture({ withTotp: false, mfaRequired: false });
    const { admin, user } = fixture;
    const suffix = `${Date.now()}-switch`;
    const [sourceAgencyId] = fixture.agencyIds;
    const [sourceMembershipId, targetMembershipId] = fixture.membershipIds;
    if (!sourceAgencyId || !sourceMembershipId || !targetMembershipId) {
      throw new Error('The E2E Agencies and Memberships were not created.');
    }

    try {
      const service = new AuthService();
      const started = await service.signInWithPassword(
        user.email,
        user.password,
        sourceMembershipId,
        signInRequest('switch'),
      );
      if (started.status !== 'SIGNED_IN') throw new Error('Expected a session.');
      const login = started.session;
      const original = await admin.userSession.findUniqueOrThrow({
        where: { id: login.sessionId },
      });
      const switched = await new AuthService().switchAgency(
        login.token,
        login,
        targetMembershipId,
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
      ).resolves.toBeUndefined();
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
      const inactiveAgencyToken = `inactive-agency-${suffix}`;
      const inactiveAgencySession = await admin.userSession.create({
        data: {
          userId: user.id,
          agencyId: sourceAgencyId,
          agencyMembershipId: sourceMembershipId,
          sessionTokenHash: databaseBytes(hashSessionToken(inactiveAgencyToken)),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });
      await admin.agency.update({
        where: { id: sourceAgencyId },
        data: { status: 'SUSPENDED' },
      });
      await expect(
        new AuthService().authenticateSession(inactiveAgencyToken, `inactive-agency-${suffix}`),
      ).resolves.toBeNull();
      await expect(
        admin.userSession.findUniqueOrThrow({ where: { id: inactiveAgencySession.id } }),
      ).resolves.toMatchObject({ revocationReason: 'SESSION_EXPIRED_OR_ACCESS_REMOVED' });
      await expect(
        new AuthService().signInWithPassword(
          user.email,
          user.password,
          sourceMembershipId,
          signInRequest('suspended'),
        ),
      ).rejects.toMatchObject({ code: 'MEMBERSHIP_DENIED' });
    } finally {
      await fixture.cleanup();
    }
  },
);

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
      await admin.signInThrottle.deleteMany({ where: { emailHash } });
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

const SIGN_IN_USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) LingkodHR test';

function signInRequest(label: string) {
  return {
    requestId: `owned-login-${label}-${randomUUID()}`,
    ipAddress: '198.51.100.7',
    userAgent: SIGN_IN_USER_AGENT,
  };
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

/** An Argon2id hash of `password` with the old parameters, which sign-in rehashes. */
function legacyHash(password: string): string {
  const salt = Buffer.alloc(16, 5);
  const tag = argon2Sync('argon2id', {
    message: password,
    nonce: salt,
    memory: 19456,
    passes: 2,
    parallelism: 1,
    tagLength: 32,
  });
  const unpadded = (value: Buffer) => value.toString('base64').replace(/=+$/, '');
  return `$argon2id$v=19$m=19456,t=2,p=1$${unpadded(salt)}$${unpadded(tag)}`;
}

it.skipIf(!enabled)(
  'signs a User without a factor straight in and rehashes a password with old parameters',
  async () => {
    const password = `legacy passphrase ${randomUUID()}`;
    const fixture = await ownedLoginFixture({
      withTotp: false,
      mfaRequired: false,
      passwordHash: legacyHash(password),
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
  'signs in a password whose old hash a concurrent sign-in rehashed after it verified',
  async () => {
    const password = `legacy passphrase ${randomUUID()}`;
    const fixture = await ownedLoginFixture({
      withTotp: false,
      mfaRequired: false,
      passwordHash: legacyHash(password),
    });
    const { admin, user } = fixture;
    try {
      const service = new AuthService();
      const actual = await vi.importActual<typeof import('@lingkod-hr/auth')>('@lingkod-hr/auth');
      // The old hash verifies, then another sign-in rehashes it before this one saves.
      vi.mocked(verifyPassword).mockImplementationOnce(async (hash, candidate) => {
        const verified = await actual.verifyPassword(hash, candidate);
        await service.signInWithPassword(user.email, password, null, signInRequest('rehash-first'));
        return verified;
      });

      const result = await service.signInWithPassword(
        user.email,
        password,
        null,
        signInRequest('rehash-second'),
      );
      expect(result.status).toBe('SIGNED_IN');
      await expect(admin.userSession.count({ where: { userId: user.id } })).resolves.toBe(2);
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
  'refuses a password sign-in whose password a Password Reset replaced after it verified',
  async () => {
    const fixture = await ownedLoginFixture({ withTotp: false, mfaRequired: false });
    const { admin, user } = fixture;
    try {
      const service = new AuthService();
      const mail = await service.requestPasswordReset(user.email, signInRequest('reset-request'));
      const resetToken = /\/reset-password\/([A-Za-z0-9_-]{43})/.exec(mail?.text ?? '')?.[1];
      if (!resetToken) throw new Error('Expected a reset link.');
      const actual = await vi.importActual<typeof import('@lingkod-hr/auth')>('@lingkod-hr/auth');
      // The old password verifies, then a reset completes before the sign-in saves.
      vi.mocked(verifyPassword).mockImplementationOnce(async (hash, password) => {
        const verified = await actual.verifyPassword(hash, password);
        await service.completePasswordReset(
          resetToken,
          { password: 'bagong passphrase pagkatapos ng reset' },
          signInRequest('reset'),
        );
        return verified;
      });

      const request = signInRequest('stale-password');
      await expect(
        service.signInWithPassword(user.email, user.password, null, request),
      ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', statusCode: 401 });
      await expect(admin.pendingAuthentication.count({ where: { userId: user.id } })).resolves.toBe(
        0,
      );
      await expect(admin.userSession.count({ where: { userId: user.id } })).resolves.toBe(0);
      await expect(
        admin.securityEvent.findMany({
          where: { requestId: request.requestId },
          select: { eventType: true, details: true },
        }),
      ).resolves.toEqual([
        { eventType: 'LOGIN_FAILURE', details: { reason: 'INVALID_CREDENTIALS' } },
      ]);
    } finally {
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)(
  'refuses a TOTP sign-in whose pending sign-in expired after it was read',
  async () => {
    const fixture = await ownedLoginFixture();
    const { admin, user } = fixture;
    try {
      const service = new AuthService();
      const pendingToken = await passwordVerified(service, fixture, 'totp-expiry');
      const proveTotp = CredentialProof.prototype.proveTotp;
      // The pending sign-in is read while current, then expires before it is consumed.
      vi.spyOn(CredentialProof.prototype, 'proveTotp').mockImplementationOnce(async function (
        this: CredentialProof,
        attempt,
      ) {
        await admin.pendingAuthentication.updateMany({
          where: { userId: user.id },
          data: {
            createdAt: new Date(Date.now() - 6 * 60_000),
            expiresAt: new Date(Date.now() - 60_000),
          },
        });
        return proveTotp.call(this, attempt);
      });

      const request = signInRequest('totp-expiry-code');
      await expect(
        service.completeTotpSignIn(pendingToken, totpCode(user.totpSecret ?? ''), request),
      ).rejects.toMatchObject({ code: 'SIGN_IN_EXPIRED', statusCode: 401 });
      await expect(admin.userSession.count({ where: { userId: user.id } })).resolves.toBe(0);
      await expect(
        admin.securityEvent.findMany({
          where: { requestId: request.requestId },
          select: { eventType: true, details: true },
        }),
      ).resolves.toEqual([
        { eventType: 'LOGIN_FAILURE', details: { reason: 'SIGN_IN_EXPIRED', method: 'totp' } },
      ]);
    } finally {
      vi.restoreAllMocks();
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
        expect(event.userAgent).toBe(SIGN_IN_USER_AGENT);
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
  "gives the enrolled session its TOTP confirmation's time as authTime, however late the acknowledgment",
  async () => {
    const fixture = await ownedLoginFixture({ withTotp: false });
    const { admin, user } = fixture;
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const service = new AuthService({ send: vi.fn().mockResolvedValue(undefined) });
      const started = await service.signInWithPassword(
        user.email,
        user.password,
        null,
        signInRequest('enroll-time-password'),
      );
      if (started.status !== 'ENROLLMENT_REQUIRED') throw new Error('Expected enrollment.');
      const confirmedAt = new Date();
      await service.confirmTotpEnrollment(
        started.pendingToken,
        totpCode(enrollmentSecret(started.enrollment.otpauthUri)),
        signInRequest('enroll-time-code'),
      );

      vi.setSystemTime(confirmedAt.getTime() + 2 * 60_000);
      const session = await service.completeTotpEnrollment(
        started.pendingToken,
        signInRequest('enroll-time-finish'),
      );
      expect(session.authTime).toEqual(confirmedAt);
      const stored = await admin.userSession.findUniqueOrThrow({
        where: { id: session.sessionId },
      });
      expect(stored.authTime).toEqual(confirmedAt);
    } finally {
      vi.useRealTimers();
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)(
  'refuses an acknowledgment whose pending enrollment has no confirmation time',
  async () => {
    const fixture = await ownedLoginFixture({ withTotp: false });
    const { admin, user } = fixture;
    try {
      const service = new AuthService({ send: vi.fn().mockResolvedValue(undefined) });
      const started = await service.signInWithPassword(
        user.email,
        user.password,
        null,
        signInRequest('enroll-unconfirmed-password'),
      );
      if (started.status !== 'ENROLLMENT_REQUIRED') throw new Error('Expected enrollment.');
      await service.confirmTotpEnrollment(
        started.pendingToken,
        totpCode(enrollmentSecret(started.enrollment.otpauthUri)),
        signInRequest('enroll-unconfirmed-code'),
      );
      // A row confirmed before enrollment_confirmed_at existed.
      await admin.pendingAuthentication.updateMany({
        where: { userId: user.id },
        data: { enrollmentConfirmedAt: null },
      });

      const request = signInRequest('enroll-unconfirmed-finish');
      await expect(
        service.completeTotpEnrollment(started.pendingToken, request),
      ).rejects.toMatchObject({ code: 'SIGN_IN_EXPIRED', statusCode: 401 });
      await expect(enrollmentWrites(admin, user.id)).resolves.toEqual({
        factors: 0,
        codes: 0,
        sessions: 0,
      });
      await expect(
        admin.securityEvent.findMany({
          where: { requestId: request.requestId },
          select: { eventType: true, details: true },
        }),
      ).resolves.toEqual([
        {
          eventType: 'LOGIN_FAILURE',
          details: expect.objectContaining({ reason: 'SIGN_IN_EXPIRED' }),
        },
      ]);
    } finally {
      await fixture.cleanup();
    }
  },
);

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

it.skipIf(!enabled)(
  'refuses an enrollment that expired while it waited on the password row',
  async () => {
    const fixture = await ownedLoginFixture({ withTotp: false });
    const { admin, user } = fixture;
    try {
      const service = new AuthService({ send: vi.fn().mockResolvedValue(undefined) });
      const started = await service.signInWithPassword(
        user.email,
        user.password,
        null,
        signInRequest('enroll-wait'),
      );
      if (started.status !== 'ENROLLMENT_REQUIRED') throw new Error('Expected enrollment.');
      await service.confirmTotpEnrollment(
        started.pendingToken,
        totpCode(enrollmentSecret(started.enrollment.otpauthUri)),
        signInRequest('enroll-wait-code'),
      );

      const request = signInRequest('enroll-wait-finish');
      let completion: Promise<unknown> = Promise.resolve();
      // Holds the password row until the completion waits on it, then expires the enrollment.
      await admin.$transaction(
        async (transaction) => {
          await transaction.$queryRaw`
            SELECT 1 FROM "user_passwords" WHERE "user_id" = ${user.id}::uuid FOR UPDATE`;
          const [{ pid }] = await transaction.$queryRaw<[{ pid: number }]>`
            SELECT pg_backend_pid() AS pid`;
          completion = service.completeTotpEnrollment(started.pendingToken, request);
          completion.catch(() => undefined);
          for (let waited = 0; ; waited += 1) {
            const [{ waiting }] = await admin.$queryRaw<[{ waiting: boolean }]>`
              SELECT EXISTS (
                SELECT 1 FROM pg_stat_activity WHERE ${pid}::int = ANY (pg_blocking_pids(pid))
              ) AS waiting`;
            if (waiting) break;
            if (waited > 200) throw new Error('The completion never waited on the password row.');
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          await admin.pendingAuthentication.updateMany({
            where: { userId: user.id },
            data: {
              createdAt: new Date(Date.now() - 6 * 60_000),
              expiresAt: new Date(Date.now() - 60_000),
            },
          });
        },
        { timeout: 20_000 },
      );

      await expect(completion).rejects.toMatchObject({ code: 'SIGN_IN_EXPIRED' });
      await expect(admin.userSession.count({ where: { userId: user.id } })).resolves.toBe(0);
      await expect(admin.userTotpFactor.count({ where: { userId: user.id } })).resolves.toBe(0);
    } finally {
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
    assertIpAllowed: vi.fn().mockResolvedValue(undefined),
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

/** The Sign-in Cool-down row and its events for `email`, removed when the test ends. */
function throttleOf(admin: PrismaClient, email: string) {
  const emailHash = databaseBytes(hashEmail(email, getConfig().BLIND_INDEX_KEY));
  return {
    row: () => admin.signInThrottle.findUnique({ where: { emailHash } }),
    /** Ends the running cool-down, as if its time had passed. */
    expire: () =>
      admin.signInThrottle.updateMany({
        where: { emailHash },
        data: { cooldownUntil: new Date(Date.now() - 1000) },
      }),
    cooldownsStarted: () =>
      admin.securityEvent.findMany({
        where: { emailHash, eventType: 'SIGN_IN_COOLDOWN_STARTED' },
        orderBy: { occurredAt: 'asc' },
        select: { userId: true, details: true },
      }),
    remove: async () => {
      await admin.signInThrottle.deleteMany({ where: { emailHash } });
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.securityEvent.deleteMany({ where: { emailHash } });
      });
    },
  };
}

async function wrongPasswords(service: AuthService, email: string, count: number) {
  for (let index = 0; index < count; index += 1) {
    await expect(
      service.signInWithPassword(email, 'a wrong passphrase here', null, signInRequest('wrong')),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  }
}

it.skipIf(!enabled)(
  'cools down a known and an unknown email alike after 5 failures, refusing with 429 and no Argon2id',
  async () => {
    const fixture = await ownedLoginFixture({ withTotp: false, mfaRequired: false });
    const unknownEmail = `nobody-${randomUUID()}@example.test`;
    const known = throttleOf(fixture.admin, fixture.user.email);
    const unknown = throttleOf(fixture.admin, unknownEmail);
    try {
      const service = new AuthService();
      for (const [email, throttle, userId] of [
        [fixture.user.email, known, fixture.user.id],
        [unknownEmail, unknown, null],
      ] as const) {
        await wrongPasswords(service, email, 4);
        await expect(throttle.cooldownsStarted()).resolves.toEqual([]);
        await wrongPasswords(service, email, 1);
        await expect(throttle.cooldownsStarted()).resolves.toEqual([
          { userId: null, details: { level: 1, minutes: 5 } },
        ]);

        vi.mocked(verifyPassword).mockClear();
        vi.mocked(verifyPasswordAgainstDummy).mockClear();
        const refusedRequest = signInRequest('cooldown');
        const refused = await service
          .signInWithPassword(email, fixture.user.password, null, refusedRequest)
          .catch((error: unknown) => error);
        expect(refused).toMatchObject({
          code: 'SIGN_IN_COOLDOWN',
          statusCode: 429,
          message: 'Too many attempts for this email. Try again in 5 minutes.',
        });
        const retryAt = (refused as AuthServiceError).retryAt?.getTime() ?? 0;
        expect(retryAt - Date.now()).toBeGreaterThan(4 * 60 * 1000);
        expect(retryAt - Date.now()).toBeLessThanOrEqual(5 * 60 * 1000);
        expect(verifyPassword).not.toHaveBeenCalled();
        expect(verifyPasswordAgainstDummy).not.toHaveBeenCalled();
        await expect(
          fixture.admin.securityEvent.findMany({
            where: { requestId: refusedRequest.requestId },
            select: { eventType: true, userId: true, details: true },
          }),
        ).resolves.toEqual([
          { eventType: 'LOGIN_FAILURE', userId, details: { reason: 'COOLDOWN_ACTIVE' } },
        ]);
        // A refused attempt doesn't add to the email's count.
        await expect(throttle.row()).resolves.toMatchObject({ failureCount: 0, cooldownLevel: 1 });
      }
    } finally {
      await unknown.remove();
      await known.remove();
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)(
  'doubles the next cool-down, and resets the ladder after a full sign-in or 24 quiet hours',
  async () => {
    const fixture = await ownedLoginFixture({ withTotp: false, mfaRequired: false });
    const { admin, user } = fixture;
    const throttle = throttleOf(admin, user.email);
    try {
      const service = new AuthService();
      await wrongPasswords(service, user.email, 5);
      await throttle.expire();
      await wrongPasswords(service, user.email, 5);
      await expect(throttle.cooldownsStarted()).resolves.toEqual([
        { userId: null, details: { level: 1, minutes: 5 } },
        { userId: null, details: { level: 2, minutes: 10 } },
      ]);
      await expect(
        service.signInWithPassword(user.email, user.password, null, signInRequest('during')),
      ).rejects.toMatchObject({
        code: 'SIGN_IN_COOLDOWN',
        message: 'Too many attempts for this email. Try again in 10 minutes.',
      });

      // 24 hours without a failure count as reset: the next cool-down is 5 minutes again.
      await admin.signInThrottle.updateMany({
        where: { emailHash: databaseBytes(hashEmail(user.email, getConfig().BLIND_INDEX_KEY)) },
        data: {
          cooldownUntil: new Date(Date.now() - 24 * 60 * 60 * 1000),
          lastFailureAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
        },
      });
      await wrongPasswords(service, user.email, 5);
      expect((await throttle.cooldownsStarted()).at(-1)).toEqual({
        userId: null,
        details: { level: 1, minutes: 5 },
      });

      // A full sign-in resets the ladder.
      await throttle.expire();
      await wrongPasswords(service, user.email, 2);
      const signedIn = await service.signInWithPassword(
        user.email,
        user.password,
        null,
        signInRequest('reset'),
      );
      expect(signedIn.status).toBe('SIGNED_IN');
      await expect(throttle.row()).resolves.toBeNull();
    } finally {
      await throttle.remove();
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)(
  'counts concurrent failures exactly once each and starts exactly one cool-down',
  async () => {
    const admin = await createAdminClient();
    const email = `nobody-${randomUUID()}@example.test`;
    const throttle = throttleOf(admin, email);
    try {
      const service = new AuthService();
      const results = await Promise.allSettled(
        Array.from({ length: 4 }, () =>
          service.signInWithPassword(email, 'a wrong passphrase', null, signInRequest('race')),
        ),
      );
      expect(results.every(({ status }) => status === 'rejected')).toBe(true);
      await expect(throttle.row()).resolves.toMatchObject({ failureCount: 4, cooldownLevel: 0 });

      await Promise.allSettled(
        Array.from({ length: 6 }, () =>
          service.signInWithPassword(email, 'a wrong passphrase', null, signInRequest('race')),
        ),
      );
      await expect(throttle.cooldownsStarted()).resolves.toEqual([
        { userId: null, details: { level: 1, minutes: 5 } },
      ]);
      await expect(throttle.row()).resolves.toMatchObject({ failureCount: 0, cooldownLevel: 1 });
    } finally {
      await throttle.remove();
      await admin.$disconnect();
    }
  },
);

it.skipIf(!enabled)(
  'refuses an IP with 100 sign-in failures in the last 15 minutes, counting every email',
  async () => {
    const admin = await createAdminClient();
    const ipAddress = `203.0.113.${1 + ((randomBytes(1)[0] ?? 0) % 254)}`;
    const prefix = `owned-login-ip-${randomUUID()}`;
    const fromIp = (label: string) => ({
      requestId: `${prefix}-${label}`,
      ipAddress,
      userAgent: null,
    });
    const email = `nobody-${randomUUID()}@example.test`;
    const throttle = throttleOf(admin, email);
    try {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.securityEvent.deleteMany({ where: { ipAddress } });
      });
      const failures = (count: number, minutesAgo: number) =>
        admin.securityEvent.createMany({
          data: Array.from({ length: count }, (_, index) => ({
            eventType: 'LOGIN_FAILURE',
            requestId: `${prefix}-seed-${minutesAgo}-${index}`,
            ipAddress,
            occurredAt: new Date(Date.now() - minutesAgo * 60 * 1000),
            details: { reason: 'INVALID_CREDENTIALS' },
          })),
        });
      await failures(98, 5);
      await failures(50, 16);
      const service = new AuthService();
      // The 99th failure in the window, from an unknown email, still counts.
      await expect(
        service.signInWithPassword(email, 'a wrong passphrase', null, fromIp('99')),
      ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
      await expect(service.assertIpAllowed(fromIp('100'))).resolves.toBeUndefined();
      await failures(1, 1);

      vi.mocked(verifyPasswordAgainstDummy).mockClear();
      await expect(
        service.signInWithPassword(email, 'a wrong passphrase', null, fromIp('refused')),
      ).rejects.toMatchObject({ code: 'IP_RATE_LIMITED', statusCode: 429 });
      expect(verifyPasswordAgainstDummy).not.toHaveBeenCalled();
      await expect(service.assertIpAllowed(fromIp('second-step'))).rejects.toMatchObject({
        code: 'IP_RATE_LIMITED',
        statusCode: 429,
      });
      const refusals = await admin.securityEvent.findMany({
        where: { requestId: { in: [`${prefix}-refused`, `${prefix}-second-step`] } },
        orderBy: { occurredAt: 'asc' },
        select: { eventType: true, details: true, emailHash: true },
      });
      expect(refusals.map(({ eventType, details }) => ({ eventType, details }))).toEqual([
        { eventType: 'LOGIN_FAILURE', details: { reason: 'IP_RATE_LIMITED' } },
        { eventType: 'LOGIN_FAILURE', details: { reason: 'IP_RATE_LIMITED' } },
      ]);
      expect(Buffer.from(refusals[0]?.emailHash ?? [])).toEqual(
        hashEmail(email, getConfig().BLIND_INDEX_KEY),
      );
    } finally {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.securityEvent.deleteMany({ where: { ipAddress } });
      });
      await throttle.remove();
      await admin.$disconnect();
    }
  },
);

it.skipIf(!enabled)(
  'disables the password after 10 wrong TOTP or Recovery Codes and tells the User to reset it',
  async () => {
    const fixture = await ownedLoginFixture({ recoveryCodes: 1 });
    const { admin, user } = fixture;
    const throttle = throttleOf(admin, user.email);
    try {
      const service = new AuthService();
      const pendingToken = await passwordVerified(service, fixture, 'ceiling');
      const code = totpCode(user.totpSecret ?? '');
      const wrongTotp = code === '000000' ? '000001' : '000000';
      const wrong = (index: number) =>
        index % 2 === 0
          ? service.completeTotpSignIn(pendingToken, wrongTotp, signInRequest(`ceiling-${index}`))
          : service.completeRecoveryCodeSignIn(
              pendingToken,
              'aaaaa-bbbbb',
              signInRequest(`ceiling-${index}`),
            );

      for (let index = 0; index < 5; index += 1) {
        await expect(wrong(index)).rejects.toMatchObject({ code: 'INVALID_CODE' });
      }
      // Wrong codes feed the email's cool-down too, which refuses even a right code.
      await expect(
        service.completeTotpSignIn(pendingToken, code, signInRequest('ceiling-cooldown')),
      ).rejects.toMatchObject({ code: 'SIGN_IN_COOLDOWN', statusCode: 429 });
      await throttle.expire();
      for (let index = 5; index < 9; index += 1) {
        await expect(wrong(index)).rejects.toMatchObject({ code: 'INVALID_CODE' });
      }
      await expect(
        admin.userPassword.findUniqueOrThrow({ where: { userId: user.id } }),
      ).resolves.toMatchObject({ secondFactorFailures: 9, resetRequiredAt: null });

      const ceiling = await wrong(9).catch((error: unknown) => error);
      expect(ceiling).toMatchObject({ code: 'PASSWORD_RESET_REQUIRED', statusCode: 403 });
      const notice = (ceiling as AuthServiceError).notice;
      expect(notice).toMatchObject({ to: user.email });
      expect(notice?.text).not.toMatch(/https?:|\d{6}/);
      const stored = await admin.userPassword.findUniqueOrThrow({ where: { userId: user.id } });
      expect(stored.secondFactorFailures).toBe(10);
      expect(stored.resetRequiredAt).not.toBeNull();
      await expect(admin.pendingAuthentication.count({ where: { userId: user.id } })).resolves.toBe(
        0,
      );
      await expect(
        admin.securityEvent.findMany({
          where: { userId: user.id, eventType: 'PASSWORD_RESET_REQUIRED' },
          select: { agencyId: true, details: true },
        }),
      ).resolves.toEqual([{ agencyId: null, details: { secondFactorFailures: 10 } }]);
      await expect(admin.user.findUniqueOrThrow({ where: { id: user.id } })).resolves.toMatchObject(
        { globalStatus: 'ACTIVE' },
      );

      // The right password is refused from now on; a wrong one looks like any other.
      await throttle.expire();
      await expect(
        service.signInWithPassword(user.email, user.password, null, signInRequest('after')),
      ).rejects.toMatchObject({ code: 'PASSWORD_RESET_REQUIRED', statusCode: 403 });
      await expect(
        service.signInWithPassword(user.email, 'a wrong passphrase', null, signInRequest('x')),
      ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
      await expect(admin.userSession.count({ where: { userId: user.id } })).resolves.toBe(0);
    } finally {
      await throttle.remove();
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)(
  'resets the second-factor count after a full sign-in and reaches the ceiling once under races',
  async () => {
    const fixture = await ownedLoginFixture();
    const { admin, user } = fixture;
    const throttle = throttleOf(admin, user.email);
    try {
      const service = new AuthService();
      await admin.userPassword.update({
        where: { userId: user.id },
        data: { secondFactorFailures: 9 },
      });
      const pendingToken = await passwordVerified(service, fixture, 'count-reset');
      await service.completeTotpSignIn(
        pendingToken,
        totpCode(user.totpSecret ?? ''),
        signInRequest('count-reset-code'),
      );
      await expect(
        admin.userPassword.findUniqueOrThrow({ where: { userId: user.id } }),
      ).resolves.toMatchObject({ secondFactorFailures: 0 });

      await admin.userPassword.update({
        where: { userId: user.id },
        data: { secondFactorFailures: 8 },
      });
      const raced = await passwordVerified(service, fixture, 'ceiling-race');
      const results = await Promise.allSettled(
        Array.from({ length: 4 }, (_, index) =>
          service.completeRecoveryCodeSignIn(raced, `aaaaa-bbbb${index}`, signInRequest('race')),
        ),
      );
      expect(results.every(({ status }) => status === 'rejected')).toBe(true);
      await expect(
        admin.securityEvent.count({
          where: { userId: user.id, eventType: 'PASSWORD_RESET_REQUIRED' },
        }),
      ).resolves.toBe(1);
      const codes = results.map((result) =>
        result.status === 'rejected' ? (result.reason as AuthServiceError).code : null,
      );
      expect(codes.filter((code) => code === 'PASSWORD_RESET_REQUIRED')).toHaveLength(1);
    } finally {
      await throttle.remove();
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)(
  'checks a burst of TOTP codes one at a time, so no more than 5 are tried before the cool-down',
  async () => {
    const fixture = await ownedLoginFixture();
    const { admin, user } = fixture;
    const throttle = throttleOf(admin, user.email);
    try {
      const service = new AuthService();
      const pendingToken = await passwordVerified(service, fixture, 'burst');
      const wrongTotp = totpCode(user.totpSecret ?? '') === '000000' ? '000001' : '000000';
      const results = await Promise.allSettled(
        Array.from({ length: 12 }, (_, index) =>
          service.completeTotpSignIn(pendingToken, wrongTotp, signInRequest(`burst-${index}`)),
        ),
      );
      const codes = results.map((result) =>
        result.status === 'rejected' ? (result.reason as AuthServiceError).code : null,
      );
      expect(codes.filter((code) => code === 'INVALID_CODE')).toHaveLength(5);
      expect(codes.filter((code) => code === 'SIGN_IN_COOLDOWN')).toHaveLength(7);
      await expect(
        admin.userPassword.findUniqueOrThrow({ where: { userId: user.id } }),
      ).resolves.toMatchObject({ secondFactorFailures: 5 });
    } finally {
      await throttle.remove();
      await fixture.cleanup();
    }
  },
);

/** The refusal codes of settled sign-in attempts, counted by code. */
function refusals(results: PromiseSettledResult<unknown>[]) {
  const counts: Record<string, number> = {};
  for (const result of results) {
    const code = result.status === 'rejected' ? (result.reason as AuthServiceError).code : 'OK';
    counts[code] = (counts[code] ?? 0) + 1;
  }
  return counts;
}

it.skipIf(!enabled)(
  'counts a burst of wrong passwords before Argon2id, so no more than 5 run before the cool-down',
  async () => {
    const fixture = await ownedLoginFixture({ withTotp: false, mfaRequired: false });
    const { admin, user } = fixture;
    const unknownEmail = `nobody-${randomUUID()}@example.test`;
    const known = throttleOf(admin, user.email);
    const unknown = throttleOf(admin, unknownEmail);
    try {
      const service = new AuthService();
      for (const [email, throttle] of [
        [user.email, known],
        [unknownEmail, unknown],
      ] as const) {
        vi.mocked(verifyPassword).mockClear();
        vi.mocked(verifyPasswordAgainstDummy).mockClear();
        const results = await Promise.allSettled(
          Array.from({ length: 12 }, (_, index) =>
            service.signInWithPassword(
              email,
              'a wrong passphrase',
              null,
              signInRequest(`password-burst-${index}`),
            ),
          ),
        );
        expect(refusals(results)).toEqual({ INVALID_CREDENTIALS: 5, SIGN_IN_COOLDOWN: 7 });
        expect(
          vi.mocked(verifyPassword).mock.calls.length +
            vi.mocked(verifyPasswordAgainstDummy).mock.calls.length,
        ).toBe(5);
        await expect(throttle.cooldownsStarted()).resolves.toEqual([
          { userId: null, details: { level: 1, minutes: 5 } },
        ]);
        const failures = await admin.securityEvent.findMany({
          where: {
            emailHash: databaseBytes(hashEmail(email, getConfig().BLIND_INDEX_KEY)),
            eventType: 'LOGIN_FAILURE',
          },
          select: { details: true },
        });
        expect(
          failures.filter(({ details }) => isReason(details, 'INVALID_CREDENTIALS')),
        ).toHaveLength(5);
        expect(failures.filter(({ details }) => isReason(details, 'COOLDOWN_ACTIVE'))).toHaveLength(
          7,
        );
      }
    } finally {
      await unknown.remove();
      await known.remove();
      await fixture.cleanup();
    }
  },
);

function isReason(details: unknown, reason: string) {
  return (details as { reason?: string } | null)?.reason === reason;
}

it.skipIf(!enabled)(
  'counts a burst of wrong Recovery Codes before Argon2id, sharing the count with TOTP failures',
  async () => {
    const fixture = await ownedLoginFixture({ recoveryCodes: 1 });
    const { admin, user } = fixture;
    const throttle = throttleOf(admin, user.email);
    try {
      const service = new AuthService();
      const pendingToken = await passwordVerified(service, fixture, 'recovery-burst');
      const wrongTotp = totpCode(user.totpSecret ?? '') === '000000' ? '000001' : '000000';
      for (let index = 0; index < 2; index += 1) {
        await expect(
          service.completeTotpSignIn(pendingToken, wrongTotp, signInRequest('recovery-burst')),
        ).rejects.toMatchObject({ code: 'INVALID_CODE' });
      }

      vi.mocked(verifyPassword).mockClear();
      const wrongCodes = [...generateRecoveryCodes(), ...generateRecoveryCodes()].slice(0, 12);
      const results = await Promise.allSettled(
        wrongCodes.map((wrongCode, index) =>
          service.completeRecoveryCodeSignIn(
            pendingToken,
            wrongCode,
            signInRequest(`recovery-burst-${index}`),
          ),
        ),
      );
      expect(refusals(results)).toEqual({ INVALID_CODE: 3, SIGN_IN_COOLDOWN: 9 });
      // One stored Recovery Code: one Argon2id check per counted guess.
      expect(verifyPassword).toHaveBeenCalledTimes(3);
      await expect(
        admin.userPassword.findUniqueOrThrow({ where: { userId: user.id } }),
      ).resolves.toMatchObject({ secondFactorFailures: 5 });
      await expect(throttle.cooldownsStarted()).resolves.toEqual([
        { userId: null, details: { level: 1, minutes: 5 } },
      ]);
      const failures = await admin.securityEvent.findMany({
        where: { userId: user.id, eventType: 'LOGIN_FAILURE' },
        orderBy: { occurredAt: 'asc' },
        select: { details: true },
      });
      expect(
        failures
          .filter(({ details }) => isReason(details, 'INVALID_CODE'))
          .map(({ details }) => details),
      ).toEqual([
        { reason: 'INVALID_CODE', method: 'totp' },
        { reason: 'INVALID_CODE', method: 'totp' },
        { reason: 'INVALID_CODE', method: 'recovery_code' },
        { reason: 'INVALID_CODE', method: 'recovery_code' },
        { reason: 'INVALID_CODE', method: 'recovery_code' },
      ]);
      expect(failures.filter(({ details }) => isReason(details, 'COOLDOWN_ACTIVE'))).toHaveLength(
        9,
      );
    } finally {
      await throttle.remove();
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)(
  'does not count a right password or Recovery Code, even as the fifth guess',
  async () => {
    const fixture = await ownedLoginFixture({ recoveryCodes: 1 });
    const { admin, user } = fixture;
    const throttle = throttleOf(admin, user.email);
    try {
      const service = new AuthService();
      await wrongPasswords(service, user.email, 4);
      const pendingToken = await passwordVerified(service, fixture, 'fifth-right');
      await expect(throttle.row()).resolves.toMatchObject({
        failureCount: 4,
        cooldownLevel: 0,
        cooldownUntil: null,
      });

      // A right Recovery Code refused after it matched still isn't a guess against the count.
      await admin.user.update({
        where: { id: user.id },
        data: {
          globalStatus: 'LOCKED',
          lockedAt: new Date(),
          lockedByAgencyId: fixture.agencyIds[0] ?? null,
        },
      });
      const [code] = user.recoveryCodes;
      await expect(
        service.completeRecoveryCodeSignIn(pendingToken, code ?? '', signInRequest('locked')),
      ).rejects.toMatchObject({ code: 'USER_NOT_ACTIVE' });
      await expect(throttle.row()).resolves.toMatchObject({ failureCount: 4, cooldownLevel: 0 });
      await expect(throttle.cooldownsStarted()).resolves.toEqual([]);

      // The next wrong guess is the fifth failure.
      await wrongPasswords(service, user.email, 1);
      await expect(throttle.cooldownsStarted()).resolves.toEqual([
        { userId: null, details: { level: 1, minutes: 5 } },
      ]);
    } finally {
      await throttle.remove();
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)(
  'refuses a right code on a pending sign-in whose password was disabled after it began',
  async () => {
    const fixture = await ownedLoginFixture();
    const { admin, user } = fixture;
    try {
      const service = new AuthService();
      const pendingToken = await passwordVerified(service, fixture, 'stale');
      await admin.userPassword.update({
        where: { userId: user.id },
        data: { resetRequiredAt: new Date() },
      });
      await expect(
        service.completeTotpSignIn(
          pendingToken,
          totpCode(user.totpSecret ?? ''),
          signInRequest('stale-code'),
        ),
      ).rejects.toMatchObject({ code: 'PASSWORD_RESET_REQUIRED', statusCode: 403 });
      await expect(admin.userSession.count({ where: { userId: user.id } })).resolves.toBe(0);
    } finally {
      await fixture.cleanup();
    }
  },
);

/** A signed-in session of the fixture User whose `authTime` is `ageMs` old. */
async function agedSession(service: AuthService, fixture: OwnedLoginFixture, ageMs: number) {
  const pendingToken = await passwordVerified(service, fixture, 'aged');
  const { token } = await service.completeTotpSignIn(
    pendingToken,
    totpCode(fixture.user.totpSecret ?? ''),
    signInRequest('aged-totp'),
  );
  await fixture.admin.userSession.updateMany({
    where: { sessionTokenHash: databaseBytes(hashSessionToken(token)) },
    data: { authTime: new Date(Date.now() - ageMs) },
  });
  const session = await service.authenticateSession(token, 'owned-login-aged-me');
  if (!session) throw new Error('Expected an active session.');
  return session;
}

function guardAllows(session: Awaited<ReturnType<AuthService['authenticateSession']>>) {
  const executionContext = {
    switchToHttp: () => ({ getRequest: () => ({ authSession: session }) }),
  } as unknown as ExecutionContext;
  return new ReauthenticationGuard().canActivate(executionContext);
}

/** A TOTP code of the next time step, so it isn't a replay of the sign-in's code. */
function nextCode(secret: string | null) {
  return totpCode(secret ?? '', new Date(Date.now() + 30_000));
}

it('guards HRMO Administrator invitations with the Reauthentication Window', () => {
  const guards: unknown[] = Reflect.getMetadata('__guards__', AgencyController.prototype.invite);
  expect(guards).toContain(ReauthenticationGuard);
});

it.skipIf(!enabled)(
  'refuses a sensitive action 5 minutes after sign-in until the User reauthenticates',
  async () => {
    const fixture = await ownedLoginFixture();
    const { admin, user } = fixture;
    try {
      const service = new AuthService();
      const fresh = await agedSession(service, fixture, 60_000);
      expect(guardAllows(fresh)).toBe(true);

      const stale = { ...fresh, authTime: new Date(Date.now() - 6 * 60_000) };
      expect(() => guardAllows(stale)).toThrow(
        expect.objectContaining({
          status: 403,
          response: expect.objectContaining({
            error: expect.objectContaining({ code: 'REAUTHENTICATION_REQUIRED' }),
          }),
        }),
      );

      const before = Date.now();
      await service.reauthenticate(
        stale,
        { password: user.password, code: nextCode(user.totpSecret) },
        signInRequest('reauth'),
      );
      const stored = await admin.userSession.findUniqueOrThrow({ where: { id: stale.sessionId } });
      expect(stored.authTime?.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(stored.authenticationMethods).toEqual(['pwd', 'totp']);
      expect(stored.expiresAt).toEqual(stale.expiresAt);
      expect(stored.revokedAt).toBeNull();
      await expect(
        admin.securityEvent.count({
          where: { userId: user.id, eventType: 'REAUTHENTICATED' },
        }),
      ).resolves.toBe(1);
      expect(guardAllows({ ...stale, authTime: stored.authTime })).toBe(true);
    } finally {
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)(
  'counts a wrong password or code toward the Sign-in Cool-down and refuses a replayed code',
  async () => {
    const fixture = await ownedLoginFixture();
    const { admin, user } = fixture;
    const throttle = throttleOf(admin, user.email);
    try {
      const service = new AuthService();
      const session = await agedSession(service, fixture, 6 * 60_000);
      const refused = { code: 'INVALID_CREDENTIALS', statusCode: 401 };

      await expect(
        service.reauthenticate(
          session,
          { password: 'not the right passphrase', code: nextCode(user.totpSecret) },
          signInRequest('reauth-password'),
        ),
      ).rejects.toMatchObject(refused);
      await expect(
        service.reauthenticate(
          session,
          { password: user.password, code: '000000' },
          signInRequest('reauth-code'),
        ),
      ).rejects.toMatchObject(refused);
      // The sign-in's own code is a time step already accepted.
      const { lastAcceptedStep } = await admin.userTotpFactor.findUniqueOrThrow({
        where: { userId: user.id },
      });
      const replayed = totpCode(user.totpSecret ?? '', new Date(Number(lastAcceptedStep) * 30_000));
      await expect(
        service.reauthenticate(
          session,
          { password: user.password, code: replayed },
          signInRequest('reauth-replay'),
        ),
      ).rejects.toMatchObject(refused);
      await expect(
        service.reauthenticate(session, { password: user.password }, signInRequest('no-code')),
      ).rejects.toMatchObject(refused);

      await expect(throttle.row()).resolves.toMatchObject({ failureCount: 4 });
      await expect(
        admin.userPassword.findUniqueOrThrow({ where: { userId: user.id } }),
      ).resolves.toMatchObject({ secondFactorFailures: 3 });
      const stored = await admin.userSession.findUniqueOrThrow({
        where: { id: session.sessionId },
      });
      expect(stored.authTime).toEqual(session.authTime);
    } finally {
      await throttle.remove();
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)(
  'refuses a password alone when the User’s roles require MFA and they have no authenticator',
  async () => {
    const fixture = await ownedLoginFixture();
    const { admin, user } = fixture;
    try {
      const service = new AuthService();
      const session = await agedSession(service, fixture, 6 * 60_000);
      await admin.userTotpFactor.delete({ where: { userId: user.id } });

      await expect(
        service.reauthenticate(session, { password: user.password }, signInRequest('pwd-only')),
      ).rejects.toMatchObject({ code: 'MFA_REQUIRED', statusCode: 403 });
      const stored = await admin.userSession.findUniqueOrThrow({
        where: { id: session.sessionId },
      });
      expect(stored.authTime).toEqual(session.authTime);
      expect(stored.authenticationMethods).toEqual(['pwd', 'totp']);
    } finally {
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)(
  'reauthenticates with a Recovery Code, spends it, and sends a notice',
  async () => {
    const fixture = await ownedLoginFixture({ recoveryCodes: 2 });
    const { admin, user } = fixture;
    try {
      const service = new AuthService();
      const session = await agedSession(service, fixture, 6 * 60_000);
      const done = await service.reauthenticate(
        session,
        { password: user.password, recoveryCode: user.recoveryCodes[0]?.toUpperCase() },
        signInRequest('reauth-recovery'),
      );
      await expect(admin.userRecoveryCode.count({ where: { userId: user.id } })).resolves.toBe(1);
      const stored = await admin.userSession.findUniqueOrThrow({
        where: { id: session.sessionId },
      });
      expect(stored.authenticationMethods).toEqual(['pwd', 'recovery_code']);
      expect(stored.revokedAt).toBeNull();
      expect(done.notice).toMatchObject({ to: user.email });
      expect(done.notice?.text).toContain('1 Recovery Code left');
      expect(done.notice?.text).toContain('Agency Administrator');

      await expect(
        service.reauthenticate(
          session,
          { password: user.password, recoveryCode: user.recoveryCodes[0] },
          signInRequest('reauth-recovery-again'),
        ),
      ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    } finally {
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)(
  'regenerates 10 Recovery Codes, voids the old set, and sends a notice after the response',
  async () => {
    const fixture = await ownedLoginFixture({ recoveryCodes: 3 });
    const { admin, user } = fixture;
    try {
      const mail = new RecordingMailDelivery();
      const service = new AuthService(mail);
      const controller = new AuthController(service);
      const session = await agedSession(service, fixture, 60_000);
      await expect(service.recoveryCodeStatus(session)).resolves.toEqual({
        hasAuthenticator: true,
        remaining: 3,
      });

      const response = fakeResponse();
      await controller.regenerateRecoveryCodes(
        {
          authSession: session,
          header: () => `owned-login-regenerate-${randomUUID()}`,
          ip: '198.51.100.7',
        } as unknown as Parameters<AuthController['regenerateRecoveryCodes']>[0],
        response as unknown as Response,
      );
      const [[body]] = response.json.mock.calls as unknown as [[{ recoveryCodes: string[] }]];
      expect(body.recoveryCodes).toHaveLength(10);
      expect(new Set(body.recoveryCodes).size).toBe(10);
      for (const code of body.recoveryCodes) expect(code).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/);
      await expect(service.recoveryCodeStatus(session)).resolves.toMatchObject({ remaining: 10 });

      const stored = await admin.userRecoveryCode.findMany({ where: { userId: user.id } });
      for (const code of user.recoveryCodes) {
        const normalized = normalizeRecoveryCode(code) ?? '';
        for (const { codeHash } of stored) {
          await expect(verifyPassword(codeHash, normalized)).resolves.toBe(false);
        }
      }
      await expect(
        admin.securityEvent.findFirst({
          where: { userId: user.id, eventType: 'RECOVERY_CODES_REGENERATED' },
          select: { details: true },
        }),
      ).resolves.toEqual({ details: { recoveryCodes: 10 } });

      expect(mail.messages).toEqual([]);
      response.finish();
      await vi.waitFor(() => expect(mail.messages).toHaveLength(1));
      const [notice] = mail.messages;
      expect(notice).toMatchObject({ to: user.email });
      expect(notice?.text).toContain('Agency Administrator');
      expect(notice?.text).not.toMatch(/https?:/);
      for (const code of [...user.recoveryCodes, ...body.recoveryCodes]) {
        expect(JSON.stringify(notice).toLowerCase()).not.toContain(code);
      }
    } finally {
      await fixture.cleanup();
    }
  },
);
