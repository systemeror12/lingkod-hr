const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * Returns the instant a calendar day begins in Manila (UTC+8, no daylight
 * saving). `day` is a date-only value stored as UTC midnight.
 */
export function manilaDayStart(day: Date): Date {
  return new Date(day.getTime() - MANILA_OFFSET_MS);
}

/** Returns the first instant after the Manila calendar day `day`. */
export function manilaDayEnd(day: Date): Date {
  return new Date(day.getTime() + 24 * 60 * 60 * 1000 - MANILA_OFFSET_MS);
}
