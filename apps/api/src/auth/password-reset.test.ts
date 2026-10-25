import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { Request, Response } from 'express';
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
import { AuthService, PASSWORD_RESET_RESPONSE_FLOOR_MS } from './auth.service';
import type { MailDelivery, MailMessage } from '../invitations/mail';

const enabled = process.env.DATABASE_E2E === 'true';
const NEW_PASSWORD = 'tahimik na umaga sa bundok 42';
const LATER_PASSWORD = 'maaliwalas na hapon sa dagat 17';
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) LingkodHR test';
const INVALID_LINK = 'This reset link is invalid or has expired. Request a new one.';
const SAME_PASSWORD = 'Choose a password that’s different from your current one.';

function databaseBytes(value: Buffer): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(value.byteLength));
  bytes.set(value);
  return bytes;
}

/** The token in a reset mail's link. */
function tokenFrom(message: MailMessage | null): string {
  const token = /\/reset-password\/([A-Za-z0-9_-]{43})/.exec(message?.text ?? '')?.[1];
  if (!token) throw new Error('The reset mail has no link.');
  return token;
}

/**
 * A User with a password and an Agency Membership holding two open sessions; optionally a TOTP
 * factor, Recovery Codes, or no password at all. Each fixture has its own IP address, so the
 * per-IP limit of one test can't refuse another's requests.
 */
async function resetFixture(
  options: {
    withPassword?: boolean;
    withTotp?: boolean;
    recoveryCodes?: number;
    globalStatus?: string;
    secondFactorFailures?: number;
  } = {},
) {
  const admin = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_E2E_ADMIN_URL ?? '' } },
  });
  const suffix = `${Date.now()}-${randomBytes(4).toString('hex')}`;
  const email = `password-reset-${suffix}@example.test`;
  const password = `old passphrase ${suffix}`;
  const ipAddress = `198.18.${randomInt(0, 255)}.${randomInt(1, 255)}`;
  const agency = await admin.agency.create({
    data: {
      code: `PASSWORD-RESET-${suffix}`,
      name: 'Password Reset Agency',
      agencyType: 'NGA',
      status: 'ACTIVE',
    },
  });
  const user = await admin.user.create({
    data: {
      emailNormalized: email,
      displayName: 'Reset User',
      globalStatus: options.globalStatus ?? 'ACTIVE',
      ...(options.globalStatus === 'LOCKED'
        ? { lockedAt: new Date(), lockedByAgencyId: agency.id }
        : {}),
    },
  });
  const membership = await admin.agencyMembership.create({
    data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE', activatedAt: new Date() },
  });
  if (options.withPassword ?? true) {
    await admin.userPassword.create({
      data: {
        userId: user.id,
        passwordHash: await hashPassword(password),
        secondFactorFailures: options.secondFactorFailures ?? 4,
        resetRequiredAt: new Date(),
      },
    });
  }
  let totpSecret: string | null = null;
  if (options.withTotp) {
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
  for (let index = 0; index < 2; index += 1) {
    await admin.userSession.create({
      data: {
        userId: user.id,
        agencyId: agency.id,
        agencyMembershipId: membership.id,
        sessionTokenHash: databaseBytes(hashSessionToken(randomBytes(32).toString('base64url'))),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
  }
  const emailHash = databaseBytes(hashEmail(email, getConfig().BLIND_INDEX_KEY));
  return {
    admin,
    email,
    password,
    emailHash,
    totpSecret,
    recoveryCodes,
    userId: user.id,
    request: (label = 'step') => ({
      requestId: `password-reset-${label}-${randomUUID()}`,
      ipAddress,
      userAgent: USER_AGENT,
    }),
    events: (eventType: string) =>
      admin.securityEvent.findMany({
        where: { eventType, OR: [{ emailHash }, { userId: user.id }, { ipAddress }] },
        orderBy: { occurredAt: 'asc' },
      }),
    tokens: () =>
      admin.passwordResetToken.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'asc' },
      }),
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

type Fixture = Awaited<ReturnType<typeof resetFixture>>;

/** Requests a reset link for the fixture's User and answers its token. */
async function requestLink(service: AuthService, fixture: Fixture): Promise<string> {
  return tokenFrom(await service.requestPasswordReset(fixture.email, fixture.request('request')));
}

/** Every event's details, which must never hold the token, a password, a code, or the raw email. */
function expectNoSecrets(events: { details: unknown }[], secrets: string[]) {
  const written = JSON.stringify(events.map(({ details }) => details)).toLowerCase();
  for (const secret of secrets) expect(written).not.toContain(secret.toLowerCase());
}

afterEach(() => {
  vi.restoreAllMocks();
});

it.skipIf(!enabled)(
  'sends a 30-minute link to a User with a password and stores only its hash',
  async () => {
    const fixture = await resetFixture({ globalStatus: 'LOCKED' });
    try {
      const service = new AuthService();
      const before = Date.now();
      const message = await service.requestPasswordReset(
        `  ${fixture.email.toUpperCase()} `,
        fixture.request('request'),
      );
      expect(message?.to).toBe(fixture.email);
      expect(message?.text).toContain(`${getConfig().APP_URL}/reset-password/`);
      const token = tokenFrom(message);

      const [stored] = await fixture.tokens();
      expect(Buffer.from(stored?.tokenHash ?? []).equals(hashSessionToken(token))).toBe(true);
      expect(stored?.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 30 * 60 * 1000 - 1000);
      expect(stored?.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 30 * 60 * 1000);

      const events = await fixture.events('PASSWORD_RESET_REQUESTED');
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        userId: fixture.userId,
        agencyId: null,
        userAgent: USER_AGENT,
        details: { outcome: 'SENT' },
      });
      expect(Buffer.from(events[0]?.emailHash ?? []).equals(Buffer.from(fixture.emailHash))).toBe(
        true,
      );
      expectNoSecrets(events, [token, fixture.email]);
    } finally {
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)(
  'answers an unknown email and a User without a password the same, sending nothing',
  async () => {
    const fixture = await resetFixture({ withPassword: false });
    try {
      const service = new AuthService();
      await expect(
        service.requestPasswordReset(fixture.email, fixture.request('no-password')),
      ).resolves.toBeNull();
      const unknown = `nobody-${randomUUID()}@example.test`;
      await expect(
        service.requestPasswordReset(unknown, fixture.request('unknown')),
      ).resolves.toBeNull();

      expect(await fixture.tokens()).toEqual([]);
      const events = await fixture.admin.securityEvent.findMany({
        where: {
          eventType: 'PASSWORD_RESET_REQUESTED',
          ipAddress: fixture.request().ipAddress,
        },
        orderBy: { occurredAt: 'asc' },
      });
      expect(events.map(({ userId, details }) => ({ userId, details }))).toEqual([
        { userId: fixture.userId, details: { outcome: 'NO_PASSWORD' } },
        { userId: null, details: { outcome: 'UNKNOWN_EMAIL' } },
      ]);
      expectNoSecrets(events, [fixture.email, unknown]);
    } finally {
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)(
  'sends at most 3 links per email an hour, then answers the same without sending',
  async () => {
    const fixture = await resetFixture();
    try {
      const service = new AuthService();
      for (let index = 0; index < 3; index += 1) await requestLink(service, fixture);
      await expect(
        service.requestPasswordReset(fixture.email, fixture.request('fourth')),
      ).resolves.toBeNull();

      expect(await fixture.tokens()).toHaveLength(3);
      const events = await fixture.events('PASSWORD_RESET_REQUESTED');
      expect(events.map(({ details }) => details)).toEqual([
        { outcome: 'SENT' },
        { outcome: 'SENT' },
        { outcome: 'SENT' },
        { outcome: 'EMAIL_RATE_LIMITED' },
      ]);
    } finally {
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)('refuses an IP address after 20 requests in an hour', async () => {
  const fixture = await resetFixture();
  try {
    const { ipAddress } = fixture.request();
    await fixture.admin.securityEvent.createMany({
      data: Array.from({ length: 20 }, () => ({
        eventType: 'PASSWORD_RESET_REQUESTED',
        requestId: `password-reset-seed-${randomUUID()}`,
        ipAddress,
        details: { outcome: 'UNKNOWN_EMAIL' },
      })),
    });
    const service = new AuthService();
    await expect(
      service.requestPasswordReset(fixture.email, fixture.request('limited')),
    ).rejects.toMatchObject({ statusCode: 429, code: 'IP_RATE_LIMITED' });

    expect(await fixture.tokens()).toEqual([]);
    const [limited] = (await fixture.events('PASSWORD_RESET_REQUESTED')).filter(
      ({ details }) => (details as { outcome?: string }).outcome === 'IP_RATE_LIMITED',
    );
    expect(limited).toMatchObject({ ipAddress });
  } finally {
    await fixture.cleanup();
  }
});

it.skipIf(!enabled)(
  'refuses a reset from an IP address with 100 sign-in or reset failures in 15 minutes',
  async () => {
    const fixture = await resetFixture();
    const { admin, userId } = fixture;
    try {
      const { ipAddress } = fixture.request();
      await admin.securityEvent.createMany({
        data: Array.from({ length: 99 }, () => ({
          eventType: 'PASSWORD_RESET_FAILURE',
          requestId: `password-reset-seed-${randomUUID()}`,
          ipAddress,
          details: { reason: 'TOKEN_UNKNOWN' },
        })),
      });
      const service = new AuthService();
      // With 99 failures in the window, a reset still goes through.
      await service.completePasswordReset(
        await requestLink(service, fixture),
        { password: NEW_PASSWORD },
        fixture.request('under-limit'),
      );
      // The 100th failure still reaches the link.
      await expect(
        service.completePasswordReset(
          randomBytes(32).toString('base64url'),
          { password: NEW_PASSWORD },
          fixture.request('unknown'),
        ),
      ).rejects.toMatchObject({ code: 'RESET_LINK_INVALID' });

      const token = await requestLink(service, fixture);
      await expect(
        service.completePasswordReset(
          token,
          { password: LATER_PASSWORD },
          fixture.request('refused'),
        ),
      ).rejects.toMatchObject({ statusCode: 429, code: 'IP_RATE_LIMITED' });
      // Reset failures count toward sign-in's limit too.
      await expect(service.assertIpAllowed(fixture.request('sign-in'))).rejects.toMatchObject({
        statusCode: 429,
        code: 'IP_RATE_LIMITED',
      });

      const [, refusedLink] = await fixture.tokens();
      expect(refusedLink?.consumedAt).toBeNull();
      const password = await admin.userPassword.findUniqueOrThrow({ where: { userId } });
      await expect(verifyPassword(password.passwordHash, NEW_PASSWORD)).resolves.toBe(true);
      const refusals = await admin.securityEvent.findMany({
        where: { ipAddress, details: { equals: { reason: 'IP_RATE_LIMITED' } } },
        orderBy: { occurredAt: 'asc' },
      });
      expect(refusals.map(({ eventType, userId }) => ({ eventType, userId }))).toEqual([
        { eventType: 'PASSWORD_RESET_FAILURE', userId: null },
        { eventType: 'LOGIN_FAILURE', userId: null },
      ]);
    } finally {
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)(
  'answers a known and an unknown email no sooner than the response floor',
  async () => {
    const fixture = await resetFixture();
    try {
      const service = new AuthService();
      for (const email of [fixture.email, `nobody-${randomUUID()}@example.test`]) {
        const started = performance.now();
        await service.requestPasswordReset(email, fixture.request('timed'));
        expect(performance.now() - started).toBeGreaterThanOrEqual(
          PASSWORD_RESET_RESPONSE_FLOOR_MS - 1,
        );
      }
      const events = await fixture.events('PASSWORD_RESET_REQUESTED');
      expect(events.map(({ details }) => details)).toEqual([
        { outcome: 'SENT' },
        { outcome: 'UNKNOWN_EMAIL' },
      ]);
    } finally {
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)('accepts a request during a Sign-in Cool-down', async () => {
  const fixture = await resetFixture();
  try {
    await fixture.admin.signInThrottle.create({
      data: {
        emailHash: fixture.emailHash,
        failureCount: 5,
        cooldownLevel: 1,
        cooldownUntil: new Date(Date.now() + 10 * 60 * 1000),
        lastFailureAt: new Date(),
      },
    });
    await expect(requestLink(new AuthService(), fixture)).resolves.toHaveLength(43);
  } finally {
    await fixture.cleanup();
  }
});

it.skipIf(!enabled)('opens a link without writing anything', async () => {
  const fixture = await resetFixture({ withTotp: true });
  try {
    const service = new AuthService();
    const token = await requestLink(service, fixture);
    const [stored] = await fixture.tokens();
    const lookup = { status: 'VALID', email: fixture.email, secondFactor: true };
    await expect(service.lookupPasswordReset(token)).resolves.toMatchObject(lookup);
    await expect(service.lookupPasswordReset(token)).resolves.toMatchObject(lookup);
    await expect(
      service.lookupPasswordReset(randomBytes(32).toString('base64url')),
    ).resolves.toEqual({ status: 'INVALID' });
    expect(await fixture.tokens()).toEqual([stored]);
    expect(await fixture.events('PASSWORD_RESET_FAILURE')).toEqual([]);
  } finally {
    await fixture.cleanup();
  }
});

it.skipIf(!enabled)(
  'resets a password with the link alone when the User has no factor, ending every session',
  async () => {
    const fixture = await resetFixture({ globalStatus: 'LOCKED' });
    const { admin, userId } = fixture;
    try {
      const service = new AuthService();
      const token = await requestLink(service, fixture);
      await admin.signInThrottle.create({
        data: {
          emailHash: fixture.emailHash,
          failureCount: 3,
          cooldownLevel: 1,
          cooldownUntil: new Date(Date.now() - 60_000),
          lastFailureAt: new Date(),
        },
      });
      await admin.pendingAuthentication.create({
        data: {
          tokenHash: databaseBytes(hashSessionToken(randomBytes(32).toString('base64url'))),
          purpose: 'SIGN_IN',
          userId,
          stage: 'TOTP',
          verifiedMethods: ['pwd'],
          expiresAt: new Date(Date.now() + 60_000),
        },
      });

      const result = await service.completePasswordReset(
        token,
        { password: NEW_PASSWORD },
        fixture.request('complete'),
      );

      const password = await admin.userPassword.findUniqueOrThrow({ where: { userId } });
      await expect(verifyPassword(password.passwordHash, NEW_PASSWORD)).resolves.toBe(true);
      expect(password).toMatchObject({ secondFactorFailures: 0, resetRequiredAt: null });
      const [stored] = await fixture.tokens();
      expect(stored?.consumedAt).not.toBeNull();
      expect(stored?.supersededAt).toBeNull();
      const sessions = await admin.userSession.findMany({ where: { userId } });
      expect(sessions).toHaveLength(2);
      for (const session of sessions) {
        expect(session).toMatchObject({ revocationReason: 'PASSWORD_RESET' });
        expect(session.revokedAt).not.toBeNull();
      }
      expect(await admin.pendingAuthentication.findMany({ where: { userId } })).toEqual([]);
      expect(
        await admin.signInThrottle.findUnique({ where: { emailHash: fixture.emailHash } }),
      ).toBeNull();
      // Neither the status nor the memberships change, and no session is opened.
      await expect(admin.user.findUniqueOrThrow({ where: { id: userId } })).resolves.toMatchObject({
        globalStatus: 'LOCKED',
      });
      expect(await admin.agencyMembership.findMany({ where: { userId } })).toMatchObject([
        { status: 'ACTIVE' },
      ]);

      const [completed] = await fixture.events('PASSWORD_RESET_COMPLETED');
      expect(completed).toMatchObject({
        userId,
        agencyId: null,
        userAgent: USER_AGENT,
        details: { methods: ['email_link'], revokedSessions: 2 },
      });
      expectNoSecrets(await fixture.events('PASSWORD_RESET_COMPLETED'), [
        token,
        NEW_PASSWORD,
        fixture.email,
      ]);

      expect(result.notices).toHaveLength(1);
      const [notice] = result.notices;
      expect(notice).toMatchObject({ to: fixture.email });
      expect(notice?.text).toContain('password was reset');
      expect(notice?.text).not.toMatch(/https?:/);
      expect(notice?.text).not.toContain(token);

      await expect(
        service.completePasswordReset(token, { password: NEW_PASSWORD }, fixture.request('again')),
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'RESET_LINK_INVALID',
        message: INVALID_LINK,
      });
      expect(
        (await fixture.events('PASSWORD_RESET_FAILURE')).map(({ userId, details }) => ({
          userId,
          details,
        })),
      ).toEqual([{ userId, details: { reason: 'TOKEN_USED' } }]);
    } finally {
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)(
  'refuses an unknown, expired, or superseded link with the same message and its reason',
  async () => {
    const fixture = await resetFixture();
    const { admin, userId } = fixture;
    try {
      const service = new AuthService();
      const superseded = await requestLink(service, fixture);
      const current = await requestLink(service, fixture);
      const expired = randomBytes(32).toString('base64url');
      await admin.passwordResetToken.updateMany({
        where: { userId, consumedAt: null, supersededAt: null },
        data: { supersededAt: new Date() },
      });
      await admin.passwordResetToken.create({
        data: {
          userId,
          tokenHash: databaseBytes(hashSessionToken(expired)),
          createdAt: new Date(Date.now() - 40 * 60 * 1000),
          expiresAt: new Date(Date.now() - 10 * 60 * 1000),
        },
      });

      for (const token of [randomBytes(32).toString('base64url'), expired, superseded]) {
        await expect(
          service.completePasswordReset(token, { password: NEW_PASSWORD }, fixture.request()),
        ).rejects.toMatchObject({
          statusCode: 400,
          code: 'RESET_LINK_INVALID',
          message: INVALID_LINK,
        });
      }
      const failures = await admin.securityEvent.findMany({
        where: { eventType: 'PASSWORD_RESET_FAILURE', ipAddress: fixture.request().ipAddress },
        orderBy: { occurredAt: 'asc' },
      });
      expect(failures.map(({ userId, details }) => ({ userId, details }))).toEqual([
        { userId: null, details: { reason: 'TOKEN_UNKNOWN' } },
        { userId, details: { reason: 'TOKEN_EXPIRED' } },
        { userId, details: { reason: 'TOKEN_SUPERSEDED' } },
      ]);
      expectNoSecrets(failures, [superseded, current, expired, fixture.email]);
      await expect(service.lookupPasswordReset(current)).resolves.toEqual({ status: 'INVALID' });
    } finally {
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)('voids an outstanding link when the password changes', async () => {
  const fixture = await resetFixture();
  try {
    const service = new AuthService();
    const token = await requestLink(service, fixture);
    await fixture.admin.userPassword.update({
      where: { userId: fixture.userId },
      data: {
        passwordHash: await hashPassword('changed elsewhere passphrase'),
        changedAt: new Date(),
      },
    });
    await expect(
      service.completePasswordReset(token, { password: NEW_PASSWORD }, fixture.request()),
    ).rejects.toMatchObject({ code: 'RESET_LINK_INVALID' });
    expect((await fixture.events('PASSWORD_RESET_FAILURE'))[0]?.details).toEqual({
      reason: 'TOKEN_SUPERSEDED',
    });
  } finally {
    await fixture.cleanup();
  }
});

it.skipIf(!enabled)('names a broken password rule and keeps the link usable', async () => {
  const fixture = await resetFixture();
  try {
    const service = new AuthService();
    const token = await requestLink(service, fixture);
    await expect(
      service.completePasswordReset(token, { password: 'short' }, fixture.request()),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'PASSWORD_REJECTED',
      message: expect.stringContaining('15'),
    });
    expect(await fixture.events('PASSWORD_RESET_FAILURE')).toEqual([]);
    const [stored] = await fixture.tokens();
    expect(stored).toMatchObject({ consumedAt: null, supersededAt: null });
    await expect(
      service.completePasswordReset(token, { password: NEW_PASSWORD }, fixture.request()),
    ).resolves.toBeDefined();
  } finally {
    await fixture.cleanup();
  }
});

/** The password row, link, sessions, and events a refused reset must leave as they were. */
async function resetState(fixture: Fixture) {
  const { admin, userId } = fixture;
  return {
    password: await admin.userPassword.findUniqueOrThrow({ where: { userId } }),
    tokens: await fixture.tokens(),
    sessions: await admin.userSession.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    completed: await fixture.events('PASSWORD_RESET_COMPLETED'),
    revoked: await fixture.events('SESSION_REVOKED'),
  };
}

it.skipIf(!enabled)(
  'refuses the current password, keeping the link, the reset-required state, and sessions',
  async () => {
    const fixture = await resetFixture();
    try {
      const service = new AuthService();
      const token = await requestLink(service, fixture);
      const before = await resetState(fixture);

      await expect(
        service.completePasswordReset(
          token,
          { password: fixture.password },
          fixture.request('same'),
        ),
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'PASSWORD_REJECTED',
        message: SAME_PASSWORD,
      });
      expect(await resetState(fixture)).toEqual(before);
      expect(before.password.resetRequiredAt).not.toBeNull();

      const result = await service.completePasswordReset(
        token,
        { password: NEW_PASSWORD },
        fixture.request('new'),
      );
      expect(result.notices).toHaveLength(1);
      const after = await resetState(fixture);
      expect(after.password.resetRequiredAt).toBeNull();
      expect(after.tokens[0]?.consumedAt).not.toBeNull();
      expect(after.sessions.every(({ revokedAt }) => revokedAt !== null)).toBe(true);
    } finally {
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)(
  'refuses the current password disabled by the second-factor ceiling, after the code checks',
  async () => {
    const fixture = await resetFixture({
      withTotp: true,
      recoveryCodes: 2,
      secondFactorFailures: 10,
    });
    const { admin, userId } = fixture;
    try {
      const service = new AuthService();
      const token = await requestLink(service, fixture);
      const before = await resetState(fixture);

      await expect(
        service.completePasswordReset(
          token,
          { password: fixture.password, code: totpCode(fixture.totpSecret ?? '', new Date()) },
          fixture.request('totp'),
        ),
      ).rejects.toMatchObject({ code: 'PASSWORD_REJECTED', message: SAME_PASSWORD });
      await expect(
        service.completePasswordReset(
          token,
          { password: fixture.password, recoveryCode: fixture.recoveryCodes[0] ?? '' },
          fixture.request('recovery'),
        ),
      ).rejects.toMatchObject({ code: 'PASSWORD_REJECTED', message: SAME_PASSWORD });
      expect(await resetState(fixture)).toEqual(before);
      expect(before.password).toMatchObject({ secondFactorFailures: 10 });
      expect(await admin.userRecoveryCode.count({ where: { userId } })).toBe(2);
      // A wrong code still answers as one, so the refusal never confirms the current password.
      await expect(
        service.completePasswordReset(
          token,
          { password: fixture.password, recoveryCode: 'aaaaa-bbbbb' },
          fixture.request('wrong'),
        ),
      ).rejects.toMatchObject({ code: 'INVALID_CODE' });

      await service.completePasswordReset(
        token,
        { password: NEW_PASSWORD, recoveryCode: fixture.recoveryCodes[0] ?? '' },
        fixture.request('new'),
      );
      await expect(
        admin.userPassword.findUniqueOrThrow({ where: { userId } }),
      ).resolves.toMatchObject({ secondFactorFailures: 0, resetRequiredAt: null });
    } finally {
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)(
  'answers a Recovery Code spent after it matched as wrong, even for the current password',
  async () => {
    const fixture = await resetFixture({ withTotp: true, recoveryCodes: 1 });
    const { admin, userId } = fixture;
    try {
      const service = new AuthService();
      const token = await requestLink(service, fixture);
      // Spends the code on the link's second opening, after it matched.
      const links = service as unknown as { openResetLink: (...args: unknown[]) => unknown };
      const open = links.openResetLink.bind(service);
      let opened = 0;
      vi.spyOn(links, 'openResetLink').mockImplementation(async (...args) => {
        opened += 1;
        if (opened === 2) await admin.userRecoveryCode.deleteMany({ where: { userId } });
        return open(...args);
      });

      await expect(
        service.completePasswordReset(
          token,
          { password: fixture.password, recoveryCode: fixture.recoveryCodes[0] ?? '' },
          fixture.request('spent'),
        ),
      ).rejects.toMatchObject({ code: 'INVALID_CODE' });
      expect(opened).toBe(2);
    } finally {
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)(
  'counts a wrong TOTP code toward the cool-down but not the second-factor ceiling',
  async () => {
    const fixture = await resetFixture({ withTotp: true });
    const { admin, userId } = fixture;
    try {
      const service = new AuthService();
      const token = await requestLink(service, fixture);
      await expect(
        service.completePasswordReset(token, { password: NEW_PASSWORD }, fixture.request()),
      ).rejects.toMatchObject({ statusCode: 400, code: 'CODE_REQUIRED' });
      const right = totpCode(fixture.totpSecret ?? '', new Date());
      const wrong = right === '000000' ? '111111' : '000000';
      await expect(
        service.completePasswordReset(
          token,
          { password: NEW_PASSWORD, code: wrong },
          fixture.request('wrong'),
        ),
      ).rejects.toMatchObject({ statusCode: 401, code: 'INVALID_CODE' });

      await expect(
        admin.userPassword.findUniqueOrThrow({ where: { userId } }),
      ).resolves.toMatchObject({
        secondFactorFailures: 4,
      });
      await expect(
        admin.signInThrottle.findUniqueOrThrow({ where: { emailHash: fixture.emailHash } }),
      ).resolves.toMatchObject({ failureCount: 1 });
      expect(
        (await fixture.events('PASSWORD_RESET_FAILURE')).map(({ details }) => details),
      ).toEqual([{ reason: 'SECOND_FACTOR_INVALID' }]);
      expect(await fixture.tokens()).toMatchObject([{ consumedAt: null, supersededAt: null }]);

      await service.completePasswordReset(
        token,
        { password: NEW_PASSWORD, code: right },
        fixture.request('right'),
      );
      expect((await fixture.events('PASSWORD_RESET_COMPLETED'))[0]?.details).toEqual({
        methods: ['email_link', 'totp'],
        revokedSessions: 2,
      });
      expectNoSecrets(await fixture.events('PASSWORD_RESET_FAILURE'), [wrong, token]);
    } finally {
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)('spends a Recovery Code and sends its notice too', async () => {
  const fixture = await resetFixture({ withTotp: true, recoveryCodes: 2 });
  const { admin, userId } = fixture;
  try {
    const service = new AuthService();
    const token = await requestLink(service, fixture);
    await expect(
      service.completePasswordReset(
        token,
        { password: NEW_PASSWORD, recoveryCode: 'aaaaa-bbbbb' },
        fixture.request('wrong'),
      ),
    ).rejects.toMatchObject({ statusCode: 401, code: 'INVALID_CODE' });
    expect((await fixture.events('PASSWORD_RESET_FAILURE')).map(({ details }) => details)).toEqual([
      { reason: 'RECOVERY_CODE_INVALID' },
    ]);

    const result = await service.completePasswordReset(
      token,
      { password: NEW_PASSWORD, recoveryCode: fixture.recoveryCodes[0] ?? '' },
      fixture.request('right'),
    );
    expect(await admin.userRecoveryCode.count({ where: { userId } })).toBe(1);
    expect((await fixture.events('PASSWORD_RESET_COMPLETED'))[0]?.details).toEqual({
      methods: ['email_link', 'recovery_code'],
      revokedSessions: 2,
    });
    expect(result.notices.map(({ subject }) => subject)).toEqual([
      expect.stringContaining('password was reset'),
      expect.stringContaining('Recovery Code'),
    ]);
    expect(result.notices[1]?.text).toContain('1 Recovery Code left');
  } finally {
    await fixture.cleanup();
  }
});

it.skipIf(!enabled)(
  'refuses a reset during a Sign-in Cool-down with the minutes left',
  async () => {
    const fixture = await resetFixture({ withTotp: true });
    try {
      const service = new AuthService();
      const token = await requestLink(service, fixture);
      await fixture.admin.signInThrottle.create({
        data: {
          emailHash: fixture.emailHash,
          failureCount: 5,
          cooldownLevel: 1,
          cooldownUntil: new Date(Date.now() + 10 * 60 * 1000),
          lastFailureAt: new Date(),
        },
      });
      await expect(
        service.completePasswordReset(
          token,
          { password: NEW_PASSWORD, code: totpCode(fixture.totpSecret ?? '', new Date()) },
          fixture.request(),
        ),
      ).rejects.toMatchObject({
        statusCode: 429,
        code: 'SIGN_IN_COOLDOWN',
        message: expect.stringContaining('10 minutes'),
      });
      expect(
        (await fixture.events('PASSWORD_RESET_FAILURE')).map(({ details }) => details),
      ).toEqual([{ reason: 'COOLDOWN_ACTIVE' }]);
      expect(await fixture.tokens()).toMatchObject([{ consumedAt: null }]);
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

/** Just enough of an Express response for the reset endpoints; `close` fires on `finish()`. */
function fakeResponse() {
  const events = new EventEmitter();
  const response = {
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

function endpointRequest(ipAddress: string, userAgent?: string) {
  const headers: Record<string, string | undefined> = { 'user-agent': userAgent };
  return {
    headers: {},
    header: (name: string) =>
      name === 'x-request-id' ? `password-reset-endpoint-${randomUUID()}` : headers[name],
    ip: ipAddress,
  } as unknown as Request;
}

it.skipIf(!enabled)(
  'answers every request the same and sends the link only after the response',
  async () => {
    const fixture = await resetFixture();
    const { ipAddress } = fixture.request();
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const mail = new RecordingMailDelivery();
      const controller = new AuthController(new AuthService(mail));
      const answers = [];
      for (const email of [fixture.email, `nobody-${randomUUID()}@example.test`]) {
        const response = fakeResponse();
        const sent = mail.messages.length;
        await controller.requestPasswordReset(
          { email },
          endpointRequest(ipAddress),
          response as unknown as Response,
        );
        expect(mail.messages).toHaveLength(sent);
        response.finish();
        answers.push({ status: response.status.mock.calls, json: response.json.mock.calls });
      }
      expect(answers[0]).toEqual(answers[1]);
      await vi.waitFor(() => expect(mail.messages).toHaveLength(1));
      const token = tokenFrom(mail.messages[0] ?? null);

      const failing = new AuthController(
        new AuthService({
          send: () => Promise.reject(new Error(`smtp down for ${fixture.email}`)),
        }),
      );
      const response = fakeResponse();
      await failing.requestPasswordReset(
        { email: fixture.email },
        endpointRequest(ipAddress),
        response as unknown as Response,
      );
      response.finish();
      await vi.waitFor(() => expect(warn).toHaveBeenCalled());
      const logged = JSON.stringify(warn.mock.calls);
      expect(logged).not.toContain(fixture.email);
      const [, latest] = await fixture.tokens();
      expect(latest).toBeDefined();
      expect(logged).not.toContain(token);
    } finally {
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)('records the request user agent cut to 512 characters', async () => {
  const fixture = await resetFixture();
  const { ipAddress } = fixture.request();
  try {
    const controller = new AuthController(new AuthService(new RecordingMailDelivery()));
    const userAgent = `Mozilla/5.0 ${'x'.repeat(600)}`;
    await controller.requestPasswordReset(
      { email: fixture.email },
      endpointRequest(ipAddress, userAgent),
      fakeResponse() as unknown as Response,
    );
    await controller.requestPasswordReset(
      { email: fixture.email },
      endpointRequest(ipAddress),
      fakeResponse() as unknown as Response,
    );

    const events = await fixture.events('PASSWORD_RESET_REQUESTED');
    expect(events.map((event) => event.userAgent)).toEqual([userAgent.slice(0, 512), null]);
  } finally {
    await fixture.cleanup();
  }
});
