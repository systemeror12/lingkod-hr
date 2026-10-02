'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { cn } from '../lib/class-names';
import { BusyBar, CivicSunriseLayout, StepFooter } from './civic-sunrise';
import { Button } from './ui/button';
import { Field, FormError, inputClass } from './ui/field';

type Step = 'password' | 'totp' | 'recovery' | 'recovery-used';

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

type SignInResponse = { status?: string; recoveryCodesRemaining?: number };

async function post(path: string, body: unknown): Promise<SignInResponse> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const value: unknown = await response.json().catch(() => null);
  if (response.ok) return (value ?? {}) as SignInResponse;
  const error = (value as { error?: { code?: string; message?: string } } | null)?.error;
  throw new SignInFailure(
    error?.code ?? 'SIGN_IN_FAILED',
    error?.message ??
      (response.status === 400 ? 'Enter your email and password.' : FALLBACK_MESSAGE),
  );
}

function eventValue(event: { currentTarget: EventTarget }): string {
  return (event.currentTarget as unknown as { value: string }).value;
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
 * factor. Calls the relative sign-in routes and opens the workspace once a session exists; after
 * a Recovery Code it first shows how many codes are left.
 */
export function SignInForm({ membershipId }: { membershipId: string | null }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codesLeft, setCodesLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Counts refusals, so the form's nudge replays on each one.
  const [attempt, setAttempt] = useState(0);
  const errorRef = useRef<{ focus(): void } | null>(null);
  const codeRef = useRef<{ focus(): void } | null>(null);

  useEffect(() => {
    if (step === 'totp' || step === 'recovery') codeRef.current?.focus();
  }, [step]);
  useEffect(() => {
    // After a refusal the form remounts; focus the message, or the code field it sits under.
    if (attempt > 0) (step === 'password' ? errorRef : codeRef).current?.focus();
  }, [attempt]);

  function fail(failure: SignInFailure) {
    setError(failure.message);
    setAttempt((count) => count + 1);
  }

  function goTo(next: Step) {
    setStep(next);
    setCode('');
    setError('');
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
      if (result.status === 'TOTP_REQUIRED') {
        setPassword('');
        goTo('totp');
        setBusy(false);
        return;
      }
      router.replace('/dashboard');
    } catch (failure: unknown) {
      fail(failureFrom(failure));
      setBusy(false);
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
      if (signInFailure.code === 'SIGN_IN_EXPIRED') {
        goTo('password');
        fail(signInFailure);
      } else {
        fail(
          signInFailure.code === 'INVALID_CODE' && step === 'recovery'
            ? new SignInFailure('INVALID_CODE', 'That Recovery Code didn’t work.')
            : signInFailure,
        );
      }
      setBusy(false);
    }
  }

  const progress = step === 'password' ? 0 : step === 'recovery-used' ? 1 : 0.5;
  const account = (
    <p className="m-0 text-small text-ink-muted">
      Account: <span className="text-ink">{email}</span>
    </p>
  );

  return (
    <CivicSunriseLayout progress={progress} labelledBy="sign-in-title">
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
      {step !== 'recovery-used' ? (
        <StepFooter
          step={step === 'password' ? 1 : 2}
          of={2}
          label={step === 'password' ? 'Email and password' : 'Verify it’s you'}
        />
      ) : null}
    </CivicSunriseLayout>
  );
}
