import { z } from 'zod';

const token = z.string().min(1).max(512);

export const loginQuerySchema = z
  .object({
    invitation: token.optional(),
    membershipId: z.string().uuid().optional(),
  })
  .strict();

export const callbackQuerySchema = z
  .object({
    state: token,
    code: z.string().min(1).max(4096),
  })
  .strict();

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

export const enrollmentFinishSchema = z.object({ acknowledged: z.literal(true) }).strict();

export const activationTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/, 'Invalid invitation token.');

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

export const backchannelLogoutSchema = z
  .object({ logout_token: z.string().min(1).max(8192) })
  .strict();
