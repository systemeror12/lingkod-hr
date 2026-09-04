import { z } from 'zod';
import {
  GOVERNMENT_IDENTIFIER_STATUSES,
  GOVERNMENT_IDENTIFIER_TYPES,
} from './government-identifiers.constants';

export const governmentIdentifierIdSchema = z.string().uuid();
export const governmentIdentifierTypeSchema = z.enum(GOVERNMENT_IDENTIFIER_TYPES);
export const governmentIdentifierStatusSchema = z.enum(GOVERNMENT_IDENTIFIER_STATUSES);

const optionalUuid = z.string().uuid().nullable().optional();
function containsControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return (code >= 0 && code <= 31) || (code >= 127 && code <= 159);
  });
}

const reasonSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((value) => !containsControlCharacters(value), 'Reason contains unsupported characters.');
const optionalReasonSchema = z
  .string()
  .trim()
  .max(500)
  .refine((value) => !containsControlCharacters(value), 'Reason contains unsupported characters.')
  .nullable()
  .optional();
const protectedValueSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine(
    (value) => !containsControlCharacters(value),
    'Government identifier values cannot contain control characters.',
  );

export const governmentIdentifierCreateSchema = z
  .object({
    identifierType: governmentIdentifierTypeSchema,
    value: protectedValueSchema,
    effectiveFrom: z.string().date().optional(),
    verifiedAt: z.string().datetime({ offset: true }).nullable().optional(),
    reason: optionalReasonSchema,
    evidenceDocumentId: optionalUuid,
    evidenceDocumentVersionId: optionalUuid,
  })
  .strict()
  .refine(
    (value) => Boolean(value.evidenceDocumentId) === Boolean(value.evidenceDocumentVersionId),
    {
      message: 'Evidence must reference an exact Document Version.',
      path: ['evidenceDocumentVersionId'],
    },
  );

export const governmentIdentifierReplaceSchema = governmentIdentifierCreateSchema.safeExtend({
  reason: reasonSchema,
});

export const governmentIdentifierInvalidateSchema = z
  .object({
    reason: reasonSchema,
    effectiveTo: z.string().date().nullable().optional(),
  })
  .strict();

export const governmentIdentifierRevealSchema = z.object({ reason: reasonSchema }).strict();
