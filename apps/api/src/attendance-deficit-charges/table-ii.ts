/**
 * CSC MC No. 41, s. 1998, Table II: "Table showing conversion of working
 * hours/minutes into fractions of a day. Based on 8-Hour Day." Transcribed in
 * docs/research/authoritative-leave-credit-and-mandatory-leave-rules.md. The
 * printed values are the rule, so they are kept as printed, in thousandths of a
 * day, rather than derived by division.
 */
export const TABLE_II_AUTHORITY = 'CSC MC No. 41, s. 1998, Table II';

/** Thousandths of a day for 1 to 8 hours. */
const HOURS_ROW = [125, 250, 375, 500, 625, 750, 875, 1000] as const;

/** Thousandths of a day for 1 to 60 minutes. */
const MINUTES_ROW = [
  2, 4, 6, 8, 10, 12, 15, 17, 19, 21, 23, 25, 27, 29, 31, 33, 35, 37, 40, 42, 44, 46, 48, 50, 52,
  54, 56, 58, 60, 62, 65, 67, 69, 71, 73, 75, 77, 79, 81, 83, 85, 87, 90, 92, 94, 96, 98, 100, 102,
  104, 106, 108, 110, 112, 115, 117, 119, 121, 123, 125,
] as const;

export interface TableIIConversion {
  minutes: number;
  /** The whole-hours row, in thousandths of a day. */
  hoursThousandths: number;
  /** The remaining-minutes row, in thousandths of a day. */
  minutesThousandths: number;
  /** The fraction of a day, to three decimal places. */
  quantity: string;
}

/**
 * Convert minutes of tardiness or undertime on an eight-hour day: the
 * whole-hours row plus the remaining-minutes row, so 90 minutes is .125 + .062
 * = .187. Table II has no row past eight hours.
 */
export function convertTableII(minutes: number): TableIIConversion {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 480) {
    throw new RangeError('Table II converts whole minutes of an eight-hour day, 0 to 480.');
  }
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  const hoursThousandths = hours === 0 ? 0 : HOURS_ROW[hours - 1]!;
  const minutesThousandths = remainder === 0 ? 0 : MINUTES_ROW[remainder - 1]!;
  const total = hoursThousandths + minutesThousandths;
  return {
    minutes,
    hoursThousandths,
    minutesThousandths,
    quantity: `${Math.floor(total / 1000)}.${String(total % 1000).padStart(3, '0')}`,
  };
}
