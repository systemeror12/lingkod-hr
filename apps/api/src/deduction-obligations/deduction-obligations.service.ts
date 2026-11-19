import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { holdsAgencyWide, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import { DocumentsService } from '../documents/documents.service';
import {
  findAuthorizedDeductions,
  isoDateOf,
  type DeductionPayeeCategory,
} from '../payroll-rule-versions/national-payroll-rule-versions';
import type {
  ChangeDeductionObligationInput,
  EndDeductionObligationInput,
  RecordDeductionObligationInput,
} from './deduction-obligations.schemas';

export type DeductionObligationStatus = 'ACTIVE' | 'SUPERSEDED' | 'ENDED';

export interface DeductionObligationSummary {
  id: string;
  employeeId: string;
  payeeCategory: DeductionPayeeCategory;
  payeeName: string;
  issuerReference: string;
  incurredOn: string;
  outstandingBalance: string;
  scheduledAmount: string;
  authorityDocumentVersionId: string;
  payeeRuleVersionId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: DeductionObligationStatus;
  supersedesObligationId: string | null;
  changeReason: string | null;
  endReason: string | null;
}

export class DeductionObligationsServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'DeductionObligationsServiceError';
  }
}

const PERMISSION = 'payroll.deductions.manage';

const obligationSelect = {
  id: true,
  employeeId: true,
  payeeCategory: true,
  payeeName: true,
  issuerReference: true,
  incurredOn: true,
  outstandingBalance: true,
  scheduledAmount: true,
  authorityDocumentVersionId: true,
  payeeRuleVersionId: true,
  effectiveFrom: true,
  effectiveTo: true,
  status: true,
  supersedesObligationId: true,
  changeReason: true,
  endReason: true,
} satisfies Prisma.DeductionObligationSelect;

type ObligationRow = Prisma.DeductionObligationGetPayload<{ select: typeof obligationSelect }>;

const dateOf = (value: string) => new Date(`${value}T00:00:00.000Z`);

/**
 * Records, changes and ends an Employee's issuer-validated loan or deduction
 * obligation (payroll-schema.md §9). It stores what the issuer validated and
 * never calculates interest or amortization (#27). A change supersedes the
 * row with a successor, so every version of the terms stays.
 */
@Injectable()
export class DeductionObligationsService {
  constructor(@Inject(DocumentsService) private readonly documentsService: DocumentsService) {}

  /**
   * Every version of the Employee's obligations, active, superseded and ended,
   * oldest first, so a change reads after the version it supersedes.
   */
  async list(context: RequestContext, employeeId: string): Promise<DeductionObligationSummary[]> {
    this.assertPermission(context);
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const employee = await transaction.employee.findFirst({
        where: { agencyId: context.agencyId, id: employeeId },
        select: { id: true },
      });
      if (!employee) {
        throw new DeductionObligationsServiceError(
          'The Employee could not be found.',
          404,
          'EMPLOYEE_NOT_FOUND',
        );
      }
      const rows = await transaction.deductionObligation.findMany({
        where: { agencyId: context.agencyId, employeeId },
        orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
        select: obligationSelect,
      });
      return rows.map(summary);
    });
  }

  async record(
    context: RequestContext,
    employeeId: string,
    input: RecordDeductionObligationInput,
  ): Promise<DeductionObligationSummary> {
    this.assertPermission(context);
    return this.inTransaction(context, async (transaction) => {
      const employee = await transaction.employee.findFirst({
        where: { agencyId: context.agencyId, id: employeeId },
        select: { id: true },
      });
      if (!employee) {
        throw new DeductionObligationsServiceError(
          'The Employee could not be found.',
          404,
          'EMPLOYEE_NOT_FOUND',
        );
      }
      await this.assertAuthority(transaction, context, input);
      const payeeRuleVersionId = await this.allowedPayeeRuleVersion(
        transaction,
        input.payeeCategory,
        input.effectiveFrom,
      );
      const created = await transaction.deductionObligation.create({
        data: {
          agencyId: context.agencyId,
          employeeId,
          payeeCategory: input.payeeCategory,
          payeeName: input.payeeName,
          issuerReference: input.issuerReference,
          incurredOn: dateOf(input.incurredOn),
          ...termsData(input),
          payeeRuleVersionId,
          status: 'ACTIVE',
          recordedByMembershipId: context.membershipId,
        },
        select: obligationSelect,
      });
      const after = summary(created);
      await writeAudit(transaction, context, 'DEDUCTION_OBLIGATION_RECORDED', after, {
        previousStatus: null,
        reason: null,
        metadata: { after: { ...after } },
      });
      return after;
    });
  }

  async change(
    context: RequestContext,
    obligationId: string,
    input: ChangeDeductionObligationInput,
  ): Promise<DeductionObligationSummary> {
    this.assertPermission(context);
    return this.inTransaction(context, async (transaction) => {
      const current = await this.lockActive(transaction, context, obligationId);
      if (input.effectiveFrom < isoDateOf(current.effectiveFrom)) {
        throw new DeductionObligationsServiceError(
          'A change cannot take effect before the version it changes.',
          400,
          'DEDUCTION_OBLIGATION_EFFECTIVE_PERIOD_INVALID',
        );
      }
      await this.assertAuthority(transaction, context, input);
      // The GAA in effect when the new terms start must still allow the payee.
      const payeeRuleVersionId = await this.allowedPayeeRuleVersion(
        transaction,
        current.payeeCategory as DeductionPayeeCategory,
        input.effectiveFrom,
      );
      await transaction.deductionObligation.update({
        where: { id: current.id },
        data: { status: 'SUPERSEDED' },
      });
      const created = await transaction.deductionObligation.create({
        data: {
          agencyId: context.agencyId,
          employeeId: current.employeeId,
          payeeCategory: current.payeeCategory,
          payeeName: current.payeeName,
          issuerReference: current.issuerReference,
          incurredOn: current.incurredOn,
          ...termsData(input),
          payeeRuleVersionId,
          status: 'ACTIVE',
          supersedesObligationId: current.id,
          changeReason: input.reason,
          recordedByMembershipId: context.membershipId,
        },
        select: obligationSelect,
      });
      const before = summary(current);
      const after = summary(created);
      await writeAudit(transaction, context, 'DEDUCTION_OBLIGATION_CHANGED', after, {
        previousStatus: null,
        reason: input.reason,
        metadata: { before: { ...before }, after: { ...after } },
      });
      return after;
    });
  }

  async end(
    context: RequestContext,
    obligationId: string,
    input: EndDeductionObligationInput,
  ): Promise<DeductionObligationSummary> {
    this.assertPermission(context);
    return this.inTransaction(context, async (transaction) => {
      const current = await this.lockActive(transaction, context, obligationId);
      if (input.effectiveTo < isoDateOf(current.effectiveFrom)) {
        throw new DeductionObligationsServiceError(
          'An obligation cannot end before it takes effect.',
          400,
          'DEDUCTION_OBLIGATION_EFFECTIVE_PERIOD_INVALID',
        );
      }
      const ended = await transaction.deductionObligation.update({
        where: { id: current.id },
        data: {
          status: 'ENDED',
          effectiveTo: dateOf(input.effectiveTo),
          endReason: input.reason,
          endedByMembershipId: context.membershipId,
          endedAt: new Date(),
        },
        select: obligationSelect,
      });
      const before = summary(current);
      const after = summary(ended);
      await writeAudit(transaction, context, 'DEDUCTION_OBLIGATION_ENDED', after, {
        previousStatus: before.status,
        reason: input.reason,
        metadata: { before: { ...before }, after: { ...after } },
      });
      return after;
    });
  }

  private async inTransaction<T>(
    context: RequestContext,
    work: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await withDatabaseContext(requestDatabaseContext(context), work);
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new DeductionObligationsServiceError(
          'The Employee already has an active obligation with this payee and issuer reference.',
          409,
          'DEDUCTION_OBLIGATION_DUPLICATE',
        );
      }
      throw error;
    }
  }

  /** Locks the obligation; under RLS another Agency's obligation is not found. */
  private async lockActive(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    obligationId: string,
  ): Promise<ObligationRow> {
    await transaction.$queryRaw`SELECT id FROM deduction_obligations WHERE agency_id = ${context.agencyId}::uuid AND id = ${obligationId}::uuid FOR UPDATE`;
    const current = await transaction.deductionObligation.findFirst({
      where: { agencyId: context.agencyId, id: obligationId },
      select: obligationSelect,
    });
    if (!current) {
      throw new DeductionObligationsServiceError(
        'The Deduction Obligation could not be found.',
        404,
        'DEDUCTION_OBLIGATION_NOT_FOUND',
      );
    }
    if (current.status !== 'ACTIVE') {
      throw new DeductionObligationsServiceError(
        `A ${current.status.toLowerCase()} obligation cannot change; act on its active version.`,
        409,
        'DEDUCTION_OBLIGATION_NOT_ACTIVE',
      );
    }
    return current;
  }

  /** The id of the GAA rule version that allows the payee category on `on`, or a refusal. */
  private async allowedPayeeRuleVersion(
    transaction: Prisma.TransactionClient,
    payeeCategory: DeductionPayeeCategory,
    on: string,
  ): Promise<string> {
    const rule = await findAuthorizedDeductions(transaction, { on });
    if (rule.status === 'MISSING_RULE') {
      throw new DeductionObligationsServiceError(
        `No authorized-deductions rule version is in effect on ${on}, so no payee can be accepted.`,
        422,
        'PAYROLL_RULE_VERSION_MISSING',
      );
    }
    if (!rule.allowedPayeeCategories.includes(payeeCategory)) {
      throw new DeductionObligationsServiceError(
        `Rule version ${rule.ruleVersionCode} does not allow deductions payable to ${payeeCategory}.`,
        422,
        'DEDUCTION_PAYEE_NOT_ALLOWED',
      );
    }
    return rule.ruleVersionId;
  }

  private async assertAuthority(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    input: { authorityDocumentId: string; authorityDocumentVersionId: string },
  ): Promise<void> {
    const evidence = await this.documentsService.resolveExternalEvidenceInTransaction(
      transaction,
      context,
      {
        documentId: input.authorityDocumentId,
        versionId: input.authorityDocumentVersionId,
        allowSensitive: context.permissions.some(
          ({ code }) => code === 'documents.evidence.read_sensitive',
        ),
        requirement: 'FINALIZED_VERSION',
      },
    );
    if (evidence.ok) return;
    if (evidence.reason === 'STATUS_INELIGIBLE') {
      throw new DeductionObligationsServiceError(
        'Only a finalized Document Version can authorize a Deduction Obligation.',
        400,
        'DEDUCTION_OBLIGATION_AUTHORITY_INELIGIBLE',
      );
    }
    throw new DeductionObligationsServiceError(
      'The authorizing Document Version could not be found.',
      404,
      'DEDUCTION_OBLIGATION_AUTHORITY_NOT_FOUND',
    );
  }

  private assertPermission(context: RequestContext): void {
    if (!holdsAgencyWide(context, PERMISSION)) {
      throw new DeductionObligationsServiceError(
        `Managing Deduction Obligations needs the ${PERMISSION} permission for the whole Agency.`,
        403,
        'DEDUCTION_OBLIGATION_MANAGE_FORBIDDEN',
      );
    }
  }
}

function termsData(input: ChangeDeductionObligationInput | RecordDeductionObligationInput) {
  return {
    outstandingBalance: new Prisma.Decimal(input.outstandingBalance),
    scheduledAmount: new Prisma.Decimal(input.scheduledAmount),
    authorityDocumentVersionId: input.authorityDocumentVersionId,
    effectiveFrom: dateOf(input.effectiveFrom),
  };
}

function summary(row: ObligationRow): DeductionObligationSummary {
  return {
    ...row,
    payeeCategory: row.payeeCategory as DeductionPayeeCategory,
    status: row.status as DeductionObligationStatus,
    incurredOn: isoDateOf(row.incurredOn),
    outstandingBalance: row.outstandingBalance.toFixed(4),
    scheduledAmount: row.scheduledAmount.toFixed(4),
    effectiveFrom: isoDateOf(row.effectiveFrom),
    effectiveTo: row.effectiveTo ? isoDateOf(row.effectiveTo) : null,
  };
}

async function writeAudit(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  action: string,
  value: DeductionObligationSummary,
  input: { previousStatus: string | null; reason: string | null; metadata: Prisma.InputJsonObject },
): Promise<void> {
  await transaction.auditEvent.create({
    data: {
      agencyId: context.agencyId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      actorType: 'USER',
      action,
      entityType: 'DeductionObligation',
      entityId: value.id,
      previousStatus: input.previousStatus,
      newStatus: value.status,
      reason: input.reason,
      requestId: context.requestId,
      metadata: input.metadata,
    },
  });
}
