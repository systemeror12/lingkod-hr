import { expect, it } from 'vitest';
import { hoursLabel, monthLabel, monthsBetween } from './overtime-format';

it('reads a minutes value the API sends without trailing zeros', () => {
  expect(hoursLabel('90.0')).toBe('90');
  expect(hoursLabel('135.5')).toBe('135.5');
});

it('names a calendar month from a month or a date', () => {
  expect(monthLabel('2026-05')).toBe('May 2026');
  expect(monthLabel('2026-05-01')).toBe('May 2026');
});

it('lists the months a range of Work Dates spans', () => {
  expect(monthsBetween('2026-05-11', '2026-05-15')).toEqual(['2026-05']);
  expect(monthsBetween('2026-11-30', '2027-01-04')).toEqual(['2026-11', '2026-12', '2027-01']);
  expect(monthsBetween('2026-05-11', '2026-04-01')).toEqual([]);
});
