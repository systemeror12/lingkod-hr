import { describe, expect, it } from 'vitest';
import {
  allocateCocAward,
  cocValidUntil,
  earnCoc,
  formatCocMinutes,
  type CocDayClassification,
} from './coc-earning-rule';

describe('earnCoc', () => {
  it.each<CocDayClassification>(['WORKDAY', 'SPECIAL_WORKING'])(
    'earns 1.0 on a scheduled %s',
    (classification) => {
      expect(earnCoc(61, classification)).toEqual({ earns: true, cocTenths: 610 });
    },
  );

  it.each<CocDayClassification>([
    'REST',
    'REGULAR_HOLIDAY',
    'SPECIAL_NON_WORKING',
    'LOCAL_HOLIDAY',
  ])('earns 1.5 on %s, exact to one decimal', (classification) => {
    expect(earnCoc(61, classification)).toEqual({ earns: true, cocTenths: 915 });
  });

  it('refuses a whole-day work suspension with a typed reason', () => {
    expect(earnCoc(60, 'WORK_SUSPENSION')).toEqual({
      earns: false,
      code: 'COC_WHOLE_DAY_WORK_SUSPENSION',
    });
  });

  it('refuses a partial-day work suspension with a typed reason', () => {
    expect(earnCoc(60, 'PARTIAL_DAY_WORK_SUSPENSION')).toEqual({
      earns: false,
      code: 'COC_PARTIAL_DAY_WORK_SUSPENSION',
    });
  });
});

describe('cocValidUntil', () => {
  it('is December 31 of the year after the earned month', () => {
    expect(cocValidUntil('2026-01-01')).toBe('2027-12-31');
    expect(cocValidUntil('2026-12-01')).toBe('2027-12-31');
  });
});

const line = (certificateLineId: string, workDate: string, cocTenths: number) => ({
  certificateLineId,
  workDate,
  cocTenths,
});

describe('allocateCocAward', () => {
  it('credits each line in full under both caps, in Work Date order', () => {
    const result = allocateCocAward(
      [line('b', '2026-03-10', 900), line('a', '2026-03-02', 600)],
      0,
      0,
    );
    expect(result.map((entry) => [entry.certificateLineId, entry.creditedTenths])).toEqual([
      ['a', 600],
      ['b', 900],
    ]);
    expect(result.every((entry) => entry.excessTenths === 0)).toBe(true);
  });

  it('stops at the 2,400-minute monthly cap, counting earlier certificates', () => {
    const result = allocateCocAward(
      [line('a', '2026-03-02', 3_000), line('b', '2026-03-03', 1_000)],
      21_000,
      0,
    );
    expect(
      result.map(({ creditedTenths, excessTenths }) => [creditedTenths, excessTenths]),
    ).toEqual([
      [3_000, 0],
      [0, 1_000],
    ]);
  });

  it('splits the line that crosses the monthly cap', () => {
    const [first] = allocateCocAward([line('a', '2026-03-02', 5_000)], 20_000, 0);
    expect(first).toMatchObject({ creditedTenths: 4_000, excessTenths: 1_000 });
  });

  it('stops at the 7,200-minute balance cap as of the approval date', () => {
    const result = allocateCocAward(
      [line('a', '2026-03-02', 2_000), line('b', '2026-03-03', 2_000)],
      0,
      70_000,
    );
    expect(
      result.map(({ creditedTenths, excessTenths }) => [creditedTenths, excessTenths]),
    ).toEqual([
      [2_000, 0],
      [0, 2_000],
    ]);
  });

  it('applies the lesser cap when both bind', () => {
    const [first] = allocateCocAward([line('a', '2026-03-02', 9_000)], 18_000, 67_000);
    expect(first).toMatchObject({ creditedTenths: 5_000, excessTenths: 4_000 });
  });

  it('credits nothing once the balance is already over the cap', () => {
    const [first] = allocateCocAward([line('a', '2026-03-02', 600)], 0, 75_000);
    expect(first).toMatchObject({ creditedTenths: 0, excessTenths: 600 });
  });
});

describe('formatCocMinutes', () => {
  it('renders tenths at one decimal place', () => {
    expect(formatCocMinutes(915)).toBe('91.5');
    expect(formatCocMinutes(0)).toBe('0.0');
    expect(formatCocMinutes(-5)).toBe('-0.5');
  });
});
