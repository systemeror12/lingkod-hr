import { z } from 'zod';

export const passwordSignInSchema = z
  .object({
    email: z.string().trim().min(1).max(320),
    password: z.string().min(1).max(1024),
    membershipId: z.string().uuid().optional(),
  })
  .strict();

export const totpSignInSchema = z
  .object({
    code: z
      .string()
      .max(32)
      .transform((code) => code.replace(/\s/g, '')),
  })
  .strict();

/** Matched without regard to case, hyphens, or spaces; `normalizeRecoveryCode` does the rest. */
export const recoveryCodeSignInSchema = z.object({ code: z.string().max(64) }).strict();

/** The password, plus a TOTP code or a Recovery Code when the User has an authenticator app. */
export const reauthenticateSchema = z
  .object({
    password: z.string().min(1).max(1024),
    code: totpSignInSchema.shape.code.optional(),
    recoveryCode: recoveryCodeSignInSchema.shape.code.optional(),
  })
  .strict();

export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1).max(1024),
    newPassword: z.string().min(1).max(1024),
    code: totpSignInSchema.shape.code.optional(),
    recoveryCode: recoveryCodeSignInSchema.shape.code.optional(),
  })
  .strict();

export const totpReplacementSchema = z.object({ code: totpSignInSchema.shape.code }).strict();

export const enrollmentFinishSchema = z.object({ acknowledged: z.literal(true) }).strict();

export const activationTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/, 'Invalid invitation token.');

/** A first-time User's name and new password, or an existing User's password and no name. */
export const activationStartSchema = z
  .object({
    name: z.string().max(200).optional(),
    password: z.string().min(1).max(1024),
  })
  .strict();

export const passwordResetRequestSchema = z
  .object({ email: z.string().trim().min(1).max(320) })
  .strict();

/** A new password, with a TOTP code or a Recovery Code when the User has a factor. */
export const passwordResetCompleteSchema = z
  .object({
    password: z.string().min(1).max(1024),
    code: z
      .string()
      .max(32)
      .transform((code) => code.replace(/\s/g, ''))
      .optional(),
    recoveryCode: z.string().max(64).optional(),
  })
  .strict();

export const switchAgencySchema = z.object({ membershipId: z.string().uuid() }).strict();

export const invitationSchema = z
  .object({
    email: z.string().trim().email().max(320),
    roleCodes: z.array(z.string().trim().min(1).max(100)).min(1).max(32),
  })
  .strict();

export const hrmoInvitationSchema = z
  .object({
    email: z.string().trim().email().max(320),
    roleCodes: z.tuple([z.literal('hrmo_administrator')]),
  })
  .strict();

export const agencyIdSchema = z.string().uuid();

export const membershipIdSchema = z.string().uuid();

/** A member-list page: the Service Records cursor contract (#468). */
export const memberListSchema = z
  .object({
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

/** How a Security Administrator verified the User before a Factor Reset. No ID numbers or images. */
export const factorResetSchema = z
  .object({
    method: z.enum(['IN_PERSON_GOVERNMENT_ID', 'VIDEO_CALL_GOVERNMENT_ID']),
    note: z.string().trim().min(1).max(1000),
  })
  .strict();

/** Why a Security Administrator locks or unlocks a User. */
export const userLockSchema = z
  .object({
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();
