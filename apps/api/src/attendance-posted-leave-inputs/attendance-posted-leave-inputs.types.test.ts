import { describe, expect, it } from 'vitest';
import { postedLeaveAmbiguity } from './attendance-posted-leave-inputs.types';

const range = { dateFrom: '2026-01-05', dateTo: '2026-01-07' };

describe('postedLeaveAmbiguity', () => {
  it('places whole working days inside the date range', () => {
    expect(postedLeaveAmbiguity({ ...range, unitCode: 'WORKING_DAY', quantity: 3 })).toBeNull();
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

  it('rejects a working-day quantity larger than the range', () => {
    expect(postedLeaveAmbiguity({ ...range, unitCode: 'WORKING_DAY', quantity: 4 })).toMatch(
      /exceeds/i,
    );
  });

  it.each(['SCHEDULED_MINUTE', 'SOURCE_DEFINED'] as const)(
    'rejects the %s unit because it carries no whole-day placement',
    (unitCode) => {
      expect(postedLeaveAmbiguity({ ...range, unitCode, quantity: 3 })).toMatch(/clock placement/i);
    },
  );
});
