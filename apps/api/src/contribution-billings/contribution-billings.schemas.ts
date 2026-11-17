import { z } from 'zod';

export const CONTRIBUTION_TYPES = [
  'GSIS',
  'EMPLOYEES_COMPENSATION',
  'PHILHEALTH',
  'PAGIBIG',
] as const;

/** A share the issuer billed, in pesos and centavos; zero is a billed amount. */
const share = z
  .string()
  .regex(/^\d{1,15}(\.\d{1,2})?$/, 'A share is a peso amount with up to 2 decimal places.');

export const payrollPeriodIdSchema = z.uuid();

/**
 * One issuer billing statement for a contribution type: its finalized
 * evidence Document Version and the shares it bills each Employee.
 */
export const recordContributionBillingSchema = z
  .object({
    contributionType: z.enum(CONTRIBUTION_TYPES),
    evidenceDocumentId: z.uuid(),
    evidenceDocumentVersionId: z.uuid(),
    lines: z
      .array(
        z.object({ employeeId: z.uuid(), employeeShare: share, employerShare: share }).strict(),
      )
      .min(1)
      .max(5000)
      .refine(
        (lines) => new Set(lines.map((line) => line.employeeId)).size === lines.length,
        'An Employee appears once in a billing.',
      ),
  })
  .strict()
  .refine(
    (input) =>
      input.contributionType !== 'EMPLOYEES_COMPENSATION' ||
      input.lines.every((line) => Number(line.employeeShare) === 0),
    { message: "Employees' Compensation is employer-only.", path: ['lines'] },
  );

export type RecordContributionBillingInput = z.infer<typeof recordContributionBillingSchema>;
