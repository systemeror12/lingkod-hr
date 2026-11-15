'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import type { EmployeeOption } from '../lib/payroll-page-data';
import {
  decimalLabel,
  payrollInputKindLabel,
  payrollInputStatusDisplay,
  sourceModuleLabel,
  sourceRecord,
  type PayrollInputSourceModule,
  type PayrollInputStatus,
} from '../lib/payroll-inputs';
import { dateLabel } from '../lib/overtime-format';
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
import { FormError, inputClass, labelClass } from './ui/field';
import { PageHeader, type Breadcrumb } from './ui/page-header';
import { Panel } from './ui/panel';
import { StatusTag } from './ui/status-tag';
import { Table, Td, Th, Tr } from './ui/table';

/** One Payroll Input as `GET /payroll-inputs` returns it. */
export interface PayrollInput {
  id: string;
  employeeId: string;
  sourceModule: PayrollInputSourceModule;
  inputKind: string;
  sourceKey: string;
  sourceType: string;
  sourceId: string;
  effectiveDate: string;
  quantity: string | null;
  amount: string | null;
  status: PayrollInputStatus;
  acceptedAt: string;
  consumedByPayrollPeriodId: string | null;
  replacesPayrollInputId: string | null;
}

/** The API returns at most this many inputs, newest first. */
const LIST_LIMIT = 200;

function targetValue(event: { currentTarget: EventTarget }): string {
  return (event.currentTarget as unknown as { value: string }).value;
}

/**
 * The Payroll-owned inbox of Payroll Inputs: every input a source module posted, by source and
 * status. Rows are read-only; each opens to the source record it came from.
 */
export function PayrollInputsWorkspace({
  agencyId,
  employees,
  initialInputs,
}: {
  agencyId: string;
  employees: EmployeeOption[];
  initialInputs: PayrollInput[];
}) {
  const [inputs, setInputs] = useState(initialInputs);
  const [sourceModule, setSourceModule] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<PayrollInput | null>(null);
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));

  function employeeLabel(employeeId: string): ReactNode {
    const employee = employeeById.get(employeeId);
    if (!employee) return <span className="font-mono text-caption">{employeeId}</span>;
    return (
      <>
        {employee.legalName}
        <span className="block text-caption font-normal text-ink-muted">
          {employee.employeeNumber}
        </span>
      </>
    );
  }

  async function filter(next: { sourceModule: string; status: string }): Promise<void> {
    setSourceModule(next.sourceModule);
    setStatus(next.status);
    setLoading(true);
    setError('');
    const query = new URLSearchParams();
    if (next.sourceModule) query.set('sourceModule', next.sourceModule);
    if (next.status) query.set('status', next.status);
    try {
      const response = await fetch(
        `/api/v1/agencies/${agencyId}/payroll-inputs${query.size ? `?${query}` : ''}`,
        { credentials: 'include' },
      );
      const value = (await response.json().catch(() => null)) as {
        inputs?: PayrollInput[];
        error?: { message?: string };
      } | null;
      if (!response.ok || !Array.isArray(value?.inputs)) {
        throw new Error(value?.error?.message ?? 'Payroll Inputs could not be loaded.');
      }
      setInputs(value.inputs);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Payroll Inputs could not be loaded.');
    } finally {
      setLoading(false);
    }
  }

  const breadcrumbs: Breadcrumb[] = [{ label: 'Payroll' }, { label: 'Payroll Inputs' }];
  if (open) breadcrumbs.push({ label: payrollInputKindLabel[open.inputKind] ?? open.inputKind });

  const source = open ? sourceRecord(open.sourceType) : null;
  const filtersActive = sourceModule !== '' || status !== '';

  return (
    <Dialog
      presentation="form"
      open={open !== null}
      onOpenChange={(next) => !next && setOpen(null)}
    >
      <div className="grid gap-5">
        <PageHeader breadcrumbs={breadcrumbs} title="Payroll Inputs" />

        <div hidden={open !== null} className="grid min-w-0 gap-5">
          <p className="m-0 max-w-[760px] text-small text-ink-muted">
            Leave and Overtime post each approved effect here as a quantity with its source record.
            Payroll reads these inputs; it does not change them. A pending input has not been used
            by any payroll yet.
          </p>

          <div className="flex flex-wrap gap-4">
            <label className={labelClass} htmlFor="payroll-input-source">
              Source
              <select
                className={inputClass}
                id="payroll-input-source"
                value={sourceModule}
                onChange={(event) => void filter({ sourceModule: targetValue(event), status })}
              >
                <option value="">All sources</option>
                {Object.entries(sourceModuleLabel).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass} htmlFor="payroll-input-status">
              Status
              <select
                className={inputClass}
                id="payroll-input-status"
                value={status}
                onChange={(event) => void filter({ sourceModule, status: targetValue(event) })}
              >
                <option value="">All statuses</option>
                {Object.entries(payrollInputStatusDisplay).map(([value, { label }]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <FormError message={error} />

          <Panel
            title="Payroll Inputs"
            flush
            aria-busy={loading}
            actions={
              <span className="text-caption text-ink-muted" role="status">
                {loading
                  ? 'Loading…'
                  : `${inputs.length === 1 ? '1 input' : `${inputs.length} inputs`}${
                      inputs.length >= LIST_LIMIT ? `, newest ${LIST_LIMIT} shown` : ''
                    }`}
              </span>
            }
          >
            {inputs.length === 0 ? (
              <StateSurface compact label="Payroll Inputs">
                <strong className="text-body font-[650] text-ink">
                  {filtersActive
                    ? 'No Payroll Inputs match these filters.'
                    : 'No Payroll Inputs yet.'}
                </strong>
                <p className="m-0 max-w-[560px]">
                  Inputs appear when Leave posts leave without pay or a deficit charge, or Overtime
                  certifies overtime service.
                </p>
              </StateSurface>
            ) : (
              <Table className="min-w-[880px]">
                <thead>
                  <tr>
                    <Th>Employee</Th>
                    <Th>Input</Th>
                    <Th>Source record</Th>
                    <Th kind="date">Effective</Th>
                    <Th kind="numeric">Quantity</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {inputs.map((input) => {
                    const display = payrollInputStatusDisplay[input.status];
                    return (
                      <Tr key={input.id}>
                        <Td>{employeeLabel(input.employeeId)}</Td>
                        <Td>
                          <DialogTrigger asChild>
                            <button
                              className="w-fit cursor-pointer border-0 bg-transparent p-0 text-left font-[600] text-primary hover:underline"
                              onClick={() => setOpen(input)}
                              type="button"
                            >
                              {payrollInputKindLabel[input.inputKind] ?? input.inputKind}
                            </button>
                          </DialogTrigger>
                          <span className="block text-caption text-ink-muted">
                            {sourceModuleLabel[input.sourceModule]}
                          </span>
                        </Td>
                        <Td>{sourceRecord(input.sourceType).label}</Td>
                        <Td kind="date">{dateLabel(input.effectiveDate)}</Td>
                        <Td kind="numeric">
                          {input.quantity === null ? '—' : decimalLabel(input.quantity)}
                        </Td>
                        <Td>
                          <StatusTag tone={display.tone}>{display.label}</StatusTag>
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Panel>
        </div>

        <DialogContent aria-describedby="payroll-input-description">
          {open && source ? (
            <>
              <DialogHeader>
                <div className="grid min-w-0 gap-1.5">
                  <DialogTitle>
                    {payrollInputKindLabel[open.inputKind] ?? open.inputKind}
                  </DialogTitle>
                  <DialogDescription id="payroll-input-description">
                    Posted by {sourceModuleLabel[open.sourceModule]} from {source.label}. Read-only.
                  </DialogDescription>
                </div>
                <StatusTag tone={payrollInputStatusDisplay[open.status].tone}>
                  {payrollInputStatusDisplay[open.status].label}
                </StatusTag>
              </DialogHeader>
              <DialogBody className="grid gap-6">
                <Facts
                  facts={[
                    ['Employee', employeeLabel(open.employeeId)],
                    ['Effective date', dateLabel(open.effectiveDate)],
                    ['Quantity', open.quantity === null ? '—' : decimalLabel(open.quantity)],
                    ['Amount', open.amount === null ? '—' : decimalLabel(open.amount)],
                    ['Accepted', dateLabel(open.acceptedAt)],
                    [
                      'Consumed by payroll',
                      open.consumedByPayrollPeriodId ? (
                        <Mono>{open.consumedByPayrollPeriodId}</Mono>
                      ) : (
                        'Not used by a payroll yet'
                      ),
                    ],
                    [
                      'Replaces input',
                      open.replacesPayrollInputId ? (
                        <Mono>{open.replacesPayrollInputId}</Mono>
                      ) : (
                        '—'
                      ),
                    ],
                  ]}
                />
                <section className="grid gap-3" aria-labelledby="payroll-input-source-title">
                  <h3 className="m-0 text-panel-title text-ink" id="payroll-input-source-title">
                    Source record
                  </h3>
                  <Facts
                    facts={[
                      ['Record', source.label],
                      ['Record id', <Mono key="id">{open.sourceId}</Mono>],
                      ['Source key', <Mono key="key">{open.sourceKey}</Mono>],
                    ]}
                  />
                  {source.workspace ? (
                    <Link
                      className="w-fit text-small font-[600] text-primary"
                      href={source.workspace.href}
                    >
                      Open {source.workspace.label}
                    </Link>
                  ) : null}
                </section>
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button size="default" type="button" variant="secondary">
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

function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-small break-all">{children}</span>;
}

/** A read-only field grid of label and value pairs. */
export function Facts({ facts }: { facts: [string, ReactNode][] }) {
  return (
    <dl className="m-0 grid gap-x-10 gap-y-4 min-[621px]:grid-cols-2 min-[900px]:grid-cols-3">
      {facts.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-caption text-ink-muted">{label}</dt>
          <dd className="m-0 text-body font-[600] text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
