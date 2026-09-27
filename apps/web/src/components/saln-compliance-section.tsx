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
import { formatEmployeeDate } from './employee-directory';
import { FormError, inputClass, labelClass } from './ui/field';
import { Panel } from './ui/panel';
import { StatusTag, type StatusTone } from './ui/status-tag';
import { Table, Td, Th, Tr } from './ui/table';
import { StateSurface } from './state-surface';

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

const filingTone: Record<string, StatusTone> = {
  NOT_SUBMITTED: 'neutral',
  SUBMITTED: 'info',
  ACKNOWLEDGED: 'success',
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
    <Panel
      title="SALN filing compliance"
      flush
      actions={
        canReadHistory || canManage ? (
          <>
            {canReadHistory ? (
              <Button
                variant="secondary"
                onClick={() => navigation.navigate({ salnHistory: 'true', saln: null })}
              >
                History
              </Button>
            ) : null}
            {canManage ? (
              <Button variant="primary" onClick={() => begin('create')}>
                Record filing
              </Button>
            ) : null}
          </>
        ) : null
      }
    >
      <div className="grid gap-3 px-4 pt-3">
        <p className="m-0 text-small text-ink-muted">
          Metadata only. SALN declarations and contents are not stored here.
        </p>
        {!open ? <FormError message={error ?? ''} /> : null}
      </div>
      {loading ? (
        <StateSurface compact busy>
          <p role="status" className="m-0">
            Loading SALN compliance metadata…
          </p>
        </StateSurface>
      ) : items.length === 0 ? (
        <StateSurface compact>
          <p className="m-0">No SALN compliance metadata is recorded.</p>
        </StateSurface>
      ) : (
        <Table className="mt-3">
          <thead>
            <tr>
              <Th>Filing</Th>
              <Th>Status</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {items.map((record) => (
              <Tr key={record.id} selected={record.id === salnId}>
                <Td className="font-[600] text-ink">
                  {record.filingYear} · {record.filingType}
                </Td>
                <Td>
                  <StatusTag tone={filingTone[record.status] ?? 'neutral'}>
                    {record.status.replaceAll('_', ' ')}
                  </StatusTag>
                </Td>
                <Td>
                  <div className="flex flex-wrap justify-end gap-2">
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
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
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
        <DialogContent
          aria-describedby="saln-dialog-description"
          className="rounded-none border-x-0 border-b-0"
        >
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
                <FormError message={error ?? ''} />
                <label className={labelClass}>
                  Authorized requirement reference
                  <input
                    autoFocus
                    data-autofocus=""
                    required
                    className={inputClass}
                    value={values.requirementReference}
                    onChange={change('requirementReference')}
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className={labelClass}>
                    Filing year
                    <input
                      required
                      type="number"
                      min="1900"
                      max="2200"
                      className={inputClass}
                      value={values.filingYear}
                      onChange={change('filingYear')}
                    />
                  </label>
                  <label className={labelClass}>
                    Filing type
                    <input
                      required
                      className={inputClass}
                      value={values.filingType}
                      onChange={change('filingType')}
                    />
                  </label>
                </div>
                <label className={labelClass}>
                  Filing status
                  <select className={inputClass} value={values.status} onChange={change('status')}>
                    <option value="NOT_SUBMITTED">Not submitted</option>
                    <option value="SUBMITTED">Submitted</option>
                    <option value="ACKNOWLEDGED">Acknowledged</option>
                  </select>
                </label>
                {values.status !== 'NOT_SUBMITTED' ? (
                  <label className={labelClass}>
                    Submission date
                    <input
                      required
                      type="date"
                      className={inputClass}
                      value={values.submittedAt}
                      onChange={change('submittedAt')}
                    />
                  </label>
                ) : null}
                <label className={labelClass}>
                  Repository reference
                  <input
                    className={inputClass}
                    value={values.repositoryReference}
                    onChange={change('repositoryReference')}
                  />
                </label>
                {canReadEvidence ? (
                  <label className={labelClass}>
                    Acknowledgment evidence
                    <select
                      className={inputClass}
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
                  <label className={labelClass}>
                    Correction reason
                    <textarea
                      autoFocus
                      required
                      className={inputClass}
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
                <Button type="submit" variant="primary" disabled={busy}>
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
              <DialogBody className={open === 'history' && !busy ? 'p-0' : 'grid gap-3'}>
                {error ? (
                  <div className={open === 'history' && !busy ? 'p-5' : undefined}>
                    <FormError message={error} />
                  </div>
                ) : null}
                {busy ? (
                  <p role="status" className="m-0 text-small text-ink-muted">
                    Loading…
                  </p>
                ) : open === 'history' ? (
                  <Table>
                    <thead>
                      <tr>
                        <Th>Filing</Th>
                        <Th>Status</Th>
                        <Th>Requirement</Th>
                        <Th kind="date">Submitted</Th>
                        <Th>Repository reference</Th>
                        <Th>Acknowledgment version</Th>
                        <Th>Change reason</Th>
                        <Th>Recorded</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((record) => (
                        <Tr key={record.id}>
                          <Td className="font-[600] text-ink">
                            {record.filingYear} · {record.filingType}
                          </Td>
                          <Td>{record.status.replaceAll('_', ' ')}</Td>
                          <Td>{record.requirementReference}</Td>
                          <Td kind="date">
                            {record.submittedAt ? formatEmployeeDate(record.submittedAt) : null}
                          </Td>
                          <Td>{record.repositoryReference}</Td>
                          <Td className="break-all">{record.acknowledgmentDocumentVersionId}</Td>
                          <Td>{record.correctionReason}</Td>
                          <Td>
                            {formatEmployeeDate(record.createdAt)}
                            {record.actorDisplayName ? ` by ${record.actorDisplayName}` : ''}
                          </Td>
                        </Tr>
                      ))}
                    </tbody>
                  </Table>
                ) : selected ? (
                  <dl className="m-0 grid gap-4">
                    {(
                      [
                        ['Filing', `${selected.filingYear} · ${selected.filingType}`],
                        ['Status', selected.status.replaceAll('_', ' ')],
                        ['Requirement', selected.requirementReference],
                        [
                          'Submitted',
                          selected.submittedAt ? formatEmployeeDate(selected.submittedAt) : null,
                        ],
                        ['Repository reference', selected.repositoryReference],
                        ['Acknowledgment version', selected.acknowledgmentDocumentVersionId],
                        ['Change reason', selected.correctionReason],
                        [
                          'Recorded',
                          `${formatEmployeeDate(selected.createdAt)}${
                            selected.actorDisplayName ? ` by ${selected.actorDisplayName}` : ''
                          }`,
                        ],
                      ] as const
                    )
                      .filter(([, value]) => value)
                      .map(([label, value]) => (
                        <div key={label}>
                          <dt className="text-caption text-ink-muted">{label}</dt>
                          <dd className="m-0 break-words text-body font-[600] text-ink">{value}</dd>
                        </div>
                      ))}
                  </dl>
                ) : null}
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
    </Panel>
  );
}
