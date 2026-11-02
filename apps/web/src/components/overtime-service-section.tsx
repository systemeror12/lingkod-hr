'use client';

import { Fragment, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { dateLabel, hoursLabel } from '../lib/overtime-format';
import { StateSurface } from './state-surface';
import { Button } from './ui/button';
import { Field, inputClass } from './ui/field';
import { StatusTag, type StatusDisplay } from './ui/status-tag';
import { RowHeader, Table, Td, Th, Tr } from './ui/table';

export type OvertimeServiceStatus =
  'RENDERED' | 'FOR_CERTIFICATION' | 'CERTIFIED' | 'NOT_CERTIFIED';

/** One Overtime Service Record as the API's service read returns it. */
export interface OvertimeServiceRecord {
  id: string;
  employeeId: string;
  workDate: string;
  claimedHours: string;
  accomplishment: string;
  actualMinutes: number | null;
  certifiedMinutes: number | null;
  declineReason: string | null;
  status: OvertimeServiceStatus;
  /**
   * Set on a RENDERED record that can't be submitted yet, with the refusal submission would give:
   * no locked Attendance on its Work Date, or a locked Attendance Day that is ambiguous or
   * unresolved.
   */
  submitBlockedReason: string | null;
}

export interface OvertimeServiceEmployee {
  overtimeAuthorityEmployeeId: string;
  employeeId: string;
  employeeNumber: string;
  employeeName: string;
  authorizedHours: string;
  certifiedMinutes: number;
  remainingMinutes: string;
  records: OvertimeServiceRecord[];
}

interface OvertimeServiceRegister {
  overtimeAuthorityId: string;
  employees: OvertimeServiceEmployee[];
}

const STATUS_DISPLAY: Record<OvertimeServiceStatus, StatusDisplay> = {
  RENDERED: { label: 'Rendered', tone: 'neutral' },
  FOR_CERTIFICATION: { label: 'For certification', tone: 'warning' },
  CERTIFIED: { label: 'Certified', tone: 'success' },
  NOT_CERTIFIED: { label: 'Not certified', tone: 'danger' },
};

type OpenForm =
  { kind: 'record'; employeeId: string } | { kind: 'certify' | 'decline'; recordId: string } | null;

const successClass =
  'm-0 rounded-control border border-success/40 bg-success/5 px-3 py-2.5 text-small text-success';
const errorClass =
  'm-0 rounded-control border border-danger/40 bg-danger/5 px-3 py-2.5 text-small text-danger';

function valueOf(event: { currentTarget: EventTarget }): string {
  return (event.currentTarget as unknown as { value: string }).value;
}

function messageOf(failure: unknown, fallback: string): string {
  return failure instanceof Error ? failure.message : fallback;
}

/**
 * The authority Form's Service tab: one row per covered Employee and Work Date, grouped by
 * Employee with the API's authorized, certified, and remaining totals. Claimed hours, actual
 * minutes from locked Attendance, and certified minutes are separate columns, each shown as the
 * API returns it. Recording, submitting, certifying, and declining are row actions; the API
 * decides every one, and a refusal shows its reason.
 */
export function OvertimeServiceSection({
  authority,
  request,
  disabled,
  canRecord,
  canSubmit,
  canCertify,
  canDecline,
}: {
  authority: { id: string; status: string; workDateFrom: string; workDateTo: string };
  request: (path: string, init?: RequestInit) => Promise<unknown>;
  /** The authority is stale; nothing runs until it is reloaded. */
  disabled: boolean;
  canRecord: boolean;
  canSubmit: boolean;
  canCertify: boolean;
  canDecline: boolean;
}) {
  const [loaded, setLoaded] = useState<{
    id: string;
    register: OvertimeServiceRegister | null;
    error: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [open, setOpen] = useState<OpenForm>(null);
  const path = '/overtime-authorities/' + encodeURIComponent(authority.id) + '/service-records';

  useEffect(() => {
    let active = true;
    setNotice(null);
    setOpen(null);
    void request(path)
      .then((value) => {
        if (active)
          setLoaded({ id: authority.id, register: value as OvertimeServiceRegister, error: '' });
      })
      .catch((failure: unknown) => {
        if (active)
          setLoaded({
            id: authority.id,
            register: null,
            error: messageOf(failure, 'The overtime service failed to load.'),
          });
      });
    return () => {
      active = false;
    };
    // `request` is recreated each render; the authority alone decides what loads.
  }, [authority.id]);

  const current = loaded?.id === authority.id ? loaded : null;
  const register = current?.register ?? null;

  /**
   * Run one command once: a second click while it is in flight does nothing. The register reloads
   * whatever the API answered, since a refusal often means the record moved on since it was read.
   */
  async function run(commandPath: string, body: unknown, message: string): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    const id = authority.id;
    let outcome: { kind: 'success' | 'error'; message: string };
    try {
      await request(commandPath, { method: 'POST', body: JSON.stringify(body ?? {}) });
      setOpen(null);
      outcome = { kind: 'success', message };
    } catch (failure: unknown) {
      outcome = {
        kind: 'error',
        message: messageOf(failure, 'The overtime service action failed.'),
      };
    }
    try {
      const refreshed = (await request(path)) as OvertimeServiceRegister;
      setLoaded((held) => (held?.id === id ? { id, register: refreshed, error: '' } : held));
    } catch {
      outcome = {
        kind: 'error',
        message: `${outcome.message} The service list could not refresh.`,
      };
    } finally {
      setNotice(outcome);
      busyRef.current = false;
      setBusy(false);
    }
  }

  if (current === null) {
    return (
      <StateSurface busy compact label="Loading overtime service">
        <p className="m-0" role="status">
          Loading the overtime service…
        </p>
      </StateSurface>
    );
  }
  if (!register) {
    return (
      <StateSurface compact label="Overtime service unavailable">
        <p className="m-0" role="alert">
          {current.error}
        </p>
      </StateSurface>
    );
  }

  const locked = busy || disabled;
  const recordable = authority.status === 'APPROVED' && canRecord;
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
      {authority.status !== 'APPROVED' ? (
        <p className="m-0 text-small text-ink-muted">
          Service is recorded only under an approved authority.
        </p>
      ) : null}
      {register.employees.map((employee) => (
        <section
          key={employee.overtimeAuthorityEmployeeId}
          className="grid gap-2"
          aria-label={`Service of ${employee.employeeName}`}
        >
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="m-0 text-panel-title text-ink">{employee.employeeName}</h3>
              <p className="m-0 text-caption text-ink-muted">{employee.employeeNumber}</p>
            </div>
            <dl className="m-0 flex flex-wrap gap-x-5 gap-y-1 text-small">
              <div>
                <dt className="text-caption text-ink-muted">Authorized hours</dt>
                <dd className="m-0 text-ink">{hoursLabel(employee.authorizedHours)}</dd>
              </div>
              <div>
                <dt className="text-caption text-ink-muted">Certified minutes</dt>
                <dd className="m-0 text-ink">{employee.certifiedMinutes}</dd>
              </div>
              <div>
                <dt className="text-caption text-ink-muted">Remaining minutes</dt>
                <dd className="m-0 text-ink">{employee.remainingMinutes}</dd>
              </div>
            </dl>
          </header>
          {employee.records.length === 0 ? (
            <p className="m-0 text-small text-ink-muted">No service recorded.</p>
          ) : (
            <div className="overflow-x-auto rounded-panel border border-border">
              <Table className="min-w-[880px]">
                <thead>
                  <tr>
                    <Th>Work Date</Th>
                    <Th>Status</Th>
                    <Th>Claimed hours</Th>
                    <Th>Actual minutes (locked Attendance)</Th>
                    <Th>Certified minutes</Th>
                    <Th>Accomplishment</Th>
                    <Th>Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {employee.records.map((record) => (
                    <Fragment key={record.id}>
                      <ServiceRow
                        record={record}
                        locked={locked}
                        canSubmit={canSubmit}
                        canCertify={canCertify}
                        canDecline={canDecline}
                        open={open}
                        onOpen={(next) => {
                          setNotice(null);
                          setOpen(next);
                        }}
                        onSubmit={() =>
                          void run(
                            `/overtime-service-records/${record.id}/submit`,
                            undefined,
                            `The service on ${dateLabel(record.workDate)} was submitted for certification.`,
                          )
                        }
                      />
                      {open?.kind === 'certify' &&
                      open.recordId === record.id &&
                      record.status === 'FOR_CERTIFICATION' ? (
                        <FormRow>
                          <CertifyForm
                            record={record}
                            busy={locked}
                            onCancel={() => setOpen(null)}
                            onCertify={(certifiedMinutes) =>
                              void run(
                                `/overtime-service-records/${record.id}/certify`,
                                { certifiedMinutes },
                                `The service on ${dateLabel(record.workDate)} was certified.`,
                              )
                            }
                          />
                        </FormRow>
                      ) : null}
                      {open?.kind === 'decline' &&
                      open.recordId === record.id &&
                      record.status === 'FOR_CERTIFICATION' ? (
                        <FormRow>
                          <DeclineForm
                            record={record}
                            busy={locked}
                            onCancel={() => setOpen(null)}
                            onDecline={(declineReason) =>
                              void run(
                                `/overtime-service-records/${record.id}/decline`,
                                { declineReason },
                                `Certification of the service on ${dateLabel(record.workDate)} was declined.`,
                              )
                            }
                          />
                        </FormRow>
                      ) : null}
                    </Fragment>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
          {recordable ? (
            open?.kind === 'record' && open.employeeId === employee.employeeId ? (
              <RecordForm
                employee={employee}
                authority={authority}
                busy={locked}
                onCancel={() => setOpen(null)}
                onRecord={(body) =>
                  void run(
                    '/overtime-service-records',
                    { overtimeAuthorityId: authority.id, employeeId: employee.employeeId, ...body },
                    `Service on ${dateLabel(body.workDate)} was recorded for ${employee.employeeName}.`,
                  )
                }
              />
            ) : (
              <div>
                <Button
                  variant="secondary"
                  disabled={locked}
                  onClick={() => {
                    setNotice(null);
                    setOpen({ kind: 'record', employeeId: employee.employeeId });
                  }}
                >
                  Record service for {employee.employeeName}
                </Button>
              </div>
            )
          ) : null}
        </section>
      ))}
    </div>
  );
}

function ServiceRow({
  record,
  locked,
  canSubmit,
  canCertify,
  canDecline,
  open,
  onOpen,
  onSubmit,
}: {
  record: OvertimeServiceRecord;
  locked: boolean;
  canSubmit: boolean;
  canCertify: boolean;
  canDecline: boolean;
  open: OpenForm;
  onOpen: (next: OpenForm) => void;
  onSubmit: () => void;
}) {
  const display = STATUS_DISPLAY[record.status];
  const formOpen = open !== null && open.kind !== 'record' && open.recordId === record.id;
  const date = dateLabel(record.workDate);
  return (
    <Tr>
      <RowHeader>{date}</RowHeader>
      <Td>
        <StatusTag tone={display.tone}>{display.label}</StatusTag>
      </Td>
      <Td>{hoursLabel(record.claimedHours)}</Td>
      <Td>
        {record.actualMinutes ?? (
          <span className="text-ink-muted">
            {record.status === 'RENDERED' ? 'Read on submission' : '—'}
          </span>
        )}
      </Td>
      <Td>{record.certifiedMinutes ?? <span className="text-ink-muted">—</span>}</Td>
      <Td>
        <span className="whitespace-pre-line">{record.accomplishment}</span>
        {record.declineReason ? (
          <span className="block text-caption text-danger">Declined: {record.declineReason}</span>
        ) : null}
        {record.submitBlockedReason ? (
          <span className="block text-caption text-warning">
            Can’t submit: {record.submitBlockedReason}
          </span>
        ) : null}
      </Td>
      <Td>
        <div className="flex flex-wrap gap-2">
          {record.status === 'RENDERED' && canSubmit ? (
            <Button
              variant="primary"
              disabled={locked || record.submitBlockedReason !== null}
              aria-label={`Submit service on ${date} for certification`}
              onClick={onSubmit}
            >
              Submit
            </Button>
          ) : null}
          {record.status === 'FOR_CERTIFICATION' && canCertify ? (
            <Button
              variant="primary"
              disabled={locked || formOpen}
              aria-label={`Certify service on ${date}`}
              onClick={() => onOpen({ kind: 'certify', recordId: record.id })}
            >
              Certify
            </Button>
          ) : null}
          {record.status === 'FOR_CERTIFICATION' && canDecline ? (
            <Button
              variant="secondary"
              disabled={locked || formOpen}
              aria-label={`Decline service on ${date}`}
              onClick={() => onOpen({ kind: 'decline', recordId: record.id })}
            >
              Decline
            </Button>
          ) : null}
        </div>
      </Td>
    </Tr>
  );
}

function FormRow({ children }: { children: ReactNode }) {
  return (
    <tr>
      <td colSpan={7} className="border-t border-border bg-canvas px-3 py-3">
        {children}
      </td>
    </tr>
  );
}

function RecordForm({
  employee,
  authority,
  busy,
  onCancel,
  onRecord,
}: {
  employee: OvertimeServiceEmployee;
  authority: { workDateFrom: string; workDateTo: string };
  busy: boolean;
  onCancel: () => void;
  onRecord: (body: { workDate: string; claimedHours: string; accomplishment: string }) => void;
}) {
  const [workDate, setWorkDate] = useState('');
  const [claimedHours, setClaimedHours] = useState('');
  const [accomplishment, setAccomplishment] = useState('');
  const complete = workDate !== '' && claimedHours.trim() !== '' && accomplishment.trim() !== '';
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!complete) return;
    onRecord({
      workDate,
      claimedHours: claimedHours.trim(),
      accomplishment: accomplishment.trim(),
    });
  }
  return (
    <form
      className="grid gap-3 rounded-panel border border-border p-3 md:grid-cols-3"
      aria-label={`Record service for ${employee.employeeName}`}
      onSubmit={submit}
    >
      <Field label="Work Date">
        <input
          type="date"
          className={inputClass}
          min={authority.workDateFrom}
          max={authority.workDateTo}
          value={workDate}
          onChange={(event) => setWorkDate(valueOf(event))}
        />
      </Field>
      <Field label="Claimed hours">
        <input
          className={inputClass}
          inputMode="decimal"
          value={claimedHours}
          onChange={(event) => setClaimedHours(valueOf(event))}
        />
      </Field>
      <Field label="Accomplishment">
        <textarea
          className={inputClass + ' py-2'}
          rows={2}
          value={accomplishment}
          onChange={(event) => setAccomplishment(valueOf(event))}
        />
      </Field>
      <div className="flex flex-wrap gap-2 md:col-span-3">
        <Button type="submit" variant="primary" disabled={busy || !complete}>
          Record service
        </Button>
        <Button type="button" variant="quiet" disabled={busy} onClick={onCancel}>
          Discard
        </Button>
      </div>
    </form>
  );
}

function CertifyForm({
  record,
  busy,
  onCancel,
  onCertify,
}: {
  record: OvertimeServiceRecord;
  busy: boolean;
  onCancel: () => void;
  onCertify: (certifiedMinutes: number) => void;
}) {
  const [minutes, setMinutes] = useState('');
  const value = Number(minutes);
  const valid = /^\d+$/.test(minutes.trim()) && value > 0;
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (valid) onCertify(value);
  }
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      aria-label={`Certify service on ${dateLabel(record.workDate)}`}
      onSubmit={submit}
    >
      <Field label="Certified minutes, net of breaks">
        <input
          className={inputClass}
          inputMode="numeric"
          value={minutes}
          onChange={(event) => setMinutes(valueOf(event))}
        />
      </Field>
      <p className="m-0 self-center text-caption text-ink-muted">
        Actual minutes from locked Attendance: {record.actualMinutes ?? '—'}
      </p>
      <Button type="submit" variant="primary" disabled={busy || !valid}>
        Certify service
      </Button>
      <Button type="button" variant="quiet" disabled={busy} onClick={onCancel}>
        Discard
      </Button>
    </form>
  );
}

function DeclineForm({
  record,
  busy,
  onCancel,
  onDecline,
}: {
  record: OvertimeServiceRecord;
  busy: boolean;
  onCancel: () => void;
  onDecline: (declineReason: string) => void;
}) {
  const [reason, setReason] = useState('');
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (reason.trim() !== '') onDecline(reason.trim());
  }
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      aria-label={`Decline service on ${dateLabel(record.workDate)}`}
      onSubmit={submit}
    >
      <div className="min-w-[280px] flex-1">
        <Field label="Decline reason">
          <textarea
            className={inputClass + ' py-2'}
            rows={2}
            value={reason}
            onChange={(event) => setReason(valueOf(event))}
          />
        </Field>
      </div>
      <Button type="submit" variant="secondary" disabled={busy || reason.trim() === ''}>
        Decline certification
      </Button>
      <Button type="button" variant="quiet" disabled={busy} onClick={onCancel}>
        Discard
      </Button>
    </form>
  );
}
