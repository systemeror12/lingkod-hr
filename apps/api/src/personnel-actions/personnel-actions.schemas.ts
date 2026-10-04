import { z } from 'zod';

export const PERSONNEL_ACTION_MOVEMENT_TYPES = [
  'PROMOTION',
  'TRANSFER',
  'DEMOTION',
  'RECLASSIFICATION',
  'COMPARABLE_REINSTATEMENT',
] as const;

export const PERSONNEL_ACTION_TYPES = [
  'REASSIGNMENT',
  'DETAIL',
  'DESIGNATION',
  'SECONDMENT',
  'SAME_ITEM_REINSTATEMENT',
  'SEPARATION_RESIGNATION',
  'SEPARATION_DISMISSAL',
  'SEPARATION_DROPPING_FROM_ROLLS',
  'SEPARATION_EXPIRATION',
  'SEPARATION_TERMINATION',
  'SEPARATION_RETIREMENT',
  'SEPARATION_DEATH',
  'SALARY_ADJUSTMENT',
  'STEP_INCREMENT',
  ...PERSONNEL_ACTION_MOVEMENT_TYPES,
] as const;

export type PersonnelActionMovementType = (typeof PERSONNEL_ACTION_MOVEMENT_TYPES)[number];

export const PERSONNEL_ACTION_EVIDENCE_TYPES = [
  'ABSENCE_RECORD',
  'ACCEPTANCE',
  'APPEAL_STATE',
  'APPOINTMENT_TERM',
  'AUTHORITY',
  'BACK_PAY_DETERMINATION',
  'CSC_SUBMISSION',
  'CURRENT_APPOINTMENT_STATION',
  'CURRENT_COMPENSATION',
  'DEATH_CERTIFICATE',
  'DETAIL_ORDER',
  'DROPPING_ORDER',
  'DUE_PROCESS',
  'ELIGIBILITY',
  'EXECUTORY_DECISION',
  'EXPERIENCE',
  'GSIS_COVERAGE',
  'INTER_AGENCY_AGREEMENT',
  'LEAVE_CERTIFICATION',
  'NO_MISCONDUCT',
  'NOSI',
  'NOTICE',
  'OFFICE_ORDER',
  'ORIGINAL_ITEM',
  'PAY_AUTHORITY',
  'PAY_TABLE_VERSION',
  'PERFORMANCE_OR_SERVICE',
  'PERFORMANCE_RATING',
  'PERMANENT_APPOINTMENT',
  'PRIOR_SEPARATION',
  'QUALIFICATION',
  'RECEIVING_DUTIES',
  'RETIREMENT_NOTICE',
  'SALARY_ADJUSTMENT_NOTICE',
  'SERVICE_CONTINUITY',
  'SIGNED_MOA',
  'TERMINATION_ORDER',
  'WITHDRAWAL_STATE',
  'WRITTEN_RESIGNATION',
] as const;

const evidenceSchema = z
  .object({
    evidenceType: z.enum(PERSONNEL_ACTION_EVIDENCE_TYPES),
    documentId: z.string().uuid(),
    documentVersionId: z.string().uuid(),
    sourceDate: z.string().date(),
  })
  .strict();

const common = {
  employeeId: z.string().uuid(),
  proposedEffectivity: z.string().date(),
  reason: z.string().trim().min(1).max(1000),
  evidence: z.array(evidenceSchema).max(32),
};

const variant = <T extends (typeof PERSONNEL_ACTION_TYPES)[number], S extends z.ZodType>(
  actionType: T,
  targetFacts: S,
) => z.object({ ...common, actionType: z.literal(actionType), targetFacts }).strict();

const schemas = [
  variant(
    'REASSIGNMENT',
    z
      .object({
        organizationUnitId: z.string().uuid(),
        receivingDuties: z.string().trim().min(1).max(1000),
        stationSpecific: z.boolean(),
        endDate: z.string().date().nullable(),
        appealState: z.enum(['NONE', 'PENDING', 'STAYED', 'RESOLVED']),
      })
      .strict(),
  ),
  variant(
    'DETAIL',
    z
      .object({
        recipientAgencyName: z.string().trim().min(1).max(300),
        receivingDuties: z.string().trim().min(1).max(1000),
        consented: z.boolean(),
        endDate: z.string().date(),
        noDiminutionConfirmed: z.boolean(),
      })
      .strict(),
  ),
  variant(
    'DESIGNATION',
    z
      .object({
        targetPositionId: z.string().uuid(),
        basis: z.enum(['ABSENT_INCUMBENT', 'VACANCY_OR_EXIGENCY']),
        endDate: z.string().date(),
        renewalCount: z.number().int().min(0).max(2),
      })
      .strict(),
  ),
  variant(
    'SECONDMENT',
    z
      .object({
        recipientOrganization: z.string().trim().min(1).max(300),
        consented: z.literal(true),
        endDate: z.string().date(),
        compensationTerms: z.string().trim().min(1).max(1000),
        cscSubmissionState: z.enum(['PENDING', 'SUBMITTED', 'ACCEPTED']),
      })
      .strict(),
  ),
  variant(
    'SAME_ITEM_REINSTATEMENT',
    z
      .object({
        originalPositionId: z.string().uuid(),
        backPayDetermination: z.string().trim().min(1).max(1000),
      })
      .strict(),
  ),
  variant(
    'SEPARATION_RESIGNATION',
    z
      .object({
        acceptanceDate: z.string().date(),
        noticeDate: z.string().date(),
        withdrawalState: z.enum(['NONE', 'PENDING', 'DENIED']),
        mutuallyAgreedEarlier: z.boolean(),
      })
      .strict(),
  ),
  variant(
    'SEPARATION_DISMISSAL',
    z
      .object({
        decisionFinalityDate: z.string().date(),
        appealState: z.enum(['NONE', 'FINAL']),
      })
      .strict(),
  ),
  variant('SEPARATION_DROPPING_FROM_ROLLS', z.object({ orderDate: z.string().date() }).strict()),
  variant('SEPARATION_EXPIRATION', z.object({ appointmentEndDate: z.string().date() }).strict()),
  variant('SEPARATION_TERMINATION', z.object({ terminationOrderDate: z.string().date() }).strict()),
  variant(
    'SEPARATION_RETIREMENT',
    z.object({ gsisCoverageVerified: z.boolean(), eligibilityVerified: z.boolean() }).strict(),
  ),
  variant('SEPARATION_DEATH', z.object({ dateOfDeath: z.string().date() }).strict()),
  variant(
    'SALARY_ADJUSTMENT',
    z
      .object({
        newSalaryGrade: z.number().int().min(1).max(33),
        newSalaryStep: z.number().int().min(1).max(8),
        payTableVersion: z.string().trim().min(1).max(200),
      })
      .strict(),
  ),
  variant('STEP_INCREMENT', z.object({ newSalaryStep: z.number().int().min(1).max(8) }).strict()),
  variant('PROMOTION', z.object({ appointmentVersionId: z.string().uuid() }).strict()),
  variant('TRANSFER', z.object({ appointmentVersionId: z.string().uuid() }).strict()),
  variant('DEMOTION', z.object({ appointmentVersionId: z.string().uuid() }).strict()),
  variant('RECLASSIFICATION', z.object({ appointmentVersionId: z.string().uuid() }).strict()),
  variant(
    'COMPARABLE_REINSTATEMENT',
    z.object({ appointmentVersionId: z.string().uuid() }).strict(),
  ),
] as const;

export const personnelActionCreateSchema = z.discriminatedUnion('actionType', schemas);
export type PersonnelActionInput = z.infer<typeof personnelActionCreateSchema>;
export type PersonnelActionEvidenceInput = PersonnelActionInput['evidence'][number];
export const personnelActionUpdateSchema = z.discriminatedUnion(
  'actionType',
  schemas.map((schema) =>
    schema.extend({ rowVersion: z.number().int().positive().optional() }),
  ) as unknown as [
    z.ZodObject<z.ZodRawShape>,
    z.ZodObject<z.ZodRawShape>,
    ...z.ZodObject<z.ZodRawShape>[],
  ],
);

export const personnelActionReviewSchema = z
  .object({
    decision: z.enum(['RETURN', 'ENDORSE']),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();

export const personnelActionDecisionSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT']),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();

export const personnelActionReasonSchema = z
  .object({ reason: z.string().trim().min(1).max(1000) })
  .strict();

export const personnelActionIdSchema = z.string().uuid();
export const personnelActionIdempotencyKeySchema = z.string().trim().min(1).max(200);
export const personnelActionListSchema = z
  .object({
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
