'use client';

import { useState, type FormEvent } from 'react';
import {
  comparisonRefusal,
  issueLineLabel,
  type LegacyRegisterComparison,
  type LegacyRegisterComparisonSummary,
  type LegacyRegisterIssue,
} from '../lib/legacy-register-comparisons';
import { dateLabel } from '../lib/overtime-format';
import {
  instantLabel,
  moneyLabel,
  type PayComponentOption,
  type PayrollPeriod,
} from '../lib/payroll-periods';
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
import { Table, Td, Th, Tr } from './ui/table';

type Form =
  | { kind: 'compare' }
  | {
      kind: 'comparison';
      summary: LegacyRegisterComparisonSummary;
      /** Null while its differences load. */
      detail: LegacyRegisterComparison | null;
    };

/**
 * Legacy Register Comparisons: a list of the Agency's comparisons, a form to compare a legacy
 * register with a Finalized Payroll Period, and each comparison's form with its differences. The
 * API validates the file, compares it, and decides every refusal; this screen shows what it sent.
 */
export function LegacyRegisterComparisonsWorkspace({
  agencyId,
  periods,
  payComponents,
  initialComparisons,
}: {
  agencyId: string;
  periods: PayrollPeriod[];
  payComponents: PayComponentOption[];
  initialComparisons: LegacyRegisterComparisonSummary[];
}) {
  const [comparisons, setComparisons] = useState(initialComparisons);
  const [form, setForm] = useState<Form | null>(null);
  const [periodId, setPeriodId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [issues, setIssues] = useState<LegacyRegisterIssue[]>([]);
  const periodById = new Map(periods.map((period) => [period.id, period]));
  const componentById = new Map(payComponents.map((component) => [component.id, component]));
  const finalized = periods.filter((period) => period.status === 'FINALIZED');
  const periodCode = (id: string) => periodById.get(id)?.code ?? id;
  const base = `/api/v1/agencies/${agencyId}`;

  function openCompare(): void {
    setPeriodId('');
    setFile(null);
    setError('');
    setIssues([]);
    setForm({ kind: 'compare' });
  }

  async function openComparison(summary: LegacyRegisterComparisonSummary): Promise<void> {
    setError('');
    setForm({ kind: 'comparison', summary, detail: null });
    try {
      const response = await fetch(
        `${base}/payroll-periods/${encodeURIComponent(summary.payrollPeriodId)}/legacy-register-comparisons/${encodeURIComponent(summary.id)}`,
        { credentials: 'include' },
      );
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(comparisonRefusal(value, 'The comparison could not be loaded.').message);
      }
      const detail = (value as { comparison: LegacyRegisterComparison }).comparison;
      setForm((current) =>
        current?.kind === 'comparison' && current.summary.id === summary.id
          ? { ...current, detail }
          : current,
      );
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'The comparison could not be loaded.');
    }
  }

  async function compare(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError('');
    setIssues([]);
    try {
      const body = new FormData();
      if (file) body.append('file', file);
      const response = await fetch(
        `${base}/payroll-periods/${encodeURIComponent(periodId)}/legacy-register-comparisons`,
        { method: 'POST', credentials: 'include', body },
      );
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const refusal = comparisonRefusal(value, 'The legacy register could not be compared.');
        setError(refusal.message);
        setIssues(refusal.issues);
        return;
      }
      const comparison = (value as { comparison: LegacyRegisterComparison }).comparison;
      const listed = await fetch(`${base}/legacy-register-comparisons`, {
        credentials: 'include',
      });
      if (listed.ok) {
        setComparisons(
          ((await listed.json()) as { comparisons: LegacyRegisterComparisonSummary[] }).comparisons,
        );
      }
      setForm({ kind: 'comparison', summary: comparison, detail: comparison });
    } catch (caught: unknown) {
      setError(
        caught instanceof Error ? caught.message : 'The legacy register could not be compared.',
      );
    } finally {
      setBusy(false);
    }
  }

  const open = form?.kind === 'comparison' ? form : null;
  const breadcrumbs: Breadcrumb[] = [
    { label: 'Payroll' },
    { label: 'Legacy Register Comparisons' },
  ];
  if (form?.kind === 'compare') breadcrumbs.push({ label: 'Compare legacy register' });
  if (open) breadcrumbs.push({ label: periodCode(open.summary.payrollPeriodId) });

  return (
    <Dialog
      presentation="form"
      open={form !== null}
      onOpenChange={(next) => !next && setForm(null)}
    >
      <div className="grid gap-5">
        <PageHeader breadcrumbs={breadcrumbs} title="Legacy Register Comparisons" />

        <div hidden={form !== null} className="grid min-w-0 gap-5">
          <p className="m-0 max-w-[760px] text-small text-ink-muted">
            Compare the register a legacy payroll system produced with a Finalized Payroll Period.
            The report lists each Employee and pay component whose amounts differ, with both
            amounts. It decides neither is right and changes no payroll record.
          </p>

          <Panel
            title="Comparisons"
            flush
            actions={
              <>
                <span className="text-caption text-ink-muted">
                  {comparisons.length === 1 ? '1 comparison' : `${comparisons.length} comparisons`}
                </span>
                <DialogTrigger asChild>
                  <Button onClick={openCompare} type="button" variant="primary">
                    Compare legacy register
                  </Button>
                </DialogTrigger>
              </>
            }
          >
            {comparisons.length === 0 ? (
              <StateSurface compact label="Legacy Register Comparisons">
                <strong className="text-body font-[650] text-ink">No comparisons yet.</strong>
              </StateSurface>
            ) : (
              <Table className="min-w-[720px]">
                <thead>
                  <tr>
                    <Th>Payroll Period</Th>
                    <Th kind="date">Compared</Th>
                    <Th kind="numeric">Calculation version</Th>
                    <Th kind="numeric">Rows</Th>
                    <Th kind="numeric">Differences</Th>
                  </tr>
                </thead>
                <tbody>
                  {comparisons.map((comparison) => (
                    <Tr key={comparison.id} selected={open?.summary.id === comparison.id}>
                      <Td>
                        <DialogTrigger asChild>
                          <button
                            className="w-fit cursor-pointer border-0 bg-transparent p-0 text-left font-[600] text-primary hover:underline"
                            onClick={() => void openComparison(comparison)}
                            type="button"
                          >
                            {periodCode(comparison.payrollPeriodId)}
                          </button>
                        </DialogTrigger>
                      </Td>
                      <Td kind="date">{instantLabel(comparison.comparedAt)}</Td>
                      <Td kind="numeric">{comparison.calculationVersion}</Td>
                      <Td kind="numeric">{comparison.rowCount}</Td>
                      <Td kind="numeric">{comparison.differenceCount}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>
        </div>

        <DialogContent aria-describedby="legacy-register-description" aria-busy={busy}>
          {form?.kind === 'compare' ? (
            <form
              className="flex min-h-0 flex-1 flex-col"
              onSubmit={(event) => void compare(event)}
            >
              <DialogHeader>
                <div className="grid min-w-0 gap-1.5">
                  <DialogTitle>Compare legacy register</DialogTitle>
                  <DialogDescription id="legacy-register-description">
                    A UTF-8 CSV file: the header <code>employee_number,component_code,amount</code>{' '}
                    and one row per Employee and pay component. A file with any invalid row is
                    rejected whole, with every reason.
                  </DialogDescription>
                </div>
              </DialogHeader>
              <DialogBody className="grid gap-5 min-[621px]:grid-cols-2">
                <Field htmlFor="legacy-register-period" label="Finalized Payroll Period">
                  <select
                    className={inputClass}
                    id="legacy-register-period"
                    value={periodId}
                    onChange={(event) =>
                      setPeriodId((event.currentTarget as unknown as { value: string }).value)
                    }
                  >
                    <option value="">
                      {finalized.length === 0
                        ? 'No Finalized Payroll Period yet'
                        : 'Choose a Payroll Period'}
                    </option>
                    {finalized.map((period) => (
                      <option key={period.id} value={period.id}>
                        {period.code} · {dateLabel(period.periodFrom)} to{' '}
                        {dateLabel(period.periodTo)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field htmlFor="legacy-register-file" label="Legacy register (CSV)">
                  <input
                    accept=".csv,text/csv"
                    className={`${inputClass} py-1.5`}
                    id="legacy-register-file"
                    type="file"
                    onChange={(event) => {
                      // This package's TypeScript has no DOM lib; the input is a file input.
                      const input = event.currentTarget as unknown as { files: File[] | null };
                      setFile(input.files?.[0] ?? null);
                    }}
                  />
                </Field>
                <FormError className="min-[621px]:col-span-2" message={error} />
                {issues.length > 0 ? (
                  <section
                    aria-label="Rejected rows"
                    className="min-w-0 rounded-panel border border-border min-[621px]:col-span-2"
                  >
                    <Table>
                      <thead>
                        <tr>
                          <Th>Where</Th>
                          <Th>Reason</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {issues.map((issue, index) => (
                          <Tr key={`${issue.line ?? 'file'}-${issue.code}-${index}`}>
                            <Td kind="date">{issueLineLabel(issue.line)}</Td>
                            <Td>{issue.message}</Td>
                          </Tr>
                        ))}
                      </tbody>
                    </Table>
                  </section>
                ) : null}
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button disabled={busy} type="button" variant="secondary">
                    Cancel
                  </Button>
                </DialogClose>
                <Button disabled={busy || !periodId || !file} type="submit" variant="primary">
                  {busy ? 'Comparing…' : 'Compare'}
                </Button>
              </DialogFooter>
            </form>
          ) : null}

          {open ? (
            <>
              <DialogHeader>
                <div className="grid min-w-0 gap-1.5">
                  <DialogTitle>{periodCode(open.summary.payrollPeriodId)}</DialogTitle>
                  <DialogDescription id="legacy-register-description">
                    Legacy register compared on {instantLabel(open.summary.comparedAt)}
                  </DialogDescription>
                </div>
              </DialogHeader>
              <DialogBody className="grid gap-5">
                <FormError message={error} />
                <Facts
                  facts={[
                    ['Calculation version', open.summary.calculationVersion],
                    ['Rows compared', open.summary.rowCount],
                    ['Differences', open.summary.differenceCount],
                    [
                      'File SHA-256',
                      <span key="hash" className="font-mono text-caption break-all">
                        {open.summary.contentHash}
                      </span>,
                    ],
                  ]}
                />
                <Panel title="Differences" flush>
                  {open.detail === null ? (
                    <StateSurface compact label="Differences">
                      <strong className="text-body font-[650] text-ink">
                        {error ? 'Differences could not be loaded.' : 'Loading differences…'}
                      </strong>
                    </StateSurface>
                  ) : open.detail.differences.length === 0 ? (
                    <StateSurface compact label="Differences">
                      <strong className="text-body font-[650] text-ink">
                        Every amount matches the finalized payroll.
                      </strong>
                    </StateSurface>
                  ) : (
                    <Table className="min-w-[720px]">
                      <thead>
                        <tr>
                          <Th>Employee number</Th>
                          <Th>Pay component</Th>
                          <Th kind="numeric">Legacy register</Th>
                          <Th kind="numeric">Finalized payroll</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {open.detail.differences.map((difference) => (
                          <Tr key={`${difference.employeeId}:${difference.payComponentId}`}>
                            <Td>{difference.employeeNumber}</Td>
                            <Td>
                              {componentById.get(difference.payComponentId)?.name ??
                                difference.payComponentCode}
                              <span className="block text-caption text-ink-muted">
                                {difference.payComponentCode}
                              </span>
                            </Td>
                            <Td kind="numeric">
                              {difference.legacyAmount === null
                                ? 'No row'
                                : moneyLabel(difference.legacyAmount)}
                            </Td>
                            <Td kind="numeric">
                              {difference.payrollAmount === null
                                ? 'No line'
                                : moneyLabel(difference.payrollAmount)}
                            </Td>
                          </Tr>
                        ))}
                      </tbody>
                    </Table>
                  )}
                </Panel>
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
