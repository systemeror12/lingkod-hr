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

const evidencePurposeLabels: Record<EvidencePurpose, string> = {
  POSITION_DESCRIPTION: 'Position description',
  CREATION: 'Creation',
  RECLASSIFICATION: 'Reclassification',
  TRANSFER: 'Transfer',
  FREEZE: 'Freeze',
  ABOLITION: 'Abolition',
  OTHER: 'Other position evidence',
};

let restoreTransitionFocusOnMount = false;
let pendingTransitionSuccess: { asOf: string; message: string } | null = null;

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

const lifecycleTone: Record<LifecycleStatus, StatusTone> = {
  PROPOSED: 'warning',
  AUTHORIZED: 'info',
  VACANT: 'info',
  RESERVED: 'info',
  OCCUPIED: 'success',
  FROZEN: 'neutral',
  ABOLISHED: 'danger',
};

const versionTone: Record<VersionState, StatusTone> = {
  DRAFT: 'warning',
  ACTIVE: 'success',
  SUPERSEDED: 'neutral',
  VOIDED: 'danger',
};

const sectionTitleClass = 'm-0 text-panel-title text-ink';
const dangerButtonClass = 'border-danger text-danger hover:bg-danger/5';

/** Label and value pairs in a record panel; `detail` adds a muted line under the value. */
function FactList({ facts }: { facts: { label: string; value: ReactNode; detail?: string }[] }) {
  return (
    <dl className="m-0 grid gap-x-10 gap-y-4 sm:grid-cols-2">
      {facts.map((fact) => (
        <div key={fact.label}>
          <dt className="text-caption text-ink-muted">{fact.label}</dt>
          <dd className="m-0 text-body font-[600] text-ink">{fact.value}</dd>
          {fact.detail ? <dd className="m-0 text-small text-ink-muted">{fact.detail}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

function VersionHistory({ versions }: { versions: PlantillaPositionVersion[] }) {
  return (
    <ol className="m-0 grid list-none gap-0 p-0">
      {versions.map((version, index) => (
        <li className="relative grid grid-cols-[20px_1fr] gap-3 pb-5 last:pb-0" key={version.id}>
          <span
            className="z-1 mt-1.5 size-2.5 rounded-full border-2 border-surface bg-primary ring-1 ring-primary"
            aria-hidden="true"
          />
          {index < versions.length - 1 ? (
            <span
              className="absolute top-4 bottom-0 left-[4px] w-px bg-border"
              aria-hidden="true"
            />
          ) : null}
          <div className="grid gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <strong className="text-small font-[650] text-ink">
                Version {version.versionNo}
              </strong>
              <StatusTag tone={versionTone[version.versionState]}>{version.versionState}</StatusTag>
            </div>
            <span className="text-caption text-ink-muted">
              {dateLabel(version.effectiveFrom)}{' '}
              {version.effectiveTo ? `— ${dateLabel(version.effectiveTo)}` : 'onward'}
            </span>
            <span className="text-caption text-ink">
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
              <StateSurface compact busy label="Catalog references">
                <p className="m-0" role="status">
                  Loading active Organization Units, Qualification Standards, and Staffing
                  Authorities…
                </p>
              </StateSurface>
            ) : null}
            <section className="grid gap-4" aria-labelledby="position-identity-fields">
              <h3 className={sectionTitleClass} id="position-identity-fields">
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
              <h3 className={sectionTitleClass} id="position-definition-fields">
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
                        Parenthetical title{' '}
                        <span className="font-normal text-ink-muted">Optional</span>
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
              <h3 className={sectionTitleClass} id="position-reference-fields">
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
              <StateSurface compact busy label="Agency Documents">
                <p className="m-0" role="status">
                  Loading linkable Agency Documents…
                </p>
              </StateSurface>
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
                  Effectivity <span className="font-normal text-ink-muted">Optional</span>
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
            <p className="m-0 border-l-2 border-primary bg-canvas px-3 py-2.5 text-small text-ink-muted">
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
            <div className="grid gap-1 rounded-control border border-border bg-canvas px-4 py-3">
              <span className="text-caption text-ink-muted">Attached as</span>
              <strong className="text-body font-[600] text-ink">
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
  const navigation = useRecordNavigation();
  const selectedId = navigation.search.get('record');
  const asOf = navigation.search.get('asOf') || manilaToday();
  const query = navigation.search.get('q') || '';
  function setSelectedId(id: string) {
    navigation.navigate({ record: id, view: 'form' });
  }
  function setQuery(value: string) {
    navigation.navigate({ q: value });
  }
  const detailRequest = useRef(0);
  useEffect(() => {
    setDetail(null);
    setError('');
    if (selectedId) void loadDetail(selectedId);
    return () => {
      detailRequest.current += 1;
    };
  }, [selectedId, asOf]);
  const [detail, setDetail] = useState<PlantillaPositionDetail | null>(null);
  const [detailFailed, setDetailFailed] = useState(false);
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
  const [transitionFocusPending, setTransitionFocusPending] = useState(false);

  const selected =
    positions.find((position) => position.id === selectedId) ??
    (detail?.position.id === selectedId ? detail.position : null);
  const matches = positions.filter((position) => {
    const version = position.currentVersion;
    return `${position.itemNumber} ${version?.title ?? ''} ${version?.organizationUnit.name ?? ''} ${version?.salaryGrade ?? ''}`
      .toLowerCase()
      .includes(query.trim().toLowerCase());
  });
  const selectedDetail =
    detail && detail.position.id === selected?.id && detail.asOf === asOf ? detail : null;
  const effective = selectedDetail ? selectedDetail.effective : null;
  const transitionDefaultDate = nextDate(effective?.effectiveFrom ?? asOf);

  useEffect(() => {
    if (!transitionFocusPending || !selectedDetail) return;
    const frame = setTimeout(() => {
      const target = transitionActionsRef.current as unknown as { focus(): void } | null;
      if (!target) return;
      target.focus();
      setTransitionFocusPending(false);
    }, 0);
    return () => clearTimeout(frame);
  }, [selectedDetail, transitionFocusPending]);

  useEffect(() => {
    if (!restoreTransitionFocusOnMount || !selectedDetail) return;
    restoreTransitionFocusOnMount = false;
    const frame = setTimeout(() => {
      (transitionActionsRef.current as unknown as { focus(): void } | null)?.focus();
    }, 0);
    return () => clearTimeout(frame);
  }, [selectedDetail]);

  useEffect(() => {
    if (!pendingTransitionSuccess || pendingTransitionSuccess.asOf !== asOf) return;
    const pending = pendingTransitionSuccess;
    pendingTransitionSuccess = null;
    setSuccess(pending.message);
  }, [asOf]);

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
    const requestId = ++detailRequest.current;
    setDetailFailed(false);
    try {
      const next = (await request(
        `/${encodeURIComponent(positionId)}?asOf=${encodeURIComponent(nextAsOf)}`,
      )) as PlantillaPositionDetail;
      if (requestId === detailRequest.current) setDetail(next);
    } catch (requestError: unknown) {
      if (requestId === detailRequest.current) setDetailFailed(true);
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
    if (value) navigation.navigate({ asOf: value });
  }

  async function selectPosition(positionId: string): Promise<void> {
    setSelectedId(positionId);
    setError('');
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
      const successMessage = `“${position.itemNumber}” was ${config.pastTense} effective ${dateLabel(effectiveDate)}.`;
      pendingTransitionSuccess = { asOf: effectiveDate, message: successMessage };
      restoreTransitionFocusOnMount = true;
      navigation.navigate({ asOf: effectiveDate });
      await loadDetail(position.id, effectiveDate);
      setSuccess(successMessage);
      setTransitionTarget(null);
      setTransitionFocusPending(true);
    } catch (requestError: unknown) {
      pendingTransitionSuccess = null;
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

  const lifecycleStatus = effective?.lifecycleStatus;
  const lifecycleActions: { target: TransitionTarget; allowed: boolean; danger?: boolean }[] = [
    { target: 'authorize', allowed: canAuthorize && lifecycleStatus === 'PROPOSED' },
    { target: 'declareVacant', allowed: canDeclareVacant && lifecycleStatus === 'AUTHORIZED' },
    {
      target: 'freeze',
      allowed: canFreeze && (lifecycleStatus === 'AUTHORIZED' || lifecycleStatus === 'VACANT'),
    },
    { target: 'unfreeze', allowed: canUnfreeze && lifecycleStatus === 'FROZEN' },
    { target: 'cancel', allowed: canCancel && lifecycleStatus === 'PROPOSED', danger: true },
    {
      target: 'abolish',
      allowed: canAbolish && (lifecycleStatus === 'AUTHORIZED' || lifecycleStatus === 'VACANT'),
      danger: true,
    },
  ];

  const breadcrumbs: Breadcrumb[] = [{ label: 'Structure' }];
  if (selectedId) {
    breadcrumbs.push(
      { label: 'Plantilla Positions', href: navigation.href({ record: null, view: null }) },
      { label: selected?.itemNumber ?? 'Plantilla Position' },
    );
  }

  return (
    <div className="grid gap-5">
      <PageHeader
        breadcrumbs={breadcrumbs}
        title="Plantilla Positions"
        actions={
          canCreate ? (
            <Button
              type="button"
              variant="primary"
              onClick={(event) =>
                void openCreate(event.currentTarget as unknown as { focus(): void })
              }
            >
              Create proposed position
            </Button>
          ) : null
        }
      />

      <div className="grid gap-3 rounded-panel border border-border bg-surface px-4 py-3 min-[761px]:grid-cols-[minmax(0,1fr)_auto] min-[761px]:items-end">
        <Field htmlFor="plantilla-catalog-search" label="Search the catalog">
          <input
            className={inputClass}
            id="plantilla-catalog-search"
            placeholder="Item Number, title, unit, or salary grade"
            value={query}
            onChange={(event) => setQuery(targetValue(event))}
          />
        </Field>
        <Field htmlFor="plantilla-effective-on" label="Effective on">
          <input
            className={`${inputClass} min-[761px]:w-[158px]`}
            id="plantilla-effective-on"
            type="date"
            value={asOf}
            onChange={(event) => void changeAsOf(targetValue(event))}
          />
        </Field>
      </div>

      {success ? (
        <p className="m-0 text-small text-success" role="status">
          {success}
        </p>
      ) : null}
      {error &&
      !(detailFailed && !selectedDetail) &&
      !dialogOpen &&
      !linkEvidenceOpen &&
      !removeEvidenceTarget &&
      !transitionTarget ? (
        <FormError message={error} />
      ) : null}

      {!selectedId ? (
        <Panel
          title={query ? 'Matching positions' : 'All positions'}
          flush
          actions={<span className="text-caption text-ink-muted">Effective {dateLabel(asOf)}</span>}
        >
          {matches.length ? (
            <>
              <Table className="min-w-[720px]">
                <thead>
                  <tr>
                    <Th>Item Number</Th>
                    <Th>Position title</Th>
                    <Th>Organization unit</Th>
                    <Th kind="numeric">Salary grade</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map((position) => {
                    const version = position.currentVersion;
                    return (
                      <Tr key={position.id}>
                        <RowHeader>
                          <button
                            className="w-fit cursor-pointer border-0 bg-transparent p-0 text-left font-mono font-[600] text-primary hover:underline"
                            type="button"
                            onClick={() => void selectPosition(position.id)}
                          >
                            {position.itemNumber}
                          </button>
                        </RowHeader>
                        <Td className="text-ink">
                          {version?.title ?? 'No effective definition'}
                          {version?.parentheticalTitle ? (
                            <span className="block text-caption text-ink-muted">
                              ({version.parentheticalTitle})
                            </span>
                          ) : null}
                        </Td>
                        <Td className="text-ink-muted">
                          {version?.organizationUnit.name ?? 'Pending effectivity'}
                        </Td>
                        <Td kind="numeric">{version ? `SG ${version.salaryGrade}` : '—'}</Td>
                        <Td>
                          <StatusTag tone={lifecycleTone[position.status]}>
                            {position.status}
                          </StatusTag>
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
              <TableFooter shown={matches.length} total={positions.length} />
            </>
          ) : positions.length ? (
            <StateSurface compact label="Plantilla Position search results">
              <strong className="text-body font-[650] text-ink">No position found</strong>
              <p className="m-0">Try an Item Number, title, unit, or grade.</p>
            </StateSurface>
          ) : (
            <StateSurface compact label="Plantilla Position catalog">
              <strong className="text-body font-[650] text-ink">No Plantilla Positions yet.</strong>
              {canCreate ? (
                <p className="m-0">Create a proposed position to reserve its Item Number.</p>
              ) : null}
            </StateSurface>
          )}
        </Panel>
      ) : selectedDetail && selected && effective ? (
        <article className="grid min-w-0 gap-5" aria-labelledby="selected-position-title">
          <div className="rounded-panel border border-border bg-surface px-5 py-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="m-0 text-page-title text-ink" id="selected-position-title">
                  {effective.title}
                  {effective.parentheticalTitle ? (
                    <span className="ml-2 text-body font-normal text-ink-muted">
                      ({effective.parentheticalTitle})
                    </span>
                  ) : null}
                </h2>
                <StatusTag tone={lifecycleTone[effective.lifecycleStatus]}>
                  {effective.lifecycleStatus}
                </StatusTag>
              </div>
              <p className="m-0 mt-1 text-body text-ink-muted">{effective.organizationUnit.name}</p>
              <dl className="m-0 mt-4 flex flex-wrap gap-x-10 gap-y-2">
                {[
                  ['Permanent Item Number', selected.itemNumber],
                  ['Salary grade', `SG ${effective.salaryGrade}`],
                  ['Effective from', dateLabel(effective.effectiveFrom)],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-caption text-ink-muted">{label}</dt>
                    <dd className="m-0 text-body font-[600] text-ink">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div
              ref={transitionActionsRef}
              role="group"
              aria-label="Position lifecycle actions"
              className="mt-4 flex flex-wrap gap-2 outline-none empty:mt-0"
              tabIndex={-1}
            >
              {lifecycleActions
                .filter((action) => action.allowed)
                .map((action) => (
                  <Button
                    key={action.target}
                    className={action.danger ? dangerButtonClass : undefined}
                    disabled={busy || transitionBusy}
                    type="button"
                    variant="secondary"
                    onClick={(event) =>
                      openTransition(
                        action.target,
                        event.currentTarget as unknown as { focus(): void },
                      )
                    }
                  >
                    {transitionConfig[action.target].submitLabel}
                  </Button>
                ))}
            </div>
          </div>

          <div className="grid items-start gap-5 min-[1040px]:grid-cols-[minmax(0,1fr)_280px]">
            <div className="grid min-w-0 gap-5">
              <Panel
                title="Effective definition"
                actions={
                  <span className="text-caption text-ink-muted">Version {effective.versionNo}</span>
                }
              >
                <FactList
                  facts={[
                    { label: 'Funding source', value: effective.fundingSource },
                    { label: 'Employment category', value: effective.employmentCategory },
                    { label: 'Organization unit', value: effective.organizationUnit.name },
                    {
                      label: 'Lifecycle status',
                      value: (
                        <StatusTag tone={lifecycleTone[effective.lifecycleStatus]}>
                          {effective.lifecycleStatus}
                        </StatusTag>
                      ),
                    },
                  ]}
                />
              </Panel>

              <Panel title="Effective references">
                <FactList
                  facts={[
                    {
                      label: 'Qualification standard',
                      value: `${effective.qualificationStandard.code} · v${effective.qualificationStandard.versionNo}`,
                      detail: effective.qualificationStandard.name,
                    },
                    {
                      label: 'Staffing authority',
                      value: effective.staffingAuthority.referenceNo,
                      detail: `Applicable on ${dateLabel(effective.effectiveFrom)}`,
                    },
                  ]}
                />
              </Panel>

              <Panel
                title="Position evidence"
                flush
                actions={
                  canUpdate && canReadEvidence ? (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={(event) =>
                        openLinkEvidence(event.currentTarget as unknown as { focus(): void })
                      }
                    >
                      Link External Evidence
                    </Button>
                  ) : null
                }
              >
                <p className="m-0 px-4 pt-3 text-small text-ink-muted">
                  Purpose-tagged Documents retained against the permanent Item Number.
                </p>
                {!canReadEvidence ? (
                  <StateSurface compact label="Evidence access">
                    <p className="m-0">
                      Evidence inspection is restricted by the active Document permission.
                    </p>
                  </StateSurface>
                ) : selectedDetail.evidence.length ? (
                  <ul className="m-0 grid list-none gap-2 p-4">
                    {selectedDetail.evidence.map((evidenceItem) => (
                      <li
                        className="grid gap-3 rounded-control border border-border p-4"
                        key={evidenceItem.id}
                      >
                        <div className="grid min-w-0 gap-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusTag tone="info">
                              {evidencePurposeLabels[evidenceItem.purpose]}
                            </StatusTag>
                            <span className="text-caption text-ink-muted">
                              {evidenceItem.status}
                            </span>
                          </div>
                          <strong className="truncate text-body font-[600] text-ink">
                            {evidenceItem.documentNo ?? evidenceItem.documentType}
                          </strong>
                          <span className="text-small text-ink-muted">
                            {evidenceItem.documentType} · v{evidenceItem.versionNo} ·{' '}
                            {evidenceItem.mimeType}
                          </span>
                          <span className="text-small text-ink-muted">
                            {evidenceItem.effectiveFrom
                              ? `Effective ${dateLabel(evidenceItem.effectiveFrom)}`
                              : 'No effectivity recorded'}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => void inspectEvidence(evidenceItem)}
                          >
                            Inspect document
                          </Button>
                          {canUpdate ? (
                            <Button
                              className={dangerButtonClass}
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
                      </li>
                    ))}
                  </ul>
                ) : (
                  <StateSurface compact label="Evidence links">
                    <p className="m-0">
                      No evidence is linked to this position yet. Link the Document that supports
                      its description, creation, or another controlled purpose.
                    </p>
                  </StateSurface>
                )}
              </Panel>

              <Panel
                title="Transition history"
                flush
                actions={
                  <span className="text-caption text-ink-muted">
                    {selectedDetail.history.length}{' '}
                    {selectedDetail.history.length === 1 ? 'event' : 'events'}
                  </span>
                }
              >
                {selectedDetail.history.length ? (
                  <Table>
                    <thead>
                      <tr>
                        <Th>Action</Th>
                        <Th>Status change</Th>
                        <Th kind="date">Effective</Th>
                        <Th>Reason</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedDetail.history.map((event) => (
                        <Tr key={event.id}>
                          <Td className="font-[600] text-ink">
                            {transitionActionLabel(event.action)}
                          </Td>
                          <Td className="whitespace-nowrap">
                            {event.previousStatus ?? '—'} → {event.newStatus ?? '—'}
                          </Td>
                          <Td kind="date">
                            {event.effectiveDate ? dateLabel(event.effectiveDate) : '—'}
                          </Td>
                          <Td className="text-ink-muted">{event.reason ?? '—'}</Td>
                        </Tr>
                      ))}
                    </tbody>
                  </Table>
                ) : (
                  <StateSurface compact label="Lifecycle transitions">
                    <p className="m-0">No lifecycle transitions recorded for this position.</p>
                  </StateSurface>
                )}
              </Panel>
            </div>

            <Panel
              title="Version history"
              actions={
                <span className="text-caption text-ink-muted">
                  {selectedDetail.versions.length}{' '}
                  {selectedDetail.versions.length === 1 ? 'version' : 'versions'}
                </span>
              }
            >
              <div className="grid gap-4">
                <VersionHistory versions={selectedDetail.versions} />
                <Button
                  disabled={Boolean(selected.draft) || busy || !canUpdate}
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
                <p className="m-0 text-caption text-ink-muted">
                  Activated versions stay unchanged. Structural updates create one Draft successor.
                </p>
              </div>
            </Panel>
          </div>
        </article>
      ) : selectedDetail ? (
        <StateSurface labelledBy="plantilla-detail-state-title">
          <StateCode>Not effective</StateCode>
          <div className="grid justify-items-start gap-2.5" role="status">
            <h2 className="m-0 text-page-title text-ink" id="plantilla-detail-state-title">
              This position is unavailable on the selected date
            </h2>
            <p className="m-0 max-w-[420px] text-body text-ink-muted">
              Create a proposed position or choose a different effective date.
            </p>
          </div>
        </StateSurface>
      ) : detailFailed ? (
        <StateSurface labelledBy="plantilla-detail-state-title">
          <StateCode>Unavailable</StateCode>
          <h2 className="m-0 text-page-title text-ink" id="plantilla-detail-state-title">
            This position could not be loaded
          </h2>
          <p className="m-0 max-w-[420px] text-body text-ink-muted" role="alert">
            {error || 'The position detail could not be loaded.'} Choose a different effective date
            or return to Plantilla Positions.
          </p>
        </StateSurface>
      ) : (
        <StateSurface busy label="Plantilla Position">
          <StateCode>Loading</StateCode>
          <p className="m-0 text-body text-ink-muted" role="status">
            Loading the Plantilla Position…
          </p>
        </StateSurface>
      )}

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
