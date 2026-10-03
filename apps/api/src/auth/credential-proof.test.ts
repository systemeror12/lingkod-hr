import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { generateTotpSecret, hashEmail, sealTotpSecret, totpCode } from '@lingkod-hr/auth';
import { getConfig, parseProtectedValueKey } from '@lingkod-hr/config';
import { expect, it, vi } from 'vitest';
import { AuthServiceError } from './auth-error';
import { CredentialProof, type TotpAttempt } from './credential-proof';

const enabled = process.env.DATABASE_E2E === 'true';

function databaseBytes(value: Buffer): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(value.byteLength));
  bytes.set(value);
  return bytes;
}

/** A User with a password and a TOTP factor, and a TOTP attempt for them that asks nothing more. */
async function proofFixture(options: { secondFactorFailures?: number } = {}) {
  const admin = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_E2E_ADMIN_URL ?? '' } },
  });
  const email = `credential-proof-${Date.now()}-${randomBytes(4).toString('hex')}@example.test`;
  const emailHash = hashEmail(email, getConfig().BLIND_INDEX_KEY);
  const key = parseProtectedValueKey(getConfig().DATA_ENCRYPTION_KEY);
  const user = await admin.user.create({
    data: { emailNormalized: email, displayName: 'Proof User', globalStatus: 'ACTIVE' },
  });
  await admin.userPassword.create({
    data: {
      userId: user.id,
      passwordHash: 'not checked here',
      secondFactorFailures: options.secondFactorFailures ?? 0,
    },
  });
  const secret = generateTotpSecret();
  const factorId = randomUUID();
  await admin.userTotpFactor.create({
    data: {
      id: factorId,
      userId: user.id,
      secretEnvelope: databaseBytes(sealTotpSecret(secret, key, { userId: user.id, factorId })),
    },
  });
  const right = totpCode(secret, new Date());
  return {
    admin,
    userId: user.id,
    proof: new CredentialProof(key),
    right,
    wrong: right === '000000' ? '000001' : '000000',
    attempt: <T>(code: string, onProved: () => Promise<T>): TotpAttempt<T> => ({
      scope: { userId: user.id, capabilities: ['platform-security'] },
      user: { id: user.id, email, emailHash },
      code,
      request: { requestId: `credential-proof-${randomUUID()}`, ipAddress: null, userAgent: null },
      wrongCode: () => new AuthServiceError('The code is incorrect.', 401, 'INVALID_CODE'),
      noFactor: async () => new AuthServiceError('No factor.', 401, 'NO_FACTOR'),
      onProved,
    }),
    password: () => admin.userPassword.findUniqueOrThrow({ where: { userId: user.id } }),
    events: (eventType: string) =>
      admin.securityEvent.findMany({
        where: { eventType, OR: [{ userId: user.id }, { emailHash: databaseBytes(emailHash) }] },
        select: { details: true },
      }),
    cleanup: async () => {
      await admin.signInThrottle.deleteMany({ where: { emailHash: databaseBytes(emailHash) } });
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.securityEvent.deleteMany({
          where: { OR: [{ userId: user.id }, { emailHash: databaseBytes(emailHash) }] },
        });
      });
      await admin.user.deleteMany({ where: { id: user.id } });
      await admin.$disconnect();
    },
  };
}

/** The refusal codes of settled attempts, counted by code. */
function outcomes(results: PromiseSettledResult<unknown>[]) {
  const counts: Record<string, number> = {};
  for (const result of results) {
    const code = result.status === 'rejected' ? (result.reason as AuthServiceError).code : 'OK';
    counts[code] = (counts[code] ?? 0) + 1;
  }
  return counts;
}

it.skipIf(!enabled)(
  'checks a burst of TOTP codes one at a time, so no more than 5 are tried before the cool-down',
  async () => {
    const fixture = await proofFixture();
    try {
      const onProved = vi.fn(async () => 'proved');
      const results = await Promise.allSettled(
        Array.from({ length: 12 }, () =>
          fixture.proof.proveTotp(fixture.attempt(fixture.wrong, onProved)),
        ),
      );
      expect(outcomes(results)).toEqual({ INVALID_CODE: 5, SIGN_IN_COOLDOWN: 7 });
      expect(onProved).not.toHaveBeenCalled();
      await expect(fixture.password()).resolves.toMatchObject({ secondFactorFailures: 5 });
      await expect(fixture.events('SIGN_IN_COOLDOWN_STARTED')).resolves.toHaveLength(1);
    } finally {
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)(
  'accepts a code once, running the flow’s work with it, and refuses its replay',
  async () => {
    const fixture = await proofFixture();
    try {
      const onProved = vi.fn(async () => 'proved');
      const results = await Promise.allSettled([
        fixture.proof.proveTotp(fixture.attempt(fixture.right, onProved)),
        fixture.proof.proveTotp(fixture.attempt(fixture.right, onProved)),
      ]);
      expect(outcomes(results)).toEqual({ OK: 1, INVALID_CODE: 1 });
      expect(onProved).toHaveBeenCalledTimes(1);
      await expect(
        fixture.proof.proveTotp(fixture.attempt(fixture.right, onProved)),
      ).rejects.toMatchObject({ code: 'INVALID_CODE' });
    } finally {
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)('rolls the accepted code back when the flow’s work fails', async () => {
  const fixture = await proofFixture();
  try {
    const refused = new AuthServiceError('The flow refused.', 403, 'FLOW_REFUSED');
    await expect(
      fixture.proof.proveTotp(fixture.attempt(fixture.right, () => Promise.reject(refused))),
    ).rejects.toBe(refused);
    await expect(
      fixture.proof.proveTotp(fixture.attempt(fixture.right, async () => 'proved')),
    ).resolves.toBe('proved');
  } finally {
    await fixture.cleanup();
  }
});

it.skipIf(!enabled)(
  'disables the password at the Second-factor Ceiling and answers the notice',
  async () => {
    const fixture = await proofFixture({ secondFactorFailures: 9 });
    try {
      await expect(
        fixture.proof.proveTotp(fixture.attempt(fixture.wrong, async () => 'proved')),
      ).rejects.toMatchObject({
        statusCode: 403,
        code: 'PASSWORD_RESET_REQUIRED',
        notice: { subject: 'Reset your LingkodHR password to sign in' },
      });
      const password = await fixture.password();
      expect(password.secondFactorFailures).toBe(10);
      expect(password.resetRequiredAt).not.toBeNull();
      await expect(fixture.events('PASSWORD_RESET_REQUIRED')).resolves.toEqual([
        { details: { secondFactorFailures: 10 } },
      ]);
    } finally {
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)(
  'leaves a Password Reset’s wrong code to the flow, away from the cool-down and the ceiling',
  async () => {
    const fixture = await proofFixture({ secondFactorFailures: 9 });
    try {
      const recordWrongCode = vi.fn(async () => undefined);
      await expect(
        fixture.proof.proveTotp({
          ...fixture.attempt(fixture.wrong, async () => 'proved'),
          passwordReset: { recordWrongCode },
        }),
      ).rejects.toMatchObject({ code: 'INVALID_CODE' });
      expect(recordWrongCode).toHaveBeenCalledTimes(1);
      await expect(fixture.password()).resolves.toMatchObject({
        secondFactorFailures: 9,
        resetRequiredAt: null,
      });
      await expect(fixture.events('LOGIN_FAILURE')).resolves.toEqual([]);
    } finally {
      await fixture.cleanup();
    }
  },
);
