export type EmployeeRecordSection =
  'details' | 'documents' | 'identifiers' | 'bank-accounts' | 'saln';

/** URL parameters each section uses to open one of its records. */
const sectionParameters: [EmployeeRecordSection, string[]][] = [
  ['documents', ['document']],
  ['identifiers', ['identifierHistory']],
  ['bank-accounts', ['bankHistory']],
  ['saln', ['saln', 'salnHistory']],
];

/**
 * The section whose record the URL selects, so a shared or restored link opens on the right
 * tab. Returns `null` when the URL selects nothing.
 */
export function employeeRecordSectionFor(search: {
  has(name: string): boolean;
}): EmployeeRecordSection | null {
  return sectionParameters.find(([, names]) => names.some((name) => search.has(name)))?.[0] ?? null;
}
