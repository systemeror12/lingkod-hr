import { z } from 'zod';
import { CTO_MAX_WORK_DATES } from './cto-requests.types';

export const ctoRequestIdSchema = z.string().uuid();

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
