import { describe, expect, it } from 'vitest';
import {
  datesBetween,
  datesToCancel,
  drawCtoUsage,
  firstUncoveredWorkDate,
} from './cto-request-rule';

const date = (workDate: string, chargedMinutes = 480) => ({ workDate, chargedMinutes });

describe('datesBetween', () => {
  it('excludes both ends and crosses a month', () => {
    expect([...datesBetween('2026-11-27', '2026-12-02')]).toEqual([
      '2026-11-28',
      '2026-11-29',
      '2026-11-30',
      '2026-12-01',
    ]);
  });

  it('is empty for adjacent dates', () => {
    expect([...datesBetween('2026-11-27', '2026-11-28')]).toEqual([]);
  });
});

describe('firstUncoveredWorkDate', () => {
  it('covers a date exactly', () => {
    expect(
      firstUncoveredWorkDate([{ validUntil: '2027-12-31', tenths: 4800 }], [date('2027-01-04')]),
    ).toBeNull();
  });

  it('names the first date past what is available, one tenth short', () => {
    expect(
      firstUncoveredWorkDate(
        [{ validUntil: '2027-12-31', tenths: 9599 }],
        [date('2027-01-05'), date('2027-01-04')],
      ),
    ).toBe('2027-01-05');
  });

  it('does not count COC past its Valid Until on the date', () => {
    expect(
      firstUncoveredWorkDate([{ validUntil: '2026-12-31', tenths: 4800 }], [date('2027-01-04')]),
    ).toBe('2027-01-04');
  });

  it('spends the expiring COC first, so a later date keeps the longer-lived COC', () => {
    expect(
      firstUncoveredWorkDate(
        [
          { validUntil: '2027-12-31', tenths: 4800 },
          { validUntil: '2026-12-31', tenths: 4800 },
        ],
        [date('2026-12-31'), date('2027-01-04')],
      ),
    ).toBeNull();
  });

  it('splits one date across two Valid Untils', () => {
    expect(
      firstUncoveredWorkDate(
        [
          { validUntil: '2026-12-31', tenths: 2400 },
          { validUntil: '2027-12-31', tenths: 2400 },
        ],
        [date('2026-12-30')],
      ),
    ).toBeNull();
  });

  it('skips a Valid Until left at zero or below by earlier entries', () => {
    expect(
      firstUncoveredWorkDate(
        [
          { validUntil: '2026-12-31', tenths: -100 },
          { validUntil: '2027-12-31', tenths: 4800 },
        ],
        [date('2026-12-30')],
      ),
    ).toBeNull();
  });
});

describe('drawCtoUsage', () => {
  it('draws the earliest Valid Until first and splits a date across two', () => {
    expect(
      drawCtoUsage(
        [
          { validUntil: '2027-12-31', tenths: 9600 },
          { validUntil: '2026-12-31', tenths: 3000 },
        ],
        [date('2026-12-15'), date('2026-12-14')],
      ),
    ).toEqual({
      draws: [
        { workDate: '2026-12-14', validUntil: '2026-12-31', tenths: 3000 },
        { workDate: '2026-12-14', validUntil: '2027-12-31', tenths: 1800 },
        { workDate: '2026-12-15', validUntil: '2027-12-31', tenths: 4800 },
      ],
      uncovered: null,
    });
  });

  it('skips COC past its Valid Until on the date and an emptied Valid Until', () => {
    expect(
      drawCtoUsage(
        [
          { validUntil: '2026-12-31', tenths: 4800 },
          { validUntil: '2027-12-31', tenths: 0 },
          { validUntil: '2028-12-31', tenths: 4800 },
        ],
        [date('2027-01-04')],
      ),
    ).toEqual({
      draws: [{ workDate: '2027-01-04', validUntil: '2028-12-31', tenths: 4800 }],
      uncovered: null,
    });
  });

  it('refuses a date that would need a third Valid Until', () => {
    expect(
      drawCtoUsage(
        [
          { validUntil: '2026-12-31', tenths: 100 },
          { validUntil: '2027-12-31', tenths: 100 },
          { validUntil: '2028-12-31', tenths: 9600 },
        ],
        [date('2026-12-14')],
      ).uncovered,
    ).toBe('2026-12-14');
  });
});

describe('datesToCancel', () => {
  const dates = [
    { workDate: '2027-01-04', cancelledByCtoCancellationId: 'earlier' },
    { workDate: '2027-01-05', cancelledByCtoCancellationId: null },
    { workDate: '2027-01-06', cancelledByCtoCancellationId: null },
  ];

  it('takes every uncancelled date when none are named', () => {
    expect(datesToCancel(dates, undefined).map((date) => date.workDate)).toEqual([
      '2027-01-05',
      '2027-01-06',
    ]);
  });

  it('takes only the named dates, in Work Date order', () => {
    expect(datesToCancel(dates, ['2027-01-06', '2027-01-05']).map((date) => date.workDate)).toEqual(
      ['2027-01-05', '2027-01-06'],
    );
  });

  it('refuses a date not on the request or already cancelled', () => {
    expect(() => datesToCancel(dates, ['2027-01-07'])).toThrow(
      expect.objectContaining({ code: 'CTO_WORK_DATE_NOT_ON_REQUEST', statusCode: 422 }),
    );
    expect(() => datesToCancel(dates, ['2027-01-05', '2027-01-04'])).toThrow(
      expect.objectContaining({ code: 'CTO_WORK_DATE_ALREADY_CANCELLED', statusCode: 409 }),
    );
  });
});
