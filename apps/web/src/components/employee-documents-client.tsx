'use client';

import { useRecordNavigation } from './record-navigation';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from './ui/button';
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
} from './ui/dialog';
import {
  employeeInputClass,
  employeeLabelClass,
  formatEmployeeDate,
  titleCase,
} from './employee-directory';

const personnelClassifications = [
  'PDS',
  'WES',
  'APPOINTMENT',
  'OATH_OF_OFFICE',
  'ASSUMPTION_TO_DUTY',
  'MEDICAL',
  'CLEARANCE',
  'ELIGIBILITY',
  'EDUCATION',
  'TRAINING',
  'LICENSE',
  'PERFORMANCE',
  'SALARY_ADJUSTMENT',
  'SEPARATION',
  'GOVERNMENT_IDENTIFIER',
  'BANK_ACCOUNT',
] as const;

const purposeLabels = {
  PDS_SUPPORT: 'PDS support',
  WES_SUPPORT: 'WES support',
  APPOINTMENT_SUPPORT: 'Appointment support',
  PERSONNEL_ACTION_SUPPORT: 'Personnel Action support',
  SERVICE_RECORD_SUPPORT: 'Service Record support',
  PAYROLL_SUPPORT: 'Payroll support',
  LEAVE_SUPPORT: 'Leave support',
  PERFORMANCE_SUPPORT: 'Performance support',
  COMPLIANCE_SUPPORT: 'Compliance support',
  OWN_RECORD_UPLOAD: 'Own-record upload',
} as const;

const purposes = Object.keys(purposeLabels) as Array<keyof typeof purposeLabels>;

interface EmployeeDocument {
  id: string;
  employeeId: string;
  documentId: string;
  documentVersionId: string;
  documentNo: string | null;
  documentType: string;
  classification: string;
  status: string;
  personnelClassification: string;
  purpose: keyof typeof purposeLabels;
  releaseState: 'PENDING' | 'RELEASED' | 'WITHHELD';
  versionNo: number;
  mimeType: string;
  sizeBytes: number;
  issuedAt: string | null;
  createdAt: string;
}

interface LinkableDocument {
  documentId: string;
  documentNo: string | null;
  documentType: string;
  classification: string;
  status: string;
  version: { id: string; versionNo: number };
}

interface ErrorEnvelope {
  error?: { message?: string };
}

function human(value: string): string {
  return value
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function targetValue(event: { target: unknown }): string {
  return (event.target as { value: string }).value;
}

interface FormControl {
  value?: unknown;
  files?: { [index: number]: unknown };
}

interface FormElements {
  namedItem(name: string): FormControl | null;
}

function formValue(form: unknown, name: string): string {
  const elements = (form as { elements?: FormElements }).elements;
  const value = elements?.namedItem(name)?.value;
  return typeof value === 'string' ? value : '';
}

function formFile(form: unknown): unknown {
  return (form as { elements?: FormElements }).elements?.namedItem('file')?.files?.[0];
}

function errorMessage(value: unknown, fallback: string): string {
  if (!value || typeof value !== 'object') return fallback;
  const message = (value as ErrorEnvelope).error?.message;
  return message || fallback;
}

function documentLabel(document: Pick<EmployeeDocument, 'documentNo' | 'documentType'>): string {
  return document.documentNo ?? human(document.documentType);
}

function parseDocumentList(value: unknown): EmployeeDocument[] {
  if (
    !value ||
    typeof value !== 'object' ||
    !Array.isArray((value as { documents?: unknown }).documents)
  ) {
    throw new Error('The Personnel Document response was invalid.');
  }
  return (value as { documents: EmployeeDocument[] }).documents;
}

function parseLinkableList(value: unknown): LinkableDocument[] {
  if (
    !value ||
    typeof value !== 'object' ||
    !Array.isArray((value as { documents?: unknown }).documents)
  ) {
    throw new Error('The Agency Document response was invalid.');
  }
  return (value as { documents: LinkableDocument[] }).documents;
}

export function EmployeeDocumentsSection({
  agencyId,
  employeeId,
  canRead,
  canManage,
  canUploadOwn,
  canBrowseSource,
  canRemoveOwn,
}: {
  agencyId: string;
  employeeId: string;
  canRead: boolean;
  canManage: boolean;
  canUploadOwn: boolean;
  canBrowseSource: boolean;
  canRemoveOwn: boolean;
}) {
  const [documents, setDocuments] = useState<EmployeeDocument[]>([]);
  const navigation = useRecordNavigation();
  const documentId = navigation.search.get('document');

  const [linkableDocuments, setLinkableDocuments] = useState<LinkableDocument[]>([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState('');
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [loading, setLoading] = useState(canRead);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [accessBusy, setAccessBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const uploadAttempt = useRef<{ file: unknown; metadata: string; key: string } | null>(null);
  const [detail, setDetail] = useState<EmployeeDocument | null>(null);
  const [accessUrl, setAccessUrl] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<EmployeeDocument | null>(null);

  useEffect(() => {
    setAccessUrl(null);
    if (!documentId) {
      setDetail(null);
      return;
    }
    if (loading) return;
    const selected = documents.find((item) => item.id === documentId);
    setDetail(selected ?? null);
    if (!selected) setError('This Personnel Document is missing or outside your permitted scope.');
  }, [documentId, documents, loading]);

  const endpoint = `/api/v1/agencies/${agencyId}/employees/${employeeId}/documents`;

  async function refresh(): Promise<void> {
    if (!canRead) return;
    setLoading(true);
    try {
      const response = await fetch(endpoint, { credentials: 'include' });
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(errorMessage(value, 'Personnel Documents could not be loaded.'));
      setDocuments(parseDocumentList(value));
      setError(null);
    } catch (caught: unknown) {
      setError(
        caught instanceof Error ? caught.message : 'Personnel Documents could not be loaded.',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [agencyId, employeeId, canRead]);

  useEffect(() => {
    if (!linkOpen || !canBrowseSource) return;
    let active = true;
    setSourceLoading(true);
    void fetch('/api/v1/agencies/' + agencyId + '/documents/versions', {
      credentials: 'include',
    })
      .then(async (response) => {
        const value: unknown = await response.json().catch(() => null);
        if (!response.ok)
          throw new Error(errorMessage(value, 'Agency Documents could not be loaded.'));
        if (active) setLinkableDocuments(parseLinkableList(value));
      })
      .catch((caught: unknown) => {
        if (active)
          setError(
            caught instanceof Error ? caught.message : 'Agency Documents could not be loaded.',
          );
      })
      .finally(() => {
        if (active) setSourceLoading(false);
      });
    return () => {
      active = false;
    };
  }, [agencyId, linkOpen, canBrowseSource]);

  async function link(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget as unknown;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          documentId: formValue(form, 'documentId'),
          documentVersionId: formValue(form, 'documentVersionId'),
          personnelClassification: formValue(form, 'personnelClassification'),
          purpose: formValue(form, 'purpose'),
          releaseState: formValue(form, 'releaseState'),
        }),
      });
      const value: unknown = await response.json().catch(() => null);
      if (response.ok) {
        setLinkOpen(false);
        setMessage('Personnel Document linked to this Employee.');
        await refresh();
      } else {
        setError(errorMessage(value, 'The Personnel Document could not be linked.'));
      }
    } catch (caught: unknown) {
      setError(
        caught instanceof Error ? caught.message : 'The Personnel Document could not be linked.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function upload(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    const formElement = event.currentTarget as unknown;
    const form = new FormData();
    const file = formFile(formElement);
    if (file) {
      form.append('file', file as Parameters<FormData['append']>[1]);
    }
    form.append('classification', formValue(formElement, 'classification'));
    form.append('personnelClassification', formValue(formElement, 'personnelClassification'));
    form.append('purpose', formValue(formElement, 'purpose'));
    const metadata = JSON.stringify(
      ['classification', 'personnelClassification', 'purpose'].map((name) =>
        formValue(formElement, name),
      ),
    );
    if (
      !uploadAttempt.current ||
      uploadAttempt.current.file !== file ||
      uploadAttempt.current.metadata !== metadata
    ) {
      uploadAttempt.current = { file, metadata, key: crypto.randomUUID() };
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${endpoint}/upload`, {
        method: 'POST',
        headers: { 'idempotency-key': uploadAttempt.current.key },
        credentials: 'include',
        body: form,
      });
      const value: unknown = await response.json().catch(() => null);
      if (response.ok) {
        uploadAttempt.current = null;
        setUploadOpen(false);
        setMessage('Own-record evidence uploaded and held pending release.');
        await refresh();
      } else {
        setError(errorMessage(value, 'The Personnel Document could not be uploaded.'));
      }
    } catch (caught: unknown) {
      setError(
        caught instanceof Error ? caught.message : 'The Personnel Document could not be uploaded.',
      );
    } finally {
      setBusy(false);
    }
  }

  function inspect(document: EmployeeDocument): void {
    navigation.navigate({ document: document.id });
    setAccessUrl(null);
    setError(null);
  }

  async function openPrivateFile(): Promise<void> {
    if (!detail) return;
    setAccessBusy(true);
    setError(null);
    try {
      const response = await fetch(`${endpoint}/${detail.id}/access`, { credentials: 'include' });
      const value: unknown = await response.json().catch(() => null);
      if (
        response.ok &&
        value &&
        typeof value === 'object' &&
        typeof (value as { accessUrl?: unknown }).accessUrl === 'string'
      ) {
        setAccessUrl((value as { accessUrl: string }).accessUrl);
      } else {
        setError(errorMessage(value, 'The private file could not be opened.'));
      }
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'The private file could not be opened.');
    } finally {
      setAccessBusy(false);
    }
  }

  async function remove(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!removeTarget) return;
    const form = event.currentTarget as unknown;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${endpoint}/${removeTarget.id}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reason: formValue(form, 'reason') }),
      });
      const value: unknown = await response.json().catch(() => null);
      if (response.ok) {
        setRemoveTarget(null);
        setMessage('Personnel Document link removed. The underlying Document remains preserved.');
        await refresh();
      } else {
        setError(errorMessage(value, 'The Personnel Document link could not be removed.'));
      }
    } catch (caught: unknown) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'The Personnel Document link could not be removed.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (!canRead) return null;

  return (
    <section
      className="border-t border-line px-6 py-6 min-[700px]:px-8"
      aria-labelledby="personnel-documents-heading"
    >
      <div className="flex flex-col gap-4 min-[620px]:flex-row min-[620px]:items-start min-[620px]:justify-between">
        <div>
          <p className="m-0 text-[10px] font-bold tracking-[.08em] text-muted uppercase">
            Controlled evidence
          </p>
          <h2
            id="personnel-documents-heading"
            className="mt-1 mb-0 text-lg font-[680] tracking-[-.02em] text-midnight"
          >
            Personnel Documents
          </h2>
          <p className="mt-1 mb-0 max-w-[620px] text-xs leading-5 text-muted">
            Each link points to one exact immutable Document Version. Removing a link never deletes
            the source evidence.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage && canBrowseSource ? (
            <Dialog open={linkOpen} onOpenChange={(open) => !busy && setLinkOpen(open)}>
              <DialogTrigger asChild>
                <Button size="default" variant="primary">
                  Link personnel document
                </Button>
              </DialogTrigger>
              <DialogContent aria-describedby="link-personnel-document-description" size="compact">
                <form className="contents" onSubmit={link}>
                  <DialogHeader>
                    <div className="grid gap-1.5">
                      <DialogTitle>Link personnel document</DialogTitle>
                      <DialogDescription id="link-personnel-document-description">
                        Link one finalized Agency Document Version to this Employee with a
                        controlled personnel meaning.
                      </DialogDescription>
                    </div>
                    <DialogClose asChild>
                      <Button
                        aria-label="Close link personnel document dialog"
                        disabled={busy}
                        type="button"
                      >
                        <span aria-hidden="true" className="text-xl leading-none">
                          ×
                        </span>
                      </Button>
                    </DialogClose>
                  </DialogHeader>
                  <DialogBody className="grid gap-5">
                    {error ? (
                      <p
                        role="alert"
                        className="m-0 rounded-[3px] bg-[#fdeeee] px-4 py-3 text-sm text-[#8f2d2d]"
                      >
                        {error}
                      </p>
                    ) : null}
                    {sourceLoading ? (
                      <p
                        role="status"
                        className="m-0 rounded-[3px] bg-canvas px-4 py-3 text-sm text-muted"
                      >
                        Loading finalized Agency Documents…
                      </p>
                    ) : null}
                    <label className={employeeLabelClass}>
                      Document Version
                      <select
                        autoFocus
                        className={employeeInputClass}
                        name="documentVersionChoice"
                        required
                        onChange={(event) => {
                          const selected = linkableDocuments.find(
                            (document) =>
                              `${document.documentId}:${document.version.id}` ===
                              targetValue(event),
                          );
                          setSelectedDocumentId(selected?.documentId ?? '');
                          setSelectedVersionId(selected?.version.id ?? '');
                        }}
                      >
                        <option value="">Select a finalized Document Version</option>
                        {linkableDocuments.map((document) => (
                          <option
                            key={`${document.documentId}:${document.version.id}`}
                            value={`${document.documentId}:${document.version.id}`}
                          >
                            {document.documentNo ?? human(document.documentType)} · v
                            {document.version.versionNo}
                          </option>
                        ))}
                      </select>
                    </label>
                    <input type="hidden" name="documentId" value={selectedDocumentId} />
                    <label className={employeeLabelClass}>
                      Exact version ID
                      <input
                        className={employeeInputClass}
                        name="documentVersionId"
                        value={selectedVersionId}
                        readOnly
                        placeholder="Select a Document Version above"
                        required
                      />
                    </label>
                    <label className={employeeLabelClass}>
                      Personnel classification
                      <select
                        className={employeeInputClass}
                        name="personnelClassification"
                        defaultValue="PDS"
                        required
                      >
                        {personnelClassifications.map((classification) => (
                          <option key={classification} value={classification}>
                            {human(classification)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={employeeLabelClass}>
                      Purpose
                      <select
                        className={employeeInputClass}
                        name="purpose"
                        defaultValue="PDS_SUPPORT"
                        required
                      >
                        {purposes.map((purpose) => (
                          <option key={purpose} value={purpose}>
                            {purposeLabels[purpose]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={employeeLabelClass}>
                      Release state
                      <select
                        className={employeeInputClass}
                        name="releaseState"
                        defaultValue="RELEASED"
                        required
                      >
                        <option value="RELEASED">Released for authorized access</option>
                        <option value="WITHHELD">Withheld from Employee self-service</option>
                      </select>
                    </label>
                    <p className="m-0 border-l-2 border-cobalt bg-[#f3f7fc] px-3 py-2.5 text-xs leading-[1.55] text-muted">
                      The source Document’s classification stays authoritative. Restricted medical,
                      SALN, bank, and identifier evidence remains hidden without the separate
                      sensitive permission.
                    </p>
                  </DialogBody>
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button disabled={busy} size="default" type="button" variant="secondary">
                        Cancel
                      </Button>
                    </DialogClose>
                    <Button
                      disabled={busy || sourceLoading}
                      size="default"
                      type="submit"
                      variant="primary"
                    >
                      {busy ? 'Linking…' : 'Link document'}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          ) : null}
          {canUploadOwn ? (
            <Dialog open={uploadOpen} onOpenChange={(open) => !busy && setUploadOpen(open)}>
              <DialogTrigger asChild>
                <Button size="default" variant="secondary">
                  Upload own evidence
                </Button>
              </DialogTrigger>
              <DialogContent aria-describedby="upload-own-document-description" size="compact">
                <form className="contents" onSubmit={upload}>
                  <DialogHeader>
                    <div className="grid gap-1.5">
                      <DialogTitle>Upload own Personnel Document</DialogTitle>
                      <DialogDescription id="upload-own-document-description">
                        Upload evidence for this Employee record. It stays pending until an
                        authorized release.
                      </DialogDescription>
                    </div>
                    <DialogClose asChild>
                      <Button
                        aria-label="Close upload own document dialog"
                        disabled={busy}
                        type="button"
                      >
                        <span aria-hidden="true" className="text-xl leading-none">
                          ×
                        </span>
                      </Button>
                    </DialogClose>
                  </DialogHeader>
                  <DialogBody className="grid gap-5">
                    {error ? (
                      <p
                        role="alert"
                        className="m-0 rounded-[3px] bg-[#fdeeee] px-4 py-3 text-sm text-[#8f2d2d]"
                      >
                        {error}
                      </p>
                    ) : null}
                    <label className={employeeLabelClass}>
                      File
                      <input
                        className={employeeInputClass}
                        name="file"
                        type="file"
                        accept="application/pdf,image/png,image/jpeg,text/plain"
                        required
                      />
                    </label>
                    <label className={employeeLabelClass}>
                      Document classification
                      <select
                        className={employeeInputClass}
                        name="classification"
                        defaultValue="CONFIDENTIAL"
                        required
                      >
                        <option value="CONFIDENTIAL">Confidential</option>
                        <option value="HIGHLY_SENSITIVE">Highly sensitive</option>
                        <option value="INTERNAL">Internal</option>
                        <option value="PUBLIC">Public</option>
                      </select>
                    </label>
                    <label className={employeeLabelClass}>
                      Personnel classification
                      <select
                        className={employeeInputClass}
                        name="personnelClassification"
                        defaultValue="PDS"
                        required
                      >
                        {personnelClassifications.map((classification) => (
                          <option key={classification} value={classification}>
                            {human(classification)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={employeeLabelClass}>
                      Purpose
                      <select
                        className={employeeInputClass}
                        name="purpose"
                        defaultValue="OWN_RECORD_UPLOAD"
                        required
                      >
                        {purposes.map((purpose) => (
                          <option key={purpose} value={purpose}>
                            {purposeLabels[purpose]}
                          </option>
                        ))}
                      </select>
                    </label>
                  </DialogBody>
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button disabled={busy} size="default" type="button" variant="secondary">
                        Cancel
                      </Button>
                    </DialogClose>
                    <Button disabled={busy} size="default" type="submit" variant="primary">
                      {busy ? 'Uploading…' : 'Upload evidence'}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          ) : null}
        </div>
      </div>
      {message ? (
        <p role="status" className="mb-0 mt-4 text-xs text-[#27633b]">
          {message}
        </p>
      ) : null}
      {error && !linkOpen && !uploadOpen && !removeTarget ? (
        <p role="alert" className="mb-0 mt-4 text-xs text-[#8f2d2d]">
          {error}
        </p>
      ) : null}
      <div className="mt-5 grid gap-3">
        {loading ? (
          <p role="status" className="m-0 rounded-[3px] bg-canvas px-4 py-3 text-sm text-muted">
            Loading Personnel Documents…
          </p>
        ) : null}
        {!loading && documents.length === 0 ? (
          <p className="m-0 rounded-[3px] bg-canvas px-4 py-3 text-sm text-muted">
            No Personnel Documents are visible in this scope.
          </p>
        ) : null}
        {documents.map((document) => (
          <article
            key={document.id}
            className="grid gap-4 rounded-[4px] border border-line bg-[#fbfcfe] px-4 py-4 min-[620px]:grid-cols-[1fr_auto] min-[620px]:items-center"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <strong className="text-sm text-midnight">{documentLabel(document)}</strong>
                <span className="rounded-full bg-pale-blue px-2 py-1 text-[10px] font-bold tracking-[.04em] text-cobalt uppercase">
                  v{document.versionNo}
                </span>
                <span className="rounded-full bg-canvas px-2 py-1 text-[10px] font-bold tracking-[.04em] text-muted uppercase">
                  {human(document.releaseState)}
                </span>
              </div>
              <p className="mt-1 mb-0 text-xs text-muted">
                {human(document.personnelClassification)} ·{' '}
                {purposeLabels[document.purpose] ?? human(document.purpose)} · {document.mimeType} ·{' '}
                {document.sizeBytes.toLocaleString()} bytes
              </p>
              <p className="mt-1 mb-0 text-[11px] text-muted">
                Created {formatEmployeeDate(document.createdAt)} · {human(document.status)} ·{' '}
                {titleCase(document.classification)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 min-[620px]:justify-end">
              <Button size="default" variant="secondary" onClick={() => void inspect(document)}>
                Inspect document
              </Button>
              {canManage || canRemoveOwn ? (
                <Button
                  size="default"
                  variant="secondary"
                  onClick={() => setRemoveTarget(document)}
                >
                  Remove link
                </Button>
              ) : null}
            </div>
          </article>
        ))}
      </div>

      <Dialog
        presentation="form"
        open={Boolean(detail)}
        onOpenChange={(open) => {
          if (!open && !accessBusy) {
            navigation.navigate({ document: null });
            setDetail(null);
            setAccessUrl(null);
          }
        }}
      >
        <DialogContent aria-describedby="personnel-document-detail-description" size="compact">
          <DialogHeader>
            <div className="grid gap-1.5">
              <DialogTitle>Personnel Document detail</DialogTitle>
              <DialogDescription id="personnel-document-detail-description">
                Inspect the classified link and request a short-lived private retrieval link when
                your active scope permits it.
              </DialogDescription>
            </div>
            <DialogClose asChild>
              <Button
                aria-label="Close Personnel Document detail"
                disabled={accessBusy}
                type="button"
              >
                <span aria-hidden="true" className="text-xl leading-none">
                  ×
                </span>
              </Button>
            </DialogClose>
          </DialogHeader>
          <DialogBody className="grid gap-5">
            {detail ? (
              <dl className="grid gap-4">
                {[
                  ['Document', documentLabel(detail)],
                  ['Personnel classification', human(detail.personnelClassification)],
                  ['Purpose', purposeLabels[detail.purpose] ?? human(detail.purpose)],
                  ['Release state', human(detail.releaseState)],
                  ['Exact Document Version', `${detail.documentVersionId} · v${detail.versionNo}`],
                  ['File', `${detail.mimeType} · ${detail.sizeBytes.toLocaleString()} bytes`],
                  ['Issued', detail.issuedAt ? formatEmployeeDate(detail.issuedAt) : 'Not issued'],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-[10px] font-bold tracking-[.08em] text-muted uppercase">
                      {label}
                    </dt>
                    <dd className="mt-1 break-words text-sm font-[560] text-ink">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {accessUrl ? (
              <p className="m-0 rounded-[3px] bg-[#e7f4eb] px-4 py-3 text-sm text-[#27633b]">
                <a
                  className="font-[650] text-[#27633b] underline"
                  href={accessUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  Open private file
                </a>
              </p>
            ) : null}
            {error ? (
              <p
                role="alert"
                className="m-0 rounded-[3px] bg-[#fdeeee] px-4 py-3 text-sm text-[#8f2d2d]"
              >
                {error}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button disabled={accessBusy} size="default" type="button" variant="secondary">
                Close
              </Button>
            </DialogClose>
            <Button
              disabled={accessBusy || !detail}
              size="default"
              type="button"
              variant="primary"
              onClick={() => void openPrivateFile()}
            >
              {accessBusy ? 'Preparing…' : accessUrl ? 'Refresh private link' : 'Open private file'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(removeTarget)}
        onOpenChange={(open) => !busy && !open && setRemoveTarget(null)}
      >
        <DialogContent aria-describedby="remove-personnel-document-description" size="compact">
          <form className="contents" onSubmit={remove}>
            <DialogHeader>
              <div className="grid gap-1.5">
                <DialogTitle>Remove Personnel Document link</DialogTitle>
                <DialogDescription id="remove-personnel-document-description">
                  Remove {removeTarget ? documentLabel(removeTarget) : 'this link'} from the
                  Employee only. The Document, exact version, and storage object remain preserved.
                </DialogDescription>
              </div>
              <DialogClose asChild>
                <Button
                  aria-label="Close remove Personnel Document dialog"
                  disabled={busy}
                  type="button"
                >
                  <span aria-hidden="true" className="text-xl leading-none">
                    ×
                  </span>
                </Button>
              </DialogClose>
            </DialogHeader>
            <DialogBody className="grid gap-5">
              {error ? (
                <p
                  role="alert"
                  className="m-0 rounded-[3px] bg-[#fdeeee] px-4 py-3 text-sm text-[#8f2d2d]"
                >
                  {error}
                </p>
              ) : null}
              <label className={employeeLabelClass}>
                Reason for removal
                <textarea
                  autoFocus
                  className={`${employeeInputClass} min-h-28 resize-y py-3`}
                  maxLength={500}
                  name="reason"
                  placeholder="Explain why this link was attached in error."
                  required
                />
              </label>
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button disabled={busy} size="default" type="button" variant="secondary">
                  Keep link
                </Button>
              </DialogClose>
              <Button
                className="border-[#9a3030] bg-[#9a3030] hover:bg-[#7d2525]"
                disabled={busy}
                size="default"
                type="submit"
                variant="primary"
              >
                {busy ? 'Removing…' : 'Remove link'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
