import { randomBytes, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PrismaClient } from '@prisma/client';
import type { Response } from 'express';
import {
  generateRecoveryCodes,
  generateTotpSecret,
  hashPassword,
  hashSessionToken,
  normalizeRecoveryCode,
  sealTotpSecret,
} from '@lingkod-hr/auth';
import { getConfig, parseProtectedValueKey } from '@lingkod-hr/config';
import { withDatabaseContext } from '@lingkod-hr/database';
import { expect, it, vi } from 'vitest';
import { AgencyController } from './agency.controller';
import { REQUIRED_PERMISSIONS } from './auth.decorators';
import { AuthService } from './auth.service';
import { ReauthenticationGuard } from './reauthentication.guard';
import type { MailDelivery, MailMessage } from '../invitations/mail';

const enabled = process.env.DATABASE_E2E === 'true';
const VERIFICATION = {
  method: 'IN_PERSON_GOVERNMENT_ID',
  note: 'Checked her UMID at the HR counter.',
} as const;

function databaseBytes(value: Buffer): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(value.byteLength));
  bytes.set(value);
  return bytes;
}

class RecordingMailDelivery implements MailDelivery {
  readonly messages: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.messages.push(message);
  }
}

/** A response whose `close` the test fires, as Express does once the response is out. */
function fakeResponse() {
  const events = new EventEmitter();
  const response = {
    status: vi.fn(() => response),
    json: vi.fn(() => response),
    once: (event: string, listener: () => void) => events.once(event, listener),
    finish: () => events.emit('close'),
  };
  return response;
}

/**
 * Agencies A and B. The target User is an ACTIVE member of both, with a factor, Recovery Codes,
 * a session in each Agency, and a pending sign-in. Each Agency has a signed-in Security
 * Administrator; A also has an Agency Administrator.
 */
async function resetFixture() {
  const admin = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_E2E_ADMIN_URL ?? '' } },
  });
  const suffix = `${Date.now()}-${randomBytes(4).toString('hex')}`;
  const agencies = await Promise.all(
    ['A', 'B'].map((label) =>
      admin.agency.create({
        data: {
          code: `FACTOR-RESET-${label}-${suffix}`,
          name: `Factor Reset Agency ${label}`,
          agencyType: 'NGA',
          status: 'ACTIVE',
        },
      }),
    ),
  );
  const [agencyA, agencyB] = agencies as [(typeof agencies)[0], (typeof agencies)[0]];
  const userIds: string[] = [];
  const tokens = new Map<string, string>();

  async function member(label: string, agencyId: string, userId?: string, roleCode?: string) {
    const id =
      userId ??
      (
        await admin.user.create({
          data: {
            emailNormalized: `factor-reset-${label}-${suffix}@example.test`,
            displayName: `Reset ${label}`,
            globalStatus: 'ACTIVE',
          },
        })
      ).id;
    if (!userId) userIds.push(id);
    const membership = await admin.agencyMembership.create({
      data: { agencyId, userId: id, status: 'ACTIVE', activatedAt: new Date() },
    });
    if (roleCode) {
      const role = await admin.role.findFirstOrThrow({ where: { code: roleCode, agencyId: null } });
      await admin.membershipRole.create({
        data: {
          agencyId,
          membershipId: membership.id,
          roleId: role.id,
          effectiveFrom: new Date(Date.now() - 60_000),
          reason: 'Factor reset fixture',
        },
      });
    }
    const token = randomBytes(32).toString('base64url');
    const session = await admin.userSession.create({
      data: {
        userId: id,
        agencyId,
        agencyMembershipId: membership.id,
        sessionTokenHash: databaseBytes(hashSessionToken(token)),
        authTime: new Date(Date.now() - 60_000),
        authenticationMethods: ['pwd', 'totp'],
        lastSeenAt: new Date(),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    tokens.set(`${label}`, token);
    return { userId: id, membershipId: membership.id, sessionId: session.id };
  }

  const target = await member('target', agencyA.id, undefined, 'hrmo_administrator');
  const targetInB = await member('target-b', agencyB.id, target.userId);
  const securityA = await member('security-a', agencyA.id, undefined, 'security_administrator');
  const securityB = await member('security-b', agencyB.id, undefined, 'security_administrator');
  const agencyAdministrator = await member(
    'agency-admin',
    agencyA.id,
    undefined,
    'agency_administrator',
  );

  const factorId = randomUUID();
  await admin.userTotpFactor.create({
    data: {
      id: factorId,
      userId: target.userId,
      secretEnvelope: databaseBytes(
        sealTotpSecret(
          generateTotpSecret(),
          parseProtectedValueKey(getConfig().DATA_ENCRYPTION_KEY),
          { userId: target.userId, factorId },
        ),
      ),
    },
  });
  for (const code of generateRecoveryCodes().slice(0, 3)) {
    await admin.userRecoveryCode.create({
      data: {
        userId: target.userId,
        codeHash: await hashPassword(normalizeRecoveryCode(code) ?? ''),
      },
    });
  }
  await admin.userPassword.create({
    data: { userId: target.userId, passwordHash: await hashPassword(`passphrase ${suffix}`) },
  });
  await admin.pendingAuthentication.create({
    data: {
      tokenHash: databaseBytes(hashSessionToken(randomBytes(32).toString('base64url'))),
      purpose: 'SIGN_IN',
      userId: target.userId,
      stage: 'TOTP',
      verifiedMethods: ['pwd'],
      expiresAt: new Date(Date.now() + 60_000),
    },
  });

  const mail = new RecordingMailDelivery();
  const service = new AuthService(mail);
  const signedIn = async (label: string) => {
    const session = await service.authenticateSession(tokens.get(label) ?? '', `reset-${label}`);
    if (!session) throw new Error(`Expected an active session for ${label}.`);
    return session;
  };

  return {
    admin,
    mail,
    service,
    agencyA,
    agencyB,
    target,
    targetInB,
    securityA,
    securityB,
    agencyAdministrator,
    signedIn,
    request: (label = 'step') => ({
      requestId: `factor-reset-${label}-${randomUUID()}`,
      ipAddress: '198.19.0.1',
    }),
    cleanup: async () => {
      const agencyIds = [agencyA.id, agencyB.id];
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.securityEvent.deleteMany({
          where: { OR: [{ agencyId: { in: agencyIds } }, { userId: { in: userIds } }] },
        });
        await transaction.auditEvent.deleteMany({ where: { agencyId: { in: agencyIds } } });
      });
      await admin.userSession.deleteMany({ where: { userId: { in: userIds } } });
      await admin.membershipRole.deleteMany({ where: { agencyId: { in: agencyIds } } });
      await admin.agencyMembership.deleteMany({ where: { userId: { in: userIds } } });
      await admin.user.deleteMany({ where: { id: { in: userIds } } });
      await admin.agency.deleteMany({ where: { id: { in: agencyIds } } });
      await admin.$disconnect();
    },
  };
}

it('guards the Factor Reset with its own permission and the Reauthentication Window', () => {
  const handler = AgencyController.prototype.resetFactor;
  expect(Reflect.getMetadata(REQUIRED_PERMISSIONS, handler)).toEqual(['security.mfa.reset_factor']);
  expect(Reflect.getMetadata('__guards__', handler)).toEqual([ReauthenticationGuard]);
  expect(Reflect.getMetadata(REQUIRED_PERMISSIONS, AgencyController.prototype.members)).toEqual([
    'security.users.read',
  ]);
});

it.skipIf(!enabled)(
  'grants the Factor Reset to the Security Administrator and not the Agency Administrator',
  async () => {
    const fixture = await resetFixture();
    try {
      const security = await fixture.signedIn('security-a');
      const agencyAdministrator = await fixture.signedIn('agency-admin');
      expect(security.context.permissions.map(({ code }) => code)).toContain(
        'security.mfa.reset_factor',
      );
      expect(agencyAdministrator.context.permissions.map(({ code }) => code)).not.toContain(
        'security.mfa.reset_factor',
      );
      await expect(
        fixture.service.resetFactor(
          agencyAdministrator.context,
          fixture.target.membershipId,
          VERIFICATION,
          fixture.request('agency-admin'),
        ),
      ).rejects.toMatchObject({ code: 'FACTOR_RESET_FORBIDDEN', statusCode: 403 });
      await expect(
        fixture.admin.userTotpFactor.count({ where: { userId: fixture.target.userId } }),
      ).resolves.toBe(1);
    } finally {
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)('lists the Agency members with whether each has an authenticator', async () => {
  const fixture = await resetFixture();
  try {
    const security = await fixture.signedIn('security-a');
    const members = await fixture.service.listAgencyMembers(security.context);
    expect(members.map(({ membershipId }) => membershipId).sort()).toEqual(
      [
        fixture.target.membershipId,
        fixture.securityA.membershipId,
        fixture.agencyAdministrator.membershipId,
      ].sort(),
    );
    expect(members.find(({ userId }) => userId === fixture.target.userId)).toMatchObject({
      membershipStatus: 'ACTIVE',
      globalStatus: 'ACTIVE',
      hasAuthenticator: true,
    });
    expect(members.find(({ userId }) => userId === fixture.securityA.userId)).toMatchObject({
      hasAuthenticator: false,
    });
    // The Agency Context learns only that the factor exists, never the row and its secret.
    await expect(
      withDatabaseContext(security.context, (transaction) =>
        transaction.userTotpFactor.findMany({ where: { userId: fixture.target.userId } }),
      ),
    ).resolves.toEqual([]);
  } finally {
    await fixture.cleanup();
  }
});

it.skipIf(!enabled)(
  'resets the factor, signs the User out everywhere, and records it in the acting Agency only',
  async () => {
    const fixture = await resetFixture();
    try {
      const security = await fixture.signedIn('security-a');
      const controller = new AgencyController(fixture.service);
      const response = fakeResponse();
      await controller.resetFactor(
        fixture.agencyA.id,
        fixture.target.membershipId,
        VERIFICATION,
        security.context,
        { header: () => 'factor-reset-controller', ip: '198.19.0.1' } as never,
        response as unknown as Response,
      );
      expect(response.json).toHaveBeenCalledWith({ status: 'RESET', revokedSessions: 2 });

      const { admin, target } = fixture;
      await expect(admin.userTotpFactor.count({ where: { userId: target.userId } })).resolves.toBe(
        0,
      );
      await expect(
        admin.userRecoveryCode.count({ where: { userId: target.userId } }),
      ).resolves.toBe(0);
      await expect(
        admin.pendingAuthentication.count({ where: { userId: target.userId } }),
      ).resolves.toBe(0);
      const sessions = await admin.userSession.findMany({ where: { userId: target.userId } });
      expect(sessions).toHaveLength(2);
      for (const session of sessions) {
        expect(session.revokedAt).not.toBeNull();
        expect(session.revocationReason).toBe('MFA_FACTOR_RESET');
      }
      await expect(admin.userPassword.count({ where: { userId: target.userId } })).resolves.toBe(1);
      await expect(
        admin.user.findUniqueOrThrow({ where: { id: target.userId } }),
      ).resolves.toMatchObject({ globalStatus: 'ACTIVE' });

      const [reset, ...others] = await admin.securityEvent.findMany({
        where: { eventType: 'MFA_FACTOR_RESET', userId: target.userId },
      });
      expect(others).toEqual([]);
      expect(reset).toMatchObject({
        agencyId: fixture.agencyA.id,
        userId: target.userId,
        membershipId: target.membershipId,
        details: {
          actorUserId: fixture.securityA.userId,
          actorMembershipId: fixture.securityA.membershipId,
          verificationMethod: VERIFICATION.method,
          note: VERIFICATION.note,
          revokedSessions: 2,
        },
      });
      const audit = await admin.auditEvent.findMany({
        where: { agencyId: fixture.agencyA.id, action: 'MFA_FACTOR_RESET' },
      });
      expect(audit).toEqual([
        expect.objectContaining({
          actorUserId: fixture.securityA.userId,
          actorMembershipId: fixture.securityA.membershipId,
          entityType: 'User',
          entityId: target.userId,
          reason: VERIFICATION.note,
        }),
      ]);
      await expect(
        admin.securityEvent.count({
          where: { agencyId: fixture.agencyA.id, eventType: 'SESSION_REVOKED' },
        }),
      ).resolves.toBe(2);
      await expect(
        admin.auditEvent.count({
          where: { agencyId: fixture.agencyA.id, action: 'SESSION_REVOKED' },
        }),
      ).resolves.toBe(2);
      await expect(
        admin.securityEvent.count({ where: { agencyId: fixture.agencyB.id } }),
      ).resolves.toBe(0);
      await expect(
        admin.auditEvent.count({ where: { agencyId: fixture.agencyB.id } }),
      ).resolves.toBe(0);

      expect(fixture.mail.messages).toEqual([]);
      response.finish();
      await vi.waitFor(() => expect(fixture.mail.messages).toHaveLength(1));
      const [notice] = fixture.mail.messages;
      expect(notice?.text).toContain(
        'A Security Administrator of Factor Reset Agency A reset your authenticator on',
      );
      expect(notice?.text).toContain("You'll set it up again the next time you sign in.");
      expect(notice?.text).toContain(
        "If you didn't request this, contact your Agency Administrator.",
      );
      expect(notice?.text).not.toMatch(/https?:/);
    } finally {
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)(
  'refuses a reset across Agencies, of oneself, of a non-ACTIVE member, or without a factor',
  async () => {
    const fixture = await resetFixture();
    try {
      const { admin, service, target } = fixture;
      const securityA = await fixture.signedIn('security-a');
      const securityB = await fixture.signedIn('security-b');
      const reset = (context: typeof securityA.context, membershipId: string) =>
        service.resetFactor(context, membershipId, VERIFICATION, fixture.request());

      // Agency B's Security Administrator cannot name Agency A's membership.
      await expect(reset(securityB.context, target.membershipId)).rejects.toMatchObject({
        code: 'MEMBER_NOT_FOUND',
        statusCode: 404,
      });
      await expect(reset(securityA.context, fixture.securityA.membershipId)).rejects.toMatchObject({
        code: 'SELF_FACTOR_RESET',
        statusCode: 403,
      });
      await admin.agencyMembership.update({
        where: { id: target.membershipId },
        data: { status: 'SUSPENDED' },
      });
      await expect(reset(securityA.context, target.membershipId)).rejects.toMatchObject({
        code: 'MEMBER_NOT_FOUND',
        statusCode: 404,
      });
      await expect(admin.userTotpFactor.count({ where: { userId: target.userId } })).resolves.toBe(
        1,
      );

      // Agency B's Security Administrator may reset through the target's ACTIVE membership there.
      await expect(reset(securityB.context, fixture.targetInB.membershipId)).resolves.toMatchObject(
        { revokedSessions: 2 },
      );
      await expect(reset(securityB.context, fixture.targetInB.membershipId)).rejects.toMatchObject({
        code: 'NO_AUTHENTICATOR',
        statusCode: 409,
      });
      await expect(
        admin.securityEvent.count({
          where: { eventType: 'MFA_FACTOR_RESET', agencyId: fixture.agencyB.id },
        }),
      ).resolves.toBe(1);
      await expect(
        admin.securityEvent.count({ where: { agencyId: fixture.agencyA.id } }),
      ).resolves.toBe(0);
    } finally {
      await fixture.cleanup();
    }
  },
);
