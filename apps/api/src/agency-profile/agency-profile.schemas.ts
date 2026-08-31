import { z } from 'zod';

export const AGENCY_PROFILE_TYPES = [
  'NGA',
  'LGU',
  'SUC',
  'GOCC_ORIGINAL_CHARTER',
  'OTHER',
] as const;

const optionalText = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .transform((value) => value || null);

const timezone = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }, 'Enter a valid IANA timezone.');

const currency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Enter a three-letter ISO currency code.');

export const agencyProfileDraftSchema = z
  .object({
    officialName: z.string().trim().min(1).max(255),
    acronym: optionalText(30),
    agencyType: z.enum(AGENCY_PROFILE_TYPES),
    parentOrganization: optionalText(255),
    reportingIdentifiers: optionalText(500),
    appointingAuthorityTitle: optionalText(200),
    defaultTimezone: timezone,
    defaultCurrency: currency,
    effectiveFrom: z.string().date(),
  })
  .strict();

export const agencyProfileActivationSchema = z
  .object({
    effectiveDate: z.string().date(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export const agencyProfileCorrectionSchema = agencyProfileDraftSchema
  .omit({ effectiveFrom: true })
  .extend({ reason: z.string().trim().min(1).max(500) })
  .strict();

export const agencyProfileReadQuerySchema = z
  .object({ asOf: z.string().date().optional() })
  .strict();

export const agencyProfileVersionIdSchema = z.string().uuid();
