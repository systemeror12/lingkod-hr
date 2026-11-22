import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type DisbursementOutcome } from '@prisma/client';
import { holdsAgencyWide, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { z } from 'zod';
import { requestDatabaseContext } from '../database-context';
import { DocumentsService } from '../documents/documents.service';
import { claimPayrollFunction } from '../payroll-periods/payroll-period-actors';
import { PaymentExportsServiceError } from './payment-exports.service';

export const DISBURSEMENT_OUTCOME_RECORDED = 'DISBURSEMENT_OUTCOME_RECORDED';

export const DISBURSEMENT_OUTCOMES = [
  'SUBMITTED',
  'ACCEPTED',
  'REJECTED',
  'SETTLED',
  'RETURNED',
] as const;

export type DisbursementOutcomeKind = (typeof DISBURSEMENT_OUTCOMES)[number];

/** The latest outcomes that mean money may have moved, so the payroll cannot be voided (#330). */
export const VOID_BLOCKING_OUTCOMES = [
  'SUBMITTED',
  'ACCEPTED',
  'SETTLED',
] as const satisfies readonly DisbursementOutcomeKind[];

const REASONED_OUTCOMES: readonly DisbursementOutcomeKind[] = ['REJECTED', 'RETURNED'];

const PERMISSION = 'payroll.disbursement.update';

/**
 * One Disbursement Outcome of the instruction named in the route. `sequence`
 * is the place it takes in the instruction's order: one more than the
 * outcomes the Cashier read, so a stale or repeated submission is refused.
 * REJECTED and RETURNED need a reason, and only they take one.
 */
export const disbursementOutcomeSchema = z
  .object({
    outcome: z.enum(DISBURSEMENT_OUTCOMES),
    sequence: z.number().int().positive(),
    externalReference: z
      .string()
      .trim()
      .min(1, 'Enter the external reference or leave it out.')
      .max(200)
      .optional(),
    evidenceDocumentVersionId: z.string().uuid().optional(),
    reason: z.string().trim().min(1, 'A reason is required.').max(2000).optional(),
  })
  .strict()
  .superRefine((input, issues) => {
    const reasoned = REASONED_OUTCOMES.includes(input.outcome);
    if (reasoned && input.reason === undefined) {
      issues.addIssue({
        code: 'custom',
        path: ['reason'],
        message: `A ${input.outcome} outcome needs a reason.`,
      });
    }
    if (!reasoned && input.reason !== undefined) {
      issues.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'Only a REJECTED or RETURNED outcome takes a reason.',
      });
    }
  });

export type DisbursementOutcomeInput = z.input<typeof disbursementOutcomeSchema>;

export interface DisbursementOutcomeView {
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

/**
 * Records Disbursement Outcomes on the Payment Instructions of a FINALIZED
 * payroll (#28, #642). Outcomes are append-only and change no export,
 * instruction, or payroll row; an instruction's latest outcome is its highest
 * sequence. ACCEPTED does not imply SETTLED, and one export may hold mixed
 * outcomes. The docs give no order between outcomes, so any outcome may
 * follow any other.
 *
 * Recording needs `payroll.disbursement.update` held Agency-wide and claims
 * the DISBURSEMENT function on the instruction's Payroll Period (#330): a
 * person who holds another function there, such as its Payroll Approver, is
 * refused. The period row lock orders an outcome against a concurrent outcome
 * and against a void, which reads `instructionsBlockingVoid`.
 */
@Injectable()
export class DisbursementOutcomesService {
  constructor(@Inject(DocumentsService) private readonly documents: DocumentsService) {}

  async record(
    context: RequestContext,
    target: { periodId: string; exportId: string; instructionId: string },
    rawInput: unknown,
  ): Promise<DisbursementOutcomeView> {
    if (!holdsAgencyWide(context, PERMISSION)) {
      throw new PaymentExportsServiceError(
        `Recording a Disbursement Outcome needs the ${PERMISSION} permission for the whole Agency.`,
        403,
        'DISBURSEMENT_OUTCOME_FORBIDDEN',
      );
    }
    const input = parse(rawInput);
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      await lockFinalizedPeriod(transaction, context, target.periodId);
      const paymentExport = await transaction.paymentExport.findFirst({
        where: {
          agencyId: context.agencyId,
          payrollPeriodId: target.periodId,
          id: target.exportId,
        },
        select: { id: true },
      });
      const instruction =
        paymentExport &&
        (await transaction.paymentInstruction.findFirst({
          where: {
            agencyId: context.agencyId,
            paymentExportId: paymentExport.id,
            id: target.instructionId,
          },
          select: { id: true },
        }));
      if (!instruction) {
        throw new PaymentExportsServiceError(
          'The Payment Instruction could not be found.',
          404,
          'PAYMENT_INSTRUCTION_NOT_FOUND',
        );
      }

      const latest = await transaction.disbursementOutcome.findFirst({
        where: { agencyId: context.agencyId, paymentInstructionId: instruction.id },
        orderBy: { sequence: 'desc' },
        select: { sequence: true, outcome: true },
      });
      const sequence = (latest?.sequence ?? 0) + 1;
      if (input.sequence !== sequence) {
        throw new PaymentExportsServiceError(
          latest
            ? `This instruction's latest outcome is now ${latest.outcome} (#${latest.sequence}). Read it again before recording another.`
            : 'This instruction has no outcome yet; its first outcome is #1.',
          409,
          'DISBURSEMENT_OUTCOME_STALE',
        );
      }
      if (
        input.evidenceDocumentVersionId &&
        !(await this.documents.resolveFinalizedVersionInTransaction(
          transaction,
          context,
          input.evidenceDocumentVersionId,
        ))
      ) {
        throw new PaymentExportsServiceError(
          'The evidence must be an exact finalized Document Version of this Agency.',
          400,
          'DISBURSEMENT_OUTCOME_EVIDENCE_INVALID',
        );
      }
      const claim = await claimPayrollFunction(transaction, {
        agencyId: context.agencyId,
        payrollPeriodId: target.periodId,
        membershipId: context.membershipId,
        payrollFunction: 'DISBURSEMENT',
      });
      if (claim.outcome === 'REFUSED') {
        throw new PaymentExportsServiceError(
          `You act in ${claim.heldFunction} on this Payroll Period, so you cannot also act in DISBURSEMENT.`,
          409,
          'PAYROLL_FUNCTION_CONFLICT',
        );
      }

      const recorded = await transaction.disbursementOutcome.create({
        data: {
          agencyId: context.agencyId,
          paymentInstructionId: instruction.id,
          sequence,
          outcome: input.outcome,
          externalReference: input.externalReference ?? null,
          evidenceDocumentVersionId: input.evidenceDocumentVersionId ?? null,
          reason: input.reason ?? null,
          recordedByMembershipId: context.membershipId,
        },
      });
      await transaction.auditEvent.create({
        data: {
          agencyId: context.agencyId,
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          actorType: 'USER',
          entityType: 'PaymentInstruction',
          entityId: instruction.id,
          action: DISBURSEMENT_OUTCOME_RECORDED,
          previousStatus: latest?.outcome ?? null,
          newStatus: recorded.outcome,
          reason: recorded.reason,
          requestId: context.requestId,
          metadata: {
            payrollPeriodId: target.periodId,
            paymentExportId: target.exportId,
            disbursementOutcomeId: recorded.id,
            sequence,
            externalReference: recorded.externalReference,
            evidenceDocumentVersionId: recorded.evidenceDocumentVersionId,
          },
          idempotencyKey: `sequence-${sequence}`,
        },
      });
      return toView(recorded);
    });
  }
}

/**
 * The Payment Instructions of a Payroll Period whose latest Disbursement
 * Outcome is SUBMITTED, ACCEPTED, or SETTLED. A void request or approval of
 * the period is refused while this is not empty (hris-controls.md §5.20,
 * #358). Call it in the void's transaction after locking the period row
 * FOR UPDATE: recording an outcome takes the same lock, so the answer holds
 * until the void commits.
 */
export async function instructionsBlockingVoid(
  transaction: Prisma.TransactionClient,
  period: { agencyId: string; payrollPeriodId: string },
): Promise<{ paymentInstructionId: string; outcome: DisbursementOutcomeKind }[]> {
  const rows = await transaction.$queryRaw<{ payment_instruction_id: string; outcome: string }[]>`
    SELECT latest."payment_instruction_id", latest."outcome"
    FROM (
      SELECT DISTINCT ON (o."payment_instruction_id")
             o."payment_instruction_id"::text, o."outcome"
      FROM "disbursement_outcomes" o
      JOIN "payment_instructions" i
        ON i."agency_id" = o."agency_id" AND i."id" = o."payment_instruction_id"
      JOIN "payment_exports" x
        ON x."agency_id" = i."agency_id" AND x."id" = i."payment_export_id"
      WHERE o."agency_id" = CAST(${period.agencyId} AS uuid)
        AND x."payroll_period_id" = CAST(${period.payrollPeriodId} AS uuid)
      ORDER BY o."payment_instruction_id", o."sequence" DESC
    ) latest
    WHERE latest."outcome" IN (${Prisma.join(VOID_BLOCKING_OUTCOMES)})
    ORDER BY latest."payment_instruction_id"
  `;
  return rows.map((row) => ({
    paymentInstructionId: row.payment_instruction_id,
    outcome: row.outcome as DisbursementOutcomeKind,
  }));
}

function parse(rawInput: unknown): z.output<typeof disbursementOutcomeSchema> {
  const parsed = disbursementOutcomeSchema.safeParse(rawInput);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  throw new PaymentExportsServiceError(
    `${issue?.path.map(String).join('.') || 'request'}: ${issue?.message ?? 'invalid'}`,
    400,
    'INVALID_INPUT',
  );
}

/** The period, locked until the command commits; only a FINALIZED payroll takes outcomes. */
async function lockFinalizedPeriod(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  periodId: string,
): Promise<void> {
  const [row] = await transaction.$queryRaw<{ status: string }[]>`
    SELECT "status" FROM "payroll_periods"
    WHERE "agency_id" = CAST(${context.agencyId} AS uuid)
      AND "id" = CAST(${periodId} AS uuid)
    FOR UPDATE
  `;
  if (!row) {
    throw new PaymentExportsServiceError(
      'The Payroll Period could not be found.',
      404,
      'PAYROLL_PERIOD_NOT_FOUND',
    );
  }
  if (row.status !== 'FINALIZED') {
    throw new PaymentExportsServiceError(
      `The Payroll Period is ${row.status}; Disbursement Outcomes are recorded only on a FINALIZED payroll.`,
      409,
      'DISBURSEMENT_OUTCOME_PAYROLL_NOT_FINALIZED',
    );
  }
}

function toView(row: DisbursementOutcome): DisbursementOutcomeView {
  return {
    id: row.id,
    paymentInstructionId: row.paymentInstructionId,
    sequence: row.sequence,
    outcome: row.outcome as DisbursementOutcomeKind,
    externalReference: row.externalReference,
    evidenceDocumentVersionId: row.evidenceDocumentVersionId,
    reason: row.reason,
    recordedByMembershipId: row.recordedByMembershipId,
    recordedAt: row.recordedAt.toISOString(),
  };
}
