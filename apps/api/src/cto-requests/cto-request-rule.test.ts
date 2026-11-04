import { describe, expect, it } from 'vitest';
import { datesBetween, firstUncoveredWorkDate } from './cto-request-rule';

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
