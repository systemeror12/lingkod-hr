import { z } from 'zod';
import { DOCUMENT_CLASSIFICATIONS } from './documents.service';

const optionalText = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .transform((value) => value || null)
    .optional();

export const documentCreateSchema = z
  .object({
    documentNo: optionalText(100),
    documentType: z.string().trim().min(1).max(100),
    classification: z.enum(DOCUMENT_CLASSIFICATIONS),
  })
  .strict();

export const documentIdSchema = z.string().uuid();

export const documentVersionCreateSchema = z.object({}).strict();
