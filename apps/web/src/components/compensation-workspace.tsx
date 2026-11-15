'use client';

import Link from 'next/link';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  basisStatusDisplay,
  monthRange,
  payBasisLabel,
  type CompensationBasis,
  type CompensationBasisStretch,
} from '../lib/compensation-basis';
import { manilaToday } from '../lib/manila-date';
import { dateLabel } from '../lib/overtime-format';
import type { EmployeeOption } from '../lib/payroll-page-data';
import { decimalLabel } from '../lib/payroll-inputs';
import { Facts } from './payroll-inputs-workspace';
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
import { PageHeader, type Breadcrumb } from './ui/page-header';
import { Panel } from './ui/panel';
import { StatusTag } from './ui/status-tag';
import { Table, Td, Th, Tr } from './ui/table';

function targetValue(event: { currentTarget: EventTarget }): string {
  return (event.currentTarget as unknown as { value: string }).value;
}

/**
 * Compensation: an Employee's compensation basis over a date range, as Payroll resolves it from
 * Personnel's salary facts and the salary schedule in effect. Each stretch names its sources; an
 * indeterminate one lists its reasons. Nothing here is edited: grade, step, and pay basis come
 * from Personnel, and rates from Salary Rules.
 */
export function CompensationWorkspace({
  agencyId,
  employees,
}: {
  agencyId: string;
  employees: EmployeeOption[];
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [range, setRange] = useState(() => monthRange(manilaToday()));
  const [basis, setBasis] = useState<CompensationBasis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Only the latest request may show its answer, so a slow earlier one never mislabels the panel.
  const latest = useRef(0);
  const open = employees.find(({ id }) => id === openId);

  async function load(employeeId: string, next: { from: string; to: string }): Promise<void> {
    const request = ++latest.current;
    setLoading(true);
    setError('');
    setBasis(null);
    try {
      const query = new URLSearchParams(next);
      const response = await fetch(
        `/api/v1/agencies/${agencyId}/employees/${encodeURIComponent(employeeId)}/compensation-basis?${query}`,
        { credentials: 'include' },
      );
      const value = (await response.json().catch(() => null)) as
        (CompensationBasis & { error?: { message?: string } }) | null;
      if (!response.ok || !Array.isArray(value?.stretches)) {
        throw new Error(value?.error?.message ?? 'The compensation basis could not be loaded.');
      }
      if (request === latest.current) setBasis(value);
    } catch (caught: unknown) {
      if (request !== latest.current) return;
      setError(
        caught instanceof Error ? caught.message : 'The compensation basis could not be loaded.',
      );
    } finally {
      if (request === latest.current) setLoading(false);
    }
  }

  function openEmployee(id: string): void {
    setOpenId(id);
    void load(id, range);
  }

  function show(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (open) void load(open.id, range);
  }

  const breadcrumbs: Breadcrumb[] = [{ label: 'Payroll' }, { label: 'Compensation' }];
  if (open) breadcrumbs.push({ label: open.legalName });

  return (
    <Dialog
      presentation="form"
      open={open !== undefined}
      onOpenChange={(next) => !next && setOpenId(null)}
    >
      <div className="grid gap-5">
        <PageHeader breadcrumbs={breadcrumbs} title="Compensation" />

        <div hidden={open !== undefined} className="grid min-w-0 gap-5">
          <p className="m-0 max-w-[760px] text-small text-ink-muted">
            An Employee’s compensation basis matches Personnel’s salary grade, step, and pay basis
            to the salary schedule in effect on each date. A basis that is indeterminate blocks
            payroll until its reasons are resolved at their source.
          </p>

          <Panel
            title="Employees"
            flush
            actions={
              <span className="text-caption text-ink-muted">
                {employees.length === 1 ? '1 Employee' : `${employees.length} Employees`}
              </span>
            }
          >
            {employees.length === 0 ? (
              <StateSurface compact label="Employees">
                <strong className="text-body font-[650] text-ink">No Employees to list.</strong>
                <p className="m-0 max-w-[560px]">
                  Listing Employees needs permission to read them in this Agency.
                </p>
              </StateSurface>
            ) : (
              <Table className="min-w-[560px]">
                <thead>
                  <tr>
                    <Th>Employee</Th>
                    <Th>Employee number</Th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map((employee) => (
                    <Tr key={employee.id} selected={openId === employee.id}>
                      <Td>
                        <DialogTrigger asChild>
                          <button
                            className="w-fit cursor-pointer border-0 bg-transparent p-0 text-left font-[600] text-primary hover:underline"
                            onClick={() => openEmployee(employee.id)}
                            type="button"
                          >
                            {employee.legalName}
                          </button>
                        </DialogTrigger>
                      </Td>
                      <Td>{employee.employeeNumber}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>
        </div>

        <DialogContent aria-describedby="compensation-description" aria-busy={loading}>
          {open ? (
            <>
              <DialogHeader>
                <div className="grid min-w-0 gap-1.5">
                  <DialogTitle>{open.legalName}</DialogTitle>
                  <DialogDescription id="compensation-description">
                    {open.employeeNumber} · Compensation basis. Read-only.
                  </DialogDescription>
                </div>
                {basis && !loading ? (
                  <StatusTag tone={basisStatusDisplay[basis.status].tone}>
                    {basisStatusDisplay[basis.status].label}
                  </StatusTag>
                ) : null}
              </DialogHeader>
              <DialogBody className="grid gap-6">
                <form className="flex flex-wrap items-end gap-4" onSubmit={show}>
                  <Field htmlFor="compensation-from" label="From">
                    <input
                      className={inputClass}
                      id="compensation-from"
                      type="date"
                      value={range.from}
                      onChange={(event) => {
                        const from = targetValue(event);
                        setRange((current) => ({ ...current, from }));
                      }}
                    />
                  </Field>
                  <Field htmlFor="compensation-to" label="To">
                    <input
                      className={inputClass}
                      id="compensation-to"
                      type="date"
                      value={range.to}
                      onChange={(event) => {
                        const to = targetValue(event);
                        setRange((current) => ({ ...current, to }));
                      }}
                    />
                  </Field>
                  <Button disabled={loading} type="submit" variant="primary">
                    {loading ? 'Loading…' : 'Show basis'}
                  </Button>
                </form>
                <FormError message={error} />
                {loading ? (
                  <p className="m-0 text-small text-ink-muted" role="status">
                    Loading the compensation basis…
                  </p>
                ) : null}
                {basis && !loading ? (
                  <div className="grid gap-4">
                    <p className="m-0 text-small text-ink-muted">
                      {dateLabel(basis.from)} to {dateLabel(basis.to)}:{' '}
                      {basis.stretches.length === 1
                        ? '1 stretch'
                        : `${basis.stretches.length} stretches`}
                      .
                    </p>
                    {basis.stretches.map((stretch) => (
                      <Stretch key={stretch.from} stretch={stretch} />
                    ))}
                  </div>
                ) : null}
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="secondary">
                    Close
                  </Button>
                </DialogClose>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </div>
    </Dialog>
  );
}

function Stretch({ stretch }: { stretch: CompensationBasisStretch }) {
  const title = `${dateLabel(stretch.from)} to ${dateLabel(stretch.to)}`;
  const display = basisStatusDisplay[stretch.status];
  const { personnel, salarySchedule } = stretch;
  return (
    <Panel title={title} actions={<StatusTag tone={display.tone}>{display.label}</StatusTag>}>
      <div className="grid gap-5">
        <Source title="Personnel Service Segment">
          {personnel ? (
            <Facts
              facts={[
                ['Salary Grade', personnel.salaryGrade ?? 'Not recorded'],
                ['Step', personnel.salaryStep ?? 'Not recorded'],
                [
                  'Pay basis',
                  personnel.payBasis === null
                    ? 'Not recorded'
                    : (payBasisLabel[personnel.payBasis] ?? personnel.payBasis),
                ],
                [
                  'Employment fraction',
                  personnel.employmentFraction === null
                    ? 'Not recorded'
                    : decimalLabel(personnel.employmentFraction),
                ],
                [
                  'Service Segment',
                  <span key="segment" className="font-mono text-small break-all">
                    {personnel.serviceSegmentId}
                  </span>,
                ],
              ]}
            />
          ) : (
            <p className="m-0 text-small text-ink-muted">No Service Segment covers these dates.</p>
          )}
        </Source>
        <Source title="Salary schedule">
          {salarySchedule ? (
            <Facts
              facts={[
                [
                  'Rule version',
                  <Link
                    key="version"
                    className="font-[600] text-primary"
                    href={`/salary-rules?version=${encodeURIComponent(salarySchedule.ruleVersionId)}`}
                  >
                    {salarySchedule.ruleVersionCode}
                  </Link>,
                ],
                [
                  'Monthly rate',
                  salarySchedule.monthlyRate === null
                    ? 'No rate for this grade and step'
                    : decimalLabel(salarySchedule.monthlyRate),
                ],
              ]}
            />
          ) : (
            <p className="m-0 text-small text-ink-muted">No schedule rate was looked up.</p>
          )}
        </Source>
        {stretch.status === 'RESOLVED' ? (
          <Source title="Derived rate">
            <Facts
              facts={[
                [
                  'Monthly rate',
                  stretch.rate.monthlyRate === null
                    ? 'Paid by the day'
                    : decimalLabel(stretch.rate.monthlyRate),
                ],
                ['Daily rate', decimalLabel(stretch.rate.dailyRate)],
                ['Derivation', stretch.rate.derivation],
              ]}
            />
          </Source>
        ) : (
          <Source title="Why it is indeterminate">
            <ul className="m-0 grid gap-1 pl-5 text-body text-ink">
              {stretch.reasons.map((reason) => (
                <li key={reason.code}>
                  {reason.message}{' '}
                  <span className="font-mono text-caption text-ink-muted">{reason.code}</span>
                </li>
              ))}
            </ul>
          </Source>
        )}
      </div>
    </Panel>
  );
}

function Source({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-3" aria-label={title}>
      <h3 className="m-0 text-small font-[650] text-ink">{title}</h3>
      {children}
    </section>
  );
}
