import type { Prisma } from '@prisma/client';
import { holdsAgencyWide, type RequestContext } from '@lingkod-hr/auth';
import type { z } from 'zod';
import type { ApplicabilityScope } from './agency-payroll-applicabilities.schemas';

export const MANAGE_PERMISSION = 'payroll.compensation.manage';
/** Compensation access (hris-controls.md §6.10), which also reads these records. */
export const READ_PERMISSION = 'payroll.compensation.read';

export class ApplicabilityServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ApplicabilityServiceError';
  }
}

export interface ApplicabilitySummary {
  id: string;
  payComponentId: string;
  scope: ApplicabilityScope;
  employeeId: string | null;
  authorityDocumentVersionId: string;
  fundingReference: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  recordedByMembershipId: string;
  recordedAt: string;
}

const summarySelect = {
  id: true,
  payComponentId: true,
  scope: true,
  employeeId: true,
  authorityDocumentVersionId: true,
  fundingReference: true,
  effectiveFrom: true,
  effectiveTo: true,
  recordedByMembershipId: true,
  recordedAt: true,
} satisfies Prisma.AgencyPayrollApplicabilitySelect;

export const isoDateOf = (date: Date) => date.toISOString().slice(0, 10);
export const dateOf = (value: string) => new Date(`${value}T00:00:00.000Z`);

/** Read one record of the Agency; RLS hides another Agency's rows as not found. */
export async function readApplicability(
  transaction: Prisma.TransactionClient,
  agencyId: string,
  id: string,
): Promise<ApplicabilitySummary> {
  const row = await transaction.agencyPayrollApplicability.findFirst({
    where: { agencyId, id },
    select: summarySelect,
  });
  if (!row) {
    throw new ApplicabilityServiceError(
      'The Agency Payroll Applicability could not be found.',
      404,
      'APPLICABILITY_NOT_FOUND',
    );
  }
  return {
    ...row,
    scope: row.scope as ApplicabilityScope,
    effectiveFrom: isoDateOf(row.effectiveFrom),
    effectiveTo: row.effectiveTo ? isoDateOf(row.effectiveTo) : null,
    recordedAt: row.recordedAt.toISOString(),
  };
}

/** Record and end both need `payroll.compensation.manage` for the whole Agency. */
export function assertManagePermission(context: RequestContext): void {
  if (!holdsAgencyWide(context, MANAGE_PERMISSION)) {
    throw new ApplicabilityServiceError(
      `Agency Payroll Applicability needs the ${MANAGE_PERMISSION} permission for the whole Agency.`,
      403,
      'APPLICABILITY_FORBIDDEN',
    );
  }
}

/** Parse a request body, refusing it with the first issue's field and reason. */
export function parseOrRefuse<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  throw new ApplicabilityServiceError(
    `${issue?.path.map(String).join('.') || 'request'}: ${issue?.message ?? 'invalid'}`,
    422,
    'APPLICABILITY_INVALID',
  );
}

export type ApplicabilityLookup =
  /** `applicabilityId` is null when the component is unconditional and needs no record. */
  | { status: 'APPLICABLE'; applicabilityId: string | null }
  /** No record covers the date, and the latest one before it ended on `endedOn`. */
  | { status: 'EXPIRED'; applicabilityId: string; endedOn: string }
  | { status: 'NOT_APPLICABLE' };

/**
 * Whether a component applies on `on` (ISO date) to the whole Agency, or to an
 * Employee when `employeeId` is given. An unconditional component always
 * applies. A conditional one applies only under a record for the whole Agency
 * or for that Employee; it is `EXPIRED` when the latest such record ended
 * before the date. National eligibility stays with the calculator.
 */
export async function findAgencyPayrollApplicability(
  transaction: Pick<Prisma.TransactionClient, 'payComponent' | 'agencyPayrollApplicability'>,
  input: { agencyId: string; payComponentId: string; employeeId: string | null; on: string },
): Promise<ApplicabilityLookup> {
  const component = await transaction.payComponent.findUnique({
    where: { id: input.payComponentId },
    select: { isConditional: true },
  });
  if (!component) throw new Error('The pay component is not in the national catalogue.');
  if (!component.isConditional) return { status: 'APPLICABLE', applicabilityId: null };

  const on = dateOf(input.on);
  const targets: Prisma.AgencyPayrollApplicabilityWhereInput[] = [{ scope: 'AGENCY' }];
  if (input.employeeId) targets.push({ scope: 'EMPLOYEE', employeeId: input.employeeId });
  const started = await transaction.agencyPayrollApplicability.findMany({
    where: {
      agencyId: input.agencyId,
      payComponentId: input.payComponentId,
      effectiveFrom: { lte: on },
      OR: targets,
    },
    // A named Employee's record answers before the Agency-wide one.
    orderBy: [{ scope: 'desc' }, { effectiveFrom: 'desc' }],
    select: { id: true, effectiveTo: true },
  });
  const covering = started.find((row) => row.effectiveTo === null || row.effectiveTo >= on);
  if (covering) return { status: 'APPLICABLE', applicabilityId: covering.id };

  // Every started record now ended before the date; name the latest to end.
  let latest: { id: string; endedOn: Date } | null = null;
  for (const row of started) {
    if (row.effectiveTo && (!latest || row.effectiveTo > latest.endedOn)) {
      latest = { id: row.id, endedOn: row.effectiveTo };
    }
  }
  return latest
    ? { status: 'EXPIRED', applicabilityId: latest.id, endedOn: isoDateOf(latest.endedOn) }
    : { status: 'NOT_APPLICABLE' };
}
