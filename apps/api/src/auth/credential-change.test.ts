import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PrismaClient } from '@prisma/client';
import type { Response } from 'express';
import {
  generateRecoveryCodes,
  generateTotpSecret,
  hashEmail,
  hashPassword,
  hashSessionToken,
  normalizeRecoveryCode,
  sealTotpSecret,
  totpCode,
  verifyPassword,
} from '@lingkod-hr/auth';
import { getConfig, parseProtectedValueKey } from '@lingkod-hr/config';
import { afterEach, expect, it, vi } from 'vitest';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { ReauthenticationGuard } from './reauthentication.guard';
import type { MailDelivery, MailMessage } from '../invitations/mail';

const enabled = process.env.DATABASE_E2E === 'true';
const NEW_PASSWORD = 'tahimik na umaga sa bundok 42';

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

/** The time step after the last one accepted, so a code is never a replay. */
function nextCode(secret: string, offsetSteps = 1) {
  return totpCode(secret, new Date(Date.now() + offsetSteps * 30_000));
}

/**
 * A User with a password, a TOTP factor, Recovery Codes, and an Agency Membership, signed in on
 * three sessions. `session` is the one acting, signed in `authAgeMs` ago.
 */
async function signedInFixture(options: { authAgeMs?: number; recoveryCodes?: number } = {}) {
  const admin = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_E2E_ADMIN_URL ?? '' } },
  });
  const suffix = `${Date.now()}-${randomBytes(4).toString('hex')}`;
  const email = `credential-change-${suffix}@example.test`;
  const password = `old passphrase ${suffix}`;
  const ipAddress = `198.19.${randomInt(0, 255)}.${randomInt(1, 255)}`;
  const agency = await admin.agency.create({
    data: {
      code: `CREDENTIAL-CHANGE-${suffix}`,
      name: 'Credential Change Agency',
      agencyType: 'NGA',
      status: 'ACTIVE',
    },
  });
  const user = await admin.user.create({
    data: { emailNormalized: email, displayName: 'Change User', globalStatus: 'ACTIVE' },
  });
  const membership = await admin.agencyMembership.create({
    data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE', activatedAt: new Date() },
  });
  await admin.userPassword.create({
    data: { userId: user.id, passwordHash: await hashPassword(password) },
  });
  const totpSecret = generateTotpSecret();
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
  const recoveryCodes = generateRecoveryCodes().slice(0, options.recoveryCodes ?? 3);
  for (const code of recoveryCodes) {
    await admin.userRecoveryCode.create({
      data: { userId: user.id, codeHash: await hashPassword(normalizeRecoveryCode(code) ?? '') },
    });
  }
  const tokens = Array.from({ length: 3 }, () => randomBytes(32).toString('base64url'));
  for (const [index, token] of tokens.entries()) {
    await admin.userSession.create({
      data: {
        userId: user.id,
        agencyId: agency.id,
        agencyMembershipId: membership.id,
        sessionTokenHash: databaseBytes(hashSessionToken(token)),
        authTime: new Date(Date.now() - (index === 0 ? (options.authAgeMs ?? 60_000) : 60_000)),
        authenticationMethods: ['pwd', 'totp'],
        lastSeenAt: new Date(),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
  }
  const service = new AuthService(new RecordingMailDelivery());
  const session = await service.authenticateSession(tokens[0] ?? '', 'credential-change-me');
  if (!session) throw new Error('Expected an active session.');
  const emailHash = databaseBytes(hashEmail(email, getConfig().BLIND_INDEX_KEY));
  return {
    admin,
    email,
    password,
    totpSecret,
    factorId,
    recoveryCodes,
    session,
    userId: user.id,
    emailHash,
    request: (label = 'step') => ({
      requestId: `credential-change-${label}-${randomUUID()}`,
      ipAddress,
    }),
    events: (eventType: string) =>
      admin.securityEvent.findMany({
        where: { eventType, OR: [{ userId: user.id }, { emailHash }] },
        orderBy: { occurredAt: 'asc' },
      }),
    sessions: () =>
      admin.userSession.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'asc' } }),
    throttle: () => admin.signInThrottle.findUnique({ where: { emailHash } }),
    storedPassword: () => admin.userPassword.findUniqueOrThrow({ where: { userId: user.id } }),
    cleanup: async () => {
      await admin.signInThrottle.deleteMany({ where: { emailHash } });
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.securityEvent.deleteMany({
          where: {
            OR: [{ agencyId: agency.id }, { userId: user.id }, { emailHash }, { ipAddress }],
          },
        });
        await transaction.auditEvent.deleteMany({ where: { agencyId: agency.id } });
      });
      await admin.userSession.deleteMany({ where: { userId: user.id } });
      await admin.agencyMembership.deleteMany({ where: { userId: user.id } });
      await admin.user.deleteMany({ where: { id: user.id } });
      await admin.agency.deleteMany({ where: { id: agency.id } });
      await admin.$disconnect();
    },
  };
}

type Fixture = Awaited<ReturnType<typeof signedInFixture>>;

function controllerRequest(fixture: Fixture, label: string) {
  return {
    authSession: fixture.session,
    header: () => `credential-change-${label}-${randomUUID()}`,
    ip: fixture.request().ipAddress,
  } as unknown as Parameters<AuthController['changePassword']>[1];
}

afterEach(() => {
  vi.restoreAllMocks();
});

it('asks for proof on every password change instead of the Reauthentication Window', () => {
  const guards: unknown[] = Reflect.getMetadata(
    '__guards__',
    AuthController.prototype.changePassword,
  );
  expect(guards).toEqual([AuthGuard]);
});

it('guards replacing the authenticator with the Reauthentication Window', () => {
  for (const handler of [
    AuthController.prototype.beginTotpReplacement,
    AuthController.prototype.confirmTotpReplacement,
  ]) {
    const guards: unknown[] = Reflect.getMetadata('__guards__', handler);
    expect(guards).toEqual([AuthGuard, ReauthenticationGuard]);
  }
});

it.skipIf(!enabled)(
  'changes the password with a TOTP code outside the window and signs out the other sessions',
  async () => {
    const fixture = await signedInFixture({ authAgeMs: 60 * 60_000 });
    try {
      const mail = new RecordingMailDelivery();
      const controller = new AuthController(new AuthService(mail));
      const response = fakeResponse();
      await controller.changePassword(
        {
          currentPassword: fixture.password,
          newPassword: NEW_PASSWORD,
          code: nextCode(fixture.totpSecret),
        },
        controllerRequest(fixture, 'change'),
        response as unknown as Response,
      );
      expect(response.json).toHaveBeenCalledWith({ status: 'CHANGED', revokedSessions: 2 });

      const stored = await fixture.storedPassword();
      await expect(verifyPassword(stored.passwordHash, NEW_PASSWORD)).resolves.toBe(true);
      await expect(verifyPassword(stored.passwordHash, fixture.password)).resolves.toBe(false);
      expect(stored.changedAt.getTime()).toBeGreaterThan(Date.now() - 60_000);

      const [current, ...others] = await fixture.sessions();
      expect(current?.id).toBe(fixture.session.sessionId);
      expect(current?.revokedAt).toBeNull();
      expect(current?.authTime).toEqual(fixture.session.authTime);
      expect(current?.expiresAt).toEqual(fixture.session.expiresAt);
      expect(others).toHaveLength(2);
      for (const other of others) {
        expect(other.revokedAt).not.toBeNull();
        expect(other.revocationReason).toBe('PASSWORD_CHANGED');
      }

      const [changed] = await fixture.events('PASSWORD_CHANGED');
      expect(changed?.details).toEqual({ methods: ['pwd', 'totp'], revokedSessions: 2 });
      expect(JSON.stringify(changed?.details)).not.toContain(NEW_PASSWORD);
      await expect(fixture.events('SESSION_REVOKED')).resolves.toHaveLength(2);

      expect(mail.messages).toEqual([]);
      response.finish();
      await vi.waitFor(() => expect(mail.messages).toHaveLength(1));
      const [notice] = mail.messages;
      expect(notice).toMatchObject({ to: fixture.email });
      expect(notice?.text).toContain('Agency Administrator');
      expect(notice?.text).not.toMatch(/https?:/);
    } finally {
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)(
  'changes the password with a Recovery Code, spends it, and sends both notices',
  async () => {
    const fixture = await signedInFixture({ recoveryCodes: 2 });
    try {
      const service = new AuthService(new RecordingMailDelivery());
      const done = await service.changePassword(
        fixture.session,
        {
          currentPassword: fixture.password,
          newPassword: NEW_PASSWORD,
          recoveryCode: fixture.recoveryCodes[0]?.toUpperCase(),
        },
        fixture.request('recovery'),
      );
      expect(done.revokedSessions).toBe(2);
      await expect(
        fixture.admin.userRecoveryCode.count({ where: { userId: fixture.userId } }),
      ).resolves.toBe(1);
      expect(done.notices.map((notice) => notice.subject)).toEqual([
        'Your LingkodHR password was changed',
        'A Recovery Code was used in your LingkodHR account',
      ]);
      const [changed] = await fixture.events('PASSWORD_CHANGED');
      expect(changed?.details).toEqual({ methods: ['pwd', 'recovery_code'], revokedSessions: 2 });
    } finally {
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)(
  'refuses a wrong current password or code, counting it like sign-in, and changes nothing',
  async () => {
    const fixture = await signedInFixture();
    try {
      const service = new AuthService(new RecordingMailDelivery());
      const refused = { code: 'INVALID_CREDENTIALS', statusCode: 401 };
      const before = await fixture.storedPassword();

      await expect(
        service.changePassword(
          fixture.session,
          {
            currentPassword: 'not the right passphrase',
            newPassword: NEW_PASSWORD,
            code: nextCode(fixture.totpSecret),
          },
          fixture.request('wrong-password'),
        ),
      ).rejects.toMatchObject(refused);
      await expect(
        service.changePassword(
          fixture.session,
          { currentPassword: fixture.password, newPassword: NEW_PASSWORD, code: '000000' },
          fixture.request('wrong-code'),
        ),
      ).rejects.toMatchObject(refused);
      await expect(
        service.changePassword(
          fixture.session,
          { currentPassword: fixture.password, newPassword: NEW_PASSWORD },
          fixture.request('no-code'),
        ),
      ).rejects.toMatchObject(refused);

      await expect(fixture.throttle()).resolves.toMatchObject({ failureCount: 3 });
      const after = await fixture.storedPassword();
      expect(after.passwordHash).toBe(before.passwordHash);
      expect(after.secondFactorFailures).toBe(2);
      const sessions = await fixture.sessions();
      expect(sessions.every((session) => session.revokedAt === null)).toBe(true);
      await expect(fixture.events('PASSWORD_CHANGED')).resolves.toEqual([]);
    } finally {
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)(
  'refuses a password change from a session that a concurrent change revoked',
  async () => {
    const fixture = await signedInFixture();
    try {
      const service = new AuthService(new RecordingMailDelivery());
      const before = await fixture.storedPassword();
      // Another session's change committed between this proof and this change.
      await fixture.admin.userSession.update({
        where: { id: fixture.session.sessionId },
        data: { revokedAt: new Date(), revocationReason: 'PASSWORD_CHANGED' },
      });

      await expect(
        service.changePassword(
          fixture.session,
          {
            currentPassword: fixture.password,
            newPassword: NEW_PASSWORD,
            code: nextCode(fixture.totpSecret),
          },
          fixture.request('revoked'),
        ),
      ).rejects.toMatchObject({ code: 'SESSION_REVOKED', statusCode: 401 });
      await expect(fixture.storedPassword()).resolves.toMatchObject({
        passwordHash: before.passwordHash,
      });
      await expect(fixture.events('PASSWORD_CHANGED')).resolves.toEqual([]);
    } finally {
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)('refuses a password change during a Sign-in Cool-down', async () => {
  const fixture = await signedInFixture();
  try {
    const service = new AuthService(new RecordingMailDelivery());
    const before = await fixture.storedPassword();
    await fixture.admin.signInThrottle.create({
      data: {
        emailHash: fixture.emailHash,
        failureCount: 0,
        cooldownLevel: 1,
        cooldownUntil: new Date(Date.now() + 5 * 60_000),
        lastFailureAt: new Date(),
      },
    });

    await expect(
      service.changePassword(
        fixture.session,
        {
          currentPassword: fixture.password,
          newPassword: NEW_PASSWORD,
          code: nextCode(fixture.totpSecret),
        },
        fixture.request('cooldown'),
      ),
    ).rejects.toMatchObject({ code: 'SIGN_IN_COOLDOWN', statusCode: 429 });
    await expect(fixture.storedPassword()).resolves.toMatchObject({
      passwordHash: before.passwordHash,
    });
  } finally {
    await fixture.cleanup();
  }
});

it.skipIf(!enabled)(
  'names the password rule a new password fails, including reuse, without counting a guess',
  async () => {
    const fixture = await signedInFixture();
    try {
      const service = new AuthService(new RecordingMailDelivery());
      const change = (newPassword: string) =>
        service.changePassword(
          fixture.session,
          {
            currentPassword: fixture.password,
            newPassword,
            code: nextCode(fixture.totpSecret),
          },
          fixture.request('rule'),
        );

      await expect(change('too short')).rejects.toMatchObject({
        code: 'PASSWORD_REJECTED',
        statusCode: 400,
        message: 'Use 15 to 128 characters. This one has 9.',
      });
      await expect(change(fixture.password)).rejects.toMatchObject({
        code: 'PASSWORD_REJECTED',
        message: 'Choose a password that’s different from your current one.',
      });
      await expect(fixture.throttle()).resolves.toBeNull();
      const stored = await fixture.storedPassword();
      await expect(verifyPassword(stored.passwordHash, fixture.password)).resolves.toBe(true);
    } finally {
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)(
  'replaces the authenticator in one transaction, keeps the Recovery Codes, and sends a notice',
  async () => {
    const fixture = await signedInFixture();
    const { admin, userId } = fixture;
    try {
      const mail = new RecordingMailDelivery();
      const service = new AuthService(mail);
      const controller = new AuthController(service);
      const codesBefore = await admin.userRecoveryCode.findMany({
        where: { userId },
        orderBy: { id: 'asc' },
      });

      const started = await service.beginTotpReplacement(fixture.session);
      expect(started.account).toBe(fixture.email);
      expect(started.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 5 * 60_000);
      const newSecret = new URL(started.otpauthUri).searchParams.get('secret') ?? '';
      expect(newSecret).not.toBe(fixture.totpSecret);
      const [pending] = await admin.pendingAuthentication.findMany({ where: { userId } });
      expect(pending).toMatchObject({ purpose: 'TOTP_REPLACEMENT', tokenHash: null });

      // A code from the old app doesn't confirm the new one.
      await expect(
        service.confirmTotpReplacement(
          fixture.session,
          nextCode(fixture.totpSecret),
          fixture.request('old-app'),
        ),
      ).rejects.toMatchObject({ code: 'INVALID_CODE', statusCode: 401 });
      await expect(admin.userTotpFactor.findUnique({ where: { userId } })).resolves.toMatchObject({
        id: fixture.factorId,
      });

      const response = fakeResponse();
      await controller.confirmTotpReplacement(
        { code: totpCode(newSecret) },
        controllerRequest(fixture, 'replace') as never,
        response as unknown as Response,
      );
      expect(response.json).toHaveBeenCalledWith({ status: 'REPLACED', revokedSessions: 2 });

      const factor = await admin.userTotpFactor.findUniqueOrThrow({ where: { userId } });
      expect(factor.id).toBe(pending?.id);
      expect(factor.id).not.toBe(fixture.factorId);
      expect(Number(factor.lastAcceptedStep)).toBeGreaterThan(0);
      await expect(admin.pendingAuthentication.count({ where: { userId } })).resolves.toBe(0);
      await expect(
        admin.userRecoveryCode.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
      ).resolves.toEqual(codesBefore);

      const [current, ...others] = await fixture.sessions();
      expect(current?.revokedAt).toBeNull();
      for (const other of others) expect(other.revocationReason).toBe('TOTP_REPLACED');
      const [replaced] = await fixture.events('TOTP_REPLACED');
      expect(replaced?.details).toEqual({ revokedSessions: 2 });

      // The new app proves the User; the old one no longer does.
      await expect(
        service.reauthenticate(
          fixture.session,
          { password: fixture.password, code: nextCode(fixture.totpSecret, 2) },
          fixture.request('old-reauth'),
        ),
      ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
      await expect(
        service.reauthenticate(
          fixture.session,
          { password: fixture.password, code: totpCode(newSecret, new Date(Date.now() + 30_000)) },
          fixture.request('new-reauth'),
        ),
      ).resolves.toEqual({ notice: null });

      response.finish();
      await vi.waitFor(() => expect(mail.messages).toHaveLength(1));
      const [notice] = mail.messages;
      expect(notice?.subject).toBe('The authenticator app for your LingkodHR account was replaced');
      expect(notice?.text).toContain('Agency Administrator');
      expect(notice?.text).not.toMatch(/https?:|otpauth/);
    } finally {
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)(
  'refuses to confirm a replacement that was never started or expired',
  async () => {
    const fixture = await signedInFixture();
    const { admin, userId } = fixture;
    try {
      const service = new AuthService(new RecordingMailDelivery());
      const expired = { code: 'REPLACEMENT_EXPIRED', statusCode: 409 };
      await expect(
        service.confirmTotpReplacement(fixture.session, '123456', fixture.request('none')),
      ).rejects.toMatchObject(expired);

      const started = await service.beginTotpReplacement(fixture.session);
      const newSecret = new URL(started.otpauthUri).searchParams.get('secret') ?? '';
      await admin.pendingAuthentication.updateMany({
        where: { userId },
        data: {
          createdAt: new Date(Date.now() - 10 * 60_000),
          expiresAt: new Date(Date.now() - 1),
        },
      });
      await expect(
        service.confirmTotpReplacement(
          fixture.session,
          totpCode(newSecret),
          fixture.request('late'),
        ),
      ).rejects.toMatchObject(expired);
      await expect(admin.userTotpFactor.findUnique({ where: { userId } })).resolves.toMatchObject({
        id: fixture.factorId,
      });
    } finally {
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)('offers no replacement to a User without an authenticator', async () => {
  const fixture = await signedInFixture();
  try {
    await fixture.admin.userTotpFactor.delete({ where: { userId: fixture.userId } });
    await expect(
      new AuthService(new RecordingMailDelivery()).beginTotpReplacement(fixture.session),
    ).rejects.toMatchObject({ code: 'NO_AUTHENTICATOR', statusCode: 409 });
  } finally {
    await fixture.cleanup();
  }
});
