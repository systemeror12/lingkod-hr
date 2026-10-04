import type { Prisma } from '@prisma/client';
import {
  acceptTotpCode,
  activeCooldown,
  addSignInFailure,
  type CountedSignInFailure,
  openTotpSecret,
  type SignInCooldownStart,
  type SignInThrottleState,
} from '@lingkod-hr/auth';
import type { ProtectedValueKey } from '@lingkod-hr/config';
import { type DatabaseContext, withDatabaseContext } from '@lingkod-hr/database';
import type { MailMessage } from '../invitations/mail';
import { prismaBytes } from '../invitations/invitation-utils';
import { AuthServiceError } from './auth-error';
import type { SignInRequest } from './auth.service';

/*
 * Credential Proof: one attempt to prove who a User is, with the same guess protocol whichever
 * flow asks. The helpers exported below the class serve the flows that still run their own copy
 * of the protocol.
 */

/** Consecutive wrong TOTP or Recovery Codes, since the last full sign-in, that disable the password. */
const SECOND_FACTOR_CEILING = 10;

export type SecondFactorMethod = 'totp' | 'recovery_code';

/**
 * A wrong password or code; `secondFactor` marks a wrong code on the User's pending sign-in, and
 * `cooldown` is the Sign-in Cool-down that counting the guess started.
 */
export interface GuessFailure {
  emailHash: Buffer;
  userId: string | null;
  reason: string;
  cooldown: SignInCooldownStart | null;
  secondFactor?: { method: SecondFactorMethod; email: string };
}

/**
 * A guess counted toward the email's Sign-in Cool-down before it is checked, or the end of the
 * running cool-down that refuses it. `before` is the state it was counted on, for a refund.
 */
export type GuessCount =
  | { cooldownUntil: Date }
  | { cooldownUntil: null; before: SignInThrottleState | null; counted: CountedSignInFailure };

/** A `sign_in_throttles` row as raw SQL answers it. */
export interface ThrottleRow {
  failure_count: number;
  cooldown_level: number;
  cooldown_until: Date | null;
  last_failure_at: Date;
}

export function throttleState(row: ThrottleRow | undefined): SignInThrottleState | null {
  return row
    ? {
        failureCount: row.failure_count,
        cooldownLevel: row.cooldown_level,
        cooldownUntil: row.cooldown_until,
        lastFailureAt: row.last_failure_at,
      }
    : null;
}

/** The refusal during the email's Sign-in Cool-down, with the minutes left. */
export function signInCooldown(until: Date, now: Date): AuthServiceError {
  const minutes = Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 60_000));
  return new AuthServiceError(
    `Too many attempts for this email. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
    429,
    'SIGN_IN_COOLDOWN',
    { retryAt: until },
  );
}

/** The refusal once the Second-factor Ceiling disabled the password, with the notice it sent. */
export function passwordResetRequired(notice?: MailMessage): AuthServiceError {
  return new AuthServiceError(
    'Your password was disabled after too many wrong codes. Reset it to sign in.',
    403,
    'PASSWORD_RESET_REQUIRED',
    notice ? { notice } : {},
  );
}

/** Who is proving, as the flow read them in a transaction of its own. */
export interface ProvingUser {
  id: string;
  email: string;
  emailHash: Buffer;
}

/** A TOTP code to prove `user` with, and what the asking flow does with the outcome. */
export interface TotpAttempt<T> {
  /** The flow's database context with the User's id; the proof's transaction runs in it. */
  scope: DatabaseContext;
  user: ProvingUser;
  code: string;
  request: SignInRequest;
  /** The flow's refusal for a wrong or replayed code, thrown once the failure is recorded. */
  wrongCode: () => AuthServiceError;
  /** The flow's refusal when the User's factor is gone; it may record the refusal first. */
  noFactor: (transaction: Prisma.TransactionClient) => Promise<AuthServiceError>;
  /**
   * Password Reset's protocol: the flow counted the guess, and checked the cool-down, when the
   * link opened, and it records a wrong code itself, away from the Second-factor Ceiling, because
   * a reset is how a User gets past the ceiling.
   */
  passwordReset?: { recordWrongCode: (transaction: Prisma.TransactionClient) => Promise<void> };
  /** The flow's work, run in the transaction that accepts the code. */
  onProved: (transaction: Prisma.TransactionClient) => Promise<T>;
}

/** Proves who a User is for every flow that asks, built once per `AuthService`. */
export class CredentialProof {
  constructor(private readonly dataEncryptionKey: ProtectedValueKey) {}

  /**
   * Proves a User with a TOTP code. One attempt per User runs at a time, under a lock on their
   * password row, so each wrong code is counted before the next is checked and a burst can't pass
   * the Sign-in Cool-down or the Second-factor Ceiling. A code is accepted once: its time step is
   * saved with a conditional update, so of two submissions of one code exactly one wins, and
   * `onProved` runs in that transaction, committing the flow's work with the step.
   *
   * A refusal is recorded and committed, then thrown: the cool-down's `SIGN_IN_COOLDOWN`, the
   * ceiling's `PASSWORD_RESET_REQUIRED` with its notice, or the flow's own. An error thrown by
   * `onProved` rolls everything back, the accepted step too.
   */
  async proveTotp<T>({
    scope,
    user,
    code,
    request,
    wrongCode,
    noFactor,
    passwordReset,
    onProved,
  }: TotpAttempt<T>): Promise<T> {
    const outcome = await withDatabaseContext(scope, async (transaction) => {
      const now = new Date();
      await transaction.$queryRaw`
        SELECT 1 FROM "user_passwords" WHERE "user_id" = ${user.id}::uuid FOR UPDATE`;
      if (!passwordReset) {
        const cooldownUntil = await readCooldown(transaction, user.emailHash, now);
        if (cooldownUntil) {
          await writeSignInFailure(transaction, request, {
            userId: user.id,
            emailHash: user.emailHash,
            reason: 'COOLDOWN_ACTIVE',
            method: 'totp',
          });
          return { refusal: signInCooldown(cooldownUntil, now) };
        }
      }
      const factor = await transaction.userTotpFactor.findUnique({ where: { userId: user.id } });
      if (!factor) return { refusal: await noFactor(transaction) };

      const secret = openTotpSecret(Buffer.from(factor.secretEnvelope), this.dataEncryptionKey, {
        userId: user.id,
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
      if (accepted) return { proved: await onProved(transaction) };

      if (passwordReset) {
        await passwordReset.recordWrongCode(transaction);
        return { refusal: wrongCode() };
      }
      const guess = await countGuess(transaction, user.emailHash, now);
      const ceiling = await writeGuessFailure(transaction, request, {
        emailHash: user.emailHash,
        userId: user.id,
        reason: 'INVALID_CODE',
        cooldown: guess.cooldownUntil ? null : guess.counted.cooldown,
        secondFactor: { method: 'totp', email: user.email },
      });
      return { refusal: ceiling ? passwordResetRequired(ceiling) : wrongCode() };
    });
    if ('refusal' in outcome) throw outcome.refusal;
    return outcome.proved;
  }
}

/** When the email's running Sign-in Cool-down ends, or null. */
export async function readCooldown(
  transaction: Prisma.TransactionClient,
  emailHash: Buffer,
  now: Date,
): Promise<Date | null> {
  const state = await transaction.signInThrottle.findUnique({
    where: { emailHash: prismaBytes(emailHash) },
  });
  return activeCooldown(state, now);
}

/**
 * Counts a guess toward the email's Sign-in Cool-down under the throttle row's lock, so
 * concurrent guesses each count once, or answers the running cool-down that refuses it.
 */
export async function countGuess(
  transaction: Prisma.TransactionClient,
  emailHash: Buffer,
  now: Date,
): Promise<GuessCount> {
  const key = prismaBytes(emailHash);
  // One statement creates or locks the row, so a full sign-in deleting it can't slip between.
  const [row] = await transaction.$queryRaw<ThrottleRow[]>`
    INSERT INTO "sign_in_throttles" ("email_hash", "last_failure_at")
    VALUES (${key}, ${now})
    ON CONFLICT ("email_hash") DO UPDATE SET "email_hash" = EXCLUDED."email_hash"
    RETURNING "failure_count", "cooldown_level", "cooldown_until", "last_failure_at"`;
  const before = throttleState(row);
  const cooldownUntil = activeCooldown(before, now);
  if (cooldownUntil) return { cooldownUntil };
  const counted = addSignInFailure(before, now);
  await transaction.signInThrottle.update({ where: { emailHash: key }, data: counted.state });
  return { cooldownUntil: null, before, counted };
}

/**
 * A wrong password, TOTP code, or Recovery Code, already counted by `countGuess`: a LOGIN_FAILURE,
 * and a SIGN_IN_COOLDOWN_STARTED for the cool-down counting it started.
 * A wrong code also counts toward the second-factor ceiling; the failure that reaches it disables
 * the password, ends the User's pending sign-ins and activations, and answers the notice to send.
 * The transaction needs the platform-security capability, and the User's context for a wrong code.
 */
export async function writeGuessFailure(
  transaction: Prisma.TransactionClient,
  request: SignInRequest,
  { emailHash, userId, reason, cooldown, secondFactor }: GuessFailure,
): Promise<MailMessage | null> {
  const now = new Date();
  await writeSignInFailure(transaction, request, {
    userId,
    emailHash,
    reason,
    method: secondFactor?.method,
  });
  if (cooldown) {
    await transaction.securityEvent.create({
      data: {
        eventType: 'SIGN_IN_COOLDOWN_STARTED',
        requestId: request.requestId,
        ipAddress: request.ipAddress,
        userAgent: request.userAgent,
        emailHash: prismaBytes(emailHash),
        details: { level: cooldown.level, minutes: cooldown.minutes },
      },
    });
  }

  if (!secondFactor || !userId) return null;
  const { secondFactorFailures } = await transaction.userPassword.update({
    where: { userId },
    data: { secondFactorFailures: { increment: 1 } },
    select: { secondFactorFailures: true },
  });
  const disabled = await transaction.userPassword.updateMany({
    where: {
      userId,
      resetRequiredAt: null,
      secondFactorFailures: { gte: SECOND_FACTOR_CEILING },
    },
    data: { resetRequiredAt: now },
  });
  if (disabled.count !== 1) return null;
  await transaction.pendingAuthentication.deleteMany({ where: { userId } });
  await transaction.securityEvent.create({
    data: {
      userId,
      eventType: 'PASSWORD_RESET_REQUIRED',
      requestId: request.requestId,
      ipAddress: request.ipAddress,
      userAgent: request.userAgent,
      emailHash: prismaBytes(emailHash),
      details: { secondFactorFailures },
    },
  });
  return passwordResetRequiredNotice(secondFactor.email);
}

/** A sign-in LOGIN_FAILURE event; it never holds the password, code, token, or raw email. */
export async function writeSignInFailure(
  transaction: Prisma.TransactionClient,
  request: SignInRequest,
  failure: {
    userId: string | null;
    emailHash: Buffer | null;
    reason: string;
    method?: SecondFactorMethod | undefined;
  },
): Promise<void> {
  await transaction.securityEvent.create({
    data: {
      userId: failure.userId,
      eventType: 'LOGIN_FAILURE',
      requestId: request.requestId,
      ipAddress: request.ipAddress,
      userAgent: request.userAgent,
      emailHash: failure.emailHash ? prismaBytes(failure.emailHash) : null,
      details: {
        reason: failure.reason,
        ...(failure.method ? { method: failure.method } : {}),
      },
    },
  });
}

function passwordResetRequiredNotice(email: string): MailMessage {
  return {
    to: email,
    subject: 'Reset your LingkodHR password to sign in',
    text: [
      'Someone entered your LingkodHR password correctly, then entered too many wrong codes after it. To protect your account, your password no longer works.',
      'To sign in again, reset your password from the LingkodHR sign-in page.',
      "If you didn't try to sign in, someone may know your password. Contact your Agency Administrator right away.",
    ].join('\n\n'),
  };
}
