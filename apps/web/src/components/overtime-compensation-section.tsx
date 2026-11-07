'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { dateLabel, hoursLabel, monthLabel, monthsBetween } from '../lib/overtime-format';
import { StateSurface } from './state-surface';
import { Button } from './ui/button';
import { Field, inputClass } from './ui/field';
import { StatusTag, type StatusDisplay } from './ui/status-tag';
import { RowHeader, Table, Td, Th, Tr } from './ui/table';

export type CocEarnedCertificateStatus = 'DRAFT' | 'FOR_APPROVAL' | 'APPROVED' | 'DISCARDED';

/** One Certificate of COC Earned as the API's certificate read returns it. */
export interface CocEarnedCertificate {
  id: string;
  employeeId: string;
  employeeNumber: string;
  employeeName: string;
  /** The first day of the earned month, `YYYY-MM-DD`. */
  earnedMonth: string;
  status: CocEarnedCertificateStatus;
  approvedAt: string | null;
  lines: Array<{
    id: string;
    workDate: string;
    dayClassification: string | null;
    certifiedMinutes: number;
    /** Frozen at approval; `null` until then. */
    creditedMinutes: string | null;
    excessMinutes: string | null;
    releasedAt: string | null;
  }>;
}

/** An Employee's COC balance, derived by the API from the ledger as of `asOf`. */
export interface CocBalance {
  cocAccountId: string | null;
  asOf: string;
  byValidUntil: Array<{ validUntil: string; minutes: string }>;
  totalMinutes: string;
}

const STATUS_DISPLAY: Record<CocEarnedCertificateStatus, StatusDisplay> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  FOR_APPROVAL: { label: 'For approval', tone: 'warning' },
  APPROVED: { label: 'Approved', tone: 'success' },
  DISCARDED: { label: 'Discarded', tone: 'neutral' },
};

const DAY_LABEL: Record<string, string> = {
  WORKDAY: 'Workday',
  SPECIAL_WORKING: 'Special working day',
  REST_DAY: 'Rest day',
  REGULAR_HOLIDAY: 'Regular holiday',
  SPECIAL_NON_WORKING: 'Special non-working day',
  LOCAL_HOLIDAY: 'Local holiday',
};

const successClass =
  'm-0 rounded-control border border-success/40 bg-success/5 px-3 py-2.5 text-small text-success';
const errorClass =
  'm-0 rounded-control border border-danger/40 bg-danger/5 px-3 py-2.5 text-small text-danger';

type Loaded<T> = { ok: true; value: T } | { ok: false; error: string };

interface Compensation {
  id: string;
  certificates: Loaded<CocEarnedCertificate[]> | null;
  balances: Map<string, Loaded<CocBalance>>;
}

function messageOf(failure: unknown, fallback: string): string {
  return failure instanceof Error ? failure.message : fallback;
}

function valueOf(event: { currentTarget: EventTarget }): string {
  return (event.currentTarget as unknown as { value: string }).value;
}

/**
 * The authority Form's Compensation tab. For each covered Employee it shows the COC balance the
 * API derives and the Employee's Certificates of COC Earned for the months of the authority's
 * Work Dates, with their lines' certified, credited, and excess minutes as the API returns them.
 * Preparing, submitting, returning, approving, and discarding are explicit actions; the API
 * decides each one, and a refusal shows its reason. An overtime-pay authority shows the API's
 * reason that overtime pay is unavailable.
 */
export function OvertimeCompensationSection({
  authority,
  request,
  disabled,
  canReadBalance,
  canReadCertificates,
  canPrepare,
  canApprove,
}: {
  authority: {
    id: string;
    status: string;
    compensationMethod: 'COC' | 'OVERTIME_PAY';
    overtimePayUnavailableReason: string | null;
    workDateFrom: string;
    workDateTo: string;
    employees: Array<{ employeeId: string; employeeNumber: string; employeeName: string }>;
  };
  request: (path: string, init?: RequestInit) => Promise<unknown>;
  /** The authority is stale; nothing runs until it is reloaded. */
  disabled: boolean;
  canReadBalance: boolean;
  canReadCertificates: boolean;
  canPrepare: boolean;
  canApprove: boolean;
}) {
  const [loaded, setLoaded] = useState<Compensation | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const coc = authority.compensationMethod === 'COC';

  /** Read the certificates and every covered Employee's balance, each failing on its own. */
  async function read(): Promise<Omit<Compensation, 'id'>> {
    const [certificates, ...balances] = await Promise.allSettled([
      canReadCertificates
        ? (request('/coc-earned-certificates') as Promise<{
            certificates: CocEarnedCertificate[];
          }>)
        : Promise.resolve(null),
      ...authority.employees.map((employee) =>
        canReadBalance
          ? (request(
              '/employees/' + encodeURIComponent(employee.employeeId) + '/coc-balance',
            ) as Promise<CocBalance>)
          : Promise.resolve(null),
      ),
    ]);
    const settle = <T,>(
      result: PromiseSettledResult<T | null>,
      fallback: string,
    ): Loaded<T> | null =>
      result.status === 'rejected'
        ? { ok: false, error: messageOf(result.reason, fallback) }
        : result.value === null
          ? null
          : { ok: true, value: result.value };
    const list = settle(certificates, 'The Certificates of COC Earned failed to load.');
    const map = new Map<string, Loaded<CocBalance>>();
    authority.employees.forEach((employee, index) => {
      const balance = settle(
        balances[index] as PromiseSettledResult<CocBalance | null>,
        'The COC balance failed to load.',
      );
      if (balance) map.set(employee.employeeId, balance);
    });
    return {
      certificates: list && list.ok ? { ok: true, value: list.value.certificates } : list,
      balances: map,
    };
  }

  useEffect(() => {
    let active = true;
    setNotice(null);
    if (!coc) return;
    void read().then((value) => {
      if (active) setLoaded({ id: authority.id, ...value });
    });
    return () => {
      active = false;
    };
    // `request` is recreated each render; the authority alone decides what loads.
  }, [authority.id, coc]);

  /**
   * Run one command once: a second click while it is in flight does nothing. Certificates and
   * balances reload whatever the API answered, since a refusal often means a certificate moved on.
   */
  async function run(path: string, body: unknown, message: string): Promise<boolean> {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    const id = authority.id;
    let outcome: { kind: 'success' | 'error'; message: string };
    try {
      await request(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
      outcome = { kind: 'success', message };
    } catch (failure: unknown) {
      outcome = {
        kind: 'error',
        message: messageOf(failure, 'The Certificate of COC Earned action failed.'),
      };
    }
    try {
      const refreshed = await read();
      setLoaded((held) => (held?.id === id ? { id, ...refreshed } : held));
    } finally {
      setNotice(outcome);
      busyRef.current = false;
      setBusy(false);
    }
    return outcome.kind === 'success';
  }

  if (!coc) {
    return (
      <StateSurface compact label="Overtime pay unavailable">
        <p className="m-0" role="note">
          {authority.overtimePayUnavailableReason
            ? `Overtime pay is unavailable. ${authority.overtimePayUnavailableReason}`
            : 'This authority compensates by overtime pay, which Certificates of COC Earned do not cover.'}
        </p>
      </StateSurface>
    );
  }
  if (!canReadBalance && !canReadCertificates) {
    return (
      <StateSurface compact label="Compensation unavailable">
        <p className="m-0">
          Your active Agency Membership does not permit reading COC balances or Certificates of COC
          Earned.
        </p>
      </StateSurface>
    );
  }
  const current = loaded?.id === authority.id ? loaded : null;
  if (current === null) {
    return (
      <StateSurface busy compact label="Loading compensation">
        <p className="m-0" role="status">
          Loading COC balances and certificates…
        </p>
      </StateSurface>
    );
  }

  const locked = busy || disabled;
  const months = monthsBetween(authority.workDateFrom, authority.workDateTo);
  return (
    <div className="grid gap-5">
      {notice?.kind === 'success' ? (
        <p className={successClass} role="status">
          {notice.message}
        </p>
      ) : null}
      {notice?.kind === 'error' ? (
        <p className={errorClass} role="alert">
          {notice.message}
        </p>
      ) : null}
      {current.certificates && !current.certificates.ok ? (
        <p className={errorClass} role="alert">
          {current.certificates.error}
        </p>
      ) : null}
      {authority.employees.map((employee) => {
        const certificates =
          current.certificates?.ok === true
            ? current.certificates.value.filter(
                (certificate) =>
                  certificate.employeeId === employee.employeeId &&
                  months.includes(certificate.earnedMonth.slice(0, 7)),
              )
            : null;
        return (
          <section
            key={employee.employeeId}
            className="grid gap-3"
            aria-label={`Compensation of ${employee.employeeName}`}
          >
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="m-0 text-panel-title text-ink">{employee.employeeName}</h3>
                <p className="m-0 text-caption text-ink-muted">{employee.employeeNumber}</p>
              </div>
              {canReadBalance ? (
                <BalanceSummary balance={current.balances.get(employee.employeeId) ?? null} />
              ) : null}
            </header>
            {certificates === null ? null : certificates.length === 0 ? (
              <p className="m-0 text-small text-ink-muted">
                No Certificate of COC Earned for these Work Dates.
              </p>
            ) : (
              certificates.map((certificate) => (
                <CertificateCard
                  key={certificate.id}
                  certificate={certificate}
                  locked={locked}
                  canPrepare={canPrepare}
                  canApprove={canApprove}
                  run={run}
                />
              ))
            )}
            {canPrepare && canReadCertificates && authority.status === 'APPROVED' ? (
              <PrepareForm
                employeeName={employee.employeeName}
                months={months}
                busy={locked}
                onPrepare={(earnedMonth) =>
                  void run(
                    '/coc-earned-certificates',
                    { employeeId: employee.employeeId, earnedMonth },
                    `A Certificate of COC Earned for ${monthLabel(earnedMonth)} was prepared for ${employee.employeeName}.`,
                  )
                }
              />
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function BalanceSummary({ balance }: { balance: Loaded<CocBalance> | null }) {
  if (balance === null) return null;
  if (!balance.ok) {
    return (
      <p className="m-0 text-small text-danger" role="alert">
        {balance.error}
      </p>
    );
  }
  const { value } = balance;
  return (
    <dl className="m-0 grid gap-1 text-small" aria-label="COC balance">
      <div>
        <dt className="text-caption text-ink-muted">COC balance as of {dateLabel(value.asOf)}</dt>
        <dd className="m-0 font-[600] text-ink">{hoursLabel(value.totalMinutes)} minutes</dd>
      </div>
      {value.cocAccountId === null ? (
        <dd className="m-0 text-caption text-ink-muted">No COC Account yet.</dd>
      ) : (
        value.byValidUntil.map((group) => (
          <dd key={group.validUntil} className="m-0 text-caption text-ink-muted">
            {hoursLabel(group.minutes)} minutes valid until {dateLabel(group.validUntil)}
          </dd>
        ))
      )}
    </dl>
  );
}

function CertificateCard({
  certificate,
  locked,
  canPrepare,
  canApprove,
  run,
}: {
  certificate: CocEarnedCertificate;
  locked: boolean;
  canPrepare: boolean;
  canApprove: boolean;
  run: (path: string, body: unknown, message: string) => Promise<boolean>;
}) {
  const [returning, setReturning] = useState(false);
  const [reason, setReason] = useState('');
  const display = STATUS_DISPLAY[certificate.status];
  const month = monthLabel(certificate.earnedMonth);
  const title = `Certificate of COC Earned for ${month}`;
  const path = '/coc-earned-certificates/' + encodeURIComponent(certificate.id);
  async function submitReturn(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (reason.trim() === '') return;
    const returned = await run(
      path + '/return',
      { reason: reason.trim() },
      `The certificate for ${month} was returned to its preparer.`,
    );
    if (returned) {
      setReturning(false);
      setReason('');
    }
  }
  return (
    <article className="grid gap-2 rounded-panel border border-border p-3" aria-label={title}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="m-0 text-body font-[650] text-ink">{title}</h4>
          <StatusTag tone={display.tone}>{display.label}</StatusTag>
          {certificate.approvedAt ? (
            <span className="text-caption text-ink-muted">
              Approved {dateLabel(certificate.approvedAt)}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {certificate.status === 'DRAFT' && canPrepare ? (
            <>
              <Button
                variant="primary"
                disabled={locked}
                aria-label={`Submit the certificate for ${month} for approval`}
                onClick={() =>
                  void run(
                    path + '/submit',
                    undefined,
                    `The certificate for ${month} was submitted for approval.`,
                  )
                }
              >
                Submit
              </Button>
              <Button
                variant="secondary"
                disabled={locked}
                aria-label={`Discard the certificate for ${month}`}
                onClick={() =>
                  void run(
                    path + '/discard',
                    undefined,
                    `The certificate for ${month} was discarded.`,
                  )
                }
              >
                Discard
              </Button>
            </>
          ) : null}
          {certificate.status === 'FOR_APPROVAL' && canApprove ? (
            <>
              <Button
                variant="primary"
                disabled={locked}
                aria-label={`Approve the certificate for ${month}`}
                onClick={() =>
                  void run(
                    path + '/approve',
                    undefined,
                    `The certificate for ${month} was approved and its COC credited.`,
                  )
                }
              >
                Approve
              </Button>
              <Button
                variant="secondary"
                disabled={locked || returning}
                aria-label={`Return the certificate for ${month}`}
                onClick={() => setReturning(true)}
              >
                Return
              </Button>
            </>
          ) : null}
        </div>
      </header>
      {returning && certificate.status === 'FOR_APPROVAL' ? (
        <form
          className="flex flex-wrap items-end gap-3"
          aria-label={`Return the certificate for ${month}`}
          onSubmit={(event) => void submitReturn(event)}
        >
          <div className="min-w-[280px] flex-1">
            <Field label="Return reason">
              <textarea
                className={inputClass + ' py-2'}
                rows={2}
                value={reason}
                onChange={(event) => setReason(valueOf(event))}
              />
            </Field>
          </div>
          <Button type="submit" variant="secondary" disabled={locked || reason.trim() === ''}>
            Return certificate
          </Button>
          <Button
            type="button"
            variant="quiet"
            disabled={locked}
            onClick={() => setReturning(false)}
          >
            Keep
          </Button>
        </form>
      ) : null}
      <div className="overflow-x-auto rounded-panel border border-border">
        <Table className="min-w-[720px]">
          <thead>
            <tr>
              <Th>Work Date</Th>
              <Th>Day classification</Th>
              <Th>Certified minutes</Th>
              <Th>Credited minutes</Th>
              <Th>Excess minutes</Th>
            </tr>
          </thead>
          <tbody>
            {certificate.lines.map((line) => (
              <Tr key={line.id}>
                <RowHeader>
                  {dateLabel(line.workDate)}
                  {line.releasedAt ? (
                    <span className="block text-caption text-ink-muted">Released</span>
                  ) : null}
                </RowHeader>
                <Td>
                  {line.dayClassification
                    ? (DAY_LABEL[line.dayClassification] ?? line.dayClassification)
                    : '—'}
                </Td>
                <Td>{line.certifiedMinutes}</Td>
                <Td>
                  {line.creditedMinutes === null ? (
                    <span className="text-ink-muted">Set at approval</span>
                  ) : (
                    hoursLabel(line.creditedMinutes)
                  )}
                </Td>
                <Td>
                  {line.excessMinutes === null ? (
                    <span className="text-ink-muted">—</span>
                  ) : (
                    hoursLabel(line.excessMinutes)
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </div>
    </article>
  );
}

function PrepareForm({
  employeeName,
  months,
  busy,
  onPrepare,
}: {
  employeeName: string;
  months: string[];
  busy: boolean;
  onPrepare: (earnedMonth: string) => void;
}) {
  const [month, setMonth] = useState(months[0] ?? '');
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (month) onPrepare(month);
  }
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      aria-label={`Prepare a certificate for ${employeeName}`}
      onSubmit={submit}
    >
      <Field label="Earned month">
        <select className={inputClass} value={month} onChange={(event) => setMonth(valueOf(event))}>
          {months.map((value) => (
            <option key={value} value={value}>
              {monthLabel(value)}
            </option>
          ))}
        </select>
      </Field>
      <Button type="submit" variant="secondary" disabled={busy || month === ''}>
        Prepare certificate for {employeeName}
      </Button>
    </form>
  );
}
