import { createHash } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import { expect, it } from 'vitest';

const enabled = process.env.DATABASE_E2E === 'true';

async function withContext<T>(
  client: PrismaClient,
  values: { userId?: string; pendingTokenHash?: string },
  work: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return client.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT
        set_config('app.user_id', ${values.userId ?? ''}, true),
        set_config('app.pending_token_hash', ${values.pendingTokenHash ?? ''}, true)
    `;
    return work(transaction);
  });
}

async function visibleCredentials(transaction: Prisma.TransactionClient) {
  const [passwords, factors, codes, pending] = await Promise.all([
    transaction.userPassword.findMany({ select: { userId: true } }),
    transaction.userTotpFactor.findMany({ select: { userId: true } }),
    transaction.userRecoveryCode.findMany({ select: { userId: true } }),
    transaction.pendingAuthentication.findMany({ select: { userId: true } }),
  ]);
  return {
    passwords: passwords.map(({ userId }) => userId),
    factors: factors.map(({ userId }) => userId),
    codes: codes.map(({ userId }) => userId),
    pending: pending.map(({ userId }) => userId),
  };
}

it.skipIf(!enabled)(
  "keeps each User's password, factor, codes, and pending sign-in away from other Users",
  async () => {
    const runtimeUrl = process.env.DATABASE_URL;
    const adminUrl = process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
    if (!runtimeUrl || !adminUrl)
      throw new Error('Runtime and administrative database URLs are required.');

    const app = new PrismaClient({ datasources: { db: { url: runtimeUrl } } });
    const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const users = await Promise.all(
      ['a', 'b'].map((label) =>
        admin.user.create({
          data: {
            emailNormalized: `credential-rls-${label}-${suffix}@example.test`,
            displayName: `Credential RLS ${label}`,
            globalStatus: 'ACTIVE',
          },
        }),
      ),
    );
    const [userA, userB] = users;
    if (!userA || !userB) throw new Error('Credential RLS fixtures were not created.');
    const tokenHashB = createHash('sha256').update(`pending-${suffix}-b`).digest();
    for (const user of users) {
      await admin.userPassword.create({ data: { userId: user.id, passwordHash: 'fixture-hash' } });
      await admin.userTotpFactor.create({
        data: { userId: user.id, secretEnvelope: Buffer.from('fixture-envelope') },
      });
      await admin.userRecoveryCode.create({ data: { userId: user.id, codeHash: 'fixture-hash' } });
      await admin.pendingAuthentication.create({
        data: {
          tokenHash:
            user.id === userB.id
              ? tokenHashB
              : createHash('sha256').update(`pending-${suffix}-a`).digest(),
          purpose: 'SIGN_IN',
          userId: user.id,
          stage: 'TOTP',
          verifiedMethods: ['pwd'],
          expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        },
      });
    }

    try {
      await expect(withContext(app, { userId: userA.id }, visibleCredentials)).resolves.toEqual({
        passwords: [userA.id],
        factors: [userA.id],
        codes: [userA.id],
        pending: [userA.id],
      });
      await expect(withContext(app, {}, visibleCredentials)).resolves.toEqual({
        passwords: [],
        factors: [],
        codes: [],
        pending: [],
      });
      // The pending-sign-in token opens only its own pending row, not the User's secrets.
      await expect(
        withContext(app, { pendingTokenHash: tokenHashB.toString('hex') }, visibleCredentials),
      ).resolves.toEqual({ passwords: [], factors: [], codes: [], pending: [userB.id] });

      await expect(
        withContext(app, { userId: userA.id }, (transaction) =>
          transaction.userPassword.update({
            where: { userId: userB.id },
            data: { passwordHash: 'overwritten' },
          }),
        ),
      ).rejects.toThrow();
      await expect(
        withContext(app, { userId: userA.id }, (transaction) =>
          transaction.userRecoveryCode.create({
            data: { userId: userB.id, codeHash: 'planted' },
          }),
        ),
      ).rejects.toThrow(/row-level security/i);
      await expect(
        withContext(app, { userId: userA.id }, (transaction) =>
          transaction.userTotpFactor.deleteMany({ where: { userId: userB.id } }),
        ),
      ).resolves.toEqual({ count: 0 });
      // Only the replay guard may change on a factor; its secret is replaced, never edited.
      await expect(
        withContext(app, { userId: userA.id }, (transaction) =>
          transaction.userTotpFactor.update({
            where: { userId: userA.id },
            data: { secretEnvelope: Buffer.from('swapped') },
          }),
        ),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        withContext(app, { userId: userA.id }, (transaction) =>
          transaction.userTotpFactor.update({
            where: { userId: userA.id },
            data: { lastAcceptedStep: 10n },
          }),
        ),
      ).resolves.toMatchObject({ lastAcceptedStep: 10n });
    } finally {
      await admin.user.deleteMany({ where: { id: { in: users.map(({ id }) => id) } } });
      await app.$disconnect();
      await admin.$disconnect();
    }
  },
);
