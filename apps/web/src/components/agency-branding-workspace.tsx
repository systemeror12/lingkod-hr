'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../lib/class-names';
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

export interface SavedBuildingPhoto extends SavedAgencySeal {
  shown: boolean;
}

interface StagedImage {
  file: File;
  url: string;
  width: number;
  height: number;
}

/** The API's limits, checked here too so a rejected file never leaves the browser. */
interface ImageLimits {
  noun: 'seal' | 'photo';
  maxBytes: number;
  maxLabel: string;
  minWidth: number;
  minHeight: number;
  minLabel: string;
}

const SEAL_LIMITS: ImageLimits = {
  noun: 'seal',
  maxBytes: 2 * 1024 * 1024,
  maxLabel: '2 MB',
  minWidth: 600,
  minHeight: 600,
  minLabel: 'Use at least 600 × 600 px to print.',
};
const PHOTO_LIMITS: ImageLimits = {
  noun: 'photo',
  maxBytes: 5 * 1024 * 1024,
  maxLabel: '5 MB',
  minWidth: 1200,
  minHeight: 1,
  minLabel: 'Use at least 1200 px wide.',
};

/**
 * One saved branding image and the file staged to replace it. A picked file stays staged as
 * **Not saved** until `send('PUT')`; every request carries the saved image's ID as the revision.
 */
function useBrandImage<T extends { id: string }>({
  endpoint,
  revisionField,
  resultKey,
  limits,
  initial,
}: {
  endpoint: string;
  revisionField: string;
  resultKey: 'seal' | 'photo';
  limits: ImageLimits;
  initial: T | null;
}) {
  const [saved, setSaved] = useState(initial);
  const [staged, setStaged] = useState<StagedImage | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const pickSequence = useRef(0);

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
    const rejected = (message: string) =>
      `${file.name}: ${message} The current ${limits.noun} is unchanged.`;
    let url: string | undefined;
    try {
      if (!['image/png', 'image/jpeg'].includes(file.type))
        throw new Error(rejected('Use a PNG or JPEG image.'));
      if (file.size > limits.maxBytes)
        throw new Error(rejected(`Use a file no larger than ${limits.maxLabel}.`));
      url = URL.createObjectURL(file);
      const image = new browser.Image();
      image.src = url;
      await image.decode().catch(() => {
        throw new Error(rejected('Use a readable PNG or JPEG image.'));
      });
      if (image.naturalWidth < limits.minWidth || image.naturalHeight < limits.minHeight) {
        throw new Error(
          rejected(
            `The image is ${image.naturalWidth} × ${image.naturalHeight} px. ${limits.minLabel}`,
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

  /** Saves the staged file (`PUT`), or sends `fields` as JSON. Resolves true once applied. */
  async function send(
    method: 'PUT' | 'PATCH' | 'DELETE',
    success: string,
    fields: Record<string, unknown> = {},
  ) {
    if (busy || (method === 'PUT' && !staged)) return false;
    setBusy(true);
    setError('');
    setNotice('');
    const fallback = `The ${limits.noun} could not be saved. Try again.`;
    try {
      const revision = saved?.id ?? '';
      let body: FormData | string;
      if (method === 'PUT') {
        body = new FormData();
        body.append(revisionField, revision);
        body.append('file', staged!.file);
      } else {
        body = JSON.stringify({ [revisionField]: revision, ...fields });
      }
      const response = await fetch(endpoint, {
        method,
        credentials: 'include',
        ...(typeof body === 'string' ? { headers: { 'Content-Type': 'application/json' } } : {}),
        body,
      });
      const result = (await response.json()) as Record<string, unknown> & {
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(result.error?.message ?? fallback);
      setSaved((result[resultKey] as T | null | undefined) ?? null);
      setStaged(null);
      setNotice(success);
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : fallback);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setStaged(null);
    setError('');
  }

  return { saved, staged, error, notice, busy, picking, pick, send, cancel };
}

type BrandImage = ReturnType<typeof useBrandImage>;

function fileSize(byteSize: number, width: number, height: number) {
  return `${Math.ceil(byteSize / 1024)} KB · ${width} × ${height} px`;
}

/** "Changed by {name}, {date and time} · View in Audit Log" under a saved file. */
function ChangedBy({ image }: { image: { changedByName: string; changedAt: string } }) {
  return (
    <p className="m-0 text-caption text-ink-muted">
      Changed by {image.changedByName},{' '}
      {new Intl.DateTimeFormat('en-PH', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Manila',
      }).format(new Date(image.changedAt))}{' '}
      ·{' '}
      <Link className="text-primary underline underline-offset-4" href="/audit">
        View in Audit Log
      </Link>
    </p>
  );
}

/** The hidden file input, the Upload or Replace button, and Remove. */
function FileActions({
  image,
  label,
  limitsId,
  uploadLabel,
  onRemove,
}: {
  image: BrandImage;
  label: string;
  limitsId: string;
  uploadLabel: string;
  onRemove: () => void;
}) {
  const picker = useRef<{ click(): void }>(null);
  const { saved, staged, busy, picking } = image;
  return (
    <>
      <input
        ref={picker}
        type="file"
        accept="image/png,image/jpeg"
        aria-label={label}
        aria-describedby={limitsId}
        className="sr-only"
        disabled={busy || picking}
        onChange={(event) => {
          const input = event.currentTarget as unknown as { files: File[]; value: string };
          void image.pick(input.files?.[0]);
          input.value = '';
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || picking} onClick={() => picker.current?.click()}>
          {picking ? 'Reading image…' : saved ? 'Replace' : uploadLabel}
        </Button>
        {saved ? (
          <Button disabled={busy || picking || !!staged} onClick={onRemove}>
            Remove
          </Button>
        ) : null}
      </div>
    </>
  );
}

/** The staged file with its **Not saved** tag, Save, and Cancel. */
function StagedFile({
  image,
  thumbnail,
  saveLabel,
  savedNotice,
  children,
}: {
  image: BrandImage;
  thumbnail: ReactNode;
  saveLabel: string;
  savedNotice: string;
  children: ReactNode;
}) {
  const { staged, busy, picking } = image;
  if (!staged) return null;
  return (
    <div className="grid gap-3 rounded-control border border-warning/50 bg-warning/5 p-4">
      <div className="flex items-center gap-4">
        {thumbnail}
        <div className="grid min-w-0 gap-1">
          <span className="break-all text-small font-semibold">
            {staged.file.name} <StatusTag tone="warning">Not saved</StatusTag>
          </span>
          <span className="text-caption text-ink-muted">
            {fileSize(staged.file.size, staged.width, staged.height)}
          </span>
        </div>
      </div>
      <p className="m-0 text-small">{children}</p>
      <div className="flex gap-2">
        <Button
          variant="primary"
          disabled={busy || picking}
          onClick={() => void image.send('PUT', savedNotice)}
        >
          {busy ? 'Saving…' : saveLabel}
        </Button>
        <Button disabled={busy || picking} onClick={image.cancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function Feedback({ image }: { image: BrandImage }) {
  return (
    <>
      <FormError message={image.error} />
      {image.notice ? (
        <p role="status" className="m-0 text-small text-ink">
          {image.notice}
        </p>
      ) : null}
    </>
  );
}

function RemoveDialog({
  open,
  busy,
  title,
  description,
  keepLabel,
  removeLabel,
  onOpenChange,
  onRemove,
}: {
  open: boolean;
  busy: boolean;
  title: string;
  description: string;
  keepLabel: string;
  removeLabel: string;
  onOpenChange: (open: boolean) => void;
  onRemove: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <DialogContent size="compact">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button disabled={busy} onClick={() => onOpenChange(false)}>
            {keepLabel}
          </Button>
          <Button variant="primary" disabled={busy} onClick={onRemove}>
            {busy ? 'Removing…' : removeLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PhotoThumbnail({ url, off = false }: { url: string; off?: boolean }) {
  return (
    <img
      src={url}
      alt="Building photo"
      className={cn(
        'h-28 w-40 shrink-0 rounded-control object-cover',
        off && 'opacity-40 grayscale',
      )}
    />
  );
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

/**
 * The Agency Administrator's **Seal and building photo** page: the seal for the Invitation
 * letterhead, the optional building photo for its scene, and a live preview of the Invitation.
 */
export function AgencyBrandingWorkspace({
  agencyId,
  agency,
  initialSeal,
  initialPhoto,
  canUpdate,
}: {
  agencyId: string;
  agency: LetterheadAgency;
  initialSeal: SavedAgencySeal | null;
  initialPhoto: SavedBuildingPhoto | null;
  canUpdate: boolean;
}) {
  const seal = useBrandImage({
    endpoint: `/api/v1/agencies/${agencyId}/agency-profile/seal`,
    revisionField: 'expectedSealId',
    resultKey: 'seal',
    limits: SEAL_LIMITS,
    initial: initialSeal,
  });
  const photo = useBrandImage({
    endpoint: `/api/v1/agencies/${agencyId}/agency-profile/building-photo`,
    revisionField: 'expectedPhotoId',
    resultKey: 'photo',
    limits: PHOTO_LIMITS,
    initial: initialPhoto,
  });
  const [removing, setRemoving] = useState<'seal' | 'photo' | null>(null);
  const [preview, setPreview] = useState('password');
  const savedSeal = seal.saved;
  const savedPhoto = photo.saved;
  const previewAgency = {
    ...agency,
    sealUrl: seal.staged?.url ?? savedSeal?.url ?? null,
    photoUrl: photo.staged?.url ?? (savedPhoto?.shown ? savedPhoto.url : null),
  };
  const anyStaged = !!seal.staged || !!photo.staged;

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
              <Feedback image={seal} />
              {savedSeal ? (
                <div className="flex flex-wrap items-center gap-4">
                  <AgencySealMark
                    agency={{ ...agency, sealUrl: savedSeal.url }}
                    className="size-24"
                  />
                  <div className="grid min-w-0 gap-1">
                    <span className="break-all text-small font-semibold">{savedSeal.fileName}</span>
                    <span className="text-caption text-ink-muted">
                      {fileSize(savedSeal.byteSize, savedSeal.width, savedSeal.height)}
                    </span>
                    <ChangedBy image={savedSeal} />
                  </div>
                </div>
              ) : (
                <p className="m-0 rounded-control border-2 border-dashed border-border bg-canvas p-5 text-small">
                  No seal yet. Invitations show a gold ring with your acronym.
                </p>
              )}
              {canUpdate ? (
                <FileActions
                  image={seal}
                  label="Agency seal file"
                  limitsId="seal-limits"
                  uploadLabel="Upload seal"
                  onRemove={() => setRemoving('seal')}
                />
              ) : null}
              <StagedFile
                image={seal}
                saveLabel="Save seal"
                savedNotice="Agency seal saved. Open Invitation links now show this seal."
                thumbnail={<AgencySealMark agency={previewAgency} className="size-24" />}
              >
                Check the preview. Once saved, every open Invitation link shows this seal.
              </StagedFile>
            </div>
          </Panel>
          <Panel title="Building photo">
            <div className="grid gap-4">
              <p className="m-0 text-small text-ink-muted">
                Replaces the drawn sunrise on Invitation Activation. Optional. Sign-in and Password
                Reset keep the drawn sunrise.
              </p>
              <p className="m-0 text-caption text-ink-muted" id="photo-limits">
                JPEG or PNG, landscape, at least 1200 px wide, up to 5 MB.
              </p>
              <Feedback image={photo} />
              {savedPhoto ? (
                <div className="flex flex-wrap items-start gap-4">
                  <PhotoThumbnail url={savedPhoto.url} off={!savedPhoto.shown} />
                  <div className="grid min-w-0 gap-1">
                    <span className="break-all text-small font-semibold">
                      {savedPhoto.fileName}
                    </span>
                    <span className="text-caption text-ink-muted">
                      {fileSize(savedPhoto.byteSize, savedPhoto.width, savedPhoto.height)}
                    </span>
                    <label className="flex cursor-pointer items-center gap-2 py-1 text-small">
                      <input
                        type="checkbox"
                        className="size-3.5 accent-primary"
                        checked={savedPhoto.shown}
                        disabled={!canUpdate || photo.busy || photo.picking || !!photo.staged}
                        onChange={() =>
                          void photo.send(
                            'PATCH',
                            savedPhoto.shown
                              ? 'Building photo turned off. Invitations show the drawn sunrise.'
                              : 'Building photo turned on. Open Invitation links now show it.',
                            { shown: !savedPhoto.shown },
                          )
                        }
                      />
                      Show on Invitation screens
                    </label>
                    <ChangedBy image={savedPhoto} />
                  </div>
                </div>
              ) : (
                <p className="m-0 rounded-control border-2 border-dashed border-border bg-canvas p-5 text-small">
                  No photo. Invitations show the drawn sunrise.
                </p>
              )}
              {canUpdate ? (
                <FileActions
                  image={photo}
                  label="Building photo file"
                  limitsId="photo-limits"
                  uploadLabel="Upload photo"
                  onRemove={() => setRemoving('photo')}
                />
              ) : null}
              <StagedFile
                image={photo}
                saveLabel="Save photo"
                savedNotice="Building photo saved. Open Invitation links now show this photo."
                thumbnail={photo.staged ? <PhotoThumbnail url={photo.staged.url} /> : null}
              >
                Check the preview. Once saved, every open Invitation link shows this photo.
              </StagedFile>
            </div>
          </Panel>
        </div>
        <Panel
          title={anyStaged ? 'Preview · not saved' : 'What invited Users see'}
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
      <RemoveDialog
        open={removing === 'seal'}
        busy={seal.busy}
        title="Remove the Agency seal?"
        description="Open Invitation links will show the gold ring with your acronym. The Audit Log keeps a record of the removed file."
        keepLabel="Keep seal"
        removeLabel="Remove seal"
        onOpenChange={(open) => setRemoving(open ? 'seal' : null)}
        onRemove={async () => {
          if (await seal.send('DELETE', 'Agency seal removed.')) setRemoving(null);
        }}
      />
      <RemoveDialog
        open={removing === 'photo'}
        busy={photo.busy}
        title="Remove the building photo?"
        description="Open Invitation links will show the drawn sunrise. The Audit Log keeps a record of the removed file."
        keepLabel="Keep photo"
        removeLabel="Remove photo"
        onOpenChange={(open) => setRemoving(open ? 'photo' : null)}
        onRemove={async () => {
          if (await photo.send('DELETE', 'Building photo removed.')) setRemoving(null);
        }}
      />
    </>
  );
}
