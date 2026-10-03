'use client';

import { useState } from 'react';
import { RecoveryCodeSlip } from '../../../components/authenticator-setup';
import { useReauthentication } from '../../../components/reauthentication';
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
import { FormError } from '../../../components/ui/field';
import { PageHeader } from '../../../components/ui/page-header';
import { Panel } from '../../../components/ui/panel';
import { ChangePasswordDialog, refusal, ReplaceAuthenticatorDialog } from './credential-dialogs';

function eventChecked(event: { currentTarget: EventTarget }): boolean {
  return (event.currentTarget as unknown as { checked: boolean }).checked;
}

export function AccountSecurity({
  account,
  initial,
}: {
  account: string;
  initial: { hasAuthenticator: boolean; remaining: number };
}) {
  const [remaining, setRemaining] = useState(initial.remaining);
  const [codes, setCodes] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [changing, setChanging] = useState(false);
  const [replacement, setReplacement] = useState('');
  const [replaceError, setReplaceError] = useState('');
  const [starting, setStarting] = useState(false);
  const [done, setDone] = useState('');
  const { guarded, prompt } = useReauthentication();

  async function startReplacement(): Promise<void> {
    setReplaceError('');
    setDone('');
    setStarting(true);
    try {
      const response = await guarded(() =>
        fetch('/api/v1/auth/authenticator/replacement', {
          method: 'POST',
          credentials: 'include',
        }),
      );
      if (!response.ok) {
        setReplaceError(
          (await refusal(response)).message ?? 'The replacement could not start. Try again.',
        );
        return;
      }
      const { otpauthUri } = (await response.json()) as { otpauthUri: string };
      setReplacement(otpauthUri);
    } catch {
      setReplaceError('The replacement could not start. Check the connection and try again.');
    } finally {
      setStarting(false);
    }
  }

  /** A Recovery Code spent on a password change leaves one fewer. */
  async function refreshRemaining(): Promise<void> {
    const response = await fetch('/api/v1/auth/recovery-codes', { credentials: 'include' }).catch(
      () => null,
    );
    if (!response?.ok) return;
    const value = (await response.json().catch(() => null)) as { remaining?: unknown } | null;
    if (typeof value?.remaining === 'number') setRemaining(value.remaining);
  }

  async function regenerate(): Promise<void> {
    setError('');
    setBusy(true);
    try {
      const response = await guarded(() =>
        fetch('/api/v1/auth/recovery-codes', { method: 'POST', credentials: 'include' }),
      );
      const value = (await response.json().catch(() => null)) as {
        recoveryCodes?: unknown;
        error?: { message?: unknown };
      } | null;
      if (!response.ok || !Array.isArray(value?.recoveryCodes)) {
        setError(
          typeof value?.error?.message === 'string'
            ? value.error.message
            : 'New Recovery Codes could not be generated. Try again.',
        );
        return;
      }
      setCodes(value.recoveryCodes as string[]);
      setRemaining(value.recoveryCodes.length);
      setSaved(false);
    } catch {
      setError('New Recovery Codes could not be generated. Check the connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5">
      <PageHeader breadcrumbs={[{ label: 'Account' }]} title="Account security" />
      {done ? (
        <p
          role="status"
          className="m-0 rounded-control border border-success/40 bg-success/5 px-3 py-2.5 text-small text-success"
        >
          {done}
        </p>
      ) : null}
      <Panel
        title="Password"
        actions={
          <Button
            variant="secondary"
            type="button"
            onClick={() => {
              setDone('');
              setChanging(true);
            }}
          >
            Change password
          </Button>
        }
      >
        <p className="m-0 text-small text-ink">
          Changing it signs out your other sessions. You’ll need your current password
          {initial.hasAuthenticator ? ' and a code' : ''}.
        </p>
      </Panel>
      {initial.hasAuthenticator ? (
        <Panel
          title="Authenticator app"
          actions={
            <Button
              variant="secondary"
              type="button"
              disabled={starting}
              onClick={startReplacement}
            >
              {starting ? 'Starting…' : 'Replace authenticator'}
            </Button>
          }
        >
          <div className="grid gap-3">
            <FormError message={replaceError} />
            <p className="m-0 text-small text-ink">
              Sign-in asks for a code from this app every time. Replace it if you’re moving to a new
              phone.
            </p>
          </div>
        </Panel>
      ) : null}
      <Panel
        title="Recovery Codes"
        actions={
          initial.hasAuthenticator ? (
            <Button variant="secondary" type="button" disabled={busy} onClick={regenerate}>
              {busy ? 'Generating…' : 'Generate new codes'}
            </Button>
          ) : null
        }
      >
        <div className="grid gap-3">
          <FormError message={error} />
          <p className="m-0 text-small text-ink">
            {initial.hasAuthenticator
              ? `${remaining} of 10 left. Generating a new set voids the old one.`
              : 'You don’t have an authenticator, so there are no Recovery Codes to replace.'}
          </p>
        </div>
      </Panel>
      {changing ? (
        <ChangePasswordDialog
          hasAuthenticator={initial.hasAuthenticator}
          onClose={() => setChanging(false)}
          onChanged={(revokedSessions) => {
            setChanging(false);
            void refreshRemaining();
            setDone(
              revokedSessions === 0
                ? 'Password changed. We emailed you a notice.'
                : `Password changed. We signed out your ${revokedSessions} other session${revokedSessions === 1 ? '' : 's'} and emailed you a notice.`,
            );
          }}
        />
      ) : null}
      {replacement ? (
        <ReplaceAuthenticatorDialog
          otpauthUri={replacement}
          guarded={guarded}
          onClose={() => setReplacement('')}
          onReplaced={() => {
            setReplacement('');
            setDone(
              'Authenticator replaced. The old one no longer works. We signed out your other sessions.',
            );
          }}
        />
      ) : null}
      {prompt}
      <Dialog open={codes.length > 0}>
        <DialogContent size="compact" onEscapeKeyDown={(event) => event.preventDefault()}>
          <DialogHeader>
            <div className="grid gap-1">
              <DialogTitle>Your new Recovery Codes</DialogTitle>
              <DialogDescription>
                Your old codes no longer work. Save these now; you won’t see them again.
              </DialogDescription>
            </div>
          </DialogHeader>
          <DialogBody>
            <div className="grid gap-4">
              <RecoveryCodeSlip account={account} codes={codes} />
              <label className="flex items-start gap-2.5 text-small text-ink">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 accent-primary"
                  checked={saved}
                  onChange={(event) => setSaved(eventChecked(event))}
                />
                <span>I’ve saved these Recovery Codes somewhere safe.</span>
              </label>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="primary" type="button" disabled={!saved} onClick={() => setCodes([])}>
              I’ve saved them
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
