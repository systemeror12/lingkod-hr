import { createHmac, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  acceptTotpCode,
  createSessionToken,
  hashEmail,
  hashPassword,
  hashSessionToken,
  hasMfaEvidence,
  hasPermission,
  isSessionActive,
  OidcClient,
  type OidcIdentity,
  openTotpSecret,
  passwordNeedsRehash,
  type PermissionGrant,
  type RequestContext,
  type SessionDisplay,
  permissionsRequireMfa,
  SCOPE_POLICIES,
  sessionExpiry,
  verifyPassword,
  verifyPasswordAgainstDummy,
} from '@lingkod-hr/auth';
import { getConfig, parseProtectedValueKey } from '@lingkod-hr/config';
import { setDatabaseContext, withDatabaseContext } from '@lingkod-hr/database';
import {
  InvitationDeliveryError,
  InvitationIssueError,
  InvitationIssuer,
} from '../invitations/invitation-issuer';
import {
  createMailDelivery,
  INVITATION_MAIL_DELIVERY,
  type MailDelivery,
} from '../invitations/mail';
import { prismaBytes, safeJson, selectInvitationRoles } from '../invitations/invitation-utils';

const OIDC_FLOW_LIFETIME_MS = 10 * 60 * 1000;
export const PENDING_SIGN_IN_LIFETIME_MS = 5 * 60 * 1000;
const OWNED_LOGIN_PROVIDER = 'lingkodhr';

export const SESSION_COOKIE = 'hris_session';
export const OIDC_FLOW_COOKIE = 'hris_oidc_flow';
export const PENDING_AUTHENTICATION_COOKIE = 'hris_pending_auth';
export const HRMO_ADMINISTRATOR_ROLE_CODE = 'hrmo_administrator';
const PENDING_INVITATION_PAGE_SIZE = 100;

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
  display: SessionDisplay;
}

export interface LoginResult extends AuthenticatedSession {
  token: string;
  providerLogoutUrl: string | null;
}

/** Who is signing in from where, for Security Events. */
export interface SignInRequest {
  requestId: string;
  ipAddress: string | null;
}

export type PasswordSignInResult =
  | { status: 'TOTP_REQUIRED'; pendingToken: string }
  | { status: 'SIGNED_IN'; session: AuthenticatedSession & { token: string } };

/** What the new session records about how the User proved who they are. */
interface SessionEvidence {
  provider: string;
  providerSid: string | null;
  authTime: Date | null;
  authenticationMethods: readonly string[];
  emailHash?: Buffer;
  ipAddress?: string | null;
}

export interface InvitationResult {
  id: string;
  email: string;
  expiresAt: Date;
  activationToken: string;
}

export interface EmployeeAccessClosure {
  membershipIds: string[];
  sessionIds: string[];
}

export interface PendingInvitation {
  id: string;
  email: string;
  roleCode: string | null;
  expiresAt: Date;
  status: 'PENDING';
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

function invalidCredentials(): AuthServiceError {
  return new AuthServiceError('The email or password is incorrect.', 401, 'INVALID_CREDENTIALS');
}

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new AuthServiceError('A valid email address is required.', 400, 'INVALID_EMAIL');
  }
  return normalized;
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
  private readonly invitationIssuer: InvitationIssuer;
  private readonly dataEncryptionKey = parseProtectedValueKey(this.config.DATA_ENCRYPTION_KEY);

  constructor(@Optional() @Inject(INVITATION_MAIL_DELIVERY) mailDelivery?: MailDelivery) {
    this.invitationIssuer = new InvitationIssuer(
      mailDelivery ?? createMailDelivery(this.config),
      this.config.API_URL,
    );
  }

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
    const loginHint = invitationToken ? await this.invitationEmailHint(invitationToken) : null;
    return {
      authorizationUrl: await this.oidc.authorizationUrl(
        state.state,
        state.nonce,
        state.verifier,
        loginHint,
      ),
      flowCookie: this.signFlowState(state),
    };
  }

  hasInvitationFlow(flowCookie: string): boolean {
    try {
      return this.readFlowState(flowCookie).invitationToken !== null;
    } catch {
      return false;
    }
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
    const failures = await withDatabaseContext(
      { capabilities: ['platform-security'] },
      (transaction) =>
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
        }
        const pendingInvitation = invitationTokenHash
          ? await transaction.invitation.findFirst({
              where: { tokenHash: prismaBytes(invitationTokenHash), status: 'PENDING' },
              select: { id: true, agencyId: true, emailNormalized: true, expiresAt: true },
            })
          : null;
        if (invitationTokenHash && !pendingInvitation) {
          throw new AuthServiceError(
            'The invitation is invalid or already used.',
            400,
            'INVITATION_INVALID',
          );
        }
        if (pendingInvitation && pendingInvitation.expiresAt <= now) {
          await this.expireInvitation(transaction, pendingInvitation, requestId);
          return { status: 'invitation_expired' as const };
        }
        if (
          pendingInvitation &&
          normalizeEmail(identity.email) !== pendingInvitation.emailNormalized.toLowerCase()
        ) {
          throw new AuthServiceError(
            'The authenticated email does not match the invitation.',
            403,
            'INVITATION_EMAIL_MISMATCH',
          );
        }
        if (invitationTokenHash) {
          await setDatabaseContext(transaction, {
            invitationTokenHash: invitationTokenHash.toString('hex'),
          });
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

        const membership = await this.selectSignInMembership(
          transaction,
          user.id,
          invitationMembershipId ?? selectedMembershipId,
        );
        return {
          status: 'authenticated' as const,
          session: await this.createSession(
            transaction,
            user.id,
            membership.id,
            {
              provider: identity.issuer,
              providerSid: identity.providerSid,
              authTime: identity.authTime,
              authenticationMethods: identity.authenticationMethods,
            },
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
      providerLogoutUrl: await this.oidc.providerLogoutUrl(),
    };
  }

  /**
   * First sign-in step. Every failure before the password verifies looks the same, and an unknown
   * email still costs a full Argon2id verification. A User with a TOTP factor gets a 5-minute
   * pending sign-in, replacing any earlier one; anyone else gets a session.
   */
  async signInWithPassword(
    email: string,
    password: string,
    membershipId: string | null,
    request: SignInRequest,
  ): Promise<PasswordSignInResult> {
    const emailHash = hashEmail(email, this.config.BLIND_INDEX_KEY);
    const account = await withDatabaseContext({}, async (transaction) => {
      const user = await transaction.user.findUnique({
        where: { emailNormalized: email.trim().toLowerCase() },
        select: { id: true, globalStatus: true },
      });
      if (!user) return null;
      await setDatabaseContext(transaction, { userId: user.id });
      const stored = await transaction.userPassword.findUnique({
        where: { userId: user.id },
        select: { passwordHash: true },
      });
      return stored ? { ...user, passwordHash: stored.passwordHash } : null;
    });
    const verified = account
      ? await verifyPassword(account.passwordHash, password)
      : await verifyPasswordAgainstDummy(password);
    if (!account || !verified || account.globalStatus !== 'ACTIVE') {
      await this.recordSignInFailure(
        request,
        emailHash,
        account?.id ?? null,
        'INVALID_CREDENTIALS',
      );
      throw invalidCredentials();
    }

    const userId = account.id;
    const rehashed = passwordNeedsRehash(account.passwordHash)
      ? await hashPassword(password)
      : null;
    try {
      return await withDatabaseContext(
        { userId, capabilities: ['platform-security'] },
        async (transaction): Promise<PasswordSignInResult> => {
          if (rehashed) {
            await transaction.userPassword.updateMany({
              where: { userId, passwordHash: account.passwordHash },
              data: { passwordHash: rehashed },
            });
          }
          const factor = await transaction.userTotpFactor.findUnique({
            where: { userId },
            select: { id: true },
          });
          if (factor) {
            const pendingToken = createSessionToken();
            await transaction.pendingAuthentication.deleteMany({
              where: { userId, purpose: 'SIGN_IN' },
            });
            await transaction.pendingAuthentication.create({
              data: {
                tokenHash: prismaBytes(hashSessionToken(pendingToken)),
                purpose: 'SIGN_IN',
                userId,
                requestedMembershipId: membershipId,
                stage: 'TOTP',
                verifiedMethods: ['pwd'],
                expiresAt: new Date(Date.now() + PENDING_SIGN_IN_LIFETIME_MS),
              },
            });
            await transaction.securityEvent.create({
              data: {
                userId,
                eventType: 'SIGN_IN_PASSWORD_VERIFIED',
                requestId: request.requestId,
                ipAddress: request.ipAddress,
                emailHash: prismaBytes(emailHash),
                details: { nextStep: 'TOTP' },
              },
            });
            return { status: 'TOTP_REQUIRED', pendingToken };
          }
          return {
            status: 'SIGNED_IN',
            session: await this.openOwnedSession(
              transaction,
              userId,
              membershipId,
              ['pwd'],
              request,
              emailHash,
            ),
          };
        },
      );
    } catch (error: unknown) {
      if (error instanceof AuthServiceError) {
        await this.recordSignInFailure(request, emailHash, userId, error.code);
      }
      throw error;
    }
  }

  /**
   * Second sign-in step. A code is accepted once: its time step is saved with a conditional
   * update, so of two submissions of one code exactly one wins. The session is created and the
   * pending sign-in deleted in the same transaction.
   */
  async completeTotpSignIn(
    pendingToken: string,
    code: string,
    request: SignInRequest,
  ): Promise<AuthenticatedSession & { token: string }> {
    const pendingTokenHash = hashSessionToken(pendingToken).toString('hex');
    const scope = { pendingTokenHash, capabilities: ['platform-security'] as const };
    // Set once both factors verify, so a later refusal can still be recorded.
    const verified: { userId?: string; emailHash?: Buffer } = {};
    try {
      const outcome = await withDatabaseContext(scope, async (transaction) => {
        const now = new Date();
        const pending = await transaction.pendingAuthentication.findUnique({
          where: { tokenHash: prismaBytes(hashSessionToken(pendingToken)) },
        });
        if (!pending?.userId || pending.purpose !== 'SIGN_IN' || pending.stage !== 'TOTP') {
          return { status: 'SIGN_IN_EXPIRED' as const, user: null };
        }
        const userId = pending.userId;
        await setDatabaseContext(transaction, { ...scope, userId });
        const user = await transaction.user.findUniqueOrThrow({
          where: { id: userId },
          select: { emailNormalized: true, globalStatus: true },
        });
        const failure = async (reason: 'SIGN_IN_EXPIRED' | 'INVALID_CODE') => {
          await transaction.securityEvent.create({
            data: {
              userId,
              eventType: 'LOGIN_FAILURE',
              requestId: request.requestId,
              ipAddress: request.ipAddress,
              emailHash: prismaBytes(emailHash),
              details: { reason, method: 'totp' },
            },
          });
          return { status: reason, user: null };
        };
        const emailHash = hashEmail(user.emailNormalized, this.config.BLIND_INDEX_KEY);
        const factor = await transaction.userTotpFactor.findUnique({ where: { userId } });
        if (pending.expiresAt <= now || !factor) {
          await transaction.pendingAuthentication.deleteMany({ where: { id: pending.id } });
          return failure('SIGN_IN_EXPIRED');
        }

        const secret = openTotpSecret(Buffer.from(factor.secretEnvelope), this.dataEncryptionKey, {
          userId,
          factorId: factor.id,
        });
        const step = acceptTotpCode(secret, code, Number(factor.lastAcceptedStep), now);
        const accepted =
          step !== null &&
          (
            await transaction.userTotpFactor.updateMany({
              where: { id: factor.id, lastAcceptedStep: { lt: step } },
              data: { lastAcceptedStep: step },
            })
          ).count === 1;
        if (!accepted) return failure('INVALID_CODE');
        const consumed = await transaction.pendingAuthentication.deleteMany({
          where: { id: pending.id },
        });
        if (consumed.count !== 1) return failure('SIGN_IN_EXPIRED');

        verified.userId = userId;
        verified.emailHash = emailHash;
        if (user.globalStatus !== 'ACTIVE') {
          throw new AuthServiceError('This identity is not active.', 403, 'USER_NOT_ACTIVE');
        }
        return {
          status: 'SIGNED_IN' as const,
          user: await this.openOwnedSession(
            transaction,
            userId,
            pending.requestedMembershipId,
            [...pending.verifiedMethods, 'totp'],
            request,
            emailHash,
          ),
        };
      });
      if (outcome.status !== 'SIGNED_IN') {
        throw new AuthServiceError(
          outcome.status === 'INVALID_CODE'
            ? 'The code is incorrect.'
            : 'The sign-in expired. Enter your email and password again.',
          401,
          outcome.status,
        );
      }
      return outcome.user;
    } catch (error: unknown) {
      // A refusal after both factors verified rolls the transaction back; record it separately.
      if (error instanceof AuthServiceError && verified.userId && verified.emailHash) {
        await this.recordSignInFailure(request, verified.emailHash, verified.userId, error.code);
      }
      throw error;
    }
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

        const resolved = await this.sessionContextFor(transaction, user.id, membership, requestId);
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

        const refreshed = await transaction.userSession.updateMany({
          where: { id: session.id, revokedAt: null },
          data: { lastSeenAt: new Date() },
        });
        if (refreshed.count !== 1) return null;
        return {
          sessionId: session.id,
          providerSid: session.providerSid,
          authenticationMethods: session.authenticationMethods,
          authTime: session.authTime,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
          context: resolved.context,
          display: resolved.display,
        };
      },
    );
  }

  async recordLoginFailure(requestId: string, reason: string, ipAddress?: string): Promise<void> {
    await withDatabaseContext({ capabilities: ['platform-security'] }, async (transaction) => {
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
    this.assertInvitationManagementAccess(context);
    let invitation;
    try {
      invitation = await withDatabaseContext(context, (transaction) =>
        this.invitationIssuer.issueInTransaction(transaction, {
          agencyId: context.agencyId,
          email,
          roleCodes,
          invitedByMembershipId: context.membershipId,
          actor: { type: 'USER', userId: context.userId, membershipId: context.membershipId },
          requestId,
        }),
      );
    } catch (error: unknown) {
      if (error instanceof InvitationIssueError) {
        throw new AuthServiceError(error.message, error.statusCode, error.code);
      }
      throw error;
    }
    try {
      await this.invitationIssuer.deliver(invitation);
    } catch (error: unknown) {
      if (error instanceof InvitationDeliveryError) {
        try {
          await withDatabaseContext(context, (transaction) =>
            this.invitationIssuer.cancelPendingInvitationInTransaction(transaction, {
              agencyId: context.agencyId,
              invitationId: invitation.id,
              requestId,
              actor: { type: 'USER', userId: context.userId, membershipId: context.membershipId },
              reason: 'INVITATION_DELIVERY_FAILED',
            }),
          );
        } catch {
          throw new AuthServiceError(
            'The invitation could not be delivered or safely cancelled.',
            502,
            'INVITATION_DELIVERY_FAILED',
          );
        }
        throw new AuthServiceError(
          'The invitation could not be delivered.',
          502,
          'INVITATION_DELIVERY_FAILED',
        );
      }
      throw error;
    }
    return {
      id: invitation.id,
      email: invitation.email,
      expiresAt: invitation.expiresAt,
      activationToken: invitation.activationToken,
    };
  }

  async createHrmoAdministratorInvitation(
    context: RequestContext,
    email: string,
    roleCodes: readonly string[],
    requestId: string,
  ): Promise<InvitationResult> {
    this.assertInvitationManagementAccess(context);
    if (
      roleCodes.length !== 1 ||
      roleCodes[0]?.trim().toLowerCase() !== HRMO_ADMINISTRATOR_ROLE_CODE
    ) {
      throw new AuthServiceError(
        'This workflow can assign only the HRMO Administrator role.',
        400,
        'ROLE_NOT_ALLOWED',
      );
    }
    return this.createInvitation(context, email, [HRMO_ADMINISTRATOR_ROLE_CODE], requestId);
  }

  async listPendingInvitations(context: RequestContext): Promise<{
    pendingCount: number;
    hasMore: boolean;
    invitations: PendingInvitation[];
  }> {
    this.assertInvitationManagementAccess(context);
    const now = new Date();
    return withDatabaseContext(context, async (transaction) => {
      const where = { agencyId: context.agencyId, status: 'PENDING', expiresAt: { gt: now } };
      const [pendingCount, invitations] = await Promise.all([
        transaction.invitation.count({ where }),
        transaction.invitation.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: PENDING_INVITATION_PAGE_SIZE,
          select: {
            id: true,
            emailNormalized: true,
            requestedRoleCodes: true,
            expiresAt: true,
            status: true,
          },
        }),
      ]);
      return {
        pendingCount,
        hasMore: pendingCount > invitations.length,
        invitations: invitations.map((invitation) => ({
          id: invitation.id,
          email: invitation.emailNormalized,
          roleCode: invitation.requestedRoleCodes[0] ?? null,
          expiresAt: invitation.expiresAt,
          status: 'PENDING' as const,
        })),
      };
    });
  }

  async inspectInvitationToken(
    token: string,
    requestId: string,
  ): Promise<'VALID' | 'INVALID' | 'EXPIRED'> {
    const tokenHash = hashSessionToken(token);
    return withDatabaseContext(
      { invitationTokenHash: tokenHash.toString('hex') },
      async (transaction) => {
        const invitation = await transaction.invitation.findFirst({
          where: { tokenHash: prismaBytes(tokenHash), status: 'PENDING' },
          select: { id: true, agencyId: true, expiresAt: true, emailNormalized: true },
        });
        if (!invitation) return 'INVALID' as const;
        if (invitation.expiresAt <= new Date()) {
          await this.expireInvitation(transaction, invitation, requestId);
          return 'EXPIRED' as const;
        }
        return 'VALID' as const;
      },
    );
  }

  async revokeSession(
    rawToken: string,
    session: AuthenticatedSession,
    reason: string,
    requestId: string,
  ): Promise<string | null> {
    const tokenHash = hashSessionToken(rawToken);
    await withDatabaseContext(
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
      },
    );
    return this.oidc.providerLogoutUrl();
  }

  /** Internal contract: the caller owns the transaction; Identity owns access closure. */
  async deactivateEmployeeAccessInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    employeeId: string,
    reason: string,
    effectiveAt: Date,
  ): Promise<EmployeeAccessClosure> {
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "agency_memberships" WHERE "agency_id" = CAST(${context.agencyId} AS uuid) AND "employee_id" = CAST(${employeeId} AS uuid) FOR UPDATE`,
    );
    const memberships = await transaction.agencyMembership.findMany({
      where: {
        agencyId: context.agencyId,
        employeeId,
        status: { in: ['ACTIVE', 'LOCKED', 'SUSPENDED'] },
      },
      select: { id: true },
    });
    const membershipIds = memberships.map(({ id }) => id);
    if (membershipIds.length === 0) return { membershipIds, sessionIds: [] };

    await transaction.agencyMembership.updateMany({
      where: { agencyId: context.agencyId, id: { in: membershipIds } },
      data: {
        status: 'DEACTIVATED',
        deactivatedAt: effectiveAt,
        deactivationReason: reason,
      },
    });
    const sessions = await transaction.userSession.updateManyAndReturn({
      where: {
        agencyId: context.agencyId,
        agencyMembershipId: { in: membershipIds },
        revokedAt: null,
      },
      data: { revokedAt: effectiveAt, revocationReason: reason },
      select: { id: true, userId: true, agencyMembershipId: true },
    });
    await transaction.auditEvent.createMany({
      data: [
        ...membershipIds.map((membershipId) => ({
          agencyId: context.agencyId,
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          actorType: 'USER',
          action: 'AGENCY_MEMBERSHIP_DEACTIVATED_FOR_SEPARATION',
          entityType: 'AgencyMembership',
          entityId: membershipId,
          reason,
          requestId: context.requestId,
          metadata: { employeeId },
        })),
        ...sessions.map((session) => ({
          agencyId: context.agencyId,
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          actorType: 'USER',
          action: 'SESSION_REVOKED_FOR_SEPARATION',
          entityType: 'UserSession',
          entityId: session.id,
          reason,
          requestId: context.requestId,
          metadata: { employeeId, membershipId: session.agencyMembershipId },
        })),
      ],
    });
    return { membershipIds, sessionIds: sessions.map(({ id }) => id) };
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
              provider: this.config.OIDC_ISSUER,
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
    await withDatabaseContext({ capabilities: ['platform-security'] }, async (transaction) => {
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

  private assertInvitationManagementAccess(context: RequestContext): void {
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
  }

  private async invitationEmailHint(token: string): Promise<string | null> {
    const tokenHash = hashSessionToken(token);
    return withDatabaseContext(
      { invitationTokenHash: tokenHash.toString('hex') },
      async (transaction) => {
        const invitation = await transaction.invitation.findFirst({
          where: {
            tokenHash: prismaBytes(tokenHash),
            status: 'PENDING',
            expiresAt: { gt: new Date() },
          },
          select: { emailNormalized: true },
        });
        return invitation?.emailNormalized.toLowerCase() ?? null;
      },
    );
  }

  private async expireInvitation(
    transaction: Prisma.TransactionClient,
    invitation: { id: string; agencyId: string },
    requestId: string,
  ): Promise<void> {
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

  private async openOwnedSession(
    transaction: Prisma.TransactionClient,
    userId: string,
    requestedMembershipId: string | null,
    methods: readonly string[],
    request: SignInRequest,
    emailHash: Buffer,
  ): Promise<AuthenticatedSession & { token: string }> {
    const now = new Date();
    await transaction.user.update({ where: { id: userId }, data: { lastLoginAt: now } });
    const membership = await this.selectSignInMembership(
      transaction,
      userId,
      requestedMembershipId,
    );
    return this.createSession(
      transaction,
      userId,
      membership.id,
      {
        provider: OWNED_LOGIN_PROVIDER,
        providerSid: null,
        authTime: now,
        authenticationMethods: methods,
        emailHash,
        ipAddress: request.ipAddress,
      },
      request.requestId,
    );
  }

  /** A failed sign-in step, recorded outside the attempt's transaction. */
  private async recordSignInFailure(
    request: SignInRequest,
    emailHash: Buffer,
    userId: string | null,
    reason: string,
  ): Promise<void> {
    await withDatabaseContext({ capabilities: ['platform-security'] }, (transaction) =>
      transaction.securityEvent.create({
        data: {
          userId,
          eventType: 'LOGIN_FAILURE',
          requestId: request.requestId,
          ipAddress: request.ipAddress,
          emailHash: prismaBytes(emailHash),
          details: { reason },
        },
      }),
    );
  }

  /**
   * Picks the requested Agency Membership, or the oldest active one, and leaves the transaction in
   * its context. Only memberships of an active Agency count.
   */
  private async selectSignInMembership(
    transaction: Prisma.TransactionClient,
    userId: string,
    requestedMembershipId: string | null,
  ) {
    const memberships = await transaction.agencyMembership.findMany({
      where: { userId, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });
    const activeMemberships: typeof memberships = [];
    for (const membership of memberships) {
      await setDatabaseContext(transaction, {
        userId,
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
      throw new AuthServiceError('No active Agency Membership is available.', 403, 'NO_MEMBERSHIP');
    }

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
      userId,
      agencyId: membership.agencyId,
      membershipId: membership.id,
    });
    return membership;
  }

  private async createSession(
    transaction: Prisma.TransactionClient,
    userId: string,
    membershipId: string,
    evidence: SessionEvidence,
    requestId: string,
    previousSession?: Pick<AuthenticatedSession, 'authTime' | 'createdAt' | 'expiresAt'>,
  ): Promise<AuthenticatedSession & { token: string }> {
    const membership = await transaction.agencyMembership.findFirstOrThrow({
      where: { id: membershipId, userId, status: 'ACTIVE' },
    });
    if (
      (await this.userRequiresMfa(transaction, userId, membership.agencyId, membership.id)) &&
      !hasMfaEvidence(evidence.authenticationMethods)
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
        providerSid: evidence.providerSid,
        authTime: previousSession ? previousSession.authTime : evidence.authTime,
        authenticationMethods: [...evidence.authenticationMethods],
        createdAt,
        lastSeenAt: new Date(),
        expiresAt: previousSession?.expiresAt ?? sessionExpiry(createdAt),
      },
    });
    const resolved = await this.sessionContextFor(transaction, userId, membership, requestId);
    await transaction.securityEvent.create({
      data: {
        agencyId: membership.agencyId,
        userId,
        membershipId: membership.id,
        eventType: 'LOGIN_SUCCESS',
        requestId,
        ipAddress: evidence.ipAddress ?? null,
        emailHash: evidence.emailHash ? prismaBytes(evidence.emailHash) : null,
        details: { provider: evidence.provider, methods: [...evidence.authenticationMethods] },
      },
    });
    await this.recordAuditEvent(transaction, resolved.context, {
      action: 'LOGIN_SUCCESS',
      entityType: 'UserSession',
      entityId: session.id,
      requestId,
      metadata: { provider: evidence.provider },
    });
    return {
      token,
      sessionId: session.id,
      providerSid: session.providerSid,
      authenticationMethods: session.authenticationMethods,
      authTime: session.authTime,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      context: resolved.context,
      display: resolved.display,
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

  private async sessionContextFor(
    transaction: Prisma.TransactionClient,
    userId: string,
    membership: { id: string; agencyId: string; primaryOrganizationUnitId: string | null },
    requestId: string,
  ): Promise<{ context: RequestContext; display: SessionDisplay }> {
    const now = new Date();
    const [agency, user, assignments] = await Promise.all([
      transaction.agency.findUniqueOrThrow({
        where: { id: membership.agencyId },
        select: { id: true, name: true, acronym: true },
      }),
      transaction.user.findUniqueOrThrow({
        where: { id: userId },
        select: { id: true, displayName: true, emailNormalized: true },
      }),
      transaction.membershipRole.findMany({
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
              code: true,
              name: true,
              permissions: {
                select: { permission: { select: { code: true } }, scopePolicy: true },
              },
            },
          },
        },
      }),
    ]);
    const permissions = new Map<string, PermissionGrant>();
    const roles = new Map<string, { code: string; name: string }>();
    for (const assignment of assignments) {
      roles.set(assignment.role.code, {
        code: assignment.role.code,
        name: assignment.role.name,
      });
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
      context: {
        requestId,
        userId,
        agencyId: membership.agencyId,
        membershipId: membership.id,
        primaryOrganizationUnitId: membership.primaryOrganizationUnitId,
        permissions: [...permissions.values()],
      },
      display: {
        agency,
        identity: {
          id: user.id,
          displayName: user.displayName,
          email: user.emailNormalized,
        },
        effectiveRoles: [...roles.values()].sort((left, right) =>
          left.name.localeCompare(right.name),
        ),
      },
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
