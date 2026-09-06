'use client';

import { Field, inputClass, FormError } from './ui/field';

import { RecordReturn, useRecordNavigation } from './record-navigation';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
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

export interface PersonnelBaseline {
  id: string;
  employee: {
    id: string;
    employeeNumber: string;
    legalName: string;
    serviceStatus: string;
  };
  authorityEvidence: {
    documentId: string;
    documentNo: string | null;
    documentType: string;
    classification: string;
    status: string;
    versionId: string;
    versionNo: number;
  };
  firstGovernmentServiceDate: string;
  agencyServiceStartDate: string;
  organizationUnit: { id: string; code: string; name: string };
  appointmentStatus: string;
  salaryGrade: number | null;
  salaryStep: number | null;
  position: {
    id: string;
    itemNumber: string;
    status: string;
    title: string | null;
    salaryGrade: number | null;
  } | null;
  status:
    | 'DRAFT'
    | 'FOR_REVIEW'
    | 'APPROVED'
    | 'RETURNED'
    | 'REJECTED'
    | 'EFFECTIVE'
    | 'SUPERSEDED'
    | 'VOIDED';
  reason: string;
  reviewedAt: string | null;
  effectuatedAt: string | null;
  serviceSegment: {
    id: string;
    positionId: string | null;
    organizationUnitId: string;
    appointmentStatus: string;
    salaryGrade: number | null;
    salaryStep: number | null;
    effectiveFrom: string;
    effectiveTo: string | null;
    status: string;
  } | null;
  positionIncumbency: {
    id: string;
    positionId: string;
    employeeId: string;
    serviceSegmentId: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    status: string;
  } | null;
  supersedesBaselineId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PersonnelBaselineListResponse {
  baselines: PersonnelBaseline[];
}

interface EmployeeOption {
  id: string;
  employeeNumber: string;
  legalName: string;
  serviceStatus: string;
}

interface OrganizationUnitOption {
  id: string;
  code: string;
  officialName: string;
  lifecycleStatus: string;
}

interface PositionOption {
  id: string;
  itemNumber: string;
  status: string;
  currentVersion: { title: string; salaryGrade: number } | null;
}

interface EvidenceOption {
  id: string;
  documentNo: string | null;
  documentType: string;
  classification: string;
  status: string;
  currentVersion: { id: string; versionNo: number } | null;
}

interface BaselineOptions {
  employees: EmployeeOption[];
  units: OrganizationUnitOption[];
  positions: PositionOption[];
  documents: EvidenceOption[];
}

interface FormValues {
  employeeId: string;
  authorityDocumentId: string;
  authorityEvidenceVersionId: string;
  firstGovernmentServiceDate: string;
  agencyServiceStartDate: string;
  organizationUnitId: string;
  appointmentStatus: string;
  salaryGrade: string;
  salaryStep: string;
  positionId: string;
  reason: string;
  rowVersion?: number;
}

type DialogKind = 'prepare' | 'detail' | 'review' | 'effectuate' | 'history';
type FormMode = 'create' | 'edit' | 'correct';

function emptyValues(): FormValues {
  return {
    employeeId: '',
    authorityDocumentId: '',
    authorityEvidenceVersionId: '',
    firstGovernmentServiceDate: '',
    agencyServiceStartDate: manilaToday(),
    organizationUnitId: '',
    appointmentStatus: '',
    salaryGrade: '',
    salaryStep: '',
    positionId: '',
    reason: '',
  };
}

function valuesFromBaseline(baseline: PersonnelBaseline): FormValues {
  return {
    employeeId: baseline.employee.id,
    authorityDocumentId: baseline.authorityEvidence.documentId,
    authorityEvidenceVersionId: baseline.authorityEvidence.versionId,
    firstGovernmentServiceDate: baseline.firstGovernmentServiceDate,
    agencyServiceStartDate: baseline.agencyServiceStartDate,
    organizationUnitId: baseline.organizationUnit.id,
    appointmentStatus: baseline.appointmentStatus,
    salaryGrade: baseline.salaryGrade === null ? '' : String(baseline.salaryGrade),
    salaryStep: baseline.salaryStep === null ? '' : String(baseline.salaryStep),
    positionId: baseline.position?.id ?? '',
    reason: baseline.reason,
  };
}

function dateLabel(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Manila',
  });
}

function dateTimeLabel(value: string | null): string {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
}

function errorMessage(value: unknown, fallback: string): string {
  if (value instanceof Error && value.message) return value.message;
  if (typeof value !== 'object' || value === null) return fallback;
  const error = (value as { error?: { message?: unknown } }).error;
  return typeof error?.message === 'string' ? error.message : fallback;
}

function statusClass(status: PersonnelBaseline['status']): string {
  if (status === 'EFFECTIVE') return 'bg-[#e8f3ed] text-[#316647]';
  if (status === 'REJECTED' || status === 'VOIDED') return 'bg-[#f0f2f5] text-muted';
  if (status === 'APPROVED') return 'bg-[#e8edf8] text-[#315f99]';
  return 'bg-[#fff3d6] text-[#79531c]';
}

function targetValue(event: { currentTarget: EventTarget }): string {
  return (event.currentTarget as unknown as { value: string }).value;
}

function numericValue(value: string): number | null {
  const normalized = value.trim();
  return normalized ? Number(normalized) : null;
}

export function PersonnelBaselineWorkspace({
  agencyId,
  initial,
  canPrepare,
  canReview,
  canEffectuate,
  canAudit,
  canCorrect,
}: {
  agencyId: string;
  initial: PersonnelBaselineListResponse;
  canPrepare: boolean;
  canReview: boolean;
  canEffectuate: boolean;
  canAudit: boolean;
  canCorrect: boolean;
}) {
  const [baselines, setBaselines] = useState(initial.baselines);
  const [options, setOptions] = useState<BaselineOptions>({
    employees: [],
    units: [],
    positions: [],
    documents: [],
  });
  const [optionsError, setOptionsError] = useState('');
  const [optionsLoading, setOptionsLoading] = useState(canPrepare);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [formMode, setFormMode] = useState<FormMode>('create');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const navigation = useRecordNavigation();
  const recordId = navigation.search.get('record');
  const historyView = navigation.search.get('section') === 'history';

  useEffect(() => {
    let active = true;
    setSelectedId(null);
    setError('');
    if (!recordId) {
      setDialog(null);
      return;
    }
    setDialog(null);
    void (async () => {
      const next = (await request(
        agencyId,
        `/personnel-baselines/${encodeURIComponent(recordId)}`,
      )) as PersonnelBaseline;
      if (!active) return;
      setBaselines((current) => [next, ...current.filter((item) => item.id !== next.id)]);
      setSelectedId(next.id);
      if (historyView) {
        if (!canAudit) throw new Error('History is outside your permitted scope.');
        const historyValue = (await request(
          agencyId,
          `/personnel-baselines/${encodeURIComponent(recordId)}/history`,
        )) as { entries: typeof history };
        if (!active) return;
        setHistory(historyValue.entries);
        setDialog('history');
      } else setDialog('detail');
    })().catch((cause: unknown) => {
      if (active) setError(errorMessage(cause, 'This record is unavailable.'));
    });
    return () => {
      active = false;
    };
  }, [recordId, historyView, canAudit]);

  const [values, setValues] = useState(emptyValues);
  const [reviewDecision, setReviewDecision] = useState<'APPROVE' | 'RETURN' | 'REJECT'>('APPROVE');
  const [reviewReason, setReviewReason] = useState('');
  const [history, setHistory] = useState<
    Array<{
      id: string;
      action: string;
      previousStatus: string | null;
      newStatus: string | null;
      reason: string | null;
      occurredAt: string;
    }>
  >([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const returnFocusRef = useRef<(() => void) | null>(null);
  const employeeFieldRef = useRef<{ focus(): void } | null>(null);

  const selected =
    baselines.find(
      (baseline) => baseline.id === selectedId && (!recordId || baseline.id === recordId),
    ) ?? null;

  useEffect(() => {
    if (!canPrepare) return;
    let active = true;
    setOptionsLoading(true);
    Promise.all([
      request(agencyId, '/employees'),
      request(agencyId, '/organization-units'),
      request(agencyId, '/plantilla-positions'),
      request(agencyId, '/documents'),
    ])
      .then(([employees, units, positions, documents]) => {
        if (!active) return;
        const employeeValue = employees as { employees: EmployeeOption[] };
        const unitValue = units as { units: OrganizationUnitOption[] };
        const positionValue = positions as { positions: PositionOption[] };
        const documentValue = documents as { documents: EvidenceOption[] };
        setOptions({
          employees: employeeValue.employees,
          units: unitValue.units,
          positions: positionValue.positions,
          documents: documentValue.documents,
        });
        setOptionsError('');
      })
      .catch((reason: unknown) => {
        if (active)
          setOptionsError(errorMessage(reason, 'Baseline reference values could not be loaded.'));
      })
      .finally(() => {
        if (active) setOptionsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [agencyId, canPrepare]);

  function setValue<K extends keyof FormValues>(field: K, value: FormValues[K]): void {
    setValues((current) => ({ ...current, [field]: value }));
  }

  function openPrepare(
    mode: FormMode,
    baseline?: PersonnelBaseline,
    restoreFocus?: () => void,
  ): void {
    if (restoreFocus) returnFocusRef.current = restoreFocus;
    setFormMode(mode);
    setValues(baseline ? valuesFromBaseline(baseline) : emptyValues());
    setSelectedId(baseline?.id ?? null);
    setError('');
    setDialog('prepare');
  }

  function openDetail(record: PersonnelBaseline): void {
    navigation.navigate({ record: record.id, view: 'form', section: null });
  }

  function replaceBaseline(next: PersonnelBaseline): void {
    setBaselines((current) => {
      const found = current.some((baseline) => baseline.id === next.id);
      return found
        ? current.map((baseline) => (baseline.id === next.id ? next : baseline))
        : [next, ...current];
    });
    setSelectedId(next.id);
    navigation.navigate({ record: next.id, view: 'form', section: null });
  }

  async function submitForm(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const payload = {
        employeeId: values.employeeId,
        authorityDocumentId: values.authorityDocumentId,
        authorityEvidenceVersionId: values.authorityEvidenceVersionId,
        firstGovernmentServiceDate: values.firstGovernmentServiceDate,
        agencyServiceStartDate: values.agencyServiceStartDate,
        organizationUnitId: values.organizationUnitId,
        appointmentStatus: values.appointmentStatus,
        salaryGrade: numericValue(values.salaryGrade),
        salaryStep: numericValue(values.salaryStep),
        positionId: values.positionId || null,
        reason: values.reason,
        ...(values.rowVersion === undefined ? {} : { rowVersion: values.rowVersion }),
      };
      const path =
        formMode === 'create' ? '' : `/${selectedId}` + (formMode === 'correct' ? '/correct' : '');
      const next = (await request(agencyId, `/personnel-baselines${path}`, {
        method: formMode === 'create' || formMode === 'correct' ? 'POST' : 'PATCH',
        body: JSON.stringify(payload),
        headers: { 'content-type': 'application/json' },
      })) as PersonnelBaseline;
      replaceBaseline(next);
      setDialog('detail');
      setSuccess(
        formMode === 'correct'
          ? 'Correction prepared as a new baseline record.'
          : formMode === 'edit'
            ? 'Baseline draft updated.'
            : 'Personnel Baseline prepared as a Draft.',
      );
    } catch (reason: unknown) {
      setError(errorMessage(reason, 'The Personnel Baseline could not be saved.'));
    } finally {
      setBusy(false);
    }
  }

  async function submitBaseline(): Promise<void> {
    if (!selected) return;
    await runAction(`/${selected.id}/submit`, {}, 'Baseline submitted for review.');
  }

  async function reviewBaseline(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await runAction(
      `/${selected?.id}/review`,
      {
        method: 'POST',
        body: JSON.stringify({ decision: reviewDecision, reason: reviewReason }),
        headers: { 'content-type': 'application/json' },
      },
      `Baseline ${reviewDecision === 'APPROVE' ? 'approved' : reviewDecision === 'RETURN' ? 'returned' : 'rejected'}.`,
    );
  }

  async function effectuateBaseline(): Promise<void> {
    if (!selected) return;
    await runAction(
      `/${selected.id}/effectuate`,
      { method: 'POST', headers: { 'idempotency-key': `web-${selected.id}` } },
      'Personnel Baseline effectuated. Employee service and position history are now active.',
    );
  }

  async function runAction(path: string, init: RequestInit, message: string): Promise<void> {
    if (!selected || busy) return;
    setBusy(true);
    setError('');
    try {
      const next = (await request(
        agencyId,
        `/personnel-baselines${path}`,
        init,
      )) as PersonnelBaseline;
      replaceBaseline(next);
      setDialog('detail');
      setSuccess(message);
    } catch (reason: unknown) {
      setError(errorMessage(reason, 'The Personnel Baseline action could not be completed.'));
    } finally {
      setBusy(false);
    }
  }

  async function openHistory(): Promise<void> {
    if (selected) navigation.navigate({ record: selected.id, view: 'form', section: 'history' });
  }

  const counts = ['DRAFT', 'FOR_REVIEW', 'APPROVED', 'EFFECTIVE'].map(
    (status) =>
      [status, baselines.filter((baseline) => baseline.status === status).length] as const,
  );

  return (
    <div className="grid min-w-0 gap-7">
      {recordId ? (
        <RecordReturn href={navigation.href({ record: null, view: null, section: null })}>
          ← Personnel Baselines
        </RecordReturn>
      ) : null}
      {recordId && error ? <p role="alert">{error}</p> : null}
      {recordId && !selectedId && !error ? <p role="status">Loading record…</p> : null}
      <div hidden={Boolean(recordId) || dialog === 'prepare'} className="space-y-5">
        <header className="flex flex-col gap-5 min-[700px]:flex-row min-[700px]:items-end min-[700px]:justify-between">
          <div>
            <p className="mb-2 text-[10px] font-bold tracking-[.12em] text-cobalt uppercase">
              Personnel records / Phase 5
            </p>
            <h1 className="m-0 text-[30px] font-[700] tracking-[-.035em] text-midnight">
              Personnel Baseline
            </h1>
            <p className="mt-2 max-w-[650px] text-sm leading-6 text-muted">
              Establish the evidence-backed starting point for an existing Appointed Personnel
              record. This adoption record does not issue a new Appointment.
            </p>
          </div>
          {canPrepare ? (
            <Button
              className="shrink-0"
              onClick={(event) => {
                const trigger = event.currentTarget as unknown as { focus(): void };
                openPrepare('create', undefined, () => trigger.focus());
              }}
              size="default"
              type="button"
              variant="primary"
            >
              Prepare baseline
            </Button>
          ) : null}
        </header>

        <section className="grid gap-4 border-l-[3px] border-cobalt bg-[#edf3fb] px-5 py-4 min-[700px]:grid-cols-[1fr_auto] min-[700px]:items-center">
          <div>
            <strong className="block text-sm font-[700] text-midnight">
              Adoption, not appointment issuance
            </strong>
            <p className="m-0 mt-1 text-[13px] leading-6 text-muted">
              The baseline records service history, the current Organization Unit, and optional
              Plantilla occupancy from approved evidence. Appointment, oath, assumption, and CSC
              records remain separate workflows.
            </p>
          </div>
          <span className="font-mono text-[11px] font-bold tracking-[.08em] text-cobalt">
            EVIDENCE → SERVICE
          </span>
        </section>

        {success ? (
          <p
            className="m-0 border border-[#b8d8c0] bg-[#f1faf3] px-4 py-3 text-sm text-[#316647]"
            role="status"
          >
            {success}
          </p>
        ) : null}

        <div className="grid border-y border-line bg-paper min-[700px]:grid-cols-4">
          {counts.map(([label, count]) => (
            <div
              key={label}
              className="flex items-baseline justify-between border-b border-line px-5 py-4 last:border-0 min-[700px]:border-r min-[700px]:border-b-0 min-[700px]:last:border-r-0"
            >
              <span className="text-[10px] font-bold tracking-[.08em] text-muted">{label}</span>
              <strong className="font-mono text-2xl text-midnight">{count}</strong>
            </div>
          ))}
        </div>

        <section className="overflow-hidden rounded-[4px] border border-line bg-paper">
          {baselines.length === 0 ? (
            <div className="px-5 py-10">
              <strong className="block text-sm text-midnight">No Personnel Baselines yet</strong>
              <p className="m-0 mt-2 max-w-[540px] text-sm leading-6 text-muted">
                Prepare one when the Personnel Records Officer has the authority evidence and
                effective-dated service facts for an existing Employee.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-line bg-[#f9fafc] text-[10px] tracking-[.08em] text-muted uppercase">
                    <th className="px-5 py-3 font-bold">Employee</th>
                    <th className="px-5 py-3 font-bold">Service start</th>
                    <th className="px-5 py-3 font-bold">Organization / position</th>
                    <th className="px-5 py-3 font-bold">State</th>
                    <th className="w-20">
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {baselines.map((baseline) => (
                    <tr
                      key={baseline.id}
                      className="border-b border-line last:border-0 hover:bg-[#f8fafd]"
                    >
                      <td className="px-5 py-4">
                        <button
                          className="text-left"
                          onClick={() => openDetail(baseline)}
                          type="button"
                        >
                          <strong className="block text-sm font-[650] text-ink">
                            {baseline.employee.legalName}
                          </strong>
                          <span className="font-mono text-xs text-muted">
                            {baseline.employee.employeeNumber}
                          </span>
                        </button>
                      </td>
                      <td className="px-5 py-4 text-xs text-muted">
                        {dateLabel(baseline.agencyServiceStartDate)}
                      </td>
                      <td className="px-5 py-4">
                        <strong className="block text-sm font-[620] text-ink">
                          {baseline.organizationUnit.code}
                        </strong>
                        <span className="text-xs text-muted">
                          {baseline.position?.itemNumber ?? 'No Plantilla Position'}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold tracking-[.06em] ${statusClass(baseline.status)}`}
                        >
                          {baseline.status.replaceAll('_', ' ')}
                        </span>
                      </td>
                      <td className="px-5">
                        <button
                          aria-label={`Open baseline for ${baseline.employee.legalName}`}
                          className="text-lg text-cobalt"
                          onClick={() => openDetail(baseline)}
                          type="button"
                        >
                          →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <Dialog
        presentation={
          dialog === 'detail' || dialog === 'prepare' || dialog === 'history' ? 'form' : 'dialog'
        }
        onOpenChange={(open) => {
          if (!open && !busy) {
            navigation.navigate({ record: null, view: null, section: null });
            setDialog(null);
            setError('');
          }
        }}
        open={dialog !== null}
      >
        {dialog === 'prepare' ? (
          <DialogContent
            aria-describedby="baseline-prepare-description"
            className="max-w-[900px]"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              returnFocusRef.current?.();
            }}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              employeeFieldRef.current?.focus();
            }}
          >
            <DialogHeader>
              <div className="min-w-0">
                <DialogTitle>
                  {formMode === 'correct'
                    ? 'Prepare baseline correction'
                    : formMode === 'edit'
                      ? 'Edit baseline draft'
                      : 'Prepare Personnel Baseline'}
                </DialogTitle>
                <DialogDescription id="baseline-prepare-description">
                  Capture the approved authority evidence and effective-dated facts for an existing
                  Employee.
                </DialogDescription>
              </div>
              <DialogClose asChild>
                <Button aria-label="Close Personnel Baseline dialog" disabled={busy} type="button">
                  <span aria-hidden="true" className="text-xl leading-none">
                    ×
                  </span>
                </Button>
              </DialogClose>
            </DialogHeader>
            <form onSubmit={submitForm}>
              <DialogBody className="grid gap-6">
                <FormError message={error || optionsError} />
                {optionsLoading ? (
                  <p
                    className="m-0 rounded-[3px] bg-canvas px-4 py-3 text-sm text-muted"
                    role="status"
                  >
                    Loading Employee, Organization, Position, and evidence choices…
                  </p>
                ) : null}
                <section className="grid gap-4" aria-labelledby="baseline-identity-fields">
                  <h2
                    id="baseline-identity-fields"
                    className="m-0 text-[11px] font-bold tracking-[.1em] text-cobalt uppercase"
                  >
                    Existing personnel record
                  </h2>
                  <div className="grid gap-4 min-[700px]:grid-cols-2">
                    <Field htmlFor="baseline-employee" label="Employee">
                      <select
                        className={inputClass}
                        disabled={formMode !== 'create'}
                        id="baseline-employee"
                        onChange={(event) => setValue('employeeId', targetValue(event))}
                        required
                        ref={employeeFieldRef}
                        value={values.employeeId}
                      >
                        <option value="">Select a PREBOARDING Employee</option>
                        {options.employees
                          .filter(
                            (employee) =>
                              employee.serviceStatus === 'PREBOARDING' ||
                              employee.id === values.employeeId,
                          )
                          .map((employee) => (
                            <option key={employee.id} value={employee.id}>
                              {employee.employeeNumber} · {employee.legalName} ·{' '}
                              {employee.serviceStatus}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <Field htmlFor="baseline-appointment-status" label="Appointment status">
                      <input
                        className={inputClass}
                        id="baseline-appointment-status"
                        onChange={(event) => setValue('appointmentStatus', targetValue(event))}
                        placeholder="e.g. Permanent"
                        required
                        value={values.appointmentStatus}
                      />
                    </Field>
                  </div>
                </section>

                <section className="grid gap-4" aria-labelledby="baseline-evidence-fields">
                  <h2
                    id="baseline-evidence-fields"
                    className="m-0 text-[11px] font-bold tracking-[.1em] text-cobalt uppercase"
                  >
                    Authority evidence
                  </h2>
                  <div className="grid gap-4 min-[700px]:grid-cols-2">
                    <Field htmlFor="baseline-evidence-document" label="External Evidence Document">
                      <select
                        className={inputClass}
                        id="baseline-evidence-document"
                        onChange={(event) => {
                          const id = targetValue(event);
                          const document = options.documents.find((item) => item.id === id);
                          setValue('authorityDocumentId', id);
                          setValue(
                            'authorityEvidenceVersionId',
                            document?.currentVersion?.id ?? '',
                          );
                        }}
                        required
                        value={values.authorityDocumentId}
                      >
                        <option value="">Select approved evidence</option>
                        {options.documents.map((document) => (
                          <option key={document.id} value={document.id}>
                            {document.documentNo ?? document.documentType} · {document.status}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <div className="rounded-[3px] bg-canvas px-4 py-3 text-xs leading-5 text-muted">
                      {values.authorityEvidenceVersionId
                        ? `Exact evidence version selected: ${values.authorityEvidenceVersionId}`
                        : 'Choose the exact evidence document version used for this baseline.'}
                    </div>
                  </div>
                </section>

                <section className="grid gap-4" aria-labelledby="baseline-service-fields">
                  <h2
                    id="baseline-service-fields"
                    className="m-0 text-[11px] font-bold tracking-[.1em] text-cobalt uppercase"
                  >
                    Effective-dated service facts
                  </h2>
                  <div className="grid gap-4 min-[700px]:grid-cols-2">
                    <Field
                      htmlFor="baseline-first-service-date"
                      label="First government service date"
                    >
                      <input
                        className={inputClass}
                        id="baseline-first-service-date"
                        onChange={(event) =>
                          setValue('firstGovernmentServiceDate', targetValue(event))
                        }
                        required
                        type="date"
                        value={values.firstGovernmentServiceDate}
                      />
                    </Field>
                    <Field htmlFor="baseline-agency-service-date" label="Agency service start date">
                      <input
                        className={inputClass}
                        id="baseline-agency-service-date"
                        onChange={(event) => setValue('agencyServiceStartDate', targetValue(event))}
                        required
                        type="date"
                        value={values.agencyServiceStartDate}
                      />
                    </Field>
                    <Field htmlFor="baseline-organization-unit" label="Organization Unit">
                      <select
                        className={inputClass}
                        id="baseline-organization-unit"
                        onChange={(event) => setValue('organizationUnitId', targetValue(event))}
                        required
                        value={values.organizationUnitId}
                      >
                        <option value="">Select an active Organization Unit</option>
                        {options.units
                          .filter(
                            (unit) =>
                              unit.lifecycleStatus === 'ACTIVE' ||
                              unit.id === values.organizationUnitId,
                          )
                          .map((unit) => (
                            <option key={unit.id} value={unit.id}>
                              {unit.code} · {unit.officialName}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <Field htmlFor="baseline-position" label="Plantilla Position (optional)">
                      <select
                        className={inputClass}
                        id="baseline-position"
                        onChange={(event) => {
                          const id = targetValue(event);
                          const position = options.positions.find((item) => item.id === id);
                          setValue('positionId', id);
                          if (position?.currentVersion)
                            setValue('salaryGrade', String(position.currentVersion.salaryGrade));
                        }}
                        value={values.positionId}
                      >
                        <option value="">No Plantilla Position</option>
                        {options.positions
                          .filter(
                            (position) =>
                              position.status === 'VACANT' || position.id === values.positionId,
                          )
                          .map((position) => (
                            <option key={position.id} value={position.id}>
                              {position.itemNumber} ·{' '}
                              {position.currentVersion?.title ?? 'Untitled position'}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <Field htmlFor="baseline-salary-grade" label="Salary grade (where applicable)">
                      <input
                        className={inputClass}
                        id="baseline-salary-grade"
                        max="33"
                        min="1"
                        onChange={(event) => setValue('salaryGrade', targetValue(event))}
                        type="number"
                        value={values.salaryGrade}
                      />
                    </Field>
                    <Field htmlFor="baseline-salary-step" label="Salary step (where applicable)">
                      <input
                        className={inputClass}
                        id="baseline-salary-step"
                        min="1"
                        onChange={(event) => setValue('salaryStep', targetValue(event))}
                        type="number"
                        value={values.salaryStep}
                      />
                    </Field>
                  </div>
                </section>

                <Field htmlFor="baseline-reason" label="Reason for adoption or correction">
                  <textarea
                    className={`${inputClass} min-h-24 py-3`}
                    id="baseline-reason"
                    onChange={(event) => setValue('reason', targetValue(event))}
                    required
                    value={values.reason}
                  />
                </Field>
                <p className="m-0 rounded-[3px] bg-canvas px-4 py-3 text-[13px] leading-6 text-muted">
                  Saving creates a Draft. Submit it for review before effectuation. No Appointment
                  or oath record is created by this workflow.
                </p>
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button disabled={busy} size="default" type="button" variant="secondary">
                    Cancel
                  </Button>
                </DialogClose>
                <Button
                  disabled={busy || optionsLoading}
                  size="default"
                  type="submit"
                  variant="primary"
                >
                  {busy
                    ? 'Saving…'
                    : formMode === 'correct'
                      ? 'Prepare correction'
                      : formMode === 'edit'
                        ? 'Save draft'
                        : 'Create draft'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        ) : null}

        {dialog === 'detail' && selected ? (
          <DialogContent aria-describedby="baseline-detail-description" className="max-w-[820px]">
            <DialogHeader>
              <div className="min-w-0">
                <DialogTitle>{selected.employee.legalName}</DialogTitle>
                <DialogDescription id="baseline-detail-description">
                  Personnel Baseline · {selected.employee.employeeNumber}
                </DialogDescription>
              </div>
              <DialogClose asChild>
                <Button aria-label="Close Personnel Baseline details" type="button">
                  <span aria-hidden="true" className="text-xl leading-none">
                    ×
                  </span>
                </Button>
              </DialogClose>
            </DialogHeader>
            <DialogBody className="grid gap-6">
              <FormError message={error} />
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
                <span
                  className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold tracking-[.06em] ${statusClass(selected.status)}`}
                >
                  {selected.status.replaceAll('_', ' ')}
                </span>
                <span className="font-mono text-xs text-muted">{selected.id}</span>
              </div>
              <div className="grid gap-5 min-[700px]:grid-cols-2">
                <DetailGroup title="Authority evidence">
                  <DetailRow
                    label="Document"
                    value={
                      selected.authorityEvidence.documentNo ??
                      selected.authorityEvidence.documentType
                    }
                  />
                  <DetailRow
                    label="Status"
                    value={`${selected.authorityEvidence.status} · v${selected.authorityEvidence.versionNo}`}
                  />
                  <DetailRow
                    label="Classification"
                    value={selected.authorityEvidence.classification}
                  />
                </DetailGroup>
                <DetailGroup title="Effective service">
                  <DetailRow
                    label="First government service"
                    value={dateLabel(selected.firstGovernmentServiceDate)}
                  />
                  <DetailRow
                    label="Agency service start"
                    value={dateLabel(selected.agencyServiceStartDate)}
                  />
                  <DetailRow label="Appointment status" value={selected.appointmentStatus} />
                </DetailGroup>
                <DetailGroup title="Current assignment">
                  <DetailRow
                    label="Organization Unit"
                    value={`${selected.organizationUnit.code} · ${selected.organizationUnit.name}`}
                  />
                  <DetailRow
                    label="Plantilla Position"
                    value={
                      selected.position
                        ? `${selected.position.itemNumber} · ${selected.position.title ?? 'Untitled'}`
                        : 'None'
                    }
                  />
                  <DetailRow
                    label="Salary"
                    value={
                      selected.salaryGrade === null
                        ? 'Not recorded'
                        : `SG ${selected.salaryGrade}, Step ${selected.salaryStep ?? '—'}`
                    }
                  />
                </DetailGroup>
                <DetailGroup title="Workflow record">
                  <DetailRow label="Reason" value={selected.reason} />
                  <DetailRow label="Reviewed" value={dateTimeLabel(selected.reviewedAt)} />
                  <DetailRow label="Effectuated" value={dateTimeLabel(selected.effectuatedAt)} />
                </DetailGroup>
              </div>
              {selected.serviceSegment ? (
                <div className="border-l-[3px] border-[#5a8f6a] bg-[#f1faf3] px-4 py-3 text-[13px] leading-6 text-[#316647]">
                  Active Service Segment {selected.serviceSegment.id} begins{' '}
                  {dateLabel(selected.serviceSegment.effectiveFrom)}.
                  {selected.positionIncumbency
                    ? ' The Plantilla Position has an active Position Incumbency.'
                    : ''}
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {canPrepare && (selected.status === 'DRAFT' || selected.status === 'RETURNED') ? (
                  <Button
                    onClick={() => openPrepare('edit', selected)}
                    size="default"
                    type="button"
                    variant="secondary"
                  >
                    Edit draft
                  </Button>
                ) : null}
                {canPrepare && (selected.status === 'DRAFT' || selected.status === 'RETURNED') ? (
                  <Button
                    disabled={busy}
                    onClick={() => void submitBaseline()}
                    size="default"
                    type="button"
                    variant="primary"
                  >
                    Submit for review
                  </Button>
                ) : null}
                {canReview && selected.status === 'FOR_REVIEW' ? (
                  <Button
                    onClick={() => {
                      setReviewDecision('APPROVE');
                      setReviewReason('');
                      setError('');
                      setDialog('review');
                    }}
                    size="default"
                    type="button"
                    variant="primary"
                  >
                    Review baseline
                  </Button>
                ) : null}
                {canEffectuate && selected.status === 'APPROVED' ? (
                  <Button
                    onClick={() => {
                      setError('');
                      setDialog('effectuate');
                    }}
                    size="default"
                    type="button"
                    variant="primary"
                  >
                    Effectuate baseline
                  </Button>
                ) : null}
                {canCorrect && selected.status === 'EFFECTIVE' ? (
                  <Button
                    onClick={() => openPrepare('correct', selected)}
                    size="default"
                    type="button"
                    variant="secondary"
                  >
                    Prepare correction
                  </Button>
                ) : null}
                {canAudit ? (
                  <Button
                    disabled={busy}
                    onClick={() => void openHistory()}
                    size="default"
                    type="button"
                    variant="secondary"
                  >
                    View history
                  </Button>
                ) : null}
              </div>
            </DialogBody>
          </DialogContent>
        ) : null}

        {dialog === 'review' && selected ? (
          <DialogContent aria-describedby="baseline-review-description" size="compact">
            <DialogHeader>
              <div className="min-w-0">
                <DialogTitle>Review Personnel Baseline</DialogTitle>
                <DialogDescription id="baseline-review-description">
                  Record a review decision for {selected.employee.legalName}. Approval allows
                  effectuation.
                </DialogDescription>
              </div>
              <DialogClose asChild>
                <Button aria-label="Close review dialog" disabled={busy} type="button">
                  <span aria-hidden="true" className="text-xl leading-none">
                    ×
                  </span>
                </Button>
              </DialogClose>
            </DialogHeader>
            <form onSubmit={reviewBaseline}>
              <DialogBody className="grid gap-5">
                <FormError message={error} />
                <Field htmlFor="baseline-review-decision" label="Decision">
                  <select
                    className={inputClass}
                    id="baseline-review-decision"
                    onChange={(event) =>
                      setReviewDecision(targetValue(event) as typeof reviewDecision)
                    }
                    value={reviewDecision}
                  >
                    <option value="APPROVE">Approve</option>
                    <option value="RETURN">Return for correction</option>
                    <option value="REJECT">Reject</option>
                  </select>
                </Field>
                <Field htmlFor="baseline-review-reason" label="Review reason">
                  <textarea
                    className={`${inputClass} min-h-24 py-3`}
                    id="baseline-review-reason"
                    onChange={(event) => setReviewReason(targetValue(event))}
                    required
                    value={reviewReason}
                  />
                </Field>
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button disabled={busy} size="default" type="button" variant="secondary">
                    Cancel
                  </Button>
                </DialogClose>
                <Button disabled={busy} size="default" type="submit" variant="primary">
                  {busy ? 'Recording…' : 'Record decision'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        ) : null}

        {dialog === 'effectuate' && selected ? (
          <DialogContent aria-describedby="baseline-effectuate-description" size="compact">
            <DialogHeader>
              <div className="min-w-0">
                <DialogTitle>Effectuate Personnel Baseline</DialogTitle>
                <DialogDescription id="baseline-effectuate-description">
                  Activate the approved service facts for {selected.employee.legalName}.
                </DialogDescription>
              </div>
              <DialogClose asChild>
                <Button aria-label="Close effectuation dialog" disabled={busy} type="button">
                  <span aria-hidden="true" className="text-xl leading-none">
                    ×
                  </span>
                </Button>
              </DialogClose>
            </DialogHeader>
            <DialogBody className="grid gap-4">
              <FormError message={error} />
              <p className="m-0 text-sm leading-6 text-muted">
                This one transaction will activate the Service Segment, update the Employee service
                projection, request Plantilla occupancy when selected, and append Audit and outbox
                records.
              </p>
              <div className="border-l-[3px] border-cobalt bg-[#edf3fb] px-4 py-3 text-[13px] leading-6 text-muted">
                No Appointment, oath, assumption, or CSC record will be created.
              </div>
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button disabled={busy} size="default" type="button" variant="secondary">
                  Cancel
                </Button>
              </DialogClose>
              <Button
                disabled={busy}
                onClick={() => void effectuateBaseline()}
                size="default"
                type="button"
                variant="primary"
              >
                {busy ? 'Effectuating…' : 'Effectuate baseline'}
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}

        {dialog === 'history' && selected ? (
          <DialogContent aria-describedby="baseline-history-description" className="max-w-[760px]">
            <DialogHeader>
              <div className="min-w-0">
                <DialogTitle>Personnel Baseline history</DialogTitle>
                <DialogDescription id="baseline-history-description">
                  Retained workflow events for {selected.employee.legalName}.
                </DialogDescription>
              </div>
              <DialogClose asChild>
                <Button aria-label="Close baseline history" type="button">
                  <span aria-hidden="true" className="text-xl leading-none">
                    ×
                  </span>
                </Button>
              </DialogClose>
            </DialogHeader>
            <DialogBody className="grid gap-3">
              {history.length === 0 ? (
                <p className="m-0 text-sm text-muted">No history events were found.</p>
              ) : (
                history.map((entry) => (
                  <article className="grid gap-1 border-l-2 border-line px-4 py-3" key={entry.id}>
                    <div className="flex flex-wrap justify-between gap-2">
                      <strong className="text-sm text-midnight">
                        {entry.action.replaceAll('_', ' ')}
                      </strong>
                      <time className="text-xs text-muted">{dateTimeLabel(entry.occurredAt)}</time>
                    </div>
                    <span className="text-xs text-muted">
                      {entry.previousStatus ?? '—'} → {entry.newStatus ?? '—'}
                    </span>
                    {entry.reason ? (
                      <p className="m-0 text-sm leading-6 text-ink">{entry.reason}</p>
                    ) : null}
                  </article>
                ))
              )}
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button size="default" type="button" variant="secondary">
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

function DetailGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-3 border-t border-line pt-3">
      <h2 className="m-0 text-[10px] font-bold tracking-[.1em] text-cobalt uppercase">{title}</h2>
      <div className="grid gap-2">{children}</div>
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 min-[520px]:grid-cols-[145px_1fr] min-[520px]:gap-3">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-sm leading-5 text-ink">{value}</span>
    </div>
  );
}

async function request(agencyId: string, path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`/api/v1/agencies/${agencyId}${path}`, init);
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(errorMessage(value, 'The request could not be completed.'));
  return value;
}
