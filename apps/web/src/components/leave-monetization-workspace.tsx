'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { cn } from '../lib/class-names';
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
import { RowHeader, Table, Td, Th, Tr } from './ui/table';

export type MonetizationStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'CREDIT_CERTIFIED'
  | 'NEEDS_INFORMATION'
  | 'FOR_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'POSTED'
  | 'WITHDRAWN'
  | 'CANCELLED';

export type MonetizationKind = 'REGULAR' | 'SPECIAL';
export type MonetizationAdjustmentScope = 'WHOLE' | 'PARTIAL';

export interface MonetizationRequestSummary {
  id: string;
  agencyId: string;
  employeeId: string;
  employeeNumber: string;
  employeeName: string;
  status: MonetizationStatus;
  currentVersionId: string | null;
  versionNo: number | null;
  kind: MonetizationKind | null;
  reason: string | null;
  requestedQuantity: string;
  certifiedQuantity: string | null;
  approvedQuantity: string | null;
  createdAt: string;
  submittedAt: string | null;
}

export interface MonetizationAllocationSummary {
  id: string;
  leaveAccountId: string;
  leaveTypeCode: string;
  leaveTypeName: string;
  policyVersionId: string;
  requestedQuantity: string;
  certifiedQuantity: string | null;
  approvedQuantity: string | null;
}

export interface MonetizationRuleResult {
  rule: string;
  outcome: 'PASS' | 'FAIL' | 'INDETERMINATE';
  message: string;
  citation: string;
}

export interface MonetizationAssessmentSummary {
  id: string;
  result: string;
  balanceEffectiveDate: string;
  ledgerCutoff: string;
  ruleResults: unknown;
  assessedAt: string;
}

export interface MonetizationCertificationSummary {
  id: string;
  certifiedAt: string;
  lines: Array<{
    id: string;
    leaveAccountId: string;
    postedBalance: string;
    otherActiveCommitments: string;
    certifiedQuantity: string;
    resultingAvailableQuantity: string;
    leaveCreditCommitmentId: string;
  }>;
}

export interface MonetizationFundingSummary {
  id: string;
  result: string;
  fiscalAuthorityDocumentVersionId: string;
  fundingSourceSnapshot: unknown;
  evidenceSnapshot: unknown;
  reviewedAt: string;
}

export interface MonetizationPostingSummary {
  id: string;
  postingKey: string;
  valuationDate: string;
  calculatorKind: string;
  factor: string;
  payrollInputId: string;
  postedAt: string;
}

export interface MonetizationAdjustmentSummary {
  id: string;
  scope: string;
  reason: string;
  status: string;
  approvalRequestId: string;
  ownerResult: unknown;
  appliedAt: string | null;
  lines: Array<{
    id: string;
    originalLedgerEntryId: string;
    retainedQuantity: string;
    reversalLedgerEntryId: string | null;
    replacementLedgerEntryId: string | null;
  }>;
}

export interface MonetizationDetail {
  request: MonetizationRequestSummary;
  allocations: MonetizationAllocationSummary[];
  assessment: MonetizationAssessmentSummary | null;
  certification: MonetizationCertificationSummary | null;
  funding: MonetizationFundingSummary | null;
  posting: MonetizationPostingSummary | null;
  adjustments: MonetizationAdjustmentSummary[];
}

export interface MonetizationPage {
  items: MonetizationRequestSummary[];
  hasMore: boolean;
  nextOffset: number | null;
}

export interface MonetizationPermissions {
  createScope: 'AGENCY' | 'OWN' | null;
  submit: boolean;
  certify: boolean;
  returnRequest: boolean;
  reviewFunding: boolean;
  approve: boolean;
  reject: boolean;
  post: boolean;
  adjust: boolean;
  withdraw: boolean;
  cancel: boolean;
}

interface EmployeeOption {
  id: string;
  employeeNumber: string;
  legalName: string;
}

interface LeaveAccountOption {
  id: string;
  leaveTypeCode: string;
  leaveTypeName: string;
  status: string;
  balances: { availableQuantity: string };
}

interface LedgerEntryOption {
  id: string;
  quantity: string;
  effectiveDate: string;
  sourceType: string;
  sourceId: string;
}

interface OriginalEntryOption {
  id: string;
  leaveAccountId: string;
  leaveTypeName: string;
  quantity: string;
}

interface AllocationRow {
  leaveAccountId: string;
  requestedQuantity: string;
}

type DialogKind =
  | 'detail'
  | 'create'
  | 'submit'
  | 'assess'
  | 'certify'
  | 'return'
  | 'withdraw'
  | 'cancel'
  | 'funding'
  | 'approve'
  | 'reject'
  | 'post'
  | 'adjust'
  | 'adjustment-approve'
  | 'adjustment-reject'
  | null;

const MONETIZATION_STATUSES: readonly MonetizationStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'CREDIT_CERTIFIED',
  'NEEDS_INFORMATION',
  'FOR_APPROVAL',
  'APPROVED',
  'REJECTED',
  'POSTED',
  'WITHDRAWN',
  'CANCELLED',
];

const REGULAR_LEAVE_TYPES = ['VACATION_LEAVE'];
const SPECIAL_LEAVE_TYPES = ['VACATION_LEAVE', 'SICK_LEAVE'];

function statusTone(status: MonetizationStatus): StatusTone {
  if (status === 'POSTED' || status === 'APPROVED') return 'success';
  if (status === 'REJECTED' || status === 'CANCELLED') return 'danger';
  if (status === 'FOR_APPROVAL' || status === 'CREDIT_CERTIFIED' || status === 'SUBMITTED') {
    return 'warning';
  }
  return 'neutral';
}

function adjustmentStatusTone(status: string): StatusTone {
  if (status === 'APPLIED') return 'success';
  if (status === 'REJECTED' || status === 'BLOCKED') return 'danger';
  if (status === 'APPROVED' || status === 'RETRYABLE' || status === 'FOR_APPROVAL') {
    return 'warning';
  }
  return 'neutral';
}

function resultTone(result: string): StatusTone {
  if (result === 'ELIGIBLE' || result === 'SUPPORTED' || result === 'PASS') return 'success';
  if (result === 'INELIGIBLE' || result === 'UNSUPPORTED' || result === 'FAIL') return 'danger';
  return 'warning';
}

const sectionTitleClass = 'm-0 text-panel-title text-ink';
const preClass =
  'm-0 overflow-x-auto rounded-control bg-canvas px-3 py-2 font-mono text-caption text-ink-muted';

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

function quantityLabel(value: string): string {
  if (!value.includes('.')) return value;
  return value.replace(/0+$/, '').replace(/\.$/, '');
}

function targetValue(event: { currentTarget: EventTarget }): string {
  return (event.currentTarget as unknown as { value: string }).value;
}

function targetChecked(event: { currentTarget: EventTarget }): boolean {
  return (event.currentTarget as unknown as { checked: boolean }).checked;
}

function ruleResultsOf(value: unknown): MonetizationRuleResult[] | null {
  if (!Array.isArray(value)) return null;
  const results: MonetizationRuleResult[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) return null;
    const record = entry as Record<string, unknown>;
    if (
      typeof record.rule !== 'string' ||
      typeof record.outcome !== 'string' ||
      typeof record.message !== 'string' ||
      typeof record.citation !== 'string'
    ) {
      return null;
    }
    if (
      record.outcome !== 'PASS' &&
      record.outcome !== 'FAIL' &&
      record.outcome !== 'INDETERMINATE'
    ) {
      return null;
    }
    results.push({
      rule: record.rule,
      outcome: record.outcome,
      message: record.message,
      citation: record.citation,
    });
  }
  return results;
}

function jsonLabel(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function SuccessMessage({ message }: { message: string }) {
  return message ? (
    <p
      className="m-0 rounded-control border border-success/40 bg-success/5 px-3 py-2.5 text-small text-success"
      role="status"
    >
      {message}
    </p>
  ) : null;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-caption text-ink-muted">{label}</dt>
      <dd className="m-0 text-body font-[600] text-ink">{value}</dd>
    </div>
  );
}

export function LeaveMonetizationWorkspace({
  agencyId,
  initial,
  permissions,
}: {
  agencyId: string;
  initial: MonetizationPage;
  permissions: MonetizationPermissions;
}) {
  const [items, setItems] = useState(initial.items);
  const [hasMore, setHasMore] = useState(initial.hasMore);
  const [nextOffset, setNextOffset] = useState(initial.nextOffset);
  const [statusFilter, setStatusFilter] = useState('');
  const navigation = useRecordNavigation();
  const recordId = navigation.search.get('record');
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [detail, setDetail] = useState<MonetizationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [employeeOptions, setEmployeeOptions] = useState<EmployeeOption[]>([]);
  const [accountOptions, setAccountOptions] = useState<LeaveAccountOption[]>([]);
  const [originalEntries, setOriginalEntries] = useState<OriginalEntryOption[]>([]);
  const [createEmployeeId, setCreateEmployeeId] = useState('');
  const [kind, setKind] = useState<MonetizationKind>('REGULAR');
  const [submitReason, setSubmitReason] = useState('');
  const [formTemplateDocumentVersionId, setFormTemplateDocumentVersionId] = useState('');
  const [attestationType, setAttestationType] = useState<
    'AUTHENTICATED_SUBMISSION' | 'SIGNED_DOCUMENT'
  >('AUTHENTICATED_SUBMISSION');
  const [attestationDocumentVersionId, setAttestationDocumentVersionId] = useState('');
  const [citations, setCitations] = useState('');
  const [valuationDate, setValuationDate] = useState('');
  const [fiscalPeriod, setFiscalPeriod] = useState('');
  const [salarySourceReference, setSalarySourceReference] = useState('');
  const [specialPercentageBasis, setSpecialPercentageBasis] = useState('');
  const [fractionalCreditRounding, setFractionalCreditRounding] = useState('');
  const [allocationRows, setAllocationRows] = useState<AllocationRow[]>([
    { leaveAccountId: '', requestedQuantity: '' },
  ]);
  const [balanceEffectiveDate, setBalanceEffectiveDate] = useState('');
  const [certifiedQuantities, setCertifiedQuantities] = useState<Record<string, string>>({});
  const [fundingResult, setFundingResult] = useState<'SUPPORTED' | 'UNSUPPORTED' | 'INDETERMINATE'>(
    'SUPPORTED',
  );
  const [fiscalAuthorityDocumentVersionId, setFiscalAuthorityDocumentVersionId] = useState('');
  const [fundingSourceSnapshot, setFundingSourceSnapshot] = useState('{}');
  const [evidenceSnapshot, setEvidenceSnapshot] = useState('{}');
  const [approvalNarrowing, setApprovalNarrowing] = useState<Record<string, string>>({});
  const [comments, setComments] = useState('');
  const [reason, setReason] = useState('');
  const [adjustmentScope, setAdjustmentScope] = useState<MonetizationAdjustmentScope>('WHOLE');
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const [selectedOriginals, setSelectedOriginals] = useState<Record<string, boolean>>({});
  const [retainedQuantities, setRetainedQuantities] = useState<Record<string, string>>({});
  const [decisionAdjustmentId, setDecisionAdjustmentId] = useState<string | null>(null);
  const [decisionComments, setDecisionComments] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const employeesRequested = useRef(false);

  useEffect(() => {
    let active = true;
    if (!recordId) {
      setDetail(null);
      return;
    }
    setDetail(null);
    setError('');
    setDialog('detail');
    setDetailLoading(true);
    void request('/leave-monetization/' + encodeURIComponent(recordId))
      .then((value) => {
        if (active) setDetail(value as MonetizationDetail);
      })
      .catch((reason_: unknown) => {
        if (active)
          setError(reason_ instanceof Error ? reason_.message : 'This record is unavailable.');
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [recordId]);

  useEffect(() => {
    let active = true;
    void request(listPath(0))
      .then((value) => {
        if (!active) return;
        const page = value as MonetizationPage;
        setItems(page.items);
        setHasMore(page.hasMore);
        setNextOffset(page.nextOffset);
      })
      .catch((reason_: unknown) => {
        if (active)
          setError(reason_ instanceof Error ? reason_.message : 'The register is unavailable.');
      });
    return () => {
      active = false;
    };
  }, [statusFilter]);

  function listPath(offset: number): string {
    const search = new URLSearchParams();
    if (statusFilter) search.set('status', statusFilter);
    if (offset > 0) search.set('offset', String(offset));
    const query = search.toString();
    return '/leave-monetization' + (query ? '?' + query : '');
  }

  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await fetch('/api/v1/agencies/' + agencyId + path, {
      ...init,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...init.headers },
    });
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(errorMessage(value, 'The Leave Monetization action failed.'));
    }
    return value;
  }

  async function refresh(): Promise<void> {
    const list = (await request(listPath(0))) as MonetizationPage;
    setItems(list.items);
    setHasMore(list.hasMore);
    setNextOffset(list.nextOffset);
    if (recordId) {
      const next = (await request(
        '/leave-monetization/' + encodeURIComponent(recordId),
      )) as MonetizationDetail;
      setDetail(next);
    }
  }

  async function loadMore(): Promise<void> {
    if (nextOffset === null) return;
    setBusy(true);
    try {
      const page = (await request(listPath(nextOffset))) as MonetizationPage;
      setItems((current) => [...current, ...page.items]);
      setHasMore(page.hasMore);
      setNextOffset(page.nextOffset);
    } catch (reason_: unknown) {
      setError(reason_ instanceof Error ? reason_.message : 'Loading more failed.');
    } finally {
      setBusy(false);
    }
  }

  async function loadEmployees(): Promise<void> {
    if (employeesRequested.current) return;
    employeesRequested.current = true;
    try {
      const value = (await request('/employees')) as { employees: EmployeeOption[] };
      setEmployeeOptions(value.employees);
      setCreateEmployeeId((current) => current || value.employees[0]?.id || '');
    } catch (reason_: unknown) {
      employeesRequested.current = false;
      setError(reason_ instanceof Error ? reason_.message : 'Loading Employees failed.');
    }
  }

  async function loadAccounts(employeeId: string): Promise<void> {
    try {
      const value = (await request(
        '/leave-accounts?employeeId=' + encodeURIComponent(employeeId),
      )) as {
        accounts: LeaveAccountOption[];
      };
      setAccountOptions(value.accounts.filter(({ status }) => status === 'ACTIVE'));
    } catch (reason_: unknown) {
      setError(reason_ instanceof Error ? reason_.message : 'Loading Leave Accounts failed.');
    }
  }

  function resetAction(): void {
    setError('');
    setSuccess('');
  }

  function closeDialog(force = false): void {
    if (busy && !force) return;
    setDialog(null);
    setDetail(null);
    setOriginalEntries([]);
    setDecisionAdjustmentId(null);
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

  async function runAction(work: () => Promise<void>, fallback: string): Promise<void> {
    setBusy(true);
    resetAction();
    try {
      await work();
    } catch (reason_: unknown) {
      setError(reason_ instanceof Error ? reason_.message : fallback);
    } finally {
      setBusy(false);
    }
  }

  async function createRequest(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await runAction(async () => {
      const body =
        permissions.createScope === 'AGENCY' && createEmployeeId
          ? { employeeId: createEmployeeId }
          : {};
      await post('/leave-monetization', body);
      await refresh();
      closeDialog(true);
      setSuccess('The Leave Monetization Request was drafted.');
    }, 'The request could not be drafted.');
  }

  function openSubmit(): void {
    if (!detail) return;
    resetAction();
    setKind((detail.request.kind as MonetizationKind) ?? 'REGULAR');
    setSubmitReason(detail.request.reason ?? '');
    setFormTemplateDocumentVersionId('');
    setAttestationType('AUTHENTICATED_SUBMISSION');
    setAttestationDocumentVersionId('');
    setCitations('');
    setValuationDate('');
    setFiscalPeriod('');
    setSalarySourceReference('');
    setSpecialPercentageBasis('');
    setFractionalCreditRounding('');
    setAllocationRows(
      detail.allocations.length > 0
        ? detail.allocations.map((allocation) => ({
            leaveAccountId: allocation.leaveAccountId,
            requestedQuantity: allocation.requestedQuantity,
          }))
        : [{ leaveAccountId: '', requestedQuantity: '' }],
    );
    setDialog('submit');
    void loadAccounts(detail.request.employeeId);
  }

  async function submitRequest(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!detail) return;
    await runAction(async () => {
      const snapshot: Record<string, unknown> = {
        citations: citations
          .split('\n')
          .map((citation) => citation.trim())
          .filter(Boolean),
      };
      if (valuationDate) snapshot.valuationDate = valuationDate;
      if (fiscalPeriod.trim()) snapshot.fiscalPeriod = fiscalPeriod.trim();
      if (salarySourceReference.trim())
        snapshot.salarySourceReference = salarySourceReference.trim();
      if (specialPercentageBasis) snapshot.specialPercentageBasis = specialPercentageBasis;
      if (fractionalCreditRounding) snapshot.fractionalCreditRounding = fractionalCreditRounding;
      await post('/leave-monetization/' + detail.request.id + '/submit', {
        kind,
        ...(submitReason.trim() ? { reason: submitReason.trim() } : {}),
        formTemplateDocumentVersionId,
        attestationType,
        ...(attestationType === 'SIGNED_DOCUMENT' ? { attestationDocumentVersionId } : {}),
        authoritySnapshot: snapshot,
        allocations: allocationRows
          .filter(({ leaveAccountId }) => leaveAccountId)
          .map(({ leaveAccountId, requestedQuantity }) => ({
            leaveAccountId,
            requestedQuantity,
          })),
      });
      await refresh();
      setDialog('detail');
      setSuccess('The version was submitted and bound to its Approval Route.');
    }, 'The version could not be submitted.');
  }

  async function assess(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!detail) return;
    await runAction(async () => {
      await post('/leave-monetization/' + detail.request.id + '/assessment', {
        ...(balanceEffectiveDate ? { balanceEffectiveDate } : {}),
      });
      await refresh();
      setDialog('detail');
      setSuccess('The Monetization Eligibility Assessment was recorded.');
    }, 'The assessment could not be recorded.');
  }

  async function certify(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!detail) return;
    await runAction(async () => {
      const allocations = detail.allocations.map((allocation) => {
        const quantity = certifiedQuantities[allocation.id]?.trim();
        return quantity
          ? { allocationId: allocation.id, certifiedQuantity: quantity }
          : { allocationId: allocation.id };
      });
      await post('/leave-monetization/' + detail.request.id + '/certification', { allocations });
      await refresh();
      setDialog('detail');
      setSuccess('Credits were certified and committed per allocation.');
    }, 'Credits could not be certified.');
  }

  async function returnRequest(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!detail) return;
    await runAction(async () => {
      await post('/leave-monetization/' + detail.request.id + '/return', { reason });
      await refresh();
      setDialog('detail');
      setSuccess('The request was returned for information.');
    }, 'The request could not be returned.');
  }

  async function withdrawRequest(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!detail) return;
    await runAction(async () => {
      await post('/leave-monetization/' + detail.request.id + '/withdraw', { reason });
      await refresh();
      setDialog('detail');
      setSuccess('The request was withdrawn and its commitments released.');
    }, 'The request could not be withdrawn.');
  }

  async function cancelRequest(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!detail) return;
    await runAction(async () => {
      await post('/leave-monetization/' + detail.request.id + '/cancel', { reason });
      await refresh();
      setDialog('detail');
      setSuccess('The request was cancelled.');
    }, 'The request could not be cancelled.');
  }

  async function determineFunding(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!detail) return;
    await runAction(async () => {
      let source: unknown;
      let evidence: unknown;
      try {
        source = JSON.parse(fundingSourceSnapshot);
        evidence = JSON.parse(evidenceSnapshot);
      } catch {
        throw new Error('Funding source and evidence snapshots must be valid JSON objects.');
      }
      await post('/leave-monetization/' + detail.request.id + '/funding', {
        result: fundingResult,
        fiscalAuthorityDocumentVersionId,
        fundingSourceSnapshot: source,
        evidenceSnapshot: evidence,
      });
      await refresh();
      setDialog('detail');
      setSuccess('The Monetization Funding Determination was recorded.');
    }, 'The funding determination could not be recorded.');
  }

  async function decideRequest(
    event: FormEvent<HTMLFormElement>,
    decision: 'APPROVE' | 'REJECT',
  ): Promise<void> {
    event.preventDefault();
    if (!detail) return;
    await runAction(async () => {
      const approvedAllocations =
        decision === 'APPROVE'
          ? detail.allocations
              .map((allocation) => {
                const quantity = approvalNarrowing[allocation.id]?.trim();
                return quantity
                  ? { allocationId: allocation.id, approvedQuantity: quantity }
                  : null;
              })
              .filter(
                (entry): entry is { allocationId: string; approvedQuantity: string } =>
                  entry !== null,
              )
          : [];
      await post('/leave-monetization/' + detail.request.id + '/decision', {
        decision,
        ...(comments.trim() ? { comments: comments.trim() } : {}),
        ...(approvedAllocations.length > 0 ? { approvedAllocations } : {}),
      });
      await refresh();
      setDialog('detail');
      setSuccess(
        decision === 'APPROVE'
          ? 'The request was approved.'
          : 'The request was rejected with the reviewer’s reason.',
      );
    }, 'The decision could not be recorded.');
  }

  async function postRequest(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!detail) return;
    await runAction(async () => {
      const result = (await post('/leave-monetization/' + detail.request.id + '/post', {})) as {
        outcome: string;
      };
      await refresh();
      setDialog('detail');
      setSuccess(
        result.outcome === 'ALREADY_POSTED'
          ? 'The request was already posted; no additional Payroll effect was created.'
          : 'Payroll accepted the Monetization Earning Input; credits and commitments settled.',
      );
    }, 'The request could not be posted.');
  }

  async function openAdjust(): Promise<void> {
    if (!detail || !detail.request.currentVersionId) return;
    setBusy(true);
    resetAction();
    try {
      const adjusted = new Set(
        detail.adjustments.flatMap((adjustment) =>
          adjustment.lines.map(({ originalLedgerEntryId }) => originalLedgerEntryId),
        ),
      );
      const collected: OriginalEntryOption[] = [];
      const seen = new Set<string>();
      for (const allocation of detail.allocations) {
        if (seen.has(allocation.leaveAccountId)) continue;
        seen.add(allocation.leaveAccountId);
        const account = (await request(
          '/leave-accounts/' + encodeURIComponent(allocation.leaveAccountId),
        )) as { ledgerEntries: LedgerEntryOption[] };
        for (const entry of account.ledgerEntries) {
          if (
            entry.sourceType === 'MONETIZATION_POSTING' &&
            entry.sourceId === detail.request.currentVersionId &&
            !adjusted.has(entry.id)
          ) {
            collected.push({
              id: entry.id,
              leaveAccountId: allocation.leaveAccountId,
              leaveTypeName: allocation.leaveTypeName,
              quantity: entry.quantity,
            });
          }
        }
      }
      setOriginalEntries(collected);
      setAdjustmentScope('WHOLE');
      setAdjustmentReason('');
      setSelectedOriginals(Object.fromEntries(collected.map(({ id }) => [id, false])));
      setRetainedQuantities(Object.fromEntries(collected.map(({ id }) => [id, '0'])));
      setDialog('adjust');
    } catch (reason_: unknown) {
      setError(
        reason_ instanceof Error ? reason_.message : 'Loading posting ledger entries failed.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function createAdjustment(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!detail || !detail.posting) return;
    await runAction(async () => {
      const lines = originalEntries
        .filter(({ id }) => selectedOriginals[id])
        .map(({ id }) => ({
          originalLedgerEntryId: id,
          retainedQuantity:
            adjustmentScope === 'WHOLE' ? '0' : retainedQuantities[id]?.trim() || '0',
        }));
      await post('/leave-monetization/postings/' + detail.posting!.id + '/adjustments', {
        scope: adjustmentScope,
        reason: adjustmentReason,
        lines,
      });
      await refresh();
      setDialog('detail');
      setSuccess('The Monetization Adjustment was drafted.');
    }, 'The adjustment could not be drafted.');
  }

  async function submitAdjustment(adjustmentId: string): Promise<void> {
    await runAction(async () => {
      await post('/leave-monetization/adjustments/' + adjustmentId + '/submit', {});
      await refresh();
      setDialog('detail');
      setSuccess('The Monetization Adjustment was submitted for approval.');
    }, 'The adjustment could not be submitted.');
  }

  async function decideAdjustment(
    event: FormEvent<HTMLFormElement>,
    adjustmentId: string,
    decision: 'APPROVE' | 'REJECT',
  ): Promise<void> {
    event.preventDefault();
    await runAction(async () => {
      const result = (await post('/leave-monetization/adjustments/' + adjustmentId + '/decision', {
        decision,
        ...(decisionComments.trim() ? { comments: decisionComments.trim() } : {}),
        ...(decision === 'REJECT' ? { comments: decisionComments.trim() } : {}),
      })) as { adjustment: MonetizationAdjustmentSummary; ownerResult: unknown };
      await refresh();
      setDialog('detail');
      setDecisionAdjustmentId(null);
      setSuccess(
        decision === 'REJECT'
          ? 'The Monetization Adjustment was rejected.'
          : result.adjustment.status === 'APPLIED'
            ? 'The Monetization Adjustment was approved and applied.'
            : 'The Monetization Adjustment was approved; Payroll must accept the correction.',
      );
    }, 'The adjustment decision could not be recorded.');
  }

  async function applyAdjustment(adjustmentId: string): Promise<void> {
    await runAction(async () => {
      const result = (await post(
        '/leave-monetization/adjustments/' + adjustmentId + '/apply',
        {},
      )) as {
        adjustment: MonetizationAdjustmentSummary;
      };
      await refresh();
      setDialog('detail');
      setSuccess(
        result.adjustment.status === 'APPLIED'
          ? 'Payroll accepted the correction; credits were restored.'
          : 'Payroll did not accept the correction yet; the adjustment remains retryable.',
      );
    }, 'The adjustment could not be applied.');
  }

  const rules = detail ? ruleResultsOf(detail.assessment?.ruleResults ?? null) : null;
  const detailKind = detail?.request.kind ?? null;

  return (
    <Dialog
      presentation="form"
      open={dialog !== null}
      onOpenChange={(open) => !open && closeDialog()}
    >
      <div className="grid min-w-0 gap-5">
        <PageHeader
          breadcrumbs={[{ label: 'Leave' }]}
          title="Leave Monetization"
          actions={
            permissions.createScope ? (
              <DialogTrigger asChild>
                <Button
                  // Hidden rather than unmounted, so focus can return here when a record closes.
                  hidden={dialog !== null}
                  onClick={() => {
                    resetAction();
                    void loadEmployees();
                    setCreateEmployeeId('');
                    setDialog('create');
                  }}
                  type="button"
                  variant="primary"
                >
                  New request
                </Button>
              </DialogTrigger>
            ) : null
          }
        />

        <div hidden={dialog !== null} className="grid min-w-0 gap-5">
          <p className="m-0 max-w-[760px] text-small text-ink-muted">
            One stable request with immutable submitted versions, per-account allocations, an
            explainable eligibility assessment, HR certification, a separate funding determination,
            and an approval that creates no ledger or Payroll effect. Posting is one atomic and
            idempotent Leave command.
          </p>

          <SuccessMessage message={success} />
          <FormError message={error} />

          <Panel
            title="Leave Monetization register"
            flush
            actions={
              <>
                <span className="text-caption text-ink-muted">
                  {items.length === 1 ? '1 Request' : items.length + ' Requests'}
                  {hasMore ? ' · more available' : ''}
                </span>
                <label className="flex items-center gap-2 text-caption text-ink-muted">
                  Status
                  <select
                    className={cn(inputClass, 'w-auto')}
                    onChange={(event) => setStatusFilter(targetValue(event))}
                    value={statusFilter}
                  >
                    <option value="">All statuses</option>
                    {MONETIZATION_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {status.replaceAll('_', ' ')}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            }
          >
            {items.length === 0 ? (
              <StateSurface compact label="Leave Monetization register">
                <strong className="font-[650] text-ink">No Leave Monetization Requests yet.</strong>
                <p className="m-0 max-w-[560px]">
                  Draft a request for an Employee with posted, credit-bearing Leave Accounts.
                  Ordinary monetization uses vacation leave only; special monetization needs a valid
                  and justifiable reason.
                </p>
              </StateSurface>
            ) : (
              <Table aria-label="Leave Monetization Requests" className="min-w-[860px]">
                <thead>
                  <tr>
                    <Th>Employee</Th>
                    <Th>Kind</Th>
                    <Th kind="numeric">Requested</Th>
                    <Th kind="numeric">Certified</Th>
                    <Th kind="numeric">Approved</Th>
                    <Th>Status</Th>
                    <Th>Submitted</Th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <Tr key={item.id}>
                      <RowHeader>
                        <button
                          className="cursor-pointer border-0 bg-transparent p-0 text-left font-[600] text-primary underline-offset-2 hover:underline"
                          type="button"
                          onClick={() => navigation.navigate({ record: item.id })}
                        >
                          {item.employeeName}
                        </button>
                        <span className="block font-mono text-caption font-normal text-ink-muted">
                          {item.employeeNumber}
                        </span>
                      </RowHeader>
                      <Td>
                        {item.kind ?? '—'}
                        {item.versionNo ? (
                          <span className="block text-caption text-ink-muted">
                            v{item.versionNo}
                          </span>
                        ) : null}
                      </Td>
                      <Td kind="numeric">{quantityLabel(item.requestedQuantity)}</Td>
                      <Td kind="numeric">
                        {item.certifiedQuantity ? quantityLabel(item.certifiedQuantity) : '—'}
                      </Td>
                      <Td kind="numeric" className="font-[600]">
                        {item.approvedQuantity ? quantityLabel(item.approvedQuantity) : '—'}
                      </Td>
                      <Td>
                        <StatusTag tone={statusTone(item.status)}>
                          {item.status.replaceAll('_', ' ')}
                        </StatusTag>
                      </Td>
                      <Td kind="date" className="text-ink-muted">
                        {item.submittedAt ? instantLabel(item.submittedAt) : '—'}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
            {hasMore ? (
              <div className="border-t border-border px-4 py-3">
                <Button
                  disabled={busy}
                  onClick={() => void loadMore()}
                  type="button"
                  variant="secondary"
                >
                  {busy ? 'Loading…' : 'Load more'}
                </Button>
              </div>
            ) : null}
          </Panel>
        </div>
      </div>

      {dialog === 'detail' ? (
        <div className="mb-4">
          <RecordReturn href={navigation.href({ record: null })}>← Leave Monetization</RecordReturn>
        </div>
      ) : null}

      <DialogContent aria-describedby="leave-monetization-dialog-description">
        <DialogHeader>
          <div className="grid min-w-0 gap-1.5">
            <DialogTitle>
              {dialog === 'create'
                ? 'New Leave Monetization Request'
                : dialog === 'submit'
                  ? 'Submit Monetization Version'
                  : dialog === 'assess'
                    ? 'Record eligibility assessment'
                    : dialog === 'certify'
                      ? 'Certify monetization credits'
                      : dialog === 'return'
                        ? 'Return Leave Monetization Request'
                        : dialog === 'withdraw'
                          ? 'Withdraw Leave Monetization Request'
                          : dialog === 'cancel'
                            ? 'Cancel Leave Monetization Request'
                            : dialog === 'funding'
                              ? 'Record funding determination'
                              : dialog === 'approve'
                                ? 'Approve allocations'
                                : dialog === 'reject'
                                  ? 'Reject request'
                                  : dialog === 'post'
                                    ? 'Post to Payroll'
                                    : dialog === 'adjust'
                                      ? 'Draft Monetization Adjustment'
                                      : dialog === 'adjustment-approve'
                                        ? 'Approve Monetization Adjustment'
                                        : dialog === 'adjustment-reject'
                                          ? 'Reject Monetization Adjustment'
                                          : (detail?.request.employeeName ??
                                            'Leave Monetization Request')}
            </DialogTitle>
            <DialogDescription id="leave-monetization-dialog-description">
              {dialog === 'create'
                ? 'Draft one stable request for an Employee. Submitted versions become immutable.'
                : dialog === 'submit'
                  ? 'Bind the exact form template, attestation, authority snapshot, and per-account allocations to a new immutable version.'
                  : dialog === 'assess'
                    ? 'Lock the accounts, recheck balances and commitments, and record one explainable eligibility result.'
                    : dialog === 'certify'
                      ? 'One Leave Credit Commitment per allocation is created atomically. Certified quantities may only narrow the request.'
                      : dialog === 'return'
                        ? 'Return the request for information and release the current commitments.'
                        : dialog === 'withdraw'
                          ? 'Withdraw the request, cancel its Approval Request, and release every commitment.'
                          : dialog === 'cancel'
                            ? 'Cancel a draft or approved request and release every commitment.'
                            : dialog === 'funding'
                              ? 'Record the separate immutable funding determination with its exact fiscal authority and evidence.'
                              : dialog === 'approve'
                                ? 'Approval binds the exact version and creates no ledger or Payroll effect. Narrow allocations only against the same accounts.'
                                : dialog === 'reject'
                                  ? 'Rejection requires a reviewer reason and creates no ledger or Payroll effect.'
                                  : dialog === 'post'
                                    ? 'Posting is one atomic and idempotent Leave command. Payroll owns salary resolution, calculation, and rounding.'
                                    : dialog === 'adjust'
                                      ? 'Reverse posting ledger entries and replace only the retained credits. Payroll accepts the correction before credits are restored.'
                                      : dialog === 'adjustment-approve' ||
                                          dialog === 'adjustment-reject'
                                        ? 'The adjustment decision uses the bound Approval Route. Approval attempts the Payroll correction immediately.'
                                        : 'Versions, allocations, assessment, certification, funding, posting, and adjustments.'}
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              Close
            </Button>
          </DialogClose>
        </DialogHeader>

        {error ? (
          <DialogBody className="pb-0">
            <FormError message={error} />
          </DialogBody>
        ) : null}

        {dialog === 'create' ? (
          <form onSubmit={(event) => void createRequest(event)}>
            <DialogBody className="grid gap-5">
              {permissions.createScope === 'AGENCY' ? (
                <Field htmlFor="monetization-employee" label="Employee">
                  <select
                    autoFocus
                    className={inputClass}
                    data-autofocus=""
                    id="monetization-employee"
                    onChange={(event) => setCreateEmployeeId(targetValue(event))}
                    required
                    value={createEmployeeId}
                  >
                    <option value="">Select an Employee</option>
                    {employeeOptions.map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.employeeNumber} · {employee.legalName}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : (
                <p className="m-0 text-caption text-ink-muted">
                  The request is created for your linked Employee record.
                </p>
              )}
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button disabled={busy} type="button" variant="secondary">
                  Cancel
                </Button>
              </DialogClose>
              <Button disabled={busy} type="submit" variant="primary">
                {busy ? 'Drafting…' : 'Draft request'}
              </Button>
            </DialogFooter>
          </form>
        ) : null}

        {dialog === 'submit' && detail ? (
          <form onSubmit={(event) => void submitRequest(event)}>
            <DialogBody className="grid gap-5">
              <div className="grid gap-4 min-[621px]:grid-cols-2">
                <Field htmlFor="monetization-kind" label="Kind">
                  <select
                    autoFocus
                    className={inputClass}
                    data-autofocus=""
                    id="monetization-kind"
                    onChange={(event) =>
                      setKind(targetValue(event) === 'SPECIAL' ? 'SPECIAL' : 'REGULAR')
                    }
                    value={kind}
                  >
                    <option value="REGULAR">Regular · vacation leave only</option>
                    <option value="SPECIAL">Special · vacation and sick leave by authority</option>
                  </select>
                </Field>
                <Field
                  htmlFor="monetization-form-template"
                  label="Form template Document Version ID"
                >
                  <input
                    className={inputClass}
                    id="monetization-form-template"
                    onChange={(event) => setFormTemplateDocumentVersionId(targetValue(event))}
                    placeholder="00000000-0000-0000-0000-000000000000"
                    required
                    value={formTemplateDocumentVersionId}
                  />
                </Field>
              </div>
              <Field
                htmlFor="monetization-reason"
                label="Reason (required for special monetization)"
              >
                <textarea
                  className={inputClass + ' min-h-[72px] py-2'}
                  id="monetization-reason"
                  maxLength={2000}
                  onChange={(event) => setSubmitReason(targetValue(event))}
                  required={kind === 'SPECIAL'}
                  value={submitReason}
                />
              </Field>
              <div className="grid gap-4 min-[621px]:grid-cols-2">
                <Field htmlFor="monetization-attestation" label="Attestation">
                  <select
                    className={inputClass}
                    id="monetization-attestation"
                    onChange={(event) =>
                      setAttestationType(
                        targetValue(event) === 'SIGNED_DOCUMENT'
                          ? 'SIGNED_DOCUMENT'
                          : 'AUTHENTICATED_SUBMISSION',
                      )
                    }
                    value={attestationType}
                  >
                    <option value="AUTHENTICATED_SUBMISSION">Authenticated submission</option>
                    <option value="SIGNED_DOCUMENT">Signed document</option>
                  </select>
                </Field>
                {attestationType === 'SIGNED_DOCUMENT' ? (
                  <Field
                    htmlFor="monetization-attestation-document"
                    label="Signed attestation Document Version ID"
                  >
                    <input
                      className={inputClass}
                      id="monetization-attestation-document"
                      onChange={(event) => setAttestationDocumentVersionId(targetValue(event))}
                      placeholder="00000000-0000-0000-0000-000000000000"
                      required
                      value={attestationDocumentVersionId}
                    />
                  </Field>
                ) : null}
              </div>
              <fieldset className="m-0 grid gap-4 rounded-control border border-border p-4">
                <legend className="px-1 text-caption font-[650] text-ink">
                  Authority snapshot
                </legend>
                <Field htmlFor="monetization-citations" label="Citations (one per line)">
                  <textarea
                    className={inputClass + ' min-h-[72px] py-2'}
                    id="monetization-citations"
                    onChange={(event) => setCitations(targetValue(event))}
                    required
                    value={citations}
                  />
                </Field>
                <div className="grid gap-4 min-[621px]:grid-cols-2">
                  <Field htmlFor="monetization-valuation-date" label="Valuation date">
                    <input
                      className={inputClass}
                      id="monetization-valuation-date"
                      onChange={(event) => setValuationDate(targetValue(event))}
                      type="date"
                      value={valuationDate}
                    />
                  </Field>
                  <Field htmlFor="monetization-fiscal-period" label="Fiscal period">
                    <input
                      className={inputClass}
                      id="monetization-fiscal-period"
                      onChange={(event) => setFiscalPeriod(targetValue(event))}
                      value={fiscalPeriod}
                    />
                  </Field>
                  <Field htmlFor="monetization-salary-source" label="Salary source reference">
                    <input
                      className={inputClass}
                      id="monetization-salary-source"
                      onChange={(event) => setSalarySourceReference(targetValue(event))}
                      value={salarySourceReference}
                    />
                  </Field>
                  <Field htmlFor="monetization-share-basis" label="Special percentage basis">
                    <select
                      className={inputClass}
                      id="monetization-share-basis"
                      onChange={(event) => setSpecialPercentageBasis(targetValue(event))}
                      value={specialPercentageBasis}
                    >
                      <option value="">Not stated</option>
                      <option value="PER_ACCOUNT">Per account</option>
                      <option value="COMBINED">Combined</option>
                    </select>
                  </Field>
                  <Field htmlFor="monetization-rounding" label="Fractional credit rounding">
                    <select
                      className={inputClass}
                      id="monetization-rounding"
                      onChange={(event) => setFractionalCreditRounding(targetValue(event))}
                      value={fractionalCreditRounding}
                    >
                      <option value="">Not stated</option>
                      <option value="DOWN">Round down</option>
                      <option value="NEAREST">Nearest</option>
                    </select>
                  </Field>
                </div>
              </fieldset>
              <fieldset className="m-0 grid gap-4 rounded-control border border-border p-4">
                <legend className="px-1 text-caption font-[650] text-ink">Allocations</legend>
                {accountOptions.filter((account) =>
                  (kind === 'REGULAR' ? REGULAR_LEAVE_TYPES : SPECIAL_LEAVE_TYPES).includes(
                    account.leaveTypeCode,
                  ),
                ).length === 0 ? (
                  <p className="m-0 text-caption text-ink-muted">
                    No ACTIVE Leave Account matches this kind for the Employee.
                  </p>
                ) : null}
                {allocationRows.map((row, index) => (
                  <div className="grid gap-4 min-[621px]:grid-cols-2" key={String(index)}>
                    <Field
                      htmlFor={'monetization-allocation-' + index}
                      label={'Leave Account ' + (index + 1)}
                    >
                      <select
                        className={inputClass}
                        id={'monetization-allocation-' + index}
                        onChange={(event) => {
                          const leaveAccountId = targetValue(event);
                          setAllocationRows((current) =>
                            current.map((entry, entryIndex) =>
                              entryIndex === index ? { ...entry, leaveAccountId } : entry,
                            ),
                          );
                        }}
                        required
                        value={row.leaveAccountId}
                      >
                        <option value="">Select a Leave Account</option>
                        {accountOptions
                          .filter((account) =>
                            (kind === 'REGULAR'
                              ? REGULAR_LEAVE_TYPES
                              : SPECIAL_LEAVE_TYPES
                            ).includes(account.leaveTypeCode),
                          )
                          .map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.leaveTypeName} · available{' '}
                              {quantityLabel(account.balances.availableQuantity)}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <Field htmlFor={'monetization-quantity-' + index} label="Requested quantity">
                      <input
                        className={inputClass}
                        id={'monetization-quantity-' + index}
                        min={0}
                        onChange={(event) => {
                          const requestedQuantity = targetValue(event);
                          setAllocationRows((current) =>
                            current.map((entry, entryIndex) =>
                              entryIndex === index ? { ...entry, requestedQuantity } : entry,
                            ),
                          );
                        }}
                        required
                        step="0.0001"
                        type="number"
                        value={row.requestedQuantity}
                      />
                    </Field>
                  </div>
                ))}
                <div>
                  <Button
                    onClick={() =>
                      setAllocationRows((current) => [
                        ...current,
                        { leaveAccountId: '', requestedQuantity: '' },
                      ])
                    }
                    type="button"
                    variant="secondary"
                  >
                    Add allocation
                  </Button>
                </div>
              </fieldset>
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button disabled={busy} type="button" variant="secondary">
                  Cancel
                </Button>
              </DialogClose>
              <Button disabled={busy} type="submit" variant="primary">
                {busy ? 'Submitting…' : 'Submit version'}
              </Button>
            </DialogFooter>
          </form>
        ) : null}

        {dialog === 'assess' ? (
          <form onSubmit={(event) => void assess(event)}>
            <DialogBody className="grid gap-5">
              <Field htmlFor="monetization-balance-date" label="Balance effective date (optional)">
                <input
                  autoFocus
                  className={inputClass}
                  data-autofocus=""
                  id="monetization-balance-date"
                  onChange={(event) => setBalanceEffectiveDate(targetValue(event))}
                  type="date"
                  value={balanceEffectiveDate}
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
                {busy ? 'Recording…' : 'Record assessment'}
              </Button>
            </DialogFooter>
          </form>
        ) : null}

        {dialog === 'certify' && detail ? (
          <form onSubmit={(event) => void certify(event)}>
            <DialogBody className="grid gap-5">
              {detail.allocations.map((allocation) => (
                <Field
                  htmlFor={'monetization-certify-' + allocation.id}
                  key={allocation.id}
                  label={
                    allocation.leaveTypeName +
                    ' · requested ' +
                    quantityLabel(allocation.requestedQuantity)
                  }
                >
                  <input
                    className={inputClass}
                    id={'monetization-certify-' + allocation.id}
                    min={0}
                    onChange={(event) => {
                      const certifiedQuantity = targetValue(event);
                      setCertifiedQuantities((current) => ({
                        ...current,
                        [allocation.id]: certifiedQuantity,
                      }));
                    }}
                    placeholder="Certify the full requested quantity"
                    step="0.0001"
                    type="number"
                    value={certifiedQuantities[allocation.id] ?? ''}
                  />
                </Field>
              ))}
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

        {dialog === 'return' || dialog === 'withdraw' || dialog === 'cancel' ? (
          <form
            onSubmit={(event) =>
              void (dialog === 'return'
                ? returnRequest(event)
                : dialog === 'withdraw'
                  ? withdrawRequest(event)
                  : cancelRequest(event))
            }
          >
            <DialogBody className="grid gap-5">
              <Field htmlFor="monetization-action-reason" label="Reason">
                <textarea
                  autoFocus
                  className={inputClass + ' min-h-[72px] py-2'}
                  data-autofocus=""
                  id="monetization-action-reason"
                  maxLength={2000}
                  onChange={(event) => setReason(targetValue(event))}
                  required
                  value={reason}
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
                  : dialog === 'return'
                    ? 'Return request'
                    : dialog === 'withdraw'
                      ? 'Withdraw request'
                      : 'Cancel request'}
              </Button>
            </DialogFooter>
          </form>
        ) : null}

        {dialog === 'funding' ? (
          <form onSubmit={(event) => void determineFunding(event)}>
            <DialogBody className="grid gap-5">
              <div className="grid gap-4 min-[621px]:grid-cols-2">
                <Field htmlFor="monetization-funding-result" label="Result">
                  <select
                    autoFocus
                    className={inputClass}
                    data-autofocus=""
                    id="monetization-funding-result"
                    onChange={(event) => {
                      const value = targetValue(event);
                      setFundingResult(
                        value === 'UNSUPPORTED' || value === 'INDETERMINATE' ? value : 'SUPPORTED',
                      );
                    }}
                    value={fundingResult}
                  >
                    <option value="SUPPORTED">Supported</option>
                    <option value="UNSUPPORTED">Unsupported</option>
                    <option value="INDETERMINATE">Indeterminate</option>
                  </select>
                </Field>
                <Field
                  htmlFor="monetization-fiscal-authority"
                  label="Fiscal authority Document Version ID"
                >
                  <input
                    className={inputClass}
                    id="monetization-fiscal-authority"
                    onChange={(event) => setFiscalAuthorityDocumentVersionId(targetValue(event))}
                    placeholder="00000000-0000-0000-0000-000000000000"
                    required
                    value={fiscalAuthorityDocumentVersionId}
                  />
                </Field>
              </div>
              <Field htmlFor="monetization-funding-source" label="Funding source snapshot (JSON)">
                <textarea
                  className={inputClass + ' min-h-[92px] py-2 font-mono text-caption'}
                  id="monetization-funding-source"
                  onChange={(event) => setFundingSourceSnapshot(targetValue(event))}
                  required
                  value={fundingSourceSnapshot}
                />
              </Field>
              <Field htmlFor="monetization-evidence-snapshot" label="Evidence snapshot (JSON)">
                <textarea
                  className={inputClass + ' min-h-[92px] py-2 font-mono text-caption'}
                  id="monetization-evidence-snapshot"
                  onChange={(event) => setEvidenceSnapshot(targetValue(event))}
                  required
                  value={evidenceSnapshot}
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
                {busy ? 'Recording…' : 'Record determination'}
              </Button>
            </DialogFooter>
          </form>
        ) : null}

        {dialog === 'approve' && detail ? (
          <form onSubmit={(event) => void decideRequest(event, 'APPROVE')}>
            <DialogBody className="grid gap-5">
              {detail.allocations.map((allocation) => (
                <Field
                  htmlFor={'monetization-approve-' + allocation.id}
                  key={allocation.id}
                  label={
                    allocation.leaveTypeName +
                    ' · certified ' +
                    quantityLabel(allocation.certifiedQuantity ?? allocation.requestedQuantity)
                  }
                >
                  <input
                    className={inputClass}
                    id={'monetization-approve-' + allocation.id}
                    min={0}
                    onChange={(event) => {
                      const approvedQuantity = targetValue(event);
                      setApprovalNarrowing((current) => ({
                        ...current,
                        [allocation.id]: approvedQuantity,
                      }));
                    }}
                    placeholder="Approve the certified quantity"
                    step="0.0001"
                    type="number"
                    value={approvalNarrowing[allocation.id] ?? ''}
                  />
                </Field>
              ))}
              <Field htmlFor="monetization-approve-comments" label="Comments (optional)">
                <input
                  className={inputClass}
                  id="monetization-approve-comments"
                  maxLength={2000}
                  onChange={(event) => setComments(targetValue(event))}
                  value={comments}
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
                {busy ? 'Approving…' : 'Approve request'}
              </Button>
            </DialogFooter>
          </form>
        ) : null}

        {dialog === 'reject' ? (
          <form onSubmit={(event) => void decideRequest(event, 'REJECT')}>
            <DialogBody className="grid gap-5">
              <Field htmlFor="monetization-reject-comments" label="Reviewer reason">
                <textarea
                  autoFocus
                  className={inputClass + ' min-h-[72px] py-2'}
                  data-autofocus=""
                  id="monetization-reject-comments"
                  maxLength={2000}
                  onChange={(event) => setComments(targetValue(event))}
                  required
                  value={comments}
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
                {busy ? 'Rejecting…' : 'Reject request'}
              </Button>
            </DialogFooter>
          </form>
        ) : null}

        {dialog === 'post' ? (
          <form onSubmit={(event) => void postRequest(event)}>
            <DialogBody className="grid gap-4">
              <p className="m-0 text-caption text-ink-muted">
                Posting hands the authority-bound allocations to Payroll and, only with an accepted
                result, commits the ledger deductions and commitment consumption. Duplicate attempts
                create no additional effect.
              </p>
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button disabled={busy} type="button" variant="secondary">
                  Cancel
                </Button>
              </DialogClose>
              <Button disabled={busy} type="submit" variant="primary">
                {busy ? 'Posting…' : 'Post to Payroll'}
              </Button>
            </DialogFooter>
          </form>
        ) : null}

        {dialog === 'adjust' ? (
          <form onSubmit={(event) => void createAdjustment(event)}>
            <DialogBody className="grid gap-5">
              <div className="grid gap-4 min-[621px]:grid-cols-2">
                <Field htmlFor="monetization-adjustment-scope" label="Scope">
                  <select
                    autoFocus
                    className={inputClass}
                    data-autofocus=""
                    id="monetization-adjustment-scope"
                    onChange={(event) =>
                      setAdjustmentScope(targetValue(event) === 'PARTIAL' ? 'PARTIAL' : 'WHOLE')
                    }
                    value={adjustmentScope}
                  >
                    <option value="WHOLE">Whole · retain no credits</option>
                    <option value="PARTIAL">Partial · retain credits</option>
                  </select>
                </Field>
                <Field htmlFor="monetization-adjustment-reason" label="Reason">
                  <input
                    className={inputClass}
                    id="monetization-adjustment-reason"
                    maxLength={2000}
                    onChange={(event) => setAdjustmentReason(targetValue(event))}
                    required
                    value={adjustmentReason}
                  />
                </Field>
              </div>
              {originalEntries.length === 0 ? (
                <p className="m-0 text-caption text-ink-muted">
                  Every posting ledger entry already has a Monetization Adjustment.
                </p>
              ) : (
                <Table aria-label="Posting ledger entries" className="min-w-[480px]">
                  <thead>
                    <tr>
                      <Th>Entry</Th>
                      <Th kind="numeric">Deducted</Th>
                      {adjustmentScope === 'PARTIAL' ? <Th>Retained</Th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {originalEntries.map((entry) => (
                      <Tr key={entry.id}>
                        <Td>
                          <label className="flex items-center gap-2 text-small text-ink">
                            <input
                              checked={selectedOriginals[entry.id] ?? false}
                              className="size-3.5 accent-primary"
                              onChange={(event) => {
                                const selected = targetChecked(event);
                                setSelectedOriginals((current) => ({
                                  ...current,
                                  [entry.id]: selected,
                                }));
                              }}
                              type="checkbox"
                            />
                            {entry.leaveTypeName} · {entry.id.slice(0, 8)}
                          </label>
                        </Td>
                        <Td kind="numeric" className="font-[600]">
                          {quantityLabel(entry.quantity)}
                        </Td>
                        {adjustmentScope === 'PARTIAL' ? (
                          <Td>
                            <input
                              aria-label={`Retained quantity for ${entry.leaveTypeName} · ${entry.id.slice(0, 8)}`}
                              className={inputClass}
                              disabled={!(selectedOriginals[entry.id] ?? false)}
                              min={0}
                              onChange={(event) => {
                                const retainedQuantity = targetValue(event);
                                setRetainedQuantities((current) => ({
                                  ...current,
                                  [entry.id]: retainedQuantity,
                                }));
                              }}
                              step="0.0001"
                              type="number"
                              value={retainedQuantities[entry.id] ?? '0'}
                            />
                          </Td>
                        ) : null}
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button disabled={busy} type="button" variant="secondary">
                  Cancel
                </Button>
              </DialogClose>
              <Button
                disabled={busy || originalEntries.length === 0}
                type="submit"
                variant="primary"
              >
                {busy ? 'Drafting…' : 'Draft adjustment'}
              </Button>
            </DialogFooter>
          </form>
        ) : null}

        {dialog === 'adjustment-approve' || dialog === 'adjustment-reject' ? (
          <form
            onSubmit={(event) =>
              decisionAdjustmentId
                ? void decideAdjustment(
                    event,
                    decisionAdjustmentId,
                    dialog === 'adjustment-reject' ? 'REJECT' : 'APPROVE',
                  )
                : undefined
            }
          >
            <DialogBody className="grid gap-5">
              {dialog === 'adjustment-approve' ? (
                <p className="m-0 text-caption text-ink-muted">
                  Approval attempts the Payroll correction immediately. If Payroll does not accept,
                  the adjustment stays retryable and no credits move.
                </p>
              ) : (
                <Field htmlFor="monetization-adjustment-comments" label="Reviewer reason">
                  <textarea
                    autoFocus
                    className={inputClass + ' min-h-[72px] py-2'}
                    data-autofocus=""
                    id="monetization-adjustment-comments"
                    maxLength={2000}
                    onChange={(event) => setDecisionComments(targetValue(event))}
                    required
                    value={decisionComments}
                  />
                </Field>
              )}
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
                  : dialog === 'adjustment-approve'
                    ? 'Approve adjustment'
                    : 'Reject adjustment'}
              </Button>
            </DialogFooter>
          </form>
        ) : null}

        {dialog === 'detail' ? (
          <DialogBody className="grid gap-6">
            {detailLoading ? (
              <StateSurface compact busy label="Leave Monetization record">
                <p className="m-0" role="status">
                  Loading the Leave Monetization record…
                </p>
              </StateSurface>
            ) : !detail ? (
              error ? (
                <StateSurface compact label="Leave Monetization record">
                  <p className="m-0">The Leave Monetization record could not be loaded.</p>
                </StateSurface>
              ) : null
            ) : (
              <>
                <SuccessMessage message={success} />
                <section className="grid gap-3" aria-labelledby="monetization-snapshot-heading">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className={sectionTitleClass} id="monetization-snapshot-heading">
                      {detail.request.employeeName} · {detailKind ?? 'No version yet'}
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {permissions.submit &&
                      (detail.request.status === 'DRAFT' ||
                        detail.request.status === 'NEEDS_INFORMATION') ? (
                        <Button onClick={openSubmit} type="button" variant="secondary">
                          {detail.request.status === 'DRAFT'
                            ? 'Submit version'
                            : 'Resubmit version'}
                        </Button>
                      ) : null}
                      {permissions.certify && detail.request.status === 'SUBMITTED' ? (
                        <Button
                          onClick={() => {
                            resetAction();
                            setBalanceEffectiveDate('');
                            setDialog('assess');
                          }}
                          type="button"
                          variant="secondary"
                        >
                          Assess eligibility
                        </Button>
                      ) : null}
                      {permissions.certify && detail.request.status === 'SUBMITTED' ? (
                        <Button
                          onClick={() => {
                            resetAction();
                            setCertifiedQuantities({});
                            setDialog('certify');
                          }}
                          type="button"
                          variant="secondary"
                        >
                          Certify credits
                        </Button>
                      ) : null}
                      {permissions.reviewFunding && detail.request.status === 'CREDIT_CERTIFIED' ? (
                        <Button
                          onClick={() => {
                            resetAction();
                            setFundingResult('SUPPORTED');
                            setFiscalAuthorityDocumentVersionId('');
                            setFundingSourceSnapshot('{}');
                            setEvidenceSnapshot('{}');
                            setDialog('funding');
                          }}
                          type="button"
                          variant="secondary"
                        >
                          Determine funding
                        </Button>
                      ) : null}
                      {permissions.approve && detail.request.status === 'FOR_APPROVAL' ? (
                        <Button
                          onClick={() => {
                            resetAction();
                            setApprovalNarrowing({});
                            setComments('');
                            setDialog('approve');
                          }}
                          type="button"
                          variant="primary"
                        >
                          Approve
                        </Button>
                      ) : null}
                      {permissions.reject && detail.request.status === 'FOR_APPROVAL' ? (
                        <Button
                          onClick={() => {
                            resetAction();
                            setComments('');
                            setDialog('reject');
                          }}
                          type="button"
                          variant="secondary"
                        >
                          Reject
                        </Button>
                      ) : null}
                      {permissions.post && detail.request.status === 'APPROVED' ? (
                        <Button
                          onClick={() => {
                            resetAction();
                            setDialog('post');
                          }}
                          type="button"
                          variant="primary"
                        >
                          Post to Payroll
                        </Button>
                      ) : null}
                      {permissions.adjust && detail.request.status === 'POSTED' ? (
                        <Button onClick={() => void openAdjust()} type="button" variant="secondary">
                          Record adjustment
                        </Button>
                      ) : null}
                      {permissions.returnRequest &&
                      (detail.request.status === 'SUBMITTED' ||
                        detail.request.status === 'CREDIT_CERTIFIED') ? (
                        <Button
                          onClick={() => {
                            resetAction();
                            setReason('');
                            setDialog('return');
                          }}
                          type="button"
                          variant="secondary"
                        >
                          Return
                        </Button>
                      ) : null}
                      {permissions.withdraw &&
                      (detail.request.status === 'SUBMITTED' ||
                        detail.request.status === 'CREDIT_CERTIFIED' ||
                        detail.request.status === 'NEEDS_INFORMATION' ||
                        detail.request.status === 'FOR_APPROVAL') ? (
                        <Button
                          onClick={() => {
                            resetAction();
                            setReason('');
                            setDialog('withdraw');
                          }}
                          type="button"
                          variant="secondary"
                        >
                          Withdraw
                        </Button>
                      ) : null}
                      {permissions.cancel &&
                      (detail.request.status === 'DRAFT' ||
                        detail.request.status === 'APPROVED') ? (
                        <Button
                          onClick={() => {
                            resetAction();
                            setReason('');
                            setDialog('cancel');
                          }}
                          type="button"
                          variant="secondary"
                        >
                          Cancel request
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  <dl className="m-0 flex flex-wrap gap-x-10 gap-y-3">
                    <Fact label="Employee number" value={detail.request.employeeNumber} />
                    <div>
                      <dt className="text-caption text-ink-muted">Status</dt>
                      <dd className="m-0 pt-0.5">
                        <StatusTag tone={statusTone(detail.request.status)}>
                          {detail.request.status.replaceAll('_', ' ')}
                        </StatusTag>
                      </dd>
                    </div>
                    {detail.request.versionNo ? (
                      <Fact label="Version" value={String(detail.request.versionNo)} />
                    ) : null}
                    <Fact label="Created" value={instantLabel(detail.request.createdAt)} />
                    {detail.request.submittedAt ? (
                      <Fact label="Submitted" value={instantLabel(detail.request.submittedAt)} />
                    ) : null}
                  </dl>
                  {detail.request.reason ? (
                    <p className="m-0 text-small text-ink-muted">{detail.request.reason}</p>
                  ) : null}
                </section>

                <section className="grid gap-3" aria-labelledby="monetization-allocations-heading">
                  <h3 className={sectionTitleClass} id="monetization-allocations-heading">
                    Allocations
                  </h3>
                  {detail.allocations.length === 0 ? (
                    <StateSurface compact label="Allocations">
                      <p className="m-0">No submitted allocations.</p>
                    </StateSurface>
                  ) : (
                    <Table
                      aria-labelledby="monetization-allocations-heading"
                      className="min-w-[560px]"
                    >
                      <thead>
                        <tr>
                          <Th>Leave type</Th>
                          <Th kind="numeric">Requested</Th>
                          <Th kind="numeric">Certified</Th>
                          <Th kind="numeric">Approved</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.allocations.map((allocation) => (
                          <Tr key={allocation.id}>
                            <RowHeader>
                              {allocation.leaveTypeName}
                              <span className="block font-mono text-caption font-normal text-ink-muted">
                                {allocation.leaveTypeCode}
                              </span>
                            </RowHeader>
                            <Td kind="numeric">{quantityLabel(allocation.requestedQuantity)}</Td>
                            <Td kind="numeric">
                              {allocation.certifiedQuantity
                                ? quantityLabel(allocation.certifiedQuantity)
                                : '—'}
                            </Td>
                            <Td kind="numeric">
                              {allocation.approvedQuantity
                                ? quantityLabel(allocation.approvedQuantity)
                                : '—'}
                            </Td>
                          </Tr>
                        ))}
                      </tbody>
                    </Table>
                  )}
                </section>

                <section className="grid gap-3" aria-labelledby="monetization-assessment-heading">
                  <h3 className={sectionTitleClass} id="monetization-assessment-heading">
                    Eligibility assessment
                  </h3>
                  {!detail.assessment ? (
                    <StateSurface compact label="Eligibility assessment">
                      <p className="m-0">No assessment recorded.</p>
                    </StateSurface>
                  ) : (
                    <>
                      <dl className="m-0 flex flex-wrap gap-x-10 gap-y-3">
                        <div>
                          <dt className="text-caption text-ink-muted">Result</dt>
                          <dd className="m-0 pt-0.5">
                            <StatusTag tone={resultTone(detail.assessment.result)}>
                              {detail.assessment.result}
                            </StatusTag>
                          </dd>
                        </div>
                        <Fact
                          label="Balance effective"
                          value={dateLabel(detail.assessment.balanceEffectiveDate)}
                        />
                        <Fact
                          label="Ledger cutoff"
                          value={instantLabel(detail.assessment.ledgerCutoff)}
                        />
                        <Fact label="Assessed" value={instantLabel(detail.assessment.assessedAt)} />
                      </dl>
                      {rules ? (
                        <ul className="m-0 grid list-none gap-3 p-0 text-small">
                          {rules.map((rule, index) => (
                            <li className="grid gap-1 text-ink-muted" key={rule.rule + ':' + index}>
                              <span className="flex flex-wrap items-center gap-2 font-[650] text-ink">
                                {rule.rule}
                                <StatusTag tone={resultTone(rule.outcome)}>
                                  {rule.outcome}
                                </StatusTag>
                              </span>
                              <span>{rule.message}</span>
                              <span className="text-caption">{rule.citation}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <pre className={preClass}>{jsonLabel(detail.assessment.ruleResults)}</pre>
                      )}
                    </>
                  )}
                </section>

                <section
                  className="grid gap-3"
                  aria-labelledby="monetization-certification-heading"
                >
                  <h3 className={sectionTitleClass} id="monetization-certification-heading">
                    HR credit certification
                  </h3>
                  {!detail.certification ? (
                    <StateSurface compact label="HR credit certification">
                      <p className="m-0">No certification recorded.</p>
                    </StateSurface>
                  ) : (
                    <>
                      <p className="m-0 text-caption text-ink-muted">
                        Certified {instantLabel(detail.certification.certifiedAt)}
                      </p>
                      <Table
                        aria-labelledby="monetization-certification-heading"
                        className="min-w-[560px]"
                      >
                        <thead>
                          <tr>
                            <Th kind="numeric">Posted balance</Th>
                            <Th kind="numeric">Other commitments</Th>
                            <Th kind="numeric">Certified</Th>
                            <Th kind="numeric">Resulting available</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.certification.lines.map((line) => (
                            <Tr key={line.id}>
                              <Td kind="numeric">{quantityLabel(line.postedBalance)}</Td>
                              <Td kind="numeric">{quantityLabel(line.otherActiveCommitments)}</Td>
                              <Td kind="numeric" className="font-[600]">
                                {quantityLabel(line.certifiedQuantity)}
                              </Td>
                              <Td kind="numeric">
                                {quantityLabel(line.resultingAvailableQuantity)}
                              </Td>
                            </Tr>
                          ))}
                        </tbody>
                      </Table>
                    </>
                  )}
                </section>

                <section className="grid gap-3" aria-labelledby="monetization-funding-heading">
                  <h3 className={sectionTitleClass} id="monetization-funding-heading">
                    Funding determination
                  </h3>
                  {!detail.funding ? (
                    <StateSurface compact label="Funding determination">
                      <p className="m-0">No funding determination recorded.</p>
                    </StateSurface>
                  ) : (
                    <div className="grid gap-3 text-small">
                      <dl className="m-0 flex flex-wrap gap-x-10 gap-y-3">
                        <div>
                          <dt className="text-caption text-ink-muted">Result</dt>
                          <dd className="m-0 pt-0.5">
                            <StatusTag tone={resultTone(detail.funding.result)}>
                              {detail.funding.result}
                            </StatusTag>
                          </dd>
                        </div>
                        <Fact label="Reviewed" value={instantLabel(detail.funding.reviewedAt)} />
                        <Fact
                          label="Fiscal authority Document Version"
                          value={detail.funding.fiscalAuthorityDocumentVersionId}
                        />
                      </dl>
                      <details>
                        <summary className="cursor-pointer font-[650] text-ink">
                          Funding source snapshot
                        </summary>
                        <pre className={preClass}>
                          {jsonLabel(detail.funding.fundingSourceSnapshot)}
                        </pre>
                      </details>
                      <details>
                        <summary className="cursor-pointer font-[650] text-ink">
                          Evidence snapshot
                        </summary>
                        <pre className={preClass}>{jsonLabel(detail.funding.evidenceSnapshot)}</pre>
                      </details>
                    </div>
                  )}
                </section>

                <section className="grid gap-3" aria-labelledby="monetization-posting-heading">
                  <h3 className={sectionTitleClass} id="monetization-posting-heading">
                    Payroll posting
                  </h3>
                  {!detail.posting ? (
                    <StateSurface compact label="Payroll posting">
                      <p className="m-0">
                        None — not posted. Approval alone creates no ledger or Payroll effect.
                      </p>
                    </StateSurface>
                  ) : (
                    <dl className="m-0 flex flex-wrap gap-x-10 gap-y-3">
                      <Fact label="Posting key" value={detail.posting.postingKey} />
                      <Fact
                        label="Valuation date"
                        value={dateLabel(detail.posting.valuationDate)}
                      />
                      <Fact label="Calculator" value={detail.posting.calculatorKind} />
                      <Fact label="Factor" value={detail.posting.factor} />
                      <Fact label="Payroll input" value={detail.posting.payrollInputId} />
                      <Fact label="Posted" value={instantLabel(detail.posting.postedAt)} />
                    </dl>
                  )}
                </section>

                <section className="grid gap-3" aria-labelledby="monetization-adjustments-heading">
                  <h3 className={sectionTitleClass} id="monetization-adjustments-heading">
                    Monetization Adjustments
                  </h3>
                  {detail.adjustments.length === 0 ? (
                    <StateSurface compact label="Monetization Adjustments">
                      <p className="m-0">No Monetization Adjustments recorded.</p>
                    </StateSurface>
                  ) : (
                    detail.adjustments.map((adjustment) => (
                      <div
                        className="grid gap-3 rounded-panel border border-border p-4"
                        key={adjustment.id}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-3 text-small text-ink-muted">
                            <StatusTag tone={adjustmentStatusTone(adjustment.status)}>
                              {adjustment.status}
                            </StatusTag>
                            <span>{adjustment.scope}</span>
                            <span>{adjustment.reason}</span>
                            {adjustment.appliedAt ? (
                              <span>Applied {instantLabel(adjustment.appliedAt)}</span>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {permissions.adjust && adjustment.status === 'DRAFT' ? (
                              <Button
                                onClick={() => void submitAdjustment(adjustment.id)}
                                type="button"
                                variant="secondary"
                              >
                                Submit adjustment
                              </Button>
                            ) : null}
                            {permissions.approve && adjustment.status === 'FOR_APPROVAL' ? (
                              <Button
                                onClick={() => {
                                  resetAction();
                                  setDecisionAdjustmentId(adjustment.id);
                                  setDecisionComments('');
                                  setDialog('adjustment-approve');
                                }}
                                type="button"
                                variant="primary"
                              >
                                Approve adjustment
                              </Button>
                            ) : null}
                            {permissions.reject && adjustment.status === 'FOR_APPROVAL' ? (
                              <Button
                                onClick={() => {
                                  resetAction();
                                  setDecisionAdjustmentId(adjustment.id);
                                  setDecisionComments('');
                                  setDialog('adjustment-reject');
                                }}
                                type="button"
                                variant="secondary"
                              >
                                Reject adjustment
                              </Button>
                            ) : null}
                            {permissions.adjust &&
                            (adjustment.status === 'APPROVED' ||
                              adjustment.status === 'RETRYABLE') ? (
                              <Button
                                onClick={() => void applyAdjustment(adjustment.id)}
                                type="button"
                                variant="secondary"
                              >
                                Apply correction
                              </Button>
                            ) : null}
                          </div>
                        </div>
                        <Table aria-label="Adjustment lines" className="min-w-[480px]">
                          <thead>
                            <tr>
                              <Th>Original entry</Th>
                              <Th kind="numeric">Retained</Th>
                              <Th>Reversal</Th>
                              <Th>Replacement</Th>
                            </tr>
                          </thead>
                          <tbody>
                            {adjustment.lines.map((line) => (
                              <Tr key={line.id}>
                                <Td className="font-mono text-caption text-ink-muted">
                                  {line.originalLedgerEntryId.slice(0, 8)}
                                </Td>
                                <Td kind="numeric">{quantityLabel(line.retainedQuantity)}</Td>
                                <Td className="font-mono text-caption text-ink-muted">
                                  {line.reversalLedgerEntryId
                                    ? line.reversalLedgerEntryId.slice(0, 8)
                                    : '—'}
                                </Td>
                                <Td className="font-mono text-caption text-ink-muted">
                                  {line.replacementLedgerEntryId
                                    ? line.replacementLedgerEntryId.slice(0, 8)
                                    : '—'}
                                </Td>
                              </Tr>
                            ))}
                          </tbody>
                        </Table>
                        {adjustment.ownerResult ? (
                          <details>
                            <summary className="cursor-pointer text-small font-[650] text-ink">
                              Payroll owner result
                            </summary>
                            <pre className={preClass}>{jsonLabel(adjustment.ownerResult)}</pre>
                          </details>
                        ) : null}
                      </div>
                    ))
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
