'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { manilaToday } from '../lib/manila-date';
import { useRecordNavigation } from './record-navigation';
import { Button } from './ui/button';
import { Field, FormError, inputClass } from './ui/field';

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

export interface AppointmentDetail extends AppointmentSummary {
  selectionPackage: unknown;
  versions: AppointmentVersion[];
  history: AppointmentHistoryEntry[];
  settings: AppointmentSettings | null;
  externalSubmissions: AppointmentExternalSubmission[];
  externalActions: AppointmentExternalAction[];
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
  initialSelected: string | null;
}

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

function statusTone(status: string): 'blue' | 'amber' | 'green' | 'gray' | 'red' {
  if (status === 'ISSUED' || status === 'APPROVED' || status === 'VALIDATED') return 'green';
  if (status === 'FOR_REVIEW' || status === 'FOR_SIGNATURE' || status === 'RETURNED')
    return 'amber';
  if (status === 'CANCELLED' || status === 'DISAPPROVED' || status === 'INVALIDATED') return 'red';
  if (status === 'SUPERSEDED' || status === 'NOT_SUBMITTED') return 'gray';
  return 'blue';
}

function StatusBadge({ status }: { status: string }) {
  const tones = {
    blue: 'border-[#b9cce5] bg-[#edf2f9] text-[#315d98]',
    amber: 'border-[#decba7] bg-[#fff8e9] text-[#755421]',
    green: 'border-[#b6d9c3] bg-[#eef9f1] text-[#296442]',
    gray: 'border-line bg-canvas text-muted',
    red: 'border-[#e8b6b6] bg-[#fff4f4] text-[#9a3030]',
  };
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold tracking-[0.06em] uppercase ${tones[statusTone(status)]}`}
    >
      {label(status)}
    </span>
  );
}

function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="grid gap-4 rounded-[4px] border border-line bg-paper p-5 shadow-[0_7px_20px_rgb(23_32_51/4%)]"
    >
      <div className="grid gap-1">
        <h2 className="m-0 text-[17px] font-[720] tracking-[-0.02em] text-midnight">{title}</h2>
        {description ? (
          <p className="m-0 text-[13px] leading-[1.55] text-muted">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function DetailRow({ label: term, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-line/70 py-3 last:border-b-0">
      <dt className="text-[10px] font-bold tracking-[0.07em] text-muted uppercase">{term}</dt>
      <dd className="m-0 text-sm leading-[1.5] text-ink">{children}</dd>
    </div>
  );
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
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
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
      <p className="m-0 rounded-[3px] border border-line bg-canvas px-3 py-2 text-[13px] text-muted">
        Appointing authority: <strong className="text-ink">{authorityLabel}</strong>
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
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
      <fieldset className="grid gap-3 rounded-[3px] border border-line p-4">
        <legend className="px-1 text-xs font-[650] text-ink">Exact evidence versions</legend>
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
  const [detail, setDetail] = useState<AppointmentDetail | null>(null);
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const selected = useMemo(
    () => appointments.find((appointment) => appointment.id === selectedId) ?? null,
    [appointments, selectedId],
  );
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

  async function loadDetail(appointmentId: string): Promise<void> {
    const response = await fetch(
      `/api/v1/agencies/${props.agencyId}/appointments/${appointmentId}`,
      { credentials: 'include' },
    );
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      setError(errorMessage(value, 'The Appointment record could not be loaded.'));
      return;
    }
    setDetail(value as AppointmentDetail);
  }

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
    else setDetail(null);
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

  const canPrepare = props.canCreate && settings !== null;
  const dialogTitle =
    dialog === 'prepare'
      ? 'Prepare Appointment'
      : dialog === 'update'
        ? 'Update Draft version'
        : dialog === 'return'
          ? 'Return for correction'
          : dialog === 'cancel'
            ? 'Cancel Appointment'
            : dialog === 'correct'
              ? 'Prepare a linked correction'
              : dialog === 'settings'
                ? 'Agency appointment configuration'
                : dialog === 'external-submission'
                  ? 'Record CSC submission event'
                  : dialog === 'external-action'
                    ? 'Record official CSC action'
                    : dialog === 'receipt'
                      ? 'Record appointee acknowledgment of receipt'
                      : dialog === 'oath'
                        ? 'Record Oath of Office'
                        : dialog === 'oath-correction'
                          ? 'Correct the Oath of Office'
                          : dialog === 'assumption'
                            ? 'Certify Assumption to Duty'
                            : dialog === 'assumption-correction'
                              ? 'Correct the Assumption to Duty'
                              : dialog === 'assumption-failure'
                                ? 'Record failure to assume'
                                : dialog === 'assumption-cancellation'
                                  ? 'Cancel before assumption'
                                  : '';

  return (
    <div className="grid gap-5">
      <header className="grid gap-2">
        <p className="m-0 text-[11px] font-bold tracking-[0.08em] text-muted uppercase">
          Personnel administration
        </p>
        <h1 className="m-0 text-[26px] font-[740] tracking-[-0.03em] text-midnight">
          Appointments
        </h1>
        <p className="m-0 max-w-[70ch] text-sm leading-[1.6] text-muted">
          Prepare an Appointment from an immutable selected-candidate package, route it through
          review and signature, and retain every version and evidence link. Issuance alone neither
          occupies the Plantilla item nor activates Employee service.
        </p>
      </header>

      <FormError message={error} />
      {success ? (
        <p
          role="status"
          className="m-0 rounded-[3px] border border-[#b6d9c3] bg-[#eef9f1] px-3 py-3 text-[13px] text-[#296442]"
        >
          {success}
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <Panel
          title="Eligible selections"
          description="Handed-off Selection Decisions available for preparation. The reservation, evidence, and configuration contract are revalidated when the Draft is saved."
        >
          {selections.length === 0 ? (
            <p className="m-0 rounded-[3px] border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
              No handed-off Selection Decisions are waiting for preparation.
            </p>
          ) : (
            <ul className="m-0 grid list-none gap-2 p-0">
              {selections.map((selection) => (
                <li
                  className="grid gap-2 rounded-[3px] border border-line px-4 py-3"
                  key={selection.handoffId}
                >
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-sm font-[680] text-midnight">
                      {selection.applicant.fullName}
                    </strong>
                    {selection.appointment ? (
                      <StatusBadge status={selection.appointment.workflowStatus} />
                    ) : (
                      <span className="text-[11px] font-bold tracking-[0.06em] text-muted uppercase">
                        Awaiting preparation
                      </span>
                    )}
                  </span>
                  <span className="text-[13px] text-ink">
                    {selection.position.itemNumber} · {selection.position.title ?? 'Untitled item'}{' '}
                    · SG {selection.position.salaryGrade ?? '—'}
                  </span>
                  <span className="text-xs text-muted">
                    {selection.applicant.applicationNo} · handed off{' '}
                    {dateTimeLabel(selection.handedOffAt)}
                  </span>
                  <span className="flex flex-wrap gap-2">
                    {selection.appointment ? (
                      <Button
                        size="default"
                        className="min-h-9"
                        type="button"
                        variant="secondary"
                        onClick={() => select(selection.appointment!.id)}
                      >
                        Open Appointment
                      </Button>
                    ) : (
                      <Button
                        size="default"
                        className="min-h-9"
                        type="button"
                        variant="primary"
                        disabled={!canPrepare}
                        onClick={() => openPrepare(selection)}
                      >
                        Prepare Appointment
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {selectionsHasMore ? (
            <p className="m-0 text-xs text-muted">
              Only the most recent handed-off Selection Decisions are shown. Prepare or cancel an
              Appointment to reduce the list.
            </p>
          ) : null}
          {settings === null ? (
            <p className="m-0 rounded-[3px] border border-[#decba7] bg-[#fff8e9] px-3 py-2 text-[13px] text-[#755421]">
              Agency appointment configuration is missing. Record the evidenced regulatory status
              before preparing an Appointment.
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted">
              {settings
                ? `${settings.regulatoryStatus} · ${settings.formVariant}`
                : 'No Agency configuration recorded'}
            </span>
            {props.canManageSettings ? (
              <Button
                size="default"
                className="min-h-9"
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
            ) : null}
          </div>
        </Panel>

        <Panel
          title="Appointment register"
          description="Every prepared Appointment with its current workflow status."
        >
          {appointments.length === 0 ? (
            <p className="m-0 rounded-[3px] border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
              No Appointments prepared yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-line text-[10px] font-bold tracking-[0.07em] text-muted uppercase">
                    <th className="px-3 py-2">Appointee</th>
                    <th className="px-3 py-2">Position</th>
                    <th className="px-3 py-2">Workflow</th>
                    <th className="px-3 py-2">CSC standing</th>
                  </tr>
                </thead>
                <tbody>
                  {appointments.map((appointment) => (
                    <tr
                      className={`border-b border-line/70 align-top ${selectedId === appointment.id ? 'bg-[#f1f5fb]' : ''}`}
                      key={appointment.id}
                    >
                      <td className="px-3 py-2">
                        <button
                          className="rounded-[2px] text-left text-sm font-[680] text-cobalt underline-offset-2 hover:underline"
                          type="button"
                          onClick={() => select(appointment.id)}
                        >
                          {appointment.appointee.fullName}
                        </button>
                        <span className="block text-xs text-muted">
                          {appointment.appointee.applicationNo}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-[13px] text-ink">
                        {appointment.position.itemNumber}
                        <span className="block text-xs text-muted">
                          {appointment.position.title ?? 'Untitled item'}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={appointment.workflowStatus} />
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={appointment.externalStanding} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      {selected && detail ? (
        <Panel
          title={detail.appointee.fullName}
          description={`${detail.position.itemNumber} · ${detail.position.title ?? 'Untitled item'}`}
        >
          <div className="flex flex-wrap items-center gap-3">
            <span aria-label="Workflow status">
              <StatusBadge status={detail.workflowStatus} />
            </span>
            <span aria-label="External standing">
              <StatusBadge status={detail.externalStanding} />
            </span>
            <span className="text-[13px] text-muted">
              {currentVersion
                ? `Current version v${currentVersion.versionNo} · ${label(currentVersion.status)}`
                : 'No version recorded'}
            </span>
            {detail.issuedAt ? (
              <span className="text-[13px] text-muted">
                Issued {dateTimeLabel(detail.issuedAt)}
              </span>
            ) : null}
          </div>

          <dl className="m-0 grid gap-0 sm:grid-cols-2 sm:gap-x-6">
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

          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Appointment sections">
            {(
              [
                ['preparation', 'Preparation & evidence'],
                ['review', 'Review & issuance'],
                ['oath', 'Oath & assumption'],
                ['csc', 'CSC transactions'],
              ] as const
            ).map(([value, name]) => (
              <Button
                key={value}
                size="default"
                className={`min-h-9 border px-3 ${tab === value ? 'border-cobalt bg-[#edf2f9] text-cobalt' : 'border-line bg-paper text-muted'}`}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
              >
                {name}
              </Button>
            ))}
          </div>

          {tab === 'preparation' ? (
            <div className="grid gap-4">
              <h3 className="m-0 text-sm font-[700] text-midnight">Exact evidence versions</h3>
              {detail.versions.map((version) => (
                <div
                  aria-label={`Version v${version.versionNo}`}
                  className="grid gap-3 rounded-[3px] border border-line p-4"
                  key={version.id}
                >
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-sm font-[680] text-midnight">
                      Version v{version.versionNo}
                      {version.replacesVersionId ? ' · linked correction' : ''}
                    </strong>
                    <StatusBadge status={version.status} />
                  </span>
                  <dl className="m-0 grid gap-0 sm:grid-cols-2 sm:gap-x-6">
                    <DetailRow label="Employment status">
                      {label(version.employmentStatus)}
                    </DetailRow>
                    <DetailRow label="Nature">{label(version.natureOfAppointment)}</DetailRow>
                    <DetailRow label="Salary">
                      SG {version.salaryGrade} step {version.salaryStep}
                    </DetailRow>
                    <DetailRow label="Effectivity">{dateLabel(version.effectivityDate)}</DetailRow>
                    <DetailRow label="Signature">{label(version.signatureMethod)}</DetailRow>
                    <DetailRow label="Appointment form">
                      {version.appointmentDocumentVersionId}
                    </DetailRow>
                    {version.correctionReason ? (
                      <DetailRow label="Correction reason">{version.correctionReason}</DetailRow>
                    ) : null}
                  </dl>
                  {version.evidence.length === 0 ? (
                    <p className="m-0 text-[13px] text-muted">No evidence links recorded.</p>
                  ) : (
                    <ul className="m-0 grid list-none gap-1 p-0">
                      {version.evidence.map((entry) => (
                        <li
                          className="flex flex-wrap items-center justify-between gap-2 border-b border-line/60 py-1.5 text-[13px] text-ink last:border-b-0"
                          key={entry.id}
                        >
                          <span className="font-[620]">{label(entry.linkRole)}</span>
                          <span className="text-muted">
                            {entry.documentNo ?? entry.documentType} · v{entry.versionNo} ·{' '}
                            {dateLabel(entry.issuedAt)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          ) : tab === 'review' ? (
            <div className="grid gap-4">
              <h3 className="m-0 text-sm font-[700] text-midnight">
                Preparation, review and signature
              </h3>
              <ul className="m-0 grid list-none gap-1 p-0">
                {detail.history.length === 0 ? (
                  <li className="text-[13px] text-muted">No review history recorded.</li>
                ) : (
                  detail.history.map((entry) => (
                    <li
                      className="grid gap-0.5 border-b border-line/60 py-2 last:border-b-0"
                      key={entry.id}
                    >
                      <span className="text-[13px] font-[650] text-ink">
                        {label(entry.action)}
                        {entry.newStatus ? ` · ${label(entry.newStatus)}` : ''}
                      </span>
                      <span className="text-xs text-muted">
                        {dateTimeLabel(entry.occurredAt)}
                        {entry.reason ? ` · ${entry.reason}` : ''}
                      </span>
                    </li>
                  ))
                )}
              </ul>
              <p className="m-0 text-[12px] leading-[1.55] text-muted">
                Issued corrections require a linked successor with its own reason, authority and
                evidence. Issuance alone creates no Employee service and leaves the Plantilla
                reservation in place.
              </p>
            </div>
          ) : tab === 'oath' ? (
            <div className="grid gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-[13px] text-muted">Assumption to Duty</span>
                <span aria-label="Assumption status">
                  <StatusBadge
                    status={
                      assumption?.status ?? (acknowledgment || oath ? 'PENDING' : 'NOT_RECORDED')
                    }
                  />
                </span>
              </div>
              <p className="m-0 text-[12px] leading-[1.55] text-muted">
                Receipt, Oath and Assumption bind to this exact issued version. Certification is
                complete without CSC action, and a correction is refused once service has been
                activated from the assumption.
              </p>
              {detail.workflowStatus !== 'ISSUED' ? (
                <p className="m-0 rounded-[3px] border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
                  Oath and Assumption open once an Appointment Version is issued.
                </p>
              ) : (
                <>
                  <dl className="m-0 grid gap-0 sm:grid-cols-2 sm:gap-x-6">
                    <DetailRow label="Acknowledged receipt">
                      {acknowledgment
                        ? `${dateTimeLabel(acknowledgment.acknowledgedAt)} · ${acknowledgment.evidence.documentNo ?? label(acknowledgment.evidence.documentType)} v${acknowledgment.evidence.versionNo}`
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
                        size="default"
                        className="min-h-9"
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
                        size="default"
                        className="min-h-9"
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
                        size="default"
                        className="min-h-9"
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
                        size="default"
                        className="min-h-9"
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
                        size="default"
                        className="min-h-9"
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
                        size="default"
                        className="min-h-9"
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
                        size="default"
                        className="min-h-9"
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
                    <div className="grid gap-2">
                      <h3 className="m-0 text-sm font-[700] text-midnight">Oath history</h3>
                      <ul className="m-0 grid list-none gap-1 p-0">
                        {oath.versions.map((entry) => (
                          <li
                            className="grid gap-0.5 border-b border-line/60 py-2 last:border-b-0"
                            key={entry.id}
                          >
                            <span className="text-[13px] font-[650] text-ink">
                              v{entry.versionNo} · {dateLabel(entry.oathDate)} · {entry.authority}
                              {entry.replacesOathVersionId ? ' · corrected' : ''}
                            </span>
                            <span className="text-xs text-muted">
                              {entry.evidence.documentNo ?? label(entry.evidence.documentType)} v
                              {entry.evidence.versionNo}
                              {entry.place ? ` · ${entry.place}` : ''}
                              {entry.permittedVirtualMethod
                                ? ` · ${entry.permittedVirtualMethod}`
                                : ''}
                              {entry.correctionReason ? ` · ${entry.correctionReason}` : ''}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {assumption && assumption.versions.length > 0 ? (
                    <div className="grid gap-2">
                      <h3 className="m-0 text-sm font-[700] text-midnight">Assumption history</h3>
                      <ul className="m-0 grid list-none gap-1 p-0">
                        {assumption.versions.map((entry) => (
                          <li
                            className="grid gap-0.5 border-b border-line/60 py-2 last:border-b-0"
                            key={entry.id}
                          >
                            <span className="text-[13px] font-[650] text-ink">
                              v{entry.versionNo} · actual {dateLabel(entry.actualAssumptionDate)} ·
                              certified by {entry.certifyingAuthority}
                              {entry.replacesAssumptionVersionId ? ' · corrected' : ''}
                            </span>
                            <span className="text-xs text-muted">
                              {entry.evidence.documentNo ?? label(entry.evidence.documentType)} v
                              {entry.evidence.versionNo} · certified{' '}
                              {dateTimeLabel(entry.certifiedAt)}
                              {entry.correctionReason ? ` · ${entry.correctionReason}` : ''}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {assumption?.outcome ? (
                    <div className="grid gap-2">
                      <h3 className="m-0 text-sm font-[700] text-midnight">
                        {label(assumption.outcome.outcome)}
                      </h3>
                      <p className="m-0 text-xs leading-[1.55] text-muted">
                        {dateLabel(assumption.outcome.outcomeDate)}
                        {assumption.outcome.noticeDate
                          ? ` · notice ${dateLabel(assumption.outcome.noticeDate)}`
                          : ''}
                        {assumption.outcome.deadlineDate
                          ? ` · deadline ${dateLabel(assumption.outcome.deadlineDate)}`
                          : ''}
                        {` · ${assumption.outcome.reason}`}
                      </p>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          ) : (
            <div className="grid gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-[13px] text-muted">External standing</span>
                <span aria-label="External standing">
                  <StatusBadge status={detail.externalStanding} />
                </span>
              </div>
              <p className="m-0 text-[12px] leading-[1.55] text-muted">
                Submission and official action events are append-only and bind to an exact issued
                version. They never change the workflow status, employment status, nature of
                appointment, or the issued instrument.
              </p>
              {issuedVersions.length === 0 ? (
                <p className="m-0 rounded-[3px] border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
                  External tracking opens once an Appointment Version is issued.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {props.canRecordExternalEvents ? (
                    <Button
                      size="default"
                      className="min-h-9"
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
                      size="default"
                      className="min-h-9"
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
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="grid gap-2">
                  <h3 className="m-0 text-sm font-[700] text-midnight">Submission history</h3>
                  {detail.externalSubmissions.length === 0 ? (
                    <p className="m-0 text-[13px] text-muted">No submission events recorded.</p>
                  ) : (
                    <ul className="m-0 grid list-none gap-1 p-0">
                      {detail.externalSubmissions.map((entry) => (
                        <li
                          className="grid gap-0.5 border-b border-line/60 py-2 last:border-b-0"
                          key={entry.id}
                        >
                          <span className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[13px] font-[650] text-ink">
                              {label(entry.eventType)}
                            </span>
                            <span className="text-xs text-muted">
                              {dateTimeLabel(entry.occurredAt)}
                            </span>
                          </span>
                          <span className="text-xs text-muted">
                            {entry.externalReference ? `${entry.externalReference} · ` : ''}
                            {entry.receivingOffice} ·{' '}
                            {entry.evidence.documentNo ?? label(entry.evidence.documentType)} v
                            {entry.evidence.versionNo}
                            {entry.reason ? ` · ${entry.reason}` : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="grid gap-2">
                  <h3 className="m-0 text-sm font-[700] text-midnight">Official action history</h3>
                  {detail.externalActions.length === 0 ? (
                    <p className="m-0 text-[13px] text-muted">No official actions recorded.</p>
                  ) : (
                    <ul className="m-0 grid list-none gap-1 p-0">
                      {detail.externalActions.map((entry) => (
                        <li
                          className="grid gap-0.5 border-b border-line/60 py-2 last:border-b-0"
                          key={entry.id}
                        >
                          <span className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[13px] font-[650] text-ink">
                              {label(entry.action)}
                            </span>
                            <span className="text-xs text-muted">
                              {dateTimeLabel(entry.actionAt)}
                            </span>
                          </span>
                          <span className="text-xs text-muted">
                            {entry.externalReference} ·{' '}
                            {entry.evidence.documentNo ?? label(entry.evidence.documentType)} v
                            {entry.evidence.versionNo}
                            {entry.reason ? ` · ${entry.reason}` : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {detail.workflowStatus === 'DRAFT' && props.canCreate ? (
              <Button
                size="default"
                className="min-h-9"
                type="button"
                variant="secondary"
                onClick={openUpdate}
              >
                Update Draft
              </Button>
            ) : null}
            {detail.workflowStatus === 'DRAFT' && props.canSubmit ? (
              <Button
                size="default"
                className="min-h-9"
                type="button"
                variant="primary"
                disabled={busy}
                onClick={() => void submit()}
              >
                Submit for review
              </Button>
            ) : null}
            {detail.workflowStatus === 'FOR_REVIEW' && props.canReturn ? (
              <Button
                size="default"
                className="min-h-9"
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
              <Button
                size="default"
                className="min-h-9"
                type="button"
                variant="primary"
                disabled={busy}
                onClick={() => void endorse()}
              >
                Endorse for signature
              </Button>
            ) : null}
            {detail.workflowStatus === 'FOR_SIGNATURE' && props.canIssue ? (
              <Button
                size="default"
                className="min-h-9"
                type="button"
                variant="primary"
                disabled={busy}
                onClick={() => void issue()}
              >
                Issue Appointment
              </Button>
            ) : null}
            {detail.workflowStatus === 'ISSUED' && props.canCreate ? (
              <Button
                size="default"
                className="min-h-9"
                type="button"
                variant="secondary"
                onClick={openCorrect}
              >
                Prepare linked correction
              </Button>
            ) : null}
            {(detail.workflowStatus === 'FOR_SIGNATURE' || detail.workflowStatus === 'ISSUED') &&
            props.canCancel ? (
              <Button
                size="default"
                className="min-h-9"
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
          </div>
        </Panel>
      ) : selected ? (
        <p className="m-0 text-sm text-muted">Loading the Appointment record…</p>
      ) : null}

      {dialog ? (
        <section
          aria-label={dialogTitle}
          className="grid gap-4 rounded-[4px] border border-cobalt/40 bg-paper p-5 shadow-[0_10px_28px_rgb(23_32_51/8%)]"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="m-0 text-[17px] font-[720] text-midnight">{dialogTitle}</h2>
            <Button
              size="default"
              className="min-h-9"
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => setDialog(null)}
            >
              Close
            </Button>
          </div>
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
            <div className="grid gap-4 sm:grid-cols-2">
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
              <div className="grid gap-4 sm:grid-cols-2">
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
            <div className="grid gap-4 sm:grid-cols-2">
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
              <Field label="Exact evidence (finalized Document Version)" htmlFor="receipt-evidence">
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
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Oath date" htmlFor="oath-date">
                  <input
                    className={inputClass}
                    id="oath-date"
                    type="date"
                    value={oathForm.oathDate}
                    onChange={(event) => setOathForm({ ...oathForm, oathDate: inputValue(event) })}
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
                    onChange={(event) => setOathForm({ ...oathForm, authority: inputValue(event) })}
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
                <Field label="Exact evidence (finalized Document Version)" htmlFor="oath-evidence">
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
                      onChange={(event) => setOathForm({ ...oathForm, reason: inputValue(event) })}
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
              <div className="grid gap-4 sm:grid-cols-2">
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
                      setAssumptionForm({ ...assumptionForm, documentVersionId: inputValue(event) })
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
              <div className="grid gap-4 sm:grid-cols-2">
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

          <div className="flex flex-wrap gap-2">
            {dialog === 'prepare' ? (
              <Button
                size="default"
                className="min-h-9"
                type="button"
                variant="primary"
                disabled={busy}
                onClick={() => void savePrepare()}
              >
                Prepare Draft
              </Button>
            ) : null}
            {dialog === 'update' ? (
              <Button
                size="default"
                className="min-h-9"
                type="button"
                variant="primary"
                disabled={busy}
                onClick={() => void saveUpdate()}
              >
                Save Draft
              </Button>
            ) : null}
            {dialog === 'return' ? (
              <Button
                size="default"
                className="min-h-9"
                type="button"
                variant="primary"
                disabled={busy || reason.trim() === ''}
                onClick={() => void saveReturn()}
              >
                Return for correction
              </Button>
            ) : null}
            {dialog === 'cancel' ? (
              <Button
                size="default"
                className="min-h-9"
                type="button"
                variant="primary"
                disabled={busy || reason.trim() === '' || authorityDocumentVersionId === ''}
                onClick={() => void saveCancel()}
              >
                Cancel Appointment
              </Button>
            ) : null}
            {dialog === 'correct' ? (
              <Button
                size="default"
                className="min-h-9"
                type="button"
                variant="primary"
                disabled={busy || reason.trim() === '' || authorityDocumentVersionId === ''}
                onClick={() => void saveCorrect()}
              >
                Prepare correction Draft
              </Button>
            ) : null}
            {dialog === 'settings' ? (
              <Button
                size="default"
                className="min-h-9"
                type="button"
                variant="primary"
                disabled={busy || settingsForm.statusEvidenceDocumentVersionId === ''}
                onClick={() => void saveSettings()}
              >
                Record configuration
              </Button>
            ) : null}
            {dialog === 'external-submission' ? (
              <Button
                size="default"
                className="min-h-9"
                type="button"
                variant="primary"
                disabled={
                  busy ||
                  externalForm.appointmentVersionId === '' ||
                  externalForm.occurredAt === '' ||
                  externalForm.receivingOffice.trim() === '' ||
                  externalForm.evidenceDocumentVersionId === ''
                }
                onClick={() => void saveExternalSubmission()}
              >
                Record submission event
              </Button>
            ) : null}
            {dialog === 'external-action' ? (
              <Button
                size="default"
                className="min-h-9"
                type="button"
                variant="primary"
                disabled={
                  busy ||
                  externalForm.appointmentVersionId === '' ||
                  externalForm.action === '' ||
                  externalForm.occurredAt === '' ||
                  externalForm.externalReference.trim() === '' ||
                  externalForm.evidenceDocumentVersionId === ''
                }
                onClick={() => void saveExternalAction()}
              >
                Record official action
              </Button>
            ) : null}
            {dialog === 'receipt' ? (
              <Button
                size="default"
                className="min-h-9"
                type="button"
                variant="primary"
                disabled={
                  busy || receiptForm.acknowledgedAt === '' || receiptForm.documentVersionId === ''
                }
                onClick={() => void saveReceipt()}
              >
                Record acknowledgment
              </Button>
            ) : null}
            {dialog === 'oath' ? (
              <Button
                size="default"
                className="min-h-9"
                type="button"
                variant="primary"
                disabled={
                  busy ||
                  oathForm.oathDate === '' ||
                  oathForm.authority.trim() === '' ||
                  oathForm.documentVersionId === ''
                }
                onClick={() => void saveOath()}
              >
                Record Oath
              </Button>
            ) : null}
            {dialog === 'oath-correction' ? (
              <Button
                size="default"
                className="min-h-9"
                type="button"
                variant="primary"
                disabled={
                  busy ||
                  oathForm.oathDate === '' ||
                  oathForm.authority.trim() === '' ||
                  oathForm.documentVersionId === '' ||
                  oathForm.reason.trim() === '' ||
                  oathForm.authorityDocumentVersionId === ''
                }
                onClick={() => void saveOathCorrection()}
              >
                Record Oath correction
              </Button>
            ) : null}
            {dialog === 'assumption' ? (
              <Button
                size="default"
                className="min-h-9"
                type="button"
                variant="primary"
                disabled={
                  busy ||
                  assumptionForm.actualAssumptionDate === '' ||
                  assumptionForm.certifyingAuthority.trim() === '' ||
                  assumptionForm.certifiedAt === '' ||
                  assumptionForm.documentVersionId === ''
                }
                onClick={() => void saveAssumption()}
              >
                Certify Assumption to Duty
              </Button>
            ) : null}
            {dialog === 'assumption-correction' ? (
              <Button
                size="default"
                className="min-h-9"
                type="button"
                variant="primary"
                disabled={
                  busy ||
                  assumptionForm.actualAssumptionDate === '' ||
                  assumptionForm.certifyingAuthority.trim() === '' ||
                  assumptionForm.certifiedAt === '' ||
                  assumptionForm.documentVersionId === '' ||
                  assumptionForm.reason.trim() === '' ||
                  assumptionForm.authorityDocumentVersionId === ''
                }
                onClick={() => void saveAssumptionCorrection()}
              >
                Record Assumption correction
              </Button>
            ) : null}
            {dialog === 'assumption-failure' ? (
              <Button
                size="default"
                className="min-h-9"
                type="button"
                variant="primary"
                disabled={
                  busy ||
                  outcomeForm.noticeDate === '' ||
                  outcomeForm.deadlineDate === '' ||
                  outcomeForm.outcomeDate === '' ||
                  outcomeForm.reason.trim() === '' ||
                  outcomeForm.authorityDocumentVersionId === '' ||
                  outcomeForm.evidenceDocumentVersionId === ''
                }
                onClick={() => void saveAssumptionFailure()}
              >
                Record failure to assume
              </Button>
            ) : null}
            {dialog === 'assumption-cancellation' ? (
              <Button
                size="default"
                className="min-h-9"
                type="button"
                variant="primary"
                disabled={
                  busy ||
                  outcomeForm.outcomeDate === '' ||
                  outcomeForm.reason.trim() === '' ||
                  outcomeForm.authorityDocumentVersionId === '' ||
                  outcomeForm.evidenceDocumentVersionId === ''
                }
                onClick={() => void saveAssumptionCancellation()}
              >
                Record cancellation
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
