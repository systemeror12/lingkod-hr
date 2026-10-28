import { describe, expect, it } from 'vitest';
import { overtimeAuthorityDraftSchema } from './overtime-authorities.schemas';

const employeeId = '00000000-0000-4000-8000-000000000001';
const draft = {
  authorityNo: 'OT-2030-001',
  requestingUnitId: '00000000-0000-4000-8000-000000000002',
  purpose: 'Year-end closing of accounts.',
  workDateFrom: '2030-06-01',
  workDateTo: '2030-06-30',
  compensationMethod: 'COC',
  employees: [{ employeeId, authorizedHours: '16' }],
};

function failedFields(value: unknown): PropertyKey[] {
  const parsed = overtimeAuthorityDraftSchema.safeParse(value);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.path[0] ?? '');
}

describe('overtimeAuthorityDraftSchema', () => {
  it('accepts a COC draft without a funding reference', () => {
    expect(failedFields(draft)).toEqual([]);
  });

  it('refuses a last Work Date before the first', () => {
    expect(failedFields({ ...draft, workDateTo: '2030-05-31' })).toEqual(['workDateTo']);
  });

  it('requires a funding reference only for overtime pay', () => {
    expect(failedFields({ ...draft, compensationMethod: 'OVERTIME_PAY' })).toEqual([
      'fundingReference',
    ]);
    expect(
      failedFields({ ...draft, compensationMethod: 'OVERTIME_PAY', fundingReference: 'GAA' }),
    ).toEqual([]);
    expect(failedFields({ ...draft, compensationMethod: 'TO_BE_DETERMINED' })).toEqual([
      'compensationMethod',
    ]);
  });

  it('requires positive hours and each Employee once', () => {
    expect(failedFields({ ...draft, employees: [{ employeeId, authorizedHours: '0' }] })).toEqual([
      'employees',
    ]);
    expect(failedFields({ ...draft, employees: [] })).toEqual(['employees']);
    expect(
      failedFields({
        ...draft,
        employees: [
          { employeeId, authorizedHours: '4' },
          { employeeId, authorizedHours: '4' },
        ],
      }),
    ).toEqual(['employees']);
  });
});
