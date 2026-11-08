import { z } from 'zod';
import { COC_EARNED_CERTIFICATE_STATUSES } from './coc-earned-certificates.types';

export const cocEarnedCertificateIdSchema = z.string().uuid();

export const cocEarnedCertificateListSchema = z
  .object({ status: z.enum(COC_EARNED_CERTIFICATE_STATUSES).optional() })
  .strict();

export const cocEarnedCertificatePrepareSchema = z
  .object({
    employeeId: z.string().uuid(),
    earnedMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Enter the earned month as YYYY-MM.'),
  })
  .strict();

export const cocEarnedCertificateReturnSchema = z
  .object({ reason: z.string().trim().min(1).max(2000) })
  .strict();
