import { expect, it } from 'vitest';
import { convertTableII } from './table-ii';

// Table II as printed in CSC MC No. 41, s. 1998, page 15, transcribed in the
// leave research. Kept apart from the implementation so a typo in either fails.
const PRINTED_MINUTES: Record<number, string> = {
  1: '.002',
  2: '.004',
  3: '.006',
  4: '.008',
  5: '.010',
  6: '.012',
  7: '.015',
  8: '.017',
  9: '.019',
  10: '.021',
  11: '.023',
  12: '.025',
  13: '.027',
  14: '.029',
  15: '.031',
  16: '.033',
  17: '.035',
  18: '.037',
  19: '.040',
  20: '.042',
  21: '.044',
  22: '.046',
  23: '.048',
  24: '.050',
  25: '.052',
  26: '.054',
  27: '.056',
  28: '.058',
  29: '.060',
  30: '.062',
  31: '.065',
  32: '.067',
  33: '.069',
  34: '.071',
  35: '.073',
  36: '.075',
  37: '.077',
  38: '.079',
  39: '.081',
  40: '.083',
  41: '.085',
  42: '.087',
  43: '.090',
  44: '.092',
  45: '.094',
  46: '.096',
  47: '.098',
  48: '.100',
  49: '.102',
  50: '.104',
  51: '.106',
  52: '.108',
  53: '.110',
  54: '.112',
  55: '.115',
  56: '.117',
  57: '.119',
  58: '.121',
  59: '.123',
  60: '.125',
};
const PRINTED_HOURS: Record<number, string> = {
  1: '.125',
  2: '.250',
  3: '.375',
  4: '.500',
  5: '.625',
  6: '.750',
  7: '.875',
  8: '1.000',
};

it('returns every printed minutes value of Table II', () => {
  for (const [minutes, printed] of Object.entries(PRINTED_MINUTES)) {
    expect(convertTableII(Number(minutes)).quantity).toBe(`0${printed}`);
  }
});

it('returns every printed hours value of Table II', () => {
  for (const [hours, printed] of Object.entries(PRINTED_HOURS)) {
    const expected = printed.startsWith('.') ? `0${printed}` : printed;
    expect(convertTableII(Number(hours) * 60).quantity).toBe(expected);
  }
});

it('keeps the exact halves rounded down as printed', () => {
  expect([6, 18, 30, 42, 54].map((minutes) => convertTableII(minutes).quantity)).toEqual([
    '0.012',
    '0.037',
    '0.062',
    '0.087',
    '0.112',
  ]);
});

it('adds the whole-hours row to the remaining-minutes row', () => {
  expect(convertTableII(90)).toEqual({
    minutes: 90,
    hoursThousandths: 125,
    minutesThousandths: 62,
    quantity: '0.187',
  });
  expect(convertTableII(0).quantity).toBe('0.000');
  expect(convertTableII(479).quantity).toBe('0.998');
});

it('has no row past an eight-hour day or for a partial minute', () => {
  expect(() => convertTableII(481)).toThrow(RangeError);
  expect(() => convertTableII(-1)).toThrow(RangeError);
  expect(() => convertTableII(1.5)).toThrow(RangeError);
});
