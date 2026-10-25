'use client';

import { useRef, useState } from 'react';
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
import { Field, FormError, inputClass, labelClass } from '../../../components/ui/field';
import { Panel } from '../../../components/ui/panel';
import { StatusTag, type StatusDisplay } from '../../../components/ui/status-tag';
import { Table, Td, Th, Tr } from '../../../components/ui/table';
import { refusal } from '../account-security/credential-dialogs';

export interface AgencyMember {
  membershipId: string;
  userId: string;
  displayName: string | null;
  email: string;
  membershipStatus: string;
  globalStatus: string;
  /** Never says which other Agency placed a lock, or why. */
  lock: { byThisAgency: boolean; unlockable: boolean } | null;
  hasAuthenticator: boolean;
}

/** A member-list page; `nextCursor` is set while more members follow (#468). */
export interface AgencyMemberPage {
  members: AgencyMember[];
  nextCursor: string | null;
}

type LockAction = { kind: 'lock' | 'unlock'; member: AgencyMember };

const membershipStatus: Record<string, StatusDisplay> = {
  ACTIVE: { label: 'Active', tone: 'success' },
  INVITED: { label: 'Invited', tone: 'warning' },
  SUSPENDED: { label: 'Suspended', tone: 'danger' },
  DEACTIVATED: { label: 'Deactivated', tone: 'neutral' },
};

const verificationMethods = [
  { value: 'IN_PERSON_GOVERNMENT_ID', label: 'In person, with a government ID' },
  { value: 'VIDEO_CALL_GOVERNMENT_ID', label: 'Video call, with a government ID' },
] as const;

function eventValue(event: { currentTarget: EventTarget }): string {
  return (event.currentTarget as unknown as { value: string }).value;
}

/**
 * The Agency's members with their membership status, Global User Lock, and whether each has an
 * authenticator. Holders of `security.mfa.reset_factor` may reset another active member's factor;
 * holders of `security.users.lock` and `security.users.unlock` may lock and unlock Users. Later
 * pages append to the loaded rows, so an action updates its row wherever it was loaded.
 */
export function MemberList({
  agencyId,
  currentUserId,
  canResetFactor,
  canLock,
  canUnlock,
  initial,
}: {
  agencyId: string;
  currentUserId: string;
  canResetFactor: boolean;
  canLock: boolean;
  canUnlock: boolean;
  initial: AgencyMemberPage;
}) {
  const [members, setMembers] = useState(initial.members);
  const [nextCursor, setNextCursor] = useState(initial.nextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState('');
  // State lags a fast double click by a render; the ref stops the second request.
  const loadingRef = useRef(false);
  const [resetting, setResetting] = useState<AgencyMember | null>(null);
  const [locking, setLocking] = useState<LockAction | null>(null);
  const hasActions = canResetFactor || canLock || canUnlock;
  const [done, setDone] = useState('');
  const { guarded, prompt } = useReauthentication();

  async function loadMore(): Promise<void> {
    if (!nextCursor || loadingRef.current) return;
    loadingRef.current = true;
    setLoadingMore(true);
    setListError('');
    try {
      const response = await fetch(
        `/api/v1/agencies/${agencyId}/members?cursor=${encodeURIComponent(nextCursor)}`,
        { credentials: 'include' },
      );
      if (!response.ok) {
        setListError(
          (await refusal(response)).message ?? 'More members could not be loaded. Try again.',
        );
        return;
      }
      const page = (await response.json()) as AgencyMemberPage;
      setMembers((current) => [
        ...current,
        ...page.members.filter(
          (member) => !current.some((item) => item.membershipId === member.membershipId),
        ),
      ]);
      setNextCursor(page.nextCursor);
    } catch {
      setListError('More members could not be loaded. Check the connection and try again.');
    } finally {
      loadingRef.current = false;
      setLoadingMore(false);
    }
  }

  return (
    <>
      {done ? (
        <p
          className="m-0 rounded-control border border-success/40 bg-success/5 px-3 py-2.5 text-small text-ink"
          role="status"
        >
          {done}
        </p>
      ) : null}
      <Panel
        title="Members"
        flush
        actions={
          <span className="text-caption text-ink-muted tabular-nums">
            {nextCursor ? `${members.length}+` : members.length}
          </span>
        }
      >
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Membership</Th>
              <Th>Account</Th>
              <Th>Authenticator</Th>
              {hasActions ? <Th>Action</Th> : null}
            </tr>
          </thead>
          <tbody>
            {members.map((member) => {
              const status = membershipStatus[member.membershipStatus] ?? {
                label: member.membershipStatus,
                tone: 'neutral' as const,
              };
              const actsOnOther =
                member.membershipStatus === 'ACTIVE' && member.userId !== currentUserId;
              const resettable = canResetFactor && actsOnOther && member.hasAuthenticator;
              const lockable = canLock && actsOnOther && member.globalStatus === 'ACTIVE';
              const unlockable = canUnlock && member.lock?.unlockable === true;
              return (
                <Tr key={member.membershipId}>
                  <Td>
                    <span className="block font-[600] text-ink">
                      {member.displayName ?? member.email}
                    </span>
                    <span className="block text-caption text-ink-muted">{member.email}</span>
                  </Td>
                  <Td>
                    <StatusTag tone={status.tone}>{status.label}</StatusTag>
                  </Td>
                  <Td>
                    {member.globalStatus === 'LOCKED' ? (
                      <>
                        <StatusTag tone="danger">Locked</StatusTag>
                        {member.lock?.byThisAgency === false ? (
                          <span className="mt-1 block text-caption text-ink-muted">
                            By another Agency’s Security Administrator
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <StatusTag tone="success">Active</StatusTag>
                    )}
                  </Td>
                  <Td>{member.hasAuthenticator ? 'Set up' : 'Not set up'}</Td>
                  {hasActions ? (
                    <Td>
                      <div className="flex flex-wrap gap-2">
                        {resettable ? (
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => {
                              setDone('');
                              setResetting(member);
                            }}
                          >
                            Reset authenticator
                          </Button>
                        ) : null}
                        {lockable || unlockable ? (
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => {
                              setDone('');
                              setLocking({ kind: lockable ? 'lock' : 'unlock', member });
                            }}
                          >
                            {lockable ? 'Lock account' : 'Unlock account'}
                          </Button>
                        ) : null}
                      </div>
                    </Td>
                  ) : null}
                </Tr>
              );
            })}
          </tbody>
        </Table>
        {listError || nextCursor ? (
          <div className="grid justify-items-start gap-3 border-t border-border p-4">
            <FormError message={listError} className="self-stretch" />
            {nextCursor ? (
              <Button
                disabled={loadingMore}
                onClick={() => void loadMore()}
                type="button"
                variant="secondary"
              >
                {loadingMore ? 'Loading…' : 'Load more members'}
              </Button>
            ) : null}
          </div>
        ) : null}
      </Panel>
      {resetting ? (
        <FactorResetDialog
          agencyId={agencyId}
          member={resetting}
          guarded={guarded}
          onClose={() => setResetting(null)}
          onReset={() => {
            setMembers((current) =>
              current.map((member) =>
                member.userId === resetting.userId
                  ? { ...member, hasAuthenticator: false }
                  : member,
              ),
            );
            setDone(
              `${resetting.displayName ?? resetting.email}’s authenticator was reset. They’ll set it up again the next time they sign in.`,
            );
            setResetting(null);
          }}
        />
      ) : null}
      {locking ? (
        <LockDialog
          agencyId={agencyId}
          action={locking}
          guarded={guarded}
          onClose={() => setLocking(null)}
          onDone={() => {
            const { kind, member: target } = locking;
            setMembers((current) =>
              current.map((member) =>
                member.userId !== target.userId
                  ? member
                  : kind === 'lock'
                    ? {
                        ...member,
                        globalStatus: 'LOCKED',
                        lock: { byThisAgency: true, unlockable: true },
                      }
                    : { ...member, globalStatus: 'ACTIVE', lock: null },
              ),
            );
            const name = target.displayName ?? target.email;
            setDone(
              kind === 'lock'
                ? `${name}’s account is locked in every Agency and they were signed out everywhere.`
                : `${name}’s account is unlocked. They can sign in again.`,
            );
            setLocking(null);
          }}
        />
      ) : null}
      {prompt}
    </>
  );
}

/** Records why the administrator locks or unlocks the User, then does it. */
function LockDialog({
  agencyId,
  action: { kind, member },
  guarded,
  onClose,
  onDone,
}: {
  agencyId: string;
  action: LockAction;
  guarded: (request: () => Promise<Response>) => Promise<Response>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const name = member.displayName ?? member.email;
  const title = kind === 'lock' ? 'Lock account' : 'Unlock account';
  const failure = `The account could not be ${kind === 'lock' ? 'locked' : 'unlocked'}.`;

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError('');
    if (!reason.trim()) {
      setError('Add the reason.');
      return;
    }
    setBusy(true);
    try {
      const response = await guarded(() =>
        fetch(`/api/v1/agencies/${agencyId}/members/${member.membershipId}/${kind}`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reason }),
        }),
      );
      if (response.ok) {
        onDone();
        return;
      }
      setError((await refusal(response)).message ?? `${failure} Try again.`);
    } catch {
      setError(`${failure} Check the connection and try again.`);
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
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {kind === 'lock'
                ? `${name} can’t sign in to any Agency until a Security Administrator unlocks them, and is signed out everywhere. A password reset doesn’t unlock them.`
                : `${name} can sign in again with their current password and authenticator.`}
            </DialogDescription>
          </div>
        </DialogHeader>
        <DialogBody>
          <form className="grid gap-4" id="user-lock-form" onSubmit={submit} noValidate>
            <FormError message={error} />
            <Field label="Reason">
              <textarea
                className={inputClass}
                required
                maxLength={1000}
                value={reason}
                onChange={(event) => setReason(eventValue(event))}
              />
            </Field>
            <p className="m-0 text-caption text-ink-muted">
              {kind === 'lock'
                ? 'Say what you suspect. Only your Agency sees the reason.'
                : 'Say what the review found. Only your Agency sees the reason.'}
            </p>
          </form>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" type="button" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="user-lock-form" disabled={busy}>
            {busy ? (kind === 'lock' ? 'Locking…' : 'Unlocking…') : title}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Records how the administrator verified the User, then resets the factor. */
function FactorResetDialog({
  agencyId,
  member,
  guarded,
  onClose,
  onReset,
}: {
  agencyId: string;
  member: AgencyMember;
  guarded: (request: () => Promise<Response>) => Promise<Response>;
  onClose: () => void;
  onReset: () => void;
}) {
  const [method, setMethod] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError('');
    if (!method || !note.trim()) {
      setError('Choose how you verified the User and add a note.');
      return;
    }
    setBusy(true);
    try {
      const response = await guarded(() =>
        fetch(`/api/v1/agencies/${agencyId}/members/${member.membershipId}/factor-reset`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ method, note }),
        }),
      );
      if (response.ok) {
        onReset();
        return;
      }
      setError(
        (await refusal(response)).message ?? 'The authenticator could not be reset. Try again.',
      );
    } catch {
      setError('The authenticator could not be reset. Check the connection and try again.');
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
            <DialogTitle>Reset authenticator</DialogTitle>
            <DialogDescription>
              {member.displayName ?? member.email} loses their authenticator and every Recovery
              Code, and is signed out everywhere. Their password stays the same.
            </DialogDescription>
          </div>
        </DialogHeader>
        <DialogBody>
          <form className="grid gap-4" id="factor-reset-form" onSubmit={submit} noValidate>
            <FormError message={error} />
            <fieldset className="m-0 grid gap-1 border-0 p-0">
              <legend className={labelClass}>How you verified their identity</legend>
              {verificationMethods.map((option) => (
                <label
                  key={option.value}
                  className="flex min-h-9 items-center gap-3 rounded-control border border-border bg-canvas px-2.5 py-2 text-small text-ink"
                >
                  <input
                    type="radio"
                    name="method"
                    value={option.value}
                    checked={method === option.value}
                    onChange={() => setMethod(option.value)}
                  />
                  {option.label}
                </label>
              ))}
            </fieldset>
            <Field label="Note">
              <textarea
                className={inputClass}
                required
                maxLength={1000}
                value={note}
                onChange={(event) => setNote(eventValue(event))}
              />
            </Field>
            <p className="m-0 text-caption text-ink-muted">
              Don’t record ID numbers. The note says how you verified them, not what the ID says.
            </p>
          </form>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" type="button" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="factor-reset-form" disabled={busy}>
            {busy ? 'Resetting…' : 'Reset authenticator'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
