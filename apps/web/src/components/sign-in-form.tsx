'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from './ui/button';
import { Field, FormError, inputClass } from './ui/field';

type Step = 'password' | 'totp';

const FALLBACK_MESSAGE = 'Sign-in could not be completed. Try again.';

class SignInFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function post(path: string, body: unknown): Promise<{ status?: string }> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const value: unknown = await response.json().catch(() => null);
  if (response.ok) return (value ?? {}) as { status?: string };
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

/**
 * Email and password, then the authenticator code when the User has a TOTP factor. Calls the
 * relative sign-in routes and opens the workspace once a session exists.
 */
export function SignInForm({ membershipId }: { membershipId: string | null }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const errorRef = useRef<{ focus(): void } | null>(null);
  const codeRef = useRef<{ focus(): void } | null>(null);

  useEffect(() => {
    if (step === 'totp') codeRef.current?.focus();
  }, [step]);

  function fail(failure: SignInFailure) {
    setError(failure.message);
    queueMicrotask(() => errorRef.current?.focus());
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
        setStep('totp');
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
      await post('/api/v1/auth/sign-in/totp', { code });
      router.replace('/dashboard');
    } catch (failure: unknown) {
      const signInFailure = failureFrom(failure);
      setCode('');
      if (signInFailure.code === 'SIGN_IN_EXPIRED') setStep('password');
      fail(signInFailure);
      setBusy(false);
    }
  }

  function startOver() {
    setStep('password');
    setCode('');
    setError('');
  }

  return step === 'password' ? (
    <form className="grid gap-4" onSubmit={submitPassword} noValidate>
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
      <Button variant="primary" className="min-h-11" type="submit" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  ) : (
    <form className="grid gap-4" onSubmit={submitCode} noValidate>
      <FormError ref={errorRef} tabIndex={-1} message={error} />
      <p className="m-0 text-body text-ink-muted">
        Enter the 6-digit code from your authenticator app.
      </p>
      <Field label="Authentication code">
        <input
          className={inputClass}
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
      <Button variant="primary" className="min-h-11" type="submit" disabled={busy}>
        {busy ? 'Verifying…' : 'Verify'}
      </Button>
      <Button type="button" onClick={startOver} disabled={busy}>
        Use a different account
      </Button>
    </form>
  );
}
