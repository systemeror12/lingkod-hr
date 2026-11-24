import type { StatusDisplay } from '../components/ui/status-tag';

/** What every stored output of a Finalized payroll says about where it came from. */
export interface OutputSource {
  id: string;
  payrollPeriodId: string;
  calculationVersion: number;
  generatedAt: string;
}

/** `GET|POST /payroll-periods/:id/register`. */
export interface PayrollRegisterRecord extends OutputSource {
  documentId: string;
  resultCount: number;
  grossAmount: string;
  totalDeductions: string;
  netAmount: string;
}

/** `GET|POST /payroll-periods/:id/variance-report`: `content` is the report's exact bytes. */
export interface VarianceReportRecord extends OutputSource {
  contract: { code: string; version: number };
  content: string;
  checksum: string;
}

interface Schedule<Totals> {
  content: string;
  checksum: string;
  totals: Totals;
}

/** `GET|POST /payroll-periods/:id/deduction-summaries`: three schedules generated together. */
export interface DeductionSummariesRecord extends OutputSource {
  contract: { code: string; version: number };
  taxSummary: Schedule<{ lineCount: number; withholdingTaxTotal: string }>;
  loanRemittanceSummary: Schedule<{ lineCount: number; deductedTotal: string }>;
  deductionRegister: Schedule<{ lineCount: number; amountTotal: string }>;
}

/** `GET|POST /payroll-periods/:id/accounting-support-exports`; its files are downloaded apart. */
export interface AccountingSupportExportRecord extends OutputSource {
  contract: { code: string; version: number };
  checksum: string;
  reconciliation: {
    resultCount: number;
    grossAmount: string;
    totalDeductions: string;
    netAmount: string;
  };
}

/**
 * One output of one period as the screen knows it. `generating` lasts while the API generates it;
 * only the record the API returns makes it `ready`. `none` is not generated yet, with the API's
 * reason when it refused.
 */
export type OutputState<T> =
  | { state: 'reading' }
  | { state: 'error'; message: string }
  | { state: 'none'; blocked: string | null }
  | { state: 'generating' }
  | { state: 'ready'; record: T };

export function outputStatusDisplay(output: OutputState<unknown>): StatusDisplay {
  switch (output.state) {
    case 'reading':
      return { label: 'Reading…', tone: 'neutral' };
    case 'error':
      return { label: 'Unavailable', tone: 'danger' };
    case 'none':
      return output.blocked
        ? { label: 'Blocked', tone: 'danger' }
        : { label: 'Not generated', tone: 'neutral' };
    case 'generating':
      return { label: 'Generating…', tone: 'warning' };
    case 'ready':
      return { label: 'Ready', tone: 'info' };
  }
}

/** The relative API path of the accounting support export's two files. */
export function accountingExportFilePath(
  agencyId: string,
  record: Pick<OutputSource, 'id' | 'payrollPeriodId'>,
  file: 'content' | 'employee-detail',
): string {
  return `/api/v1/agencies/${agencyId}/payroll-periods/${record.payrollPeriodId}/accounting-support-exports/${record.id}/${file}`;
}

/** A file name for a JSON output the API returned whole: `deduction-summaries-<period>-tax-summary-v1.json`. */
export function jsonFileName(
  contract: { code: string; version: number },
  periodCode: string,
  part?: string,
): string {
  const code = contract.code.toLowerCase().replaceAll('_', '-');
  return `${[code, periodCode, part].filter(Boolean).join('-')}-v${contract.version}.json`;
}

/** A refused Payroll request, with the API's message and status. */
export class OutputRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Call a relative Agency route of the API with the session cookie; throws the API's message. */
export async function outputRequest(
  agencyId: string,
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const response = await fetch(`/api/v1/agencies/${agencyId}${path}`, {
    ...init,
    credentials: 'include',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
  const value = (await response.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  if (!response.ok) {
    throw new OutputRequestError(
      value?.error?.message ?? 'The Payroll request failed.',
      response.status,
    );
  }
  return value;
}
