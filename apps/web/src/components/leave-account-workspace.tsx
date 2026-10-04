'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { cn } from '../lib/class-names';
import { manilaToday } from '../lib/manila-date';
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

type LeaveAccountStatus = 'ACTIVE' | 'FROZEN' | 'CLOSED';

export interface LeaveAccountBalances {
  asOf: string;
  recordedThrough: string;
  postedQuantity: string;
  committedQuantity: string;
  availableQuantity: string;
}

export interface LeaveAccount {
  id: string;
  agencyId: string;
  employeeId: string;
  employeeNumber: string;
  employeeName: string;
  leaveTypeId: string;
  leaveTypeCode: string;
  leaveTypeName: string;
  unitCode: string;
  status: LeaveAccountStatus;
  openedAt: string;
  closedAt: string | null;
  balances: LeaveAccountBalances;
}

export interface LeaveAccountListResponse {
  accounts: LeaveAccount[];
}

export interface LeaveLedgerEntry {
  id: string;
  quantity: string;
  effectiveDate: string;
  sourceType: string;
  sourceId: string;
  sourcePostingKey: string;
  policyVersionId: string;
  policyVersionNo: number;
  reversesEntryId: string | null;
  postedAt: string;
  postedByMembershipId: string | null;
  postedByName: string | null;
}

export interface LeaveCreditCommitment {
  id: string;
  quantity: string;
  sourceType: string;
  sourceId: string;
  sourceCommitmentKey: string;
  succeedsCommitmentId: string | null;
  status: string;
  effectiveFrom: string;
  endedAt: string | null;
}

export interface LeaveAccountOpening {
  id: string;
  quantity: string;
  effectiveDate: string;
  policyVersionId: string;
  policyVersionNo: number;
  evidenceDocumentId: string;
  evidenceDocumentVersionId: string;
  evidenceDocumentNo: string | null;
  evidenceDocumentType: string;
  evidenceDocumentVersionNo: number;
  reason: string | null;
  openedByMembershipId: string;
  openedByName: string | null;
  openedAt: string;
}

export interface LeaveAccountHistoryEntry {
  id: string;
  action: string;
  previousStatus: string | null;
  newStatus: string | null;
  reason: string | null;
  effectiveDate: string | null;
  occurredAt: string;
}

export interface LeaveAccountDetail {
  account: LeaveAccount;
  opening: LeaveAccountOpening | null;
  ledgerEntries: LeaveLedgerEntry[];
  commitments: LeaveCreditCommitment[];
  history: LeaveAccountHistoryEntry[];
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
  catalogue: { entitlementBasis: string };
  currentVersion: { entitlementBasis: string; status: string } | null;
}

type DialogKind = 'detail' | 'open' | 'adjust' | 'reverse' | 'freeze' | 'unfreeze' | 'close' | null;

const CREDIT_BEARING_BASES = ['ACCRUED_ACCOUNT', 'PERIODIC_ALLOWANCE'];

const STATUS_TONE: Record<LeaveAccountStatus, StatusTone> = {
  ACTIVE: 'success',
  FROZEN: 'warning',
  CLOSED: 'neutral',
};

const sectionTitleClass = 'm-0 text-panel-title text-ink';

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

function sourceLabel(sourceType: string, sourcePostingKey: string): string {
  const type = sourceType.replace(/([a-z])([A-Z])/g, '$1 $2');
  return `${type} · ${sourcePostingKey}`;
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

function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-caption text-ink-muted">{label}</dt>
      <dd className={cn('m-0 text-body font-[600] text-ink', mono && 'font-mono font-normal')}>
        {value}
      </dd>
    </div>
  );
}

export function LeaveAccountWorkspace({
  agencyId,
  initial,
  canAdjust,
}: {
  agencyId: string;
  initial: LeaveAccountListResponse;
  canAdjust: boolean;
}) {
  const [accounts, setAccounts] = useState(initial.accounts);
  const navigation = useRecordNavigation();
  const recordId = navigation.search.get('record');
  const asOf = navigation.search.get('asOf') ?? manilaToday();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [detail, setDetail] = useState<LeaveAccountDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [employeeOptions, setEmployeeOptions] = useState<EmployeeOption[]>([]);
  const [leaveTypeOptions, setLeaveTypeOptions] = useState<LeaveTypeOption[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [leaveTypeId, setLeaveTypeId] = useState('');
  const [openEffectiveDate, setOpenEffectiveDate] = useState(manilaToday());
  const [openingQuantity, setOpeningQuantity] = useState('0');
  const [openEvidenceDocumentId, setOpenEvidenceDocumentId] = useState('');
  const [openReason, setOpenReason] = useState('');
  const [adjustQuantity, setAdjustQuantity] = useState('');
  const [adjustEffectiveDate, setAdjustEffectiveDate] = useState(manilaToday());
  const [adjustAuthorityDocumentId, setAdjustAuthorityDocumentId] = useState('');
  const [adjustEvidenceDocumentId, setAdjustEvidenceDocumentId] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [reverseAuthorityDocumentId, setReverseAuthorityDocumentId] = useState('');
  const [reverseEvidenceDocumentId, setReverseEvidenceDocumentId] = useState('');
  const [reverseReason, setReverseReason] = useState('');
  const [reverseEntry, setReverseEntry] = useState<LeaveLedgerEntry | null>(null);
  const [actionReason, setActionReason] = useState('');
  const [closedAt, setClosedAt] = useState(manilaToday());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState('');
  const optionsRequested = useRef(false);

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
    void request(
      '/leave-accounts/' + encodeURIComponent(recordId) + '?asOf=' + encodeURIComponent(asOf),
    )
      .then((value) => {
        if (active) setDetail(value as LeaveAccountDetail);
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

  useEffect(() => {
    let active = true;
    void request('/leave-accounts?asOf=' + encodeURIComponent(asOf))
      .then((value) => {
        if (active) setAccounts((value as LeaveAccountListResponse).accounts);
      })
      .catch((reason: unknown) => {
        if (active)
          setError(reason instanceof Error ? reason.message : 'The register is unavailable.');
      });
    return () => {
      active = false;
    };
  }, [asOf]);

  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await fetch('/api/v1/agencies/' + agencyId + path, {
      ...init,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...init.headers },
    });
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(errorMessage(value, 'The Leave Account action failed.'));
    }
    return value;
  }

  async function refresh(): Promise<void> {
    const list = (await request(
      '/leave-accounts?asOf=' + encodeURIComponent(asOf),
    )) as LeaveAccountListResponse;
    setAccounts(list.accounts);
    if (recordId) {
      const next = (await request(
        '/leave-accounts/' + encodeURIComponent(recordId) + '?asOf=' + encodeURIComponent(asOf),
      )) as LeaveAccountDetail;
      setDetail(next);
    }
  }

  async function loadOptions(): Promise<void> {
    if (optionsRequested.current) return;
    optionsRequested.current = true;
    try {
      const [employees, leaveTypes] = await Promise.all([
        request('/employees'),
        request('/leave-types'),
      ]);
      setEmployeeOptions((employees as { employees: EmployeeOption[] }).employees);
      setLeaveTypeOptions(
        (leaveTypes as { leaveTypes: LeaveTypeOption[] }).leaveTypes.filter(
          ({ status, catalogue, currentVersion }) =>
            status === 'ACTIVE' &&
            currentVersion !== null &&
            CREDIT_BEARING_BASES.includes(
              currentVersion.entitlementBasis ?? catalogue.entitlementBasis,
            ),
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

  function closeDialog(force = false): void {
    if (busy && !force) return;
    setDialog(null);
    setDetail(null);
    setReverseEntry(null);
    setError('');
    setSuccess('');
    if (recordId) navigation.navigate({ record: null });
  }

  async function post(path: string, body: unknown): Promise<void> {
    await request(path, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    });
  }

  async function openAccount(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    resetAction();
    try {
      await post('/leave-accounts', {
        employeeId,
        leaveTypeId,
        effectiveDate: openEffectiveDate,
        openingQuantity: Number(openingQuantity),
        evidenceDocumentId: openEvidenceDocumentId,
        ...(openReason.trim() ? { reason: openReason.trim() } : {}),
      });
      await refresh();
      closeDialog(true);
      setSuccess('The Leave Account was opened.');
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'The Leave Account could not be opened.');
    } finally {
      setBusy(false);
    }
  }

  async function recordAdjustment(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!detail) return;
    setBusy(true);
    resetAction();
    try {
      await post('/leave-accounts/' + detail.account.id + '/adjustments', {
        quantity: Number(adjustQuantity),
        effectiveDate: adjustEffectiveDate,
        authorityDocumentId: adjustAuthorityDocumentId,
        evidenceDocumentId: adjustEvidenceDocumentId,
        reason: adjustReason,
      });
      await refresh();
      setDialog('detail');
      setSuccess('The Leave Credit adjustment was posted.');
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'The adjustment could not be posted.');
    } finally {
      setBusy(false);
    }
  }

  async function reverseLedgerEntry(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!detail || !reverseEntry) return;
    setBusy(true);
    resetAction();
    try {
      await post(
        '/leave-accounts/' + detail.account.id + '/ledger-entries/' + reverseEntry.id + '/reversal',
        {
          authorityDocumentId: reverseAuthorityDocumentId,
          evidenceDocumentId: reverseEvidenceDocumentId,
          reason: reverseReason,
        },
      );
      await refresh();
      setDialog('detail');
      setReverseEntry(null);
      setSuccess('The Leave Ledger Entry was reversed.');
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'The reversal could not be posted.');
    } finally {
      setBusy(false);
    }
  }

  async function transitionAccount(
    event: FormEvent<HTMLFormElement>,
    kind: 'freeze' | 'unfreeze' | 'close',
  ): Promise<void> {
    event.preventDefault();
    if (!detail) return;
    setBusy(true);
    resetAction();
    try {
      await post(
        '/leave-accounts/' + detail.account.id + '/' + kind,
        kind === 'close' ? { closedAt, reason: actionReason } : { reason: actionReason },
      );
      await refresh();
      setDialog('detail');
      setSuccess(
        kind === 'freeze'
          ? 'The Leave Account was frozen.'
          : kind === 'unfreeze'
            ? 'The Leave Account was unfrozen.'
            : 'The Leave Account was closed.',
      );
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'The action could not be recorded.');
    } finally {
      setBusy(false);
    }
  }

  const reversedEntryIds = new Set(
    detail?.ledgerEntries.map(({ reversesEntryId }) => reversesEntryId).filter(Boolean) ?? [],
  );

  const unit = detail?.account.unitCode.replaceAll('_', ' ').toLowerCase() ?? '';
  const asOfInput = (
    <label className="flex items-center gap-2 text-caption font-[650] text-ink">
      As of
      <input
        className={cn(inputClass, 'w-auto')}
        onChange={(event) =>
          navigation.navigate({
            asOf: targetValue(event) === manilaToday() ? null : targetValue(event),
          })
        }
        type="date"
        value={asOf}
      />
    </label>
  );

  return (
    <Dialog
      presentation="form"
      open={dialog !== null}
      onOpenChange={(open) => !open && closeDialog()}
    >
      <div className="grid min-w-0 gap-5">
        <PageHeader
          breadcrumbs={[{ label: 'Leave' }]}
          title="Leave Accounts"
          actions={
            canAdjust ? (
              <DialogTrigger asChild>
                <Button
                  // Hidden rather than unmounted, so focus can return here when a record closes.
                  hidden={dialog !== null}
                  onClick={() => {
                    resetAction();
                    void loadOptions();
                    setEmployeeId(employeeOptions[0]?.id ?? '');
                    setLeaveTypeId(leaveTypeOptions[0]?.id ?? '');
                    setOpenEffectiveDate(manilaToday());
                    setOpeningQuantity('0');
                    setOpenEvidenceDocumentId('');
                    setOpenReason('');
                    setDialog('open');
                  }}
                  type="button"
                  variant="primary"
                >
                  Open Leave Account
                </Button>
              </DialogTrigger>
            ) : null
          }
        />

        <div hidden={dialog !== null} className="grid min-w-0 gap-5">
          <p className="m-0 max-w-[760px] text-small text-ink-muted">
            One Leave Account per Employee, credit-bearing Leave Type, and continuous entitlement
            period. Posted Leave Ledger Entries never change; corrections are adjustments or
            reversals with authority and evidence.
          </p>

          <SuccessMessage message={success} />
          <FormError message={error} />

          <Panel
            title="Leave Account register"
            flush
            actions={
              <>
                <span className="text-caption text-ink-muted">
                  {accounts.length === 1 ? '1 Leave Account' : accounts.length + ' Leave Accounts'}
                </span>
                {asOfInput}
              </>
            }
          >
            {accounts.length === 0 ? (
              <StateSurface compact label="Leave Account register">
                <strong className="font-[650] text-ink">No Leave Accounts yet.</strong>
                <p className="m-0 max-w-[560px]">
                  Open an evidence-backed Leave Account against an active credit-bearing Leave
                  Policy Version before credits can be posted.
                </p>
              </StateSurface>
            ) : (
              <Table aria-label="Leave Accounts" className="min-w-[860px]">
                <thead>
                  <tr>
                    <Th>Employee</Th>
                    <Th>Leave type</Th>
                    <Th>Status</Th>
                    <Th kind="numeric">Posted</Th>
                    <Th kind="numeric">Committed</Th>
                    <Th kind="numeric">Available</Th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((account) => (
                    <Tr key={account.id}>
                      <RowHeader>
                        <button
                          className="cursor-pointer border-0 bg-transparent p-0 text-left font-[600] text-primary underline-offset-2 hover:underline"
                          type="button"
                          onClick={() => navigation.navigate({ record: account.id })}
                        >
                          {account.employeeName}
                        </button>
                        <span className="block font-mono text-caption font-normal text-ink-muted">
                          {account.employeeNumber}
                        </span>
                      </RowHeader>
                      <Td>
                        {account.leaveTypeName}
                        <span className="block font-mono text-caption text-ink-muted">
                          {account.leaveTypeCode}
                        </span>
                      </Td>
                      <Td>
                        <StatusTag tone={STATUS_TONE[account.status]}>{account.status}</StatusTag>
                      </Td>
                      <Td kind="numeric">{quantityLabel(account.balances.postedQuantity)}</Td>
                      <Td kind="numeric">{quantityLabel(account.balances.committedQuantity)}</Td>
                      <Td kind="numeric" className="font-[600]">
                        {quantityLabel(account.balances.availableQuantity)}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>
        </div>
      </div>

      {dialog === 'detail' ? (
        <div className="mb-4">
          <RecordReturn href={navigation.href({ record: null })}>← Leave Accounts</RecordReturn>
        </div>
      ) : null}

      <DialogContent aria-describedby="leave-account-dialog-description">
        <DialogHeader>
          <div className="grid min-w-0 gap-1.5">
            <DialogTitle>
              {dialog === 'open'
                ? 'Open Leave Account'
                : dialog === 'adjust'
                  ? 'Post credit adjustment'
                  : dialog === 'reverse'
                    ? 'Reverse Leave Ledger Entry'
                    : dialog === 'freeze'
                      ? 'Freeze Leave Account'
                      : dialog === 'unfreeze'
                        ? 'Unfreeze Leave Account'
                        : dialog === 'close'
                          ? 'Close Leave Account'
                          : (detail?.account.employeeName ?? 'Leave Account')}
            </DialogTitle>
            <DialogDescription id="leave-account-dialog-description">
              {dialog === 'open'
                ? 'Establish one Leave Account for an Employee and credit-bearing Leave Type, backed by an exact Document Version.'
                : dialog === 'adjust'
                  ? 'Post a signed adjustment with authority, evidence, and reason. Posted entries never change.'
                  : dialog === 'reverse'
                    ? 'Post the exact opposite quantity on the same account, keeping the original entry.'
                    : dialog === 'freeze'
                      ? 'Freeze disputed credits. Postings stop until the account is unfrozen.'
                      : dialog === 'unfreeze'
                        ? 'Resume postings on a frozen account.'
                        : dialog === 'close'
                          ? 'Close the account for separation. A closed account never reopens; reemployment opens a new account.'
                          : 'Balances, source postings, commitments, and audit history.'}
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

        {dialog === 'open' ? (
          <form onSubmit={(event) => void openAccount(event)}>
            <DialogBody className="grid gap-5">
              <Field htmlFor="leave-account-employee" label="Employee">
                <select
                  autoFocus
                  className={inputClass}
                  data-autofocus=""
                  id="leave-account-employee"
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
              <Field htmlFor="leave-account-leave-type" label="Leave type">
                <select
                  className={inputClass}
                  id="leave-account-leave-type"
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
              <div className="grid gap-4 min-[621px]:grid-cols-2">
                <Field htmlFor="leave-account-effective" label="Effective date">
                  <input
                    className={inputClass}
                    id="leave-account-effective"
                    onChange={(event) => setOpenEffectiveDate(targetValue(event))}
                    required
                    type="date"
                    value={openEffectiveDate}
                  />
                </Field>
                <Field htmlFor="leave-account-quantity" label="Opening quantity">
                  <input
                    className={inputClass}
                    id="leave-account-quantity"
                    min={0}
                    onChange={(event) => setOpeningQuantity(targetValue(event))}
                    required
                    step="0.0001"
                    type="number"
                    value={openingQuantity}
                  />
                </Field>
              </div>
              <Field htmlFor="leave-account-evidence" label="Evidence Document ID">
                <input
                  className={inputClass}
                  id="leave-account-evidence"
                  onChange={(event) => setOpenEvidenceDocumentId(targetValue(event))}
                  placeholder="00000000-0000-0000-0000-000000000000"
                  required
                  value={openEvidenceDocumentId}
                />
              </Field>
              <Field htmlFor="leave-account-reason" label="Reason (optional)">
                <input
                  className={inputClass}
                  id="leave-account-reason"
                  maxLength={500}
                  onChange={(event) => setOpenReason(targetValue(event))}
                  value={openReason}
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
                {busy ? 'Opening…' : 'Open Leave Account'}
              </Button>
            </DialogFooter>
          </form>
        ) : null}

        {dialog === 'adjust' ? (
          <form onSubmit={(event) => void recordAdjustment(event)}>
            <DialogBody className="grid gap-5">
              <div className="grid gap-4 min-[621px]:grid-cols-2">
                <Field htmlFor="leave-adjust-quantity" label="Signed quantity">
                  <input
                    autoFocus
                    className={inputClass}
                    data-autofocus=""
                    id="leave-adjust-quantity"
                    onChange={(event) => setAdjustQuantity(targetValue(event))}
                    required
                    step="0.0001"
                    type="number"
                    value={adjustQuantity}
                  />
                </Field>
                <Field htmlFor="leave-adjust-effective" label="Effective date">
                  <input
                    className={inputClass}
                    id="leave-adjust-effective"
                    onChange={(event) => setAdjustEffectiveDate(targetValue(event))}
                    required
                    type="date"
                    value={adjustEffectiveDate}
                  />
                </Field>
              </div>
              <Field htmlFor="leave-adjust-authority" label="Authority Document ID">
                <input
                  className={inputClass}
                  id="leave-adjust-authority"
                  onChange={(event) => setAdjustAuthorityDocumentId(targetValue(event))}
                  placeholder="00000000-0000-0000-0000-000000000000"
                  required
                  value={adjustAuthorityDocumentId}
                />
              </Field>
              <Field htmlFor="leave-adjust-evidence" label="Evidence Document ID">
                <input
                  className={inputClass}
                  id="leave-adjust-evidence"
                  onChange={(event) => setAdjustEvidenceDocumentId(targetValue(event))}
                  placeholder="00000000-0000-0000-0000-000000000000"
                  required
                  value={adjustEvidenceDocumentId}
                />
              </Field>
              <Field htmlFor="leave-adjust-reason" label="Reason">
                <input
                  className={inputClass}
                  id="leave-adjust-reason"
                  maxLength={500}
                  onChange={(event) => setAdjustReason(targetValue(event))}
                  required
                  value={adjustReason}
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
                {busy ? 'Posting…' : 'Post adjustment'}
              </Button>
            </DialogFooter>
          </form>
        ) : null}

        {dialog === 'reverse' ? (
          <form onSubmit={(event) => void reverseLedgerEntry(event)}>
            <DialogBody className="grid gap-5">
              {reverseEntry ? (
                <p className="m-0 text-small text-ink-muted">
                  Original entry · {quantityLabel(reverseEntry.quantity)} effective{' '}
                  {dateLabel(reverseEntry.effectiveDate)} ·{' '}
                  {sourceLabel(reverseEntry.sourceType, reverseEntry.sourcePostingKey)}
                </p>
              ) : null}
              <Field htmlFor="leave-reversal-authority" label="Authority Document ID">
                <input
                  autoFocus
                  className={inputClass}
                  data-autofocus=""
                  id="leave-reversal-authority"
                  onChange={(event) => setReverseAuthorityDocumentId(targetValue(event))}
                  placeholder="00000000-0000-0000-0000-000000000000"
                  required
                  value={reverseAuthorityDocumentId}
                />
              </Field>
              <Field htmlFor="leave-reversal-evidence" label="Evidence Document ID">
                <input
                  className={inputClass}
                  id="leave-reversal-evidence"
                  onChange={(event) => setReverseEvidenceDocumentId(targetValue(event))}
                  placeholder="00000000-0000-0000-0000-000000000000"
                  required
                  value={reverseEvidenceDocumentId}
                />
              </Field>
              <Field htmlFor="leave-reversal-reason" label="Reason">
                <input
                  className={inputClass}
                  id="leave-reversal-reason"
                  maxLength={500}
                  onChange={(event) => setReverseReason(targetValue(event))}
                  required
                  value={reverseReason}
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
                {busy ? 'Reversing…' : 'Reverse entry'}
              </Button>
            </DialogFooter>
          </form>
        ) : null}

        {dialog === 'freeze' || dialog === 'unfreeze' || dialog === 'close' ? (
          <form onSubmit={(event) => void transitionAccount(event, dialog)}>
            <DialogBody className="grid gap-5">
              {dialog === 'close' ? (
                <Field htmlFor="leave-account-closed-at" label="Separation date">
                  <input
                    autoFocus
                    className={inputClass}
                    data-autofocus=""
                    id="leave-account-closed-at"
                    onChange={(event) => setClosedAt(targetValue(event))}
                    required
                    type="date"
                    value={closedAt}
                  />
                </Field>
              ) : null}
              <Field htmlFor="leave-account-action-reason" label="Reason">
                <input
                  autoFocus={dialog !== 'close'}
                  className={inputClass}
                  data-autofocus={dialog === 'close' ? undefined : ''}
                  id="leave-account-action-reason"
                  maxLength={500}
                  onChange={(event) => setActionReason(targetValue(event))}
                  required
                  value={actionReason}
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
                  : dialog === 'freeze'
                    ? 'Freeze account'
                    : dialog === 'unfreeze'
                      ? 'Unfreeze account'
                      : 'Close account'}
              </Button>
            </DialogFooter>
          </form>
        ) : null}

        {dialog === 'detail' ? (
          <DialogBody className="grid gap-6">
            {detailLoading ? (
              <StateSurface compact busy label="Leave Account record">
                <p className="m-0" role="status">
                  Loading the Leave Account record…
                </p>
              </StateSurface>
            ) : !detail ? (
              error ? (
                <StateSurface compact label="Leave Account record">
                  <p className="m-0">The Leave Account record could not be loaded.</p>
                </StateSurface>
              ) : null
            ) : (
              <>
                <SuccessMessage message={success} />
                <section className="grid gap-3" aria-labelledby="leave-account-snapshot-heading">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className={sectionTitleClass} id="leave-account-snapshot-heading">
                        {detail.account.leaveTypeName}
                      </h3>
                      <StatusTag tone={STATUS_TONE[detail.account.status]}>
                        {detail.account.status}
                      </StatusTag>
                    </div>
                    {canAdjust ? (
                      <div className="flex flex-wrap gap-2">
                        {detail.account.status === 'ACTIVE' ? (
                          <Button
                            onClick={() => {
                              resetAction();
                              setAdjustQuantity('');
                              setAdjustEffectiveDate(manilaToday());
                              setAdjustAuthorityDocumentId('');
                              setAdjustEvidenceDocumentId('');
                              setAdjustReason('');
                              setDialog('adjust');
                            }}
                            type="button"
                            variant="secondary"
                          >
                            Adjust credits
                          </Button>
                        ) : null}
                        {detail.account.status === 'ACTIVE' ? (
                          <Button
                            onClick={() => {
                              resetAction();
                              setActionReason('');
                              setDialog('freeze');
                            }}
                            type="button"
                            variant="secondary"
                          >
                            Freeze
                          </Button>
                        ) : null}
                        {detail.account.status === 'FROZEN' ? (
                          <Button
                            onClick={() => {
                              resetAction();
                              setActionReason('');
                              setDialog('unfreeze');
                            }}
                            type="button"
                            variant="secondary"
                          >
                            Unfreeze
                          </Button>
                        ) : null}
                        {detail.account.status !== 'CLOSED' ? (
                          <Button
                            onClick={() => {
                              resetAction();
                              setActionReason('');
                              setClosedAt(manilaToday());
                              setDialog('close');
                            }}
                            type="button"
                            variant="secondary"
                          >
                            Close account
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <dl className="m-0 flex flex-wrap gap-x-10 gap-y-3">
                    <Fact label="Employee number" mono value={detail.account.employeeNumber} />
                    <Fact label="Leave type code" mono value={detail.account.leaveTypeCode} />
                    <Fact label="Opened" value={dateLabel(detail.account.openedAt)} />
                    {detail.account.closedAt ? (
                      <Fact label="Closed" value={dateLabel(detail.account.closedAt)} />
                    ) : null}
                  </dl>
                </section>

                <section className="grid gap-3" aria-labelledby="leave-account-balances-heading">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className={sectionTitleClass} id="leave-account-balances-heading">
                      Balances
                    </h3>
                    {asOfInput}
                  </div>
                  <dl className="m-0 flex flex-wrap gap-x-10 gap-y-3">
                    <Fact
                      label="Posted"
                      value={`${quantityLabel(detail.account.balances.postedQuantity)} ${unit}`}
                    />
                    <Fact
                      label="Committed"
                      value={`${quantityLabel(detail.account.balances.committedQuantity)} ${unit}`}
                    />
                    <Fact
                      label="Available"
                      value={`${quantityLabel(detail.account.balances.availableQuantity)} ${unit}`}
                    />
                  </dl>
                  <p className="m-0 text-caption text-ink-muted">
                    Ledger recorded through {instantLabel(detail.account.balances.recordedThrough)}.
                  </p>
                </section>

                <section className="grid gap-3" aria-labelledby="leave-opening-heading">
                  <h3 className={sectionTitleClass} id="leave-opening-heading">
                    Opening
                  </h3>
                  {detail.opening ? (
                    <dl className="m-0 flex flex-wrap gap-x-10 gap-y-3">
                      <Fact label="Quantity" value={quantityLabel(detail.opening.quantity)} />
                      <Fact label="Effective" value={dateLabel(detail.opening.effectiveDate)} />
                      <Fact label="Policy version" value={`v${detail.opening.policyVersionNo}`} />
                      <Fact
                        label="Evidence"
                        value={`${detail.opening.evidenceDocumentNo ?? detail.opening.evidenceDocumentType} · version ${detail.opening.evidenceDocumentVersionNo}`}
                      />
                      <Fact
                        label="Recorded by"
                        value={`${detail.opening.openedByName ?? detail.opening.openedByMembershipId} · ${instantLabel(detail.opening.openedAt)}`}
                      />
                      {detail.opening.reason ? (
                        <Fact label="Reason" value={detail.opening.reason} />
                      ) : null}
                    </dl>
                  ) : (
                    <StateSurface compact label="Opening">
                      <p className="m-0">No opening posting recorded.</p>
                    </StateSurface>
                  )}
                </section>

                <section className="grid gap-3" aria-labelledby="leave-ledger-heading">
                  <h3 className={sectionTitleClass} id="leave-ledger-heading">
                    Leave Ledger Entries
                  </h3>
                  {detail.ledgerEntries.length === 0 ? (
                    <StateSurface compact label="Leave Ledger Entries">
                      <p className="m-0">No Leave Ledger Entries posted.</p>
                    </StateSurface>
                  ) : (
                    <Table aria-labelledby="leave-ledger-heading" className="min-w-[720px]">
                      <thead>
                        <tr>
                          <Th kind="date">Effective</Th>
                          <Th kind="numeric">Quantity</Th>
                          <Th>Source</Th>
                          <Th>Policy</Th>
                          <Th>Recorded</Th>
                          <Th>
                            <span className="sr-only">Actions</span>
                          </Th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.ledgerEntries.map((entry) => (
                          <Tr key={entry.id}>
                            <Td kind="date">{dateLabel(entry.effectiveDate)}</Td>
                            <Td kind="numeric" className="font-[600]">
                              {quantityLabel(entry.quantity)}
                            </Td>
                            <Td className="text-ink-muted">
                              {sourceLabel(entry.sourceType, entry.sourcePostingKey)}
                              {entry.reversesEntryId ? (
                                <span className="block text-caption">
                                  Reverses {entry.reversesEntryId.slice(0, 8)}
                                </span>
                              ) : null}
                            </Td>
                            <Td className="text-ink-muted">v{entry.policyVersionNo}</Td>
                            <Td className="text-ink-muted">
                              {entry.postedByName ?? entry.postedByMembershipId ?? 'System'} ·{' '}
                              {instantLabel(entry.postedAt)}
                            </Td>
                            <Td>
                              {entry.reversesEntryId || reversedEntryIds.has(entry.id) ? (
                                <StatusTag tone="neutral">
                                  {reversedEntryIds.has(entry.id) ? 'Reversed' : 'Reversal'}
                                </StatusTag>
                              ) : canAdjust && detail.account.status === 'ACTIVE' ? (
                                <Button
                                  onClick={() => {
                                    resetAction();
                                    setReverseEntry(entry);
                                    setReverseAuthorityDocumentId('');
                                    setReverseEvidenceDocumentId('');
                                    setReverseReason('');
                                    setDialog('reverse');
                                  }}
                                  type="button"
                                  variant="secondary"
                                >
                                  Reverse
                                </Button>
                              ) : null}
                            </Td>
                          </Tr>
                        ))}
                      </tbody>
                    </Table>
                  )}
                </section>

                <section className="grid gap-3" aria-labelledby="leave-commitments-heading">
                  <h3 className={sectionTitleClass} id="leave-commitments-heading">
                    Leave Credit Commitments
                  </h3>
                  {detail.commitments.length === 0 ? (
                    <StateSurface compact label="Leave Credit Commitments">
                      <p className="m-0">No Leave Credit Commitments recorded.</p>
                    </StateSurface>
                  ) : (
                    <Table aria-labelledby="leave-commitments-heading" className="min-w-[640px]">
                      <thead>
                        <tr>
                          <Th kind="numeric">Quantity</Th>
                          <Th>Source</Th>
                          <Th>Status</Th>
                          <Th kind="date">Effective from</Th>
                          <Th>Ended</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.commitments.map((commitment) => (
                          <Tr key={commitment.id}>
                            <Td kind="numeric" className="font-[600]">
                              {quantityLabel(commitment.quantity)}
                            </Td>
                            <Td className="text-ink-muted">
                              {commitment.sourceType} · {commitment.sourceCommitmentKey}
                            </Td>
                            <Td className="text-ink-muted">{commitment.status}</Td>
                            <Td kind="date">{dateLabel(commitment.effectiveFrom)}</Td>
                            <Td className="text-ink-muted">
                              {commitment.endedAt ? instantLabel(commitment.endedAt) : 'Open'}
                            </Td>
                          </Tr>
                        ))}
                      </tbody>
                    </Table>
                  )}
                </section>

                <section className="grid gap-3" aria-labelledby="leave-account-history-heading">
                  <h3 className={sectionTitleClass} id="leave-account-history-heading">
                    Audit history
                  </h3>
                  {detail.history.length === 0 ? (
                    <StateSurface compact label="Audit history">
                      <p className="m-0">No Audit Events recorded.</p>
                    </StateSurface>
                  ) : (
                    <Table
                      aria-labelledby="leave-account-history-heading"
                      className="min-w-[640px]"
                    >
                      <thead>
                        <tr>
                          <Th>Action</Th>
                          <Th>Status change</Th>
                          <Th>Reason</Th>
                          <Th>Occurred</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.history.map((entry) => (
                          <Tr key={entry.id}>
                            <Td className="font-[600]">{entry.action}</Td>
                            <Td className="text-ink-muted">
                              {entry.previousStatus || entry.newStatus
                                ? `${entry.previousStatus ?? '—'} → ${entry.newStatus ?? '—'}`
                                : '—'}
                            </Td>
                            <Td className="text-ink-muted">{entry.reason ?? '—'}</Td>
                            <Td className="text-ink-muted">{instantLabel(entry.occurredAt)}</Td>
                          </Tr>
                        ))}
                      </tbody>
                    </Table>
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
