import { z } from 'zod';

export const overtimeServiceRecordIdSchema = z.string().uuid();

export const overtimeServiceRecordSchema = z
  .object({
    overtimeAuthorityId: z.string().uuid(),
    employeeId: z.string().uuid(),
    workDate: z.string().date(),
    claimedHours: z
      .string()
      .trim()
      .regex(/^\d{1,8}(\.\d{1,4})?$/, 'Enter hours with at most four decimal places.')
      .refine((value) => Number(value) > 0, 'Enter more than zero hours.'),
    accomplishment: z.string().trim().min(1).max(4000),
  })
  .strict();

/** A CERTIFIED record stays on its Work Date, so no time rendered is a decline, not zero minutes. */
export const overtimeServiceCertificationSchema = z
  .object({ certifiedMinutes: z.number().int().positive().max(2147483647) })
  .strict();

export const overtimeServiceDeclineSchema = z
  .object({ declineReason: z.string().trim().min(1).max(4000) })
  .strict();
