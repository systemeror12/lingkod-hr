import { expect, it } from 'vitest';
import { leaveWithoutPayWorkDates } from './leave-without-pay-work-dates';

const weekdays = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
  weekday,
  ruleType: weekday <= 5 ? 'FIXED' : 'REST',
}));

const day = (workDate: string) => ({ workDate, quantity: '1.0000' });

it('places one day on each working date, skipping rest days and non-working holidays', () => {
  expect(
    leaveWithoutPayWorkDates({
      dateFrom: '2026-06-11',
      dateTo: '2026-06-16',
      unitCode: 'WORKING_DAY',
      quantity: '3.0000',
      dayRules: weekdays,
      holidayFacts: {
        holidayCalendarVersionId: null,
        entries: [
          { holidayDate: '2026-06-12', dayType: 'REGULAR_HOLIDAY' },
          { holidayDate: '2026-06-15', dayType: 'SPECIAL_WORKING' },
        ],
      },
    }),
  ).toEqual({ workDates: [day('2026-06-11'), day('2026-06-15'), day('2026-06-16')] });
});

it('places one day on every calendar date of a calendar-day line', () => {
  expect(
    leaveWithoutPayWorkDates({
      dateFrom: '2026-06-30',
      dateTo: '2026-07-01',
      unitCode: 'CALENDAR_DAY',
      quantity: '2.0000',
      dayRules: null,
      holidayFacts: null,
    }),
  ).toEqual({ workDates: [day('2026-06-30'), day('2026-07-01')] });
});

it('refuses a line that is only part of its range, because no rule says which dates are unpaid', () => {
  expect(
    leaveWithoutPayWorkDates({
      dateFrom: '2026-06-01',
      dateTo: '2026-06-05',
      unitCode: 'WORKING_DAY',
      quantity: '2.0000',
      dayRules: weekdays,
      holidayFacts: { entries: [] },
    }),
  ).toEqual({ reason: expect.stringContaining('2.0000 of the 5 Work Dates') });
});

it('refuses a unit with no day per Work Date, and a schedule it cannot read', () => {
  const line = { dateFrom: '2026-06-01', dateTo: '2026-06-01', quantity: '480.0000' };
  expect(
    leaveWithoutPayWorkDates({
      ...line,
      unitCode: 'SCHEDULED_TIME',
      dayRules: weekdays,
      holidayFacts: { entries: [] },
    }),
  ).toEqual({ reason: expect.stringContaining('SCHEDULED_TIME') });
  expect(
    leaveWithoutPayWorkDates({
      ...line,
      quantity: '1.0000',
      unitCode: 'WORKING_DAY',
      dayRules: null,
      holidayFacts: { entries: [] },
    }),
  ).toEqual({ reason: expect.stringContaining('Work Schedule') });
  expect(
    leaveWithoutPayWorkDates({
      ...line,
      quantity: '1.0000',
      unitCode: 'WORKING_DAY',
      dayRules: weekdays,
      holidayFacts: { entries: 'unreadable' },
    }),
  ).toEqual({ reason: expect.stringContaining('holiday') });
});
