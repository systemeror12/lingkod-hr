import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { hashPassword, hashSessionToken } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { expect, it } from 'vitest';
import { AgencyController } from './agency.controller';
import { REQUIRED_PERMISSIONS } from './auth.decorators';
import { AuthService } from './auth.service';
import { ReauthenticationGuard } from './reauthentication.guard';

const enabled = process.env.DATABASE_E2E === 'true';
const LOCK_REASON = 'Reported a phishing email that captured her password.';
const UNLOCK_REASON = 'Password reset confirmed in person; review closed.';

function databaseBytes(value: Buffer): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(value.byteLength));
  bytes.set(value);
  return bytes;
}

/**
 * Agencies A and B. The target User is an ACTIVE member of both, with a password and a session in
 * each Agency. Each Agency has a signed-in Security Administrator; A also has an Agency
 * Administrator.
 */
async function lockFixture() {
  const admin = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_E2E_ADMIN_URL ?? '' } },
  });
  const suffix = `${Date.now()}-${randomBytes(4).toString('hex')}`;
  const agencies = await Promise.all(
    ['A', 'B'].map((label) =>
      admin.agency.create({
        data: {
          code: `USER-LOCK-${label}-${suffix}`,
          name: `User Lock Agency ${label}`,
          agencyType: 'NGA',
          status: 'ACTIVE',
        },
      }),
    ),
  );
  const [agencyA, agencyB] = agencies as [(typeof agencies)[0], (typeof agencies)[0]];
  const userIds: string[] = [];
  const tokens = new Map<string, string>();
  const targetEmail = `user-lock-target-${suffix}@example.test`;
  const targetPassword = `passphrase ${suffix}`;

  async function member(label: string, agencyId: string, userId?: string, roleCode?: string) {
    const id =
      userId ??
      (
        await admin.user.create({
          data: {
            emailNormalized:
              label === 'target' ? targetEmail : `user-lock-${label}-${suffix}@example.test`,
            displayName: `Lock ${label}`,
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
          reason: 'User lock fixture',
        },
      });
    }
    const token = randomBytes(32).toString('base64url');
    await admin.userSession.create({
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
    tokens.set(label, token);
    return { userId: id, membershipId: membership.id };
  }

  const target = await member('target', agencyA.id, undefined, 'employee');
  const targetInB = await member('target-b', agencyB.id, target.userId);
  const securityA = await member('security-a', agencyA.id, undefined, 'security_administrator');
  const securityB = await member('security-b', agencyB.id, undefined, 'security_administrator');
  await member('agency-admin', agencyA.id, undefined, 'agency_administrator');
  await admin.userPassword.create({
    data: { userId: target.userId, passwordHash: await hashPassword(targetPassword) },
  });

  const service = new AuthService();
  const signedIn = async (label: string) => {
    const session = await service.authenticateSession(tokens.get(label) ?? '', `lock-${label}`);
    if (!session) throw new Error(`Expected an active session for ${label}.`);
    return session;
  };
  let requests = 0;

  return {
    admin,
    service,
    agencyA,
    agencyB,
    target,
    targetInB,
    targetEmail,
    targetPassword,
    securityA,
    securityB,
    signedIn,
    request: () => ({
      requestId: `user-lock-${suffix}-${(requests += 1)}`,
      ipAddress: '198.19.0.2',
      userAgent: null,
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

it('guards lock and unlock with their own permissions and the Reauthentication Window', () => {
  for (const [handler, permission] of [
    [AgencyController.prototype.lockUser, 'security.users.lock'],
    [AgencyController.prototype.unlockUser, 'security.users.unlock'],
  ] as const) {
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS, handler)).toEqual([permission]);
    expect(Reflect.getMetadata('__guards__', handler)).toEqual([ReauthenticationGuard]);
  }
});

it.skipIf(!enabled)('refuses lock and unlock to the Agency Administrator', async () => {
  const fixture = await lockFixture();
  try {
    const { context } = await fixture.signedIn('agency-admin');
    await expect(
      fixture.service.lockUser(
        context,
        fixture.target.membershipId,
        LOCK_REASON,
        fixture.request(),
      ),
    ).rejects.toMatchObject({ code: 'USER_LOCK_FORBIDDEN', statusCode: 403 });
    await expect(
      fixture.service.unlockUser(
        context,
        fixture.target.membershipId,
        UNLOCK_REASON,
        fixture.request(),
      ),
    ).rejects.toMatchObject({ code: 'USER_LOCK_FORBIDDEN', statusCode: 403 });
  } finally {
    await fixture.cleanup();
  }
});

it.skipIf(!enabled)(
  'locks the User everywhere, records it in the acting Agency only, and hides the detail from other Agencies',
  async () => {
    const fixture = await lockFixture();
    try {
      const { admin, service, target } = fixture;
      const securityA = await fixture.signedIn('security-a');
      await expect(
        service.lockUser(securityA.context, target.membershipId, LOCK_REASON, fixture.request()),
      ).resolves.toEqual({ revokedSessions: 2 });

      const user = await admin.user.findUniqueOrThrow({ where: { id: target.userId } });
      expect(user).toMatchObject({ globalStatus: 'LOCKED', lockedByAgencyId: fixture.agencyA.id });
      expect(user.lockedAt).toBeInstanceOf(Date);
      const sessions = await admin.userSession.findMany({ where: { userId: target.userId } });
      expect(sessions.map(({ revocationReason }) => revocationReason)).toEqual([
        'USER_LOCKED',
        'USER_LOCKED',
      ]);
      // Memberships keep their status: LOCKED is a User status only.
      await expect(
        admin.agencyMembership.findMany({
          where: { userId: target.userId },
          select: { status: true },
        }),
      ).resolves.toEqual([{ status: 'ACTIVE' }, { status: 'ACTIVE' }]);

      await expect(
        admin.securityEvent.findMany({
          where: { eventType: 'USER_LOCKED', userId: target.userId },
        }),
      ).resolves.toEqual([
        expect.objectContaining({
          agencyId: fixture.agencyA.id,
          membershipId: target.membershipId,
          details: {
            actorUserId: fixture.securityA.userId,
            actorMembershipId: fixture.securityA.membershipId,
            reason: LOCK_REASON,
            revokedSessions: 2,
          },
        }),
      ]);
      await expect(
        admin.auditEvent.findMany({
          where: { agencyId: fixture.agencyA.id, action: 'USER_LOCKED' },
        }),
      ).resolves.toEqual([
        expect.objectContaining({
          actorUserId: fixture.securityA.userId,
          entityType: 'User',
          entityId: target.userId,
          previousStatus: 'ACTIVE',
          newStatus: 'LOCKED',
          reason: LOCK_REASON,
        }),
      ]);
      await expect(
        admin.securityEvent.count({ where: { agencyId: fixture.agencyB.id } }),
      ).resolves.toBe(0);
      await expect(
        admin.auditEvent.count({ where: { agencyId: fixture.agencyB.id } }),
      ).resolves.toBe(0);

      // The locked User can't sign in, and gets the same answer as a wrong password.
      await expect(
        service.signInWithPassword(fixture.targetEmail, fixture.targetPassword, null, {
          requestId: 'user-lock-sign-in',
          ipAddress: '198.19.0.3',
          userAgent: null,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', statusCode: 401 });

      const inA = await service.listAgencyMembers(securityA.context);
      expect(inA.find(({ userId }) => userId === target.userId)).toMatchObject({
        globalStatus: 'LOCKED',
        lock: { byThisAgency: true, unlockable: true },
      });
      const securityB = await fixture.signedIn('security-b');
      const inB = await service.listAgencyMembers(securityB.context);
      const seenFromB = inB.find(({ userId }) => userId === target.userId);
      expect(seenFromB).toMatchObject({
        globalStatus: 'LOCKED',
        lock: { byThisAgency: false, unlockable: false },
      });
      const leaked = JSON.stringify(seenFromB);
      expect(leaked).not.toContain(fixture.agencyA.id);
      expect(leaked).not.toContain(fixture.agencyA.name);
      expect(leaked).not.toContain(LOCK_REASON);
    } finally {
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)(
  'keeps lock events in the locking Agency under Cross-Agency Isolation',
  async () => {
    const fixture = await lockFixture();
    try {
      const securityA = await fixture.signedIn('security-a');
      const securityB = await fixture.signedIn('security-b');
      await fixture.service.lockUser(
        securityA.context,
        fixture.target.membershipId,
        LOCK_REASON,
        fixture.request(),
      );
      const lockEvents = (context: typeof securityA.context) =>
        withDatabaseContext(context, async (transaction) => ({
          security: await transaction.securityEvent.count({
            where: { eventType: 'USER_LOCKED', userId: fixture.target.userId },
          }),
          audit: await transaction.auditEvent.count({
            where: { action: 'USER_LOCKED', entityId: fixture.target.userId },
          }),
        }));
      await expect(lockEvents(securityA.context)).resolves.toEqual({ security: 1, audit: 1 });
      await expect(lockEvents(securityB.context)).resolves.toEqual({ security: 0, audit: 0 });
    } finally {
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)('lets only the locking Agency unlock while it still has the User', async () => {
  const fixture = await lockFixture();
  try {
    const { admin, service, target } = fixture;
    const securityA = await fixture.signedIn('security-a');
    const securityB = await fixture.signedIn('security-b');
    await service.lockUser(securityA.context, target.membershipId, LOCK_REASON, fixture.request());

    await expect(
      service.unlockUser(
        securityB.context,
        fixture.targetInB.membershipId,
        UNLOCK_REASON,
        fixture.request(),
      ),
    ).rejects.toMatchObject({ code: 'UNLOCK_NOT_PERMITTED', statusCode: 403 });
    await expect(
      service.lockUser(
        securityB.context,
        fixture.targetInB.membershipId,
        LOCK_REASON,
        fixture.request(),
      ),
    ).rejects.toMatchObject({ code: 'USER_ALREADY_LOCKED', statusCode: 409 });

    await expect(
      service.unlockUser(securityA.context, target.membershipId, UNLOCK_REASON, fixture.request()),
    ).resolves.toEqual({ revokedSessions: 0 });
    await expect(
      admin.user.findUniqueOrThrow({
        where: { id: target.userId },
        select: { globalStatus: true, lockedAt: true, lockedByAgencyId: true },
      }),
    ).resolves.toEqual({ globalStatus: 'ACTIVE', lockedAt: null, lockedByAgencyId: null });
    await expect(
      admin.securityEvent.findMany({
        where: { eventType: 'USER_UNLOCKED', userId: target.userId },
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        agencyId: fixture.agencyA.id,
        details: {
          actorUserId: fixture.securityA.userId,
          actorMembershipId: fixture.securityA.membershipId,
          reason: UNLOCK_REASON,
          lockingAgencyGone: false,
          revokedSessions: 0,
        },
      }),
    ]);
    await expect(
      service.unlockUser(securityA.context, target.membershipId, UNLOCK_REASON, fixture.request()),
    ).rejects.toMatchObject({ code: 'USER_NOT_LOCKED', statusCode: 409 });
    await expect(
      admin.securityEvent.count({ where: { agencyId: fixture.agencyB.id } }),
    ).resolves.toBe(0);
  } finally {
    await fixture.cleanup();
  }
});

it.skipIf(!enabled)(
  'passes unlock authority to the remaining Agencies once the locking Agency no longer has the User',
  async () => {
    const fixture = await lockFixture();
    try {
      const { admin, service, target } = fixture;
      const securityA = await fixture.signedIn('security-a');
      const securityB = await fixture.signedIn('security-b');
      await service.lockUser(
        securityA.context,
        target.membershipId,
        LOCK_REASON,
        fixture.request(),
      );
      await admin.agencyMembership.update({
        where: { id: target.membershipId },
        data: { status: 'DEACTIVATED', deactivatedAt: new Date(), deactivationReason: 'Separated' },
      });

      const inB = await service.listAgencyMembers(securityB.context);
      expect(inB.find(({ userId }) => userId === target.userId)).toMatchObject({
        lock: { byThisAgency: false, unlockable: true },
      });
      await expect(
        service.unlockUser(
          securityB.context,
          fixture.targetInB.membershipId,
          UNLOCK_REASON,
          fixture.request(),
        ),
      ).resolves.toEqual({ revokedSessions: 0 });

      const [unlocked, ...others] = await admin.securityEvent.findMany({
        where: { eventType: 'USER_UNLOCKED', userId: target.userId },
      });
      expect(others).toEqual([]);
      expect(unlocked).toMatchObject({
        agencyId: fixture.agencyB.id,
        membershipId: fixture.targetInB.membershipId,
        details: { lockingAgencyGone: true, reason: UNLOCK_REASON },
      });
      // Agency B learns that authority passed to it, never which Agency locked the User.
      expect(JSON.stringify(unlocked?.details)).not.toContain(fixture.agencyA.id);
      await expect(
        admin.auditEvent.findMany({
          where: { agencyId: fixture.agencyB.id, action: 'USER_UNLOCKED' },
        }),
      ).resolves.toEqual([
        expect.objectContaining({
          entityId: target.userId,
          previousStatus: 'LOCKED',
          newStatus: 'ACTIVE',
          metadata: expect.objectContaining({ lockingAgencyGone: true }),
        }),
      ]);
    } finally {
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)(
  'refuses a lock across Agencies, of oneself, or of a member who is not ACTIVE',
  async () => {
    const fixture = await lockFixture();
    try {
      const { admin, service, target } = fixture;
      const securityA = await fixture.signedIn('security-a');
      const securityB = await fixture.signedIn('security-b');
      const lock = (context: typeof securityA.context, membershipId: string) =>
        service.lockUser(context, membershipId, LOCK_REASON, fixture.request());

      await expect(lock(securityB.context, target.membershipId)).rejects.toMatchObject({
        code: 'MEMBER_NOT_FOUND',
        statusCode: 404,
      });
      await expect(lock(securityA.context, fixture.securityA.membershipId)).rejects.toMatchObject({
        code: 'SELF_USER_LOCK',
        statusCode: 403,
      });
      await admin.agencyMembership.update({
        where: { id: target.membershipId },
        data: { status: 'SUSPENDED' },
      });
      await expect(lock(securityA.context, target.membershipId)).rejects.toMatchObject({
        code: 'MEMBER_NOT_FOUND',
        statusCode: 404,
      });
      await expect(
        admin.user.findUniqueOrThrow({ where: { id: target.userId } }),
      ).resolves.toMatchObject({ globalStatus: 'ACTIVE' });
    } finally {
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)(
  'allows only ACTIVE and LOCKED Users, with the lock columns set together, and no LOCKED membership',
  async () => {
    const fixture = await lockFixture();
    try {
      const { admin, target } = fixture;
      await expect(
        admin.user.update({ where: { id: target.userId }, data: { globalStatus: 'DEACTIVATED' } }),
      ).rejects.toThrow(/users_global_status_check/);
      await expect(
        admin.user.update({ where: { id: target.userId }, data: { globalStatus: 'LOCKED' } }),
      ).rejects.toThrow(/users_global_status_check/);
      await expect(
        admin.user.update({ where: { id: target.userId }, data: { lockedAt: new Date() } }),
      ).rejects.toThrow(/users_global_status_check/);
      await expect(
        admin.agencyMembership.update({
          where: { id: target.membershipId },
          data: { status: 'LOCKED' },
        }),
      ).rejects.toThrow(/agency_memberships_status_check/);
    } finally {
      await fixture.cleanup();
    }
  },
);
