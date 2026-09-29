'use client';

import { Field, inputClass, FormError } from './ui/field';
import { useRecordNavigation } from './record-navigation';
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
import { PageHeader, type Breadcrumb } from './ui/page-header';
import { Panel } from './ui/panel';
import { StateSurface } from './state-surface';
import { StatusTag, type StatusTone } from './ui/status-tag';
import { RowHeader, Table, Td, Th, Tr } from './ui/table';
import { cn } from '../lib/class-names';
import { manilaToday } from '../lib/manila-date';

type LeaveTypeStatus = 'ACTIVE' | 'INACTIVE';
type VersionState = 'DRAFT' | 'ACTIVE' | 'SUPERSEDED';
type AuthorityClass = 'NATIONAL_RULE' | 'AGENCY_CONFIGURATION';
type ConfigurationResult = 'RESOLVED' | 'INDETERMINATE';

export interface LeaveCatalogueEntry {
  code: string;
  name: string;
  evaluatorKind: string;
  entitlementBasis: string;
  calendarBasis: string;
  chargedLeaveTypeCode: string | null;
  activationPolicy: 'FIXED_NATIONAL' | 'REQUIRES_AGENCY_CONFIGURATION' | 'FAIL_CLOSED_PLACEHOLDER';
  personnelProfiles: string[];
  requiredEvidenceKinds: string[];
  ruleParameters: Record<string, unknown>;
  authorityCitations: Array<{ citation: string; title: string }>;
  failClosed: boolean;
}

export interface LeavePolicyAuthority {
  id: string;
  authorityClass: AuthorityClass;
  documentId: string;
  documentNo: string | null;
  documentType: string;
  classification: string;
  documentStatus: string;
  documentVersionId: string;
  documentVersionNo: number;
  citation: string;
  validationReason: string | null;
  createdAt: string;
}

export interface LeavePolicyVersion {
  id: string;
  leaveTypeId: string;
  versionNo: number;
  entitlementBasis: string;
  calendarBasis: string;
  chargedLeaveTypeId: string | null;
  chargedLeaveTypeCode: string | null;
  evaluatorKind: string;
  ruleParameters: Record<string, unknown>;
  applicability: { profiles: string[]; excludedProfiles: string[] };
  documentRequirements: { required: string[]; additional: string[] };
  approvalRouteCode: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: VersionState;
  authorities: LeavePolicyAuthority[];
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface LeaveType {
  id: string;
  code: string;
  name: string;
  status: LeaveTypeStatus;
  catalogue: LeaveCatalogueEntry;
  currentVersion: LeavePolicyVersion | null;
  draft: LeavePolicyVersion | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeaveTypeListResponse {
  leaveTypes: LeaveType[];
}

export interface LeaveCatalogueResponse {
  entries: LeaveCatalogueEntry[];
  personnelProfiles: string[];
  evidenceKinds: string[];
}

export interface LeaveTypeDetail {
  leaveType: LeaveType;
  asOf: string;
  effective: LeavePolicyVersion | null;
  configuration: { result: ConfigurationResult; reasons: string[] };
  versions: LeavePolicyVersion[];
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

const PROFILE_LABELS: Record<string, string> = {
  ORDINARY_CIVILIAN_NGA: 'Ordinary civilian (NGA)',
  TEACHER: 'Teacher',
  SPECIAL_LAW_PERSONNEL: 'Special-law personnel',
  JO_COS_WORKER: 'JO/COS worker',
  UNIFORMED_OR_MILITARY: 'Uniformed or military',
};

const EVIDENCE_LABELS: Record<string, string> = {
  SIGNED_LEAVE_APPLICATION_FORM: 'Signed leave application (CS Form No. 6)',
  MEDICAL_CERTIFICATE: 'Medical certificate',
  BIRTH_OR_PREGNANCY_EVIDENCE: 'Birth or pregnancy evidence',
  MARRIAGE_EVIDENCE: 'Marriage evidence',
  PLACEMENT_AUTHORITY_EVIDENCE: 'Placement authority evidence',
  SOLO_PARENT_IDENTIFICATION: 'Solo parent identification',
  PROTECTION_ORDER_EVIDENCE: 'Protection order evidence',
  CALAMITY_DECLARATION_EVIDENCE: 'Calamity declaration evidence',
  STUDY_AGREEMENT_EVIDENCE: 'Study agreement evidence',
  MEDICAL_RECOMMENDATION: 'Medical recommendation',
  GYNECOLOGICAL_SURGERY_EVIDENCE: 'Gynecological surgery evidence',
  SCHEDULE_OR_CLEARANCE_EVIDENCE: 'Schedule or clearance evidence',
};

const EVALUATOR_LABELS: Record<string, string> = {
  SERVICE_ACCRUAL: 'Service accrual',
  ANNUAL_ALLOWANCE: 'Annual allowance',
  EVENT_BOUND_ALLOWANCE: 'Event-bound allowance',
  MANDATORY_CHARGE_FROM_ACCOUNT: 'Mandatory charge from account',
  NON_CREDIT_AUTHORIZATION: 'Non-credit authorization',
  SOURCE_DEFINED_PLACEHOLDER: 'Source-defined placeholder',
};

const ACTIVATION_LABELS: Record<string, string> = {
  FIXED_NATIONAL: 'Fixed national rule',
  REQUIRES_AGENCY_CONFIGURATION: 'Requires Agency configuration',
  FAIL_CLOSED_PLACEHOLDER: 'Fail-closed placeholder',
};

const VALUE_LABELS: Record<string, string> = {
  ACCRUED_ACCOUNT: 'Accrued account',
  PERIODIC_ALLOWANCE: 'Periodic allowance',
  QUALIFYING_EVENT: 'Qualifying event',
  NON_CREDIT_AUTHORIZATION: 'Non-credit authorization',
  WORKING_DAY: 'Working day',
  CALENDAR_DAY: 'Calendar day',
  SCHEDULED_TIME: 'Scheduled time',
  SOURCE_DEFINED: 'Source-defined',
};

interface DraftValues {
  effectiveDate: string;
  approvalRouteCode: string;
  profiles: string[];
  excludedProfiles: string[];
  additional: string[];
  reason: string;
  rowVersion: number | null;
}

function emptyDraft(entry: LeaveCatalogueEntry | undefined): DraftValues {
  return {
    effectiveDate: manilaToday(),
    approvalRouteCode: '',
    profiles: entry ? [...entry.personnelProfiles] : [],
    excludedProfiles: [],
    additional: [],
    reason: '',
    rowVersion: null,
  };
}

function draftValues(version: LeavePolicyVersion): DraftValues {
  return {
    effectiveDate: version.effectiveFrom,
    approvalRouteCode: version.approvalRouteCode,
    profiles: [...version.applicability.profiles],
    excludedProfiles: [...version.applicability.excludedProfiles],
    additional: [...version.documentRequirements.additional],
    reason: '',
    rowVersion: version.rowVersion,
  };
}

function errorMessage(value: unknown, fallback: string): string {
  if (typeof value !== 'object' || value === null) return fallback;
  const error = (value as { error?: { message?: unknown; reasons?: unknown } }).error;
  const message = typeof error?.message === 'string' ? error.message : fallback;
  if (Array.isArray(error?.reasons) && error.reasons.length > 0) {
    return `${message} (${error.reasons.join(', ')})`;
  }
  return message;
}

function statusTone(status: LeaveTypeStatus | VersionState): StatusTone {
  if (status === 'ACTIVE') return 'success';
  if (status === 'DRAFT') return 'warning';
  return 'neutral';
}

function configurationTone(result: ConfigurationResult): StatusTone {
  return result === 'RESOLVED' ? 'success' : 'warning';
}

const recordLinkClass =
  'w-fit cursor-pointer text-left font-[600] text-primary underline-offset-2 hover:underline';

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

function targetValue(event: { currentTarget: EventTarget }): string {
  return (event.currentTarget as unknown as { value: string }).value;
}

function optionLabel(labels: Record<string, string>, code: string): string {
  return labels[code] ?? code.replaceAll('_', ' ').toLowerCase();
}

function SuccessNotice({ children }: { children: ReactNode }) {
  return (
    <p
      className="m-0 rounded-control border border-success/40 bg-success/5 px-3 py-2.5 text-small text-success"
      role="status"
    >
      {children}
    </p>
  );
}

function CheckGroup({
  legend,
  name,
  options,
  labels,
  selected,
  onChange,
}: {
  legend: string;
  name: string;
  options: readonly string[];
  labels: Record<string, string>;
  selected: readonly string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <fieldset className="grid gap-2">
      <legend className="text-caption font-[650] text-ink">{legend}</legend>
      <div className="grid gap-2 min-[621px]:grid-cols-2">
        {options.map((option) => (
          <label
            className="flex min-h-10 items-center gap-2 rounded-control border border-border px-3 text-caption text-ink"
            key={option}
          >
            <input
              checked={selected.includes(option)}
              name={name}
              onChange={() =>
                onChange(
                  selected.includes(option)
                    ? selected.filter((value) => value !== option)
                    : [...selected, option],
                )
              }
              type="checkbox"
              value={option}
            />
            {optionLabel(labels, option)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function ParameterList({ parameters }: { parameters: Record<string, unknown> }) {
  const entries = Object.entries(parameters).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return <span className="text-caption text-ink-muted">None</span>;
  return (
    <dl className="m-0 grid gap-1 text-caption">
      {entries.map(([key, value]) => (
        <div className="flex gap-2" key={key}>
          <dt className="font-[650] text-ink">{key}</dt>
          <dd className="m-0 break-words text-ink-muted">{JSON.stringify(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function AuthorityList({
  authorities,
  canManage,
  busy,
  onRemove,
}: {
  authorities: LeavePolicyAuthority[];
  canManage: boolean;
  busy: boolean;
  onRemove: (authorityId: string) => Promise<void>;
}) {
  if (authorities.length === 0) {
    return (
      <span className="text-caption text-ink-muted">No authority Document Version linked yet.</span>
    );
  }
  return (
    <ul className="m-0 grid list-none gap-2 p-0">
      {authorities.map((authority) => (
        <li
          className="grid gap-1 rounded-control border border-border bg-surface px-3 py-2 text-caption"
          key={authority.id}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong className="text-ink">
              {authority.authorityClass === 'NATIONAL_RULE'
                ? 'National rule'
                : 'Agency configuration'}{' '}
              · version {authority.documentVersionNo}
            </strong>
            {canManage ? (
              <Button
                disabled={busy}
                onClick={() => void onRemove(authority.id)}
                type="button"
                variant="secondary"
              >
                Remove
              </Button>
            ) : null}
          </div>
          <span className="break-all text-ink-muted">
            {authority.documentNo ?? authority.documentId}
          </span>
          <span className="break-words text-ink">{authority.citation}</span>
          {authority.validationReason ? (
            <span className="break-words text-ink-muted">{authority.validationReason}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function SummaryFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="font-[650] text-ink">{label}</dt>
      <dd className="m-0 text-ink-muted">{children}</dd>
    </div>
  );
}

function VersionSummary({
  version,
  assessment,
}: {
  version: LeavePolicyVersion;
  assessment?: { result: ConfigurationResult; reasons: string[] } | undefined;
}) {
  return (
    <div className="grid gap-3 rounded-control border border-border bg-canvas px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-small text-ink">Version {version.versionNo}</strong>
        <StatusTag tone={statusTone(version.status)}>{version.status}</StatusTag>
        {assessment ? (
          <StatusTag tone={configurationTone(assessment.result)}>{assessment.result}</StatusTag>
        ) : null}
      </div>
      <dl className="m-0 grid gap-1 text-caption min-[621px]:grid-cols-2">
        <SummaryFact label="Effective">
          {dateLabel(version.effectiveFrom)} —{' '}
          {version.effectiveTo ? dateLabel(version.effectiveTo) : 'open'}
        </SummaryFact>
        <SummaryFact label="Evaluator">
          {optionLabel(EVALUATOR_LABELS, version.evaluatorKind)}
        </SummaryFact>
        <SummaryFact label="Entitlement">
          {optionLabel(VALUE_LABELS, version.entitlementBasis)}
        </SummaryFact>
        <SummaryFact label="Calendar">
          {optionLabel(VALUE_LABELS, version.calendarBasis)}
        </SummaryFact>
        <SummaryFact label="Charged leave type">
          {version.chargedLeaveTypeCode ?? 'None'}
        </SummaryFact>
        <SummaryFact label="Approval route">{version.approvalRouteCode}</SummaryFact>
      </dl>
      <div className="grid gap-1 text-caption">
        <span className="font-[650] text-ink">National rule parameters</span>
        <ParameterList parameters={version.ruleParameters} />
      </div>
      <div className="grid gap-1 text-caption">
        <span className="font-[650] text-ink">Personnel applicability</span>
        <span className="text-ink-muted">
          {version.applicability.profiles
            .map((code) => optionLabel(PROFILE_LABELS, code))
            .join(', ')}
          {version.applicability.excludedProfiles.length > 0
            ? ' · excludes ' +
              version.applicability.excludedProfiles
                .map((code) => optionLabel(PROFILE_LABELS, code))
                .join(', ')
            : ''}
        </span>
      </div>
      <div className="grid gap-1 text-caption">
        <span className="font-[650] text-ink">Evidence</span>
        <span className="text-ink-muted">
          {version.documentRequirements.required
            .map((code) => optionLabel(EVIDENCE_LABELS, code))
            .join(', ') || 'None'}
          {version.documentRequirements.additional.length > 0
            ? ' · additional ' +
              version.documentRequirements.additional
                .map((code) => optionLabel(EVIDENCE_LABELS, code))
                .join(', ')
            : ''}
        </span>
      </div>
      <div className="grid gap-2 text-caption">
        <span className="font-[650] text-ink">Authority Document Versions</span>
        <ul className="m-0 grid list-none gap-1 p-0">
          {version.authorities.map((authority) => (
            <li className="text-ink-muted" key={authority.id}>
              {authority.authorityClass === 'NATIONAL_RULE' ? 'National' : 'Agency'} ·{' '}
              {authority.citation} · version {authority.documentVersionNo}
            </li>
          ))}
          {version.authorities.length === 0 ? (
            <li className="text-ink-muted">None linked.</li>
          ) : null}
        </ul>
      </div>
      {assessment && assessment.result === 'INDETERMINATE' ? (
        <Blocked title="Indeterminate — assessment is blocked">
          {assessment.reasons.join(', ')}
        </Blocked>
      ) : null}
    </div>
  );
}

/** Warning callout for a policy that cannot be assessed. */
function Blocked({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 rounded-control border border-warning/40 bg-warning/5 px-3 py-2 text-caption text-warning">
      <strong>{title}</strong>
      <span className="break-words">{children}</span>
    </div>
  );
}

export function LeavePolicyWorkspace({
  agencyId,
  initial,
  catalogue,
  canManage,
}: {
  agencyId: string;
  initial: LeaveTypeListResponse;
  catalogue: LeaveCatalogueResponse;
  canManage: boolean;
}) {
  const [leaveTypes, setLeaveTypes] = useState(initial.leaveTypes);
  const navigation = useRecordNavigation();
  const recordId = navigation.search.get('record');
  const asOf = navigation.search.get('asOf') ?? manilaToday();
  const dialogRef = useRef<'detail' | 'createType' | 'editType' | null>(null);
  const [dialog, setDialog] = useState<'detail' | 'createType' | 'editType' | null>(null);
  const [detail, setDetail] = useState<LeaveTypeDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [catalogueCode, setCatalogueCode] = useState(catalogue.entries[0]?.code ?? '');
  const [typeName, setTypeName] = useState('');
  const [typeStatus, setTypeStatus] = useState<LeaveTypeStatus>('ACTIVE');
  const [typeRowVersion, setTypeRowVersion] = useState<number | null>(null);
  const [draft, setDraft] = useState<DraftValues>(() => emptyDraft(catalogue.entries[0]));
  const [authorityClass, setAuthorityClass] = useState<AuthorityClass>('NATIONAL_RULE');
  const [documentId, setDocumentId] = useState('');
  const [citation, setCitation] = useState('');
  const [validationReason, setValidationReason] = useState('');
  const [activationReason, setActivationReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState('');

  useEffect(() => {
    let active = true;
    if (!recordId) {
      if (dialogRef.current === 'detail') {
        dialogRef.current = null;
        setDialog(null);
        setDetail(null);
      }
      return;
    }
    setDetail(null);
    setError('');
    dialogRef.current = 'detail';
    setDialog('detail');
    setDetailLoading(true);
    void request(
      '/leave-types/' + encodeURIComponent(recordId) + '?asOf=' + encodeURIComponent(asOf),
    )
      .then((value) => {
        if (!active) return;
        const next = value as LeaveTypeDetail;
        setDetail(next);
        setDraft(
          next.leaveType.draft
            ? draftValues(next.leaveType.draft)
            : emptyDraft(next.leaveType.catalogue),
        );
      })
      .catch((reason: unknown) => {
        if (active)
          setError(reason instanceof Error ? reason.message : 'This record is unavailable.');
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [recordId, asOf]);

  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await fetch('/api/v1/agencies/' + agencyId + path, {
      ...init,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...init.headers },
    });
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(errorMessage(value, 'The Leave Policy action failed.'));
    }
    return value;
  }

  async function refresh(): Promise<void> {
    const list = (await request('/leave-types')) as LeaveTypeListResponse;
    setLeaveTypes(list.leaveTypes);
    if (recordId) {
      const next = (await request(
        '/leave-types/' + encodeURIComponent(recordId) + '?asOf=' + encodeURIComponent(asOf),
      )) as LeaveTypeDetail;
      setDetail(next);
      setDraft(
        next.leaveType.draft
          ? draftValues(next.leaveType.draft)
          : emptyDraft(next.leaveType.catalogue),
      );
    }
  }

  function resetAction(): void {
    setError('');
    setSuccess('');
    setActivationReason('');
  }

  function closeDialog(force = false): void {
    if (busy && !force) return;
    dialogRef.current = null;
    setDialog(null);
    setDetail(null);
    setError('');
    setSuccess('');
    if (recordId) navigation.navigate({ record: null });
  }

  async function createLeaveType(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    resetAction();
    try {
      const created = (await request('/leave-types', {
        method: 'POST',
        body: JSON.stringify({ catalogueCode }),
      })) as LeaveType;
      await refresh();
      closeDialog(true);
      setSuccess(
        `${created.name} is now an Agency Leave Type. Open it to create an effective-dated policy version.`,
      );
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'The Leave Type could not be created.');
    } finally {
      setBusy(false);
    }
  }

  async function updateLeaveType(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!detail) return;
    setBusy(true);
    resetAction();
    try {
      const updated = (await request('/leave-types/' + detail.leaveType.id, {
        method: 'PATCH',
        body: JSON.stringify({
          name: typeName,
          status: typeStatus,
          ...(typeRowVersion === null ? {} : { rowVersion: typeRowVersion }),
        }),
      })) as LeaveType;
      await refresh();
      closeDialog(true);
      setSuccess(`${updated.name} settings were saved.`);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'The Leave Type could not be updated.');
    } finally {
      setBusy(false);
    }
  }

  async function submitDraft(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!detail) return;
    const approvalRouteCode = draft.approvalRouteCode.trim();
    if (!approvalRouteCode) {
      setError('Enter the Approval Route code this Leave Policy Version follows.');
      return;
    }
    setBusy(true);
    resetAction();
    const existing = detail.leaveType.draft;
    const body = {
      effectiveDate: draft.effectiveDate,
      approvalRouteCode,
      applicability: { profiles: draft.profiles, excludedProfiles: draft.excludedProfiles },
      documentRequirements: { additional: draft.additional },
      reason: draft.reason,
      ...(existing && draft.rowVersion !== null ? { rowVersion: draft.rowVersion } : {}),
    };
    try {
      if (existing) {
        await request('/leave-types/' + detail.leaveType.id + '/policy-versions/' + existing.id, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        setSuccess('The draft Leave Policy Version was updated.');
      } else {
        await request('/leave-types/' + detail.leaveType.id + '/policy-versions', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        setSuccess('A draft Leave Policy Version was created.');
      }
      await refresh();
    } catch (reason: unknown) {
      setError(
        reason instanceof Error ? reason.message : 'The Leave Policy Version could not be saved.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function linkAuthority(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!detail?.leaveType.draft) return;
    setBusy(true);
    resetAction();
    try {
      const next = (await request(
        '/leave-types/' +
          detail.leaveType.id +
          '/policy-versions/' +
          detail.leaveType.draft.id +
          '/authorities',
        {
          method: 'POST',
          body: JSON.stringify({
            authorityClass,
            documentId,
            citation,
            ...(validationReason.trim() ? { validationReason } : {}),
          }),
        },
      )) as LeavePolicyVersion;
      setDetail({ ...detail, leaveType: { ...detail.leaveType, draft: next } });
      setDocumentId('');
      setCitation('');
      setValidationReason('');
      setSuccess('The authority Document Version was linked to the draft.');
      await refresh();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'The authority could not be linked.');
    } finally {
      setBusy(false);
    }
  }

  async function unlinkAuthority(authorityId: string): Promise<void> {
    if (!detail?.leaveType.draft) return;
    setBusy(true);
    resetAction();
    try {
      const next = (await request(
        '/leave-types/' +
          detail.leaveType.id +
          '/policy-versions/' +
          detail.leaveType.draft.id +
          '/authorities/' +
          authorityId,
        { method: 'DELETE' },
      )) as LeavePolicyVersion;
      setDetail({ ...detail, leaveType: { ...detail.leaveType, draft: next } });
      setSuccess('The authority link was removed from the draft.');
      await refresh();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'The authority could not be removed.');
    } finally {
      setBusy(false);
    }
  }

  async function activate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!detail?.leaveType.draft) return;
    setBusy(true);
    resetAction();
    try {
      await request(
        '/leave-types/' +
          detail.leaveType.id +
          '/policy-versions/' +
          detail.leaveType.draft.id +
          '/activate',
        {
          method: 'POST',
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: JSON.stringify({ reason: activationReason }),
        },
      );
      setActivationReason('');
      setSuccess('The Leave Policy Version is active.');
      await refresh();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'The version could not be activated.');
    } finally {
      setBusy(false);
    }
  }

  const createdCodes = new Set(leaveTypes.map(({ code }) => code));
  const showingForm = dialog !== null;
  const breadcrumbs: Breadcrumb[] = [{ label: 'Leave administration' }];
  // Only the record view changes the URL, so only it can link back to the register.
  if (recordId) {
    breadcrumbs.push({
      label: 'Leave Policies',
      href: navigation.href({ record: null }),
    });
    if (detail) breadcrumbs.push({ label: detail.leaveType.code });
  }

  return (
    <Dialog
      presentation="form"
      open={dialog !== null}
      onOpenChange={(open) => !open && closeDialog()}
    >
      <div className="grid min-w-0 gap-5">
        <PageHeader breadcrumbs={breadcrumbs} title="Leave Policies" />

        <div hidden={showingForm} className="grid min-w-0 gap-5">
          <p className="m-0 max-w-[760px] text-small text-ink-muted">
            Admit the government leave catalogue, then activate effective-dated Leave Policy
            Versions backed by exact national-rule and Agency-configuration Document Versions. The
            catalogue fixes evaluator kinds and national values; administrators cannot supply
            formulas.
          </p>

          {success ? <SuccessNotice>{success}</SuccessNotice> : null}

          <Panel
            title="Government leave catalogue"
            flush
            actions={
              <span className="text-caption text-ink-muted">
                {catalogue.entries.length} catalogue entries
              </span>
            }
          >
            <Table aria-label="Government leave catalogue entries" className="min-w-[960px]">
              <thead>
                <tr>
                  <Th>Leave type</Th>
                  <Th>Evaluator</Th>
                  <Th>Basis</Th>
                  <Th>Charged leave type</Th>
                  <Th>Activation</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {catalogue.entries.map((entry) => (
                  <Tr key={entry.code}>
                    <RowHeader>
                      <div className="grid gap-1">
                        <span>{entry.name}</span>
                        <span className="text-caption font-normal text-ink-muted">
                          {entry.code}
                        </span>
                        <span className="max-w-[320px] text-caption font-normal text-ink-muted">
                          {entry.authorityCitations.map(({ title }) => title).join(' · ')}
                        </span>
                      </div>
                    </RowHeader>
                    <Td>{optionLabel(EVALUATOR_LABELS, entry.evaluatorKind)}</Td>
                    <Td className="text-ink-muted">
                      {optionLabel(VALUE_LABELS, entry.entitlementBasis)}
                      <br />
                      {optionLabel(VALUE_LABELS, entry.calendarBasis)}
                    </Td>
                    <Td className="text-ink-muted">{entry.chargedLeaveTypeCode ?? 'None'}</Td>
                    <Td>
                      <StatusTag tone={entry.failClosed ? 'warning' : 'success'}>
                        {optionLabel(ACTIVATION_LABELS, entry.activationPolicy)}
                      </StatusTag>
                    </Td>
                    <Td>
                      {createdCodes.has(entry.code) ? (
                        <span className="text-ink-muted">Already maintained</span>
                      ) : canManage ? (
                        <DialogTrigger asChild>
                          <Button
                            onClick={() => {
                              resetAction();
                              setCatalogueCode(entry.code);
                              dialogRef.current = 'createType';
                              setDialog('createType');
                            }}
                            type="button"
                            variant="secondary"
                          >
                            Admit Leave Type
                          </Button>
                        </DialogTrigger>
                      ) : (
                        <span className="text-ink-muted">Not maintained</span>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Panel>

          <Panel
            title="Agency Leave Types"
            flush
            actions={
              <span className="text-caption text-ink-muted">
                {leaveTypes.length === 1 ? '1 Leave Type' : leaveTypes.length + ' Leave Types'} ·
                Agency scoped · Evidence required
              </span>
            }
          >
            {leaveTypes.length === 0 ? (
              <StateSurface compact>
                <strong className="text-body font-[650] text-ink">
                  No Agency Leave Types yet.
                </strong>
                <p className="m-0 max-w-[560px]">
                  Admit a catalogue entry, then create and activate an evidence-backed Leave Policy
                  Version before leave can be assessed.
                </p>
              </StateSurface>
            ) : (
              <Table aria-label="Agency Leave Types" className="min-w-[860px]">
                <thead>
                  <tr>
                    <Th>Leave type</Th>
                    <Th>Active version</Th>
                    <Th>Draft</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {leaveTypes.map((leaveType) => (
                    <Tr key={leaveType.id}>
                      <RowHeader>
                        <div className="grid gap-1">
                          <button
                            className={recordLinkClass}
                            type="button"
                            onClick={() => navigation.navigate({ record: leaveType.id })}
                          >
                            {leaveType.code}
                          </button>
                          <span className="text-caption font-normal text-ink-muted">
                            {leaveType.name}
                          </span>
                        </div>
                      </RowHeader>
                      <Td>
                        {leaveType.currentVersion
                          ? 'Version ' +
                            leaveType.currentVersion.versionNo +
                            ' · ' +
                            dateLabel(leaveType.currentVersion.effectiveFrom)
                          : 'No active version'}
                      </Td>
                      <Td className="text-ink-muted">
                        {leaveType.draft
                          ? 'Version ' +
                            leaveType.draft.versionNo +
                            ' · ' +
                            dateLabel(leaveType.draft.effectiveFrom)
                          : 'None'}
                      </Td>
                      <Td>
                        <StatusTag tone={statusTone(leaveType.status)}>
                          {leaveType.status}
                        </StatusTag>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>
        </div>

        <DialogContent aria-describedby="leave-policy-dialog-description">
          <DialogHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="grid gap-1">
                <DialogTitle>
                  {dialog === 'createType'
                    ? 'Admit Leave Type'
                    : dialog === 'editType'
                      ? 'Leave Type settings'
                      : (detail?.leaveType.name ?? 'Leave Type')}
                </DialogTitle>
                <DialogDescription id="leave-policy-dialog-description">
                  {dialog === 'createType'
                    ? 'Create the Agency Leave Type from one admitted government catalogue entry.'
                    : dialog === 'editType'
                      ? 'Rename the Leave Type or suspend it. Suspension does not delete history.'
                      : 'Policy snapshot, draft, versions, and audit history.'}
                </DialogDescription>
              </div>
              <DialogClose asChild>
                <Button type="button" variant="secondary">
                  Close
                </Button>
              </DialogClose>
            </div>
          </DialogHeader>

          {error ? (
            <DialogBody className="pb-0">
              <FormError message={error} />
            </DialogBody>
          ) : null}

          {dialog === 'createType' ? (
            <form onSubmit={(event) => void createLeaveType(event)}>
              <DialogBody className="grid gap-5">
                <Field htmlFor="leave-catalogue-code" label="Catalogue entry">
                  <select
                    autoFocus
                    className={inputClass}
                    data-autofocus=""
                    id="leave-catalogue-code"
                    onChange={(event) => setCatalogueCode(targetValue(event))}
                    value={catalogueCode}
                  >
                    {catalogue.entries.map((entry) => (
                      <option key={entry.code} value={entry.code}>
                        {entry.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button disabled={busy} type="button" variant="secondary">
                    Cancel
                  </Button>
                </DialogClose>
                <Button disabled={busy} type="submit" variant="primary">
                  {busy ? 'Creating…' : 'Create Leave Type'}
                </Button>
              </DialogFooter>
            </form>
          ) : null}

          {dialog === 'editType' ? (
            <form onSubmit={(event) => void updateLeaveType(event)}>
              <DialogBody className="grid gap-5">
                <Field htmlFor="leave-type-name" label="Leave Type name">
                  <input
                    autoFocus
                    className={inputClass}
                    data-autofocus=""
                    id="leave-type-name"
                    maxLength={200}
                    onChange={(event) => setTypeName(targetValue(event))}
                    required
                    value={typeName}
                  />
                </Field>
                <Field htmlFor="leave-type-status" label="Status">
                  <select
                    className={inputClass}
                    id="leave-type-status"
                    onChange={(event) =>
                      setTypeStatus(targetValue(event) === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE')
                    }
                    value={typeStatus}
                  >
                    <option value="ACTIVE">Active</option>
                    <option value="INACTIVE">Inactive</option>
                  </select>
                </Field>
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button disabled={busy} type="button" variant="secondary">
                    Cancel
                  </Button>
                </DialogClose>
                <Button disabled={busy} type="submit" variant="primary">
                  {busy ? 'Saving…' : 'Save settings'}
                </Button>
              </DialogFooter>
            </form>
          ) : null}

          {dialog === 'detail' ? (
            <DialogBody className="grid gap-6">
              {success ? <SuccessNotice>{success}</SuccessNotice> : null}
              {detailLoading ? (
                <StateSurface busy compact>
                  <p className="m-0" role="status">
                    Loading the Leave Type record…
                  </p>
                </StateSurface>
              ) : !detail ? (
                <StateSurface compact>
                  <strong className="text-body font-[650] text-ink">
                    This Leave Type record is unavailable.
                  </strong>
                </StateSurface>
              ) : (
                <>
                  <Panel
                    title="Policy snapshot"
                    actions={
                      canManage ? (
                        <Button
                          onClick={() => {
                            resetAction();
                            setTypeName(detail.leaveType.name);
                            setTypeStatus(detail.leaveType.status);
                            setTypeRowVersion(null);
                            dialogRef.current = 'editType';
                            setDialog('editType');
                          }}

                          type="button"
                          variant="secondary"
                        >
                          Leave Type settings
                        </Button>
                      ) : null
                    }
                  >
                    <div className="grid gap-3">
                      <div className="flex flex-wrap items-center gap-2 text-caption text-ink-muted">
                        <span>{detail.leaveType.code}</span>
                        <StatusTag tone={statusTone(detail.leaveType.status)}>
                          {detail.leaveType.status}
                        </StatusTag>
                        <label className="ml-auto flex items-center gap-2 font-[650] text-ink">
                          As of
                          <input
                            className={cn(inputClass, 'w-auto font-normal')}
                            onChange={(event) =>
                              navigation.navigate({
                                asOf:
                                  targetValue(event) === manilaToday() ? null : targetValue(event),
                              })
                            }
                            type="date"
                            value={asOf}
                          />
                        </label>
                      </div>
                      {detail.effective ? (
                        <VersionSummary
                          assessment={detail.configuration}
                          version={detail.effective}
                        />
                      ) : (
                        <Blocked title="No effective Leave Policy Version on this date">
                          {detail.configuration.reasons.join(', ')}
                        </Blocked>
                      )}
                    </div>
                  </Panel>

                  <Panel title="Draft Leave Policy Version">
                    <div className="grid gap-3">
                      {canManage ? (
                        <form className="grid gap-4" onSubmit={(event) => void submitDraft(event)}>
                          <div className="grid gap-4 min-[621px]:grid-cols-2">
                            <Field htmlFor="leave-draft-effective" label="Effective date">
                              <input
                                className={inputClass}
                                id="leave-draft-effective"
                                onChange={(event) =>
                                  setDraft({ ...draft, effectiveDate: targetValue(event) })
                                }
                                required
                                type="date"
                                value={draft.effectiveDate}
                              />
                            </Field>
                            <Field htmlFor="leave-draft-route" label="Approval route code">
                              <input
                                className={inputClass}
                                id="leave-draft-route"
                                maxLength={120}
                                onChange={(event) =>
                                  setDraft({ ...draft, approvalRouteCode: targetValue(event) })
                                }
                                required
                                value={draft.approvalRouteCode}
                              />
                            </Field>
                          </div>
                          <CheckGroup
                            labels={PROFILE_LABELS}
                            legend="Personnel applicability"
                            name="leave-draft-profiles"
                            onChange={(profiles) => setDraft({ ...draft, profiles })}
                            options={catalogue.personnelProfiles}
                            selected={draft.profiles}
                          />
                          <CheckGroup
                            labels={PROFILE_LABELS}
                            legend="Excluded personnel profiles"
                            name="leave-draft-excluded"
                            onChange={(excludedProfiles) =>
                              setDraft({ ...draft, excludedProfiles })
                            }
                            options={catalogue.personnelProfiles}
                            selected={draft.excludedProfiles}
                          />
                          <CheckGroup
                            labels={EVIDENCE_LABELS}
                            legend="Additional evidence requirements"
                            name="leave-draft-evidence"
                            onChange={(additional) => setDraft({ ...draft, additional })}
                            options={catalogue.evidenceKinds}
                            selected={draft.additional}
                          />
                          <Field htmlFor="leave-draft-reason" label="Reason">
                            <textarea
                              className={inputClass}
                              id="leave-draft-reason"
                              onChange={(event) =>
                                setDraft({ ...draft, reason: targetValue(event) })
                              }
                              required
                              rows={2}
                              value={draft.reason}
                            />
                          </Field>
                          <DialogFooter className="border-t-0 px-0 pb-0">
                            <Button disabled={busy} type="submit" variant="secondary">
                              {busy
                                ? 'Saving…'
                                : detail.leaveType.draft
                                  ? 'Save draft'
                                  : 'Create draft'}
                            </Button>
                          </DialogFooter>
                        </form>
                      ) : detail.leaveType.draft ? (
                        <VersionSummary version={detail.leaveType.draft} />
                      ) : (
                        <span className="text-caption text-ink-muted">No draft version.</span>
                      )}

                      {detail.leaveType.draft && canManage ? (
                        <div className="grid gap-4 rounded-control border border-border bg-canvas px-4 py-4">
                          <div className="grid gap-1">
                            <strong className="text-caption font-[650] text-ink">
                              Authority Document Versions
                            </strong>
                            <span className="text-caption text-ink-muted">
                              National-rule and Agency-configuration Document Versions must already
                              be finalized in this Agency.
                            </span>
                          </div>
                          <AuthorityList
                            authorities={detail.leaveType.draft.authorities}
                            busy={busy}
                            canManage={canManage}
                            onRemove={unlinkAuthority}
                          />
                          <form
                            className="grid gap-3"
                            onSubmit={(event) => void linkAuthority(event)}
                          >
                            <div className="grid gap-3 min-[621px]:grid-cols-2">
                              <Field htmlFor="leave-authority-class" label="Authority class">
                                <select
                                  className={inputClass}
                                  id="leave-authority-class"
                                  onChange={(event) =>
                                    setAuthorityClass(
                                      targetValue(event) === 'AGENCY_CONFIGURATION'
                                        ? 'AGENCY_CONFIGURATION'
                                        : 'NATIONAL_RULE',
                                    )
                                  }
                                  value={authorityClass}
                                >
                                  <option value="NATIONAL_RULE">National rule</option>
                                  <option value="AGENCY_CONFIGURATION">Agency configuration</option>
                                </select>
                              </Field>
                              <Field htmlFor="leave-authority-document" label="Document ID">
                                <input
                                  className={inputClass}
                                  id="leave-authority-document"
                                  onChange={(event) => setDocumentId(targetValue(event))}
                                  required
                                  value={documentId}
                                />
                              </Field>
                            </div>
                            <Field htmlFor="leave-authority-citation" label="Citation">
                              <input
                                className={inputClass}
                                id="leave-authority-citation"
                                maxLength={300}
                                onChange={(event) => setCitation(targetValue(event))}
                                required
                                value={citation}
                              />
                            </Field>
                            <Field
                              htmlFor="leave-authority-reason"
                              label="Validation reason (optional)"
                            >
                              <input
                                className={inputClass}
                                id="leave-authority-reason"
                                maxLength={500}
                                onChange={(event) => setValidationReason(targetValue(event))}
                                value={validationReason}
                              />
                            </Field>
                            <DialogFooter className="border-t-0 px-0 pb-0">
                              <Button disabled={busy} type="submit" variant="secondary">
                                {busy ? 'Linking…' : 'Link authority'}
                              </Button>
                            </DialogFooter>
                          </form>
                          <form
                            className="grid gap-3 border-t border-border pt-4"
                            onSubmit={(event) => void activate(event)}
                          >
                            <p className="m-0 rounded-control bg-surface px-3 py-2 text-caption text-ink-muted">
                              Activation requires every national rule to resolve. The version
                              becomes immutable and any active version it replaces is superseded
                              with an end date.
                            </p>
                            <Field htmlFor="leave-activation-reason" label="Activation reason">
                              <textarea
                                className={inputClass}
                                id="leave-activation-reason"
                                onChange={(event) => setActivationReason(targetValue(event))}
                                required
                                rows={2}
                                value={activationReason}
                              />
                            </Field>
                            <DialogFooter className="border-t-0 px-0 pb-0">
                              <Button disabled={busy} type="submit" variant="primary">
                                {busy ? 'Activating…' : 'Activate version'}
                              </Button>
                            </DialogFooter>
                          </form>
                        </div>
                      ) : null}
                    </div>
                  </Panel>

                  <Panel title="Version history" flush>
                    {detail.versions.length === 0 ? (
                      <StateSurface compact>No versions yet.</StateSurface>
                    ) : (
                      <Table aria-label="Version history" className="min-w-[640px]">
                        <thead>
                          <tr>
                            <Th>Version</Th>
                            <Th>Status</Th>
                            <Th>Effective</Th>
                            <Th>Authorities</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.versions.map((version) => (
                            <Tr key={version.id}>
                              <RowHeader>v{version.versionNo}</RowHeader>
                              <Td>
                                <StatusTag tone={statusTone(version.status)}>
                                  {version.status}
                                </StatusTag>
                              </Td>
                              <Td className="text-ink-muted">
                                {dateLabel(version.effectiveFrom)} —{' '}
                                {version.effectiveTo ? dateLabel(version.effectiveTo) : 'open'}
                              </Td>
                              <Td className="text-ink-muted">
                                {version.authorities.length === 0
                                  ? 'None'
                                  : version.authorities
                                      .map(
                                        (authority) =>
                                          (authority.authorityClass === 'NATIONAL_RULE'
                                            ? 'National'
                                            : 'Agency') + ` v${authority.documentVersionNo}`,
                                      )
                                      .join(', ')}
                              </Td>
                            </Tr>
                          ))}
                        </tbody>
                      </Table>
                    )}
                  </Panel>

                  <Panel title="Audit history">
                    {detail.history.length === 0 ? (
                      <span className="text-small text-ink-muted">No audit history yet.</span>
                    ) : (
                      <ol className="m-0 grid list-none gap-2 p-0 text-caption">
                        {detail.history.map((entry) => (
                          <li
                            className="grid gap-1 rounded-control border border-border bg-surface px-3 py-2"
                            key={entry.id}
                          >
                            <span className="font-[650] text-ink">{entry.action}</span>
                            <span className="text-ink-muted">
                              {new Date(entry.occurredAt).toLocaleString('en-PH', {
                                dateStyle: 'medium',
                                timeStyle: 'short',
                                timeZone: 'Asia/Manila',
                              })}
                              {entry.previousStatus || entry.newStatus
                                ? ` · ${entry.previousStatus ?? '—'} → ${entry.newStatus ?? '—'}`
                                : ''}
                            </span>
                            {entry.reason ? <span className="text-ink">{entry.reason}</span> : null}
                          </li>
                        ))}
                      </ol>
                    )}
                  </Panel>
                </>
              )}
            </DialogBody>
          ) : null}
        </DialogContent>
      </div>
    </Dialog>
  );
}
