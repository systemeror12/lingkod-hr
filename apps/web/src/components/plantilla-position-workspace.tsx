'use client';

import { useRef, useState, type FormEvent, type ReactNode } from 'react';
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

type VersionState = 'ACTIVE' | 'DRAFT' | 'SUPERSEDED' | 'VOIDED';
type LifecycleStatus =
  'PROPOSED' | 'AUTHORIZED' | 'VACANT' | 'RESERVED' | 'OCCUPIED' | 'FROZEN' | 'ABOLISHED';
type EmploymentCategory = 'PLANTILLA' | 'CASUAL' | 'CONTRACTUAL' | 'OTHER';
type EvidencePurpose =
  | 'POSITION_DESCRIPTION'
  | 'CREATION'
  | 'RECLASSIFICATION'
  | 'TRANSFER'
  | 'FREEZE'
  | 'ABOLITION'
  | 'OTHER';
type TransitionTarget =
  'authorize' | 'declareVacant' | 'freeze' | 'unfreeze' | 'cancel' | 'abolish';

export interface PlantillaPositionVersion {
  id: string;
  positionId: string;
  versionNo: number;
  title: string;
  parentheticalTitle: string | null;
  salaryGrade: number;
  organizationUnit: { id: string; code: string; name: string };
  fundingSource: string;
  employmentCategory: EmploymentCategory;
  qualificationStandard: {
    id: string;
    versionNo: number;
    code: string;
    name: string;
    effectiveFrom: string;
    effectiveTo: string | null;
  };
  staffingAuthority: {
    id: string;
    referenceNo: string;
    authorityType: string;
    effectiveDate: string;
  };
  effectiveFrom: string;
  effectiveTo: string | null;
  versionState: VersionState;
  lifecycleStatus: LifecycleStatus;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlantillaPosition {
  id: string;
  itemNumber: string;
  status: LifecycleStatus;
  currentVersion: PlantillaPositionVersion | null;
  draft: PlantillaPositionVersion | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlantillaPositionListResponse {
  positions: PlantillaPosition[];
}

interface PlantillaPositionDetail {
  position: PlantillaPosition;
  asOf: string;
  effective: PlantillaPositionVersion | null;
  versions: PlantillaPositionVersion[];
  evidence: PlantillaPositionEvidence[];
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

interface PlantillaPositionEvidence {
  id: string;
  positionId: string;
  documentId: string;
  documentNo: string | null;
  documentType: string;
  classification: 'PUBLIC' | 'INTERNAL' | 'CONFIDENTIAL' | 'HIGHLY_SENSITIVE';
  status: string;
  purpose: EvidencePurpose;
  versionNo: number;
  mimeType: string;
  sizeBytes: number;
  effectiveFrom: string | null;
  createdAt: string;
}

interface EvidenceDocumentOption {
  id: string;
  documentNo: string | null;
  documentType: string;
  classification: 'PUBLIC' | 'INTERNAL' | 'CONFIDENTIAL' | 'HIGHLY_SENSITIVE';
  status: string;
  currentVersion: { versionNo: number; mimeType: string; sizeBytes: number } | null;
}

interface OrganizationUnitOption {
  id: string;
  code: string;
  officialName: string;
  versionState: string;
  lifecycleStatus: string;
}

interface QualificationStandardOption {
  id: string;
  code: string;
  name: string;
  currentVersion: {
    id: string;
    versionNo: number;
    effectiveFrom: string;
    effectiveTo: string | null;
    lifecycleStatus: string;
  } | null;
}

interface StaffingAuthorityOption {
  id: string;
  referenceNo: string;
  authorityType: string;
  effectiveDate: string;
  status: string;
}

interface CatalogOptions {
  units: OrganizationUnitOption[];
  standards: QualificationStandardOption[];
  authorities: StaffingAuthorityOption[];
}

const inputClass =
  'min-h-11 w-full rounded-[3px] border border-line bg-paper px-3 text-sm text-ink outline-none focus:border-cobalt focus:ring-2 focus:ring-cobalt/15';
const labelClass = 'grid gap-1.5 text-xs font-[650] text-ink';

const evidencePurposeLabels: Record<EvidencePurpose, string> = {
  POSITION_DESCRIPTION: 'Position description',
  CREATION: 'Creation',
  RECLASSIFICATION: 'Reclassification',
  TRANSFER: 'Transfer',
  FREEZE: 'Freeze',
  ABOLITION: 'Abolition',
  OTHER: 'Other position evidence',
};

const transitionConfig: Record<
  TransitionTarget,
  {
    path: string;
    title: string;
    description: string;
    submitLabel: string;
    pastTense: string;
  }
> = {
  authorize: {
    path: 'authorize',
    title: 'Authorize Plantilla Position',
    description:
      'Authorize this complete proposed position with its active Staffing Authority and creation evidence.',
    submitLabel: 'Authorize position',
    pastTense: 'authorized',
  },
  declareVacant: {
    path: 'declare-vacant',
    title: 'Declare position vacant',
    description:
      'Record the position as VACANT. This does not create an incumbent or a Recruitable Vacancy.',
    submitLabel: 'Declare vacant',
    pastTense: 'declared vacant',
  },
  freeze: {
    path: 'freeze',
    title: 'Freeze Plantilla Position',
    description:
      'Freeze this authorized or vacant position with its authority and freeze evidence.',
    submitLabel: 'Freeze position',
    pastTense: 'frozen',
  },
  unfreeze: {
    path: 'unfreeze',
    title: 'Restore position to vacant',
    description: 'Restore this frozen position to VACANT without creating an incumbent.',
    submitLabel: 'Restore vacancy',
    pastTense: 'restored to vacant',
  },
  cancel: {
    path: 'cancel',
    title: 'Cancel proposed position',
    description: 'Cancel this proposal as ABOLISHED while preserving its Item Number and history.',
    submitLabel: 'Cancel proposal',
    pastTense: 'cancelled',
  },
  abolish: {
    path: 'abolish',
    title: 'Abolish Plantilla Position',
    description:
      'Abolish this authorized or vacant position prospectively with its authority and abolition evidence.',
    submitLabel: 'Abolish position',
    pastTense: 'abolished',
  },
};

function targetValue(event: { currentTarget: EventTarget }): string {
  return (event.currentTarget as unknown as { value: string }).value;
}

function errorMessage(value: unknown, fallback: string): string {
  if (typeof value !== 'object' || value === null) return fallback;
  const error = (value as { error?: { message?: unknown } }).error;
  return typeof error?.message === 'string' ? error.message : fallback;
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

function nextDate(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function transitionActionLabel(action: string): string {
  return action.replace(/^PLANTILLA_POSITION_/, '').replaceAll('_', ' ');
}

function statusTone(status: VersionState | LifecycleStatus): 'blue' | 'gray' | 'amber' {
  if (status === 'ACTIVE' || status === 'PROPOSED') return 'blue';
  if (status === 'DRAFT') return 'amber';
  return 'gray';
}

function StateBadge({ children, tone }: { children: ReactNode; tone: 'blue' | 'gray' | 'amber' }) {
  const tones = {
    blue: 'border-[#b9cce5] bg-[#edf2f9] text-[#315d98]',
    gray: 'border-line bg-canvas text-muted',
    amber: 'border-[#decba7] bg-[#fff8e9] text-[#755421]',
  };
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold tracking-[0.06em] uppercase ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

function FormError({ message }: { message: string }) {
  return message ? (
    <p
      className="m-0 rounded-[3px] border border-[#e8b6b6] bg-[#fff4f4] px-3 py-3 text-[13px] leading-[1.5] text-[#9a3030]"
      role="alert"
    >
      {message}
    </p>
  ) : null;
}

function VersionHistory({ versions }: { versions: PlantillaPositionVersion[] }) {
  return (
    <ol className="m-0 grid list-none gap-0 p-0">
      {versions.map((version, index) => (
        <li className="relative grid grid-cols-[20px_1fr] gap-3 pb-5 last:pb-0" key={version.id}>
          <span
            className="z-1 mt-1.5 size-2.5 rounded-full border-2 border-paper bg-cobalt ring-1 ring-cobalt"
            aria-hidden="true"
          />
          {index < versions.length - 1 ? (
            <span className="absolute top-4 bottom-0 left-[4px] w-px bg-line" aria-hidden="true" />
          ) : null}
          <div className="grid gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <strong className="text-xs text-midnight">Version {version.versionNo}</strong>
              <StateBadge tone={statusTone(version.versionState)}>
                {version.versionState}
              </StateBadge>
            </div>
            <span className="text-xs text-muted">
              {dateLabel(version.effectiveFrom)}{' '}
              {version.effectiveTo ? `— ${dateLabel(version.effectiveTo)}` : 'onward'}
            </span>
            <span className="text-xs leading-[1.55] text-ink">
              {version.versionState === 'VOIDED'
                ? 'Incorrect activated definition retained for audit.'
                : version.versionState === 'DRAFT'
                  ? 'Draft successor ready for review.'
                  : version.versionNo === 1
                    ? 'Initial proposed definition.'
                    : 'Activated effective definition.'}
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Field({
  label,
  children,
  htmlFor,
}: {
  label: ReactNode;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <label className={labelClass} htmlFor={htmlFor}>
      {label}
      {children}
    </label>
  );
}

function CreatePositionDialog({
  open,
  onOpenChange,
  options,
  optionsLoading,
  busy,
  error,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: CatalogOptions | null;
  optionsLoading: boolean;
  busy: boolean;
  error: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent aria-describedby="create-position-description" className="max-w-[980px]">
        <form className="contents" onSubmit={onSubmit}>
          <DialogHeader>
            <div className="grid gap-1.5">
              <DialogTitle>Create proposed position</DialogTitle>
              <DialogDescription id="create-position-description">
                Reserve the permanent Item Number and record its first effective definition against
                active Agency references.
              </DialogDescription>
            </div>
            <DialogClose asChild>
              <Button aria-label="Close create position dialog" disabled={busy} type="button">
                <span aria-hidden="true" className="text-xl leading-none">
                  ×
                </span>
              </Button>
            </DialogClose>
          </DialogHeader>
          <DialogBody className="grid gap-6">
            {error ? <FormError message={error} /> : null}
            {optionsLoading ? (
              <p className="m-0 rounded-[3px] bg-canvas px-4 py-3 text-sm text-muted" role="status">
                Loading active Organization Units, Qualification Standards, and Staffing
                Authorities…
              </p>
            ) : null}
            <section className="grid gap-4" aria-labelledby="position-identity-fields">
              <h3
                className="m-0 text-xs font-bold tracking-[0.07em] text-cobalt uppercase"
                id="position-identity-fields"
              >
                Stable identity
              </h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field htmlFor="plantilla-item-number" label="Permanent Item Number">
                  <input
                    autoFocus
                    className={inputClass}
                    id="plantilla-item-number"
                    maxLength={80}
                    name="itemNumber"
                    placeholder="e.g. HRM-000143"
                    required
                  />
                </Field>
                <Field htmlFor="plantilla-effective-date" label="Initial effectivity">
                  <input
                    className={inputClass}
                    defaultValue={manilaToday()}
                    id="plantilla-effective-date"
                    name="effectiveDate"
                    required
                    type="date"
                  />
                </Field>
              </div>
            </section>
            <section className="grid gap-4" aria-labelledby="position-definition-fields">
              <h3
                className="m-0 text-xs font-bold tracking-[0.07em] text-cobalt uppercase"
                id="position-definition-fields"
              >
                Initial definition
              </h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field htmlFor="plantilla-position-title" label="Position title">
                  <input
                    className={inputClass}
                    id="plantilla-position-title"
                    maxLength={200}
                    name="title"
                    required
                  />
                </Field>
                <Field
                  htmlFor="plantilla-parenthetical-title"
                  label={
                    <>
                      <span>
                        Parenthetical title <span className="font-normal text-muted">Optional</span>
                      </span>
                    </>
                  }
                >
                  <input
                    className={inputClass}
                    id="plantilla-parenthetical-title"
                    maxLength={200}
                    name="parentheticalTitle"
                  />
                </Field>
                <Field htmlFor="plantilla-salary-grade" label="Salary grade">
                  <input
                    className={inputClass}
                    id="plantilla-salary-grade"
                    max="33"
                    min="1"
                    name="salaryGrade"
                    required
                    type="number"
                  />
                </Field>
                <Field htmlFor="plantilla-organization-unit" label="Organization unit">
                  <select
                    className={inputClass}
                    disabled={!options}
                    id="plantilla-organization-unit"
                    name="organizationUnitId"
                    required
                  >
                    <option value="">Select active unit</option>
                    {options?.units
                      .filter(
                        (unit) =>
                          unit.versionState === 'ACTIVE' && unit.lifecycleStatus === 'ACTIVE',
                      )
                      .map((unit) => (
                        <option key={unit.id} value={unit.id}>
                          {unit.officialName} · {unit.code}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field htmlFor="plantilla-funding-source" label="Funding source">
                  <input
                    className={inputClass}
                    id="plantilla-funding-source"
                    maxLength={200}
                    name="fundingSource"
                    placeholder="General Appropriations Act"
                    required
                  />
                </Field>
                <Field htmlFor="plantilla-employment-category" label="Employment category">
                  <select
                    className={inputClass}
                    id="plantilla-employment-category"
                    name="employmentCategory"
                    required
                  >
                    <option value="PLANTILLA">Plantilla</option>
                    <option value="CASUAL">Casual</option>
                    <option value="CONTRACTUAL">Contractual</option>
                    <option value="OTHER">Other</option>
                  </select>
                </Field>
              </div>
            </section>
            <section className="grid gap-4" aria-labelledby="position-reference-fields">
              <h3
                className="m-0 text-xs font-bold tracking-[0.07em] text-cobalt uppercase"
                id="position-reference-fields"
              >
                Effective references
              </h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  htmlFor="plantilla-qualification-standard"
                  label="Exact Qualification Standard version"
                >
                  <select
                    className={inputClass}
                    disabled={!options}
                    id="plantilla-qualification-standard"
                    name="qualificationStandardVersionId"
                    required
                  >
                    <option value="">Select active QS version</option>
                    {options?.standards
                      .filter((standard) => standard.currentVersion?.lifecycleStatus === 'ACTIVE')
                      .map((standard) => (
                        <option
                          key={standard.currentVersion?.id}
                          value={standard.currentVersion?.id}
                        >
                          {standard.code} · v{standard.currentVersion?.versionNo} · {standard.name}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field htmlFor="plantilla-staffing-authority" label="Applicable Staffing Authority">
                  <select
                    className={inputClass}
                    disabled={!options}
                    id="plantilla-staffing-authority"
                    name="staffingAuthorityId"
                    required
                  >
                    <option value="">Select active authority</option>
                    {options?.authorities
                      .filter(
                        (authority) =>
                          authority.status === 'ACTIVE' || authority.status === 'SUPERSEDED',
                      )
                      .map((authority) => (
                        <option key={authority.id} value={authority.id}>
                          {authority.referenceNo} · {authority.authorityType}
                        </option>
                      ))}
                  </select>
                </Field>
              </div>
            </section>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button disabled={busy} size="default" type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button
              disabled={busy || optionsLoading || !options}
              size="default"
              type="submit"
              variant="primary"
            >
              {busy ? 'Creating…' : 'Create proposed position'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LinkEvidenceDialog({
  open,
  onOpenChange,
  documents,
  documentsLoading,
  busy,
  error,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documents: EvidenceDocumentOption[] | null;
  documentsLoading: boolean;
  busy: boolean;
  error: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent aria-describedby="link-evidence-description" size="compact">
        <form className="contents" onSubmit={onSubmit}>
          <DialogHeader>
            <div className="grid gap-1.5">
              <DialogTitle>Link External Evidence</DialogTitle>
              <DialogDescription id="link-evidence-description">
                Attach an accessible Agency Document to this position with the reason it supports
                the record.
              </DialogDescription>
            </div>
            <DialogClose asChild>
              <Button aria-label="Close link evidence dialog" disabled={busy} type="button">
                <span aria-hidden="true" className="text-xl leading-none">
                  ×
                </span>
              </Button>
            </DialogClose>
          </DialogHeader>
          <DialogBody className="grid gap-5">
            {error ? <FormError message={error} /> : null}
            {documentsLoading ? (
              <p className="m-0 rounded-[3px] bg-canvas px-4 py-3 text-sm text-muted" role="status">
                Loading linkable Agency Documents…
              </p>
            ) : null}
            <Field htmlFor="plantilla-evidence-document" label="External Evidence Document">
              <select
                autoFocus
                className={inputClass}
                id="plantilla-evidence-document"
                name="documentId"
                required
              >
                <option value="">Select an approved Document</option>
                {documents?.map((document) => (
                  <option key={document.id} value={document.id}>
                    {document.documentNo ?? document.documentType} · {document.documentType} · v
                    {document.currentVersion?.versionNo ?? '—'}
                  </option>
                ))}
              </select>
            </Field>
            <Field htmlFor="plantilla-evidence-purpose" label="Evidence purpose">
              <select
                className={inputClass}
                id="plantilla-evidence-purpose"
                name="purpose"
                required
              >
                {Object.entries(evidencePurposeLabels).map(([purpose, label]) => (
                  <option key={purpose} value={purpose}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              htmlFor="plantilla-evidence-effective-date"
              label={
                <>
                  Effectivity <span className="font-normal text-muted">Optional</span>
                </>
              }
            >
              <input
                className={inputClass}
                id="plantilla-evidence-effective-date"
                name="effectiveDate"
                type="date"
              />
            </Field>
            <p className="m-0 border-l-2 border-cobalt bg-[#f3f7fc] px-3 py-2.5 text-xs leading-[1.55] text-muted">
              Purpose describes why the Document supports this position. Its MIME type remains
              separate file metadata.
            </p>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button disabled={busy} size="default" type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button
              disabled={busy || documentsLoading || !documents?.length}
              size="default"
              type="submit"
              variant="primary"
            >
              {busy ? 'Linking…' : 'Link evidence'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RemoveEvidenceDialog({
  evidence,
  open,
  onOpenChange,
  busy,
  error,
  onSubmit,
}: {
  evidence: PlantillaPositionEvidence | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  error: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const documentLabel = evidence?.documentNo ?? evidence?.documentType ?? 'this Document';
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent aria-describedby="remove-evidence-description" size="compact">
        <form className="contents" onSubmit={onSubmit}>
          <DialogHeader>
            <div className="grid gap-1.5">
              <DialogTitle>Remove evidence link</DialogTitle>
              <DialogDescription id="remove-evidence-description">
                Remove {documentLabel} from this position only. The Document, its versions, and
                audit history stay preserved.
              </DialogDescription>
            </div>
            <DialogClose asChild>
              <Button aria-label="Close remove evidence dialog" disabled={busy} type="button">
                <span aria-hidden="true" className="text-xl leading-none">
                  ×
                </span>
              </Button>
            </DialogClose>
          </DialogHeader>
          <DialogBody className="grid gap-5">
            {error ? <FormError message={error} /> : null}
            <div className="grid gap-1 rounded-[4px] border border-line bg-[#f8fafc] px-4 py-3">
              <span className="text-[10px] font-bold tracking-[0.06em] text-muted uppercase">
                Attached as
              </span>
              <strong className="text-sm text-midnight">
                {evidence ? evidencePurposeLabels[evidence.purpose] : 'Position evidence'}
              </strong>
            </div>
            <Field htmlFor="plantilla-evidence-removal-reason" label="Reason for removal">
              <textarea
                autoFocus
                className={`${inputClass} min-h-28 resize-y py-3`}
                id="plantilla-evidence-removal-reason"
                maxLength={500}
                name="reason"
                placeholder="Explain why this link was attached in error."
                required
              />
            </Field>
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
  );
}

function TransitionDialog({
  target,
  open,
  defaultDate,
  busy,
  error,
  onOpenChange,
  onSubmit,
}: {
  target: TransitionTarget | null;
  open: boolean;
  defaultDate: string;
  busy: boolean;
  error: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  if (!target) return null;
  const config = transitionConfig[target];
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent
        aria-describedby="plantilla-transition-description"
        onCloseAutoFocus={(event) => event.preventDefault()}
        size="compact"
      >
        <form className="contents" onSubmit={onSubmit}>
          <DialogHeader>
            <div className="grid gap-1.5">
              <DialogTitle>{config.title}</DialogTitle>
              <DialogDescription id="plantilla-transition-description">
                {config.description}
              </DialogDescription>
            </div>
            <DialogClose asChild>
              <Button aria-label={`Close ${config.title} dialog`} disabled={busy} type="button">
                <span aria-hidden="true" className="text-xl leading-none">
                  ×
                </span>
              </Button>
            </DialogClose>
          </DialogHeader>
          <DialogBody className="grid gap-5">
            {error ? <FormError message={error} /> : null}
            <Field htmlFor="plantilla-transition-effective-date" label="Effective date">
              <input
                autoFocus
                className={inputClass}
                defaultValue={defaultDate}
                id="plantilla-transition-effective-date"
                min={defaultDate}
                name="effectiveDate"
                required
                type="date"
              />
            </Field>
            <Field htmlFor="plantilla-transition-reason" label="Reason">
              <textarea
                className={`${inputClass} min-h-28 resize-y py-3`}
                id="plantilla-transition-reason"
                maxLength={500}
                name="reason"
                placeholder="Explain the controlled lifecycle decision."
                required
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
              {busy ? `${config.submitLabel}…` : config.submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PlantillaPositionWorkspace({
  agencyId,
  initial,
  canCreate,
  canUpdate,
  canReadEvidence,
  canAuthorize,
  canDeclareVacant,
  canFreeze,
  canUnfreeze,
  canCancel,
  canAbolish,
}: {
  agencyId: string;
  initial: PlantillaPositionListResponse;
  canCreate: boolean;
  canUpdate: boolean;
  canReadEvidence: boolean;
  canAuthorize: boolean;
  canDeclareVacant: boolean;
  canFreeze: boolean;
  canUnfreeze: boolean;
  canCancel: boolean;
  canAbolish: boolean;
}) {
  const [positions, setPositions] = useState(initial.positions);
  const [selectedId, setSelectedId] = useState(initial.positions[0]?.id ?? '');
  const [asOf, setAsOf] = useState(manilaToday());
  const [query, setQuery] = useState('');
  const [detail, setDetail] = useState<PlantillaPositionDetail | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [options, setOptions] = useState<CatalogOptions | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [evidenceDocuments, setEvidenceDocuments] = useState<EvidenceDocumentOption[] | null>(null);
  const [evidenceDocumentsLoading, setEvidenceDocumentsLoading] = useState(false);
  const [linkEvidenceOpen, setLinkEvidenceOpen] = useState(false);
  const [removeEvidenceTarget, setRemoveEvidenceTarget] =
    useState<PlantillaPositionEvidence | null>(null);
  const [busy, setBusy] = useState(false);
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [transitionTarget, setTransitionTarget] = useState<TransitionTarget | null>(null);
  const [transitionBusy, setTransitionBusy] = useState(false);
  const [transitionError, setTransitionError] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const returnFocusRef = useRef<{ focus(): void } | null>(null);
  const evidenceReturnFocusRef = useRef<{ focus(): void } | null>(null);
  const removeEvidenceReturnFocusRef = useRef<{ focus(): void } | null>(null);
  const transitionReturnFocusRef = useRef<{ focus(): void } | null>(null);
  const transitionActionsRef = useRef<HTMLDivElement | null>(null);

  const selected = positions.find((position) => position.id === selectedId) ?? positions[0] ?? null;
  const matches = positions.filter((position) => {
    const version = position.currentVersion;
    return `${position.itemNumber} ${version?.title ?? ''} ${version?.organizationUnit.name ?? ''} ${version?.salaryGrade ?? ''}`
      .toLowerCase()
      .includes(query.trim().toLowerCase());
  });
  const selectedDetail =
    detail && detail.position.id === selected?.id && detail.asOf === asOf ? detail : null;
  const effective = selectedDetail?.effective ?? selected?.currentVersion ?? null;
  const versions =
    selectedDetail?.versions ?? (selected?.currentVersion ? [selected.currentVersion] : []);
  const evidence = selectedDetail?.evidence ?? [];
  const transitionDefaultDate = nextDate(effective?.effectiveFrom ?? asOf);

  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await fetch(`/api/v1/agencies/${agencyId}/plantilla-positions${path}`, {
      ...init,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...init.headers },
    });
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new Error(errorMessage(value, 'The Plantilla Position action failed.'));
    return value;
  }

  async function refresh(nextAsOf = asOf): Promise<PlantillaPosition[]> {
    const value = await request(`?asOf=${encodeURIComponent(nextAsOf)}`);
    if (
      typeof value !== 'object' ||
      value === null ||
      !Array.isArray((value as { positions?: unknown }).positions)
    ) {
      throw new Error('The Plantilla Position list response was invalid.');
    }
    const next = (value as PlantillaPositionListResponse).positions;
    setPositions(next);
    return next;
  }

  async function loadDetail(positionId: string, nextAsOf = asOf): Promise<void> {
    try {
      setDetail(
        (await request(
          `/${positionId}?asOf=${encodeURIComponent(nextAsOf)}`,
        )) as PlantillaPositionDetail,
      );
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'The position detail could not be loaded.',
      );
    }
  }

  async function openCreate(target: { focus(): void }): Promise<void> {
    returnFocusRef.current = target;
    setError('');
    setSuccess('');
    setDialogOpen(true);
    if (options || optionsLoading) return;
    setOptionsLoading(true);
    try {
      const [unitsValue, standardsValue, authoritiesValue] = await Promise.all([
        fetch(`/api/v1/agencies/${agencyId}/organization-units`, { credentials: 'include' }).then(
          async (response) => {
            const value: unknown = await response.json().catch(() => null);
            if (!response.ok)
              throw new Error(errorMessage(value, 'Organization Units could not be loaded.'));
            return value as { units: OrganizationUnitOption[] };
          },
        ),
        fetch(`/api/v1/agencies/${agencyId}/qualification-standards`, {
          credentials: 'include',
        }).then(async (response) => {
          const value: unknown = await response.json().catch(() => null);
          if (!response.ok)
            throw new Error(errorMessage(value, 'Qualification Standards could not be loaded.'));
          return value as { standards: QualificationStandardOption[] };
        }),
        fetch(`/api/v1/agencies/${agencyId}/staffing-authorities`, { credentials: 'include' }).then(
          async (response) => {
            const value: unknown = await response.json().catch(() => null);
            if (!response.ok)
              throw new Error(errorMessage(value, 'Staffing Authorities could not be loaded.'));
            return value as { authorities: StaffingAuthorityOption[] };
          },
        ),
      ]);
      setOptions({
        units: unitsValue.units,
        standards: standardsValue.standards,
        authorities: authoritiesValue.authorities,
      });
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'The catalog references could not be loaded.',
      );
    } finally {
      setOptionsLoading(false);
    }
  }

  function closeCreate(next: boolean): void {
    if (busy) return;
    setDialogOpen(next);
    if (!next) {
      const target = returnFocusRef.current;
      setTimeout(() => target?.focus(), 0);
    }
  }

  async function loadEvidenceDocuments(): Promise<void> {
    if (evidenceDocuments || evidenceDocumentsLoading) return;
    setEvidenceDocumentsLoading(true);
    try {
      const response = await fetch(`/api/v1/agencies/${agencyId}/documents`, {
        credentials: 'include',
      });
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(errorMessage(value, 'Agency Documents could not be loaded.'));
      if (
        typeof value !== 'object' ||
        value === null ||
        !Array.isArray((value as { documents?: unknown }).documents)
      ) {
        throw new Error('The Agency Document response was invalid.');
      }
      setEvidenceDocuments((value as { documents: EvidenceDocumentOption[] }).documents);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'The Agency Documents could not be loaded.',
      );
    } finally {
      setEvidenceDocumentsLoading(false);
    }
  }

  function openLinkEvidence(target: { focus(): void }): void {
    evidenceReturnFocusRef.current = target;
    setError('');
    setSuccess('');
    setLinkEvidenceOpen(true);
    void loadEvidenceDocuments();
  }

  function closeLinkEvidence(next: boolean): void {
    if (evidenceBusy) return;
    setLinkEvidenceOpen(next);
    if (!next) {
      const target = evidenceReturnFocusRef.current;
      setTimeout(() => target?.focus(), 0);
    }
  }

  function openRemoveEvidence(evidenceItem: PlantillaPositionEvidence, target: { focus(): void }) {
    removeEvidenceReturnFocusRef.current = target;
    setError('');
    setSuccess('');
    setRemoveEvidenceTarget(evidenceItem);
  }

  function closeRemoveEvidence(next: boolean): void {
    if (evidenceBusy) return;
    setRemoveEvidenceTarget(next ? removeEvidenceTarget : null);
    if (!next) {
      const target = removeEvidenceReturnFocusRef.current;
      setTimeout(() => target?.focus(), 0);
    }
  }

  function openTransition(target: TransitionTarget, trigger: { focus(): void }): void {
    transitionReturnFocusRef.current = trigger;
    setError('');
    setSuccess('');
    setTransitionError('');
    setTransitionTarget(target);
  }

  function closeTransition(next: boolean): void {
    if (transitionBusy) return;
    if (next) return;
    setTransitionTarget(null);
    setTransitionError('');
    const target = transitionReturnFocusRef.current;
    setTimeout(() => target?.focus(), 0);
  }

  async function changeAsOf(value: string): Promise<void> {
    setAsOf(value);
    setError('');
    try {
      await refresh(value);
      if (selected) await loadDetail(selected.id, value);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'The effective catalog could not be loaded.',
      );
    }
  }

  async function selectPosition(positionId: string): Promise<void> {
    setSelectedId(positionId);
    setError('');
    await loadDetail(positionId);
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    const BrowserFormData = FormData as unknown as new (form: EventTarget) => FormData;
    const form = new BrowserFormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      const value = (await request('', {
        method: 'POST',
        body: JSON.stringify({
          itemNumber: String(form.get('itemNumber') ?? ''),
          title: String(form.get('title') ?? ''),
          parentheticalTitle: String(form.get('parentheticalTitle') ?? ''),
          salaryGrade: Number(form.get('salaryGrade')),
          organizationUnitId: String(form.get('organizationUnitId') ?? ''),
          fundingSource: String(form.get('fundingSource') ?? ''),
          employmentCategory: String(form.get('employmentCategory') ?? ''),
          qualificationStandardVersionId: String(form.get('qualificationStandardVersionId') ?? ''),
          staffingAuthorityId: String(form.get('staffingAuthorityId') ?? ''),
          effectiveDate: String(form.get('effectiveDate') ?? ''),
        }),
      })) as PlantillaPosition;
      await refresh();
      setSelectedId(value.id);
      await loadDetail(value.id);
      setSuccess(`Proposed position “${value.itemNumber}” was created.`);
      setDialogOpen(false);
      const target = returnFocusRef.current;
      setTimeout(() => target?.focus(), 0);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'The proposed position could not be created.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function prepareSuccessor(): Promise<void> {
    if (!selected || selected.draft || busy || !canUpdate) return;
    setBusy(true);
    setError('');
    try {
      await request(`/${selected.id}/successor`, { method: 'POST' });
      await refresh();
      await loadDetail(selected.id);
      setSuccess(`Draft successor prepared for “${selected.itemNumber}”.`);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'The successor could not be prepared.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitTransition(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selected || !transitionTarget || transitionBusy) return;
    const BrowserFormData = FormData as unknown as new (form: EventTarget) => FormData;
    const form = new BrowserFormData(event.currentTarget);
    const position = selected;
    const target = transitionTarget;
    const config = transitionConfig[target];
    const effectiveDate = String(form.get('effectiveDate') ?? '');
    const reason = String(form.get('reason') ?? '');
    setTransitionBusy(true);
    setError('');
    setTransitionError('');
    try {
      await request(`/${position.id}/${config.path}`, {
        method: 'POST',
        body: JSON.stringify({ effectiveDate, reason }),
      });
      await refresh(effectiveDate);
      setAsOf(effectiveDate);
      await loadDetail(position.id, effectiveDate);
      setSuccess(
        `“${position.itemNumber}” was ${config.pastTense} effective ${dateLabel(effectiveDate)}.`,
      );
      setTransitionTarget(null);
      setTimeout(() => {
        const target = transitionActionsRef.current as unknown as { focus(): void } | null;
        target?.focus();
      }, 0);
    } catch (requestError: unknown) {
      setTransitionError(
        requestError instanceof Error
          ? requestError.message
          : 'The lifecycle transition could not be completed.',
      );
    } finally {
      setTransitionBusy(false);
    }
  }

  async function submitLinkEvidence(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selected || evidenceBusy || !canUpdate || !canReadEvidence) return;
    const BrowserFormData = FormData as unknown as new (form: EventTarget) => FormData;
    const form = new BrowserFormData(event.currentTarget);
    const position = selected;
    setEvidenceBusy(true);
    setError('');
    try {
      const documentId = String(form.get('documentId') ?? '');
      const document = evidenceDocuments?.find((item) => item.id === documentId);
      await request(`/${position.id}/evidence`, {
        method: 'POST',
        body: JSON.stringify({
          documentId,
          purpose: String(form.get('purpose') ?? '') as EvidencePurpose,
          effectiveDate: String(form.get('effectiveDate') ?? '') || null,
        }),
      });
      await loadDetail(position.id);
      setSuccess(
        `External Evidence ${document?.documentNo ?? document?.documentType ?? 'Document'} was linked to “${position.itemNumber}”.`,
      );
      setLinkEvidenceOpen(false);
      const target = evidenceReturnFocusRef.current;
      setTimeout(() => target?.focus(), 0);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'The External Evidence could not be linked.',
      );
    } finally {
      setEvidenceBusy(false);
    }
  }

  async function submitRemoveEvidence(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selected || !removeEvidenceTarget || evidenceBusy || !canUpdate || !canReadEvidence)
      return;
    const BrowserFormData = FormData as unknown as new (form: EventTarget) => FormData;
    const form = new BrowserFormData(event.currentTarget);
    const position = selected;
    const evidenceItem = removeEvidenceTarget;
    setEvidenceBusy(true);
    setError('');
    try {
      await request(`/${position.id}/evidence/${evidenceItem.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ reason: String(form.get('reason') ?? '') }),
      });
      await loadDetail(position.id);
      setSuccess(
        `The ${evidencePurposeLabels[evidenceItem.purpose].toLowerCase()} link was removed from “${position.itemNumber}”.`,
      );
      setRemoveEvidenceTarget(null);
      const target = evidenceReturnFocusRef.current ?? removeEvidenceReturnFocusRef.current;
      setTimeout(() => target?.focus(), 0);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'The External Evidence link could not be removed.',
      );
    } finally {
      setEvidenceBusy(false);
    }
  }

  async function inspectEvidence(evidenceItem: PlantillaPositionEvidence): Promise<void> {
    if (!selected || !canReadEvidence || evidenceBusy) return;
    setError('');
    try {
      const value = await request(`/${selected.id}/evidence/${evidenceItem.id}/access`);
      if (
        typeof value !== 'object' ||
        value === null ||
        typeof (value as { accessUrl?: unknown }).accessUrl !== 'string'
      ) {
        throw new Error('The External Evidence access response was invalid.');
      }
      const browser = globalThis as unknown as {
        open(url: string, target?: string, features?: string): unknown;
      };
      browser.open((value as { accessUrl: string }).accessUrl, '_blank', 'noopener,noreferrer');
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'The External Evidence could not be opened.',
      );
    }
  }

  return (
    <div className="grid gap-5">
      <header className="flex flex-col gap-4 border-b border-[#aeb9c8] pb-5 min-[761px]:flex-row min-[761px]:items-end min-[761px]:justify-between">
        <div className="grid gap-1.5">
          <p className="m-0 text-[10px] font-bold tracking-[0.1em] text-cobalt uppercase">
            Organization and Plantilla
          </p>
          <h1 className="m-0 text-[clamp(27px,3vw,38px)] leading-none font-[690] tracking-[-0.035em] text-midnight">
            Plantilla positions
          </h1>
          <p className="m-0 text-sm text-muted">
            Find a permanent Item Number and inspect its effective definition.
          </p>
        </div>
        {canCreate ? (
          <Button
            size="default"
            type="button"
            variant="primary"
            onClick={(event) =>
              void openCreate(event.currentTarget as unknown as { focus(): void })
            }
          >
            Create proposed position
          </Button>
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
      {error && !dialogOpen && !linkEvidenceOpen && !removeEvidenceTarget && !transitionTarget ? (
        <FormError message={error} />
      ) : null}

      <section className="overflow-hidden rounded-[5px] border border-[#cbd3df] bg-paper shadow-[0_1px_2px_rgb(23_32_51/4%)]">
        <div className="grid gap-3 border-b border-line bg-[#f8fafc] p-4 min-[761px]:grid-cols-[minmax(0,1fr)_auto] min-[761px]:items-end">
          <label className="grid gap-1.5" htmlFor="plantilla-catalog-search">
            <span className="text-[10px] font-bold tracking-[0.07em] text-muted uppercase">
              Search the catalog
            </span>
            <span className="relative block">
              <svg
                className="pointer-events-none absolute top-1/2 left-3.5 w-[18px] -translate-y-1/2 fill-none stroke-cobalt stroke-2"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="6.5" />
                <path d="m16 16 4 4" />
              </svg>
              <input
                className="min-h-11 w-full rounded-[4px] border border-[#9cabc0] bg-paper pr-4 pl-11 text-sm font-[560] text-midnight placeholder:font-normal placeholder:text-[#7b8698]"
                id="plantilla-catalog-search"
                placeholder="Item Number, title, unit, or salary grade"
                value={query}
                onChange={(event) => setQuery(targetValue(event))}
              />
            </span>
          </label>
          <label className="grid gap-1.5" htmlFor="plantilla-effective-on">
            <span className="text-[10px] font-bold tracking-[0.07em] text-muted uppercase">
              Effective on
            </span>
            <input
              className={`${inputClass} min-h-11 w-full min-[761px]:w-[158px]`}
              id="plantilla-effective-on"
              type="date"
              value={asOf}
              onChange={(event) => void changeAsOf(targetValue(event))}
            />
          </label>
        </div>

        <div className="grid min-[900px]:grid-cols-[330px_minmax(0,1fr)]">
          <section
            className="border-b border-line min-[900px]:border-r min-[900px]:border-b-0"
            aria-label="Plantilla Position search results"
          >
            <header className="flex min-h-11 items-center justify-between border-b border-line px-4">
              <strong className="text-xs text-midnight">
                {query ? 'Matching positions' : 'All positions'}
              </strong>
              <span className="font-mono text-[11px] text-muted">
                {matches.length} {matches.length === 1 ? 'item' : 'items'}
              </span>
            </header>
            <div className="max-h-[610px] overflow-y-auto">
              {matches.length ? (
                matches.map((position) => {
                  const version = position.currentVersion;
                  const isSelected = position.id === selected?.id;
                  return (
                    <button
                      className={`relative grid w-full cursor-pointer gap-1.5 border-0 border-b border-line px-4 py-4 text-left last:border-b-0 ${isSelected ? "bg-[#edf3fb] before:absolute before:top-0 before:bottom-0 before:left-0 before:w-[3px] before:bg-cobalt before:content-['']" : 'bg-paper hover:bg-[#f8fafc]'}`}
                      type="button"
                      key={position.id}
                      aria-pressed={isSelected}
                      onClick={() => void selectPosition(position.id)}
                    >
                      <span className="flex items-center justify-between gap-3">
                        <strong className="font-mono text-[11px] tracking-[0.02em] text-cobalt">
                          {position.itemNumber}
                        </strong>
                        <span className="font-mono text-[11px] font-bold text-ink">
                          SG {version?.salaryGrade ?? '—'}
                        </span>
                      </span>
                      <strong className="text-[13px] leading-[1.4] font-[650] text-midnight">
                        {version?.title ?? 'No effective definition'}
                      </strong>
                      <span className="overflow-hidden text-xs text-ellipsis whitespace-nowrap text-muted">
                        {version?.organizationUnit.name ?? 'Pending effectivity'}
                      </span>
                    </button>
                  );
                })
              ) : (
                <div className="grid min-h-[180px] place-content-center gap-1 px-5 text-center">
                  <strong className="text-sm text-midnight">No position found</strong>
                  <span className="text-xs text-muted">
                    Try an Item Number, title, unit, or grade.
                  </span>
                </div>
              )}
            </div>
          </section>

          {selected && effective ? (
            <article className="min-w-0" aria-labelledby="selected-position-title">
              <header className="border-b border-line bg-midnight px-5 py-5 text-paper min-[621px]:px-7 min-[621px]:py-6">
                <div className="flex flex-col gap-5 min-[621px]:flex-row min-[621px]:items-start min-[621px]:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[10px] font-bold tracking-[0.09em] text-[#9fbbe1] uppercase">
                        Permanent Item Number
                      </span>
                      <StateBadge tone={statusTone(effective.lifecycleStatus)}>
                        {effective.lifecycleStatus}
                      </StateBadge>
                    </div>
                    <p className="mt-2 mb-0 font-mono text-[clamp(22px,3vw,31px)] leading-none font-[730] tracking-[-0.035em] text-paper">
                      {selected.itemNumber}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-x-7 gap-y-1 min-[621px]:text-right">
                    <span className="text-[10px] font-bold tracking-[0.07em] text-[#9fabbc] uppercase">
                      Salary grade
                    </span>
                    <span className="text-[10px] font-bold tracking-[0.07em] text-[#9fabbc] uppercase">
                      Effective from
                    </span>
                    <strong className="font-mono text-lg text-paper">
                      SG {effective.salaryGrade}
                    </strong>
                    <strong className="font-mono text-sm text-paper">
                      {dateLabel(effective.effectiveFrom)}
                    </strong>
                  </div>
                </div>
                <h2
                  className="mt-6 mb-1 text-[clamp(20px,2.5vw,28px)] leading-[1.15] font-[680] tracking-[-0.025em]"
                  id="selected-position-title"
                >
                  {effective.title}
                  {effective.parentheticalTitle ? (
                    <span className="mt-1 block text-sm font-[520] text-[#bdc8d8]">
                      ({effective.parentheticalTitle})
                    </span>
                  ) : null}
                </h2>
                <p className="m-0 text-sm text-[#bdc8d8]">{effective.organizationUnit.name}</p>
                <div
                  ref={transitionActionsRef}
                  aria-label="Position lifecycle actions"
                  className="mt-5 flex flex-wrap gap-2 outline-none"
                  tabIndex={-1}
                >
                  {canAuthorize && effective.lifecycleStatus === 'PROPOSED' ? (
                    <Button
                      disabled={busy || transitionBusy}
                      size="default"
                      type="button"
                      variant="secondary"
                      onClick={(event) =>
                        openTransition(
                          'authorize',
                          event.currentTarget as unknown as { focus(): void },
                        )
                      }
                    >
                      Authorize position
                    </Button>
                  ) : null}
                  {canDeclareVacant && effective.lifecycleStatus === 'AUTHORIZED' ? (
                    <Button
                      disabled={busy || transitionBusy}
                      size="default"
                      type="button"
                      variant="secondary"
                      onClick={(event) =>
                        openTransition(
                          'declareVacant',
                          event.currentTarget as unknown as { focus(): void },
                        )
                      }
                    >
                      Declare vacant
                    </Button>
                  ) : null}
                  {canFreeze &&
                  (effective.lifecycleStatus === 'AUTHORIZED' ||
                    effective.lifecycleStatus === 'VACANT') ? (
                    <Button
                      disabled={busy || transitionBusy}
                      size="default"
                      type="button"
                      variant="secondary"
                      onClick={(event) =>
                        openTransition(
                          'freeze',
                          event.currentTarget as unknown as { focus(): void },
                        )
                      }
                    >
                      Freeze position
                    </Button>
                  ) : null}
                  {canUnfreeze && effective.lifecycleStatus === 'FROZEN' ? (
                    <Button
                      disabled={busy || transitionBusy}
                      size="default"
                      type="button"
                      variant="secondary"
                      onClick={(event) =>
                        openTransition(
                          'unfreeze',
                          event.currentTarget as unknown as { focus(): void },
                        )
                      }
                    >
                      Restore vacancy
                    </Button>
                  ) : null}
                  {canCancel && effective.lifecycleStatus === 'PROPOSED' ? (
                    <Button
                      disabled={busy || transitionBusy}
                      size="default"
                      type="button"
                      variant="secondary"
                      onClick={(event) =>
                        openTransition(
                          'cancel',
                          event.currentTarget as unknown as { focus(): void },
                        )
                      }
                    >
                      Cancel proposal
                    </Button>
                  ) : null}
                  {canAbolish &&
                  (effective.lifecycleStatus === 'AUTHORIZED' ||
                    effective.lifecycleStatus === 'VACANT') ? (
                    <Button
                      disabled={busy || transitionBusy}
                      size="default"
                      type="button"
                      variant="secondary"
                      onClick={(event) =>
                        openTransition(
                          'abolish',
                          event.currentTarget as unknown as { focus(): void },
                        )
                      }
                    >
                      Abolish position
                    </Button>
                  ) : null}
                </div>
              </header>
              <div className="grid min-[1040px]:grid-cols-[minmax(0,1fr)_245px]">
                <div className="grid content-start gap-6 p-5 min-[621px]:p-7">
                  <section aria-labelledby="plantilla-definition-heading">
                    <div className="mb-3 flex items-center justify-between gap-4">
                      <h3
                        className="m-0 text-xs font-bold text-midnight"
                        id="plantilla-definition-heading"
                      >
                        Effective definition
                      </h3>
                      <span className="font-mono text-[10px] text-muted">
                        Version {effective.versionNo}
                      </span>
                    </div>
                    <dl className="m-0 grid border-t border-l border-line sm:grid-cols-2">
                      {[
                        ['Funding source', effective.fundingSource],
                        ['Employment category', effective.employmentCategory],
                        ['Organization unit', effective.organizationUnit.name],
                        ['Lifecycle status', effective.lifecycleStatus],
                      ].map(([label, value]) => (
                        <div
                          className="grid gap-1.5 border-r border-b border-line p-3.5"
                          key={label}
                        >
                          <dt className="text-[10px] font-bold tracking-[0.06em] text-muted uppercase">
                            {label}
                          </dt>
                          <dd className="m-0 text-xs leading-[1.45] font-[620] text-midnight">
                            {value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                  <section aria-labelledby="plantilla-references-heading">
                    <h3
                      className="mt-0 mb-3 text-xs font-bold text-midnight"
                      id="plantilla-references-heading"
                    >
                      Effective references
                    </h3>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="grid gap-1 rounded-[4px] border border-line bg-[#f8fafc] p-4">
                        <span className="text-[10px] font-bold tracking-[0.06em] text-muted uppercase">
                          Qualification standard
                        </span>
                        <strong className="text-sm text-midnight">
                          {effective.qualificationStandard.code} · v
                          {effective.qualificationStandard.versionNo}
                        </strong>
                        <span className="text-xs leading-[1.45] text-muted">
                          {effective.qualificationStandard.name}
                        </span>
                      </div>
                      <div className="grid gap-1 rounded-[4px] border border-line bg-[#f8fafc] p-4">
                        <span className="text-[10px] font-bold tracking-[0.06em] text-muted uppercase">
                          Staffing authority
                        </span>
                        <strong className="text-sm leading-[1.45] text-midnight">
                          {effective.staffingAuthority.referenceNo}
                        </strong>
                        <span className="text-xs text-muted">
                          Applicable on {dateLabel(effective.effectiveFrom)}
                        </span>
                      </div>
                    </div>
                  </section>
                  <section aria-labelledby="plantilla-evidence-heading" className="grid gap-3">
                    <div className="flex flex-col gap-3 min-[1440px]:flex-row min-[1440px]:items-center min-[1440px]:justify-between">
                      <div className="grid gap-1">
                        <h3
                          className="m-0 text-xs font-bold text-midnight"
                          id="plantilla-evidence-heading"
                        >
                          Position evidence
                        </h3>
                        <p className="m-0 text-xs text-muted">
                          Purpose-tagged Documents retained against the permanent Item Number.
                        </p>
                      </div>
                      {canUpdate && canReadEvidence ? (
                        <Button
                          className="shrink-0 whitespace-nowrap"
                          size="default"
                          type="button"
                          variant="secondary"
                          onClick={(event) =>
                            openLinkEvidence(event.currentTarget as unknown as { focus(): void })
                          }
                        >
                          Link External Evidence
                        </Button>
                      ) : null}
                    </div>
                    {!canReadEvidence ? (
                      <p className="m-0 rounded-[4px] border border-line bg-[#f8fafc] px-4 py-3 text-xs leading-[1.55] text-muted">
                        Evidence inspection is restricted by the active Document permission.
                      </p>
                    ) : !selectedDetail ? (
                      <p className="m-0 rounded-[4px] border border-line bg-[#f8fafc] px-4 py-3 text-xs leading-[1.55] text-muted">
                        Select this position to inspect its linked evidence.
                      </p>
                    ) : evidence.length ? (
                      <div className="grid gap-2">
                        {evidence.map((evidenceItem) => (
                          <article
                            className="grid gap-3 rounded-[4px] border border-line bg-[#f8fafc] p-4 min-[1440px]:grid-cols-[minmax(0,1fr)_auto] min-[1440px]:items-center"
                            key={evidenceItem.id}
                          >
                            <div className="grid min-w-0 gap-1.5">
                              <div className="flex flex-wrap items-center gap-2">
                                <StateBadge tone="blue">
                                  {evidencePurposeLabels[evidenceItem.purpose]}
                                </StateBadge>
                                <span className="text-[11px] text-muted">
                                  {evidenceItem.status}
                                </span>
                              </div>
                              <strong className="truncate text-sm text-midnight">
                                {evidenceItem.documentNo ?? evidenceItem.documentType}
                              </strong>
                              <span className="text-xs text-muted">
                                {evidenceItem.documentType} · v{evidenceItem.versionNo} ·{' '}
                                {evidenceItem.mimeType}
                              </span>
                              <span className="text-xs text-muted">
                                {evidenceItem.effectiveFrom
                                  ? `Effective ${dateLabel(evidenceItem.effectiveFrom)}`
                                  : 'No effectivity recorded'}
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-2 min-[1440px]:justify-end">
                              <Button
                                className="whitespace-nowrap"
                                size="default"
                                type="button"
                                variant="secondary"
                                onClick={() => void inspectEvidence(evidenceItem)}
                              >
                                Inspect document
                              </Button>
                              {canUpdate ? (
                                <Button
                                  className="whitespace-nowrap text-[#8b2f2f] hover:bg-[#fff1f1]"
                                  size="default"
                                  type="button"
                                  variant="secondary"
                                  onClick={(event) =>
                                    openRemoveEvidence(
                                      evidenceItem,
                                      event.currentTarget as unknown as { focus(): void },
                                    )
                                  }
                                >
                                  Remove link
                                </Button>
                              ) : null}
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p className="m-0 rounded-[4px] border border-dashed border-[#9cabc0] bg-[#fbfcfe] px-4 py-4 text-xs leading-[1.55] text-muted">
                        No evidence is linked to this position yet. Link the Document that supports
                        its description, creation, or another controlled purpose.
                      </p>
                    )}
                  </section>
                  <section
                    aria-labelledby="plantilla-transition-history-heading"
                    className="grid gap-3"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <h3
                        className="m-0 text-xs font-bold text-midnight"
                        id="plantilla-transition-history-heading"
                      >
                        Transition history
                      </h3>
                      <span className="font-mono text-[10px] text-muted">
                        {selectedDetail?.history.length ?? 0}{' '}
                        {selectedDetail?.history.length === 1 ? 'event' : 'events'}
                      </span>
                    </div>
                    {selectedDetail?.history.length ? (
                      <ol className="m-0 grid list-none gap-2 p-0">
                        {selectedDetail.history.map((event) => (
                          <li
                            className="grid gap-1 rounded-[4px] border border-line bg-[#f8fafc] p-3"
                            key={event.id}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <strong className="text-xs text-midnight">
                                {transitionActionLabel(event.action)}
                              </strong>
                              <span className="font-mono text-[10px] text-muted">
                                {event.effectiveDate ? dateLabel(event.effectiveDate) : '—'}
                              </span>
                            </div>
                            <span className="text-xs text-muted">
                              {event.previousStatus ?? '—'} → {event.newStatus ?? '—'}
                            </span>
                            {event.reason ? (
                              <span className="text-xs leading-[1.5] text-ink">{event.reason}</span>
                            ) : null}
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="m-0 rounded-[4px] border border-dashed border-[#9cabc0] bg-[#fbfcfe] px-4 py-4 text-xs leading-[1.55] text-muted">
                        No lifecycle transitions recorded for this position.
                      </p>
                    )}
                  </section>
                </div>
                <aside className="grid content-start gap-4 border-t border-line bg-[#f8fafc] p-5 min-[1040px]:border-t-0 min-[1040px]:border-l">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="m-0 text-xs font-bold text-midnight">Version history</h3>
                    <span className="font-mono text-[10px] text-muted">
                      {versions.length} {versions.length === 1 ? 'version' : 'versions'}
                    </span>
                  </div>
                  <VersionHistory versions={versions} />
                  <Button
                    disabled={Boolean(selected.draft) || busy || !canUpdate}
                    size="default"
                    type="button"
                    variant="secondary"
                    onClick={() => void prepareSuccessor()}
                  >
                    {selected.draft
                      ? 'Draft successor exists'
                      : busy
                        ? 'Preparing…'
                        : 'Prepare successor'}
                  </Button>
                  <p className="m-0 text-[11px] leading-[1.5] text-muted">
                    Activated versions stay unchanged. Structural updates create one Draft
                    successor.
                  </p>
                </aside>
              </div>
            </article>
          ) : (
            <div className="grid min-h-[420px] place-content-center gap-2 p-8 text-center">
              <strong className="text-sm text-midnight">No effective position selected</strong>
              <p className="m-0 max-w-[360px] text-xs leading-[1.6] text-muted">
                Create a proposed position or choose a different effective date.
              </p>
            </div>
          )}
        </div>
      </section>

      <CreatePositionDialog
        open={dialogOpen}
        onOpenChange={closeCreate}
        options={options}
        optionsLoading={optionsLoading}
        busy={busy}
        error={error}
        onSubmit={(event) => void submitCreate(event)}
      />
      <LinkEvidenceDialog
        open={linkEvidenceOpen}
        onOpenChange={closeLinkEvidence}
        documents={evidenceDocuments}
        documentsLoading={evidenceDocumentsLoading}
        busy={evidenceBusy}
        error={error}
        onSubmit={(event) => void submitLinkEvidence(event)}
      />
      <RemoveEvidenceDialog
        evidence={removeEvidenceTarget}
        open={removeEvidenceTarget !== null}
        onOpenChange={closeRemoveEvidence}
        busy={evidenceBusy}
        error={error}
        onSubmit={(event) => void submitRemoveEvidence(event)}
      />
      <TransitionDialog
        target={transitionTarget}
        open={transitionTarget !== null}
        defaultDate={transitionDefaultDate}
        busy={transitionBusy}
        error={transitionError}
        onOpenChange={closeTransition}
        onSubmit={(event) => void submitTransition(event)}
      />
    </div>
  );
}
