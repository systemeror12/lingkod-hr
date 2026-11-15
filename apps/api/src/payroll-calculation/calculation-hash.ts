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
