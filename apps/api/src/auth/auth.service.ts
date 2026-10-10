import { S3DocumentStorage } from '../documents/documents.storage';
import { readAgencyBrandKeys } from '../agency-profile/agency-brand.queries';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  checkNewPassword,
  createSessionToken,
  generateRecoveryCodes,
  hashEmail,
  hashPassword,
  hashRecoveryCode,
  hashSessionToken,
  hasMfaEvidence,
  hasPermission,
  isSessionActive,
  normalizeRecoveryCode,
  passwordNeedsRehash,
  type PermissionGrant,
  refundSignInGuess,
  type RequestContext,
  type SessionDisplay,
  permissionsRequireMfa,
  SCOPE_POLICIES,
  sessionExpiry,
  type SignInCooldownStart,
  type SignInThrottleState,
  verifyPassword,
  verifyPasswordAgainstDummy,
} from '@lingkod-hr/auth';
import { getConfig, parseProtectedValueKey } from '@lingkod-hr/config';
import {
  type DatabaseContext,
  setDatabaseContext,
  withDatabaseContext,
} from '@lingkod-hr/database';
import {
  InvitationDeliveryError,
  InvitationIssueError,
  InvitationIssuer,
} from '../invitations/invitation-issuer';
import {
  createMailDelivery,
  INVITATION_MAIL_DELIVERY,
  type MailDelivery,
  type MailMessage,
} from '../invitations/mail';
import { prismaBytes, safeJson, selectInvitationRoles } from '../invitations/invitation-utils';
import {
  acceptEnrollmentCode,
  beginTotpEnrollment,
  confirmTotpEnrollment,
  enrollmentAuthTime,
  ENROLL_CODES_STAGE,
  ENROLL_SCAN_STAGE,
  writeTotpEnrollment,
  writeTotpFactor,
} from './totp-enrollment';
import { liftedLockUserIds } from './agency-member-list.service';
import { AuthServiceError } from './auth-error';
import {
  countGuess,
  countIpFailures,
  CredentialProof,
  type FailureEvent,
  failureScope,
  type GuessCount,
  type GuessFailure,
  lockUserPassword,
  LOGIN_FAILURE,
  passwordResetRequired,
  readCooldown,
  reauthenticationFailure,
  type SecondFactorMethod,
  signInCooldown,
  type ThrottleRow,
  throttleState,
  writeGuessFailure,
  writeSignInFailure,
} from './credential-proof';
import {
  dischargeRecoveryCodePrompt,
  oweRecoveryCodePrompt,
  takeRecoveryCodePrompt,
} from './recovery-code-prompt';

export { AuthServiceError };

export const PENDING_SIGN_IN_LIFETIME_MS = 5 * 60 * 1000;
export const PENDING_ACTIVATION_LIFETIME_MS = 15 * 60 * 1000;
/** Sign-in failures from one IP address allowed in the window, every email and step counted. */
const IP_FAILURE_LIMIT = 100;
const IP_WINDOW_MS = 15 * 60 * 1000;
const PASSWORD_RESET_LIFETIME_MS = 30 * 60 * 1000;
/** Reset links sent per email, and reset requests answered per IP address, in the window. */
const RESET_EMAIL_LIMIT = 3;
const RESET_IP_LIMIT = 20;
const RESET_WINDOW_MS = 60 * 60 * 1000;
/**
 * The least time a reset request takes, well above the token work for a known email, so its
 * answer comes no later than an unknown email's.
 */
export const PASSWORD_RESET_RESPONSE_FLOOR_MS = 500;

/** The next step a pending sign-in waits for. */
type PendingSignInStage = 'TOTP' | typeof ENROLL_SCAN_STAGE | typeof ENROLL_CODES_STAGE;

export const SESSION_COOKIE = 'hris_session';
export const PENDING_AUTHENTICATION_COOKIE = 'hris_pending_auth';
export const PENDING_ACTIVATION_COOKIE = 'hris_pending_activation';
export const HRMO_ADMINISTRATOR_ROLE_CODE = 'hrmo_administrator';
const PENDING_INVITATION_PAGE_SIZE = 100;

export interface AuthenticatedSession {
  sessionId: string;
  authenticationMethods: readonly string[];
  authTime: Date | null;
  createdAt: Date;
  expiresAt: Date;
  context: RequestContext;
  display: SessionDisplay;
}

/** Who is signing in from where, for Security Events. */
export interface SignInRequest {
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

/** What the User needs to add a pending TOTP secret to an authenticator app. */
export interface TotpEnrollmentStart {
  otpauthUri: string;
  account: string;
  expiresAt: Date;
}

export type PasswordSignInResult =
  | { status: 'TOTP_REQUIRED'; pendingToken: string }
  | { status: 'ENROLLMENT_REQUIRED'; pendingToken: string; enrollment: TotpEnrollmentStart }
  | { status: 'SIGNED_IN'; session: AuthenticatedSession & { token: string } };

/**
 * A session a sign-in opened. `recoveryCodesRemaining` is the count for the remaining-codes prompt
 * a Password Reset owed, or null when none was owed.
 */
export type OpenedSession = AuthenticatedSession & {
  token: string;
  recoveryCodesRemaining: number | null;
};

export interface RecoveryCodeSignIn {
  session: AuthenticatedSession & { token: string };
  recoveryCodesRemaining: number;
  /** The "Recovery Code used" notice, for `sendNotice` once the response is out. */
  notice: MailMessage;
}

/** Database context for a second-factor step: the pending sign-in it continues. */
interface PendingScope {
  pendingTokenHash: string;
  capabilities: readonly ['platform-security'];
}

/** The pending sign-in a second-factor step continues, before either factor is spent. */
interface PendingSignIn {
  id: string;
  userId: string;
  requestedMembershipId: string | null;
  verifiedMethods: string[];
  enrollmentSecretEnvelope: Uint8Array | null;
  enrollmentAcceptedStep: bigint | null;
  enrollmentConfirmedAt: Date | null;
  recoveryCodeHashes: string[];
  user: { emailNormalized: string; globalStatus: string };
  emailHash: Buffer;
}

/** What a signed-in User gives to prove who they are: a TOTP code or Recovery Code with a factor. */
interface SignedInProof {
  password: string;
  code?: string | undefined;
  recoveryCode?: string | undefined;
}

/** The context in which a signed-in User changes their own credentials. */
function signedInScope({ context }: AuthenticatedSession) {
  const { userId, agencyId, membershipId } = context;
  return { userId, agencyId, membershipId, capabilities: ['platform-security'] as const };
}

/** A signed-in User whose password is verified, for the second step. */
interface ReauthenticationProof {
  session: AuthenticatedSession;
  request: SignInRequest;
  emailHash: Buffer;
  email: string;
}

/** What the new session records about how the User proved who they are. */
interface SessionEvidence {
  authTime: Date | null;
  authenticationMethods: readonly string[];
  emailHash?: Buffer;
  ipAddress?: string | null;
  userAgent?: string | null;
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

/** How a Security Administrator verified the User before a Factor Reset (#370). */
export interface FactorResetVerification {
  method: 'IN_PERSON_GOVERNMENT_ID' | 'VIDEO_CALL_GOVERNMENT_ID';
  note: string;
}

/** What the invitation page shows. Expired, cancelled, used, and unknown invitations show nothing. */
export type InvitationLookup =
  | {
      status: 'VALID';
      email: string;
      agency: {
        name: string;
        acronym: string | null;
        sealUrl?: string | null;
        photoUrl?: string | null;
      };
      roleNames: string[];
      existingUser: boolean;
      expiresAt: Date;
    }
  | { status: 'EXPIRED' | 'INVALID' };

/** A finished Invitation Activation, and the notices for `sendNotice` once the response is out. */
export interface ActivationDone {
  session: AuthenticatedSession & { token: string };
  notices: MailMessage[];
  /** For the remaining-codes prompt: set when a Recovery Code proved it, or a reset owed one. */
  recoveryCodesRemaining: number | null;
}

export type ActivationStart =
  | { status: 'CODE_REQUIRED'; pendingToken: string }
  | { status: 'ENROLLMENT_REQUIRED'; pendingToken: string; enrollment: TotpEnrollmentStart }
  | ({ status: 'ACTIVATED' } & ActivationDone);

/** Database context for an activation step: its invitation and, once started, its pending activation. */
interface ActivationScope {
  invitationTokenHash: string;
  pendingTokenHash?: string;
  capabilities: readonly ['platform-security'];
}

/** A PENDING, unexpired invitation of an active Agency whose roles are all still available. */
interface ActivationInvitation {
  id: string;
  agencyId: string;
  agency: { name: string; acronym: string | null };
  emailNormalized: string;
  invitedByMembershipId: string | null;
  expiresAt: Date;
  roles: { id: string; code: string; name: string }[];
  requiresMfa: boolean;
}

type PendingActivation = Prisma.PendingAuthenticationGetPayload<object>;

/** A reset link as its page shows it; looked up without side effects. */
export type PasswordResetLookup =
  | { status: 'VALID'; email: string; secondFactor: boolean; expiresAt: Date }
  | { status: 'INVALID' };

/** The new password, plus a TOTP code or a Recovery Code when the User has a factor. */
export interface PasswordResetAnswer {
  password: string;
  code?: string | undefined;
  recoveryCode?: string | undefined;
}

type ResetLinkFailure = 'TOKEN_UNKNOWN' | 'TOKEN_EXPIRED' | 'TOKEN_USED' | 'TOKEN_SUPERSEDED';
type ResetFailure =
  | ResetLinkFailure
  | 'SECOND_FACTOR_INVALID'
  | 'RECOVERY_CODE_INVALID'
  | 'COOLDOWN_ACTIVE'
  | 'IP_RATE_LIMITED';

/** A reset link's row and User, or why the link can't be used. */
type ResetLink =
  | {
      status: 'OPEN';
      tokenId: string;
      expiresAt: Date;
      user: { id: string; emailNormalized: string; displayName: string };
      emailHash: Buffer;
      secondFactor: boolean;
    }
  | {
      status: 'INVALID';
      reason: ResetLinkFailure;
      userId: string | null;
      emailHash: Buffer | null;
    };

function invalidCredentials(): AuthServiceError {
  return new AuthServiceError('The email or password is incorrect.', 401, 'INVALID_CREDENTIALS');
}

function signInExpired(): AuthServiceError {
  return new AuthServiceError(
    'The sign-in expired. Enter your email and password again.',
    401,
    'SIGN_IN_EXPIRED',
  );
}

const noticeTime = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila',
  dateStyle: 'long',
  timeStyle: 'short',
});

/** After a Recovery Code signs a User in, completes a password reset, or confirms it’s them. */
function recoveryCodeNotice(
  email: string,
  remaining: number,
  usedAt: Date,
  usedFor: 'sign-in' | 'reset' | 'reauthentication' = 'sign-in',
): MailMessage {
  const left =
    remaining === 0
      ? 'You have no Recovery Codes left.'
      : `You have ${remaining} Recovery Code${remaining === 1 ? '' : 's'} left.`;
  const when = `on ${noticeTime.format(usedAt)} (Philippine time)`;
  return {
    to: email,
    subject:
      usedFor === 'reset'
        ? 'A Recovery Code was used to reset your LingkodHR password'
        : usedFor === 'reauthentication'
          ? 'A Recovery Code was used in your LingkodHR account'
          : 'A Recovery Code was used to sign in to LingkodHR',
    text: [
      usedFor === 'reauthentication'
        ? `A Recovery Code was used to confirm it’s you in your LingkodHR account ${when}.`
        : `A Recovery Code was used to ${usedFor === 'reset' ? 'reset the password of' : 'sign in to'} your LingkodHR account ${when}. Your other sessions were signed out.`,
      `${left} If you lost your authenticator, replace it or generate new Recovery Codes.`,
      "If you didn't sign in, contact your Agency Administrator right away.",
    ].join('\n\n'),
  };
}

function totpEnrolledNotice(email: string): MailMessage {
  return {
    to: email,
    subject: 'An authenticator app was added to your LingkodHR account',
    text: [
      'An authenticator app was set up for signing in to your LingkodHR account, and a new set of Recovery Codes was issued.',
      'If you did not do this, contact your Agency Administrator right away.',
    ].join('\n\n'),
  };
}

function recoveryCodesRegeneratedNotice(email: string, at: Date): MailMessage {
  return {
    to: email,
    subject: 'New Recovery Codes were generated for your LingkodHR account',
    text: [
      `A new set of Recovery Codes was generated for your LingkodHR account on ${noticeTime.format(at)} (Philippine time). Your old Recovery Codes no longer work.`,
      'If you did not do this, contact your Agency Administrator right away.',
    ].join('\n\n'),
  };
}

function passwordResetLinkMail(email: string, link: string): MailMessage {
  return {
    to: email,
    subject: 'Reset your LingkodHR password',
    text: [
      'Someone asked to reset the password of your LingkodHR account. To choose a new one, open this link within 30 minutes:',
      link,
      'The link works once, and asking again replaces it.',
      "If you didn't ask, ignore this email. Your password stays the same.",
    ].join('\n\n'),
  };
}

/** A wrong password or code on reauthentication; it doesn't say which. */
function reauthenticationRefused(): AuthServiceError {
  return new AuthServiceError('Password or code is incorrect.', 401, 'INVALID_CREDENTIALS');
}

function passwordResetNotice(email: string, resetAt: Date): MailMessage {
  return {
    to: email,
    subject: 'Your LingkodHR password was reset',
    text: [
      `Your LingkodHR password was reset on ${noticeTime.format(resetAt)} (Philippine time). Every session was signed out.`,
      "If you didn't reset it, contact your Agency Administrator right away.",
    ].join('\n\n'),
  };
}

function passwordChangedNotice(email: string, changedAt: Date): MailMessage {
  return {
    to: email,
    subject: 'Your LingkodHR password was changed',
    text: [
      `Your LingkodHR password was changed on ${noticeTime.format(changedAt)} (Philippine time). Your other sessions were signed out.`,
      "If you didn't change it, contact your Agency Administrator right away.",
    ].join('\n\n'),
  };
}

function totpReplacedNotice(email: string, replacedAt: Date): MailMessage {
  return {
    to: email,
    subject: 'The authenticator app for your LingkodHR account was replaced',
    text: [
      `The authenticator app for signing in to your LingkodHR account was replaced on ${noticeTime.format(replacedAt)} (Philippine time). The old app no longer works, and your other sessions were signed out. Your Recovery Codes still work.`,
      "If you didn't replace it, contact your Agency Administrator right away.",
    ].join('\n\n'),
  };
}

function factorResetNotice(email: string, agencyName: string, resetAt: Date): MailMessage {
  return {
    to: email,
    subject: 'The authenticator for your LingkodHR account was reset',
    text: [
      `A Security Administrator of ${agencyName} reset your authenticator on ${noticeTime.format(resetAt)} (Philippine time). You'll set it up again the next time you sign in.`,
      "If you didn't request this, contact your Agency Administrator.",
    ].join('\n\n'),
  };
}

/** The refusal for an IP address over the per-IP limit, from sign-in or Password Reset alike. */
function ipRateLimited(): AuthServiceError {
  return new AuthServiceError(
    'Too many attempts from this network. Try again later.',
    429,
    'IP_RATE_LIMITED',
  );
}

function resetLinkInvalid(): AuthServiceError {
  return new AuthServiceError(
    'This reset link is invalid or has expired. Request a new one.',
    400,
    'RESET_LINK_INVALID',
  );
}

function resetCodeInvalid(method: SecondFactorMethod | null): AuthServiceError {
  return new AuthServiceError(
    method === 'recovery_code'
      ? 'That Recovery Code didn’t work. Your link still works.'
      : 'That code didn’t work. Your link still works.',
    401,
    'INVALID_CODE',
  );
}

/**
 * The second factor a reset answer gives: none when the User has no factor, or `missing` when
 * the User has one and the answer gives neither code.
 */
function resetMethod(
  link: Extract<ResetLink, { status: 'OPEN' }>,
  answer: PasswordResetAnswer,
): SecondFactorMethod | 'missing' | null {
  if (!link.secondFactor) return null;
  if (answer.recoveryCode) return 'recovery_code';
  return answer.code ? 'totp' : 'missing';
}

function samePasswordRejected(): AuthServiceError {
  return new AuthServiceError(
    'Choose a password that’s different from your current one.',
    400,
    'PASSWORD_REJECTED',
  );
}

function invitationInvalid(): AuthServiceError {
  return new AuthServiceError(
    'This invitation can’t be used. Ask your Agency Administrator for a new one.',
    400,
    'INVITATION_INVALID',
  );
}

function invitationExpired(): AuthServiceError {
  return new AuthServiceError(
    'This invitation has expired. Ask your Agency Administrator to send it again.',
    400,
    'INVITATION_EXPIRED',
  );
}

function invitationRoleUnavailable(): AuthServiceError {
  return new AuthServiceError(
    'A role in this invitation is no longer available. Ask your Agency Administrator for a new invitation.',
    409,
    'INVITATION_ROLE_UNAVAILABLE',
  );
}

function activationExpired(): AuthServiceError {
  return new AuthServiceError('Your setup timed out. Start again.', 401, 'ACTIVATION_EXPIRED');
}

function assertLockPermission(
  context: RequestContext,
  permission: 'security.users.lock' | 'security.users.unlock',
): void {
  if (!hasPermission(context, permission, { agencyId: context.agencyId })) {
    throw new AuthServiceError(
      'The current Membership cannot lock or unlock Users.',
      403,
      'USER_LOCK_FORBIDDEN',
    );
  }
}

function assertUserActive(globalStatus: string): void {
  if (globalStatus === 'LOCKED') {
    throw new AuthServiceError(
      'Your account is locked. Contact your Agency Administrator.',
      403,
      'USER_LOCKED',
    );
  }
  if (globalStatus !== 'ACTIVE') {
    throw new AuthServiceError('This identity is not active.', 403, 'USER_NOT_ACTIVE');
  }
}

/** A role's permissions as Agency-scoped grants, enough to tell whether they require MFA. */
function permissionGrants(role: {
  permissions: { permission: { code: string } }[];
}): PermissionGrant[] {
  return role.permissions.map(({ permission }) => ({
    code: permission.code,
    scopePolicy: 'AGENCY' as const,
  }));
}

@Injectable()
export class AuthService {
  private readonly config = getConfig();
  private readonly brandingStorage = new S3DocumentStorage(this.config);
  private readonly invitationIssuer: InvitationIssuer;
  private readonly mailDelivery: MailDelivery;
  private readonly logger = new Logger(AuthService.name);
  private readonly dataEncryptionKey = parseProtectedValueKey(this.config.DATA_ENCRYPTION_KEY);
  private readonly credentialProof = new CredentialProof(this.dataEncryptionKey);

  constructor(@Optional() @Inject(INVITATION_MAIL_DELIVERY) mailDelivery?: MailDelivery) {
    this.mailDelivery = mailDelivery ?? createMailDelivery(this.config);
    this.invitationIssuer = new InvitationIssuer(this.mailDelivery, this.config.APP_URL);
  }

  /** The per-IP limit for a sign-in step; a refusal records `event`. */
  async assertIpAllowed(
    request: SignInRequest,
    emailHash: Buffer | null = null,
    event: FailureEvent = LOGIN_FAILURE,
  ): Promise<void> {
    await this.refuseOverIpLimit(request, async (transaction) => {
      await setDatabaseContext(transaction, failureScope(event, null));
      await writeSignInFailure(transaction, request, {
        userId: null,
        emailHash,
        reason: 'IP_RATE_LIMITED',
        event,
      });
    });
  }

  /**
   * The per-IP limit: 100 sign-in, Password Reset, or reauthentication failures in 15 minutes,
   * counted from Security Events. The flow records its own refusal, which is a failure too, so a
   * client that keeps trying stays refused. Failures are written after the attempt's slow work, so
   * a burst of parallel attempts can each find the count under the limit and overshoot it once.
   */
  private async refuseOverIpLimit(
    { ipAddress }: SignInRequest,
    recordRefusal: (transaction: Prisma.TransactionClient) => Promise<void>,
  ): Promise<void> {
    if (!ipAddress) return;
    const refused = await withDatabaseContext(
      { capabilities: ['platform-security'] },
      async (transaction) => {
        const failures = await countIpFailures(
          transaction,
          ipAddress,
          new Date(Date.now() - IP_WINDOW_MS),
        );
        if (failures < IP_FAILURE_LIMIT) return false;
        await recordRefusal(transaction);
        return true;
      },
    );
    if (refused) throw ipRateLimited();
  }

  /**
   * First sign-in step. Every failure before the password verifies looks the same, and an unknown
   * email still costs a full Argon2id verification. The guess is counted toward the email's Sign-in
   * Cool-down before the verification and refunded when it is right, so a burst can't verify more
   * guesses than the cool-down allows. During the cool-down the attempt is refused before any
   * verification; a password disabled by the second-factor ceiling
   * is refused even when it is right. A User with a TOTP factor gets a 5-minute
   * pending sign-in, replacing any earlier one. An MFA-Required User without a factor gets a pending
   * sign-in that enrolls one first. Anyone else gets a session.
   */
  async signInWithPassword(
    email: string,
    password: string,
    membershipId: string | null,
    request: SignInRequest,
  ): Promise<PasswordSignInResult> {
    const emailHash = hashEmail(email, this.config.BLIND_INDEX_KEY);
    await this.assertIpAllowed(request, emailHash);
    const now = new Date();
    const { account, guess } = await withDatabaseContext(
      { capabilities: ['platform-security'] },
      async (transaction) => {
        const guess = await countGuess(transaction, emailHash, now);
        const user = await transaction.user.findUnique({
          where: { emailNormalized: email.trim().toLowerCase() },
          select: { id: true, emailNormalized: true, globalStatus: true },
        });
        if (!user) return { account: null, guess };
        await setDatabaseContext(transaction, {
          userId: user.id,
          capabilities: ['platform-security'],
        });
        const stored = await transaction.userPassword.findUnique({
          where: { userId: user.id },
          select: { passwordHash: true, resetRequiredAt: true },
        });
        return { account: stored ? { ...user, ...stored } : null, guess };
      },
    );
    if (guess.cooldownUntil) {
      await this.recordSignInFailure(request, emailHash, account?.id ?? null, 'COOLDOWN_ACTIVE');
      throw signInCooldown(guess.cooldownUntil, now);
    }
    const verified = account
      ? await verifyPassword(account.passwordHash, password)
      : await verifyPasswordAgainstDummy(password);
    if (!account || !verified || account.globalStatus !== 'ACTIVE') {
      await this.recordGuessFailure(request, {
        emailHash,
        userId: account?.id ?? null,
        reason: 'INVALID_CREDENTIALS',
        cooldown: guess.counted.cooldown,
      });
      throw invalidCredentials();
    }
    await this.refundGuess(emailHash, guess);
    if (account.resetRequiredAt) {
      await this.recordSignInFailure(request, emailHash, account.id, 'PASSWORD_RESET_REQUIRED');
      throw passwordResetRequired();
    }

    const userId = account.id;
    const rehashed = passwordNeedsRehash(account.passwordHash)
      ? await hashPassword(password)
      : null;
    try {
      return await withDatabaseContext(
        { userId, capabilities: ['platform-security'] },
        async (transaction): Promise<PasswordSignInResult> => {
          // Held to commit, as a Password Reset or change holds it: a password replaced since it
          // was verified refuses the sign-in, and a later replacement ends what this one writes.
          // A hash changed meanwhile is checked again, so a concurrent rehash doesn't refuse.
          await lockUserPassword(transaction, userId);
          const current = await transaction.userPassword.findUnique({
            where: { userId },
            select: { passwordHash: true, resetRequiredAt: true },
          });
          const stillVerified =
            current?.passwordHash === account.passwordHash ||
            (!!current && (await verifyPassword(current.passwordHash, password)));
          if (!current || !stillVerified) throw invalidCredentials();
          if (current.resetRequiredAt) throw passwordResetRequired();
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
          const pendingId = randomUUID();
          const pendingSignIn = async (
            stage: PendingSignInStage,
            enrollmentSecretEnvelope?: Buffer,
          ) => {
            const pending = {
              token: createSessionToken(),
              expiresAt: new Date(Date.now() + PENDING_SIGN_IN_LIFETIME_MS),
            };
            await transaction.pendingAuthentication.deleteMany({
              where: { userId, purpose: 'SIGN_IN' },
            });
            await transaction.pendingAuthentication.create({
              data: {
                id: pendingId,
                tokenHash: prismaBytes(hashSessionToken(pending.token)),
                purpose: 'SIGN_IN',
                userId,
                requestedMembershipId: membershipId,
                stage,
                verifiedMethods: ['pwd'],
                enrollmentSecretEnvelope: enrollmentSecretEnvelope
                  ? prismaBytes(enrollmentSecretEnvelope)
                  : null,
                expiresAt: pending.expiresAt,
              },
            });
            await transaction.securityEvent.create({
              data: {
                userId,
                eventType: 'SIGN_IN_PASSWORD_VERIFIED',
                requestId: request.requestId,
                ipAddress: request.ipAddress,
                userAgent: request.userAgent,
                emailHash: prismaBytes(emailHash),
                details: { nextStep: stage },
              },
            });
            return pending;
          };
          if (factor) {
            const { token } = await pendingSignIn('TOTP');
            return { status: 'TOTP_REQUIRED', pendingToken: token };
          }
          const requiresMfa = await this.signInRequiresMfa(transaction, userId, membershipId);
          await setDatabaseContext(transaction, { userId, capabilities: ['platform-security'] });
          if (requiresMfa) {
            // Sealed for the pending row's id, which becomes the factor id.
            const enrollment = beginTotpEnrollment(
              this.dataEncryptionKey,
              { userId, factorId: pendingId },
              account.emailNormalized,
            );
            const pending = await pendingSignIn(ENROLL_SCAN_STAGE, enrollment.envelope);
            return {
              status: 'ENROLLMENT_REQUIRED',
              pendingToken: pending.token,
              enrollment: {
                otpauthUri: enrollment.otpauthUri,
                account: account.emailNormalized,
                expiresAt: pending.expiresAt,
              },
            };
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
   * Second sign-in step. Credential Proof checks the code; the session is created and the pending
   * sign-in deleted in the transaction that accepts it, so of two submissions of one code exactly
   * one signs in.
   */
  async completeTotpSignIn(
    pendingToken: string,
    code: string,
    request: SignInRequest,
  ): Promise<OpenedSession> {
    const pendingTokenHash = hashSessionToken(pendingToken).toString('hex');
    const scope = { pendingTokenHash, capabilities: ['platform-security'] as const };
    // Set once both factors verify, so a later refusal can still be recorded.
    const verified: { userId?: string; emailHash?: Buffer } = {};
    try {
      const pending = await withDatabaseContext(scope, (transaction) =>
        this.openPendingSignIn(transaction, scope, pendingToken, request, 'totp', new Date()),
      );
      if (!pending) throw signInExpired();
      const { userId, user, emailHash } = pending;
      const expired = async (transaction: Prisma.TransactionClient) => {
        await writeSignInFailure(transaction, request, {
          userId,
          emailHash,
          reason: 'SIGN_IN_EXPIRED',
          method: 'totp',
        });
        return signInExpired();
      };
      const signedIn = await this.credentialProof.proveTotp({
        scope: { ...scope, userId },
        user: { id: userId, email: user.emailNormalized, emailHash },
        code,
        request,
        wrongCode: () => new AuthServiceError('The code is incorrect.', 401, 'INVALID_CODE'),
        noFactor: async (transaction) => {
          await transaction.pendingAuthentication.deleteMany({ where: { id: pending.id } });
          return expired(transaction);
        },
        onProved: async (transaction) => {
          const consumed = await transaction.pendingAuthentication.deleteMany({
            where: { id: pending.id, expiresAt: { gt: new Date() } },
          });
          // Another step consumed it or it expired meanwhile: the code stays spent and the refusal
          // is recorded.
          if (consumed.count !== 1) return { refusal: await expired(transaction) };

          verified.userId = userId;
          verified.emailHash = emailHash;
          if (user.globalStatus !== 'ACTIVE') {
            throw new AuthServiceError('This identity is not active.', 403, 'USER_NOT_ACTIVE');
          }
          return {
            session: await this.openOwnedSession(
              transaction,
              userId,
              pending.requestedMembershipId,
              [...pending.verifiedMethods, 'totp'],
              request,
              emailHash,
            ),
          };
        },
      });
      if ('refusal' in signedIn) throw signedIn.refusal;
      return signedIn.session;
    } catch (error: unknown) {
      // A refusal after both factors verified rolls the transaction back; record it separately.
      if (error instanceof AuthServiceError && verified.userId && verified.emailHash) {
        await this.recordSignInFailure(request, verified.emailHash, verified.userId, error.code);
      }
      throw error;
    }
  }

  /**
   * Second sign-in step with a Recovery Code in place of the TOTP code. Up to 10 Argon2id checks
   * take too long to hold a transaction open, so the guess is counted toward the Sign-in Cool-down
   * first, as for a password, and the code matched after; deleting its row then
   * decides a race, and of two submissions of one code exactly one wins. The code's row, the
   * pending sign-in, and every other session of the User go in the transaction that creates the
   * new session.
   */
  async completeRecoveryCodeSignIn(
    pendingToken: string,
    code: string,
    request: SignInRequest,
  ): Promise<RecoveryCodeSignIn> {
    const scope = {
      pendingTokenHash: hashSessionToken(pendingToken).toString('hex'),
      capabilities: ['platform-security'] as const,
    };
    const now = new Date();
    const opened = await withDatabaseContext(scope, async (transaction) => {
      const pending = await this.openPendingSignIn(
        transaction,
        scope,
        pendingToken,
        request,
        'recovery_code',
        now,
      );
      if (!pending) return null;
      const guess = await countGuess(transaction, pending.emailHash, now);
      if (guess.cooldownUntil) {
        await writeSignInFailure(transaction, request, {
          userId: pending.userId,
          emailHash: pending.emailHash,
          reason: 'COOLDOWN_ACTIVE',
          method: 'recovery_code',
        });
        return { pending, codes: [], guess };
      }
      const codes = await transaction.userRecoveryCode.findMany({
        where: { userId: pending.userId },
        select: { id: true, codeHash: true },
      });
      return { pending, codes, guess };
    });
    if (!opened) throw signInExpired();
    const { pending, guess } = opened;
    const { userId, emailHash } = pending;
    if (guess.cooldownUntil) throw signInCooldown(guess.cooldownUntil, now);

    const normalized = normalizeRecoveryCode(code);
    const matches = normalized
      ? await Promise.all(opened.codes.map(({ codeHash }) => verifyPassword(codeHash, normalized)))
      : [];
    const used = opened.codes.find((_, index) => matches[index]);
    if (!used) {
      await this.recordGuessFailure(request, {
        emailHash,
        userId,
        reason: 'INVALID_CODE',
        cooldown: guess.counted.cooldown,
        secondFactor: { method: 'recovery_code', email: pending.user.emailNormalized },
      });
      throw new AuthServiceError('The Recovery Code is incorrect.', 401, 'INVALID_CODE');
    }
    await this.refundGuess(emailHash, guess);
    try {
      return await withDatabaseContext({ ...scope, userId }, async (transaction) => {
        await lockUserPassword(transaction, userId);
        const spent = await transaction.userRecoveryCode.deleteMany({ where: { id: used.id } });
        if (spent.count !== 1) {
          throw new AuthServiceError('The Recovery Code is incorrect.', 401, 'INVALID_CODE');
        }
        const now = new Date();
        const consumed = await transaction.pendingAuthentication.deleteMany({
          where: { id: pending.id, expiresAt: { gt: now } },
        });
        if (consumed.count !== 1) throw signInExpired();
        // Read again: a Global User Lock may have landed while the codes were being checked.
        const { globalStatus } = await transaction.user.findUniqueOrThrow({
          where: { id: userId },
          select: { globalStatus: true },
        });
        if (globalStatus !== 'ACTIVE') {
          throw new AuthServiceError('This identity is not active.', 403, 'USER_NOT_ACTIVE');
        }

        const revoked = await transaction.userSession.updateManyAndReturn({
          where: { userId, revokedAt: null },
          data: { revokedAt: now, revocationReason: 'RECOVERY_CODE_SIGN_IN' },
          select: { id: true, agencyId: true, userId: true, agencyMembershipId: true },
        });
        for (const session of revoked) {
          await this.recordSystemSessionRevocation(
            transaction,
            session,
            'RECOVERY_CODE_SIGN_IN',
            request.requestId,
          );
        }
        // Each revocation is recorded in its session's Agency; return to the sign-in's context.
        if (revoked.length > 0) await setDatabaseContext(transaction, { ...scope, userId });
        const session = await this.openOwnedSession(
          transaction,
          userId,
          pending.requestedMembershipId,
          [...pending.verifiedMethods, 'recovery_code'],
          request,
          emailHash,
        );
        const remaining = await transaction.userRecoveryCode.count({ where: { userId } });
        await transaction.securityEvent.create({
          data: {
            agencyId: session.context.agencyId,
            userId,
            membershipId: session.context.membershipId,
            eventType: 'RECOVERY_CODE_USED',
            requestId: request.requestId,
            ipAddress: request.ipAddress,
            userAgent: request.userAgent,
            emailHash: prismaBytes(emailHash),
            details: { remaining, revokedSessions: revoked.length },
          },
        });
        return {
          session,
          recoveryCodesRemaining: remaining,
          notice: recoveryCodeNotice(pending.user.emailNormalized, remaining, now),
        };
      });
    } catch (error: unknown) {
      if (error instanceof AuthServiceError) {
        await this.recordSignInFailure(request, emailHash, userId, error.code, 'recovery_code');
      }
      throw error;
    }
  }

  /**
   * Confirms the secret of a pending enrollment with one code from the authenticator app, then
   * answers the 10 Recovery Codes. They are shown once: only their hashes stay on the pending row.
   * Hashing them takes too long to hold a transaction open, so the stage advance is conditional.
   */
  async confirmTotpEnrollment(
    pendingToken: string,
    code: string,
    request: SignInRequest,
  ): Promise<{ recoveryCodes: string[] }> {
    const scope = {
      pendingTokenHash: hashSessionToken(pendingToken).toString('hex'),
      capabilities: ['platform-security'] as const,
    };
    const pending = await withDatabaseContext(scope, (transaction) =>
      this.openPendingSignIn(
        transaction,
        scope,
        pendingToken,
        request,
        'totp',
        new Date(),
        ENROLL_SCAN_STAGE,
      ),
    );
    if (!pending) throw signInExpired();
    const { userId, emailHash } = pending;
    const confirmed = await confirmTotpEnrollment(
      this.dataEncryptionKey,
      { userId, factorId: pending.id },
      Buffer.from(pending.enrollmentSecretEnvelope ?? []),
      code,
    );
    if (!confirmed) {
      await this.recordSignInFailure(request, emailHash, userId, 'INVALID_CODE');
      throw new AuthServiceError('The code is incorrect.', 401, 'INVALID_CODE');
    }
    const advanced = await withDatabaseContext({ ...scope, userId }, (transaction) =>
      transaction.pendingAuthentication.updateMany({
        where: { id: pending.id, stage: ENROLL_SCAN_STAGE, expiresAt: { gt: new Date() } },
        data: {
          stage: ENROLL_CODES_STAGE,
          verifiedMethods: [...pending.verifiedMethods, 'totp'],
          enrollmentAcceptedStep: confirmed.step,
          enrollmentConfirmedAt: confirmed.confirmedAt,
          recoveryCodeHashes: confirmed.recoveryCodeHashes,
        },
      }),
    );
    if (advanced.count !== 1) {
      await this.recordSignInFailure(request, emailHash, userId, 'SIGN_IN_EXPIRED');
      throw signInExpired();
    }
    return { recoveryCodes: confirmed.recoveryCodes };
  }

  /**
   * Final enrollment step, after the User acknowledged saving the Recovery Codes. The factor, the
   * Recovery Code hashes, and the session are written and the pending sign-in deleted in one
   * transaction. Answers the enrollment notice, for `sendNotice` once the response is out.
   */
  async completeTotpEnrollment(
    pendingToken: string,
    request: SignInRequest,
  ): Promise<AuthenticatedSession & { token: string; notice: MailMessage }> {
    const scope = {
      pendingTokenHash: hashSessionToken(pendingToken).toString('hex'),
      capabilities: ['platform-security'] as const,
    };
    // Set once the pending sign-in opens, so a later refusal can still be recorded.
    const opened: { userId?: string; emailHash?: Buffer } = {};
    try {
      const session = await withDatabaseContext(scope, async (transaction) => {
        const now = new Date();
        const pending = await this.openPendingSignIn(
          transaction,
          scope,
          pendingToken,
          request,
          'totp',
          now,
          ENROLL_CODES_STAGE,
        );
        if (!pending) return null;
        const { userId, emailHash } = pending;
        opened.userId = userId;
        opened.emailHash = emailHash;
        await lockUserPassword(transaction, userId);
        const consumed = await transaction.pendingAuthentication.deleteMany({
          where: { id: pending.id, stage: ENROLL_CODES_STAGE, expiresAt: { gt: new Date() } },
        });
        if (consumed.count !== 1) throw signInExpired();
        if (pending.user.globalStatus !== 'ACTIVE') {
          throw new AuthServiceError('This identity is not active.', 403, 'USER_NOT_ACTIVE');
        }
        await writeTotpEnrollment(transaction, pending, userId);
        await transaction.securityEvent.create({
          data: {
            userId,
            eventType: 'TOTP_ENROLLED',
            requestId: request.requestId,
            ipAddress: request.ipAddress,
            userAgent: request.userAgent,
            emailHash: prismaBytes(emailHash),
            details: { recoveryCodes: pending.recoveryCodeHashes.length },
          },
        });
        const owned = await this.openOwnedSession(
          transaction,
          userId,
          pending.requestedMembershipId,
          pending.verifiedMethods,
          request,
          emailHash,
          enrollmentAuthTime(pending, signInExpired),
        );
        return { ...owned, notice: totpEnrolledNotice(pending.user.emailNormalized) };
      });
      if (!session) throw signInExpired();
      return session;
    } catch (error: unknown) {
      // A refusal after the pending sign-in opened rolls the transaction back; record it separately.
      if (error instanceof AuthServiceError && opened.userId && opened.emailHash) {
        await this.recordSignInFailure(request, opened.emailHash, opened.userId, error.code);
      }
      throw error;
    }
  }

  /**
   * Proves again who a signed-in User is, with the same proof as sign-in. Success sets the
   * session's `authTime` to now and records the methods used; its idle timer and `expiresAt` stay
   * as they were. A spent Recovery Code answers its notice, for `sendNotice` once the response is
   * out.
   */
  async reauthenticate(
    session: AuthenticatedSession,
    proof: SignedInProof,
    request: SignInRequest,
  ): Promise<{ notice: MailMessage | null }> {
    const { notice } = await this.proveSignedInUser(
      session,
      proof,
      request,
      'reauthentication',
      (transaction, proved, methods) => this.finishReauthentication(transaction, proved, methods),
    );
    return { notice };
  }

  /**
   * Changes a signed-in User's password. It always asks for the current password, plus a TOTP code
   * or Recovery Code when the User has a factor, whatever the Reauthentication Window; wrong
   * guesses count as `reauthenticate`'s do. The new password must pass the password rules and
   * differ from the current one. Success ends every other session and pending sign-in, and voids
   * outstanding reset links; this session keeps its `authTime` and expiry. Answers the notices, for
   * `sendNotice` once the response is out.
   */
  async changePassword(
    session: AuthenticatedSession,
    answer: Omit<SignedInProof, 'password'> & { currentPassword: string; newPassword: string },
    request: SignInRequest,
  ): Promise<{ revokedSessions: number; notices: MailMessage[] }> {
    const scope = signedInScope(session);
    const { userId } = scope;
    const user = await withDatabaseContext(scope, (transaction) =>
      transaction.user.findUniqueOrThrow({
        where: { id: userId },
        select: { emailNormalized: true, displayName: true },
      }),
    );
    const rejected = checkNewPassword(answer.newPassword, {
      email: user.emailNormalized,
      name: user.displayName,
    });
    if (rejected) throw new AuthServiceError(rejected.message, 400, 'PASSWORD_REJECTED');
    // Passwords are hashed NFKC-normalized, so once the current one verifies this is the same as
    // the new one verifying against its hash.
    if (answer.newPassword.normalize('NFKC') === answer.currentPassword.normalize('NFKC')) {
      throw samePasswordRejected();
    }
    // Refuse a throttled caller before the slow hash; the proof below counts the guess.
    const emailHash = hashEmail(user.emailNormalized, this.config.BLIND_INDEX_KEY);
    const failure = reauthenticationFailure(session);
    await this.assertIpAllowed(request, emailHash, failure);
    const now = new Date();
    const cooldownUntil = await withDatabaseContext(scope, (transaction) =>
      readCooldown(transaction, emailHash, now),
    );
    if (cooldownUntil) {
      await this.recordSignInFailure(
        request,
        emailHash,
        userId,
        'COOLDOWN_ACTIVE',
        undefined,
        failure,
      );
      throw signInCooldown(cooldownUntil, now);
    }
    // Hashing takes too long to hold a transaction open.
    const passwordHash = await hashPassword(answer.newPassword);
    const { result: revokedSessions, notice } = await this.proveSignedInUser(
      session,
      { password: answer.currentPassword, code: answer.code, recoveryCode: answer.recoveryCode },
      request,
      'passwordChange',
      async (transaction, _proved, methods) => {
        // A concurrent change by another session revokes this one; under the lock it shows.
        await transaction.$queryRaw`
          SELECT 1 FROM "user_passwords" WHERE "user_id" = ${userId}::uuid FOR UPDATE`;
        const current = await transaction.userSession.count({
          where: { id: session.sessionId, revokedAt: null },
        });
        if (current !== 1) {
          throw new AuthServiceError('Your session ended. Sign in again.', 401, 'SESSION_REVOKED');
        }
        // Changing `changed_at` voids the User's outstanding reset links.
        await transaction.userPassword.update({
          where: { userId },
          data: { passwordHash, changedAt: new Date() },
        });
        await transaction.pendingAuthentication.deleteMany({ where: { userId } });
        const revoked = await this.revokeOtherSessions(
          transaction,
          session,
          'PASSWORD_CHANGED',
          request.requestId,
        );
        await transaction.securityEvent.create({
          data: {
            agencyId: scope.agencyId,
            userId,
            membershipId: scope.membershipId,
            eventType: 'PASSWORD_CHANGED',
            requestId: request.requestId,
            ipAddress: request.ipAddress,
            userAgent: request.userAgent,
            emailHash: prismaBytes(emailHash),
            details: { methods, revokedSessions: revoked },
          },
        });
        return revoked;
      },
    );
    const notices = [passwordChangedNotice(user.emailNormalized, new Date())];
    if (notice) notices.push(notice);
    return { revokedSessions, notices };
  }

  /**
   * Starts replacing the User's authenticator app: a new secret, sealed on the User's pending
   * replacement, which supersedes any earlier one and lasts 5 minutes. Their factor stays until
   * `confirmTotpReplacement`. The caller guards it with the Reauthentication Window.
   */
  async beginTotpReplacement(
    session: AuthenticatedSession,
  ): Promise<{ otpauthUri: string; account: string; expiresAt: Date }> {
    const scope = signedInScope(session);
    const { userId } = scope;
    return withDatabaseContext(scope, async (transaction) => {
      if ((await transaction.userTotpFactor.count({ where: { userId } })) !== 1) {
        throw new AuthServiceError(
          'Set up an authenticator app before replacing it.',
          409,
          'NO_AUTHENTICATOR',
        );
      }
      const { emailNormalized: account } = await transaction.user.findUniqueOrThrow({
        where: { id: userId },
        select: { emailNormalized: true },
      });
      const now = new Date();
      const expiresAt = new Date(now.getTime() + PENDING_SIGN_IN_LIFETIME_MS);
      await transaction.pendingAuthentication.deleteMany({
        where: { userId, purpose: 'TOTP_REPLACEMENT' },
      });
      const pendingId = randomUUID();
      const { envelope, otpauthUri } = beginTotpEnrollment(
        this.dataEncryptionKey,
        { userId, factorId: pendingId },
        account,
      );
      await transaction.pendingAuthentication.create({
        data: {
          id: pendingId,
          purpose: 'TOTP_REPLACEMENT',
          userId,
          stage: ENROLL_SCAN_STAGE,
          enrollmentSecretEnvelope: prismaBytes(envelope),
          createdAt: now,
          expiresAt,
        },
      });
      return { otpauthUri, account, expiresAt };
    });
  }

  /**
   * Confirms a replacement with a code from the new app. One transaction ends the pending
   * replacement, swaps the old factor for the new one, keeps the Recovery Codes, and ends every
   * other session. A wrong code leaves the replacement open and isn't counted as a guess, as in
   * enrollment. Answers the notice, for `sendNotice` once the response is out.
   */
  async confirmTotpReplacement(
    session: AuthenticatedSession,
    code: string,
    request: SignInRequest,
  ): Promise<{ revokedSessions: number; notice: MailMessage }> {
    const scope = signedInScope(session);
    const { userId } = scope;
    const outcome = await withDatabaseContext(scope, async (transaction) => {
      // One credential change per User at a time, as in `resetFactor`.
      await transaction.$queryRaw`
        SELECT 1 FROM "user_passwords" WHERE "user_id" = ${userId}::uuid FOR UPDATE`;
      const now = new Date();
      const pending = await transaction.pendingAuthentication.findFirst({
        where: { userId, purpose: 'TOTP_REPLACEMENT', expiresAt: { gt: now } },
      });
      if (!pending?.enrollmentSecretEnvelope) return { status: 'EXPIRED' as const };
      const step = acceptEnrollmentCode(
        this.dataEncryptionKey,
        { userId, factorId: pending.id },
        Buffer.from(pending.enrollmentSecretEnvelope),
        code,
        now,
      );
      const { emailNormalized: email } = await transaction.user.findUniqueOrThrow({
        where: { id: userId },
        select: { emailNormalized: true },
      });
      const emailHash = hashEmail(email, this.config.BLIND_INDEX_KEY);
      if (step === null) {
        await writeSignInFailure(transaction, request, {
          userId,
          emailHash,
          reason: 'INVALID_CODE',
          method: 'totp',
        });
        return { status: 'INVALID_CODE' as const };
      }
      const ended = await transaction.pendingAuthentication.deleteMany({
        where: { id: pending.id },
      });
      if (ended.count !== 1) return { status: 'EXPIRED' as const };
      await transaction.userTotpFactor.deleteMany({ where: { userId } });
      await writeTotpFactor(
        transaction,
        { ...pending, enrollmentAcceptedStep: BigInt(step) },
        userId,
      );
      const revokedSessions = await this.revokeOtherSessions(
        transaction,
        session,
        'TOTP_REPLACED',
        request.requestId,
      );
      await transaction.securityEvent.create({
        data: {
          agencyId: scope.agencyId,
          userId,
          membershipId: scope.membershipId,
          eventType: 'TOTP_REPLACED',
          requestId: request.requestId,
          ipAddress: request.ipAddress,
          userAgent: request.userAgent,
          emailHash: prismaBytes(emailHash),
          details: { revokedSessions },
        },
      });
      return {
        status: 'REPLACED' as const,
        revokedSessions,
        notice: totpReplacedNotice(email, now),
      };
    });
    if (outcome.status === 'EXPIRED') {
      throw new AuthServiceError(
        'The replacement expired. Start again.',
        409,
        'REPLACEMENT_EXPIRED',
      );
    }
    if (outcome.status === 'INVALID_CODE') {
      throw new AuthServiceError('The code is incorrect.', 401, 'INVALID_CODE');
    }
    return { revokedSessions: outcome.revokedSessions, notice: outcome.notice };
  }

  /**
   * Proves who a signed-in User is: the password, plus a TOTP code or Recovery Code when the User
   * has a factor. Wrong guesses count like sign-in's, toward the Sign-in Cool-down and the
   * second-factor ceiling. A right one resets both, as a full sign-in does, and runs `onProved`
   * in the same transaction that accepts the code. A spent Recovery Code answers its notice.
   */
  private async proveSignedInUser<T>(
    session: AuthenticatedSession,
    proof: SignedInProof,
    request: SignInRequest,
    purpose: 'reauthentication' | 'passwordChange',
    onProved: (
      transaction: Prisma.TransactionClient,
      proved: ReauthenticationProof,
      methods: string[],
    ) => Promise<T>,
  ): Promise<{ result: T; notice: MailMessage | null }> {
    const scope = signedInScope(session);
    const { userId } = scope;
    const { emailNormalized: email } = await withDatabaseContext(scope, (transaction) =>
      transaction.user.findUniqueOrThrow({
        where: { id: userId },
        select: { emailNormalized: true },
      }),
    );
    const emailHash = hashEmail(email, this.config.BLIND_INDEX_KEY);
    const failure = reauthenticationFailure(session);
    await this.assertIpAllowed(request, emailHash, failure);
    const now = new Date();
    const { guess, stored, hasFactor } = await withDatabaseContext(scope, async (transaction) => ({
      guess: await countGuess(transaction, emailHash, now),
      stored: await transaction.userPassword.findUnique({
        where: { userId },
        select: { passwordHash: true, resetRequiredAt: true },
      }),
      hasFactor: (await transaction.userTotpFactor.count({ where: { userId } })) === 1,
    }));
    if (guess.cooldownUntil) {
      await this.recordSignInFailure(
        request,
        emailHash,
        userId,
        'COOLDOWN_ACTIVE',
        undefined,
        failure,
      );
      throw signInCooldown(guess.cooldownUntil, now);
    }
    const verified = stored
      ? await verifyPassword(stored.passwordHash, proof.password)
      : await verifyPasswordAgainstDummy(proof.password);
    if (!stored || !verified) {
      await this.recordGuessFailure(request, {
        emailHash,
        userId,
        reason: 'INVALID_CREDENTIALS',
        cooldown: guess.counted.cooldown,
        event: failure,
      });
      throw reauthenticationRefused();
    }
    await this.refundGuess(emailHash, guess);
    if (stored.resetRequiredAt) {
      await this.recordSignInFailure(
        request,
        emailHash,
        userId,
        'PASSWORD_RESET_REQUIRED',
        undefined,
        failure,
      );
      throw passwordResetRequired();
    }

    const proved = { session, request, emailHash, email };
    if (!hasFactor) {
      return withDatabaseContext(scope, async (transaction) => {
        await this.clearGuesses(transaction, proved);
        return { result: await onProved(transaction, proved, ['pwd']), notice: null };
      });
    }
    if (proof.recoveryCode !== undefined) {
      return this.proveWithRecoveryCode(scope, proved, proof.recoveryCode, purpose, onProved);
    }
    const result = await this.credentialProof.proveTotp({
      scope,
      user: { id: userId, email, emailHash },
      code: proof.code ?? '',
      request,
      wrongCode: reauthenticationRefused,
      noFactor: async () => reauthenticationRefused(),
      failureEvent: failure,
      onProved: async (transaction) => {
        await this.clearGuesses(transaction, proved);
        return onProved(transaction, proved, ['pwd', 'totp']);
      },
    });
    return { result, notice: null };
  }

  /**
   * Whether the User has an authenticator app and how many unused Recovery Codes they have left.
   */
  async recoveryCodeStatus(
    session: AuthenticatedSession,
  ): Promise<{ hasAuthenticator: boolean; remaining: number }> {
    const { userId } = session.context;
    return withDatabaseContext({ userId }, async (transaction) => ({
      hasAuthenticator: (await transaction.userTotpFactor.count({ where: { userId } })) === 1,
      remaining: await transaction.userRecoveryCode.count({ where: { userId } }),
    }));
  }

  /**
   * Replaces the User's Recovery Codes with a new set of 10, shown once: only their hashes are
   * kept, and the old set stops working in the same transaction. The caller guards it with the
   * Reauthentication Window. Answers the notice, for `sendNotice` once the response is out.
   */
  async regenerateRecoveryCodes(
    session: AuthenticatedSession,
    requestId: string,
  ): Promise<{ recoveryCodes: string[]; notice: MailMessage }> {
    const recoveryCodes = generateRecoveryCodes();
    // Hashing takes too long to hold a transaction open.
    const hashes = await Promise.all(recoveryCodes.map(hashRecoveryCode));
    const { context } = session;
    return withDatabaseContext(context, async (transaction) => {
      const { userId } = context;
      // One credential change per User at a time, as in `resetFactor`.
      await transaction.$queryRaw`
        SELECT 1 FROM "user_passwords" WHERE "user_id" = ${userId}::uuid FOR UPDATE`;
      const hasFactor = (await transaction.userTotpFactor.count({ where: { userId } })) === 1;
      if (!hasFactor) {
        throw new AuthServiceError(
          'Set up an authenticator app before generating Recovery Codes.',
          409,
          'NO_AUTHENTICATOR',
        );
      }
      await transaction.userRecoveryCode.deleteMany({ where: { userId } });
      await transaction.userRecoveryCode.createMany({
        data: hashes.map((codeHash) => ({ userId, codeHash })),
      });
      await this.recordSecurityEvent(
        transaction,
        context,
        'RECOVERY_CODES_REGENERATED',
        requestId,
        {
          recoveryCodes: hashes.length,
        },
      );
      const { emailNormalized } = await transaction.user.findUniqueOrThrow({
        where: { id: userId },
        select: { emailNormalized: true },
      });
      return {
        recoveryCodes,
        notice: recoveryCodesRegeneratedNotice(emailNormalized, new Date()),
      };
    });
  }

  /**
   * `proveSignedInUser`'s second step with a Recovery Code: counted as a guess first, matched
   * outside a transaction, then spent by deleting its row, as on sign-in.
   */
  private async proveWithRecoveryCode<T>(
    scope: DatabaseContext,
    proved: ReauthenticationProof,
    code: string,
    purpose: 'reauthentication' | 'passwordChange',
    onProved: (
      transaction: Prisma.TransactionClient,
      proved: ReauthenticationProof,
      methods: string[],
    ) => Promise<T>,
  ): Promise<{ result: T; notice: MailMessage }> {
    const { session, request, emailHash, email } = proved;
    const { userId } = session.context;
    const failure = reauthenticationFailure(session);
    const now = new Date();
    const { guess, codes } = await withDatabaseContext(scope, async (transaction) => ({
      guess: await countGuess(transaction, emailHash, now),
      codes: await transaction.userRecoveryCode.findMany({
        where: { userId },
        select: { id: true, codeHash: true },
      }),
    }));
    if (guess.cooldownUntil) {
      await this.recordSignInFailure(
        request,
        emailHash,
        userId,
        'COOLDOWN_ACTIVE',
        'recovery_code',
        failure,
      );
      throw signInCooldown(guess.cooldownUntil, now);
    }
    const normalized = normalizeRecoveryCode(code);
    const matches = normalized
      ? await Promise.all(codes.map(({ codeHash }) => verifyPassword(codeHash, normalized)))
      : [];
    const used = codes.find((_, index) => matches[index]);
    const spent =
      used &&
      (await withDatabaseContext(scope, async (transaction) => {
        await lockUserPassword(transaction, userId);
        const deleted = await transaction.userRecoveryCode.deleteMany({ where: { id: used.id } });
        if (deleted.count !== 1) return null;
        await this.clearGuesses(transaction, proved);
        const result = await onProved(transaction, proved, ['pwd', 'recovery_code']);
        const remaining = await transaction.userRecoveryCode.count({ where: { userId } });
        await this.recordSecurityEvent(
          transaction,
          session.context,
          'RECOVERY_CODE_USED',
          request.requestId,
          { remaining, [purpose]: true },
        );
        return { result, notice: recoveryCodeNotice(email, remaining, now, 'reauthentication') };
      }));
    if (spent) {
      await this.refundGuess(emailHash, guess);
      return spent;
    }
    await this.recordGuessFailure(request, {
      emailHash,
      userId,
      reason: 'INVALID_CODE',
      cooldown: guess.counted.cooldown,
      secondFactor: { method: 'recovery_code', email },
      event: failure,
    });
    throw reauthenticationRefused();
  }

  /**
   * A signed-in User proved who they are, as a full sign-in does: the second-factor count and the
   * Sign-in Cool-down reset.
   */
  private async clearGuesses(
    transaction: Prisma.TransactionClient,
    { session, emailHash }: ReauthenticationProof,
  ): Promise<void> {
    const usable = await transaction.userPassword.updateMany({
      where: { userId: session.context.userId, resetRequiredAt: null },
      data: { secondFactorFailures: 0 },
    });
    if (usable.count !== 1) throw passwordResetRequired();
    await transaction.signInThrottle.deleteMany({ where: { emailHash: prismaBytes(emailHash) } });
  }

  /** Ends a successful reauthentication: the session's `authTime` and methods are refreshed. */
  private async finishReauthentication(
    transaction: Prisma.TransactionClient,
    { session, request, emailHash }: ReauthenticationProof,
    methods: string[],
  ): Promise<void> {
    const { userId, agencyId, membershipId } = session.context;
    // A password alone would strip the session's MFA evidence and end it on the next request.
    if (
      methods.length === 1 &&
      (await this.userRequiresMfa(transaction, userId, agencyId, membershipId))
    ) {
      throw new AuthServiceError('MFA is required for this User identity.', 403, 'MFA_REQUIRED');
    }
    const refreshed = await transaction.userSession.updateMany({
      where: { id: session.sessionId, userId, revokedAt: null },
      data: { authTime: new Date(), authenticationMethods: methods },
    });
    if (refreshed.count !== 1) {
      throw new AuthServiceError('An active HRIS session is required.', 401, 'SESSION_ENDED');
    }
    await transaction.securityEvent.create({
      data: {
        agencyId,
        userId,
        membershipId,
        eventType: 'REAUTHENTICATED',
        requestId: request.requestId,
        ipAddress: request.ipAddress,
        userAgent: request.userAgent,
        emailHash: prismaBytes(emailHash),
        details: { methods },
      },
    });
  }

  /**
   * Ends every session of the User but this one, recording each in its own Agency, then returns
   * the transaction to this session's context. Answers how many it ended.
   */
  private async revokeOtherSessions(
    transaction: Prisma.TransactionClient,
    session: AuthenticatedSession,
    reason: string,
    requestId: string,
  ): Promise<number> {
    const { userId } = session.context;
    const revoked = await transaction.userSession.updateManyAndReturn({
      where: { userId, revokedAt: null, id: { not: session.sessionId } },
      data: { revokedAt: new Date(), revocationReason: reason },
      select: { id: true, agencyId: true, userId: true, agencyMembershipId: true },
    });
    for (const other of revoked) {
      await this.recordSystemSessionRevocation(transaction, other, reason, requestId);
    }
    if (revoked.length > 0) await setDatabaseContext(transaction, signedInScope(session));
    return revoked.length;
  }

  /**
   * Answers the reset mail to send after the response, or null. The caller answers every request
   * the same, so nothing here may tell whether the email has an account: an unknown email, a User
   * without a password, and an email past its 3 links an hour all record the attempt and send
   * nothing. Only an IP address past 20 requests an hour is refused. A User with a password gets a
   * 30-minute link whatever their status, superseding any earlier one; a Sign-in Cool-down doesn't
   * stop it. Every request, refused or not, takes at least the response floor.
   */
  async requestPasswordReset(email: string, request: SignInRequest): Promise<MailMessage | null> {
    const answerAt = Date.now() + PASSWORD_RESET_RESPONSE_FLOOR_MS;
    const emailNormalized = email.trim().toLowerCase();
    const emailHash = hashEmail(emailNormalized, this.config.BLIND_INDEX_KEY);
    const scope = { capabilities: ['platform-security'] as const };
    const now = new Date();
    const since = new Date(now.getTime() - RESET_WINDOW_MS);
    const outcome = await withDatabaseContext(scope, async (transaction) => {
      const requested = async (outcome: string, userId: string | null = null) => {
        await transaction.securityEvent.create({
          data: {
            userId,
            eventType: 'PASSWORD_RESET_REQUESTED',
            requestId: request.requestId,
            ipAddress: request.ipAddress,
            userAgent: request.userAgent,
            emailHash: prismaBytes(emailHash),
            details: { outcome },
          },
        });
        return outcome;
      };
      if (request.ipAddress) {
        const fromIp = await transaction.securityEvent.count({
          where: {
            eventType: 'PASSWORD_RESET_REQUESTED',
            ipAddress: request.ipAddress,
            occurredAt: { gte: since },
          },
        });
        if (fromIp >= RESET_IP_LIMIT) return { status: await requested('IP_RATE_LIMITED') };
      }
      const user = await transaction.user.findUnique({
        where: { emailNormalized },
        select: { id: true },
      });
      if (!user) return { status: await requested('UNKNOWN_EMAIL') };
      await setDatabaseContext(transaction, { ...scope, userId: user.id });
      const password = await transaction.userPassword.findUnique({
        where: { userId: user.id },
        select: { userId: true },
      });
      if (!password) return { status: await requested('NO_PASSWORD', user.id) };
      // One request per User at a time, so a burst can't send more links than the limit.
      await transaction.$queryRaw`
        SELECT 1 FROM "user_passwords" WHERE "user_id" = ${user.id}::uuid FOR UPDATE`;
      const sent = await transaction.securityEvent.count({
        where: {
          eventType: 'PASSWORD_RESET_REQUESTED',
          emailHash: prismaBytes(emailHash),
          occurredAt: { gte: since },
          details: { path: ['outcome'], equals: 'SENT' },
        },
      });
      if (sent >= RESET_EMAIL_LIMIT) {
        return { status: await requested('EMAIL_RATE_LIMITED', user.id) };
      }
      const token = createSessionToken();
      await transaction.passwordResetToken.updateMany({
        where: { userId: user.id, consumedAt: null, supersededAt: null },
        data: { supersededAt: now },
      });
      await transaction.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: prismaBytes(hashSessionToken(token)),
          expiresAt: new Date(now.getTime() + PASSWORD_RESET_LIFETIME_MS),
        },
      });
      return { status: await requested('SENT', user.id), token };
    }).finally(() => sleep(Math.max(0, answerAt - Date.now())));
    if (outcome.status === 'IP_RATE_LIMITED') {
      throw new AuthServiceError(
        'Too many reset requests from this network. Try again later.',
        429,
        'IP_RATE_LIMITED',
      );
    }
    if (!outcome.token) return null;
    return passwordResetLinkMail(
      emailNormalized,
      `${this.config.APP_URL}/reset-password/${outcome.token}`,
    );
  }

  /** Whether a reset link can be used, and whether it needs a code. Opening it writes nothing. */
  async lookupPasswordReset(token: string): Promise<PasswordResetLookup> {
    const tokenHash = hashSessionToken(token);
    const scope = {
      passwordResetTokenHash: tokenHash.toString('hex'),
      capabilities: ['platform-security'] as const,
    };
    const link = await withDatabaseContext(scope, (transaction) =>
      this.openResetLink(transaction, scope, tokenHash, new Date()),
    );
    return link.status === 'OPEN'
      ? {
          status: 'VALID',
          email: link.user.emailNormalized,
          secondFactor: link.secondFactor,
          expiresAt: link.expiresAt,
        }
      : { status: 'INVALID' };
  }

  /**
   * Sets a new password from a reset link. An IP address over the per-IP limit is refused before
   * the link is opened. The new password must differ from the current one; that refusal comes
   * after any second factor is proved and before a Recovery Code is spent, and leaves the link
   * usable. A User with a TOTP factor also gives a code or a Recovery Code; a wrong
   * one counts toward the email's Sign-in Cool-down, not the second-factor ceiling, and leaves
   * the link usable. Recovery Codes are matched outside a transaction, as at sign-in.
   * The last transaction holds the User's password row. Credential Proof checks a TOTP code in
   * it; then the link is checked again, a Recovery Code spent, the link consumed, the password set,
   * the Second-factor Ceiling and the cool-down cleared, and every session and pending sign-in
   * ended. It answers the notices to send.
   */
  async completePasswordReset(
    token: string,
    answer: PasswordResetAnswer,
    request: SignInRequest,
  ): Promise<{ notices: MailMessage[] }> {
    const tokenHash = hashSessionToken(token);
    const scope = {
      passwordResetTokenHash: tokenHash.toString('hex'),
      capabilities: ['platform-security'] as const,
    };
    await this.refuseOverIpLimit(request, (transaction) =>
      this.writeResetFailure(transaction, request, {
        userId: null,
        emailHash: null,
        reason: 'IP_RATE_LIMITED',
      }),
    );
    const opened = await withDatabaseContext(scope, async (transaction) => {
      const now = new Date();
      const link = await this.openResetLink(transaction, scope, tokenHash, now);
      if (link.status === 'INVALID') {
        await this.writeResetFailure(transaction, request, link);
        return { status: 'INVALID' as const };
      }
      const rejected = checkNewPassword(answer.password, {
        email: link.user.emailNormalized,
        name: link.user.displayName,
      });
      if (rejected) return { status: 'REJECTED' as const, message: rejected.message };
      const method = resetMethod(link, answer);
      if (method === 'missing') return { status: 'CODE_REQUIRED' as const };
      const { passwordHash: currentHash } = await transaction.userPassword.findUniqueOrThrow({
        where: { userId: link.user.id },
        select: { passwordHash: true },
      });
      const failure = { userId: link.user.id, emailHash: link.emailHash };
      if (!method) {
        const cooldownUntil = await readCooldown(transaction, link.emailHash, now);
        if (cooldownUntil) {
          await this.writeResetFailure(transaction, request, {
            ...failure,
            reason: 'COOLDOWN_ACTIVE',
          });
          return { status: 'COOLDOWN' as const, cooldownUntil, now };
        }
        return { status: 'OPEN' as const, link, method, currentHash, guess: null, codes: [] };
      }
      const guess = await countGuess(transaction, link.emailHash, now);
      if (guess.cooldownUntil) {
        await this.writeResetFailure(transaction, request, {
          ...failure,
          reason: 'COOLDOWN_ACTIVE',
        });
        return { status: 'COOLDOWN' as const, cooldownUntil: guess.cooldownUntil, now };
      }
      const codes =
        method === 'recovery_code'
          ? await transaction.userRecoveryCode.findMany({
              where: { userId: link.user.id },
              select: { id: true, codeHash: true },
            })
          : [];
      return { status: 'OPEN' as const, link, method, currentHash, guess, codes };
    });
    if (opened.status === 'INVALID') throw resetLinkInvalid();
    if (opened.status === 'REJECTED') {
      throw new AuthServiceError(opened.message, 400, 'PASSWORD_REJECTED');
    }
    if (opened.status === 'CODE_REQUIRED') {
      throw new AuthServiceError(
        'Enter the code from your authenticator app, or a Recovery Code.',
        400,
        'CODE_REQUIRED',
      );
    }
    if (opened.status === 'COOLDOWN') throw signInCooldown(opened.cooldownUntil, opened.now);

    const { link, method, guess } = opened;
    const userId = link.user.id;
    const wrongCode = {
      userId,
      emailHash: link.emailHash,
      reason:
        method === 'recovery_code'
          ? ('RECOVERY_CODE_INVALID' as const)
          : ('SECOND_FACTOR_INVALID' as const),
      cooldown: guess && !guess.cooldownUntil ? guess.counted.cooldown : null,
    };
    let recoveryCodeId: string | null = null;
    if (method === 'recovery_code') {
      const normalized = normalizeRecoveryCode(answer.recoveryCode ?? '');
      const matches = normalized
        ? await Promise.all(
            opened.codes.map(({ codeHash }) => verifyPassword(codeHash, normalized)),
          )
        : [];
      recoveryCodeId = opened.codes.find((_, index) => matches[index])?.id ?? null;
      if (!recoveryCodeId) {
        await withDatabaseContext({ ...scope, userId }, (transaction) =>
          this.writeResetFailure(transaction, request, wrongCode),
        );
        throw resetCodeInvalid(method);
      }
    }
    // A password change since the link opened supersedes it, so `finish` never acts on a stale
    // answer; a rehash keeps the same password.
    const [passwordHash, reusesCurrent] = await Promise.all([
      hashPassword(answer.password),
      verifyPassword(opened.currentHash, answer.password),
    ]);

    // Runs holding the User's password row: the second of two completions finds the link consumed,
    // or its TOTP code already spent.
    const finish = async (transaction: Prisma.TransactionClient) => {
      const now = new Date();
      const current = await this.openResetLink(transaction, scope, tokenHash, now);
      if (current.status === 'INVALID') {
        await this.writeResetFailure(transaction, request, current);
        return { status: 'INVALID' as const };
      }
      // A factor enrolled or removed since the link was opened changes the proof the reset needs.
      const recheck = resetMethod(current, answer);
      if (recheck === 'missing') return { status: 'CODE_REQUIRED' as const };
      if (recheck !== method) return { status: 'INVALID_CODE' as const };

      if (recoveryCodeId) {
        // A refused password leaves the code unspent for the next try.
        const where = { id: recoveryCodeId };
        const proved = reusesCurrent
          ? await transaction.userRecoveryCode.count({ where })
          : (await transaction.userRecoveryCode.deleteMany({ where })).count;
        if (proved !== 1) {
          await this.writeResetFailure(transaction, request, wrongCode);
          return { status: 'INVALID_CODE' as const };
        }
      }
      // Refused once any second factor is proved, so a link can't test a guarded User's password.
      if (reusesCurrent) return { status: 'REUSED' as const };

      // Consumed before the password changes, so the change voids no link but this one.
      await transaction.passwordResetToken.update({
        where: { id: current.tokenId },
        data: { consumedAt: now },
      });
      await transaction.userPassword.update({
        where: { userId },
        data: { passwordHash, changedAt: now, secondFactorFailures: 0, resetRequiredAt: null },
      });
      if (recoveryCodeId) await oweRecoveryCodePrompt(transaction, userId, now);
      await transaction.pendingAuthentication.deleteMany({ where: { userId } });
      await transaction.signInThrottle.deleteMany({
        where: { emailHash: prismaBytes(current.emailHash) },
      });
      const revoked = await transaction.userSession.updateManyAndReturn({
        where: { userId, revokedAt: null },
        data: { revokedAt: now, revocationReason: 'PASSWORD_RESET' },
        select: { id: true, agencyId: true, userId: true, agencyMembershipId: true },
      });
      for (const session of revoked) {
        await this.recordSystemSessionRevocation(
          transaction,
          session,
          'PASSWORD_RESET',
          request.requestId,
        );
      }
      // Each revocation is recorded in its session's Agency; return to the reset's context.
      if (revoked.length > 0) await setDatabaseContext(transaction, { ...scope, userId });
      await transaction.securityEvent.create({
        data: {
          userId,
          eventType: 'PASSWORD_RESET_COMPLETED',
          requestId: request.requestId,
          ipAddress: request.ipAddress,
          userAgent: request.userAgent,
          emailHash: prismaBytes(current.emailHash),
          details: {
            methods: ['email_link', ...(method ? [method] : [])],
            revokedSessions: revoked.length,
          },
        },
      });
      const email = current.user.emailNormalized;
      const notices = [passwordResetNotice(email, now)];
      if (recoveryCodeId) {
        const remaining = await transaction.userRecoveryCode.count({ where: { userId } });
        notices.push(recoveryCodeNotice(email, remaining, now, 'reset'));
      }
      return { status: 'RESET' as const, notices };
    };
    const outcome =
      method === 'totp'
        ? await this.credentialProof.proveTotp({
            scope: { ...scope, userId },
            user: { id: userId, email: link.user.emailNormalized, emailHash: link.emailHash },
            code: answer.code ?? '',
            request,
            wrongCode: () => resetCodeInvalid(method),
            noFactor: async () => resetCodeInvalid(method),
            passwordReset: {
              recordWrongCode: (transaction) =>
                this.writeResetFailure(transaction, request, wrongCode),
            },
            onProved: finish,
          })
        : await withDatabaseContext({ ...scope, userId }, async (transaction) => {
            await transaction.$queryRaw`
              SELECT 1 FROM "user_passwords" WHERE "user_id" = ${userId}::uuid FOR UPDATE`;
            return finish(transaction);
          });
    if (outcome.status === 'INVALID') throw resetLinkInvalid();
    if (outcome.status === 'CODE_REQUIRED') {
      throw new AuthServiceError(
        'Enter the code from your authenticator app, or a Recovery Code.',
        400,
        'CODE_REQUIRED',
      );
    }
    if (outcome.status === 'INVALID_CODE') throw resetCodeInvalid(method);
    if (outcome.status === 'REUSED') throw samePasswordRejected();
    return { notices: outcome.notices };
  }

  /**
   * Sends a credential notice. Callers run it after the transaction commits and the response is
   * sent; a delivery failure is logged without the recipient or content and never thrown.
   */
  async sendNotice(message: MailMessage): Promise<void> {
    try {
      await this.mailDelivery.send(message);
    } catch (error: unknown) {
      this.logger.warn(
        `Credential notice "${message.subject}" was not delivered (${error instanceof Error ? error.name : 'unknown error'}).`,
      );
    }
  }

  /**
   * The active session behind a token, or null. Unless `renewIdleTimer` is false, the request
   * counts as activity and moves the session's last-seen time.
   */
  async authenticateSession(
    rawToken: string,
    requestId: string,
    { renewIdleTimer = true } = {},
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

        if (renewIdleTimer) {
          const refreshed = await transaction.userSession.updateMany({
            where: { id: session.id, revokedAt: null },
            data: { lastSeenAt: new Date() },
          });
          if (refreshed.count !== 1) return null;
        }
        return {
          sessionId: session.id,
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

  /**
   * Factor Reset (#370): removes the User's factor and every Recovery Code, ends their sessions and
   * pending sign-ins, and records it in the acting Agency only. The password and `globalStatus`
   * stay as they are; an MFA-Required User enrolls again at their next sign-in. Answers the notice,
   * for `sendNotice` once the response is out.
   */
  async resetFactor(
    context: RequestContext,
    membershipId: string,
    verification: FactorResetVerification,
    request: SignInRequest,
  ): Promise<{ revokedSessions: number; notice: MailMessage }> {
    if (!hasPermission(context, 'security.mfa.reset_factor', { agencyId: context.agencyId })) {
      throw new AuthServiceError(
        'The current Membership cannot reset authenticators.',
        403,
        'FACTOR_RESET_FORBIDDEN',
      );
    }
    return withDatabaseContext(context, async (transaction) => {
      const target = await this.activeMember(transaction, context, membershipId);
      if (target.userId === context.userId) {
        throw new AuthServiceError(
          'Reset your own authenticator from Account Security, or ask another Security Administrator.',
          403,
          'SELF_FACTOR_RESET',
        );
      }
      const { userId } = target;
      // The factor, codes, and pending sign-ins are the target's own rows.
      await setDatabaseContext(transaction, {
        agencyId: context.agencyId,
        userId,
        membershipId,
      });
      // One credential change per User at a time, so new Recovery Codes or a replacement factor
      // can't land after this reset removes them.
      await transaction.$queryRaw`
        SELECT 1 FROM "user_passwords" WHERE "user_id" = ${userId}::uuid FOR UPDATE`;
      const removed = await transaction.userTotpFactor.deleteMany({ where: { userId } });
      if (removed.count === 0) {
        throw new AuthServiceError(
          'This User has no authenticator to reset.',
          409,
          'NO_AUTHENTICATOR',
        );
      }
      await transaction.userRecoveryCode.deleteMany({ where: { userId } });
      await dischargeRecoveryCodePrompt(transaction, userId);
      await transaction.pendingAuthentication.deleteMany({ where: { userId } });
      const now = new Date();
      const revokedSessions = await this.revokeMemberSessions(
        transaction,
        context,
        { userId, membershipId },
        'MFA_FACTOR_RESET',
        request.requestId,
        now,
      );
      await this.recordSecurityEvent(
        transaction,
        { ...context, userId, membershipId },
        'MFA_FACTOR_RESET',
        request.requestId,
        {
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          verificationMethod: verification.method,
          note: verification.note,
          revokedSessions,
        },
      );
      await this.recordAuditEvent(transaction, context, {
        action: 'MFA_FACTOR_RESET',
        entityType: 'User',
        entityId: userId,
        reason: verification.note,
        requestId: request.requestId,
        metadata: {
          targetMembershipId: membershipId,
          verificationMethod: verification.method,
          revokedSessions,
        },
      });
      return {
        revokedSessions,
        notice: factorResetNotice(target.user.emailNormalized, target.agency.name, now),
      };
    });
  }

  /**
   * Global User Lock (#364): denies the User every Agency and ends every session, without changing
   * any Agency Membership. The lock records the acting Agency, and is recorded there only.
   */
  async lockUser(
    context: RequestContext,
    membershipId: string,
    reason: string,
    request: SignInRequest,
  ): Promise<{ revokedSessions: number }> {
    assertLockPermission(context, 'security.users.lock');
    return withDatabaseContext(context, async (transaction) => {
      const { userId } = await this.activeMember(transaction, context, membershipId);
      if (userId === context.userId) {
        throw new AuthServiceError(
          'Ask another Security Administrator to lock your account.',
          403,
          'SELF_USER_LOCK',
        );
      }
      const now = new Date();
      const locked = await transaction.user.updateMany({
        where: { id: userId, globalStatus: 'ACTIVE' },
        data: { globalStatus: 'LOCKED', lockedAt: now, lockedByAgencyId: context.agencyId },
      });
      if (locked.count === 0) {
        throw new AuthServiceError('This User is already locked.', 409, 'USER_ALREADY_LOCKED');
      }
      const revokedSessions = await this.revokeMemberSessions(
        transaction,
        context,
        { userId, membershipId },
        'USER_LOCKED',
        request.requestId,
        now,
      );
      await this.recordSecurityEvent(
        transaction,
        { ...context, userId, membershipId },
        'USER_LOCKED',
        request.requestId,
        {
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          reason,
          revokedSessions,
        },
      );
      await this.recordAuditEvent(transaction, context, {
        action: 'USER_LOCKED',
        entityType: 'User',
        entityId: userId,
        previousStatus: 'ACTIVE',
        newStatus: 'LOCKED',
        reason,
        requestId: request.requestId,
        metadata: { targetMembershipId: membershipId, revokedSessions },
      });
      return { revokedSessions };
    });
  }

  /**
   * Lifts a Global User Lock (#364). Only the locking Agency may, unless it no longer has the User
   * as an ACTIVE member; then any Agency that does may, and the event says the locking Agency was
   * gone without naming it. A Password Reset never lifts a lock.
   */
  async unlockUser(
    context: RequestContext,
    membershipId: string,
    reason: string,
    request: SignInRequest,
  ): Promise<{ revokedSessions: number }> {
    assertLockPermission(context, 'security.users.unlock');
    return withDatabaseContext(context, async (transaction) => {
      const { userId } = await this.activeMember(transaction, context, membershipId);
      await transaction.$queryRaw`SELECT 1 FROM "users" WHERE "id" = ${userId}::uuid FOR UPDATE`;
      const { lockedByAgencyId } = await transaction.user.findUniqueOrThrow({
        where: { id: userId },
        select: { lockedByAgencyId: true },
      });
      if (!lockedByAgencyId) {
        throw new AuthServiceError('This User is not locked.', 409, 'USER_NOT_LOCKED');
      }
      const lockingAgencyGone =
        lockedByAgencyId !== context.agencyId &&
        (await liftedLockUserIds(transaction, [userId])).has(userId);
      if (lockedByAgencyId !== context.agencyId && !lockingAgencyGone) {
        throw new AuthServiceError(
          'Only a Security Administrator of the Agency that locked this User can unlock them.',
          403,
          'UNLOCK_NOT_PERMITTED',
        );
      }
      await transaction.user.update({
        where: { id: userId },
        data: { globalStatus: 'ACTIVE', lockedAt: null, lockedByAgencyId: null },
      });
      const revokedSessions = await this.revokeMemberSessions(
        transaction,
        context,
        { userId, membershipId },
        'USER_UNLOCKED',
        request.requestId,
        new Date(),
      );
      await this.recordSecurityEvent(
        transaction,
        { ...context, userId, membershipId },
        'USER_UNLOCKED',
        request.requestId,
        {
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          reason,
          lockingAgencyGone,
          revokedSessions,
        },
      );
      await this.recordAuditEvent(transaction, context, {
        action: 'USER_UNLOCKED',
        entityType: 'User',
        entityId: userId,
        previousStatus: 'LOCKED',
        newStatus: 'ACTIVE',
        reason,
        requestId: request.requestId,
        metadata: { targetMembershipId: membershipId, lockingAgencyGone, revokedSessions },
      });
      return { revokedSessions };
    });
  }

  /**
   * The ACTIVE member of the acting Agency that a security action targets. The membership row is
   * held to commit, so a suspension can't land between this check and the action.
   */
  private async activeMember(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    membershipId: string,
  ) {
    await transaction.$queryRaw`
      SELECT 1 FROM "agency_memberships" WHERE "id" = ${membershipId}::uuid FOR NO KEY UPDATE`;
    const member = await transaction.agencyMembership.findFirst({
      where: { id: membershipId, agencyId: context.agencyId, status: 'ACTIVE' },
      select: {
        userId: true,
        agency: { select: { name: true } },
        user: { select: { emailNormalized: true } },
      },
    });
    if (!member) {
      throw new AuthServiceError(
        'No active member of this Agency matches.',
        404,
        'MEMBER_NOT_FOUND',
      );
    }
    return member;
  }

  /**
   * Revokes every session of the member's User, in every Agency. Each revocation is recorded in the
   * acting Agency, against the member's membership there, so the User's other Agencies learn
   * nothing of it. Leaves the transaction in `context`.
   */
  private async revokeMemberSessions(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    member: { userId: string; membershipId: string },
    reason: string,
    requestId: string,
    now: Date,
  ): Promise<number> {
    const { userId, membershipId } = member;
    // Sessions in the User's other Agencies are visible only in the User's own context.
    await setDatabaseContext(transaction, { agencyId: context.agencyId, userId, membershipId });
    const revoked = await transaction.userSession.updateManyAndReturn({
      where: { userId, revokedAt: null },
      data: { revokedAt: now, revocationReason: reason },
      select: { id: true },
    });
    for (const { id } of revoked) {
      await this.recordSystemSessionRevocation(
        transaction,
        { id, agencyId: context.agencyId, userId, agencyMembershipId: membershipId },
        reason,
        requestId,
      );
    }
    await setDatabaseContext(transaction, context);
    return revoked.length;
  }

  /**
   * What the invitation page shows. Opening an invitation writes nothing, not even its expiry; an
   * expired one stays PENDING until it is replaced or cancelled.
   */
  async lookupInvitation(token: string): Promise<InvitationLookup> {
    const scope = this.activationScope(token);
    const result = await withDatabaseContext(scope, async (transaction) => {
      const invitation = await this.readActivationInvitation(transaction, scope, new Date());
      if (invitation === 'EXPIRED') return { status: invitation };
      if (typeof invitation === 'string') return { status: 'INVALID' as const };
      const existingUser = await transaction.user.findUnique({
        where: { emailNormalized: invitation.emailNormalized },
        select: { id: true },
      });
      return {
        status: 'VALID' as const,
        brandKeys: await readAgencyBrandKeys(transaction, invitation.agencyId),
        email: invitation.emailNormalized,
        agency: invitation.agency,
        roleNames: invitation.roles.map(({ name }) => name),
        existingUser: existingUser !== null,
        expiresAt: invitation.expiresAt,
      };
    });
    if (result.status !== 'VALID') return result;
    const { brandKeys, ...invitation } = result;
    const ttl = Math.max(
      1,
      Math.min(300, Math.floor((invitation.expiresAt.getTime() - Date.now()) / 1000)),
    );
    return {
      ...invitation,
      agency: {
        ...invitation.agency,
        sealUrl: brandKeys.sealKey
          ? await this.brandingStorage.signedReadUrl(brandKeys.sealKey, ttl)
          : null,
        photoUrl: brandKeys.photoKey
          ? await this.brandingStorage.signedReadUrl(brandKeys.photoKey, ttl)
          : null,
      },
    };
  }

  /**
   * First Invitation Activation step. A User who already has the invitation's email proves it is
   * them with their current password, counted toward the Sign-in Cool-down like a sign-in, and
   * never sets a password here. Anyone else gives their name and a new password that meets the
   * password rules. Whoever must add a second factor first gets a 15-minute pending activation,
   * replacing any earlier one for the invitation; anyone else is activated at once.
   */
  async startActivation(
    token: string,
    input: { name?: string | undefined; password: string },
    request: SignInRequest,
  ): Promise<ActivationStart> {
    return this.activationStep(token, request, async () => {
      const scope = this.activationScope(token);
      const opened = await withDatabaseContext(scope, async (transaction) => {
        const invitation = await this.openActivationInvitation(transaction, scope, new Date());
        const user = await transaction.user.findUnique({
          where: { emailNormalized: invitation.emailNormalized },
          select: { id: true, globalStatus: true },
        });
        if (!user) return { invitation, account: null };
        await setDatabaseContext(transaction, {
          ...scope,
          agencyId: invitation.agencyId,
          userId: user.id,
        });
        const stored = await transaction.userPassword.findUnique({
          where: { userId: user.id },
          select: { passwordHash: true, resetRequiredAt: true },
        });
        return { invitation, account: { ...user, stored } };
      });
      return opened.account
        ? this.startExistingUserActivation(
            scope,
            opened.invitation,
            opened.account,
            input.password,
            request,
          )
        : this.startFirstTimeActivation(scope, opened.invitation, input, request);
    });
  }

  /**
   * An existing User's TOTP code, checked by Credential Proof as on sign-in. The activation is
   * opened again and finished in the transaction that accepts the code.
   */
  async completeActivationWithTotp(
    token: string,
    pendingToken: string,
    code: string,
    request: SignInRequest,
  ): Promise<ActivationDone> {
    return this.activationStep(token, request, async () => {
      const scope = this.activationScope(token, pendingToken);
      const { invitation, userId } = await withDatabaseContext(scope, (transaction) =>
        this.openExistingUserStep(transaction, scope, new Date()),
      );
      const email = invitation.emailNormalized;
      return this.credentialProof.proveTotp({
        scope: { ...scope, agencyId: invitation.agencyId, userId },
        user: { id: userId, email, emailHash: hashEmail(email, this.config.BLIND_INDEX_KEY) },
        code,
        request,
        wrongCode: () => new AuthServiceError('The code is incorrect.', 401, 'INVALID_CODE'),
        noFactor: async () => activationExpired(),
        onProved: async (transaction) => {
          const opened = await this.openExistingUserStep(transaction, scope, new Date());
          return this.finishActivation(transaction, scope, request, {
            invitation: opened.invitation,
            pending: opened.pending,
            userId,
            methods: [...opened.pending.verifiedMethods, 'totp'],
          });
        },
      });
    });
  }

  /**
   * An existing User's Recovery Code in place of the TOTP code. As in `completeRecoveryCodeSignIn`,
   * the code is matched outside the transaction and spent in it, and the User's other sessions end.
   */
  async completeActivationWithRecoveryCode(
    token: string,
    pendingToken: string,
    code: string,
    request: SignInRequest,
  ): Promise<ActivationDone> {
    return this.activationStep(token, request, async () => {
      const scope = this.activationScope(token, pendingToken);
      const now = new Date();
      const opened = await withDatabaseContext(scope, async (transaction) => {
        const { invitation, userId } = await this.openExistingUserStep(transaction, scope, now);
        const emailHash = hashEmail(invitation.emailNormalized, this.config.BLIND_INDEX_KEY);
        const guess = await countGuess(transaction, emailHash, now);
        if (guess.cooldownUntil) {
          await writeSignInFailure(transaction, request, {
            userId,
            emailHash,
            reason: 'COOLDOWN_ACTIVE',
            method: 'recovery_code',
          });
        }
        const codes = guess.cooldownUntil
          ? []
          : await transaction.userRecoveryCode.findMany({
              where: { userId },
              select: { id: true, codeHash: true },
            });
        return { email: invitation.emailNormalized, userId, emailHash, codes, guess };
      });
      const { guess } = opened;
      if (guess.cooldownUntil) throw signInCooldown(guess.cooldownUntil, now);

      const normalized = normalizeRecoveryCode(code);
      const matches = normalized
        ? await Promise.all(
            opened.codes.map(({ codeHash }) => verifyPassword(codeHash, normalized)),
          )
        : [];
      const used = opened.codes.find((_, index) => matches[index]);
      if (!used) {
        await this.recordGuessFailure(request, {
          emailHash: opened.emailHash,
          userId: opened.userId,
          reason: 'INVALID_CODE',
          cooldown: guess.counted.cooldown,
          secondFactor: { method: 'recovery_code', email: opened.email },
        });
        throw new AuthServiceError('The Recovery Code is incorrect.', 401, 'INVALID_CODE');
      }
      await this.refundGuess(opened.emailHash, guess);
      return withDatabaseContext(scope, async (transaction) => {
        const { invitation, pending, userId } = await this.openExistingUserStep(
          transaction,
          scope,
          new Date(),
        );
        await lockUserPassword(transaction, userId);
        const spent = await transaction.userRecoveryCode.deleteMany({ where: { id: used.id } });
        if (spent.count !== 1) {
          throw new AuthServiceError('The Recovery Code is incorrect.', 401, 'INVALID_CODE');
        }
        return this.finishActivation(transaction, scope, request, {
          invitation,
          pending,
          userId,
          methods: [...pending.verifiedMethods, 'recovery_code'],
          recoveryCodeUsed: true,
        });
      });
    });
  }

  /**
   * Confirms the pending activation's new TOTP secret with one code and answers the 10 Recovery
   * Codes, shown once. Like `confirmTotpEnrollment`, but for a pending activation.
   */
  async confirmActivationEnrollment(
    token: string,
    pendingToken: string,
    code: string,
    request: SignInRequest,
  ): Promise<{ recoveryCodes: string[] }> {
    return this.activationStep(token, request, async () => {
      const scope = this.activationScope(token, pendingToken);
      const { pending } = await withDatabaseContext(scope, (transaction) =>
        this.openActivationStep(transaction, scope, new Date(), ENROLL_SCAN_STAGE),
      );
      const confirmed = await confirmTotpEnrollment(
        this.dataEncryptionKey,
        { userId: pending.userId ?? pending.id, factorId: pending.id },
        Buffer.from(pending.enrollmentSecretEnvelope ?? []),
        code,
      );
      if (!confirmed) throw new AuthServiceError('The code is incorrect.', 401, 'INVALID_CODE');
      const advanced = await withDatabaseContext(scope, (transaction) =>
        transaction.pendingAuthentication.updateMany({
          where: { id: pending.id, stage: ENROLL_SCAN_STAGE, expiresAt: { gt: new Date() } },
          data: {
            stage: ENROLL_CODES_STAGE,
            verifiedMethods: [...pending.verifiedMethods, 'totp'],
            enrollmentAcceptedStep: confirmed.step,
            enrollmentConfirmedAt: confirmed.confirmedAt,
            recoveryCodeHashes: confirmed.recoveryCodeHashes,
          },
        }),
      );
      if (advanced.count !== 1) throw activationExpired();
      return { recoveryCodes: confirmed.recoveryCodes };
    });
  }

  /** Final enrollment step, once the User acknowledged saving the Recovery Codes. */
  async finishActivationEnrollment(
    token: string,
    pendingToken: string,
    request: SignInRequest,
  ): Promise<ActivationDone> {
    return this.activationStep(token, request, () => {
      const scope = this.activationScope(token, pendingToken);
      return withDatabaseContext(scope, async (transaction) => {
        const { invitation, pending } = await this.openActivationStep(
          transaction,
          scope,
          new Date(),
          ENROLL_CODES_STAGE,
        );
        return this.finishActivation(transaction, scope, request, {
          invitation,
          pending,
          userId: pending.userId ?? pending.id,
          methods: pending.verifiedMethods,
          authTime: enrollmentAuthTime(pending, activationExpired),
          ...(pending.userId ? {} : { newUser: firstTimeUser(pending) }),
        });
      });
    });
  }

  async revokeSession(
    rawToken: string,
    session: AuthenticatedSession,
    reason: string,
    requestId: string,
  ): Promise<void> {
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
        status: { in: ['ACTIVE', 'SUSPENDED'] },
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
  ): Promise<AuthenticatedSession & { token: string }> {
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
        return this.createSession(
          transaction,
          user.id,
          membership.id,
          { authTime: null, authenticationMethods: session.authenticationMethods },
          requestId,
          {
            authTime: session.authTime,
            createdAt: session.createdAt,
            expiresAt: session.expiresAt,
          },
        );
      },
    );
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

  private activationScope(token: string, pendingToken?: string): ActivationScope {
    return {
      invitationTokenHash: hashSessionToken(token).toString('hex'),
      ...(pendingToken ? { pendingTokenHash: hashSessionToken(pendingToken).toString('hex') } : {}),
      capabilities: ['platform-security'],
    };
  }

  /** Runs an activation step; each refusal is also an INVITATION_ACTIVATION_FAILED Security Event. */
  private async activationStep<T>(
    token: string,
    request: SignInRequest,
    step: () => Promise<T>,
  ): Promise<T> {
    try {
      return await step();
    } catch (error: unknown) {
      if (error instanceof AuthServiceError) {
        await this.recordActivationFailure(token, request, error.code);
      }
      throw error;
    }
  }

  /** Recorded in the inviting Agency, or without one when the token matches no invitation. */
  private async recordActivationFailure(
    token: string,
    request: SignInRequest,
    reason: string,
  ): Promise<void> {
    const scope = this.activationScope(token);
    await withDatabaseContext(scope, async (transaction) => {
      const invitation = await transaction.invitation.findUnique({
        where: { tokenHash: prismaBytes(hashSessionToken(token)) },
        select: { id: true, agencyId: true },
      });
      if (invitation)
        await setDatabaseContext(transaction, { ...scope, agencyId: invitation.agencyId });
      await transaction.securityEvent.create({
        data: {
          agencyId: invitation?.agencyId ?? null,
          eventType: 'INVITATION_ACTIVATION_FAILED',
          requestId: request.requestId,
          ipAddress: request.ipAddress,
          userAgent: request.userAgent,
          details: { invitationId: invitation?.id ?? null, reason },
        },
      });
    });
  }

  /**
   * The invitation an activation step uses, with the transaction left in its Agency's context, or
   * why it can't be used. It is read without writing anything.
   */
  private async readActivationInvitation(
    transaction: Prisma.TransactionClient,
    scope: ActivationScope,
    now: Date,
  ): Promise<ActivationInvitation | 'EXPIRED' | 'INVALID' | 'ROLE_UNAVAILABLE'> {
    const invitation = await transaction.invitation.findFirst({
      where: {
        tokenHash: prismaBytes(Buffer.from(scope.invitationTokenHash, 'hex')),
        status: 'PENDING',
      },
    });
    if (!invitation) return 'INVALID';
    if (invitation.expiresAt <= now) return 'EXPIRED';
    await setDatabaseContext(transaction, { ...scope, agencyId: invitation.agencyId });
    const agency = await transaction.agency.findUniqueOrThrow({
      where: { id: invitation.agencyId },
      select: { name: true, acronym: true, status: true },
    });
    const available = await transaction.role.findMany({
      where: {
        code: { in: invitation.requestedRoleCodes },
        status: 'ACTIVE',
        OR: [{ agencyId: null }, { agencyId: invitation.agencyId }],
      },
      select: {
        id: true,
        agencyId: true,
        code: true,
        name: true,
        permissions: { select: { permission: { select: { code: true } } } },
      },
    });
    const roles = selectInvitationRoles(
      available,
      invitation.requestedRoleCodes,
      invitation.agencyId,
    );
    if (agency.status !== 'ACTIVE') return 'INVALID';
    if (roles.length !== invitation.requestedRoleCodes.length) return 'ROLE_UNAVAILABLE';
    return {
      id: invitation.id,
      agencyId: invitation.agencyId,
      agency: { name: agency.name, acronym: agency.acronym },
      emailNormalized: invitation.emailNormalized.toLowerCase(),
      invitedByMembershipId: invitation.invitedByMembershipId,
      expiresAt: invitation.expiresAt,
      roles: roles.map(({ id, code, name }) => ({ id, code, name })),
      requiresMfa: permissionsRequireMfa(roles.flatMap(permissionGrants)),
    };
  }

  /** `readActivationInvitation`, refusing an invitation that can't be used. */
  private async openActivationInvitation(
    transaction: Prisma.TransactionClient,
    scope: ActivationScope,
    now: Date,
  ): Promise<ActivationInvitation> {
    const invitation = await this.readActivationInvitation(transaction, scope, now);
    if (invitation === 'EXPIRED') throw invitationExpired();
    if (invitation === 'INVALID') throw invitationInvalid();
    if (invitation === 'ROLE_UNAVAILABLE') throw invitationRoleUnavailable();
    return invitation;
  }

  private async startExistingUserActivation(
    scope: ActivationScope,
    invitation: ActivationInvitation,
    account: {
      id: string;
      globalStatus: string;
      stored: { passwordHash: string; resetRequiredAt: Date | null } | null;
    },
    password: string,
    request: SignInRequest,
  ): Promise<ActivationStart> {
    const userId = account.id;
    const emailHash = hashEmail(invitation.emailNormalized, this.config.BLIND_INDEX_KEY);
    await this.assertIpAllowed(request, emailHash);
    const now = new Date();
    const guess = await withDatabaseContext(
      { capabilities: ['platform-security'] },
      (transaction) => countGuess(transaction, emailHash, now),
    );
    if (guess.cooldownUntil) {
      await this.recordSignInFailure(request, emailHash, userId, 'COOLDOWN_ACTIVE');
      throw signInCooldown(guess.cooldownUntil, now);
    }
    const verified = account.stored
      ? await verifyPassword(account.stored.passwordHash, password)
      : await verifyPasswordAgainstDummy(password);
    if (!account.stored || !verified) {
      await this.recordGuessFailure(request, {
        emailHash,
        userId,
        reason: 'INVALID_CREDENTIALS',
        cooldown: guess.counted.cooldown,
      });
      throw new AuthServiceError('The password is incorrect.', 401, 'INVALID_CREDENTIALS');
    }
    await this.refundGuess(emailHash, guess);
    if (account.stored.resetRequiredAt) {
      await this.recordSignInFailure(request, emailHash, userId, 'PASSWORD_RESET_REQUIRED');
      throw passwordResetRequired();
    }
    assertUserActive(account.globalStatus);

    const context = { ...scope, agencyId: invitation.agencyId, userId };
    return withDatabaseContext(context, async (transaction): Promise<ActivationStart> => {
      const factor = await transaction.userTotpFactor.findUnique({
        where: { userId },
        select: { id: true },
      });
      if (factor) {
        const pending = await this.openPendingActivation(transaction, invitation, request, {
          id: randomUUID(),
          userId,
          stage: 'TOTP',
        });
        return { status: 'CODE_REQUIRED', pendingToken: pending.token };
      }
      const requiresMfa =
        invitation.requiresMfa || (await this.membershipsRequireMfa(transaction, userId));
      await setDatabaseContext(transaction, context);
      if (requiresMfa) {
        return this.startActivationEnrollment(transaction, invitation, request, { userId });
      }
      return {
        status: 'ACTIVATED',
        ...(await this.finishActivation(transaction, scope, request, {
          invitation,
          userId,
          methods: ['pwd'],
        })),
      };
    });
  }

  private async startFirstTimeActivation(
    scope: ActivationScope,
    invitation: ActivationInvitation,
    input: { name?: string | undefined; password: string },
    request: SignInRequest,
  ): Promise<ActivationStart> {
    const displayName = input.name?.trim();
    if (!displayName) throw new AuthServiceError('Enter your full name.', 400, 'NAME_REQUIRED');
    const rejected = checkNewPassword(input.password, {
      email: invitation.emailNormalized,
      name: displayName,
    });
    if (rejected) throw new AuthServiceError(rejected.message, 400, 'PASSWORD_REJECTED');
    const passwordHash = await hashPassword(input.password);
    return withDatabaseContext(
      { ...scope, agencyId: invitation.agencyId },
      async (transaction): Promise<ActivationStart> => {
        if (invitation.requiresMfa) {
          return this.startActivationEnrollment(transaction, invitation, request, {
            userId: null,
            displayName,
            passwordHash,
          });
        }
        return {
          status: 'ACTIVATED',
          ...(await this.finishActivation(transaction, scope, request, {
            invitation,
            userId: randomUUID(),
            methods: ['pwd'],
            newUser: { displayName, passwordHash },
          })),
        };
      },
    );
  }

  /**
   * A pending activation that enrolls a TOTP factor. The secret is sealed for the pending row's id,
   * which becomes the factor id and, for a first-time User, the new User's id.
   */
  private async startActivationEnrollment(
    transaction: Prisma.TransactionClient,
    invitation: ActivationInvitation,
    request: SignInRequest,
    owner: { userId: string | null; displayName?: string; passwordHash?: string },
  ): Promise<ActivationStart> {
    const id = randomUUID();
    const enrollment = beginTotpEnrollment(
      this.dataEncryptionKey,
      { userId: owner.userId ?? id, factorId: id },
      invitation.emailNormalized,
    );
    const pending = await this.openPendingActivation(transaction, invitation, request, {
      ...owner,
      id,
      stage: ENROLL_SCAN_STAGE,
      enrollmentSecretEnvelope: enrollment.envelope,
    });
    return {
      status: 'ENROLLMENT_REQUIRED',
      pendingToken: pending.token,
      enrollment: {
        otpauthUri: enrollment.otpauthUri,
        account: invitation.emailNormalized,
        expiresAt: pending.expiresAt,
      },
    };
  }

  /**
   * Starts the invitation's pending activation, replacing any earlier one. The invitation row is
   * locked first, so concurrent starts and saves of one invitation take turns.
   */
  private async openPendingActivation(
    transaction: Prisma.TransactionClient,
    invitation: ActivationInvitation,
    request: SignInRequest,
    pending: {
      id: string;
      userId: string | null;
      stage: PendingSignInStage;
      displayName?: string;
      passwordHash?: string;
      enrollmentSecretEnvelope?: Buffer;
    },
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = createSessionToken();
    const expiresAt = new Date(Date.now() + PENDING_ACTIVATION_LIFETIME_MS);
    await transaction.$queryRaw`
      SELECT 1 FROM "invitations" WHERE "id" = ${invitation.id}::uuid FOR UPDATE`;
    await transaction.pendingAuthentication.deleteMany({
      where: { invitationId: invitation.id, purpose: 'ACTIVATION' },
    });
    await transaction.pendingAuthentication.create({
      data: {
        id: pending.id,
        tokenHash: prismaBytes(hashSessionToken(token)),
        purpose: 'ACTIVATION',
        invitationId: invitation.id,
        userId: pending.userId,
        stage: pending.stage,
        verifiedMethods: ['pwd'],
        displayName: pending.displayName ?? null,
        passwordHash: pending.passwordHash ?? null,
        enrollmentSecretEnvelope: pending.enrollmentSecretEnvelope
          ? prismaBytes(pending.enrollmentSecretEnvelope)
          : null,
        expiresAt,
      },
    });
    await transaction.securityEvent.create({
      data: {
        agencyId: invitation.agencyId,
        userId: pending.userId,
        eventType: 'INVITATION_ACTIVATION_STARTED',
        requestId: request.requestId,
        ipAddress: request.ipAddress,
        userAgent: request.userAgent,
        details: {
          invitationId: invitation.id,
          path: pending.userId ? 'EXISTING_USER' : 'FIRST_TIME',
          nextStep: pending.stage,
        },
      },
    });
    return { token, expiresAt };
  }

  /**
   * The pending activation a later step continues, waiting at `stage`, with its invitation checked
   * again. A replaced, finished, or expired one gives ACTIVATION_EXPIRED.
   */
  private async openActivationStep(
    transaction: Prisma.TransactionClient,
    scope: ActivationScope,
    now: Date,
    stage: PendingSignInStage,
  ): Promise<{ invitation: ActivationInvitation; pending: PendingActivation }> {
    const invitation = await this.openActivationInvitation(transaction, scope, now);
    const pending = await transaction.pendingAuthentication.findUnique({
      where: { tokenHash: prismaBytes(Buffer.from(scope.pendingTokenHash ?? '', 'hex')) },
    });
    if (
      !pending ||
      pending.purpose !== 'ACTIVATION' ||
      pending.invitationId !== invitation.id ||
      pending.stage !== stage ||
      pending.expiresAt <= now
    ) {
      throw activationExpired();
    }
    return { invitation, pending };
  }

  /** `openActivationStep` for an existing User's code, in the User's context. */
  private async openExistingUserStep(
    transaction: Prisma.TransactionClient,
    scope: ActivationScope,
    now: Date,
  ): Promise<{ invitation: ActivationInvitation; pending: PendingActivation; userId: string }> {
    const opened = await this.openActivationStep(transaction, scope, now, 'TOTP');
    const userId = opened.pending.userId;
    if (!userId) throw activationExpired();
    await setDatabaseContext(transaction, {
      ...scope,
      agencyId: opened.invitation.agencyId,
      userId,
    });
    return { ...opened, userId };
  }

  /**
   * The final save of an Invitation Activation, in the caller's transaction. It consumes the
   * pending activation and the invitation; writes a first-time User with their password, any
   * enrolled factor and Recovery Codes, and the Agency Membership with the invited roles; and opens
   * a session in the inviting Agency. The invitation is accepted first with a conditional update,
   * so of two saves exactly one wins, and a refusal after it rolls everything back. The invited
   * roles are checked again here, since a step may have read them before its password work.
   */
  private async finishActivation(
    transaction: Prisma.TransactionClient,
    scope: ActivationScope,
    request: SignInRequest,
    finish: {
      invitation: ActivationInvitation;
      userId: string;
      methods: readonly string[];
      authTime?: Date;
      pending?: PendingActivation;
      newUser?: { displayName: string; passwordHash: string };
      recoveryCodeUsed?: boolean;
    },
  ): Promise<ActivationDone> {
    const { invitation, userId, pending, newUser } = finish;
    const { requestId, ipAddress, userAgent } = request;
    const email = invitation.emailNormalized;
    const emailHash = hashEmail(email, this.config.BLIND_INDEX_KEY);
    const now = new Date();
    const context = { ...scope, agencyId: invitation.agencyId, userId };
    await setDatabaseContext(transaction, context);
    const activeRoles = await transaction.role.count({
      where: { id: { in: invitation.roles.map(({ id }) => id) }, status: 'ACTIVE' },
    });
    if (activeRoles !== invitation.roles.length) throw invitationRoleUnavailable();
    if (pending) {
      const consumed = await transaction.pendingAuthentication.deleteMany({
        where: { id: pending.id, stage: pending.stage, expiresAt: { gt: now } },
      });
      if (consumed.count !== 1) throw activationExpired();
    }
    const accepted = await transaction.invitation.updateMany({
      where: { id: invitation.id, status: 'PENDING', expiresAt: { gt: now } },
      data: { status: 'ACCEPTED', acceptedAt: now },
    });
    if (accepted.count !== 1) throw invitationInvalid();
    await transaction.pendingAuthentication.deleteMany({
      where: { invitationId: invitation.id, purpose: 'ACTIVATION' },
    });

    let wasMfaRequired = false;
    if (newUser) {
      // Another invitation activated this email meanwhile; starting again takes the existing path.
      const taken = await transaction.user.findUnique({
        where: { emailNormalized: email },
        select: { id: true },
      });
      if (taken) throw activationExpired();
      await transaction.user.create({
        data: {
          id: userId,
          emailNormalized: email,
          displayName: newUser.displayName,
          globalStatus: 'ACTIVE',
          emailVerifiedAt: now,
        },
      });
      await transaction.userPassword.create({
        data: { userId, passwordHash: newUser.passwordHash },
      });
      await transaction.securityEvent.create({
        data: {
          userId,
          eventType: 'PASSWORD_SET',
          requestId,
          ipAddress,
          userAgent,
          emailHash: prismaBytes(emailHash),
          details: { invitationId: invitation.id },
        },
      });
    } else {
      // Read again: a Global User Lock may have landed since the password was checked.
      const user = await transaction.user.findUniqueOrThrow({
        where: { id: userId },
        select: { globalStatus: true, emailVerifiedAt: true },
      });
      assertUserActive(user.globalStatus);
      if (!user.emailVerifiedAt) {
        await transaction.user.update({ where: { id: userId }, data: { emailVerifiedAt: now } });
      }
      wasMfaRequired = await this.membershipsRequireMfa(transaction, userId);
      await setDatabaseContext(transaction, context);
    }

    const notices: MailMessage[] = [];
    if (pending?.stage === ENROLL_CODES_STAGE) {
      await writeTotpEnrollment(transaction, pending, userId);
      await transaction.securityEvent.create({
        data: {
          userId,
          eventType: 'TOTP_ENROLLED',
          requestId,
          ipAddress,
          userAgent,
          emailHash: prismaBytes(emailHash),
          details: { recoveryCodes: pending.recoveryCodeHashes.length },
        },
      });
      notices.push(totpEnrolledNotice(email));
    }

    // A deactivated membership stays as it is; the User joins again with a new one.
    const current = await transaction.agencyMembership.findFirst({
      where: { agencyId: invitation.agencyId, userId, status: { not: 'DEACTIVATED' } },
    });
    if (current && current.status !== 'INVITED') {
      throw new AuthServiceError(
        'You already have an Agency Membership here.',
        409,
        'MEMBERSHIP_EXISTS',
      );
    }
    const membership = current
      ? await transaction.agencyMembership.update({
          where: { id: current.id },
          data: { status: 'ACTIVE', activatedAt: now },
        })
      : await transaction.agencyMembership.create({
          data: { agencyId: invitation.agencyId, userId, status: 'ACTIVE', activatedAt: now },
        });
    for (const role of invitation.roles) {
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

    const revocationReason = finish.recoveryCodeUsed
      ? 'RECOVERY_CODE_SIGN_IN'
      : !newUser && !wasMfaRequired && invitation.requiresMfa
        ? 'MFA_REQUIRED'
        : null;
    let revokedSessions = 0;
    if (revocationReason) {
      const revoked = await transaction.userSession.updateManyAndReturn({
        where: { userId, revokedAt: null },
        data: { revokedAt: now, revocationReason },
        select: { id: true, agencyId: true, userId: true, agencyMembershipId: true },
      });
      for (const session of revoked) {
        await this.recordSystemSessionRevocation(transaction, session, revocationReason, requestId);
      }
      revokedSessions = revoked.length;
      await setDatabaseContext(transaction, context);
    }

    const membershipContext: RequestContext = {
      requestId,
      userId,
      agencyId: invitation.agencyId,
      membershipId: membership.id,
      primaryOrganizationUnitId: membership.primaryOrganizationUnitId,
      permissions: [],
    };
    const details = {
      invitationId: invitation.id,
      roleCodes: invitation.roles.map(({ code }) => code),
      assignedByMembershipId: invitation.invitedByMembershipId,
    };
    await this.recordSecurityEvent(
      transaction,
      membershipContext,
      'INVITATION_ACCEPTED',
      requestId,
      details,
    );
    await this.recordAuditEvent(transaction, membershipContext, {
      action: 'INVITATION_ACCEPTED',
      entityType: 'AgencyMembership',
      entityId: membership.id,
      requestId,
      metadata: details,
    });
    await setDatabaseContext(transaction, context);
    const session = await this.openOwnedSession(
      transaction,
      userId,
      membership.id,
      finish.methods,
      request,
      emailHash,
      finish.authTime,
    );
    if (finish.recoveryCodeUsed) {
      const remaining = await transaction.userRecoveryCode.count({ where: { userId } });
      await transaction.securityEvent.create({
        data: {
          agencyId: invitation.agencyId,
          userId,
          membershipId: membership.id,
          eventType: 'RECOVERY_CODE_USED',
          requestId,
          ipAddress,
          userAgent,
          emailHash: prismaBytes(emailHash),
          details: { remaining, revokedSessions },
        },
      });
      notices.push(recoveryCodeNotice(email, remaining, now));
      return { session, notices, recoveryCodesRemaining: remaining };
    }
    return { session, notices, recoveryCodesRemaining: session.recoveryCodesRemaining };
  }

  private async openOwnedSession(
    transaction: Prisma.TransactionClient,
    userId: string,
    requestedMembershipId: string | null,
    methods: readonly string[],
    request: SignInRequest,
    emailHash: Buffer,
    authTime?: Date,
  ): Promise<OpenedSession> {
    const now = new Date();
    // Holds the User row through session creation, so a Global User Lock either commits first and
    // refuses this sign-in, or waits and then revokes the new session.
    const active = await transaction.user.updateMany({
      where: { id: userId, globalStatus: 'ACTIVE' },
      data: { lastLoginAt: now },
    });
    if (active.count !== 1) {
      throw new AuthServiceError('This identity is not active.', 403, 'USER_NOT_ACTIVE');
    }
    // A full sign-in resets the second-factor count and the email's Sign-in Cool-down. A password
    // disabled while this sign-in was under way refuses it.
    const usable = await transaction.userPassword.updateMany({
      where: { userId, resetRequiredAt: null },
      data: { secondFactorFailures: 0 },
    });
    if (usable.count !== 1) throw passwordResetRequired();
    // Every sign-in takes an owed remaining-codes prompt, so a second one shows nothing.
    const recoveryCodesRemaining = await takeRecoveryCodePrompt(transaction, userId);
    await transaction.signInThrottle.deleteMany({ where: { emailHash: prismaBytes(emailHash) } });
    const membership = await this.selectSignInMembership(
      transaction,
      userId,
      requestedMembershipId,
    );
    const session = await this.createSession(
      transaction,
      userId,
      membership.id,
      {
        authTime: authTime ?? now,
        authenticationMethods: methods,
        emailHash,
        ipAddress: request.ipAddress,
        userAgent: request.userAgent,
      },
      request.requestId,
    );
    return { ...session, recoveryCodesRemaining };
  }

  /**
   * The pending sign-in a second-factor or enrollment step continues, with its User in the
   * transaction's context. A missing one, one waiting for another stage, or an expired one (which
   * is deleted), is recorded as a `SIGN_IN_EXPIRED` failure and gives null.
   */
  private async openPendingSignIn(
    transaction: Prisma.TransactionClient,
    scope: PendingScope,
    pendingToken: string,
    request: SignInRequest,
    method: SecondFactorMethod,
    now: Date,
    stage: PendingSignInStage = 'TOTP',
  ): Promise<PendingSignIn | null> {
    const pending = await transaction.pendingAuthentication.findUnique({
      where: { tokenHash: prismaBytes(hashSessionToken(pendingToken)) },
    });
    if (!pending?.userId || pending.purpose !== 'SIGN_IN' || pending.stage !== stage) {
      await writeSignInFailure(transaction, request, {
        userId: null,
        emailHash: null,
        reason: 'SIGN_IN_EXPIRED',
        method,
      });
      return null;
    }
    const userId = pending.userId;
    await setDatabaseContext(transaction, { ...scope, userId });
    const user = await transaction.user.findUniqueOrThrow({
      where: { id: userId },
      select: { emailNormalized: true, globalStatus: true },
    });
    const emailHash = hashEmail(user.emailNormalized, this.config.BLIND_INDEX_KEY);
    if (pending.expiresAt <= now) {
      await transaction.pendingAuthentication.deleteMany({ where: { id: pending.id } });
      await writeSignInFailure(transaction, request, {
        userId,
        emailHash,
        reason: 'SIGN_IN_EXPIRED',
        method,
      });
      return null;
    }
    return {
      id: pending.id,
      userId,
      requestedMembershipId: pending.requestedMembershipId,
      verifiedMethods: pending.verifiedMethods,
      enrollmentSecretEnvelope: pending.enrollmentSecretEnvelope,
      enrollmentAcceptedStep: pending.enrollmentAcceptedStep,
      enrollmentConfirmedAt: pending.enrollmentConfirmedAt,
      recoveryCodeHashes: pending.recoveryCodeHashes,
      user,
      emailHash,
    };
  }

  /** Takes back a counted guess that turned out right, in a transaction of its own. */
  private async refundGuess(
    emailHash: Buffer,
    { before, counted }: Extract<GuessCount, { cooldownUntil: null }>,
  ): Promise<void> {
    await withDatabaseContext({ capabilities: ['platform-security'] }, async (transaction) => {
      const key = prismaBytes(emailHash);
      const state = await this.lockThrottle(transaction, key);
      if (!state) return;
      await transaction.signInThrottle.update({
        where: { emailHash: key },
        data: refundSignInGuess(state, before, counted),
      });
    });
  }

  /** The email's throttle row, locked for the rest of the transaction. */
  private async lockThrottle(
    transaction: Prisma.TransactionClient,
    key: Uint8Array,
  ): Promise<SignInThrottleState | null> {
    const [row] = await transaction.$queryRaw<ThrottleRow[]>`
      SELECT "failure_count", "cooldown_level", "cooldown_until", "last_failure_at"
      FROM "sign_in_throttles" WHERE "email_hash" = ${key} FOR UPDATE`;
    return throttleState(row);
  }

  /** `writeGuessFailure` in a transaction of its own; throws at the second-factor ceiling. */
  private async recordGuessFailure(request: SignInRequest, failure: GuessFailure): Promise<void> {
    const ceiling = await withDatabaseContext(
      failureScope(failure.event ?? LOGIN_FAILURE, failure.userId),
      (transaction) => writeGuessFailure(transaction, request, failure),
    );
    if (ceiling) throw passwordResetRequired(ceiling);
  }

  /**
   * A reset link by its token's hash, with its User, leaving the transaction in the User's
   * context under `scope`. Writes nothing.
   */
  private async openResetLink(
    transaction: Prisma.TransactionClient,
    scope: { passwordResetTokenHash: string; capabilities: readonly ['platform-security'] },
    tokenHash: Buffer,
    now: Date,
  ): Promise<ResetLink> {
    const stored = await transaction.passwordResetToken.findUnique({
      where: { tokenHash: prismaBytes(tokenHash) },
    });
    if (!stored)
      return { status: 'INVALID', reason: 'TOKEN_UNKNOWN', userId: null, emailHash: null };
    await setDatabaseContext(transaction, { ...scope, userId: stored.userId });
    const user = await transaction.user.findUniqueOrThrow({
      where: { id: stored.userId },
      select: {
        id: true,
        emailNormalized: true,
        displayName: true,
        totpFactor: { select: { id: true } },
      },
    });
    const emailHash = hashEmail(user.emailNormalized, this.config.BLIND_INDEX_KEY);
    const ended: ResetLinkFailure | null = stored.consumedAt
      ? 'TOKEN_USED'
      : stored.supersededAt
        ? 'TOKEN_SUPERSEDED'
        : stored.expiresAt <= now
          ? 'TOKEN_EXPIRED'
          : null;
    if (ended) return { status: 'INVALID', reason: ended, userId: user.id, emailHash };
    return {
      status: 'OPEN',
      tokenId: stored.id,
      expiresAt: stored.expiresAt,
      user: { id: user.id, emailNormalized: user.emailNormalized, displayName: user.displayName },
      emailHash,
      secondFactor: user.totpFactor !== null,
    };
  }

  /**
   * A PASSWORD_RESET_FAILURE, and a SIGN_IN_COOLDOWN_STARTED for the cool-down a wrong code
   * started. It never holds the token, password, code, or raw email.
   */
  private async writeResetFailure(
    transaction: Prisma.TransactionClient,
    request: SignInRequest,
    failure: {
      userId: string | null;
      emailHash: Buffer | null;
      reason: ResetFailure;
      cooldown?: SignInCooldownStart | null;
    },
  ): Promise<void> {
    const emailHash = failure.emailHash ? prismaBytes(failure.emailHash) : null;
    await transaction.securityEvent.create({
      data: {
        userId: failure.userId,
        eventType: 'PASSWORD_RESET_FAILURE',
        requestId: request.requestId,
        ipAddress: request.ipAddress,
        userAgent: request.userAgent,
        emailHash,
        details: { reason: failure.reason },
      },
    });
    if (failure.cooldown) {
      await transaction.securityEvent.create({
        data: {
          eventType: 'SIGN_IN_COOLDOWN_STARTED',
          requestId: request.requestId,
          ipAddress: request.ipAddress,
          userAgent: request.userAgent,
          emailHash,
          details: { level: failure.cooldown.level, minutes: failure.cooldown.minutes },
        },
      });
    }
  }

  /** A failed sign-in step, recorded outside the attempt's transaction. */
  private async recordSignInFailure(
    request: SignInRequest,
    emailHash: Buffer,
    userId: string | null,
    reason: string,
    method?: SecondFactorMethod,
    event: FailureEvent = LOGIN_FAILURE,
  ): Promise<void> {
    await withDatabaseContext(failureScope(event, null), (transaction) =>
      writeSignInFailure(transaction, request, { userId, emailHash, reason, method, event }),
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
        userAgent: evidence.userAgent ?? null,
        emailHash: evidence.emailHash ? prismaBytes(evidence.emailHash) : null,
        details: { methods: [...evidence.authenticationMethods] },
      },
    });
    await this.recordAuditEvent(transaction, resolved.context, {
      action: 'LOGIN_SUCCESS',
      entityType: 'UserSession',
      entityId: session.id,
      requestId,
      metadata: {},
    });
    return {
      token,
      sessionId: session.id,
      authenticationMethods: session.authenticationMethods,
      authTime: session.authTime,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      context: resolved.context,
      display: resolved.display,
    };
  }

  /** Whether a User signing in into the requested or default membership needs a second factor. */
  private async signInRequiresMfa(
    transaction: Prisma.TransactionClient,
    userId: string,
    requestedMembershipId: string | null,
  ): Promise<boolean> {
    const membership = await this.selectSignInMembership(
      transaction,
      userId,
      requestedMembershipId,
    );
    return this.userRequiresMfa(transaction, userId, membership.agencyId, membership.id);
  }

  /** `membershipsRequireMfa`, returning the transaction to the given membership's context. */
  private async userRequiresMfa(
    transaction: Prisma.TransactionClient,
    userId: string,
    agencyId: string,
    membershipId: string,
  ): Promise<boolean> {
    try {
      return await this.membershipsRequireMfa(transaction, userId);
    } finally {
      await setDatabaseContext(transaction, { userId, agencyId, membershipId });
    }
  }

  /**
   * Whether any of the User's active Agency Memberships makes them an MFA-Required User. Leaves the
   * transaction in the context of a membership it checked; callers set their context again.
   */
  private async membershipsRequireMfa(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<boolean> {
    const now = new Date();
    const memberships = await transaction.agencyMembership.findMany({
      where: { userId, status: 'ACTIVE' },
      select: { id: true, agencyId: true },
    });
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
      if (permissionsRequireMfa(assignments.flatMap(({ role }) => permissionGrants(role)))) {
        return true;
      }
    }
    return false;
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
}

/** The name and password a first-time invitee chose when the pending activation started. */
function firstTimeUser(pending: { displayName: string | null; passwordHash: string | null }): {
  displayName: string;
  passwordHash: string;
} {
  if (pending.displayName === null || pending.passwordHash === null) {
    throw new Error('A first-time pending activation has no name or password.');
  }
  return { displayName: pending.displayName, passwordHash: pending.passwordHash };
}
