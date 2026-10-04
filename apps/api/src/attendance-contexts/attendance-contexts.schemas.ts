import { z } from 'zod';
import {
  ATTENDANCE_CONTEXT_COVERAGE_MODES,
  ATTENDANCE_CONTEXT_TYPES,
} from './attendance-contexts.types';

const contextDefinition = {
  employeeId: z.string().uuid(),
  contextType: z.enum(ATTENDANCE_CONTEXT_TYPES),
  reason: z.string().trim().min(1).max(1000),
  sourceType: z.string().trim().min(1).max(100).optional(),
  sourceId: z.string().uuid().optional(),
  evidenceDocumentVersionId: z.string().uuid().optional(),
};

export const attendanceContextCreateSchema = z
  .discriminatedUnion('coverageMode', [
    z
      .object({
        ...contextDefinition,
        coverageMode: z.literal('WHOLE_WORK_DATE'),
        workDate: z.string().date(),
      })
      .strict(),
    z
      .object({
        ...contextDefinition,
        coverageMode: z.literal('TIMED'),
        startsAt: z.string().datetime({ offset: true }),
        endsAt: z.string().datetime({ offset: true }),
      })
      .strict(),
  ])
  .superRefine((value, context) => {
    const hasSourceType = value.sourceType !== undefined;
    const hasSourceId = value.sourceId !== undefined;
    if (hasSourceType !== hasSourceId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A linked authoritative source record requires both its type and its identifier.',
        path: ['sourceId'],
      });
    }
    if (!hasSourceType && value.evidenceDocumentVersionId === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Attendance Context requires a linked authoritative source record or a supporting Document Version.',
        path: ['evidenceDocumentVersionId'],
      });
    }
  });

export const attendanceContextEmployeeIdSchema = z.string().uuid().optional();
export const attendanceContextTypeSchema = z.enum(ATTENDANCE_CONTEXT_TYPES).optional();
export const attendanceContextCoverageModeSchema = z
  .enum(ATTENDANCE_CONTEXT_COVERAGE_MODES)
  .optional();
export const attendanceContextIdempotencyKeySchema = z.string().trim().min(1).max(200);
