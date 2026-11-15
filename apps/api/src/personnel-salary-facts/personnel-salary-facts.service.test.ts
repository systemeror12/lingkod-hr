import { describe, expect, it } from 'vitest';
import { coverRange, PersonnelSalaryFactsService } from './personnel-salary-facts.service';

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

function segment(id: string, from: string, to: string | null, salaryStep: number) {
  return {
    id,
    salaryGrade: 11,
    salaryStep,
    effectiveFrom: date(from),
    effectiveTo: to ? date(to) : null,
  };
}

const inService = (id: string, from: string, to: string, salaryStep: number) => ({
  status: 'IN_SERVICE',
  from,
  to,
  serviceSegmentId: id,
  salaryGrade: 11,
  salaryStep,
  payBasis: null,
  employmentFraction: null,
});

describe('coverRange', () => {
  it('splits a mid-period step increment into two stretches', () => {
    expect(
      coverRange(
        [segment('a', '2020-01-01', '2026-03-14', 1), segment('b', '2026-03-15', null, 2)],
        date('2026-03-01'),
        date('2026-03-31'),
      ),
    ).toEqual([
      inService('a', '2026-03-01', '2026-03-14', 1),
      inService('b', '2026-03-15', '2026-03-31', 2),
    ]);
  });

  it('reports dates before, between, and after Service Segments as uncovered', () => {
    expect(
      coverRange(
        [segment('a', '2026-03-05', '2026-03-10', 1), segment('b', '2026-03-20', '2026-03-25', 2)],
        date('2026-03-01'),
        date('2026-03-31'),
      ),
    ).toEqual([
      { status: 'NO_SERVICE_SEGMENT', from: '2026-03-01', to: '2026-03-04' },
      inService('a', '2026-03-05', '2026-03-10', 1),
      { status: 'NO_SERVICE_SEGMENT', from: '2026-03-11', to: '2026-03-19' },
      inService('b', '2026-03-20', '2026-03-25', 2),
      { status: 'NO_SERVICE_SEGMENT', from: '2026-03-26', to: '2026-03-31' },
    ]);
  });

  it('reports a date with no Service Segment as uncovered', () => {
    expect(coverRange([], date('2026-03-01'), date('2026-03-01'))).toEqual([
      { status: 'NO_SERVICE_SEGMENT', from: '2026-03-01', to: '2026-03-01' },
    ]);
  });
});

describe('PersonnelSalaryFactsService', () => {
  const service = new PersonnelSalaryFactsService();
  const transaction = {} as never;

  it.each([
    ['2026-02-30', '2026-03-01', 'PERSONNEL_SALARY_FACTS_INVALID_DATE'],
    ['2026-03-01', '20260331', 'PERSONNEL_SALARY_FACTS_INVALID_DATE'],
    ['2026-03-31', '2026-03-01', 'PERSONNEL_SALARY_FACTS_INVALID_RANGE'],
  ])('refuses %s to %s before reading', async (from, to, code) => {
    await expect(
      service.readInTransaction(transaction, 'agency', 'employee', from, to),
    ).rejects.toMatchObject({ statusCode: 400, code });
  });
});
