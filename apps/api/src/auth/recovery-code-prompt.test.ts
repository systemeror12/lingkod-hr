import { randomBytes, randomInt, randomUUID } from 'node:crypto';
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
} from '@lingkod-hr/auth';
import { getConfig, parseProtectedValueKey } from '@lingkod-hr/config';
import { expect, it, vi } from 'vitest';
import { AuthController } from './auth.controller';
import { AuthService, PENDING_AUTHENTICATION_COOKIE } from './auth.service';

const enabled = process.env.DATABASE_E2E === 'true';
const NEW_PASSWORD = 'tahimik na umaga sa bundok 42';

function databaseBytes(value: Buffer): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(value.byteLength));
  bytes.set(value);
  return bytes;
}

/**
 * A User with a password, a TOTP factor, three Recovery Codes, and an Agency Membership, plus a
 * PENDING invitation to a second Agency. Each fixture has its own IP address, so the per-IP limit
 * of one test can't refuse another's requests.
 */
async function promptFixture() {
  const admin = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_E2E_ADMIN_URL ?? '' } },
  });
  const suffix = `${Date.now()}-${randomBytes(4).toString('hex')}`;
  const email = `codes-prompt-${suffix}@example.test`;
  const password = `old passphrase ${suffix}`;
  const ipAddress = `198.18.${randomInt(0, 255)}.${randomInt(1, 255)}`;
  const [agency, invitingAgency] = await Promise.all(
    ['HOME', 'INVITING'].map((label) =>
      admin.agency.create({
        data: {
          code: `CODES-PROMPT-${label}-${suffix}`,
          name: 'Codes Prompt Agency',
          agencyType: 'NGA',
          status: 'ACTIVE',
        },
      }),
    ),
  );
  if (!agency || !invitingAgency) throw new Error('The Agencies were not created.');
  const user = await admin.user.create({
    data: { emailNormalized: email, displayName: 'Prompt User', globalStatus: 'ACTIVE' },
  });
  await admin.agencyMembership.create({
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
  const recoveryCodes = generateRecoveryCodes().slice(0, 3);
  for (const code of recoveryCodes) {
    await admin.userRecoveryCode.create({
      data: { userId: user.id, codeHash: await hashPassword(normalizeRecoveryCode(code) ?? '') },
    });
  }
  const inviter = await admin.user.create({
    data: {
      emailNormalized: `codes-prompt-inviter-${suffix}@example.test`,
      displayName: 'Inviter',
      globalStatus: 'ACTIVE',
    },
  });
  const inviterMembership = await admin.agencyMembership.create({
    data: { agencyId: invitingAgency.id, userId: inviter.id, status: 'ACTIVE' },
  });
  const invitationToken = randomBytes(32).toString('base64url');
  await admin.invitation.create({
    data: {
      agencyId: invitingAgency.id,
      emailNormalized: email,
      invitedByMembershipId: inviterMembership.id,
      tokenHash: databaseBytes(hashSessionToken(invitationToken)),
      requestedRoleCodes: ['employee'],
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      status: 'PENDING',
    },
  });
  const emailHash = databaseBytes(hashEmail(email, getConfig().BLIND_INDEX_KEY));
  const request = (label: string) => ({
    requestId: `codes-prompt-${label}-${randomUUID()}`,
    ipAddress,
    userAgent: null,
  });
  return {
    admin,
    email,
    password,
    recoveryCodes,
    invitationToken,
    ipAddress,
    request,
    /** A code for the next TOTP step; the test clears the last accepted step so it can't replay. */
    totp: async () => {
      await admin.userTotpFactor.update({
        where: { userId: user.id },
        data: { lastAcceptedStep: 0 },
      });
      return totpCode(totpSecret);
    },
    owedAt: async () =>
      (await admin.userPassword.findUniqueOrThrow({ where: { userId: user.id } }))
        .recoveryCodePromptOwedAt,
    /** Resets the password through an emailed link, proved with `proof`. */
    reset: async (service: AuthService, proof: { code: string } | { recoveryCode: string }) => {
      const mail = await service.requestPasswordReset(email, request('reset-request'));
      const token = /\/reset-password\/([A-Za-z0-9_-]{43})/.exec(mail?.text ?? '')?.[1] ?? '';
      await service.completePasswordReset(
        token,
        { password: NEW_PASSWORD, ...proof },
        request('reset'),
      );
    },
    /** Signs in with the new password, answering the pending sign-in token. */
    startSignIn: async (service: AuthService) => {
      const started = await service.signInWithPassword(
        email,
        NEW_PASSWORD,
        null,
        request('sign-in'),
      );
      if (started.status !== 'TOTP_REQUIRED') throw new Error('Expected a TOTP challenge.');
      return started.pendingToken;
    },
    cleanup: async () => {
      const userIds = [user.id, inviter.id];
      const agencyIds = [agency.id, invitingAgency.id];
      await admin.signInThrottle.deleteMany({ where: { emailHash } });
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.securityEvent.deleteMany({
          where: {
            OR: [
              { agencyId: { in: agencyIds } },
              { userId: { in: userIds } },
              { emailHash },
              { ipAddress },
            ],
          },
        });
        await transaction.auditEvent.deleteMany({ where: { agencyId: { in: agencyIds } } });
      });
      await admin.userSession.deleteMany({ where: { userId: { in: userIds } } });
      await admin.membershipRole.deleteMany({ where: { agencyId: { in: agencyIds } } });
      await admin.invitation.deleteMany({ where: { agencyId: { in: agencyIds } } });
      await admin.agencyMembership.deleteMany({ where: { userId: { in: userIds } } });
      await admin.user.deleteMany({ where: { id: { in: userIds } } });
      await admin.role.deleteMany({ where: { agencyId: { in: agencyIds } } });
      await admin.agency.deleteMany({ where: { id: { in: agencyIds } } });
      await admin.$disconnect();
    },
  };
}

/** Just enough of an Express request and response for the TOTP sign-in endpoint. */
function totpEndpoint(pendingToken: string, ipAddress: string) {
  const request = {
    headers: { cookie: `${PENDING_AUTHENTICATION_COOKIE}=${pendingToken}` },
    header: (name: string) =>
      name === 'x-request-id' ? `codes-prompt-endpoint-${randomUUID()}` : undefined,
    ip: ipAddress,
  } as unknown as Request;
  const response = {
    status: vi.fn(() => response),
    json: vi.fn(() => response),
    cookie: vi.fn(() => response),
    clearCookie: vi.fn(() => response),
  };
  return { request, response };
}

it.skipIf(!enabled)(
  'owes the prompt after a reset with a Recovery Code, and shows it at one sign-in only',
  async () => {
    const fixture = await promptFixture();
    try {
      const service = new AuthService();
      await fixture.reset(service, { recoveryCode: fixture.recoveryCodes[0] ?? '' });
      expect(await fixture.owedAt()).toBeInstanceOf(Date);

      const controller = new AuthController(service);
      const { request, response } = totpEndpoint(
        await fixture.startSignIn(service),
        fixture.ipAddress,
      );
      await controller.signInWithTotp(
        { code: await fixture.totp() },
        request,
        response as unknown as Response,
      );
      expect(response.json).toHaveBeenCalledWith({
        status: 'SIGNED_IN',
        recoveryCodesRemaining: 2,
      });
      expect(await fixture.owedAt()).toBeNull();

      const again = await service.completeTotpSignIn(
        await fixture.startSignIn(service),
        await fixture.totp(),
        fixture.request('second-sign-in'),
      );
      expect(again.recoveryCodesRemaining).toBeNull();
    } finally {
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)(
  'gives one count when the sign-in after the reset itself uses a Recovery Code',
  async () => {
    const fixture = await promptFixture();
    try {
      const service = new AuthService();
      await fixture.reset(service, { recoveryCode: fixture.recoveryCodes[0] ?? '' });
      const signedIn = await service.completeRecoveryCodeSignIn(
        await fixture.startSignIn(service),
        fixture.recoveryCodes[1] ?? '',
        fixture.request('recovery-sign-in'),
      );
      expect(signedIn.recoveryCodesRemaining).toBe(1);
      expect(await fixture.owedAt()).toBeNull();

      const again = await service.completeTotpSignIn(
        await fixture.startSignIn(service),
        await fixture.totp(),
        fixture.request('second-sign-in'),
      );
      expect(again.recoveryCodesRemaining).toBeNull();
    } finally {
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)('owes no prompt after a reset with TOTP', async () => {
  const fixture = await promptFixture();
  try {
    const service = new AuthService();
    await fixture.reset(service, { code: await fixture.totp() });
    expect(await fixture.owedAt()).toBeNull();

    const signedIn = await service.completeTotpSignIn(
      await fixture.startSignIn(service),
      await fixture.totp(),
      fixture.request('sign-in'),
    );
    expect(signedIn.recoveryCodesRemaining).toBeNull();
  } finally {
    await fixture.cleanup();
  }
});

it.skipIf(!enabled)(
  'answers the count after an existing User activates with a Recovery Code',
  async () => {
    const fixture = await promptFixture();
    try {
      const service = new AuthService();
      const started = await service.startActivation(
        fixture.invitationToken,
        { password: fixture.password },
        fixture.request('activation-start'),
      );
      if (started.status !== 'CODE_REQUIRED') throw new Error('Expected a code challenge.');
      const done = await service.completeActivationWithRecoveryCode(
        fixture.invitationToken,
        started.pendingToken,
        fixture.recoveryCodes[0] ?? '',
        fixture.request('activation'),
      );
      expect(done.recoveryCodesRemaining).toBe(2);
      // Activation signs in at once, so it owes nothing later.
      expect(await fixture.owedAt()).toBeNull();
    } finally {
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)('answers no count after an existing User activates with TOTP', async () => {
  const fixture = await promptFixture();
  try {
    const service = new AuthService();
    const started = await service.startActivation(
      fixture.invitationToken,
      { password: fixture.password },
      fixture.request('activation-start'),
    );
    if (started.status !== 'CODE_REQUIRED') throw new Error('Expected a code challenge.');
    const done = await service.completeActivationWithTotp(
      fixture.invitationToken,
      started.pendingToken,
      await fixture.totp(),
      fixture.request('activation'),
    );
    expect(done.recoveryCodesRemaining).toBeNull();
    expect(await fixture.owedAt()).toBeNull();
  } finally {
    await fixture.cleanup();
  }
});
