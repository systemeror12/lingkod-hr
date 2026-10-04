import { expect, it } from 'vitest';
import { planCancellationScopes, type ApprovedAllocationLine } from './leave-cancellation-scope';

const lines: ApprovedAllocationLine[] = [
  {
    id: 'line-1',
    dateFrom: '2026-06-01',
    dateTo: '2026-06-05',
    quantity: '5.0000',
    unitCode: 'WORKING_DAY',
  },
  {
    id: 'line-2',
    dateFrom: '2026-06-08',
    dateTo: '2026-06-09',
    quantity: '2.0000',
    unitCode: 'CALENDAR_DAY',
  },
];

function partial(...scopes: Array<[string, string, string, string]>) {
  return scopes.map(([allocationLineId, dateFrom, dateTo, quantity]) => ({
    allocationLineId,
    dateFrom,
    dateTo,
    quantity,
  }));
}

it('derives a whole scope from every approved allocation line', () => {
  expect(planCancellationScopes('WHOLE', lines)).toEqual([
    {
      allocationLineId: 'line-1',
      dateFrom: '2026-06-01',
      dateTo: '2026-06-05',
      quantity: '5.0000',
    },
    {
      allocationLineId: 'line-2',
      dateFrom: '2026-06-08',
      dateTo: '2026-06-09',
      quantity: '2.0000',
    },
  ]);
});

it('accepts an exact subset of lines and a tail or head narrowing', () => {
  expect(
    planCancellationScopes(
      'PARTIAL',
      lines,
      partial(
        ['line-1', '2026-06-04', '2026-06-05', '2'],
        ['line-2', '2026-06-08', '2026-06-09', '2'],
      ),
    ),
  ).toEqual([
    {
      allocationLineId: 'line-1',
      dateFrom: '2026-06-04',
      dateTo: '2026-06-05',
      quantity: '2.0000',
    },
    {
      allocationLineId: 'line-2',
      dateFrom: '2026-06-08',
      dateTo: '2026-06-09',
      quantity: '2.0000',
    },
  ]);
  expect(
    planCancellationScopes('PARTIAL', lines, partial(['line-1', '2026-06-01', '2026-06-02', '2'])),
  ).toHaveLength(1);
});

it('rejects a scope that adds dates, exceeds quantity, or substitutes a line', () => {
  const reject = (scopes: ReturnType<typeof partial>) =>
    expect(() => planCancellationScopes('PARTIAL', lines, scopes)).toThrow();
  reject(partial(['line-1', '2026-05-31', '2026-06-02', '2']));
  reject(partial(['line-1', '2026-06-04', '2026-06-06', '2']));
  reject(partial(['line-1', '2026-06-04', '2026-06-05', '6']));
  reject(partial(['line-1', '2026-06-04', '2026-06-05', '0']));
  reject(partial(['line-unknown', '2026-06-04', '2026-06-05', '2']));
  reject(
    partial(
      ['line-1', '2026-06-04', '2026-06-05', '1'],
      ['line-1', '2026-06-01', '2026-06-02', '1'],
    ),
  );
});

it('keeps the retained period contiguous and the whole-line quantity exact', () => {
  const reject = (scopes: ReturnType<typeof partial>) =>
    expect(() => planCancellationScopes('PARTIAL', lines, scopes)).toThrow();
  // Middle dates leave two retained ranges.
  reject(partial(['line-1', '2026-06-02', '2026-06-04', '3']));
  // The full date range cancels the full quantity.
  reject(partial(['line-1', '2026-06-01', '2026-06-05', '4']));
  // A narrowed range that cancels the full quantity retains nothing for its dates.
  reject(partial(['line-1', '2026-06-04', '2026-06-05', '5']));
});

it('ties day quantities to the cancelled dates', () => {
  const reject = (scopes: ReturnType<typeof partial>) =>
    expect(() => planCancellationScopes('PARTIAL', lines, scopes)).toThrow();
  reject(partial(['line-1', '2026-06-04', '2026-06-05', '3']));
  reject(partial(['line-2', '2026-06-09', '2026-06-09', '1.5']));
  expect(
    planCancellationScopes('PARTIAL', lines, partial(['line-2', '2026-06-09', '2026-06-09', '1'])),
  ).toHaveLength(1);
});
