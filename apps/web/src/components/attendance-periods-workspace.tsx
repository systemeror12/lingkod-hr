'use client';

import { useEffect, useState } from 'react';
import { Button } from './ui/button';
import { Field, FormError, inputClass } from './ui/field';
import type { AttendancePeriodListResponse, AttendancePeriodOption } from './dtrs-workspace';

interface AttendancePayrollPublication {
  id: string;
  attendancePeriodVersionId: string;
  predecessorPublicationId: string | null;
  publicationType: string;
  idempotencyKey: string;
  publishedAt: string;
  factCount: number;
  factMinutes: number;
}

interface AttendancePeriodVersion {
  id: string;
  attendancePeriodId: string;
  period: AttendancePeriodOption;
  versionNo: number;
  status: string;
  predecessorVersionId: string | null;
  approvalRouteVersionId: string;
  submittedByMembershipId: string;
  submittedAt: string;
  reviewedByMembershipId: string | null;
  reviewedAt: string | null;
  reviewReason: string | null;
  lockedByMembershipId: string | null;
  lockedAt: string | null;
  coveredEmployeeCount: number;
  coveredWorkDateCount: number;
  dtrCount: number;
  publication: AttendancePayrollPublication | null;
}

interface AttendancePeriodVersionListResponse {
  versions: AttendancePeriodVersion[];
}

interface Reconciliation {
  source: string;
  checkedAt: string;
  ok: boolean;
  failures: Array<{ code: string; message: string }>;
  population: { employeeCount: number; workDateCount: number; membershipCount: number };
  payroll: {
    factCount: number;
    factMinutes: number;
    factTypeMinutes: Record<string, number>;
    expectedMinutes: number;
    excludedOutsideScheduleMinutes: number;
    excludedStatutoryNightWindowMinutes: number;
  };
}

interface AttendancePeriodVersionDetailResponse {
  version: AttendancePeriodVersion;
  reconciliation: Reconciliation | null;
}

interface AttendancePayrollFact {
  id: string;
  employeeId: string;
  workDate: string;
  factType: string;
  holidayClassification: string | null;
  stableSourceKey: string;
  correctedMinutes: number;
  priorMinutes: number | null;
  differenceDirection: string | null;
  differenceMinutes: number | null;
}

interface AttendancePayrollPublicationDetailResponse {
  publication: AttendancePayrollPublication;
  facts: AttendancePayrollFact[];
}

interface AttendancePeriodsWorkspaceProps {
  agencyId: string;
  canRead: boolean;
  canReadPublication: boolean;
  canSubmit: boolean;
  canReturn: boolean;
  canApprove: boolean;
  canLock: boolean;
  initialPeriods: AttendancePeriodListResponse;
}

function eventValue(event: { currentTarget: EventTarget }): string {
  return (event.currentTarget as unknown as { value: string }).value;
}

function errorMessage(value: unknown, fallback: string): string {
  if (value === null || typeof value !== 'object') return fallback;
  const error = (value as { error?: unknown }).error;
  if (error === null || typeof error !== 'object') return fallback;
  const message = (error as { message?: unknown }).message;
  const reasons = (error as { reasons?: unknown }).reasons;
  const base = typeof message === 'string' ? message : fallback;
  if (Array.isArray(reasons) && reasons.length > 0) {
    return `${base} (${reasons.filter((item) => typeof item === 'string').join('; ')})`;
  }
  return base;
}

function factLabel(fact: AttendancePayrollFact): string {
  const holiday = fact.holidayClassification ? ` · ${fact.holidayClassification}` : '';
  const difference =
    fact.differenceDirection && fact.differenceMinutes !== null
      ? ` · prior ${fact.priorMinutes ?? 0} · ${fact.differenceDirection} ${fact.differenceMinutes}`
      : '';
  return `${fact.workDate} · ${fact.factType}${holiday} · ${fact.correctedMinutes} minutes${difference}`;
}

export function AttendancePeriodsWorkspace(props: AttendancePeriodsWorkspaceProps) {
  const [periods] = useState(props.initialPeriods.periods);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>(
    props.initialPeriods.periods[0]?.id ?? '',
  );
  const [versions, setVersions] = useState<AttendancePeriodVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string>('');
  const [detail, setDetail] = useState<AttendancePeriodVersionDetailResponse | null>(null);
  const [publication, setPublication] = useState<AttendancePayrollPublicationDetailResponse | null>(
    null,
  );
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await fetch('/api/v1/agencies/' + props.agencyId + path, {
      ...init,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...init.headers },
    });
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(errorMessage(value, 'The Attendance Period action failed.'));
    }
    return value;
  }

  async function loadVersions(periodId: string): Promise<void> {
    if (!periodId || !props.canRead) {
      setVersions([]);
      return;
    }
    const value = (await request(
      '/attendance-periods/' + periodId + '/versions',
    )) as AttendancePeriodVersionListResponse;
    setVersions(value.versions);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await loadVersions(selectedPeriodId);
      } catch (failure: unknown) {
        if (!cancelled) {
          setError(
            failure instanceof Error ? failure.message : 'The versions could not be loaded.',
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.agencyId, props.canRead, selectedPeriodId]);

  async function loadVersionDetail(versionId: string): Promise<void> {
    const detailValue = (await request(
      '/attendance-period-versions/' + versionId,
    )) as AttendancePeriodVersionDetailResponse;
    if (!detailValue.reconciliation) {
      const live = (await request(
        '/attendance-period-versions/' + versionId + '/reconciliation',
      )) as { reconciliation: Reconciliation };
      detailValue.reconciliation = live.reconciliation;
    }
    setDetail(detailValue);
    if (
      props.canReadPublication &&
      detailValue.version.status === 'LOCKED' &&
      detailValue.version.publication
    ) {
      setPublication(
        (await request(
          '/attendance-period-versions/' + versionId + '/publication',
        )) as AttendancePayrollPublicationDetailResponse,
      );
    } else {
      setPublication(null);
    }
  }

  useEffect(() => {
    let cancelled = false;
    if (!selectedVersionId || !props.canRead) {
      setDetail(null);
      setPublication(null);
      return;
    }
    void (async () => {
      try {
        await loadVersionDetail(selectedVersionId);
      } catch (failure: unknown) {
        if (!cancelled) {
          setDetail(null);
          setPublication(null);
          setError(failure instanceof Error ? failure.message : 'The version could not be loaded.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.agencyId, props.canRead, selectedVersionId]);

  async function run(path: string, body: Record<string, unknown> | undefined, message: string) {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await request(path, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      setReason('');
      setSuccess(message);
      await loadVersions(selectedPeriodId);
      if (selectedVersionId) await loadVersionDetail(selectedVersionId);
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : 'The action failed.');
    } finally {
      setBusy(false);
    }
  }

  async function submitSelectedPeriod(): Promise<void> {
    if (!selectedPeriodId) return;
    await run(
      '/attendance-periods/' + selectedPeriodId + '/versions',
      undefined,
      'Attendance Period Version submitted for review.',
    );
  }

  async function returnVersion(versionId: string): Promise<void> {
    if (!reason.trim()) {
      setError('A return reason is required.');
      return;
    }
    await run(
      '/attendance-period-versions/' + versionId + '/return',
      { reason },
      'Attendance Period Version returned with a reason.',
    );
  }

  async function approveVersion(versionId: string): Promise<void> {
    await run(
      '/attendance-period-versions/' + versionId + '/approve',
      reason.trim() ? { reason } : {},
      'Attendance Period Version approved.',
    );
  }

  async function lockVersion(versionId: string): Promise<void> {
    await run(
      '/attendance-period-versions/' + versionId + '/lock',
      undefined,
      'Attendance Period Version locked with its publication.',
    );
  }

  const hasPendingVersion = versions.some(
    (version) => version.status === 'FOR_REVIEW' || version.status === 'APPROVED',
  );
  const selectedPeriod = periods.find((period) => period.id === selectedPeriodId);

  return (
    <section className="grid gap-5 text-sm text-ink">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="m-0 text-[10px] font-bold tracking-[.12em] text-muted uppercase">
            Attendance
          </p>
          <h1 className="m-0 text-xl font-[680] text-midnight">Attendance Periods</h1>
          <p className="m-0 mt-1 text-xs text-muted">
            An Attendance Period stays OPEN or FINALIZED; every review snapshot is an immutable
            version, and lock publishes stable payroll inputs.
          </p>
        </div>
        {periods.length > 0 ? (
          <label className="grid gap-1 text-xs font-medium text-muted">
            Attendance Period
            <select
              aria-label="Attendance Period"
              className={inputClass}
              value={selectedPeriodId}
              onChange={(event) => {
                setSelectedPeriodId(eventValue(event));
                setSelectedVersionId('');
              }}
            >
              {periods.map((period) => (
                <option key={period.id} value={period.id}>
                  {period.code} · {period.dateFrom} to {period.dateTo} · {period.status}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </header>

      {error ? <FormError message={error} /> : null}
      {success ? (
        <p
          className="m-0 rounded-[3px] border border-line bg-[#e8f3ed] px-4 py-3 text-xs text-[#316647]"
          role="status"
        >
          {success}
        </p>
      ) : null}

      <section
        aria-label="Attendance Period Versions"
        className="overflow-hidden rounded-[5px] border border-line bg-paper"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="m-0 text-sm font-[650] text-midnight">Attendance Period Versions</h2>
            <p className="m-0 mt-1 text-xs text-muted">
              FOR_REVIEW and APPROVED snapshots stay immutable; a lock finalizes the period and
              never reopens it.
            </p>
          </div>
          {props.canSubmit ? (
            <Button
              type="button"
              disabled={
                busy || !selectedPeriodId || selectedPeriod?.status !== 'OPEN' || hasPendingVersion
              }
              onClick={() => void submitSelectedPeriod()}
            >
              Submit for review
            </Button>
          ) : null}
        </div>
        <div className="grid gap-3 px-5 py-4">
          {versions.length === 0 ? (
            <p className="m-0 text-xs text-muted">
              No Attendance Period Version exists for this period.
            </p>
          ) : (
            <ul className="m-0 grid list-none gap-3 p-0">
              {versions.map((version) => (
                <li
                  key={version.id}
                  className="rounded-[3px] border border-line px-4 py-3"
                  data-status={version.status}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      className="m-0 bg-transparent p-0 text-left text-sm font-[650] text-midnight underline-offset-4 hover:underline"
                      onClick={() =>
                        setSelectedVersionId(version.id === selectedVersionId ? '' : version.id)
                      }
                    >
                      Version {version.versionNo} · {version.status}
                      {version.predecessorVersionId ? ' · successor' : ''}
                    </button>
                    <div className="flex flex-wrap items-center gap-2">
                      {props.canReturn && version.status === 'FOR_REVIEW' ? (
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={busy}
                          onClick={() => void returnVersion(version.id)}
                        >
                          Return
                        </Button>
                      ) : null}
                      {props.canApprove && version.status === 'FOR_REVIEW' ? (
                        <Button
                          type="button"
                          disabled={busy}
                          onClick={() => void approveVersion(version.id)}
                        >
                          Approve
                        </Button>
                      ) : null}
                      {props.canLock && version.status === 'APPROVED' ? (
                        <Button
                          type="button"
                          disabled={busy}
                          onClick={() => void lockVersion(version.id)}
                        >
                          Lock
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  <p className="m-0 mt-1 text-xs text-muted">
                    {version.coveredEmployeeCount} covered Employee(s) ·{' '}
                    {version.coveredWorkDateCount} Work Date(s) · {version.dtrCount} Finalized Daily
                    Time Record(s)
                  </p>
                  {version.publication ? (
                    <p className="m-0 mt-1 text-xs text-muted">
                      {version.publication.publicationType} publication ·{' '}
                      {version.publication.factCount} fact(s) · {version.publication.factMinutes}{' '}
                      minute(s)
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {props.canReturn || props.canApprove ? (
            <Field label="Decision comments">
              <input
                className={inputClass}
                value={reason}
                onChange={(event) => setReason(eventValue(event))}
                placeholder="Return or approval basis"
              />
            </Field>
          ) : null}
        </div>
      </section>

      {detail?.reconciliation ? (
        <section
          aria-label="Attendance Period Reconciliation"
          className="overflow-hidden rounded-[5px] border border-line bg-paper"
        >
          <div className="border-b border-line px-5 py-4">
            <h2 className="m-0 text-sm font-[650] text-midnight">
              Attendance Period Reconciliation
            </h2>
            <p className="m-0 mt-1 text-xs text-muted">
              {detail.reconciliation.ok ? 'Reconciled' : 'Not reconciled'} ·{' '}
              {detail.reconciliation.population.employeeCount} Employee(s) ·{' '}
              {detail.reconciliation.population.workDateCount} Work Date(s) ·{' '}
              {detail.reconciliation.population.membershipCount} membership row(s)
            </p>
            <p className="m-0 mt-1 text-xs text-muted">
              {detail.reconciliation.payroll.factCount} payroll fact(s) ·{' '}
              {detail.reconciliation.payroll.factMinutes} published minute(s) ·{' '}
              {detail.reconciliation.payroll.expectedMinutes} expected minute(s) ·{' '}
              {detail.reconciliation.payroll.excludedOutsideScheduleMinutes} outside-schedule
              minute(s) excluded
            </p>
          </div>
          {detail.reconciliation.failures.length > 0 ? (
            <ul className="m-0 grid list-disc gap-1 px-9 py-4 text-xs text-[#8a2d2d]">
              {detail.reconciliation.failures.map((failure) => (
                <li key={failure.code}>
                  {failure.code}: {failure.message}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {publication ? (
        <section
          aria-label="Attendance Payroll Publication"
          className="overflow-hidden rounded-[5px] border border-line bg-paper"
        >
          <div className="border-b border-line px-5 py-4">
            <h2 className="m-0 text-sm font-[650] text-midnight">Attendance Payroll Publication</h2>
            <p className="m-0 mt-1 text-xs text-muted">
              {publication.publication.publicationType} · {publication.publication.factCount}{' '}
              fact(s) · {publication.publication.factMinutes} minute(s) · published{' '}
              {publication.publication.publishedAt}
            </p>
          </div>
          <ul className="m-0 grid list-none gap-1 px-5 py-4 text-xs">
            {publication.facts.map((fact) => (
              <li key={fact.id}>{factLabel(fact)}</li>
            ))}
          </ul>
          <p className="m-0 border-t border-line px-5 py-3 text-xs text-muted">
            Outside-schedule and statutory night window minutes stay outside this publication and
            remain a separate candidate-hours handoff.
          </p>
        </section>
      ) : null}
    </section>
  );
}
