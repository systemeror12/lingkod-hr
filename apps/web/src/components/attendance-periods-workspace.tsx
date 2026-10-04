'use client';

import { useEffect, useState } from 'react';
import { StateSurface } from './state-surface';
import { Button } from './ui/button';
import { Field, FormError, inputClass } from './ui/field';
import { PageHeader } from './ui/page-header';
import { Panel } from './ui/panel';
import { StatusTag, type StatusTone } from './ui/status-tag';
import { RowHeader, Table, Td, Th, Tr } from './ui/table';
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

const VERSION_TONE: Record<string, StatusTone> = {
  FOR_REVIEW: 'info',
  RETURNED: 'warning',
  APPROVED: 'success',
  LOCKED: 'neutral',
};

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

export function AttendancePeriodsWorkspace(props: AttendancePeriodsWorkspaceProps) {
  const [periods] = useState(props.initialPeriods.periods);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>(
    props.initialPeriods.periods[0]?.id ?? '',
  );
  const [versions, setVersions] = useState<AttendancePeriodVersion[] | null>(null);
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
    setVersions(null);
    void (async () => {
      try {
        await loadVersions(selectedPeriodId);
      } catch (failure: unknown) {
        if (!cancelled) {
          setVersions([]);
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

  const hasPendingVersion = (versions ?? []).some(
    (version) => version.status === 'FOR_REVIEW' || version.status === 'APPROVED',
  );
  const selectedPeriod = periods.find((period) => period.id === selectedPeriodId);

  return (
    <div className="grid min-w-0 gap-5">
      <PageHeader
        breadcrumbs={[{ label: 'Time & attendance' }]}
        title="Attendance Periods"
        actions={
          periods.length > 0 ? (
            <Field label="Attendance Period">
              <select
                aria-label="Attendance Period"
                className={inputClass + ' min-w-64'}
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
            </Field>
          ) : null
        }
      />

      {success ? (
        <p
          className="m-0 rounded-control border border-success/40 bg-success/5 px-3 py-2.5 text-small text-success"
          role="status"
        >
          {success}
        </p>
      ) : null}
      <FormError message={error} />

      <Panel
        title="Attendance Period Versions"
        flush
        actions={
          props.canSubmit ? (
            <Button
              type="button"
              variant="primary"
              disabled={
                busy || !selectedPeriodId || selectedPeriod?.status !== 'OPEN' || hasPendingVersion
              }
              onClick={() => void submitSelectedPeriod()}
            >
              Submit for review
            </Button>
          ) : null
        }
      >
        <p className="m-0 px-4 py-3 text-small text-ink-muted">
          An Attendance Period stays OPEN or FINALIZED; every review snapshot is an immutable
          version, and lock publishes stable payroll inputs. FOR_REVIEW and APPROVED snapshots stay
          immutable; a lock finalizes the period and never reopens it.
        </p>
        {periods.length === 0 ? (
          <StateSurface compact>
            <p className="m-0">No Attendance Period exists yet.</p>
          </StateSurface>
        ) : versions === null ? (
          <StateSurface busy compact>
            <p className="m-0">Loading the versions…</p>
          </StateSurface>
        ) : versions.length === 0 ? (
          <StateSurface compact>
            <p className="m-0">No Attendance Period Version exists for this period.</p>
          </StateSurface>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Version</Th>
                <Th>Status</Th>
                <Th>Coverage</Th>
                <Th>Publication</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {versions.map((version) => (
                <Tr key={version.id} selected={version.id === selectedVersionId}>
                  <RowHeader>
                    <button
                      type="button"
                      className="m-0 cursor-pointer bg-transparent p-0 text-left font-[600] text-primary underline-offset-4 hover:underline"
                      aria-pressed={version.id === selectedVersionId}
                      onClick={() =>
                        setSelectedVersionId(version.id === selectedVersionId ? '' : version.id)
                      }
                    >
                      Version {version.versionNo}
                    </button>
                    {version.predecessorVersionId ? (
                      <span className="block text-caption font-normal text-ink-muted">
                        successor
                      </span>
                    ) : null}
                  </RowHeader>
                  <Td>
                    <StatusTag tone={VERSION_TONE[version.status] ?? 'neutral'}>
                      {version.status}
                    </StatusTag>
                  </Td>
                  <Td>
                    {version.coveredEmployeeCount} covered Employee(s) ·{' '}
                    {version.coveredWorkDateCount} Work Date(s) · {version.dtrCount} Finalized Daily
                    Time Record(s)
                  </Td>
                  <Td>
                    {version.publication ? (
                      <>
                        {version.publication.publicationType} · {version.publication.factCount}{' '}
                        fact(s) · {version.publication.factMinutes} minute(s)
                      </>
                    ) : (
                      <span className="text-ink-muted">Not published</span>
                    )}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap justify-end gap-2">
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
                          variant="primary"
                          disabled={busy}
                          onClick={() => void approveVersion(version.id)}
                        >
                          Approve
                        </Button>
                      ) : null}
                      {props.canLock && version.status === 'APPROVED' ? (
                        <Button
                          type="button"
                          variant="primary"
                          disabled={busy}
                          onClick={() => void lockVersion(version.id)}
                        >
                          Lock
                        </Button>
                      ) : null}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        {props.canReturn || props.canApprove ? (
          <div className="border-t border-border px-4 py-3">
            <Field label="Decision comments">
              <input
                className={inputClass}
                value={reason}
                onChange={(event) => setReason(eventValue(event))}
                placeholder="Return or approval basis"
              />
            </Field>
          </div>
        ) : null}
      </Panel>

      {detail?.reconciliation ? (
        <Panel title="Attendance Period Reconciliation">
          <p className="m-0 flex flex-wrap items-center gap-2 text-small">
            <StatusTag tone={detail.reconciliation.ok ? 'success' : 'danger'}>
              {detail.reconciliation.ok ? 'Reconciled' : 'Not reconciled'}
            </StatusTag>
            <span>
              {detail.reconciliation.population.employeeCount} Employee(s) ·{' '}
              {detail.reconciliation.population.workDateCount} Work Date(s) ·{' '}
              {detail.reconciliation.population.membershipCount} membership row(s)
            </span>
          </p>
          <p className="m-0 mt-2 text-small text-ink-muted">
            {detail.reconciliation.payroll.factCount} payroll fact(s) ·{' '}
            {detail.reconciliation.payroll.factMinutes} published minute(s) ·{' '}
            {detail.reconciliation.payroll.expectedMinutes} expected minute(s) ·{' '}
            {detail.reconciliation.payroll.excludedOutsideScheduleMinutes} outside-schedule
            minute(s) excluded
          </p>
          {detail.reconciliation.failures.length > 0 ? (
            <ul className="m-0 mt-3 grid list-disc gap-1 pl-5 text-small text-danger">
              {detail.reconciliation.failures.map((failure) => (
                <li key={failure.code}>
                  {failure.code}: {failure.message}
                </li>
              ))}
            </ul>
          ) : null}
        </Panel>
      ) : null}

      {publication ? (
        <Panel title="Attendance Payroll Publication" flush>
          <p className="m-0 px-4 py-3 text-small text-ink-muted">
            {publication.publication.publicationType} · {publication.publication.factCount} fact(s)
            · {publication.publication.factMinutes} minute(s) · published{' '}
            {publication.publication.publishedAt}
          </p>
          <Table>
            <thead>
              <tr>
                <Th>Work date</Th>
                <Th>Fact type</Th>
                <Th>Holiday</Th>
                <Th kind="numeric">Minutes</Th>
                <Th kind="numeric">Prior</Th>
                <Th>Difference</Th>
              </tr>
            </thead>
            <tbody>
              {publication.facts.map((fact) => (
                <Tr key={fact.id}>
                  <RowHeader>{fact.workDate}</RowHeader>
                  <Td>{fact.factType}</Td>
                  <Td>{fact.holidayClassification ?? '—'}</Td>
                  <Td kind="numeric">{fact.correctedMinutes}</Td>
                  <Td kind="numeric">{fact.priorMinutes ?? '—'}</Td>
                  <Td>
                    {fact.differenceDirection && fact.differenceMinutes !== null
                      ? `${fact.differenceDirection} ${fact.differenceMinutes}`
                      : '—'}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <p className="m-0 border-t border-border px-4 py-3 text-small text-ink-muted">
            Outside-schedule and statutory night window minutes stay outside this publication and
            remain a separate candidate-hours handoff.
          </p>
        </Panel>
      ) : null}
    </div>
  );
}
