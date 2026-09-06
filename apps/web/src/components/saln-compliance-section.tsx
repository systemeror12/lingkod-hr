'use client';

import { useRecordNavigation } from './record-navigation';

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
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
} from './ui/dialog';
import { employeeInputClass, employeeLabelClass, formatEmployeeDate } from './employee-directory';

interface SalnRecord {
  id: string;
  requirementReference?: string;
  filingYear: number;
  filingType: string;
  status: string;
  submittedAt: string | null;
  repositoryReference?: string | null;
  acknowledgmentDocumentId?: string | null;
  acknowledgmentDocumentVersionId?: string | null;
  correctsRecordId?: string | null;
  correctionReason?: string | null;
  actorDisplayName?: string | null;
  createdAt: string;
}

interface EvidenceDocument {
  documentId: string;
  documentVersionId: string;
  label: string;
}

const emptyValues = {
  requirementReference: '',
  filingYear: String(new Date().getFullYear()),
  filingType: 'ANNUAL',
  status: 'NOT_SUBMITTED',
  submittedAt: '',
  repositoryReference: '',
  acknowledgment: '',
  reason: '',
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function nonEmptyText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function parseRecords(value: unknown): SalnRecord[] {
  if (!isObject(value) || !Array.isArray(value.records))
    throw new Error('The SALN compliance response was invalid.');
  return value.records.map((entry) => {
    if (!isObject(entry) || !nonEmptyText(entry.id) || typeof entry.filingYear !== 'number')
      throw new Error('A SALN compliance record was invalid.');
    return entry as unknown as SalnRecord;
  });
}

function errorMessage(value: unknown): string {
  return isObject(value) && isObject(value.error) && nonEmptyText(value.error.message)
    ? nonEmptyText(value.error.message)!
    : 'The SALN compliance request could not be completed.';
}

function evidenceDocuments(value: unknown): EvidenceDocument[] {
  if (!isObject(value) || !Array.isArray(value.documents)) return [];
  return value.documents.flatMap((entry) => {
    if (!isObject(entry)) return [];
    const documentId = nonEmptyText(entry.documentId);
    const documentVersionId = nonEmptyText(entry.documentVersionId);
    if (!documentId || !documentVersionId) return [];
    return [
      {
        documentId,
        documentVersionId,
        label:
          nonEmptyText(entry.documentNo) ??
          nonEmptyText(entry.documentType) ??
          'Acknowledgment evidence',
      },
    ];
  });
}

function dateTime(value: string): string | null {
  return value ? `${value}T00:00:00.000+08:00` : null;
}

export function SalnComplianceSection({
  agencyId,
  employeeId,
  endpoint: endpointOverride,
  canRead,
  canManage,
  canCorrect,
  canReadHistory,
  canReadEvidence,
}: {
  agencyId: string;
  employeeId?: string;
  endpoint?: string;
  canRead: boolean;
  canManage: boolean;
  canCorrect: boolean;
  canReadHistory: boolean;
  canReadEvidence: boolean;
}) {
  const endpoint =
    endpointOverride ?? `/api/v1/agencies/${agencyId}/employees/${employeeId}/saln-compliance`;
  const [items, setItems] = useState<SalnRecord[]>([]);
  const [history, setHistory] = useState<SalnRecord[]>([]);
  const [evidence, setEvidence] = useState<EvidenceDocument[]>([]);
  const [values, setValues] = useState(emptyValues);
  const [open, setOpen] = useState<'create' | 'update' | 'detail' | 'correct' | 'history' | null>(
    null,
  );
  const [selected, setSelected] = useState<SalnRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(canRead);
  const [error, setError] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    if (!canRead) return;
    try {
      const response = await fetch(endpoint, { credentials: 'include' });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorMessage(body));
      setItems(parseRecords(body));
      setError(null);
    } catch (caught: unknown) {
      setError(
        caught instanceof Error ? caught.message : 'SALN compliance records could not be loaded.',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [endpoint, canRead]);

  const navigation = useRecordNavigation();
  const salnId = navigation.search.get('saln');
  const salnHistory = navigation.search.get('salnHistory') === 'true';
  const historyRequest = useRef(0);
  useEffect(() => {
    historyRequest.current += 1;
    setBusy(false);
    if (!salnId && !salnHistory) {
      setOpen((current) => (current === 'detail' || current === 'history' ? null : current));
      return;
    }
    if (loading) return;
    if (salnHistory) {
      if (canReadHistory) begin('history');
      else setError('SALN history is outside your permitted scope.');
      return;
    }
    const record = items.find((item) => item.id === salnId);
    if (!record) {
      setError('This SALN record is missing or outside your permitted scope.');
      setSelected(null);
      setOpen(null);
      return;
    }
    begin('detail', record);
  }, [salnId, salnHistory, loading, canReadHistory]);

  async function loadEvidence(): Promise<void> {
    if (!canReadEvidence || !employeeId || evidence.length > 0) return;
    const response = await fetch(`/api/v1/agencies/${agencyId}/employees/${employeeId}/documents`, {
      credentials: 'include',
    });
    if (response.ok) setEvidence(evidenceDocuments(await response.json()));
  }

  function begin(kind: typeof open, record: SalnRecord | null = null): void {
    setSelected(record);
    setError(null);
    if (kind === 'create') setValues(emptyValues);
    if ((kind === 'update' || kind === 'correct') && record) {
      setValues({
        requirementReference: record.requirementReference ?? '',
        filingYear: String(record.filingYear),
        filingType: record.filingType,
        status: record.status,
        submittedAt: record.submittedAt?.slice(0, 10) ?? '',
        repositoryReference: record.repositoryReference ?? '',
        acknowledgment:
          record.acknowledgmentDocumentId && record.acknowledgmentDocumentVersionId
            ? `${record.acknowledgmentDocumentId}:${record.acknowledgmentDocumentVersionId}`
            : '',
        reason: '',
      });
    }
    setOpen(kind);
    if (kind === 'create' || kind === 'update' || kind === 'correct') void loadEvidence();
    if (kind === 'history') {
      const requestId = ++historyRequest.current;
      setHistory([]);
      setBusy(true);
      void fetch(`${endpoint}/history`, { credentials: 'include' })
        .then(async (response) => {
          const body: unknown = await response.json().catch(() => null);
          if (!response.ok) throw new Error(errorMessage(body));
          if (requestId === historyRequest.current) setHistory(parseRecords(body));
        })
        .catch((caught: unknown) => {
          if (requestId === historyRequest.current)
            setError(caught instanceof Error ? caught.message : 'History could not be loaded.');
        })
        .finally(() => {
          if (requestId === historyRequest.current) setBusy(false);
        });
    }
  }

  function change(name: keyof typeof values) {
    return (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const value = (event.currentTarget as unknown as { value: string }).value;
      setValues((current) => ({
        ...current,
        [name]: value,
      }));
    };
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const selectedEvidence = evidence.find(
        ({ documentId, documentVersionId }) =>
          `${documentId}:${documentVersionId}` === values.acknowledgment,
      );
      const payload = {
        requirementReference: values.requirementReference,
        filingYear: Number(values.filingYear),
        filingType: values.filingType,
        status: values.status,
        submittedAt: dateTime(values.submittedAt),
        repositoryReference: values.repositoryReference || null,
        acknowledgmentDocumentId: selectedEvidence?.documentId ?? null,
        acknowledgmentDocumentVersionId: selectedEvidence?.documentVersionId ?? null,
        ...(open === 'correct' ? { reason: values.reason } : {}),
      };
      const transitionEndpoint =
        selected && (open === 'correct' || open === 'update')
          ? `${endpoint}/${selected.id}/${open}`
          : endpoint;
      const response = await fetch(transitionEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const body: unknown = await response.json().catch(() => null);
      if (response.ok) {
        setOpen(null);
        await refresh();
      } else setError(errorMessage(body));
    } catch {
      setError('The SALN filing could not be saved. Check the connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!canRead && !canManage) return null;

  return (
    <section
      className="border-t border-line px-6 py-6 min-[700px]:px-8"
      aria-labelledby="saln-compliance-heading"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="saln-compliance-heading" className="m-0 text-base text-midnight">
            SALN filing compliance
          </h2>
          <p className="mt-1 mb-0 text-xs text-muted">
            Metadata only. SALN declarations and contents are not stored here.
          </p>
        </div>
        <div className="flex gap-2">
          {canReadHistory ? (
            <Button
              variant="secondary"
              onClick={() => navigation.navigate({ salnHistory: 'true', saln: null })}
            >
              History
            </Button>
          ) : null}
          {canManage ? <Button onClick={() => begin('create')}>Record filing</Button> : null}
        </div>
      </div>
      {error && !open ? (
        <p role="alert" className="text-sm text-[#8f2d2d]">
          {error}
        </p>
      ) : null}
      {loading ? (
        <p role="status" className="text-sm text-muted">
          Loading SALN compliance metadata…
        </p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted">No SALN compliance metadata is recorded.</p>
      ) : (
        <div className="mt-4 grid gap-3">
          {items.map((record) => (
            <article
              key={record.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-[4px] border border-line bg-canvas/35 p-4"
            >
              <div>
                <strong className="text-sm text-midnight">
                  {record.filingYear} · {record.filingType}
                </strong>
                <p className="mt-1 mb-0 text-xs text-muted">{record.status.replaceAll('_', ' ')}</p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() => navigation.navigate({ saln: record.id, salnHistory: null })}
                >
                  Details
                </Button>
                {canManage ? (
                  <Button variant="secondary" onClick={() => begin('update', record)}>
                    Update
                  </Button>
                ) : null}
                {canCorrect ? (
                  <Button variant="secondary" onClick={() => begin('correct', record)}>
                    Correct
                  </Button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}

      <Dialog
        presentation="form"
        open={open !== null}
        onOpenChange={(value) => {
          if (!value && !busy) {
            navigation.navigate({ saln: null, salnHistory: null });
            setOpen(null);
          }
        }}
      >
        <DialogContent aria-describedby="saln-dialog-description" size="compact">
          <DialogHeader>
            <div className="grid gap-1.5">
              <DialogTitle>
                {open === 'create'
                  ? 'Record SALN filing metadata'
                  : open === 'update'
                    ? 'Update SALN filing metadata'
                    : open === 'correct'
                      ? 'Correct SALN filing metadata'
                      : open === 'history'
                        ? 'SALN compliance history'
                        : 'SALN filing details'}
              </DialogTitle>
              <DialogDescription id="saln-dialog-description">
                This surface stores compliance metadata only. Do not enter declaration contents.
              </DialogDescription>
            </div>
            <DialogClose asChild>
              <Button aria-label="Close SALN compliance dialog" disabled={busy}>
                ×
              </Button>
            </DialogClose>
          </DialogHeader>
          {open === 'create' || open === 'update' || open === 'correct' ? (
            <form className="contents" onSubmit={submit}>
              <DialogBody className="grid gap-4">
                {error ? (
                  <p role="alert" className="m-0 text-sm text-[#8f2d2d]">
                    {error}
                  </p>
                ) : null}
                <label className={employeeLabelClass}>
                  Authorized requirement reference
                  <input
                    autoFocus
                    data-autofocus=""
                    required
                    className={employeeInputClass}
                    value={values.requirementReference}
                    onChange={change('requirementReference')}
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className={employeeLabelClass}>
                    Filing year
                    <input
                      required
                      type="number"
                      min="1900"
                      max="2200"
                      className={employeeInputClass}
                      value={values.filingYear}
                      onChange={change('filingYear')}
                    />
                  </label>
                  <label className={employeeLabelClass}>
                    Filing type
                    <input
                      required
                      className={employeeInputClass}
                      value={values.filingType}
                      onChange={change('filingType')}
                    />
                  </label>
                </div>
                <label className={employeeLabelClass}>
                  Filing status
                  <select
                    className={employeeInputClass}
                    value={values.status}
                    onChange={change('status')}
                  >
                    <option value="NOT_SUBMITTED">Not submitted</option>
                    <option value="SUBMITTED">Submitted</option>
                    <option value="ACKNOWLEDGED">Acknowledged</option>
                  </select>
                </label>
                {values.status !== 'NOT_SUBMITTED' ? (
                  <label className={employeeLabelClass}>
                    Submission date
                    <input
                      required
                      type="date"
                      className={employeeInputClass}
                      value={values.submittedAt}
                      onChange={change('submittedAt')}
                    />
                  </label>
                ) : null}
                <label className={employeeLabelClass}>
                  Repository reference
                  <input
                    className={employeeInputClass}
                    value={values.repositoryReference}
                    onChange={change('repositoryReference')}
                  />
                </label>
                {canReadEvidence ? (
                  <label className={employeeLabelClass}>
                    Acknowledgment evidence
                    <select
                      className={employeeInputClass}
                      value={values.acknowledgment}
                      onChange={change('acknowledgment')}
                    >
                      <option value="">No acknowledgment attached</option>
                      {evidence.map((item) => (
                        <option
                          key={`${item.documentId}:${item.documentVersionId}`}
                          value={`${item.documentId}:${item.documentVersionId}`}
                        >
                          {item.label} · exact version {item.documentVersionId}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {open === 'correct' ? (
                  <label className={employeeLabelClass}>
                    Correction reason
                    <textarea
                      autoFocus
                      required
                      className={employeeInputClass}
                      value={values.reason}
                      onChange={(event) => {
                        const reason = (event.currentTarget as unknown as { value: string }).value;
                        setValues((current) => ({ ...current, reason }));
                      }}
                    />
                  </label>
                ) : null}
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="secondary" disabled={busy}>
                    Cancel
                  </Button>
                </DialogClose>
                <Button type="submit" disabled={busy}>
                  {busy
                    ? 'Saving…'
                    : open === 'correct'
                      ? 'Record correction'
                      : open === 'update'
                        ? 'Save update'
                        : 'Record filing'}
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <>
              <DialogBody className="grid gap-3">
                {error ? (
                  <p role="alert" className="m-0 text-sm text-[#8f2d2d]">
                    {error}
                  </p>
                ) : null}
                {busy ? (
                  <p role="status">Loading…</p>
                ) : (
                  (open === 'history' ? history : selected ? [selected] : []).map((record) => (
                    <article key={record.id} className="rounded-[4px] border border-line p-4">
                      <strong>
                        {record.filingYear} · {record.filingType}
                      </strong>
                      <p className="text-sm">Status: {record.status.replaceAll('_', ' ')}</p>
                      {record.requirementReference ? (
                        <p className="text-sm">Requirement: {record.requirementReference}</p>
                      ) : null}
                      {record.submittedAt ? (
                        <p className="text-sm">
                          Submitted: {formatEmployeeDate(record.submittedAt)}
                        </p>
                      ) : null}
                      {record.repositoryReference ? (
                        <p className="text-sm">
                          Repository reference: {record.repositoryReference}
                        </p>
                      ) : null}
                      {record.acknowledgmentDocumentVersionId ? (
                        <p className="break-all text-sm">
                          Acknowledgment version: {record.acknowledgmentDocumentVersionId}
                        </p>
                      ) : null}
                      {record.correctionReason ? (
                        <p className="text-sm">Change reason: {record.correctionReason}</p>
                      ) : null}
                      <p className="mb-0 text-xs text-muted">
                        Recorded {formatEmployeeDate(record.createdAt)}
                        {record.actorDisplayName ? ` by ${record.actorDisplayName}` : ''}
                      </p>
                    </article>
                  ))
                )}
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="secondary">Close</Button>
                </DialogClose>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
