'use client';

// PROTOTYPE (#399). The Agency Administrator's screen for the Agency seal and building photo.
// Two layouts: A keeps a live preview beside the form; B uses panels, a preview dialog, and a
// change history. Throwaway; do not import.

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
import { FormError } from '../../components/ui/field';
import { PageHeader } from '../../components/ui/page-header';
import { Panel } from '../../components/ui/panel';
import { StatusTag } from '../../components/ui/status-tag';
import { Table, Td, Th } from '../../components/ui/table';
import { cn } from '../../lib/class-names';
import type { ActiveSession } from '../../lib/session';
import { agency } from '../sign-in-prototype/fake-states';
import { inviteView } from '../sign-in-prototype/public-flows';
import {
  PHOTO_SRC,
  SEAL_SRC,
  admin,
  history,
  limits,
  sealFiles,
  type FakeFile,
} from './fake-states';
import { BrandedSunrise } from './public-screens';

export type SettingsProps = {
  state: string;
  go(state: string): void;
  busy: boolean;
  submit(next: () => void): void;
};

const session: ActiveSession = {
  userId: 'u',
  agencyId: 'a',
  membershipId: 'm',
  agency: { id: 'a', name: agency.name, acronym: agency.acronym },
  identity: { id: 'u1', displayName: admin.name, email: admin.email },
  effectiveRoles: [{ code: 'agency_administrator', name: admin.role }],
  permissions: [],
};

export function SettingsFrame({ children }: { children: ReactNode }) {
  return (
    <ApplicationShell
      session={session}
      destinations={[
        { href: '/dashboard', label: 'Dashboard', stage: null },
        { href: '/agency-profile', label: 'Agency profile', stage: 'Structure' },
        { href: '/users-access', label: 'Users & Access', stage: 'Oversight' },
        { href: '/audit', label: 'Audit Log', stage: 'Oversight' },
      ]}
      initialCollapsed={false}
    >
      {children}
    </ApplicationShell>
  );
}

/* ───────────── What each fake state means ───────────── */

function modelOf(state: string) {
  const rejected = {
    'wrong-type': `seal-chd-ncr.pdf is a PDF. Upload the seal as a ${limits.sealTypes} image.`,
    'too-large': `seal-scan.png is 8.4 MB. Upload a file of ${limits.sealMaxMb} MB or less.`,
    'too-small': `seal-from-website.png is 180 × 180 px. Upload at least ${limits.sealMinPx} × ${limits.sealMinPx} px so the seal stays sharp in print.`,
  }[state];
  const seal = state === 'empty' || state === 'staged' ? null : 'seal-chd-ncr.png';
  return {
    seal,
    staged: state === 'staged',
    rejected,
    photo: seal ? 'chd-ncr-building.jpg' : null,
    photoOn: state !== 'photo-off',
    removing: state === 'remove',
  };
}

const sealHint = `${limits.sealTypes}, square, at least ${limits.sealMinPx} × ${limits.sealMinPx} px, up to ${limits.sealMaxMb} MB.`;
const photoHint = `${limits.photoTypes}, landscape, at least ${limits.photoMinPx} px wide, up to ${limits.photoMaxMb} MB.`;

/* ───────────── Shared pieces ───────────── */

/** Stands in for the browser's file dialog: pick one of the fake files to drive the state. */
function FilePicker({
  label,
  files,
  go,
  variant = 'secondary',
}: {
  label: string;
  files: FakeFile[];
  go(state: string): void;
  variant?: 'primary' | 'secondary' | 'quiet';
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button type="button" variant={variant} onClick={() => setOpen(!open)}>
        {label}
      </Button>
      {open ? (
        <ul className="absolute top-full left-0 z-20 m-0 mt-1 grid w-80 list-none gap-0 rounded-control border border-border bg-surface p-1 shadow-lg">
          <li className="px-2 py-1 text-caption text-fuchsia-700">Pretend file picker</li>
          {files.map((file) => (
            <li key={file.name}>
              <button
                type="button"
                className="grid w-full cursor-pointer gap-0.5 rounded-control px-2 py-1.5 text-left hover:bg-canvas"
                onClick={() => {
                  setOpen(false);
                  go(file.result);
                }}
              >
                <span className="text-small font-[600] text-ink">{file.name}</span>
                <span className="text-caption text-ink-muted">{file.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const photoFiles: FakeFile[] = [
  { name: 'chd-ncr-building.jpg', detail: '512 KB · 1280 × 960 px', result: 'saved' },
];

function AuditLine({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 text-caption text-ink-muted">
      {children} ·{' '}
      <a className="text-primary underline underline-offset-4" href="#audit">
        View in Audit Log
      </a>
    </p>
  );
}

function SealImage({ size, faded }: { size: number; faded?: boolean }) {
  return (
    <img
      src={SEAL_SRC}
      alt="Agency seal"
      width={size}
      height={size}
      className={cn('shrink-0 rounded-full', faded && 'opacity-40')}
    />
  );
}

function PhotoImage({ className, off }: { className?: string; off?: boolean }) {
  return (
    <img
      src={PHOTO_SRC}
      alt="Agency building"
      className={cn('rounded-control object-cover', off && 'opacity-40 grayscale', className)}
    />
  );
}

function Dropzone({ children }: { children: ReactNode }) {
  return (
    <div className="grid justify-items-start gap-3 rounded-control border-2 border-dashed border-border bg-canvas p-5">
      {children}
    </div>
  );
}

/**
 * The Invitation as a User sees it, scaled down from a 1440 × 900 desktop. `inert` keeps the
 * fake form out of the tab order.
 */
function ScaledPreview({
  seal,
  photo,
  stamped,
  scale,
}: {
  seal: boolean;
  photo: boolean;
  stamped: boolean;
  scale: number;
}) {
  const props = {
    view: inviteView(stamped ? 'done' : 'first-time', () => undefined),
    busy: false,
    submit: () => undefined,
    stateKey: `preview:${seal}:${photo}:${stamped}`,
  };
  return (
    <div
      className="overflow-hidden rounded-control border border-border"
      style={{ width: 1440 * scale, height: 900 * scale }}
    >
      <div
        inert
        style={{ width: 1440, height: 900, transform: `scale(${scale})`, transformOrigin: '0 0' }}
      >
        <BrandedSunrise
          props={props}
          seal={seal ? { src: SEAL_SRC } : {}}
          scene={photo ? 'photo-replaces' : 'drawn'}
        />
      </div>
    </div>
  );
}

function PreviewTabs({
  stamped,
  onChange,
}: {
  stamped: boolean;
  onChange(stamped: boolean): void;
}) {
  return (
    <div role="tablist" className="flex gap-1 rounded-control bg-canvas p-1">
      {[
        { label: 'Set password', value: false },
        { label: 'Signed in', value: true },
      ].map((tab) => (
        <button
          key={tab.label}
          type="button"
          role="tab"
          aria-selected={stamped === tab.value}
          className={cn(
            'cursor-pointer rounded-control px-3 py-1 text-caption font-[600]',
            stamped === tab.value ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted',
          )}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function Header({ actions }: { actions?: ReactNode }) {
  return (
    <PageHeader
      breadcrumbs={[{ label: 'Agency profile' }, { label: agency.acronym }]}
      title="Seal and building photo"
      {...(actions ? { actions } : {})}
    />
  );
}

/* ───────────── A: one page, live preview ───────────── */

export function SettingsOnePage({ state, go, busy, submit }: SettingsProps) {
  const model = modelOf(state);
  const [stamped, setStamped] = useState(false);
  const previewSeal = Boolean(model.seal) || model.staged;

  return (
    <>
      <Header />
      <div className="mt-6 grid items-start gap-6 min-[1280px]:grid-cols-[minmax(0,1fr)_620px]">
        <div className="grid gap-6">
          <Panel title="Agency seal">
            <div className="grid gap-4">
              <p className="m-0 max-w-[62ch] text-small text-ink-muted">
                Appears in the letterhead of Invitation Activation, the first screen a person you
                invite sees. Sign-in and Password Reset keep the LingkodHR letterhead.
              </p>
              {model.rejected ? (
                <FormError message={`${model.rejected} The current seal is unchanged.`} />
              ) : null}
              {model.staged ? (
                <div className="grid gap-3 rounded-control border border-warning/50 bg-warning/5 p-4">
                  <div className="flex items-center gap-4">
                    <SealImage size={96} />
                    <div className="grid gap-1">
                      <span className="flex items-center gap-2 text-small font-[600]">
                        seal-chd-ncr.png <StatusTag tone="warning">Not saved</StatusTag>
                      </span>
                      <span className="text-caption text-ink-muted">412 KB · 1200 × 1200 px</span>
                    </div>
                  </div>
                  <p className="m-0 text-small">
                    Check the preview. Once saved, every open Invitation link shows this seal.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="primary"
                      disabled={busy}
                      onClick={() => submit(() => go('saved'))}
                    >
                      {busy ? 'Saving…' : 'Save seal'}
                    </Button>
                    <Button disabled={busy} onClick={() => go('empty')}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : model.seal ? (
                <div className="flex flex-wrap items-center gap-4">
                  <SealImage size={96} />
                  <div className="grid gap-1">
                    <span className="text-small font-[600]">{model.seal}</span>
                    <span className="text-caption text-ink-muted">412 KB · 1200 × 1200 px</span>
                    <AuditLine>
                      Changed by {history[0]!.by}, {history[0]!.at}
                    </AuditLine>
                  </div>
                  <div className="ml-auto flex gap-2">
                    <FilePicker label="Replace" files={sealFiles} go={go} />
                    <Button onClick={() => go('remove')}>Remove</Button>
                  </div>
                </div>
              ) : (
                <Dropzone>
                  <p className="m-0 text-small">
                    No seal yet. Invitations show a gold ring with your acronym.
                  </p>
                  <FilePicker label="Upload seal" files={sealFiles} go={go} variant="primary" />
                  <span className="text-caption text-ink-muted">{sealHint}</span>
                </Dropzone>
              )}
            </div>
          </Panel>

          <Panel title="Building photo">
            <div className="grid gap-4">
              <p className="m-0 max-w-[62ch] text-small text-ink-muted">
                Replaces the drawn sunrise on Invitation Activation. Optional.
              </p>
              {model.photo ? (
                <div className="flex flex-wrap items-start gap-4">
                  <PhotoImage className="h-28 w-40" off={!model.photoOn} />
                  <div className="grid gap-2">
                    <span className="text-small font-[600]">{model.photo}</span>
                    <label className="flex items-center gap-2 text-small">
                      <input
                        type="checkbox"
                        checked={model.photoOn}
                        onChange={() => go(model.photoOn ? 'photo-off' : 'saved')}
                      />
                      Show on Invitation screens
                    </label>
                    <AuditLine>
                      Added by {history[1]!.by}, {history[1]!.at}
                    </AuditLine>
                  </div>
                  <div className="ml-auto flex gap-2">
                    <FilePicker label="Replace" files={photoFiles} go={go} />
                    <Button>Remove</Button>
                  </div>
                </div>
              ) : (
                <Dropzone>
                  <p className="m-0 text-small">No photo. Invitations show the drawn sunrise.</p>
                  <FilePicker label="Upload photo" files={photoFiles} go={go} />
                  <span className="text-caption text-ink-muted">{photoHint}</span>
                </Dropzone>
              )}
            </div>
          </Panel>
        </div>

        <Panel
          title={model.staged ? 'Preview · not saved' : 'What invited Users see'}
          className="min-[1280px]:sticky min-[1280px]:top-6"
          actions={<PreviewTabs stamped={stamped} onChange={setStamped} />}
        >
          <ScaledPreview
            seal={previewSeal}
            photo={Boolean(model.photo) && model.photoOn}
            stamped={stamped}
            scale={0.4}
          />
        </Panel>
      </div>

      <Dialog open={model.removing} onOpenChange={(open) => !open && go('saved')}>
        <DialogContent size="compact">
          <DialogHeader>
            <div className="grid gap-1">
              <DialogTitle>Remove the Agency seal?</DialogTitle>
              <DialogDescription>
                Open Invitation links show the gold ring with your acronym at once. The Audit Log
                keeps a record of the removed file.
              </DialogDescription>
            </div>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => go('saved')}>Keep seal</Button>
            <Button variant="primary" disabled={busy} onClick={() => submit(() => go('empty'))}>
              {busy ? 'Removing…' : 'Remove seal'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ───────────── B: panels, preview dialog, change history ───────────── */

export function SettingsPanels({ state, go, busy, submit }: SettingsProps) {
  const model = modelOf(state);
  const [previewing, setPreviewing] = useState(false);
  const [stamped, setStamped] = useState(false);

  return (
    <>
      <Header
        actions={
          <Button variant="secondary" onClick={() => setPreviewing(true)}>
            Preview as an invited User
          </Button>
        }
      />
      <div className="mt-6 grid gap-6 min-[1100px]:grid-cols-2">
        <Panel
          title="Agency seal"
          actions={
            model.seal && !model.removing ? (
              <>
                <FilePicker label="Replace" files={sealFiles} go={go} variant="quiet" />
                <Button onClick={() => go('remove')}>Remove</Button>
              </>
            ) : null
          }
        >
          <div className="grid gap-4">
            {model.rejected ? <FormError message={model.rejected} /> : null}
            {model.staged ? (
              <div className="grid grid-cols-2 gap-4">
                <figure className="m-0 grid justify-items-center gap-2 rounded-control border border-border p-4 text-caption text-ink-muted">
                  <span className="grid size-[120px] place-items-center rounded-full border-2 border-dashed border-border">
                    none
                  </span>
                  <figcaption>Current</figcaption>
                </figure>
                <figure className="m-0 grid justify-items-center gap-2 rounded-control border border-warning p-4 text-caption text-ink-muted">
                  <SealImage size={120} />
                  <figcaption>
                    New: seal-chd-ncr.png <StatusTag tone="warning">Not saved</StatusTag>
                  </figcaption>
                </figure>
                <div className="col-span-2 flex gap-2">
                  <Button
                    variant="primary"
                    disabled={busy}
                    onClick={() => submit(() => go('saved'))}
                  >
                    {busy ? 'Saving…' : 'Use this seal'}
                  </Button>
                  <Button disabled={busy} onClick={() => go('empty')}>
                    Discard
                  </Button>
                </div>
              </div>
            ) : model.seal ? (
              <div className="grid justify-items-center gap-3 py-2">
                <SealImage size={160} faded={model.removing} />
                <span className="text-caption text-ink-muted">
                  {model.seal} · 412 KB · 1200 × 1200 px
                </span>
                {model.removing ? (
                  <div className="grid w-full gap-3 rounded-control border border-danger/40 bg-danger/5 p-4 text-small">
                    <p className="m-0">
                      Remove the seal? Open Invitation links show the gold ring with your acronym at
                      once. The change is recorded in the history below.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="primary"
                        disabled={busy}
                        onClick={() => submit(() => go('empty'))}
                      >
                        {busy ? 'Removing…' : 'Remove seal'}
                      </Button>
                      <Button onClick={() => go('saved')}>Keep seal</Button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <Dropzone>
                <p className="m-0 text-small">
                  No seal. Invitations show a gold ring with your acronym.
                </p>
                <FilePicker label="Upload seal" files={sealFiles} go={go} variant="primary" />
                <span className="text-caption text-ink-muted">{sealHint}</span>
              </Dropzone>
            )}
          </div>
        </Panel>

        <Panel
          title="Building photo"
          actions={
            model.photo ? (
              <>
                <FilePicker label="Replace" files={photoFiles} go={go} variant="quiet" />
                <Button>Remove</Button>
              </>
            ) : null
          }
        >
          {model.photo ? (
            <div className="grid gap-3">
              <PhotoImage className="aspect-[4/3] w-full" off={!model.photoOn} />
              <label className="flex items-center gap-2 text-small">
                <input
                  type="checkbox"
                  checked={model.photoOn}
                  onChange={() => go(model.photoOn ? 'photo-off' : 'saved')}
                />
                Show on Invitation screens instead of the drawn sunrise
              </label>
            </div>
          ) : (
            <Dropzone>
              <p className="m-0 text-small">No photo. Invitations show the drawn sunrise.</p>
              <FilePicker label="Upload photo" files={photoFiles} go={go} />
              <span className="text-caption text-ink-muted">{photoHint}</span>
            </Dropzone>
          )}
        </Panel>
      </div>

      <Panel title="Change history" flush className="mt-6">
        <Table>
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Change</Th>
              <Th>File</Th>
              <Th>By</Th>
            </tr>
          </thead>
          <tbody>
            {model.seal ? null : (
              <tr>
                <Td colSpan={4} className="text-ink-muted">
                  No changes yet.
                </Td>
              </tr>
            )}
            {(model.seal ? history : []).map((row) => (
              <tr key={row.at}>
                <Td>{row.at}</Td>
                <Td>{row.action}</Td>
                <Td className="font-mono text-caption">{row.file}</Td>
                <Td>{row.by}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>

      <Dialog open={previewing} onOpenChange={setPreviewing}>
        <DialogContent className="max-w-[min(1240px,calc(100vw-2rem))]">
          <DialogHeader>
            <div className="grid gap-1">
              <DialogTitle>Preview as an invited User</DialogTitle>
              <DialogDescription>
                Desktop, 1440 × 900. {model.staged ? 'Includes the unsaved seal.' : ''}
              </DialogDescription>
            </div>
          </DialogHeader>
          <DialogBody className="grid gap-3">
            <PreviewTabs stamped={stamped} onChange={setStamped} />
            <ScaledPreview
              seal={Boolean(model.seal) || model.staged}
              photo={Boolean(model.photo) && model.photoOn}
              stamped={stamped}
              scale={0.8}
            />
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
}
