import { createHash } from 'node:crypto';

/** JSON with object keys sorted at every depth, so equal values serialize equally. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : item,
  );
}

/**
 * The SHA-256 of a result's canonical JSON. The caller passes only what the
 * calculation decided from its snapshot and inputs, never row ids, times, or
 * the calculation version, so a recalculation from the same snapshot and
 * inputs reproduces the hash.
 */
export function calculationHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

/**
 * The hash of one calculation version as a whole: the SHA-256 of its Payroll
 * Employee Results' hashes in Employee order. A certification binds it (#334),
 * so what was certified is exactly the results that were reviewed. Like each
 * result's hash, it leaves the version out.
 */
export function payrollCalculationHash(
  results: readonly { employeeId: string; calculationHash: string }[],
): string {
  return calculationHash(
    results
      .map(({ employeeId, calculationHash: hash }) => ({ employeeId, calculationHash: hash }))
      .sort((a, b) => (a.employeeId < b.employeeId ? -1 : a.employeeId > b.employeeId ? 1 : 0)),
  );
}
