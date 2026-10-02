'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { cn } from '../lib/class-names';
import { manilaTime, RecoveryCodeSlip, SetupKey } from './authenticator-setup';
import { BusyBar, CivicSunriseLayout, StepFooter } from './civic-sunrise';
import { Button } from './ui/button';
import { Field, FormError, inputClass } from './ui/field';

type Step =
  | 'password'
  | 'totp'
  | 'recovery'
  | 'recovery-used'
  | 'enroll-scan'
  | 'enroll-codes'
  | 'enrolled'
  | 'reset-required';

interface Enrollment {
  otpauthUri: string;
  account: string;
  expiresAt: string;
}

const WRONG_ENROLLMENT_CODE =
  'That code didn’t match. Check the app’s clock and try the current code.';

const FALLBACK_MESSAGE = 'Sign-in could not be completed. Try again.';
const linkClass =
  'cursor-pointer justify-self-start text-small text-primary underline underline-offset-4 disabled:opacity-50';

class SignInFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type SignInResponse = {
  status?: string;
  recoveryCodesRemaining?: number;
  enrollment?: Enrollment;
  recoveryCodes?: string[];
};

async function post(path: string, body: unknown): Promise<SignInResponse> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const value: unknown = await response.json().catch(() => null);
  if (response.ok) return (value ?? {}) as SignInResponse;
  const error = (value as { error?: { code?: string; message?: string; retryAt?: string } } | null)
    ?.error;
  if (error?.code === 'SIGN_IN_COOLDOWN' && error.retryAt) {
    throw new SignInFailure(
      error.code,
      `Too many attempts for this email. You can try again after ${manilaTime(error.retryAt, { hour: 'numeric', minute: '2-digit' })}.`,
    );
  }
  throw new SignInFailure(
    error?.code ?? 'SIGN_IN_FAILED',
    error?.message ??
      (response.status === 400 ? 'Enter your email and password.' : FALLBACK_MESSAGE),
  );
}

function eventValue(event: { currentTarget: EventTarget }): string {
  return (event.currentTarget as unknown as { value: string }).value;
}

function eventChecked(event: { currentTarget: EventTarget }): boolean {
  return (event.currentTarget as unknown as { checked: boolean }).checked;
}

function failureFrom(value: unknown): SignInFailure {
  return value instanceof SignInFailure
    ? value
    : new SignInFailure('SIGN_IN_FAILED', FALLBACK_MESSAGE);
}

function Title({ children }: { children: ReactNode }) {
  return (
    <h1
      id="sign-in-title"
      className="m-0 text-[1.625rem] leading-tight font-[650] tracking-[-0.015em] text-ink"
    >
      {children}
    </h1>
  );
}

function Lead({ children }: { children: ReactNode }) {
  return <p className="m-0 max-w-[60ch] text-body text-ink-muted">{children}</p>;
}

/**
 * Email and password, then the authenticator code or a Recovery Code when the User has a TOTP
 * factor. An MFA-Required User without one sets up an authenticator and saves Recovery Codes
 * first. Calls the relative sign-in routes and opens the workspace once a session exists; after
 * a Recovery Code or a new authenticator it first says what changed.
 */
export function SignInForm({ membershipId }: { membershipId: string | null }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codesLeft, setCodesLeft] = useState(0);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
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
    // After a refusal the form remounts; focus the message, or the code field it sits under.
    if (attempt > 0) {
      (step === 'password' || step === 'enroll-codes' ? errorRef : codeRef).current?.focus();
    }
  }, [attempt]);

  function fail(failure: SignInFailure) {
    setError(failure.message);
    setAttempt((count) => count + 1);
  }

  function goTo(next: Step) {
    setStep(next);
    setCode('');
    setError('');
    if (next === 'password') {
      setEnrollment(null);
      setRecoveryCodes([]);
      setSaved(false);
    }
  }

  /**
   * A refused step; an expired sign-in starts over at email and password, and a disabled password
   * ends the flow.
   */
  function refuse(failure: SignInFailure) {
    setBusy(false);
    if (failure.code === 'PASSWORD_RESET_REQUIRED') {
      setPassword('');
      goTo('reset-required');
      return;
    }
    if (failure.code === 'SIGN_IN_EXPIRED') goTo('password');
    fail(failure);
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await post('/api/v1/auth/sign-in', {
        email,
        password,
        ...(membershipId ? { membershipId } : {}),
      });
      if (result.status === 'TOTP_REQUIRED' || result.status === 'ENROLLMENT_REQUIRED') {
        setPassword('');
        setEnrollment(result.enrollment ?? null);
        goTo(result.status === 'TOTP_REQUIRED' ? 'totp' : 'enroll-scan');
        setBusy(false);
        return;
      }
      router.replace('/dashboard');
    } catch (failure: unknown) {
      refuse(failureFrom(failure));
    }
  }

  async function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (step === 'recovery') {
        const result = await post('/api/v1/auth/sign-in/recovery-code', { code });
        setCodesLeft(result.recoveryCodesRemaining ?? 0);
        goTo('recovery-used');
        setBusy(false);
        return;
      }
      await post('/api/v1/auth/sign-in/totp', { code });
      router.replace('/dashboard');
    } catch (failure: unknown) {
      const signInFailure = failureFrom(failure);
      setCode('');
      refuse(
        signInFailure.code === 'INVALID_CODE' && step === 'recovery'
          ? new SignInFailure('INVALID_CODE', 'That Recovery Code didn’t work.')
          : signInFailure,
      );
    }
  }

  async function confirmEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await post('/api/v1/auth/sign-in/enrollment/confirm', { code });
      setRecoveryCodes(result.recoveryCodes ?? []);
      goTo('enroll-codes');
      setBusy(false);
    } catch (failure: unknown) {
      const signInFailure = failureFrom(failure);
      setCode('');
      refuse(
        signInFailure.code === 'INVALID_CODE'
          ? new SignInFailure('INVALID_CODE', WRONG_ENROLLMENT_CODE)
          : signInFailure,
      );
    }
  }

  async function finishEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await post('/api/v1/auth/sign-in/enrollment/finish', { acknowledged: true });
      setRecoveryCodes([]);
      goTo('enrolled');
      setBusy(false);
    } catch (failure: unknown) {
      refuse(failureFrom(failure));
    }
  }

  const progress = {
    password: 0,
    totp: 0.5,
    recovery: 0.5,
    'recovery-used': 1,
    'enroll-scan': 1 / 3,
    'enroll-codes': 2 / 3,
    enrolled: 1,
    'reset-required': 0.5,
  }[step];
  const account = (
    <p className="m-0 text-small text-ink-muted">
      Account: <span className="text-ink">{email}</span>
    </p>
  );

  return (
    <CivicSunriseLayout
      progress={progress}
      gloom={step === 'reset-required'}
      labelledBy="sign-in-title"
    >
      <div key={step} className="lh-step-in grid gap-5">
        {step === 'password' ? (
          <>
            <Title>Sign in to your Agency workspace</Title>
            <form
              key={attempt}
              className={cn('grid gap-4', error && 'lh-nudge')}
              onSubmit={submitPassword}
              noValidate
            >
              <FormError ref={errorRef} tabIndex={-1} message={error} />
              <Field label="Email">
                <input
                  className={inputClass}
                  type="email"
                  name="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(event) => setEmail(eventValue(event))}
                />
              </Field>
              <Field label="Password">
                <input
                  className={inputClass}
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(eventValue(event))}
                />
              </Field>
              <div className="relative grid">
                <BusyBar busy={busy} />
                <Button variant="primary" className="min-h-11" type="submit" disabled={busy}>
                  {busy ? 'Signing in…' : 'Sign in'}
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
              onSubmit={confirmEnrollment}
              noValidate
            >
              <SetupKey otpauthUri={enrollment.otpauthUri} />
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
              <div className="relative flex flex-wrap items-center gap-x-5 gap-y-2">
                <BusyBar busy={busy} />
                <Button variant="primary" className="min-h-11 px-6" type="submit" disabled={busy}>
                  {busy ? 'Confirming…' : 'Confirm code'}
                </Button>
                <button
                  type="button"
                  className={linkClass}
                  disabled={busy}
                  onClick={() => goTo('password')}
                >
                  Use a different account
                </button>
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
              onSubmit={finishEnrollment}
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
                  {busy ? 'Saving…' : 'Continue'}
                </Button>
              </div>
            </form>
          </>
        ) : step === 'enrolled' ? (
          <>
            <div className="grid gap-2">
              <Title>You’re set up</Title>
              <Lead>
                From now on, sign-in asks for a code from this app. We’ll email you a notice.
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
        ) : step === 'reset-required' ? (
          <>
            <div className="grid gap-2">
              <p className="m-0 text-caption font-[650] tracking-[0.08em] text-danger uppercase">
                Password reset required
              </p>
              <Title>Reset your password to sign in</Title>
              <Lead>
                Your password was accepted, but the code after it was wrong too many times. Your
                password won’t work until you reset it. We emailed you about this.
              </Lead>
              {account}
            </div>
            <button type="button" className={linkClass} onClick={() => goTo('password')}>
              Use a different account
            </button>
          </>
        ) : step === 'recovery-used' ? (
          <>
            <div className="grid gap-2">
              <Title>You signed in with a Recovery Code</Title>
              <Lead>
                {codesLeft > 0
                  ? 'We signed you out of your other sessions and emailed you a notice. If you lost your authenticator, replace it and generate new Recovery Codes.'
                  : 'We signed you out of your other sessions and emailed you a notice. That was your last code: replace your authenticator and generate new Recovery Codes, because without them only a Security Administrator can reset it.'}
              </Lead>
              {account}
            </div>
            <p className="m-0 text-body">
              You have{' '}
              <strong className={cn('font-[700]', codesLeft === 0 && 'text-danger')}>
                {codesLeft === 0 ? 'no' : codesLeft} Recovery Code{codesLeft === 1 ? '' : 's'}
              </strong>{' '}
              left.
            </p>
            <Button
              variant="primary"
              className="min-h-11 justify-self-start px-6"
              type="button"
              onClick={() => router.replace('/dashboard')}
            >
              Continue to workspace
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
                  ? 'Open your authenticator app and enter the 6-digit code for LingkodHR.'
                  : 'Use one of the codes you saved when you set up your authenticator. Each code works once.'}
              </Lead>
              {account}
            </div>
            <form
              key={attempt}
              className={cn('grid gap-5', error && 'lh-nudge')}
              onSubmit={submitCode}
              noValidate
            >
              <div className="grid gap-1.5">
                {step === 'totp' ? (
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
              {step === 'recovery' ? (
                <p className="m-0 text-caption text-ink-muted">
                  Lost your codes too? Contact your Security Administrator.
                </p>
              ) : null}
              <div className="relative flex flex-wrap items-center gap-x-5 gap-y-2">
                <BusyBar busy={busy} />
                <Button variant="primary" className="min-h-11 px-6" type="submit" disabled={busy}>
                  {busy ? 'Verifying…' : 'Verify'}
                </Button>
                <button
                  type="button"
                  className={linkClass}
                  disabled={busy}
                  onClick={() => goTo('password')}
                >
                  Use a different account
                </button>
              </div>
            </form>
          </>
        )}
      </div>
      {enrollment && (step === 'enroll-scan' || step === 'enroll-codes') ? (
        <StepFooter
          step={step === 'enroll-scan' ? 2 : 3}
          of={3}
          label={step === 'enroll-scan' ? 'Set up authenticator' : 'Save Recovery Codes'}
          note={`Sign-in expires at ${manilaTime(enrollment.expiresAt, { hour: 'numeric', minute: '2-digit' })}`}
        />
      ) : step === 'password' || step === 'totp' || step === 'recovery' ? (
        <StepFooter
          step={step === 'password' ? 1 : 2}
          of={2}
          label={step === 'password' ? 'Email and password' : 'Verify it’s you'}
        />
      ) : null}
    </CivicSunriseLayout>
  );
}
