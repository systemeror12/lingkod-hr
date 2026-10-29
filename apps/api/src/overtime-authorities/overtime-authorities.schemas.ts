import { z } from 'zod';
import { COMPENSATION_METHODS, POSITION_LEVEL_ATTESTATIONS } from './overtime-authorities.types';

export const overtimeAuthorityIdSchema = z.string().uuid();

const coveredEmployeeSchema = z
  .object({
    employeeId: z.string().uuid(),
    authorizedHours: z
      .string()
      .trim()
      .regex(/^\d{1,8}(\.\d{1,4})?$/, 'Enter hours with at most four decimal places.')
      .refine((value) => Number(value) > 0, 'Enter more than zero hours.'),
    taskDescription: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

/** The whole draft, for create and for update alike. */
export const overtimeAuthorityDraftSchema = z
  .object({
    authorityNo: z.string().trim().min(1).max(80),
    requestingUnitId: z.string().uuid(),
    purpose: z.string().trim().min(1).max(4000),
    workDateFrom: z.string().date(),
    workDateTo: z.string().date(),
    compensationMethod: z.enum(COMPENSATION_METHODS),
    fundingReference: z.string().trim().min(1).max(200).nullable().optional(),
    employees: z.array(coveredEmployeeSchema).min(1).max(500),
  })
  .strict()
  .superRefine((draft, issue) => {
    if (draft.workDateTo < draft.workDateFrom) {
      issue.addIssue({
        code: 'custom',
        path: ['workDateTo'],
        message: 'The last Work Date cannot precede the first.',
      });
    }
    if (draft.compensationMethod === 'OVERTIME_PAY' && !draft.fundingReference) {
      issue.addIssue({
        code: 'custom',
        path: ['fundingReference'],
        message: 'Overtime pay needs a funding reference.',
      });
    }
    const employeeIds = draft.employees.map((row) => row.employeeId);
    if (new Set(employeeIds).size !== employeeIds.length) {
      issue.addIssue({
        code: 'custom',
        path: ['employees'],
        message: 'Cover each Employee once.',
      });
    }
  });

/** One covered Employee's reviewer attestations; both facts must be attested. */
export const reviewerAttestationSchema = z
  .object({
    employeeId: z.string().uuid(),
    positionLevel: z.enum(POSITION_LEVEL_ATTESTATIONS),
    noOtherBeyondHoursAllowance: z.literal(true),
  })
  .strict();

export const overtimeAuthorityReviewSchema = z
  .object({ attestations: z.array(reviewerAttestationSchema).min(1).max(500) })
  .strict()
  .superRefine((review, issue) => {
    const employeeIds = review.attestations.map((row) => row.employeeId);
    if (new Set(employeeIds).size !== employeeIds.length) {
      issue.addIssue({
        code: 'custom',
        path: ['attestations'],
        message: 'Attest each Employee once.',
      });
    }
  });

export const overtimeAuthorityApproveSchema = z
  .object({
    compensationMethod: z.enum(COMPENSATION_METHODS),
    comments: z.string().trim().min(1).max(2000).optional(),
  })
  .strict();

export const overtimeAuthorityRejectSchema = z
  .object({ reason: z.string().trim().min(1, 'Enter a reason for rejecting.').max(2000) })
  .strict();
