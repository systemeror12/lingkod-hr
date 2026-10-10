import { randomBytes } from 'node:crypto';
import { ForbiddenException, HttpException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { hashSessionToken, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { expect, it } from 'vitest';
import { AgencyController } from './agency.controller';
import { AgencyMemberListService, type AgencyMember } from './agency-member-list.service';
import { REQUIRED_PERMISSIONS } from './auth.decorators';
import { AuthService } from './auth.service';

const enabled = process.env.DATABASE_E2E === 'true';

function databaseBytes(value: Buffer): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(value.byteLength));
  bytes.set(value);
  return bytes;
}

/**
 * Agencies A, B, and C. A has seven members: two unlocked ones sharing a display name, one locked by
 * A, one locked by A whose A membership is deactivated, one locked by B while B still has them,
 * and one locked by C after C deactivated them. A and B each have a signed-in Security
 * Administrator.
 */
async function memberListFixture() {
  const admin = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_E2E_ADMIN_URL ?? '' } },
  });
  const suffix = `${Date.now()}-${randomBytes(4).toString('hex')}`;
  const agencies = await Promise.all(
    ['A', 'B', 'C'].map((label) =>
      admin.agency.create({
        data: {
          code: `MEMBER-LIST-${label}-${suffix}`,
          name: `Member List Agency ${label}`,
          agencyType: 'NGA',
          status: 'ACTIVE',
        },
      }),
    ),
  );
  const [agencyA, agencyB, agencyC] = agencies as [
    (typeof agencies)[0],
    (typeof agencies)[0],
    (typeof agencies)[0],
  ];
  const userIds: string[] = [];

  async function user(label: string, displayName: string) {
    const { id } = await admin.user.create({
      data: {
        emailNormalized: `member-list-${label}-${suffix}@example.test`,
        displayName,
        globalStatus: 'ACTIVE',
      },
    });
    userIds.push(id);
    return id;
  }
  async function membership(agencyId: string, userId: string, status = 'ACTIVE') {
    const { id } = await admin.agencyMembership.create({
      data: {
        agencyId,
        userId,
        status,
        activatedAt: new Date(),
        ...(status === 'DEACTIVATED'
          ? { deactivatedAt: new Date(), deactivationReason: 'Separated' }
          : {}),
      },
    });
    return id;
  }
  async function lock(userId: string, agencyId: string) {
    await admin.user.update({
      where: { id: userId },
      data: { globalStatus: 'LOCKED', lockedAt: new Date(), lockedByAgencyId: agencyId },
    });
  }
  async function securityAdministrator(label: string, agencyId: string) {
    const userId = await user(label, `Member List ${label}`);
    const membershipId = await membership(agencyId, userId);
    const role = await admin.role.findFirstOrThrow({
      where: { code: 'security_administrator', agencyId: null },
    });
    await admin.membershipRole.create({
      data: {
        agencyId,
        membershipId,
        roleId: role.id,
        effectiveFrom: new Date(Date.now() - 60_000),
        reason: 'Member list fixture',
      },
    });
    const token = randomBytes(32).toString('base64url');
    await admin.userSession.create({
      data: {
        userId,
        agencyId,
        agencyMembershipId: membershipId,
        sessionTokenHash: databaseBytes(hashSessionToken(token)),
        authTime: new Date(Date.now() - 60_000),
        authenticationMethods: ['pwd', 'totp'],
        lastSeenAt: new Date(),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    const session = await new AuthService().authenticateSession(token, `member-list-${label}`);
    if (!session) throw new Error(`Expected an active session for ${label}.`);
    return { userId, membershipId, context: session.context };
  }

  const securityA = await securityAdministrator('security-a', agencyA.id);
  const securityB = await securityAdministrator('security-b', agencyB.id);

  const unlocked = await user('unlocked', 'Member List unlocked');
  const namesake = await user('namesake', 'Member List unlocked');
  const lockedHere = await user('locked-here', 'Member List locked here');
  const lockedHereInactive = await user('locked-here-inactive', 'Member List locked inactive');
  const lockedByB = await user('locked-by-b', 'Member List locked by B');
  const lockedByGoneC = await user('locked-by-gone-c', 'Member List locked by gone C');
  const membershipIds = {
    unlocked: await membership(agencyA.id, unlocked),
    namesake: await membership(agencyA.id, namesake),
    lockedHere: await membership(agencyA.id, lockedHere),
    lockedHereInactive: await membership(agencyA.id, lockedHereInactive, 'DEACTIVATED'),
    lockedByB: await membership(agencyA.id, lockedByB),
    lockedByGoneC: await membership(agencyA.id, lockedByGoneC),
  };
  await membership(agencyB.id, lockedByB);
  await membership(agencyC.id, lockedByGoneC, 'DEACTIVATED');
  await lock(lockedHere, agencyA.id);
  await lock(lockedHereInactive, agencyA.id);
  await lock(lockedByB, agencyB.id);
  await lock(lockedByGoneC, agencyC.id);

  return {
    agencyA,
    agencyB,
    agencyC,
    securityA,
    securityB,
    membershipIds,
    lockedByB,
    cleanup: async () => {
      const agencyIds = agencies.map(({ id }) => id);
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

/** Every page, `limit` members at a time, following `nextCursor` to the end. */
async function allPages(context: RequestContext, limit: number) {
  const service = new AgencyMemberListService();
  const pages: AgencyMember[][] = [];
  let cursor: string | undefined;
  do {
    const page = await service.list(context, { cursor, limit });
    pages.push(page.members);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return pages;
}

it('guards the member list with its own permission', () => {
  expect(Reflect.getMetadata(REQUIRED_PERMISSIONS, AgencyController.prototype.members)).toEqual([
    'security.users.read',
  ]);
});

it('refuses a bad cursor or page size the way the other paginated lists do', async () => {
  const controller = new AgencyController(new AuthService(), new AgencyMemberListService());
  const agencyId = '00000000-0000-4000-8000-000000000001';
  const context = { agencyId } as RequestContext;
  for (const query of [
    { cursor: 'not-a-uuid' },
    { limit: '0' },
    { limit: '101' },
    { limit: 'ten' },
    { page: '2' },
  ]) {
    const refused = await controller.members(agencyId, context, query).catch((error) => error);
    expect(refused).toBeInstanceOf(HttpException);
    expect((refused as HttpException).getStatus()).toBe(400);
    expect((refused as HttpException).getResponse()).toMatchObject({
      error: { code: 'INVALID_INPUT' },
    });
  }
});

it.skipIf(!enabled)(
  'pages the members in a stable order and resolves each page lock without naming another Agency',
  async () => {
    const fixture = await memberListFixture();
    try {
      const { securityA, membershipIds } = fixture;
      const [whole, ...rest] = await allPages(securityA.context, 100);
      expect(rest).toEqual([]);
      expect(whole).toHaveLength(7);
      // Members who share a display name follow their email.
      const order = whole?.map(({ membershipId }) => membershipId) ?? [];
      expect(order.indexOf(membershipIds.unlocked) - order.indexOf(membershipIds.namesake)).toBe(1);

      for (const limit of [1, 2, 3]) {
        const pages = await allPages(securityA.context, limit);
        expect(pages.every((page) => page.length <= limit)).toBe(true);
        expect(pages.flat()).toEqual(whole);
      }

      const row = (membershipId: string) =>
        whole?.find((member) => member.membershipId === membershipId);
      expect(row(membershipIds.unlocked)).toMatchObject({ globalStatus: 'ACTIVE', lock: null });
      expect(row(membershipIds.lockedHere)).toMatchObject({
        globalStatus: 'LOCKED',
        lock: { byThisAgency: true, unlockable: true },
      });
      expect(row(membershipIds.lockedHereInactive)).toMatchObject({
        membershipStatus: 'DEACTIVATED',
        lock: { byThisAgency: true, unlockable: false },
      });
      expect(row(membershipIds.lockedByB)).toMatchObject({
        lock: { byThisAgency: false, unlockable: false },
      });
      expect(row(membershipIds.lockedByGoneC)).toMatchObject({
        lock: { byThisAgency: false, unlockable: true },
      });
      for (const { agency, name } of [
        { agency: fixture.agencyB, name: fixture.agencyB.name },
        { agency: fixture.agencyC, name: fixture.agencyC.name },
      ]) {
        expect(JSON.stringify(whole)).not.toContain(agency.id);
        expect(JSON.stringify(whole)).not.toContain(name);
      }
    } finally {
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)(
  "keeps another Agency's Security Administrator from paging these members",
  async () => {
    const fixture = await memberListFixture();
    try {
      const { securityA, securityB, membershipIds } = fixture;
      const controller = new AgencyController(new AuthService(), new AgencyMemberListService());
      await expect(
        controller.members(fixture.agencyA.id, securityB.context, {}),
      ).rejects.toBeInstanceOf(ForbiddenException);

      // B's own list holds only B's members, and a cursor from A's list opens nothing of A's.
      const service = new AgencyMemberListService();
      const inB = await service.list(securityB.context, { limit: 100 });
      expect(inB.members.map(({ userId }) => userId).sort()).toEqual(
        [securityB.userId, fixture.lockedByB].sort(),
      );
      const { nextCursor } = await service.list(securityA.context, { limit: 1 });
      expect(nextCursor).not.toBeNull();
      const crossed = await service.list(securityB.context, {
        cursor: nextCursor ?? undefined,
        limit: 100,
      });
      const aOnly = Object.values(membershipIds);
      expect(crossed.members.filter(({ membershipId }) => aOnly.includes(membershipId))).toEqual(
        [],
      );

      // The runtime role still can't read another Agency's memberships directly.
      await expect(
        withDatabaseContext(securityB.context, (transaction) =>
          transaction.agencyMembership.count({ where: { agencyId: fixture.agencyA.id } }),
        ),
      ).resolves.toBe(0);
      await expect(
        withDatabaseContext(securityA.context, (transaction) =>
          transaction.agencyMembership.count({
            where: { agencyId: { in: [fixture.agencyB.id, fixture.agencyC.id] } },
          }),
        ),
      ).resolves.toBe(0);
    } finally {
      await fixture.cleanup();
    }
  },
);
