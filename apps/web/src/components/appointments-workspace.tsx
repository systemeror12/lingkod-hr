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
type Dialog = 'prepare' | 'update' | 'return' | 'cancel' | 'correct' | 'settings' | null;
type Tab = 'preparation' | 'review';

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
}

export interface AppointmentSummary {
  id: string;
  workflowStatus: WorkflowStatus;
  recruitmentHandoffId: string;
  position: {
    id: string;
    itemNumber: string;
    title: string | null;
    salaryGrade: number | null;
    organizationUnitId: string | null;
  };
  appointee: { personKey: string; fullName: string; applicationNo: string };
  currentVersion: Omit<AppointmentVersion, 'evidence'> | null;
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

export interface AppointmentDetail extends AppointmentSummary {
  selectionPackage: unknown;
  versions: AppointmentVersion[];
  history: AppointmentHistoryEntry[];
  settings: AppointmentSettings | null;
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
  initialSelected: string | null;
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

function statusTone(status: string): 'blue' | 'amber' | 'green' | 'gray' | 'red' {
  if (status === 'ISSUED') return 'green';
  if (status === 'FOR_REVIEW' || status === 'FOR_SIGNATURE') return 'amber';
  if (status === 'CANCELLED') return 'red';
  if (status === 'SUPERSEDED') return 'gray';
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const selected = useMemo(
    () => appointments.find((appointment) => appointment.id === selectedId) ?? null,
    [appointments, selectedId],
  );
  const currentVersion = detail?.currentVersion ?? selected?.currentVersion ?? null;

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
          ) : (
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
          </div>
        </section>
      ) : null}
    </div>
  );
}
