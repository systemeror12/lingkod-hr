'use client';

import { useRecordNavigation } from './record-navigation';

import { useEffect, useRef, useState, type FormEvent } from 'react';
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
import { employeeInputClass, employeeLabelClass, formatEmployeeDate } from './employee-directory';

interface PayrollBankAccount {
  id: string;
  bankCode: string;
  accountName: string;
  maskedAccountNumber: string;
  verificationState: string;
  verifiedAt: string | null;
  status: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

interface HistoryEntry {
  id: string;
  action: string;
  newStatus: string | null;
  maskedAccountNumber: string | null;
  actorDisplayName: string | null;
  reason: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  evidenceDocumentVersionId: string | null;
  actedAt: string;
}

interface EvidenceDocument {
  documentId: string;
  documentVersionId: string;
  documentNo: string | null;
  documentType: string;
}

type ActionKind = 'activate' | 'replace' | 'correct' | 'inactivate' | 'reveal' | 'history';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function errorMessage(value: unknown, fallback: string): string {
  if (!record(value) || !record(value.error)) return fallback;
  return text(value.error.message) ?? fallback;
}

function parseAccounts(value: unknown): PayrollBankAccount[] {
  if (!record(value) || !Array.isArray(value.accounts)) {
    throw new Error('The payroll bank account response was invalid.');
  }
  return value.accounts.map((entry, index) => {
    if (!record(entry) || !text(entry.id)) {
      throw new Error(`Payroll bank account ${index + 1} was invalid.`);
    }
    return {
      id: text(entry.id)!,
      bankCode: text(entry.bankCode) ?? 'Unknown bank',
      accountName: text(entry.accountName) ?? 'Account name unavailable',
      maskedAccountNumber: text(entry.maskedAccountNumber) ?? 'Masked number unavailable',
      verificationState: text(entry.verificationState) ?? 'PENDING',
      verifiedAt: text(entry.verifiedAt),
      status: text(entry.status) ?? 'PENDING_VERIFICATION',
      effectiveFrom: text(entry.effectiveFrom) ?? '',
      effectiveTo: text(entry.effectiveTo),
    };
  });
}

function parseHistory(value: unknown): HistoryEntry[] {
  if (!record(value) || !Array.isArray(value.entries)) {
    throw new Error('The payroll bank account history response was invalid.');
  }
  return value.entries.map((entry, index) => {
    if (!record(entry)) throw new Error(`History entry ${index + 1} was invalid.`);
    return {
      id: text(entry.id) ?? `history-${index}`,
      action: text(entry.action) ?? 'UPDATED',
      newStatus: text(entry.newStatus),
      maskedAccountNumber: text(entry.maskedAccountNumber),
      actorDisplayName: text(entry.actorDisplayName),
      reason: text(entry.reason),
      effectiveFrom: text(entry.effectiveFrom),
      effectiveTo: text(entry.effectiveTo),
      evidenceDocumentVersionId: text(entry.evidenceDocumentVersionId),
      actedAt: text(entry.actedAt) ?? '',
    };
  });
}

function parseEvidenceDocuments(value: unknown): EvidenceDocument[] {
  if (!record(value) || !Array.isArray(value.documents)) return [];
  return value.documents.flatMap((entry) => {
    if (!record(entry)) return [];
    const documentId = text(entry.documentId);
    const documentVersionId = text(entry.documentVersionId);
    if (!documentId || !documentVersionId) return [];
    return [
      {
        documentId,
        documentVersionId,
        documentNo: text(entry.documentNo),
        documentType: text(entry.documentType) ?? 'Evidence',
      },
    ];
  });
}

function selectedEvidence(value: string, documents: EvidenceDocument[] | null) {
  const selected = documents?.find(
    (document) => `${document.documentId}:${document.documentVersionId}` === value,
  );
  return selected
    ? {
        evidenceDocumentId: selected.documentId,
        evidenceDocumentVersionId: selected.documentVersionId,
      }
    : {};
}

function title(value: string): string {
  return value
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function timestamp(date: string): string {
  return `${date}T00:00:00.000+08:00`;
}

const emptyValues = {
  bankCode: '',
  accountName: '',
  accountNumber: '',
  effectiveFrom: '',
  effectiveTo: '',
  verifiedAt: '',
  reason: '',
  evidence: '',
};

export function PayrollBankAccountsSection({
  agencyId,
  employeeId,
  canRead,
  canReadEvidence,
  canManage,
  canReveal,
  canReadHistory,
}: {
  agencyId: string;
  employeeId: string;
  canRead: boolean;
  canReadEvidence: boolean;
  canManage: boolean;
  canReveal: boolean;
  canReadHistory: boolean;
}) {
  const endpoint = `/api/v1/agencies/${agencyId}/employees/${employeeId}/payroll-bank-accounts`;
  const [accounts, setAccounts] = useState<PayrollBankAccount[]>([]);
  const [loading, setLoading] = useState(canRead);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [action, setAction] = useState<{ kind: ActionKind; target: PayrollBankAccount } | null>(
    null,
  );
  const [values, setValues] = useState(emptyValues);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [evidenceDocuments, setEvidenceDocuments] = useState<EvidenceDocument[] | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const section = useRef<HTMLElement | null>(null);

  async function refresh(showLoading = true): Promise<boolean> {
    if (!canRead) return true;
    if (showLoading) setLoading(true);
    try {
      const response = await fetch(endpoint, { credentials: 'include' });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(errorMessage(body, 'Payroll bank accounts could not be loaded.'));
      setAccounts(parseAccounts(body));
      setError(null);
      return true;
    } catch (caught: unknown) {
      setError(
        caught instanceof Error ? caught.message : 'Payroll bank accounts could not be loaded.',
      );
      return false;
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [endpoint, canRead]);

  const navigation = useRecordNavigation();
  const historyId = navigation.search.get('bankHistory');
  const historyRequest = useRef(0);
  useEffect(() => {
    if (!historyId) {
      setBusy(false);
      return;
    }
    if (loading) return;
    const target = accounts.find((item) => item.id === historyId);
    if (!canReadHistory || !target) {
      setError('This bank account history is unavailable in your permitted scope.');
      return;
    }
    setAction({ kind: 'history', target });
    void loadHistory(target);
    return () => {
      historyRequest.current += 1;
    };
  }, [historyId, loading, canReadHistory]);

  useEffect(() => {
    if (historyId || action?.kind !== 'history') return;
    setAction(null);
    setRevealed(null);
    setHistory([]);
  }, [action?.kind, historyId]);

  const evidenceDialogOpen =
    createOpen || ['activate', 'replace', 'correct'].includes(action?.kind ?? '');
  useEffect(() => {
    if (!canReadEvidence || !evidenceDialogOpen || evidenceDocuments !== null) return;
    let active = true;
    void fetch(`/api/v1/agencies/${agencyId}/employees/${employeeId}/documents`, {
      credentials: 'include',
    })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((value: unknown) => {
        if (active) setEvidenceDocuments(parseEvidenceDocuments(value));
      })
      .catch(() => {
        if (active) setEvidenceDocuments([]);
      });
    return () => {
      active = false;
    };
  }, [agencyId, canReadEvidence, employeeId, evidenceDialogOpen, evidenceDocuments]);

  function change(name: keyof typeof values) {
    return (event: { currentTarget: unknown }) => {
      const value = (event.currentTarget as { value: string }).value;
      setValues((current) => ({
        ...current,
        [name]: value,
      }));
    };
  }

  function closeCreate(open: boolean): void {
    if (busy) return;
    setCreateOpen(open);
    if (!open) {
      setValues(emptyValues);
      setDialogError(null);
    }
  }

  function closeAction(open: boolean): void {
    if (open || busy) return;
    navigation.navigate({ bankHistory: null });
    setAction(null);
    setValues(emptyValues);
    setDialogError(null);
    setRevealed(null);
    setHistory([]);
  }

  function openAction(
    kind: ActionKind,
    target: PayrollBankAccount,
    event: { currentTarget: unknown },
  ): void {
    opener.current = event.currentTarget as HTMLButtonElement;
    setValues({
      ...emptyValues,
      bankCode: target.bankCode,
      accountName: target.accountName,
      effectiveFrom: target.effectiveFrom,
      effectiveTo: target.effectiveTo ?? '',
    });
    setDialogError(null);
    setRevealed(null);
    setHistory([]);
    setAction({ kind, target });
    if (kind === 'history') navigation.navigate({ bankHistory: target.id });
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setDialogError(null);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          bankCode: values.bankCode,
          accountName: values.accountName,
          accountNumber: values.accountNumber,
          effectiveFrom: values.effectiveFrom,
          ...selectedEvidence(values.evidence, evidenceDocuments),
        }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setDialogError(errorMessage(body, 'The payroll bank account could not be saved.'));
        return;
      }
      if (!(await refresh(false))) return;
      setCreateOpen(false);
      setValues(emptyValues);
      setMessage('Pending payroll bank account recorded.');
    } catch {
      setDialogError('The payroll bank account could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  async function submitAction(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || !action || action.kind === 'history') return;
    setBusy(true);
    setDialogError(null);
    const bodies = {
      activate: {
        verificationState: 'VERIFIED',
        verifiedAt: timestamp(values.verifiedAt),
        reason: values.reason,
        ...selectedEvidence(values.evidence, evidenceDocuments),
      },
      replace: {
        bankCode: values.bankCode,
        accountName: values.accountName,
        accountNumber: values.accountNumber,
        effectiveFrom: values.effectiveFrom,
        reason: values.reason,
        ...selectedEvidence(values.evidence, evidenceDocuments),
      },
      correct: {
        bankCode: values.bankCode,
        accountName: values.accountName,
        accountNumber: values.accountNumber,
        reason: values.reason,
        ...selectedEvidence(values.evidence, evidenceDocuments),
      },
      inactivate: { effectiveTo: values.effectiveTo, reason: values.reason },
      reveal: { reason: values.reason },
    };
    try {
      const response = await fetch(`${endpoint}/${action.target.id}/${action.kind}`, {
        method: action.kind === 'inactivate' ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(bodies[action.kind]),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setDialogError(
          errorMessage(body, 'The payroll bank account operation could not be completed.'),
        );
        return;
      }
      if (action.kind === 'reveal') {
        setRevealed(record(body) ? text(body.accountNumber) : null);
        return;
      }
      if (!(await refresh(false))) return;
      setAction(null);
      setValues(emptyValues);
      setMessage(
        `Payroll bank account ${
          action.kind === 'activate'
            ? 'activated'
            : action.kind === 'replace'
              ? 'replacement prepared'
              : action.kind === 'correct'
                ? 'corrected'
                : 'inactivated'
        }.`,
      );
    } catch {
      setDialogError('The payroll bank account operation could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  async function loadHistory(target: PayrollBankAccount): Promise<void> {
    const requestId = ++historyRequest.current;
    setHistory([]);
    setBusy(true);
    try {
      const response = await fetch(
        `${endpoint}/history?accountId=${encodeURIComponent(target.id)}`,
        {
          credentials: 'include',
        },
      );
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(errorMessage(body, 'Payroll bank account history could not be loaded.'));
      if (requestId === historyRequest.current) setHistory(parseHistory(body));
    } catch (caught: unknown) {
      if (requestId !== historyRequest.current) return;
      setDialogError(
        caught instanceof Error
          ? caught.message
          : 'Payroll bank account history could not be loaded.',
      );
    } finally {
      if (requestId === historyRequest.current) setBusy(false);
    }
  }

  if (!canRead && !canManage && !canReveal && !canReadHistory) return null;

  const actionTitle = action ? `${title(action.kind)} payroll bank account` : '';

  return (
    <>
      <section
        ref={section}
        tabIndex={-1}
        aria-labelledby="payroll-bank-accounts-heading"
        className="border-t border-line px-6 py-6 min-[700px]:px-8"
      >
        <div className="flex flex-col gap-4 min-[760px]:flex-row min-[760px]:items-start min-[760px]:justify-between">
          <div>
            <p className="m-0 text-[10px] font-bold tracking-[.08em] text-muted uppercase">
              Payroll protected values
            </p>
            <h2
              id="payroll-bank-accounts-heading"
              className="mt-1 mb-0 text-lg font-[680] tracking-[-.02em] text-midnight"
            >
              Payroll bank accounts
            </h2>
            <p className="mt-1 mb-0 max-w-[620px] text-xs leading-5 text-muted">
              Account numbers stay masked. Changes do not initiate payment or claim bank acceptance.
            </p>
          </div>
          {canManage ? (
            <Dialog open={createOpen} onOpenChange={closeCreate}>
              <DialogTrigger asChild>
                <Button variant="primary">Add bank account</Button>
              </DialogTrigger>
              <DialogContent aria-describedby="create-bank-account-description" size="compact">
                <form className="contents" onSubmit={submitCreate}>
                  <DialogHeader>
                    <div className="grid gap-1.5">
                      <DialogTitle>Add payroll bank account</DialogTitle>
                      <DialogDescription id="create-bank-account-description">
                        Record a pending primary payroll destination. Verification is a separate
                        step.
                      </DialogDescription>
                    </div>
                    <DialogClose asChild>
                      <Button aria-label="Close add payroll bank account dialog" type="button">
                        ×
                      </Button>
                    </DialogClose>
                  </DialogHeader>
                  <DialogBody className="grid gap-4">
                    {dialogError ? (
                      <p
                        role="alert"
                        className="m-0 rounded-[3px] bg-[#fdeeee] px-4 py-3 text-sm text-[#8f2d2d]"
                      >
                        {dialogError}
                      </p>
                    ) : null}
                    <AccountFields values={values} change={change} includeDate />
                    {canReadEvidence ? (
                      <EvidenceField
                        documents={evidenceDocuments}
                        value={values.evidence}
                        onChange={change('evidence')}
                      />
                    ) : null}
                  </DialogBody>
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button disabled={busy} type="button" variant="secondary">
                        Cancel
                      </Button>
                    </DialogClose>
                    <Button disabled={busy} type="submit" variant="primary">
                      {busy ? 'Saving…' : 'Save pending account'}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          ) : null}
        </div>
        {message ? (
          <p role="status" className="mb-0 mt-4 text-xs text-[#27633b]">
            {message}
          </p>
        ) : null}
        {error ? (
          <p
            role="alert"
            className="mb-0 mt-4 rounded-[3px] bg-[#fdeeee] px-4 py-3 text-sm text-[#8f2d2d]"
          >
            {error}
          </p>
        ) : null}
        {loading ? (
          <p role="status" className="mb-0 mt-4 text-sm text-muted">
            Loading payroll bank accounts…
          </p>
        ) : !canRead ? (
          <p className="mb-0 mt-4 text-sm text-muted">
            Payroll bank account read access is not available.
          </p>
        ) : accounts.length === 0 ? (
          <p className="mb-0 mt-4 rounded-[3px] bg-canvas px-4 py-6 text-sm text-muted">
            No payroll bank accounts are recorded for this Employee.
          </p>
        ) : (
          <div className="mt-4 grid gap-4">
            {accounts.map((account) => (
              <article
                key={account.id}
                className="rounded-[4px] border border-line bg-canvas/35 p-4"
              >
                <div className="flex flex-col gap-4 min-[760px]:flex-row min-[760px]:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="m-0 text-sm font-[680] text-midnight">
                        {account.bankCode} · {account.accountName}
                      </h3>
                      <span className="rounded-full bg-[#eef3fb] px-2.5 py-1 text-[10px] font-bold text-[#34557e]">
                        {title(account.status)}
                      </span>
                    </div>
                    <dl className="mt-3 grid gap-x-6 gap-y-3 min-[560px]:grid-cols-3">
                      <div>
                        <dt className="text-[10px] font-bold text-muted uppercase">
                          Account number
                        </dt>
                        <dd className="mt-1 ml-0 font-mono text-sm">
                          {account.maskedAccountNumber}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[10px] font-bold text-muted uppercase">
                          Effective period
                        </dt>
                        <dd className="mt-1 ml-0 text-sm">
                          {formatEmployeeDate(account.effectiveFrom)} to{' '}
                          {account.effectiveTo ? formatEmployeeDate(account.effectiveTo) : 'Open'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[10px] font-bold text-muted uppercase">Verification</dt>
                        <dd className="mt-1 ml-0 text-sm">{title(account.verificationState)}</dd>
                      </div>
                    </dl>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {canManage && account.status === 'PENDING_VERIFICATION' ? (
                      <ActionButton
                        label="Activate"
                        onClick={(event) => openAction('activate', account, event)}
                      />
                    ) : null}
                    {canManage && account.status === 'ACTIVE' ? (
                      <ActionButton
                        label="Replace"
                        onClick={(event) => openAction('replace', account, event)}
                      />
                    ) : null}
                    {canManage && account.status === 'ACTIVE' ? (
                      <ActionButton
                        label="Inactivate"
                        onClick={(event) => openAction('inactivate', account, event)}
                      />
                    ) : null}
                    {canManage ? (
                      <ActionButton
                        label="Correct"
                        onClick={(event) => openAction('correct', account, event)}
                      />
                    ) : null}
                    {canReveal ? (
                      <ActionButton
                        label="Reveal account number"
                        onClick={(event) => openAction('reveal', account, event)}
                      />
                    ) : null}
                    {canReadHistory ? (
                      <ActionButton
                        label="View history"
                        onClick={(event) => openAction('history', account, event)}
                      />
                    ) : null}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <Dialog
        presentation={action?.kind === 'history' ? 'form' : 'dialog'}
        open={Boolean(action)}
        onOpenChange={closeAction}
      >
        <DialogContent
          aria-describedby="payroll-bank-account-action-description"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            queueMicrotask(() => {
              const button = opener.current as unknown as {
                isConnected?: boolean;
                focus?: () => void;
              } | null;
              const fallback = section.current as unknown as { focus?: () => void } | null;
              if (button?.isConnected) button.focus?.();
              else fallback?.focus?.();
            });
          }}
          size="compact"
        >
          <DialogHeader>
            <div className="grid gap-1.5">
              <DialogTitle>{actionTitle}</DialogTitle>
              <DialogDescription id="payroll-bank-account-action-description">
                {action?.kind === 'reveal'
                  ? 'Record why the full account number is needed. This attempt is audited.'
                  : action?.kind === 'history'
                    ? 'Review retained changes. Account numbers remain masked.'
                    : 'Record the reason so the prior protected record and effective history remain traceable.'}
              </DialogDescription>
            </div>
            <DialogClose asChild>
              <Button aria-label="Close payroll bank account dialog" type="button">
                ×
              </Button>
            </DialogClose>
          </DialogHeader>
          {action?.kind === 'history' ? (
            <>
              <DialogBody className="grid gap-3">
                {dialogError ? (
                  <p role="alert" className="m-0 text-sm text-[#8f2d2d]">
                    {dialogError}
                  </p>
                ) : null}
                {busy ? (
                  <p role="status" className="m-0 text-sm text-muted">
                    Loading account history…
                  </p>
                ) : history.length === 0 ? (
                  <p className="m-0 text-sm text-muted">No history events were found.</p>
                ) : (
                  history.map((entry) => (
                    <article
                      key={entry.id}
                      className="rounded-[4px] border border-line bg-canvas/35 p-4"
                    >
                      <strong className="text-sm text-midnight">{title(entry.action)}</strong>
                      <p className="mt-2 mb-0 font-mono text-sm">
                        {entry.maskedAccountNumber ?? 'Masked number unavailable'}
                      </p>
                      <p className="mt-2 mb-0 text-xs text-muted">
                        {entry.actorDisplayName ?? 'Unknown actor'} ·{' '}
                        {entry.actedAt ? formatEmployeeDate(entry.actedAt) : 'Unknown date'}
                      </p>
                      {entry.reason ? (
                        <p className="mt-2 mb-0 text-xs text-muted">{entry.reason}</p>
                      ) : null}
                      {entry.effectiveFrom ? (
                        <p className="mt-2 mb-0 text-xs text-muted">
                          Effective {formatEmployeeDate(entry.effectiveFrom)} to{' '}
                          {entry.effectiveTo ? formatEmployeeDate(entry.effectiveTo) : 'Open'}
                        </p>
                      ) : null}
                      {entry.evidenceDocumentVersionId ? (
                        <p className="mt-2 mb-0 break-all text-xs text-muted">
                          Evidence version: {entry.evidenceDocumentVersionId}
                        </p>
                      ) : null}
                    </article>
                  ))
                )}
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="secondary">
                    Close
                  </Button>
                </DialogClose>
              </DialogFooter>
            </>
          ) : (
            <form className="contents" onSubmit={submitAction}>
              <DialogBody className="grid gap-4">
                {dialogError ? (
                  <p
                    role="alert"
                    className="m-0 rounded-[3px] bg-[#fdeeee] px-4 py-3 text-sm text-[#8f2d2d]"
                  >
                    {dialogError}
                  </p>
                ) : null}
                {revealed ? (
                  <div className="rounded-[3px] border border-[#b8cde5] bg-[#f3f7fc] p-4">
                    <p className="m-0 text-[10px] font-bold text-muted uppercase">
                      Full account number
                    </p>
                    <output
                      aria-label="Revealed payroll bank account number"
                      className="mt-2 block break-all font-mono text-base"
                    >
                      {revealed}
                    </output>
                  </div>
                ) : (
                  <>
                    {action?.kind === 'replace' || action?.kind === 'correct' ? (
                      <AccountFields
                        values={values}
                        change={change}
                        includeDate={action.kind === 'replace'}
                      />
                    ) : null}
                    {action?.kind === 'activate' ? (
                      <label className={employeeLabelClass}>
                        Verified date
                        <input
                          autoFocus
                          required
                          type="date"
                          className={employeeInputClass}
                          value={values.verifiedAt}
                          onChange={change('verifiedAt')}
                        />
                      </label>
                    ) : null}
                    {action?.kind === 'inactivate' ? (
                      <label className={employeeLabelClass}>
                        Inactivation date
                        <input
                          autoFocus
                          required
                          type="date"
                          className={employeeInputClass}
                          value={values.effectiveTo}
                          onChange={change('effectiveTo')}
                        />
                      </label>
                    ) : null}
                    {canReadEvidence &&
                    action &&
                    ['activate', 'replace', 'correct'].includes(action.kind) ? (
                      <EvidenceField
                        documents={evidenceDocuments}
                        value={values.evidence}
                        onChange={change('evidence')}
                      />
                    ) : null}
                    <label className={employeeLabelClass}>
                      {action?.kind === 'reveal' ? 'Reveal reason' : 'Reason'}
                      <textarea
                        autoFocus={action?.kind === 'reveal'}
                        required
                        className={`${employeeInputClass} min-h-24 py-3`}
                        value={values.reason}
                        onChange={change('reason')}
                      />
                    </label>
                  </>
                )}
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button disabled={busy} type="button" variant="secondary">
                    {revealed ? 'Close' : 'Cancel'}
                  </Button>
                </DialogClose>
                {!revealed ? (
                  <Button disabled={busy} type="submit" variant="primary">
                    {busy ? 'Working…' : actionTitle}
                  </Button>
                ) : null}
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function EvidenceField({
  documents,
  value,
  onChange,
}: {
  documents: EvidenceDocument[] | null;
  value: string;
  onChange: (event: { currentTarget: unknown }) => void;
}) {
  return (
    <label className={employeeLabelClass}>
      Evidence (optional)
      <select className={employeeInputClass} value={value} onChange={onChange}>
        <option value="">No evidence</option>
        {documents?.map((document) => (
          <option
            key={`${document.documentId}:${document.documentVersionId}`}
            value={`${document.documentId}:${document.documentVersionId}`}
          >
            {document.documentNo ?? title(document.documentType)}
          </option>
        ))}
      </select>
      {documents === null ? <span className="text-xs text-muted">Loading evidence…</span> : null}
    </label>
  );
}

function ActionButton({
  label,
  onClick,
}: {
  label: string;
  onClick: (event: { currentTarget: unknown }) => void;
}) {
  return (
    <Button type="button" variant="secondary" onClick={onClick}>
      {label}
    </Button>
  );
}

function AccountFields({
  values,
  change,
  includeDate,
}: {
  values: typeof emptyValues;
  change: (name: keyof typeof emptyValues) => (event: { currentTarget: unknown }) => void;
  includeDate: boolean;
}) {
  return (
    <>
      <label className={employeeLabelClass}>
        Bank code
        <input
          autoFocus
          required
          maxLength={40}
          className={employeeInputClass}
          value={values.bankCode}
          onChange={change('bankCode')}
        />
      </label>
      <label className={employeeLabelClass}>
        Account name
        <input
          required
          maxLength={200}
          className={employeeInputClass}
          value={values.accountName}
          onChange={change('accountName')}
        />
      </label>
      <label className={employeeLabelClass}>
        Account number
        <input
          required
          autoComplete="off"
          maxLength={120}
          className={employeeInputClass}
          value={values.accountNumber}
          onChange={change('accountNumber')}
        />
      </label>
      {includeDate ? (
        <label className={employeeLabelClass}>
          Effective from
          <input
            required
            type="date"
            className={employeeInputClass}
            value={values.effectiveFrom}
            onChange={change('effectiveFrom')}
          />
        </label>
      ) : null}
    </>
  );
}
