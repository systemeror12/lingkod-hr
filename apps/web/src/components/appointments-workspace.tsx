'use client';

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { manilaToday } from '../lib/manila-date';
import { useRecordNavigation } from './record-navigation';
import { StateCode, StateSurface } from './state-surface';
import { Button } from './ui/button';
import {
  Dialog as FormDialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Field, FormError, inputClass } from './ui/field';
import { PageHeader } from './ui/page-header';
import { Panel } from './ui/panel';
import { SectionTabList, SectionTabPanel, SectionTabs } from './ui/section-tabs';
import { StatusTag, type StatusTone } from './ui/status-tag';
import { RowHeader, Table, Td, Th, Tr } from './ui/table';

type WorkflowStatus = 'DRAFT' | 'FOR_REVIEW' | 'FOR_SIGNATURE' | 'ISSUED' | 'CANCELLED';
type VersionStatus = 'DRAFT' | 'ISSUED' | 'SUPERSEDED';
type SignatureMethod = 'WET_INK' | 'ELECTRONIC' | 'DIGITAL_CERTIFICATE';
type RegulatoryStatus = 'REGULATED' | 'ACCREDITED_OR_DEREGULATED';
type ExternalStanding =
  | 'NOT_SUBMITTED'
  | 'SUBMITTED'
  | 'RECEIVED'
  | 'RETURNED'
  | 'RESUBMITTED'
  | 'APPROVED'
  | 'DISAPPROVED'
  | 'VALIDATED'
  | 'INVALIDATED';
type AssumptionStatus = 'PENDING' | 'ASSUMED' | 'DID_NOT_ASSUME' | 'CANCELLED';
type AssumptionOutcome = 'DID_NOT_ASSUME' | 'CANCELLED';
type Dialog =
  | 'prepare'
  | 'update'
  | 'return'
  | 'cancel'
  | 'correct'
  | 'settings'
  | 'external-submission'
  | 'external-action'
  | 'receipt'
  | 'oath'
  | 'oath-correction'
  | 'assumption'
  | 'assumption-correction'
  | 'assumption-failure'
  | 'assumption-cancellation'
  | 'activation'
  | null;
type Tab = 'preparation' | 'review' | 'oath' | 'csc';

const EMPLOYMENT_STATUSES = [
  'PERMANENT',
  'TEMPORARY',
  'COTERMINOUS',
  'FIXED_TERM',
  'CONTRACTUAL',
  'SUBSTITUTE',
  'PROVISIONAL',
] as const;
const NATURES = [
  'ORIGINAL',
  'PROMOTION',
  'TRANSFER',
  'REEMPLOYMENT',
  'REAPPOINTMENT',
  'REINSTATEMENT',
  'RECLASSIFICATION',
  'DEMOTION',
] as const;
const SIGNATURE_METHODS = ['WET_INK', 'ELECTRONIC', 'DIGITAL_CERTIFICATE'] as const;
const ACTIVATION_SEXES = ['FEMALE', 'MALE'] as const;
const ACTIVATION_CIVIL_STATUSES = ['SINGLE', 'MARRIED', 'WIDOWED', 'SEPARATED'] as const;
const EXTERNAL_SUBMISSION_TYPES = ['SUBMITTED', 'RECEIVED', 'RETURNED', 'RESUBMITTED'] as const;
const APPROVAL_ACTIONS = ['APPROVED', 'DISAPPROVED'] as const;
const VALIDATION_ACTIONS = ['VALIDATED', 'INVALIDATED'] as const;
const REQUIRED_ROLES = [
  ['PDS', 'PDS'],
  ['WORK_EXPERIENCE_SHEET', 'Work Experience Sheet'],
  ['ELIGIBILITY_PROOF', 'Proof of eligibility'],
  ['POSITION_DESCRIPTION_FORM', 'Position Description Form'],
  ['SELECTION_CERTIFICATION', 'Selection certification'],
  ['PUBLICATION_CERTIFICATION', 'Publication certification'],
  ['AUTHORITY_OR_DELEGATION', 'Authority or delegation'],
] as const;
const DEFAULT_ROLE_TYPES: Record<string, string[]> = {
  PDS: ['PDS'],
  WORK_EXPERIENCE_SHEET: ['WORK_EXPERIENCE_SHEET'],
  ELIGIBILITY_PROOF: ['CERTIFICATE_OF_ELIGIBILITY', 'ELIGIBILITY'],
  POSITION_DESCRIPTION_FORM: ['POSITION_DESCRIPTION_FORM'],
  SELECTION_CERTIFICATION: ['SELECTION_CERTIFICATION'],
  PUBLICATION_CERTIFICATION: ['PUBLICATION_CERTIFICATION'],
  AUTHORITY_OR_DELEGATION: ['APPOINTING_AUTHORITY', 'STAFFING_AUTHORITY'],
};

export interface AppointmentEvidence {
  id: string;
  linkRole: string;
  documentVersionId: string;
  documentId: string;
  documentNo: string | null;
  documentType: string;
  classification: string;
  versionNo: number;
  issuedAt: string;
}

export interface AppointmentRecordedEvidence {
  documentVersionId: string;
  documentId: string;
  documentNo: string | null;
  documentType: string;
  classification: string;
  versionNo: number;
  issuedAt: string;
}

export interface AppointmentAcknowledgment {
  acknowledgedAt: string;
  evidence: AppointmentRecordedEvidence;
}

export interface AppointmentOathVersion {
  id: string;
  versionNo: number;
  oathDate: string;
  administeredByMembershipId: string;
  authority: string;
  place: string | null;
  permittedVirtualMethod: string | null;
  replacesOathVersionId: string | null;
  correctionReason: string | null;
  correctionAuthorityDocumentVersionId: string | null;
  recordedAt: string;
  evidence: AppointmentRecordedEvidence;
}

export interface AppointmentOath {
  id: string;
  currentVersion: AppointmentOathVersion | null;
  versions: AppointmentOathVersion[];
}

export interface AppointmentAssumptionVersion {
  id: string;
  versionNo: number;
  oathVersionId: string;
  actualAssumptionDate: string;
  certifiedByMembershipId: string;
  certifyingAuthority: string;
  certifiedAt: string;
  replacesAssumptionVersionId: string | null;
  correctionReason: string | null;
  correctionAuthorityDocumentVersionId: string | null;
  recordedAt: string;
  evidence: AppointmentRecordedEvidence;
}

export interface AppointmentAssumptionOutcome {
  id: string;
  outcome: AssumptionOutcome;
  noticeDate: string | null;
  deadlineDate: string | null;
  outcomeDate: string;
  reason: string;
  authorizedByMembershipId: string;
  authorityDocumentVersionId: string;
  evidenceDocumentVersionId: string;
  recordedAt: string;
}

export interface AppointmentAssumption {
  id: string;
  appointmentVersionId: string;
  status: AssumptionStatus;
  currentVersion: AppointmentAssumptionVersion | null;
  versions: AppointmentAssumptionVersion[];
  outcome: AppointmentAssumptionOutcome | null;
}

export interface AppointmentVersion {
  id: string;
  versionNo: number;
  status: VersionStatus;
  employmentStatus: string;
  natureOfAppointment: string;
  salaryGrade: number;
  salaryStep: number;
  effectivityDate: string;
  appointingAuthorityMembershipId: string;
  formVariant: string;
  signatureMethod: SignatureMethod;
  signatureEvidenceDocumentVersionId: string | null;
  appointmentDocumentVersionId: string;
  issuedAt: string | null;
  issuedByMembershipId: string | null;
  replacesVersionId: string | null;
  correctionReason: string | null;
  correctionAuthorityDocumentVersionId: string | null;
  createdAt: string;
  updatedAt: string;
  evidence: AppointmentEvidence[];
  acknowledgment: AppointmentAcknowledgment | null;
  oath: AppointmentOath | null;
  assumption: AppointmentAssumption | null;
}

export interface AppointmentSummary {
  id: string;
  workflowStatus: WorkflowStatus;
  externalStanding: ExternalStanding;
  recruitmentHandoffId: string;
  position: {
    id: string;
    itemNumber: string;
    title: string | null;
    salaryGrade: number | null;
    organizationUnitId: string | null;
  };
  appointee: { personKey: string; fullName: string; applicationNo: string };
  currentVersion: Omit<
    AppointmentVersion,
    'evidence' | 'acknowledgment' | 'oath' | 'assumption'
  > | null;
  issuedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AppointmentHistoryEntry {
  id: string;
  action: string;
  previousStatus: string | null;
  newStatus: string | null;
  reason: string | null;
  actorMembershipId: string | null;
  occurredAt: string;
}

export interface AppointmentSettings {
  id: string;
  regulatoryStatus: RegulatoryStatus;
  formVariant: string;
  statusEvidenceDocumentVersionId: string;
  updatedAt: string;
}

export interface AppointmentExternalEvidence {
  documentVersionId: string;
  documentId: string;
  documentNo: string | null;
  documentType: string;
  classification: string;
  versionNo: number;
  issuedAt: string;
}

export interface AppointmentExternalSubmission {
  id: string;
  appointmentVersionId: string;
  eventType: ExternalStanding;
  externalReference: string | null;
  occurredAt: string;
  receivingOffice: string;
  recordedByMembershipId: string;
  reason: string | null;
  evidence: AppointmentExternalEvidence;
}

export interface AppointmentExternalAction {
  id: string;
  appointmentVersionId: string;
  action: ExternalStanding;
  externalReference: string;
  actionAt: string;
  recordedByMembershipId: string;
  reason: string | null;
  evidence: AppointmentExternalEvidence;
}

export interface AppointmentActivation {
  employeeId: string;
  employeeNumber: string;
  legalName: string;
  serviceSegmentId: string;
  effectiveFrom: string;
  positionId: string | null;
  appointmentStatus: string;
}

export interface AppointmentDetail extends AppointmentSummary {
  selectionPackage: unknown;
  versions: AppointmentVersion[];
  history: AppointmentHistoryEntry[];
  settings: AppointmentSettings | null;
  externalSubmissions: AppointmentExternalSubmission[];
  externalActions: AppointmentExternalAction[];
  activation: AppointmentActivation | null;
}

export interface EligibleSelection {
  handoffId: string;
  selectionDecisionId: string;
  applicationId: string;
  positionId: string;
  handedOffAt: string;
  applicant: { personKey: string; fullName: string; applicationNo: string };
  position: AppointmentSummary['position'];
  appointment: { id: string; workflowStatus: WorkflowStatus } | null;
}

export interface DocumentVersionOption {
  documentId: string;
  documentNo: string | null;
  documentType: string;
  classification: string;
  status: string;
  version: { id: string; versionNo: number; issuedAt: string | null };
}

interface VersionForm {
  employmentStatus: string;
  natureOfAppointment: string;
  salaryGrade: string;
  salaryStep: string;
  effectivityDate: string;
  appointingAuthorityMembershipId: string;
  signatureMethod: SignatureMethod;
  signatureEvidenceDocumentVersionId: string;
  appointmentDocumentVersionId: string;
  evidence: Record<string, string>;
}

interface Props {
  agencyId: string;
  membershipId: string;
  displayName: string;
  initialAppointments: AppointmentSummary[];
  initialSelections: EligibleSelection[];
  initialSelectionsHasMore: boolean;
  initialSettings: AppointmentSettings | null;
  documents: DocumentVersionOption[];
  canCreate: boolean;
  canSubmit: boolean;
  canReturn: boolean;
  canEndorse: boolean;
  canIssue: boolean;
  canCancel: boolean;
  canManageSettings: boolean;
  canRecordExternalEvents: boolean;
  canRecordExternalActions: boolean;
  canRecordReceipt: boolean;
  canRecordOath: boolean;
  canCertifyAssumption: boolean;
  canCorrectAssumption: boolean;
  canFailAssumption: boolean;
  canCancelAssumption: boolean;
  canActivateService: boolean;
  initialSelected: string | null;
}

type Opener = { focus(): void; isConnected: boolean; disabled: boolean };

interface ExternalForm {
  appointmentVersionId: string;
  eventType: string;
  action: string;
  externalReference: string;
  occurredAt: string;
  receivingOffice: string;
  reason: string;
  evidenceDocumentVersionId: string;
}

interface ReceiptForm {
  acknowledgedAt: string;
  documentVersionId: string;
}

interface OathForm {
  oathDate: string;
  authority: string;
  place: string;
  permittedVirtualMethod: string;
  documentVersionId: string;
  reason: string;
  authorityDocumentVersionId: string;
}

interface AssumptionForm {
  actualAssumptionDate: string;
  certifyingAuthority: string;
  certifiedAt: string;
  documentVersionId: string;
  reason: string;
  authorityDocumentVersionId: string;
}

interface OutcomeForm {
  noticeDate: string;
  deadlineDate: string;
  outcomeDate: string;
  reason: string;
  authorityDocumentVersionId: string;
  evidenceDocumentVersionId: string;
}

interface ActivationForm {
  employeeNumber: string;
  birthDate: string;
  sex: string;
  civilStatus: string;
  contactEmail: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function inputValue(event: { currentTarget: EventTarget }): string {
  return (event.currentTarget as unknown as { value: string }).value;
}

function confirmAction(message: string): boolean {
  const browser = globalThis as unknown as { confirm?: (value: string) => boolean };
  return browser.confirm?.(message) ?? false;
}

function errorMessage(value: unknown, fallback: string): string {
  if (!isObject(value)) return fallback;
  const error = value.error;
  if (isObject(error) && typeof error.message === 'string') return error.message;
  return fallback;
}

function randomKey(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
}

function dateLabel(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Manila',
  });
}

function dateTimeLabel(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
}

function label(value: string): string {
  return value.replaceAll('_', ' ');
}

function externalActionsFor(regulatoryStatus: RegulatoryStatus | null): readonly string[] {
  return (regulatoryStatus ?? 'REGULATED') === 'REGULATED' ? APPROVAL_ACTIONS : VALIDATION_ACTIONS;
}

function defaultReceiptForm(): ReceiptForm {
  return { acknowledgedAt: localDateTimeValue(new Date()), documentVersionId: '' };
}

function defaultOathForm(): OathForm {
  return {
    oathDate: manilaDateValue(new Date()),
    authority: '',
    place: '',
    permittedVirtualMethod: '',
    documentVersionId: '',
    reason: '',
    authorityDocumentVersionId: '',
  };
}

function defaultAssumptionForm(): AssumptionForm {
  return {
    actualAssumptionDate: manilaDateValue(new Date()),
    certifyingAuthority: '',
    certifiedAt: localDateTimeValue(new Date()),
    documentVersionId: '',
    reason: '',
    authorityDocumentVersionId: '',
  };
}

function defaultOutcomeForm(): OutcomeForm {
  const today = manilaDateValue(new Date());
  return {
    noticeDate: today,
    deadlineDate: today,
    outcomeDate: today,
    reason: '',
    authorityDocumentVersionId: '',
    evidenceDocumentVersionId: '',
  };
}

function defaultActivationForm(): ActivationForm {
  return {
    employeeNumber: '',
    birthDate: '',
    sex: 'FEMALE',
    civilStatus: 'SINGLE',
    contactEmail: '',
  };
}

function localDateTimeValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function manilaDateValue(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function toIsoDateTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function defaultExternalForm(
  versionId: string,
  regulatoryStatus: RegulatoryStatus | null,
): ExternalForm {
  return {
    appointmentVersionId: versionId,
    eventType: 'SUBMITTED',
    action: externalActionsFor(regulatoryStatus)[0] ?? 'APPROVED',
    externalReference: '',
    occurredAt: localDateTimeValue(new Date()),
    receivingOffice: '',
    reason: '',
    evidenceDocumentVersionId: '',
  };
}

function statusTone(status: string): StatusTone {
  if (status === 'ISSUED' || status === 'APPROVED' || status === 'VALIDATED') return 'success';
  if (status === 'FOR_REVIEW' || status === 'FOR_SIGNATURE' || status === 'RETURNED')
    return 'warning';
  if (status === 'CANCELLED' || status === 'DISAPPROVED' || status === 'INVALIDATED')
    return 'danger';
  if (status === 'SUPERSEDED' || status === 'NOT_SUBMITTED') return 'neutral';
  return 'info';
}

function StatusBadge({ status }: { status: string }) {
  return <StatusTag tone={statusTone(status)}>{label(status)}</StatusTag>;
}

const sectionTitleClass = 'm-0 text-panel-title text-ink';
const noteClass = 'm-0 text-caption text-ink-muted';
const factsClass = 'm-0 grid gap-x-10 gap-y-4 min-[621px]:grid-cols-2';

function DetailRow({ label: term, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-caption text-ink-muted">{term}</dt>
      <dd className="m-0 text-body break-words text-ink">{children}</dd>
    </div>
  );
}

/** Titled block inside the Appointment record; `aria-labelledby` names it for navigation. */
function RecordSection({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <section className="grid gap-3" aria-labelledby={titleId}>
      <div className="flex flex-wrap items-center gap-3">
        <h3 className={sectionTitleClass} id={titleId}>
          {title}
        </h3>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Bordered table for a record's history, named by `label`. */
function HistoryTable({ label: name, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-control border border-border">
      <Table aria-label={name}>{children}</Table>
    </div>
  );
}

function evidenceLabel(evidence: AppointmentRecordedEvidence): string {
  return `${evidence.documentNo ?? label(evidence.documentType)} v${evidence.versionNo}`;
}

function documentOptionLabel(document: DocumentVersionOption): string {
  return `${document.documentNo ?? document.documentType} · ${label(document.documentType)} · v${document.version.versionNo}`;
}

function defaultEvidence(documents: DocumentVersionOption[]): Record<string, string> {
  const evidence: Record<string, string> = {};
  for (const [role] of REQUIRED_ROLES) {
    const types = DEFAULT_ROLE_TYPES[role] ?? [];
    const match = documents.find((document) => types.includes(document.documentType));
    if (match) evidence[role] = match.version.id;
  }
  return evidence;
}

function defaultForm(
  documents: DocumentVersionOption[],
  membershipId: string,
  salaryGrade: number | null,
): VersionForm {
  return {
    employmentStatus: 'PERMANENT',
    natureOfAppointment: 'ORIGINAL',
    salaryGrade: salaryGrade === null ? '' : String(salaryGrade),
    salaryStep: '1',
    effectivityDate: manilaToday(),
    appointingAuthorityMembershipId: membershipId,
    signatureMethod: 'WET_INK',
    signatureEvidenceDocumentVersionId: '',
    appointmentDocumentVersionId: documents[0]?.version.id ?? '',
    evidence: defaultEvidence(documents),
  };
}

function versionInput(form: VersionForm) {
  return {
    employmentStatus: form.employmentStatus,
    natureOfAppointment: form.natureOfAppointment,
    salaryGrade: Number(form.salaryGrade),
    salaryStep: Number(form.salaryStep),
    effectivityDate: form.effectivityDate,
    appointingAuthorityMembershipId: form.appointingAuthorityMembershipId,
    signatureMethod: form.signatureMethod,
    ...(form.signatureMethod === 'WET_INK' || !form.signatureEvidenceDocumentVersionId
      ? {}
      : { signatureEvidenceDocumentVersionId: form.signatureEvidenceDocumentVersionId }),
    appointmentDocumentVersionId: form.appointmentDocumentVersionId,
    evidence: REQUIRED_ROLES.flatMap(([role]) =>
      form.evidence[role] ? [{ linkRole: role, documentVersionId: form.evidence[role] }] : [],
    ),
  };
}

function VersionFields({
  form,
  setForm,
  documents,
  authorityLabel,
  idPrefix,
}: {
  form: VersionForm;
  setForm: (next: VersionForm) => void;
  documents: DocumentVersionOption[];
  authorityLabel: string;
  idPrefix: string;
}) {
  return (
    <div className="grid gap-5">
      <div className="grid gap-5 min-[621px]:grid-cols-2">
        <Field label="Employment status" htmlFor={`${idPrefix}-employment`}>
          <select
            className={inputClass}
            id={`${idPrefix}-employment`}
            value={form.employmentStatus}
            onChange={(event) => setForm({ ...form, employmentStatus: inputValue(event) })}
          >
            {EMPLOYMENT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {label(status)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Nature of appointment" htmlFor={`${idPrefix}-nature`}>
          <select
            className={inputClass}
            id={`${idPrefix}-nature`}
            value={form.natureOfAppointment}
            onChange={(event) => setForm({ ...form, natureOfAppointment: inputValue(event) })}
          >
            {NATURES.map((nature) => (
              <option key={nature} value={nature}>
                {label(nature)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Salary grade" htmlFor={`${idPrefix}-grade`}>
          <input
            className={inputClass}
            id={`${idPrefix}-grade`}
            type="number"
            min={1}
            max={33}
            value={form.salaryGrade}
            onChange={(event) => setForm({ ...form, salaryGrade: inputValue(event) })}
          />
        </Field>
        <Field label="Salary step" htmlFor={`${idPrefix}-step`}>
          <input
            className={inputClass}
            id={`${idPrefix}-step`}
            type="number"
            min={1}
            max={8}
            value={form.salaryStep}
            onChange={(event) => setForm({ ...form, salaryStep: inputValue(event) })}
          />
        </Field>
        <Field label="Effectivity date" htmlFor={`${idPrefix}-effectivity`}>
          <input
            className={inputClass}
            id={`${idPrefix}-effectivity`}
            type="date"
            value={form.effectivityDate}
            onChange={(event) => setForm({ ...form, effectivityDate: inputValue(event) })}
          />
        </Field>
        <Field label="Signature method" htmlFor={`${idPrefix}-signature`}>
          <select
            className={inputClass}
            id={`${idPrefix}-signature`}
            value={form.signatureMethod}
            onChange={(event) =>
              setForm({ ...form, signatureMethod: inputValue(event) as SignatureMethod })
            }
          >
            {SIGNATURE_METHODS.map((method) => (
              <option key={method} value={method}>
                {label(method)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <p className="m-0 rounded-control border border-border bg-canvas px-3 py-2 text-small text-ink-muted">
        Appointing authority: <strong className="text-ink">{authorityLabel}</strong>
      </p>
      <div className="grid gap-5 min-[621px]:grid-cols-2">
        <Field label="Appointment form (finalized Document Version)" htmlFor={`${idPrefix}-form`}>
          <select
            className={inputClass}
            id={`${idPrefix}-form`}
            value={form.appointmentDocumentVersionId}
            onChange={(event) =>
              setForm({ ...form, appointmentDocumentVersionId: inputValue(event) })
            }
          >
            <option value="">Select the appointment form</option>
            {documents.map((document) => (
              <option key={document.version.id} value={document.version.id}>
                {documentOptionLabel(document)}
              </option>
            ))}
          </select>
        </Field>
        {form.signatureMethod !== 'WET_INK' ? (
          <Field
            label="Signature evidence (finalized Document Version)"
            htmlFor={`${idPrefix}-signature-evidence`}
          >
            <select
              className={inputClass}
              id={`${idPrefix}-signature-evidence`}
              value={form.signatureEvidenceDocumentVersionId}
              onChange={(event) =>
                setForm({ ...form, signatureEvidenceDocumentVersionId: inputValue(event) })
              }
            >
              <option value="">Select the signature certification</option>
              {documents.map((document) => (
                <option key={document.version.id} value={document.version.id}>
                  {documentOptionLabel(document)}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
      </div>
      <fieldset className="m-0 grid gap-3 rounded-control border border-border p-4">
        <legend className="px-1 text-caption font-[650] text-ink">Exact evidence versions</legend>
        {REQUIRED_ROLES.map(([role, roleLabel]) => (
          <Field key={role} label={roleLabel} htmlFor={`${idPrefix}-evidence-${role}`}>
            <select
              className={inputClass}
              id={`${idPrefix}-evidence-${role}`}
              value={form.evidence[role] ?? ''}
              onChange={(event) =>
                setForm({
                  ...form,
                  evidence: { ...form.evidence, [role]: inputValue(event) },
                })
              }
            >
              <option value="">Select a finalized Document Version</option>
              {documents.map((document) => (
                <option key={document.version.id} value={document.version.id}>
                  {documentOptionLabel(document)}
                </option>
              ))}
            </select>
          </Field>
        ))}
      </fieldset>
    </div>
  );
}

export function AppointmentsWorkspace(props: Props) {
  const navigation = useRecordNavigation();
  const [appointments, setAppointments] = useState(props.initialAppointments);
  const [selections, setSelections] = useState(props.initialSelections);
  const [selectionsHasMore, setSelectionsHasMore] = useState(props.initialSelectionsHasMore);
  const [settings, setSettings] = useState(props.initialSettings);
  const [loadedDetail, setLoadedDetail] = useState<AppointmentDetail | null>(null);
  const [failedDetailId, setFailedDetailId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(props.initialSelected);
  const [tab, setTab] = useState<Tab>('preparation');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [form, setForm] = useState<VersionForm>(() =>
    defaultForm(props.documents, props.membershipId, null),
  );
  const [prepareSelection, setPrepareSelection] = useState<EligibleSelection | null>(null);
  const [reason, setReason] = useState('');
  const [authorityDocumentVersionId, setAuthorityDocumentVersionId] = useState('');
  const [settingsForm, setSettingsForm] = useState({
    regulatoryStatus: props.initialSettings?.regulatoryStatus ?? 'REGULATED',
    statusEvidenceDocumentVersionId: props.initialSettings?.statusEvidenceDocumentVersionId ?? '',
  });
  const [externalForm, setExternalForm] = useState<ExternalForm>(() =>
    defaultExternalForm('', props.initialSettings?.regulatoryStatus ?? null),
  );
  const [receiptForm, setReceiptForm] = useState<ReceiptForm>(defaultReceiptForm);
  const [oathForm, setOathForm] = useState<OathForm>(defaultOathForm);
  const [assumptionForm, setAssumptionForm] = useState<AssumptionForm>(defaultAssumptionForm);
  const [outcomeForm, setOutcomeForm] = useState<OutcomeForm>(defaultOutcomeForm);
  const [activationForm, setActivationForm] = useState<ActivationForm>(defaultActivationForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const openerRef = useRef<Opener | null>(null);
  const detailRef = useRef<HTMLElement | null>(null);

  const selected = useMemo(
    () => appointments.find((appointment) => appointment.id === selectedId) ?? null,
    [appointments, selectedId],
  );
  // A previously loaded record stays in state until the next one arrives; never label it as the new selection.
  const detail = loadedDetail?.id === selectedId ? loadedDetail : null;
  const currentVersion = detail?.currentVersion ?? selected?.currentVersion ?? null;
  const issuedVersions = (detail?.versions ?? []).filter((version) => version.status === 'ISSUED');
  const externalRegulatoryStatus =
    detail?.settings?.regulatoryStatus ?? settings?.regulatoryStatus ?? null;
  const currentVersionDetail =
    currentVersion && detail
      ? (detail.versions.find((version) => version.id === currentVersion.id) ?? null)
      : null;
  const acknowledgment = currentVersionDetail?.acknowledgment ?? null;
  const oath = currentVersionDetail?.oath ?? null;
  const assumption = currentVersionDetail?.assumption ?? null;
  const assumptionPending = assumption?.status === 'PENDING';
  const activation = detail?.activation ?? null;

  async function loadDetail(appointmentId: string): Promise<void> {
    setFailedDetailId(null);
    const response = await fetch(
      `/api/v1/agencies/${props.agencyId}/appointments/${appointmentId}`,
      { credentials: 'include' },
    );
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      setFailedDetailId(appointmentId);
      setError(errorMessage(value, 'The Appointment record could not be loaded.'));
      return;
    }
    setFailedDetailId(null);
    setLoadedDetail(value as AppointmentDetail);
  }

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
    else setLoadedDetail(null);
  }, [selectedId]);

  function select(appointmentId: string): void {
    setSelectedId(appointmentId);
    setTab('preparation');
    setError('');
    setSuccess('');
    navigation.navigate({ selected: appointmentId, new: null });
  }

  async function refresh(): Promise<void> {
    const [appointmentsValue, selectionsValue, settingsValue] = await Promise.all([
      fetch(`/api/v1/agencies/${props.agencyId}/appointments?limit=100`, {
        credentials: 'include',
      }),
      fetch(`/api/v1/agencies/${props.agencyId}/appointments/eligible-selections`, {
        credentials: 'include',
      }),
      fetch(`/api/v1/agencies/${props.agencyId}/appointment-settings`, {
        credentials: 'include',
      }),
    ]);
    const appointmentsBody: unknown = await appointmentsValue.json().catch(() => null);
    const selectionsBody: unknown = await selectionsValue.json().catch(() => null);
    const settingsBody: unknown = await settingsValue.json().catch(() => null);
    if (
      isObject(appointmentsBody) &&
      Array.isArray((appointmentsBody as { appointments?: unknown }).appointments)
    ) {
      setAppointments((appointmentsBody as { appointments: AppointmentSummary[] }).appointments);
    }
    if (
      isObject(selectionsBody) &&
      Array.isArray((selectionsBody as { selections?: unknown }).selections)
    ) {
      setSelections((selectionsBody as { selections: EligibleSelection[] }).selections);
      setSelectionsHasMore((selectionsBody as { hasMore?: unknown }).hasMore === true);
    }
    if (isObject(settingsBody) || settingsBody === null) {
      setSettings((settingsBody as AppointmentSettings | null) ?? null);
    }
    if (selectedId) await loadDetail(selectedId);
  }

  async function command(path: string, body?: unknown, method: 'POST' | 'PATCH' | 'PUT' = 'POST') {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const response = await fetch(path, {
        method,
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': randomKey('appointment'),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(errorMessage(value, 'The Appointment command could not be completed.'));
        return null;
      }
      await refresh();
      return value;
    } finally {
      setBusy(false);
    }
  }

  function openPrepare(selection: EligibleSelection): void {
    setPrepareSelection(selection);
    setForm(defaultForm(props.documents, props.membershipId, selection.position.salaryGrade));
    setError('');
    setSuccess('');
    setDialog('prepare');
  }

  function openUpdate(): void {
    if (!detail || !currentVersion) return;
    const versionDetail = detail.versions.find((version) => version.id === currentVersion.id);
    setForm({
      employmentStatus: currentVersion.employmentStatus,
      natureOfAppointment: currentVersion.natureOfAppointment,
      salaryGrade: String(currentVersion.salaryGrade),
      salaryStep: String(currentVersion.salaryStep),
      effectivityDate: currentVersion.effectivityDate,
      appointingAuthorityMembershipId: currentVersion.appointingAuthorityMembershipId,
      signatureMethod: currentVersion.signatureMethod,
      signatureEvidenceDocumentVersionId: currentVersion.signatureEvidenceDocumentVersionId ?? '',
      appointmentDocumentVersionId: currentVersion.appointmentDocumentVersionId,
      evidence: Object.fromEntries(
        (versionDetail?.evidence ?? []).map((entry) => [entry.linkRole, entry.documentVersionId]),
      ),
    });
    setError('');
    setSuccess('');
    setDialog('update');
  }

  function openCorrect(): void {
    if (!detail || !currentVersion) return;
    openUpdate();
    setReason('');
    setAuthorityDocumentVersionId('');
    setDialog('correct');
  }

  async function submit(): Promise<void> {
    if (!detail) return;
    const result = await command(
      `/api/v1/agencies/${props.agencyId}/appointments/${detail.id}/submit`,
    );
    if (result) setSuccess('The Appointment was submitted for review.');
  }

  async function endorse(): Promise<void> {
    if (!detail) return;
    const result = await command(
      `/api/v1/agencies/${props.agencyId}/appointments/${detail.id}/endorse`,
    );
    if (result) setSuccess('The reviewed Appointment was endorsed for signature.');
  }

  async function issue(): Promise<void> {
    if (!detail) return;
    if (
      !confirmAction(
        'Issue this Appointment? The current version and its evidence are frozen on issuance.',
      )
    )
      return;
    const result = await command(
      `/api/v1/agencies/${props.agencyId}/appointments/${detail.id}/issue`,
    );
    if (result) setSuccess('The Appointment was issued and its version frozen.');
  }

  async function savePrepare(): Promise<void> {
    if (!prepareSelection) return;
    const result = await command(`/api/v1/agencies/${props.agencyId}/appointments`, {
      selectionDecisionId: prepareSelection.selectionDecisionId,
      ...versionInput(form),
    });
    if (result) {
      setDialog(null);
      const created = result as AppointmentDetail;
      setSuccess('The Appointment was prepared as a Draft.');
      select(created.id);
    }
  }

  async function saveUpdate(): Promise<void> {
    if (!detail) return;
    const result = await command(
      `/api/v1/agencies/${props.agencyId}/appointments/${detail.id}`,
      versionInput(form),
      'PATCH',
    );
    if (result) {
      setDialog(null);
      setSuccess('The Draft version was updated.');
    }
  }

  async function saveReturn(): Promise<void> {
    if (!detail) return;
    const result = await command(
      `/api/v1/agencies/${props.agencyId}/appointments/${detail.id}/return`,
      { reason },
    );
    if (result) {
      setDialog(null);
      setReason('');
      setSuccess('The Appointment was returned for correction.');
    }
  }

  async function saveCancel(): Promise<void> {
    if (!detail) return;
    const result = await command(
      `/api/v1/agencies/${props.agencyId}/appointments/${detail.id}/cancel`,
      { reason, authorityDocumentVersionId },
    );
    if (result) {
      setDialog(null);
      setReason('');
      setAuthorityDocumentVersionId('');
      setSuccess('The Appointment was cancelled and any reservation released.');
    }
  }

  async function saveCorrect(): Promise<void> {
    if (!detail) return;
    const result = await command(
      `/api/v1/agencies/${props.agencyId}/appointments/${detail.id}/corrections`,
      {
        reason,
        authorityDocumentVersionId,
        ...versionInput(form),
      },
    );
    if (result) {
      setDialog(null);
      setReason('');
      setAuthorityDocumentVersionId('');
      setSuccess('A linked correction Draft was prepared for reissue.');
    }
  }

  async function saveSettings(): Promise<void> {
    const result = await command(
      `/api/v1/agencies/${props.agencyId}/appointment-settings`,
      settingsForm,
      'PUT',
    );
    if (result) {
      setDialog(null);
      setSuccess('The Agency appointment configuration was recorded.');
    }
  }

  function openExternal(dialogName: 'external-submission' | 'external-action'): void {
    if (!detail || issuedVersions.length === 0) return;
    const issued = issuedVersions.at(-1);
    if (!issued) return;
    setExternalForm(defaultExternalForm(issued.id, externalRegulatoryStatus));
    setError('');
    setSuccess('');
    setDialog(dialogName);
  }

  async function saveExternalSubmission(): Promise<void> {
    if (!detail) return;
    const result = await command(
      `/api/v1/agencies/${props.agencyId}/appointments/${detail.id}/external-submissions`,
      {
        appointmentVersionId: externalForm.appointmentVersionId,
        eventType: externalForm.eventType,
        occurredAt: toIsoDateTime(externalForm.occurredAt),
        receivingOffice: externalForm.receivingOffice.trim(),
        evidenceDocumentVersionId: externalForm.evidenceDocumentVersionId,
        ...(externalForm.externalReference.trim()
          ? { externalReference: externalForm.externalReference.trim() }
          : {}),
        ...(externalForm.reason.trim() ? { reason: externalForm.reason.trim() } : {}),
      },
    );
    if (result) {
      setDialog(null);
      setSuccess('The external submission event was recorded.');
    }
  }

  async function saveExternalAction(): Promise<void> {
    if (!detail) return;
    const result = await command(
      `/api/v1/agencies/${props.agencyId}/appointments/${detail.id}/external-actions`,
      {
        appointmentVersionId: externalForm.appointmentVersionId,
        action: externalForm.action,
        externalReference: externalForm.externalReference.trim(),
        actionAt: toIsoDateTime(externalForm.occurredAt),
        evidenceDocumentVersionId: externalForm.evidenceDocumentVersionId,
        ...(externalForm.reason.trim() ? { reason: externalForm.reason.trim() } : {}),
      },
    );
    if (result) {
      setDialog(null);
      setSuccess('The official external action was recorded.');
    }
  }

  function openReceipt(): void {
    setReceiptForm(defaultReceiptForm());
    setError('');
    setSuccess('');
    setDialog('receipt');
  }

  async function saveReceipt(): Promise<void> {
    if (!detail) return;
    const result = await command(
      `/api/v1/agencies/${props.agencyId}/appointments/${detail.id}/receipt`,
      {
        acknowledgedAt: toIsoDateTime(receiptForm.acknowledgedAt),
        evidenceDocumentVersionId: receiptForm.documentVersionId,
      },
    );
    if (result) {
      setDialog(null);
      setSuccess('The appointee acknowledgment of receipt was recorded.');
    }
  }

  function openOath(): void {
    setOathForm(defaultOathForm());
    setError('');
    setSuccess('');
    setDialog('oath');
  }

  function openOathCorrection(): void {
    const current = oath?.currentVersion ?? null;
    setOathForm(
      current
        ? {
            oathDate: current.oathDate,
            authority: current.authority,
            place: current.place ?? '',
            permittedVirtualMethod: current.permittedVirtualMethod ?? '',
            documentVersionId: current.evidence.documentVersionId,
            reason: '',
            authorityDocumentVersionId: '',
          }
        : defaultOathForm(),
    );
    setError('');
    setSuccess('');
    setDialog('oath-correction');
  }

  async function saveOath(): Promise<void> {
    if (!detail) return;
    const result = await command(
      `/api/v1/agencies/${props.agencyId}/appointments/${detail.id}/oaths`,
      {
        oathDate: oathForm.oathDate,
        administeredByMembershipId: props.membershipId,
        authority: oathForm.authority.trim(),
        ...(oathForm.place.trim() ? { place: oathForm.place.trim() } : {}),
        ...(oathForm.permittedVirtualMethod.trim()
          ? { permittedVirtualMethod: oathForm.permittedVirtualMethod.trim() }
          : {}),
        documentVersionId: oathForm.documentVersionId,
      },
    );
    if (result) {
      setDialog(null);
      setSuccess('The Oath of Office was recorded.');
    }
  }

  async function saveOathCorrection(): Promise<void> {
    if (!detail) return;
    const result = await command(
      `/api/v1/agencies/${props.agencyId}/appointments/${detail.id}/oaths/corrections`,
      {
        reason: oathForm.reason.trim(),
        authorityDocumentVersionId: oathForm.authorityDocumentVersionId,
        oathDate: oathForm.oathDate,
        administeredByMembershipId: props.membershipId,
        authority: oathForm.authority.trim(),
        ...(oathForm.place.trim() ? { place: oathForm.place.trim() } : {}),
        ...(oathForm.permittedVirtualMethod.trim()
          ? { permittedVirtualMethod: oathForm.permittedVirtualMethod.trim() }
          : {}),
        documentVersionId: oathForm.documentVersionId,
      },
    );
    if (result) {
      setDialog(null);
      setSuccess('A linked correction of the Oath of Office was recorded.');
    }
  }

  function openAssumption(): void {
    setAssumptionForm(defaultAssumptionForm());
    setError('');
    setSuccess('');
    setDialog('assumption');
  }

  function openAssumptionCorrection(): void {
    const current = assumption?.currentVersion ?? null;
    setAssumptionForm(
      current
        ? {
            actualAssumptionDate: current.actualAssumptionDate,
            certifyingAuthority: current.certifyingAuthority,
            certifiedAt: localDateTimeValue(new Date(current.certifiedAt)),
            documentVersionId: current.evidence.documentVersionId,
            reason: '',
            authorityDocumentVersionId: '',
          }
        : defaultAssumptionForm(),
    );
    setError('');
    setSuccess('');
    setDialog('assumption-correction');
  }

  async function saveAssumption(): Promise<void> {
    if (!detail || !oath?.currentVersion) return;
    const result = await command(
      `/api/v1/agencies/${props.agencyId}/appointments/${detail.id}/assumption`,
      {
        oathVersionId: oath.currentVersion.id,
        actualAssumptionDate: assumptionForm.actualAssumptionDate,
        certifiedByMembershipId: props.membershipId,
        certifyingAuthority: assumptionForm.certifyingAuthority.trim(),
        certifiedAt: toIsoDateTime(assumptionForm.certifiedAt),
        documentVersionId: assumptionForm.documentVersionId,
      },
    );
    if (result) {
      setDialog(null);
      setSuccess('The Assumption to Duty was certified and recorded.');
    }
  }

  async function saveAssumptionCorrection(): Promise<void> {
    if (!detail || !assumption?.currentVersion) return;
    const result = await command(
      `/api/v1/agencies/${props.agencyId}/appointments/${detail.id}/assumption/corrections`,
      {
        reason: assumptionForm.reason.trim(),
        authorityDocumentVersionId: assumptionForm.authorityDocumentVersionId,
        oathVersionId: assumption.currentVersion.oathVersionId,
        actualAssumptionDate: assumptionForm.actualAssumptionDate,
        certifiedByMembershipId: props.membershipId,
        certifyingAuthority: assumptionForm.certifyingAuthority.trim(),
        certifiedAt: toIsoDateTime(assumptionForm.certifiedAt),
        documentVersionId: assumptionForm.documentVersionId,
      },
    );
    if (result) {
      setDialog(null);
      setSuccess('A linked correction of the Assumption to Duty was recorded.');
    }
  }

  function openOutcome(dialogName: 'assumption-failure' | 'assumption-cancellation'): void {
    setOutcomeForm(defaultOutcomeForm());
    setError('');
    setSuccess('');
    setDialog(dialogName);
  }

  async function saveAssumptionFailure(): Promise<void> {
    if (!detail) return;
    const result = await command(
      `/api/v1/agencies/${props.agencyId}/appointments/${detail.id}/assumption/failure`,
      {
        noticeDate: outcomeForm.noticeDate,
        deadlineDate: outcomeForm.deadlineDate,
        outcomeDate: outcomeForm.outcomeDate,
        reason: outcomeForm.reason.trim(),
        authorizedByMembershipId: props.membershipId,
        authorityDocumentVersionId: outcomeForm.authorityDocumentVersionId,
        evidenceDocumentVersionId: outcomeForm.evidenceDocumentVersionId,
      },
    );
    if (result) {
      setDialog(null);
      setSuccess('The evidenced failure to assume was recorded and the reservation released.');
    }
  }

  async function saveAssumptionCancellation(): Promise<void> {
    if (!detail) return;
    const result = await command(
      `/api/v1/agencies/${props.agencyId}/appointments/${detail.id}/assumption/cancellation`,
      {
        outcomeDate: outcomeForm.outcomeDate,
        reason: outcomeForm.reason.trim(),
        authorizedByMembershipId: props.membershipId,
        authorityDocumentVersionId: outcomeForm.authorityDocumentVersionId,
        evidenceDocumentVersionId: outcomeForm.evidenceDocumentVersionId,
      },
    );
    if (result) {
      setDialog(null);
      setSuccess('The pre-assumption cancellation was recorded and the reservation released.');
    }
  }

  function openActivation(): void {
    setActivationForm(defaultActivationForm());
    setError('');
    setSuccess('');
    setDialog('activation');
  }

  async function saveActivation(): Promise<void> {
    if (!detail) return;
    const result = await command(
      `/api/v1/agencies/${props.agencyId}/appointments/${detail.id}/activation`,
      {
        employee: {
          employeeNumber: activationForm.employeeNumber.trim(),
          birthDate: activationForm.birthDate,
          sex: activationForm.sex,
          civilStatus: activationForm.civilStatus,
          contactEmail: activationForm.contactEmail.trim(),
        },
      },
    );
    if (result) {
      setDialog(null);
      setSuccess(
        'Employee service was activated, the reserved Plantilla item was occupied, and the recruitment case was closed.',
      );
    }
  }

  const canPrepare = props.canCreate && settings !== null;
  const correctionReady = reason.trim() !== '' && authorityDocumentVersionId !== '';
  const dialogSpec: Record<
    Exclude<Dialog, null>,
    { title: string; submit: string; ready: boolean; run: () => Promise<void> }
  > = {
    prepare: {
      title: 'Prepare Appointment',
      submit: 'Prepare Draft',
      ready: true,
      run: savePrepare,
    },
    update: { title: 'Update Draft version', submit: 'Save Draft', ready: true, run: saveUpdate },
    return: {
      title: 'Return for correction',
      submit: 'Return for correction',
      ready: reason.trim() !== '',
      run: saveReturn,
    },
    cancel: {
      title: 'Cancel Appointment',
      submit: 'Cancel Appointment',
      ready: correctionReady,
      run: saveCancel,
    },
    correct: {
      title: 'Prepare a linked correction',
      submit: 'Prepare correction Draft',
      ready: correctionReady,
      run: saveCorrect,
    },
    settings: {
      title: 'Agency appointment configuration',
      submit: 'Record configuration',
      ready: settingsForm.statusEvidenceDocumentVersionId !== '',
      run: saveSettings,
    },
    'external-submission': {
      title: 'Record CSC submission event',
      submit: 'Record submission event',
      ready:
        externalForm.appointmentVersionId !== '' &&
        externalForm.occurredAt !== '' &&
        externalForm.receivingOffice.trim() !== '' &&
        externalForm.evidenceDocumentVersionId !== '',
      run: saveExternalSubmission,
    },
    'external-action': {
      title: 'Record official CSC action',
      submit: 'Record official action',
      ready:
        externalForm.appointmentVersionId !== '' &&
        externalForm.action !== '' &&
        externalForm.occurredAt !== '' &&
        externalForm.externalReference.trim() !== '' &&
        externalForm.evidenceDocumentVersionId !== '',
      run: saveExternalAction,
    },
    receipt: {
      title: 'Record appointee acknowledgment of receipt',
      submit: 'Record acknowledgment',
      ready: receiptForm.acknowledgedAt !== '' && receiptForm.documentVersionId !== '',
      run: saveReceipt,
    },
    oath: {
      title: 'Record Oath of Office',
      submit: 'Record Oath',
      ready:
        oathForm.oathDate !== '' &&
        oathForm.authority.trim() !== '' &&
        oathForm.documentVersionId !== '',
      run: saveOath,
    },
    'oath-correction': {
      title: 'Correct the Oath of Office',
      submit: 'Record Oath correction',
      ready:
        oathForm.oathDate !== '' &&
        oathForm.authority.trim() !== '' &&
        oathForm.documentVersionId !== '' &&
        oathForm.reason.trim() !== '' &&
        oathForm.authorityDocumentVersionId !== '',
      run: saveOathCorrection,
    },
    assumption: {
      title: 'Certify Assumption to Duty',
      submit: 'Certify Assumption to Duty',
      ready:
        assumptionForm.actualAssumptionDate !== '' &&
        assumptionForm.certifyingAuthority.trim() !== '' &&
        assumptionForm.certifiedAt !== '' &&
        assumptionForm.documentVersionId !== '',
      run: saveAssumption,
    },
    'assumption-correction': {
      title: 'Correct the Assumption to Duty',
      submit: 'Record Assumption correction',
      ready:
        assumptionForm.actualAssumptionDate !== '' &&
        assumptionForm.certifyingAuthority.trim() !== '' &&
        assumptionForm.certifiedAt !== '' &&
        assumptionForm.documentVersionId !== '' &&
        assumptionForm.reason.trim() !== '' &&
        assumptionForm.authorityDocumentVersionId !== '',
      run: saveAssumptionCorrection,
    },
    'assumption-failure': {
      title: 'Record failure to assume',
      submit: 'Record failure to assume',
      ready:
        outcomeForm.noticeDate !== '' &&
        outcomeForm.deadlineDate !== '' &&
        outcomeForm.outcomeDate !== '' &&
        outcomeForm.reason.trim() !== '' &&
        outcomeForm.authorityDocumentVersionId !== '' &&
        outcomeForm.evidenceDocumentVersionId !== '',
      run: saveAssumptionFailure,
    },
    'assumption-cancellation': {
      title: 'Cancel before assumption',
      submit: 'Record cancellation',
      ready:
        outcomeForm.outcomeDate !== '' &&
        outcomeForm.reason.trim() !== '' &&
        outcomeForm.authorityDocumentVersionId !== '' &&
        outcomeForm.evidenceDocumentVersionId !== '',
      run: saveAssumptionCancellation,
    },
    activation: {
      title: 'Activate Employee service',
      submit: 'Activate service',
      ready:
        activationForm.employeeNumber.trim() !== '' &&
        activationForm.birthDate !== '' &&
        activationForm.contactEmail.trim() !== '',
      run: saveActivation,
    },
  };
  const activeDialog = dialog ? dialogSpec[dialog] : null;

  // The form sits outside the page region, so this remembers the page control that opened it.
  function rememberOpener(event: { target: EventTarget }): void {
    const button = (
      event.target as unknown as { closest(selector: string): Opener | null }
    ).closest('button');
    if (button) openerRef.current = button;
  }

  // Return focus to the opener, or to the record when the transition removed the opener.
  function restoreFocus(): void {
    const opener = openerRef.current;
    if (opener?.isConnected && !opener.disabled) opener.focus();
    else (detailRef.current as unknown as { focus(): void } | null)?.focus();
  }

  const workflowActions = detail ? (
    <>
      {detail.workflowStatus === 'DRAFT' && props.canCreate ? (
        <Button type="button" variant="secondary" onClick={openUpdate}>
          Update Draft
        </Button>
      ) : null}
      {detail.workflowStatus === 'DRAFT' && props.canSubmit ? (
        <Button type="button" variant="primary" disabled={busy} onClick={() => void submit()}>
          Submit for review
        </Button>
      ) : null}
      {detail.workflowStatus === 'FOR_REVIEW' && props.canReturn ? (
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={() => {
            setReason('');
            setError('');
            setSuccess('');
            setDialog('return');
          }}
        >
          Return for correction
        </Button>
      ) : null}
      {detail.workflowStatus === 'FOR_REVIEW' && props.canEndorse ? (
        <Button type="button" variant="primary" disabled={busy} onClick={() => void endorse()}>
          Endorse for signature
        </Button>
      ) : null}
      {detail.workflowStatus === 'FOR_SIGNATURE' && props.canIssue ? (
        <Button type="button" variant="primary" disabled={busy} onClick={() => void issue()}>
          Issue Appointment
        </Button>
      ) : null}
      {detail.workflowStatus === 'ISSUED' && props.canCreate ? (
        <Button type="button" variant="secondary" onClick={openCorrect}>
          Prepare linked correction
        </Button>
      ) : null}
      {(detail.workflowStatus === 'FOR_SIGNATURE' || detail.workflowStatus === 'ISSUED') &&
      props.canCancel ? (
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={() => {
            setReason('');
            setAuthorityDocumentVersionId('');
            setError('');
            setSuccess('');
            setDialog('cancel');
          }}
        >
          Cancel Appointment
        </Button>
      ) : null}
    </>
  ) : null;

  return (
    <div className="grid gap-5">
      <div className="grid gap-5" onClickCapture={rememberOpener}>
        <PageHeader
          breadcrumbs={[{ label: 'Merit selection' }]}
          title="Appointments"
          actions={
            props.canManageSettings ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setSettingsForm({
                    regulatoryStatus: settings?.regulatoryStatus ?? 'REGULATED',
                    statusEvidenceDocumentVersionId:
                      settings?.statusEvidenceDocumentVersionId ?? '',
                  });
                  setError('');
                  setSuccess('');
                  setDialog('settings');
                }}
              >
                Configure
              </Button>
            ) : null
          }
        />

        <p className="m-0 max-w-[80ch] text-small text-ink-muted">
          Prepare an Appointment from an immutable selected-candidate package, route it through
          review and signature, and retain every version and evidence link. Issuance alone neither
          occupies the Plantilla item nor activates Employee service.
        </p>

        {dialog ? null : <FormError message={error} />}
        {success ? (
          <p
            role="status"
            className="m-0 rounded-control border border-success/40 bg-success/5 px-3 py-2.5 text-small text-success"
          >
            {success}
          </p>
        ) : null}

        <Panel
          title="Eligible selections"
          flush
          actions={
            <span className="text-caption text-ink-muted">
              {settings
                ? `${settings.regulatoryStatus} · ${settings.formVariant}`
                : 'No Agency configuration recorded'}
            </span>
          }
        >
          <div className="grid gap-3 px-4 pt-3">
            <p className={noteClass}>
              Handed-off Selection Decisions available for preparation. The reservation, evidence,
              and configuration contract are revalidated when the Draft is saved.
            </p>
            {settings === null ? (
              <p className="m-0 rounded-control border border-warning/40 bg-warning/5 px-3 py-2.5 text-small text-warning">
                Agency appointment configuration is missing. Record the evidenced regulatory status
                before preparing an Appointment.
              </p>
            ) : null}
          </div>
          {selections.length === 0 ? (
            <StateSurface compact label="No eligible selections">
              <p className="m-0">No handed-off Selection Decisions are waiting for preparation.</p>
            </StateSurface>
          ) : (
            <Table className="mt-3 min-w-[760px]">
              <thead>
                <tr>
                  <Th>Applicant</Th>
                  <Th>Plantilla item</Th>
                  <Th kind="date">Handed off</Th>
                  <Th>Appointment</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {selections.map((selection) => (
                  <Tr key={selection.handoffId}>
                    <RowHeader>
                      {selection.applicant.fullName}
                      <span className="block text-caption font-normal text-ink-muted">
                        {selection.applicant.applicationNo}
                      </span>
                    </RowHeader>
                    <Td>
                      {selection.position.itemNumber} · SG {selection.position.salaryGrade ?? '—'}
                      <span className="block text-caption text-ink-muted">
                        {selection.position.title ?? 'Untitled item'}
                      </span>
                    </Td>
                    <Td kind="date">{dateTimeLabel(selection.handedOffAt)}</Td>
                    <Td>
                      {selection.appointment ? (
                        <StatusBadge status={selection.appointment.workflowStatus} />
                      ) : (
                        <span className="text-caption text-ink-muted">Awaiting preparation</span>
                      )}
                    </Td>
                    <Td className="text-right">
                      {selection.appointment ? (
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => select(selection.appointment!.id)}
                        >
                          Open Appointment
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="primary"
                          disabled={!canPrepare}
                          onClick={() => openPrepare(selection)}
                        >
                          Prepare Appointment
                        </Button>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
          {selectionsHasMore ? (
            <p className={`${noteClass} px-4 py-2.5`}>
              Only the most recent handed-off Selection Decisions are shown. Prepare or cancel an
              Appointment to reduce the list.
            </p>
          ) : null}
        </Panel>

        <Panel title="Appointment register" flush>
          <p className={`${noteClass} px-4 pt-3`}>
            Every prepared Appointment with its current workflow status.
          </p>
          {appointments.length === 0 ? (
            <StateSurface compact label="No Appointments">
              <p className="m-0">No Appointments prepared yet.</p>
            </StateSurface>
          ) : (
            <Table className="mt-3 min-w-[640px]">
              <thead>
                <tr>
                  <Th>Appointee</Th>
                  <Th>Plantilla item</Th>
                  <Th>Workflow</Th>
                  <Th>CSC standing</Th>
                </tr>
              </thead>
              <tbody>
                {appointments.map((appointment) => (
                  <Tr key={appointment.id} selected={selectedId === appointment.id}>
                    <RowHeader>
                      <button
                        className="w-fit cursor-pointer border-0 bg-transparent p-0 text-left font-[600] text-primary hover:underline"
                        type="button"
                        onClick={() => select(appointment.id)}
                      >
                        {appointment.appointee.fullName}
                      </button>
                      <span className="block text-caption font-normal text-ink-muted">
                        {appointment.appointee.applicationNo}
                      </span>
                    </RowHeader>
                    <Td>
                      {appointment.position.itemNumber}
                      <span className="block text-caption text-ink-muted">
                        {appointment.position.title ?? 'Untitled item'}
                      </span>
                    </Td>
                    <Td>
                      <StatusBadge status={appointment.workflowStatus} />
                    </Td>
                    <Td>
                      <StatusBadge status={appointment.externalStanding} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>

        {selected && detail ? (
          <Panel
            ref={detailRef}
            tabIndex={-1}
            title={detail.appointee.fullName}
            actions={workflowActions}
          >
            <div className="grid gap-5">
              <div className="grid gap-3">
                <p className="m-0 text-small text-ink-muted">
                  {detail.position.itemNumber} · {detail.position.title ?? 'Untitled item'}
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <span aria-label="Workflow status">
                    <StatusBadge status={detail.workflowStatus} />
                  </span>
                  <span aria-label="External standing">
                    <StatusBadge status={detail.externalStanding} />
                  </span>
                  <span className="text-small text-ink-muted">
                    {currentVersion
                      ? `Current version v${currentVersion.versionNo} · ${label(currentVersion.status)}`
                      : 'No version recorded'}
                  </span>
                  {detail.issuedAt ? (
                    <span className="text-small text-ink-muted">
                      Issued {dateTimeLabel(detail.issuedAt)}
                    </span>
                  ) : null}
                </div>
              </div>

              <dl className={factsClass}>
                <DetailRow label="Selected Application">
                  {detail.appointee.applicationNo} · {detail.appointee.personKey}
                </DetailRow>
                <DetailRow label="Recruitment handoff">{detail.recruitmentHandoffId}</DetailRow>
                <DetailRow label="Agency form path">
                  {detail.settings
                    ? `${detail.settings.regulatoryStatus} · ${detail.settings.formVariant}`
                    : 'Agency configuration missing'}
                </DetailRow>
                <DetailRow label="Reserved Plantilla Position">
                  {detail.position.itemNumber} · SG {detail.position.salaryGrade ?? '—'}
                </DetailRow>
              </dl>

              <SectionTabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
                <div className="border-b border-border">
                  <SectionTabList
                    label="Appointment sections"
                    tabs={[
                      { value: 'preparation', label: 'Preparation & evidence' },
                      { value: 'review', label: 'Review & issuance' },
                      { value: 'oath', label: 'Oath & assumption' },
                      { value: 'csc', label: 'CSC transactions' },
                    ]}
                  />
                </div>

                <SectionTabPanel value="preparation" className="grid gap-4 pt-5">
                  <h3 className={sectionTitleClass}>Exact evidence versions</h3>
                  {detail.versions.map((version) => (
                    <section
                      aria-label={`Version v${version.versionNo}`}
                      className="grid gap-4 rounded-control border border-border p-4"
                      key={version.id}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <strong className="text-body font-[650] text-ink">
                          Version v{version.versionNo}
                          {version.replacesVersionId ? ' · linked correction' : ''}
                        </strong>
                        <StatusBadge status={version.status} />
                      </div>
                      <dl className={factsClass}>
                        <DetailRow label="Employment status">
                          {label(version.employmentStatus)}
                        </DetailRow>
                        <DetailRow label="Nature">{label(version.natureOfAppointment)}</DetailRow>
                        <DetailRow label="Salary">
                          SG {version.salaryGrade} step {version.salaryStep}
                        </DetailRow>
                        <DetailRow label="Effectivity">
                          {dateLabel(version.effectivityDate)}
                        </DetailRow>
                        <DetailRow label="Signature">{label(version.signatureMethod)}</DetailRow>
                        <DetailRow label="Appointment form">
                          {version.appointmentDocumentVersionId}
                        </DetailRow>
                        {version.correctionReason ? (
                          <DetailRow label="Correction reason">
                            {version.correctionReason}
                          </DetailRow>
                        ) : null}
                      </dl>
                      {version.evidence.length === 0 ? (
                        <p className={noteClass}>No evidence links recorded.</p>
                      ) : (
                        <HistoryTable label="Evidence links">
                          <thead>
                            <tr>
                              <Th>Evidence role</Th>
                              <Th>Document</Th>
                              <Th kind="numeric">Version</Th>
                              <Th kind="date">Issued</Th>
                            </tr>
                          </thead>
                          <tbody>
                            {version.evidence.map((entry) => (
                              <Tr key={entry.id}>
                                <Td className="font-[600] text-ink">{label(entry.linkRole)}</Td>
                                <Td>{entry.documentNo ?? entry.documentType}</Td>
                                <Td kind="numeric">v{entry.versionNo}</Td>
                                <Td kind="date">{dateLabel(entry.issuedAt)}</Td>
                              </Tr>
                            ))}
                          </tbody>
                        </HistoryTable>
                      )}
                    </section>
                  ))}
                </SectionTabPanel>

                <SectionTabPanel value="review" className="grid gap-4 pt-5">
                  <RecordSection title="Preparation, review and signature">
                    {detail.history.length === 0 ? (
                      <p className={noteClass}>No review history recorded.</p>
                    ) : (
                      <HistoryTable label="Review history">
                        <thead>
                          <tr>
                            <Th>Action</Th>
                            <Th>Resulting status</Th>
                            <Th kind="date">Recorded</Th>
                            <Th>Reason</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.history.map((entry) => (
                            <Tr key={entry.id}>
                              <Td className="font-[600] text-ink">{label(entry.action)}</Td>
                              <Td>{entry.newStatus ? label(entry.newStatus) : '—'}</Td>
                              <Td kind="date">{dateTimeLabel(entry.occurredAt)}</Td>
                              <Td className="text-ink-muted">{entry.reason ?? '—'}</Td>
                            </Tr>
                          ))}
                        </tbody>
                      </HistoryTable>
                    )}
                  </RecordSection>
                  <p className={noteClass}>
                    Issued corrections require a linked successor with its own reason, authority and
                    evidence. Issuance alone creates no Employee service and leaves the Plantilla
                    reservation in place.
                  </p>
                </SectionTabPanel>

                <SectionTabPanel value="oath" className="grid gap-5 pt-5">
                  <div className="grid gap-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-small text-ink-muted">Assumption to Duty</span>
                      <span aria-label="Assumption status">
                        <StatusBadge
                          status={
                            assumption?.status ??
                            (acknowledgment || oath ? 'PENDING' : 'NOT_RECORDED')
                          }
                        />
                      </span>
                    </div>
                    <p className={noteClass}>
                      Receipt, Oath and Assumption bind to this exact issued version. Certification
                      is complete without CSC action, and a correction is refused once service has
                      been activated from the assumption.
                    </p>
                  </div>
                  {detail.workflowStatus !== 'ISSUED' ? (
                    <StateSurface compact label="Oath and assumption not open">
                      <p className="m-0">
                        Oath and Assumption open once an Appointment Version is issued.
                      </p>
                    </StateSurface>
                  ) : (
                    <>
                      <dl className={factsClass}>
                        <DetailRow label="Acknowledged receipt">
                          {acknowledgment
                            ? `${dateTimeLabel(acknowledgment.acknowledgedAt)} · ${evidenceLabel(acknowledgment.evidence)}`
                            : 'Not recorded'}
                        </DetailRow>
                        <DetailRow label="Oath">
                          {oath?.currentVersion
                            ? `${dateLabel(oath.currentVersion.oathDate)} · ${oath.currentVersion.authority} · v${oath.currentVersion.versionNo}`
                            : 'Not recorded'}
                        </DetailRow>
                        <DetailRow label="Actual assumption">
                          {assumption?.currentVersion
                            ? `${dateLabel(assumption.currentVersion.actualAssumptionDate)} · certified by ${assumption.currentVersion.certifyingAuthority}`
                            : 'Not recorded'}
                        </DetailRow>
                        <DetailRow label="Recorded outcome">
                          {assumption?.outcome
                            ? `${label(assumption.outcome.outcome)} · ${dateLabel(assumption.outcome.outcomeDate)}`
                            : 'None recorded'}
                        </DetailRow>
                      </dl>
                      <div className="flex flex-wrap gap-2">
                        {!acknowledgment && props.canRecordReceipt ? (
                          <Button
                            type="button"
                            variant="primary"
                            disabled={busy}
                            onClick={openReceipt}
                          >
                            Record acknowledgment
                          </Button>
                        ) : null}
                        {acknowledgment && !oath && props.canRecordOath ? (
                          <Button
                            type="button"
                            variant="primary"
                            disabled={busy}
                            onClick={() => openOath()}
                          >
                            Record Oath
                          </Button>
                        ) : null}
                        {oath && assumptionPending && props.canRecordOath ? (
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={busy}
                            onClick={() => openOathCorrection()}
                          >
                            Correct Oath
                          </Button>
                        ) : null}
                        {oath &&
                        assumptionPending &&
                        !assumption?.currentVersion &&
                        props.canCertifyAssumption ? (
                          <Button
                            type="button"
                            variant="primary"
                            disabled={busy}
                            onClick={() => openAssumption()}
                          >
                            Certify Assumption to Duty
                          </Button>
                        ) : null}
                        {assumption?.status === 'ASSUMED' && props.canCorrectAssumption ? (
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={busy}
                            onClick={() => openAssumptionCorrection()}
                          >
                            Correct Assumption to Duty
                          </Button>
                        ) : null}
                        {assumptionPending && props.canFailAssumption ? (
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={busy}
                            onClick={() => openOutcome('assumption-failure')}
                          >
                            Record failure to assume
                          </Button>
                        ) : null}
                        {assumptionPending && props.canCancelAssumption ? (
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={busy}
                            onClick={() => openOutcome('assumption-cancellation')}
                          >
                            Cancel before assumption
                          </Button>
                        ) : null}
                      </div>
                      {oath && oath.versions.length > 0 ? (
                        <RecordSection title="Oath history">
                          <HistoryTable label="Oath history">
                            <thead>
                              <tr>
                                <Th>Version</Th>
                                <Th kind="date">Oath date</Th>
                                <Th>Authority</Th>
                                <Th>Place or method</Th>
                                <Th>Evidence</Th>
                                <Th>Correction reason</Th>
                              </tr>
                            </thead>
                            <tbody>
                              {oath.versions.map((entry) => (
                                <Tr key={entry.id}>
                                  <Td className="font-[600] whitespace-nowrap text-ink">
                                    v{entry.versionNo}
                                    {entry.replacesOathVersionId ? ' · corrected' : ''}
                                  </Td>
                                  <Td kind="date">{dateLabel(entry.oathDate)}</Td>
                                  <Td>{entry.authority}</Td>
                                  <Td>
                                    {[entry.place, entry.permittedVirtualMethod]
                                      .filter(Boolean)
                                      .join(' · ') || '—'}
                                  </Td>
                                  <Td>{evidenceLabel(entry.evidence)}</Td>
                                  <Td className="text-ink-muted">
                                    {entry.correctionReason ?? '—'}
                                  </Td>
                                </Tr>
                              ))}
                            </tbody>
                          </HistoryTable>
                        </RecordSection>
                      ) : null}
                      {assumption && assumption.versions.length > 0 ? (
                        <RecordSection title="Assumption history">
                          <HistoryTable label="Assumption history">
                            <thead>
                              <tr>
                                <Th>Version</Th>
                                <Th kind="date">Actual assumption</Th>
                                <Th>Certifying authority</Th>
                                <Th kind="date">Certified</Th>
                                <Th>Evidence</Th>
                                <Th>Correction reason</Th>
                              </tr>
                            </thead>
                            <tbody>
                              {assumption.versions.map((entry) => (
                                <Tr key={entry.id}>
                                  <Td className="font-[600] whitespace-nowrap text-ink">
                                    v{entry.versionNo}
                                    {entry.replacesAssumptionVersionId ? ' · corrected' : ''}
                                  </Td>
                                  <Td kind="date">{dateLabel(entry.actualAssumptionDate)}</Td>
                                  <Td>{entry.certifyingAuthority}</Td>
                                  <Td kind="date">{dateTimeLabel(entry.certifiedAt)}</Td>
                                  <Td>{evidenceLabel(entry.evidence)}</Td>
                                  <Td className="text-ink-muted">
                                    {entry.correctionReason ?? '—'}
                                  </Td>
                                </Tr>
                              ))}
                            </tbody>
                          </HistoryTable>
                        </RecordSection>
                      ) : null}
                      {assumption?.outcome ? (
                        <RecordSection title={label(assumption.outcome.outcome)}>
                          <p className="m-0 text-small text-ink-muted">
                            {dateLabel(assumption.outcome.outcomeDate)}
                            {assumption.outcome.noticeDate
                              ? ` · notice ${dateLabel(assumption.outcome.noticeDate)}`
                              : ''}
                            {assumption.outcome.deadlineDate
                              ? ` · deadline ${dateLabel(assumption.outcome.deadlineDate)}`
                              : ''}
                            {` · ${assumption.outcome.reason}`}
                          </p>
                        </RecordSection>
                      ) : null}
                      <div className="rounded-control border border-border p-4">
                        <RecordSection
                          title="Employee service activation"
                          actions={
                            <StatusBadge
                              status={
                                activation
                                  ? 'ACTIVE'
                                  : assumption?.status === 'ASSUMED'
                                    ? 'READY'
                                    : 'PENDING'
                              }
                            />
                          }
                        >
                          <p className={noteClass}>
                            Activation runs only from the assumed Appointment Contract. Personnel
                            creates the Employee and initial Service Segment, Plantilla occupies the
                            reserved item and records the Position Incumbency, and Recruitment
                            closes the selected Application, Vacancy Publication, and Request to
                            Fill in one transaction.
                          </p>
                          {activation ? (
                            <dl className={factsClass}>
                              <DetailRow label="Employee">
                                {activation.legalName} · {activation.employeeNumber}
                              </DetailRow>
                              <DetailRow label="Service effective from">
                                {dateLabel(activation.effectiveFrom)}
                              </DetailRow>
                              <DetailRow label="Appointment status">
                                {label(activation.appointmentStatus)}
                              </DetailRow>
                              <DetailRow label="Service Segment">
                                {activation.serviceSegmentId}
                              </DetailRow>
                            </dl>
                          ) : null}
                          {!activation &&
                          assumption?.status === 'ASSUMED' &&
                          props.canActivateService ? (
                            <span>
                              <Button
                                type="button"
                                variant="primary"
                                disabled={busy}
                                onClick={openActivation}
                              >
                                Activate service
                              </Button>
                            </span>
                          ) : null}
                          {!activation && assumption?.status !== 'ASSUMED' ? (
                            <p className={noteClass}>
                              Activation opens once the Assumption to Duty is certified for the
                              current issued version.
                            </p>
                          ) : null}
                        </RecordSection>
                      </div>
                    </>
                  )}
                </SectionTabPanel>

                <SectionTabPanel value="csc" className="grid gap-5 pt-5">
                  <div className="grid gap-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-small text-ink-muted">External standing</span>
                      <span aria-label="External standing">
                        <StatusBadge status={detail.externalStanding} />
                      </span>
                    </div>
                    <p className={noteClass}>
                      Submission and official action events are append-only and bind to an exact
                      issued version. They never change the workflow status, employment status,
                      nature of appointment, or the issued instrument.
                    </p>
                  </div>
                  {issuedVersions.length === 0 ? (
                    <StateSurface compact label="CSC tracking not open">
                      <p className="m-0">
                        External tracking opens once an Appointment Version is issued.
                      </p>
                    </StateSurface>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {props.canRecordExternalEvents ? (
                        <Button
                          type="button"
                          variant="primary"
                          disabled={busy || detail.settings === null}
                          onClick={() => openExternal('external-submission')}
                        >
                          Record submission event
                        </Button>
                      ) : null}
                      {props.canRecordExternalActions ? (
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={busy || detail.settings === null}
                          onClick={() => openExternal('external-action')}
                        >
                          Record official action
                        </Button>
                      ) : null}
                    </div>
                  )}
                  <RecordSection title="Submission history">
                    {detail.externalSubmissions.length === 0 ? (
                      <p className={noteClass}>No submission events recorded.</p>
                    ) : (
                      <HistoryTable label="Submission history">
                        <thead>
                          <tr>
                            <Th>Event</Th>
                            <Th kind="date">Occurred</Th>
                            <Th>Reference</Th>
                            <Th>Receiving office</Th>
                            <Th>Evidence</Th>
                            <Th>Reason</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.externalSubmissions.map((entry) => (
                            <Tr key={entry.id}>
                              <Td className="font-[600] text-ink">{label(entry.eventType)}</Td>
                              <Td kind="date">{dateTimeLabel(entry.occurredAt)}</Td>
                              <Td>{entry.externalReference ?? '—'}</Td>
                              <Td>{entry.receivingOffice}</Td>
                              <Td>{evidenceLabel(entry.evidence)}</Td>
                              <Td className="text-ink-muted">{entry.reason ?? '—'}</Td>
                            </Tr>
                          ))}
                        </tbody>
                      </HistoryTable>
                    )}
                  </RecordSection>
                  <RecordSection title="Official action history">
                    {detail.externalActions.length === 0 ? (
                      <p className={noteClass}>No official actions recorded.</p>
                    ) : (
                      <HistoryTable label="Official action history">
                        <thead>
                          <tr>
                            <Th>Action</Th>
                            <Th kind="date">Action at</Th>
                            <Th>Reference</Th>
                            <Th>Evidence</Th>
                            <Th>Reason</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.externalActions.map((entry) => (
                            <Tr key={entry.id}>
                              <Td className="font-[600] text-ink">{label(entry.action)}</Td>
                              <Td kind="date">{dateTimeLabel(entry.actionAt)}</Td>
                              <Td>{entry.externalReference}</Td>
                              <Td>{evidenceLabel(entry.evidence)}</Td>
                              <Td className="text-ink-muted">{entry.reason ?? '—'}</Td>
                            </Tr>
                          ))}
                        </tbody>
                      </HistoryTable>
                    )}
                  </RecordSection>
                </SectionTabPanel>
              </SectionTabs>
            </div>
          </Panel>
        ) : selected ? (
          <Panel title={selected.appointee.fullName} flush>
            {failedDetailId === selected.id ? (
              <StateSurface compact label="Appointment record unavailable">
                <StateCode>Unavailable</StateCode>
                <p className="m-0">
                  The Appointment record could not be loaded. Refresh the page to try again.
                </p>
              </StateSurface>
            ) : (
              <StateSurface compact busy label="Loading the Appointment record">
                <p className="m-0">Loading the Appointment record…</p>
              </StateSurface>
            )}
          </Panel>
        ) : null}
      </div>

      <FormDialog
        presentation="form"
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setDialog(null);
        }}
      >
        <DialogContent onCloseAutoFocus={restoreFocus}>
          <DialogHeader>
            <DialogTitle>{activeDialog?.title}</DialogTitle>
          </DialogHeader>
          <DialogBody className="grid gap-5">
            <FormError message={error} />
            {(dialog === 'prepare' || dialog === 'update' || dialog === 'correct') && (
              <VersionFields
                form={form}
                setForm={setForm}
                documents={props.documents}
                authorityLabel={props.displayName}
                idPrefix={dialog}
              />
            )}

            {(dialog === 'return' || dialog === 'cancel' || dialog === 'correct') && (
              <Field label="Reason" htmlFor={`${dialog}-reason`}>
                <textarea
                  className={`${inputClass} min-h-20 py-2`}
                  id={`${dialog}-reason`}
                  value={reason}
                  onChange={(event) => setReason(inputValue(event))}
                />
              </Field>
            )}

            {(dialog === 'cancel' || dialog === 'correct') && (
              <Field
                label="Authority evidence (finalized Document Version)"
                htmlFor={`${dialog}-authority`}
              >
                <select
                  className={inputClass}
                  id={`${dialog}-authority`}
                  value={authorityDocumentVersionId}
                  onChange={(event) => setAuthorityDocumentVersionId(inputValue(event))}
                >
                  <option value="">
                    {dialog === 'cancel'
                      ? 'Select the cancellation authority'
                      : 'Select the correction authority'}
                  </option>
                  {props.documents.map((document) => (
                    <option key={document.version.id} value={document.version.id}>
                      {documentOptionLabel(document)}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {dialog === 'settings' ? (
              <div className="grid gap-5 min-[621px]:grid-cols-2">
                <Field label="Regulatory status" htmlFor="settings-status">
                  <select
                    className={inputClass}
                    id="settings-status"
                    value={settingsForm.regulatoryStatus}
                    onChange={(event) =>
                      setSettingsForm({
                        ...settingsForm,
                        regulatoryStatus: inputValue(event) as RegulatoryStatus,
                      })
                    }
                  >
                    <option value="REGULATED">REGULATED</option>
                    <option value="ACCREDITED_OR_DEREGULATED">ACCREDITED OR DEREGULATED</option>
                  </select>
                </Field>
                <Field
                  label="Status evidence (finalized Document Version)"
                  htmlFor="settings-evidence"
                >
                  <select
                    className={inputClass}
                    id="settings-evidence"
                    value={settingsForm.statusEvidenceDocumentVersionId}
                    onChange={(event) =>
                      setSettingsForm({
                        ...settingsForm,
                        statusEvidenceDocumentVersionId: inputValue(event),
                      })
                    }
                  >
                    <option value="">Select the regulatory status evidence</option>
                    {props.documents.map((document) => (
                      <option key={document.version.id} value={document.version.id}>
                        {documentOptionLabel(document)}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            ) : null}

            {dialog === 'external-submission' || dialog === 'external-action' ? (
              <div className="grid gap-4">
                <div className="grid gap-5 min-[621px]:grid-cols-2">
                  <Field label="Issued version" htmlFor={`${dialog}-version`}>
                    <select
                      className={inputClass}
                      id={`${dialog}-version`}
                      value={externalForm.appointmentVersionId}
                      onChange={(event) =>
                        setExternalForm({
                          ...externalForm,
                          appointmentVersionId: inputValue(event),
                        })
                      }
                    >
                      {issuedVersions.map((version) => (
                        <option key={version.id} value={version.id}>
                          Version v{version.versionNo} · issued {dateLabel(version.issuedAt)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {dialog === 'external-submission' ? (
                    <Field label="Submission event" htmlFor="external-event">
                      <select
                        className={inputClass}
                        id="external-event"
                        value={externalForm.eventType}
                        onChange={(event) =>
                          setExternalForm({ ...externalForm, eventType: inputValue(event) })
                        }
                      >
                        {EXTERNAL_SUBMISSION_TYPES.map((eventType) => (
                          <option key={eventType} value={eventType}>
                            {label(eventType)}
                          </option>
                        ))}
                      </select>
                    </Field>
                  ) : (
                    <Field label="Official action" htmlFor="external-action">
                      <select
                        className={inputClass}
                        id="external-action"
                        value={externalForm.action}
                        onChange={(event) =>
                          setExternalForm({ ...externalForm, action: inputValue(event) })
                        }
                      >
                        {externalActionsFor(externalRegulatoryStatus).map((action) => (
                          <option key={action} value={action}>
                            {label(action)}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                  <Field
                    label={
                      dialog === 'external-submission'
                        ? 'External reference (optional)'
                        : 'External reference'
                    }
                    htmlFor="external-reference"
                  >
                    <input
                      className={inputClass}
                      id="external-reference"
                      value={externalForm.externalReference}
                      onChange={(event) =>
                        setExternalForm({ ...externalForm, externalReference: inputValue(event) })
                      }
                    />
                  </Field>
                  <Field
                    label={dialog === 'external-submission' ? 'Occurred at' : 'Action at'}
                    htmlFor="external-occurred"
                  >
                    <input
                      className={inputClass}
                      id="external-occurred"
                      type="datetime-local"
                      value={externalForm.occurredAt}
                      onChange={(event) =>
                        setExternalForm({ ...externalForm, occurredAt: inputValue(event) })
                      }
                    />
                  </Field>
                  {dialog === 'external-submission' ? (
                    <Field label="Receiving office" htmlFor="external-office">
                      <input
                        className={inputClass}
                        id="external-office"
                        value={externalForm.receivingOffice}
                        onChange={(event) =>
                          setExternalForm({ ...externalForm, receivingOffice: inputValue(event) })
                        }
                      />
                    </Field>
                  ) : null}
                </div>
                <Field
                  label="Exact evidence (finalized Document Version)"
                  htmlFor="external-evidence"
                >
                  <select
                    className={inputClass}
                    id="external-evidence"
                    value={externalForm.evidenceDocumentVersionId}
                    onChange={(event) =>
                      setExternalForm({
                        ...externalForm,
                        evidenceDocumentVersionId: inputValue(event),
                      })
                    }
                  >
                    <option value="">Select the exact evidence version</option>
                    {props.documents.map((document) => (
                      <option key={document.version.id} value={document.version.id}>
                        {documentOptionLabel(document)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Reason (optional)" htmlFor="external-reason">
                  <textarea
                    className={`${inputClass} min-h-20 py-2`}
                    id="external-reason"
                    value={externalForm.reason}
                    onChange={(event) =>
                      setExternalForm({ ...externalForm, reason: inputValue(event) })
                    }
                  />
                </Field>
              </div>
            ) : null}

            {dialog === 'receipt' ? (
              <div className="grid gap-5 min-[621px]:grid-cols-2">
                <Field label="Acknowledged at" htmlFor="receipt-acknowledged">
                  <input
                    className={inputClass}
                    id="receipt-acknowledged"
                    type="datetime-local"
                    value={receiptForm.acknowledgedAt}
                    onChange={(event) =>
                      setReceiptForm({ ...receiptForm, acknowledgedAt: inputValue(event) })
                    }
                  />
                </Field>
                <Field
                  label="Exact evidence (finalized Document Version)"
                  htmlFor="receipt-evidence"
                >
                  <select
                    className={inputClass}
                    id="receipt-evidence"
                    value={receiptForm.documentVersionId}
                    onChange={(event) =>
                      setReceiptForm({ ...receiptForm, documentVersionId: inputValue(event) })
                    }
                  >
                    <option value="">Select the acknowledgment evidence</option>
                    {props.documents.map((document) => (
                      <option key={document.version.id} value={document.version.id}>
                        {documentOptionLabel(document)}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            ) : null}

            {dialog === 'oath' || dialog === 'oath-correction' ? (
              <div className="grid gap-4">
                <div className="grid gap-5 min-[621px]:grid-cols-2">
                  <Field label="Oath date" htmlFor="oath-date">
                    <input
                      className={inputClass}
                      id="oath-date"
                      type="date"
                      value={oathForm.oathDate}
                      onChange={(event) =>
                        setOathForm({ ...oathForm, oathDate: inputValue(event) })
                      }
                    />
                  </Field>
                  <Field label="Administered by" htmlFor="oath-administered-by">
                    <input
                      className={inputClass}
                      id="oath-administered-by"
                      value={props.displayName}
                      readOnly
                    />
                  </Field>
                  <Field label="Authority" htmlFor="oath-authority">
                    <input
                      className={inputClass}
                      id="oath-authority"
                      placeholder="e.g., City Mayor"
                      value={oathForm.authority}
                      onChange={(event) =>
                        setOathForm({ ...oathForm, authority: inputValue(event) })
                      }
                    />
                  </Field>
                  <Field label="Place (optional)" htmlFor="oath-place">
                    <input
                      className={inputClass}
                      id="oath-place"
                      value={oathForm.place}
                      onChange={(event) => setOathForm({ ...oathForm, place: inputValue(event) })}
                    />
                  </Field>
                  <Field label="Permitted virtual method (optional)" htmlFor="oath-method">
                    <input
                      className={inputClass}
                      id="oath-method"
                      value={oathForm.permittedVirtualMethod}
                      onChange={(event) =>
                        setOathForm({ ...oathForm, permittedVirtualMethod: inputValue(event) })
                      }
                    />
                  </Field>
                  <Field
                    label="Exact evidence (finalized Document Version)"
                    htmlFor="oath-evidence"
                  >
                    <select
                      className={inputClass}
                      id="oath-evidence"
                      value={oathForm.documentVersionId}
                      onChange={(event) =>
                        setOathForm({ ...oathForm, documentVersionId: inputValue(event) })
                      }
                    >
                      <option value="">Select the oath evidence</option>
                      {props.documents.map((document) => (
                        <option key={document.version.id} value={document.version.id}>
                          {documentOptionLabel(document)}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                {dialog === 'oath-correction' ? (
                  <>
                    <Field label="Reason" htmlFor="oath-correction-reason">
                      <textarea
                        className={`${inputClass} min-h-20 py-2`}
                        id="oath-correction-reason"
                        value={oathForm.reason}
                        onChange={(event) =>
                          setOathForm({ ...oathForm, reason: inputValue(event) })
                        }
                      />
                    </Field>
                    <Field
                      label="Authority evidence (finalized Document Version)"
                      htmlFor="oath-correction-authority"
                    >
                      <select
                        className={inputClass}
                        id="oath-correction-authority"
                        value={oathForm.authorityDocumentVersionId}
                        onChange={(event) =>
                          setOathForm({
                            ...oathForm,
                            authorityDocumentVersionId: inputValue(event),
                          })
                        }
                      >
                        <option value="">Select the correction authority</option>
                        {props.documents.map((document) => (
                          <option key={document.version.id} value={document.version.id}>
                            {documentOptionLabel(document)}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </>
                ) : null}
              </div>
            ) : null}

            {dialog === 'assumption' || dialog === 'assumption-correction' ? (
              <div className="grid gap-4">
                <div className="grid gap-5 min-[621px]:grid-cols-2">
                  <Field label="Actual assumption date" htmlFor="assumption-date">
                    <input
                      className={inputClass}
                      id="assumption-date"
                      type="date"
                      value={assumptionForm.actualAssumptionDate}
                      onChange={(event) =>
                        setAssumptionForm({
                          ...assumptionForm,
                          actualAssumptionDate: inputValue(event),
                        })
                      }
                    />
                  </Field>
                  <Field label="Certified by" htmlFor="assumption-certified-by">
                    <input
                      className={inputClass}
                      id="assumption-certified-by"
                      value={props.displayName}
                      readOnly
                    />
                  </Field>
                  <Field label="Certifying authority" htmlFor="assumption-authority">
                    <input
                      className={inputClass}
                      id="assumption-authority"
                      value={assumptionForm.certifyingAuthority}
                      onChange={(event) =>
                        setAssumptionForm({
                          ...assumptionForm,
                          certifyingAuthority: inputValue(event),
                        })
                      }
                    />
                  </Field>
                  <Field label="Certified at" htmlFor="assumption-certified-at">
                    <input
                      className={inputClass}
                      id="assumption-certified-at"
                      type="datetime-local"
                      value={assumptionForm.certifiedAt}
                      onChange={(event) =>
                        setAssumptionForm({ ...assumptionForm, certifiedAt: inputValue(event) })
                      }
                    />
                  </Field>
                  <Field
                    label="Exact evidence (finalized Document Version)"
                    htmlFor="assumption-evidence"
                  >
                    <select
                      className={inputClass}
                      id="assumption-evidence"
                      value={assumptionForm.documentVersionId}
                      onChange={(event) =>
                        setAssumptionForm({
                          ...assumptionForm,
                          documentVersionId: inputValue(event),
                        })
                      }
                    >
                      <option value="">Select the certification evidence</option>
                      {props.documents.map((document) => (
                        <option key={document.version.id} value={document.version.id}>
                          {documentOptionLabel(document)}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                {dialog === 'assumption-correction' ? (
                  <>
                    <Field label="Reason" htmlFor="assumption-correction-reason">
                      <textarea
                        className={`${inputClass} min-h-20 py-2`}
                        id="assumption-correction-reason"
                        value={assumptionForm.reason}
                        onChange={(event) =>
                          setAssumptionForm({ ...assumptionForm, reason: inputValue(event) })
                        }
                      />
                    </Field>
                    <Field
                      label="Authority evidence (finalized Document Version)"
                      htmlFor="assumption-correction-authority"
                    >
                      <select
                        className={inputClass}
                        id="assumption-correction-authority"
                        value={assumptionForm.authorityDocumentVersionId}
                        onChange={(event) =>
                          setAssumptionForm({
                            ...assumptionForm,
                            authorityDocumentVersionId: inputValue(event),
                          })
                        }
                      >
                        <option value="">Select the correction authority</option>
                        {props.documents.map((document) => (
                          <option key={document.version.id} value={document.version.id}>
                            {documentOptionLabel(document)}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </>
                ) : null}
              </div>
            ) : null}

            {dialog === 'assumption-failure' || dialog === 'assumption-cancellation' ? (
              <div className="grid gap-4">
                <div className="grid gap-5 min-[621px]:grid-cols-2">
                  {dialog === 'assumption-failure' ? (
                    <>
                      <Field label="Notice date" htmlFor="outcome-notice-date">
                        <input
                          className={inputClass}
                          id="outcome-notice-date"
                          type="date"
                          value={outcomeForm.noticeDate}
                          onChange={(event) =>
                            setOutcomeForm({ ...outcomeForm, noticeDate: inputValue(event) })
                          }
                        />
                      </Field>
                      <Field label="Deadline date" htmlFor="outcome-deadline-date">
                        <input
                          className={inputClass}
                          id="outcome-deadline-date"
                          type="date"
                          value={outcomeForm.deadlineDate}
                          onChange={(event) =>
                            setOutcomeForm({ ...outcomeForm, deadlineDate: inputValue(event) })
                          }
                        />
                      </Field>
                    </>
                  ) : null}
                  <Field label="Outcome date" htmlFor="outcome-date">
                    <input
                      className={inputClass}
                      id="outcome-date"
                      type="date"
                      value={outcomeForm.outcomeDate}
                      onChange={(event) =>
                        setOutcomeForm({ ...outcomeForm, outcomeDate: inputValue(event) })
                      }
                    />
                  </Field>
                  <Field label="Authorized by" htmlFor="outcome-authorized-by">
                    <input
                      className={inputClass}
                      id="outcome-authorized-by"
                      value={props.displayName}
                      readOnly
                    />
                  </Field>
                  <Field
                    label="Authority evidence (finalized Document Version)"
                    htmlFor="outcome-authority"
                  >
                    <select
                      className={inputClass}
                      id="outcome-authority"
                      value={outcomeForm.authorityDocumentVersionId}
                      onChange={(event) =>
                        setOutcomeForm({
                          ...outcomeForm,
                          authorityDocumentVersionId: inputValue(event),
                        })
                      }
                    >
                      <option value="">Select the outcome authority</option>
                      {props.documents.map((document) => (
                        <option key={document.version.id} value={document.version.id}>
                          {documentOptionLabel(document)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field
                    label="Exact evidence (finalized Document Version)"
                    htmlFor="outcome-evidence"
                  >
                    <select
                      className={inputClass}
                      id="outcome-evidence"
                      value={outcomeForm.evidenceDocumentVersionId}
                      onChange={(event) =>
                        setOutcomeForm({
                          ...outcomeForm,
                          evidenceDocumentVersionId: inputValue(event),
                        })
                      }
                    >
                      <option value="">Select the outcome evidence</option>
                      {props.documents.map((document) => (
                        <option key={document.version.id} value={document.version.id}>
                          {documentOptionLabel(document)}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label="Reason" htmlFor="outcome-reason">
                  <textarea
                    className={`${inputClass} min-h-20 py-2`}
                    id="outcome-reason"
                    value={outcomeForm.reason}
                    onChange={(event) =>
                      setOutcomeForm({ ...outcomeForm, reason: inputValue(event) })
                    }
                  />
                </Field>
              </div>
            ) : null}

            {dialog === 'activation' ? (
              <div className="grid gap-4">
                <dl className={factsClass}>
                  <DetailRow label="Appointee">{detail?.appointee.fullName ?? '—'}</DetailRow>
                  <DetailRow label="Plantilla item">
                    {detail
                      ? `${detail.position.itemNumber} · ${detail.position.title ?? 'Untitled item'} · SG ${detail.position.salaryGrade ?? '—'}`
                      : '—'}
                  </DetailRow>
                </dl>
                <p className={noteClass}>
                  The Employee legal name and service dates come from the assumed Appointment
                  Contract. The Employee number and identity facts are recorded once and reused for
                  later personnel actions.
                </p>
                <div className="grid gap-5 min-[621px]:grid-cols-2">
                  <Field label="Employee number" htmlFor="activation-number">
                    <input
                      className={inputClass}
                      id="activation-number"
                      value={activationForm.employeeNumber}
                      onChange={(event) =>
                        setActivationForm({ ...activationForm, employeeNumber: inputValue(event) })
                      }
                    />
                  </Field>
                  <Field label="Birth date" htmlFor="activation-birth-date">
                    <input
                      className={inputClass}
                      id="activation-birth-date"
                      type="date"
                      value={activationForm.birthDate}
                      onChange={(event) =>
                        setActivationForm({ ...activationForm, birthDate: inputValue(event) })
                      }
                    />
                  </Field>
                  <Field label="Sex" htmlFor="activation-sex">
                    <select
                      className={inputClass}
                      id="activation-sex"
                      value={activationForm.sex}
                      onChange={(event) =>
                        setActivationForm({ ...activationForm, sex: inputValue(event) })
                      }
                    >
                      {ACTIVATION_SEXES.map((sex) => (
                        <option key={sex} value={sex}>
                          {label(sex)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Civil status" htmlFor="activation-civil-status">
                    <select
                      className={inputClass}
                      id="activation-civil-status"
                      value={activationForm.civilStatus}
                      onChange={(event) =>
                        setActivationForm({ ...activationForm, civilStatus: inputValue(event) })
                      }
                    >
                      {ACTIVATION_CIVIL_STATUSES.map((civilStatus) => (
                        <option key={civilStatus} value={civilStatus}>
                          {label(civilStatus)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Contact email" htmlFor="activation-contact-email">
                    <input
                      className={inputClass}
                      id="activation-contact-email"
                      type="email"
                      value={activationForm.contactEmail}
                      onChange={(event) =>
                        setActivationForm({ ...activationForm, contactEmail: inputValue(event) })
                      }
                    />
                  </Field>
                </div>
              </div>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="quiet" disabled={busy}>
                Close
              </Button>
            </DialogClose>
            {activeDialog ? (
              <Button
                type="button"
                variant="primary"
                disabled={busy || !activeDialog.ready}
                onClick={() => void activeDialog.run()}
              >
                {activeDialog.submit}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </FormDialog>
    </div>
  );
}
