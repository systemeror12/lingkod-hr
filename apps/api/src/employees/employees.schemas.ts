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
