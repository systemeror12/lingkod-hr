import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { holdsAgencyWide, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import { DocumentsService } from '../documents/documents.service';
import type { RecordContributionBillingInput } from './contribution-billings.schemas';

export interface ContributionBillingSummary {
  id: string;
  employeeId: string;
  employeeShare: string;
  employerShare: string;
  supersedesContributionBillingId: string | null;
}

export interface RecordedContributionBilling {
  payrollPeriodId: string;
  contributionType: RecordContributionBillingInput['contributionType'];
  evidenceDocumentVersionId: string;
  billings: ContributionBillingSummary[];
}

/**
 * One recorded billing row of a period. `current` is false once a later
 * billing of the same Employee and contribution type supersedes it.
 */
export interface ContributionBillingView extends ContributionBillingSummary {
  contributionType: RecordContributionBillingInput['contributionType'];
  evidenceDocumentVersionId: string;
  recordedAt: string;
  current: boolean;
}

export class ContributionBillingsServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ContributionBillingsServiceError';
  }
}

const PERMISSION = 'payroll.deductions.manage';
const READ_PERMISSION = 'payroll.periods.read';

/**
 * The current billing of each Employee and contribution type among `billings`:
 * the one no other row supersedes. Billings are only inserted, and a
 * correction names the row it supersedes (migration 0175).
 */
export function currentBillings<
  T extends { id: string; supersedesContributionBillingId: string | null },
>(billings: readonly T[]): T[] {
  const superseded = new Set(billings.map((billing) => billing.supersedesContributionBillingId));
  return billings.filter((billing) => !superseded.has(billing.id));
}

/**
 * Records an issuer's validated contribution billing for a regular Payroll
 * Period in `DRAFT` (payroll-schema.md §9, #349), so the next calculation
 * compares it with the Contribution Lines it calculates. The billing is
 * evidence, never a rule: it writes no line, and a difference is a blocking
 * Payroll Exception until explained. Recording an Employee's billing again
 * corrects it, keeping the earlier row.
 */
@Injectable()
export class ContributionBillingsService {
  constructor(@Inject(DocumentsService) private readonly documentsService: DocumentsService) {}

  /**
   * Every billing recorded for the period, current and superseded, by
   * contribution type and then in the order recorded. It is read with the
   * period, so it needs `payroll.periods.read` for the whole Agency.
   */
  async list(context: RequestContext, periodId: string): Promise<ContributionBillingView[]> {
    if (!holdsAgencyWide(context, READ_PERMISSION)) {
      throw new ContributionBillingsServiceError(
        `Reading contribution billing needs the ${READ_PERMISSION} permission for the whole Agency.`,
        403,
        'CONTRIBUTION_BILLING_READ_FORBIDDEN',
      );
    }
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const period = await transaction.payrollPeriod.findUnique({
        where: { agencyId_id: { agencyId: context.agencyId, id: periodId } },
        select: { id: true },
      });
      if (!period) {
        throw new ContributionBillingsServiceError(
          'The Payroll Period could not be found.',
          404,
          'PAYROLL_PERIOD_NOT_FOUND',
        );
      }
      const rows = await transaction.contributionBilling.findMany({
        where: { agencyId: context.agencyId, payrollPeriodId: periodId },
        orderBy: [{ contributionType: 'asc' }, { recordedAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          employeeId: true,
          contributionType: true,
          employeeShare: true,
          employerShare: true,
          evidenceDocumentVersionId: true,
          supersedesContributionBillingId: true,
          recordedAt: true,
        },
      });
      const current = new Set(currentBillings(rows).map((row) => row.id));
      return rows.map((row) => ({
        ...row,
        contributionType: row.contributionType as ContributionBillingView['contributionType'],
        employeeShare: row.employeeShare.toFixed(2),
        employerShare: row.employerShare.toFixed(2),
        recordedAt: row.recordedAt.toISOString(),
        current: current.has(row.id),
      }));
    });
  }

  async record(
    context: RequestContext,
    periodId: string,
    input: RecordContributionBillingInput,
  ): Promise<RecordedContributionBilling> {
    if (!holdsAgencyWide(context, PERMISSION)) {
      throw new ContributionBillingsServiceError(
        `Recording contribution billing needs the ${PERMISSION} permission for the whole Agency.`,
        403,
        'CONTRIBUTION_BILLING_RECORD_FORBIDDEN',
      );
    }
    try {
      return await withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
        // FOR SHARE: a concurrent start of calculation waits for this billing.
        const [period] = await transaction.$queryRaw<{ status: string; run_type: string }[]>`
          SELECT "status", "run_type" FROM "payroll_periods"
          WHERE "agency_id" = CAST(${context.agencyId} AS uuid)
            AND "id" = CAST(${periodId} AS uuid)
          FOR SHARE
        `;
        if (!period) {
          throw new ContributionBillingsServiceError(
            'The Payroll Period could not be found.',
            404,
            'PAYROLL_PERIOD_NOT_FOUND',
          );
        }
        if (period.run_type !== 'REGULAR' || period.status !== 'DRAFT') {
          throw new ContributionBillingsServiceError(
            'Contribution billing is recorded only for a regular Payroll Period in DRAFT, so the next calculation compares it.',
            409,
            'CONTRIBUTION_BILLING_PERIOD_NOT_DRAFT',
          );
        }
        await this.assertEvidence(transaction, context, input);

        const employeeIds = input.lines.map((line) => line.employeeId);
        const found = new Set(
          (
            await transaction.employee.findMany({
              where: { agencyId: context.agencyId, id: { in: employeeIds } },
              select: { id: true },
            })
          ).map((employee) => employee.id),
        );
        const missing = employeeIds.filter((id) => !found.has(id));
        if (missing.length > 0) {
          throw new ContributionBillingsServiceError(
            `These Employees could not be found: ${missing.join(', ')}.`,
            404,
            'EMPLOYEE_NOT_FOUND',
          );
        }

        const current = new Map(
          currentBillings(
            await transaction.contributionBilling.findMany({
              where: {
                agencyId: context.agencyId,
                payrollPeriodId: periodId,
                contributionType: input.contributionType,
                employeeId: { in: employeeIds },
              },
              select: { id: true, employeeId: true, supersedesContributionBillingId: true },
            }),
          ).map((billing) => [billing.employeeId, billing.id]),
        );
        const created = await transaction.contributionBilling.createManyAndReturn({
          data: input.lines.map((line) => ({
            agencyId: context.agencyId,
            payrollPeriodId: periodId,
            employeeId: line.employeeId,
            contributionType: input.contributionType,
            employeeShare: new Prisma.Decimal(line.employeeShare),
            employerShare: new Prisma.Decimal(line.employerShare),
            evidenceDocumentVersionId: input.evidenceDocumentVersionId,
            supersedesContributionBillingId: current.get(line.employeeId) ?? null,
            recordedByMembershipId: context.membershipId,
          })),
          select: {
            id: true,
            employeeId: true,
            employeeShare: true,
            employerShare: true,
            supersedesContributionBillingId: true,
          },
        });
        const recorded: RecordedContributionBilling = {
          payrollPeriodId: periodId,
          contributionType: input.contributionType,
          evidenceDocumentVersionId: input.evidenceDocumentVersionId,
          billings: created.map((billing) => ({
            ...billing,
            employeeShare: billing.employeeShare.toFixed(2),
            employerShare: billing.employerShare.toFixed(2),
          })),
        };
        await transaction.auditEvent.create({
          data: {
            agencyId: context.agencyId,
            actorUserId: context.userId,
            actorMembershipId: context.membershipId,
            actorType: 'USER',
            action: 'CONTRIBUTION_BILLING_RECORDED',
            entityType: 'PayrollPeriod',
            entityId: periodId,
            requestId: context.requestId,
            metadata: {
              contributionType: recorded.contributionType,
              evidenceDocumentVersionId: recorded.evidenceDocumentVersionId,
              billings: recorded.billings.map((billing) => ({ ...billing })),
            },
          },
        });
        return recorded;
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ContributionBillingsServiceError(
          'Another billing for these Employees was recorded at the same time; record it again.',
          409,
          'CONTRIBUTION_BILLING_CONFLICT',
        );
      }
      throw error;
    }
  }

  private async assertEvidence(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    input: RecordContributionBillingInput,
  ): Promise<void> {
    const evidence = await this.documentsService.resolveExternalEvidenceInTransaction(
      transaction,
      context,
      {
        documentId: input.evidenceDocumentId,
        versionId: input.evidenceDocumentVersionId,
        allowSensitive: context.permissions.some(
          ({ code }) => code === 'documents.evidence.read_sensitive',
        ),
        requirement: 'FINALIZED_VERSION',
      },
    );
    if (evidence.ok) return;
    if (evidence.reason === 'STATUS_INELIGIBLE') {
      throw new ContributionBillingsServiceError(
        'Only a finalized Document Version can evidence a contribution billing.',
        400,
        'CONTRIBUTION_BILLING_EVIDENCE_INELIGIBLE',
      );
    }
    throw new ContributionBillingsServiceError(
      'The evidence Document Version could not be found.',
      404,
      'CONTRIBUTION_BILLING_EVIDENCE_NOT_FOUND',
    );
  }
}
