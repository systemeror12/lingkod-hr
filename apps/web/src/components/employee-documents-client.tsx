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
import { formatEmployeeDate, titleCase } from './employee-directory';
import { FormError, inputClass, labelClass } from './ui/field';
import { Panel } from './ui/panel';
import { StatusTag, type StatusTone } from './ui/status-tag';
import { Table, Td, Th, Tr } from './ui/table';
import { StateSurface } from './state-surface';

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

const releaseTone: Record<EmployeeDocument['releaseState'], StatusTone> = {
  PENDING: 'warning',
  RELEASED: 'success',
  WITHHELD: 'neutral',
};

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
    <Panel
      title="Personnel Documents"
      flush
      actions={
        <>
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
                    <FormError message={error ?? ''} />
                    {sourceLoading ? (
                      <p role="status" className="m-0 text-small text-ink-muted">
                        Loading finalized Agency Documents…
                      </p>
                    ) : null}
                    <label className={labelClass}>
                      Document Version
                      <select
                        autoFocus
                        className={inputClass}
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
                    <label className={labelClass}>
                      Exact version ID
                      <input
                        className={inputClass}
                        name="documentVersionId"
                        value={selectedVersionId}
                        readOnly
                        placeholder="Select a Document Version above"
                        required
                      />
                    </label>
                    <label className={labelClass}>
                      Personnel classification
                      <select
                        className={inputClass}
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
                    <label className={labelClass}>
                      Purpose
                      <select
                        className={inputClass}
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
                    <label className={labelClass}>
                      Release state
                      <select
                        className={inputClass}
                        name="releaseState"
                        defaultValue="RELEASED"
                        required
                      >
                        <option value="RELEASED">Released for authorized access</option>
                        <option value="WITHHELD">Withheld from Employee self-service</option>
                      </select>
                    </label>
                    <p className="m-0 border-l-2 border-info bg-canvas px-3 py-2.5 text-small text-ink-muted">
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
                    <FormError message={error ?? ''} />
                    <label className={labelClass}>
                      File
                      <input
                        className={inputClass}
                        name="file"
                        type="file"
                        accept="application/pdf,image/png,image/jpeg,text/plain"
                        required
                      />
                    </label>
                    <label className={labelClass}>
                      Document classification
                      <select
                        className={inputClass}
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
                    <label className={labelClass}>
                      Personnel classification
                      <select
                        className={inputClass}
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
                    <label className={labelClass}>
                      Purpose
                      <select
                        className={inputClass}
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
        </>
      }
    >
      <div className="grid gap-3 px-4 pt-3">
        <p className="m-0 text-small text-ink-muted">
          Each link points to one exact immutable Document Version. Removing a link never deletes
          the source evidence.
        </p>
        {message ? (
          <p role="status" className="m-0 text-small text-success">
            {message}
          </p>
        ) : null}
        {!linkOpen && !uploadOpen && !removeTarget ? <FormError message={error ?? ''} /> : null}
      </div>
      {loading ? (
        <StateSurface compact busy>
          <p role="status" className="m-0">
            Loading Personnel Documents…
          </p>
        </StateSurface>
      ) : documents.length === 0 ? (
        <StateSurface compact>
          <p className="m-0">No Personnel Documents are visible in this scope.</p>
        </StateSurface>
      ) : (
        <Table className="mt-3">
          <thead>
            <tr>
              <Th>Document</Th>
              <Th>Release state</Th>
              <Th>Classification</Th>
              <Th>File</Th>
              <Th kind="date">Created</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {documents.map((document) => (
              <Tr key={document.id} selected={document.id === documentId}>
                <Td>
                  <span className="font-[600] text-ink">{documentLabel(document)}</span>
                  <span className="block text-caption text-ink-muted">
                    Version {document.versionNo} · {human(document.status)} ·{' '}
                    {titleCase(document.classification)}
                  </span>
                </Td>
                <Td>
                  <StatusTag tone={releaseTone[document.releaseState]}>
                    {human(document.releaseState)}
                  </StatusTag>
                </Td>
                <Td>
                  {human(document.personnelClassification)}
                  <span className="block text-caption text-ink-muted">
                    {purposeLabels[document.purpose] ?? human(document.purpose)}
                  </span>
                </Td>
                <Td>
                  {document.mimeType}
                  <span className="block text-caption text-ink-muted tabular-nums">
                    {document.sizeBytes.toLocaleString()} bytes
                  </span>
                </Td>
                <Td kind="date">{formatEmployeeDate(document.createdAt)}</Td>
                <Td>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button variant="secondary" onClick={() => void inspect(document)}>
                      Inspect document
                    </Button>
                    {canManage || canRemoveOwn ? (
                      <Button variant="secondary" onClick={() => setRemoveTarget(document)}>
                        Remove link
                      </Button>
                    ) : null}
                  </div>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}

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
        <DialogContent
          aria-describedby="personnel-document-detail-description"
          className="rounded-none border-x-0 border-b-0"
        >
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
                    <dt className="text-caption text-ink-muted">{label}</dt>
                    <dd className="m-0 break-words text-body font-[600] text-ink">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {accessUrl ? (
              <p className="m-0 text-small">
                <a
                  className="font-[650] text-primary underline"
                  href={accessUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  Open private file
                </a>
              </p>
            ) : null}
            <FormError message={error ?? ''} />
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
              <FormError message={error ?? ''} />
              <label className={labelClass}>
                Reason for removal
                <textarea
                  autoFocus
                  className={`${inputClass} min-h-28 resize-y py-3`}
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
                className="border-danger bg-danger hover:border-danger hover:bg-danger/90"
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
    </Panel>
  );
}
