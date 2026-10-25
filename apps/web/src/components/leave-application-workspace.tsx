'use client';

import { Field, inputClass, FormError } from './ui/field';
import { useRecordNavigation } from './record-navigation';
import { StateSurface } from './state-surface';
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
import { PageHeader, type Breadcrumb } from './ui/page-header';
import { Panel } from './ui/panel';
import { StatusTag, type StatusTone } from './ui/status-tag';
import { RowHeader, Table, Td, Th, Tr } from './ui/table';
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
  allocationKinds: string[];
}

export interface LeaveCreditCertificationLine {
  id: string;
  leaveAccountId: string;
  leaveTypeCode: string;
  leaveTypeName: string;
  postedBalance: string;
  activeCommitments: string;
  applicationQuantity: string;
  availableAfterApplication: string;
  leaveCreditCommitmentId: string;
}

export interface LeaveCreditCertification {
  id: string;
  eligibilityAssessmentId: string;
  approvalDecisionId: string;
  balanceAsOf: string;
  ledgerRecordedThrough: string;
  certifiedByMembershipId: string;
  certifiedByName: string | null;
  certifiedAt: string;
  lines: LeaveCreditCertificationLine[];
}

export interface LeaveRecommendation {
  id: string;
  approvalDecisionId: string;
  outcome: string;
  reason: string | null;
  recommendedAt: string;
}

export interface LeaveApprovalAllocationLine {
  id: string;
  sequenceNo: number;
  dateFrom: string;
  dateTo: string;
  allocationKind: string;
  policyVersionId: string;
  leaveAccountId: string | null;
  quantity: string;
  unitCode: string;
}

export interface LeaveApprovalAllocation {
  id: string;
  approvalDecisionId: string;
  decidedAt: string;
  lines: LeaveApprovalAllocationLine[];
}

export interface LeaveApprovalDecision {
  id: string;
  decidedByMembershipId: string;
  decidedByName: string | null;
  decision: string;
  comments: string | null;
  decidedAt: string;
}

export interface LeaveApprovalStep {
  id: string;
  stepNo: number;
  status: string;
  requiredPermission: string;
  approvePermission: string;
  returnPermission: string;
  rejectPermission: string;
  assignedRoleCode: string | null;
  assignedMembershipId: string | null;
  requiresSeparateReview: boolean;
  activatedAt: string | null;
  completedAt: string | null;
  decisions: LeaveApprovalDecision[];
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
  certification: LeaveCreditCertification | null;
  recommendation: LeaveRecommendation | null;
  approvalAllocation: LeaveApprovalAllocation | null;
  posting: {
    id: string;
    postedAt: string;
    effects: { effectKind: string; effectKey: string; ownerRecordId: string }[];
  } | null;
  approvalSteps: LeaveApprovalStep[];
}

export interface LeaveCancellationScope {
  id: string;
  allocationLineId: string;
  allocationKind: string;
  unitCode: string;
  dateFrom: string;
  dateTo: string;
  quantity: string;
}

export interface LeaveCancellationEffect {
  id: string;
  effectKind: string;
  effectKey: string;
  ownerRecordId: string;
  ownerStatus: string;
  /** Current status of a locked Attendance handoff; null for other effects. */
  attendanceHandoff: {
    correctionId: string;
    status: string;
    blockingReason: string | null;
    blockedAt: string | null;
  } | null;
}

export interface LeaveCancellation {
  id: string;
  leaveApplicationVersionId: string;
  priorStatus: string;
  scopeType: string;
  reason: string;
  approvalRouteCode: string;
  approvalRequestStatus: string;
  decisionStatus: string;
  effectStatus: string;
  lastEffectFailureCode: string | null;
  lastEffectFailureKind: string | null;
  effects: LeaveCancellationEffect[];
  requestedByMembershipId: string;
  requestedByName: string | null;
  requestedAt: string;
  documents: LeaveApplicationDocument[];
  scopes: LeaveCancellationScope[];
  approvalSteps: LeaveApprovalStep[];
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
  canPost: boolean;
  application: LeaveApplication;
  draftPeriods: LeaveApplicationPeriod[];
  draftDocuments: LeaveApplicationDocument[];
  versions: LeaveApplicationVersion[];
  cancellations: LeaveCancellation[];
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

interface AllocationRow {
  quantity: string;
}

interface CancellationScopeRow {
  selected: boolean;
  dateFrom: string;
  dateTo: string;
  quantity: string;
}

type DialogKind =
  | 'detail'
  | 'prepare'
  | 'route'
  | 'certify'
  | 'recommend'
  | 'decision'
  | 'return'
  | 'cancelRequest'
  | 'cancelDecision'
  | null;

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

const REVIEW_STATUSES = ['FOR_CERTIFICATION', 'FOR_RECOMMENDATION', 'FOR_APPROVAL'];
const EDITABLE_STATUSES = ['DRAFT', 'NEEDS_INFORMATION'];
const WITHDRAWABLE_STATUSES = [
  'SUBMITTED',
  'FOR_CERTIFICATION',
  'FOR_RECOMMENDATION',
  'FOR_APPROVAL',
  'NEEDS_INFORMATION',
];

const sectionTitleClass = 'm-0 text-panel-title text-ink';
const successClass =
  'm-0 rounded-control border border-success/40 bg-success/5 px-3 py-2.5 text-small text-success';

function statusTone(status: string): StatusTone {
  if (['APPROVED', 'POSTED'].includes(status)) return 'success';
  if (['REJECTED', 'CANCELLED'].includes(status)) return 'danger';
  if (['WITHDRAWN', 'DRAFT'].includes(status)) return 'neutral';
  return 'warning';
}

function decisionTone(status: string): StatusTone {
  if (status === 'APPROVED') return 'success';
  if (status === 'REJECTED') return 'danger';
  return 'warning';
}

function eligibilityTone(result: string): StatusTone {
  if (result === 'ELIGIBLE') return 'success';
  if (result === 'INELIGIBLE') return 'danger';
  return 'warning';
}

function cancellationEffectLabel(effectKind: string): string {
  switch (effectKind) {
    case 'LEDGER_REVERSAL':
      return 'Leave Ledger reversal';
    case 'LEDGER_REPLACEMENT':
      return 'Leave Ledger replacement';
    case 'ATTENDANCE_CORRECTION':
      return 'Attendance successor input';
    case 'ATTENDANCE_LOCKED_CORRECTION':
      return 'Locked Attendance adjustment';
    default:
      return humanize(effectKind);
  }
}

function cancellationEffectText(effect: LeaveCancellationEffect): string {
  if (effect.effectKind === 'COMMITMENT_RELEASE') return 'Commitment released';
  const handoff = effect.attendanceHandoff;
  if (!handoff) {
    return `${cancellationEffectLabel(effect.effectKind)} · ${humanize(effect.ownerStatus)} · ${effect.ownerRecordId}`;
  }
  const status =
    handoff.status === 'FOR_AUTHORIZATION'
      ? `awaiting HR Administrator authorization${handoff.blockingReason ? ` · Blocked: ${handoff.blockingReason}` : ''}`
      : handoff.status === 'APPLIED'
        ? 'authorized and applied'
        : humanize(handoff.status);
  return `${cancellationEffectLabel(effect.effectKind)} · ${status} · ${handoff.correctionId}`;
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

function targetChecked(event: { currentTarget: EventTarget }): boolean {
  return (event.currentTarget as unknown as { checked: boolean }).checked;
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
  canRoute,
  canCertify,
  canRecommend,
  canApprove,
  canReject,
  canReturn,
  canRequestCancel,
  canCancel,
  canRejectCancel,
  canApplyCancellation,
}: {
  agencyId: string;
  initial: LeaveApplicationListResponse;
  canRecordForOthers: boolean;
  canSubmit: boolean;
  canWithdraw: boolean;
  canRoute: boolean;
  canCertify: boolean;
  canRecommend: boolean;
  canApprove: boolean;
  canReject: boolean;
  canReturn: boolean;
  canRequestCancel: boolean;
  canCancel: boolean;
  canRejectCancel: boolean;
  canApplyCancellation: boolean;
}) {
  const postingKeys = useRef<Record<string, string>>({});
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
  const [balanceAsOf, setBalanceAsOf] = useState('');
  const [recommendationOutcome, setRecommendationOutcome] = useState('RECOMMEND_APPROVAL');
  const [recommendationReason, setRecommendationReason] = useState('');
  const [recommendationComments, setRecommendationComments] = useState('');
  const [decisionKind, setDecisionKind] = useState('APPROVE');
  const [decisionComments, setDecisionComments] = useState('');
  const [fullApproval, setFullApproval] = useState(true);
  const [allocationRows, setAllocationRows] = useState<Record<string, AllocationRow>>({});
  const [cancelScopeType, setCancelScopeType] = useState('WHOLE');
  const [cancelReason, setCancelReason] = useState('');
  const [cancelEvidenceDocumentId, setCancelEvidenceDocumentId] = useState('');
  const [cancelScopeRows, setCancelScopeRows] = useState<Record<string, CancellationScopeRow>>({});
  const [cancelDecisionKind, setCancelDecisionKind] = useState('APPROVE');
  const [cancelDecisionComments, setCancelDecisionComments] = useState('');
  const [returnReason, setReturnReason] = useState('');
  const [returnComments, setReturnComments] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState('');
  const optionsRequested = useRef(false);
  const syncedRecordId = useRef<string | null>(null);
  const prefill = useRef<{ employeeId: string; leaveTypeCode: string } | null>(null);

  // `?prepare=1&employeeId=…&leaveType=CODE` opens the prepare form preselected, as the
  // Mandatory Leave workspace links here to start fulfillment with an ordinary application.
  useEffect(() => {
    if (navigation.search.get('prepare') !== '1') return;
    prefill.current = {
      employeeId: navigation.search.get('employeeId') ?? '',
      leaveTypeCode: navigation.search.get('leaveType') ?? '',
    };
    navigation.show({ prepare: null, employeeId: null, leaveType: null });
    resetAction();
    void loadOptions();
    setDialog('prepare');
  }, []);

  useEffect(() => {
    const pending = prefill.current;
    if (!pending || leaveTypeOptions.length === 0) return;
    prefill.current = null;
    const leaveType = leaveTypeOptions.find(({ code }) => code === pending.leaveTypeCode);
    if (leaveType) setLeaveTypeId(leaveType.id);
    if (!canRecordForOthers || !pending.employeeId) return;
    if (employeeOptions.some(({ id }) => id === pending.employeeId)) {
      setEmployeeId(pending.employeeId);
      return;
    }
    // The option list holds one page; fetch an Employee outside it rather than drop the choice.
    void request('/employees/' + encodeURIComponent(pending.employeeId))
      .then((value) => {
        const employee = value as EmployeeOption;
        setEmployeeOptions((current) => [employee, ...current]);
        // Keep a choice the user made while the lookup was pending.
        setEmployeeId((current) => current || employee.id);
      })
      .catch(() => undefined);
  }, [employeeOptions, leaveTypeOptions]);

  useEffect(() => {
    let active = true;
    if (!recordId) {
      syncedRecordId.current = null;
      setDetail(null);
      // The register link and browser Back clear `record`; close whatever record work was open.
      setDialog((current) => (current === 'prepare' ? current : null));
      setSuccess('');
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
      headers: {
        'Idempotency-Key': path.endsWith('/posting')
          ? (postingKeys.current[path] ??= crypto.randomUUID())
          : crypto.randomUUID(),
      },
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

  function currentVersion(): LeaveApplicationVersion | null {
    if (!detail?.application.currentVersionId) return null;
    return detail.versions.find(({ id }) => id === detail.application.currentVersionId) ?? null;
  }

  function openDecision(): void {
    const version = currentVersion();
    const rows: Record<string, AllocationRow> = {};
    for (const segment of version?.calculationSegments ?? []) {
      rows[segment.id] = { quantity: segment.requestedQuantity };
    }
    resetAction();
    setDecisionKind('APPROVE');
    setDecisionComments('');
    setFullApproval(true);
    setAllocationRows(rows);
    setDialog('decision');
  }

  function openCancelRequest(): void {
    const rows: Record<string, CancellationScopeRow> = {};
    for (const line of currentVersion()?.approvalAllocation?.lines ?? []) {
      rows[line.id] = {
        selected: false,
        dateFrom: line.dateFrom,
        dateTo: line.dateTo,
        quantity: line.quantity,
      };
    }
    resetAction();
    setCancelScopeType('WHOLE');
    setCancelReason('');
    setCancelEvidenceDocumentId('');
    setCancelScopeRows(rows);
    setDialog('cancelRequest');
  }

  function cancellationScopesPayload(): Array<Record<string, unknown>> {
    return Object.entries(cancelScopeRows)
      .filter(([, row]) => row.selected)
      .map(([allocationLineId, row]) => ({
        allocationLineId,
        dateFrom: row.dateFrom,
        dateTo: row.dateTo,
        quantity: row.quantity.trim(),
      }));
  }

  function openCancelDecision(kind: 'APPROVE' | 'REJECT'): void {
    resetAction();
    setCancelDecisionKind(kind);
    setCancelDecisionComments('');
    setDialog('cancelDecision');
  }

  function allocationPayload(): Array<Record<string, unknown>> {
    const version = currentVersion();
    const payload: Array<Record<string, unknown>> = [];
    for (const segment of version?.calculationSegments ?? []) {
      const row = allocationRows[segment.id];
      const quantity = row?.quantity.trim() ?? '';
      if (!row || !quantity) continue;
      payload.push({ segmentId: segment.id, quantity });
    }
    return payload;
  }

  function allocationKindLabel(segment: LeaveCalculationSegment): string {
    if (segment.allocationKinds.includes('LEAVE_ACCOUNT')) {
      return 'Charges certified leave credits; any uncovered excess becomes leave without pay.';
    }
    if (segment.allocationKinds.includes('NON_CREDIT')) {
      return 'Approved outside the leave-credit ledger; nothing is charged to an account.';
    }
    return 'Approved as leave without pay.';
  }

  async function review(
    command:
      | 'posting'
      | 'routing'
      | 'certification'
      | 'recommendation'
      | 'decision'
      | 'return'
      | 'cancellation-requests'
      | 'cancellation-decisions',
    body: Record<string, unknown>,
    message: string,
    failure: string,
  ): Promise<void> {
    if (!detail) return;
    setBusy(true);
    resetAction();
    try {
      const value = (await post(
        '/leave-applications/' + detail.application.id + '/' + command,
        body,
      )) as LeaveApplicationDetail;
      setDetail(value);
      syncDraft(value);
      await refresh();
      setDialog('detail');
      setSuccess(message);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : failure);
    } finally {
      setBusy(false);
    }
  }

  async function routeApplication(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await review(
      'routing',
      {},
      'The Leave Application was sent for credit certification.',
      'The Leave Application could not be routed.',
    );
  }

  async function certifyApplication(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await review(
      'certification',
      balanceAsOf ? { balanceAsOf } : {},
      'The leave credits were certified.',
      'The leave credits could not be certified.',
    );
  }

  async function recommendApplication(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await review(
      'recommendation',
      {
        outcome: recommendationOutcome,
        ...(recommendationReason.trim() ? { reason: recommendationReason.trim() } : {}),
        ...(recommendationComments.trim() ? { comments: recommendationComments.trim() } : {}),
      },
      'The recommendation was recorded.',
      'The recommendation could not be recorded.',
    );
  }

  async function decideApplication(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await review(
      'decision',
      {
        decision: decisionKind,
        ...(decisionComments.trim() ? { comments: decisionComments.trim() } : {}),
        ...(decisionKind === 'APPROVE' && !fullApproval
          ? { allocations: allocationPayload() }
          : {}),
      },
      decisionKind === 'APPROVE'
        ? 'The Leave Application was approved.'
        : 'The Leave Application was rejected.',
      'The decision could not be recorded.',
    );
  }

  async function requestCancellation(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await review(
      'cancellation-requests',
      {
        scopeType: cancelScopeType,
        reason: cancelReason.trim(),
        ...(cancelEvidenceDocumentId.trim()
          ? { evidenceDocumentId: cancelEvidenceDocumentId.trim() }
          : {}),
        ...(cancelScopeType === 'PARTIAL' ? { scopes: cancellationScopesPayload() } : {}),
      },
      'The cancellation was requested.',
      'The cancellation could not be requested.',
    );
  }

  async function decideCancellation(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await review(
      'cancellation-decisions',
      {
        decision: cancelDecisionKind,
        ...(cancelDecisionComments.trim() ? { comments: cancelDecisionComments.trim() } : {}),
      },
      cancelDecisionKind === 'APPROVE'
        ? 'The cancellation was approved; its effects are pending.'
        : 'The cancellation was rejected.',
      'The cancellation decision could not be recorded.',
    );
  }

  async function applyCancellation(cancellation: LeaveCancellation): Promise<void> {
    if (!detail || busy) return;
    setBusy(true);
    resetAction();
    try {
      const value = (await request(
        '/leave-applications/' +
          detail.application.id +
          '/cancellations/' +
          cancellation.id +
          '/apply',
        {
          method: 'POST',
          headers: { 'Idempotency-Key': 'LEAVE_CANCELLATION_APPLY:' + cancellation.id },
        },
      )) as LeaveApplicationDetail;
      setDetail(value);
      syncDraft(value);
      const attendancePending = value.cancellations
        .find(({ id }) => id === cancellation.id)
        ?.effects.some(
          ({ attendanceHandoff }) => attendanceHandoff?.status === 'FOR_AUTHORIZATION',
        );
      setSuccess(
        attendancePending
          ? 'The Leave effects were applied. Attendance awaits HR Administrator authorization.'
          : 'The cancellation was applied.',
      );
      await refresh().catch(() => {
        setError(
          'The cancellation was applied, but the register could not be refreshed. Reload this page.',
        );
      });
    } catch (reason: unknown) {
      // Reload the recorded failure after the authoritative transaction rolled back.
      await refresh().catch(() => undefined);
      setError(reason instanceof Error ? reason.message : 'The cancellation could not be applied.');
    } finally {
      setBusy(false);
    }
  }

  async function returnApplication(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await review(
      'return',
      {
        reason: returnReason.trim(),
        ...(returnComments.trim() ? { comments: returnComments.trim() } : {}),
      },
      'The Leave Application was returned for material information.',
      'The Leave Application could not be returned.',
    );
  }

  const status = detail?.application.status ?? '';
  const editable = EDITABLE_STATUSES.includes(status);
  const withdrawable = WITHDRAWABLE_STATUSES.includes(status);
  const reviewable = REVIEW_STATUSES.includes(status);
  const cancellable = status === 'APPROVED' || status === 'POSTED';
  const openCancellation =
    status === 'CANCEL_REQUESTED'
      ? (detail?.cancellations.find(({ decisionStatus }) => decisionStatus === 'REQUESTED') ?? null)
      : null;

  const breadcrumbs: Breadcrumb[] = [{ label: 'Leave' }];
  if (recordId) {
    breadcrumbs.push(
      { label: 'Leave Applications', href: navigation.href({ record: null }) },
      { label: detail?.application.employeeName ?? 'Leave Application' },
    );
  } else if (dialog === 'prepare') {
    // Preparing a draft leaves the URL alone, so there is no register link to follow.
    breadcrumbs.push({ label: 'Leave Applications' }, { label: 'Prepare' });
  } else {
    breadcrumbs.push({ label: 'Leave Applications' });
  }

  return (
    <Dialog
      presentation="form"
      open={dialog !== null}
      onOpenChange={(open) => !open && closeDialog()}
    >
      <div className="grid min-w-0 gap-5">
        <PageHeader
          breadcrumbs={breadcrumbs}
          title="Leave Applications"
          actions={
            <DialogTrigger asChild>
              <Button
                // Hidden rather than unmounted, so focus can return here when the form closes.
                hidden={dialog !== null}
                onClick={() => {
                  resetAction();
                  void loadOptions();
                  setEmployeeId('');
                  setLeaveTypeId('');
                  setDialog('prepare');
                }}
                type="button"
                variant="primary"
              >
                Prepare Leave Application
              </Button>
            </DialogTrigger>
          }
        />

        <div hidden={dialog !== null} className="grid gap-5">
          <p className="m-0 max-w-[80ch] text-small text-ink-muted">
            Prepare the facts of a leave request, check eligibility against the active Leave Policy,
            and submit an immutable Leave Application Version with attestation and approval routing.
          </p>

          {success ? (
            <p className={successClass} role="status">
              {success}
            </p>
          ) : null}

          {dialog === null ? <FormError message={error} /> : null}

          <Panel
            title="Leave Application register"
            flush
            actions={
              <span className="text-caption text-ink-muted">
                {applications.length === 1
                  ? '1 Leave Application'
                  : applications.length + ' Leave Applications'}
              </span>
            }
          >
            {applications.length === 0 ? (
              <StateSurface compact label="No Leave Applications">
                <strong className="text-body font-[650] text-ink">
                  No Leave Applications yet.
                </strong>
                <p className="m-0 max-w-[560px]">
                  Prepare a Leave Application against an active Leave Policy Version, then submit it
                  with the required evidence.
                </p>
              </StateSurface>
            ) : (
              <Table className="min-w-[860px]">
                <thead>
                  <tr>
                    <Th>Employee</Th>
                    <Th>Leave type</Th>
                    <Th>Status</Th>
                    <Th>Periods</Th>
                    <Th kind="date">Submitted</Th>
                  </tr>
                </thead>
                <tbody>
                  {applications.map((application) => (
                    <Tr key={application.id}>
                      <RowHeader>
                        <button
                          className="cursor-pointer border-0 bg-transparent p-0 text-left text-small font-[600] text-primary underline-offset-2 hover:underline"
                          type="button"
                          onClick={() => navigation.navigate({ record: application.id })}
                        >
                          {application.employeeName}
                        </button>
                        <span className="block text-caption font-normal text-ink-muted">
                          {application.employeeNumber}
                        </span>
                      </RowHeader>
                      <Td>
                        {application.leaveTypeName}
                        <span className="block text-caption text-ink-muted">
                          {application.leaveTypeCode}
                        </span>
                      </Td>
                      <Td>
                        <StatusTag tone={statusTone(application.status)}>
                          {application.status}
                        </StatusTag>
                      </Td>
                      <Td>{periodsLabel(application.periods)}</Td>
                      <Td kind="date" className="text-ink-muted">
                        {application.submittedAt ? instantLabel(application.submittedAt) : '—'}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>
        </div>

        <DialogContent aria-describedby="leave-application-dialog-description">
          <DialogHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="grid gap-1">
                <DialogTitle>
                  {dialog === 'prepare'
                    ? 'Prepare Leave Application'
                    : dialog === 'route'
                      ? 'Send for credit certification'
                      : dialog === 'certify'
                        ? 'Certify leave credits'
                        : dialog === 'recommend'
                          ? 'Recommend the Leave Application'
                          : dialog === 'decision'
                            ? 'Record the final decision'
                            : dialog === 'return'
                              ? 'Return for material information'
                              : dialog === 'cancelRequest'
                                ? 'Request cancellation'
                                : dialog === 'cancelDecision'
                                  ? 'Decide the cancellation'
                                  : (detail?.application.employeeName ?? 'Leave Application')}
                </DialogTitle>
                <DialogDescription id="leave-application-dialog-description">
                  {dialog === 'prepare'
                    ? 'Start a draft for an Employee and Leave Type. The draft can be edited until it is submitted.'
                    : dialog === 'detail'
                      ? 'Draft facts, eligibility, submitted versions, and audit history.'
                      : 'The submitted version changes only when the command succeeds.'}
                </DialogDescription>
              </div>
              <DialogClose asChild>
                <Button type="button" variant="secondary">
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
                  <Button disabled={busy} type="button" variant="secondary">
                    Cancel
                  </Button>
                </DialogClose>
                <Button disabled={busy} type="submit" variant="primary">
                  {busy ? 'Preparing…' : 'Prepare Leave Application'}
                </Button>
              </DialogFooter>
            </form>
          ) : null}

          {dialog === 'route' ? (
            <form onSubmit={(event) => void routeApplication(event)}>
              <DialogBody className="grid gap-4">
                <p className="m-0 text-small text-ink-muted">
                  Routing activates the credit certification step on the submitted version. The
                  Employee and the submitted facts stay unchanged.
                </p>
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button disabled={busy} type="button" variant="secondary">
                    Cancel
                  </Button>
                </DialogClose>
                <Button disabled={busy} type="submit" variant="primary">
                  {busy ? 'Routing…' : 'Send for certification'}
                </Button>
              </DialogFooter>
            </form>
          ) : null}

          {dialog === 'certify' ? (
            <form onSubmit={(event) => void certifyApplication(event)}>
              <DialogBody className="grid gap-5">
                <p className="m-0 text-small text-ink-muted">
                  Certification attests the posted balances and other active commitments of every
                  charged Leave Account, then freezes one Leave Credit Commitment per account. A
                  later posting, version, or commitment release requires recertification.
                </p>
                <Field
                  htmlFor="leave-certification-balance"
                  label="Effective balance date (optional)"
                >
                  <input
                    autoFocus
                    className={inputClass}
                    data-autofocus=""
                    id="leave-certification-balance"
                    onChange={(event) => setBalanceAsOf(targetValue(event))}
                    type="date"
                    value={balanceAsOf}
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
                  {busy ? 'Certifying…' : 'Certify credits'}
                </Button>
              </DialogFooter>
            </form>
          ) : null}

          {dialog === 'recommend' ? (
            <form onSubmit={(event) => void recommendApplication(event)}>
              <DialogBody className="grid gap-5">
                <div className="grid gap-4 min-[621px]:grid-cols-2">
                  <Field htmlFor="leave-recommendation-outcome" label="Recommendation">
                    <select
                      autoFocus
                      className={inputClass}
                      data-autofocus=""
                      id="leave-recommendation-outcome"
                      onChange={(event) => setRecommendationOutcome(targetValue(event))}
                      value={recommendationOutcome}
                    >
                      <option value="RECOMMEND_APPROVAL">Recommend approval</option>
                      <option value="RECOMMEND_REJECTION">Recommend rejection</option>
                    </select>
                  </Field>
                  <Field htmlFor="leave-recommendation-comments" label="Comments (optional)">
                    <input
                      className={inputClass}
                      id="leave-recommendation-comments"
                      maxLength={1000}
                      onChange={(event) => setRecommendationComments(targetValue(event))}
                      value={recommendationComments}
                    />
                  </Field>
                </div>
                <Field
                  htmlFor="leave-recommendation-reason"
                  label={
                    recommendationOutcome === 'RECOMMEND_REJECTION' ? 'Reason' : 'Reason (optional)'
                  }
                >
                  <input
                    className={inputClass}
                    id="leave-recommendation-reason"
                    maxLength={1000}
                    onChange={(event) => setRecommendationReason(targetValue(event))}
                    required={recommendationOutcome === 'RECOMMEND_REJECTION'}
                    value={recommendationReason}
                  />
                </Field>
                <p className="m-0 text-small text-ink-muted">
                  The recommendation is advisory. A negative recommendation still continues to the
                  authorized official unless the bound route says otherwise.
                </p>
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button disabled={busy} type="button" variant="secondary">
                    Cancel
                  </Button>
                </DialogClose>
                <Button disabled={busy} type="submit" variant="primary">
                  {busy ? 'Recording…' : 'Record recommendation'}
                </Button>
              </DialogFooter>
            </form>
          ) : null}

          {dialog === 'decision' ? (
            <form onSubmit={(event) => void decideApplication(event)}>
              <DialogBody className="grid gap-5">
                <Field htmlFor="leave-decision-kind" label="Decision">
                  <select
                    className={inputClass}
                    id="leave-decision-kind"
                    onChange={(event) => setDecisionKind(targetValue(event))}
                    value={decisionKind}
                  >
                    <option value="APPROVE">Approve</option>
                    <option value="REJECT">Reject</option>
                  </select>
                </Field>
                {decisionKind === 'APPROVE' ? (
                  <>
                    <label className="flex items-center gap-2 text-small text-ink">
                      <input
                        checked={fullApproval}
                        onChange={(event) => setFullApproval(targetChecked(event))}
                        type="checkbox"
                      />
                      Approve the full requested quantity
                    </label>
                    {!fullApproval ? (
                      <div className="grid gap-3">
                        <span className="text-caption font-[650] text-ink-muted">
                          Approved allocation
                        </span>
                        {(currentVersion()?.calculationSegments ?? []).map((segment) => {
                          const row = allocationRows[segment.id];
                          if (!row) return null;
                          return (
                            <div
                              className="grid gap-3 rounded-control border border-border bg-canvas px-3 py-3"
                              key={segment.id}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2 text-small">
                                <strong className="font-[650] text-ink">
                                  {dateLabel(segment.dateFrom)} – {dateLabel(segment.dateTo)}
                                </strong>
                                <span className="text-ink-muted">
                                  Requested {quantityLabel(segment.requestedQuantity)}{' '}
                                  {humanize(segment.requestedUnit)}
                                </span>
                              </div>
                              <div className="grid items-end gap-3 min-[621px]:grid-cols-[1fr_180px]">
                                <p className="m-0 text-small text-ink-muted">
                                  {allocationKindLabel(segment)}
                                </p>
                                <Field
                                  htmlFor={'leave-allocation-quantity-' + segment.id}
                                  label="Approved quantity"
                                >
                                  <input
                                    className={inputClass}
                                    id={'leave-allocation-quantity-' + segment.id}
                                    inputMode="decimal"
                                    onChange={(event) => {
                                      const value = targetValue(event);
                                      setAllocationRows((rows) => ({
                                        ...rows,
                                        [segment.id]: { ...row, quantity: value },
                                      }));
                                    }}
                                    value={row.quantity}
                                  />
                                </Field>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </>
                ) : null}
                <Field
                  htmlFor="leave-decision-comments"
                  label={decisionKind === 'REJECT' ? 'Reason' : 'Comments (optional)'}
                >
                  <textarea
                    className={inputClass + ' min-h-[72px] py-2'}
                    id="leave-decision-comments"
                    maxLength={1000}
                    onChange={(event) => setDecisionComments(targetValue(event))}
                    required={decisionKind === 'REJECT'}
                    value={decisionComments}
                  />
                </Field>
                <p className="m-0 text-small text-ink-muted">
                  A decision cannot add dates, increase quantity, change Leave Type, or rewrite the
                  submitted facts. Approving less than the certified request narrows the
                  certification commitment through a linked successor. The bound Leave Policy
                  Version decides the source; only the quantity the certified account cannot cover
                  becomes leave without pay.
                </p>
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button disabled={busy} type="button" variant="secondary">
                    Cancel
                  </Button>
                </DialogClose>
                <Button disabled={busy} type="submit" variant="primary">
                  {busy
                    ? 'Recording…'
                    : decisionKind === 'APPROVE'
                      ? 'Approve application'
                      : 'Reject application'}
                </Button>
              </DialogFooter>
            </form>
          ) : null}

          {dialog === 'return' ? (
            <form onSubmit={(event) => void returnApplication(event)}>
              <DialogBody className="grid gap-5">
                <p className="m-0 text-small text-ink-muted">
                  Returning cancels the unfinished route work and releases the certification
                  commitments. The Employee must submit a successor version with the missing facts
                  or evidence.
                </p>
                <Field htmlFor="leave-return-reason" label="Reason">
                  <input
                    autoFocus
                    className={inputClass}
                    data-autofocus=""
                    id="leave-return-reason"
                    maxLength={1000}
                    onChange={(event) => setReturnReason(targetValue(event))}
                    required
                    value={returnReason}
                  />
                </Field>
                <Field htmlFor="leave-return-comments" label="Comments (optional)">
                  <input
                    className={inputClass}
                    id="leave-return-comments"
                    maxLength={1000}
                    onChange={(event) => setReturnComments(targetValue(event))}
                    value={returnComments}
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
                  {busy ? 'Returning…' : 'Return application'}
                </Button>
              </DialogFooter>
            </form>
          ) : null}

          {dialog === 'cancelRequest' ? (
            <form onSubmit={(event) => void requestCancellation(event)}>
              <DialogBody className="grid gap-5">
                <p className="m-0 text-small text-ink-muted">
                  A cancellation is its own request, separate from a withdrawal. It cannot add
                  dates, exceed the approved quantity, or change the Leave Type. Approval records
                  the decision only; ledger, commitment, and Attendance effects are applied later.
                </p>
                <Field htmlFor="leave-cancellation-scope" label="Cancellation scope">
                  <select
                    className={inputClass}
                    id="leave-cancellation-scope"
                    onChange={(event) => setCancelScopeType(targetValue(event))}
                    value={cancelScopeType}
                  >
                    <option value="WHOLE">Whole application</option>
                    <option value="PARTIAL">Part of the approved leave</option>
                  </select>
                </Field>
                {cancelScopeType === 'PARTIAL' ? (
                  <div className="grid gap-3">
                    <span className="text-caption font-[650] text-ink-muted">
                      Approved allocation lines
                    </span>
                    {(currentVersion()?.approvalAllocation?.lines ?? []).map((line) => {
                      const row = cancelScopeRows[line.id];
                      if (!row) return null;
                      const update = (change: Partial<CancellationScopeRow>) =>
                        setCancelScopeRows((rows) => ({
                          ...rows,
                          [line.id]: { ...row, ...change },
                        }));
                      return (
                        <div
                          className="grid gap-3 rounded-control border border-border bg-canvas px-3 py-3"
                          key={line.id}
                        >
                          <label className="flex items-center gap-2 text-small text-ink">
                            <input
                              checked={row.selected}
                              onChange={(event) => update({ selected: targetChecked(event) })}
                              type="checkbox"
                            />
                            {`Cancel ${dateLabel(line.dateFrom)} – ${dateLabel(line.dateTo)} · ${humanize(line.allocationKind)} ${quantityLabel(line.quantity)} ${humanize(line.unitCode)}`}
                          </label>
                          {row.selected ? (
                            <div className="grid gap-3 min-[621px]:grid-cols-3">
                              <Field
                                htmlFor={'leave-cancel-from-' + line.id}
                                label="Cancelled from"
                              >
                                <input
                                  className={inputClass}
                                  id={'leave-cancel-from-' + line.id}
                                  onChange={(event) => update({ dateFrom: targetValue(event) })}
                                  type="date"
                                  value={row.dateFrom}
                                />
                              </Field>
                              <Field htmlFor={'leave-cancel-to-' + line.id} label="Cancelled to">
                                <input
                                  className={inputClass}
                                  id={'leave-cancel-to-' + line.id}
                                  onChange={(event) => update({ dateTo: targetValue(event) })}
                                  type="date"
                                  value={row.dateTo}
                                />
                              </Field>
                              <Field
                                htmlFor={'leave-cancel-quantity-' + line.id}
                                label="Cancelled quantity"
                              >
                                <input
                                  className={inputClass}
                                  id={'leave-cancel-quantity-' + line.id}
                                  inputMode="decimal"
                                  onChange={(event) => update({ quantity: targetValue(event) })}
                                  value={row.quantity}
                                />
                              </Field>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                    <p className="m-0 text-small text-ink-muted">
                      A partial scope keeps the retained period contiguous: it must include the
                      first or last date of its allocation line.
                    </p>
                  </div>
                ) : null}
                <Field htmlFor="leave-cancellation-reason" label="Cancellation reason">
                  <textarea
                    className={inputClass + ' min-h-[72px] py-2'}
                    id="leave-cancellation-reason"
                    maxLength={1000}
                    onChange={(event) => setCancelReason(targetValue(event))}
                    required
                    value={cancelReason}
                  />
                </Field>
                <Field
                  htmlFor="leave-cancellation-evidence"
                  label="Cancellation evidence Document ID (optional)"
                >
                  <input
                    className={inputClass}
                    id="leave-cancellation-evidence"
                    onChange={(event) => setCancelEvidenceDocumentId(targetValue(event))}
                    placeholder="00000000-0000-0000-0000-000000000000"
                    value={cancelEvidenceDocumentId}
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
                  {busy ? 'Requesting…' : 'Submit cancellation request'}
                </Button>
              </DialogFooter>
            </form>
          ) : null}

          {dialog === 'cancelDecision' ? (
            <form onSubmit={(event) => void decideCancellation(event)}>
              <DialogBody className="grid gap-5">
                <p className="m-0 text-small text-ink-muted">
                  Approving records the decision with effects pending; the application stays in
                  cancel requested and no ledger, commitment, or Attendance change occurs. Rejecting
                  returns it to its prior state.
                </p>
                <Field htmlFor="leave-cancellation-decision" label="Decision">
                  <select
                    className={inputClass}
                    id="leave-cancellation-decision"
                    onChange={(event) => setCancelDecisionKind(targetValue(event))}
                    value={cancelDecisionKind}
                  >
                    {canCancel ? <option value="APPROVE">Approve</option> : null}
                    {canRejectCancel ? <option value="REJECT">Reject</option> : null}
                  </select>
                </Field>
                <Field
                  htmlFor="leave-cancellation-comments"
                  label={cancelDecisionKind === 'REJECT' ? 'Reason' : 'Comments (optional)'}
                >
                  <textarea
                    className={inputClass + ' min-h-[72px] py-2'}
                    id="leave-cancellation-comments"
                    maxLength={1000}
                    onChange={(event) => setCancelDecisionComments(targetValue(event))}
                    required={cancelDecisionKind === 'REJECT'}
                    value={cancelDecisionComments}
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
                  {busy
                    ? 'Recording…'
                    : cancelDecisionKind === 'APPROVE'
                      ? 'Approve cancellation'
                      : 'Reject cancellation'}
                </Button>
              </DialogFooter>
            </form>
          ) : null}

          {dialog === 'detail' ? (
            <DialogBody className="grid gap-6">
              {detailLoading || !detail ? (
                <StateSurface
                  compact
                  busy={detailLoading}
                  label={
                    detailLoading
                      ? 'Loading the Leave Application record'
                      : 'Leave Application record unavailable'
                  }
                >
                  <p className="m-0">
                    {detailLoading
                      ? 'Loading the Leave Application record…'
                      : 'The Leave Application record could not be loaded.'}
                  </p>
                </StateSurface>
              ) : (
                <>
                  {success ? (
                    <p className={successClass} role="status">
                      {success}
                    </p>
                  ) : null}

                  <section
                    className="grid gap-3"
                    aria-labelledby="leave-application-snapshot-heading"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className={sectionTitleClass} id="leave-application-snapshot-heading">
                        {detail.application.employeeName} · {detail.application.leaveTypeName}
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {canRoute && status === 'SUBMITTED' ? (
                          <Button
                            onClick={() => {
                              resetAction();
                              setDialog('route');
                            }}

                            type="button"
                            variant="secondary"
                          >
                            Send for certification
                          </Button>
                        ) : null}
                        {canCertify && status === 'FOR_CERTIFICATION' ? (
                          <Button
                            onClick={() => {
                              resetAction();
                              setBalanceAsOf('');
                              setDialog('certify');
                            }}

                            type="button"
                            variant="secondary"
                          >
                            Certify credits
                          </Button>
                        ) : null}
                        {canRecommend && status === 'FOR_RECOMMENDATION' ? (
                          <Button
                            onClick={() => {
                              resetAction();
                              setRecommendationOutcome('RECOMMEND_APPROVAL');
                              setRecommendationReason('');
                              setRecommendationComments('');
                              setDialog('recommend');
                            }}

                            type="button"
                            variant="secondary"
                          >
                            Recommend
                          </Button>
                        ) : null}
                        {canApprove && status === 'FOR_APPROVAL' ? (
                          <Button
                            onClick={() => openDecision()}

                            type="button"
                            variant="primary"
                          >
                            Approve
                          </Button>
                        ) : null}
                        {canReject && status === 'FOR_APPROVAL' ? (
                          <Button
                            onClick={() => {
                              resetAction();
                              setDecisionKind('REJECT');
                              setDecisionComments('');
                              setDialog('decision');
                            }}

                            type="button"
                            variant="secondary"
                          >
                            Reject
                          </Button>
                        ) : null}
                        {detail.canPost && status === 'APPROVED' ? (
                          <Button
                            disabled={busy}
                            onClick={() =>
                              void review(
                                'posting',
                                {},
                                'The Leave Application was posted to Leave and Attendance.',
                                'The Leave Application could not be posted.',
                              )
                            }
                            type="button"
                            variant="primary"
                          >
                            {busy ? 'Posting…' : 'Post leave'}
                          </Button>
                        ) : null}
                        {canRequestCancel && cancellable ? (
                          <Button
                            onClick={() => openCancelRequest()}
                            type="button"
                            variant="secondary"
                          >
                            Request cancellation
                          </Button>
                        ) : null}
                        {canCancel && openCancellation ? (
                          <Button
                            onClick={() => openCancelDecision('APPROVE')}
                            type="button"
                            variant="primary"
                          >
                            Approve cancellation
                          </Button>
                        ) : null}
                        {canRejectCancel && openCancellation ? (
                          <Button
                            onClick={() => openCancelDecision('REJECT')}
                            type="button"
                            variant="secondary"
                          >
                            Reject cancellation
                          </Button>
                        ) : null}
                        {canReturn && reviewable ? (
                          <Button
                            onClick={() => {
                              resetAction();
                              setReturnReason('');
                              setReturnComments('');
                              setDialog('return');
                            }}

                            type="button"
                            variant="secondary"
                          >
                            Return for information
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-small text-ink-muted">
                      <span>{detail.application.employeeNumber}</span>
                      <span>{detail.application.leaveTypeCode}</span>
                      <StatusTag tone={statusTone(detail.application.status)}>
                        {detail.application.status}
                      </StatusTag>
                      {detail.application.currentVersionNo !== null ? (
                        <span>Version {detail.application.currentVersionNo}</span>
                      ) : null}
                      <span>Prepared {instantLabel(detail.application.createdAt)}</span>
                      {detail.application.submittedAt ? (
                        <span>Submitted {instantLabel(detail.application.submittedAt)}</span>
                      ) : null}
                    </div>
                  </section>

                  {currentVersion()?.posting ? (
                    <section className="grid gap-3" aria-label="Posting effects">
                      <h3 className={sectionTitleClass}>Posting effects</h3>
                      <p className="m-0 text-small text-ink-muted">
                        Posted {instantLabel(currentVersion()!.posting!.postedAt)}
                      </p>
                      {currentVersion()!.posting!.effects.map((effect) => (
                        <p className="m-0 text-small" key={effect.effectKey}>
                          {effect.effectKind === 'LEDGER_ENTRY'
                            ? 'Leave Ledger Entry'
                            : 'Attendance input'}{' '}
                          · {effect.ownerRecordId}
                        </p>
                      ))}
                    </section>
                  ) : null}
                  {detail.cancellations.length > 0 ? (
                    <section className="grid gap-3" aria-labelledby="leave-cancellations-heading">
                      <h3 className={sectionTitleClass} id="leave-cancellations-heading">
                        Cancellation requests
                      </h3>
                      {detail.cancellations.map((cancellation) => (
                        <article
                          aria-label={`Cancellation requested ${instantLabel(cancellation.requestedAt)}`}
                          className="grid gap-2 rounded-control border border-border bg-canvas px-3 py-3 text-small"
                          key={cancellation.id}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <strong className="font-[650] text-ink">
                              {humanize(cancellation.scopeType)} cancellation
                            </strong>
                            <StatusTag tone={decisionTone(cancellation.decisionStatus)}>
                              Decision {humanize(cancellation.decisionStatus)}
                            </StatusTag>
                            <StatusTag
                              tone={
                                cancellation.effectStatus === 'FAILED'
                                  ? 'danger'
                                  : cancellation.effectStatus === 'APPLIED'
                                    ? 'success'
                                    : 'neutral'
                              }
                            >
                              Effect {humanize(cancellation.effectStatus)}
                            </StatusTag>
                          </div>
                          <p className="m-0 text-ink-muted">
                            Requested by {cancellation.requestedByName ?? 'an Agency recorder'} ·{' '}
                            {instantLabel(cancellation.requestedAt)} · {cancellation.reason}
                          </p>
                          <ul className="m-0 grid list-none gap-1 p-0 text-ink-muted">
                            {cancellation.scopes.map((scope) => (
                              <li key={scope.id}>
                                {dateLabel(scope.dateFrom)} – {dateLabel(scope.dateTo)} ·{' '}
                                {humanize(scope.allocationKind)} {quantityLabel(scope.quantity)}{' '}
                                {humanize(scope.unitCode)}
                              </li>
                            ))}
                          </ul>
                          {cancellation.documents.length > 0 ? (
                            <p className="m-0 text-ink-muted">
                              Evidence:{' '}
                              {cancellation.documents
                                .map(
                                  ({ documentNo, documentType, versionNo }) =>
                                    `${documentNo ?? documentType ?? 'Document'} v${versionNo ?? '—'}`,
                                )
                                .join('; ')}
                            </p>
                          ) : null}
                          {cancellation.approvalSteps.map((step) => (
                            <div className="grid gap-1" key={step.id}>
                              <span className="font-[650] text-ink">
                                Step {step.stepNo} · {humanize(step.requiredPermission)} ·{' '}
                                {humanize(step.status)}
                              </span>
                              {step.decisions.map((decision) => (
                                <span className="text-ink-muted" key={decision.id}>
                                  {humanize(decision.decision)} ·{' '}
                                  {decision.decidedByName ?? decision.decidedByMembershipId} ·{' '}
                                  {instantLabel(decision.decidedAt)}
                                  {decision.comments ? ' · ' + decision.comments : ''}
                                </span>
                              ))}
                            </div>
                          ))}
                          {cancellation.effects.length > 0 ? (
                            <ul
                              className="m-0 grid list-none gap-1 p-0 text-ink-muted"
                              aria-label="Applied cancellation effects"
                            >
                              {cancellation.effects.map((effect) => (
                                <li key={effect.id}>{cancellationEffectText(effect)}</li>
                              ))}
                            </ul>
                          ) : null}
                          {cancellation.effectStatus === 'APPLIED' &&
                          cancellation.effects.some(
                            ({ attendanceHandoff }) =>
                              attendanceHandoff?.status === 'FOR_AUTHORIZATION',
                          ) ? (
                            <p className="m-0 text-ink-muted">
                              The Leave effects were applied and the application is cancelled.
                              Attendance is not corrected until an HR Administrator authorizes the
                              Locked Attendance adjustment.
                            </p>
                          ) : cancellation.effectStatus === 'APPLIED' ? (
                            <p className="m-0 text-ink-muted">
                              The cancellation was applied and the application is cancelled.
                            </p>
                          ) : cancellation.decisionStatus === 'APPROVED' ? (
                            <p className="m-0 text-ink-muted">
                              Effects are {humanize(cancellation.effectStatus)}; no ledger,
                              commitment, or Attendance change has been applied.
                            </p>
                          ) : null}
                          {cancellation.lastEffectFailureCode ? (
                            <p className="m-0 text-danger" role="status">
                              {cancellation.lastEffectFailureKind === 'RETRYABLE'
                                ? 'The apply attempt failed. Retry the cancellation.'
                                : 'The apply attempt is blocked. Resolve the recorded failure before retrying.'}{' '}
                              {humanize(cancellation.lastEffectFailureCode)}
                            </p>
                          ) : null}
                          {canApplyCancellation &&
                          status === 'CANCEL_REQUESTED' &&
                          cancellation.decisionStatus === 'APPROVED' &&
                          ['PENDING', 'FAILED'].includes(cancellation.effectStatus) ? (
                            <div>
                              <Button
                                disabled={busy}
                                onClick={() => void applyCancellation(cancellation)}
                                type="button"
                              >
                                {busy
                                  ? 'Applying cancellation…'
                                  : cancellation.effectStatus === 'FAILED'
                                    ? 'Retry cancellation'
                                    : 'Apply cancellation'}
                              </Button>
                            </div>
                          ) : null}
                        </article>
                      ))}
                    </section>
                  ) : null}

                  {editable ? (
                    <form className="grid gap-4" onSubmit={(event) => void saveDraft(event)}>
                      <h3 className={sectionTitleClass} id="leave-application-draft-heading">
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
                        <span className="text-caption font-[650] text-ink-muted">Periods</span>
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
                              onClick={() =>
                                setPeriodRows((rows) =>
                                  rows.filter((_, rowIndex) => rowIndex !== index),
                                )
                              }

                              type="button"
                              variant="secondary"
                            >
                              Remove
                            </Button>
                          </div>
                        ))}
                        <div>
                          <Button
                            onClick={() =>
                              setPeriodRows((rows) => [
                                ...rows,
                                { dateFrom: manilaToday(), dateTo: manilaToday() },
                              ])
                            }

                            type="button"
                            variant="secondary"
                          >
                            Add period
                          </Button>
                        </div>
                      </div>

                      <div className="grid gap-3">
                        <span className="text-caption font-[650] text-ink-muted">Evidence</span>
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
                              onClick={() =>
                                setDocumentRows((rows) =>
                                  rows.filter((_, rowIndex) => rowIndex !== index),
                                )
                              }

                              type="button"
                              variant="secondary"
                            >
                              Remove
                            </Button>
                          </div>
                        ))}
                        <div>
                          <Button
                            onClick={() =>
                              setDocumentRows((rows) => [
                                ...rows,
                                { documentId: '', purposeCode: 'SIGNED_LEAVE_APPLICATION_FORM' },
                              ])
                            }

                            type="button"
                            variant="secondary"
                          >
                            Add evidence
                          </Button>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button disabled={busy} type="submit" variant="secondary">
                          {busy ? 'Saving…' : 'Save draft'}
                        </Button>
                        <Button
                          disabled={previewLoading}
                          onClick={() => void checkEligibility()}

                          type="button"
                          variant="secondary"
                        >
                          {previewLoading ? 'Checking…' : 'Check eligibility'}
                        </Button>
                      </div>

                      {preview ? (
                        <section
                          aria-labelledby="leave-eligibility-heading"
                          className="grid gap-3 rounded-control border border-border bg-canvas px-4 py-4"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className={sectionTitleClass} id="leave-eligibility-heading">
                              Eligibility
                            </h4>
                            <StatusTag tone={eligibilityTone(preview.result)}>
                              {preview.result}
                            </StatusTag>
                            <span className="text-small text-ink-muted">
                              {preview.requestedQuantity === null
                                ? 'No quantity computed'
                                : quantityLabel(preview.requestedQuantity) +
                                  ' ' +
                                  humanize(preview.requestedUnit)}
                            </span>
                          </div>
                          {preview.missingFacts.length > 0 ? (
                            <ul className="m-0 grid list-disc gap-1 pl-5 text-small text-ink-muted">
                              {preview.missingFacts.map((fact) => (
                                <li key={fact.fact}>
                                  <strong className="font-[650] text-ink">{fact.fact}</strong>{' '}
                                  {fact.detail}
                                </li>
                              ))}
                            </ul>
                          ) : null}
                          <ul className="m-0 grid list-disc gap-1 pl-5 text-small text-ink-muted">
                            {preview.ruleResults.map((rule) => (
                              <li key={rule.rule}>
                                <strong className="font-[650] text-ink">{rule.rule}</strong>{' '}
                                {rule.outcome} · {rule.detail}
                              </li>
                            ))}
                          </ul>
                          {preview.segments.length > 0 ? (
                            <p className="m-0 text-small text-ink-muted">
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
                      <h3 className={sectionTitleClass} id="leave-submission-heading">
                        Submit
                      </h3>
                      <Field
                        htmlFor="leave-form-template"
                        label="Form template Document Version ID"
                      >
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
                        <Button disabled={busy} type="submit" variant="primary">
                          {busy ? 'Submitting…' : 'Submit application'}
                        </Button>
                      </div>
                    </form>
                  ) : null}

                  {withdrawable && canWithdraw ? (
                    <form className="grid gap-4" onSubmit={(event) => void withdraw(event)}>
                      <h3 className={sectionTitleClass} id="leave-withdrawal-heading">
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
                        <Button disabled={busy} type="submit" variant="secondary">
                          {busy ? 'Withdrawing…' : 'Withdraw application'}
                        </Button>
                      </div>
                    </form>
                  ) : null}

                  {detail.application.currentVersionId && !editable ? (
                    <form className="grid gap-4" onSubmit={(event) => void appendDocument(event)}>
                      <h3 className={sectionTitleClass} id="leave-document-heading">
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
                        <Button disabled={busy} type="submit" variant="secondary">
                          {busy ? 'Attaching…' : 'Attach document'}
                        </Button>
                      </div>
                    </form>
                  ) : null}

                  <section className="grid gap-3" aria-labelledby="leave-versions-heading">
                    <h3 className={sectionTitleClass} id="leave-versions-heading">
                      Leave Application Versions
                    </h3>
                    {detail.versions.length === 0 ? (
                      <p className="m-0 text-small text-ink-muted">No versions submitted.</p>
                    ) : (
                      <div className="grid gap-3">
                        {detail.versions.map((version) => {
                          const assessment = version.assessments.at(-1);
                          return (
                            <article
                              className="grid gap-2 rounded-control border border-border bg-canvas px-4 py-3"
                              key={version.id}
                            >
                              <div className="flex flex-wrap items-center gap-2 text-small">
                                <strong className="font-[650] text-ink">
                                  Version {version.versionNo}
                                </strong>
                                <span className="text-ink-muted">{version.leaveTypeCode}</span>
                                <StatusTag tone={statusTone(version.approvalRequestStatus)}>
                                  {version.approvalRequestStatus}
                                </StatusTag>
                                <span className="text-ink-muted">
                                  {humanize(version.attestationType)}
                                </span>
                                <span className="text-ink-muted">
                                  {humanize(version.submissionMethod)}
                                </span>
                              </div>
                              <p className="m-0 text-small text-ink-muted">
                                {periodsLabel(version.periods)}
                              </p>
                              <p className="m-0 text-small text-ink-muted">
                                Route {version.approvalRouteCode} · Submitted by{' '}
                                {version.submittedByName ?? version.submittedByMembershipId} ·
                                Received {instantLabel(version.receivedAt)}
                              </p>
                              {version.reason ? (
                                <p className="m-0 text-small text-ink-muted">
                                  Reason: {version.reason}
                                </p>
                              ) : null}
                              {version.commutationChoice ? (
                                <p className="m-0 text-small text-ink-muted">
                                  Commutation: {humanize(version.commutationChoice)}
                                </p>
                              ) : null}
                              {version.documents.length > 0 ? (
                                <p className="m-0 text-small text-ink-muted">
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
                                <p className="m-0 text-small text-ink-muted">
                                  Eligibility {assessment.result} · assessed{' '}
                                  {instantLabel(assessment.assessedAt)}
                                </p>
                              ) : null}
                              {version.calculationSegments.length > 0 ? (
                                <p className="m-0 text-small text-ink-muted">
                                  Quantity:{' '}
                                  {version.calculationSegments
                                    .map(
                                      (segment) =>
                                        `${quantityLabel(segment.requestedQuantity)} ${humanize(segment.requestedUnit)}`,
                                    )
                                    .join('; ')}
                                </p>
                              ) : null}
                              {version.certification ? (
                                <div className="grid gap-2 rounded-control border border-border bg-surface px-3 py-3">
                                  <div className="flex flex-wrap items-center gap-2 text-small">
                                    <strong className="font-[650] text-ink">
                                      Certified credits
                                    </strong>
                                    <span className="text-ink-muted">
                                      Balance as of {dateLabel(version.certification.balanceAsOf)}
                                    </span>
                                    <span className="text-ink-muted">
                                      Ledger recorded through{' '}
                                      {instantLabel(version.certification.ledgerRecordedThrough)}
                                    </span>
                                    <span className="text-ink-muted">
                                      {version.certification.certifiedByName ??
                                        version.certification.certifiedByMembershipId}{' '}
                                      · {instantLabel(version.certification.certifiedAt)}
                                    </span>
                                  </div>
                                  <Table className="min-w-[640px]">
                                    <thead>
                                      <tr>
                                        <Th>Account</Th>
                                        <Th kind="numeric">Posted</Th>
                                        <Th kind="numeric">Commitments</Th>
                                        <Th kind="numeric">Application</Th>
                                        <Th kind="numeric">Available after</Th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {version.certification.lines.map((line) => (
                                        <Tr key={line.id}>
                                          <RowHeader>
                                            {line.leaveTypeName}{' '}
                                            <span className="font-normal text-ink-muted">
                                              {line.leaveTypeCode}
                                            </span>
                                          </RowHeader>
                                          <Td kind="numeric">
                                            {quantityLabel(line.postedBalance)}
                                          </Td>
                                          <Td kind="numeric">
                                            {quantityLabel(line.activeCommitments)}
                                          </Td>
                                          <Td kind="numeric">
                                            {quantityLabel(line.applicationQuantity)}
                                          </Td>
                                          <Td
                                            kind="numeric"
                                            className={
                                              Number(line.availableAfterApplication) < 0
                                                ? 'font-[650] text-danger'
                                                : undefined
                                            }
                                          >
                                            {quantityLabel(line.availableAfterApplication)}
                                          </Td>
                                        </Tr>
                                      ))}
                                    </tbody>
                                  </Table>
                                </div>
                              ) : null}
                              {version.recommendation ? (
                                <p className="m-0 text-small text-ink-muted">
                                  Recommendation{' '}
                                  <strong className="font-[650] text-ink">
                                    {humanize(version.recommendation.outcome)}
                                  </strong>{' '}
                                  · {instantLabel(version.recommendation.recommendedAt)}
                                  {version.recommendation.reason
                                    ? ' · ' + version.recommendation.reason
                                    : ''}
                                </p>
                              ) : null}
                              {version.approvalAllocation ? (
                                <p className="m-0 text-small text-ink-muted">
                                  Approved allocation:{' '}
                                  {version.approvalAllocation.lines
                                    .map(
                                      (line) =>
                                        `${dateLabel(line.dateFrom)} – ${dateLabel(line.dateTo)} · ${humanize(line.allocationKind)} ${quantityLabel(line.quantity)} ${humanize(line.unitCode)}`,
                                    )
                                    .join('; ')}
                                </p>
                              ) : null}
                              {version.approvalSteps.length > 0 ? (
                                <div className="grid gap-1">
                                  <span className="text-caption font-[650] text-ink-muted">
                                    Approval route
                                  </span>
                                  <ol className="m-0 grid list-none gap-2 p-0">
                                    {version.approvalSteps.map((step) => (
                                      <li className="grid gap-1 text-small" key={step.id}>
                                        <span className="font-[650] text-ink">
                                          Step {step.stepNo} · {humanize(step.requiredPermission)} ·{' '}
                                          {humanize(step.status)}
                                          {step.assignedRoleCode
                                            ? ' · ' + humanize(step.assignedRoleCode)
                                            : ''}
                                        </span>
                                        {step.decisions.map((decision) => (
                                          <span className="text-ink-muted" key={decision.id}>
                                            {humanize(decision.decision)} ·{' '}
                                            {decision.decidedByName ??
                                              decision.decidedByMembershipId}{' '}
                                            · {instantLabel(decision.decidedAt)}
                                            {decision.comments ? ' · ' + decision.comments : ''}
                                          </span>
                                        ))}
                                      </li>
                                    ))}
                                  </ol>
                                </div>
                              ) : null}
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </section>

                  <section className="grid gap-3" aria-labelledby="leave-history-heading">
                    <h3 className={sectionTitleClass} id="leave-history-heading">
                      History
                    </h3>
                    {detail.history.length === 0 ? (
                      <p className="m-0 text-small text-ink-muted">No history recorded.</p>
                    ) : (
                      <ol className="m-0 grid list-none gap-2 p-0">
                        {detail.history.map((entry) => (
                          <li className="grid gap-1 text-small" key={entry.id}>
                            <span className="font-[650] text-ink">
                              {humanize(entry.action)}
                              {entry.previousStatus || entry.newStatus
                                ? ` · ${entry.previousStatus ?? '—'} → ${entry.newStatus ?? '—'}`
                                : ''}
                            </span>
                            <span className="text-ink-muted">
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
      </div>
    </Dialog>
  );
}
