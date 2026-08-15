'use client';

import { useEffect, useRef, useState } from 'react';

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

function expiryLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Expiry unavailable';
  return `Expires ${date.toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Manila',
  })}`;
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
  const triggerRef = useRef<{ focus(): void } | null>(null);
  const emailRef = useRef<{ focus(): void } | null>(null);
  const firstDialogControlRef = useRef<{ focus(): void } | null>(null);
  const lastDialogControlRef = useRef<{ focus(): void } | null>(null);
  const dialogWasOpenRef = useRef(false);

  useEffect(() => {
    if (open) {
      dialogWasOpenRef.current = true;
      emailRef.current?.focus();
    } else if (dialogWasOpenRef.current) {
      triggerRef.current?.focus();
    }
  }, [open]);

  function closeDialog(): void {
    if (submitting) return;
    setOpen(false);
    setError('');
  }

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError('');
    setSentEmail('');
    setSubmitting(true);
    try {
      const response = await fetch(`/api/v1/agencies/${agencyId}/invitations`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, roleCodes: ['hrmo_administrator'] }),
      });
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
    <div className="grid gap-7">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid max-w-[650px] gap-2">
          <p className="m-0 text-[11px] font-bold tracking-[0.09em] text-cobalt uppercase">
            Users &amp; Access
          </p>
          <h1 className="m-0 text-[clamp(28px,3vw,38px)] leading-[1.08] font-[680] tracking-[-0.035em] text-midnight">
            Invite an HRMO Administrator
          </h1>
          <p className="m-0 text-sm leading-[1.65] text-muted">
            Send one secure, single-use invitation for HRMO work in this Agency Context. The invitee
            establishes identity through the approved sign-in provider.
          </p>
        </div>
        <button
          className="inline-flex min-h-11 items-center justify-center rounded-[3px] bg-cobalt px-4 text-sm font-[650] text-white hover:bg-[#365f96]"
          type="button"
          ref={triggerRef}
          onClick={() => {
            setError('');
            setOpen(true);
          }}
        >
          Invite user
        </button>
      </header>

      {sentEmail ? (
        <p
          className="m-0 rounded-[4px] border border-[#b8cbe4] bg-pale-blue px-4 py-3 text-sm text-ink"
          role="status"
        >
          Invitation sent to <strong>{sentEmail}</strong>. The pending handoff is now visible below.
        </p>
      ) : null}
      {error && !open ? (
        <p
          className="m-0 rounded-[4px] border border-[#d6aeb0] bg-[#fff7f7] px-4 py-3 text-sm text-[#7a3036]"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <section
        className="overflow-hidden rounded-[5px] border border-line bg-paper"
        aria-labelledby="pending-heading"
      >
        <header className="flex min-h-[60px] items-center justify-between gap-4 border-b border-line px-5">
          <h2 className="m-0 text-sm font-[670] text-midnight" id="pending-heading">
            Pending invitations
          </h2>
          <span className="rounded-full bg-pale-blue px-2.5 py-1 text-xs font-[650] text-cobalt">
            {pending.pendingCount}
          </span>
        </header>
        {pending.invitations.length === 0 ? (
          <div className="grid min-h-[190px] place-content-center gap-2 px-6 py-10 text-left">
            <strong className="text-[15px] font-[650] text-midnight">
              No pending invitations.
            </strong>
            <p className="m-0 max-w-[520px] text-[13px] leading-[1.6] text-muted">
              Invite one HRMO Administrator when your Agency is ready to hand off HR work.
            </p>
          </div>
        ) : (
          <ul className="m-0 list-none divide-y divide-line p-0">
            {pending.invitations.map((invitation) => (
              <li
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
                key={invitation.id}
              >
                <div className="grid gap-1">
                  <strong className="text-sm font-[650] text-midnight">{invitation.email}</strong>
                  <span className="text-xs text-muted">
                    HRMO Administrator · {expiryLabel(invitation.expiresAt)}
                  </span>
                </div>
                <span className="text-xs font-[650] tracking-[0.04em] text-cobalt uppercase">
                  Pending
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {open ? (
        <div
          className="fixed inset-0 z-20 grid place-items-center bg-midnight/35 px-4 py-6"
          role="presentation"
        >
          <section
            className="grid max-h-full w-full max-w-[520px] gap-5 overflow-y-auto rounded-[5px] border border-line bg-paper p-6 shadow-[0_18px_55px_rgb(23_32_51/20%)] min-[621px]:p-8"
            role="dialog"
            aria-modal="true"
            aria-labelledby="invite-dialog-title"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                closeDialog();
                return;
              }
              if (event.key !== 'Tab') return;
              const target = event.target as unknown;
              if (event.shiftKey && target === firstDialogControlRef.current) {
                event.preventDefault();
                lastDialogControlRef.current?.focus();
              } else if (!event.shiftKey && target === lastDialogControlRef.current) {
                event.preventDefault();
                firstDialogControlRef.current?.focus();
              }
            }}
          >
            <header className="flex items-start justify-between gap-4">
              <div className="grid gap-1.5">
                <p className="m-0 text-[11px] font-bold tracking-[0.09em] text-cobalt uppercase">
                  New invitation
                </p>
                <h2
                  className="m-0 text-xl font-[680] tracking-[-0.025em] text-midnight"
                  id="invite-dialog-title"
                >
                  Invite user
                </h2>
              </div>
              <button
                className="min-h-9 min-w-9 rounded-[3px] text-xl text-muted hover:bg-canvas"
                type="button"
                ref={firstDialogControlRef}
                aria-label="Close invitation dialog"
                onClick={closeDialog}
              >
                ×
              </button>
            </header>
            <form className="grid gap-5" onSubmit={submit}>
              <div className="grid gap-2">
                <label className="text-sm font-[650] text-ink" htmlFor="invite-email">
                  Email address
                </label>
                <input
                  ref={emailRef}
                  className="min-h-11 rounded-[3px] border border-line bg-paper px-3 text-sm text-ink"
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
                <span className="text-xs leading-[1.5] text-muted" id="invite-email-help">
                  Use the verified email address of the individual who will accept the invitation.
                </span>
                {error ? (
                  <span
                    className="text-xs leading-[1.5] text-[#7a3036]"
                    id="invite-error"
                    role="alert"
                  >
                    {error}
                  </span>
                ) : null}
              </div>
              <fieldset className="grid gap-2 border-0 p-0">
                <legend className="text-sm font-[650] text-ink">Role</legend>
                <label className="flex min-h-11 items-center gap-3 rounded-[3px] border border-line bg-canvas px-3 text-sm text-ink">
                  <input type="radio" name="role" value="hrmo_administrator" checked readOnly />
                  <span>
                    <strong className="font-[650]">HRMO Administrator</strong>
                    <span className="block text-xs text-muted">
                      HR management without unrestricted system administration.
                    </span>
                  </span>
                </label>
              </fieldset>
              <div className="flex flex-wrap justify-end gap-3 border-t border-line pt-5">
                <button
                  className="min-h-11 rounded-[3px] px-4 text-sm font-[650] text-muted hover:bg-canvas"
                  type="button"
                  onClick={closeDialog}
                >
                  Cancel
                </button>
                <button
                  className="min-h-11 rounded-[3px] bg-cobalt px-4 text-sm font-[650] text-white hover:bg-[#365f96]"
                  type="submit"
                  ref={lastDialogControlRef}
                  disabled={submitting}
                >
                  {submitting ? 'Sending…' : 'Send invitation'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
