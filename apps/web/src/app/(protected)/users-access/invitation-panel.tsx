'use client';

import { useRef, useState } from 'react';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../../components/ui/dialog';
import { useReauthentication } from '../../../components/reauthentication';
import { StateSurface } from '../../../components/state-surface';
import { Button } from '../../../components/ui/button';
import { FormError, inputClass, labelClass } from '../../../components/ui/field';
import { PageHeader } from '../../../components/ui/page-header';
import { Panel } from '../../../components/ui/panel';
import { StatusTag } from '../../../components/ui/status-tag';
import { Table, Td, Th, Tr } from '../../../components/ui/table';

interface PendingInvitation {
  id: string;
  email: string;
  roleCode: string | null;
  expiresAt: string;
  status: 'PENDING';
}

interface PendingInvitationResponse {
  pendingCount: number;
  hasMore: boolean;
  invitations: PendingInvitation[];
}

interface InvitationErrorResponse {
  error?: { code?: unknown; message?: unknown };
}

function errorMessage(value: unknown): string {
  if (typeof value !== 'object' || value === null) {
    return 'The invitation could not be sent. Try again.';
  }
  const error = (value as InvitationErrorResponse).error;
  return typeof error?.message === 'string'
    ? error.message
    : 'The invitation could not be sent. Try again.';
}

function formatExpiryDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unavailable';
  return date.toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Manila',
  });
}

export function InvitationPanel({
  agencyId,
  initial,
}: {
  agencyId: string;
  initial: PendingInvitationResponse;
}) {
  const [pending, setPending] = useState(initial);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sentEmail, setSentEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const emailRef = useRef<{ focus(): void } | null>(null);
  const { guarded, prompt } = useReauthentication();

  function handleOpenChange(nextOpen: boolean): void {
    if (!nextOpen && submitting) return;
    setOpen(nextOpen);
    if (!nextOpen) setError('');
  }

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError('');
    setSentEmail('');
    setSubmitting(true);
    try {
      const response = await guarded(() =>
        fetch(`/api/v1/agencies/${agencyId}/invitations`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, roleCodes: ['hrmo_administrator'] }),
        }),
      );
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(errorMessage(value));
        return;
      }
      if (
        typeof value !== 'object' ||
        value === null ||
        typeof (value as { id?: unknown }).id !== 'string' ||
        typeof (value as { email?: unknown }).email !== 'string' ||
        typeof (value as { expiresAt?: unknown }).expiresAt !== 'string'
      ) {
        setError('The invitation was not confirmed. Check the pending list before trying again.');
        return;
      }
      const invitation: PendingInvitation = {
        id: (value as { id: string }).id,
        email: (value as { email: string }).email,
        roleCode: 'hrmo_administrator',
        expiresAt: (value as { expiresAt: string }).expiresAt,
        status: 'PENDING',
      };
      setPending((current) => ({
        ...current,
        pendingCount: current.pendingCount + 1,
        invitations: [invitation, ...current.invitations],
      }));
      const refreshed = await fetch(`/api/v1/agencies/${agencyId}/invitations`, {
        credentials: 'include',
      });
      if (refreshed.ok) setPending((await refreshed.json()) as PendingInvitationResponse);
      setSentEmail(invitation.email);
      setEmail('');
      setOpen(false);
    } catch {
      setError('The invitation could not be sent. Check the connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <div className="grid gap-5">
        <PageHeader
          breadcrumbs={[{ label: 'Oversight' }, { label: 'Users & Access' }]}
          title="Invite an HRMO Administrator"
          actions={
            <DialogTrigger asChild>
              <Button variant="primary" type="button" onClick={() => setError('')}>
                Invite user
              </Button>
            </DialogTrigger>
          }
        />
        <p className="m-0 max-w-[650px] text-small text-ink-muted">
          Send one secure, single-use invitation for HRMO work in this Agency Context. The invitee
          establishes identity through the approved sign-in provider.
        </p>

        {sentEmail ? (
          <p
            className="m-0 rounded-control border border-success/40 bg-success/5 px-3 py-2.5 text-small text-ink"
            role="status"
          >
            Invitation sent to <strong>{sentEmail}</strong>. The pending handoff is now visible
            below.
          </p>
        ) : null}
        {!open ? <FormError message={error} /> : null}

        <Panel
          title="Pending invitations"
          flush
          actions={
            <span className="text-caption text-ink-muted tabular-nums">{pending.pendingCount}</span>
          }
        >
          {pending.invitations.length === 0 ? (
            <StateSurface compact labelledBy="pending-empty-title">
              <strong className="text-body font-[650] text-ink" id="pending-empty-title">
                No pending invitations.
              </strong>
              <p className="m-0">
                Invite one HRMO Administrator when your Agency is ready to hand off HR work.
              </p>
            </StateSurface>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Email address</Th>
                  <Th>Role</Th>
                  <Th kind="date">Expires</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {pending.invitations.map((invitation) => (
                  <Tr key={invitation.id}>
                    <Td className="font-[600] text-ink">{invitation.email}</Td>
                    <Td>HRMO Administrator</Td>
                    <Td kind="date">{formatExpiryDate(invitation.expiresAt)}</Td>
                    <Td>
                      <StatusTag tone="warning">Pending</StatusTag>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>

        <DialogContent
          size="compact"
          aria-busy={submitting}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            emailRef.current?.focus();
          }}
        >
          <DialogHeader>
            <div className="grid min-w-0 gap-1.5">
              <DialogTitle>Invite user</DialogTitle>
              <DialogDescription>
                Send a secure, single-use invitation for an HRMO Administrator in this Agency
                Context.
              </DialogDescription>
            </div>
            <DialogClose asChild>
              <Button type="button" aria-label="Close invitation dialog" disabled={submitting}>
                <span aria-hidden="true" className="text-xl leading-none">
                  ×
                </span>
              </Button>
            </DialogClose>
          </DialogHeader>
          <DialogBody>
            <form className="grid gap-5" id="invite-form" onSubmit={submit}>
              <div className="grid gap-1">
                <label className={labelClass} htmlFor="invite-email">
                  Email address
                </label>
                <input
                  ref={emailRef}
                  className={inputClass}
                  id="invite-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? 'invite-error' : 'invite-email-help'}
                  onChange={(event) =>
                    setEmail((event.target as unknown as { value: string }).value)
                  }
                />
                <span className="text-caption text-ink-muted" id="invite-email-help">
                  Use the verified email address of the individual who will accept the invitation.
                </span>
                {error ? (
                  <span className="text-caption text-danger" id="invite-error" role="alert">
                    {error}
                  </span>
                ) : null}
              </div>
              <fieldset className="m-0 grid gap-1 border-0 p-0">
                <legend className={labelClass}>Role</legend>
                <label className="flex min-h-9 items-center gap-3 rounded-control border border-border bg-canvas px-2.5 py-2 text-small text-ink">
                  <input type="radio" name="role" value="hrmo_administrator" checked readOnly />
                  <span>
                    <strong className="font-[650]">HRMO Administrator</strong>
                    <span className="block text-caption text-ink-muted">
                      HR management without unrestricted system administration.
                    </span>
                  </span>
                </label>
              </fieldset>
            </form>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary" type="button" disabled={submitting}>
                Cancel
              </Button>
            </DialogClose>
            <Button variant="primary" type="submit" form="invite-form" disabled={submitting}>
              {submitting ? 'Sending…' : 'Send invitation'}
            </Button>
          </DialogFooter>
        </DialogContent>
        {prompt}
      </div>
    </Dialog>
  );
}
