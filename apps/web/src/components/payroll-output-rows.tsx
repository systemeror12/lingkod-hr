'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  accountingExportFilePath,
  jsonFileName,
  outputRequest,
  OutputRequestError,
  outputStatusDisplay,
  type AccountingSupportExportRecord,
  type DeductionSummariesRecord,
  type OutputSource,
  type OutputState,
  type PayrollRegisterRecord,
  type VarianceReportRecord,
} from '../lib/payroll-outputs';
import { instantLabel, moneyLabel, type PayrollPeriod } from '../lib/payroll-periods';
import { Button, buttonVariants } from './ui/button';
import { FormError } from './ui/field';
import { StatusTag } from './ui/status-tag';
import { Td, Tr } from './ui/table';

/** A download link for JSON the API returned whole, saved byte for byte under `fileName`. */
function JsonDownload({
  fileName,
  content,
  children,
}: {
  fileName: string;
  content: string;
  children: ReactNode;
}) {
  return (
    <a
      className={buttonVariants({ variant: 'secondary' })}
      download={fileName}
      href={`data:application/json;charset=utf-8,${encodeURIComponent(content)}`}
    >
      {children}
    </a>
  );
}

const lineCount = (count: number) => (count === 1 ? '1 line' : `${count} lines`);

/**
 * One stored output of a period: read on mount, then generated on request. The API keeps one per
 * period and returns it again on a repeat, so the record it returns is what the row shows.
 */
function useStoredOutput<T>(agencyId: string, path: string, key: string) {
  const [output, setOutput] = useState<OutputState<T>>({ state: 'reading' });
  const [error, setError] = useState('');

  useEffect(() => {
    let current = true;
    outputRequest(agencyId, path)
      .then((value) => {
        if (!current) return;
        const record = (value as Record<string, T | null> | null)?.[key] ?? null;
        setOutput(record ? { state: 'ready', record } : { state: 'none', blocked: null });
      })
      .catch((caught: unknown) => {
        if (!current) return;
        setOutput({
          state: 'error',
          message: caught instanceof Error ? caught.message : 'The output could not be read.',
        });
      });
    return () => {
      current = false;
    };
  }, [agencyId, path, key]);

  const generate = useCallback(async () => {
    setError('');
    setOutput({ state: 'generating' });
    try {
      const value = (await outputRequest(agencyId, path, { method: 'POST' })) as Record<string, T>;
      setOutput({ state: 'ready', record: value[key]! });
    } catch (caught: unknown) {
      const message = caught instanceof Error ? caught.message : 'The output was not generated.';
      // A refusal the API explains, such as a payroll that does not reconcile, stores nothing.
      if (caught instanceof OutputRequestError && caught.status === 409) {
        setOutput({ state: 'none', blocked: message });
      } else {
        setOutput({ state: 'none', blocked: null });
        setError(message);
      }
    }
  }, [agencyId, path, key]);

  return { output, error, generate };
}

/**
 * One output's row: its status, where it came from once generated, and its files. Until the API
 * returns the record, the row offers generating and never reads as Ready.
 */
export function OutputRow<T extends OutputSource>({
  title,
  about,
  period,
  output,
  error = '',
  generateLabel,
  onGenerate,
  details,
  files,
}: {
  title: string;
  /** What the output is, shown until it is generated. */
  about: string;
  period: PayrollPeriod;
  output: OutputState<T>;
  error?: string;
  generateLabel: string;
  onGenerate: () => void;
  details: (record: T) => ReactNode;
  files: (record: T) => ReactNode;
}) {
  const status = outputStatusDisplay(output);
  const record = output.state === 'ready' ? output.record : null;
  return (
    <Tr data-output={title}>
      <Td>
        <strong className="font-[600] text-ink">{title}</strong>
      </Td>
      <Td>
        <span role={output.state === 'generating' ? 'status' : undefined}>
          <StatusTag tone={status.tone}>{status.label}</StatusTag>
        </span>
      </Td>
      <Td>
        {output.state === 'error' ? (
          <FormError message={output.message} />
        ) : record ? (
          <>
            {details(record)}
            <span className="block text-caption text-ink-muted">
              Generated {instantLabel(record.generatedAt)} from {period.code}, calculation version{' '}
              {record.calculationVersion}
            </span>
          </>
        ) : (
          <span className="block max-w-[560px] text-small break-words text-ink">
            {output.state === 'none' && output.blocked ? output.blocked : about}
          </span>
        )}
        <FormError message={error} />
      </Td>
      <Td>
        {record ? (
          <div className="flex flex-wrap gap-2">{files(record)}</div>
        ) : output.state === 'none' || output.state === 'generating' ? (
          <Button
            disabled={output.state === 'generating'}
            onClick={onGenerate}
            type="button"
            variant="primary"
          >
            {output.state === 'generating' ? 'Generating…' : generateLabel}
          </Button>
        ) : null}
      </Td>
    </Tr>
  );
}

const periodPath = (period: PayrollPeriod, output: string) =>
  `/payroll-periods/${period.id}/${output}`;

/** The Payroll Register: a PDF of the finalized results, opened through a short-lived link. */
export function RegisterRow({ agencyId, period }: { agencyId: string; period: PayrollPeriod }) {
  const path = periodPath(period, 'register');
  const { output, error, generate } = useStoredOutput<PayrollRegisterRecord>(
    agencyId,
    path,
    'register',
  );
  const [file, setFile] = useState<
    | { state: 'idle' | 'preparing' }
    | { state: 'ready'; accessUrl: string; expiresAt: string }
    | { state: 'error'; message: string }
  >({ state: 'idle' });

  async function prepare(): Promise<void> {
    setFile({ state: 'preparing' });
    try {
      const value = (await outputRequest(agencyId, `${path}/file`)) as {
        file: { accessUrl: string; expiresAt: string };
      };
      setFile({ state: 'ready', ...value.file });
    } catch (caught: unknown) {
      setFile({
        state: 'error',
        message: caught instanceof Error ? caught.message : 'The PDF could not be prepared.',
      });
    }
  }

  return (
    <OutputRow
      about="A PDF of each finalized result’s gross, deductions, and net, with component totals. It is not a prescribed government form."
      details={(record) => (
        <span className="block text-small text-ink">
          {record.resultCount === 1 ? '1 result' : `${record.resultCount} results`} · Gross{' '}
          {moneyLabel(record.grossAmount)} · Net {moneyLabel(record.netAmount)}
        </span>
      )}
      error={error}
      files={() =>
        file.state === 'ready' ? (
          <>
            <a
              className={buttonVariants({ variant: 'secondary' })}
              href={file.accessUrl}
              rel="noreferrer"
              target="_blank"
            >
              Open register PDF
            </a>
            <span className="block text-caption text-ink-muted">
              The link works until {instantLabel(file.expiresAt)}.
            </span>
          </>
        ) : (
          <>
            <Button
              disabled={file.state === 'preparing'}
              onClick={() => void prepare()}
              type="button"
              variant="secondary"
            >
              {file.state === 'preparing' ? 'Preparing…' : 'Prepare register PDF'}
            </Button>
            {file.state === 'error' ? <FormError message={file.message} /> : null}
          </>
        )
      }
      generateLabel="Generate register"
      onGenerate={() => void generate()}
      output={output}
      period={period}
      title="Payroll Register"
    />
  );
}

/** The Payroll Variance and Exception Report, a JSON Structured Export. */
export function VarianceReportRow({
  agencyId,
  period,
}: {
  agencyId: string;
  period: PayrollPeriod;
}) {
  const { output, error, generate } = useStoredOutput<VarianceReportRecord>(
    agencyId,
    periodPath(period, 'variance-report'),
    'varianceReport',
  );
  return (
    <OutputRow
      about="Net pay compared with the last Finalized regular period, by Employee and pay component, with every Payroll Exception of the period."
      details={(record) => (
        <span className="block text-small text-ink">
          {record.contract.code} v{record.contract.version}
        </span>
      )}
      error={error}
      files={(record) => (
        <JsonDownload
          content={record.content}
          fileName={jsonFileName(record.contract, period.code)}
        >
          Download report
        </JsonDownload>
      )}
      generateLabel="Generate report"
      onGenerate={() => void generate()}
      output={output}
      period={period}
      title="Variance and Exception Report"
    />
  );
}

/** The Tax Summary, Loan Remittance Summary, and Deduction Register, generated together. */
export function DeductionSchedulesRow({
  agencyId,
  period,
}: {
  agencyId: string;
  period: PayrollPeriod;
}) {
  const { output, error, generate } = useStoredOutput<DeductionSummariesRecord>(
    agencyId,
    periodPath(period, 'deduction-summaries'),
    'deductionSummaries',
  );
  return (
    <OutputRow
      about="The Tax Summary, the Loan Remittance Summary by payee, and the Deduction Register. They are no BIR form and file or remit nothing."
      details={(record) => (
        <span className="block text-small text-ink">
          Tax {lineCount(record.taxSummary.totals.lineCount)} · withheld{' '}
          {moneyLabel(record.taxSummary.totals.withholdingTaxTotal)}
          <br />
          Loans {lineCount(record.loanRemittanceSummary.totals.lineCount)} · deducted{' '}
          {moneyLabel(record.loanRemittanceSummary.totals.deductedTotal)}
          <br />
          Deductions {lineCount(record.deductionRegister.totals.lineCount)} ·{' '}
          {moneyLabel(record.deductionRegister.totals.amountTotal)}
        </span>
      )}
      error={error}
      files={(record) =>
        (
          [
            ['Tax Summary', 'tax-summary', record.taxSummary],
            ['Loan Remittance Summary', 'loan-remittance-summary', record.loanRemittanceSummary],
            ['Deduction Register', 'deduction-register', record.deductionRegister],
          ] as const
        ).map(([label, part, schedule]) => (
          <JsonDownload
            content={schedule.content}
            fileName={jsonFileName(record.contract, period.code, part)}
            key={part}
          >
            Download {label}
          </JsonDownload>
        ))
      }
      generateLabel="Generate schedules"
      onGenerate={() => void generate()}
      output={output}
      period={period}
      title="Tax, loan remittance, and deduction schedules"
    />
  );
}

/** The Finalized Payroll Accounting Support Export and, under its own permission, its companion. */
export function AccountingExportRow({
  agencyId,
  period,
  canReadEmployeeDetail,
}: {
  agencyId: string;
  period: PayrollPeriod;
  canReadEmployeeDetail: boolean;
}) {
  const { output, error, generate } = useStoredOutput<AccountingSupportExportRecord>(
    agencyId,
    periodPath(period, 'accounting-support-exports'),
    'export',
  );
  return (
    <OutputRow
      about="Every Payroll Line of the finalized payroll, classified and reconciled for Accounting. It is not a journal entry or a posting."
      details={(record) => (
        <span className="block text-small text-ink">
          {record.reconciliation.resultCount === 1
            ? '1 result'
            : `${record.reconciliation.resultCount} results`}{' '}
          · Gross {moneyLabel(record.reconciliation.grossAmount)} · Net{' '}
          {moneyLabel(record.reconciliation.netAmount)}
        </span>
      )}
      error={error}
      files={(record) => (
        <>
          <a
            className={buttonVariants({ variant: 'secondary' })}
            download
            href={accountingExportFilePath(agencyId, record, 'content')}
          >
            Download export
          </a>
          {canReadEmployeeDetail ? (
            <a
              className={buttonVariants({ variant: 'secondary' })}
              download
              href={accountingExportFilePath(agencyId, record, 'employee-detail')}
            >
              Download Employee Detail
            </a>
          ) : null}
        </>
      )}
      generateLabel="Generate accounting export"
      onGenerate={() => void generate()}
      output={output}
      period={period}
      title="Accounting Support Export"
    />
  );
}
