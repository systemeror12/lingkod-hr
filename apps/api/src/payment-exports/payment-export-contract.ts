import { Prisma } from '@prisma/client';

/** The contract version this code renders; migration 0186 defines it. */
export const PAYMENT_EXPORT_CONTRACT = { code: 'PAYMENT_EXPORT', version: 1 } as const;

/** Contract version 1's statement, verbatim: the export claims no external state (#28). */
export const PAYMENT_EXPORT_STATEMENT =
  'This Payment Export is a provider-neutral handoff of one finalized payroll. It does not claim conformance to, acceptance by, or settlement through any bank or disbursement system, and it marks no one paid.';

export const DESTINATION_TYPE = 'BANK_ACCOUNT';
export const INSTITUTION_IDENTIFIER_SCHEME = 'AGENCY_BANK_CODE';

/** One FINALIZED Payroll Employee Result, with its line sums and its Employee. */
export interface PaymentExportSourceResult {
  payrollEmployeeId: string;
  employeeId: string;
  agencyEmployeeNumber: string;
  payeeLegalName: string;
  grossAmount: string;
  totalDeductions: string;
  netAmount: string;
  earningLineTotal: string;
  deductionLineTotal: string;
}

/** A Payroll Bank Account of an Employee: designated only while ACTIVE and effective. */
export interface PaymentExportDestinationCandidate {
  id: string;
  employeeId: string;
  status: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  bankCode: string;
  accountName: string;
  maskedAccountNumber: string;
}

export interface PaymentExportPeriod {
  id: string;
  code: string;
  runType: string;
  periodFrom: string;
  periodTo: string;
  paymentDate: string;
  calculationVersion: number;
}

export interface PlannedPaymentInstruction {
  payrollEmployeeId: string;
  payrollBankAccountId: string;
  agencyEmployeeNumber: string;
  payeeLegalName: string;
  destinationType: string;
  institutionIdentifierScheme: string;
  institutionIdentifier: string;
  institutionName: string;
  maskedAccountIdentifier: string;
  accountHolderName: string;
  amount: string;
  paymentReference: string;
}

export interface ExcludedPaymentExportResult {
  payrollEmployeeId: string;
  agencyEmployeeNumber: string;
  payeeLegalName: string;
  netAmount: string;
}

export interface PaymentExportControls {
  sourceResultCount: number;
  sourceNetTotal: string;
  instructionCount: number;
  instructionTotal: string;
  excludedResultCount: number;
  excludedResultTotal: string;
}

export interface PaymentExportPlan {
  instructions: PlannedPaymentInstruction[];
  excluded: ExcludedPaymentExportResult[];
  controls: PaymentExportControls;
}

export type DestinationProblem = 'MISSING' | 'INEFFECTIVE' | 'UNVERIFIED';

/** Why the whole export is blocked; nothing is stored. */
export class PaymentExportBlockedError extends Error {
  constructor(
    message: string,
    readonly code: 'PAYMENT_EXPORT_DESTINATION_BLOCKED' | 'PAYMENT_EXPORT_RECONCILIATION_FAILED',
  ) {
    super(message);
    this.name = 'PaymentExportBlockedError';
  }
}

/**
 * Plan the Payment Export of a finalized payroll (#28): one instruction per
 * positive-net-pay result, to its Employee's designated destination on
 * `onDate`, and the controls that account for every result. A zero- or
 * negative-net-pay result is excluded and counted.
 *
 * It refuses the whole export on any reconciliation mismatch first, then on
 * any positive-net-pay result whose destination is missing, ineffective on
 * `onDate`, or unverified, naming every Employee affected.
 */
export function planPaymentExport(input: {
  period: PaymentExportPeriod;
  results: PaymentExportSourceResult[];
  destinations: PaymentExportDestinationCandidate[];
  onDate: string;
}): PaymentExportPlan {
  const results = [...input.results].sort(byEmployeeNumber);
  reconcileResults(results);

  const instructions: PlannedPaymentInstruction[] = [];
  const excluded: ExcludedPaymentExportResult[] = [];
  const problems: { employeeNumber: string; problem: DestinationProblem }[] = [];
  for (const result of results) {
    const net = new Prisma.Decimal(result.netAmount);
    if (net.lte(0)) {
      excluded.push({
        payrollEmployeeId: result.payrollEmployeeId,
        agencyEmployeeNumber: result.agencyEmployeeNumber,
        payeeLegalName: result.payeeLegalName,
        netAmount: net.toFixed(2),
      });
      continue;
    }
    const candidates = input.destinations.filter(
      (account) => account.employeeId === result.employeeId,
    );
    const destination = designatedDestination(candidates, input.onDate);
    if (typeof destination === 'string') {
      problems.push({ employeeNumber: result.agencyEmployeeNumber, problem: destination });
      continue;
    }
    instructions.push({
      payrollEmployeeId: result.payrollEmployeeId,
      payrollBankAccountId: destination.id,
      agencyEmployeeNumber: result.agencyEmployeeNumber,
      payeeLegalName: result.payeeLegalName,
      destinationType: DESTINATION_TYPE,
      institutionIdentifierScheme: INSTITUTION_IDENTIFIER_SCHEME,
      institutionIdentifier: destination.bankCode,
      // The HRIS keeps no bank catalogue, so version 1 repeats the bank code.
      institutionName: destination.bankCode,
      maskedAccountIdentifier: destination.maskedAccountNumber,
      accountHolderName: destination.accountName,
      amount: net.toFixed(2),
      paymentReference: `${input.period.code}-${result.agencyEmployeeNumber}`,
    });
  }
  if (problems.length > 0) {
    throw new PaymentExportBlockedError(
      `The Payment Export is blocked: ${describeProblems(problems)}. Nothing was generated.`,
      'PAYMENT_EXPORT_DESTINATION_BLOCKED',
    );
  }

  const controls: PaymentExportControls = {
    sourceResultCount: results.length,
    sourceNetTotal: sum(results.map((result) => result.netAmount)),
    instructionCount: instructions.length,
    instructionTotal: sum(instructions.map((instruction) => instruction.amount)),
    excludedResultCount: excluded.length,
    excludedResultTotal: sum(excluded.map((result) => result.netAmount)),
  };
  if (
    controls.sourceResultCount !== controls.instructionCount + controls.excludedResultCount ||
    !new Prisma.Decimal(controls.sourceNetTotal).equals(
      new Prisma.Decimal(controls.instructionTotal).add(controls.excludedResultTotal),
    )
  ) {
    throw reconciliationFailed('the controls do not account for every result');
  }
  return { instructions, excluded, controls };
}

/**
 * The Employee's designated destination on `onDate`: the ACTIVE account, which
 * the database keeps verified, effective that day. Otherwise why there is none.
 */
export function designatedDestination(
  candidates: PaymentExportDestinationCandidate[],
  onDate: string,
): PaymentExportDestinationCandidate | DestinationProblem {
  const effective = (account: PaymentExportDestinationCandidate) =>
    account.effectiveFrom <= onDate &&
    (account.effectiveTo === null || account.effectiveTo >= onDate);
  const active = candidates.find((account) => account.status === 'ACTIVE' && effective(account));
  if (active) return active;
  if (
    candidates.some((account) => account.status === 'PENDING_VERIFICATION' && effective(account))
  ) {
    return 'UNVERIFIED';
  }
  if (
    candidates.some((account) =>
      ['ACTIVE', 'PENDING_VERIFICATION', 'INACTIVE'].includes(account.status),
    )
  ) {
    return 'INEFFECTIVE';
  }
  return 'MISSING';
}

/** Each result's totals equal its line sums, and its net is whole centavos. */
function reconcileResults(results: PaymentExportSourceResult[]): void {
  const unreconciled = results.filter((result) => {
    const gross = new Prisma.Decimal(result.grossAmount);
    const deductions = new Prisma.Decimal(result.totalDeductions);
    const net = new Prisma.Decimal(result.netAmount);
    return (
      !gross.equals(result.earningLineTotal) ||
      !deductions.equals(result.deductionLineTotal) ||
      !net.equals(gross.sub(deductions))
    );
  });
  if (unreconciled.length > 0) {
    throw reconciliationFailed(
      `the totals of ${employeeList(unreconciled)} do not equal their Payroll Lines`,
    );
  }
  const fractional = results.filter(
    (result) => new Prisma.Decimal(result.netAmount).decimalPlaces() > 2,
  );
  if (fractional.length > 0) {
    throw reconciliationFailed(
      `the net pay of ${employeeList(fractional)} is not whole centavos, and the export never rounds`,
    );
  }
}

function reconciliationFailed(cause: string): PaymentExportBlockedError {
  return new PaymentExportBlockedError(
    `The Payment Export does not reconcile: ${cause}. Nothing was generated.`,
    'PAYMENT_EXPORT_RECONCILIATION_FAILED',
  );
}

const problemWords: Record<DestinationProblem, string> = {
  MISSING: 'no Payroll Bank Account',
  INEFFECTIVE: 'no Payroll Bank Account effective today',
  UNVERIFIED: 'an unverified Payroll Bank Account',
};

function describeProblems(problems: { employeeNumber: string; problem: DestinationProblem }[]) {
  return (['MISSING', 'INEFFECTIVE', 'UNVERIFIED'] as const)
    .map((problem) => {
      const numbers = problems
        .filter((entry) => entry.problem === problem)
        .map((entry) => entry.employeeNumber);
      return numbers.length === 0 ? null : `${problemWords[problem]} for ${numbers.join(', ')}`;
    })
    .filter((part) => part !== null)
    .join('; ');
}

function employeeList(results: PaymentExportSourceResult[]): string {
  return results.map((result) => result.agencyEmployeeNumber).join(', ');
}

function byEmployeeNumber(
  left: { agencyEmployeeNumber: string; payrollEmployeeId: string },
  right: { agencyEmployeeNumber: string; payrollEmployeeId: string },
): number {
  return (
    compare(left.agencyEmployeeNumber, right.agencyEmployeeNumber) ||
    compare(left.payrollEmployeeId, right.payrollEmployeeId)
  );
}

/** Code-unit order, so the row order never depends on a locale. */
function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sum(amounts: string[]): string {
  return amounts.reduce((total, amount) => total.add(amount), new Prisma.Decimal(0)).toFixed(2);
}

/** The stored export and its instructions, as the artifacts render them. */
export interface PaymentExportSnapshot {
  id: string;
  agencyId: string;
  generatedAt: string;
  currency: string;
  period: PaymentExportPeriod;
  controls: PaymentExportControls;
  instructions: (Omit<PlannedPaymentInstruction, 'payrollBankAccountId'> & {
    id: string;
    /** The full account identifier: the CSV carries it, the summary never does. */
    accountIdentifier: string;
  })[];
}

const csvColumns = [
  'contract_code',
  'contract_version',
  'payment_export_id',
  'agency_id',
  'payroll_period_id',
  'payroll_period_code',
  'payroll_run_type',
  'calculation_version',
  'period_from',
  'period_to',
  'payment_date',
  'currency',
  'generated_at',
  'payment_instruction_id',
  'payroll_employee_id',
  'agency_employee_number',
  'payee_legal_name',
  'destination_type',
  'institution_identifier_scheme',
  'institution_identifier',
  'institution_name',
  'account_identifier',
  'account_holder_name',
  'amount',
  'payment_reference',
] as const;

/**
 * Render contract version 1's CSV: one header row, then one row per
 * instruction in the contract's row order, every field double-quoted, CRLF
 * line endings, UTF-8 without a byte order mark. The same snapshot always
 * renders the same bytes.
 */
export function renderPaymentExportCsv(snapshot: PaymentExportSnapshot): string {
  const { period } = snapshot;
  const rows = [...snapshot.instructions].sort(byEmployeeNumber).map((instruction) => {
    const row: Record<(typeof csvColumns)[number], string> = {
      contract_code: PAYMENT_EXPORT_CONTRACT.code,
      contract_version: String(PAYMENT_EXPORT_CONTRACT.version),
      payment_export_id: snapshot.id,
      agency_id: snapshot.agencyId,
      payroll_period_id: period.id,
      payroll_period_code: period.code,
      payroll_run_type: period.runType,
      calculation_version: String(period.calculationVersion),
      period_from: period.periodFrom,
      period_to: period.periodTo,
      payment_date: period.paymentDate,
      currency: snapshot.currency,
      generated_at: snapshot.generatedAt,
      payment_instruction_id: instruction.id,
      payroll_employee_id: instruction.payrollEmployeeId,
      agency_employee_number: instruction.agencyEmployeeNumber,
      payee_legal_name: instruction.payeeLegalName,
      destination_type: instruction.destinationType,
      institution_identifier_scheme: instruction.institutionIdentifierScheme,
      institution_identifier: instruction.institutionIdentifier,
      institution_name: instruction.institutionName,
      account_identifier: instruction.accountIdentifier,
      account_holder_name: instruction.accountHolderName,
      amount: instruction.amount,
      payment_reference: instruction.paymentReference,
    };
    return csvColumns.map((column) => row[column]);
  });
  return [[...csvColumns], ...rows]
    .map((fields) => `${fields.map(csvField).join(',')}\r\n`)
    .join('');
}

function csvField(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

/**
 * Render the human-readable reconciliation summary. It masks every account
 * identifier except its last four characters, lists the excluded results, and
 * names the CSV's checksum, so the two artifacts are tied together.
 */
export function renderPaymentExportSummary(
  snapshot: PaymentExportSnapshot,
  excluded: ExcludedPaymentExportResult[],
  csvChecksum: string,
): string {
  const { period, controls } = snapshot;
  const lines = [
    'Payment Export reconciliation summary',
    '',
    `Contract: ${PAYMENT_EXPORT_CONTRACT.code} version ${PAYMENT_EXPORT_CONTRACT.version}`,
    `Payment Export: ${snapshot.id}`,
    `Agency: ${snapshot.agencyId}`,
    `Payroll Period: ${period.code} (${period.id})`,
    `Run type: ${period.runType}`,
    `Calculation version: ${period.calculationVersion}`,
    `Period: ${period.periodFrom} to ${period.periodTo}`,
    `Payment date: ${period.paymentDate}`,
    `Currency: ${snapshot.currency}`,
    `Generated at: ${snapshot.generatedAt}`,
    `CSV SHA-256: ${csvChecksum}`,
    '',
    'Controls',
    `Source results: ${controls.sourceResultCount}, net total ${controls.sourceNetTotal}`,
    `Payment Instructions: ${controls.instructionCount}, total ${controls.instructionTotal}`,
    `Excluded zero or negative net pay: ${controls.excludedResultCount}, total ${controls.excludedResultTotal}`,
    '',
    'Payment Instructions',
    ...(snapshot.instructions.length === 0
      ? ['None']
      : [...snapshot.instructions]
          .sort(byEmployeeNumber)
          .map((instruction, index) =>
            [
              String(index + 1),
              instruction.agencyEmployeeNumber,
              instruction.payeeLegalName,
              instruction.institutionIdentifier,
              instruction.maskedAccountIdentifier,
              instruction.accountHolderName,
              instruction.amount,
              instruction.paymentReference,
            ].join(' | '),
          )),
    '',
    'Excluded results',
    ...(excluded.length === 0
      ? ['None']
      : [...excluded]
          .sort(byEmployeeNumber)
          .map((result) =>
            [result.agencyEmployeeNumber, result.payeeLegalName, result.netAmount].join(' | '),
          )),
    '',
    PAYMENT_EXPORT_STATEMENT,
  ];
  return lines.map((line) => `${line}\n`).join('');
}
