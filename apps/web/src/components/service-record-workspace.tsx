'use client';

import { useRecordNavigation } from './record-navigation';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { manilaToday } from '../lib/manila-date';
import { StateCode, StateSurface } from './state-surface';
import { Button } from './ui/button';
import { Field, FormError, inputClass } from './ui/field';
import { PageHeader, type Breadcrumb } from './ui/page-header';
import { Panel } from './ui/panel';
import { StatusTag, type StatusTone } from './ui/status-tag';
import { RowHeader, Table, Td, Th, Tr } from './ui/table';
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
  nextCursor: string | null;
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

type RecordChain = 'Original' | 'Replacement' | 'Superseded';

const chainTone: Record<RecordChain, StatusTone> = {
  Original: 'success',
  Replacement: 'info',
  Superseded: 'neutral',
};

function recordChain(record: ServiceRecord): RecordChain {
  return record.supersedesSnapshotId
    ? 'Replacement'
    : record.replacementSnapshotId
      ? 'Superseded'
      : 'Original';
}

function RecordChainTag({ record }: { record: ServiceRecord }) {
  const chain = recordChain(record);
  return <StatusTag tone={chainTone[chain]}>{chain}</StatusTag>;
}

const sectionTitleClass = 'm-0 text-panel-title text-ink';

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
  const navigation = useRecordNavigation();
  const recordId = navigation.search.get('record');
  const historyView = navigation.search.get('section') === 'history';
  useEffect(() => {
    let active = true;
    setSelected(null);
    setError('');
    setDialog(null);
    if (!recordId) return;
    void api<ServiceRecord>(
      `/api/v1/agencies/${agencyId}/service-records/${encodeURIComponent(recordId)}`,
    )
      .then((record) => {
        if (!active) return;
        setSelected(record);
        setRecords((current) => [record, ...current.filter((item) => item.id !== record.id)]);
        setDialog(historyView ? 'history' : 'preview');
      })
      .catch((cause: unknown) => {
        if (active)
          setError(cause instanceof Error ? cause.message : 'This Service Record is unavailable.');
      });
    return () => {
      active = false;
    };
  }, [recordId, historyView]);

  const [nextCursor, setNextCursor] = useState(initial.nextCursor);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [loadedSelected, setSelected] = useState<ServiceRecord | null>(null);
  const selected =
    loadedSelected && (!recordId || loadedSelected.id === recordId) ? loadedSelected : null;
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
  const [listError, setListError] = useState('');
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
    if (record && (kind === 'preview' || kind === 'history')) {
      navigation.navigate({
        record: record.id,
        view: 'form',
        section: kind === 'history' ? 'history' : null,
      });
      return;
    }
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
    if (busy) return;
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
      navigation.navigate({ record: record.id, view: 'form', section: null });
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Generation failed.');
    } finally {
      setBusy(false);
    }
  }

  async function replace(event: FormEvent) {
    event.preventDefault();
    if (!selected || busy) return;
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
      navigation.navigate({ record: replacement.id, view: 'form', section: null });
      setDialog('preview');
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Replacement failed.');
    } finally {
      setBusy(false);
    }
  }

  async function loadMore() {
    if (!nextCursor || busy) return;
    setBusy(true);
    setListError('');
    try {
      const page = await api<ServiceRecordListResponse>(
        `/api/v1/agencies/${agencyId}/service-records?cursor=${encodeURIComponent(nextCursor)}`,
      );
      setRecords((current) => [
        ...current,
        ...page.records.filter((record) => !current.some((item) => item.id === record.id)),
      ]);
      setNextCursor(page.nextCursor);
    } catch (cause: unknown) {
      setListError(cause instanceof Error ? cause.message : 'Loading failed.');
    } finally {
      setBusy(false);
    }
  }

  const employeeHistory = selected
    ? records
        .filter(({ employee }) => employee.id === selected.employee.id)
        .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt) || b.id.localeCompare(a.id))
    : [];

  const breadcrumbs: Breadcrumb[] = [{ label: 'Personnel' }];
  // Only record views change the URL, so only they can link back to the register.
  if (recordId) {
    breadcrumbs.push({
      label: 'Service Records',
      href: navigation.href({ record: null, view: null, section: null }),
    });
    if (selected) breadcrumbs.push({ label: selected.employee.legalName });
  }

  return (
    <div className="grid min-w-0 gap-5">
      <PageHeader
        breadcrumbs={breadcrumbs}
        title="Service Records"
        actions={
          canGenerate ? (
            <Button
              // Hidden rather than unmounted, so focus can return here when a dialog closes.
              hidden={Boolean(recordId)}
              type="button"
              variant="primary"
              onClick={(event) => {
                rememberTrigger(event);
                open('generate');
              }}
            >
              Generate record
            </Button>
          ) : null
        }
      />

      {recordId && !selected ? (
        error ? (
          <StateSurface labelledBy="service-record-state-title">
            <StateCode>Unavailable</StateCode>
            <h2 className="m-0 text-page-title text-ink" id="service-record-state-title">
              This Service Record could not be opened
            </h2>
            <p className="m-0 max-w-[500px] text-body text-ink-muted" role="alert">
              {error}
            </p>
          </StateSurface>
        ) : (
          <StateSurface busy label="Service Record">
            <StateCode>Loading</StateCode>
            <p className="m-0 text-body text-ink-muted" role="status">
              Loading Service Record…
            </p>
          </StateSurface>
        )
      ) : null}

      <Panel
        title="Snapshot register"
        flush
        hidden={Boolean(recordId)}
        actions={
          <dl className="m-0 flex gap-1.5 text-caption text-ink-muted">
            <dt>Loaded</dt>
            <dd className="m-0 font-[650] text-ink">{records.length}</dd>
          </dl>
        }
      >
        <div className="grid gap-3 px-4 pt-3">
          <p className="m-0 max-w-[760px] text-small text-ink-muted">
            Reproduce effective-dated service history as immutable Printable System Views. Generated
            records are retained snapshots. Later source corrections do not rewrite them.
          </p>
          <FormError message={listError} />
        </div>
        {records.length === 0 ? (
          <StateSurface compact label="Service Record register">
            <p className="m-0">No Service Records are available in your permitted record scope.</p>
          </StateSurface>
        ) : (
          <Table aria-label="Service Records" className="mt-3 min-w-[820px]">
            <thead>
              <tr>
                <Th>Employee</Th>
                <Th kind="date">As of</Th>
                <Th>Generated</Th>
                <Th>Record chain</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <Tr key={record.id}>
                  <RowHeader>
                    {record.employee.legalName}
                    <span className="block font-mono text-caption font-normal text-ink-muted">
                      {record.employee.employeeNumber}
                    </span>
                  </RowHeader>
                  <Td kind="date">{record.asOfDate}</Td>
                  <Td className="text-ink-muted">
                    {formatDateTime(record.generatedAt)} by {record.generatedBy.displayName}
                  </Td>
                  <Td>
                    <RecordChainTag record={record} />
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={(event) => {
                          rememberTrigger(event);
                          open('preview', record);
                        }}
                      >
                        Preview
                      </Button>
                      <Button
                        type="button"
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
                          type="button"
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
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        {nextCursor ? (
          <div className="flex justify-center px-4 py-3">
            <Button disabled={busy} type="button" variant="secondary" onClick={loadMore}>
              {busy ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        ) : null}
      </Panel>

      <Dialog
        presentation={dialog === 'preview' || dialog === 'history' ? 'form' : 'dialog'}
        open={dialog !== null}
        onOpenChange={(value) => {
          if (!value && !busy) {
            setDialog(null);
            navigation.navigate({ record: null, view: null, section: null });
          }
        }}
      >
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
              <div className="grid min-w-0 gap-1.5">
                <DialogTitle>Generate Service Record</DialogTitle>
                <DialogDescription id="service-record-generate-description">
                  Select an Employee and explicit as-of date. Service facts come from authoritative
                  history.
                </DialogDescription>
              </div>
              <DialogClose asChild>
                <Button aria-label="Close Service Record dialog" type="button">
                  <span aria-hidden="true" className="text-xl leading-none">
                    ×
                  </span>
                </Button>
              </DialogClose>
            </DialogHeader>
            <form className="flex min-h-0 flex-1 flex-col" onSubmit={generate}>
              <DialogBody className="grid gap-5">
                <FormError message={error} />
                <Field htmlFor="service-record-employee" label="Employee">
                  <select
                    ref={employeeRef}
                    className={inputClass}
                    id="service-record-employee"
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
                </Field>
                <Field htmlFor="service-record-as-of" label="As-of date">
                  <input
                    className={inputClass}
                    id="service-record-as-of"
                    required
                    type="date"
                    value={asOfDate}
                    onChange={(event) => setAsOfDate(targetValue(event))}
                  />
                </Field>
                {loadingOptions ? (
                  <StateSurface compact busy label="Employee choices">
                    <p className="m-0" role="status">
                      Loading Employees…
                    </p>
                  </StateSurface>
                ) : null}
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button disabled={busy} type="button" variant="secondary">
                    Cancel
                  </Button>
                </DialogClose>
                <Button disabled={busy || loadingOptions} type="submit" variant="primary">
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
              <div className="grid min-w-0 gap-1.5">
                <div className="flex flex-wrap items-center gap-3">
                  <DialogTitle>{selected.snapshot.label}</DialogTitle>
                  <RecordChainTag record={selected} />
                </div>
                <DialogDescription id="service-record-preview-description">
                  {selected.snapshot.disclaimer}
                </DialogDescription>
              </div>
              <DialogClose asChild>
                <Button aria-label="Close Service Record preview" type="button">
                  <span aria-hidden="true" className="text-xl leading-none">
                    ×
                  </span>
                </Button>
              </DialogClose>
            </DialogHeader>
            <DialogBody className="grid gap-6 print:overflow-visible">
              <dl className="m-0 flex flex-wrap gap-x-10 gap-y-3">
                <div>
                  <dt className="text-caption text-ink-muted">Employee</dt>
                  <dd className="m-0 text-body font-[600] text-ink">
                    {selected.employee.legalName}
                  </dd>
                </div>
                <div>
                  <dt className="text-caption text-ink-muted">Employee number</dt>
                  <dd className="m-0 font-mono text-body text-ink">
                    {selected.employee.employeeNumber}
                  </dd>
                </div>
                <div>
                  <dt className="text-caption text-ink-muted">As of</dt>
                  <dd className="m-0 font-mono text-body text-ink">{selected.asOfDate}</dd>
                </div>
              </dl>
              <section className="grid gap-3" aria-labelledby="service-record-segments">
                <h3 className={sectionTitleClass} id="service-record-segments">
                  Service history
                </h3>
                <Table aria-labelledby="service-record-segments" className="min-w-[720px]">
                  <thead>
                    <tr>
                      <Th>Position</Th>
                      <Th>Appointment status</Th>
                      <Th>Organization Unit</Th>
                      <Th>Salary</Th>
                      <Th kind="date">From</Th>
                      <Th kind="date">To</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.snapshot.serviceSegments.map((segment) => (
                      <Tr key={segment.id}>
                        <RowHeader>
                          {segment.position?.title ?? '—'}
                          {segment.position ? (
                            <span className="block font-mono text-caption font-normal text-ink-muted">
                              Item {segment.position.itemNumber}
                            </span>
                          ) : null}
                        </RowHeader>
                        <Td>{segment.appointmentStatus}</Td>
                        <Td>{segment.organizationUnit.name ?? segment.organizationUnit.code}</Td>
                        <Td className="whitespace-nowrap">
                          {segment.salaryGrade
                            ? `SG ${segment.salaryGrade}-${segment.salaryStep}`
                            : '—'}
                        </Td>
                        <Td kind="date">{segment.effectiveFrom}</Td>
                        <Td kind="date">{segment.effectiveTo ?? 'present'}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </section>
              {selected.snapshot.personnelActions.length > 0 ? (
                <section className="grid gap-3" aria-labelledby="service-record-actions">
                  <h3 className={sectionTitleClass} id="service-record-actions">
                    Supported Personnel Actions
                  </h3>
                  <Table aria-labelledby="service-record-actions">
                    <thead>
                      <tr>
                        <Th kind="date">Effectivity</Th>
                        <Th>Action</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.snapshot.personnelActions.map((action) => (
                        <Tr key={action.id}>
                          <Td kind="date">{action.proposedEffectivity}</Td>
                          <Td>{action.actionType.replaceAll('_', ' ')}</Td>
                        </Tr>
                      ))}
                    </tbody>
                  </Table>
                </section>
              ) : null}
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="secondary">
                  Close
                </Button>
              </DialogClose>
              <Button
                type="button"
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
              <div className="grid min-w-0 gap-1.5">
                <DialogTitle>Confirm Service Record replacement</DialogTitle>
                <DialogDescription id="service-record-replace-description">
                  The original snapshot remains unchanged and linked to the replacement.
                </DialogDescription>
              </div>
              <DialogClose asChild>
                <Button aria-label="Close replacement dialog" type="button">
                  <span aria-hidden="true" className="text-xl leading-none">
                    ×
                  </span>
                </Button>
              </DialogClose>
            </DialogHeader>
            <form className="flex min-h-0 flex-1 flex-col" onSubmit={replace}>
              <DialogBody className="grid gap-5">
                <FormError message={error} />
                <Field htmlFor="service-record-reason" label="Reason">
                  <textarea
                    ref={reasonRef}
                    className={`${inputClass} min-h-24 resize-y py-3`}
                    id="service-record-reason"
                    required
                    value={reason}
                    onChange={(event) => setReason(targetValue(event))}
                  />
                </Field>
                <Field htmlFor="service-record-evidence" label="Correction evidence">
                  <select
                    className={inputClass}
                    id="service-record-evidence"
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
                </Field>
                {loadingOptions ? (
                  <StateSurface compact busy label="Evidence choices">
                    <p className="m-0" role="status">
                      Loading evidence…
                    </p>
                  </StateSurface>
                ) : null}
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button disabled={busy} type="button" variant="secondary">
                    Cancel
                  </Button>
                </DialogClose>
                <Button disabled={busy || loadingOptions} type="submit" variant="primary">
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
              <div className="grid min-w-0 gap-1.5">
                <DialogTitle>Service Record history</DialogTitle>
                <DialogDescription id="service-record-history-description">
                  Loaded issued snapshots for {selected.employee.legalName} in your permitted scope.{' '}
                  {nextCursor
                    ? 'More snapshots may be available; load more history to continue.'
                    : 'All permitted snapshots have been loaded.'}
                </DialogDescription>
              </div>
              <DialogClose asChild>
                <Button aria-label="Close Service Record history" type="button">
                  <span aria-hidden="true" className="text-xl leading-none">
                    ×
                  </span>
                </Button>
              </DialogClose>
            </DialogHeader>
            <DialogBody className="grid gap-3 p-0">
              <Table aria-label="Service Record history" className="min-w-[560px]">
                <thead>
                  <tr>
                    <Th kind="date">As of</Th>
                    <Th>Record chain</Th>
                    <Th>Generated</Th>
                    <Th>Correction reason</Th>
                  </tr>
                </thead>
                <tbody>
                  {employeeHistory.map((record) => (
                    <Tr key={record.id}>
                      <RowHeader className="font-mono whitespace-nowrap">
                        {record.asOfDate}
                      </RowHeader>
                      <Td>
                        <RecordChainTag record={record} />
                      </Td>
                      <Td className="text-ink-muted">
                        {formatDateTime(record.generatedAt)} by {record.generatedBy.displayName}
                      </Td>
                      <Td className="text-ink-muted">{record.correctionReason ?? '—'}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
              <FormError className="mx-4 mb-4" message={listError} />
            </DialogBody>
            <DialogFooter>
              {nextCursor ? (
                <Button
                  disabled={busy}
                  type="button"
                  variant="secondary"
                  onClick={() => void loadMore()}
                >
                  {busy ? 'Loading…' : 'Load more history'}
                </Button>
              ) : null}
              <DialogClose asChild>
                <Button type="button" variant="secondary">
                  Close
                </Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}
