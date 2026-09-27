export const EMPLOYEE_REGISTER_PAGE_SIZE = 50;

export const EMPLOYEE_SERVICE_STATUSES = [
  'PREBOARDING',
  'ACTIVE',
  'ON_EXTENDED_LEAVE',
  'SUSPENDED',
  'SEPARATED',
  'DECEASED',
] as const;
export const EMPLOYEE_MEMBERSHIP_LINKS = ['LINKED', 'UNLINKED'] as const;

/** Register state kept in the `/employees` URL so the server component fetches the true page. */
export interface EmployeeRegisterParams {
  q: string;
  serviceStatus: string[];
  membership: string[];
  page: number;
}

type SearchParamValue = string | string[] | undefined;

function allowed(value: SearchParamValue, values: readonly string[]): string[] {
  const picked = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return values.filter((item) => picked.includes(item));
}

export function readEmployeeRegisterParams(
  params: Record<string, SearchParamValue>,
): EmployeeRegisterParams {
  const q = Array.isArray(params.q) ? params.q[0] : params.q;
  const page = Number(Array.isArray(params.page) ? params.page[0] : params.page);
  return {
    q: (q ?? '').trim().slice(0, 100),
    serviceStatus: allowed(params.serviceStatus, EMPLOYEE_SERVICE_STATUSES),
    membership: allowed(params.membership, EMPLOYEE_MEMBERSHIP_LINKS),
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

function filterQuery(params: EmployeeRegisterParams): URLSearchParams {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  for (const status of params.serviceStatus) query.append('serviceStatus', status);
  for (const link of params.membership) query.append('membership', link);
  return query;
}

export function employeeRegisterApiQuery(params: EmployeeRegisterParams): URLSearchParams {
  const query = filterQuery(params);
  query.set('limit', String(EMPLOYEE_REGISTER_PAGE_SIZE));
  query.set('offset', String((params.page - 1) * EMPLOYEE_REGISTER_PAGE_SIZE));
  return query;
}

export function employeeRegisterHref(params: EmployeeRegisterParams): string {
  const query = filterQuery(params);
  if (params.page > 1) query.set('page', String(params.page));
  const search = query.toString();
  return search ? `/employees?${search}` : '/employees';
}
