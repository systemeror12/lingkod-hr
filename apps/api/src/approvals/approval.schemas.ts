import { z } from 'zod';

export const APPROVAL_ROUTE_STEP_MODES = ['SEQUENTIAL'] as const;

export const APPROVAL_REQUEST_SUBJECT_TYPES = [
  'REQUEST_TO_FILL',
  'REQUEST_TO_FILL_REVIEW',
  'VACANCY_PUBLICATION',
  'MSP_REBASELINE',
  'APPOINTMENT_ISSUANCE',
  'ADMINISTRATIVE_CORRECTION',
  'LEAVE_APPLICATION',
  'LEAVE_MONETIZATION',
  'LEAVE_MONETIZATION_ADJUSTMENT',
  'ATTENDANCE_CORRECTION',
] as const;

const routeAssignmentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('MEMBERSHIP'), membershipId: z.string().uuid() }).strict(),
  z
    .object({
      kind: z.literal('ROLE'),
      roleCode: z.string().trim().min(1).max(120),
    })
    .strict(),
]);

const permissionCodeSchema = z.string().trim().min(1).max(160);

const routeStepSchema = z
  .object({
    stepNo: z.number().int().positive(),
    stepMode: z.enum(APPROVAL_ROUTE_STEP_MODES),
    requiredPermission: permissionCodeSchema,
    approvePermission: permissionCodeSchema.optional(),
    returnPermission: permissionCodeSchema.optional(),
    rejectPermission: permissionCodeSchema.optional(),
    assignment: routeAssignmentSchema,
    requiresSeparateReview: z.boolean().default(true),
  })
  .strict();

export const approvalRouteDefinitionSchema = z
  .object({ steps: z.array(routeStepSchema).min(1).max(20) })
  .strict()
  .superRefine((definition, context) => {
    const stepNumbers = definition.steps.map(({ stepNo }) => stepNo);
    const sorted = [...stepNumbers].sort((left, right) => left - right);
    const isOrdered = sorted.every((stepNo, index) => stepNo === index + 1);
    if (!isOrdered || new Set(stepNumbers).size !== stepNumbers.length) {
      context.addIssue({
        code: 'custom',
        message: 'Approval route steps must be numbered consecutively from one.',
        path: ['steps'],
      });
    }
  });

export type ApprovalRouteDefinition = z.infer<typeof approvalRouteDefinitionSchema>;
export type ApprovalRouteStep = ApprovalRouteDefinition['steps'][number];

export const approvalRouteCreateSchema = z
  .object({
    routeCode: z.string().trim().min(1).max(120),
    domain: z.string().trim().min(1).max(80),
    versionNo: z.number().int().positive(),
    effectiveFrom: z.string().date(),
    effectiveTo: z.string().date().optional(),
    stepDefinition: approvalRouteDefinitionSchema,
  })
  .strict()
  .refine(
    ({ effectiveFrom, effectiveTo }) => effectiveTo === undefined || effectiveTo >= effectiveFrom,
    { message: 'The route end date cannot precede its start date.', path: ['effectiveTo'] },
  );

export const approvalRouteIdSchema = z.string().uuid();

export const approvalRouteSupersedeSchema = z
  .object({
    effectiveTo: z.string().date(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export const approvalRouteListSchema = z
  .object({
    status: z.enum(['DRAFT', 'ACTIVE', 'SUPERSEDED']).optional(),
    routeCode: z.string().trim().min(1).max(120).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(25),
    cursor: z.string().trim().min(1).max(512).optional(),
  })
  .strict();

export const approvalRouteCursorSchema = z
  .object({
    routeCode: z.string(),
    versionNo: z.number().int().positive(),
    id: z.string().uuid(),
  })
  .strict();

export const approvalRequestCreateSchema = z
  .object({
    routeCode: z.string().trim().min(1).max(120),
    subjectType: z.enum(APPROVAL_REQUEST_SUBJECT_TYPES),
    subjectId: z.string().uuid(),
    effectiveDate: z.string().date().optional(),
  })
  .strict();

export const approvalRequestIdSchema = z.string().uuid();

export const approvalRequestListSchema = z
  .object({
    status: z
      .enum(['PENDING', 'IN_PROGRESS', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED', 'EXPIRED'])
      .optional(),
    limit: z.coerce.number().int().min(1).max(50).default(25),
    cursor: z.string().trim().min(1).max(512).optional(),
  })
  .strict();

export const approvalRequestCursorSchema = z
  .object({ requestedAt: z.string().datetime(), id: z.string().uuid() })
  .strict();

export const approvalDecisionSchema = z
  .object({ comments: z.string().trim().min(1).max(1000).optional() })
  .strict();

export const approvalReasonSchema = z
  .object({ reason: z.string().trim().min(1).max(1000) })
  .strict();

export const approvalIdempotencyKeySchema = z.string().trim().min(1).max(200);
