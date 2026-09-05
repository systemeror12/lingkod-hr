'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { manilaToday } from '../lib/manila-date';
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

interface ServiceRecordData {
  label: 'Printable System View';
  disclaimer: string;
  asOfDate: string;
  employee: { id: string; employeeNumber: string; legalName: string };
  serviceSegments: Array<{
    id: string;
    appointmentStatus: string;
    position: { itemNumber: string; title: string | null } | null;
    organizationUnit: { code: string; name: string | null };
    salaryGrade: number | null;
    salaryStep: number | null;
    effectiveFrom: string;
    effectiveTo: string | null;
  }>;
  personnelActions: Array<{
    id: string;
    actionType: string;
    status: string;
    proposedEffectivity: string;
  }>;
}

interface ServiceRecord {
  id: string;
  asOfDate: string;
  renderingContractVersion: string;
  snapshot: ServiceRecordData;
  employee: { id: string; employeeNumber: string; legalName: string };
  generatedBy: { id: string; displayName: string };
  generatedAt: string;
  supersedesSnapshotId: string | null;
  replacementSnapshotId: string | null;
  correctionReason: string | null;
}

export interface ServiceRecordListResponse {
  records: ServiceRecord[];
}

interface EmployeeOption {
  id: string;
  employeeNumber: string;
  legalName: string;
  serviceStatus: string;
}

interface DocumentOption {
  id: string;
  documentNo: string | null;
  documentType: string;
  status: string;
  currentVersion: { id: string; versionNo: number } | null;
}

type DialogKind = 'generate' | 'preview' | 'replace' | 'history' | null;

const inputClass =
  'min-h-11 w-full rounded-[3px] border border-line bg-paper px-3 text-sm text-ink outline-none focus:border-cobalt focus:ring-2 focus:ring-cobalt/20';

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Manila',
  }).format(new Date(value));
}

function targetValue(event: { currentTarget: EventTarget }): string {
  return (event.currentTarget as unknown as { value: string }).value;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof body === 'object' &&
      body !== null &&
      typeof (body as { error?: { message?: unknown } }).error?.message === 'string'
        ? (body as { error: { message: string } }).error.message
        : 'The Service Record request failed.';
    throw new Error(message);
  }
  return body as T;
}

export function ServiceRecordWorkspace({
  agencyId,
  canGenerate,
  canReplace,
  initial,
}: {
  agencyId: string;
  canGenerate: boolean;
  canReplace: boolean;
  initial: ServiceRecordListResponse;
}) {
  const [records, setRecords] = useState(initial.records);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [selected, setSelected] = useState<ServiceRecord | null>(null);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [documents, setDocuments] = useState<DocumentOption[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [asOfDate, setAsOfDate] = useState(manilaToday());
  const [reason, setReason] = useState('');
  const [evidenceDocumentId, setEvidenceDocumentId] = useState('');
  const [evidenceVersionId, setEvidenceVersionId] = useState('');
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const employeeRef = useRef<{ focus(): void } | null>(null);
  const reasonRef = useRef<{ focus(): void } | null>(null);
  const returnFocusRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (dialog !== 'generate' || employees.length > 0) return;
    setLoadingOptions(true);
    api<{ employees: EmployeeOption[] }>(`/api/v1/agencies/${agencyId}/employees`)
      .then(({ employees: options }) => setEmployees(options))
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : 'Loading failed.'),
      )
      .finally(() => setLoadingOptions(false));
  }, [agencyId, dialog, employees.length]);

  useEffect(() => {
    if (dialog !== 'replace' || documents.length > 0) return;
    setLoadingOptions(true);
    api<{ documents: DocumentOption[] }>(`/api/v1/agencies/${agencyId}/documents`)
      .then(({ documents: options }) =>
        setDocuments(
          options.filter(({ status, currentVersion }) => status === 'APPROVED' && currentVersion),
        ),
      )
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : 'Loading failed.'),
      )
      .finally(() => setLoadingOptions(false));
  }, [agencyId, dialog, documents.length]);

  function open(kind: Exclude<DialogKind, null>, record: ServiceRecord | null = null) {
    setSelected(record);
    setDialog(kind);
    setError('');
    setReason('');
    setEvidenceDocumentId('');
    setEvidenceVersionId('');
  }

  function rememberTrigger(event: { currentTarget: EventTarget }) {
    const target = event.currentTarget as unknown as { focus(): void };
    returnFocusRef.current = () => target.focus();
  }

  function restoreFocus(event: { preventDefault(): void }) {
    event.preventDefault();
    returnFocusRef.current?.();
  }

  async function generate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const record = await api<ServiceRecord>(`/api/v1/agencies/${agencyId}/service-records`, {
        method: 'POST',
        body: JSON.stringify({ employeeId, asOfDate }),
      });
      setRecords((current) => [record, ...current]);
      setSelected(record);
      setDialog('preview');
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Generation failed.');
    } finally {
      setBusy(false);
    }
  }

  async function replace(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      const replacement = await api<ServiceRecord>(
        `/api/v1/agencies/${agencyId}/service-records/${selected.id}/replace`,
        {
          method: 'POST',
          body: JSON.stringify({
            reason,
            evidenceDocumentId,
            evidenceDocumentVersionId: evidenceVersionId,
          }),
        },
      );
      setRecords((current) => [
        replacement,
        ...current.map((record) =>
          record.id === selected.id ? { ...record, replacementSnapshotId: replacement.id } : record,
        ),
      ]);
      setSelected(replacement);
      setDialog('preview');
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Replacement failed.');
    } finally {
      setBusy(false);
    }
  }

  const employeeHistory = selected
    ? records.filter(({ employee }) => employee.id === selected.employee.id)
    : [];

  return (
    <>
      <header className="mb-7 flex flex-col gap-5 min-[700px]:flex-row min-[700px]:items-end min-[700px]:justify-between">
        <div>
          <p className="m-0 mb-2 text-[11px] font-bold tracking-[.1em] text-cobalt uppercase">
            Personnel records
          </p>
          <h1 className="m-0 text-[30px] font-[720] tracking-[-.035em] text-midnight">
            Service records
          </h1>
          <p className="m-0 mt-2 max-w-2xl text-sm leading-6 text-muted">
            Reproduce effective-dated service history as immutable Printable System Views.
          </p>
        </div>
        {canGenerate ? (
          <Button
            size="default"
            type="button"
            variant="primary"
            onClick={(event) => {
              rememberTrigger(event);
              open('generate');
            }}
          >
            Generate record
          </Button>
        ) : null}
      </header>

      <section className="mb-5 grid gap-4 border-l-[3px] border-cobalt bg-[#edf3fb] px-5 py-4 min-[700px]:grid-cols-[1fr_auto] min-[700px]:items-center">
        <p className="m-0 text-sm leading-6 text-ink">
          Generated records are retained snapshots. Later source corrections do not rewrite them.
        </p>
        <strong className="font-mono text-2xl text-midnight">{records.length}</strong>
      </section>

      <section className="overflow-hidden rounded-[4px] border border-line bg-paper">
        {records.length === 0 ? (
          <p className="m-0 px-5 py-8 text-sm text-muted">
            No Service Records are available in your permitted record scope.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line bg-[#f9fafc] text-[10px] tracking-[.08em] text-muted uppercase">
                  <th className="px-5 py-3 font-bold">Employee</th>
                  <th className="px-5 py-3 font-bold">As of</th>
                  <th className="px-5 py-3 font-bold">Generated</th>
                  <th className="px-5 py-3 font-bold">Record chain</th>
                  <th className="px-5 py-3 font-bold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id} className="border-b border-line last:border-0">
                    <td className="px-5 py-4">
                      <strong className="block text-sm font-[650] text-ink">
                        {record.employee.legalName}
                      </strong>
                      <span className="font-mono text-xs text-muted">
                        {record.employee.employeeNumber}
                      </span>
                    </td>
                    <td className="px-5 py-4 font-mono text-xs text-ink">{record.asOfDate}</td>
                    <td className="px-5 py-4 text-xs text-muted">
                      {formatDateTime(record.generatedAt)} by {record.generatedBy.displayName}
                    </td>
                    <td className="px-5 py-4 text-xs text-muted">
                      {record.supersedesSnapshotId
                        ? 'Replacement'
                        : record.replacementSnapshotId
                          ? 'Superseded'
                          : 'Original'}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="default"
                          variant="secondary"
                          onClick={(event) => {
                            rememberTrigger(event);
                            open('preview', record);
                          }}
                        >
                          Preview
                        </Button>
                        <Button
                          size="default"
                          variant="secondary"
                          onClick={(event) => {
                            rememberTrigger(event);
                            open('history', record);
                          }}
                        >
                          History
                        </Button>
                        {canReplace && !record.replacementSnapshotId ? (
                          <Button
                            size="default"
                            variant="secondary"
                            onClick={(event) => {
                              rememberTrigger(event);
                              open('replace', record);
                            }}
                          >
                            Replace
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Dialog open={dialog !== null} onOpenChange={(value) => !value && !busy && setDialog(null)}>
        {dialog === 'generate' ? (
          <DialogContent
            aria-describedby="service-record-generate-description"
            onCloseAutoFocus={restoreFocus}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              employeeRef.current?.focus();
            }}
          >
            <DialogHeader>
              <div>
                <DialogTitle>Generate Service Record</DialogTitle>
                <DialogDescription id="service-record-generate-description">
                  Select an Employee and explicit as-of date. Service facts come from authoritative
                  history.
                </DialogDescription>
              </div>
              <DialogClose asChild>
                <Button aria-label="Close Service Record dialog">×</Button>
              </DialogClose>
            </DialogHeader>
            <form onSubmit={generate}>
              <DialogBody className="grid gap-5">
                {error ? (
                  <p className="m-0 text-sm text-[#a73333]" role="alert">
                    {error}
                  </p>
                ) : null}
                <label className="grid gap-2 text-sm font-[650] text-ink">
                  Employee
                  <select
                    ref={employeeRef}
                    className={inputClass}
                    required
                    value={employeeId}
                    onChange={(event) => setEmployeeId(targetValue(event))}
                  >
                    <option value="">Select an Employee</option>
                    {employees.map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.employeeNumber} · {employee.legalName} · {employee.serviceStatus}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-2 text-sm font-[650] text-ink">
                  As-of date
                  <input
                    className={inputClass}
                    required
                    type="date"
                    value={asOfDate}
                    onChange={(event) => setAsOfDate(targetValue(event))}
                  />
                </label>
                {loadingOptions ? (
                  <p className="m-0 text-sm text-muted" role="status">
                    Loading Employees…
                  </p>
                ) : null}
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button disabled={busy} size="default" variant="secondary">
                    Cancel
                  </Button>
                </DialogClose>
                <Button
                  disabled={busy || loadingOptions}
                  size="default"
                  type="submit"
                  variant="primary"
                >
                  {busy ? 'Generating…' : 'Generate record'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        ) : null}

        {dialog === 'preview' && selected ? (
          <DialogContent
            aria-describedby="service-record-preview-description"
            className="max-w-[900px]"
            onCloseAutoFocus={restoreFocus}
          >
            <DialogHeader>
              <div>
                <DialogTitle>{selected.snapshot.label}</DialogTitle>
                <DialogDescription id="service-record-preview-description">
                  {selected.snapshot.disclaimer}
                </DialogDescription>
              </div>
              <DialogClose asChild>
                <Button aria-label="Close Service Record preview">×</Button>
              </DialogClose>
            </DialogHeader>
            <DialogBody className="grid gap-6 print:overflow-visible">
              <div className="flex flex-wrap justify-between gap-4 border-b border-line pb-4">
                <div>
                  <strong className="block text-lg text-midnight">
                    {selected.employee.legalName}
                  </strong>
                  <span className="font-mono text-xs text-muted">
                    {selected.employee.employeeNumber}
                  </span>
                </div>
                <div className="text-right">
                  <span className="block text-[10px] font-bold tracking-[.08em] text-muted uppercase">
                    As of
                  </span>
                  <strong className="font-mono text-sm text-ink">{selected.asOfDate}</strong>
                </div>
              </div>
              <ol className="m-0 grid list-none gap-0 border-l-2 border-cobalt pl-6">
                {selected.snapshot.serviceSegments.map((segment) => (
                  <li
                    key={segment.id}
                    className="relative border-b border-line py-4 last:border-0 before:absolute before:top-6 before:-left-[31px] before:size-3 before:rounded-full before:border-2 before:border-cobalt before:bg-paper"
                  >
                    <div className="flex flex-wrap justify-between gap-2">
                      <strong className="text-sm text-ink">
                        {segment.position?.title ?? segment.appointmentStatus}
                      </strong>
                      <span className="font-mono text-xs text-muted">
                        {segment.effectiveFrom} to {segment.effectiveTo ?? 'present'}
                      </span>
                    </div>
                    <p className="m-0 mt-1 text-xs text-muted">
                      {segment.organizationUnit.name ?? segment.organizationUnit.code}
                      {segment.position ? ` · Item ${segment.position.itemNumber}` : ''}
                      {segment.salaryGrade
                        ? ` · SG ${segment.salaryGrade}-${segment.salaryStep}`
                        : ''}
                    </p>
                  </li>
                ))}
              </ol>
              {selected.snapshot.personnelActions.length > 0 ? (
                <section>
                  <h2 className="m-0 mb-3 text-[11px] font-bold tracking-[.1em] text-cobalt uppercase">
                    Supported Personnel Actions
                  </h2>
                  <ul className="m-0 grid gap-2 pl-5 text-sm text-ink">
                    {selected.snapshot.personnelActions.map((action) => (
                      <li key={action.id}>
                        {action.proposedEffectivity} · {action.actionType.replaceAll('_', ' ')}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button size="default" variant="secondary">
                  Close
                </Button>
              </DialogClose>
              <Button
                size="default"
                variant="primary"
                onClick={() => (globalThis as unknown as { print(): void }).print()}
              >
                Print view
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}

        {dialog === 'replace' && selected ? (
          <DialogContent
            aria-describedby="service-record-replace-description"
            size="compact"
            onCloseAutoFocus={restoreFocus}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              reasonRef.current?.focus();
            }}
          >
            <DialogHeader>
              <div>
                <DialogTitle>Confirm Service Record replacement</DialogTitle>
                <DialogDescription id="service-record-replace-description">
                  The original snapshot remains unchanged and linked to the replacement.
                </DialogDescription>
              </div>
              <DialogClose asChild>
                <Button aria-label="Close replacement dialog">×</Button>
              </DialogClose>
            </DialogHeader>
            <form onSubmit={replace}>
              <DialogBody className="grid gap-5">
                {error ? (
                  <p className="m-0 text-sm text-[#a73333]" role="alert">
                    {error}
                  </p>
                ) : null}
                <label className="grid gap-2 text-sm font-[650] text-ink">
                  Reason
                  <textarea
                    ref={reasonRef}
                    className={`${inputClass} min-h-24 py-3`}
                    required
                    value={reason}
                    onChange={(event) => setReason(targetValue(event))}
                  />
                </label>
                <label className="grid gap-2 text-sm font-[650] text-ink">
                  Correction evidence
                  <select
                    className={inputClass}
                    required
                    value={evidenceDocumentId}
                    onChange={(event) => {
                      const id = targetValue(event);
                      const document = documents.find((item) => item.id === id);
                      setEvidenceDocumentId(id);
                      setEvidenceVersionId(document?.currentVersion?.id ?? '');
                    }}
                  >
                    <option value="">Select approved evidence</option>
                    {documents.map((document) => (
                      <option key={document.id} value={document.id}>
                        {document.documentNo ?? document.documentType} · version{' '}
                        {document.currentVersion?.versionNo}
                      </option>
                    ))}
                  </select>
                </label>
                {loadingOptions ? (
                  <p className="m-0 text-sm text-muted" role="status">
                    Loading evidence…
                  </p>
                ) : null}
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button disabled={busy} size="default" variant="secondary">
                    Cancel
                  </Button>
                </DialogClose>
                <Button
                  disabled={busy || loadingOptions}
                  size="default"
                  type="submit"
                  variant="primary"
                >
                  {busy ? 'Replacing…' : 'Create replacement'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        ) : null}

        {dialog === 'history' && selected ? (
          <DialogContent
            aria-describedby="service-record-history-description"
            size="compact"
            onCloseAutoFocus={restoreFocus}
          >
            <DialogHeader>
              <div>
                <DialogTitle>Service Record history</DialogTitle>
                <DialogDescription id="service-record-history-description">
                  Every issued snapshot for {selected.employee.legalName} in your permitted scope.
                </DialogDescription>
              </div>
              <DialogClose asChild>
                <Button aria-label="Close Service Record history">×</Button>
              </DialogClose>
            </DialogHeader>
            <DialogBody>
              <ol className="m-0 grid list-none gap-3 p-0">
                {employeeHistory.map((record) => (
                  <li key={record.id} className="rounded-[3px] border border-line px-4 py-3">
                    <strong className="block text-sm text-ink">
                      {record.asOfDate} ·{' '}
                      {record.supersedesSnapshotId
                        ? 'Replacement'
                        : record.replacementSnapshotId
                          ? 'Superseded'
                          : 'Original'}
                    </strong>
                    <span className="text-xs text-muted">
                      Generated {formatDateTime(record.generatedAt)} by{' '}
                      {record.generatedBy.displayName}
                    </span>
                    {record.correctionReason ? (
                      <p className="m-0 mt-2 text-xs leading-5 text-muted">
                        {record.correctionReason}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button size="default" variant="secondary">
                  Close
                </Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}
