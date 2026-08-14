import { Prisma, PrismaClient } from '@prisma/client';
import { createRequestId } from '@lingkod-hr/observability';
import { createOperationalDatabaseClient, setDatabaseContext } from '@lingkod-hr/database';
import { getConfig } from '@lingkod-hr/config';
import { z } from 'zod';
import { createMailDelivery, type MailDelivery } from '../invitations/mail';
import { InvitationIssueError, InvitationIssuer } from '../invitations/invitation-issuer';

const agencyType = z.enum(['NGA', 'LGU', 'SUC', 'GOCC_ORIGINAL_CHARTER', 'OTHER']);
const agencyText = (maximum: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maximum)
    .refine((value) => !/[\r\n]/.test(value));

export const provisionAgencyInputSchema = z
  .object({
    code: agencyText(100),
    name: agencyText(255),
    agencyType,
    administratorEmail: z.string().trim().email().max(320),
  })
  .strict();

export type ProvisionAgencyInput = z.infer<typeof provisionAgencyInputSchema>;

export interface ProvisionAgencyResult {
  requestId: string;
  agency: {
    id: string;
    code: string;
    name: string;
    agencyType: string;
    status: 'ACTIVE';
  };
  invitation: {
    id: string;
    email: string;
    expiresAt: Date;
    roleCodes: ['agency_administrator'];
  };
}

export type ProvisionAgencyErrorCode =
  'INVALID_INPUT' | 'AGENCY_EXISTS' | 'PERSISTENCE_FAILED' | 'DELIVERY_FAILED';

export class ProvisionAgencyCommandError extends Error {
  constructor(
    readonly code: ProvisionAgencyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ProvisionAgencyCommandError';
  }
}

const optionNames = {
  '--code': 'code',
  '--name': 'name',
  '--agency-type': 'agencyType',
  '--administrator-email': 'administratorEmail',
} as const;

type OptionName = keyof typeof optionNames;

function invalidInput(message: string): ProvisionAgencyCommandError {
  return new ProvisionAgencyCommandError('INVALID_INPUT', message);
}

export function parseProvisionAgencyArgs(args: readonly string[]): ProvisionAgencyInput {
  const values: Partial<Record<keyof ProvisionAgencyInput, string>> = {};
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (!(option && option in optionNames)) {
      throw invalidInput(`Unknown option: ${option ?? '<missing>'}.`);
    }
    const optionName = option as OptionName;
    const key = optionNames[optionName];
    if (values[key] !== undefined) {
      throw invalidInput(`Option provided more than once: ${optionName}.`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      throw invalidInput(`Missing value for ${optionName}.`);
    }
    values[key] = value;
    index += 1;
  }

  for (const [key, option] of Object.entries(optionNames)) {
    if (values[option] === undefined) {
      throw invalidInput(`Missing required option: ${key}.`);
    }
  }

  const parsed = provisionAgencyInputSchema.safeParse(values);
  if (!parsed.success) throw invalidInput('Agency provisioning input is invalid.');
  return parsed.data;
}

export interface AgencyProvisioningDependencies {
  database: PrismaClient;
  invitationIssuer: InvitationIssuer;
  requestId?: () => string;
}

function requiredOperationalDatabaseUrl(value: string | undefined): string {
  if (!value) {
    throw new ProvisionAgencyCommandError(
      'PERSISTENCE_FAILED',
      'Agency provisioning requires DATABASE_OPERATIONAL_URL.',
    );
  }
  return value;
}

export class AgencyProvisioningCommand {
  private readonly requestId: () => string;

  constructor(private readonly dependencies: AgencyProvisioningDependencies) {
    this.requestId = dependencies.requestId ?? createRequestId;
  }

  async execute(input: unknown): Promise<ProvisionAgencyResult> {
    const parsed = provisionAgencyInputSchema.safeParse(input);
    if (!parsed.success) throw invalidInput('Agency provisioning input is invalid.');
    const normalizedInput = {
      ...parsed.data,
      code: parsed.data.code.trim(),
      name: parsed.data.name.trim(),
      administratorEmail: parsed.data.administratorEmail.trim().toLowerCase(),
    };
    const requestId = this.requestId();

    let provisioned: {
      agency: ProvisionAgencyResult['agency'];
      invitation: Awaited<ReturnType<InvitationIssuer['issueInTransaction']>>;
    };
    try {
      provisioned = await this.dependencies.database.$transaction(async (transaction) => {
        await setDatabaseContext(transaction, { operationalProvisioning: true });
        const agency = await transaction.agency.create({
          data: {
            code: normalizedInput.code,
            name: normalizedInput.name,
            agencyType: normalizedInput.agencyType,
            status: 'ACTIVE',
          },
        });
        await setDatabaseContext(transaction, {
          agencyId: agency.id,
          operationalProvisioning: true,
        });
        await transaction.securityEvent.create({
          data: {
            agencyId: agency.id,
            eventType: 'AGENCY_PROVISIONED',
            requestId,
            details: {
              agencyType: normalizedInput.agencyType,
              code: normalizedInput.code,
            },
          },
        });
        await transaction.auditEvent.create({
          data: {
            agencyId: agency.id,
            actorType: 'SYSTEM',
            action: 'AGENCY_PROVISIONED',
            entityType: 'Agency',
            entityId: agency.id,
            newStatus: 'ACTIVE',
            requestId,
            metadata: {
              agencyType: normalizedInput.agencyType,
              code: normalizedInput.code,
              name: normalizedInput.name,
            },
          },
        });
        const invitation = await this.dependencies.invitationIssuer.issueInTransaction(
          transaction,
          {
            agencyId: agency.id,
            email: normalizedInput.administratorEmail,
            roleCodes: ['agency_administrator'],
            invitedByMembershipId: null,
            actor: { type: 'SYSTEM', userId: null, membershipId: null },
            requestId,
          },
        );
        return {
          agency: {
            id: agency.id,
            code: agency.code,
            name: agency.name,
            agencyType: agency.agencyType,
            status: 'ACTIVE' as const,
          },
          invitation,
        };
      });
    } catch (error: unknown) {
      if (error instanceof InvitationIssueError) {
        if (error.code === 'INVITATION_PENDING') {
          throw new ProvisionAgencyCommandError(
            'AGENCY_EXISTS',
            'The Agency could not be provisioned because its identity already exists.',
          );
        }
        throw new ProvisionAgencyCommandError('PERSISTENCE_FAILED', error.message);
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ProvisionAgencyCommandError(
          'AGENCY_EXISTS',
          'An Agency with this identity already exists.',
        );
      }
      throw new ProvisionAgencyCommandError(
        'PERSISTENCE_FAILED',
        'Agency provisioning could not be persisted.',
      );
    }

    try {
      await this.dependencies.invitationIssuer.deliver(provisioned.invitation);
    } catch {
      await this.compensateDeliveryFailure(
        provisioned.agency.id,
        provisioned.invitation.id,
        requestId,
      );
      throw new ProvisionAgencyCommandError(
        'DELIVERY_FAILED',
        'Agency provisioning could not be completed because the administrator invitation could not be delivered.',
      );
    }

    return {
      requestId,
      agency: provisioned.agency,
      invitation: {
        id: provisioned.invitation.id,
        email: provisioned.invitation.email,
        expiresAt: provisioned.invitation.expiresAt,
        roleCodes: ['agency_administrator'],
      },
    };
  }

  private async compensateDeliveryFailure(
    agencyId: string,
    invitationId: string,
    requestId: string,
  ): Promise<void> {
    try {
      await this.dependencies.database.$transaction(async (transaction) => {
        await setDatabaseContext(transaction, {
          agencyId,
          operationalProvisioning: true,
        });
        const cancelledInvitation =
          await this.dependencies.invitationIssuer.cancelPendingInvitationInTransaction(
            transaction,
            {
              agencyId,
              invitationId,
              requestId,
              actor: { type: 'SYSTEM', userId: null, membershipId: null },
              reason: 'INVITATION_DELIVERY_FAILED',
            },
          );
        if (!cancelledInvitation) return;

        await transaction.agency.update({
          where: { id: agencyId },
          data: { status: 'SUSPENDED' },
        });
        await transaction.securityEvent.create({
          data: {
            agencyId,
            eventType: 'AGENCY_PROVISIONING_FAILED',
            requestId,
            details: { invitationId, reason: 'INVITATION_DELIVERY_FAILED' },
          },
        });
        await transaction.auditEvent.create({
          data: {
            agencyId,
            actorType: 'SYSTEM',
            action: 'AGENCY_PROVISIONING_FAILED',
            entityType: 'Agency',
            entityId: agencyId,
            previousStatus: 'ACTIVE',
            newStatus: 'SUSPENDED',
            reason: 'INVITATION_DELIVERY_FAILED',
            requestId,
            metadata: { invitationId },
          },
        });
      });
    } catch {
      throw new ProvisionAgencyCommandError(
        'PERSISTENCE_FAILED',
        'Agency provisioning could not be safely rolled back after invitation delivery failed.',
      );
    }
  }
}

export function createAgencyProvisioningCommand(
  database: PrismaClient,
  mailDelivery: MailDelivery,
): AgencyProvisioningCommand {
  const config = getConfig();
  return new AgencyProvisioningCommand({
    database,
    invitationIssuer: new InvitationIssuer(mailDelivery, config.API_URL),
  });
}

export async function runProvisionAgencyCommand(
  args: readonly string[] = process.argv.slice(2),
): Promise<number> {
  let database: PrismaClient | undefined;
  try {
    const input = parseProvisionAgencyArgs(args[0] === '--' ? args.slice(1) : args);
    const config = getConfig();
    database = createOperationalDatabaseClient(
      requiredOperationalDatabaseUrl(config.DATABASE_OPERATIONAL_URL),
    );
    const command = createAgencyProvisioningCommand(database, createMailDelivery(config));
    const result = await command.execute(input);
    process.stdout.write(
      [
        `Agency provisioned: ${result.agency.code} (${result.agency.id})`,
        `Administrator invitation sent to ${result.invitation.email}.`,
        `Invitation expires: ${result.invitation.expiresAt.toISOString()}`,
      ].join('\n') + '\n',
    );
    return 0;
  } catch (error: unknown) {
    const commandError =
      error instanceof ProvisionAgencyCommandError
        ? error
        : new ProvisionAgencyCommandError('PERSISTENCE_FAILED', 'Agency provisioning failed.');
    process.stderr.write(`Agency provisioning failed: ${commandError.message}\n`);
    return 1;
  } finally {
    await database?.$disconnect();
  }
}

if (require.main === module) {
  void runProvisionAgencyCommand().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
