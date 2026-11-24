import { expect, it } from 'vitest';
import { comparisonRefusal, issueLineLabel } from './legacy-register-comparisons';

it('reads every rejection reason the API sent', () => {
  const issues = [
    { line: 2, code: 'EMPLOYEE_UNKNOWN', message: 'No Employee of this Agency has E-404.' },
    { line: null, code: 'HEADER_INVALID', message: 'The first row must be the header.' },
  ];
  expect(
    comparisonRefusal(
      { error: { code: 'LEGACY_REGISTER_INVALID', message: 'Rejected.', issues } },
      'Failed.',
    ),
  ).toEqual({ message: 'Rejected.', issues });
});

it('falls back to a message and no reasons when the body has none', () => {
  expect(comparisonRefusal(null, 'Failed.')).toEqual({ message: 'Failed.', issues: [] });
  expect(comparisonRefusal({ error: { message: 'Not finalized.' } }, 'Failed.')).toEqual({
    message: 'Not finalized.',
    issues: [],
  });
});

it('names the line a reason points to, or the whole file', () => {
  expect(issueLineLabel(3)).toBe('Line 3');
  expect(issueLineLabel(null)).toBe('Whole file');
});
