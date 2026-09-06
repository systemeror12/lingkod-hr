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

type IdentifierType = 'UMID' | 'PAGIBIG' | 'PHILHEALTH' | 'PHILSYS_PCN' | 'TIN';

interface GovernmentIdentifier {
  id: string;
  identifierType: string;
  maskedValue: string;
  status: string;
  verifiedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

interface GovernmentIdentifierHistoryEntry {
  id: string;
  action: string;
  status: string | null;
  maskedValue: string | null;
  reason: string | null;
  actorDisplayName: string | null;
  actedAt: string | null;
}

function recordOf(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function arrayValue(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function errorMessage(value: unknown, fallback: string): string {
  if (!recordOf(value)) return fallback;
  return stringValue(value.error && recordOf(value.error) ? value.error.message : null) ?? fallback;
}

function fieldErrors(value: unknown): Record<string, string> {
  if (!recordOf(value) || !recordOf(value.error) || !recordOf(value.error.fields)) return {};
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value.error.fields)) {
    if (typeof entry === 'string') result[key] = entry;
  }
  return result;
}

function arrayFromEnvelope(value: unknown, keys: string[]): unknown[] {
  if (Array.isArray(value)) return value;
  if (!recordOf(value)) throw new Error('The Government Identifier response was invalid.');
  for (const key of keys) {
    const candidate = arrayValue(value[key]);
    if (candidate) return candidate;
  }
  throw new Error('The Government Identifier response was invalid.');
}

function parseIdentifiers(value: unknown): GovernmentIdentifier[] {
  return arrayFromEnvelope(value, ['identifiers', 'items', 'data']).map((entry, index) => {
    if (!recordOf(entry) || typeof entry.id !== 'string') {
      throw new Error(`The Government Identifier entry at position ${index + 1} was invalid.`);
    }
    return {
      id: entry.id,
      identifierType: stringValue(entry.identifierType) ?? stringValue(entry.type) ?? 'UNKNOWN',
      maskedValue:
        stringValue(entry.maskedValue) ??
        stringValue(entry.masked_value) ??
        'Masked value unavailable',
      status: stringValue(entry.status) ?? 'ACTIVE',
      verifiedAt: stringValue(entry.verifiedAt) ?? stringValue(entry.verified_at),
      createdAt: stringValue(entry.createdAt) ?? stringValue(entry.created_at),
      updatedAt: stringValue(entry.updatedAt) ?? stringValue(entry.updated_at),
    };
  });
}

function parseHistory(value: unknown): GovernmentIdentifierHistoryEntry[] {
  return arrayFromEnvelope(value, ['entries', 'history', 'items', 'data']).map((entry, index) => {
    if (!recordOf(entry)) {
      throw new Error(
        `The Government Identifier history entry at position ${index + 1} was invalid.`,
      );
    }
    return {
      id: stringValue(entry.id) ?? `history-${index + 1}`,
      action:
        stringValue(entry.action) ??
        stringValue(entry.event) ??
        stringValue(entry.type) ??
        'UPDATED',
      status: stringValue(entry.status) ?? stringValue(entry.newStatus),
      maskedValue: stringValue(entry.maskedValue) ?? stringValue(entry.masked_value),
      reason: stringValue(entry.reason) ?? stringValue(entry.notes),
      actorDisplayName:
        stringValue(entry.actorDisplayName) ??
        stringValue(entry.actorName) ??
        stringValue(entry.performedByDisplayName),
      actedAt:
        stringValue(entry.actedAt) ??
        stringValue(entry.occurredAt) ??
        stringValue(entry.createdAt) ??
        stringValue(entry.timestamp),
    };
  });
}

function parseRevealValue(value: unknown): string | null {
  if (!recordOf(value)) return null;
  return (
    stringValue(value.value) ??
    stringValue(value.plaintext) ??
    stringValue(value.revealedValue) ??
    (recordOf(value.identifier)
      ? (stringValue(value.identifier.value) ??
        stringValue(value.identifier.plaintext) ??
        stringValue(value.identifier.revealedValue))
      : null)
  );
}

function formatIdentifierType(value: string): string {
  if (value === 'UMID') return 'UMID';
  if (value === 'PHILHEALTH') return 'PhilHealth';
  if (value === 'PAGIBIG') return 'Pag-IBIG';
  if (value === 'PHILSYS_PCN') return 'PhilSys PCN';
  if (value === 'TIN') return 'TIN';
  return 'Unknown';
}

function formatStatus(value: string): string {
  return value
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function statusClass(value: string): string {
  if (value === 'INVALID') return 'bg-[#fdeeee] text-[#8f2d2d]';
  if (value === 'REPLACED') return 'bg-[#eef3fb] text-[#34557e]';
  return 'bg-[#e7f4eb] text-[#27633b]';
}

function displayDate(value: string | null): string {
  return value ? formatEmployeeDate(value) : 'Not recorded';
}

function normalizeDate(value: string | null): string {
  return value ? value.slice(0, 10) : '';
}

function currentValue(event: { currentTarget: unknown }): string {
  return (event.currentTarget as { value: string }).value;
}

function dateInputTimestamp(value: string): string | null {
  return value ? `${value}T00:00:00.000+08:00` : null;
}

function rememberOpener(
  ref: { current: HTMLButtonElement | null },
  event: { currentTarget: unknown },
): void {
  ref.current = event.currentTarget as HTMLButtonElement;
}

function restoreFocus(
  ref: { current: HTMLButtonElement | null },
  fallback: { current: HTMLElement | null },
): void {
  const opener = ref.current;
  ref.current = null;
  if (!opener) return;
  queueMicrotask(() => {
    const openerState = opener as unknown as { isConnected?: boolean; focus?: () => void };
    const fallbackState = fallback.current as unknown as {
      isConnected?: boolean;
      focus?: () => void;
    } | null;
    if (openerState.isConnected) {
      openerState.focus?.();
    } else if (fallbackState?.isConnected) {
      fallbackState.focus?.();
    }
  });
}

function historyActionLabel(value: string): string {
  return formatStatus(value);
}

export function GovernmentIdentifiersSection({
  agencyId,
  employeeId,
  canRead,
  canManage,
  canReveal,
  canReadHistory,
}: {
  agencyId: string;
  employeeId: string;
  canRead: boolean;
  canManage: boolean;
  canReveal: boolean;
  canReadHistory: boolean;
}) {
  const [identifiers, setIdentifiers] = useState<GovernmentIdentifier[]>([]);
  const [revealedValue, setRevealedValue] = useState<string | null>(null);
  const [loading, setLoading] = useState(canRead);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<'ok' | 'error'>('ok');
  const [createOpen, setCreateOpen] = useState(false);
  const [createValues, setCreateValues] = useState({
    identifierType: 'TIN',
    value: '',
    verifiedAt: '',
  });
  const [replaceTarget, setReplaceTarget] = useState<GovernmentIdentifier | null>(null);
  const [replaceValues, setReplaceValues] = useState({
    value: '',
    verifiedAt: '',
    reason: '',
  });
  const [revealTarget, setRevealTarget] = useState<GovernmentIdentifier | null>(null);
  const [revealReason, setRevealReason] = useState('');
  const [invalidateTarget, setInvalidateTarget] = useState<GovernmentIdentifier | null>(null);
  const [invalidateReason, setInvalidateReason] = useState('');
  const [historyTarget, setHistoryTarget] = useState<GovernmentIdentifier | null>(null);
  const [historyEntries, setHistoryEntries] = useState<GovernmentIdentifierHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const revealOpener = useRef<HTMLButtonElement | null>(null);
  const revealCloseRef = useRef<HTMLButtonElement | null>(null);
  const replaceOpener = useRef<HTMLButtonElement | null>(null);
  const invalidateOpener = useRef<HTMLButtonElement | null>(null);
  const historyOpener = useRef<HTMLButtonElement | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);

  const endpoint = `/api/v1/agencies/${agencyId}/employees/${employeeId}/government-identifiers`;
  const navigation = useRecordNavigation();
  const historyId = navigation.search.get('identifierHistory');
  const historyRequest = useRef(0);
  useEffect(() => {
    setHistoryTarget(null);
    if (!historyId || loading) return;
    const target = identifiers.find((item) => item.id === historyId);
    if (!canReadHistory || !target) {
      setError('This identifier history is unavailable in your permitted scope.');
      return;
    }
    void loadHistory(target);
    return () => {
      historyRequest.current += 1;
    };
  }, [historyId, loading, canReadHistory]);

  async function refresh(showLoading = true): Promise<boolean> {
    if (!canRead) return true;
    if (showLoading) setLoading(true);
    try {
      const response = await fetch(endpoint, { credentials: 'include' });
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(errorMessage(value, 'Government identifiers could not be loaded.'));
      setIdentifiers(parseIdentifiers(value));
      setRevealedValue(null);
      setError(null);
      return true;
    } catch (caught: unknown) {
      setError(
        caught instanceof Error ? caught.message : 'Government identifiers could not be loaded.',
      );
      return false;
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [endpoint, canRead]);

  useEffect(() => {
    if (!revealedValue) return;
    queueMicrotask(() => (revealCloseRef.current as { focus: () => void } | null)?.focus());
  }, [revealedValue]);

  function resetDialogState(): void {
    setDialogError(null);
    setFields({});
  }

  function closeCreate(open: boolean): void {
    if (busy) return;
    setCreateOpen(open);
    if (!open) {
      resetDialogState();
      setCreateValues({ identifierType: 'TIN', value: '', verifiedAt: '' });
    }
  }

  function closeReplace(open: boolean): void {
    if (busy) return;
    if (!open) {
      setReplaceTarget(null);
      setReplaceValues({ value: '', verifiedAt: '', reason: '' });
      resetDialogState();
    }
  }

  function closeReveal(open: boolean): void {
    if (busy) return;
    if (!open) {
      setRevealTarget(null);
      setRevealReason('');
      setRevealedValue(null);
      resetDialogState();
    }
  }

  function closeInvalidate(open: boolean): void {
    if (busy) return;
    if (!open) {
      setInvalidateTarget(null);
      setInvalidateReason('');
      resetDialogState();
    }
  }

  function closeHistory(open: boolean): void {
    if (open) return;
    navigation.navigate({ identifierHistory: null });
    setHistoryTarget(null);
    setHistoryEntries([]);
    setHistoryLoading(false);
    setHistoryError(null);
  }

  function fieldError(name: string): string | undefined {
    return fields[name];
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    resetDialogState();
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          identifierType: createValues.identifierType,
          value: createValues.value.trim(),
          verifiedAt: dateInputTimestamp(createValues.verifiedAt),
        }),
      });
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setFields(fieldErrors(value));
        setDialogError(errorMessage(value, 'The Government Identifier could not be saved.'));
        setBusy(false);
        return;
      }
      await refresh(false);
      setBusy(false);
      setCreateOpen(false);
      setCreateValues({ identifierType: 'TIN', value: '', verifiedAt: '' });
      setMessageTone('ok');
      setMessage('Government identifier saved.');
    } catch {
      setDialogError('The request could not be confirmed. Check the connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function submitReplace(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    if (!replaceTarget) return;
    setBusy(true);
    resetDialogState();
    try {
      const response = await fetch(`${endpoint}/${replaceTarget.id}/replace`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          identifierType: replaceTarget.identifierType,
          value: replaceValues.value.trim(),
          verifiedAt: dateInputTimestamp(replaceValues.verifiedAt),
          reason: replaceValues.reason.trim(),
        }),
      });
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setFields(fieldErrors(value));
        setDialogError(errorMessage(value, 'The Government Identifier could not be replaced.'));
        setBusy(false);
        return;
      }
      await refresh(false);
      setBusy(false);
      setReplaceTarget(null);
      setReplaceValues({ value: '', verifiedAt: '', reason: '' });
      setMessageTone('ok');
      setMessage(`${formatIdentifierType(replaceTarget.identifierType)} identifier replaced.`);
    } catch {
      setDialogError('The request could not be confirmed. Check the connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function submitReveal(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    if (!revealTarget) return;
    setBusy(true);
    resetDialogState();
    try {
      const response = await fetch(`${endpoint}/${revealTarget.id}/reveal`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reason: revealReason.trim() }),
      });
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setDialogError(errorMessage(value, 'The Government Identifier could not be revealed.'));
        setBusy(false);
        return;
      }
      const revealed = parseRevealValue(value);
      if (!revealed) {
        setDialogError('The revealed Government Identifier value was missing.');
        setBusy(false);
        return;
      }
      setRevealedValue(revealed);
      setBusy(false);
      setMessageTone('ok');
      setMessage(
        `${formatIdentifierType(revealTarget.identifierType)} value revealed for this session.`,
      );
    } catch {
      setDialogError('The request could not be confirmed. Check the connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function submitInvalidate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    if (!invalidateTarget) return;
    setBusy(true);
    resetDialogState();
    try {
      const response = await fetch(`${endpoint}/${invalidateTarget.id}/invalidate`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reason: invalidateReason.trim() }),
      });
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setFields(fieldErrors(value));
        setDialogError(errorMessage(value, 'The Government Identifier could not be invalidated.'));
        setBusy(false);
        return;
      }
      await refresh(false);
      setBusy(false);
      setInvalidateTarget(null);
      setInvalidateReason('');
      setMessageTone('ok');
      setMessage(
        `${formatIdentifierType(invalidateTarget.identifierType)} identifier invalidated.`,
      );
    } catch {
      setDialogError('The request could not be confirmed. Check the connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function loadHistory(identifier: GovernmentIdentifier): Promise<void> {
    const requestId = ++historyRequest.current;
    setHistoryTarget(identifier);
    setHistoryEntries([]);
    setHistoryError(null);
    setHistoryLoading(true);
    try {
      const response = await fetch(`${endpoint}/history?identifierId=${identifier.id}`, {
        credentials: 'include',
      });
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(errorMessage(value, 'Government identifier history could not be loaded.'));
      if (requestId === historyRequest.current) setHistoryEntries(parseHistory(value));
    } catch (caught: unknown) {
      if (requestId !== historyRequest.current) return;
      setHistoryError(
        caught instanceof Error
          ? caught.message
          : 'Government identifier history could not be loaded.',
      );
    } finally {
      if (requestId === historyRequest.current) setHistoryLoading(false);
    }
  }

  if (!canRead && !canManage && !canReveal && !canReadHistory) return null;

  return (
    <>
      <section
        ref={sectionRef}
        tabIndex={-1}
        aria-labelledby="government-identifiers-heading"
        className="border-t border-line px-6 py-6 min-[700px]:px-8"
      >
        <div className="flex flex-col gap-4 min-[760px]:flex-row min-[760px]:items-start min-[760px]:justify-between">
          <div>
            <p className="m-0 text-[10px] font-bold tracking-[.08em] text-muted uppercase">
              Protected values
            </p>
            <h2
              id="government-identifiers-heading"
              className="mt-1 mb-0 text-lg font-[680] tracking-[-.02em] text-midnight"
            >
              Government identifiers
            </h2>
            <p className="mt-1 mb-0 max-w-[620px] text-xs leading-5 text-muted">
              Routine reads stay masked. Full-value reveal is a separate audited step with a reason.
            </p>
          </div>
          {canManage ? (
            <Dialog open={createOpen} onOpenChange={closeCreate}>
              <DialogTrigger asChild>
                <Button size="default" variant="primary">
                  Add identifier
                </Button>
              </DialogTrigger>
              <DialogContent
                aria-describedby="add-government-identifier-description"
                size="compact"
              >
                <form className="contents" onSubmit={submitCreate}>
                  <DialogHeader>
                    <div className="grid gap-1.5">
                      <DialogTitle>Add government identifier</DialogTitle>
                      <DialogDescription id="add-government-identifier-description">
                        Record one active protected value for a supported identifier type. The
                        routine list stays masked.
                      </DialogDescription>
                    </div>
                    <DialogClose asChild>
                      <Button
                        aria-label="Close add government identifier dialog"
                        disabled={busy}
                        type="button"
                      >
                        <span aria-hidden="true" className="text-xl leading-none">
                          ×
                        </span>
                      </Button>
                    </DialogClose>
                  </DialogHeader>
                  <DialogBody className="grid gap-5">
                    {dialogError ? (
                      <p
                        role="alert"
                        className="m-0 rounded-[3px] bg-[#fdeeee] px-4 py-3 text-sm text-[#8f2d2d]"
                      >
                        {dialogError}
                      </p>
                    ) : null}
                    <label className={employeeLabelClass}>
                      Identifier type
                      <select
                        className={employeeInputClass}
                        name="identifierType"
                        value={createValues.identifierType}
                        onChange={(event) => {
                          const value = currentValue(event);
                          setCreateValues((current) => ({
                            ...current,
                            identifierType: value as IdentifierType,
                          }));
                        }}
                      >
                        <option value="UMID">UMID</option>
                        <option value="PAGIBIG">Pag-IBIG</option>
                        <option value="PHILHEALTH">PhilHealth</option>
                        <option value="PHILSYS_PCN">PhilSys PCN</option>
                        <option value="TIN">TIN</option>
                      </select>
                    </label>
                    <label className={employeeLabelClass}>
                      Identifier value
                      <input
                        autoFocus
                        className={employeeInputClass}
                        name="value"
                        value={createValues.value}
                        onChange={(event) => {
                          const value = currentValue(event);
                          setCreateValues((current) => ({
                            ...current,
                            value,
                          }));
                        }}
                        required
                      />
                      {fieldError('value') ? (
                        <span className="text-xs text-[#8f2d2d]">{fieldError('value')}</span>
                      ) : null}
                    </label>
                    <label className={employeeLabelClass}>
                      Verified date
                      <input
                        className={employeeInputClass}
                        name="verifiedAt"
                        type="date"
                        value={createValues.verifiedAt}
                        onChange={(event) => {
                          const value = currentValue(event);
                          setCreateValues((current) => ({
                            ...current,
                            verifiedAt: value,
                          }));
                        }}
                      />
                      {fieldError('verifiedAt') ? (
                        <span className="text-xs text-[#8f2d2d]">{fieldError('verifiedAt')}</span>
                      ) : null}
                    </label>
                    <p className="m-0 border-l-2 border-cobalt bg-[#f3f7fc] px-3 py-2.5 text-xs leading-[1.55] text-muted">
                      If the current value changes, replace the identifier instead of overwriting it
                      so retained history stays intact.
                    </p>
                  </DialogBody>
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button disabled={busy} size="default" type="button" variant="secondary">
                        Cancel
                      </Button>
                    </DialogClose>
                    <Button disabled={busy} size="default" type="submit" variant="primary">
                      {busy ? 'Saving…' : 'Save identifier'}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          ) : null}
        </div>
        {message ? (
          <p
            role="status"
            className={`mb-0 mt-4 text-xs ${messageTone === 'ok' ? 'text-[#27633b]' : 'text-[#8f2d2d]'}`}
          >
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
          <p
            role="status"
            className="mb-0 mt-4 rounded-[3px] bg-canvas px-4 py-3 text-sm text-muted"
          >
            Loading government identifiers…
          </p>
        ) : !canRead ? (
          <p className="mb-0 mt-4 rounded-[3px] bg-canvas px-4 py-3 text-sm text-muted">
            Government identifier read access is not available in this Agency Context.
          </p>
        ) : identifiers.length === 0 ? (
          <p className="mb-0 mt-4 rounded-[3px] bg-canvas px-4 py-6 text-sm text-muted">
            No government identifiers are recorded for this Employee.
          </p>
        ) : (
          <div className="mt-4 grid gap-4">
            {identifiers.map((identifier) => (
              <article
                key={identifier.id}
                className="rounded-[4px] border border-line bg-canvas/35 px-4 py-4"
              >
                <div className="flex flex-col gap-4 min-[760px]:flex-row min-[760px]:items-start min-[760px]:justify-between">
                  <div className="grid gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="m-0 text-sm font-[680] text-midnight">
                        {formatIdentifierType(identifier.identifierType)}
                      </h3>
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold tracking-[.06em] ${statusClass(identifier.status)}`}
                      >
                        {formatStatus(identifier.status)}
                      </span>
                    </div>
                    <dl className="grid gap-x-6 gap-y-3 min-[560px]:grid-cols-2">
                      <div>
                        <dt className="text-[10px] font-bold tracking-[.08em] text-muted uppercase">
                          Value
                        </dt>
                        <dd className="mt-1 ml-0">
                          <span className="font-mono text-sm text-ink">
                            {identifier.maskedValue}
                          </span>
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[10px] font-bold tracking-[.08em] text-muted uppercase">
                          Verified
                        </dt>
                        <dd className="mt-1 ml-0 text-sm text-ink">
                          {displayDate(identifier.verifiedAt)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[10px] font-bold tracking-[.08em] text-muted uppercase">
                          Recorded
                        </dt>
                        <dd className="mt-1 ml-0 text-sm text-ink">
                          {displayDate(identifier.createdAt)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[10px] font-bold tracking-[.08em] text-muted uppercase">
                          Last updated
                        </dt>
                        <dd className="mt-1 ml-0 text-sm text-ink">
                          {displayDate(identifier.updatedAt)}
                        </dd>
                      </div>
                    </dl>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {canReveal ? (
                      <Button
                        size="default"
                        type="button"
                        variant="secondary"
                        disabled={busy}
                        onClick={(event) => {
                          rememberOpener(revealOpener, event);
                          resetDialogState();
                          setRevealReason('');
                          setRevealedValue(null);
                          setRevealTarget(identifier);
                        }}
                      >
                        Reveal value
                      </Button>
                    ) : null}
                    {canManage && identifier.status === 'ACTIVE' ? (
                      <Button
                        size="default"
                        type="button"
                        variant="secondary"
                        disabled={busy}
                        onClick={(event) => {
                          rememberOpener(replaceOpener, event);
                          resetDialogState();
                          setReplaceValues({
                            value: '',
                            verifiedAt: normalizeDate(identifier.verifiedAt),
                            reason: '',
                          });
                          setReplaceTarget(identifier);
                        }}
                      >
                        Replace
                      </Button>
                    ) : null}
                    {canManage && identifier.status === 'ACTIVE' ? (
                      <Button
                        size="default"
                        type="button"
                        variant="secondary"
                        disabled={busy}
                        onClick={(event) => {
                          rememberOpener(invalidateOpener, event);
                          resetDialogState();
                          setInvalidateReason('');
                          setInvalidateTarget(identifier);
                        }}
                      >
                        Invalidate
                      </Button>
                    ) : null}
                    {canReadHistory ? (
                      <Button
                        size="default"
                        type="button"
                        variant="secondary"
                        disabled={busy}
                        onClick={(event) => {
                          rememberOpener(historyOpener, event);
                          navigation.navigate({ identifierHistory: identifier.id });
                        }}
                      >
                        View history
                      </Button>
                    ) : null}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <Dialog open={Boolean(revealTarget)} onOpenChange={closeReveal}>
        <DialogContent
          aria-describedby="reveal-government-identifier-description"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreFocus(revealOpener, sectionRef);
          }}
          size="compact"
        >
          <form className="contents" onSubmit={submitReveal}>
            <DialogHeader>
              <div className="grid gap-1.5">
                <DialogTitle>Reveal government identifier</DialogTitle>
                <DialogDescription id="reveal-government-identifier-description">
                  Record why you need the full protected value. The routine screen stays masked.
                </DialogDescription>
              </div>
              <DialogClose asChild>
                <Button
                  aria-label="Close reveal government identifier dialog"
                  disabled={busy}
                  type="button"
                >
                  <span aria-hidden="true" className="text-xl leading-none">
                    ×
                  </span>
                </Button>
              </DialogClose>
            </DialogHeader>
            <DialogBody className="grid gap-5">
              {dialogError ? (
                <p
                  role="alert"
                  className="m-0 rounded-[3px] bg-[#fdeeee] px-4 py-3 text-sm text-[#8f2d2d]"
                >
                  {dialogError}
                </p>
              ) : null}
              {revealedValue ? (
                <div className="grid gap-2 rounded-[3px] border border-[#b8cde5] bg-[#f3f7fc] px-4 py-4">
                  <p className="m-0 text-[10px] font-bold tracking-[.08em] text-muted uppercase">
                    Full value
                  </p>
                  <output
                    aria-label="Revealed government identifier value"
                    className="break-all font-mono text-base text-midnight"
                  >
                    {revealedValue}
                  </output>
                  <p className="m-0 text-xs leading-5 text-muted">
                    This value is shown only in this audited reveal dialog. Close the dialog when
                    you are finished.
                  </p>
                </div>
              ) : (
                <>
                  <p className="m-0 rounded-[3px] bg-canvas px-4 py-3 text-sm text-muted">
                    {revealTarget
                      ? formatIdentifierType(revealTarget.identifierType)
                      : 'Identifier'}{' '}
                    is masked as {revealTarget?.maskedValue ?? 'Unavailable'} until reveal
                    completes.
                  </p>
                  <label className={employeeLabelClass}>
                    Reveal reason
                    <textarea
                      autoFocus
                      className={`${employeeInputClass} min-h-28 py-3`}
                      name="reason"
                      value={revealReason}
                      onChange={(event) => setRevealReason(currentValue(event))}
                      required
                    />
                  </label>
                </>
              )}
            </DialogBody>
            <DialogFooter>
              {revealedValue ? (
                <DialogClose asChild>
                  <Button ref={revealCloseRef} size="default" type="button" variant="secondary">
                    Close
                  </Button>
                </DialogClose>
              ) : (
                <>
                  <DialogClose asChild>
                    <Button disabled={busy} size="default" type="button" variant="secondary">
                      Cancel
                    </Button>
                  </DialogClose>
                  <Button disabled={busy} size="default" type="submit" variant="primary">
                    {busy ? 'Revealing…' : 'Reveal value'}
                  </Button>
                </>
              )}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(replaceTarget)} onOpenChange={closeReplace}>
        <DialogContent
          aria-describedby="replace-government-identifier-description"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreFocus(replaceOpener, sectionRef);
          }}
          size="compact"
        >
          <form className="contents" onSubmit={submitReplace}>
            <DialogHeader>
              <div className="grid gap-1.5">
                <DialogTitle>Replace government identifier</DialogTitle>
                <DialogDescription id="replace-government-identifier-description">
                  Save a successor protected value. The former record stays in retained history.
                </DialogDescription>
              </div>
              <DialogClose asChild>
                <Button
                  aria-label="Close replace government identifier dialog"
                  disabled={busy}
                  type="button"
                >
                  <span aria-hidden="true" className="text-xl leading-none">
                    ×
                  </span>
                </Button>
              </DialogClose>
            </DialogHeader>
            <DialogBody className="grid gap-5">
              {dialogError ? (
                <p
                  role="alert"
                  className="m-0 rounded-[3px] bg-[#fdeeee] px-4 py-3 text-sm text-[#8f2d2d]"
                >
                  {dialogError}
                </p>
              ) : null}
              <label className={employeeLabelClass}>
                New identifier value
                <input
                  autoFocus
                  className={employeeInputClass}
                  name="value"
                  value={replaceValues.value}
                  onChange={(event) => {
                    const value = currentValue(event);
                    setReplaceValues((current) => ({
                      ...current,
                      value,
                    }));
                  }}
                  required
                />
                {fieldError('value') ? (
                  <span className="text-xs text-[#8f2d2d]">{fieldError('value')}</span>
                ) : null}
              </label>
              <label className={employeeLabelClass}>
                Verified date
                <input
                  className={employeeInputClass}
                  name="verifiedAt"
                  type="date"
                  value={replaceValues.verifiedAt}
                  onChange={(event) => {
                    const value = currentValue(event);
                    setReplaceValues((current) => ({
                      ...current,
                      verifiedAt: value,
                    }));
                  }}
                />
                {fieldError('verifiedAt') ? (
                  <span className="text-xs text-[#8f2d2d]">{fieldError('verifiedAt')}</span>
                ) : null}
              </label>
              <label className={employeeLabelClass}>
                Replacement reason
                <textarea
                  className={`${employeeInputClass} min-h-28 py-3`}
                  name="reason"
                  value={replaceValues.reason}
                  onChange={(event) => {
                    const value = currentValue(event);
                    setReplaceValues((current) => ({
                      ...current,
                      reason: value,
                    }));
                  }}
                  required
                />
                {fieldError('reason') ? (
                  <span className="text-xs text-[#8f2d2d]">{fieldError('reason')}</span>
                ) : null}
              </label>
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button disabled={busy} size="default" type="button" variant="secondary">
                  Cancel
                </Button>
              </DialogClose>
              <Button disabled={busy} size="default" type="submit" variant="primary">
                {busy ? 'Replacing…' : 'Replace identifier'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(invalidateTarget)} onOpenChange={closeInvalidate}>
        <DialogContent
          aria-describedby="invalidate-government-identifier-description"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreFocus(invalidateOpener, sectionRef);
          }}
          size="compact"
        >
          <form className="contents" onSubmit={submitInvalidate}>
            <DialogHeader>
              <div className="grid gap-1.5">
                <DialogTitle>Invalidate government identifier</DialogTitle>
                <DialogDescription id="invalidate-government-identifier-description">
                  Mark this protected value invalid without deleting its retained history.
                </DialogDescription>
              </div>
              <DialogClose asChild>
                <Button
                  aria-label="Close invalidate government identifier dialog"
                  disabled={busy}
                  type="button"
                >
                  <span aria-hidden="true" className="text-xl leading-none">
                    ×
                  </span>
                </Button>
              </DialogClose>
            </DialogHeader>
            <DialogBody className="grid gap-5">
              {dialogError ? (
                <p
                  role="alert"
                  className="m-0 rounded-[3px] bg-[#fdeeee] px-4 py-3 text-sm text-[#8f2d2d]"
                >
                  {dialogError}
                </p>
              ) : null}
              <p className="m-0 rounded-[3px] bg-canvas px-4 py-3 text-sm text-muted">
                {invalidateTarget
                  ? formatIdentifierType(invalidateTarget.identifierType)
                  : 'Identifier'}{' '}
                is currently shown as {invalidateTarget?.maskedValue ?? 'Unavailable'}.
              </p>
              <label className={employeeLabelClass}>
                Invalidation reason
                <textarea
                  autoFocus
                  className={`${employeeInputClass} min-h-28 py-3`}
                  name="reason"
                  value={invalidateReason}
                  onChange={(event) => setInvalidateReason(currentValue(event))}
                  required
                />
                {fieldError('reason') ? (
                  <span className="text-xs text-[#8f2d2d]">{fieldError('reason')}</span>
                ) : null}
              </label>
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button disabled={busy} size="default" type="button" variant="secondary">
                  Cancel
                </Button>
              </DialogClose>
              <Button disabled={busy} size="default" type="submit" variant="primary">
                {busy ? 'Invalidating…' : 'Invalidate identifier'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog presentation="form" open={Boolean(historyTarget)} onOpenChange={closeHistory}>
        <DialogContent
          aria-describedby="government-identifier-history-description"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreFocus(historyOpener, sectionRef);
          }}
          size="compact"
        >
          <DialogHeader>
            <div className="grid gap-1.5">
              <DialogTitle>Government identifier history</DialogTitle>
              <DialogDescription id="government-identifier-history-description">
                Inspect retained events for the selected protected identifier without exposing its
                full value.
              </DialogDescription>
            </div>
            <DialogClose asChild>
              <Button aria-label="Close government identifier history dialog" type="button">
                <span aria-hidden="true" className="text-xl leading-none">
                  ×
                </span>
              </Button>
            </DialogClose>
          </DialogHeader>
          <DialogBody className="grid gap-3">
            {historyLoading ? (
              <p className="m-0 text-sm text-muted" role="status">
                Loading identifier history…
              </p>
            ) : historyError ? (
              <p
                role="alert"
                className="m-0 rounded-[3px] bg-[#fdeeee] px-4 py-3 text-sm text-[#8f2d2d]"
              >
                {historyError}
              </p>
            ) : historyEntries.length === 0 ? (
              <p className="m-0 text-sm text-muted">No history events were found.</p>
            ) : (
              historyEntries.map((entry) => (
                <article
                  key={entry.id}
                  className="rounded-[4px] border border-line bg-canvas/35 p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm text-midnight">
                      {historyActionLabel(entry.action)}
                    </strong>
                    {entry.status ? (
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold tracking-[.06em] ${statusClass(entry.status)}`}
                      >
                        {formatStatus(entry.status)}
                      </span>
                    ) : null}
                  </div>
                  <dl className="mt-3 grid gap-x-6 gap-y-3 min-[560px]:grid-cols-2">
                    <div>
                      <dt className="text-[10px] font-bold tracking-[.08em] text-muted uppercase">
                        Masked value
                      </dt>
                      <dd className="mt-1 ml-0 font-mono text-sm text-ink">
                        {entry.maskedValue ?? 'Not recorded'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-bold tracking-[.08em] text-muted uppercase">
                        Recorded
                      </dt>
                      <dd className="mt-1 ml-0 text-sm text-ink">{displayDate(entry.actedAt)}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-bold tracking-[.08em] text-muted uppercase">
                        Actor
                      </dt>
                      <dd className="mt-1 ml-0 text-sm text-ink">
                        {entry.actorDisplayName ?? 'Not recorded'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-bold tracking-[.08em] text-muted uppercase">
                        Reason
                      </dt>
                      <dd className="mt-1 ml-0 text-sm text-ink">
                        {entry.reason ?? 'Not recorded'}
                      </dd>
                    </div>
                  </dl>
                </article>
              ))
            )}
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button size="default" type="button" variant="secondary">
                Close
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
