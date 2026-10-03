import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import {
  generateTotpSecret,
  hashEmail,
  hashPassword,
  hashSessionToken,
  sealTotpSecret,
  totpCode,
} from '@lingkod-hr/auth';
import { getConfig, parseProtectedValueKey } from '@lingkod-hr/config';
import { expect, it } from 'vitest';
import { AuthService } from './auth.service';

const enabled = process.env.DATABASE_E2E === 'true';
const STRONG_PASSWORD = 'tahimik na umaga sa bundok 42';

function databaseBytes(value: Buffer): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(value.byteLength));
  bytes.set(value);
  return bytes;
}

function activationRequest(label: string) {
  return { requestId: `activation-${label}-${randomUUID()}`, ipAddress: '198.51.100.9' };
}

function secretFromUri(uri: string): string {
  return new URL(uri).searchParams.get('secret') ?? '';
}

/**
 * An Agency with an active inviter and a PENDING invitation for `email`. `existingUser` creates a
 * User with that email first, with a password and, optionally, a TOTP factor.
 */
async function activationFixture(
  options: {
    roleCodes?: string[];
    existingUser?: { withTotp?: boolean; globalStatus?: string };
  } = {},
) {
  const admin = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_E2E_ADMIN_URL ?? '' } },
  });
  const suffix = `${Date.now()}-${randomBytes(4).toString('hex')}`;
  const email = `invitee-${suffix}@example.test`;
  const token = randomBytes(32).toString('base64url');
  const agency = await admin.agency.create({
    data: {
      code: `ACTIVATION-${suffix}`,
      name: 'Activation Test Agency',
      acronym: 'ATA',
      agencyType: 'NGA',
      status: 'ACTIVE',
    },
  });
  const priorAgency = await admin.agency.create({
    data: {
      code: `ACTIVATION-PRIOR-${suffix}`,
      name: 'Prior Agency',
      agencyType: 'NGA',
      status: 'ACTIVE',
    },
  });
  const inviter = await admin.user.create({
    data: {
      emailNormalized: `inviter-${suffix}@example.test`,
      displayName: 'Inviter',
      globalStatus: 'ACTIVE',
    },
  });
  const inviterMembership = await admin.agencyMembership.create({
    data: { agencyId: agency.id, userId: inviter.id, status: 'ACTIVE' },
  });
  const invitation = await admin.invitation.create({
    data: {
      agencyId: agency.id,
      emailNormalized: email,
      invitedByMembershipId: inviterMembership.id,
      tokenHash: databaseBytes(hashSessionToken(token)),
      requestedRoleCodes: options.roleCodes ?? ['employee'],
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      status: 'PENDING',
    },
  });

  let existing: { id: string; password: string; totpSecret: string | null } | null = null;
  if (options.existingUser) {
    const password = `existing passphrase ${suffix}`;
    const user = await admin.user.create({
      data: {
        emailNormalized: email,
        displayName: 'Existing Invitee',
        globalStatus: options.existingUser.globalStatus ?? 'ACTIVE',
      },
    });
    await admin.userPassword.create({
      data: { userId: user.id, passwordHash: await hashPassword(password) },
    });
    let totpSecret: string | null = null;
    if (options.existingUser.withTotp) {
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
    existing = { id: user.id, password, totpSecret };
  }

  const emailHash = databaseBytes(hashEmail(email, getConfig().BLIND_INDEX_KEY));
  return {
    admin,
    agency,
    priorAgency,
    inviterMembership,
    invitation,
    email,
    token,
    existing,
    emailHash,
    /** Everything this invitation's activation wrote, read with the admin client. */
    written: async () => {
      const user = await admin.user.findUnique({
        where: { emailNormalized: email },
        include: {
          password: true,
          totpFactor: true,
          recoveryCodes: true,
          memberships: { include: { membershipRoles: true } },
          sessions: true,
        },
      });
      return {
        user,
        invitation: await admin.invitation.findUniqueOrThrow({ where: { id: invitation.id } }),
        pending: await admin.pendingAuthentication.findMany({
          where: { invitationId: invitation.id },
        }),
      };
    },
    cleanup: async () => {
      const users = await admin.user.findMany({
        where: { emailNormalized: { in: [email, inviter.emailNormalized] } },
        select: { id: true },
      });
      const userIds = users.map(({ id }) => id);
      const agencyIds = [agency.id, priorAgency.id];
      await admin.signInThrottle.deleteMany({ where: { emailHash } });
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.securityEvent.deleteMany({
          where: {
            OR: [
              { agencyId: { in: agencyIds } },
              { userId: { in: userIds } },
              { emailHash },
              { userId: null, requestId: { startsWith: 'activation-' } },
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

it.skipIf(!enabled)('opens an invitation without writing anything', async () => {
  const fixture = await activationFixture({ roleCodes: ['hrmo_administrator'] });
  const { admin } = fixture;
  try {
    const service = new AuthService();
    await expect(service.lookupInvitation(fixture.token)).resolves.toEqual({
      status: 'VALID',
      email: fixture.email,
      agency: { name: 'Activation Test Agency', acronym: 'ATA', sealUrl: null },
      roleNames: ['HRMO Administrator'],
      existingUser: false,
      expiresAt: fixture.invitation.expiresAt,
    });
    await expect(service.lookupInvitation(randomBytes(32).toString('base64url'))).resolves.toEqual({
      status: 'INVALID',
    });

    await admin.invitation.update({
      where: { id: fixture.invitation.id },
      data: { createdAt: new Date(Date.now() - 2000), expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(service.lookupInvitation(fixture.token)).resolves.toEqual({ status: 'EXPIRED' });
    await expect(fixture.written()).resolves.toMatchObject({
      user: null,
      invitation: { status: 'PENDING' },
      pending: [],
    });
    await expect(
      admin.securityEvent.count({ where: { agencyId: fixture.agency.id } }),
    ).resolves.toBe(0);
  } finally {
    await fixture.cleanup();
  }
});

it.skipIf(!enabled)(
  'activates a first-time MFA-Required invitee only once enrollment is acknowledged',
  async () => {
    const fixture = await activationFixture({ roleCodes: ['hrmo_administrator'] });
    try {
      const service = new AuthService();
      await expect(
        service.startActivation(
          fixture.token,
          { name: 'Maria Clara Santos', password: 'santos family vacation' },
          activationRequest('weak'),
        ),
      ).rejects.toMatchObject({ code: 'PASSWORD_REJECTED', statusCode: 400 });

      const started = await service.startActivation(
        fixture.token,
        { name: '  Maria Clara Santos ', password: STRONG_PASSWORD },
        activationRequest('start'),
      );
      if (started.status !== 'ENROLLMENT_REQUIRED') throw new Error('Expected enrollment.');
      expect(started.enrollment.account).toBe(fixture.email);
      const pendingRows = (await fixture.written()).pending;
      expect(pendingRows).toHaveLength(1);
      const lifetime = (pendingRows[0]?.expiresAt.getTime() ?? 0) - Date.now();
      expect(lifetime).toBeGreaterThan(14 * 60 * 1000);
      expect(lifetime).toBeLessThanOrEqual(15 * 60 * 1000);
      await expect(fixture.written()).resolves.toMatchObject({ user: null });

      const secret = secretFromUri(started.enrollment.otpauthUri);
      await expect(
        service.confirmActivationEnrollment(
          fixture.token,
          started.pendingToken,
          '000000' === totpCode(secret) ? '111111' : '000000',
          activationRequest('wrong-enroll'),
        ),
      ).rejects.toMatchObject({ code: 'INVALID_CODE' });
      const { recoveryCodes } = await service.confirmActivationEnrollment(
        fixture.token,
        started.pendingToken,
        totpCode(secret),
        activationRequest('confirm'),
      );
      expect(recoveryCodes).toHaveLength(10);
      await expect(fixture.written()).resolves.toMatchObject({ user: null });

      const done = await service.finishActivationEnrollment(
        fixture.token,
        started.pendingToken,
        activationRequest('finish'),
      );
      expect(done.session.authenticationMethods).toEqual(['pwd', 'totp']);
      expect(done.session.context.agencyId).toBe(fixture.agency.id);
      expect(done.notices.map(({ subject }) => subject)).toEqual([
        'An authenticator app was added to your LingkodHR account',
      ]);

      const written = await fixture.written();
      expect(written.user).toMatchObject({
        displayName: 'Maria Clara Santos',
        globalStatus: 'ACTIVE',
        emailVerifiedAt: expect.any(Date),
      });
      expect(written.user?.password).not.toBeNull();
      expect(written.user?.totpFactor).not.toBeNull();
      expect(written.user?.recoveryCodes).toHaveLength(10);
      expect(written.user?.memberships).toMatchObject([
        { agencyId: fixture.agency.id, status: 'ACTIVE', membershipRoles: [{}] },
      ]);
      expect(written.invitation).toMatchObject({
        status: 'ACCEPTED',
        acceptedAt: expect.any(Date),
      });
      expect(written.pending).toHaveLength(0);
      const eventTypes = (
        await fixture.admin.securityEvent.findMany({
          where: { userId: written.user?.id ?? null },
          select: { eventType: true },
        })
      ).map(({ eventType }) => eventType);
      expect(eventTypes).toEqual(
        expect.arrayContaining([
          'PASSWORD_SET',
          'TOTP_ENROLLED',
          'INVITATION_ACCEPTED',
          'LOGIN_SUCCESS',
        ]),
      );
      await expect(
        fixture.admin.auditEvent.count({
          where: { agencyId: fixture.agency.id, action: 'INVITATION_ACCEPTED' },
        }),
      ).resolves.toBe(1);
      await expect(
        service.authenticateSession(done.session.token, 'activation-me'),
      ).resolves.toMatchObject({ sessionId: done.session.sessionId });

      await expect(
        service.startActivation(
          fixture.token,
          { name: 'Someone Else', password: STRONG_PASSWORD },
          activationRequest('reuse'),
        ),
      ).rejects.toMatchObject({ code: 'INVITATION_INVALID' });
    } finally {
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)(
  'activates a first-time invitee without MFA at once, preferring Agency roles',
  async () => {
    const fixture = await activationFixture({ roleCodes: ['employee'] });
    const agencyRole = await fixture.admin.role.create({
      data: {
        agencyId: fixture.agency.id,
        code: 'employee',
        name: 'Agency employee',
        status: 'ACTIVE',
      },
    });
    try {
      const request = activationRequest('direct');
      const started = await new AuthService().startActivation(
        fixture.token,
        { name: 'Jose Rizal', password: STRONG_PASSWORD },
        request,
      );
      if (started.status !== 'ACTIVATED') throw new Error('Expected activation.');
      expect(started.session.authenticationMethods).toEqual(['pwd']);

      const written = await fixture.written();
      expect(written.user?.totpFactor).toBeNull();
      expect(written.user?.memberships[0]?.membershipRoles).toMatchObject([
        { roleId: agencyRole.id, assignedByMembershipId: fixture.inviterMembership.id },
      ]);
      await expect(
        fixture.admin.auditEvent.findFirstOrThrow({
          where: {
            agencyId: fixture.agency.id,
            action: 'INVITATION_ACCEPTED',
            requestId: request.requestId,
          },
        }),
      ).resolves.toMatchObject({
        metadata: {
          invitationId: fixture.invitation.id,
          roleCodes: ['employee'],
          assignedByMembershipId: fixture.inviterMembership.id,
        },
      });
    } finally {
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)('writes nothing when the setup is abandoned or expires', async () => {
  const fixture = await activationFixture({ roleCodes: ['hrmo_administrator'] });
  const { admin } = fixture;
  try {
    const service = new AuthService();
    const first = await service.startActivation(
      fixture.token,
      { name: 'Andres Bonifacio', password: STRONG_PASSWORD },
      activationRequest('first'),
    );
    const restarted = await service.startActivation(
      fixture.token,
      { name: 'Andres Bonifacio', password: STRONG_PASSWORD },
      activationRequest('restart'),
    );
    if (first.status !== 'ENROLLMENT_REQUIRED' || restarted.status !== 'ENROLLMENT_REQUIRED') {
      throw new Error('Expected enrollment.');
    }
    // Restarting replaced the first pending activation.
    await expect(fixture.written()).resolves.toMatchObject({ pending: [{}] });
    await expect(
      service.confirmActivationEnrollment(
        fixture.token,
        first.pendingToken,
        totpCode(secretFromUri(first.enrollment.otpauthUri)),
        activationRequest('replaced'),
      ),
    ).rejects.toMatchObject({ code: 'ACTIVATION_EXPIRED' });

    await service.confirmActivationEnrollment(
      fixture.token,
      restarted.pendingToken,
      totpCode(secretFromUri(restarted.enrollment.otpauthUri)),
      activationRequest('confirm'),
    );
    // The invitation expires before the final save.
    await admin.invitation.update({
      where: { id: fixture.invitation.id },
      data: { createdAt: new Date(Date.now() - 2000), expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(
      service.finishActivationEnrollment(
        fixture.token,
        restarted.pendingToken,
        activationRequest('expired-invitation'),
      ),
    ).rejects.toMatchObject({ code: 'INVITATION_EXPIRED' });
    await expect(fixture.written()).resolves.toMatchObject({
      user: null,
      invitation: { status: 'PENDING' },
    });

    // The pending activation itself times out.
    await admin.invitation.update({
      where: { id: fixture.invitation.id },
      data: { expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
    });
    await admin.pendingAuthentication.updateMany({
      where: { invitationId: fixture.invitation.id },
      data: { createdAt: new Date(Date.now() - 2000), expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(
      service.finishActivationEnrollment(
        fixture.token,
        restarted.pendingToken,
        activationRequest('expired-pending'),
      ),
    ).rejects.toMatchObject({ code: 'ACTIVATION_EXPIRED' });
    await expect(fixture.written()).resolves.toMatchObject({
      user: null,
      invitation: { status: 'PENDING' },
    });
    await expect(
      admin.securityEvent.findMany({
        where: { agencyId: fixture.agency.id, eventType: 'INVITATION_ACTIVATION_FAILED' },
        select: { details: true },
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        { details: { invitationId: fixture.invitation.id, reason: 'ACTIVATION_EXPIRED' } },
        { details: { invitationId: fixture.invitation.id, reason: 'INVITATION_EXPIRED' } },
      ]),
    );
  } finally {
    await fixture.cleanup();
  }
});

it.skipIf(!enabled)('lets the first of two saves win', async () => {
  const fixture = await activationFixture({ roleCodes: ['employee'] });
  try {
    const outcomes = await Promise.allSettled(
      ['one', 'two'].map((label) =>
        new AuthService().startActivation(
          fixture.token,
          { name: 'Gabriela Silang', password: STRONG_PASSWORD },
          activationRequest(label),
        ),
      ),
    );
    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find(({ status }) => status === 'rejected')).toMatchObject({
      reason: { code: 'INVITATION_INVALID' },
    });
    const written = await fixture.written();
    expect(written.user?.memberships).toHaveLength(1);
    expect(written.user?.sessions).toHaveLength(1);
  } finally {
    await fixture.cleanup();
  }
});

it.skipIf(!enabled)(
  'activates an existing User with their password and TOTP, counting a wrong password',
  async () => {
    const fixture = await activationFixture({
      roleCodes: ['employee'],
      existingUser: { withTotp: true },
    });
    const existing = fixture.existing!;
    try {
      const service = new AuthService();
      await expect(
        service.startActivation(
          fixture.token,
          { password: 'not the right passphrase' },
          activationRequest('wrong-password'),
        ),
      ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', statusCode: 401 });
      await expect(
        fixture.admin.signInThrottle.findUnique({ where: { emailHash: fixture.emailHash } }),
      ).resolves.toMatchObject({ failureCount: 1 });

      const started = await service.startActivation(
        fixture.token,
        { name: 'Ignored Name', password: existing.password },
        activationRequest('password'),
      );
      if (started.status !== 'CODE_REQUIRED') throw new Error('Expected a code challenge.');
      const passwordBefore = await fixture.admin.userPassword.findUniqueOrThrow({
        where: { userId: existing.id },
      });

      const done = await service.completeActivationWithTotp(
        fixture.token,
        started.pendingToken,
        totpCode(existing.totpSecret ?? ''),
        activationRequest('totp'),
      );
      expect(done.session.authenticationMethods).toEqual(['pwd', 'totp']);
      expect(done.session.context.agencyId).toBe(fixture.agency.id);

      const written = await fixture.written();
      expect(written.user).toMatchObject({
        id: existing.id,
        displayName: 'Existing Invitee',
        emailVerifiedAt: expect.any(Date),
      });
      expect(written.user?.password?.passwordHash).toBe(passwordBefore.passwordHash);
      expect(written.invitation.status).toBe('ACCEPTED');
      // A full sign-in clears the email's failures.
      await expect(
        fixture.admin.signInThrottle.findUnique({ where: { emailHash: fixture.emailHash } }),
      ).resolves.toBeNull();
    } finally {
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)('refuses a locked existing User and keeps the invitation', async () => {
  const fixture = await activationFixture({ existingUser: { globalStatus: 'LOCKED' } });
  try {
    await expect(
      new AuthService().startActivation(
        fixture.token,
        { password: fixture.existing!.password },
        activationRequest('locked'),
      ),
    ).rejects.toMatchObject({ code: 'USER_LOCKED', statusCode: 403 });
    await expect(fixture.written()).resolves.toMatchObject({
      invitation: { status: 'PENDING' },
      pending: [],
      user: { memberships: [] },
    });
  } finally {
    await fixture.cleanup();
  }
});

it.skipIf(!enabled)(
  'adds a new membership beside a deactivated one, and refuses an active one',
  async () => {
    const fixture = await activationFixture({ existingUser: {} });
    const existing = fixture.existing!;
    const deactivated = await fixture.admin.agencyMembership.create({
      data: {
        agencyId: fixture.agency.id,
        userId: existing.id,
        status: 'DEACTIVATED',
        deactivatedAt: new Date(),
        deactivationReason: 'Separated',
      },
    });
    try {
      const service = new AuthService();
      const started = await service.startActivation(
        fixture.token,
        { password: existing.password },
        activationRequest('rejoin'),
      );
      if (started.status !== 'ACTIVATED') throw new Error('Expected activation.');
      expect(started.session.context.membershipId).not.toBe(deactivated.id);
      await expect(
        fixture.admin.agencyMembership.findUniqueOrThrow({ where: { id: deactivated.id } }),
      ).resolves.toMatchObject({ status: 'DEACTIVATED', deactivationReason: 'Separated' });

      const second = await fixture.admin.invitation.create({
        data: {
          agencyId: fixture.agency.id,
          emailNormalized: fixture.email,
          invitedByMembershipId: fixture.inviterMembership.id,
          tokenHash: databaseBytes(hashSessionToken(`${fixture.token.slice(0, 42)}x`)),
          requestedRoleCodes: ['employee'],
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          status: 'PENDING',
        },
      });
      await expect(
        service.startActivation(
          `${fixture.token.slice(0, 42)}x`,
          { password: existing.password },
          activationRequest('active'),
        ),
      ).rejects.toMatchObject({ code: 'MEMBERSHIP_EXISTS', statusCode: 409 });
      await expect(
        fixture.admin.invitation.findUniqueOrThrow({ where: { id: second.id } }),
      ).resolves.toMatchObject({ status: 'PENDING' });
    } finally {
      await fixture.cleanup();
    }
  },
);

it.skipIf(!enabled)(
  'enrolls an existing User who becomes MFA-Required and signs out their other sessions',
  async () => {
    const fixture = await activationFixture({
      roleCodes: ['hrmo_administrator'],
      existingUser: {},
    });
    const existing = fixture.existing!;
    const priorMembership = await fixture.admin.agencyMembership.create({
      data: { agencyId: fixture.priorAgency.id, userId: existing.id, status: 'ACTIVE' },
    });
    const otherSession = await fixture.admin.userSession.create({
      data: {
        userId: existing.id,
        agencyId: fixture.priorAgency.id,
        agencyMembershipId: priorMembership.id,
        sessionTokenHash: databaseBytes(hashSessionToken(randomUUID())),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    try {
      const service = new AuthService();
      const started = await service.startActivation(
        fixture.token,
        { password: existing.password },
        activationRequest('existing-enroll'),
      );
      if (started.status !== 'ENROLLMENT_REQUIRED') throw new Error('Expected enrollment.');
      await service.confirmActivationEnrollment(
        fixture.token,
        started.pendingToken,
        totpCode(secretFromUri(started.enrollment.otpauthUri)),
        activationRequest('existing-confirm'),
      );
      const done = await service.finishActivationEnrollment(
        fixture.token,
        started.pendingToken,
        activationRequest('existing-finish'),
      );
      expect(done.session.authenticationMethods).toEqual(['pwd', 'totp']);
      await expect(
        fixture.admin.userSession.findUniqueOrThrow({ where: { id: otherSession.id } }),
      ).resolves.toMatchObject({ revocationReason: 'MFA_REQUIRED' });
    } finally {
      await fixture.cleanup();
    }
  },
);
