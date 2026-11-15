import { expect, it } from 'vitest';
import {
  allowedPayeeCategories,
  compareRates,
  effectivityLabel,
  supersessionDisplay,
} from './payroll-rules';

it('labels a version by its own dates and reads a superseded one as replaced', () => {
  expect(effectivityLabel({ effectiveFrom: '2750-01-01', effectiveTo: null })).toBe(
    'From Jan 1, 2750',
  );
  expect(effectivityLabel({ effectiveFrom: '2750-01-01', effectiveTo: '2750-12-31' })).toBe(
    'Jan 1, 2750 to Dec 31, 2750',
  );
  expect(
    supersessionDisplay({ supersededBy: { id: 'b', code: 'B', effectiveFrom: '2750-07-01' } }),
  ).toEqual({ label: 'Superseded from Jul 1, 2750', tone: 'neutral' });
  expect(supersessionDisplay({ supersededBy: null })).toEqual({
    label: 'Not superseded',
    tone: 'info',
  });
});

it('lines up two schedules by grade and step, keeping a rate only one of them has', () => {
  expect(
    compareRates(
      [
        { salaryGrade: 24, salaryStep: 1, monthlyRate: '2400.0000' },
        { salaryGrade: 11, salaryStep: 1, monthlyRate: '1100.0000' },
      ],
      [
        { salaryGrade: 24, salaryStep: 2, monthlyRate: '2410.0000' },
        { salaryGrade: 24, salaryStep: 1, monthlyRate: '2450.0000' },
      ],
    ),
  ).toEqual([
    { salaryGrade: 11, salaryStep: 1, left: '1100.0000', right: null },
    { salaryGrade: 24, salaryStep: 1, left: '2400.0000', right: '2450.0000' },
    { salaryGrade: 24, salaryStep: 2, left: null, right: '2410.0000' },
  ]);
});

it('reads only string payee categories from the parameters', () => {
  expect(allowedPayeeCategories({ allowedPayeeCategories: ['GSIS', 7, 'HDMF'] })).toEqual([
    'GSIS',
    'HDMF',
  ]);
  expect(allowedPayeeCategories({})).toEqual([]);
  expect(allowedPayeeCategories(null)).toEqual([]);
});
