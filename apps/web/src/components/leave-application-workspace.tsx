'use client';

import { Field, inputClass, FormError } from './ui/field';
import { RecordReturn, useRecordNavigation } from './record-navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
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

export interface LeaveApplicationPeriod {
  sequenceNo: number;
  dateFrom: string;
  dateTo: string;
}

export interface LeaveApplicationDocument {
  id: string;
  documentVersionId: string;
  purposeCode: string;
  documentNo: string | null;
  documentType: string | null;
  versionNo: number | null;
}

export interface LeaveApplication {
  id: string;
  agencyId: string;
  employeeId: string;
  employeeNumber: string;
  employeeName: string;
  leaveTypeId: string;
  leaveTypeCode: string;
  leaveTypeName: string;
  status: string;
  currentVersionId: string | null;
  currentVersionNo: number | null;
  reason: string | null;
  policyDetails: unknown;
  commutationChoice: string | null;
  periods: LeaveApplicationPeriod[];
  submittedAt: string | null;
  createdAt: string;
}

export interface LeaveApplicationAssessment {
  id: string;
  assessmentNo: number;
  result: string;
  inputFacts: unknown;
  ruleResults: unknown;
  missingFacts: unknown;
  assessedAt: string;
}

export interface LeaveCalculationSegment {
  id: string;
  policyVersionId: string;
  scheduleAssignmentId: string | null;
  holidayFacts: unknown;
  dateFrom: string;
  dateTo: string;
  requestedQuantity: string;
  requestedUnit: string;
  accountQuantity: string | null;
}

export interface LeaveApplicationVersion {
  id: string;
  versionNo: number;
  leaveTypeId: string;
  leaveTypeCode: string;
  leaveTypeName: string;
  acceptedAssessmentId: string | null;
  approvalRouteVersionId: string;
  approvalRouteCode: string;
  approvalRequestId: string;
  approvalRequestStatus: string;
  formTemplateDocumentVersionId: string;
  attestationType: string;
  attestationDocumentVersionId: string | null;
  submittedByMembershipId: string;
  submittedByName: string | null;
  employeeAttestedAt: string | null;
  submissionMethod: string;
  receivedAt: string;
  reason: string | null;
  policyDetails: unknown;
  commutationChoice: string | null;
  submittedAt: string;
  periods: LeaveApplicationPeriod[];
  documents: LeaveApplicationDocument[];
  assessments: LeaveApplicationAssessment[];
  calculationSegments: LeaveCalculationSegment[];
}

export interface LeaveApplicationHistoryEntry {
  id: string;
  action: string;
  previousStatus: string | null;
  newStatus: string | null;
  reason: string | null;
  occurredAt: string;
}

export interface LeaveApplicationDetail {
  application: LeaveApplication;
  draftPeriods: LeaveApplicationPeriod[];
  draftDocuments: LeaveApplicationDocument[];
  versions: LeaveApplicationVersion[];
  history: LeaveApplicationHistoryEntry[];
}

export interface LeaveApplicationListResponse {
  applications: LeaveApplication[];
}

export interface LeaveEligibilityRuleResult {
  rule: string;
  outcome: string;
  detail: string;
}

export interface LeaveEligibilityMissingFact {
  fact: string;
  detail: string;
}

export interface LeaveEligibilitySegment {
  policyVersionId: string;
  scheduleAssignmentId: string | null;
  holidayCalendarVersionId: string | null;
  dateFrom: string;
  dateTo: string;
  requestedQuantity: number;
  requestedUnit: string;
  accountQuantity: number | null;
}

export interface LeaveEligibilityOutcome {
  result: string;
  ruleResults: LeaveEligibilityRuleResult[];
  missingFacts: LeaveEligibilityMissingFact[];
  inputFacts: Record<string, unknown>;
  segments: LeaveEligibilitySegment[];
  requestedQuantity: number | null;
  requestedUnit: string;
}

interface EmployeeOption {
  id: string;
  employeeNumber: string;
  legalName: string;
}

interface LeaveTypeOption {
  id: string;
  code: string;
  name: string;
  status: string;
  currentVersion: { status: string } | null;
}

interface PeriodRow {
  dateFrom: string;
  dateTo: string;
}

interface DocumentRow {
  documentId: string;
  purposeCode: string;
}

type DialogKind = 'detail' | 'prepare' | null;

const EVIDENCE_KINDS = [
  'SIGNED_LEAVE_APPLICATION_FORM',
  'MEDICAL_CERTIFICATE',
  'BIRTH_OR_PREGNANCY_EVIDENCE',
  'MARRIAGE_EVIDENCE',
  'PLACEMENT_AUTHORITY_EVIDENCE',
  'SOLO_PARENT_IDENTIFICATION',
  'PROTECTION_ORDER_EVIDENCE',
  'CALAMITY_DECLARATION_EVIDENCE',
  'STUDY_AGREEMENT_EVIDENCE',
  'MEDICAL_RECOMMENDATION',
  'GYNECOLOGICAL_SURGERY_EVIDENCE',
  'SCHEDULE_OR_CLEARANCE_EVIDENCE',
] as const;

const DOCUMENT_PURPOSES = [
  ...EVIDENCE_KINDS,
  'RENDERED_FORM',
  'SIGNED_FORM',
  'WITHDRAWAL_EVIDENCE',
] as const;

const QUALIFYING_EVENTS = [
  'LIVE_CHILDBIRTH',
  'MISCARRIAGE_OR_EMERGENCY_TERMINATION',
  'QUALIFYING_DELIVERY',
  'PLACEMENT',
  'DECLARED_CALAMITY',
  'GYNECOLOGICAL_SURGERY',
  'MASTERS_PROGRAM',
] as const;

const EDITABLE_STATUSES = ['DRAFT', 'NEEDS_INFORMATION'];
const WITHDRAWABLE_STATUSES = [
  'SUBMITTED',
  'FOR_CERTIFICATION',
  'FOR_RECOMMENDATION',
  'FOR_APPROVAL',
  'NEEDS_INFORMATION',
];

const TONE_RESOLVED = 'bg-[#e8f3ed] text-[#316647]';
const TONE_ATTENTION = 'bg-[#fff3d6] text-[#79531c]';
const TONE_DANGER = 'bg-[#fbe9e7] text-[#8c2f21]';
const TONE_NEUTRAL = 'bg-[#f0f2f5] text-muted';

function statusClass(status: string): string {
  if (['APPROVED', 'POSTED'].includes(status)) return TONE_RESOLVED;
  if (['REJECTED', 'CANCELLED'].includes(status)) return TONE_DANGER;
  if (status === 'WITHDRAWN') return TONE_NEUTRAL;
  if (status === 'DRAFT') return TONE_NEUTRAL;
  return TONE_ATTENTION;
}

function eligibilityClass(result: string): string {
  if (result === 'ELIGIBLE') return TONE_RESOLVED;
  if (result === 'INELIGIBLE') return TONE_DANGER;
  return TONE_ATTENTION;
}

function humanize(value: string): string {
  return value.replaceAll('_', ' ').toLowerCase();
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

function instantLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Manila',
  });
}

function quantityLabel(value: number | string): string {
  const text = String(value);
  if (!text.includes('.')) return text;
  return text.replace(/0+$/, '').replace(/\.$/, '');
}

function targetValue(event: { currentTarget: EventTarget }): string {
  return (event.currentTarget as unknown as { value: string }).value;
}

function periodsLabel(periods: LeaveApplicationPeriod[]): string {
  if (periods.length === 0) return '—';
  return periods
    .map(({ dateFrom, dateTo }) =>
      dateFrom === dateTo ? dateLabel(dateFrom) : `${dateLabel(dateFrom)} – ${dateLabel(dateTo)}`,
    )
    .join('; ');
}

function qualifyingEventLabel(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const event = (value as { qualifyingEvent?: unknown }).qualifyingEvent;
  return typeof event === 'string' ? event : null;
}

export function LeaveApplicationWorkspace({
  agencyId,
  initial,
  canRecordForOthers,
  canSubmit,
  canWithdraw,
}: {
  agencyId: string;
  initial: LeaveApplicationListResponse;
  canRecordForOthers: boolean;
  canSubmit: boolean;
  canWithdraw: boolean;
}) {
  const [applications, setApplications] = useState(initial.applications);
  const navigation = useRecordNavigation();
  const recordId = navigation.search.get('record');
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [detail, setDetail] = useState<LeaveApplicationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [employeeOptions, setEmployeeOptions] = useState<EmployeeOption[]>([]);
  const [leaveTypeOptions, setLeaveTypeOptions] = useState<LeaveTypeOption[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [leaveTypeId, setLeaveTypeId] = useState('');
  const [reason, setReason] = useState('');
  const [commutationChoice, setCommutationChoice] = useState('');
  const [qualifyingEvent, setQualifyingEvent] = useState('');
  const [periodRows, setPeriodRows] = useState<PeriodRow[]>([{ dateFrom: '', dateTo: '' }]);
  const [documentRows, setDocumentRows] = useState<DocumentRow[]>([]);
  const [preview, setPreview] = useState<LeaveEligibilityOutcome | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [formTemplateDocumentVersionId, setFormTemplateDocumentVersionId] = useState('');
  const [attestationType, setAttestationType] = useState('AUTHENTICATED_SUBMISSION');
  const [attestationDocumentId, setAttestationDocumentId] = useState('');
  const [receivedAt, setReceivedAt] = useState('');
  const [withdrawalReason, setWithdrawalReason] = useState('');
  const [withdrawalEvidenceDocumentId, setWithdrawalEvidenceDocumentId] = useState('');
  const [appendDocumentId, setAppendDocumentId] = useState('');
  const [appendPurposeCode, setAppendPurposeCode] = useState('SIGNED_FORM');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState('');
  const optionsRequested = useRef(false);
  const syncedRecordId = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!recordId) {
      syncedRecordId.current = null;
      setDetail(null);
      return;
    }
    if (syncedRecordId.current === recordId) return;
    setDetail(null);
    setError('');
    setDialog('detail');
    setDetailLoading(true);
    void request('/leave-applications/' + encodeURIComponent(recordId))
      .then((value) => {
        if (!active) return;
        const next = value as LeaveApplicationDetail;
        syncedRecordId.current = recordId;
        setDetail(next);
        syncDraft(next);
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
  }, [recordId]);

  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await fetch('/api/v1/agencies/' + agencyId + path, {
      ...init,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...init.headers },
    });
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(errorMessage(value, 'The Leave Application action failed.'));
    }
    return value;
  }

  async function refresh(): Promise<void> {
    const list = (await request('/leave-applications')) as LeaveApplicationListResponse;
    setApplications(list.applications);
    if (recordId) {
      const next = (await request(
        '/leave-applications/' + encodeURIComponent(recordId),
      )) as LeaveApplicationDetail;
      setDetail(next);
    }
  }

  async function loadOptions(): Promise<void> {
    if (optionsRequested.current) return;
    optionsRequested.current = true;
    try {
      const [employees, leaveTypes] = await Promise.all([
        canRecordForOthers ? request('/employees') : Promise.resolve({ employees: [] }),
        request('/leave-types'),
      ]);
      setEmployeeOptions((employees as { employees: EmployeeOption[] }).employees);
      setLeaveTypeOptions(
        (leaveTypes as { leaveTypes: LeaveTypeOption[] }).leaveTypes.filter(
          ({ status, currentVersion }) => status === 'ACTIVE' && currentVersion !== null,
        ),
      );
    } catch (reason: unknown) {
      optionsRequested.current = false;
      setError(reason instanceof Error ? reason.message : 'Loading options failed.');
    }
  }

  function resetAction(): void {
    setError('');
    setSuccess('');
  }

  function syncDraft(value: LeaveApplicationDetail): void {
    setReason(value.application.reason ?? '');
    setCommutationChoice(value.application.commutationChoice ?? '');
    setQualifyingEvent(qualifyingEventLabel(value.application.policyDetails) ?? '');
    setPeriodRows(
      value.draftPeriods.length > 0
        ? value.draftPeriods.map(({ dateFrom, dateTo }) => ({ dateFrom, dateTo }))
        : [{ dateFrom: manilaToday(), dateTo: manilaToday() }],
    );
    setDocumentRows(
      value.draftDocuments.map(({ documentVersionId, purposeCode }) => ({
        documentId: documentVersionId,
        purposeCode,
      })),
    );
    setPreview(null);
    setFormTemplateDocumentVersionId('');
    setAttestationType('AUTHENTICATED_SUBMISSION');
    setAttestationDocumentId('');
    setReceivedAt('');
    setWithdrawalReason('');
    setWithdrawalEvidenceDocumentId('');
    setAppendDocumentId('');
    setAppendPurposeCode('SIGNED_FORM');
  }

  function closeDialog(force = false): void {
    if (busy && !force) return;
    setDialog(null);
    setDetail(null);
    setPreview(null);
    setError('');
    setSuccess('');
    if (recordId) navigation.navigate({ record: null });
  }

  async function post(path: string, body: unknown): Promise<unknown> {
    return request(path, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    });
  }

  async function prepare(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    resetAction();
    try {
      const value = (await post('/leave-applications', {
        ...(canRecordForOthers && employeeId ? { employeeId } : {}),
        leaveTypeId,
      })) as LeaveApplicationDetail;
      syncedRecordId.current = value.application.id;
      setDetail(value);
      syncDraft(value);
      await refresh();
      navigation.navigate({ record: value.application.id });
      setDialog('detail');
      setSuccess('The Leave Application draft was prepared.');
    } catch (reason: unknown) {
      setError(
        reason instanceof Error ? reason.message : 'The Leave Application could not be prepared.',
      );
    } finally {
      setBusy(false);
    }
  }

  function draftPayload(): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    const trimmedReason = reason.trim();
    if (trimmedReason) payload.reason = trimmedReason;
    if (commutationChoice) payload.commutationChoice = commutationChoice;
    if (qualifyingEvent) payload.policyDetails = { qualifyingEvent };
    const periods = periodRows
      .filter(({ dateFrom, dateTo }) => dateFrom && dateTo)
      .map(({ dateFrom, dateTo }) => ({ dateFrom, dateTo }));
    if (periods.length > 0) payload.periods = periods;
    const documents = documentRows
      .filter(({ documentId }) => documentId.trim())
      .map(({ documentId, purposeCode }) => ({ documentId: documentId.trim(), purposeCode }));
    if (documents.length > 0) payload.documents = documents;
    return payload;
  }

  async function saveDraft(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!detail) return;
    setBusy(true);
    resetAction();
    try {
      const value = (await request('/leave-applications/' + detail.application.id, {
        method: 'PATCH',
        body: JSON.stringify(draftPayload()),
      })) as LeaveApplicationDetail;
      setDetail(value);
      syncDraft(value);
      await refresh();
      setSuccess('The Leave Application draft was saved.');
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'The draft could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  async function checkEligibility(): Promise<void> {
    if (!detail) return;
    setPreviewLoading(true);
    resetAction();
    try {
      const value = (await request(
        '/leave-applications/' + detail.application.id + '/eligibility',
      )) as LeaveEligibilityOutcome;
      setPreview(value);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Eligibility could not be checked.');
    } finally {
      setPreviewLoading(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!detail) return;
    setBusy(true);
    resetAction();
    try {
      const value = (await post('/leave-applications/' + detail.application.id + '/submission', {
        formTemplateDocumentVersionId,
        attestation:
          attestationType === 'SIGNED_DOCUMENT'
            ? {
                type: 'SIGNED_DOCUMENT',
                documentId: attestationDocumentId,
                receivedAt: new Date(receivedAt).toISOString(),
              }
            : { type: 'AUTHENTICATED_SUBMISSION' },
      })) as LeaveApplicationDetail;
      setDetail(value);
      syncDraft(value);
      await refresh();
      setSuccess('The Leave Application was submitted.');
    } catch (reason: unknown) {
      setError(
        reason instanceof Error ? reason.message : 'The Leave Application could not be submitted.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!detail) return;
    setBusy(true);
    resetAction();
    try {
      const value = (await post('/leave-applications/' + detail.application.id + '/withdrawal', {
        reason: withdrawalReason,
        ...(withdrawalEvidenceDocumentId.trim()
          ? { evidenceDocumentId: withdrawalEvidenceDocumentId.trim() }
          : {}),
      })) as LeaveApplicationDetail;
      setDetail(value);
      syncDraft(value);
      await refresh();
      setSuccess('The Leave Application was withdrawn.');
    } catch (reason: unknown) {
      setError(
        reason instanceof Error ? reason.message : 'The Leave Application could not be withdrawn.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function appendDocument(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!detail) return;
    setBusy(true);
    resetAction();
    try {
      const value = (await post('/leave-applications/' + detail.application.id + '/documents', {
        documentId: appendDocumentId,
        purposeCode: appendPurposeCode,
      })) as LeaveApplicationDetail;
      syncedRecordId.current = value.application.id;
      setDetail(value);
      syncDraft(value);
      await refresh();
      setSuccess('The document was attached.');
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'The document could not be attached.');
    } finally {
      setBusy(false);
    }
  }

  const status = detail?.application.status ?? '';
  const editable = EDITABLE_STATUSES.includes(status);
  const withdrawable = WITHDRAWABLE_STATUSES.includes(status);

  return (
    <Dialog
      presentation="form"
      open={dialog !== null}
      onOpenChange={(open) => !open && closeDialog()}
    >
      <div hidden={dialog !== null} className="min-w-0 space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-5">
          <div className="grid max-w-[760px] gap-2">
            <p className="m-0 text-[11px] font-bold tracking-[0.09em] text-cobalt uppercase">
              Leave administration
            </p>
            <h1 className="m-0 text-[clamp(28px,3vw,38px)] leading-[1.08] font-[680] tracking-[-0.035em] text-midnight">
              Leave Applications
            </h1>
            <p className="m-0 text-sm leading-[1.65] text-muted">
              Prepare the facts of a leave request, check eligibility against the active Leave
              Policy, and submit an immutable Leave Application Version with attestation and
              approval routing.
            </p>
          </div>
          <DialogTrigger asChild>
            <Button
              onClick={() => {
                resetAction();
                void loadOptions();
                setEmployeeId('');
                setLeaveTypeId('');
                setDialog('prepare');
              }}
              size="default"
              type="button"
              variant="primary"
            >
              Prepare Leave Application
            </Button>
          </DialogTrigger>
        </header>

        {success ? (
          <p
            className="m-0 rounded-[3px] border border-[#b9d8c3] bg-[#f2faf4] px-4 py-3 text-sm text-[#316647]"
            role="status"
          >
            {success}
          </p>
        ) : null}

        {error && dialog === null ? <FormError message={error} /> : null}

        <section
          aria-labelledby="leave-applications-heading"
          className="overflow-hidden rounded-[5px] border border-line bg-paper"
        >
          <header className="flex min-h-[60px] flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
            <div className="grid gap-1">
              <h2 className="m-0 text-sm font-[670] text-midnight" id="leave-applications-heading">
                Leave Application register
              </h2>
              <span className="text-xs text-muted">
                {applications.length === 1
                  ? '1 Leave Application'
                  : applications.length + ' Leave Applications'}
              </span>
            </div>
          </header>
          {applications.length === 0 ? (
            <div className="grid min-h-[200px] place-content-center gap-2 px-6 py-12">
              <strong className="text-[15px] font-[650] text-midnight">
                No Leave Applications yet.
              </strong>
              <p className="m-0 max-w-[560px] text-[13px] leading-[1.6] text-muted">
                Prepare a Leave Application against an active Leave Policy Version, then submit it
                with the required evidence.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] border-collapse text-left text-sm">
                <thead className="bg-canvas text-[11px] tracking-[0.07em] text-muted uppercase">
                  <tr>
                    <th className="px-5 py-3 font-bold" scope="col">
                      Employee
                    </th>
                    <th className="px-5 py-3 font-bold" scope="col">
                      Leave type
                    </th>
                    <th className="px-5 py-3 font-bold" scope="col">
                      Status
                    </th>
                    <th className="px-5 py-3 font-bold" scope="col">
                      Periods
                    </th>
                    <th className="px-5 py-3 font-bold" scope="col">
                      Submitted
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {applications.map((application) => (
                    <tr key={application.id}>
                      <td className="px-5 py-4 align-top">
                        <div className="grid gap-1">
                          <button
                            className="w-fit cursor-pointer text-left font-[670] text-cobalt underline-offset-2 hover:underline"
                            type="button"
                            onClick={() => navigation.navigate({ record: application.id })}
                          >
                            {application.employeeName}
                          </button>
                          <span className="text-xs text-muted">{application.employeeNumber}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4 align-top">
                        <div className="grid gap-1">
                          <strong className="font-[650] text-midnight">
                            {application.leaveTypeName}
                          </strong>
                          <span className="text-xs text-muted">{application.leaveTypeCode}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4 align-top">
                        <span
                          className={
                            'inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold tracking-[0.07em] uppercase ' +
                            statusClass(application.status)
                          }
                        >
                          {application.status}
                        </span>
                      </td>
                      <td className="px-5 py-4 align-top text-xs text-ink">
                        {periodsLabel(application.periods)}
                      </td>
                      <td className="px-5 py-4 align-top text-xs text-muted">
                        {application.submittedAt ? instantLabel(application.submittedAt) : '—'}
                      </td>
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
          <RecordReturn href={navigation.href({ record: null })}>← Leave Applications</RecordReturn>
        </div>
      ) : null}

      <DialogContent aria-describedby="leave-application-dialog-description">
        <DialogHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="grid gap-1">
              <DialogTitle>
                {dialog === 'prepare'
                  ? 'Prepare Leave Application'
                  : (detail?.application.employeeName ?? 'Leave Application')}
              </DialogTitle>
              <DialogDescription id="leave-application-dialog-description">
                {dialog === 'prepare'
                  ? 'Start a draft for an Employee and Leave Type. The draft can be edited until it is submitted.'
                  : 'Draft facts, eligibility, submitted versions, and audit history.'}
              </DialogDescription>
            </div>
            <DialogClose asChild>
              <Button size="default" type="button" variant="secondary">
                Close
              </Button>
            </DialogClose>
          </div>
        </DialogHeader>

        {error && dialog !== null ? (
          <DialogBody className="pb-0">
            <FormError message={error} />
          </DialogBody>
        ) : null}

        {dialog === 'prepare' ? (
          <form onSubmit={(event) => void prepare(event)}>
            <DialogBody className="grid gap-5">
              {canRecordForOthers ? (
                <Field htmlFor="leave-application-employee" label="Employee">
                  <select
                    autoFocus
                    className={inputClass}
                    data-autofocus=""
                    id="leave-application-employee"
                    onChange={(event) => setEmployeeId(targetValue(event))}
                    required
                    value={employeeId}
                  >
                    <option value="">Select an Employee</option>
                    {employeeOptions.map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.employeeNumber} · {employee.legalName}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}
              <Field htmlFor="leave-application-leave-type" label="Leave type">
                <select
                  autoFocus={!canRecordForOthers}
                  className={inputClass}
                  data-autofocus={canRecordForOthers ? undefined : ''}
                  id="leave-application-leave-type"
                  onChange={(event) => setLeaveTypeId(targetValue(event))}
                  required
                  value={leaveTypeId}
                >
                  <option value="">Select a Leave Type</option>
                  {leaveTypeOptions.map((leaveType) => (
                    <option key={leaveType.id} value={leaveType.id}>
                      {leaveType.code} · {leaveType.name}
                    </option>
                  ))}
                </select>
              </Field>
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button disabled={busy} size="default" type="button" variant="secondary">
                  Cancel
                </Button>
              </DialogClose>
              <Button disabled={busy} size="default" type="submit" variant="primary">
                {busy ? 'Preparing…' : 'Prepare Leave Application'}
              </Button>
            </DialogFooter>
          </form>
        ) : null}

        {dialog === 'detail' ? (
          <DialogBody className="grid gap-6">
            {detailLoading || !detail ? (
              <p className="m-0 text-sm text-muted" role="status">
                Loading the Leave Application record…
              </p>
            ) : (
              <>
                {success ? (
                  <p
                    className="m-0 rounded-[3px] border border-[#b9d8c3] bg-[#f2faf4] px-4 py-3 text-sm text-[#316647]"
                    role="status"
                  >
                    {success}
                  </p>
                ) : null}

                <section
                  className="grid gap-3"
                  aria-labelledby="leave-application-snapshot-heading"
                >
                  <h3
                    className="m-0 text-sm font-[670] text-midnight"
                    id="leave-application-snapshot-heading"
                  >
                    {detail.application.employeeName} · {detail.application.leaveTypeName}
                  </h3>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span>{detail.application.employeeNumber}</span>
                    <span>{detail.application.leaveTypeCode}</span>
                    <span
                      className={
                        'inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold tracking-[0.07em] uppercase ' +
                        statusClass(detail.application.status)
                      }
                    >
                      {detail.application.status}
                    </span>
                    {detail.application.currentVersionNo !== null ? (
                      <span>Version {detail.application.currentVersionNo}</span>
                    ) : null}
                    <span>Prepared {instantLabel(detail.application.createdAt)}</span>
                    {detail.application.submittedAt ? (
                      <span>Submitted {instantLabel(detail.application.submittedAt)}</span>
                    ) : null}
                  </div>
                </section>

                {editable ? (
                  <form className="grid gap-4" onSubmit={(event) => void saveDraft(event)}>
                    <h3
                      className="m-0 text-sm font-[670] text-midnight"
                      id="leave-application-draft-heading"
                    >
                      Draft facts
                    </h3>
                    <Field htmlFor="leave-application-reason" label="Reason">
                      <input
                        className={inputClass}
                        id="leave-application-reason"
                        maxLength={1000}
                        onChange={(event) => setReason(targetValue(event))}
                        value={reason}
                      />
                    </Field>
                    <div className="grid gap-4 min-[621px]:grid-cols-2">
                      <Field htmlFor="leave-application-commutation" label="Commutation">
                        <select
                          className={inputClass}
                          id="leave-application-commutation"
                          onChange={(event) => setCommutationChoice(targetValue(event))}
                          value={commutationChoice}
                        >
                          <option value="">Not stated</option>
                          <option value="REQUESTED">Requested</option>
                          <option value="NOT_REQUESTED">Not requested</option>
                        </select>
                      </Field>
                      <Field htmlFor="leave-application-event" label="Qualifying event">
                        <select
                          className={inputClass}
                          id="leave-application-event"
                          onChange={(event) => setQualifyingEvent(targetValue(event))}
                          value={qualifyingEvent}
                        >
                          <option value="">Not applicable</option>
                          {QUALIFYING_EVENTS.map((event) => (
                            <option key={event} value={event}>
                              {humanize(event)}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </div>

                    <div className="grid gap-3">
                      <span className="text-[11px] font-bold tracking-[0.07em] text-muted uppercase">
                        Periods
                      </span>
                      {periodRows.map((period, index) => (
                        <div
                          className="grid items-end gap-3 min-[621px]:grid-cols-[1fr_1fr_auto]"
                          key={index}
                        >
                          <Field htmlFor={'leave-period-from-' + index} label="Period start">
                            <input
                              className={inputClass}
                              id={'leave-period-from-' + index}
                              onChange={(event) => {
                                const value = targetValue(event);
                                setPeriodRows((rows) =>
                                  rows.map((row, rowIndex) =>
                                    rowIndex === index ? { ...row, dateFrom: value } : row,
                                  ),
                                );
                              }}
                              type="date"
                              value={period.dateFrom}
                            />
                          </Field>
                          <Field htmlFor={'leave-period-to-' + index} label="Period end">
                            <input
                              className={inputClass}
                              id={'leave-period-to-' + index}
                              onChange={(event) => {
                                const value = targetValue(event);
                                setPeriodRows((rows) =>
                                  rows.map((row, rowIndex) =>
                                    rowIndex === index ? { ...row, dateTo: value } : row,
                                  ),
                                );
                              }}
                              type="date"
                              value={period.dateTo}
                            />
                          </Field>
                          <Button
                            className="min-h-9"
                            onClick={() =>
                              setPeriodRows((rows) =>
                                rows.filter((_, rowIndex) => rowIndex !== index),
                              )
                            }
                            size="default"
                            type="button"
                            variant="secondary"
                          >
                            Remove
                          </Button>
                        </div>
                      ))}
                      <div>
                        <Button
                          className="min-h-9"
                          onClick={() =>
                            setPeriodRows((rows) => [
                              ...rows,
                              { dateFrom: manilaToday(), dateTo: manilaToday() },
                            ])
                          }
                          size="default"
                          type="button"
                          variant="secondary"
                        >
                          Add period
                        </Button>
                      </div>
                    </div>

                    <div className="grid gap-3">
                      <span className="text-[11px] font-bold tracking-[0.07em] text-muted uppercase">
                        Evidence
                      </span>
                      {documentRows.map((document, index) => (
                        <div
                          className="grid items-end gap-3 min-[621px]:grid-cols-[1fr_1fr_auto]"
                          key={index}
                        >
                          <Field htmlFor={'leave-evidence-' + index} label="Evidence Document ID">
                            <input
                              className={inputClass}
                              id={'leave-evidence-' + index}
                              onChange={(event) => {
                                const value = targetValue(event);
                                setDocumentRows((rows) =>
                                  rows.map((row, rowIndex) =>
                                    rowIndex === index ? { ...row, documentId: value } : row,
                                  ),
                                );
                              }}
                              placeholder="00000000-0000-0000-0000-000000000000"
                              value={document.documentId}
                            />
                          </Field>
                          <Field
                            htmlFor={'leave-evidence-purpose-' + index}
                            label="Evidence purpose"
                          >
                            <select
                              className={inputClass}
                              id={'leave-evidence-purpose-' + index}
                              onChange={(event) => {
                                const value = targetValue(event);
                                setDocumentRows((rows) =>
                                  rows.map((row, rowIndex) =>
                                    rowIndex === index ? { ...row, purposeCode: value } : row,
                                  ),
                                );
                              }}
                              value={document.purposeCode}
                            >
                              {EVIDENCE_KINDS.map((kind) => (
                                <option key={kind} value={kind}>
                                  {humanize(kind)}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Button
                            className="min-h-9"
                            onClick={() =>
                              setDocumentRows((rows) =>
                                rows.filter((_, rowIndex) => rowIndex !== index),
                              )
                            }
                            size="default"
                            type="button"
                            variant="secondary"
                          >
                            Remove
                          </Button>
                        </div>
                      ))}
                      <div>
                        <Button
                          className="min-h-9"
                          onClick={() =>
                            setDocumentRows((rows) => [
                              ...rows,
                              { documentId: '', purposeCode: 'SIGNED_LEAVE_APPLICATION_FORM' },
                            ])
                          }
                          size="default"
                          type="button"
                          variant="secondary"
                        >
                          Add evidence
                        </Button>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button disabled={busy} size="default" type="submit" variant="secondary">
                        {busy ? 'Saving…' : 'Save draft'}
                      </Button>
                      <Button
                        disabled={previewLoading}
                        onClick={() => void checkEligibility()}
                        size="default"
                        type="button"
                        variant="secondary"
                      >
                        {previewLoading ? 'Checking…' : 'Check eligibility'}
                      </Button>
                    </div>

                    {preview ? (
                      <section
                        aria-labelledby="leave-eligibility-heading"
                        className="grid gap-3 rounded-[3px] border border-line bg-canvas px-4 py-4"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <h4
                            className="m-0 text-sm font-[670] text-midnight"
                            id="leave-eligibility-heading"
                          >
                            Eligibility
                          </h4>
                          <span
                            className={
                              'inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold tracking-[0.07em] uppercase ' +
                              eligibilityClass(preview.result)
                            }
                          >
                            {preview.result}
                          </span>
                          <span className="text-xs text-muted">
                            {preview.requestedQuantity === null
                              ? 'No quantity computed'
                              : quantityLabel(preview.requestedQuantity) +
                                ' ' +
                                humanize(preview.requestedUnit)}
                          </span>
                        </div>
                        {preview.missingFacts.length > 0 ? (
                          <ul className="m-0 grid list-disc gap-1 pl-5 text-xs text-muted">
                            {preview.missingFacts.map((fact) => (
                              <li key={fact.fact}>
                                <strong className="font-[650] text-ink">{fact.fact}</strong>{' '}
                                {fact.detail}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        <ul className="m-0 grid list-disc gap-1 pl-5 text-xs text-muted">
                          {preview.ruleResults.map((rule) => (
                            <li key={rule.rule}>
                              <strong className="font-[650] text-ink">{rule.rule}</strong>{' '}
                              {rule.outcome} · {rule.detail}
                            </li>
                          ))}
                        </ul>
                        {preview.segments.length > 0 ? (
                          <p className="m-0 text-xs text-muted">
                            Segments:{' '}
                            {preview.segments
                              .map(
                                (segment) =>
                                  `${dateLabel(segment.dateFrom)} – ${dateLabel(segment.dateTo)} (${quantityLabel(segment.requestedQuantity)} ${humanize(segment.requestedUnit)})`,
                              )
                              .join('; ')}
                          </p>
                        ) : null}
                      </section>
                    ) : null}
                  </form>
                ) : null}

                {editable && canSubmit ? (
                  <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
                    <h3
                      className="m-0 text-sm font-[670] text-midnight"
                      id="leave-submission-heading"
                    >
                      Submit
                    </h3>
                    <Field htmlFor="leave-form-template" label="Form template Document Version ID">
                      <input
                        className={inputClass}
                        id="leave-form-template"
                        onChange={(event) => setFormTemplateDocumentVersionId(targetValue(event))}
                        placeholder="00000000-0000-0000-0000-000000000000"
                        required
                        value={formTemplateDocumentVersionId}
                      />
                    </Field>
                    <Field htmlFor="leave-attestation" label="Attestation">
                      <select
                        className={inputClass}
                        id="leave-attestation"
                        onChange={(event) => setAttestationType(targetValue(event))}
                        value={attestationType}
                      >
                        <option value="AUTHENTICATED_SUBMISSION">Authenticated submission</option>
                        <option value="SIGNED_DOCUMENT">Signed document</option>
                      </select>
                    </Field>
                    {attestationType === 'SIGNED_DOCUMENT' ? (
                      <div className="grid gap-4 min-[621px]:grid-cols-2">
                        <Field htmlFor="leave-attestation-document" label="Signed document ID">
                          <input
                            className={inputClass}
                            id="leave-attestation-document"
                            onChange={(event) => setAttestationDocumentId(targetValue(event))}
                            placeholder="00000000-0000-0000-0000-000000000000"
                            required
                            value={attestationDocumentId}
                          />
                        </Field>
                        <Field htmlFor="leave-received-at" label="Received at">
                          <input
                            className={inputClass}
                            id="leave-received-at"
                            onChange={(event) => setReceivedAt(targetValue(event))}
                            required
                            type="datetime-local"
                            value={receivedAt}
                          />
                        </Field>
                      </div>
                    ) : null}
                    <div>
                      <Button disabled={busy} size="default" type="submit" variant="primary">
                        {busy ? 'Submitting…' : 'Submit application'}
                      </Button>
                    </div>
                  </form>
                ) : null}

                {withdrawable && canWithdraw ? (
                  <form className="grid gap-4" onSubmit={(event) => void withdraw(event)}>
                    <h3
                      className="m-0 text-sm font-[670] text-midnight"
                      id="leave-withdrawal-heading"
                    >
                      Withdraw
                    </h3>
                    <Field htmlFor="leave-withdrawal-reason" label="Withdrawal reason">
                      <input
                        className={inputClass}
                        id="leave-withdrawal-reason"
                        maxLength={1000}
                        onChange={(event) => setWithdrawalReason(targetValue(event))}
                        required
                        value={withdrawalReason}
                      />
                    </Field>
                    <Field
                      htmlFor="leave-withdrawal-evidence"
                      label="Withdrawal evidence Document ID (optional)"
                    >
                      <input
                        className={inputClass}
                        id="leave-withdrawal-evidence"
                        onChange={(event) => setWithdrawalEvidenceDocumentId(targetValue(event))}
                        placeholder="00000000-0000-0000-0000-000000000000"
                        value={withdrawalEvidenceDocumentId}
                      />
                    </Field>
                    <div>
                      <Button disabled={busy} size="default" type="submit" variant="secondary">
                        {busy ? 'Withdrawing…' : 'Withdraw application'}
                      </Button>
                    </div>
                  </form>
                ) : null}

                {detail.application.currentVersionId && !editable ? (
                  <form className="grid gap-4" onSubmit={(event) => void appendDocument(event)}>
                    <h3
                      className="m-0 text-sm font-[670] text-midnight"
                      id="leave-document-heading"
                    >
                      Attach document
                    </h3>
                    <div className="grid items-end gap-4 min-[621px]:grid-cols-2">
                      <Field htmlFor="leave-document-id" label="Document ID">
                        <input
                          className={inputClass}
                          id="leave-document-id"
                          onChange={(event) => setAppendDocumentId(targetValue(event))}
                          placeholder="00000000-0000-0000-0000-000000000000"
                          required
                          value={appendDocumentId}
                        />
                      </Field>
                      <Field htmlFor="leave-document-purpose" label="Purpose">
                        <select
                          className={inputClass}
                          id="leave-document-purpose"
                          onChange={(event) => setAppendPurposeCode(targetValue(event))}
                          value={appendPurposeCode}
                        >
                          {DOCUMENT_PURPOSES.map((purpose) => (
                            <option key={purpose} value={purpose}>
                              {humanize(purpose)}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </div>
                    <div>
                      <Button disabled={busy} size="default" type="submit" variant="secondary">
                        {busy ? 'Attaching…' : 'Attach document'}
                      </Button>
                    </div>
                  </form>
                ) : null}

                <section className="grid gap-3" aria-labelledby="leave-versions-heading">
                  <h3 className="m-0 text-sm font-[670] text-midnight" id="leave-versions-heading">
                    Leave Application Versions
                  </h3>
                  {detail.versions.length === 0 ? (
                    <p className="m-0 text-xs text-muted">No versions submitted.</p>
                  ) : (
                    <div className="grid gap-3">
                      {detail.versions.map((version) => {
                        const assessment = version.assessments.at(-1);
                        return (
                          <article
                            className="grid gap-2 rounded-[3px] border border-line bg-canvas px-4 py-3"
                            key={version.id}
                          >
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <strong className="font-[670] text-midnight">
                                Version {version.versionNo}
                              </strong>
                              <span className="text-muted">{version.leaveTypeCode}</span>
                              <span
                                className={
                                  'inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold tracking-[0.07em] uppercase ' +
                                  statusClass(version.approvalRequestStatus)
                                }
                              >
                                {version.approvalRequestStatus}
                              </span>
                              <span className="text-muted">
                                {humanize(version.attestationType)}
                              </span>
                              <span className="text-muted">
                                {humanize(version.submissionMethod)}
                              </span>
                            </div>
                            <p className="m-0 text-xs text-muted">
                              {periodsLabel(version.periods)}
                            </p>
                            <p className="m-0 text-xs text-muted">
                              Route {version.approvalRouteCode} · Submitted by{' '}
                              {version.submittedByName ?? version.submittedByMembershipId} ·
                              Received {instantLabel(version.receivedAt)}
                            </p>
                            {version.reason ? (
                              <p className="m-0 text-xs text-muted">Reason: {version.reason}</p>
                            ) : null}
                            {version.commutationChoice ? (
                              <p className="m-0 text-xs text-muted">
                                Commutation: {humanize(version.commutationChoice)}
                              </p>
                            ) : null}
                            {version.documents.length > 0 ? (
                              <p className="m-0 text-xs text-muted">
                                Documents:{' '}
                                {version.documents
                                  .map(
                                    (document) =>
                                      `${humanize(document.purposeCode)} (${document.documentNo ?? document.documentType ?? document.documentVersionId.slice(0, 8)})`,
                                  )
                                  .join('; ')}
                              </p>
                            ) : null}
                            {assessment ? (
                              <p className="m-0 text-xs text-muted">
                                Eligibility {assessment.result} · assessed{' '}
                                {instantLabel(assessment.assessedAt)}
                              </p>
                            ) : null}
                            {version.calculationSegments.length > 0 ? (
                              <p className="m-0 text-xs text-muted">
                                Quantity:{' '}
                                {version.calculationSegments
                                  .map(
                                    (segment) =>
                                      `${quantityLabel(segment.requestedQuantity)} ${humanize(segment.requestedUnit)}`,
                                  )
                                  .join('; ')}
                              </p>
                            ) : null}
                          </article>
                        );
                      })}
                    </div>
                  )}
                </section>

                <section className="grid gap-3" aria-labelledby="leave-history-heading">
                  <h3 className="m-0 text-sm font-[670] text-midnight" id="leave-history-heading">
                    History
                  </h3>
                  {detail.history.length === 0 ? (
                    <p className="m-0 text-xs text-muted">No history recorded.</p>
                  ) : (
                    <ol className="m-0 grid list-none gap-2 p-0">
                      {detail.history.map((entry) => (
                        <li className="grid gap-1 text-xs" key={entry.id}>
                          <span className="font-[650] text-ink">
                            {humanize(entry.action)}
                            {entry.previousStatus || entry.newStatus
                              ? ` · ${entry.previousStatus ?? '—'} → ${entry.newStatus ?? '—'}`
                              : ''}
                          </span>
                          <span className="text-muted">
                            {instantLabel(entry.occurredAt)}
                            {entry.reason ? ' · ' + entry.reason : ''}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              </>
            )}
          </DialogBody>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
