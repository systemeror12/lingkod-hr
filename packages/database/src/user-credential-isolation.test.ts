import { createHash } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import { expect, it } from 'vitest';
import { setDatabaseContext, type DatabaseContext } from './context';

const enabled = process.env.DATABASE_E2E === 'true';

async function withContext<T>(
  client: PrismaClient,
  context: DatabaseContext,
  work: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return client.$transaction(async (transaction) => {
    await setDatabaseContext(transaction, context);
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

      // Any insert purges every expired pending row, including other Users' rows it cannot see.
      await admin.pendingAuthentication.updateMany({
        where: { userId: userB.id },
        data: {
          createdAt: new Date(Date.now() - 20 * 60 * 1000),
          expiresAt: new Date(Date.now() - 1),
        },
      });
      await withContext(app, { userId: userA.id }, async (transaction) => {
        await transaction.pendingAuthentication.deleteMany({ where: { userId: userA.id } });
        await transaction.pendingAuthentication.create({
          data: {
            tokenHash: createHash('sha256').update(`pending-${suffix}-a2`).digest(),
            purpose: 'SIGN_IN',
            userId: userA.id,
            stage: 'TOTP',
            expiresAt: new Date(Date.now() + 5 * 60 * 1000),
          },
        });
      });
      await expect(
        admin.pendingAuthentication.count({ where: { userId: { in: [userA.id, userB.id] } } }),
      ).resolves.toBe(1);
    } finally {
      await admin.user.deleteMany({ where: { id: { in: users.map(({ id }) => id) } } });
      await app.$disconnect();
      await admin.$disconnect();
    }
  },
);

it.skipIf(!enabled)(
  'keeps reset links with their User or token and throttle rows with platform security',
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
            emailNormalized: `reset-rls-${label}-${suffix}@example.test`,
            displayName: `Reset RLS ${label}`,
            globalStatus: 'ACTIVE',
          },
        }),
      ),
    );
    const [userA, userB] = users;
    if (!userA || !userB) throw new Error('Reset RLS fixtures were not created.');
    const userIds = [userA.id, userB.id];
    const resetHash = (label: string) =>
      createHash('sha256').update(`reset-${suffix}-${label}`).digest();
    for (const [user, label] of [
      [userA, 'a'],
      [userB, 'b'],
    ] as const) {
      await admin.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: resetHash(label),
          expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        },
      });
    }
    const emailHash = createHash('sha256').update(`throttle-${suffix}`).digest();
    const plantedHash = createHash('sha256').update(`throttle-${suffix}-planted`).digest();
    const throttleKeys = [emailHash, plantedHash];
    await admin.signInThrottle.create({
      data: { emailHash, failureCount: 3, lastFailureAt: new Date() },
    });

    const visibleResetOwners = (transaction: Prisma.TransactionClient) =>
      transaction.passwordResetToken
        .findMany({ where: { userId: { in: userIds } }, select: { userId: true } })
        .then((rows) => rows.map(({ userId }) => userId));
    const visibleThrottles = (transaction: Prisma.TransactionClient) =>
      transaction.signInThrottle.count({ where: { emailHash: { in: throttleKeys } } });

    try {
      await expect(withContext(app, { userId: userA.id }, visibleResetOwners)).resolves.toEqual([
        userA.id,
      ]);
      await expect(
        withContext(
          app,
          { passwordResetTokenHash: resetHash('b').toString('hex') },
          visibleResetOwners,
        ),
      ).resolves.toEqual([userB.id]);
      await expect(withContext(app, {}, visibleResetOwners)).resolves.toEqual([]);
      // Platform security opens throttle rows, not reset links.
      await expect(
        withContext(app, { capabilities: ['platform-security'] }, visibleResetOwners),
      ).resolves.toEqual([]);

      await expect(
        withContext(app, { userId: userA.id }, (transaction) =>
          transaction.passwordResetToken.updateMany({
            where: { userId: userB.id },
            data: { consumedAt: new Date() },
          }),
        ),
      ).resolves.toEqual({ count: 0 });
      await expect(
        withContext(app, { userId: userA.id }, (transaction) =>
          transaction.passwordResetToken.create({
            data: {
              userId: userB.id,
              tokenHash: resetHash('planted'),
              expiresAt: new Date(Date.now() + 30 * 60 * 1000),
            },
          }),
        ),
      ).rejects.toThrow(/row-level security/i);
      await expect(
        admin.passwordResetToken.findMany({
          where: { userId: userB.id },
          select: { consumedAt: true },
        }),
      ).resolves.toEqual([{ consumedAt: null }]);

      await expect(
        withContext(app, { capabilities: ['platform-security'] }, visibleThrottles),
      ).resolves.toBe(1);
      // A User's context, or one with only a reset token, has no capability.
      for (const context of [
        { userId: userA.id },
        { userId: userB.id },
        { passwordResetTokenHash: resetHash('a').toString('hex') },
        {},
      ]) {
        await expect(withContext(app, context, visibleThrottles)).resolves.toBe(0);
        await expect(
          withContext(app, context, (transaction) =>
            transaction.signInThrottle.updateMany({
              where: { emailHash },
              data: { failureCount: 0 },
            }),
          ),
        ).resolves.toEqual({ count: 0 });
        await expect(
          withContext(app, context, (transaction) =>
            transaction.signInThrottle.deleteMany({ where: { emailHash } }),
          ),
        ).resolves.toEqual({ count: 0 });
        await expect(
          withContext(app, context, (transaction) =>
            transaction.signInThrottle.create({
              data: { emailHash: plantedHash, lastFailureAt: new Date() },
            }),
          ),
        ).rejects.toThrow(/row-level security/i);
      }
      await expect(
        admin.signInThrottle.findMany({
          where: { emailHash: { in: throttleKeys } },
          select: { failureCount: true },
        }),
      ).resolves.toEqual([{ failureCount: 3 }]);
    } finally {
      await admin.signInThrottle.deleteMany({ where: { emailHash: { in: throttleKeys } } });
      await admin.user.deleteMany({ where: { id: { in: userIds } } });
      await app.$disconnect();
      await admin.$disconnect();
    }
  },
);
