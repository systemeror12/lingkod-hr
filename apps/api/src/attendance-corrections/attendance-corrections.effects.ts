import type { Prisma } from '@prisma/client';
import type { AttendanceEventType, AttendanceWorkDateEvent } from '../attendance/attendance.types';
import {
  attendanceCorrectionContextFactSchema,
  attendanceCorrectionEventFactSchema,
} from './attendance-corrections.types';

/**
 * One applied Attendance Correction effect normalized for calculation. The
 * effect id becomes the effective fact id so successor Attendance Day segments
 * keep exact correction lineage while the original fact stays untouched.
 */
export interface AttendanceCorrectionEventOverlay {
  effectId: string;
  effectAction: 'ADD' | 'REPLACE' | 'VOID';
  originalTargetId: string | null;
  eventType: AttendanceEventType | null;
  eventTime: Date | null;
}

export interface AttendanceCorrectionContextOverlay {
  effectId: string;
  effectAction: 'ADD' | 'REPLACE' | 'VOID';
  originalTargetId: string | null;
  contextType: string | null;
  coverageMode: string | null;
  workDate: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  reason: string | null;
  appliedByMembershipId: string;
  appliedAt: Date;
}

export interface AppliedAttendanceCorrectionOverlays {
  events: AttendanceCorrectionEventOverlay[];
  contexts: AttendanceCorrectionContextOverlay[];
}

export const EMPTY_ATTENDANCE_CORRECTION_OVERLAYS: AppliedAttendanceCorrectionOverlays = {
  events: [],
  contexts: [],
};

/**
 * Apply applied-correction overlays to the raw Attendance Events of one Work
 * Date. A VOID or REPLACE removes its immutable original; a replacement that
 * lands inside this Work Date is appended, so a fact moved across an event
 * window is dropped on the old side and added on the new side.
 */
export function applyEventCorrectionOverlays(
  events: readonly AttendanceWorkDateEvent[],
  overlays: readonly AttendanceCorrectionEventOverlay[],
  includesEventTime: (eventTime: Date) => boolean,
): AttendanceWorkDateEvent[] {
  if (overlays.length === 0) return [...events];
  const byTarget = new Map<string, AttendanceCorrectionEventOverlay>();
  for (const overlay of overlays) {
    if (overlay.originalTargetId) byTarget.set(overlay.originalTargetId, overlay);
  }
  const effective: AttendanceWorkDateEvent[] = [];
  const seenTargets = new Set<string>();
  for (const event of events) {
    const overlay = byTarget.get(event.id);
    if (!overlay) {
      effective.push(event);
      continue;
    }
    seenTargets.add(event.id);
    if (overlay.effectAction === 'VOID' || !overlay.eventType || !overlay.eventTime) continue;
    if (includesEventTime(overlay.eventTime)) {
      effective.push({
        id: overlay.effectId,
        eventType: overlay.eventType,
        eventTime: overlay.eventTime,
      });
    }
  }
  for (const overlay of overlays) {
    if (overlay.originalTargetId && seenTargets.has(overlay.originalTargetId)) continue;
    if (overlay.effectAction === 'VOID' || !overlay.eventType || !overlay.eventTime) continue;
    if (includesEventTime(overlay.eventTime)) {
      effective.push({
        id: overlay.effectId,
        eventType: overlay.eventType,
        eventTime: overlay.eventTime,
      });
    }
  }
  effective.sort(
    (left, right) =>
      left.eventTime.getTime() - right.eventTime.getTime() || left.id.localeCompare(right.id),
  );
  return effective;
}

/**
 * Whether one applied context effect covers the Work Date window being
 * calculated. Whole-work-date facts match by Work Date; timed facts intersect
 * the caller's exact window.
 */
export function contextOverlayCoversWindow(
  overlay: AttendanceCorrectionContextOverlay,
  workDate: string,
  windowStartsAt: Date,
  windowEndsAt: Date,
): boolean {
  if (overlay.coverageMode === 'WHOLE_WORK_DATE') return overlay.workDate === workDate;
  if (!overlay.startsAt || !overlay.endsAt) return false;
  return (
    overlay.startsAt.getTime() < windowEndsAt.getTime() &&
    overlay.endsAt.getTime() > windowStartsAt.getTime()
  );
}

export interface AppliedAttendanceCorrectionEffectRow {
  id: string;
  effectAction: string;
  targetType: string;
  originalTargetId: string | null;
  replacementRecord: Prisma.JsonValue;
  appliedByMembershipId: string;
  appliedAt: Date;
}

/**
 * Normalize stored Attendance Correction Effects for calculation. A stored
 * effect that does not parse fails closed instead of quietly dropping the
 * correction from the recalculated result.
 */
export function parseAppliedCorrectionOverlays(
  rows: readonly AppliedAttendanceCorrectionEffectRow[],
): AppliedAttendanceCorrectionOverlays {
  const overlays: AppliedAttendanceCorrectionOverlays = { events: [], contexts: [] };
  for (const row of rows) {
    const effectAction = row.effectAction as 'ADD' | 'REPLACE' | 'VOID';
    if (row.targetType === 'ATTENDANCE_EVENT') {
      if (effectAction === 'VOID') {
        overlays.events.push({
          effectId: row.id,
          effectAction,
          originalTargetId: row.originalTargetId,
          eventType: null,
          eventTime: null,
        });
        continue;
      }
      const parsed = attendanceCorrectionEventFactSchema.safeParse(row.replacementRecord);
      if (!parsed.success) {
        throw new Error('The stored Attendance Correction Event effect is invalid.');
      }
      overlays.events.push({
        effectId: row.id,
        effectAction,
        originalTargetId: row.originalTargetId,
        eventType: parsed.data.eventType,
        eventTime: new Date(parsed.data.eventTime),
      });
      continue;
    }
    if (row.targetType === 'ATTENDANCE_CONTEXT') {
      if (effectAction === 'VOID') {
        overlays.contexts.push({
          effectId: row.id,
          effectAction,
          originalTargetId: row.originalTargetId,
          contextType: null,
          coverageMode: null,
          workDate: null,
          startsAt: null,
          endsAt: null,
          reason: null,
          appliedByMembershipId: row.appliedByMembershipId,
          appliedAt: row.appliedAt,
        });
        continue;
      }
      const parsed = attendanceCorrectionContextFactSchema.safeParse(row.replacementRecord);
      if (!parsed.success) {
        throw new Error('The stored Attendance Correction Context effect is invalid.');
      }
      overlays.contexts.push({
        effectId: row.id,
        effectAction,
        originalTargetId: row.originalTargetId,
        contextType: parsed.data.contextType,
        coverageMode: parsed.data.coverageMode,
        workDate: parsed.data.coverageMode === 'WHOLE_WORK_DATE' ? parsed.data.workDate : null,
        startsAt: parsed.data.coverageMode === 'TIMED' ? new Date(parsed.data.startsAt) : null,
        endsAt: parsed.data.coverageMode === 'TIMED' ? new Date(parsed.data.endsAt) : null,
        reason: parsed.data.reason,
        appliedByMembershipId: row.appliedByMembershipId,
        appliedAt: row.appliedAt,
      });
    }
  }
  return overlays;
}
