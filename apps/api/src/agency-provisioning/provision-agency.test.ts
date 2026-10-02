import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { totpCode } from '@lingkod-hr/auth';
import { createOperationalDatabaseClient } from '@lingkod-hr/database';
import { getConfig } from '@lingkod-hr/config';
import { expect, it } from 'vitest';
import { AuthService } from '../auth/auth.service';
import {
  AgencyProvisioningCommand,
  ProvisionAgencyCommandError,
  parseProvisionAgencyArgs,
} from './provision-agency';
import { InvitationIssuer } from '../invitations/invitation-issuer';
import { createMailDelivery, type MailDelivery, type MailMessage } from '../invitations/mail';

const enabled = process.env.DATABASE_E2E === 'true';

class RecordingMailDelivery implements MailDelivery {
  readonly messages: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.messages.push(message);
  }
}

class FailingMailDelivery implements MailDelivery {
  async send(): Promise<void> {
    throw new Error('mail transport unavailable');
  }
}

/** Runs the invitation's whole activation as a first-time User, enrolling TOTP when required. */
async function activate(service: AuthService, token: string, requestId: string) {
  const request = { requestId, ipAddress: '198.51.100.20' };
  const started = await service.startActivation(
    token,
    { name: 'First Administrator', password: 'tahimik na umaga sa bundok 42' },
    request,
  );
  if (started.status === 'ACTIVATED') return started.session;
  if (started.status !== 'ENROLLMENT_REQUIRED') throw new Error(started.status);
  const secret = new URL(started.enrollment.otpauthUri).searchParams.get('secret') ?? '';
  await service.confirmActivationEnrollment(token, started.pendingToken, totpCode(secret), request);
  return (await service.finishActivationEnrollment(token, started.pendingToken, request)).session;
}

async function createAdminClient(): Promise<PrismaClient> {
  const databaseUrl =
    process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
  if (!databaseUrl) throw new Error('DATABASE_E2E_ADMIN_URL is required for the integration test.');
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

function operationalDatabaseUrl(): string {
  const value = getConfig().DATABASE_OPERATIONAL_URL;
  if (!value) throw new Error('DATABASE_OPERATIONAL_URL is required for the integration test.');
  return value;
}

interface MailpitMessageSummary {
  ID: string;
  Subject: string;
  To: Array<{ Address: string }>;
}

interface MailpitMessagesResponse {
  messages: MailpitMessageSummary[];
}

interface MailpitMessage {
  Text: string;
}

async function readMailpitMessage(recipient: string, subject: string): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await fetch('http://localhost:8025/api/v1/messages');
    if (!response.ok) throw new Error('Mailpit message listing failed.');
    const payload = (await response.json()) as MailpitMessagesResponse;
    const summary = payload.messages.find(
      (message) =>
        message.Subject === subject && message.To.some(({ Address }) => Address === recipient),
    );
    if (summary) {
      const detailResponse = await fetch(`http://localhost:8025/api/v1/message/${summary.ID}`);
      if (!detailResponse.ok) throw new Error('Mailpit message lookup failed.');
      const detail = (await detailResponse.json()) as MailpitMessage;
      return detail.Text;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('The invitation message did not arrive in Mailpit.');
}

async function cleanup(
  admin: PrismaClient,
  agencyIds: readonly string[],
  userIds: readonly string[] = [],
): Promise<void> {
  await admin.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    await transaction.securityEvent.deleteMany({
      where: { OR: [{ agencyId: { in: [...agencyIds] } }, { userId: { in: [...userIds] } }] },
    });
    await transaction.auditEvent.deleteMany({ where: { agencyId: { in: [...agencyIds] } } });
  });
  if (userIds.length > 0) {
    await admin.userSession.deleteMany({ where: { userId: { in: [...userIds] } } });
    await admin.externalIdentityLink.deleteMany({ where: { userId: { in: [...userIds] } } });
    await admin.membershipRole.deleteMany({ where: { agencyId: { in: [...agencyIds] } } });
    await admin.agencyMembership.deleteMany({ where: { userId: { in: [...userIds] } } });
    await admin.user.deleteMany({ where: { id: { in: [...userIds] } } });
  }
  await admin.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    await transaction.agency.updateMany({
      where: { id: { in: [...agencyIds] } },
      data: { currentProfileVersionId: null },
    });
    await transaction.agencyProfileVersion.deleteMany({
      where: { agencyId: { in: [...agencyIds] } },
    });
    await transaction.invitation.deleteMany({ where: { agencyId: { in: [...agencyIds] } } });
    await transaction.agency.deleteMany({ where: { id: { in: [...agencyIds] } } });
  });
}

it('parses the documented non-HTTP provisioning command input', () => {
  expect(
    parseProvisionAgencyArgs([
      '--code',
      'DOST',
      '--name',
      'Department of Science and Technology',
      '--agency-type',
      'NGA',
      '--administrator-email',
      'Admin@Example.test',
    ]),
  ).toEqual({
    code: 'DOST',
    name: 'Department of Science and Technology',
    agencyType: 'NGA',
    administratorEmail: 'Admin@Example.test',
  });
});

it('rejects missing, unknown, and duplicate command options without exposing secrets', () => {
  expect(() => parseProvisionAgencyArgs(['--code', 'DOST'])).toThrow(
    new ProvisionAgencyCommandError('INVALID_INPUT', 'Missing required option: --name.'),
  );
  expect(() =>
    parseProvisionAgencyArgs([
      '--code',
      'DOST',
      '--name',
      'DOST',
      '--agency-type',
      'NGA',
      '--administrator-email',
      'admin@example.test',
      '--unexpected',
      'secret-token-value',
    ]),
  ).toThrow(/Unknown option: --unexpected/);
  expect(() =>
    parseProvisionAgencyArgs([
      '--code',
      'DOST',
      '--name',
      'DOST',
      '--agency-type',
      'NGA',
      '--administrator-email',
      'admin@example.test',
      '--code',
      'OTHER',
    ]),
  ).toThrow(/Option provided more than once: --code/);
});

it.skipIf(!enabled)(
  'provisions the Agency and first administrator through the public command boundary',
  async () => {
    const config = getConfig();
    const admin = await createAdminClient();
    const database = createOperationalDatabaseClient(operationalDatabaseUrl());
    const suffix = `${Date.now()}`;
    const email = `first-admin-${suffix}@example.test`;
    const requestId = `provision-${suffix}`;
    const mail = createMailDelivery(config);
    const command = new AgencyProvisioningCommand({
      database,
      invitationIssuer: new InvitationIssuer(mail, config.APP_URL),
      requestId: () => requestId,
    });
    let agencyId: string | undefined;
    let userId: string | undefined;

    try {
      const result = await command.execute({
        code: `E2E-I60-${suffix}`,
        name: 'Issue 60 Provisioning Agency',
        agencyType: 'NGA',
        administratorEmail: email,
      });
      agencyId = result.agency.id;

      expect(result.invitation.roleCodes).toEqual(['agency_administrator']);
      const messageText = await readMailpitMessage(
        email,
        `LingkodHR invitation for ${result.agency.name}`,
      );
      expect(messageText).toContain(result.agency.name);
      const token = /\/invite\/([A-Za-z0-9_-]+)/.exec(messageText)?.[1];
      if (!token) throw new Error('The invitation email did not contain an activation link.');
      expect(JSON.stringify(result)).not.toContain(token);

      await expect(
        admin.user.findUnique({ where: { emailNormalized: email } }),
      ).resolves.toBeNull();
      await expect(
        admin.invitation.findUniqueOrThrow({ where: { id: result.invitation.id } }),
      ).resolves.toMatchObject({
        agencyId,
        emailNormalized: email,
        invitedByMembershipId: null,
        requestedRoleCodes: ['agency_administrator'],
        status: 'PENDING',
      });
      const provisioningAudit = await admin.auditEvent.findFirstOrThrow({
        where: { agencyId, action: 'AGENCY_PROVISIONED' },
      });
      const invitationAudit = await admin.auditEvent.findFirstOrThrow({
        where: { agencyId, action: 'INVITATION_CREATED' },
      });
      expect(provisioningAudit).toMatchObject({
        actorType: 'SYSTEM',
        requestId,
        newStatus: 'ACTIVE',
      });
      expect(invitationAudit).toMatchObject({ actorType: 'SYSTEM', requestId });
      expect(JSON.stringify(provisioningAudit.metadata)).not.toContain(token);
      expect(JSON.stringify(invitationAudit.metadata)).not.toContain(token);

      const runtime = new PrismaClient({ datasources: { db: { url: config.DATABASE_URL } } });
      try {
        await expect(
          runtime.$transaction(async (transaction) => {
            await transaction.$queryRaw`
            SELECT set_config('app.agency_id', '11111111-1111-4111-8111-111111111111', true),
                   set_config('app.operational_provisioning', 'true', true)
          `;
            return transaction.agency.create({
              data: {
                id: '11111111-1111-4111-8111-111111111111',
                code: `APP-DENIED-${suffix}`,
                name: 'Denied runtime Agency',
                agencyType: 'NGA',
                status: 'ACTIVE',
              },
            });
          }),
        ).rejects.toThrow(/row-level security/i);
      } finally {
        await runtime.$disconnect();
      }

      const login = await activate(new AuthService(mail), token, `${requestId}-accept`);
      userId = login.context.userId;
      expect(login.context.agencyId).toBe(agencyId);
      await expect(
        admin.membershipRole.findFirstOrThrow({
          where: { agencyId, membershipId: login.context.membershipId },
        }),
      ).resolves.toMatchObject({ assignedByMembershipId: null });
      await expect(
        activate(new AuthService(mail), token, `${requestId}-reuse`),
      ).rejects.toMatchObject({ code: 'INVITATION_INVALID' });
    } finally {
      await cleanup(admin, agencyId ? [agencyId] : [], userId ? [userId] : []);
      await database.$disconnect();
      await admin.$disconnect();
    }
  },
);

it.skipIf(!enabled)(
  'runs the documented provisioning command against local dependencies',
  async () => {
    const config = getConfig();
    const admin = await createAdminClient();
    const suffix = `${Date.now()}-cli`;
    const code = `E2E-I64-${suffix}`;
    const email = `first-admin-${suffix}@example.test`;
    let agencyId: string | undefined;

    try {
      const output = execFileSync(
        'pnpm',
        [
          '--filter',
          '@lingkod-hr/api',
          'provision:agency',
          '--',
          '--code',
          code,
          '--name',
          'Issue 64 Command Boundary Agency',
          '--agency-type',
          'NGA',
          '--administrator-email',
          email,
        ],
        {
          cwd: resolve(__dirname, '../../../..'),
          env: {
            ...process.env,
            API_URL: config.API_URL,
            DATABASE_OPERATIONAL_URL: operationalDatabaseUrl(),
            EMAIL_HOST: 'localhost',
            EMAIL_PORT: '1025',
            EMAIL_SECURE: 'false',
          },
          encoding: 'utf8',
        },
      );
      expect(output).toContain(`Agency provisioned: ${code}`);

      const agency = await admin.agency.findUniqueOrThrow({ where: { code } });
      agencyId = agency.id;
      expect(agency).toMatchObject({
        name: 'Issue 64 Command Boundary Agency',
        agencyType: 'NGA',
        status: 'ACTIVE',
      });
      const invitation = await admin.invitation.findFirstOrThrow({ where: { agencyId } });
      expect(invitation).toMatchObject({
        emailNormalized: email,
        invitedByMembershipId: null,
        requestedRoleCodes: ['agency_administrator'],
        status: 'PENDING',
      });

      const messageText = await readMailpitMessage(
        email,
        'LingkodHR invitation for Issue 64 Command Boundary Agency',
      );
      const token = /\/invite\/([A-Za-z0-9_-]+)/.exec(messageText)?.[1];
      if (!token) throw new Error('The command-boundary invitation email did not contain a token.');
      expect(output).not.toContain(token);
      expect(messageText).toContain('Agency Administrator');
      await expect(
        admin.auditEvent.count({ where: { agencyId, action: 'AGENCY_PROVISIONED' } }),
      ).resolves.toBe(1);
      await expect(
        admin.auditEvent.count({ where: { agencyId, action: 'INVITATION_CREATED' } }),
      ).resolves.toBe(1);
    } finally {
      await cleanup(admin, agencyId ? [agencyId] : []);
      await admin.$disconnect();
    }
  },
);

it.skipIf(!enabled)('rolls back the Agency when invitation persistence fails', async () => {
  const admin = await createAdminClient();
  const database = createOperationalDatabaseClient(operationalDatabaseUrl());
  const issuer = {
    issueInTransaction: async () => {
      throw new Error('forced persistence failure');
    },
    deliver: async () => undefined,
  } as unknown as InvitationIssuer;
  const code = `E2E-I60-ROLLBACK-${Date.now()}`;
  const command = new AgencyProvisioningCommand({ database, invitationIssuer: issuer });

  try {
    await expect(
      command.execute({
        code,
        name: 'Issue 60 Rollback Agency',
        agencyType: 'NGA',
        administratorEmail: 'rollback@example.test',
      }),
    ).rejects.toMatchObject({ code: 'PERSISTENCE_FAILED' });
    await expect(admin.agency.findUnique({ where: { code } })).resolves.toBeNull();
  } finally {
    await database.$disconnect();
    await admin.$disconnect();
  }
});

it.skipIf(!enabled)('rejects an expired provisioned invitation', async () => {
  const config = getConfig();
  const admin = await createAdminClient();
  const database = createOperationalDatabaseClient(operationalDatabaseUrl());
  const mail = new RecordingMailDelivery();
  const suffix = `${Date.now()}`;
  const email = `expired-${suffix}@example.test`;
  const command = new AgencyProvisioningCommand({
    database,
    invitationIssuer: new InvitationIssuer(mail, config.APP_URL),
    requestId: () => `provision-expired-${suffix}`,
  });
  let agencyId: string | undefined;

  try {
    const result = await command.execute({
      code: `E2E-I60-EXPIRED-${suffix}`,
      name: 'Issue 60 Expired Invitation Agency',
      agencyType: 'NGA',
      administratorEmail: email,
    });
    agencyId = result.agency.id;
    const message = mail.messages[0];
    if (!message) throw new Error('The invitation email was not captured.');
    const token = /\/invite\/([A-Za-z0-9_-]+)/.exec(message.text)?.[1];
    if (!token) throw new Error('The invitation email did not contain an activation link.');
    const expiredCreatedAt = new Date(Date.now() - 2_000);
    const expiredAt = new Date(Date.now() - 1_000);
    await admin.invitation.update({
      where: { id: result.invitation.id },
      data: { createdAt: expiredCreatedAt, expiresAt: expiredAt },
    });

    await expect(
      activate(new AuthService(mail), token, `accept-expired-${suffix}`),
    ).rejects.toMatchObject({ code: 'INVITATION_EXPIRED' });
    // An expired invitation is refused without being written.
    await expect(
      admin.invitation.findUniqueOrThrow({ where: { id: result.invitation.id } }),
    ).resolves.toMatchObject({
      status: 'PENDING',
    });
  } finally {
    await cleanup(admin, agencyId ? [agencyId] : []);
    await database.$disconnect();
    await admin.$disconnect();
  }
});

it.skipIf(!enabled)('cancels the complete provisioning state when delivery fails', async () => {
  const config = getConfig();
  const admin = await createAdminClient();
  const database = createOperationalDatabaseClient(operationalDatabaseUrl());
  const suffix = `${Date.now()}`;
  const code = `E2E-I60-MAIL-${suffix}`;
  const command = new AgencyProvisioningCommand({
    database,
    invitationIssuer: new InvitationIssuer(new FailingMailDelivery(), config.APP_URL),
    requestId: () => `provision-mail-${suffix}`,
  });
  let agencyId: string | undefined;

  try {
    await expect(
      command.execute({
        code,
        name: 'Issue 60 Mail Failure Agency',
        agencyType: 'NGA',
        administratorEmail: `mail-failure-${suffix}@example.test`,
      }),
    ).rejects.toMatchObject({ code: 'DELIVERY_FAILED' });
    const agency = await admin.agency.findUniqueOrThrow({ where: { code } });
    agencyId = agency.id;
    expect(agency.status).toBe('SUSPENDED');
    await expect(admin.invitation.count({ where: { agencyId, status: 'PENDING' } })).resolves.toBe(
      0,
    );
    await expect(admin.invitation.findFirstOrThrow({ where: { agencyId } })).resolves.toMatchObject(
      { status: 'CANCELLED' },
    );
  } finally {
    await cleanup(admin, agencyId ? [agencyId] : []);
    await database.$disconnect();
    await admin.$disconnect();
  }
});
