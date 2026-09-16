import { z } from 'zod';
import {
  LEAVE_AUTHORITY_CLASSES,
  LEAVE_EVIDENCE_KINDS,
  LEAVE_PERSONNEL_PROFILES,
} from './leave-catalogue';

export const leaveTypeIdSchema = z.string().uuid();
export const leavePolicyVersionIdSchema = z.string().uuid();
export const leaveAuthorityIdSchema = z.string().uuid();
export const leaveTypeAsOfSchema = z.string().date().optional();
export const leaveIdempotencyKeySchema = z.string().trim().min(1).max(200);
export const leaveReasonSchema = z.string().trim().min(1).max(500);

export const leaveTypeCreateSchema = z
  .object({
    catalogueCode: z.string().trim().min(1).max(80),
  })
  .strict();

export const leaveTypeUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
    rowVersion: z.number().int().positive().optional(),
  })
  .strict();

const applicabilitySchema = z
  .object({
    profiles: z.array(z.enum(LEAVE_PERSONNEL_PROFILES)).min(1).max(LEAVE_PERSONNEL_PROFILES.length),
    excludedProfiles: z
      .array(z.enum(LEAVE_PERSONNEL_PROFILES))
      .max(LEAVE_PERSONNEL_PROFILES.length)
      .optional(),
  })
  .strict();

const documentRequirementsSchema = z
  .object({
    additional: z.array(z.enum(LEAVE_EVIDENCE_KINDS)).max(LEAVE_EVIDENCE_KINDS.length).optional(),
  })
  .strict();

export const leavePolicyVersionCreateSchema = z
  .object({
    effectiveDate: z.string().date(),
    approvalRouteCode: z.string().trim().min(1).max(120),
    applicability: applicabilitySchema,
    documentRequirements: documentRequirementsSchema,
    reason: leaveReasonSchema,
  })
  .strict();

export const leavePolicyVersionUpdateSchema = z
  .object({
    effectiveDate: z.string().date(),
    approvalRouteCode: z.string().trim().min(1).max(120),
    applicability: applicabilitySchema,
    documentRequirements: documentRequirementsSchema,
    rowVersion: z.number().int().positive().optional(),
    reason: leaveReasonSchema,
  })
  .strict();

export const leavePolicyAuthoritySchema = z
  .object({
    authorityClass: z.enum(LEAVE_AUTHORITY_CLASSES),
    documentId: z.string().uuid(),
    citation: z.string().trim().min(1).max(300),
    validationReason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export const leavePolicyActivationSchema = z
  .object({
    reason: leaveReasonSchema,
  })
  .strict();
