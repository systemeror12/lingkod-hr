import { z } from 'zod';

export const serviceRecordIdSchema = z.string().uuid();

export const serviceRecordListSchema = z
  .object({
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export const serviceRecordGenerationSchema = z
  .object({
    employeeId: z.string().uuid(),
    asOfDate: z.iso.date(),
  })
  .strict();

export const serviceRecordReplacementSchema = z
  .object({
    reason: z.string().trim().min(1).max(500),
    evidenceDocumentId: z.string().uuid(),
    evidenceDocumentVersionId: z.string().uuid(),
  })
  .strict();
