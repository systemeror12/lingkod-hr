'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { cn } from '../lib/class-names';
import { manilaTime, RecoveryCodeSlip, SetupKey } from './authenticator-setup';
import {
  BusyBar,
  CivicSunriseLayout,
  InvitationStamp,
  StepFooter,
  type LetterheadAgency,
} from './civic-sunrise';
import { Button } from './ui/button';
import { Field, FormError, inputClass } from './ui/field';

/** The invitation as the activation page shows it; looked up without side effects. */
export interface ActivationInvitation {
  token: string;
  email: string;
  agency: LetterheadAgency;
  roleNames: string[];
  existingUser: boolean;
  expiresAt: string;
}

type Step = 'start' | 'totp' | 'recovery' | 'enroll-scan' | 'enroll-codes' | 'done';

/** Ends the flow in place of the form. */
interface Outcome {
  tone: 'danger' | 'warning';
  kicker: string;
  title: string;
  body: string;
  restart?: boolean;
  signIn?: boolean;
}

interface Enrollment {
  otpauthUri: string;
  account: string;
  expiresAt: string;
}

type ActivationResponse = {
  status?: string;
  enrollment?: Enrollment;
  recoveryCodes?: string[];
};

const FALLBACK_MESSAGE = 'Activation could not be completed. Try again.';
const linkClass =
  'cursor-pointer justify-self-start text-small text-primary underline underline-offset-4 disabled:opacity-50';

class ActivationFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function post(path: string, body: unknown): Promise<ActivationResponse> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const value: unknown = await response.json().catch(() => null);
  if (response.ok) return (value ?? {}) as ActivationResponse;
  const error = (value as { error?: { code?: string; message?: string; retryAt?: string } } | null)
    ?.error;
  if (error?.code === 'SIGN_IN_COOLDOWN' && error.retryAt) {
    throw new ActivationFailure(
      error.code,
      `Too many attempts for this email. You can try again after ${manilaTime(error.retryAt, { hour: 'numeric', minute: '2-digit' })}.`,
    );
  }
  throw new ActivationFailure(
    error?.code ?? 'ACTIVATION_FAILED',
    error?.message ?? FALLBACK_MESSAGE,
  );
}

function failureFrom(value: unknown): ActivationFailure {
  return value instanceof ActivationFailure
    ? value
    : new ActivationFailure('ACTIVATION_FAILED', FALLBACK_MESSAGE);
}

function eventValue(event: { currentTarget: EventTarget }): string {
  return (event.currentTarget as unknown as { value: string }).value;
}

function eventChecked(event: { currentTarget: EventTarget }): boolean {
  return (event.currentTarget as unknown as { checked: boolean }).checked;
}

/** The refusals that end the flow, by error code. Others show beside the form. */
function outcomeFor(code: string): Outcome | null {
  switch (code) {
    case 'ACTIVATION_EXPIRED':
      return {
        tone: 'warning',
        kicker: 'Nothing was saved',
        title: 'Your setup timed out',
        body: 'Setup has to finish within 15 minutes. Your invitation link still works, so you can start again.',
        restart: true,
      };
    case 'INVITATION_EXPIRED':
      return invitationOutcome('EXPIRED');
    case 'INVITATION_INVALID':
      return invitationOutcome('INVALID');
    case 'INVITATION_ROLE_UNAVAILABLE':
      return {
        tone: 'danger',
        kicker: 'Nothing was saved',
        title: 'A role in this invitation is no longer available',
        body: 'Ask your Agency Administrator to send a new invitation. No access was granted.',
      };
    case 'USER_LOCKED':
      return {
        tone: 'danger',
        kicker: 'Account locked',
        title: 'Your account is locked',
        body: 'A Security Administrator locked your account. Contact your Agency Administrator. This invitation stays open until it expires.',
      };
    case 'USER_NOT_ACTIVE':
      return {
        tone: 'danger',
        kicker: 'Account unavailable',
        title: 'Your account can’t accept this invitation',
        body: 'Contact your Agency Administrator. This invitation stays open until it expires.',
      };
    case 'MEMBERSHIP_EXISTS':
      return {
        tone: 'warning',
        kicker: 'Already a member',
        title: 'You already have access to this Agency',
        body: 'Your account already has an Agency Membership here, so this invitation wasn’t used. Sign in to continue.',
        signIn: true,
      };
    case 'PASSWORD_RESET_REQUIRED':
      return {
        tone: 'danger',
        kicker: 'Password reset required',
        title: 'Reset your password to continue',
        body: 'Your password won’t work until you reset it. We emailed you about this. This invitation stays open until it expires.',
      };
    default:
      return null;
  }
}

/** Why an invitation link can't be used, for the page and for a refusal mid-flow. */
export function invitationOutcome(status: 'EXPIRED' | 'INVALID'): Outcome {
  return status === 'EXPIRED'
    ? {
        tone: 'warning',
        kicker: 'Invitation expired',
        title: 'This invitation has expired',
        body: 'Invitations last 7 days. Ask your Agency Administrator to send a new one. No access was granted.',
      }
    : {
        tone: 'danger',
        kicker: 'Invitation invalid',
        title: 'This invitation can’t be used',
        body: 'It was already accepted, cancelled, or replaced by a newer invitation. If you didn’t accept it, contact your Agency Administrator.',
        signIn: true,
      };
}

function Title({ children }: { children: ReactNode }) {
  return (
    <h1
      id="activation-title"
      className="m-0 text-[1.625rem] leading-tight font-[650] tracking-[-0.015em] text-ink"
    >
      {children}
    </h1>
  );
}

function Lead({ children }: { children: ReactNode }) {
  return <p className="m-0 max-w-[60ch] text-body text-ink-muted">{children}</p>;
}

/** An ended flow: the scene overcasts and the form gives way to what happened and what to do. */
export function ActivationOutcome({
  outcome,
  agency,
  onRestart,
}: {
  outcome: Outcome;
  agency: LetterheadAgency | null;
  onRestart?: () => void;
}) {
  return (
    <CivicSunriseLayout progress={0} gloom agency={agency} labelledBy="activation-title">
      <div className="lh-step-in grid gap-5">
        <div className="grid gap-2">
          <p
            className={cn(
              'm-0 text-caption font-[650] tracking-[0.08em] uppercase',
              outcome.tone === 'danger' ? 'text-danger' : 'text-ink-muted',
            )}
          >
            {outcome.kicker}
          </p>
          <Title>{outcome.title}</Title>
          <Lead>{outcome.body}</Lead>
        </div>
        {outcome.restart && onRestart ? (
          <Button
            variant="primary"
            className="min-h-11 justify-self-start px-6"
            type="button"
            onClick={onRestart}
          >
            Start again
          </Button>
        ) : outcome.signIn ? (
          <a className={linkClass} href="/sign-in">
            Sign in
          </a>
        ) : null}
      </div>
    </CivicSunriseLayout>
  );
}

/**
 * Invitation Activation. A first-time User sets their name and a password; an existing User
 * confirms their password, then their authenticator code or a Recovery Code. An MFA-Required
 * invitee without an authenticator sets one up and saves Recovery Codes. Nothing is saved until
 * the last step, which opens a session in the inviting Agency.
 */
export function InvitationActivationForm({ invitation }: { invitation: ActivationInvitation }) {
  const router = useRouter();
  const { agency, existingUser } = invitation;
  const base = `/api/v1/auth/invitations/${invitation.token}/activation`;
  const welcome = agency.acronym ?? agency.name;
  const [step, setStep] = useState<Step>('start');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [enrolled, setEnrolled] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Counts refusals, so the form's nudge replays on each one.
  const [attempt, setAttempt] = useState(0);
  const errorRef = useRef<{ focus(): void } | null>(null);
  const codeRef = useRef<{ focus(): void } | null>(null);

  useEffect(() => {
    if (step === 'totp' || step === 'recovery' || step === 'enroll-scan') codeRef.current?.focus();
  }, [step]);
  useEffect(() => {
    if (attempt > 0)
      (step === 'start' || step === 'enroll-codes' ? errorRef : codeRef).current?.focus();
  }, [attempt]);

  function goTo(next: Step) {
    setStep(next);
    setCode('');
    setError('');
  }

  function restart() {
    setOutcome(null);
    setEnrollment(null);
    setRecoveryCodes([]);
    setSaved(false);
    setPassword('');
    goTo('start');
  }

  function refuse(failure: ActivationFailure) {
    setBusy(false);
    const ended = outcomeFor(failure.code);
    if (ended) {
      setOutcome(ended);
      return;
    }
    setError(failure.message);
    setAttempt((count) => count + 1);
  }

  /** Runs one step against the activation routes; `then` handles its answer. */
  async function submit(
    event: FormEvent<HTMLFormElement>,
    path: string,
    body: unknown,
    then: (result: ActivationResponse) => void,
    wrongCode?: string,
  ) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await post(`${base}${path}`, body);
      setBusy(false);
      then(result);
    } catch (value: unknown) {
      const failure = failureFrom(value);
      if (step !== 'start' && step !== 'enroll-codes') setCode('');
      refuse(
        failure.code === 'INVALID_CODE' && wrongCode
          ? new ActivationFailure(failure.code, wrongCode)
          : failure,
      );
    }
  }

  function started(result: ActivationResponse) {
    setPassword('');
    if (result.status === 'CODE_REQUIRED') goTo('totp');
    else if (result.status === 'ENROLLMENT_REQUIRED' && result.enrollment) {
      setEnrollment(result.enrollment);
      goTo('enroll-scan');
    } else goTo('done');
  }

  if (outcome) return <ActivationOutcome outcome={outcome} agency={agency} onRestart={restart} />;

  const roles = invitation.roleNames.join(', ');
  const steps = existingUser
    ? enrollment
      ? ['Confirm your password', 'Set up authenticator', 'Save Recovery Codes']
      : ['Confirm your password', 'Verify it’s you']
    : enrollment
      ? ['Set your password', 'Set up authenticator', 'Save Recovery Codes']
      : ['Set your password'];
  const index = {
    start: 0,
    totp: 1,
    recovery: 1,
    'enroll-scan': 1,
    'enroll-codes': 2,
    done: steps.length,
  }[step];
  const account = (
    <p className="m-0 text-small text-ink-muted">
      Account: <span className="text-ink">{invitation.email}</span>
    </p>
  );
  const codeField = (
    <Field label="Authentication code" error={error || undefined}>
      <input
        className={cn(inputClass, 'font-mono tracking-[0.3em]')}
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={7}
        required
        ref={codeRef}
        value={code}
        onChange={(event) => setCode(eventValue(event))}
      />
    </Field>
  );

  return (
    <CivicSunriseLayout
      progress={index / steps.length}
      agency={agency}
      labelledBy="activation-title"
    >
      {/* Keep the fetched stamp mounted: its signed URL may expire during the MFA steps. */}
      <div hidden={step !== 'done'} className="mb-5">
        <InvitationStamp agency={agency} />
      </div>
      <div key={step} className="lh-step-in grid gap-5">
        {step === 'start' ? (
          <>
            <div className="grid gap-2">
              <p className="m-0 text-caption font-[650] tracking-[0.08em] text-ink-muted uppercase">
                Invitation from {welcome}
              </p>
              <Title>
                {existingUser
                  ? `Join ${welcome} with your account`
                  : 'Activate your LingkodHR access'}
              </Title>
              <Lead>
                {agency.name} invited you as {roles}.{' '}
                {existingUser
                  ? 'You already have a LingkodHR account, so enter your current password. It won’t change.'
                  : 'Set your name and a password. Nothing is saved until you finish.'}
              </Lead>
            </div>
            <form
              key={attempt}
              className={cn('grid gap-4', error && 'lh-nudge')}
              onSubmit={(event) =>
                void submit(event, '', existingUser ? { password } : { name, password }, started)
              }
              noValidate
            >
              <FormError ref={errorRef} tabIndex={-1} message={error} />
              <Field label="Email">
                <input
                  className={inputClass}
                  type="email"
                  name="email"
                  autoComplete="username"
                  readOnly
                  value={invitation.email}
                />
              </Field>
              {existingUser ? null : (
                <Field label="Full name">
                  <input
                    className={inputClass}
                    name="name"
                    autoComplete="name"
                    required
                    maxLength={200}
                    value={name}
                    onChange={(event) => setName(eventValue(event))}
                  />
                </Field>
              )}
              <div className="grid gap-1.5">
                <Field label={existingUser ? 'Password' : 'New password'}>
                  <input
                    className={inputClass}
                    type="password"
                    name="password"
                    autoComplete={existingUser ? 'current-password' : 'new-password'}
                    aria-describedby={existingUser ? undefined : 'password-rules'}
                    required
                    value={password}
                    onChange={(event) => setPassword(eventValue(event))}
                  />
                </Field>
                {existingUser ? null : (
                  <p id="password-rules" className="m-0 text-caption text-ink-muted">
                    Use 15 to 128 characters. A few unrelated words work well. Don’t use your name,
                    your email, or LingkodHR.
                  </p>
                )}
              </div>
              <div className="relative grid justify-items-start">
                <BusyBar busy={busy} />
                <Button variant="primary" className="min-h-11 px-6" type="submit" disabled={busy}>
                  {busy ? 'Checking…' : 'Continue'}
                </Button>
              </div>
            </form>
          </>
        ) : step === 'enroll-scan' && enrollment ? (
          <>
            <div className="grid gap-2">
              <Title>Set up your authenticator</Title>
              <Lead>
                Your role needs a second step at sign-in. Scan this QR code with an authenticator
                app, then enter the code it shows.
              </Lead>
              {account}
            </div>
            <form
              key={attempt}
              className={cn('grid gap-5', error && 'lh-nudge')}
              onSubmit={(event) =>
                void submit(
                  event,
                  '/enrollment/confirm',
                  { code },
                  (result) => {
                    setRecoveryCodes(result.recoveryCodes ?? []);
                    goTo('enroll-codes');
                  },
                  'That code didn’t match. Check the app’s clock and try the current code.',
                )
              }
              noValidate
            >
              <SetupKey otpauthUri={enrollment.otpauthUri} />
              {codeField}
              <div className="relative grid justify-items-start">
                <BusyBar busy={busy} />
                <Button variant="primary" className="min-h-11 px-6" type="submit" disabled={busy}>
                  {busy ? 'Confirming…' : 'Confirm code'}
                </Button>
              </div>
            </form>
          </>
        ) : step === 'enroll-codes' && enrollment ? (
          <>
            <div className="grid gap-2">
              <Title>Save your Recovery Codes</Title>
              <Lead>
                If you lose your authenticator, each code lets you sign in once. You won’t see these
                codes again.
              </Lead>
            </div>
            <form
              key={attempt}
              className={cn('grid gap-5', error && 'lh-nudge')}
              onSubmit={(event) =>
                void submit(event, '/enrollment/finish', { acknowledged: true }, () => {
                  setRecoveryCodes([]);
                  setEnrolled(true);
                  goTo('done');
                })
              }
              noValidate
            >
              <FormError ref={errorRef} tabIndex={-1} message={error} />
              <RecoveryCodeSlip account={enrollment.account} codes={recoveryCodes} />
              <label className="flex items-start gap-2.5 text-small text-ink">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 accent-primary"
                  checked={saved}
                  onChange={(event) => setSaved(eventChecked(event))}
                />
                <span>I’ve saved these Recovery Codes somewhere safe.</span>
              </label>
              <div className="relative grid justify-items-start">
                <BusyBar busy={busy} />
                <Button
                  variant="primary"
                  className="min-h-11 px-6"
                  type="submit"
                  disabled={!saved || busy}
                >
                  {busy ? 'Activating…' : 'Finish activation'}
                </Button>
              </div>
            </form>
          </>
        ) : step === 'done' ? (
          <>
            <div className="grid gap-2">
              <p className="m-0 text-caption font-[650] tracking-[0.08em] text-ink-muted uppercase">
                Access activated
              </p>
              <Title>You now have access to {welcome}</Title>
              <Lead>
                You’re signed in to {agency.name} as {roles}.
                {enrolled
                  ? ' From now on, sign-in asks for a code from your authenticator app. We emailed you a notice.'
                  : ''}
              </Lead>
            </div>
            <Button
              variant="primary"
              className="min-h-11 justify-self-start px-6"
              type="button"
              onClick={() => router.replace('/dashboard')}
            >
              Open workspace
            </Button>
          </>
        ) : (
          <>
            <div className="grid gap-2">
              <Title>
                {step === 'totp' ? 'Enter your authenticator code' : 'Enter a Recovery Code'}
              </Title>
              <Lead>
                {step === 'totp'
                  ? 'Enter the 6-digit code from your authenticator app to accept the invitation.'
                  : 'Use one of the codes you saved when you set up your authenticator. Each code works once, and using one signs you out of your other sessions.'}
              </Lead>
              {account}
            </div>
            <form
              key={attempt}
              className={cn('grid gap-5', error && 'lh-nudge')}
              onSubmit={(event) =>
                void submit(
                  event,
                  step === 'totp' ? '/code' : '/recovery-code',
                  { code },
                  () => goTo('done'),
                  step === 'recovery' ? 'That Recovery Code didn’t work.' : undefined,
                )
              }
              noValidate
            >
              <div className="grid gap-1.5">
                {step === 'totp' ? (
                  codeField
                ) : (
                  <Field label="Recovery Code" error={error || undefined}>
                    <input
                      className={cn(inputClass, 'font-mono tracking-[0.12em]')}
                      name="recovery-code"
                      autoComplete="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      maxLength={64}
                      placeholder="xxxxx-xxxxx"
                      required
                      ref={codeRef}
                      value={code}
                      onChange={(event) => setCode(eventValue(event))}
                    />
                  </Field>
                )}
                <button
                  type="button"
                  className={cn(linkClass, 'text-caption')}
                  disabled={busy}
                  onClick={() => goTo(step === 'totp' ? 'recovery' : 'totp')}
                >
                  {step === 'totp' ? 'No phone? Use a Recovery Code' : 'Use your authenticator app'}
                </button>
              </div>
              <div className="relative grid justify-items-start">
                <BusyBar busy={busy} />
                <Button variant="primary" className="min-h-11 px-6" type="submit" disabled={busy}>
                  {busy ? 'Activating…' : 'Accept invitation'}
                </Button>
              </div>
            </form>
          </>
        )}
      </div>
      {step === 'done' ? null : (
        <StepFooter
          step={index + 1}
          of={steps.length}
          label={steps[index] ?? ''}
          note={
            enrollment && step !== 'start'
              ? `Setup expires at ${manilaTime(enrollment.expiresAt, { hour: 'numeric', minute: '2-digit' })}`
              : `Invitation expires ${manilaTime(invitation.expiresAt, { dateStyle: 'medium' })}`
          }
        />
      )}
    </CivicSunriseLayout>
  );
}
