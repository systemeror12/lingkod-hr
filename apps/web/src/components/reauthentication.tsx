'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Button } from './ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Field, FormError, inputClass } from './ui/field';

function eventValue(event: { currentTarget: EventTarget }): string {
  return (event.currentTarget as unknown as { value: string }).value;
}

async function requiresReauthentication(response: Response): Promise<boolean> {
  if (response.status !== 403) return false;
  const value: unknown = await response
    .clone()
    .json()
    .catch(() => null);
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { error?: { code?: unknown } }).error?.code === 'REAUTHENTICATION_REQUIRED'
  );
}

/**
 * Guarded actions answer `403 REAUTHENTICATION_REQUIRED` once the Reauthentication Window has
 * closed. `guarded(request)` sends the request; on that refusal it asks the User to confirm it’s
 * them and retries the request once. If they cancel, it returns the original refusal. Render
 * `prompt` once in the calling component.
 */
export function useReauthentication(): {
  guarded: (request: () => Promise<Response>) => Promise<Response>;
  prompt: ReactNode;
} {
  const [settle, setSettle] = useState<((confirmed: boolean) => void) | null>(null);

  async function guarded(request: () => Promise<Response>): Promise<Response> {
    const response = await request();
    if (!(await requiresReauthentication(response))) return response;
    const confirmed = await new Promise<boolean>((resolve) => setSettle(() => resolve));
    setSettle(null);
    return confirmed ? request() : response;
  }

  return {
    guarded,
    prompt: settle ? <ReauthenticationPrompt onSettle={settle} /> : null,
  };
}

function ReauthenticationPrompt({ onSettle }: { onSettle: (confirmed: boolean) => void }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [method, setMethod] = useState<'totp' | 'recovery_code'>('totp');
  const [hasAuthenticator, setHasAuthenticator] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Ask for a code only when the User has an authenticator; assume one if the status fails.
  useEffect(() => {
    void fetch('/api/v1/auth/recovery-codes', { credentials: 'include' })
      .then(async (response) =>
        response.ok ? ((await response.json()) as { hasAuthenticator: boolean }) : null,
      )
      .then((status) => setHasAuthenticator(status?.hasAuthenticator ?? true))
      .catch(() => setHasAuthenticator(true));
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const proof = !hasAuthenticator
        ? { password }
        : method === 'totp'
          ? { password, code }
          : { password, recoveryCode: code };
      const response = await fetch('/api/v1/auth/reauthenticate', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(proof),
      });
      if (response.ok) {
        onSettle(true);
        return;
      }
      const value = (await response.json().catch(() => null)) as {
        error?: { message?: unknown };
      } | null;
      setError(
        typeof value?.error?.message === 'string'
          ? value.error.message
          : 'We couldn’t confirm it’s you. Try again.',
      );
    } catch {
      setError('We couldn’t confirm it’s you. Check the connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onSettle(false);
      }}
    >
      <DialogContent size="compact" aria-busy={busy}>
        <DialogHeader>
          <div className="grid gap-1">
            <DialogTitle>Confirm it’s you</DialogTitle>
            <DialogDescription>
              This action needs a recent sign-in. Enter your password
              {hasAuthenticator ? ' and a code' : ''} to continue.
            </DialogDescription>
          </div>
        </DialogHeader>
        <DialogBody>
          <form className="grid gap-4" id="reauthentication-form" onSubmit={submit} noValidate>
            <FormError message={error} />
            <Field label="Current password">
              <input
                className={inputClass}
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(eventValue(event))}
              />
            </Field>
            {hasAuthenticator ? (
              <div className="grid justify-items-start gap-2">
                <div className="grid w-full">
                  {method === 'totp' ? (
                    <Field key="totp" label="Authentication code">
                      <input
                        className={inputClass}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={7}
                        required
                        value={code}
                        onChange={(event) => setCode(eventValue(event))}
                      />
                    </Field>
                  ) : (
                    <Field key="recovery" label="Recovery Code">
                      <input
                        className={inputClass}
                        autoComplete="off"
                        spellCheck={false}
                        maxLength={64}
                        required
                        value={code}
                        onChange={(event) => setCode(eventValue(event))}
                      />
                    </Field>
                  )}
                </div>
                <button
                  type="button"
                  className="cursor-pointer text-small font-semibold text-primary underline-offset-2 hover:underline"
                  onClick={() => {
                    setCode('');
                    setMethod(method === 'totp' ? 'recovery_code' : 'totp');
                  }}
                >
                  {method === 'totp'
                    ? 'Use a Recovery Code instead'
                    : 'Use your authenticator code'}
                </button>
              </div>
            ) : null}
          </form>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" type="button" disabled={busy} onClick={() => onSettle(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="reauthentication-form"
            disabled={busy || hasAuthenticator === null}
          >
            {busy ? 'Confirming…' : 'Confirm'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
