'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { cn } from '../lib/class-names';
import { BusyBar, CivicSunriseLayout, StepFooter } from './civic-sunrise';
import { Button } from './ui/button';
import { Field, FormError, inputClass } from './ui/field';

const FALLBACK_MESSAGE = 'The reset could not be completed. Try again.';
const linkClass =
  'cursor-pointer justify-self-start text-small text-primary underline underline-offset-4 disabled:opacity-50';

class ResetFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function post(path: string, body: unknown): Promise<void> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (response.ok) return;
  const value: unknown = await response.json().catch(() => null);
  const error = (value as { error?: { code?: string; message?: string } } | null)?.error;
  throw new ResetFailure(error?.code ?? 'RESET_FAILED', error?.message ?? FALLBACK_MESSAGE);
}

function failureFrom(value: unknown): ResetFailure {
  return value instanceof ResetFailure ? value : new ResetFailure('RESET_FAILED', FALLBACK_MESSAGE);
}

function eventValue(event: { currentTarget: EventTarget }): string {
  return (event.currentTarget as unknown as { value: string }).value;
}

function Title({ children }: { children: ReactNode }) {
  return (
    <h1
      id="reset-title"
      className="m-0 text-[1.625rem] leading-tight font-[650] tracking-[-0.015em] text-ink"
    >
      {children}
    </h1>
  );
}

function Lead({ children }: { children: ReactNode }) {
  return <p className="m-0 max-w-[60ch] text-body text-ink-muted">{children}</p>;
}

function Kicker({ danger, children }: { danger?: boolean; children: ReactNode }) {
  return (
    <p
      className={cn(
        'm-0 text-caption font-[650] tracking-[0.08em] uppercase',
        danger ? 'text-danger' : 'text-ink-muted',
      )}
    >
      {children}
    </p>
  );
}

/**
 * Asks for a reset link. Every email gets the same answer, so the page never tells whether an
 * account exists.
 */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const errorRef = useRef<{ focus(): void } | null>(null);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await post('/api/v1/auth/password-reset', { email });
      setSent(true);
    } catch (failure: unknown) {
      const resetFailure = failureFrom(failure);
      setError(
        resetFailure.code === 'RESET_FAILED' && !email.trim()
          ? 'Enter your email.'
          : resetFailure.message,
      );
    }
    setBusy(false);
  }

  return (
    <CivicSunriseLayout progress={sent ? 1 / 3 : 0} labelledBy="reset-title">
      <div key={String(sent)} className="lh-step-in grid gap-5">
        {sent ? (
          <>
            <div className="grid gap-2">
              <Kicker>Check your email</Kicker>
              <Title>If that email belongs to a LingkodHR account, we’ve sent a reset link.</Title>
              <Lead>
                The link works once, for 30 minutes. Asking again replaces the earlier link.
              </Lead>
            </div>
            <a className={linkClass} href="/sign-in">
              Back to sign in
            </a>
          </>
        ) : (
          <>
            <div className="grid gap-2">
              <Title>Reset your password</Title>
              <Lead>
                Enter the email you sign in with. If it belongs to an account, we’ll send a reset
                link.
              </Lead>
            </div>
            <form className="grid gap-4" onSubmit={submit} noValidate>
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
              <div className="relative flex flex-wrap items-center gap-x-5 gap-y-2">
                <BusyBar busy={busy} />
                <Button variant="primary" className="min-h-11 px-6" type="submit" disabled={busy}>
                  {busy ? 'Sending…' : 'Send reset link'}
                </Button>
                <a className={linkClass} href="/sign-in">
                  Back to sign in
                </a>
              </div>
            </form>
          </>
        )}
      </div>
      <StepFooter step={1} of={3} label="Request a link" />
    </CivicSunriseLayout>
  );
}

/** Every unusable link looks the same, whatever the reason. */
export function ResetLinkInvalid() {
  return (
    <CivicSunriseLayout progress={0} gloom labelledBy="reset-title">
      <div className="lh-step-in grid gap-5">
        <div className="grid gap-2">
          <Kicker danger>Link invalid</Kicker>
          <Title>This reset link is invalid or has expired.</Title>
          <Lead>Request a new one.</Lead>
        </div>
        <a className={linkClass} href="/forgot-password">
          Request a new link
        </a>
      </div>
    </CivicSunriseLayout>
  );
}

/**
 * A new password from a reset link, with the authenticator code or a Recovery Code when the User
 * has one. A wrong code leaves the link usable. A reset signs out every session and doesn't sign
 * the User in.
 */
export function PasswordResetForm({
  link,
}: {
  link: { token: string; email: string; secondFactor: boolean };
}) {
  const [state, setState] = useState<'form' | 'invalid' | 'done'>('form');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field: 'form' | 'password' | 'code'; message: string }>();
  // Counts refusals, so the form's nudge replays on each one.
  const [attempt, setAttempt] = useState(0);
  const errorRef = useRef<{ focus(): void } | null>(null);
  const codeRef = useRef<{ focus(): void } | null>(null);

  useEffect(() => {
    if (attempt > 0) (error?.field === 'code' ? codeRef : errorRef).current?.focus();
  }, [attempt]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await post(`/api/v1/auth/password-reset/${link.token}`, {
        password,
        ...(link.secondFactor ? (recovery ? { recoveryCode: code } : { code }) : {}),
      });
      setPassword('');
      setState('done');
    } catch (failure: unknown) {
      const resetFailure = failureFrom(failure);
      if (resetFailure.code === 'RESET_LINK_INVALID') {
        setState('invalid');
      } else {
        setCode('');
        setError({
          field:
            resetFailure.code === 'INVALID_CODE' || resetFailure.code === 'CODE_REQUIRED'
              ? 'code'
              : resetFailure.code === 'PASSWORD_REJECTED'
                ? 'password'
                : 'form',
          message: resetFailure.message,
        });
        setAttempt((count) => count + 1);
      }
    }
    setBusy(false);
  }

  if (state === 'invalid') return <ResetLinkInvalid />;
  if (state === 'done') {
    return (
      <CivicSunriseLayout progress={1} labelledBy="reset-title">
        <div className="lh-step-in grid gap-5">
          <div className="grid gap-2">
            <Kicker>Password reset</Kicker>
            <Title>Your password was reset</Title>
            <Lead>
              We signed you out on every device and emailed you a notice. Sign in with your new
              password.
            </Lead>
          </div>
          <a className={linkClass} href="/sign-in">
            Sign in
          </a>
        </div>
        <StepFooter step={3} of={3} label="Sign in again" />
      </CivicSunriseLayout>
    );
  }

  return (
    <CivicSunriseLayout progress={2 / 3} labelledBy="reset-title">
      <div className="lh-step-in grid gap-5">
        <div className="grid gap-2">
          <Title>Choose a new password</Title>
          <Lead>
            {link.secondFactor
              ? 'You still need your authenticator code. A reset signs you out on every device.'
              : 'A reset signs you out on every device.'}
          </Lead>
          <p className="m-0 text-small text-ink-muted">
            Account: <span className="text-ink">{link.email}</span>
          </p>
        </div>
        <form
          key={attempt}
          className={cn('grid gap-5', error && 'lh-nudge')}
          onSubmit={submit}
          noValidate
        >
          <FormError
            ref={errorRef}
            tabIndex={-1}
            message={error?.field === 'code' ? '' : (error?.message ?? '')}
          />
          <input type="email" hidden readOnly autoComplete="username" value={link.email} />
          <div className="grid gap-1.5">
            <Field label="New password">
              <input
                className={inputClass}
                type="password"
                name="password"
                autoComplete="new-password"
                aria-describedby="password-rules"
                required
                value={password}
                onChange={(event) => setPassword(eventValue(event))}
              />
            </Field>
            <p id="password-rules" className="m-0 text-caption text-ink-muted">
              Use 15 to 128 characters. A few unrelated words work well. Don’t use your name, your
              email, or LingkodHR.
            </p>
          </div>
          {link.secondFactor ? (
            <div className="grid gap-1.5">
              <Field
                label={recovery ? 'Recovery Code' : 'Authentication code'}
                error={error?.field === 'code' ? error.message : undefined}
              >
                <input
                  className={cn(
                    inputClass,
                    'font-mono',
                    recovery ? 'tracking-[0.12em]' : 'tracking-[0.3em]',
                  )}
                  name={recovery ? 'recovery-code' : 'code'}
                  inputMode={recovery ? undefined : 'numeric'}
                  autoComplete={recovery ? 'off' : 'one-time-code'}
                  autoCapitalize="off"
                  spellCheck={false}
                  maxLength={recovery ? 64 : 7}
                  placeholder={recovery ? 'xxxxx-xxxxx' : undefined}
                  required
                  ref={codeRef}
                  value={code}
                  onChange={(event) => setCode(eventValue(event))}
                />
              </Field>
              <button
                type="button"
                className={cn(linkClass, 'text-caption')}
                disabled={busy}
                onClick={() => {
                  setRecovery(!recovery);
                  setCode('');
                  setError(undefined);
                }}
              >
                {recovery ? 'Use your authenticator app' : 'No phone? Use a Recovery Code'}
              </button>
            </div>
          ) : null}
          <div className="relative grid justify-items-start">
            <BusyBar busy={busy} />
            <Button variant="primary" className="min-h-11 px-6" type="submit" disabled={busy}>
              {busy ? 'Resetting…' : 'Reset password'}
            </Button>
          </div>
        </form>
      </div>
      <StepFooter step={2} of={3} label="Choose a new password" />
    </CivicSunriseLayout>
  );
}
