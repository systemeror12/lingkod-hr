'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { dateLabel } from '../lib/overtime-format';
import { paymentExportFilePath, type PaymentExportRecord } from '../lib/payment-exports';
import { outputRequest, OutputRequestError } from '../lib/payroll-outputs';
import { instantLabel, moneyLabel, type PayrollPeriod } from '../lib/payroll-periods';
import {
  AccountingExportRow,
  DeductionSchedulesRow,
  RegisterRow,
  VarianceReportRow,
} from './payroll-output-rows';
import { StateSurface } from './state-surface';
import { Button, buttonVariants } from './ui/button';
import { Field, FormError, inputClass } from './ui/field';
import { PageHeader } from './ui/page-header';
import { Panel } from './ui/panel';
import { StatusTag } from './ui/status-tag';
import { Table, Td, Th, Tr } from './ui/table';

/** A period's Payment Exports as read, and why the last generation was refused, if it was. */
type Outputs =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; exports: PaymentExportRecord[]; blocked: string | null };

const instructionCount = (count: number) =>
  count === 1 ? '1 instruction' : `${count} instructions`;

/**
 * Payroll → Reports (#327): one Finalized period's outputs, each with its status, each shown only
 * to those its permission names. The register and schedules, and the accounting support export,
 * are one stored output each (payroll-output-rows.tsx). The Payment Export lists each generated
 * export with its controls and its CSV and summary, or why the API refused; a superseding retry
 * export is its own row. Generating marks no one paid; Disbursement Outcomes are recorded on each
 * payslip.
 */
export function PayrollReports({
  agencyId,
  periods,
  canGenerateRegisters,
  canGenerateAccountingExport,
  canReadEmployeeDetail,
  canGeneratePaymentExport,
}: {
  agencyId: string;
  /** The Agency's Finalized periods, newest first; only they produce outputs. */
  periods: PayrollPeriod[];
  /** `payroll.registers.generate`: the register, variance report, and deduction schedules. */
  canGenerateRegisters: boolean;
  canGenerateAccountingExport: boolean;
  canReadEmployeeDetail: boolean;
  canGeneratePaymentExport: boolean;
}) {
  const [periodId, setPeriodId] = useState(periods[0]?.id ?? '');
  const [outputs, setOutputs] = useState<Record<string, Outputs>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const period = periods.find((item) => item.id === periodId);

  const request = useCallback(
    (path: string, init?: RequestInit) => outputRequest(agencyId, path, init),
    [agencyId],
  );

  const load = useCallback(
    async (id: string, blocked: string | null = null) => {
      setOutputs((current) => ({ ...current, [id]: { state: 'loading' } }));
      try {
        const { exports } = (await request(`/payroll-periods/${id}/payment-exports`)) as {
          exports: PaymentExportRecord[];
        };
        setOutputs((current) => ({ ...current, [id]: { state: 'ready', exports, blocked } }));
      } catch (caught: unknown) {
        setOutputs((current) => ({
          ...current,
          [id]: {
            state: 'error',
            message: caught instanceof Error ? caught.message : 'The outputs could not be read.',
          },
        }));
      }
    },
    [request],
  );

  useEffect(() => {
    if (canGeneratePaymentExport && periodId && !outputs[periodId]) void load(periodId);
  }, [canGeneratePaymentExport, periodId, outputs, load]);

  async function generate(target: PayrollPeriod): Promise<void> {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await request(`/payroll-periods/${target.id}/payment-exports`, { method: 'POST' });
      await load(target.id);
      setNotice(
        `Payment Export of ${target.code} generated. It marks no one paid: record each instruction’s Disbursement Outcome on its payslip.`,
      );
    } catch (caught: unknown) {
      // A refusal the API explains, such as a missing destination, stores nothing; show it on the row.
      if (caught instanceof OutputRequestError && caught.status === 409) {
        await load(target.id, caught.message);
      } else {
        setError(
          caught instanceof Error ? caught.message : 'The Payment Export was not generated.',
        );
      }
    } finally {
      setBusy(false);
    }
  }

  function paymentExportRows(target: PayrollPeriod, current: Outputs | undefined): ReactNode {
    if (!current || current.state === 'loading') {
      return (
        <Tr>
          <Td>Payment Export</Td>
          <Td>
            <span className="text-caption text-ink-muted">Reading…</span>
          </Td>
          <Td />
          <Td />
        </Tr>
      );
    }
    if (current.state === 'error') {
      return (
        <Tr>
          <Td>Payment Export</Td>
          <Td colSpan={3}>
            <FormError message={current.message} />
          </Td>
        </Tr>
      );
    }
    const original = current.exports.find((item) => item.supersedesPaymentExportId === null);
    return (
      <>
        {original ? null : (
          <Tr>
            <Td>
              <strong className="font-[600] text-ink">Payment Export</strong>
            </Td>
            <Td>
              {busy ? (
                <span role="status">
                  <StatusTag tone="warning">Generating…</StatusTag>
                </span>
              ) : current.blocked ? (
                <StatusTag tone="danger">Blocked</StatusTag>
              ) : (
                <StatusTag tone="neutral">Not generated</StatusTag>
              )}
            </Td>
            <Td>
              <span className="block max-w-[560px] text-small break-words text-ink">
                {current.blocked ??
                  'One instruction per payslip with positive net pay, to its Employee’s designated Payroll Bank Account.'}
              </span>
            </Td>
            <Td>
              {canGeneratePaymentExport ? (
                <Button
                  disabled={busy}
                  onClick={() => void generate(target)}
                  type="button"
                  variant="primary"
                >
                  {busy
                    ? 'Generating…'
                    : current.blocked
                      ? 'Generate again'
                      : 'Generate Payment Export'}
                </Button>
              ) : null}
            </Td>
          </Tr>
        )}
        {current.exports.map((paymentExport) => {
          const { controls } = paymentExport;
          const retry = paymentExport.supersedesPaymentExportId !== null;
          return (
            <Tr key={paymentExport.id} data-payment-export={paymentExport.id}>
              <Td>
                <strong className="font-[600] text-ink">
                  {retry ? 'Payment Export, superseding' : 'Payment Export'}
                </strong>
                <span className="block text-caption text-ink-muted">
                  {paymentExport.contract.code} v{paymentExport.contract.version}
                </span>
              </Td>
              <Td>
                <StatusTag tone="info">Ready</StatusTag>
              </Td>
              <Td>
                <span className="block text-small text-ink">
                  {instructionCount(controls.instructionCount)} ·{' '}
                  {moneyLabel(controls.instructionTotal)}
                  {controls.excludedResultCount > 0
                    ? ` · ${controls.excludedResultCount} excluded with no positive net pay`
                    : ''}
                </span>
                <span className="block text-caption text-ink-muted">
                  Generated {instantLabel(paymentExport.generatedAt)}
                  {retry
                    ? `. Resends ${paymentExport.instructions[0]?.agencyEmployeeNumber ?? 'one instruction'} to a corrected destination.`
                    : ''}
                </span>
              </Td>
              <Td>
                <div className="flex flex-wrap gap-2">
                  <a
                    className={buttonVariants({ variant: 'secondary' })}
                    download
                    href={paymentExportFilePath(agencyId, paymentExport, 'csv')}
                  >
                    Download CSV
                  </a>
                  <a
                    className={buttonVariants({ variant: 'secondary' })}
                    download
                    href={paymentExportFilePath(agencyId, paymentExport, 'summary')}
                  >
                    Download summary
                  </a>
                </div>
              </Td>
            </Tr>
          );
        })}
      </>
    );
  }

  return (
    <div className="grid gap-5">
      <PageHeader breadcrumbs={[{ label: 'Payroll' }, { label: 'Reports' }]} title="Reports" />
      <p className="m-0 max-w-[760px] text-small text-ink-muted">
        Each Finalized Payroll Period’s outputs, with their status. An output reads Ready only once
        the API has generated it. Generating the Payment Export hands its instructions off; it marks
        no one paid. Record each instruction’s Disbursement Outcome on its payslip.
      </p>
      {periods.length === 0 ? (
        <StateSurface compact label="Payroll outputs">
          <strong className="text-body font-[650] text-ink">
            No Finalized Payroll Periods yet.
          </strong>
          <p className="m-0">A period produces its outputs once it is Finalized.</p>
        </StateSurface>
      ) : (
        <>
          <div className="max-w-[360px]">
            <Field htmlFor="reports-period" label="Payroll Period">
              <select
                className={inputClass}
                id="reports-period"
                onChange={(event) => {
                  setPeriodId((event.currentTarget as unknown as { value: string }).value);
                  setError('');
                  setNotice('');
                }}
                value={periodId}
              >
                {periods.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.code}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <FormError message={error} />
          {notice ? (
            <p className="m-0 text-small text-ink" role="status">
              {notice}
            </p>
          ) : null}
          {period ? (
            <Panel
              title={`${period.code} outputs`}
              flush
              actions={
                <span className="text-caption text-ink-muted">
                  Payment date {dateLabel(period.paymentDate)}
                  {period.totals ? ` · Net ${moneyLabel(period.totals.netAmount)}` : ''}
                </span>
              }
            >
              <Table className="min-w-[880px]">
                <thead>
                  <tr>
                    <Th>Output</Th>
                    <Th>Status</Th>
                    <Th>Details</Th>
                    <Th>Files</Th>
                  </tr>
                </thead>
                <tbody key={period.id}>
                  {canGenerateRegisters ? (
                    <>
                      <RegisterRow agencyId={agencyId} period={period} />
                      <VarianceReportRow agencyId={agencyId} period={period} />
                      <DeductionSchedulesRow agencyId={agencyId} period={period} />
                    </>
                  ) : null}
                  {canGenerateAccountingExport ? (
                    <AccountingExportRow
                      agencyId={agencyId}
                      canReadEmployeeDetail={canReadEmployeeDetail}
                      period={period}
                    />
                  ) : null}
                  {canGeneratePaymentExport ? paymentExportRows(period, outputs[period.id]) : null}
                </tbody>
              </Table>
            </Panel>
          ) : null}
        </>
      )}
    </div>
  );
}
