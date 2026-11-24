/** One comparison as the API lists it, without its differences. */
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
 * One Employee and pay component whose amounts differ, as the API computed it. An amount is null
 * where its side has none.
 */
export interface LegacyRegisterDifference {
  employeeId: string;
  employeeNumber: string;
  payComponentId: string;
  payComponentCode: string;
  legacyAmount: string | null;
  payrollAmount: string | null;
}

export interface LegacyRegisterComparison extends LegacyRegisterComparisonSummary {
  differences: LegacyRegisterDifference[];
}

/** One reason the API rejected the file; `line` is null for the whole file. */
export interface LegacyRegisterIssue {
  line: number | null;
  code: string;
  message: string;
}

/** Where a rejection reason points: `Line 3`, or `Whole file`. */
export function issueLineLabel(line: number | null): string {
  return line === null ? 'Whole file' : `Line ${line}`;
}

/**
 * The API's refusal of a comparison, read from its error body: the message, and every reason it
 * rejected the file for when it did.
 */
export function comparisonRefusal(
  body: unknown,
  fallback: string,
): { message: string; issues: LegacyRegisterIssue[] } {
  const error = (body as { error?: { message?: unknown; issues?: unknown } } | null)?.error;
  const message = typeof error?.message === 'string' ? error.message : fallback;
  const issues = Array.isArray(error?.issues)
    ? (error.issues as unknown[]).filter(
        (issue): issue is LegacyRegisterIssue =>
          typeof issue === 'object' &&
          issue !== null &&
          typeof (issue as LegacyRegisterIssue).message === 'string',
      )
    : [];
  return { message, issues };
}
