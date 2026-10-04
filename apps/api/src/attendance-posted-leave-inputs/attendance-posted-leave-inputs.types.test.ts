import { describe, expect, it } from 'vitest';
import { postedLeaveAmbiguity, workingDayAmbiguity } from './attendance-posted-leave-inputs.types';

const range = { dateFrom: '2026-01-05', dateTo: '2026-01-07' };

describe('postedLeaveAmbiguity', () => {
  it('leaves whole working days to the schedule-aware working-day check', () => {
    expect(postedLeaveAmbiguity({ ...range, unitCode: 'WORKING_DAY', quantity: 2 })).toBeNull();
  });

  it('places calendar days only when the quantity matches the range', () => {
    expect(postedLeaveAmbiguity({ ...range, unitCode: 'CALENDAR_DAY', quantity: 3 })).toBeNull();
    expect(postedLeaveAmbiguity({ ...range, unitCode: 'CALENDAR_DAY', quantity: 2 })).toMatch(
      /calendar days/i,
    );
  });

  it('rejects a fraction of a day without a clock placement', () => {
    expect(
      postedLeaveAmbiguity({
        dateFrom: '2026-01-05',
        dateTo: '2026-01-05',
        unitCode: 'WORKING_DAY',
        quantity: 0.5,
      }),
    ).toMatch(/fraction/i);
  });

  it.each(['SCHEDULED_MINUTE', 'SOURCE_DEFINED'] as const)(
    'rejects the %s unit because it carries no whole-day placement',
    (unitCode) => {
      expect(postedLeaveAmbiguity({ ...range, unitCode, quantity: 3 })).toMatch(/clock placement/i);
    },
  );
});

describe('workingDayAmbiguity', () => {
  it('places working days only when the quantity equals the working dates of the range', () => {
    expect(workingDayAmbiguity(3, 3)).toBeNull();
  });

  it('rejects two approved working days over three working dates', () => {
    expect(workingDayAmbiguity(2, 3)).toMatch(/working dates/i);
  });

  it('rejects a quantity larger than the working dates of the range', () => {
    expect(workingDayAmbiguity(4, 3)).toMatch(/working dates/i);
  });

  it('fails closed when the schedule of the range cannot be resolved', () => {
    expect(workingDayAmbiguity(3, null)).toMatch(/schedule/i);
  });
});
