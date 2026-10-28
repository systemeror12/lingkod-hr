import { Prisma } from '@prisma/client';
import { hasPermission, type RequestContext } from '@lingkod-hr/auth';
import { resolveEmployeeScope, scopeCovers } from '../employee-scope';
import {
  OvertimeAuthorityServiceError,
  type CompensationMethod,
  type CoveredEmployeeRefusal,
  type OvertimeAuthorityDraftInput,
  type OvertimeAuthorityStatus,
  type OvertimeAuthoritySummary,
} from './overtime-authorities.types';

const authoritySelect = {
  id: true,
  agencyId: true,
  authorityNo: true,
  requestingUnitId: true,
  purpose: true,
  workDateFrom: true,
  workDateTo: true,
  compensationMethod: true,
  fundingReference: true,
  status: true,
  createdAt: true,
  employees: {
    orderBy: { employee: { employeeNumber: 'asc' as const } },
    select: {
      id: true,
      employeeId: true,
      authorizedHours: true,
      taskDescription: true,
      employee: { select: { employeeNumber: true, legalName: true } },
    },
  },
} as const;

type AuthorityRecord = Prisma.OvertimeAuthorityGetPayload<{ select: typeof authoritySelect }>;

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function toDatabaseDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function summary(record: AuthorityRecord): OvertimeAuthoritySummary {
  return {
    id: record.id,
    agencyId: record.agencyId,
    authorityNo: record.authorityNo,
    requestingUnitId: record.requestingUnitId,
    purpose: record.purpose,
    workDateFrom: formatDate(record.workDateFrom),
    workDateTo: formatDate(record.workDateTo),
    compensationMethod: record.compensationMethod as CompensationMethod,
    fundingReference: record.fundingReference,
    status: record.status as OvertimeAuthorityStatus,
    createdAt: record.createdAt.toISOString(),
    employees: record.employees.map((row) => ({
      id: row.id,
      employeeId: row.employeeId,
      employeeNumber: row.employee.employeeNumber,
      employeeName: row.employee.legalName,
      authorizedHours: row.authorizedHours.toFixed(4),
      taskDescription: row.taskDescription,
    })),
  };
}

export async function readAuthority(
  transaction: Prisma.TransactionClient,
  agencyId: string,
  authorityId: string,
): Promise<OvertimeAuthoritySummary> {
  const record = await transaction.overtimeAuthority.findFirst({
    where: { agencyId, id: authorityId },
    select: authoritySelect,
  });
  if (!record) throw authorityNotFound();
  return summary(record);
}

/** Lock one authority for a command and return it. */
export async function lockAuthority(
  transaction: Prisma.TransactionClient,
  agencyId: string,
  authorityId: string,
): Promise<OvertimeAuthoritySummary> {
  const rows = await transaction.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT "id" FROM "overtime_authorities" WHERE "agency_id" = CAST(${agencyId} AS uuid) AND "id" = CAST(${authorityId} AS uuid) FOR UPDATE`,
  );
  if (rows.length !== 1) throw authorityNotFound();
  return readAuthority(transaction, agencyId, authorityId);
}

/** Only a `DRAFT` may be edited, submitted, or cancelled by these commands. */
export function assertDraft(authority: OvertimeAuthoritySummary): void {
  if (authority.status !== 'DRAFT') {
    throw new OvertimeAuthorityServiceError(
      `Only a DRAFT Overtime Authority can be changed; this one is ${authority.status}.`,
      409,
      'OVERTIME_AUTHORITY_NOT_DRAFT',
    );
  }
}

/**
 * Require the permission and that its grant reaches every covered Employee:
 * an Agency grant reaches all of them, a Supervisor's DIRECT_REPORTS grant
 * only their direct reports (ADR 0007).
 */
export async function assertCommandAccess(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  permission: string,
  employeeIds: readonly string[],
): Promise<void> {
  if (!context.agencyId || !context.userId || !context.membershipId) throw forbidden();
  if (hasPermission(context, permission, { agencyId: context.agencyId })) return;
  const scope = await resolveEmployeeScope(context, permission, transaction);
  if (!scope) throw forbidden();
  if (employeeIds.some((employeeId) => !scopeCovers(scope, employeeId))) {
    throw new OvertimeAuthorityServiceError(
      'A covered Employee is outside the scope of the current Agency Membership.',
      403,
      'OVERTIME_AUTHORITY_SCOPE_FORBIDDEN',
    );
  }
}

/**
 * Check that the requesting unit belongs to the Agency and every covered
 * Employee is its Appointed Personnel over all the Work Dates: a non-voided
 * Service Segment covers each date. RLS hides another Agency's rows, so they
 * are refused as not found.
 */
export async function assertDraftValid(
  transaction: Prisma.TransactionClient,
  agencyId: string,
  draft: Pick<
    OvertimeAuthorityDraftInput,
    'requestingUnitId' | 'workDateFrom' | 'workDateTo' | 'employees'
  >,
): Promise<void> {
  const unit = await transaction.organizationUnit.findFirst({
    where: { agencyId, id: draft.requestingUnitId },
    select: { id: true },
  });
  if (!unit) {
    throw new OvertimeAuthorityServiceError(
      'The requesting Organization Unit could not be found in this Agency.',
      422,
      'OVERTIME_AUTHORITY_UNIT_NOT_FOUND',
    );
  }
  const refusals = await coveredEmployeeRefusals(
    transaction,
    agencyId,
    draft.employees.map((row) => row.employeeId),
    draft.workDateFrom,
    draft.workDateTo,
  );
  if (refusals.length > 0) {
    throw new OvertimeAuthorityServiceError(
      'Some Employees cannot be covered by this Overtime Authority.',
      422,
      'OVERTIME_AUTHORITY_EMPLOYEE_INELIGIBLE',
      refusals,
    );
  }
}

async function coveredEmployeeRefusals(
  transaction: Prisma.TransactionClient,
  agencyId: string,
  employeeIds: readonly string[],
  workDateFromValue: string,
  workDateToValue: string,
): Promise<CoveredEmployeeRefusal[]> {
  const workDateFrom = toDatabaseDate(workDateFromValue);
  const workDateTo = toDatabaseDate(workDateToValue);
  const employees = await transaction.employee.findMany({
    where: { agencyId, id: { in: [...employeeIds] } },
    select: { id: true },
  });
  const found = new Set(employees.map((row) => row.id));
  const segments = await transaction.serviceSegment.findMany({
    where: {
      agencyId,
      employeeId: { in: [...found] },
      status: { not: 'VOIDED' },
      effectiveFrom: { lte: workDateTo },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: workDateFrom } }],
    },
    orderBy: { effectiveFrom: 'asc' },
    select: { employeeId: true, effectiveFrom: true, effectiveTo: true },
  });

  const refusals: CoveredEmployeeRefusal[] = [];
  for (const employeeId of employeeIds) {
    if (!found.has(employeeId)) {
      refusals.push({
        employeeId,
        code: 'EMPLOYEE_NOT_FOUND',
        message: 'The Employee could not be found in this Agency.',
      });
      continue;
    }
    const own = segments.filter((segment) => segment.employeeId === employeeId);
    if (!servesThrough(own, workDateFrom, workDateTo)) {
      refusals.push({
        employeeId,
        code: 'NOT_APPOINTED_PERSONNEL',
        message: 'The Employee is not Appointed Personnel of the Agency on every Work Date.',
      });
    }
  }
  return refusals;
}

/** Whether segments sorted by start leave no uncovered date from `from` through `to`. */
function servesThrough(
  segments: ReadonlyArray<{ effectiveFrom: Date; effectiveTo: Date | null }>,
  from: Date,
  to: Date,
): boolean {
  const day = 24 * 60 * 60 * 1000;
  let uncovered = from.getTime();
  for (const segment of segments) {
    if (segment.effectiveFrom.getTime() > uncovered) return false;
    if (!segment.effectiveTo) return true;
    uncovered = Math.max(uncovered, segment.effectiveTo.getTime() + day);
    if (uncovered > to.getTime()) return true;
  }
  return false;
}

/** Store the draft's fields, the values create and update both write. */
export function draftData(draft: OvertimeAuthorityDraftInput) {
  return {
    authorityNo: draft.authorityNo,
    requestingUnitId: draft.requestingUnitId,
    purpose: draft.purpose,
    workDateFrom: toDatabaseDate(draft.workDateFrom),
    workDateTo: toDatabaseDate(draft.workDateTo),
    compensationMethod: draft.compensationMethod,
    fundingReference: draft.fundingReference ?? null,
  };
}

export function auditDraft(draft: OvertimeAuthorityDraftInput): Prisma.InputJsonObject {
  return {
    authorityNo: draft.authorityNo,
    requestingUnitId: draft.requestingUnitId,
    workDateFrom: draft.workDateFrom,
    workDateTo: draft.workDateTo,
    compensationMethod: draft.compensationMethod,
    fundingReference: draft.fundingReference ?? null,
    employees: draft.employees.map((row) => ({
      employeeId: row.employeeId,
      authorizedHours: row.authorizedHours,
    })),
  };
}

export function isAuthorityNoConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export function authorityNoConflict(): OvertimeAuthorityServiceError {
  return new OvertimeAuthorityServiceError(
    'An Overtime Authority with this number already exists in the Agency.',
    409,
    'OVERTIME_AUTHORITY_NUMBER_CONFLICT',
  );
}

function authorityNotFound(): OvertimeAuthorityServiceError {
  return new OvertimeAuthorityServiceError(
    'The Overtime Authority could not be found.',
    404,
    'OVERTIME_AUTHORITY_NOT_FOUND',
  );
}

function forbidden(): OvertimeAuthorityServiceError {
  return new OvertimeAuthorityServiceError(
    'The current Agency Membership lacks the required permission.',
    403,
    'OVERTIME_AUTHORITY_FORBIDDEN',
  );
}
