import { getConfig } from '@lingkod-hr/config';
import { cookies } from 'next/headers';
import { hasPermission, type ActiveSession } from './session';

export interface EmployeeOption {
  id: string;
  employeeNumber: string;
  legalName: string;
}

/**
 * GET an Agency API path for a Payroll page on the server. `value` is `null` unless the response
 * was OK.
 */
export async function getAgencyJson(
  session: ActiveSession,
  path: string,
): Promise<{ status: number; value: unknown }> {
  const config = getConfig();
  const cookieStore = await cookies();
  const response = await fetch(`${config.API_URL}/api/v1/agencies/${session.agencyId}${path}`, {
    headers: { cookie: cookieStore.toString(), origin: new URL(config.APP_URL).origin },
    cache: 'no-store',
  });
  return { status: response.status, value: response.ok ? await response.json() : null };
}

/**
 * The Agency's Employees a Payroll page can name, or none when the membership cannot read
 * Employees; the page then shows Employee ids.
 */
export async function loadEmployeeOptions(session: ActiveSession): Promise<EmployeeOption[]> {
  if (!hasPermission(session, 'personnel.employees.read')) return [];
  const { value } = await getAgencyJson(session, '/employees');
  const employees = (value as { employees?: unknown } | null)?.employees;
  return Array.isArray(employees)
    ? (employees as EmployeeOption[]).map(({ id, employeeNumber, legalName }) => ({
        id,
        employeeNumber,
        legalName,
      }))
    : [];
}

/** A finalized Document Version a Payroll record may name as its authority. */
export interface AuthorityOption {
  id: string;
  /** The Document the version belongs to, for the commands that name both. */
  documentId: string;
  label: string;
}

interface LinkableVersion {
  documentId: string;
  documentNo: string | null;
  documentType: string;
  version: { id: string; versionNo: number };
}

/**
 * The Agency's Document Versions a recorder may name as an authority, or none when the membership
 * cannot read Document evidence. The API still refuses one that is not finalized.
 */
export async function loadAuthorityOptions(session: ActiveSession): Promise<AuthorityOption[]> {
  if (!hasPermission(session, 'documents.evidence.read')) return [];
  const { value } = await getAgencyJson(session, '/documents/versions');
  const documents = (value as { documents?: LinkableVersion[] } | null)?.documents ?? [];
  return documents.map((document) => ({
    id: document.version.id,
    documentId: document.documentId,
    label: `${document.documentNo ?? document.documentType} · v${document.version.versionNo}`,
  }));
}
