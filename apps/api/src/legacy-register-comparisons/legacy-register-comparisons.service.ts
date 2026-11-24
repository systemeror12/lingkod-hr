import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { holdsAgencyWide, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import {
  legacyRegisterDifferences,
  parseLegacyRegister,
  type ComparedAmount,
  type LegacyRegisterIssue,
  type LegacyRegisterRow,
} from './legacy-register-file';

export const LEGACY_REGISTER_COMPARED = 'LEGACY_REGISTER_COMPARED';

const PERMISSION = 'payroll.legacy_registers.compare';

export class LegacyRegisterComparisonsServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
    /** Every reason the file was rejected, when it was. */
    readonly issues?: LegacyRegisterIssue[],
  ) {
    super(message);
    this.name = 'LegacyRegisterComparisonsServiceError';
  }
}

export interface LegacyRegisterComparisonSummary {
  id: string;
  payrollPeriodId: string;
  calculationVersion: number;
  /** SHA-256 of the imported file's bytes. */
  contentHash: string;
  rowCount: number;
  differenceCount: number;
  comparedByMembershipId: string;
  comparedAt: string;
}

/**
 * One Employee and pay component whose amounts differ. An amount is null
 * where its side has none: the legacy register has no row, or the finalized
 * payroll no line, for that Employee and component.
 */
export interface LegacyRegisterDifferenceView {
  employeeId: string;
  employeeNumber: string;
  payComponentId: string;
  payComponentCode: string;
  legacyAmount: string | null;
  payrollAmount: string | null;
}

export interface LegacyRegisterComparisonView extends LegacyRegisterComparisonSummary {
  differences: LegacyRegisterDifferenceView[];
}

type Transaction = Prisma.TransactionClient;
type ComparisonRow = Prisma.LegacyRegisterComparisonGetPayload<object>;

/**
 * Compares a legacy payroll register with a FINALIZED Payroll Period
 * (payroll-schema.md §12, #359). The payroll side of each Employee and pay
 * component is the sum of its Payroll Lines in the period's FINALIZED results
 * at the finalized calculation version. The comparison reports where the two
 * differ and decides neither is right.
 *
 * The file is rejected whole, with every reason by line, when its shape is
 * invalid or it names an Employee number or component code LingkodHR does
 * not have. A comparison writes only its own two tables and an Audit Event,
 * never a payroll table. Comparing the same file with the same period again
 * returns the stored comparison and writes nothing.
 *
 * Every method needs `payroll.legacy_registers.compare` held Agency-wide; a
 * comparison claims no payroll function.
 */
@Injectable()
export class LegacyRegisterComparisonsService {
  async compare(
    context: RequestContext,
    periodId: string,
    content: Buffer,
  ): Promise<LegacyRegisterComparisonView> {
    assertPermission(context);
    const parsed = parseLegacyRegister(content);
    if (!parsed.ok) throw rejected(parsed.issues);
    const contentHash = createHash('sha256').update(content).digest('hex');
    try {
      return await withDatabaseContext(requestDatabaseContext(context), (transaction) =>
        this.record(transaction, context, periodId, parsed.rows, contentHash),
      );
    } catch (error: unknown) {
      // The same file compared at the same time: the other import stored it.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
          const stored = await transaction.legacyRegisterComparison.findUniqueOrThrow({
            where: { payrollPeriodId_contentHash: { payrollPeriodId: periodId, contentHash } },
          });
          return readView(transaction, stored);
        });
      }
      throw error;
    }
  }

  /** The period's comparisons, oldest first, without their differences. */
  async list(
    context: RequestContext,
    periodId: string,
  ): Promise<LegacyRegisterComparisonSummary[]> {
    assertPermission(context);
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      await findPeriod(transaction, context, periodId);
      const rows = await transaction.legacyRegisterComparison.findMany({
        where: { agencyId: context.agencyId, payrollPeriodId: periodId },
        orderBy: [{ comparedAt: 'asc' }, { id: 'asc' }],
      });
      return summaries(transaction, context.agencyId, rows);
    });
  }

  /**
   * The Agency's comparisons of every period, newest first, without their differences, for the
   * Payroll workspace's list.
   */
  async listForAgency(context: RequestContext): Promise<LegacyRegisterComparisonSummary[]> {
    assertPermission(context);
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const rows = await transaction.legacyRegisterComparison.findMany({
        where: { agencyId: context.agencyId },
        orderBy: [{ comparedAt: 'desc' }, { id: 'desc' }],
      });
      return summaries(transaction, context.agencyId, rows);
    });
  }

  async get(
    context: RequestContext,
    periodId: string,
    comparisonId: string,
  ): Promise<LegacyRegisterComparisonView> {
    assertPermission(context);
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const stored = await transaction.legacyRegisterComparison.findUnique({
        where: { agencyId_id: { agencyId: context.agencyId, id: comparisonId } },
      });
      if (!stored || stored.payrollPeriodId !== periodId) {
        throw new LegacyRegisterComparisonsServiceError(
          'The Legacy Register Comparison could not be found.',
          404,
          'LEGACY_REGISTER_COMPARISON_NOT_FOUND',
        );
      }
      return readView(transaction, stored);
    });
  }

  private async record(
    transaction: Transaction,
    context: RequestContext,
    periodId: string,
    rows: LegacyRegisterRow[],
    contentHash: string,
  ): Promise<LegacyRegisterComparisonView> {
    const { agencyId } = context;
    // FOR SHARE: a void of this payroll waits until the comparison commits.
    const [period] = await transaction.$queryRaw<{ status: string; calculation_version: number }[]>`
      SELECT "status", "calculation_version" FROM "payroll_periods"
      WHERE "agency_id" = CAST(${agencyId} AS uuid) AND "id" = CAST(${periodId} AS uuid)
      FOR SHARE
    `;
    if (!period) throw periodNotFound();
    if (period.status !== 'FINALIZED') {
      throw new LegacyRegisterComparisonsServiceError(
        `The Payroll Period is ${period.status}; a legacy register is compared only with a FINALIZED payroll.`,
        409,
        'LEGACY_REGISTER_PAYROLL_NOT_FINALIZED',
      );
    }
    const stored = await transaction.legacyRegisterComparison.findUnique({
      where: { payrollPeriodId_contentHash: { payrollPeriodId: periodId, contentHash } },
    });
    if (stored) return readView(transaction, stored);

    // Employee numbers and component codes are citext: matched case-insensitively.
    const employees = await transaction.$queryRaw<{ id: string; employee_number: string }[]>`
      SELECT "id", "employee_number" FROM "employees"
      WHERE "agency_id" = CAST(${agencyId} AS uuid)
        AND "employee_number" = ANY(CAST(${rows.map((row) => row.employeeNumber)} AS citext[]))
    `;
    const components = await transaction.$queryRaw<{ id: string; code: string }[]>`
      SELECT "id", "code" FROM "pay_components"
      WHERE "code" = ANY(CAST(${rows.map((row) => row.componentCode)} AS citext[]))
    `;
    const employeeIdOf = new Map(
      employees.map((each) => [each.employee_number.toLowerCase(), each.id]),
    );
    const componentIdOf = new Map(components.map((each) => [each.code.toLowerCase(), each.id]));
    const issues: LegacyRegisterIssue[] = [];
    const legacy: ComparedAmount[] = [];
    for (const row of rows) {
      const employeeId = employeeIdOf.get(row.employeeNumber.toLowerCase());
      const payComponentId = componentIdOf.get(row.componentCode.toLowerCase());
      if (!employeeId) {
        issues.push({
          line: row.line,
          code: 'EMPLOYEE_UNKNOWN',
          message: `No Employee of this Agency has the employee number ${row.employeeNumber}.`,
        });
      }
      if (!payComponentId) {
        issues.push({
          line: row.line,
          code: 'COMPONENT_UNKNOWN',
          message: `${row.componentCode} is not a pay component code.`,
        });
      }
      if (employeeId && payComponentId) {
        legacy.push({ employeeId, payComponentId, amount: new Prisma.Decimal(row.amount) });
      }
    }
    if (issues.length > 0) throw rejected(issues);

    const payroll = await transaction.$queryRaw<
      { employeeId: string; payComponentId: string; amount: Prisma.Decimal }[]
    >`
      SELECT r."employee_id"::text AS "employeeId",
             l."pay_component_id"::text AS "payComponentId",
             sum(l."amount") AS "amount"
      FROM "payroll_employees" r
      JOIN "payroll_lines" l
        ON l."agency_id" = r."agency_id" AND l."payroll_employee_id" = r."id"
      WHERE r."agency_id" = CAST(${agencyId} AS uuid)
        AND r."payroll_period_id" = CAST(${periodId} AS uuid)
        AND r."calculation_version" = ${period.calculation_version}
        AND r."status" = 'FINALIZED'
      GROUP BY r."employee_id", l."pay_component_id"
    `;
    const differences = legacyRegisterDifferences(legacy, payroll);

    const created = await transaction.legacyRegisterComparison.create({
      data: {
        agencyId,
        payrollPeriodId: periodId,
        calculationVersion: period.calculation_version,
        contentHash,
        rowCount: rows.length,
        comparedByMembershipId: context.membershipId,
      },
    });
    await transaction.legacyRegisterDifference.createMany({
      data: differences.map((difference) => ({
        agencyId,
        legacyRegisterComparisonId: created.id,
        ...difference,
      })),
    });
    await transaction.auditEvent.create({
      data: {
        agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: LEGACY_REGISTER_COMPARED,
        entityType: 'LegacyRegisterComparison',
        entityId: created.id,
        requestId: context.requestId,
        metadata: {
          payrollPeriodId: periodId,
          calculationVersion: period.calculation_version,
          contentHash,
          rowCount: rows.length,
          differenceCount: differences.length,
        },
      },
    });
    return readView(transaction, created);
  }
}

function assertPermission(context: RequestContext): void {
  if (!holdsAgencyWide(context, PERMISSION)) {
    throw new LegacyRegisterComparisonsServiceError(
      `Comparing a legacy register needs the ${PERMISSION} permission for the whole Agency.`,
      403,
      'LEGACY_REGISTER_COMPARISON_FORBIDDEN',
    );
  }
}

async function findPeriod(transaction: Transaction, context: RequestContext, periodId: string) {
  const period = await transaction.payrollPeriod.findUnique({
    where: { agencyId_id: { agencyId: context.agencyId, id: periodId } },
    select: { id: true },
  });
  if (!period) throw periodNotFound();
}

function periodNotFound() {
  return new LegacyRegisterComparisonsServiceError(
    'The Payroll Period could not be found.',
    404,
    'PAYROLL_PERIOD_NOT_FOUND',
  );
}

function rejected(issues: LegacyRegisterIssue[]) {
  return new LegacyRegisterComparisonsServiceError(
    'The legacy register was rejected; nothing was compared.',
    400,
    'LEGACY_REGISTER_INVALID',
    issues,
  );
}

/** The comparison with its differences, by employee number and then component code. */
async function readView(
  transaction: Transaction,
  comparison: ComparisonRow,
): Promise<LegacyRegisterComparisonView> {
  const rows = await transaction.legacyRegisterDifference.findMany({
    where: { agencyId: comparison.agencyId, legacyRegisterComparisonId: comparison.id },
  });
  const [employees, components] = await Promise.all([
    transaction.employee.findMany({
      where: {
        agencyId: comparison.agencyId,
        id: { in: [...new Set(rows.map((row) => row.employeeId))] },
      },
      select: { id: true, employeeNumber: true },
    }),
    transaction.payComponent.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.payComponentId))] } },
      select: { id: true, code: true },
    }),
  ]);
  const numberOf = new Map(employees.map((each) => [each.id, each.employeeNumber]));
  const codeOf = new Map(components.map((each) => [each.id, each.code]));
  const differences = rows.map((row) => ({
    employeeId: row.employeeId,
    employeeNumber: numberOf.get(row.employeeId)!,
    payComponentId: row.payComponentId,
    payComponentCode: codeOf.get(row.payComponentId)!,
    legacyAmount: row.legacyAmount?.toFixed(4) ?? null,
    payrollAmount: row.payrollAmount?.toFixed(4) ?? null,
  }));
  differences.sort(
    (a, b) =>
      compareText(a.employeeNumber, b.employeeNumber) ||
      compareText(a.payComponentCode, b.payComponentCode),
  );
  return { ...toSummary(comparison, differences.length), differences };
}

async function summaries(
  transaction: Transaction,
  agencyId: string,
  rows: ComparisonRow[],
): Promise<LegacyRegisterComparisonSummary[]> {
  const counts = await transaction.legacyRegisterDifference.groupBy({
    by: ['legacyRegisterComparisonId'],
    where: { agencyId, legacyRegisterComparisonId: { in: rows.map((row) => row.id) } },
    _count: { _all: true },
  });
  const countOf = new Map(
    counts.map((count) => [count.legacyRegisterComparisonId, count._count._all]),
  );
  return rows.map((row) => toSummary(row, countOf.get(row.id) ?? 0));
}

function toSummary(row: ComparisonRow, differenceCount: number): LegacyRegisterComparisonSummary {
  return {
    id: row.id,
    payrollPeriodId: row.payrollPeriodId,
    calculationVersion: row.calculationVersion,
    contentHash: row.contentHash,
    rowCount: row.rowCount,
    differenceCount,
    comparedByMembershipId: row.comparedByMembershipId,
    comparedAt: row.comparedAt.toISOString(),
  };
}

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
