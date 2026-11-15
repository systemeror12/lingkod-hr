import { expect, it } from 'vitest';
import { monthRange } from './compensation-basis';

it('spans the calendar month that holds a date', () => {
  expect(monthRange('2750-07-15')).toEqual({ from: '2750-07-01', to: '2750-07-31' });
  expect(monthRange('2028-02-03')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  expect(monthRange('2026-11-30')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
});
