import { z } from 'zod';
import { ATTENDANCE_EVENT_TYPES } from './attendance.types';

export const attendanceIdSchema = z.string().uuid();
export const attendanceIdempotencyKeySchema = z.string().trim().min(1).max(200);
export const attendanceWorkDateSchema = z.string().date();

export const attendanceEventTimeSchema = z.string().datetime({ offset: true });

export const manualAttendanceEventSchema = z
  .object({
    employeeId: z.string().uuid(),
    eventType: z.enum(ATTENDANCE_EVENT_TYPES),
    eventTime: attendanceEventTimeSchema,
    reason: z.string().trim().min(1).max(500),
    sourceReference: z.string().trim().min(1).max(300).optional(),
  })
  .strict();

export const clockAttendanceEventSchema = z
  .object({
    eventType: z.enum(ATTENDANCE_EVENT_TYPES).optional(),
  })
  .strict();

export const webClockEnablementSchema = z
  .object({
    enabled: z.boolean(),
    effectiveFrom: attendanceWorkDateSchema,
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export const attendanceEventListQuerySchema = z
  .object({
    employeeId: z.string().uuid().optional(),
    from: attendanceWorkDateSchema.optional(),
    to: attendanceWorkDateSchema.optional(),
  })
  .strict();

export const attendanceWebClockAsOfQuerySchema = attendanceWorkDateSchema.optional();
