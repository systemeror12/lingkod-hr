import { Prisma } from '@prisma/client';
import { holdsAgencyWide, type RequestContext } from '@lingkod-hr/auth';
import type {
  AuthorizedInputPaymentSchedule,
  AuthorizedInputScope,
  AuthorizedInputStatus,
  AuthorizedInputValueKind,
} from './authorized-payroll-component-inputs.schemas';

export const ADJUST_PERMISSION = 'payroll.inputs.adjust';

/**
 * The catalogue code of reimbursable RATA. Its approved amount may not exceed
 * the native RATA ceiling (#43, docs/research/native-payroll-component-authorities.md).
 * No National Payroll Rule Version kind carries that ceiling yet, so the
 * recorder refuses every amount until one does.
 */
export const REIMBURSABLE_RATA_COMPONENT_CODE = 'REIMBURSABLE_RATA';

export class AuthorizedInputServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'AuthorizedInputServiceError';
  }
}

export interface AuthorizedInputSummary {
  id: string;
  payComponentId: string;
  scope: AuthorizedInputScope;
  employeeId: string | null;
  valueKind: AuthorizedInputValueKind;
  value: string;
  paymentSchedule: AuthorizedInputPaymentSchedule;
  authorityDocumentVersionId: string;
  sourceReference: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: AuthorizedInputStatus;
  recordedByMembershipId: string;
  approvedByMembershipId: string | null;
  approvedAt: string | null;
  rowVersion: number;
}

export const summarySelect = {
  id: true,
  payComponentId: true,
  scope: true,
  employeeId: true,
  valueKind: true,
  value: true,
  paymentSchedule: true,
  authorityDocumentVersionId: true,
  sourceReference: true,
  effectiveFrom: true,
  effectiveTo: true,
  status: true,
  recordedByMembershipId: true,
  approvedByMembershipId: true,
  approvedAt: true,
  rowVersion: true,
} satisfies Prisma.AuthorizedPayrollComponentInputSelect;

const isoDateOf = (date: Date) => date.toISOString().slice(0, 10);

/** Read one input of the Agency; RLS hides another Agency's rows as not found. */
export async function readAuthorizedInput(
  transaction: Prisma.TransactionClient,
  agencyId: string,
  id: string,
): Promise<AuthorizedInputSummary> {
  const row = await transaction.authorizedPayrollComponentInput.findFirst({
    where: { agencyId, id },
    select: summarySelect,
  });
  if (!row) {
    throw new AuthorizedInputServiceError(
      'The Authorized Payroll Component Input could not be found.',
      404,
      'AUTHORIZED_INPUT_NOT_FOUND',
    );
  }
  return toAuthorizedInputSummary(row);
}

/** Map a row read with `summarySelect` to its API shape. */
export function toAuthorizedInputSummary(
  row: Prisma.AuthorizedPayrollComponentInputGetPayload<{ select: typeof summarySelect }>,
): AuthorizedInputSummary {
  return {
    ...row,
    scope: row.scope as AuthorizedInputScope,
    valueKind: row.valueKind as AuthorizedInputValueKind,
    paymentSchedule: row.paymentSchedule as AuthorizedInputPaymentSchedule,
    status: row.status as AuthorizedInputStatus,
    value: row.value.toFixed(8),
    effectiveFrom: isoDateOf(row.effectiveFrom),
    effectiveTo: row.effectiveTo ? isoDateOf(row.effectiveTo) : null,
    approvedAt: row.approvedAt?.toISOString() ?? null,
  };
}

/** Record and approve both need `payroll.inputs.adjust` for the whole Agency. */
export function assertAdjustPermission(context: RequestContext): void {
  if (!holdsAgencyWide(context, ADJUST_PERMISSION)) {
    throw new AuthorizedInputServiceError(
      `Authorized Payroll Component Inputs need the ${ADJUST_PERMISSION} permission for the whole Agency.`,
      403,
      'AUTHORIZED_INPUT_FORBIDDEN',
    );
  }
}
