'use client';

import { useState } from 'react';
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
  hasAuthenticator: boolean;
}

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
 * authenticator. Holders of `security.mfa.reset_factor` may reset another active member's factor.
 */
export function MemberList({
  agencyId,
  currentUserId,
  canResetFactor,
  initial,
}: {
  agencyId: string;
  currentUserId: string;
  canResetFactor: boolean;
  initial: AgencyMember[];
}) {
  const [members, setMembers] = useState(initial);
  const [resetting, setResetting] = useState<AgencyMember | null>(null);
  const [done, setDone] = useState('');
  const { guarded, prompt } = useReauthentication();

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
        actions={<span className="text-caption text-ink-muted tabular-nums">{members.length}</span>}
      >
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Membership</Th>
              <Th>Account</Th>
              <Th>Authenticator</Th>
              {canResetFactor ? <Th>Action</Th> : null}
            </tr>
          </thead>
          <tbody>
            {members.map((member) => {
              const status = membershipStatus[member.membershipStatus] ?? {
                label: member.membershipStatus,
                tone: 'neutral' as const,
              };
              const resettable =
                member.membershipStatus === 'ACTIVE' &&
                member.hasAuthenticator &&
                member.userId !== currentUserId;
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
                      <StatusTag tone="danger">Locked</StatusTag>
                    ) : (
                      <StatusTag tone="success">Active</StatusTag>
                    )}
                  </Td>
                  <Td>{member.hasAuthenticator ? 'Set up' : 'Not set up'}</Td>
                  {canResetFactor ? (
                    <Td>
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
                    </Td>
                  ) : null}
                </Tr>
              );
            })}
          </tbody>
        </Table>
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
      {prompt}
    </>
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
