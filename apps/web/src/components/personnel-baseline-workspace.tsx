'use client';

import { Field, inputClass, FormError } from './ui/field';

import { useRecordNavigation } from './record-navigation';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { manilaToday } from '../lib/manila-date';
import { StateCode, StateSurface } from './state-surface';
import { Button } from './ui/button';
import { PageHeader, type Breadcrumb } from './ui/page-header';
import { Panel } from './ui/panel';
import { StatusTag, type StatusTone } from './ui/status-tag';
import { RowHeader, Table, TableFooter, Td, Th, Tr } from './ui/table';
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

const statusTone: Record<PersonnelBaseline['status'], StatusTone> = {
  DRAFT: 'warning',
  FOR_REVIEW: 'warning',
  RETURNED: 'warning',
  APPROVED: 'info',
  EFFECTIVE: 'success',
  SUPERSEDED: 'neutral',
  REJECTED: 'neutral',
  VOIDED: 'neutral',
};

function statusLabel(status: string): string {
  return status.replaceAll('_', ' ');
}

const sectionTitleClass = 'm-0 text-panel-title text-ink';
const noteClass = 'm-0 border-l-2 border-primary bg-canvas px-3 py-2.5 text-small text-ink-muted';

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

  const counts = (['DRAFT', 'FOR_REVIEW', 'APPROVED', 'EFFECTIVE'] as const).map(
    (status) =>
      [status, baselines.filter((baseline) => baseline.status === status).length] as const,
  );

  const inline = Boolean(recordId) || dialog === 'prepare';
  const canEditDraft =
    canPrepare && (selected?.status === 'DRAFT' || selected?.status === 'RETURNED');
  const breadcrumbs: Breadcrumb[] = [{ label: 'Personnel' }];
  // Only record views change the URL, so only they can link back to the register.
  if (recordId) {
    breadcrumbs.push({
      label: 'Personnel Baselines',
      href: navigation.href({ record: null, view: null, section: null }),
    });
    if (selected) breadcrumbs.push({ label: selected.employee.legalName });
  } else if (dialog === 'prepare') {
    breadcrumbs.push({ label: 'Personnel Baselines' }, { label: 'Prepare' });
  }

  return (
    <div className="grid min-w-0 gap-5">
      <PageHeader
        breadcrumbs={breadcrumbs}
        title="Personnel Baselines"
        actions={
          canPrepare ? (
            <Button
              // Hidden rather than unmounted, so focus can return here when the form closes.
              hidden={inline}
              onClick={(event) => {
                const trigger = event.currentTarget as unknown as { focus(): void };
                openPrepare('create', undefined, () => trigger.focus());
              }}
              type="button"
              variant="primary"
            >
              Prepare baseline
            </Button>
          ) : null
        }
      />

      {recordId && dialog === null && error ? (
        <StateSurface labelledBy="baseline-record-state-title">
          <StateCode>Unavailable</StateCode>
          <h2 className="m-0 text-page-title text-ink" id="baseline-record-state-title">
            This Personnel Baseline view could not be opened
          </h2>
          <p className="m-0 max-w-[500px] text-body text-ink-muted" role="alert">
            {error}
          </p>
        </StateSurface>
      ) : recordId && !selected && !error ? (
        <StateSurface busy label="Personnel Baseline">
          <StateCode>Loading</StateCode>
          <p className="m-0 text-body text-ink-muted" role="status">
            Loading record…
          </p>
        </StateSurface>
      ) : null}

      <Panel
        title="Baseline register"
        flush
        hidden={inline}
        actions={
          <dl className="m-0 flex flex-wrap gap-x-4 gap-y-1 text-caption text-ink-muted">
            {counts.map(([status, count]) => (
              <div className="flex gap-1.5" key={status}>
                <dt>{statusLabel(status)}</dt>
                <dd className="m-0 font-[650] text-ink">{count}</dd>
              </div>
            ))}
          </dl>
        }
      >
        <div className="grid gap-3 px-4 pt-3">
          <p className="m-0 max-w-[760px] text-small text-ink-muted">
            Establish the evidence-backed starting point for an existing Appointed Personnel record.
            The baseline records service history, the current Organization Unit, and optional
            Plantilla occupancy from approved evidence.
          </p>
          <p className={noteClass}>
            <strong className="font-[650] text-ink">Adoption, not appointment issuance.</strong>{' '}
            Appointment, oath, assumption, and CSC records remain separate workflows.
          </p>
          {success ? (
            <p role="status" className="m-0 text-small text-success">
              {success}
            </p>
          ) : null}
        </div>
        {baselines.length === 0 ? (
          <StateSurface compact label="Personnel Baseline register">
            <strong className="text-body font-[650] text-ink">No Personnel Baselines yet</strong>
            <p className="m-0 max-w-[540px]">
              Prepare one when the Personnel Records Officer has the authority evidence and
              effective-dated service facts for an existing Employee.
            </p>
          </StateSurface>
        ) : (
          <>
            <Table aria-label="Personnel Baselines" className="mt-3 min-w-[760px]">
              <thead>
                <tr>
                  <Th>Employee</Th>
                  <Th kind="date">Service start</Th>
                  <Th>Organization / position</Th>
                  <Th>State</Th>
                </tr>
              </thead>
              <tbody>
                {baselines.map((baseline) => (
                  <Tr key={baseline.id}>
                    <RowHeader>
                      <button
                        aria-label={`Open baseline for ${baseline.employee.legalName}`}
                        className="w-fit cursor-pointer border-0 bg-transparent p-0 text-left font-[600] text-primary hover:underline"
                        onClick={() => openDetail(baseline)}
                        type="button"
                      >
                        {baseline.employee.legalName}
                      </button>
                      <span className="block font-mono text-caption font-normal text-ink-muted">
                        {baseline.employee.employeeNumber}
                      </span>
                    </RowHeader>
                    <Td kind="date">{dateLabel(baseline.agencyServiceStartDate)}</Td>
                    <Td>
                      <span className="block font-[600] text-ink">
                        {baseline.organizationUnit.code}
                      </span>
                      <span className="text-caption text-ink-muted">
                        {baseline.position?.itemNumber ?? 'No Plantilla Position'}
                      </span>
                    </Td>
                    <Td>
                      <StatusTag tone={statusTone[baseline.status]}>
                        {statusLabel(baseline.status)}
                      </StatusTag>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <TableFooter shown={baselines.length} total={baselines.length} />
          </>
        )}
      </Panel>

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
              <div className="grid min-w-0 gap-1.5">
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
            <form className="flex min-h-0 flex-1 flex-col" onSubmit={submitForm}>
              <DialogBody className="grid gap-6">
                <FormError message={error || optionsError} />
                {optionsLoading ? (
                  <StateSurface compact busy label="Baseline reference values">
                    <p className="m-0" role="status">
                      Loading Employee, Organization, Position, and evidence choices…
                    </p>
                  </StateSurface>
                ) : null}
                <section className="grid gap-4" aria-labelledby="baseline-identity-fields">
                  <h3 className={sectionTitleClass} id="baseline-identity-fields">
                    Existing personnel record
                  </h3>
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
                  <h3 className={sectionTitleClass} id="baseline-evidence-fields">
                    Authority evidence
                  </h3>
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
                    <p className="m-0 self-end rounded-control border border-border bg-canvas px-3 py-2.5 text-small text-ink-muted">
                      {values.authorityEvidenceVersionId
                        ? `Exact evidence version selected: ${values.authorityEvidenceVersionId}`
                        : 'Choose the exact evidence document version used for this baseline.'}
                    </p>
                  </div>
                </section>

                <section className="grid gap-4" aria-labelledby="baseline-service-fields">
                  <h3 className={sectionTitleClass} id="baseline-service-fields">
                    Effective-dated service facts
                  </h3>
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
                    className={`${inputClass} min-h-24 resize-y py-3`}
                    id="baseline-reason"
                    onChange={(event) => setValue('reason', targetValue(event))}
                    required
                    value={values.reason}
                  />
                </Field>
                <p className={noteClass}>
                  Saving creates a Draft. Submit it for review before effectuation. No Appointment
                  or oath record is created by this workflow.
                </p>
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button disabled={busy} type="button" variant="secondary">
                    Cancel
                  </Button>
                </DialogClose>
                <Button disabled={busy || optionsLoading} type="submit" variant="primary">
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
          <DialogContent aria-describedby="baseline-detail-description">
            <DialogHeader>
              <div className="grid min-w-0 gap-1.5">
                <div className="flex flex-wrap items-center gap-3">
                  <DialogTitle>{selected.employee.legalName}</DialogTitle>
                  <StatusTag tone={statusTone[selected.status]}>
                    {statusLabel(selected.status)}
                  </StatusTag>
                </div>
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
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  {canEditDraft ? (
                    <Button
                      onClick={() => openPrepare('edit', selected)}
                      type="button"
                      variant="secondary"
                    >
                      Edit draft
                    </Button>
                  ) : null}
                  {canEditDraft ? (
                    <Button
                      disabled={busy}
                      onClick={() => void submitBaseline()}
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
                      type="button"
                      variant="primary"
                    >
                      Effectuate baseline
                    </Button>
                  ) : null}
                  {canCorrect && selected.status === 'EFFECTIVE' ? (
                    <Button
                      onClick={() => openPrepare('correct', selected)}
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
                      type="button"
                      variant="secondary"
                    >
                      View history
                    </Button>
                  ) : null}
                </div>
                <span className="font-mono text-caption text-ink-muted">{selected.id}</span>
              </div>
              <div className="grid gap-x-10 gap-y-6 min-[700px]:grid-cols-2">
                <FactSection
                  title="Authority evidence"
                  facts={[
                    [
                      'Document',
                      selected.authorityEvidence.documentNo ??
                        selected.authorityEvidence.documentType,
                    ],
                    [
                      'Status',
                      `${selected.authorityEvidence.status} · v${selected.authorityEvidence.versionNo}`,
                    ],
                    ['Classification', selected.authorityEvidence.classification],
                  ]}
                />
                <FactSection
                  title="Effective service"
                  facts={[
                    ['First government service', dateLabel(selected.firstGovernmentServiceDate)],
                    ['Agency service start', dateLabel(selected.agencyServiceStartDate)],
                    ['Appointment status', selected.appointmentStatus],
                  ]}
                />
                <FactSection
                  title="Current assignment"
                  facts={[
                    [
                      'Organization Unit',
                      `${selected.organizationUnit.code} · ${selected.organizationUnit.name}`,
                    ],
                    [
                      'Plantilla Position',
                      selected.position
                        ? `${selected.position.itemNumber} · ${selected.position.title ?? 'Untitled'}`
                        : 'None',
                    ],
                    [
                      'Salary',
                      selected.salaryGrade === null
                        ? 'Not recorded'
                        : `SG ${selected.salaryGrade}, Step ${selected.salaryStep ?? '—'}`,
                    ],
                  ]}
                />
                <FactSection
                  title="Workflow record"
                  facts={[
                    ['Reason', selected.reason],
                    ['Reviewed', dateTimeLabel(selected.reviewedAt)],
                    ['Effectuated', dateTimeLabel(selected.effectuatedAt)],
                  ]}
                />
              </div>
              {selected.serviceSegment ? (
                <p className="m-0 border-l-2 border-success bg-canvas px-3 py-2.5 text-small text-ink">
                  Active Service Segment {selected.serviceSegment.id} begins{' '}
                  {dateLabel(selected.serviceSegment.effectiveFrom)}.
                  {selected.positionIncumbency
                    ? ' The Plantilla Position has an active Position Incumbency.'
                    : ''}
                </p>
              ) : null}
            </DialogBody>
          </DialogContent>
        ) : null}

        {dialog === 'review' && selected ? (
          <DialogContent aria-describedby="baseline-review-description" size="compact">
            <DialogHeader>
              <div className="grid min-w-0 gap-1.5">
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
            <form className="contents" onSubmit={reviewBaseline}>
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
                    className={`${inputClass} min-h-24 resize-y py-3`}
                    id="baseline-review-reason"
                    onChange={(event) => setReviewReason(targetValue(event))}
                    required
                    value={reviewReason}
                  />
                </Field>
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button disabled={busy} type="button" variant="secondary">
                    Cancel
                  </Button>
                </DialogClose>
                <Button disabled={busy} type="submit" variant="primary">
                  {busy ? 'Recording…' : 'Record decision'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        ) : null}

        {dialog === 'effectuate' && selected ? (
          <DialogContent aria-describedby="baseline-effectuate-description" size="compact">
            <DialogHeader>
              <div className="grid min-w-0 gap-1.5">
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
              <p className="m-0 text-body text-ink-muted">
                This one transaction will activate the Service Segment, update the Employee service
                projection, request Plantilla occupancy when selected, and append Audit and outbox
                records.
              </p>
              <p className={noteClass}>
                No Appointment, oath, assumption, or CSC record will be created.
              </p>
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button disabled={busy} type="button" variant="secondary">
                  Cancel
                </Button>
              </DialogClose>
              <Button
                disabled={busy}
                onClick={() => void effectuateBaseline()}
                type="button"
                variant="primary"
              >
                {busy ? 'Effectuating…' : 'Effectuate baseline'}
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}

        {dialog === 'history' && selected ? (
          <DialogContent aria-describedby="baseline-history-description">
            <DialogHeader>
              <div className="grid min-w-0 gap-1.5">
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
            <DialogBody className="p-0">
              {history.length === 0 ? (
                <StateSurface compact label="Personnel Baseline history">
                  <p className="m-0">No history events were found.</p>
                </StateSurface>
              ) : (
                <Table aria-label="Personnel Baseline history" className="min-w-[640px]">
                  <thead>
                    <tr>
                      <Th>Action</Th>
                      <Th>Status change</Th>
                      <Th kind="date">Occurred</Th>
                      <Th>Reason</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((entry) => (
                      <Tr key={entry.id}>
                        <RowHeader>{statusLabel(entry.action)}</RowHeader>
                        <Td className="whitespace-nowrap">
                          {entry.previousStatus ?? '—'} → {entry.newStatus ?? '—'}
                        </Td>
                        <Td kind="date">
                          <time dateTime={entry.occurredAt}>{dateTimeLabel(entry.occurredAt)}</time>
                        </Td>
                        <Td className="text-ink-muted">{entry.reason ?? '—'}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </DialogBody>
            <DialogFooter>
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

/** Titled group of label and value pairs in the record view. */
function FactSection({ title, facts }: { title: string; facts: [string, ReactNode][] }) {
  return (
    <section className="grid content-start gap-3">
      <h3 className={sectionTitleClass}>{title}</h3>
      <dl className="m-0 grid gap-3">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt className="text-caption text-ink-muted">{label}</dt>
            <dd className="m-0 text-body text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

async function request(agencyId: string, path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`/api/v1/agencies/${agencyId}${path}`, init);
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(errorMessage(value, 'The request could not be completed.'));
  return value;
}
