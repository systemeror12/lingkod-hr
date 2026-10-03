'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  CivicSunriseLayout,
  InvitationStamp,
  AgencySealMark,
  type LetterheadAgency,
} from './civic-sunrise';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Field, FormError, inputClass } from './ui/field';
import { PageHeader } from './ui/page-header';
import { Panel } from './ui/panel';
import { SectionTabs, SectionTabList, SectionTabPanel } from './ui/section-tabs';
import { StatusTag } from './ui/status-tag';

// The web package intentionally uses the shared ES-only TypeScript library. Describe only the
// browser APIs this screen needs, as the existing workspaces do.
const browser = globalThis as unknown as {
  ResizeObserver: new (callback: (entries: { contentRect: { width: number } }[]) => void) => {
    observe(element: unknown): void;
    disconnect(): void;
  };
  Image: new () => {
    src: string;
    decode(): Promise<void>;
    naturalWidth: number;
    naturalHeight: number;
  };
  addEventListener(
    type: 'beforeunload',
    listener: (event: { preventDefault(): void }) => void,
  ): void;
  removeEventListener(
    type: 'beforeunload',
    listener: (event: { preventDefault(): void }) => void,
  ): void;
};

export interface SavedAgencySeal {
  id: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  width: number;
  height: number;
  contentHash: string;
  changedAt: string;
  changedByName: string;
  url: string;
}

interface StagedSeal {
  file: File;
  url: string;
  width: number;
  height: number;
}

/** Scales the actual Invitation shell to the panel's width, with no interactive form controls. */
function InvitationPreview({ agency, signedIn }: { agency: LetterheadAgency; signedIn: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!host.current) return;
    const observer = new browser.ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={host}
      className="overflow-hidden rounded-control border border-border"
      style={{ height: (width * 900) / 1440 }}
    >
      <div
        inert
        style={{
          width: 1440,
          height: 900,
          transform: `scale(${width / 1440})`,
          transformOrigin: '0 0',
        }}
      >
        <CivicSunriseLayout
          progress={signedIn ? 1 : 0}
          agency={agency}
          labelledBy="preview-invitation-title"
        >
          <div className="grid gap-5">
            {signedIn ? (
              <>
                <InvitationStamp agency={agency} />
                <h1 id="preview-invitation-title" className="m-0 text-[1.625rem] font-[650]">
                  You now have access to {agency.acronym ?? agency.name}
                </h1>
                <p className="m-0 text-body text-ink-muted">You’re signed in to {agency.name}.</p>
                <Button variant="primary">Open workspace</Button>
              </>
            ) : (
              <>
                <p className="m-0 text-caption text-ink-muted">
                  Invitation from {agency.acronym ?? agency.name}
                </p>
                <h1 id="preview-invitation-title" className="m-0 text-[1.625rem] font-[650]">
                  Activate your LingkodHR access
                </h1>
                <p className="m-0 text-body text-ink-muted">
                  Set your name and password to accept the invitation.
                </p>
                <Field label="Full name" htmlFor="preview-name">
                  <input id="preview-name" className={inputClass} readOnly value="Invited User" />
                </Field>
                <Field label="New password" htmlFor="preview-password">
                  <input
                    id="preview-password"
                    className={inputClass}
                    readOnly
                    type="password"
                    value="preview password"
                  />
                </Field>
                <Button variant="primary">Continue</Button>
              </>
            )}
          </div>
        </CivicSunriseLayout>
      </div>
    </div>
  );
}

export function AgencySealWorkspace({
  agencyId,
  agency,
  initial,
  canUpdate,
}: {
  agencyId: string;
  agency: LetterheadAgency;
  initial: SavedAgencySeal | null;
  canUpdate: boolean;
}) {
  const [seal, setSeal] = useState(initial);
  const [staged, setStaged] = useState<StagedSeal | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [preview, setPreview] = useState('password');
  const picker = useRef<{ click(): void }>(null);
  const pickSequence = useRef(0);
  const endpoint = `/api/v1/agencies/${agencyId}/agency-profile/seal`;
  const previewAgency = { ...agency, sealUrl: staged?.url ?? seal?.url ?? null };

  useEffect(
    () => () => {
      if (staged) URL.revokeObjectURL(staged.url);
    },
    [staged],
  );
  useEffect(() => {
    if (!staged) return;
    const warn = (event: { preventDefault(): void }) => event.preventDefault();
    browser.addEventListener('beforeunload', warn);
    return () => browser.removeEventListener('beforeunload', warn);
  }, [staged]);

  async function pick(file: File | undefined) {
    if (!file) return;
    const sequence = ++pickSequence.current;
    setPicking(true);
    setError('');
    setNotice('');
    const rejected = (message: string) => `${file.name}: ${message} The current seal is unchanged.`;
    let url: string | undefined;
    try {
      if (!['image/png', 'image/jpeg'].includes(file.type))
        throw new Error(rejected('Use a PNG or JPEG image.'));
      if (file.size > 2 * 1024 * 1024) throw new Error(rejected('Use a file no larger than 2 MB.'));
      url = URL.createObjectURL(file);
      const image = new browser.Image();
      image.src = url;
      await image.decode().catch(() => {
        throw new Error(rejected('Use a readable PNG or JPEG image.'));
      });
      if (image.naturalWidth < 600 || image.naturalHeight < 600) {
        throw new Error(
          rejected(
            `The image is ${image.naturalWidth} × ${image.naturalHeight} px. Use at least 600 × 600 px to print.`,
          ),
        );
      }
      if (sequence !== pickSequence.current) {
        URL.revokeObjectURL(url);
        return;
      }
      setStaged({ file, url, width: image.naturalWidth, height: image.naturalHeight });
    } catch (failure) {
      if (url) URL.revokeObjectURL(url);
      if (sequence === pickSequence.current)
        setError(
          failure instanceof Error ? failure.message : rejected('The image could not be read.'),
        );
    } finally {
      if (sequence === pickSequence.current) setPicking(false);
    }
  }

  async function mutate(remove = false) {
    if (busy || (!remove && !staged)) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const form = new FormData();
      form.append('expectedSealId', seal?.id ?? '');
      if (staged) form.append('file', staged.file);
      const response = await fetch(endpoint, {
        method: remove ? 'DELETE' : 'PUT',
        credentials: 'include',
        ...(remove
          ? {
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ expectedSealId: seal?.id ?? '' }),
            }
          : { body: form }),
      });
      const result = (await response.json()) as {
        seal?: SavedAgencySeal | null;
        error?: { message?: string };
      };
      if (!response.ok)
        throw new Error(result.error?.message ?? 'The seal could not be saved. Try again.');
      setSeal(result.seal ?? null);
      setStaged(null);
      setRemoving(false);
      setNotice(
        remove
          ? 'Agency seal removed.'
          : 'Agency seal saved. Open Invitation links now show this seal.',
      );
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'The seal could not be saved. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Seal and building photo"
        breadcrumbs={[
          { label: 'Organization', href: '/organization' },
          { label: 'Agency Profile', href: '/organization?workspace=agency' },
          { label: 'Seal and building photo' },
        ]}
      />
      <div className="mt-6 grid items-start gap-6 min-[1280px]:grid-cols-[minmax(0,1fr)_620px]">
        <div className="grid gap-6">
          <Panel title="Agency seal">
            <div className="grid gap-4">
              <p className="m-0 text-small text-ink-muted">
                Appears in the letterhead of Invitation Activation. Sign-in and Password Reset keep
                the LingkodHR letterhead.
              </p>
              <p className="m-0 text-caption text-ink-muted" id="seal-limits">
                PNG or JPEG, at least 600 × 600 px, up to 2 MB.
              </p>
              <FormError message={error} />
              {notice ? (
                <p role="status" className="m-0 text-small text-ink">
                  {notice}
                </p>
              ) : null}
              {seal ? (
                <div className="flex flex-wrap items-center gap-4">
                  <AgencySealMark agency={{ ...agency, sealUrl: seal.url }} className="size-24" />
                  <div className="grid min-w-0 gap-1">
                    <span className="break-all text-small font-semibold">{seal.fileName}</span>
                    <span className="text-caption text-ink-muted">
                      {Math.ceil(seal.byteSize / 1024)} KB · {seal.width} × {seal.height} px
                    </span>
                    <p className="m-0 text-caption text-ink-muted">
                      Changed by {seal.changedByName},{' '}
                      {new Intl.DateTimeFormat('en-PH', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                        timeZone: 'Asia/Manila',
                      }).format(new Date(seal.changedAt))}{' '}
                      ·{' '}
                      <Link className="text-primary underline underline-offset-4" href="/audit">
                        View in Audit Log
                      </Link>
                    </p>
                  </div>
                </div>
              ) : (
                <p className="m-0 rounded-control border-2 border-dashed border-border bg-canvas p-5 text-small">
                  No seal yet. Invitations show a gold ring with your acronym.
                </p>
              )}
              {canUpdate ? (
                <>
                  <input
                    ref={picker}
                    type="file"
                    accept="image/png,image/jpeg"
                    aria-label="Agency seal file"
                    aria-describedby="seal-limits"
                    className="sr-only"
                    disabled={busy || picking}
                    onChange={(event) => {
                      const input = event.currentTarget as unknown as {
                        files: File[];
                        value: string;
                      };
                      void pick(input.files?.[0]);
                      input.value = '';
                    }}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button disabled={busy || picking} onClick={() => picker.current?.click()}>
                      {picking ? 'Reading image…' : seal ? 'Replace' : 'Upload seal'}
                    </Button>
                    {seal ? (
                      <Button
                        disabled={busy || picking || !!staged}
                        onClick={() => setRemoving(true)}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>
                </>
              ) : null}
              {staged ? (
                <div className="grid gap-3 rounded-control border border-warning/50 bg-warning/5 p-4">
                  <div className="flex items-center gap-4">
                    <AgencySealMark agency={previewAgency} className="size-24" />
                    <div className="grid min-w-0 gap-1">
                      <span className="break-all text-small font-semibold">
                        {staged.file.name} <StatusTag tone="warning">Not saved</StatusTag>
                      </span>
                      <span className="text-caption text-ink-muted">
                        {Math.ceil(staged.file.size / 1024)} KB · {staged.width} × {staged.height}{' '}
                        px
                      </span>
                    </div>
                  </div>
                  <p className="m-0 text-small">
                    Check the preview. Once saved, every open Invitation link shows this seal.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="primary"
                      disabled={busy || picking}
                      onClick={() => void mutate()}
                    >
                      {busy ? 'Saving…' : 'Save seal'}
                    </Button>
                    <Button
                      disabled={busy || picking}
                      onClick={() => {
                        setStaged(null);
                        setError('');
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          </Panel>
          <Panel title="Building photo">
            <p className="m-0 text-small text-ink-muted">
              Invitations currently show the drawn sunrise.
            </p>
          </Panel>
        </div>
        <Panel
          title={staged ? 'Preview · not saved' : 'What invited Users see'}
          className="min-[1280px]:sticky min-[1280px]:top-6"
        >
          <SectionTabs value={preview} onValueChange={setPreview}>
            <SectionTabList
              label="Invitation preview"
              tabs={[
                { value: 'password', label: 'Set password' },
                { value: 'done', label: 'Signed in' },
              ]}
            />
            <SectionTabPanel
              forceMount
              value="password"
              className="mt-4 data-[state=inactive]:hidden"
            >
              <InvitationPreview agency={previewAgency} signedIn={false} />
            </SectionTabPanel>
            <SectionTabPanel forceMount value="done" className="mt-4 data-[state=inactive]:hidden">
              <InvitationPreview agency={previewAgency} signedIn />
            </SectionTabPanel>
          </SectionTabs>
        </Panel>
      </div>
      <Dialog
        open={removing}
        onOpenChange={(open) => {
          if (!busy) setRemoving(open);
        }}
      >
        <DialogContent size="compact">
          <DialogHeader>
            <DialogTitle>Remove the Agency seal?</DialogTitle>
            <DialogDescription>
              Open Invitation links will show the gold ring with your acronym. The Audit Log keeps a
              record of the removed file.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button disabled={busy} onClick={() => setRemoving(false)}>
              Keep seal
            </Button>
            <Button variant="primary" disabled={busy} onClick={() => void mutate(true)}>
              {busy ? 'Removing…' : 'Remove seal'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
