'use client';

// PROTOTYPE (#398). Signed-in screens: Reauthentication, account security, Security
// Administrator member list. Two layouts each. Throwaway; do not import.

import { useState, type ReactNode } from 'react';
import { ApplicationShell } from '../../components/application-shell';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Field, FormError, inputClass } from '../../components/ui/field';
import { PageHeader } from '../../components/ui/page-header';
import { Panel } from '../../components/ui/panel';
import { StatusTag, type StatusTone } from '../../components/ui/status-tag';
import { Table, Td, Th } from '../../components/ui/table';
import { cn } from '../../lib/class-names';
import type { ActiveSession } from '../../lib/session';
import {
  agency,
  manualSecret,
  members,
  recoveryCodes,
  type Member,
  type ScreenKey,
} from './fake-states';
import type { Go } from './public-flows';

export type ProtectedProps = {
  screen: ScreenKey;
  state: string;
  go: Go;
  busy: boolean;
  submit(next: () => void): void;
};

function session(admin: boolean): ActiveSession {
  return {
    userId: 'u',
    agencyId: 'a',
    membershipId: 'm',
    agency: { id: 'a', name: agency.name, acronym: agency.acronym },
    identity: admin
      ? { id: 'u1', displayName: 'Jose Rizal Dela Cruz', email: 'jose.delacruz@doh.gov.ph' }
      : { id: 'u2', displayName: 'Maria Clara Santos', email: 'maria.santos@doh.gov.ph' },
    effectiveRoles: [
      admin
        ? { code: 'security_administrator', name: 'Security Administrator' }
        : { code: 'hrmo_officer', name: 'HRMO Officer' },
    ],
    permissions: [],
  };
}

export function ProtectedFrame({ admin, children }: { admin: boolean; children: ReactNode }) {
  return (
    <ApplicationShell
      session={session(admin)}
      destinations={[
        { href: '/dashboard', label: 'Dashboard', stage: null },
        { href: '/users-access', label: 'Users & Access', stage: 'Oversight' },
        { href: '/audit', label: 'Audit Log', stage: 'Oversight' },
      ]}
      initialCollapsed={false}
    >
      {children}
    </ApplicationShell>
  );
}

/* ───────────── Shared pieces (fields only; layout stays per variant) ───────────── */

function ProofFields({ error }: { error?: string | undefined }) {
  const [recovery, setRecovery] = useState(false);
  return (
    <div className="grid gap-3">
      <Field label="Current password" error={error}>
        <input className={inputClass} type="password" autoComplete="current-password" />
      </Field>
      <Field label={recovery ? 'Recovery Code' : 'Authentication code'}>
        <input
          className={cn(inputClass, 'font-mono')}
          inputMode={recovery ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          placeholder={recovery ? 'xxxxx-xxxxx' : '123456'}
        />
      </Field>
      <Button type="button" className="justify-self-start" onClick={() => setRecovery(!recovery)}>
        {recovery ? 'Use your authenticator code' : 'Use a Recovery Code instead'}
      </Button>
    </div>
  );
}

function NewPasswordField({ error }: { error?: string | undefined }) {
  return (
    <div className="grid gap-1">
      <Field label="New password" error={error}>
        <input className={inputClass} type="password" autoComplete="new-password" />
      </Field>
      <span className="text-caption text-ink-muted">
        15 to 128 characters. Spaces are fine. Don’t use your name, email, or current password.
      </span>
    </div>
  );
}

function CodesGrid() {
  return (
    <ol className="m-0 grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-control border border-border bg-canvas p-4 font-mono text-body">
      {recoveryCodes.map((code) => (
        <li key={code} className="ml-5">
          {code}
        </li>
      ))}
    </ol>
  );
}

function ScanBlock() {
  return (
    <div className="flex flex-wrap items-start gap-4">
      <div
        aria-label="QR code (prototype placeholder)"
        role="img"
        className="grid size-32 place-items-center rounded-control border border-dashed border-border bg-canvas text-caption text-ink-muted"
      >
        QR
      </div>
      <div className="grid min-w-0 flex-1 gap-2 text-small">
        <span className="text-caption text-ink-muted">Setup key</span>
        <code className="break-all">{manualSecret}</code>
        <Field label="Code from the new app">
          <input className={cn(inputClass, 'font-mono')} inputMode="numeric" placeholder="123456" />
        </Field>
      </div>
    </div>
  );
}

function Notice({ tone, children }: { tone: 'success' | 'warning'; children: ReactNode }) {
  return (
    <p
      role="status"
      className={cn(
        'm-0 rounded-control border px-3 py-2.5 text-small',
        tone === 'success'
          ? 'border-success/40 bg-success/5 text-success'
          : 'border-warning/50 bg-warning/5 text-warning',
      )}
    >
      {children}
    </p>
  );
}

const reauthCopy = {
  title: 'Confirm it’s you',
  body: 'Generating new Recovery Codes needs a fresh check. You last confirmed 23 minutes ago; the limit is 5 minutes.',
};

function reauthError(state: string) {
  if (state === 'prompt-invalid') return 'Password or code is incorrect.';
  if (state === 'prompt-cooldown')
    return 'Too many attempts for this account. Try again in 9 minutes.';
  return '';
}

/* ───────────────────────── Account security ───────────────────────── */

/**
 * Which account-page action is open, derived from the screen and fake state, so both variants
 * read the same thing.
 */
function accountModel(screen: ScreenKey, state: string) {
  const reauth = screen === 'reauth';
  const codesLeft = state === 'low-codes' ? 2 : reauth && state === 'continued' ? 10 : 7;
  return {
    codesLeft,
    changing: state.startsWith('change-password') && state !== 'change-password-done',
    changeError:
      state === 'change-password-rule'
        ? {
            field: 'new' as const,
            message: 'Choose a password that’s different from your current one.',
          }
        : state === 'change-password-invalid'
          ? { field: 'proof' as const, message: 'Current password or code is incorrect.' }
          : null,
    changed: state === 'change-password-done',
    replacing: state === 'replace-factor',
    replaced: state === 'replace-done',
    prompting: reauth && state.startsWith('prompt'),
    regenerated: reauth && state === 'continued',
    reauthError: reauth ? reauthError(state) : '',
  };
}

export function AccountDialogs({ screen, state, go, busy, submit }: ProtectedProps) {
  const model = accountModel(screen, state);
  const close = () => go(screen === 'reauth' ? 'idle' : 'overview');
  return (
    <>
      <PageHeader breadcrumbs={[{ label: 'Account' }]} title="Account security" />
      <div className="mt-6 grid max-w-[760px] gap-4">
        {model.changed ? (
          <Notice tone="success">
            Password changed. We signed out your 2 other sessions and emailed you a notice.
          </Notice>
        ) : null}
        {model.replaced ? (
          <Notice tone="success">
            Authenticator replaced. The old one no longer works. We signed out your other sessions.
          </Notice>
        ) : null}
        {model.codesLeft <= 2 ? (
          <Notice tone="warning">
            Only {model.codesLeft} Recovery Codes left. Generate a new set before you run out.
          </Notice>
        ) : null}
        <Panel
          title="Password"
          actions={
            <Button variant="secondary" onClick={() => go('change-password', 'account')}>
              Change password
            </Button>
          }
        >
          <p className="m-0 text-small text-ink-muted">Last changed 3 March 2026.</p>
        </Panel>
        <Panel
          title="Authenticator app"
          actions={
            <Button variant="secondary" onClick={() => go('replace-factor', 'account')}>
              Replace authenticator
            </Button>
          }
        >
          <p className="m-0 text-small text-ink-muted">
            <StatusTag tone="success">Enrolled</StatusTag> Added 12 January 2026. Sign-in asks for a
            code every time.
          </p>
        </Panel>
        <Panel
          title="Recovery Codes"
          actions={
            <Button variant="secondary" onClick={() => go('prompt', 'reauth')}>
              Generate new codes
            </Button>
          }
        >
          <p className="m-0 text-small text-ink-muted">
            {model.codesLeft} of 10 left. Generating a new set voids the old one.
          </p>
        </Panel>
      </div>

      <Dialog open={model.changing} onOpenChange={(open) => !open && close()}>
        <DialogContent size="compact">
          <DialogHeader>
            <div className="grid gap-1">
              <DialogTitle>Change password</DialogTitle>
              <DialogDescription>
                Your other sessions will be signed out. This one stays signed in.
              </DialogDescription>
            </div>
          </DialogHeader>
          <DialogBody className="grid gap-4">
            <FormError
              message={model.changeError?.field === 'proof' ? model.changeError.message : ''}
            />
            <ProofFields />
            <NewPasswordField
              error={model.changeError?.field === 'new' ? model.changeError.message : undefined}
            />
          </DialogBody>
          <DialogFooter>
            <Button onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => submit(() => go('change-password-done', 'account'))}
            >
              {busy ? 'Changing…' : 'Change password'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={model.replacing} onOpenChange={(open) => !open && close()}>
        <DialogContent size="compact">
          <DialogHeader>
            <div className="grid gap-1">
              <DialogTitle>Replace authenticator</DialogTitle>
              <DialogDescription>
                Scan with the new app. The old app stops working once you confirm.
              </DialogDescription>
            </div>
          </DialogHeader>
          <DialogBody>
            <ScanBlock />
          </DialogBody>
          <DialogFooter>
            <Button onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => submit(() => go('replace-done', 'account'))}
            >
              {busy ? 'Confirming…' : 'Confirm and replace'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={model.prompting || model.regenerated} onOpenChange={(open) => !open && close()}>
        <DialogContent size="compact">
          <DialogHeader>
            <div className="grid gap-1">
              <DialogTitle>
                {model.regenerated ? 'Your new Recovery Codes' : reauthCopy.title}
              </DialogTitle>
              <DialogDescription>
                {model.regenerated
                  ? 'Your old codes no longer work. Save these now; you won’t see them again.'
                  : reauthCopy.body}
              </DialogDescription>
            </div>
          </DialogHeader>
          <DialogBody className="grid gap-4">
            {model.regenerated ? (
              <CodesGrid />
            ) : (
              <>
                <FormError message={model.reauthError} />
                <ProofFields />
              </>
            )}
          </DialogBody>
          <DialogFooter>
            {model.regenerated ? (
              <Button variant="primary" onClick={close}>
                I’ve saved them
              </Button>
            ) : (
              <>
                <Button onClick={close} disabled={busy}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  disabled={busy || state === 'prompt-cooldown'}
                  onClick={() => submit(() => go('continued', 'reauth'))}
                >
                  {busy ? 'Confirming…' : 'Confirm and generate codes'}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Row({
  title,
  summary,
  action,
  open,
  children,
}: {
  title: string;
  summary: ReactNode;
  action?: ReactNode;
  open: boolean;
  children?: ReactNode;
}) {
  return (
    <li className={cn('grid gap-4 px-5 py-4', open && 'bg-canvas/60')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-0.5">
          <strong className="text-small">{title}</strong>
          <span className="text-small text-ink-muted">{summary}</span>
        </div>
        {open ? null : action}
      </div>
      {open ? <div className="grid max-w-[460px] gap-4">{children}</div> : null}
    </li>
  );
}

export function AccountInline({ screen, state, go, busy, submit }: ProtectedProps) {
  const model = accountModel(screen, state);
  const close = () => go(screen === 'reauth' ? 'idle' : 'overview');
  return (
    <>
      <PageHeader breadcrumbs={[{ label: 'Account' }]} title="Account security" />
      <div className="mt-6 grid max-w-[760px] gap-4">
        <section className="rounded-panel border border-border bg-surface">
          <ul className="m-0 grid list-none divide-y divide-border p-0">
            <Row
              title="Password"
              summary={
                model.changed ? (
                  <span className="text-success">
                    Changed just now · 2 other sessions signed out
                  </span>
                ) : (
                  'Last changed 3 March 2026'
                )
              }
              action={
                <Button variant="secondary" onClick={() => go('change-password', 'account')}>
                  Change
                </Button>
              }
              open={model.changing}
            >
              <FormError
                message={model.changeError?.field === 'proof' ? model.changeError.message : ''}
              />
              <ProofFields />
              <NewPasswordField
                error={model.changeError?.field === 'new' ? model.changeError.message : undefined}
              />
              <p className="m-0 text-caption text-ink-muted">
                Your other sessions will be signed out. This one stays signed in.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={() => submit(() => go('change-password-done', 'account'))}
                >
                  {busy ? 'Changing…' : 'Change password'}
                </Button>
                <Button onClick={close} disabled={busy}>
                  Cancel
                </Button>
              </div>
            </Row>
            <Row
              title="Authenticator app"
              summary={
                model.replaced ? (
                  <span className="text-success">
                    Replaced just now · other sessions signed out
                  </span>
                ) : (
                  'Enrolled 12 January 2026'
                )
              }
              action={
                <Button variant="secondary" onClick={() => go('replace-factor', 'account')}>
                  Replace
                </Button>
              }
              open={model.replacing}
            >
              <ScanBlock />
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={() => submit(() => go('replace-done', 'account'))}
                >
                  {busy ? 'Confirming…' : 'Confirm and replace'}
                </Button>
                <Button onClick={close} disabled={busy}>
                  Cancel
                </Button>
              </div>
            </Row>
            <Row
              title="Recovery Codes"
              summary={
                model.regenerated ? (
                  <span className="text-success">New set of 10 · old set voided</span>
                ) : (
                  <span className={model.codesLeft <= 2 ? 'font-[650] text-warning' : ''}>
                    {model.codesLeft} of 10 left
                    {model.codesLeft <= 2 ? ' · generate a new set soon' : ''}
                  </span>
                )
              }
              action={
                <Button variant="secondary" onClick={() => go('prompt', 'reauth')}>
                  Generate new codes
                </Button>
              }
              open={model.prompting || model.regenerated}
            >
              {model.regenerated ? (
                <>
                  <CodesGrid />
                  <Button variant="primary" className="justify-self-start" onClick={close}>
                    I’ve saved them
                  </Button>
                </>
              ) : (
                <>
                  <div className="grid gap-1 border-l-4 border-l-primary pl-3">
                    <strong className="text-small">{reauthCopy.title}</strong>
                    <span className="text-small text-ink-muted">{reauthCopy.body}</span>
                  </div>
                  <FormError message={model.reauthError} />
                  <ProofFields />
                  <div className="flex gap-2">
                    <Button
                      variant="primary"
                      disabled={busy || state === 'prompt-cooldown'}
                      onClick={() => submit(() => go('continued', 'reauth'))}
                    >
                      {busy ? 'Confirming…' : 'Confirm and generate'}
                    </Button>
                    <Button onClick={close} disabled={busy}>
                      Cancel
                    </Button>
                  </div>
                </>
              )}
            </Row>
          </ul>
        </section>
      </div>
    </>
  );
}

/* ───────────────────────── Security Administrator ───────────────────────── */

const membershipTone: Record<Member['membership'], StatusTone> = {
  ACTIVE: 'success',
  INVITED: 'info',
  SUSPENDED: 'warning',
  DEACTIVATED: 'neutral',
};

function adminModel(state: string) {
  const rows = members.map((member) =>
    state === 'factor-reset-done' && member.id === 'u2'
      ? { ...member, factor: 'NONE' as const }
      : member,
  );
  const target =
    state === 'locked-here'
      ? 'u3'
      : state === 'locked-elsewhere'
        ? 'u4'
        : state === 'list'
          ? null
          : 'u2';
  return { rows, target };
}

function LockTag({ member }: { member: Member }) {
  if (member.lock === 'LOCKED_HERE') return <StatusTag tone="danger">Locked</StatusTag>;
  if (member.lock === 'LOCKED_ELSEWHERE')
    return <StatusTag tone="danger">Locked by another Agency</StatusTag>;
  return <span className="text-ink-muted">—</span>;
}

function FactorTag({ member }: { member: Member }) {
  if (member.factor === 'ENROLLED') return <StatusTag tone="success">Enrolled</StatusTag>;
  return member.mfaRequired ? (
    <StatusTag tone="warning">Not enrolled · required</StatusTag>
  ) : (
    <span className="text-ink-muted">Not required</span>
  );
}

function FactorResetFields() {
  return (
    <>
      <fieldset className="m-0 grid gap-2 border-0 p-0">
        <legend className="mb-1 text-caption font-[650] text-ink">
          How did you verify identity?
        </legend>
        {[
          ['IN_PERSON_GOVERNMENT_ID', 'In person, with a government ID'],
          ['VIDEO_CALL_GOVERNMENT_ID', 'Video call, with a government ID'],
        ].map(([value, label]) => (
          <label key={value} className="flex items-center gap-2 text-small">
            <input type="radio" name="method" value={value} className="accent-primary" />
            {label}
          </label>
        ))}
      </fieldset>
      <Field label="Note">
        <textarea
          className={cn(inputClass, 'min-h-20 py-2')}
          placeholder="Who you spoke to, when, and what you checked. Don’t enter ID numbers."
        />
      </Field>
      <ul className="m-0 grid gap-1 pl-5 text-small text-ink-muted">
        <li>Removes the authenticator and every Recovery Code.</li>
        <li>Signs the User out everywhere. Their password doesn’t change.</li>
        <li>They set up a new authenticator at their next sign-in, and get an email notice.</li>
      </ul>
    </>
  );
}

function LockFields() {
  return (
    <>
      <Field label="Reason">
        <textarea
          className={cn(inputClass, 'min-h-20 py-2')}
          placeholder="Why you suspect this account is compromised"
        />
      </Field>
      <ul className="m-0 grid gap-1 pl-5 text-small text-ink-muted">
        <li>Blocks sign-in in every Agency, not just {agency.acronym}.</li>
        <li>Only a Security Administrator here can lift it.</li>
        <li>A password reset doesn’t lift it.</li>
      </ul>
    </>
  );
}

function rowActions(member: Member, go: Go) {
  if (member.self)
    return <span className="text-caption text-ink-muted">You can’t reset your own</span>;
  if (member.lock === 'LOCKED_ELSEWHERE')
    return <span className="text-caption text-ink-muted">Only the locking Agency can unlock</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {member.factor === 'ENROLLED' && member.membership === 'ACTIVE' ? (
        <Button variant="secondary" onClick={() => go('factor-reset')}>
          Reset authenticator
        </Button>
      ) : null}
      {member.lock === 'LOCKED_HERE' ? (
        <Button variant="secondary" onClick={() => go('locked-here')}>
          Unlock
        </Button>
      ) : member.membership === 'ACTIVE' ? (
        <Button onClick={() => go('lock')}>Lock</Button>
      ) : null}
    </div>
  );
}

export function AdminDialogs({ state, go, busy, submit }: ProtectedProps) {
  const { rows, target } = adminModel(state);
  const close = () => go('list');
  const name = rows.find(({ id }) => id === target)?.name ?? '';
  const dialog =
    state === 'factor-reset'
      ? {
          title: `Reset authenticator for ${name}`,
          description: 'Do this only after you’ve confirmed who they are.',
          body: <FactorResetFields />,
          confirm: 'Reset authenticator',
          next: 'factor-reset-done',
        }
      : state === 'lock'
        ? {
            title: `Lock ${name}`,
            description: 'Use this when you suspect the account is compromised.',
            body: <LockFields />,
            confirm: 'Lock account',
            next: 'locked-here',
          }
        : state === 'locked-here'
          ? {
              title: `Unlock ${name}`,
              description: `Locked by ${agency.acronym} on 28 September 2026 for “Suspicious sign-in from new location.”`,
              body: (
                <Field label="Review note">
                  <textarea className={cn(inputClass, 'min-h-20 py-2')} />
                </Field>
              ),
              confirm: 'Unlock account',
              next: 'list',
            }
          : null;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Oversight' }, { label: 'Users & Access' }]}
        title="Members and sign-in security"
      />
      <div className="mt-6 grid gap-4">
        {state === 'factor-reset-done' ? (
          <Notice tone="success">
            Authenticator reset for Maria Clara Santos. 2 sessions signed out. She’ll set up a new
            one at her next sign-in.
          </Notice>
        ) : null}
        <Panel title={`${rows.length} members`} flush>
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Roles</Th>
                <Th>Membership</Th>
                <Th>Authenticator</Th>
                <Th>Lock</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((member) => (
                <tr key={member.id} className={cn(member.id === target && 'bg-primary/5')}>
                  <Td>
                    <strong className="block font-[600]">
                      {member.name}
                      {member.self ? ' (you)' : ''}
                    </strong>
                    <span className="text-caption text-ink-muted">{member.email}</span>
                  </Td>
                  <Td>{member.roles}</Td>
                  <Td>
                    <StatusTag tone={membershipTone[member.membership]}>
                      {member.membership}
                    </StatusTag>
                  </Td>
                  <Td>
                    <FactorTag member={member} />
                  </Td>
                  <Td>
                    <LockTag member={member} />
                  </Td>
                  <Td>{rowActions(member, go)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      </div>
      <Dialog open={dialog !== null} onOpenChange={(open) => !open && close()}>
        {dialog ? (
          <DialogContent size="compact">
            <DialogHeader>
              <div className="grid gap-1">
                <DialogTitle>{dialog.title}</DialogTitle>
                <DialogDescription>{dialog.description}</DialogDescription>
              </div>
            </DialogHeader>
            <DialogBody className="grid gap-4">{dialog.body}</DialogBody>
            <DialogFooter>
              <Button onClick={close} disabled={busy}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => submit(() => go(dialog.next))}
              >
                {busy ? 'Saving…' : dialog.confirm}
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}

export function AdminInline({ state, go, busy, submit }: ProtectedProps) {
  const { rows, target } = adminModel(state);
  const selected = rows.find(({ id }) => id === target) ?? rows[1]!;
  const select = (member: Member) =>
    go(
      member.lock === 'LOCKED_HERE'
        ? 'locked-here'
        : member.lock === 'LOCKED_ELSEWHERE'
          ? 'locked-elsewhere'
          : 'list',
    );
  const form =
    state === 'factor-reset'
      ? {
          title: 'Reset authenticator',
          body: <FactorResetFields />,
          confirm: 'Reset authenticator',
          next: 'factor-reset-done',
        }
      : state === 'lock'
        ? {
            title: 'Lock account',
            body: <LockFields />,
            confirm: 'Lock account',
            next: 'locked-here',
          }
        : null;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Oversight' }, { label: 'Users & Access' }]}
        title="Members and sign-in security"
      />
      <div className="mt-6 grid gap-4 min-[1100px]:grid-cols-[340px_minmax(0,1fr)]">
        <section className="rounded-panel border border-border bg-surface" aria-label="Members">
          <ul className="m-0 grid list-none divide-y divide-border-subtle p-0">
            {rows.map((member) => (
              <li key={member.id}>
                <button
                  type="button"
                  aria-current={member.id === selected.id ? 'true' : undefined}
                  onClick={() => select(member)}
                  className={cn(
                    'grid w-full cursor-pointer gap-1 px-4 py-3 text-left hover:bg-canvas',
                    member.id === selected.id &&
                      'bg-primary/5 shadow-[inset_3px_0_0_var(--color-primary)]',
                  )}
                >
                  <span className="text-small font-[600]">
                    {member.name}
                    {member.self ? ' (you)' : ''}
                  </span>
                  <span className="flex flex-wrap gap-1.5 text-caption">
                    <StatusTag tone={membershipTone[member.membership]}>
                      {member.membership}
                    </StatusTag>
                    {member.lock !== 'NONE' ? <StatusTag tone="danger">Locked</StatusTag> : null}
                    {member.factor === 'NONE' && member.mfaRequired ? (
                      <StatusTag tone="warning">No authenticator</StatusTag>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="grid content-start gap-4 rounded-panel border border-border bg-surface p-5">
          <div className="grid gap-0.5">
            <h2 className="m-0 text-panel-title">{selected.name}</h2>
            <span className="text-small text-ink-muted">
              {selected.email} · {selected.roles}
            </span>
          </div>
          {state === 'factor-reset-done' ? (
            <Notice tone="success">
              Authenticator reset. 2 sessions signed out. She’ll set up a new one at her next
              sign-in.
            </Notice>
          ) : null}
          <dl className="m-0 grid grid-cols-[160px_minmax(0,1fr)] gap-x-4 gap-y-3 text-small">
            <dt className="text-ink-muted">Membership</dt>
            <dd className="m-0">
              <StatusTag tone={membershipTone[selected.membership]}>
                {selected.membership}
              </StatusTag>
            </dd>
            <dt className="text-ink-muted">Authenticator</dt>
            <dd className="m-0 flex flex-wrap items-center gap-2">
              <FactorTag member={selected} />
              {!form &&
              !selected.self &&
              selected.factor === 'ENROLLED' &&
              selected.lock !== 'LOCKED_ELSEWHERE' ? (
                <Button variant="secondary" onClick={() => go('factor-reset')}>
                  Reset
                </Button>
              ) : null}
              {selected.self ? (
                <span className="text-caption text-ink-muted">You can’t reset your own.</span>
              ) : null}
            </dd>
            <dt className="text-ink-muted">Global User Lock</dt>
            <dd className="m-0 grid gap-2">
              <span className="flex flex-wrap items-center gap-2">
                <LockTag member={selected} />
                {!form &&
                selected.lock === 'NONE' &&
                !selected.self &&
                selected.membership === 'ACTIVE' ? (
                  <Button onClick={() => go('lock')}>Lock</Button>
                ) : null}
              </span>
              {selected.lock === 'LOCKED_HERE' ? (
                <div className="grid gap-2 rounded-control border border-border bg-canvas p-3">
                  <span>
                    Locked by {agency.acronym} on 28 September 2026: “Suspicious sign-in from new
                    location.”
                  </span>
                  <Field label="Review note">
                    <textarea className={cn(inputClass, 'min-h-16 py-2')} />
                  </Field>
                  <Button
                    variant="primary"
                    className="justify-self-start"
                    disabled={busy}
                    onClick={() => submit(() => go('list'))}
                  >
                    {busy ? 'Unlocking…' : 'Unlock account'}
                  </Button>
                </div>
              ) : null}
              {selected.lock === 'LOCKED_ELSEWHERE' ? (
                <span className="text-ink-muted">
                  Locked by another Agency’s Security Administrator. Only they can unlock it.
                </span>
              ) : null}
            </dd>
          </dl>
          {form ? (
            <div className="grid max-w-[520px] gap-4 border-t border-border pt-4">
              <h3 className="m-0 text-panel-title">{form.title}</h3>
              {form.body}
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={() => submit(() => go(form.next))}
                >
                  {busy ? 'Saving…' : form.confirm}
                </Button>
                <Button onClick={() => go('list')} disabled={busy}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </>
  );
}
