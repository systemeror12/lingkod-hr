'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { cn } from '../lib/class-names';
import { manilaToday } from '../lib/manila-date';
import { RecordReturn, useRecordNavigation } from './record-navigation';
import { StateSurface } from './state-surface';
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
import { Field, FormError, inputClass } from './ui/field';
import { PageHeader } from './ui/page-header';
import { Panel } from './ui/panel';
import { StatusTag, type StatusTone } from './ui/status-tag';
import { Table, Td, Th, Tr } from './ui/table';

type VersionState = 'DRAFT' | 'ACTIVE' | 'SUPERSEDED' | 'VOIDED';
type EvidenceKind = 'SOURCE' | 'APPROVAL';

interface Evidence {
  documentId: string;
  documentNo: string | null;
  documentType: string;
  classification: string;
  status: string;
  versionNo: number;
  mimeType: string;
  sizeBytes: number;
  validatedAt: string;
  validationReason: string;
}

export interface QualificationStandardVersion {
  id: string;
  qualificationStandardId: string;
  versionNo: number;
  educationRequirement: string | null;
  trainingHoursRequired: number | null;
  experienceMonthsRequired: number | null;
  eligibilityRequirement: string | null;
  competencyRequirements: unknown[];
  licenseRequirements: unknown[];
  specialRequirements: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  versionState: VersionState;
  lifecycleStatus: 'ACTIVE' | 'INACTIVE';
  sourceEvidence: Evidence | null;
  approvalEvidence: Evidence | null;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface QualificationStandard {
  id: string;
  code: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  currentVersion: QualificationStandardVersion | null;
  draft: QualificationStandardVersion | null;
  createdAt: string;
  updatedAt: string;
}

export interface QualificationStandardListResponse {
  standards: QualificationStandard[];
}

interface QualificationStandardDetail {
  standard: QualificationStandard;
  asOf: string;
  effective: QualificationStandardVersion | null;
  versions: QualificationStandardVersion[];
  history: Array<{
    id: string;
    action: string;
    previousStatus: string | null;
    newStatus: string | null;
    reason: string | null;
    effectiveDate: string | null;
    occurredAt: string;
  }>;
}

interface FormValues {
  code: string;
  name: string;
  effectiveDate: string;
  educationRequirement: string;
  trainingHoursRequired: string;
  experienceMonthsRequired: string;
  eligibilityRequirement: string;
  competencyRequirements: string;
  licenseRequirements: string;
  specialRequirements: string;
  rowVersion?: number;
}

type DialogKind =
  'create' | 'edit' | 'evidence' | 'activate' | 'successor' | 'correction' | 'detail';

const draftDescription =
  'Record the requirements for one Draft version. The stable Standard remains inactive until both source and approval External Evidence are validated.';

/** Title and description for each dialog, given the selected Standard's code. */
const dialogCopy: Record<DialogKind, (code: string) => { title: string; description: string }> = {
  create: () => ({ title: 'Create Qualification Standard', description: draftDescription }),
  edit: () => ({ title: 'Edit Draft Qualification Standard', description: draftDescription }),
  evidence: (code) => ({
    title: 'Validate Evidence · ' + code,
    description:
      'Pin the selected same-Agency External Evidence version and record the validation reason.',
  }),
  activate: (code) => ({
    title: 'Activate ' + code,
    description:
      'Activation checks effectivity, evidence, and overlap atomically. Published requirements cannot be edited.',
  }),
  correction: (code) => ({
    title: 'Correct Version · ' + code,
    description:
      'Use a reasoned correction when a published fact is wrong. The original version is voided and retained in history.',
  }),
  successor: (code) => ({
    title: 'Create Successor · ' + code,
    description:
      'The successor copies the current requirements and receives a later effective date. It remains Draft until reviewed.',
  }),
  detail: (code) => ({
    title: 'Qualification Standard · ' + code,
    description:
      'Inspect effective-dated versions, pinned evidence, and the immutable transition history.',
  }),
};

function emptyValues(): FormValues {
  return {
    code: '',
    name: '',
    effectiveDate: manilaToday(),
    educationRequirement: '',
    trainingHoursRequired: '',
    experienceMonthsRequired: '',
    eligibilityRequirement: '',
    competencyRequirements: '[]',
    licenseRequirements: '[]',
    specialRequirements: '',
  };
}

function dateLabel(value: string): string {
  const date = new Date(value.includes('T') ? value : value.slice(0, 10) + 'T00:00:00.000Z');
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Manila',
  });
}

function errorMessage(value: unknown, fallback: string): string {
  if (typeof value !== 'object' || value === null) return fallback;
  const error = (value as { error?: { message?: unknown } }).error;
  return typeof error?.message === 'string' ? error.message : fallback;
}

type DisplayedStatus = QualificationStandard['status'] | VersionState;

const statusTone: Record<DisplayedStatus, StatusTone> = {
  ACTIVE: 'success',
  INACTIVE: 'neutral',
  DRAFT: 'warning',
  SUPERSEDED: 'neutral',
  VOIDED: 'neutral',
};

function Status({ status }: { status: DisplayedStatus }) {
  return <StatusTag tone={statusTone[status]}>{status}</StatusTag>;
}

function versionValues(
  standard: QualificationStandard,
  version: QualificationStandardVersion,
): FormValues {
  return {
    code: standard.code,
    name: standard.name,
    effectiveDate: version.effectiveFrom,
    educationRequirement: version.educationRequirement ?? '',
    trainingHoursRequired:
      version.trainingHoursRequired === null ? '' : String(version.trainingHoursRequired),
    experienceMonthsRequired:
      version.experienceMonthsRequired === null ? '' : String(version.experienceMonthsRequired),
    eligibilityRequirement: version.eligibilityRequirement ?? '',
    competencyRequirements: JSON.stringify(version.competencyRequirements, null, 2),
    licenseRequirements: JSON.stringify(version.licenseRequirements, null, 2),
    specialRequirements: version.specialRequirements ?? '',
    rowVersion: version.rowVersion,
  };
}

function parseJsonList(value: string, label: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(label + ' must be valid JSON.');
  }
  if (!Array.isArray(parsed)) throw new Error(label + ' must be a JSON array.');
  return parsed;
}

function payload(values: FormValues, includeIdentity: boolean): Record<string, unknown> {
  const training = values.trainingHoursRequired.trim();
  const experience = values.experienceMonthsRequired.trim();
  const result: Record<string, unknown> = {
    effectiveDate: values.effectiveDate,
    educationRequirement: values.educationRequirement,
    trainingHoursRequired: training ? Number(training) : null,
    experienceMonthsRequired: experience ? Number(experience) : null,
    eligibilityRequirement: values.eligibilityRequirement,
    competencyRequirements: parseJsonList(values.competencyRequirements, 'Competency requirements'),
    licenseRequirements: parseJsonList(values.licenseRequirements, 'License requirements'),
    specialRequirements: values.specialRequirements,
  };
  if (includeIdentity) {
    result.code = values.code;
    result.name = values.name;
  } else if (values.rowVersion !== undefined) {
    result.rowVersion = values.rowVersion;
  }
  return result;
}

function targetValue(event: { currentTarget: EventTarget }): string {
  return (event.currentTarget as unknown as { value: string }).value;
}

function validForm(event: FormEvent<HTMLFormElement>): boolean {
  return (event.currentTarget as unknown as { reportValidity(): boolean }).reportValidity();
}

export function QualificationStandardWorkspace({
  agencyId,
  initial,
  canCreate,
  canUpdate,
  canValidateEvidence,
  canActivate,
}: {
  agencyId: string;
  initial: QualificationStandardListResponse;
  canCreate: boolean;
  canUpdate: boolean;
  canValidateEvidence: boolean;
  canActivate: boolean;
}) {
  const [standards, setStandards] = useState(initial.standards);
  const navigation = useRecordNavigation();
  const recordId = navigation.search.get('record');
  const dialogRef = useRef<DialogKind | null>(null);
  useEffect(() => {
    let active = true;
    if (!recordId) {
      if (dialogRef.current === 'detail') {
        dialogRef.current = null;
        setDialog(null);
        setSelected(null);
        setDetail(null);
      }
      return;
    }
    setDetail(null);
    setSelected(null);
    setError('');
    dialogRef.current = 'detail';
    setDialog('detail');
    setDetailLoading(true);
    void request('/' + encodeURIComponent(recordId))
      .then((value) => {
        if (!active) return;
        const next = value as QualificationStandardDetail;
        setDetail(next);
        setSelected(next.standard);
      })
      .catch((error: unknown) => {
        if (active)
          setError(error instanceof Error ? error.message : 'This record is unavailable.');
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [recordId]);

  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [loadedSelected, setSelected] = useState<QualificationStandard | null>(null);
  const selected =
    loadedSelected && (!recordId || loadedSelected.id === recordId) ? loadedSelected : null;
  const [correctionVersion, setCorrectionVersion] = useState<QualificationStandardVersion | null>(
    null,
  );
  const [values, setValues] = useState(emptyValues);
  const [evidenceKind, setEvidenceKind] = useState<EvidenceKind>('SOURCE');
  const [documentId, setDocumentId] = useState('');
  const [reason, setReason] = useState('');
  const [loadedDetail, setDetail] = useState<QualificationStandardDetail | null>(null);
  const detail =
    loadedDetail && (!recordId || loadedDetail.standard.id === recordId) ? loadedDetail : null;
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState('');
  const returnFocusRef = useRef<{ focus(): void } | null>(null);

  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await fetch(
      '/api/v1/agencies/' + agencyId + '/qualification-standards' + path,
      {
        ...init,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...init.headers },
      },
    );
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(errorMessage(value, 'The Qualification Standard action failed.'));
    }
    return value;
  }

  async function refresh(): Promise<void> {
    const value = await request('');
    if (
      typeof value !== 'object' ||
      value === null ||
      !Array.isArray((value as { standards?: unknown }).standards)
    ) {
      throw new Error('The Qualification Standard list response was invalid.');
    }
    setStandards((value as QualificationStandardListResponse).standards);
  }

  function resetAction(): void {
    setError('');
    setReason('');
    setDocumentId('');
    setEvidenceKind('SOURCE');
    setDetail(null);
    setCorrectionVersion(null);
  }

  function openDialog(
    kind: DialogKind,
    standard: QualificationStandard | null,
    target: { focus(): void },
  ): void {
    dialogRef.current = kind;
    returnFocusRef.current = target;
    resetAction();
    setSelected(standard);
    setDialog(kind);
  }

  function closeDialog(force = false): void {
    if (busy && !force) return;
    dialogRef.current = null;
    const focusTarget = returnFocusRef.current;
    navigation.navigate({ record: null, view: null });
    setDialog(null);
    setSelected(null);
    setDetail(null);
    setCorrectionVersion(null);
    setTimeout(() => {
      focusTarget?.focus();
      setTimeout(() => focusTarget?.focus(), 0);
    }, 0);
  }

  async function openDetail(
    standard: QualificationStandard,
    target: { focus(): void },
  ): Promise<void> {
    returnFocusRef.current = target;
    navigation.navigate({ record: standard.id, view: 'form' });
  }

  async function submitDraft(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || !validForm(event) || (dialog === 'edit' && !selected?.draft)) return;
    setBusy(true);
    setError('');
    try {
      const isCreate = dialog === 'create';
      await request(isCreate ? '' : '/' + selected?.id + '/draft/' + selected?.draft?.id, {
        method: isCreate ? 'POST' : 'PATCH',
        body: JSON.stringify(payload(values, isCreate)),
      });
      await refresh();
      setSuccess(
        isCreate
          ? 'Draft Qualification Standard “' + values.code + '” was created.'
          : 'Draft Qualification Standard “' + values.code + '” was updated.',
      );
      closeDialog(true);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error ? requestError.message : 'The Draft could not be saved.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitSuccessor(): Promise<void> {
    if (!selected || busy) return;
    setBusy(true);
    setError('');
    try {
      await request('/' + selected.id + '/successor', { method: 'POST' });
      await refresh();
      setSuccess('A Draft successor for “' + selected.code + '” was created.');
      closeDialog(true);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'The successor could not be created.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitEvidence(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selected || !selected.draft || busy || !validForm(event)) return;
    setBusy(true);
    setError('');
    try {
      await request('/' + selected.id + '/draft/' + selected.draft.id + '/evidence', {
        method: 'POST',
        body: JSON.stringify({ kind: evidenceKind, documentId, validationReason: reason }),
      });
      await refresh();
      setSuccess(
        (evidenceKind === 'SOURCE' ? 'Source' : 'Approval') + ' External Evidence was validated.',
      );
      closeDialog(true);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'The evidence could not be validated.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitActivation(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selected || !selected.draft || busy || !validForm(event)) return;
    setBusy(true);
    setError('');
    try {
      await request('/' + selected.id + '/draft/' + selected.draft.id + '/activate', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ reason }),
      });
      await refresh();
      setSuccess('Qualification Standard “' + selected.code + '” was activated.');
      closeDialog(true);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'The Qualification Standard could not be activated.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitCorrection(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selected || !correctionVersion || busy || !validForm(event)) return;
    setBusy(true);
    setError('');
    try {
      const correction = payload(values, false);
      delete correction.effectiveDate;
      delete correction.rowVersion;
      correction.reason = reason;
      await request('/' + selected.id + '/versions/' + correctionVersion.id + '/correct', {
        method: 'POST',
        body: JSON.stringify(correction),
      });
      await refresh();
      setSuccess(
        'Version ' +
          correctionVersion.versionNo +
          ' was voided and replaced with a corrected version.',
      );
      closeDialog(true);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'The correction could not be recorded.',
      );
    } finally {
      setBusy(false);
    }
  }

  function setValue<K extends keyof FormValues>(field: K, value: FormValues[K]): void {
    setValues((current) => ({ ...current, [field]: value }));
  }

  function openCorrection(
    standard: QualificationStandard,
    version: QualificationStandardVersion,
    target: { focus(): void },
  ): void {
    openDialog('correction', standard, target);
    setCorrectionVersion(version);
    setValues(versionValues(standard, version));
  }

  function recordActions(standard: QualificationStandard) {
    return (
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          size="default"
          type="button"
          variant="secondary"
          onClick={(event) =>
            void openDetail(standard, event.currentTarget as unknown as { focus(): void })
          }
        >
          Details
        </Button>
        {standard.draft && canUpdate ? (
          <Button
            size="default"
            type="button"
            variant="secondary"
            onClick={(event) => {
              setValues(versionValues(standard, standard.draft as QualificationStandardVersion));
              openDialog('edit', standard, event.currentTarget as unknown as { focus(): void });
            }}
          >
            Edit Draft
          </Button>
        ) : null}
        {standard.draft && canValidateEvidence ? (
          <Button
            size="default"
            type="button"
            variant="secondary"
            onClick={(event) =>
              openDialog('evidence', standard, event.currentTarget as unknown as { focus(): void })
            }
          >
            Validate Evidence
          </Button>
        ) : null}
        {standard.draft && canActivate ? (
          <Button
            size="default"
            type="button"
            variant="primary"
            onClick={(event) =>
              openDialog('activate', standard, event.currentTarget as unknown as { focus(): void })
            }
          >
            Activate
          </Button>
        ) : null}
        {standard.currentVersion && !standard.draft && canUpdate ? (
          <Button
            size="default"
            type="button"
            variant="secondary"
            onClick={(event) =>
              openDialog('successor', standard, event.currentTarget as unknown as { focus(): void })
            }
          >
            Create Successor
          </Button>
        ) : null}
        {standard.currentVersion && canUpdate ? (
          <Button
            size="default"
            type="button"
            variant="secondary"
            onClick={(event) =>
              openCorrection(
                standard,
                standard.currentVersion as QualificationStandardVersion,
                event.currentTarget as unknown as { focus(): void },
              )
            }
          >
            Correct Version
          </Button>
        ) : null}
      </div>
    );
  }

  const selectedTitle = selected?.code || 'Qualification Standard';
  const copy = dialogCopy[dialog ?? 'detail'](selectedTitle);
  const dialogDescriptionId = 'qualification-standard-dialog-description';

  // Create, Edit Draft, and Details replace the register with an inline record; Correct Version
  // opens below it.
  const registerHidden = dialog === 'detail' || dialog === 'create' || dialog === 'edit';

  return (
    <Dialog
      presentation={registerHidden || dialog === 'correction' ? 'form' : 'dialog'}
      open={dialog !== null}
      onOpenChange={(open) => !open && closeDialog()}
    >
      <div className="grid min-w-0 gap-5">
        <PageHeader
          breadcrumbs={[{ label: 'Structure' }]}
          title="Qualification Standards"
          actions={
            canCreate ? (
              // Hidden rather than unmounted so focus can return to it when the form closes.
              <DialogTrigger asChild>
                <Button
                  hidden={registerHidden}
                  size="default"
                  type="button"
                  variant="primary"
                  onClick={(event) => {
                    resetAction();
                    setValues(emptyValues());
                    returnFocusRef.current = event.currentTarget as unknown as { focus(): void };
                    dialogRef.current = 'create';
                    setDialog('create');
                  }}
                >
                  Create Qualification Standard
                </Button>
              </DialogTrigger>
            ) : null
          }
        />

        <div hidden={registerHidden} className="grid min-w-0 gap-5">
          {success ? (
            <p
              className="m-0 rounded-control border border-success/40 bg-success/5 px-3 py-2.5 text-small text-success"
              role="status"
            >
              {success}
            </p>
          ) : null}

          <Panel
            title="Agency register"
            flush
            actions={
              <span className="text-caption text-ink-muted tabular-nums">
                {standards.length === 1 ? '1 standard' : standards.length + ' standards'}
              </span>
            }
          >
            {standards.length === 0 ? (
              <StateSurface compact labelledBy="qualification-standards-empty">
                <strong className="font-[650] text-ink" id="qualification-standards-empty">
                  No Qualification Standards yet.
                </strong>
                <p className="m-0 max-w-[560px]">
                  Create a Draft with the official minimum requirements, then link and validate
                  source and approval External Evidence before activation.
                </p>
              </StateSurface>
            ) : (
              <Table className="min-w-[860px]">
                <thead>
                  <tr>
                    <Th>Standard</Th>
                    <Th>Current effectivity</Th>
                    <Th>Draft</Th>
                    <Th>Status</Th>
                    <Th>
                      <span className="sr-only">Actions</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {standards.map((standard) => (
                    <Tr key={standard.id}>
                      <Td>
                        <div className="grid gap-0.5">
                          <button
                            className="w-fit cursor-pointer border-0 bg-transparent p-0 text-left font-[600] text-primary hover:underline"
                            type="button"
                            onClick={(event) =>
                              void openDetail(
                                standard,
                                event.currentTarget as unknown as { focus(): void },
                              )
                            }
                          >
                            {standard.code}
                          </button>
                          <span className="text-caption text-ink-muted">{standard.name}</span>
                        </div>
                      </Td>
                      <Td kind="date">
                        {standard.currentVersion
                          ? 'v' +
                            standard.currentVersion.versionNo +
                            ' · ' +
                            dateLabel(standard.currentVersion.effectiveFrom)
                          : 'No active version'}
                      </Td>
                      <Td kind="date" className="text-ink-muted">
                        {standard.draft
                          ? 'v' +
                            standard.draft.versionNo +
                            ' · ' +
                            dateLabel(standard.draft.effectiveFrom)
                          : 'None'}
                      </Td>
                      <Td>
                        <Status status={standard.status} />
                      </Td>
                      <Td>{recordActions(standard)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>
        </div>

        {dialog === 'detail' ? (
          <div>
            <RecordReturn href={navigation.href({ record: null, view: null })}>
              ← Qualification Standards
            </RecordReturn>
          </div>
        ) : null}
        <DialogContent
          aria-describedby={dialogDescriptionId}
          className={dialog === 'create' || dialog === 'edit' ? 'max-w-[980px]' : undefined}
        >
          <DialogHeader>
            <div className="grid min-w-0 gap-1">
              <DialogTitle>{copy.title}</DialogTitle>
              <DialogDescription id={dialogDescriptionId}>{copy.description}</DialogDescription>
            </div>
            <DialogClose asChild>
              <Button
                aria-label="Close Qualification Standard dialog"
                className="px-2.5"
                disabled={busy}
                type="button"
              >
                <span aria-hidden="true" className="text-xl leading-none">
                  ×
                </span>
              </Button>
            </DialogClose>
          </DialogHeader>

          {dialog === 'detail' ? (
            <>
              {selected ? <div className="px-5 pt-4">{recordActions(selected)}</div> : null}
              <DetailBody detail={detail} detailLoading={detailLoading} error={error} />
            </>
          ) : dialog === 'evidence' ? (
            <EvidenceForm
              busy={busy}
              documentId={documentId}
              evidenceKind={evidenceKind}
              error={error}
              onDocumentChange={setDocumentId}
              onKindChange={setEvidenceKind}
              onReasonChange={setReason}
              onSubmit={submitEvidence}
              reason={reason}
            />
          ) : dialog === 'activate' ? (
            <ReasonForm
              busy={busy}
              buttonLabel="Activate Version"
              description={
                'Version ' +
                selected?.draft?.versionNo +
                ' becomes immutable after activation. Both source and approval evidence must be validated first.'
              }
              error={error}
              id="qualification-activation-reason"
              onReasonChange={setReason}
              onSubmit={submitActivation}
              reason={reason}
            />
          ) : dialog === 'correction' ? (
            <form onSubmit={(event) => void submitCorrection(event)}>
              <DialogBody className="grid gap-5">
                <FormError message={error} />
                <p className="m-0 border-l-2 border-danger bg-canvas px-3 py-2.5 text-small text-ink">
                  Version {correctionVersion?.versionNo} remains in history as VOIDED. The corrected
                  replacement keeps the original effectivity and evidence pins.
                </p>
                {requirementsForm(values, setValue, false)}
                <Field htmlFor="qualification-correction-reason" label="Correction reason">
                  <textarea
                    className={inputClass}
                    id="qualification-correction-reason"
                    onChange={(event) => setReason(targetValue(event))}
                    required
                    rows={3}
                    value={reason}
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
                  {busy ? 'Recording…' : 'Void and Replace'}
                </Button>
              </DialogFooter>
            </form>
          ) : dialog === 'create' || dialog === 'edit' ? (
            <form
              className="flex min-h-0 flex-1 flex-col overflow-hidden"
              onSubmit={(event) => void submitDraft(event)}
            >
              <DialogBody className="grid auto-rows-max content-start gap-6">
                <FormError message={error} />
                <section className="grid gap-4" aria-labelledby="qualification-matrix-record">
                  <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3">
                    <h3 className="m-0 text-panel-title text-ink" id="qualification-matrix-record">
                      Minimum qualification matrix
                    </h3>
                    <div className="w-full max-w-[280px]">
                      <Field htmlFor="qualification-standard-effective-date" label="Effective date">
                        <input
                          className={inputClass}
                          id="qualification-standard-effective-date"
                          onChange={(event) => setValue('effectiveDate', targetValue(event))}
                          required
                          type="date"
                          value={values.effectiveDate}
                        />
                      </Field>
                    </div>
                  </div>
                  {dialog === 'create' ? (
                    <div className="grid gap-4 min-[621px]:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
                      <Field
                        htmlFor="qualification-standard-code"
                        label="Qualification Standard code"
                      >
                        <input
                          autoFocus
                          data-autofocus=""
                          className={inputClass}
                          id="qualification-standard-code"
                          maxLength={80}
                          onChange={(event) => setValue('code', targetValue(event))}
                          required
                          value={values.code}
                        />
                      </Field>
                      <Field
                        htmlFor="qualification-standard-name"
                        label="Qualification Standard name"
                      >
                        <input
                          className={inputClass}
                          id="qualification-standard-name"
                          maxLength={200}
                          onChange={(event) => setValue('name', targetValue(event))}
                          required
                          value={values.name}
                        />
                      </Field>
                    </div>
                  ) : null}
                </section>
                {qualificationMatrixForm(values, setValue)}
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button disabled={busy} size="default" type="button" variant="secondary">
                    Cancel
                  </Button>
                </DialogClose>
                <Button disabled={busy} size="default" type="submit" variant="primary">
                  {busy ? 'Saving…' : dialog === 'create' ? 'Create Draft' : 'Save Draft'}
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <>
              <DialogBody className="grid gap-5">
                <FormError message={error} />
                <p className="m-0 text-body text-ink-muted">
                  The next version copies the current published requirements and receives a later
                  effective date. It remains Draft until reviewed and activated.
                </p>
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button disabled={busy} size="default" type="button" variant="secondary">
                    Cancel
                  </Button>
                </DialogClose>
                <Button
                  disabled={busy}
                  onClick={() => void submitSuccessor()}
                  size="default"
                  type="button"
                  variant="primary"
                >
                  {busy ? 'Creating…' : 'Create Successor'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </div>
    </Dialog>
  );
}

type FormValueSetter = <K extends keyof FormValues>(field: K, value: FormValues[K]) => void;

function NumberRequirementInput({
  field,
  id,
  label,
  setValue,
  step,
  unit,
  values,
}: {
  field: 'trainingHoursRequired' | 'experienceMonthsRequired';
  id: string;
  label: string;
  setValue: FormValueSetter;
  step: string;
  unit: 'hours' | 'months';
  values: FormValues;
}) {
  return (
    <div className="flex w-full max-w-[280px] overflow-hidden rounded-control border border-border bg-surface focus-within:border-primary focus-within:shadow-[inset_0_0_0_1px_var(--color-primary)]">
      <input
        aria-describedby={`${id}-unit`}
        aria-label={label}
        className="min-h-9 min-w-0 flex-1 border-0 bg-surface px-2.5 text-body text-ink outline-none"
        id={id}
        min="0"
        onChange={(event) => setValue(field, targetValue(event))}
        step={step}
        type="number"
        value={values[field]}
      />
      <span
        className="inline-flex min-w-[78px] items-center justify-center border-l border-border bg-canvas px-3 text-caption font-[650] text-ink-muted"
        id={`${id}-unit`}
      >
        {unit}
      </span>
    </div>
  );
}

function listText(value: string): string {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return '';
    return parsed
      .map((item) => {
        if (typeof item === 'string') return item;
        if (typeof item !== 'object' || item === null) return String(item);
        const record = item as { code?: unknown; name?: unknown; level?: unknown };
        const label =
          typeof record.name === 'string'
            ? record.name
            : typeof record.code === 'string'
              ? record.code
              : JSON.stringify(item);
        return record.level === undefined ? label : label + ' — level ' + String(record.level);
      })
      .join('\n');
  } catch {
    return value;
  }
}

function ListRequirementField({
  field,
  id,
  label,
  setValue,
  values,
}: {
  field: 'competencyRequirements' | 'licenseRequirements';
  id: string;
  label: string;
  setValue: FormValueSetter;
  values: FormValues;
}) {
  return (
    <Field htmlFor={id} label={label}>
      <textarea
        className={inputClass}
        id={id}
        onChange={(event) =>
          setValue(
            field,
            JSON.stringify(
              targetValue(event)
                .split('\n')
                .map((item) => item.trim())
                .filter(Boolean),
            ),
          )
        }
        placeholder="Add one requirement per line"
        rows={4}
        value={listText(values[field])}
      />
      <span className="font-normal text-ink-muted">One requirement per line.</span>
    </Field>
  );
}

function MatrixRow({
  children,
  htmlFor,
  label,
}: {
  children: ReactNode;
  htmlFor: string;
  label: string;
}) {
  return (
    <div className="grid border-b border-border-subtle last:border-b-0 min-[700px]:grid-cols-[150px_minmax(0,1fr)]">
      <label className="bg-canvas px-4 py-3 text-caption font-[650] text-ink" htmlFor={htmlFor}>
        {label}
      </label>
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}

function qualificationMatrixForm(values: FormValues, setValue: FormValueSetter): ReactNode {
  return (
    <>
      <section
        className="overflow-hidden rounded-panel border border-border"
        aria-label="Core minimum requirements"
      >
        <div className="hidden grid-cols-[150px_minmax(0,1fr)] border-b border-border bg-canvas text-caption font-[650] text-ink min-[700px]:grid">
          <span className="px-4 py-2">Criterion</span>
          <span className="px-4 py-2">Minimum requirement</span>
        </div>
        <MatrixRow htmlFor="qualification-education" label="Education">
          <textarea
            aria-label="Education requirement"
            className={inputClass}
            id="qualification-education"
            onChange={(event) => setValue('educationRequirement', targetValue(event))}
            rows={2}
            value={values.educationRequirement}
          />
        </MatrixRow>
        <MatrixRow htmlFor="qualification-training-hours" label="Training">
          <NumberRequirementInput
            field="trainingHoursRequired"
            id="qualification-training-hours"
            label="Training hours required"
            setValue={setValue}
            step="0.25"
            unit="hours"
            values={values}
          />
        </MatrixRow>
        <MatrixRow htmlFor="qualification-experience-months" label="Experience">
          <NumberRequirementInput
            field="experienceMonthsRequired"
            id="qualification-experience-months"
            label="Experience months required"
            setValue={setValue}
            step="1"
            unit="months"
            values={values}
          />
        </MatrixRow>
        <MatrixRow htmlFor="qualification-eligibility" label="Eligibility">
          <textarea
            aria-label="Civil-service eligibility"
            className={inputClass}
            id="qualification-eligibility"
            onChange={(event) => setValue('eligibilityRequirement', targetValue(event))}
            rows={2}
            value={values.eligibilityRequirement}
          />
        </MatrixRow>
      </section>
      <section className="grid gap-4">
        <h3 className="m-0 text-panel-title text-ink">Additional requirements</h3>
        <div className="grid gap-4 min-[760px]:grid-cols-2">
          <ListRequirementField
            field="competencyRequirements"
            id="qualification-competencies"
            label="Competencies"
            setValue={setValue}
            values={values}
          />
          <ListRequirementField
            field="licenseRequirements"
            id="qualification-licenses"
            label="Licenses"
            setValue={setValue}
            values={values}
          />
          <div className="min-[760px]:col-span-2">
            <Field htmlFor="qualification-special-requirements" label="Special requirements">
              <textarea
                className={inputClass}
                id="qualification-special-requirements"
                onChange={(event) => setValue('specialRequirements', targetValue(event))}
                rows={3}
                value={values.specialRequirements}
              />
            </Field>
          </div>
        </div>
      </section>
    </>
  );
}

function requirementsForm(
  values: FormValues,
  setValue: FormValueSetter,
  includeEffectiveDate: boolean,
): ReactNode {
  return (
    <fieldset className="grid gap-4">
      <legend className="mb-1 text-panel-title text-ink">Minimum requirements</legend>
      {includeEffectiveDate ? (
        <Field htmlFor="qualification-standard-effective-date" label="Effective date">
          <input
            className={inputClass}
            id="qualification-standard-effective-date"
            onChange={(event) => setValue('effectiveDate', targetValue(event))}
            required
            type="date"
            value={values.effectiveDate}
          />
        </Field>
      ) : null}
      <div className="grid gap-4 min-[621px]:grid-cols-2">
        <Field htmlFor="qualification-education" label="Education requirement">
          <textarea
            className={inputClass}
            id="qualification-education"
            onChange={(event) => setValue('educationRequirement', targetValue(event))}
            rows={3}
            value={values.educationRequirement}
          />
        </Field>
        <Field htmlFor="qualification-eligibility" label="Civil-service eligibility">
          <textarea
            className={inputClass}
            id="qualification-eligibility"
            onChange={(event) => setValue('eligibilityRequirement', targetValue(event))}
            rows={3}
            value={values.eligibilityRequirement}
          />
        </Field>
      </div>
      <div className="grid gap-4 min-[621px]:grid-cols-2">
        <Field htmlFor="qualification-training-hours" label="Training hours required">
          <input
            className={inputClass}
            id="qualification-training-hours"
            min="0"
            onChange={(event) => setValue('trainingHoursRequired', targetValue(event))}
            step="0.25"
            type="number"
            value={values.trainingHoursRequired}
          />
        </Field>
        <Field htmlFor="qualification-experience-months" label="Experience months required">
          <input
            className={inputClass}
            id="qualification-experience-months"
            min="0"
            onChange={(event) => setValue('experienceMonthsRequired', targetValue(event))}
            step="1"
            type="number"
            value={values.experienceMonthsRequired}
          />
        </Field>
      </div>
      <Field
        htmlFor="qualification-competencies"
        label="Structured competency requirements (JSON array)"
      >
        <textarea
          className={cn(inputClass, 'font-mono text-caption')}
          id="qualification-competencies"
          onChange={(event) => setValue('competencyRequirements', targetValue(event))}
          rows={5}
          value={values.competencyRequirements}
        />
      </Field>
      <Field htmlFor="qualification-licenses" label="License requirements (JSON array)">
        <textarea
          className={cn(inputClass, 'font-mono text-caption')}
          id="qualification-licenses"
          onChange={(event) => setValue('licenseRequirements', targetValue(event))}
          rows={4}
          value={values.licenseRequirements}
        />
      </Field>
      <Field htmlFor="qualification-special-requirements" label="Special requirements">
        <textarea
          className={inputClass}
          id="qualification-special-requirements"
          onChange={(event) => setValue('specialRequirements', targetValue(event))}
          rows={3}
          value={values.specialRequirements}
        />
      </Field>
    </fieldset>
  );
}

function EvidenceForm({
  busy,
  documentId,
  evidenceKind,
  error,
  onDocumentChange,
  onKindChange,
  onReasonChange,
  onSubmit,
  reason,
}: {
  busy: boolean;
  documentId: string;
  evidenceKind: EvidenceKind;
  error: string;
  onDocumentChange: (value: string) => void;
  onKindChange: (value: EvidenceKind) => void;
  onReasonChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  reason: string;
}) {
  return (
    <form onSubmit={(event) => void onSubmit(event)}>
      <DialogBody className="grid gap-5">
        <FormError message={error} />
        <fieldset className="grid gap-4">
          <legend className="mb-1 text-panel-title text-ink">Evidence role</legend>
          <div className="grid gap-3 min-[621px]:grid-cols-2">
            {(['SOURCE', 'APPROVAL'] as const).map((kind) => (
              <label
                className="flex min-h-9 items-center gap-2 rounded-control border border-border px-3 text-body text-ink"
                key={kind}
              >
                <input
                  checked={evidenceKind === kind}
                  name="evidence-kind"
                  onChange={() => onKindChange(kind)}
                  type="radio"
                  value={kind}
                />
                {kind === 'SOURCE' ? 'Source' : 'Approval'}
              </label>
            ))}
          </div>
        </fieldset>
        <Field htmlFor="qualification-evidence-document" label="External Evidence document ID">
          <input
            className={inputClass}
            id="qualification-evidence-document"
            onChange={(event) => onDocumentChange(targetValue(event))}
            required
            value={documentId}
          />
        </Field>
        <Field htmlFor="qualification-evidence-reason" label="Validation reason">
          <textarea
            className={inputClass}
            id="qualification-evidence-reason"
            onChange={(event) => onReasonChange(targetValue(event))}
            required
            rows={3}
            value={reason}
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
          {busy ? 'Validating…' : 'Validate Evidence'}
        </Button>
      </DialogFooter>
    </form>
  );
}

function ReasonForm({
  busy,
  buttonLabel,
  description,
  error,
  id,
  onReasonChange,
  onSubmit,
  reason,
}: {
  busy: boolean;
  buttonLabel: string;
  description: string;
  error: string;
  id: string;
  onReasonChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  reason: string;
}) {
  return (
    <form onSubmit={(event) => void onSubmit(event)}>
      <DialogBody className="grid gap-5">
        <FormError message={error} />
        <p className="m-0 text-body text-ink-muted">{description}</p>
        <Field htmlFor={id} label="Reason">
          <textarea
            autoFocus
            className={inputClass}
            id={id}
            onChange={(event) => onReasonChange(targetValue(event))}
            required
            rows={3}
            value={reason}
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
          {busy ? 'Working…' : buttonLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

function EvidenceDetails({ label, evidence }: { label: string; evidence: Evidence | null }) {
  return (
    <div className="grid gap-0.5 rounded-control border border-border bg-surface px-3 py-2 text-caption">
      <strong className="font-[650] text-ink">{label}</strong>
      {evidence ? (
        <>
          <span className="text-ink-muted">
            {evidence.documentNo ?? evidence.documentId} · version {evidence.versionNo}
          </span>
          <span className="text-ink-muted">
            Validated{' '}
            {new Date(evidence.validatedAt).toLocaleString('en-PH', {
              dateStyle: 'medium',
              timeStyle: 'short',
              timeZone: 'Asia/Manila',
            })}
          </span>
          <span className="break-words text-ink">{evidence.validationReason}</span>
        </>
      ) : (
        <span className="text-ink-muted">Not validated</span>
      )}
    </div>
  );
}

function Fact({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div>
      <dt className="text-caption text-ink-muted">{label}</dt>
      <dd className="m-0 text-body text-ink">{children}</dd>
    </div>
  );
}

function DetailBody({
  detail,
  detailLoading,
  error,
}: {
  detail: QualificationStandardDetail | null;
  detailLoading: boolean;
  error: string;
}) {
  return (
    <>
      <DialogBody className="grid gap-5">
        {detailLoading ? (
          <StateSurface compact busy label="Qualification Standard history">
            <p className="m-0">Loading standard history…</p>
          </StateSurface>
        ) : null}
        <FormError message={error} />
        {detail ? (
          <>
            <dl className="m-0 grid gap-4 min-[621px]:grid-cols-2">
              <Fact label="Code">
                <span className="font-[600]">{detail.standard.code}</span>
              </Fact>
              <Fact label="Name">{detail.standard.name}</Fact>
              <Fact label="Stable status">
                <Status status={detail.standard.status} />
              </Fact>
              <Fact label={'Effective on ' + dateLabel(detail.asOf)}>
                {detail.effective
                  ? 'Version ' + detail.effective.versionNo
                  : 'No effective version'}
              </Fact>
            </dl>
            <Panel title="Version history">
              <div className="grid gap-4">
                {detail.versions.map((version) => (
                  <article
                    className="grid gap-3 border-b border-border-subtle pb-4 last:border-b-0 last:pb-0"
                    key={version.id}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="grid gap-0.5">
                        <strong className="text-body font-[650] text-ink">
                          Version {version.versionNo}
                        </strong>
                        <span className="text-caption text-ink-muted">
                          {dateLabel(version.effectiveFrom)}
                          {version.effectiveTo
                            ? ' – ' + dateLabel(version.effectiveTo)
                            : ' – open-ended'}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Status status={version.versionState} />
                        <Status status={version.lifecycleStatus} />
                      </div>
                    </div>
                    <dl className="m-0 grid gap-3 min-[621px]:grid-cols-2">
                      <Fact label="Education">
                        {version.educationRequirement || 'Not specified'}
                      </Fact>
                      <Fact label="Eligibility">
                        {version.eligibilityRequirement || 'Not specified'}
                      </Fact>
                      <Fact label="Training hours">
                        {version.trainingHoursRequired ?? 'Not specified'}
                      </Fact>
                      <Fact label="Experience months">
                        {version.experienceMonthsRequired ?? 'Not specified'}
                      </Fact>
                      <Fact label="Competencies">
                        <span className="font-mono text-caption break-words">
                          {JSON.stringify(version.competencyRequirements)}
                        </span>
                      </Fact>
                      <Fact label="Licenses">
                        <span className="font-mono text-caption break-words">
                          {JSON.stringify(version.licenseRequirements)}
                        </span>
                      </Fact>
                      <div className="min-[621px]:col-span-2">
                        <Fact label="Special requirements">
                          {version.specialRequirements || 'Not specified'}
                        </Fact>
                      </div>
                    </dl>
                    <div className="grid gap-2 min-[621px]:grid-cols-2">
                      <EvidenceDetails
                        label="Source External Evidence"
                        evidence={version.sourceEvidence}
                      />
                      <EvidenceDetails
                        label="Approval External Evidence"
                        evidence={version.approvalEvidence}
                      />
                    </div>
                  </article>
                ))}
              </div>
            </Panel>
            <Panel title="Transition history" flush>
              {detail.history.length ? (
                <Table>
                  <thead>
                    <tr>
                      <Th>Action</Th>
                      <Th>Reason</Th>
                      <Th kind="date">Recorded</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.history.map((entry) => (
                      <Tr key={entry.id}>
                        <Td>{entry.action}</Td>
                        <Td>{entry.reason ?? 'No reason recorded'}</Td>
                        <Td kind="date">{dateLabel(entry.occurredAt)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              ) : (
                <StateSurface compact label="Transition history">
                  <p className="m-0">No transitions recorded.</p>
                </StateSurface>
              )}
            </Panel>
          </>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <DialogClose asChild>
          <Button size="default" type="button" variant="secondary">
            Close
          </Button>
        </DialogClose>
      </DialogFooter>
    </>
  );
}
