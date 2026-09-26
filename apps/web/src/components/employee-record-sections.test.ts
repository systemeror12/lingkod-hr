import { expect, it } from 'vitest';
import { employeeRecordSectionFor } from './employee-record-sections';

it('opens the section that owns a record selected in the URL', () => {
  expect(employeeRecordSectionFor(new URLSearchParams('document=d1'))).toBe('documents');
  expect(employeeRecordSectionFor(new URLSearchParams('identifierHistory=i1'))).toBe(
    'identifiers',
  );
  expect(employeeRecordSectionFor(new URLSearchParams('bankHistory=b1'))).toBe('bank-accounts');
  expect(employeeRecordSectionFor(new URLSearchParams('saln=s1'))).toBe('saln');
  expect(employeeRecordSectionFor(new URLSearchParams('salnHistory=true'))).toBe('saln');
});

it('returns null when no section record is selected', () => {
  expect(employeeRecordSectionFor(new URLSearchParams(''))).toBeNull();
  expect(employeeRecordSectionFor(new URLSearchParams('page=2'))).toBeNull();
});
