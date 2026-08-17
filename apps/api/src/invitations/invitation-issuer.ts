import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { hashSessionToken } from '@lingkod-hr/auth';
import type { MailDelivery } from './mail';
import { MailDeliveryError } from './mail';
import { prismaBytes, safeJson, selectInvitationRoles } from './invitation-utils';

export const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export type InvitationActorType = 'USER' | 'SYSTEM';

export interface InvitationActor {
  type: InvitationActorType;
  userId: string | null;
  membershipId: string | null;
}

export interface IssueInvitationInput {
  agencyId: string;
  email: string;
  roleCodes: readonly string[];
  invitedByMembershipId: string | null;
  actor: InvitationActor;
  requestId: string;
}

export interface IssuedInvitation {
  id: string;
  email: string;
  expiresAt: Date;
  activationToken: string;
  activationUrl: string;
  agencyCode: string;
  agencyName: string;
  roleNames: string[];
}

export interface CancelInvitationInput {
  agencyId: string;
  invitationId: string;
  requestId: string;
  actor: InvitationActor;
  reason: string;
}

export class InvitationIssueError extends Error {
  constructor(
    readonly code:
      | 'INVALID_EMAIL'
      | 'ROLE_REQUIRED'
      | 'ROLE_NOT_FOUND'
      | 'AGENCY_NOT_FOUND'
      | 'MEMBERSHIP_EXISTS'
      | 'INVITATION_PENDING',
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = 'InvitationIssueError';
  }
}

export class InvitationDeliveryError extends Error {
  constructor() {
    super('Invitation delivery failed.');
    this.name = 'InvitationDeliveryError';
  }
}

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new InvitationIssueError('INVALID_EMAIL', 'A valid email address is required.');
  }
  return normalized;
}

function normalizeRoleCodes(roleCodes: readonly string[]): string[] {
  return [...new Set(roleCodes.map((code) => code.trim().toLowerCase()).filter(Boolean))];
}

function activationUrl(apiUrl: string, token: string): string {
  return `${apiUrl.replace(/\/$/, '')}/api/v1/auth/invitations/${token}/activate`;
}

export class InvitationIssuer {
  constructor(
    private readonly mailDelivery: MailDelivery,
    private readonly apiUrl: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async issueInTransaction(
    transaction: Prisma.TransactionClient,
    input: IssueInvitationInput,
  ): Promise<IssuedInvitation> {
    const normalizedEmail = normalizeEmail(input.email);
    const requestedRoleCodes = normalizeRoleCodes(input.roleCodes);
    if (requestedRoleCodes.length === 0) {
      throw new InvitationIssueError('ROLE_REQUIRED', 'At least one Agency role is required.');
    }

    const agency = await transaction.agency.findUnique({
      where: { id: input.agencyId },
      select: { code: true, name: true },
    });
    if (!agency) {
      throw new InvitationIssueError('AGENCY_NOT_FOUND', 'The Agency does not exist.', 404);
    }

    const availableRoles = await transaction.role.findMany({
      where: {
        code: { in: requestedRoleCodes },
        status: 'ACTIVE',
        OR: [{ agencyId: null }, { agencyId: input.agencyId }],
      },
      select: { agencyId: true, code: true, name: true },
    });
    const roles = selectInvitationRoles(availableRoles, requestedRoleCodes, input.agencyId);
    if (roles.length !== requestedRoleCodes.length) {
      throw new InvitationIssueError(
        'ROLE_NOT_FOUND',
        'One or more requested roles are unavailable.',
      );
    }

    const emailOwner = await transaction.user.findUnique({
      where: { emailNormalized: normalizedEmail },
      select: { id: true },
    });
    const existingMembership = emailOwner
      ? await transaction.agencyMembership.findFirst({
          where: { agencyId: input.agencyId, userId: emailOwner.id },
          select: { status: true },
        })
      : null;
    if (existingMembership && existingMembership.status !== 'INVITED') {
      throw new InvitationIssueError(
        'MEMBERSHIP_EXISTS',
        'The User already has an Agency Membership.',
        409,
      );
    }

    const now = this.now();
    const expiresAt = new Date(now.getTime() + INVITATION_LIFETIME_MS);
    const activationToken = randomBytes(32).toString('base64url');

    try {
      const expiredInvitations = await transaction.invitation.updateManyAndReturn({
        where: {
          agencyId: input.agencyId,
          emailNormalized: normalizedEmail,
          status: 'PENDING',
          expiresAt: { lte: now },
        },
        data: { status: 'EXPIRED' },
        select: { id: true },
      });
      for (const expiredInvitation of expiredInvitations) {
        await this.recordSecurityEvent(transaction, input, 'INVITATION_EXPIRED', {
          invitationId: expiredInvitation.id,
        });
        await this.recordAuditEvent(transaction, input, {
          action: 'INVITATION_EXPIRED',
          entityType: 'Invitation',
          entityId: expiredInvitation.id,
          previousStatus: 'PENDING',
          newStatus: 'EXPIRED',
          metadata: {},
        });
      }

      const invitation = await transaction.invitation.create({
        data: {
          agencyId: input.agencyId,
          emailNormalized: normalizedEmail,
          invitedByMembershipId: input.invitedByMembershipId,
          tokenHash: prismaBytes(hashSessionToken(activationToken)),
          requestedRoleCodes,
          expiresAt,
          status: 'PENDING',
        },
      });
      await this.recordSecurityEvent(transaction, input, 'INVITATION_CREATED', {
        invitationId: invitation.id,
        email: normalizedEmail,
        roleCodes: roles.map(({ code }) => code),
      });
      await this.recordAuditEvent(transaction, input, {
        action: 'INVITATION_CREATED',
        entityType: 'Invitation',
        entityId: invitation.id,
        metadata: { email: normalizedEmail, roleCodes: roles.map(({ code }) => code) },
      });

      return {
        id: invitation.id,
        email: normalizedEmail,
        expiresAt,
        activationToken,
        activationUrl: activationUrl(this.apiUrl, activationToken),
        agencyCode: agency.code,
        agencyName: agency.name,
        roleNames: roles.map(({ name }) => name),
      };
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new InvitationIssueError(
          'INVITATION_PENDING',
          'A pending invitation already exists for this email.',
          409,
        );
      }
      throw error;
    }
  }

  async deliver(invitation: IssuedInvitation): Promise<void> {
    const roles = invitation.roleNames.join(', ');
    try {
      await this.mailDelivery.send({
        to: invitation.email,
        subject: `LingkodHR invitation for ${invitation.agencyName}`,
        text: [
          `You have been invited to LingkodHR for ${invitation.agencyName} (${invitation.agencyCode}).`,
          '',
          `Agency role: ${roles}`,
          `This single-use invitation expires on ${invitation.expiresAt.toISOString()}.`,
          '',
          `Activate your access: ${invitation.activationUrl}`,
          '',
          'The link can be used once. Identity is established through the approved sign-in provider.',
        ].join('\n'),
      });
    } catch (error: unknown) {
      if (error instanceof InvitationDeliveryError) throw error;
      if (error instanceof MailDeliveryError) throw new InvitationDeliveryError();
      throw new InvitationDeliveryError();
    }
  }

  async cancelPendingInvitationInTransaction(
    transaction: Prisma.TransactionClient,
    input: CancelInvitationInput,
  ): Promise<boolean> {
    const cancelledInvitation = await transaction.invitation.updateMany({
      where: { id: input.invitationId, agencyId: input.agencyId, status: 'PENDING' },
      data: { status: 'CANCELLED', cancelledAt: this.now() },
    });
    if (cancelledInvitation.count === 0) return false;

    await this.recordSecurityEvent(transaction, input, 'INVITATION_CANCELLED', {
      invitationId: input.invitationId,
      reason: input.reason,
    });
    await this.recordAuditEvent(transaction, input, {
      action: 'INVITATION_CANCELLED',
      entityType: 'Invitation',
      entityId: input.invitationId,
      previousStatus: 'PENDING',
      newStatus: 'CANCELLED',
      metadata: {},
    });
    return true;
  }

  private async recordSecurityEvent(
    transaction: Prisma.TransactionClient,
    input: Pick<IssueInvitationInput, 'agencyId' | 'actor' | 'requestId'>,
    eventType: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    await transaction.securityEvent.create({
      data: {
        agencyId: input.agencyId,
        userId: input.actor.userId,
        membershipId: input.actor.membershipId,
        eventType,
        requestId: input.requestId,
        details: safeJson(details),
      },
    });
  }

  private async recordAuditEvent(
    transaction: Prisma.TransactionClient,
    input: Pick<IssueInvitationInput, 'agencyId' | 'actor' | 'requestId'>,
    event: {
      action: string;
      entityType: string;
      entityId: string;
      actor?: InvitationActor;
      previousStatus?: string;
      newStatus?: string;
      metadata: Record<string, unknown>;
    },
  ): Promise<void> {
    await transaction.auditEvent.create({
      data: {
        agencyId: input.agencyId,
        actorUserId: (event.actor ?? input.actor).userId,
        actorMembershipId: (event.actor ?? input.actor).membershipId,
        actorType: event.actor?.type ?? input.actor.type,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        previousStatus: event.previousStatus ?? null,
        newStatus: event.newStatus ?? null,
        requestId: input.requestId,
        metadata: safeJson(event.metadata),
      },
    });
  }
}
