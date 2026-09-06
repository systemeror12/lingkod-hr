'use client';

import { Field, inputClass, FormError } from './ui/field';

import { RecordReturn, useRecordNavigation } from './record-navigation';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
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
import { Button } from './ui/button';
import { manilaToday } from '../lib/manila-date';

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

function statusClass(status: 'ACTIVE' | 'INACTIVE' | VersionState): string {
  if (status === 'ACTIVE') return 'bg-[#e8f3ed] text-[#316647]';
  if (status === 'SUPERSEDED' || status === 'VOIDED' || status === 'INACTIVE') {
    return 'bg-[#f0f2f5] text-muted';
  }
  return 'bg-[#fff3d6] text-[#79531c]';
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
  useEffect(() => {
    let active = true;
    setDetail(null);
    setSelected(null);
    setError('');
    if (!recordId) {
      setDialog(null);
      setSelected(null);
      return;
    }
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
    returnFocusRef.current = target;
    resetAction();
    setSelected(standard);
    setDialog(kind);
  }

  function closeDialog(force = false): void {
    if (busy && !force) return;
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
            className="min-h-9 px-3 text-xs"
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
            className="border border-[#d9a5a5] bg-paper px-3 py-2 text-xs font-[650] text-[#9a3030] hover:bg-[#fff4f4]"
            size="default"
            type="button"
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
  const dialogDescriptionId = 'qualification-standard-dialog-description';

  return (
    <Dialog
      presentation={
        dialog === 'detail' || dialog === 'create' || dialog === 'edit' || dialog === 'correction'
          ? 'form'
          : 'dialog'
      }
      open={dialog !== null}
      onOpenChange={(open) => !open && closeDialog()}
    >
      <div
        hidden={dialog === 'detail' || dialog === 'create' || dialog === 'edit'}
        className="min-w-0 space-y-5"
      >
        <header className="flex flex-wrap items-end justify-between gap-5">
          <div className="grid max-w-[760px] gap-2">
            <p className="m-0 text-[11px] font-bold tracking-[0.09em] text-cobalt uppercase">
              Qualification register
            </p>
            <h1 className="m-0 text-[clamp(28px,3vw,38px)] leading-[1.08] font-[680] tracking-[-0.035em] text-midnight">
              Qualification Standards
            </h1>
            <p className="m-0 text-sm leading-[1.65] text-muted">
              Maintain stable Agency Qualification Standards through evidence-backed,
              effective-dated versions. Published versions are immutable.
            </p>
          </div>
          {canCreate ? (
            <DialogTrigger asChild>
              <Button
                className="min-h-11"
                size="default"
                type="button"
                variant="primary"
                onClick={(event) => {
                  resetAction();
                  setValues(emptyValues());
                  returnFocusRef.current = event.currentTarget as unknown as { focus(): void };
                  setDialog('create');
                }}
              >
                Create Qualification Standard
              </Button>
            </DialogTrigger>
          ) : null}
        </header>

        {success ? (
          <p
            className="m-0 rounded-[3px] border border-[#b9d8c3] bg-[#f2faf4] px-4 py-3 text-sm text-[#316647]"
            role="status"
          >
            {success}
          </p>
        ) : null}

        <section
          className="overflow-hidden rounded-[5px] border border-line bg-paper"
          aria-labelledby="qualification-standard-register-heading"
        >
          <header className="flex min-h-[60px] flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
            <div className="grid gap-1">
              <h2
                className="m-0 text-sm font-[670] text-midnight"
                id="qualification-standard-register-heading"
              >
                Agency register
              </h2>
              <span className="text-xs text-muted">
                {standards.length === 1 ? '1 standard' : standards.length + ' standards'}
              </span>
            </div>
            <span className="rounded-full bg-pale-blue px-2.5 py-1 text-xs font-[650] text-cobalt">
              Agency scoped · Evidence required
            </span>
          </header>

          {standards.length === 0 ? (
            <div className="grid min-h-[260px] place-content-center gap-2 px-6 py-12">
              <strong className="text-[15px] font-[650] text-midnight">
                No Qualification Standards yet.
              </strong>
              <p className="m-0 max-w-[560px] text-[13px] leading-[1.6] text-muted">
                Create a Draft with the official minimum requirements, then link and validate source
                and approval External Evidence before activation.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] border-collapse text-left text-sm">
                <thead className="bg-canvas text-[11px] tracking-[0.07em] text-muted uppercase">
                  <tr>
                    <th className="px-5 py-3 font-bold" scope="col">
                      Standard
                    </th>
                    <th className="px-5 py-3 font-bold" scope="col">
                      Current effectivity
                    </th>
                    <th className="px-5 py-3 font-bold" scope="col">
                      Draft
                    </th>
                    <th className="px-5 py-3 font-bold" scope="col">
                      Status
                    </th>
                    <th className="px-5 py-3 font-bold" scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {standards.map((standard) => (
                    <tr key={standard.id}>
                      <td className="px-5 py-4 align-top">
                        <div className="grid gap-1">
                          <button
                            className="w-fit cursor-pointer text-left font-[670] text-cobalt underline-offset-2 hover:underline"
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
                          <span className="text-xs text-muted">{standard.name}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4 align-top text-xs text-ink">
                        {standard.currentVersion
                          ? 'v' +
                            standard.currentVersion.versionNo +
                            ' · ' +
                            dateLabel(standard.currentVersion.effectiveFrom)
                          : 'No active version'}
                      </td>
                      <td className="px-5 py-4 align-top text-xs text-muted">
                        {standard.draft
                          ? 'v' +
                            standard.draft.versionNo +
                            ' · ' +
                            dateLabel(standard.draft.effectiveFrom)
                          : 'None'}
                      </td>
                      <td className="px-5 py-4 align-top">
                        <span
                          className={
                            'inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold tracking-[0.07em] uppercase ' +
                            statusClass(standard.status)
                          }
                        >
                          {standard.status}
                        </span>
                      </td>
                      <td className="px-5 py-4 align-top">{recordActions(standard)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {dialog === 'detail' ? (
        <div className="mb-4">
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
          <div className="grid min-w-0 gap-1.5">
            <p className="m-0 text-[11px] font-bold tracking-[0.08em] text-cobalt uppercase">
              Qualification register
            </p>
            <DialogTitle>
              {dialog === 'create'
                ? 'Create Qualification Standard'
                : dialog === 'edit'
                  ? 'Edit Draft Qualification Standard'
                  : dialog === 'evidence'
                    ? 'Validate Evidence · ' + selectedTitle
                    : dialog === 'activate'
                      ? 'Activate ' + selectedTitle
                      : dialog === 'correction'
                        ? 'Correct Version · ' + selectedTitle
                        : dialog === 'successor'
                          ? 'Create Successor · ' + selectedTitle
                          : 'Qualification Standard · ' + selectedTitle}
            </DialogTitle>
            <DialogDescription id={dialogDescriptionId}>
              {dialog === 'create' || dialog === 'edit'
                ? 'Record the requirements for one Draft version. The stable Standard remains inactive until both source and approval External Evidence are validated.'
                : dialog === 'evidence'
                  ? 'Pin the selected same-Agency External Evidence version and record the validation reason.'
                  : dialog === 'activate'
                    ? 'Activation checks effectivity, evidence, and overlap atomically. Published requirements cannot be edited.'
                    : dialog === 'correction'
                      ? 'Use a reasoned correction when a published fact is wrong. The original version is voided and retained in history.'
                      : dialog === 'successor'
                        ? 'The successor copies the current requirements and receives a later effective date. It remains Draft until reviewed.'
                        : 'Inspect effective-dated versions, pinned evidence, and the immutable transition history.'}
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <Button
              aria-label="Close Qualification Standard dialog"
              className="border border-line bg-paper text-muted hover:bg-canvas"
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
            {selected ? <div className="p-4">{recordActions(selected)}</div> : null}
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
              {error ? <FormError message={error} /> : null}
              <p className="m-0 rounded-[3px] bg-[#fff4f4] px-4 py-3 text-sm leading-[1.6] text-[#9a3030]">
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
              {error ? <FormError message={error} /> : null}
              <section className="grid gap-4" aria-labelledby="qualification-matrix-record">
                <div className="flex flex-wrap items-end justify-between gap-3 border-b-2 border-midnight pb-3">
                  <div>
                    <p className="m-0 text-[10px] font-bold tracking-[0.09em] text-cobalt uppercase">
                      Qualification record
                    </p>
                    <h3
                      className="m-0 mt-1 text-base font-[700] text-midnight"
                      id="qualification-matrix-record"
                    >
                      Minimum qualification matrix
                    </h3>
                  </div>
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
          <DialogBody className="grid gap-5">
            {error ? <FormError message={error} /> : null}
            <p className="m-0 rounded-[3px] bg-canvas px-4 py-3 text-sm leading-[1.6] text-muted">
              The next version copies the current published requirements and receives a later
              effective date. It remains Draft until reviewed and activated.
            </p>
            <DialogFooter className="-mx-6 border-t-0 px-0 pb-0 min-[621px]:-mx-8 min-[621px]:px-0">
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
          </DialogBody>
        )}
      </DialogContent>
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
    <div className="flex w-full max-w-[280px] overflow-hidden rounded-[3px] border border-line bg-paper focus-within:border-cobalt focus-within:ring-2 focus-within:ring-cobalt/15">
      <input
        aria-describedby={`${id}-unit`}
        aria-label={label}
        className="min-h-11 min-w-0 flex-1 bg-paper px-3 text-sm text-ink outline-none"
        id={id}
        min="0"
        onChange={(event) => setValue(field, targetValue(event))}
        step={step}
        type="number"
        value={values[field]}
      />
      <span
        className="inline-flex min-w-[78px] items-center justify-center border-l border-line bg-canvas px-3 text-xs font-[650] text-muted"
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
      <span className="text-xs leading-5 font-normal text-muted">One requirement per line.</span>
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
    <div className="grid border-b border-line last:border-b-0 min-[700px]:grid-cols-[150px_minmax(0,1fr)]">
      <label className="bg-canvas px-4 py-4 text-xs font-[680] text-midnight" htmlFor={htmlFor}>
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
        className="overflow-hidden rounded-[3px] border border-line"
        aria-label="Core minimum requirements"
      >
        <div className="hidden grid-cols-[150px_minmax(0,1fr)] bg-midnight text-[10px] font-bold tracking-[0.08em] text-paper uppercase min-[700px]:grid">
          <span className="px-4 py-2.5">Criterion</span>
          <span className="px-4 py-2.5">Minimum requirement</span>
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
        <h3 className="m-0 text-sm font-[680] text-midnight">Additional requirements</h3>
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
      <legend className="mb-1 text-sm font-[670] text-midnight">Minimum requirements</legend>
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
          className={inputClass + ' font-mono text-xs'}
          id="qualification-competencies"
          onChange={(event) => setValue('competencyRequirements', targetValue(event))}
          rows={5}
          value={values.competencyRequirements}
        />
      </Field>
      <Field htmlFor="qualification-licenses" label="License requirements (JSON array)">
        <textarea
          className={inputClass + ' font-mono text-xs'}
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
        {error ? <FormError message={error} /> : null}
        <fieldset className="grid gap-4">
          <legend className="mb-1 text-sm font-[670] text-midnight">Evidence role</legend>
          <div className="grid gap-3 min-[621px]:grid-cols-2">
            {(['SOURCE', 'APPROVAL'] as const).map((kind) => (
              <label
                className="flex min-h-11 items-center gap-2 rounded-[3px] border border-line px-3 text-sm text-ink"
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
        {error ? <FormError message={error} /> : null}
        <p className="m-0 rounded-[3px] bg-canvas px-4 py-3 text-sm leading-[1.6] text-muted">
          {description}
        </p>
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
    <div className="grid gap-1 rounded-[3px] border border-line bg-paper px-3 py-2 text-xs">
      <strong className="text-ink">{label}</strong>
      {evidence ? (
        <>
          <span className="text-muted">
            {evidence.documentNo ?? evidence.documentId} · version {evidence.versionNo}
          </span>
          <span className="text-muted">
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
        <span className="text-muted">Not validated</span>
      )}
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
    <DialogBody>
      {detailLoading ? <p className="m-0 text-sm text-muted">Loading standard history…</p> : null}
      {error ? <FormError message={error} /> : null}
      {detail ? (
        <div className="grid gap-7">
          <dl className="grid gap-4 text-sm min-[621px]:grid-cols-2">
            <div>
              <dt className="text-xs text-muted">Code</dt>
              <dd className="m-0 font-[650] text-ink">{detail.standard.code}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Name</dt>
              <dd className="m-0 text-ink">{detail.standard.name}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Stable status</dt>
              <dd className="m-0 text-ink">{detail.standard.status}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Effective on {dateLabel(detail.asOf)}</dt>
              <dd className="m-0 text-ink">
                {detail.effective
                  ? 'Version ' + detail.effective.versionNo
                  : 'No effective version'}
              </dd>
            </div>
          </dl>
          <section
            className="grid gap-3"
            aria-labelledby="qualification-standard-version-history-title"
          >
            <h3
              className="m-0 text-sm font-[670] text-midnight"
              id="qualification-standard-version-history-title"
            >
              Version history
            </h3>
            <div className="grid gap-3">
              {detail.versions.map((version) => (
                <article
                  className="grid gap-2 rounded-[3px] border border-line bg-canvas px-4 py-3 text-sm"
                  key={version.id}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-ink">Version {version.versionNo}</strong>
                    <div className="flex flex-wrap gap-2">
                      <span
                        className={
                          'rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ' +
                          statusClass(version.versionState)
                        }
                      >
                        {version.versionState}
                      </span>
                      <span
                        className={
                          'rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ' +
                          statusClass(version.lifecycleStatus)
                        }
                      >
                        {version.lifecycleStatus}
                      </span>
                    </div>
                  </div>
                  <span className="text-xs text-muted">
                    {dateLabel(version.effectiveFrom)}
                    {version.effectiveTo ? ' – ' + dateLabel(version.effectiveTo) : ' – open-ended'}
                  </span>
                  <dl className="grid gap-2 text-xs text-muted min-[621px]:grid-cols-2">
                    <div>
                      <dt>Education</dt>
                      <dd className="m-0 text-ink">
                        {version.educationRequirement || 'Not specified'}
                      </dd>
                    </div>
                    <div>
                      <dt>Eligibility</dt>
                      <dd className="m-0 text-ink">
                        {version.eligibilityRequirement || 'Not specified'}
                      </dd>
                    </div>
                    <div>
                      <dt>Training hours</dt>
                      <dd className="m-0 text-ink">
                        {version.trainingHoursRequired ?? 'Not specified'}
                      </dd>
                    </div>
                    <div>
                      <dt>Experience months</dt>
                      <dd className="m-0 text-ink">
                        {version.experienceMonthsRequired ?? 'Not specified'}
                      </dd>
                    </div>
                    <div>
                      <dt>Competencies</dt>
                      <dd className="m-0 break-words font-mono text-[11px] text-ink">
                        {JSON.stringify(version.competencyRequirements)}
                      </dd>
                    </div>
                    <div>
                      <dt>Licenses</dt>
                      <dd className="m-0 break-words font-mono text-[11px] text-ink">
                        {JSON.stringify(version.licenseRequirements)}
                      </dd>
                    </div>
                    <div className="min-[621px]:col-span-2">
                      <dt>Special requirements</dt>
                      <dd className="m-0 text-ink">
                        {version.specialRequirements || 'Not specified'}
                      </dd>
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
          </section>
          <section
            className="grid gap-3"
            aria-labelledby="qualification-standard-audit-history-title"
          >
            <h3
              className="m-0 text-sm font-[670] text-midnight"
              id="qualification-standard-audit-history-title"
            >
              Transition history
            </h3>
            {detail.history.length ? (
              <ol className="m-0 grid gap-2 pl-5 text-xs text-muted">
                {detail.history.map((entry) => (
                  <li key={entry.id}>
                    {entry.action} · {entry.reason ?? 'No reason recorded'} ·{' '}
                    {dateLabel(entry.occurredAt)}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="m-0 text-xs text-muted">No transitions recorded.</p>
            )}
          </section>
        </div>
      ) : null}
      <DialogFooter className="-mx-6 mt-6 border-t-0 px-0 pb-0 min-[621px]:-mx-8 min-[621px]:px-0">
        <DialogClose asChild>
          <Button size="default" type="button" variant="secondary">
            Close
          </Button>
        </DialogClose>
      </DialogFooter>
    </DialogBody>
  );
}
