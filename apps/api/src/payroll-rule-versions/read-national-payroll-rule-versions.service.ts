import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { holdsAgencyWide, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import { isoDateOf, type NationalPayrollRuleKind } from './national-payroll-rule-versions';

/**
 * Rule versions are the sources of a compensation basis, so reading them
 * needs the permission that reads the basis and its sources (hris-controls.md
 * §6.10).
 */
export const READ_PERMISSION = 'payroll.compensation.read';

export class RuleVersionReadError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'RuleVersionReadError';
  }
}

/** A version as loaded, with the versions on either side of its supersession. */
export interface RuleVersionSummary {
  id: string;
  ruleKind: NationalPayrollRuleKind;
  code: string;
  name: string;
  issuingAuthority: string;
  issuanceReference: string;
  sourceUrl: string;
  verifiedOn: string;
  verifiedBy: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  loadedAt: string;
  /** The version this one replaces from its own `effectiveFrom`. */
  supersedes: { id: string; code: string } | null;
  /** The version that replaces this one from that version's `effectiveFrom`. */
  supersededBy: { id: string; code: string; effectiveFrom: string } | null;
  salaryGradeRateCount: number;
}

export interface RuleVersionDetail extends RuleVersionSummary {
  /** The kind's typed parameters as loaded; a salary schedule's are empty. */
  parameters: Prisma.JsonValue;
  /** A salary schedule's rates by grade and step; other kinds have none. */
  salaryGradeRates: { salaryGrade: number; salaryStep: number; monthlyRate: string }[];
}

const summarySelect = {
  id: true,
  ruleKind: true,
  code: true,
  name: true,
  issuingAuthority: true,
  issuanceReference: true,
  sourceUrl: true,
  verifiedOn: true,
  verifiedBy: true,
  effectiveFrom: true,
  effectiveTo: true,
  loadedAt: true,
  supersedes: { select: { id: true, code: true } },
  supersededBy: { select: { id: true, code: true, effectiveFrom: true } },
  _count: { select: { salaryGradeRates: true } },
} satisfies Prisma.NationalPayrollRuleVersionSelect;

type SummaryRow = Prisma.NationalPayrollRuleVersionGetPayload<{ select: typeof summarySelect }>;

function toSummary(row: SummaryRow): RuleVersionSummary {
  return {
    id: row.id,
    ruleKind: row.ruleKind as NationalPayrollRuleKind,
    code: row.code,
    name: row.name,
    issuingAuthority: row.issuingAuthority,
    issuanceReference: row.issuanceReference,
    sourceUrl: row.sourceUrl,
    verifiedOn: isoDateOf(row.verifiedOn),
    verifiedBy: row.verifiedBy,
    effectiveFrom: isoDateOf(row.effectiveFrom),
    effectiveTo: row.effectiveTo ? isoDateOf(row.effectiveTo) : null,
    loadedAt: row.loadedAt.toISOString(),
    supersedes: row.supersedes,
    supersededBy: row.supersededBy
      ? { ...row.supersededBy, effectiveFrom: isoDateOf(row.supersededBy.effectiveFrom) }
      : null,
    salaryGradeRateCount: row._count.salaryGradeRates,
  };
}

/**
 * Reads the platform-wide National Payroll Rule Versions as loaded (ADR 0013).
 * Nothing here decides which version is in effect; the calculators do.
 */
@Injectable()
export class ReadNationalPayrollRuleVersionsService {
  /** Every loaded version, by kind, latest effective first. */
  async list(context: RequestContext): Promise<{ versions: RuleVersionSummary[] }> {
    assertReadPermission(context);
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const rows = await transaction.nationalPayrollRuleVersion.findMany({
        orderBy: [{ ruleKind: 'asc' }, { effectiveFrom: 'desc' }, { loadedAt: 'desc' }],
        select: summarySelect,
      });
      return { versions: rows.map(toSummary) };
    });
  }

  /** One version with its parameters and, for a salary schedule, its rates. */
  async get(context: RequestContext, id: string): Promise<RuleVersionDetail> {
    assertReadPermission(context);
    return withDatabaseContext(requestDatabaseContext(context), async (transaction) => {
      const row = await transaction.nationalPayrollRuleVersion.findUnique({
        where: { id },
        select: {
          ...summarySelect,
          parameters: true,
          salaryGradeRates: {
            orderBy: [{ salaryGrade: 'asc' }, { salaryStep: 'asc' }],
            select: { salaryGrade: true, salaryStep: true, monthlyRate: true },
          },
        },
      });
      if (!row) throw notFound();
      return {
        ...toSummary(row),
        parameters: row.parameters,
        salaryGradeRates: row.salaryGradeRates.map((rate) => ({
          salaryGrade: rate.salaryGrade,
          salaryStep: rate.salaryStep,
          monthlyRate: rate.monthlyRate.toFixed(4),
        })),
      };
    });
  }
}

export const notFound = () =>
  new RuleVersionReadError(
    'The National Payroll Rule Version could not be found.',
    404,
    'RULE_VERSION_NOT_FOUND',
  );

function assertReadPermission(context: RequestContext): void {
  if (!holdsAgencyWide(context, READ_PERMISSION)) {
    throw new RuleVersionReadError(
      `Reading National Payroll Rule Versions needs the ${READ_PERMISSION} permission for the whole Agency.`,
      403,
      'RULE_VERSION_READ_FORBIDDEN',
    );
  }
}
