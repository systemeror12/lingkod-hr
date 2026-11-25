import type { StatusDisplay } from '../components/ui/status-tag';

/** The Disbursement Outcomes the API records, in the order the outcome form offers them. */
export const DISBURSEMENT_OUTCOMES = [
  'SUBMITTED',
  'ACCEPTED',
  'REJECTED',
  'SETTLED',
  'RETURNED',
] as const;

export type DisbursementOutcomeKind = (typeof DISBURSEMENT_OUTCOMES)[number];

/** One Disbursement Outcome as the API returns it. */
export interface DisbursementOutcome {
  id: string;
  paymentInstructionId: string;
  sequence: number;
  outcome: DisbursementOutcomeKind;
  externalReference: string | null;
  evidenceDocumentVersionId: string | null;
  reason: string | null;
  recordedByMembershipId: string;
  recordedAt: string;
}

/** One Payment Instruction as `GET /payroll-periods/:id/payment-exports` lists it. */
export interface PaymentInstructionRecord {
  id: string;
  payrollEmployeeId: string;
  priorPaymentInstructionId: string | null;
  retryReason: string | null;
  agencyEmployeeNumber: string;
  payeeLegalName: string;
  institutionName: string;
  maskedAccountIdentifier: string;
  accountHolderName: string;
  amount: string;
  paymentReference: string;
  /** Oldest first, as the API orders them; the last is the latest. */
  outcomes: DisbursementOutcome[];
  retriedByPaymentInstructionId: string | null;
  /** The API's answer to whether it can be superseded now. */
  retryable: boolean;
}

export interface PaymentExportControls {
  sourceResultCount: number;
  sourceNetTotal: string;
  instructionCount: number;
  instructionTotal: string;
  excludedResultCount: number;
  excludedResultTotal: string;
}

/** One Payment Export of a period: its original, or a superseding retry export. */
export interface PaymentExportRecord {
  id: string;
  payrollPeriodId: string;
  supersedesPaymentExportId: string | null;
  calculationVersion: number;
  contract: { code: string; version: number };
  generatedAt: string;
  checksum: string;
  controls: PaymentExportControls;
  instructions: PaymentInstructionRecord[];
}

export const outcomeDisplay: Record<DisbursementOutcomeKind, StatusDisplay> = {
  SUBMITTED: { label: 'Submitted', tone: 'info' },
  ACCEPTED: { label: 'Accepted', tone: 'info' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
  SETTLED: { label: 'Settled', tone: 'success' },
  RETURNED: { label: 'Returned', tone: 'danger' },
};

/**
 * An instruction's state as the API recorded it: superseded once retried, else its latest
 * outcome. A handed-off instruction with no outcome is never paid.
 */
export function instructionStatusDisplay(instruction: PaymentInstructionRecord): StatusDisplay {
  if (instruction.retriedByPaymentInstructionId) return { label: 'Superseded', tone: 'neutral' };
  const latest = instruction.outcomes.at(-1);
  return latest ? outcomeDisplay[latest.outcome] : { label: 'No outcome yet', tone: 'neutral' };
}

/** The sequence the next outcome takes: one after the latest the actor read. */
export function nextOutcomeSequence(instruction: PaymentInstructionRecord): number {
  return (instruction.outcomes.at(-1)?.sequence ?? 0) + 1;
}

/** One result's Payment Instructions across the period's exports, oldest attempt first. */
export function attemptsOf(
  exports: readonly PaymentExportRecord[],
  payrollEmployeeId: string,
): { paymentExport: PaymentExportRecord; instruction: PaymentInstructionRecord }[] {
  return exports.flatMap((paymentExport) =>
    paymentExport.instructions
      .filter((instruction) => instruction.payrollEmployeeId === payrollEmployeeId)
      .map((instruction) => ({ paymentExport, instruction })),
  );
}

/** The relative API path of one export's file; the browser sends the session cookie. */
export function paymentExportFilePath(
  agencyId: string,
  paymentExport: Pick<PaymentExportRecord, 'id' | 'payrollPeriodId'>,
  file: 'csv' | 'summary',
): string {
  return `/api/v1/agencies/${agencyId}/payroll-periods/${paymentExport.payrollPeriodId}/payment-exports/${paymentExport.id}/${file}`;
}
