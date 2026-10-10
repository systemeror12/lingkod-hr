import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import { hashEmail, hashPassword, hashSessionToken } from '@lingkod-hr/auth';
import { getConfig } from '@lingkod-hr/config';
import { expect, it } from 'vitest';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';

const enabled = process.env.DATABASE_E2E === 'true';
const TEN_MINUTES_MS = 10 * 60_000;

function databaseBytes(value: Buffer): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(value.byteLength));
  bytes.set(value);
  return bytes;
}

/**
 * A password-only User in one Agency, signed in on a session last seen and last proved ten
 * minutes ago, served by the real `AuthController` and `AuthGuard` over HTTP.
 */
async function idleSessionFixture() {
  const admin = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_E2E_ADMIN_URL ?? '' } },
  });
  const suffix = `${Date.now()}-${randomBytes(4).toString('hex')}`;
  const email = `reauth-idle-${suffix}@example.test`;
  const password = `idle passphrase ${suffix}`;
  const agency = await admin.agency.create({
    data: {
      code: `REAUTH-IDLE-${suffix}`,
      name: 'Reauthentication Idle Agency',
      agencyType: 'NGA',
      status: 'ACTIVE',
    },
  });
  const user = await admin.user.create({
    data: { emailNormalized: email, displayName: 'Idle User', globalStatus: 'ACTIVE' },
  });
  const membership = await admin.agencyMembership.create({
    data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE', activatedAt: new Date() },
  });
  await admin.userPassword.create({
    data: { userId: user.id, passwordHash: await hashPassword(password) },
  });
  const token = randomBytes(32).toString('base64url');
  const idleSince = new Date(Date.now() - TEN_MINUTES_MS);
  const session = await admin.userSession.create({
    data: {
      userId: user.id,
      agencyId: agency.id,
      agencyMembershipId: membership.id,
      sessionTokenHash: databaseBytes(hashSessionToken(token)),
      authTime: idleSince,
      authenticationMethods: ['pwd'],
      lastSeenAt: idleSince,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    },
  });

  @Module({
    controllers: [AuthController],
    providers: [AuthGuard, { provide: AuthService, useValue: new AuthService() }],
  })
  class TestModule {}
  const app = await NestFactory.create(TestModule, { logger: ['error'], abortOnError: false });
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  const emailHash = databaseBytes(hashEmail(email, getConfig().BLIND_INDEX_KEY));

  return {
    admin,
    password,
    session,
    userId: user.id,
    /** Calls the API as this session, by bearer token, as a non-browser client would. */
    request: (path: string, init: RequestInit = {}) =>
      fetch(`${base}${path}`, {
        ...init,
        headers: {
          ...init.headers,
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
      }),
    stored: () => admin.userSession.findUniqueOrThrow({ where: { id: session.id } }),
    cleanup: async () => {
      await app.close();
      await admin.signInThrottle.deleteMany({ where: { emailHash } });
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.securityEvent.deleteMany({
          where: { OR: [{ agencyId: agency.id }, { userId: user.id }, { emailHash }] },
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

it.skipIf(!enabled)(
  'reauthenticates an idle session over HTTP without moving its last-seen time or expiry',
  async () => {
    const fixture = await idleSessionFixture();
    try {
      const before = Date.now();
      const response = await fixture.request('/auth/reauthenticate', {
        method: 'POST',
        body: JSON.stringify({ password: fixture.password }),
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ status: 'REAUTHENTICATED' });

      const stored = await fixture.stored();
      expect(stored.authTime?.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(stored.lastSeenAt).toEqual(fixture.session.lastSeenAt);
      expect(stored.expiresAt).toEqual(fixture.session.expiresAt);
      expect(stored.revokedAt).toBeNull();
      await expect(
        fixture.admin.securityEvent.count({
          where: { userId: fixture.userId, eventType: 'REAUTHENTICATED' },
        }),
      ).resolves.toBe(1);
    } finally {
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)(
  'renews the idle timer on any other authenticated request over HTTP',
  async () => {
    const fixture = await idleSessionFixture();
    try {
      const before = Date.now();
      const response = await fixture.request('/auth/me');
      expect(response.status).toBe(200);

      const stored = await fixture.stored();
      expect(stored.lastSeenAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(stored.authTime).toEqual(fixture.session.authTime);
      expect(stored.expiresAt).toEqual(fixture.session.expiresAt);
    } finally {
      await fixture.cleanup();
    }
  },
);
