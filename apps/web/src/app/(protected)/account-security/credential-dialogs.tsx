'use client';

import { useState } from 'react';
import { SetupKey } from '../../../components/authenticator-setup';
import { CodeField } from '../../../components/reauthentication';
import { Button } from '../../../components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { Field, FormError, inputClass } from '../../../components/ui/field';

function eventValue(event: { currentTarget: EventTarget }): string {
  return (event.currentTarget as unknown as { value: string }).value;
}

/** The API's refusal, or nothing when the body isn't one. */
export async function refusal(response: Response): Promise<{ code?: string; message?: string }> {
  const value = (await response.json().catch(() => null)) as {
    error?: { code?: unknown; message?: unknown };
  } | null;
  return {
    ...(typeof value?.error?.code === 'string' ? { code: value.error.code } : {}),
    ...(typeof value?.error?.message === 'string' ? { message: value.error.message } : {}),
  };
}

/**
 * Asks for the current password, a code when the User has an authenticator, and a new password.
 * It asks every time, so it isn't guarded by the Reauthentication Window.
 */
export function ChangePasswordDialog({
  hasAuthenticator,
  onClose,
  onChanged,
}: {
  hasAuthenticator: boolean;
  onClose: () => void;
  onChanged: (revokedSessions: number) => void;
}) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [code, setCode] = useState('');
  const [method, setMethod] = useState<'totp' | 'recovery_code'>('totp');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [newPasswordError, setNewPasswordError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError('');
    setNewPasswordError('');
    setBusy(true);
    try {
      const proof = !hasAuthenticator ? {} : method === 'totp' ? { code } : { recoveryCode: code };
      const response = await fetch('/api/v1/auth/password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword, ...proof }),
      });
      if (response.ok) {
        const { revokedSessions } = (await response.json()) as { revokedSessions: number };
        onChanged(revokedSessions);
        return;
      }
      const refused = await refusal(response);
      if (refused.code === 'PASSWORD_REJECTED' && refused.message) {
        setNewPasswordError(refused.message);
      } else if (refused.code === 'INVALID_CREDENTIALS') {
        setError('Current password or code is incorrect.');
      } else {
        setError(refused.message ?? 'Your password could not be changed. Try again.');
      }
    } catch {
      setError('Your password could not be changed. Check the connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent size="compact" aria-busy={busy}>
        <DialogHeader>
          <div className="grid gap-1">
            <DialogTitle>Change password</DialogTitle>
            <DialogDescription>
              Your other sessions will be signed out. This one stays signed in.
            </DialogDescription>
          </div>
        </DialogHeader>
        <DialogBody>
          <form className="grid gap-4" id="change-password-form" onSubmit={submit} noValidate>
            <FormError message={error} />
            <Field label="Current password">
              <input
                className={inputClass}
                type="password"
                autoComplete="current-password"
                required
                value={currentPassword}
                onChange={(event) => setCurrentPassword(eventValue(event))}
              />
            </Field>
            {hasAuthenticator ? (
              <CodeField method={method} code={code} onCode={setCode} onMethod={setMethod} />
            ) : null}
            <div className="grid gap-1">
              <Field label="New password" error={newPasswordError || undefined}>
                <input
                  className={inputClass}
                  type="password"
                  autoComplete="new-password"
                  required
                  maxLength={1024}
                  value={newPassword}
                  onChange={(event) => setNewPassword(eventValue(event))}
                />
              </Field>
              <p className="m-0 text-caption text-ink-muted">
                15 to 128 characters. Spaces are fine. Don’t use your name, email, or current
                password.
              </p>
            </div>
          </form>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" type="button" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="change-password-form" disabled={busy}>
            {busy ? 'Changing…' : 'Change password'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Shows the new authenticator's setup key and confirms it with a code from the new app. Both
 * requests go through `guarded`, since the Reauthentication Window guards them.
 */
export function ReplaceAuthenticatorDialog({
  otpauthUri,
  guarded,
  onClose,
  onReplaced,
}: {
  otpauthUri: string;
  guarded: (request: () => Promise<Response>) => Promise<Response>;
  onClose: () => void;
  onReplaced: () => void;
}) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [codeError, setCodeError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError('');
    setCodeError('');
    setBusy(true);
    try {
      const response = await guarded(() =>
        fetch('/api/v1/auth/authenticator/replacement/confirm', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code }),
        }),
      );
      if (response.ok) {
        onReplaced();
        return;
      }
      const refused = await refusal(response);
      if (refused.code === 'INVALID_CODE' && refused.message) setCodeError(refused.message);
      else setError(refused.message ?? 'Your authenticator could not be replaced. Try again.');
    } catch {
      setError('Your authenticator could not be replaced. Check the connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent size="compact" aria-busy={busy}>
        <DialogHeader>
          <div className="grid gap-1">
            <DialogTitle>Replace authenticator</DialogTitle>
            <DialogDescription>
              Scan with the new app. The old app stops working once you confirm.
            </DialogDescription>
          </div>
        </DialogHeader>
        <DialogBody>
          <form className="grid gap-4" id="replace-authenticator-form" onSubmit={submit} noValidate>
            <FormError message={error} />
            <SetupKey otpauthUri={otpauthUri} />
            <Field label="Code from the new app" error={codeError || undefined}>
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
          </form>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" type="button" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="replace-authenticator-form" disabled={busy}>
            {busy ? 'Confirming…' : 'Confirm and replace'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
