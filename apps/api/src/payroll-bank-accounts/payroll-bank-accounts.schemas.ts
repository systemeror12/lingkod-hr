import { z } from 'zod';

export const payrollBankAccountIdSchema = z.string().uuid();

const optionalUuid = z.string().uuid().nullable().optional();
const safeText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(
      (value) =>
        ![...value].some((character) => {
          const code = character.charCodeAt(0);
          return (code >= 0 && code <= 31) || (code >= 127 && code <= 159);
        }),
      `${label} contains unsupported characters.`,
    );
const reasonSchema = safeText('Reason', 500);
const evidenceSchema = z
  .object({
    evidenceDocumentId: optionalUuid,
    evidenceDocumentVersionId: optionalUuid,
  })
  .refine(
    (value) => Boolean(value.evidenceDocumentId) === Boolean(value.evidenceDocumentVersionId),
    {
      message: 'Evidence must reference an exact Document Version.',
      path: ['evidenceDocumentVersionId'],
    },
  );
const accountFields = {
  bankCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9_-]{1,39}$/),
  accountName: safeText('Account name', 200),
  accountNumber: safeText('Account number', 120),
  evidenceDocumentId: optionalUuid,
  evidenceDocumentVersionId: optionalUuid,
};
function hasEvidencePair(value: {
  evidenceDocumentId?: string | null | undefined;
  evidenceDocumentVersionId?: string | null | undefined;
}): boolean {
  return Boolean(value.evidenceDocumentId) === Boolean(value.evidenceDocumentVersionId);
}
const evidencePairIssue = {
  message: 'Evidence must reference an exact Document Version.',
  path: ['evidenceDocumentVersionId'],
};

export const payrollBankAccountCreateSchema = z
  .object({ ...accountFields, effectiveFrom: z.string().date() })
  .strict()
  .refine(hasEvidencePair, evidencePairIssue);
export const payrollBankAccountReplaceSchema = z
  .object({ ...accountFields, effectiveFrom: z.string().date(), reason: reasonSchema })
  .strict()
  .refine(hasEvidencePair, evidencePairIssue);
export const payrollBankAccountCorrectSchema = z
  .object({ ...accountFields, reason: reasonSchema })
  .strict()
  .refine(hasEvidencePair, evidencePairIssue);
export const payrollBankAccountActivateSchema = evidenceSchema.safeExtend({
  verificationState: z.literal('VERIFIED'),
  verifiedAt: z.string().datetime({ offset: true }),
  reason: reasonSchema,
});
export const payrollBankAccountInactivateSchema = z
  .object({ effectiveTo: z.string().date(), reason: reasonSchema })
  .strict();
export const payrollBankAccountRevealSchema = z.object({ reason: reasonSchema }).strict();
