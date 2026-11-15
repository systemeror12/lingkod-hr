import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { holdsAgencyWide, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import {
  payrollInputSubmissionSchema,
  type PayrollInputKind,
  type PayrollInputListFilters,
  type PayrollInputSourceModule,
  type PayrollInputStatus,
  type PayrollInputSubmission,
  type PayrollInputWithdrawal,
} from './payroll-inputs.schemas';

/**
 * Payroll's answer to a source module. `REJECTED` will not change on retry;
 * `RETRYABLE_FAILURE` means Payroll cannot accept the input yet and the same
 * request may succeed later. Neither creates a Payroll Input.
 */
export type PayrollInputAcceptance =
  | { outcome: 'ACCEPTED' | 'ALREADY_ACCEPTED'; payrollInputId: string }
  | { outcome: 'REJECTED' | 'RETRYABLE_FAILURE'; code: string; reason: string };

/** Payroll's answer to a withdrawal, with the same failure meanings as acceptance. */
export type PayrollInputWithdrawalAnswer =
  | { outcome: 'WITHDRAWN' | 'ALREADY_WITHDRAWN'; payrollInputId: string }
  | { outcome: 'REJECTED' | 'RETRYABLE_FAILURE'; code: string; reason: string };

export interface PayrollInputSummary {
  id: string;
  employeeId: string;
  sourceModule: PayrollInputSourceModule;
  inputKind: PayrollInputKind;
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

export class PayrollInputsServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'PayrollInputsServiceError';
  }
}

const LIST_LIMIT = 200;

const summarySelect = {
  id: true,
  employeeId: true,
  sourceModule: true,
  inputKind: true,
  sourceKey: true,
  sourceType: true,
  sourceId: true,
  effectiveDate: true,
  quantity: true,
  amount: true,
  status: true,
  acceptedAt: true,
  consumedByPayrollPeriodId: true,
  replacesPayrollInputId: true,
} as const;

/**
 * The Payroll Input inbox, and the only way a source module posts to Payroll
 * (payroll-schema.md §4).
 */
@Injectable()
export class PayrollInputsService {
  /**
   * Accept one source effect inside the caller's transaction, which must carry
   * the caller's Agency database context. The input commits or rolls back with
   * that transaction. A retry with the same source key and payload returns the
   * existing input; the same key with a different payload is rejected.
   */
  async acceptInTransaction(
    transaction: Prisma.TransactionClient,
    submission: PayrollInputSubmission,
  ): Promise<PayrollInputAcceptance> {
    const parsed = payrollInputSubmissionSchema.safeParse(submission);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return rejected(
        'PAYROLL_INPUT_INVALID',
        `${issue?.path.map(String).join('.') || 'request'}: ${issue?.message ?? 'invalid'}`,
      );
    }
    const request = parsed.data;
    const quantity = request.quantity == null ? null : new Prisma.Decimal(request.quantity);
    const payloadHash = createHash('sha256')
      .update(
        canonicalJson({
          employeeId: request.employeeId,
          inputKind: request.inputKind,
          sourceType: request.sourceType,
          sourceId: request.sourceId,
          effectiveDate: request.effectiveDate,
          quantity: quantity?.toFixed(4) ?? null,
          payload: request.payload,
          // Only a replacement adds the key, so earlier inputs keep their hash.
          ...(request.replacesPayrollInputId
            ? { replacesPayrollInputId: request.replacesPayrollInputId }
            : {}),
        }),
      )
      .digest('hex');
    const key = {
      agencyId: request.agencyId,
      sourceModule: request.sourceModule,
      sourceKey: request.sourceKey,
    };

    const existing = await findByKey(transaction, key);
    if (existing) return replay(existing, payloadHash);

    // Payroll computes a monetization amount from Personnel salary facts, which
    // #339 binds. Until then Payroll cannot value the input, so it accepts none.
    if (request.inputKind === 'MONETIZATION_EARNING') {
      return {
        outcome: 'RETRYABLE_FAILURE',
        code: 'PAYROLL_INPUT_VALUATION_UNAVAILABLE',
        reason: 'Payroll cannot yet value a monetization earning from its salary source.',
      };
    }

    // Under RLS this also refuses an Agency other than the caller's context.
    const employee = await transaction.employee.findFirst({
      where: { agencyId: request.agencyId, id: request.employeeId },
      select: { id: true },
    });
    if (!employee) {
      return rejected('PAYROLL_INPUT_EMPLOYEE_NOT_FOUND', 'The Employee is not in this Agency.');
    }

    // A replacement names a withdrawn input of the same source, Employee, and kind.
    if (request.replacesPayrollInputId) {
      const replaced = await transaction.payrollInput.findFirst({
        where: { agencyId: request.agencyId, id: request.replacesPayrollInputId },
        select: { employeeId: true, sourceModule: true, inputKind: true, status: true },
      });
      if (
        !replaced ||
        replaced.employeeId !== request.employeeId ||
        replaced.sourceModule !== request.sourceModule ||
        replaced.inputKind !== request.inputKind
      ) {
        return rejected(
          'PAYROLL_INPUT_REPLACED_NOT_FOUND',
          'The replaced Payroll Input is not one this source posted for the Employee and kind.',
        );
      }
      if (replaced.status !== 'CANCELLED') {
        return rejected(
          'PAYROLL_INPUT_REPLACED_NOT_WITHDRAWN',
          'A replacement needs its earlier Payroll Input withdrawn first.',
        );
      }
    }

    // ON CONFLICT DO NOTHING keeps a concurrent duplicate from aborting the
    // caller's transaction; the committed winner is read back and compared.
    const { count } = await transaction.payrollInput.createMany({
      data: {
        ...key,
        employeeId: request.employeeId,
        inputKind: request.inputKind,
        sourceType: request.sourceType,
        sourceId: request.sourceId,
        effectiveDate: new Date(`${request.effectiveDate}T00:00:00.000Z`),
        quantity,
        status: 'PENDING',
        payloadSnapshot: request.payload as Prisma.InputJsonObject,
        payloadHash,
        replacesPayrollInputId: request.replacesPayrollInputId ?? null,
      },
      skipDuplicates: true,
    });
    const stored = await findByKey(transaction, key);
    if (!stored) throw new Error('The accepted Payroll Input could not be read back.');
    return count === 1
      ? { outcome: 'ACCEPTED', payrollInputId: stored.id }
      : replay(stored, payloadHash);
  }

  /**
   * Withdraw a source module's own input inside the caller's transaction, which
   * must carry the caller's Agency database context (payroll-schema.md §4). A
   * `PENDING` input becomes `CANCELLED`; a retry answers `ALREADY_WITHDRAWN`.
   * No calculation uses a `PENDING` input yet. A `CONSUMED` input is corrected
   * by a Payroll Adjustment (#649), which does not exist yet, so it is refused
   * as retryable.
   */
  async withdrawInTransaction(
    transaction: Prisma.TransactionClient,
    request: PayrollInputWithdrawal,
  ): Promise<PayrollInputWithdrawalAnswer> {
    const where = { agencyId: request.agencyId, id: request.payrollInputId };
    const cancelled = await transaction.payrollInput.updateMany({
      where: { ...where, sourceModule: request.sourceModule, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
    if (cancelled.count === 1) {
      return { outcome: 'WITHDRAWN', payrollInputId: request.payrollInputId };
    }
    const input = await transaction.payrollInput.findFirst({
      where,
      select: { sourceModule: true, status: true },
    });
    if (!input || input.sourceModule !== request.sourceModule) {
      return rejected(
        'PAYROLL_INPUT_NOT_FOUND',
        'The Payroll Input is not one this source posted.',
      );
    }
    if (input.status === 'CANCELLED') {
      return { outcome: 'ALREADY_WITHDRAWN', payrollInputId: request.payrollInputId };
    }
    return {
      outcome: 'RETRYABLE_FAILURE',
      code: 'PAYROLL_INPUT_CONSUMED_CORRECTION_UNAVAILABLE',
      reason: 'The Payroll Input was consumed by a payroll; Payroll cannot yet correct it (#649).',
    };
  }

  /** Payroll Inputs of the acting Agency, newest first, by source module and status. */
  async list(
    context: RequestContext,
    filters: PayrollInputListFilters,
  ): Promise<PayrollInputSummary[]> {
    if (!holdsAgencyWide(context, 'payroll.inputs.read')) {
      throw new PayrollInputsServiceError(
        'Reading Payroll Inputs needs the payroll.inputs.read permission for the whole Agency.',
        403,
        'PAYROLL_INPUT_READ_FORBIDDEN',
      );
    }
    const rows = await withDatabaseContext(requestDatabaseContext(context), (transaction) =>
      transaction.payrollInput.findMany({
        where: {
          agencyId: context.agencyId,
          ...(filters.sourceModule ? { sourceModule: filters.sourceModule } : {}),
          ...(filters.status ? { status: filters.status } : {}),
        },
        orderBy: [{ acceptedAt: 'desc' }, { id: 'desc' }],
        take: LIST_LIMIT,
        select: summarySelect,
      }),
    );
    return rows.map((row) => ({
      ...row,
      sourceModule: row.sourceModule as PayrollInputSourceModule,
      inputKind: row.inputKind as PayrollInputKind,
      status: row.status as PayrollInputStatus,
      effectiveDate: row.effectiveDate.toISOString().slice(0, 10),
      quantity: row.quantity?.toFixed(4) ?? null,
      amount: row.amount?.toFixed(4) ?? null,
      acceptedAt: row.acceptedAt.toISOString(),
    }));
  }
}

function findByKey(
  transaction: Prisma.TransactionClient,
  key: { agencyId: string; sourceModule: string; sourceKey: string },
) {
  return transaction.payrollInput.findUnique({
    where: { agencyId_sourceModule_sourceKey: key },
    select: { id: true, payloadHash: true },
  });
}

function replay(
  existing: { id: string; payloadHash: string },
  payloadHash: string,
): PayrollInputAcceptance {
  return existing.payloadHash === payloadHash
    ? { outcome: 'ALREADY_ACCEPTED', payrollInputId: existing.id }
    : rejected(
        'PAYROLL_INPUT_SOURCE_KEY_CONFLICT',
        'The source key already names a Payroll Input with a different payload.',
      );
}

function rejected(
  code: string,
  reason: string,
): { outcome: 'REJECTED'; code: string; reason: string } {
  return { outcome: 'REJECTED', code, reason };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
