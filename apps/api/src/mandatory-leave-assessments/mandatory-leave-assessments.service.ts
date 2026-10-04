import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import { findLeaveCatalogueEntry } from '../leave-policies/leave-catalogue';
import {
  mandatoryLeaveAssessmentCursorSchema,
  mandatoryLeaveEmployeeCursorSchema,
} from './mandatory-leave-assessments.schemas';
import {
  evaluateMandatoryLeave,
  type MandatoryLeaveEvaluation,
  type MandatoryLeaveResult,
} from './mandatory-leave-evaluator';

export interface MandatoryLeaveAssessmentAuditWriter {
  write(
    transaction: Prisma.TransactionClient,
    event: Prisma.AuditEventUncheckedCreateInput,
  ): Promise<void>;
}

export const MANDATORY_LEAVE_ASSESSMENT_AUDIT_WRITER = Symbol(
  'MANDATORY_LEAVE_ASSESSMENT_AUDIT_WRITER',
);

export const mandatoryLeaveAssessmentAuditWriter: MandatoryLeaveAssessmentAuditWriter = {
  async write(transaction, event): Promise<void> {
    await transaction.auditEvent.create({ data: event });
  },
};

export class MandatoryLeaveAssessmentServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
    readonly reasons: string[] = [],
  ) {
    super(message);
    this.name = 'MandatoryLeaveAssessmentServiceError';
  }
}

export interface MandatoryLeaveAssessmentFilters {
  employeeId?: string | undefined;
  year?: number | undefined;
  result?: MandatoryLeaveResult | undefined;
}

export interface MandatoryLeaveAssessmentPageRequest {
  limit?: number | undefined;
  cursor?: string | undefined;
}

export interface MandatoryLeaveAssessmentPage {
  items: MandatoryLeaveAssessmentSummary[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface MandatoryLeaveAssessmentSummary {
  id: string;
  agencyId: string;
  employeeId: string;
  employeeNumber: string;
  employeeName: string;
  assessmentYear: number;
  assessmentDate: string;
  result: MandatoryLeaveResult;
  requiredQuantity: string | null;
  fulfilledQuantity: string | null;
  policyVersionId: string | null;
  leaveAccountId: string | null;
  previousAssessmentId: string | null;
  isLatest: boolean;
  assessedAt: string;
}

/** One in-scope Employee and its latest assessment for a year, or null when not yet evaluated. */
export interface MandatoryLeaveEmployeeLatest {
  employeeId: string;
  employeeNumber: string;
  employeeName: string;
  assessment: MandatoryLeaveAssessmentSummary | null;
}

export interface MandatoryLeaveEmployeeLatestPage {
  assessmentYear: number;
  items: MandatoryLeaveEmployeeLatest[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface MandatoryLeaveAssessmentDetail extends MandatoryLeaveAssessmentSummary {
  materialFingerprint: string;
  inputFacts: Prisma.JsonValue;
  ruleResults: Prisma.JsonValue;
}

export interface MandatoryLeaveAgencyEvaluation {
  assessmentYear: number;
  assessmentDate: string;
  employeeCount: number;
  recordedCount: number;
  unchangedCount: number;
  results: Record<MandatoryLeaveResult, number>;
}

export interface MandatoryLeaveEmployeeEvaluation {
  assessmentId: string;
  result: MandatoryLeaveResult;
  recorded: boolean;
}

const assessmentSelect = {
  id: true,
  agencyId: true,
  employeeId: true,
  assessmentYear: true,
  assessmentDate: true,
  result: true,
  requiredQuantity: true,
  fulfilledQuantity: true,
  policyVersionId: true,
  leaveAccountId: true,
  previousAssessmentId: true,
  materialFingerprint: true,
  inputFacts: true,
  ruleResults: true,
  assessedAt: true,
  employee: {
    select: {
      employeeNumber: true,
      legalName: true,
      memberships: { select: { id: true } },
    },
  },
  successors: { select: { id: true } },
} as const;

type AssessmentRecord = Prisma.MandatoryLeaveAssessmentGetPayload<{
  select: typeof assessmentSelect;
}>;

const MANDATORY_LEAVE_CODE = 'MANDATORY_LEAVE';
const VACATION_LEAVE_CODE =
  findLeaveCatalogueEntry(MANDATORY_LEAVE_CODE)?.chargedLeaveTypeCode ?? '';
const PROFILE = 'ORDINARY_CIVILIAN_NGA';

@Injectable()
export class MandatoryLeaveAssessmentsService {
  constructor(
    @Inject(MANDATORY_LEAVE_ASSESSMENT_AUDIT_WRITER)
    private readonly auditWriter: MandatoryLeaveAssessmentAuditWriter,
  ) {}

  /**
   * Evaluates every Employee in the active Agency for one calendar year. Each
   * Employee is evaluated in its own transaction; a new assessment is recorded
   * only when its material fingerprint differs from the latest one.
   */
  async evaluateAgencyYear(
    context: RequestContext,
    assessmentYear: number,
  ): Promise<MandatoryLeaveAgencyEvaluation> {
    if (!hasScope(context, 'leave.mandatory_assessments.evaluate', 'AGENCY')) {
      throw new MandatoryLeaveAssessmentServiceError(
        'The leave.mandatory_assessments.evaluate permission is required.',
        403,
        'MANDATORY_LEAVE_ASSESSMENT_EVALUATE_FORBIDDEN',
      );
    }
    const assessmentDate = assessmentDateFor(assessmentYear);
    const databaseContext = requestDatabaseContext(context);
    const employees = await withDatabaseContext(databaseContext, (transaction) =>
      transaction.employee.findMany({
        where: { agencyId: context.agencyId },
        orderBy: { id: 'asc' },
        select: { id: true },
      }),
    );
    const summary: MandatoryLeaveAgencyEvaluation = {
      assessmentYear,
      assessmentDate,
      employeeCount: employees.length,
      recordedCount: 0,
      unchangedCount: 0,
      results: { SUBJECT: 0, NOT_SUBJECT: 0, INDETERMINATE: 0 },
    };
    for (const employee of employees) {
      const outcome = await withDatabaseContext(databaseContext, async (transaction) => {
        await lockAgencyYear(transaction, context.agencyId, assessmentYear, 'SHARED');
        const evaluated = await this.evaluateEmployeeYear(
          transaction,
          context.agencyId,
          employee.id,
          assessmentYear,
          assessmentDate,
        );
        if (evaluated.recorded) {
          await this.auditRecorded(
            transaction,
            context,
            employee.id,
            assessmentYear,
            assessmentDate,
            evaluated,
          );
        }
        return evaluated;
      });
      summary.results[outcome.result] += 1;
      if (outcome.recorded) summary.recordedCount += 1;
      else summary.unchangedCount += 1;
    }
    await withDatabaseContext(databaseContext, (transaction) =>
      this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'leave.mandatory_assessments.evaluated',
        entityType: 'Agency',
        entityId: context.agencyId,
        requestId: context.requestId,
        metadata: { ...summary },
      }),
    );
    return summary;
  }

  /**
   * Re-evaluates the owners of vacation Leave Accounts touched by ledger
   * entries, inside the source command's transaction. Call it after the
   * command's ledger, posting, and cancellation writes; a failure must roll the
   * command back so an assessment never lags a committed source. Entries on
   * other Leave Accounts are ignored.
   */
  async reevaluateLeaveAccounts(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    entries: readonly { leaveAccountId: string; effectiveDate: Date }[],
  ): Promise<void> {
    if (!entries.length) return;
    const accounts = await transaction.leaveAccount.findMany({
      where: {
        agencyId: context.agencyId,
        id: { in: [...new Set(entries.map((entry) => entry.leaveAccountId))] },
        leaveType: { code: VACATION_LEAVE_CODE },
      },
      select: { id: true, employeeId: true },
    });
    const fromYearByEmployee = new Map<string, number>();
    for (const entry of entries) {
      const account = accounts.find(({ id }) => id === entry.leaveAccountId);
      if (!account) continue;
      const year = entry.effectiveDate.getUTCFullYear();
      const current = fromYearByEmployee.get(account.employeeId);
      if (current === undefined || year < current) fromYearByEmployee.set(account.employeeId, year);
    }
    for (const [employeeId, fromYear] of [...fromYearByEmployee].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      await this.reevaluate(transaction, context, fromYear, employeeId);
    }
  }

  /**
   * Re-evaluates every assessed Employee in the Agency from the activated
   * Mandatory Leave policy version's effective year, inside the activation's
   * transaction.
   */
  async reevaluateAgency(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    effectiveFrom: Date,
  ): Promise<void> {
    await this.reevaluate(transaction, context, effectiveFrom.getUTCFullYear());
  }

  /**
   * Re-evaluates each already-assessed Employee and year from `fromYear` through
   * the current year; a past year uses December 31. Years without an assessment
   * are left to the Agency/year evaluation, which covers new years and backfill.
   */
  private async reevaluate(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    fromYear: number,
    employeeId?: string,
  ): Promise<void> {
    const currentYear = Number(manilaToday().slice(0, 4));
    let pairs: { employeeId: string; assessmentYear: number }[] = [];
    if (employeeId) {
      // Whether a year is assessed is read under that year's Employee lock, so
      // a first assessment still being written is waited for, not skipped.
      for (let year = fromYear; year <= currentYear; year += 1) {
        pairs.push({ employeeId, assessmentYear: year });
      }
    } else {
      // The exclusive Agency-year locks wait out in-flight Agency/year
      // evaluations, so the first assessments they write are listed here.
      for (let year = fromYear; year <= currentYear; year += 1) {
        await lockAgencyYear(transaction, context.agencyId, year, 'EXCLUSIVE');
      }
      pairs = await transaction.mandatoryLeaveAssessment.findMany({
        where: {
          agencyId: context.agencyId,
          assessmentYear: { gte: fromYear },
          previousAssessmentId: null,
        },
        orderBy: [{ employeeId: 'asc' }, { assessmentYear: 'asc' }],
        select: { employeeId: true, assessmentYear: true },
      });
    }
    for (const pair of pairs) {
      const assessmentDate = assessmentDateFor(pair.assessmentYear);
      const evaluated = await this.evaluateUnderLock(
        transaction,
        context.agencyId,
        pair.employeeId,
        pair.assessmentYear,
        assessmentDate,
        true,
      );
      if (evaluated?.recorded) {
        await this.auditRecorded(
          transaction,
          context,
          pair.employeeId,
          pair.assessmentYear,
          assessmentDate,
          evaluated,
        );
      }
    }
  }

  private async auditRecorded(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    employeeId: string,
    assessmentYear: number,
    assessmentDate: string,
    evaluated: MandatoryLeaveEmployeeEvaluation,
  ): Promise<void> {
    await this.auditWriter.write(transaction, {
      agencyId: context.agencyId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      actorType: 'USER',
      action: 'leave.mandatory_assessment.recorded',
      entityType: 'MandatoryLeaveAssessment',
      entityId: evaluated.assessmentId,
      requestId: context.requestId,
      metadata: { employeeId, assessmentYear, assessmentDate, result: evaluated.result },
    });
  }

  /**
   * Evaluates one Employee and year inside the caller's transaction and appends
   * a successor only when the material fingerprint changed. A transaction-level
   * advisory lock serializes evaluators of the same Employee and year so they
   * extend one chain; the chain's unique constraints remain the backstop. This
   * never writes a ledger entry or forfeits credits.
   */
  async evaluateEmployeeYear(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    employeeId: string,
    assessmentYear: number,
    assessmentDate: string,
  ): Promise<MandatoryLeaveEmployeeEvaluation> {
    return (await this.evaluateUnderLock(
      transaction,
      agencyId,
      employeeId,
      assessmentYear,
      assessmentDate,
      false,
    ))!;
  }

  /**
   * Every source writer re-evaluates after its own writes, under this lock, so
   * an evaluator that reads before a writer commits is followed by that
   * writer's re-evaluation. With `onlyIfAssessed`, an unassessed year is left
   * alone and returns null.
   */
  private async evaluateUnderLock(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    employeeId: string,
    assessmentYear: number,
    assessmentDate: string,
    onlyIfAssessed: boolean,
  ): Promise<MandatoryLeaveEmployeeEvaluation | null> {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mandatory_leave_assessment:${agencyId}:${employeeId}:${assessmentYear}`}, 0))`;
    const latest = await transaction.mandatoryLeaveAssessment.findFirst({
      where: { agencyId, employeeId, assessmentYear, successors: { none: {} } },
      select: { id: true, result: true, materialFingerprint: true },
    });
    if (!latest && onlyIfAssessed) return null;
    const evaluation = await this.evaluate(
      transaction,
      agencyId,
      employeeId,
      assessmentYear,
      assessmentDate,
    );
    if (latest && latest.materialFingerprint === evaluation.materialFingerprint) {
      return {
        assessmentId: latest.id,
        result: latest.result as MandatoryLeaveResult,
        recorded: false,
      };
    }
    const created = await transaction.mandatoryLeaveAssessment.create({
      data: {
        agencyId,
        employeeId,
        assessmentYear,
        assessmentDate: toDatabaseDate(assessmentDate),
        previousAssessmentId: latest?.id ?? null,
        policyVersionId: evaluation.policyVersionId,
        leaveAccountId: evaluation.leaveAccountId,
        result: evaluation.result,
        requiredQuantity: evaluation.requiredQuantity,
        fulfilledQuantity: evaluation.fulfilledQuantity,
        materialFingerprint: evaluation.materialFingerprint,
        inputFacts: evaluation.inputFacts as unknown as Prisma.InputJsonValue,
        ruleResults: evaluation.ruleResults as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return { assessmentId: created.id, result: evaluation.result, recorded: true };
  }

  /**
   * Lists assessments by year (newest first), Employee name, and assessment time
   * (newest first). Pages continue from an opaque keyset cursor.
   */
  async list(
    context: RequestContext,
    filters: MandatoryLeaveAssessmentFilters = {},
    page: MandatoryLeaveAssessmentPageRequest = {},
  ): Promise<MandatoryLeaveAssessmentPage> {
    const scope = requireReadScope(context);
    const limit = page.limit ?? 25;
    const cursor = page.cursor ? decodeCursor(page.cursor) : null;
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const records = await transaction.mandatoryLeaveAssessment.findMany({
        where: {
          agencyId: context.agencyId,
          ...(filters.employeeId ? { employeeId: filters.employeeId } : {}),
          ...(filters.year ? { assessmentYear: filters.year } : {}),
          ...(filters.result ? { result: filters.result } : {}),
          ...(scope === 'OWN'
            ? { employee: { memberships: { some: { id: context.membershipId } } } }
            : {}),
          ...(cursor ? { AND: [afterCursor(cursor)] } : {}),
        },
        orderBy: [
          { assessmentYear: 'desc' },
          { employee: { legalName: 'asc' } },
          { assessedAt: 'desc' },
          { id: 'asc' },
        ],
        take: limit + 1,
        select: assessmentSelect,
      });
      const hasMore = records.length > limit;
      const items = records.slice(0, limit);
      const last = items.at(-1);
      return {
        items: items.map(summaryOf),
        hasMore,
        nextCursor:
          hasMore && last
            ? encodeCursor({
                assessmentYear: last.assessmentYear,
                legalName: last.employee.legalName,
                assessedAt: last.assessedAt.toISOString(),
                id: last.id,
              })
            : null,
      };
    });
  }

  /**
   * Lists every in-scope Employee by name with its latest assessment for the
   * year. An Employee the Agency/year evaluation has not reached yet has a null
   * assessment. Pages continue from an opaque keyset cursor.
   */
  async latestByEmployee(
    context: RequestContext,
    assessmentYear: number,
    page: MandatoryLeaveAssessmentPageRequest = {},
  ): Promise<MandatoryLeaveEmployeeLatestPage> {
    const scope = requireReadScope(context);
    const limit = page.limit ?? 25;
    const cursor = page.cursor ? decodeEmployeeCursor(page.cursor) : null;
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const employees = await transaction.employee.findMany({
        where: {
          agencyId: context.agencyId,
          ...(scope === 'OWN' ? { memberships: { some: { id: context.membershipId } } } : {}),
          ...(cursor
            ? {
                OR: [
                  { legalName: { gt: cursor.legalName } },
                  { legalName: cursor.legalName, id: { gt: cursor.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ legalName: 'asc' }, { id: 'asc' }],
        take: limit + 1,
        select: {
          id: true,
          employeeNumber: true,
          legalName: true,
          mandatoryLeaveAssessments: {
            where: { assessmentYear, successors: { none: {} } },
            select: assessmentSelect,
            take: 1,
          },
        },
      });
      const hasMore = employees.length > limit;
      const items = employees.slice(0, limit);
      const last = items.at(-1);
      return {
        assessmentYear,
        items: items.map((employee) => {
          const latest = employee.mandatoryLeaveAssessments[0];
          return {
            employeeId: employee.id,
            employeeNumber: employee.employeeNumber,
            employeeName: employee.legalName,
            assessment: latest ? summaryOf(latest) : null,
          };
        }),
        hasMore,
        nextCursor:
          hasMore && last ? encodeCursor({ legalName: last.legalName, id: last.id }) : null,
      };
    });
  }

  async findById(
    context: RequestContext,
    assessmentId: string,
  ): Promise<MandatoryLeaveAssessmentDetail | null> {
    const scope = requireReadScope(context);
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const record = await transaction.mandatoryLeaveAssessment.findFirst({
        where: { agencyId: context.agencyId, id: assessmentId },
        select: assessmentSelect,
      });
      if (!record) return null;
      if (
        scope === 'OWN' &&
        !record.employee.memberships.some((membership) => membership.id === context.membershipId)
      ) {
        return null;
      }
      return {
        ...summaryOf(record),
        materialFingerprint: record.materialFingerprint,
        inputFacts: record.inputFacts,
        ruleResults: record.ruleResults,
      };
    });
  }

  private async evaluate(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    employeeId: string,
    assessmentYear: number,
    asOf: string,
  ): Promise<MandatoryLeaveEvaluation> {
    const asOfDate = toDatabaseDate(asOf);
    const yearStart = toDatabaseDate(`${assessmentYear}-01-01`);
    const yearEnd = toDatabaseDate(`${assessmentYear}-12-31`);
    const policy = await transaction.leavePolicyVersion.findFirst({
      where: {
        agencyId,
        leaveType: { code: MANDATORY_LEAVE_CODE },
        status: { in: ['ACTIVE', 'SUPERSEDED'] },
        effectiveFrom: { lte: asOfDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOfDate } }],
      },
      orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
      select: {
        id: true,
        versionNo: true,
        evaluatorKind: true,
        ruleParameters: true,
        applicabilityRules: true,
        chargedLeaveTypeId: true,
        leaveType: { select: { code: true } },
        chargedLeaveType: { select: { code: true } },
      },
    });

    const vacationLeaveTypeId =
      policy?.chargedLeaveTypeId ??
      (
        await transaction.leaveType.findFirst({
          where: {
            agencyId,
            code: VACATION_LEAVE_CODE,
          },
          select: { id: true },
        })
      )?.id ??
      null;
    const accountWhere = {
      agencyId,
      employeeId,
      leaveTypeId: vacationLeaveTypeId ?? '',
      openedAt: { lte: asOfDate },
      OR: [{ closedAt: null }, { closedAt: { gte: yearStart } }],
    } satisfies Prisma.LeaveAccountWhereInput;
    // Every ledger writer re-evaluates under this Employee-year lock before it
    // commits, so these reads cannot interleave with a writer's commit.
    const accounts = vacationLeaveTypeId
      ? await transaction.leaveAccount.findMany({
          where: accountWhere,
          orderBy: { openedAt: 'asc' },
          select: { id: true, status: true, openedAt: true, closedAt: true },
        })
      : [];
    const accountIds = accounts.map((account) => account.id);
    const ledgerEntries = accountIds.length
      ? await transaction.leaveLedgerEntry.findMany({
          where: { agencyId, leaveAccountId: { in: accountIds }, effectiveDate: { lte: asOfDate } },
          // Posting order at PostgreSQL's microsecond precision, which Date would truncate.
          orderBy: [{ postedAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            leaveAccountId: true,
            effectiveDate: true,
            quantity: true,
            reversesEntryId: true,
          },
        })
      : [];
    const lines = accountIds.length
      ? await transaction.leaveApprovalAllocationLine.findMany({
          where: {
            agencyId,
            allocationKind: 'LEAVE_ACCOUNT',
            leaveAccountId: { in: accountIds },
            dateFrom: { lte: yearEnd },
            dateTo: { gte: yearStart },
            leaveApprovalAllocation: { postings: { some: {} } },
          },
          select: {
            id: true,
            leaveAccountId: true,
            dateFrom: true,
            dateTo: true,
            quantity: true,
            unitCode: true,
            leaveApprovalAllocation: {
              select: {
                leaveApplicationVersionId: true,
                postings: { select: { id: true }, take: 1 },
              },
            },
            cancellationScopes: {
              where: { leaveCancellation: { effectStatus: 'APPLIED' } },
              select: { quantity: true },
            },
          },
        })
      : [];

    return evaluateMandatoryLeave({
      assessmentYear,
      asOf,
      personnelProfile: {
        profile: policy && admitsProfile(policy.applicabilityRules) ? PROFILE : null,
        basis: 'POLICY_APPLICABILITY',
      },
      policy: policy
        ? {
            id: policy.id,
            versionNo: policy.versionNo,
            leaveTypeCode: policy.leaveType.code,
            evaluatorKind: policy.evaluatorKind,
            chargedLeaveTypeCode: policy.chargedLeaveType?.code ?? null,
            ruleParameters: policy.ruleParameters,
          }
        : null,
      vacationAccounts: accounts.map((account) => ({
        id: account.id,
        status: account.status,
        openedAt: formatDate(account.openedAt),
        closedAt: account.closedAt ? formatDate(account.closedAt) : null,
      })),
      ledgerEntries: ledgerEntries.map((entry) => ({
        id: entry.id,
        leaveAccountId: entry.leaveAccountId,
        effectiveDate: formatDate(entry.effectiveDate),
        quantity: entry.quantity.toFixed(4),
        reversesEntryId: entry.reversesEntryId,
      })),
      allocations: lines.map((line) => ({
        lineId: line.id,
        leavePostingId: line.leaveApprovalAllocation.postings[0]?.id ?? '',
        leaveApplicationVersionId: line.leaveApprovalAllocation.leaveApplicationVersionId,
        leaveAccountId: line.leaveAccountId ?? '',
        dateFrom: formatDate(line.dateFrom),
        dateTo: formatDate(line.dateTo),
        quantity: line.quantity.toFixed(4),
        cancelledQuantity: line.cancellationScopes
          .reduce((total, scope) => total.plus(scope.quantity), new Prisma.Decimal(0))
          .toFixed(4),
        unitCode: line.unitCode,
      })),
    });
  }
}

type AssessmentCursor = ReturnType<typeof mandatoryLeaveAssessmentCursorSchema.parse>;
type EmployeeCursor = ReturnType<typeof mandatoryLeaveEmployeeCursorSchema.parse>;

function encodeCursor(cursor: AssessmentCursor | EmployeeCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeCursor(value: string): AssessmentCursor {
  return parseCursor(value, mandatoryLeaveAssessmentCursorSchema);
}

function decodeEmployeeCursor(value: string): EmployeeCursor {
  return parseCursor(value, mandatoryLeaveEmployeeCursorSchema);
}

function parseCursor<T>(value: string, schema: { parse(input: unknown): T }): T {
  try {
    return schema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
  } catch {
    throw new MandatoryLeaveAssessmentServiceError(
      'The Mandatory Leave Assessment list cursor is invalid.',
      400,
      'MANDATORY_LEAVE_ASSESSMENT_CURSOR_INVALID',
    );
  }
}

/** Rows strictly after the cursor in the list's sort order. */
function afterCursor(cursor: AssessmentCursor): Prisma.MandatoryLeaveAssessmentWhereInput {
  const assessedAt = new Date(cursor.assessedAt);
  const sameYear = { assessmentYear: cursor.assessmentYear };
  const sameName = { ...sameYear, employee: { legalName: cursor.legalName } };
  return {
    OR: [
      { assessmentYear: { lt: cursor.assessmentYear } },
      { ...sameYear, employee: { legalName: { gt: cursor.legalName } } },
      { ...sameName, assessedAt: { lt: assessedAt } },
      { ...sameName, assessedAt, id: { gt: cursor.id } },
    ],
  };
}

/**
 * The as-of date for a year: today for the current year and December 31 for a
 * past year. Future years cannot be assessed.
 */
/** Serializes Agency/year evaluations (shared) with policy activation (exclusive). */
async function lockAgencyYear(
  transaction: Prisma.TransactionClient,
  agencyId: string,
  assessmentYear: number,
  mode: 'SHARED' | 'EXCLUSIVE',
): Promise<void> {
  const key = `mandatory_leave_assessment_agency:${agencyId}:${assessmentYear}`;
  if (mode === 'SHARED') {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${key}, 0))`;
  } else {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  }
}

export function assessmentDateFor(assessmentYear: number, today = manilaToday()): string {
  const currentYear = Number(today.slice(0, 4));
  if (!Number.isInteger(assessmentYear) || assessmentYear < 1900 || assessmentYear > currentYear) {
    throw new MandatoryLeaveAssessmentServiceError(
      'Mandatory leave can be evaluated only for the current or a past calendar year.',
      400,
      'MANDATORY_LEAVE_ASSESSMENT_YEAR_INVALID',
    );
  }
  return assessmentYear === currentYear ? today : `${assessmentYear}-12-31`;
}

/** The governing policy admits the ordinary civilian profile and does not exclude it. */
function admitsProfile(applicabilityRules: Prisma.JsonValue): boolean {
  const profiles = readStringArray(applicabilityRules, 'profiles');
  const excluded = readStringArray(applicabilityRules, 'excludedProfiles');
  return (
    profiles !== null &&
    excluded !== null &&
    profiles.includes(PROFILE) &&
    !excluded.includes(PROFILE)
  );
}

function readStringArray(value: unknown, key: string): string[] | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const entry = (value as Record<string, unknown>)[key];
  if (entry === undefined || entry === null) return [];
  if (!Array.isArray(entry) || entry.some((item) => typeof item !== 'string')) return null;
  return entry as string[];
}

function hasScope(context: RequestContext, code: string, scopePolicy: string): boolean {
  return context.permissions.some(
    (grant) => grant.code === code && grant.scopePolicy === scopePolicy,
  );
}

function requireReadScope(context: RequestContext): 'AGENCY' | 'OWN' {
  if (hasScope(context, 'leave.mandatory_assessments.read', 'AGENCY')) return 'AGENCY';
  if (hasScope(context, 'leave.mandatory_assessments.read', 'OWN')) return 'OWN';
  throw new MandatoryLeaveAssessmentServiceError(
    'The leave.mandatory_assessments.read permission is required.',
    403,
    'MANDATORY_LEAVE_ASSESSMENT_READ_FORBIDDEN',
  );
}

function summaryOf(record: AssessmentRecord): MandatoryLeaveAssessmentSummary {
  return {
    id: record.id,
    agencyId: record.agencyId,
    employeeId: record.employeeId,
    employeeNumber: record.employee.employeeNumber,
    employeeName: record.employee.legalName,
    assessmentYear: record.assessmentYear,
    assessmentDate: formatDate(record.assessmentDate),
    result: record.result as MandatoryLeaveResult,
    requiredQuantity: record.requiredQuantity?.toFixed(4) ?? null,
    fulfilledQuantity: record.fulfilledQuantity?.toFixed(4) ?? null,
    policyVersionId: record.policyVersionId,
    leaveAccountId: record.leaveAccountId,
    previousAssessmentId: record.previousAssessmentId,
    isLatest: record.successors.length === 0,
    assessedAt: record.assessedAt.toISOString(),
  };
}

function toDatabaseDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function manilaToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
