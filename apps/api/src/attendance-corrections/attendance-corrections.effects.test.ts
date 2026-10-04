import { describe, expect, it } from 'vitest';
import {
  applyEventCorrectionOverlays,
  contextOverlayCoversWindow,
  type AttendanceCorrectionContextOverlay,
  type AttendanceCorrectionEventOverlay,
} from './attendance-corrections.effects';
import type { AttendanceWorkDateEvent } from '../attendance/attendance.types';

function event(id: string, eventType: AttendanceWorkDateEvent['eventType'], time: string) {
  return { id, eventType, eventTime: new Date(time) } satisfies AttendanceWorkDateEvent;
}

function eventOverlay(values: {
  effectId: string;
  effectAction: 'ADD' | 'REPLACE' | 'VOID';
  originalTargetId: string | null;
  eventType?: AttendanceWorkDateEvent['eventType'] | null;
  eventTime?: Date | null;
}): AttendanceCorrectionEventOverlay {
  return {
    effectId: values.effectId,
    effectAction: values.effectAction,
    originalTargetId: values.originalTargetId,
    eventType: values.eventType ?? 'TIME_OUT',
    eventTime: values.eventTime ?? null,
  };
}

describe('applyEventCorrectionOverlays', () => {
  const always = () => true;
  const base = [
    event('in', 'TIME_IN', '2026-01-05T00:00:00.000Z'),
    event('out', 'TIME_OUT', '2026-01-05T08:00:00.000Z'),
  ];

  it('returns the raw events when no overlays apply', () => {
    expect(applyEventCorrectionOverlays(base, [], always)).toEqual(base);
  });

  it('voids an original and keeps the rest in order', () => {
    const result = applyEventCorrectionOverlays(
      base,
      [eventOverlay({ effectId: 'e1', effectAction: 'VOID', originalTargetId: 'out' })],
      always,
    );
    expect(result.map((item) => item.id)).toEqual(['in']);
  });

  it('replaces the original with the effect fact and keeps correction lineage', () => {
    const result = applyEventCorrectionOverlays(
      base,
      [
        eventOverlay({
          effectId: 'e1',
          effectAction: 'REPLACE',
          originalTargetId: 'out',
          eventTime: new Date('2026-01-05T09:00:00.000Z'),
        }),
      ],
      always,
    );
    expect(result).toEqual([
      base[0],
      {
        id: 'e1',
        eventType: 'TIME_OUT',
        eventTime: new Date('2026-01-05T09:00:00.000Z'),
      },
    ]);
  });

  it('adds a proposed fact without an original', () => {
    const result = applyEventCorrectionOverlays(
      base,
      [
        eventOverlay({
          effectId: 'e1',
          effectAction: 'ADD',
          originalTargetId: null,
          eventType: 'BREAK_OUT',
          eventTime: new Date('2026-01-05T04:00:00.000Z'),
        }),
      ],
      always,
    );
    expect(result.map((item) => item.id)).toEqual(['in', 'e1', 'out']);
  });

  it('drops a moved fact from the old window and applies it in the new window', () => {
    const overlay = eventOverlay({
      effectId: 'e1',
      effectAction: 'REPLACE',
      originalTargetId: 'out',
      eventTime: new Date('2026-01-06T09:00:00.000Z'),
    });
    const oldWindow = (time: Date) => time.getUTCDate() === 5;
    const newWindow = (time: Date) => time.getUTCDate() === 6;
    const oldDate = applyEventCorrectionOverlays(base, [overlay], oldWindow);
    expect(oldDate.map((item) => item.id)).toEqual(['in']);
    const newDate = applyEventCorrectionOverlays([], [overlay], newWindow);
    expect(newDate.map((item) => item.id)).toEqual(['e1']);
  });
});

describe('contextOverlayCoversWindow', () => {
  const windowStart = new Date('2026-01-05T00:00:00.000Z');
  const windowEnd = new Date('2026-01-06T00:00:00.000Z');

  function overlay(
    values: Partial<AttendanceCorrectionContextOverlay>,
  ): AttendanceCorrectionContextOverlay {
    return {
      effectId: 'e1',
      effectAction: 'ADD',
      originalTargetId: null,
      contextType: 'OFFICIAL_BUSINESS',
      coverageMode: 'WHOLE_WORK_DATE',
      workDate: '2026-01-05',
      startsAt: null,
      endsAt: null,
      reason: 'Official business.',
      appliedByMembershipId: 'm1',
      appliedAt: new Date('2026-01-05T02:00:00.000Z'),
      ...values,
    };
  }

  it('matches a whole-work-date fact by Work Date', () => {
    expect(contextOverlayCoversWindow(overlay({}), '2026-01-05', windowStart, windowEnd)).toBe(
      true,
    );
    expect(contextOverlayCoversWindow(overlay({}), '2026-01-06', windowStart, windowEnd)).toBe(
      false,
    );
  });

  it('matches a timed fact by window intersection', () => {
    const timed = overlay({
      coverageMode: 'TIMED',
      workDate: null,
      startsAt: new Date('2026-01-05T23:00:00.000Z'),
      endsAt: new Date('2026-01-06T02:00:00.000Z'),
    });
    expect(contextOverlayCoversWindow(timed, '2026-01-05', windowStart, windowEnd)).toBe(true);
    const outside = overlay({
      coverageMode: 'TIMED',
      workDate: null,
      startsAt: new Date('2026-01-06T01:00:00.000Z'),
      endsAt: new Date('2026-01-06T02:00:00.000Z'),
    });
    expect(contextOverlayCoversWindow(outside, '2026-01-05', windowStart, windowEnd)).toBe(false);
  });
});
