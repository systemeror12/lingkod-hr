import { z } from 'zod';

export const EMPLOYEE_SEXES = ['FEMALE', 'MALE'] as const;
export const EMPLOYEE_CIVIL_STATUSES = ['SINGLE', 'MARRIED', 'WIDOWED', 'SEPARATED'] as const;

export const employeeCreateSchema = z
  .object({
    employeeNumber: z.string().trim().min(1).max(80),
    legalName: z.string().trim().min(1).max(300),
    birthDate: z.string().date(),
    sex: z.enum(EMPLOYEE_SEXES),
    civilStatus: z.enum(EMPLOYEE_CIVIL_STATUSES),
    contactEmail: z.string().trim().email().max(320),
  })
  .strict();

export const employeeIdSchema = z.string().uuid();

export const employeeMembershipLinkSchema = z.object({ membershipId: z.string().uuid() }).strict();

export const EMPLOYEE_SERVICE_STATUSES = [
  'PREBOARDING',
  'ACTIVE',
  'ON_EXTENDED_LEAVE',
  'SUSPENDED',
  'SEPARATED',
  'DECEASED',
] as const;
export const EMPLOYEE_MEMBERSHIP_LINKS = ['LINKED', 'UNLINKED'] as const;
export const EMPLOYEE_LIST_LIMIT = 200;

function queryValues<const T extends readonly [string, ...string[]]>(values: T) {
  return z.preprocess(
    (value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]),
    z.array(z.enum(values)).max(values.length),
  );
}

/** Register search, filters, and offset page. Repeated keys select several filter values. */
export const employeeListQuerySchema = z
  .object({
    q: z.preprocess(
      (value) => (typeof value === 'string' ? value.trim() || undefined : value),
      z.string().max(100).optional(),
    ),
    serviceStatus: queryValues(EMPLOYEE_SERVICE_STATUSES),
    membership: queryValues(EMPLOYEE_MEMBERSHIP_LINKS),
    limit: z.coerce.number().int().min(1).max(EMPLOYEE_LIST_LIMIT).default(EMPLOYEE_LIST_LIMIT),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export type EmployeeListQuery = z.infer<typeof employeeListQuerySchema>;
