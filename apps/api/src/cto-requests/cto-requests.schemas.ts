import { z } from 'zod';
import { CTO_CANCELLATION_KINDS, CTO_MAX_WORK_DATES } from './cto-requests.types';

export const ctoRequestIdSchema = z.string().uuid();

export const ctoRequestIdempotencyKeySchema = z.string().trim().min(1).max(200);

const workDateSchema = z.string().date();

const ctoRequestDateSchema = z
  .discriminatedUnion('unit', [
    z.object({ workDate: workDateSchema, unit: z.literal('WHOLE') }).strict(),
    z
      .object({
        workDate: workDateSchema,
        unit: z.literal('HALF'),
        startsAt: z.string().datetime({ offset: true }),
        endsAt: z.string().datetime({ offset: true }),
      })
      .strict(),
  ])
  .superRefine((date, context) => {
    if (date.unit === 'HALF' && new Date(date.endsAt) <= new Date(date.startsAt)) {
      context.addIssue({
        code: 'custom',
        message: 'A half day ends after it starts.',
        path: ['endsAt'],
      });
    }
  });

export const ctoRequestCreateSchema = z
  .object({
    employeeId: z.string().uuid(),
    dates: z.array(ctoRequestDateSchema).min(1).max(CTO_MAX_WORK_DATES),
  })
  .strict();

export const ctoRequestRecommendSchema = z
  .object({ comment: z.string().trim().min(1).max(2000).optional() })
  .strict();

export const ctoRequestReturnSchema = z
  .object({ comment: z.string().trim().min(1).max(2000) })
  .strict();

export const ctoRequestApproveSchema = z
  .object({ comment: z.string().trim().min(1).max(2000).optional() })
  .strict();

export const ctoRequestRejectSchema = z
  .object({ reason: z.string().trim().min(1, 'Enter a reason for rejecting.').max(2000) })
  .strict();

export const ctoRequestCancelSchema = z
  .object({
    kind: z.enum(CTO_CANCELLATION_KINDS),
    reason: z.string().trim().min(1, 'Enter a reason for cancelling.').max(2000),
    workDates: z
      .array(workDateSchema)
      .min(1)
      .max(CTO_MAX_WORK_DATES)
      .refine((dates) => new Set(dates).size === dates.length, 'Name each Work Date once.')
      .optional(),
  })
  .strict();
