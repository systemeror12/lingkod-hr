import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  createSessionToken,
  hashSessionToken,
  hasMfaEvidence,
  hasPermission,
  isSessionActive,
  OidcClient,
  type OidcIdentity,
  type PermissionGrant,
  type RequestContext,
  permissionsRequireMfa,
  SCOPE_POLICIES,
  sessionExpiry,
} from '@lingkod-hr/auth';
import { getConfig } from '@lingkod-hr/config';
import { setDatabaseContext, withDatabaseContext } from '@lingkod-hr/database';

const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const OIDC_FLOW_LIFETIME_MS = 10 * 60 * 1000;

export const SESSION_COOKIE = 'hris_session';
export const OIDC_FLOW_COOKIE = 'hris_oidc_flow';

interface OidcFlowState {
  state: string;
  nonce: string;
  verifier: string;
  issuedAt: number;
  invitationToken: string | null;
  membershipId: string | null;
}

export interface LoginStart {
  authorizationUrl: string;
  flowCookie: string;
}

export interface AuthenticatedSession {
  sessionId: string;
  providerSid: string | null;
  authenticationMethods: readonly string[];
  authTime: Date | null;
  createdAt: Date;
  expiresAt: Date;
  context: RequestContext;
}

export interface LoginResult extends AuthenticatedSession {
  token: string;
  providerLogoutUrl: string | null;
}

export interface InvitationResult {
  id: string;
  email: string;
  expiresAt: Date;
  activationToken: string;
}

type SignInTransactionResult =
  | { status: 'invitation_expired' }
  | { status: 'authenticated'; session: AuthenticatedSession & { token: string } };

export class AuthServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
    readonly code = 'AUTHENTICATION_ERROR',
  ) {
    super(message);
    this.name = 'AuthServiceError';
  }
}

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new AuthServiceError('A valid email address is required.', 400, 'INVALID_EMAIL');
  }
  return normalized;
}

function normalizeRoleCodes(roleCodes: readonly string[]): string[] {
  return [...new Set(roleCodes.map((code) => code.trim().toLowerCase()).filter(Boolean))];
}

function selectInvitationRoles<T extends { agencyId: string | null; code: string }>(
  roles: readonly T[],
  roleCodes: readonly string[],
  agencyId: string,
): T[] {
  const selected = new Map<string, T>();
  for (const role of roles) {
    const code = role.code.toLowerCase();
    if (!selected.has(code) || role.agencyId === agencyId) selected.set(code, role);
  }
  return roleCodes.flatMap((code) => (selected.has(code) ? [selected.get(code)!] : []));
}

function prismaBytes(value: Buffer): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(value.byteLength));
  bytes.set(value);
  return bytes;
}

function safeJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === null) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

@Injectable()
export class AuthService {
  private readonly config = getConfig();
  private readonly oidc = new OidcClient({
    issuer: this.config.OIDC_ISSUER,
    clientId: this.config.OIDC_CLIENT_ID,
    clientSecret: this.config.OIDC_CLIENT_SECRET,
    redirectUri: this.config.OIDC_REDIRECT_URI,
  });

  async beginLogin(
    invitationToken: string | null,
    membershipId: string | null,
  ): Promise<LoginStart> {
    const state: OidcFlowState = {
      state: createSessionToken(),
      nonce: createSessionToken(),
      verifier: createSessionToken(),
      issuedAt: Date.now(),
      invitationToken,
      membershipId,
    };
    return {
      authorizationUrl: await this.oidc.authorizationUrl(state.state, state.nonce, state.verifier),
      flowCookie: this.signFlowState(state),
    };
  }

  async completeLogin(
    flowCookie: string,
    returnedState: string,
    code: string,
    requestId = 'oidc',
  ): Promise<LoginResult> {
    const flow = this.readFlowState(flowCookie);
    if (flow.state !== returnedState) {
      throw new AuthServiceError('The authentication state is invalid.', 401, 'OIDC_STATE_INVALID');
    }
    const identity = await this.oidc.verifyIdToken(
      await this.oidc.exchangeCode(code, flow.verifier),
      flow.nonce,
    );
    return this.signIn(identity, flow.membershipId, flow.invitationToken, requestId);
  }

  async assertLoginAllowed(ipAddress: string): Promise<void> {
    const since = new Date(Date.now() - 15 * 60 * 1000);
    const failures = await withDatabaseContext({ platformSecurity: true }, (transaction) =>
      transaction.securityEvent.count({
        where: {
          eventType: 'LOGIN_FAILURE',
          ipAddress: ipAddress ?? null,
          occurredAt: { gte: since },
        },
      }),
    );
    if (failures >= 20) {
      throw new AuthServiceError(
        'Too many authentication attempts. Try again later.',
        429,
        'AUTHENTICATION_RATE_LIMITED',
      );
    }
  }

  async signIn(
    identity: OidcIdentity,
    selectedMembershipId: string | null = null,
    invitationToken: string | null = null,
    requestId = 'oidc',
  ): Promise<LoginResult> {
    if (identity.issuer !== this.config.OIDC_ISSUER) {
      throw new AuthServiceError('The identity provider is not trusted.', 401, 'ISSUER_INVALID');
    }
    if (!identity.emailVerified) {
      throw new AuthServiceError('A verified identity is required.', 401, 'EMAIL_NOT_VERIFIED');
    }

    const transactionResult: SignInTransactionResult = await withDatabaseContext(
      {},
      async (transaction) => {
        const now = new Date();
        const invitationTokenHash = invitationToken ? hashSessionToken(invitationToken) : null;
        if (invitationTokenHash) {
          await setDatabaseContext(transaction, {
            invitationTokenHash: invitationTokenHash.toString('hex'),
          });
          const invitation = await transaction.invitation.findFirst({
            where: { tokenHash: prismaBytes(invitationTokenHash), status: 'PENDING' },
            select: { id: true, agencyId: true, expiresAt: true },
          });
          if (invitation && invitation.expiresAt <= now) {
            await setDatabaseContext(transaction, { agencyId: invitation.agencyId });
            await transaction.invitation.update({
              where: { id: invitation.id },
              data: { status: 'EXPIRED' },
            });
            await transaction.securityEvent.create({
              data: {
                agencyId: invitation.agencyId,
                eventType: 'INVITATION_EXPIRED',
                requestId,
                details: { invitationId: invitation.id },
              },
            });
            await transaction.auditEvent.create({
              data: {
                agencyId: invitation.agencyId,
                actorType: 'SYSTEM',
                action: 'INVITATION_EXPIRED',
                entityType: 'Invitation',
                entityId: invitation.id,
                previousStatus: 'PENDING',
                newStatus: 'EXPIRED',
                requestId,
                metadata: {},
              },
            });
            return { status: 'invitation_expired' as const };
          }
        }

        const user = await this.resolveIdentity(transaction, identity);
        if (user.globalStatus !== 'ACTIVE') {
          throw new AuthServiceError('This identity is not active.', 403, 'USER_NOT_ACTIVE');
        }

        if (invitationTokenHash) {
          await setDatabaseContext(transaction, {
            userId: user.id,
            invitationTokenHash: invitationTokenHash.toString('hex'),
          });
        } else {
          await setDatabaseContext(transaction, { userId: user.id });
        }

        const invitationMembershipId = invitationTokenHash
          ? await this.acceptInvitation(
              transaction,
              user.id,
              identity.email,
              invitationTokenHash,
              requestId,
              now,
            )
          : null;

        const memberships = await transaction.agencyMembership.findMany({
          where: { userId: user.id, status: 'ACTIVE' },
          orderBy: { createdAt: 'asc' },
        });
        const activeMemberships: typeof memberships = [];
        for (const membership of memberships) {
          await setDatabaseContext(transaction, {
            userId: user.id,
            agencyId: membership.agencyId,
            membershipId: membership.id,
          });
          const agency = await transaction.agency.findUnique({
            where: { id: membership.agencyId },
            select: { status: true },
          });
          if (agency?.status === 'ACTIVE') activeMemberships.push(membership);
        }
        if (activeMemberships.length === 0) {
          throw new AuthServiceError(
            'No active Agency Membership is available.',
            403,
            'NO_MEMBERSHIP',
          );
        }

        const requestedMembershipId = invitationMembershipId ?? selectedMembershipId;
        const membership = requestedMembershipId
          ? activeMemberships.find(({ id }) => id === requestedMembershipId)
          : activeMemberships[0];
        if (!membership) {
          throw new AuthServiceError(
            'The selected Agency Membership is not active.',
            403,
            'MEMBERSHIP_DENIED',
          );
        }

        await setDatabaseContext(transaction, {
          userId: user.id,
          agencyId: membership.agencyId,
          membershipId: membership.id,
        });
        return {
          status: 'authenticated' as const,
          session: await this.createSession(
            transaction,
            user.id,
            membership.id,
            identity,
            requestId,
          ),
        };
      },
    );
    if (transactionResult.status === 'invitation_expired') {
      throw new AuthServiceError('The invitation has expired.', 400, 'INVITATION_EXPIRED');
    }
    const result = transactionResult.session;
    return {
      ...result,
      providerLogoutUrl: await this.oidc.providerLogoutUrl(result.providerSid),
    };
  }

  async authenticateSession(
    rawToken: string,
    requestId: string,
  ): Promise<AuthenticatedSession | null> {
    if (!rawToken) return null;
    const tokenHash = hashSessionToken(rawToken);
    return withDatabaseContext(
      { sessionTokenHash: tokenHash.toString('hex') },
      async (transaction) => {
        const session = await transaction.userSession.findUnique({
          where: { sessionTokenHash: prismaBytes(tokenHash) },
        });
        if (!session) return null;

        await setDatabaseContext(transaction, {
          sessionTokenHash: tokenHash.toString('hex'),
          userId: session.userId,
          agencyId: session.agencyId,
          membershipId: session.agencyMembershipId,
        });
        const user = await transaction.user.findUnique({ where: { id: session.userId } });
        const membership = await transaction.agencyMembership.findFirst({
          where: { id: session.agencyMembershipId, agencyId: session.agencyId },
          include: { agency: { select: { status: true } } },
        });
        const accessRemoved =
          !user ||
          !membership ||
          membership.userId !== user.id ||
          membership.status !== 'ACTIVE' ||
          membership.agency.status !== 'ACTIVE' ||
          user.globalStatus !== 'ACTIVE';
        if (accessRemoved || !isSessionActive(session)) {
          const reason = 'SESSION_EXPIRED_OR_ACCESS_REMOVED';
          const revokedSessions = await transaction.userSession.updateManyAndReturn({
            where: {
              ...(accessRemoved
                ? {
                    userId: session.userId,
                    ...(user?.globalStatus === 'ACTIVE'
                      ? { agencyMembershipId: session.agencyMembershipId }
                      : {}),
                  }
                : { id: session.id }),
              revokedAt: null,
            },
            data: {
              revokedAt: new Date(),
              revocationReason: reason,
            },
            select: { id: true, agencyId: true, userId: true, agencyMembershipId: true },
          });
          for (const revokedSession of revokedSessions) {
            await this.recordSystemSessionRevocation(
              transaction,
              revokedSession,
              reason,
              requestId,
            );
          }
          return null;
        }

        const context = await this.contextFor(transaction, user.id, membership, requestId);
        if (
          (await this.userRequiresMfa(transaction, user.id, membership.agencyId, membership.id)) &&
          !hasMfaEvidence(session.authenticationMethods)
        ) {
          const reason = 'MFA_REQUIRED';
          await transaction.userSession.update({
            where: { id: session.id },
            data: { revokedAt: new Date(), revocationReason: reason },
          });
          await this.recordSystemSessionRevocation(transaction, session, reason, requestId);
          return null;
        }

        await transaction.userSession.update({
          where: { id: session.id },
          data: { lastSeenAt: new Date() },
        });
        return {
          sessionId: session.id,
          providerSid: session.providerSid,
          authenticationMethods: session.authenticationMethods,
          authTime: session.authTime,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
          context,
        };
      },
    );
  }

  async recordLoginFailure(requestId: string, reason: string, ipAddress?: string): Promise<void> {
    await withDatabaseContext({ platformSecurity: true }, async (transaction) => {
      await transaction.securityEvent.create({
        data: {
          eventType: 'LOGIN_FAILURE',
          requestId,
          ipAddress: ipAddress ?? null,
          details: { reason },
        },
      });
    });
  }

  async createInvitation(
    context: RequestContext,
    email: string,
    roleCodes: readonly string[],
    requestId: string,
  ): Promise<InvitationResult> {
    const agencyRecord = { agencyId: context.agencyId };
    if (!hasPermission(context, 'security.users.invite', agencyRecord)) {
      throw new AuthServiceError(
        'The current Membership cannot invite users.',
        403,
        'INVITATION_FORBIDDEN',
      );
    }
    if (!hasPermission(context, 'security.users.update_roles', agencyRecord)) {
      throw new AuthServiceError(
        'The current Membership cannot assign Agency roles.',
        403,
        'ROLE_ASSIGNMENT_FORBIDDEN',
      );
    }
    const normalizedEmail = normalizeEmail(email);
    const requestedRoleCodes = normalizeRoleCodes(roleCodes);
    if (requestedRoleCodes.length === 0) {
      throw new AuthServiceError('At least one Agency role is required.', 400, 'ROLE_REQUIRED');
    }
    const activationToken = randomBytes(32).toString('base64url');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + INVITATION_LIFETIME_MS);

    return withDatabaseContext(context, async (transaction) => {
      const availableRoles = await transaction.role.findMany({
        where: {
          code: { in: requestedRoleCodes },
          status: 'ACTIVE',
          OR: [{ agencyId: null }, { agencyId: context.agencyId }],
        },
        select: { agencyId: true, code: true },
      });
      const roles = selectInvitationRoles(availableRoles, requestedRoleCodes, context.agencyId);
      if (roles.length !== requestedRoleCodes.length) {
        throw new AuthServiceError(
          'One or more requested roles are unavailable.',
          400,
          'ROLE_NOT_FOUND',
        );
      }
      const emailOwner = await transaction.user.findUnique({
        where: { emailNormalized: normalizedEmail },
        select: { id: true },
      });
      const existingMembership = emailOwner
        ? await transaction.agencyMembership.findFirst({
            where: { agencyId: context.agencyId, userId: emailOwner.id },
            select: { status: true },
          })
        : null;
      if (existingMembership && existingMembership.status !== 'INVITED') {
        throw new AuthServiceError(
          'The User already has an Agency Membership.',
          409,
          'MEMBERSHIP_EXISTS',
        );
      }
      const expiredInvitations = await transaction.invitation.updateManyAndReturn({
        where: {
          agencyId: context.agencyId,
          emailNormalized: normalizedEmail,
          status: 'PENDING',
          expiresAt: { lte: now },
        },
        data: { status: 'EXPIRED' },
        select: { id: true },
      });
      for (const expiredInvitation of expiredInvitations) {
        await this.recordSecurityEvent(transaction, context, 'INVITATION_EXPIRED', requestId, {
          invitationId: expiredInvitation.id,
        });
        await this.recordAuditEvent(transaction, context, {
          action: 'INVITATION_EXPIRED',
          entityType: 'Invitation',
          entityId: expiredInvitation.id,
          previousStatus: 'PENDING',
          newStatus: 'EXPIRED',
          requestId,
          metadata: { email: normalizedEmail },
        });
      }
      const invitation = await transaction.invitation.create({
        data: {
          agencyId: context.agencyId,
          emailNormalized: normalizedEmail,
          invitedByMembershipId: context.membershipId,
          tokenHash: prismaBytes(hashSessionToken(activationToken)),
          requestedRoleCodes,
          expiresAt,
          status: 'PENDING',
        },
      });
      await this.recordSecurityEvent(transaction, context, 'INVITATION_CREATED', requestId, {
        invitationId: invitation.id,
        email: normalizedEmail,
        roleCodes: roles.map(({ code }) => code),
      });
      await this.recordAuditEvent(transaction, context, {
        action: 'INVITATION_CREATED',
        entityType: 'Invitation',
        entityId: invitation.id,
        requestId,
        metadata: { email: normalizedEmail, roleCodes: roles.map(({ code }) => code) },
      });
      return { id: invitation.id, email: normalizedEmail, expiresAt, activationToken };
    });
  }

  async revokeSession(
    rawToken: string,
    session: AuthenticatedSession,
    reason: string,
    requestId: string,
  ): Promise<string | null> {
    const tokenHash = hashSessionToken(rawToken);
    const providerSid = await withDatabaseContext(
      { ...session.context, sessionTokenHash: tokenHash.toString('hex') },
      async (transaction) => {
        const revoked = await transaction.userSession.updateMany({
          where: {
            id: session.sessionId,
            sessionTokenHash: prismaBytes(tokenHash),
            revokedAt: null,
          },
          data: { revokedAt: new Date(), revocationReason: reason },
        });
        if (revoked.count === 1) {
          await this.recordSecurityEvent(
            transaction,
            session.context,
            'SESSION_REVOKED',
            requestId,
            { reason },
          );
          await this.recordAuditEvent(transaction, session.context, {
            action: 'SESSION_REVOKED',
            entityType: 'UserSession',
            entityId: session.sessionId,
            reason,
            requestId,
            metadata: { reason },
          });
        }
        return session.providerSid;
      },
    );
    return this.oidc.providerLogoutUrl(providerSid);
  }

  async switchAgency(
    rawToken: string,
    session: AuthenticatedSession,
    membershipId: string,
    requestId: string,
  ): Promise<LoginResult> {
    const tokenHash = hashSessionToken(rawToken);
    return withDatabaseContext(
      { ...session.context, sessionTokenHash: tokenHash.toString('hex') },
      async (transaction) => {
        const membership = await transaction.agencyMembership.findFirst({
          where: { id: membershipId, userId: session.context.userId, status: 'ACTIVE' },
        });
        if (membership) {
          await setDatabaseContext(transaction, {
            userId: session.context.userId,
            agencyId: membership.agencyId,
            membershipId: membership.id,
          });
        }
        const agency = membership
          ? await transaction.agency.findUnique({
              where: { id: membership.agencyId },
              select: { status: true },
            })
          : null;
        if (!membership || agency?.status !== 'ACTIVE') {
          throw new AuthServiceError(
            'The selected Agency Membership is not active.',
            403,
            'MEMBERSHIP_DENIED',
          );
        }
        await setDatabaseContext(transaction, {
          ...session.context,
          sessionTokenHash: tokenHash.toString('hex'),
        });
        const reason = 'AGENCY_CONTEXT_SWITCHED';
        const revoked = await transaction.userSession.updateMany({
          where: {
            id: session.sessionId,
            sessionTokenHash: prismaBytes(tokenHash),
            revokedAt: null,
          },
          data: { revokedAt: new Date(), revocationReason: reason },
        });
        if (revoked.count !== 1) {
          throw new AuthServiceError(
            'The HRIS session is no longer active.',
            401,
            'SESSION_REVOKED',
          );
        }
        await this.recordSecurityEvent(transaction, session.context, 'SESSION_REVOKED', requestId, {
          reason,
        });
        await this.recordAuditEvent(transaction, session.context, {
          action: 'SESSION_REVOKED',
          entityType: 'UserSession',
          entityId: session.sessionId,
          reason,
          requestId,
          metadata: {},
        });
        await setDatabaseContext(transaction, {
          userId: session.context.userId,
          agencyId: membership.agencyId,
          membershipId: membership.id,
        });
        const user = await transaction.user.findUniqueOrThrow({
          where: { id: session.context.userId },
        });
        return {
          ...(await this.createSession(
            transaction,
            user.id,
            membership.id,
            {
              issuer: '',
              subject: '',
              email: '',
              displayName: '',
              emailVerified: true,
              providerSid: session.providerSid,
              authTime: null,
              authenticationMethods: session.authenticationMethods,
            },
            requestId,
            {
              authTime: session.authTime,
              createdAt: session.createdAt,
              expiresAt: session.expiresAt,
            },
          )),
          providerLogoutUrl: null,
        };
      },
    );
  }

  async handleBackChannelLogout(token: string, requestId: string): Promise<void> {
    const identity = await this.oidc.verifyLogoutToken(token);
    await withDatabaseContext({ platformSecurity: true }, async (transaction) => {
      try {
        await transaction.securityEvent.create({
          data: {
            eventKey: identity.eventId,
            eventType: 'OIDC_BACKCHANNEL_LOGOUT',
            details: { subject: identity.subject, providerSid: identity.providerSid },
            requestId,
          },
        });
      } catch (error: unknown) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return;
        throw error;
      }
      const identityLink = identity.subject
        ? await transaction.externalIdentityLink.findFirst({
            where: {
              issuer: this.config.OIDC_ISSUER,
              subject: identity.subject,
            },
            select: { userId: true },
          })
        : null;
      const userId = identityLink?.userId ?? null;
      if (!userId && !identity.providerSid) return;
      if (userId && identity.providerSid) {
        await setDatabaseContext(transaction, {
          userId,
          providerSid: identity.providerSid,
        });
      } else if (userId) {
        await setDatabaseContext(transaction, { userId });
      } else {
        await setDatabaseContext(transaction, { providerSid: identity.providerSid as string });
      }
      const revokedAt = new Date();
      const sessions = await transaction.userSession.updateManyAndReturn({
        where: {
          ...(userId ? { userId } : {}),
          ...(identity.providerSid ? { providerSid: identity.providerSid } : {}),
          revokedAt: null,
        },
        data: { revokedAt, revocationReason: 'OIDC_BACKCHANNEL_LOGOUT' },
        select: { id: true, agencyId: true, userId: true, agencyMembershipId: true },
      });
      for (const session of sessions) {
        await this.recordSystemSessionRevocation(
          transaction,
          session,
          'OIDC_BACKCHANNEL_LOGOUT',
          requestId,
          { providerEventId: identity.eventId },
        );
      }
    });
  }

  private async resolveIdentity(transaction: Prisma.TransactionClient, identity: OidcIdentity) {
    const normalizedEmail = normalizeEmail(identity.email);
    const link = await transaction.externalIdentityLink.findFirst({
      where: { issuer: identity.issuer, subject: identity.subject },
    });
    if (link && link.status !== 'ACTIVE') {
      throw new AuthServiceError(
        'The external identity link is no longer active.',
        401,
        'IDENTITY_LINK_INACTIVE',
      );
    }
    let user = link
      ? await transaction.user.findUniqueOrThrow({ where: { id: link.userId } })
      : await transaction.user.findFirst({
          where: { identityProvider: identity.issuer, externalSubject: identity.subject },
        });
    if (!user) {
      const emailOwner = await transaction.user.findUnique({
        where: { emailNormalized: normalizedEmail },
      });
      if (emailOwner) {
        throw new AuthServiceError(
          'The identity is not linked to this HRIS User.',
          401,
          'IDENTITY_NOT_LINKED',
        );
      }
      user = await transaction.user.create({
        data: {
          identityProvider: identity.issuer,
          externalSubject: identity.subject,
          emailNormalized: normalizedEmail,
          displayName: identity.displayName,
          globalStatus: 'ACTIVE',
          emailVerifiedAt: identity.emailVerified ? new Date() : null,
          lastLoginAt: new Date(),
        },
      });
    } else {
      try {
        user = await transaction.user.update({
          where: { id: user.id },
          data: {
            emailNormalized: normalizedEmail,
            displayName: identity.displayName,
            emailVerifiedAt: identity.emailVerified ? new Date() : user.emailVerifiedAt,
            lastLoginAt: new Date(),
          },
        });
      } catch (error: unknown) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new AuthServiceError(
            'The verified email belongs to another HRIS User.',
            401,
            'EMAIL_ALREADY_IN_USE',
          );
        }
        throw error;
      }
    }

    if (!link) {
      await transaction.externalIdentityLink.create({
        data: {
          userId: user.id,
          issuer: identity.issuer,
          subject: identity.subject,
          status: 'ACTIVE',
        },
      });
    }
    return user;
  }

  private async acceptInvitation(
    transaction: Prisma.TransactionClient,
    userId: string,
    email: string,
    tokenHash: Buffer,
    requestId: string,
    now: Date,
  ): Promise<string> {
    const invitation = await transaction.invitation.findFirst({
      where: { tokenHash: prismaBytes(tokenHash), status: 'PENDING' },
    });
    if (!invitation) {
      throw new AuthServiceError(
        'The invitation is invalid or already used.',
        400,
        'INVITATION_INVALID',
      );
    }
    if (normalizeEmail(email) !== invitation.emailNormalized.toLowerCase()) {
      throw new AuthServiceError(
        'The authenticated email does not match the invitation.',
        403,
        'INVITATION_EMAIL_MISMATCH',
      );
    }

    await setDatabaseContext(transaction, { agencyId: invitation.agencyId, userId });
    let membership = await transaction.agencyMembership.findFirst({
      where: { agencyId: invitation.agencyId, userId },
    });
    if (membership?.status === 'ACTIVE') {
      throw new AuthServiceError(
        'The User already has an active Agency Membership.',
        409,
        'MEMBERSHIP_EXISTS',
      );
    }
    if (membership && membership.status !== 'INVITED') {
      throw new AuthServiceError(
        'The existing Agency Membership requires an authorized reactivation.',
        403,
        'MEMBERSHIP_REACTIVATION_REQUIRED',
      );
    }
    membership = membership
      ? await transaction.agencyMembership.update({
          where: { id: membership.id },
          data: {
            status: 'ACTIVE',
            activatedAt: now,
            deactivatedAt: null,
            deactivationReason: null,
          },
        })
      : await transaction.agencyMembership.create({
          data: {
            agencyId: invitation.agencyId,
            userId,
            status: 'ACTIVE',
            activatedAt: now,
          },
        });

    const availableRoles = await transaction.role.findMany({
      where: {
        code: { in: invitation.requestedRoleCodes },
        status: 'ACTIVE',
        OR: [{ agencyId: null }, { agencyId: invitation.agencyId }],
      },
      select: { id: true, agencyId: true, code: true },
    });
    const roles = selectInvitationRoles(
      availableRoles,
      invitation.requestedRoleCodes,
      invitation.agencyId,
    );
    if (roles.length !== invitation.requestedRoleCodes.length) {
      throw new AuthServiceError(
        'One or more invitation roles are no longer available.',
        409,
        'ROLE_NOT_FOUND',
      );
    }
    for (const role of roles) {
      await transaction.membershipRole.create({
        data: {
          agencyId: invitation.agencyId,
          membershipId: membership.id,
          roleId: role.id,
          effectiveFrom: now,
          assignedByMembershipId: invitation.invitedByMembershipId,
          reason: 'Invitation role assignment',
        },
      });
    }
    await transaction.invitation.update({
      where: { id: invitation.id },
      data: { status: 'ACCEPTED', acceptedAt: now },
    });
    const context = {
      requestId,
      userId,
      agencyId: invitation.agencyId,
      membershipId: membership.id,
      primaryOrganizationUnitId: membership.primaryOrganizationUnitId,
      permissions: [] as readonly PermissionGrant[],
    };
    await this.recordSecurityEvent(transaction, context, 'INVITATION_ACCEPTED', requestId, {
      invitationId: invitation.id,
      roleCodes: roles.map(({ code }) => code),
      assignedByMembershipId: invitation.invitedByMembershipId,
    });
    await this.recordAuditEvent(transaction, context, {
      action: 'INVITATION_ACCEPTED',
      entityType: 'AgencyMembership',
      entityId: membership.id,
      requestId,
      metadata: {
        invitationId: invitation.id,
        roleCodes: roles.map(({ code }) => code),
        assignedByMembershipId: invitation.invitedByMembershipId,
      },
    });
    return membership.id;
  }

  private async createSession(
    transaction: Prisma.TransactionClient,
    userId: string,
    membershipId: string,
    identity: OidcIdentity,
    requestId: string,
    previousSession?: Pick<AuthenticatedSession, 'authTime' | 'createdAt' | 'expiresAt'>,
  ): Promise<AuthenticatedSession & { token: string }> {
    const membership = await transaction.agencyMembership.findFirstOrThrow({
      where: { id: membershipId, userId, status: 'ACTIVE' },
    });
    if (
      (await this.userRequiresMfa(transaction, userId, membership.agencyId, membership.id)) &&
      !hasMfaEvidence(identity.authenticationMethods)
    ) {
      throw new AuthServiceError('MFA is required for this User identity.', 403, 'MFA_REQUIRED');
    }
    const token = createSessionToken();
    const createdAt = previousSession?.createdAt ?? new Date();
    const session = await transaction.userSession.create({
      data: {
        userId,
        agencyId: membership.agencyId,
        agencyMembershipId: membership.id,
        sessionTokenHash: prismaBytes(hashSessionToken(token)),
        providerSid: identity.providerSid,
        authTime: previousSession ? previousSession.authTime : identity.authTime,
        authenticationMethods: [...identity.authenticationMethods],
        createdAt,
        lastSeenAt: new Date(),
        expiresAt: previousSession?.expiresAt ?? sessionExpiry(createdAt),
      },
    });
    const context = await this.contextFor(transaction, userId, membership, requestId);
    await transaction.securityEvent.create({
      data: {
        agencyId: membership.agencyId,
        userId,
        membershipId: membership.id,
        eventType: 'LOGIN_SUCCESS',
        requestId,
        details: { provider: identity.issuer || this.config.OIDC_ISSUER },
      },
    });
    await this.recordAuditEvent(transaction, context, {
      action: 'LOGIN_SUCCESS',
      entityType: 'UserSession',
      entityId: session.id,
      requestId,
      metadata: { provider: identity.issuer || this.config.OIDC_ISSUER },
    });
    return {
      token,
      sessionId: session.id,
      providerSid: session.providerSid,
      authenticationMethods: session.authenticationMethods,
      authTime: session.authTime,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      context,
    };
  }

  private async userRequiresMfa(
    transaction: Prisma.TransactionClient,
    userId: string,
    agencyId: string,
    membershipId: string,
  ): Promise<boolean> {
    const now = new Date();
    const memberships = await transaction.agencyMembership.findMany({
      where: { userId, status: 'ACTIVE' },
      select: { id: true, agencyId: true },
    });

    try {
      for (const membership of memberships) {
        await setDatabaseContext(transaction, {
          userId,
          agencyId: membership.agencyId,
          membershipId: membership.id,
        });
        const assignments = await transaction.membershipRole.findMany({
          where: {
            agencyId: membership.agencyId,
            membershipId: membership.id,
            role: { status: 'ACTIVE' },
            effectiveFrom: { lte: now },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
          },
          select: {
            role: {
              select: {
                permissions: {
                  select: { permission: { select: { code: true } } },
                },
              },
            },
          },
        });
        if (
          permissionsRequireMfa(
            assignments.flatMap(({ role }) =>
              role.permissions.map(({ permission }) => ({
                code: permission.code,
                scopePolicy: 'AGENCY' as const,
              })),
            ),
          )
        ) {
          return true;
        }
      }
      return false;
    } finally {
      await setDatabaseContext(transaction, { userId, agencyId, membershipId });
    }
  }

  private async contextFor(
    transaction: Prisma.TransactionClient,
    userId: string,
    membership: { id: string; agencyId: string; primaryOrganizationUnitId: string | null },
    requestId: string,
  ): Promise<RequestContext> {
    const now = new Date();
    const assignments = await transaction.membershipRole.findMany({
      where: {
        agencyId: membership.agencyId,
        membershipId: membership.id,
        role: { status: 'ACTIVE' },
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      },
      select: {
        role: {
          select: {
            permissions: {
              select: { permission: { select: { code: true } }, scopePolicy: true },
            },
          },
        },
      },
    });
    const permissions = new Map<string, PermissionGrant>();
    for (const assignment of assignments) {
      for (const grant of assignment.role.permissions) {
        if (SCOPE_POLICIES.includes(grant.scopePolicy as (typeof SCOPE_POLICIES)[number])) {
          permissions.set(`${grant.permission.code}:${grant.scopePolicy}`, {
            code: grant.permission.code,
            scopePolicy: grant.scopePolicy as PermissionGrant['scopePolicy'],
          });
        }
      }
    }
    return {
      requestId,
      userId,
      agencyId: membership.agencyId,
      membershipId: membership.id,
      primaryOrganizationUnitId: membership.primaryOrganizationUnitId,
      permissions: [...permissions.values()],
    };
  }

  private async recordSecurityEvent(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    eventType: string,
    requestId: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    await transaction.securityEvent.create({
      data: {
        agencyId: context.agencyId,
        userId: context.userId,
        membershipId: context.membershipId,
        eventType,
        requestId,
        details: safeJson(details),
      },
    });
  }

  private async recordSystemSessionRevocation(
    transaction: Prisma.TransactionClient,
    session: { id: string; agencyId: string; userId: string; agencyMembershipId: string },
    reason: string,
    requestId: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await setDatabaseContext(transaction, {
      agencyId: session.agencyId,
      userId: session.userId,
      membershipId: session.agencyMembershipId,
    });
    await transaction.securityEvent.create({
      data: {
        agencyId: session.agencyId,
        userId: session.userId,
        membershipId: session.agencyMembershipId,
        eventType: 'SESSION_REVOKED',
        requestId,
        details: safeJson({ reason, ...metadata }),
      },
    });
    await transaction.auditEvent.create({
      data: {
        agencyId: session.agencyId,
        actorType: 'SYSTEM',
        action: 'SESSION_REVOKED',
        entityType: 'UserSession',
        entityId: session.id,
        reason,
        requestId,
        metadata: safeJson(metadata),
      },
    });
  }

  private async recordAuditEvent(
    // Internal atomic contract: the Audit module is not present yet, so identity writes its
    // append-only audit row in the same transaction as the security transition.
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    event: {
      action: string;
      entityType: string;
      entityId: string;
      previousStatus?: string;
      newStatus?: string;
      reason?: string;
      requestId: string;
      metadata: Record<string, unknown>;
    },
  ): Promise<void> {
    await transaction.auditEvent.create({
      data: {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        previousStatus: event.previousStatus ?? null,
        newStatus: event.newStatus ?? null,
        reason: event.reason ?? null,
        requestId: event.requestId,
        metadata: safeJson(event.metadata),
      },
    });
  }

  private signFlowState(state: OidcFlowState): string {
    const payload = Buffer.from(JSON.stringify(state)).toString('base64url');
    const signature = createHmac('sha256', this.config.SESSION_SECRET)
      .update(payload)
      .digest('base64url');
    return `${payload}.${signature}`;
  }

  private readFlowState(value: string): OidcFlowState {
    const [payload, signature] = value.split('.');
    if (!payload || !signature)
      throw new AuthServiceError('The authentication flow expired.', 401, 'OIDC_FLOW_INVALID');
    const expected = createHmac('sha256', this.config.SESSION_SECRET)
      .update(payload)
      .digest('base64url');
    const actualBytes = Buffer.from(signature);
    const expectedBytes = Buffer.from(expected);
    if (
      actualBytes.length !== expectedBytes.length ||
      !timingSafeEqual(actualBytes, expectedBytes)
    ) {
      throw new AuthServiceError('The authentication flow is invalid.', 401, 'OIDC_FLOW_INVALID');
    }
    try {
      const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (!parsed || typeof parsed !== 'object') throw new Error('invalid state');
      const flow = parsed as Partial<OidcFlowState>;
      if (
        typeof flow.state !== 'string' ||
        typeof flow.nonce !== 'string' ||
        typeof flow.verifier !== 'string' ||
        typeof flow.issuedAt !== 'number' ||
        !Number.isFinite(flow.issuedAt) ||
        Date.now() - flow.issuedAt > OIDC_FLOW_LIFETIME_MS ||
        flow.issuedAt - Date.now() > 30_000
      )
        throw new Error('invalid state');
      return {
        state: flow.state,
        nonce: flow.nonce,
        verifier: flow.verifier,
        issuedAt: flow.issuedAt,
        invitationToken: typeof flow.invitationToken === 'string' ? flow.invitationToken : null,
        membershipId: typeof flow.membershipId === 'string' ? flow.membershipId : null,
      };
    } catch {
      throw new AuthServiceError('The authentication flow is invalid.', 401, 'OIDC_FLOW_INVALID');
    }
  }
}
