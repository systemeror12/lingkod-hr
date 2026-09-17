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

const TONE_RESOLVED = 'bg-[#e8f3ed] text-[#316647]';
const TONE_ATTENTION = 'bg-[#fff3d6] text-[#79531c]';
const TONE_NEUTRAL = 'bg-[#f0f2f5] text-muted';

function statusClass(status: LeaveAccountStatus): string {
  if (status === 'ACTIVE') return TONE_RESOLVED;
  if (status === 'FROZEN') return TONE_ATTENTION;
  return TONE_NEUTRAL;
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
              Leave Accounts
            </h1>
            <p className="m-0 text-sm leading-[1.65] text-muted">
              One Leave Account per Employee, credit-bearing Leave Type, and continuous entitlement
              period. Posted Leave Ledger Entries never change; corrections are adjustments or
              reversals with authority and evidence.
            </p>
          </div>
          {canAdjust ? (
            <DialogTrigger asChild>
              <Button
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
                size="default"
                type="button"
                variant="primary"
              >
                Open Leave Account
              </Button>
            </DialogTrigger>
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

        {error ? <FormError message={error} /> : null}

        <section
          aria-labelledby="leave-accounts-heading"
          className="overflow-hidden rounded-[5px] border border-line bg-paper"
        >
          <header className="flex min-h-[60px] flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
            <div className="grid gap-1">
              <h2 className="m-0 text-sm font-[670] text-midnight" id="leave-accounts-heading">
                Leave Account register
              </h2>
              <span className="text-xs text-muted">
                {accounts.length === 1 ? '1 Leave Account' : accounts.length + ' Leave Accounts'}
              </span>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted">
              As of
              <input
                className="min-h-9 rounded-[3px] border border-line bg-paper px-2 text-xs text-ink"
                onChange={(event) =>
                  navigation.navigate({
                    asOf: targetValue(event) === manilaToday() ? null : targetValue(event),
                  })
                }
                type="date"
                value={asOf}
              />
            </label>
          </header>
          {accounts.length === 0 ? (
            <div className="grid min-h-[200px] place-content-center gap-2 px-6 py-12">
              <strong className="text-[15px] font-[650] text-midnight">
                No Leave Accounts yet.
              </strong>
              <p className="m-0 max-w-[560px] text-[13px] leading-[1.6] text-muted">
                Open an evidence-backed Leave Account against an active credit-bearing Leave Policy
                Version before credits can be posted.
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
                      Posted
                    </th>
                    <th className="px-5 py-3 font-bold" scope="col">
                      Committed
                    </th>
                    <th className="px-5 py-3 font-bold" scope="col">
                      Available
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {accounts.map((account) => (
                    <tr key={account.id}>
                      <td className="px-5 py-4 align-top">
                        <div className="grid gap-1">
                          <button
                            className="w-fit cursor-pointer text-left font-[670] text-cobalt underline-offset-2 hover:underline"
                            type="button"
                            onClick={() => navigation.navigate({ record: account.id })}
                          >
                            {account.employeeName}
                          </button>
                          <span className="text-xs text-muted">{account.employeeNumber}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4 align-top">
                        <div className="grid gap-1">
                          <strong className="font-[650] text-midnight">
                            {account.leaveTypeName}
                          </strong>
                          <span className="text-xs text-muted">{account.leaveTypeCode}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4 align-top">
                        <span
                          className={
                            'inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold tracking-[0.07em] uppercase ' +
                            statusClass(account.status)
                          }
                        >
                          {account.status}
                        </span>
                      </td>
                      <td className="px-5 py-4 align-top text-xs text-ink">
                        {quantityLabel(account.balances.postedQuantity)}
                      </td>
                      <td className="px-5 py-4 align-top text-xs text-ink">
                        {quantityLabel(account.balances.committedQuantity)}
                      </td>
                      <td className="px-5 py-4 align-top text-xs font-[650] text-ink">
                        {quantityLabel(account.balances.availableQuantity)}
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
          <RecordReturn href={navigation.href({ record: null })}>← Leave Accounts</RecordReturn>
        </div>
      ) : null}

      <DialogContent aria-describedby="leave-account-dialog-description">
        <DialogHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="grid gap-1">
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
              <Button size="default" type="button" variant="secondary">
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
                <Button disabled={busy} size="default" type="button" variant="secondary">
                  Cancel
                </Button>
              </DialogClose>
              <Button disabled={busy} size="default" type="submit" variant="primary">
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
                <Button disabled={busy} size="default" type="button" variant="secondary">
                  Cancel
                </Button>
              </DialogClose>
              <Button disabled={busy} size="default" type="submit" variant="primary">
                {busy ? 'Posting…' : 'Post adjustment'}
              </Button>
            </DialogFooter>
          </form>
        ) : null}

        {dialog === 'reverse' ? (
          <form onSubmit={(event) => void reverseLedgerEntry(event)}>
            <DialogBody className="grid gap-5">
              {reverseEntry ? (
                <p className="m-0 text-xs text-muted">
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
                <Button disabled={busy} size="default" type="button" variant="secondary">
                  Cancel
                </Button>
              </DialogClose>
              <Button disabled={busy} size="default" type="submit" variant="primary">
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
                <Button disabled={busy} size="default" type="button" variant="secondary">
                  Cancel
                </Button>
              </DialogClose>
              <Button disabled={busy} size="default" type="submit" variant="primary">
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
            {detailLoading || !detail ? (
              <p className="m-0 text-sm text-muted" role="status">
                Loading the Leave Account record…
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
                <section className="grid gap-3" aria-labelledby="leave-account-snapshot-heading">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3
                      className="m-0 text-sm font-[670] text-midnight"
                      id="leave-account-snapshot-heading"
                    >
                      {detail.account.employeeName} · {detail.account.leaveTypeName}
                    </h3>
                    {canAdjust ? (
                      <div className="flex flex-wrap gap-2">
                        {detail.account.status === 'ACTIVE' ? (
                          <Button
                            className="min-h-9"
                            onClick={() => {
                              resetAction();
                              setAdjustQuantity('');
                              setAdjustEffectiveDate(manilaToday());
                              setAdjustAuthorityDocumentId('');
                              setAdjustEvidenceDocumentId('');
                              setAdjustReason('');
                              setDialog('adjust');
                            }}
                            size="default"
                            type="button"
                            variant="secondary"
                          >
                            Adjust credits
                          </Button>
                        ) : null}
                        {detail.account.status === 'ACTIVE' ? (
                          <Button
                            className="min-h-9"
                            onClick={() => {
                              resetAction();
                              setActionReason('');
                              setDialog('freeze');
                            }}
                            size="default"
                            type="button"
                            variant="secondary"
                          >
                            Freeze
                          </Button>
                        ) : null}
                        {detail.account.status === 'FROZEN' ? (
                          <Button
                            className="min-h-9"
                            onClick={() => {
                              resetAction();
                              setActionReason('');
                              setDialog('unfreeze');
                            }}
                            size="default"
                            type="button"
                            variant="secondary"
                          >
                            Unfreeze
                          </Button>
                        ) : null}
                        {detail.account.status !== 'CLOSED' ? (
                          <Button
                            className="min-h-9"
                            onClick={() => {
                              resetAction();
                              setActionReason('');
                              setClosedAt(manilaToday());
                              setDialog('close');
                            }}
                            size="default"
                            type="button"
                            variant="secondary"
                          >
                            Close account
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span>{detail.account.employeeNumber}</span>
                    <span>{detail.account.leaveTypeCode}</span>
                    <span
                      className={
                        'inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold tracking-[0.07em] uppercase ' +
                        statusClass(detail.account.status)
                      }
                    >
                      {detail.account.status}
                    </span>
                    <span>Opened {dateLabel(detail.account.openedAt)}</span>
                    {detail.account.closedAt ? (
                      <span>Closed {dateLabel(detail.account.closedAt)}</span>
                    ) : null}
                  </div>
                </section>

                <section className="grid gap-3" aria-labelledby="leave-account-balances-heading">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3
                      className="m-0 text-sm font-[670] text-midnight"
                      id="leave-account-balances-heading"
                    >
                      Balances
                    </h3>
                    <label className="flex items-center gap-2 text-xs text-muted">
                      As of
                      <input
                        className="min-h-9 rounded-[3px] border border-line bg-paper px-2 text-xs text-ink"
                        onChange={(event) =>
                          navigation.navigate({
                            asOf: targetValue(event) === manilaToday() ? null : targetValue(event),
                          })
                        }
                        type="date"
                        value={asOf}
                      />
                    </label>
                  </div>
                  <dl className="m-0 grid gap-3 min-[621px]:grid-cols-3">
                    <div className="grid gap-1 rounded-[3px] border border-line bg-canvas px-3 py-2">
                      <dt className="text-[11px] font-bold tracking-[0.07em] text-muted uppercase">
                        Posted
                      </dt>
                      <dd className="m-0 text-lg font-[650] text-midnight">
                        {quantityLabel(detail.account.balances.postedQuantity)}{' '}
                        {detail.account.unitCode.replaceAll('_', ' ').toLowerCase()}
                      </dd>
                    </div>
                    <div className="grid gap-1 rounded-[3px] border border-line bg-canvas px-3 py-2">
                      <dt className="text-[11px] font-bold tracking-[0.07em] text-muted uppercase">
                        Committed
                      </dt>
                      <dd className="m-0 text-lg font-[650] text-midnight">
                        {quantityLabel(detail.account.balances.committedQuantity)}{' '}
                        {detail.account.unitCode.replaceAll('_', ' ').toLowerCase()}
                      </dd>
                    </div>
                    <div className="grid gap-1 rounded-[3px] border border-line bg-canvas px-3 py-2">
                      <dt className="text-[11px] font-bold tracking-[0.07em] text-muted uppercase">
                        Available
                      </dt>
                      <dd className="m-0 text-lg font-[650] text-midnight">
                        {quantityLabel(detail.account.balances.availableQuantity)}{' '}
                        {detail.account.unitCode.replaceAll('_', ' ').toLowerCase()}
                      </dd>
                    </div>
                  </dl>
                  <p className="m-0 text-xs text-muted">
                    Ledger recorded through {instantLabel(detail.account.balances.recordedThrough)}.
                  </p>
                </section>

                <section className="grid gap-3" aria-labelledby="leave-opening-heading">
                  <h3 className="m-0 text-sm font-[670] text-midnight" id="leave-opening-heading">
                    Opening
                  </h3>
                  {detail.opening ? (
                    <dl className="m-0 grid gap-1 text-xs min-[621px]:grid-cols-2">
                      <div className="flex gap-2">
                        <dt className="font-[650] text-ink">Quantity</dt>
                        <dd className="m-0 text-muted">{quantityLabel(detail.opening.quantity)}</dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="font-[650] text-ink">Effective</dt>
                        <dd className="m-0 text-muted">
                          {dateLabel(detail.opening.effectiveDate)}
                        </dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="font-[650] text-ink">Policy version</dt>
                        <dd className="m-0 text-muted">v{detail.opening.policyVersionNo}</dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="font-[650] text-ink">Evidence</dt>
                        <dd className="m-0 text-muted">
                          {detail.opening.evidenceDocumentNo ?? detail.opening.evidenceDocumentType}{' '}
                          · version {detail.opening.evidenceDocumentVersionNo}
                        </dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="font-[650] text-ink">Recorded by</dt>
                        <dd className="m-0 text-muted">
                          {detail.opening.openedByName ?? detail.opening.openedByMembershipId} ·{' '}
                          {instantLabel(detail.opening.openedAt)}
                        </dd>
                      </div>
                      {detail.opening.reason ? (
                        <div className="flex gap-2">
                          <dt className="font-[650] text-ink">Reason</dt>
                          <dd className="m-0 text-muted">{detail.opening.reason}</dd>
                        </div>
                      ) : null}
                    </dl>
                  ) : (
                    <p className="m-0 text-xs text-muted">No opening posting recorded.</p>
                  )}
                </section>

                <section className="grid gap-3" aria-labelledby="leave-ledger-heading">
                  <h3 className="m-0 text-sm font-[670] text-midnight" id="leave-ledger-heading">
                    Leave Ledger Entries
                  </h3>
                  {detail.ledgerEntries.length === 0 ? (
                    <p className="m-0 text-xs text-muted">No Leave Ledger Entries posted.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                        <thead className="bg-canvas text-[11px] tracking-[0.07em] text-muted uppercase">
                          <tr>
                            <th className="px-3 py-2 font-bold" scope="col">
                              Effective
                            </th>
                            <th className="px-3 py-2 font-bold" scope="col">
                              Quantity
                            </th>
                            <th className="px-3 py-2 font-bold" scope="col">
                              Source
                            </th>
                            <th className="px-3 py-2 font-bold" scope="col">
                              Policy
                            </th>
                            <th className="px-3 py-2 font-bold" scope="col">
                              Recorded
                            </th>
                            <th className="px-3 py-2 font-bold" scope="col">
                              <span className="sr-only">Actions</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                          {detail.ledgerEntries.map((entry) => (
                            <tr key={entry.id}>
                              <td className="px-3 py-3 align-top text-xs text-ink">
                                {dateLabel(entry.effectiveDate)}
                              </td>
                              <td className="px-3 py-3 align-top text-xs font-[650] text-ink">
                                {quantityLabel(entry.quantity)}
                              </td>
                              <td className="px-3 py-3 align-top text-xs text-muted">
                                {sourceLabel(entry.sourceType, entry.sourcePostingKey)}
                                {entry.reversesEntryId ? (
                                  <span className="block text-[11px]">
                                    Reverses {entry.reversesEntryId.slice(0, 8)}
                                  </span>
                                ) : null}
                              </td>
                              <td className="px-3 py-3 align-top text-xs text-muted">
                                v{entry.policyVersionNo}
                              </td>
                              <td className="px-3 py-3 align-top text-xs text-muted">
                                {entry.postedByName ?? entry.postedByMembershipId ?? 'System'} ·{' '}
                                {instantLabel(entry.postedAt)}
                              </td>
                              <td className="px-3 py-3 align-top">
                                {entry.reversesEntryId || reversedEntryIds.has(entry.id) ? (
                                  <span className="text-xs text-muted">
                                    {reversedEntryIds.has(entry.id) ? 'Reversed' : 'Reversal'}
                                  </span>
                                ) : canAdjust && detail.account.status === 'ACTIVE' ? (
                                  <Button
                                    className="min-h-9"
                                    onClick={() => {
                                      resetAction();
                                      setReverseEntry(entry);
                                      setReverseAuthorityDocumentId('');
                                      setReverseEvidenceDocumentId('');
                                      setReverseReason('');
                                      setDialog('reverse');
                                    }}
                                    size="default"
                                    type="button"
                                    variant="secondary"
                                  >
                                    Reverse
                                  </Button>
                                ) : null}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                <section className="grid gap-3" aria-labelledby="leave-commitments-heading">
                  <h3
                    className="m-0 text-sm font-[670] text-midnight"
                    id="leave-commitments-heading"
                  >
                    Leave Credit Commitments
                  </h3>
                  {detail.commitments.length === 0 ? (
                    <p className="m-0 text-xs text-muted">No Leave Credit Commitments recorded.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                        <thead className="bg-canvas text-[11px] tracking-[0.07em] text-muted uppercase">
                          <tr>
                            <th className="px-3 py-2 font-bold" scope="col">
                              Quantity
                            </th>
                            <th className="px-3 py-2 font-bold" scope="col">
                              Source
                            </th>
                            <th className="px-3 py-2 font-bold" scope="col">
                              Status
                            </th>
                            <th className="px-3 py-2 font-bold" scope="col">
                              Effective from
                            </th>
                            <th className="px-3 py-2 font-bold" scope="col">
                              Ended
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                          {detail.commitments.map((commitment) => (
                            <tr key={commitment.id}>
                              <td className="px-3 py-3 align-top text-xs font-[650] text-ink">
                                {quantityLabel(commitment.quantity)}
                              </td>
                              <td className="px-3 py-3 align-top text-xs text-muted">
                                {commitment.sourceType} · {commitment.sourceCommitmentKey}
                              </td>
                              <td className="px-3 py-3 align-top text-xs text-muted">
                                {commitment.status}
                              </td>
                              <td className="px-3 py-3 align-top text-xs text-muted">
                                {dateLabel(commitment.effectiveFrom)}
                              </td>
                              <td className="px-3 py-3 align-top text-xs text-muted">
                                {commitment.endedAt ? instantLabel(commitment.endedAt) : 'Open'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                <section className="grid gap-3" aria-labelledby="leave-account-history-heading">
                  <h3
                    className="m-0 text-sm font-[670] text-midnight"
                    id="leave-account-history-heading"
                  >
                    Audit history
                  </h3>
                  {detail.history.length === 0 ? (
                    <p className="m-0 text-xs text-muted">No Audit Events recorded.</p>
                  ) : (
                    <ul className="m-0 grid list-none gap-2 p-0 text-xs">
                      {detail.history.map((entry) => (
                        <li className="text-muted" key={entry.id}>
                          <span className="font-[650] text-ink">{entry.action}</span>
                          {entry.previousStatus || entry.newStatus
                            ? ` · ${entry.previousStatus ?? '—'} → ${entry.newStatus ?? '—'}`
                            : ''}
                          {entry.reason ? ` · ${entry.reason}` : ''} ·{' '}
                          {instantLabel(entry.occurredAt)}
                        </li>
                      ))}
                    </ul>
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
