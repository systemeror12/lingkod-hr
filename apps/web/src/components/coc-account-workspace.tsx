'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { dateLabel, hoursLabel, monthLabel } from '../lib/overtime-format';
import type { CocBalance } from './overtime-compensation-section';
import { useRecordNavigation } from './record-navigation';
import { StateSurface } from './state-surface';
import { Button } from './ui/button';
import { Field, FormError, inputClass } from './ui/field';
import { PageHeader } from './ui/page-header';
import { Panel } from './ui/panel';
import { SectionTabList, SectionTabPanel, SectionTabs } from './ui/section-tabs';
import { StatusTag, type StatusDisplay } from './ui/status-tag';
import { RowHeader, Table, TableFooter, Td, Th, Tr } from './ui/table';

/** One COC Account as the API's account list returns it. */
export interface CocAccountSummary {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeNumber: string;
  status: string;
  openedAt: string;
  closedAt: string | null;
  /** Today's balance for an active account; `null` for a closed one. */
  balanceMinutes: string | null;
}

/** One posted COC Ledger Entry as the API's ledger read returns it. */
interface CocLedgerEntry {
  id: string;
  minutes: string;
  effectiveDate: string;
  validUntil: string;
  earnedMonth: string | null;
  sourceType: string;
  sourceId: string;
  ruleCode: string;
  reason: string | null;
  supportingDocumentVersionId: string | null;
  reversesEntryId: string | null;
  reversedByEntryId: string | null;
  postedAt: string;
  overtimeAuthority: { id: string; authorityNo: string } | null;
}

interface CocLedger {
  account: Omit<CocAccountSummary, 'balanceMinutes'>;
  entries: CocLedgerEntry[];
}

interface Loaded {
  id: string;
  ledger: CocLedger | null;
  /** `null` for a closed account, which has no balance to read. */
  balance: CocBalance | null;
  error: string;
}

const ACCOUNT_STATUS: Record<string, StatusDisplay> = {
  ACTIVE: { label: 'Active', tone: 'success' },
  CLOSED: { label: 'Closed', tone: 'neutral' },
};

/** What each ledger source is, in the user's words. The source type is the entry's type. */
const SOURCE_LABEL: Record<string, string> = {
  COC_EARNED_CERTIFICATE: 'Earned',
  COC_ADJUSTMENT: 'Adjusted',
  COC_REVERSAL: 'Reversal',
  COC_EXPIRY: 'Expired',
  CTO_REQUEST: 'CTO used',
  CTO_CANCELLATION: 'CTO cancellation returned',
};

/**
 * The sources the API lets a user reverse (hris-controls §5.18); CTO usage returns through CTO
 * cancellation. The API still decides each reversal and gives its reason when it refuses.
 */
const REVERSIBLE = new Set(['COC_ADJUSTMENT', 'COC_EXPIRY']);

const successClass =
  'm-0 rounded-control border border-success/40 bg-success/5 px-3 py-2.5 text-small text-success';
const linkClass = 'font-[600] text-primary underline-offset-2 hover:underline';

function valueOf(event: { currentTarget: EventTarget }): string {
  return (event.currentTarget as unknown as { value: string }).value;
}

function messageOf(failure: unknown, fallback: string): string {
  return failure instanceof Error ? failure.message : fallback;
}

/** The API's refusal message, followed by any field messages. */
function refusalMessage(value: unknown, fallback: string): string {
  const error = (value as { error?: { message?: unknown; fields?: unknown } } | null)?.error;
  const message = typeof error?.message === 'string' ? error.message : fallback;
  const fields =
    error?.fields && typeof error.fields === 'object'
      ? Object.values(error.fields as Record<string, unknown>).filter(
          (field): field is string => typeof field === 'string',
        )
      : [];
  return [message, ...fields].join(' ');
}

function minutesLabel(value: string): string {
  return `${hoursLabel(value)} minutes`;
}

/**
 * The COC Accounts destination: a Tree of the accounts the reader may see, and a Form with the
 * API's balance by Valid Until and the account's whole ledger. Each entry shows its source; an
 * earned entry links to the Compensation tab of its Overtime Authority, and a reversal and the
 * entry it reverses link to each other. Adjusting and reversing are explicit, evidence-backed
 * commands the API decides.
 */
export function CocAccountWorkspace({
  agencyId,
  initial,
  canAdjust,
  canReverse,
}: {
  agencyId: string;
  initial: CocAccountSummary[];
  canAdjust: boolean;
  canReverse: boolean;
}) {
  const [accounts, setAccounts] = useState(initial);
  const [query, setQuery] = useState('');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [notice, setNotice] = useState<{
    recordId: string;
    kind: 'success' | 'error';
    message: string;
  } | null>(null);
  const [reversing, setReversing] = useState<string | null>(null);
  const navigation = useRecordNavigation();
  const view = navigation.search.get('view') === 'form' ? 'form' : 'tree';
  const recordId = navigation.search.get('record');

  const current = loaded?.id === recordId ? loaded : null;
  const shown = notice?.recordId === recordId ? notice : null;

  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await fetch('/api/v1/agencies/' + agencyId + path, {
      ...init,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...init.headers },
    });
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new Error(refusalMessage(value, 'The COC Account request failed.'));
    return value;
  }

  /** The ledger, then the balance of an active account. */
  async function read(id: string): Promise<Loaded> {
    try {
      const ledger = (await request(
        '/coc-accounts/' + encodeURIComponent(id) + '/entries',
      )) as CocLedger;
      const balance =
        ledger.account.status === 'ACTIVE'
          ? ((await request(
              '/employees/' + encodeURIComponent(ledger.account.employeeId) + '/coc-balance',
            )) as CocBalance)
          : null;
      return { id, ledger, balance, error: '' };
    } catch (failure: unknown) {
      return {
        id,
        ledger: null,
        balance: null,
        error: messageOf(failure, 'The COC Account failed to load.'),
      };
    }
  }

  useEffect(() => {
    setLoaded(null);
    setReversing(null);
    setNotice((held) => (held?.recordId === recordId ? held : null));
    if (recordId === null) return;
    let active = true;
    void read(recordId).then((value) => {
      if (active) setLoaded(value);
    });
    return () => {
      active = false;
    };
    // `read` is recreated each render; the record alone decides what loads.
  }, [recordId]);

  /** Run one command once, then reload the ledger, balance, and register whatever it answered. */
  async function run(path: string, body: unknown, message: string): Promise<boolean> {
    if (busyRef.current || !recordId) return false;
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    const id = recordId;
    let ok = true;
    let outcome = message;
    try {
      await request(path, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      });
    } catch (failure: unknown) {
      ok = false;
      outcome = messageOf(failure, 'The COC correction failed.');
    }
    try {
      const [refreshed, list] = await Promise.all([
        read(id),
        request('/coc-accounts') as Promise<{ accounts: CocAccountSummary[] }>,
      ]);
      setLoaded((held) => (held === null || held.id === id ? refreshed : held));
      setAccounts(list.accounts);
    } catch {
      // The ledger reload reports its own failure; a stale register is refreshed next time.
    } finally {
      setNotice({ recordId: id, kind: ok ? 'success' : 'error', message: outcome });
      if (ok) setReversing(null);
      busyRef.current = false;
      setBusy(false);
    }
    return ok;
  }

  const needle = query.trim().toLowerCase();
  const visible = accounts.filter(
    (account) =>
      needle === '' ||
      account.employeeName.toLowerCase().includes(needle) ||
      account.employeeNumber.toLowerCase().includes(needle),
  );
  const position = recordId ? visible.findIndex((row) => row.id === recordId) : -1;
  const previous = position > 0 ? visible[position - 1] : undefined;
  const next = position >= 0 ? visible[position + 1] : undefined;
  const openRecord = (id: string) => navigation.navigate({ view: 'form', record: id });

  return (
    <SectionTabs
      className="grid min-w-0 gap-5"
      value={view}
      onValueChange={(nextView) => navigation.navigate({ view: nextView })}
    >
      <PageHeader
        breadcrumbs={[{ label: 'Overtime' }]}
        title="COC Accounts"
        tabs={
          <SectionTabList
            label="COC Account views"
            tabs={[
              { value: 'tree', label: 'Tree' },
              { value: 'form', label: 'Form' },
            ]}
          />
        }
      />
      <p className="m-0 max-w-[760px] text-small text-ink-muted">
        Compensatory Overtime Credit earned, used, expired, adjusted, and reversed, as posted to
        each Employee’s ledger.
      </p>

      <SectionTabPanel value="tree">
        <Panel
          title="COC Account register"
          flush
          actions={
            <input
              aria-label="Search Employee"
              className={inputClass + ' max-w-xs'}
              placeholder="Search Employee"
              value={query}
              onChange={(event) => setQuery(valueOf(event))}
            />
          }
        >
          {visible.length === 0 ? (
            <StateSurface compact label="COC Accounts">
              <p className="m-0">
                {accounts.length === 0 ? 'No COC Accounts yet.' : 'No COC Accounts match.'}
              </p>
            </StateSurface>
          ) : (
            <>
              <Table className="min-w-[720px]">
                <thead>
                  <tr>
                    <Th>Employee</Th>
                    <Th>Status</Th>
                    <Th>Opened</Th>
                    <Th>Balance today</Th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((account) => (
                    <Tr key={account.id} selected={account.id === recordId}>
                      <RowHeader>
                        <button
                          type="button"
                          className="cursor-pointer border-0 bg-transparent p-0 text-left font-[600] text-ink underline-offset-2 hover:underline"
                          onClick={() => openRecord(account.id)}
                        >
                          {account.employeeName}
                        </button>
                        <p className="m-0 text-caption font-normal text-ink-muted">
                          {account.employeeNumber}
                        </p>
                      </RowHeader>
                      <Td>
                        <AccountStatus status={account.status} />
                      </Td>
                      <Td>{dateLabel(account.openedAt)}</Td>
                      <Td>
                        {account.balanceMinutes === null
                          ? '—'
                          : minutesLabel(account.balanceMinutes)}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
              <TableFooter shown={visible.length} total={accounts.length} />
            </>
          )}
        </Panel>
      </SectionTabPanel>

      <SectionTabPanel value="form">
        <Panel
          title="COC Account record"
          actions={
            recordId ? (
              <>
                <Button
                  variant="secondary"
                  disabled={!previous}
                  onClick={() => previous && openRecord(previous.id)}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  disabled={!next}
                  onClick={() => next && openRecord(next.id)}
                >
                  Next
                </Button>
              </>
            ) : null
          }
        >
          {recordId === null ? (
            <StateSurface compact>
              <p className="m-0">Select a COC Account from the Tree view.</p>
            </StateSurface>
          ) : current === null ? (
            <StateSurface busy compact label="Loading COC Account">
              <p className="m-0" role="status">
                Loading the COC Account…
              </p>
            </StateSurface>
          ) : current.ledger === null ? (
            <StateSurface compact label="COC Account unavailable">
              <p className="m-0" role="alert">
                {current.error}
              </p>
            </StateSurface>
          ) : (
            <AccountForm
              ledger={current.ledger}
              balance={current.balance}
              busy={busy}
              notice={shown}
              canAdjust={canAdjust && current.ledger.account.status === 'ACTIVE'}
              canReverse={canReverse && current.ledger.account.status === 'ACTIVE'}
              reversing={reversing}
              onReversing={(id) => {
                setNotice(null);
                setReversing(id);
              }}
              run={run}
            />
          )}
        </Panel>
      </SectionTabPanel>
    </SectionTabs>
  );
}

function AccountStatus({ status }: { status: string }) {
  const display = ACCOUNT_STATUS[status] ?? { label: status, tone: 'neutral' as const };
  return <StatusTag tone={display.tone}>{display.label}</StatusTag>;
}

function AccountForm({
  ledger,
  balance,
  busy,
  notice,
  canAdjust,
  canReverse,
  reversing,
  onReversing,
  run,
}: {
  ledger: CocLedger;
  balance: CocBalance | null;
  busy: boolean;
  notice: { kind: 'success' | 'error'; message: string } | null;
  canAdjust: boolean;
  canReverse: boolean;
  reversing: string | null;
  onReversing: (id: string | null) => void;
  run: (path: string, body: unknown, message: string) => Promise<boolean>;
}) {
  const { account, entries } = ledger;
  const number = new Map(entries.map((entry, index) => [entry.id, index + 1]));
  const reversed = entries.find((entry) => entry.id === reversing) ?? null;
  const base = '/coc-accounts/' + encodeURIComponent(account.id);

  return (
    <div className="grid gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="m-0 text-panel-title text-ink">{account.employeeName}</h2>
          <p className="m-0 text-small text-ink-muted">
            {account.employeeNumber} · Opened {dateLabel(account.openedAt)}
            {account.closedAt ? ` · Closed ${dateLabel(account.closedAt)}` : ''}
          </p>
        </div>
        <AccountStatus status={account.status} />
      </header>

      {notice?.kind === 'success' ? (
        <p className={successClass} role="status">
          {notice.message}
        </p>
      ) : null}
      <FormError message={notice?.kind === 'error' ? notice.message : ''} />

      {balance ? (
        <dl className="m-0 grid gap-3 text-small sm:grid-cols-2" aria-label="COC balance">
          <div>
            <dt className="text-caption text-ink-muted">
              COC balance as of {dateLabel(balance.asOf)}
            </dt>
            <dd className="m-0 font-[600] text-ink">{minutesLabel(balance.totalMinutes)}</dd>
          </div>
          <div>
            <dt className="text-caption text-ink-muted">By Valid Until, earliest expiring first</dt>
            <dd className="m-0 text-ink">
              {balance.byValidUntil.length === 0
                ? 'No COC valid today.'
                : balance.byValidUntil
                    .map(
                      (group) =>
                        `${minutesLabel(group.minutes)} valid until ${dateLabel(group.validUntil)}`,
                    )
                    .join(' · ')}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="m-0 text-small text-ink-muted">
          A closed account has no balance; its ledger stays as posted.
        </p>
      )}

      <section className="grid gap-2" aria-label="COC ledger">
        <h3 className="m-0 text-panel-title text-ink">Ledger</h3>
        {entries.length === 0 ? (
          <p className="m-0 text-small text-ink-muted">No entries posted.</p>
        ) : (
          <Table className="min-w-[960px]">
            <thead>
              <tr>
                <Th>Entry</Th>
                <Th>Type</Th>
                <Th>Minutes</Th>
                <Th>Valid until</Th>
                <Th>Source</Th>
                <Th>Reversal</Th>
                {canReverse ? <Th>Actions</Th> : null}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const no = number.get(entry.id);
                const reversible =
                  canReverse &&
                  entry.reversedByEntryId === null &&
                  entry.minutes.startsWith('-') &&
                  REVERSIBLE.has(entry.sourceType);
                return (
                  <Tr key={entry.id} id={'coc-entry-' + entry.id} selected={entry.id === reversing}>
                    <RowHeader>
                      Entry {no}
                      <p className="m-0 text-caption font-normal text-ink-muted">
                        Effective {dateLabel(entry.effectiveDate)}
                      </p>
                    </RowHeader>
                    <Td>{SOURCE_LABEL[entry.sourceType] ?? entry.sourceType}</Td>
                    <Td>{hoursLabel(entry.minutes)}</Td>
                    <Td>{dateLabel(entry.validUntil)}</Td>
                    <Td>
                      <EntrySource entry={entry} />
                    </Td>
                    <Td>
                      {entry.reversesEntryId ? (
                        <a className={linkClass} href={'#coc-entry-' + entry.reversesEntryId}>
                          Reverses entry {number.get(entry.reversesEntryId)}
                        </a>
                      ) : entry.reversedByEntryId ? (
                        <a className={linkClass} href={'#coc-entry-' + entry.reversedByEntryId}>
                          Reversed by entry {number.get(entry.reversedByEntryId)}
                        </a>
                      ) : (
                        '—'
                      )}
                    </Td>
                    {canReverse ? (
                      <Td>
                        {reversible ? (
                          <Button
                            variant="secondary"
                            disabled={busy}
                            aria-label={`Reverse entry ${no}`}
                            onClick={() => onReversing(entry.id)}
                          >
                            Reverse
                          </Button>
                        ) : null}
                      </Td>
                    ) : null}
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </section>

      {reversed ? (
        <CorrectionForm
          key={reversed.id}
          title={`Reverse entry ${number.get(reversed.id)}`}
          description={`Restores ${hoursLabel(reversed.minutes.replace(/^-/, ''))} minutes valid until ${dateLabel(reversed.validUntil)}, effective ${dateLabel(reversed.effectiveDate)}.`}
          submitLabel="Post reversal"
          busy={busy}
          onCancel={() => onReversing(null)}
          onSubmit={(evidence) =>
            run(
              base + '/entries/' + encodeURIComponent(reversed.id) + '/reversal',
              evidence,
              `Entry ${number.get(reversed.id)} was reversed.`,
            )
          }
        />
      ) : null}

      {canAdjust ? (
        <CorrectionForm
          title="Adjust COC"
          description="Draws COC down by a negative entry effective today. New credit comes only from a Certificate of COC Earned."
          submitLabel="Post adjustment"
          busy={busy}
          adjustment={balance?.byValidUntil ?? []}
          onSubmit={({ minutes, validUntil, ...evidence }) =>
            run(
              base + '/adjustments',
              {
                minutes: '-' + (minutes ?? '').trim().replace(/^-/, ''),
                ...(validUntil ? { validUntil } : {}),
                ...evidence,
              },
              'The adjustment was posted.',
            )
          }
        />
      ) : null}
    </div>
  );
}

function EntrySource({ entry }: { entry: CocLedgerEntry }) {
  const evidence = entry.supportingDocumentVersionId ? (
    <span className="block text-caption text-ink-muted">
      Evidence: Document Version {entry.supportingDocumentVersionId}
    </span>
  ) : null;
  const reason = entry.reason ? <span className="block">{entry.reason}</span> : null;
  if (entry.sourceType === 'COC_EARNED_CERTIFICATE') {
    return (
      <>
        <span className="block">
          Certificate of COC Earned
          {entry.earnedMonth ? ` for ${monthLabel(entry.earnedMonth)}` : ''}
        </span>
        {entry.overtimeAuthority ? (
          <a
            className={linkClass}
            href={
              '/overtime-authorities?view=form&tab=compensation&record=' +
              encodeURIComponent(entry.overtimeAuthority.id)
            }
          >
            {entry.overtimeAuthority.authorityNo} Compensation
          </a>
        ) : null}
      </>
    );
  }
  if (entry.sourceType === 'COC_EXPIRY') {
    return <span>Valid Until passed ({entry.ruleCode})</span>;
  }
  return (
    <>
      {reason}
      {evidence}
      {!reason && !evidence ? <span>{entry.ruleCode}</span> : null}
    </>
  );
}

function CorrectionForm({
  title,
  description,
  submitLabel,
  busy,
  adjustment,
  onCancel,
  onSubmit,
}: {
  title: string;
  description: string;
  submitLabel: string;
  busy: boolean;
  /** Set for an adjustment: the Valid Untils it may draw from. */
  adjustment?: Array<{ validUntil: string; minutes: string }>;
  onCancel?: () => void;
  onSubmit: (values: {
    minutes?: string;
    validUntil?: string;
    reason: string;
    supportingDocumentVersionId: string;
  }) => Promise<boolean>;
}) {
  const [minutes, setMinutes] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [reason, setReason] = useState('');
  const [documentVersionId, setDocumentVersionId] = useState('');

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void onSubmit({
      ...(adjustment ? { minutes, validUntil } : {}),
      reason,
      supportingDocumentVersionId: documentVersionId.trim(),
    }).then((ok) => {
      if (!ok) return;
      setMinutes('');
      setValidUntil('');
      setReason('');
      setDocumentVersionId('');
    });
  }

  return (
    <form
      aria-label={title}
      className="grid gap-3 rounded-control border border-border p-4"
      onSubmit={submit}
    >
      <div>
        <h3 className="m-0 text-panel-title text-ink">{title}</h3>
        <p className="m-0 text-small text-ink-muted">{description}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {adjustment ? (
          <>
            <Field label="Minutes to deduct">
              <input
                className={inputClass}
                inputMode="decimal"
                value={minutes}
                onChange={(event) => setMinutes(valueOf(event))}
                required
              />
            </Field>
            <Field label="Draw from">
              <select
                className={inputClass}
                value={validUntil}
                onChange={(event) => setValidUntil(valueOf(event))}
              >
                <option value="">Earliest-expiring COC</option>
                {adjustment.map((group) => (
                  <option key={group.validUntil} value={group.validUntil}>
                    Valid until {dateLabel(group.validUntil)} ({minutesLabel(group.minutes)})
                  </option>
                ))}
              </select>
            </Field>
          </>
        ) : null}
        <Field label="Reason">
          <textarea
            className={inputClass + ' min-h-20 py-2'}
            value={reason}
            onChange={(event) => setReason(valueOf(event))}
            required
          />
        </Field>
        <Field label="Supporting Document Version">
          <input
            className={inputClass}
            value={documentVersionId}
            onChange={(event) => setDocumentVersionId(valueOf(event))}
            placeholder="Finalized Document Version UUID"
            required
          />
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={busy}>
          {submitLabel}
        </Button>
        {onCancel ? (
          <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
