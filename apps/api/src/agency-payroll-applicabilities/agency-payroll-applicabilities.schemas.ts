import { z } from 'zod';

export const APPLICABILITY_SCOPES = ['AGENCY', 'EMPLOYEE'] as const;
export type ApplicabilityScope = (typeof APPLICABILITY_SCOPES)[number];

const isoDate = z.iso.date();

/**
 * What the recorder enters. Every field is required: the conditional
 * component, the scope, its authority, its funding, and its effective period.
 * There is no population rule by office, position, or grade.
 */
export const recordApplicabilitySchema = z
  .object({
    payComponentId: z.uuid(),
    scope: z.enum(APPLICABILITY_SCOPES),
    /** The named Employee for `EMPLOYEE` scope; `null` for the whole Agency. */
    employeeId: z.uuid().nullable(),
    authorityDocumentVersionId: z.uuid(),
    fundingReference: z.string().trim().min(1).max(500),
    effectiveFrom: isoDate,
    effectiveTo: isoDate.nullable(),
  })
  .strict()
  .refine((input) => (input.scope === 'EMPLOYEE') === (input.employeeId !== null), {
    message: 'Name an Employee for EMPLOYEE scope, and none for the whole Agency.',
    path: ['employeeId'],
  })
  .refine((input) => input.effectiveTo === null || input.effectiveTo >= input.effectiveFrom, {
    message: 'effectiveTo is on or after effectiveFrom.',
    path: ['effectiveTo'],
  });

export type RecordApplicability = z.input<typeof recordApplicabilitySchema>;

/** Ending brings `effectiveTo` forward; the reason goes to the Audit Event. */
export const endApplicabilitySchema = z
  .object({ effectiveTo: isoDate, reason: z.string().trim().min(1).max(1000) })
  .strict();

export type EndApplicability = z.input<typeof endApplicabilitySchema>;

/**
 * The last date a GAA-revalidated component's record may run to: 31 December
 * of the fiscal year it starts in. Renewal is a new record (#43, #328).
 */
export const gaaFiscalYearEnd = (effectiveFrom: string): string =>
  `${effectiveFrom.slice(0, 4)}-12-31`;
