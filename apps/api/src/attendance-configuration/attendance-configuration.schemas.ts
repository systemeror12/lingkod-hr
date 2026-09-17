import { z } from 'zod';
import {
  DAY_RULE_TYPES,
  EVENT_PATTERNS,
  WORK_ARRANGEMENT_TYPES,
  WORK_SCHEDULE_TYPES,
} from './attendance-configuration.types';

const time = z.string().trim().min(1).max(8);
const optionalTime = time.nullable().optional();

const breakSchema = z
  .object({
    breakStartTime: time,
    breakEndTime: time,
    endNextCalendarDay: z.boolean().optional(),
  })
  .strict();

const dayRuleSchema = z
  .object({
    weekday: z.number().int().min(1).max(7),
    ruleType: z.enum(DAY_RULE_TYPES),
    dutyStartTime: optionalTime,
    earliestStartTime: optionalTime,
    latestStartTime: optionalTime,
    dutyEndTime: optionalTime,
    endNextCalendarDay: z.boolean().optional(),
    requiredMinutes: z.number().int().min(0).max(1440),
    coreStartTime: optionalTime,
    coreEndTime: optionalTime,
    eventPattern: z.enum(EVENT_PATTERNS),
    collectionBeforeMinutes: z.number().int().min(0).max(1440),
    collectionAfterMinutes: z.number().int().min(0).max(1440),
    breaks: z.array(breakSchema).max(12).optional(),
  })
  .strict();

const scheduleDefinition = {
  scheduleType: z.enum(WORK_SCHEDULE_TYPES),
  timezone: z.string().trim().min(1).max(100).optional(),
  effectiveDate: z.string().date(),
  dayRules: z.array(dayRuleSchema).length(7),
};

const arrangementDefinition = {
  arrangementType: z.enum(WORK_ARRANGEMENT_TYPES),
  permittedScheduleTypes: z.array(z.enum(WORK_SCHEDULE_TYPES)).min(1).max(4),
  holidayCalendarId: z.string().uuid(),
  effectiveDate: z.string().date(),
};

export const workScheduleCreateSchema = z
  .object({
    code: z.string().trim().min(1).max(80),
    name: z.string().trim().min(1).max(200),
    ...scheduleDefinition,
  })
  .strict();

export const workScheduleDraftUpdateSchema = z
  .object({
    ...scheduleDefinition,
    rowVersion: z.number().int().positive().optional(),
  })
  .strict();

export const workArrangementCreateSchema = z
  .object({
    code: z.string().trim().min(1).max(80),
    name: z.string().trim().min(1).max(200),
    ...arrangementDefinition,
  })
  .strict();

export const workArrangementDraftUpdateSchema = z
  .object({
    ...arrangementDefinition,
    rowVersion: z.number().int().positive().optional(),
  })
  .strict();

export const attendanceConfigurationActivationSchema = z
  .object({
    authorityDocumentVersionId: z.string().uuid(),
    approvingAuthority: z.string().trim().min(1).max(300),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export const attendanceConfigurationIdSchema = z.string().uuid();
export const attendanceConfigurationAsOfSchema = z.string().date().optional();
export const attendanceConfigurationIdempotencyKeySchema = z.string().trim().min(1).max(200);
