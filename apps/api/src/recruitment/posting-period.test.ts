import { describe, expect, it } from 'vitest';
import { manilaDayEnd, manilaDayStart } from './posting-period';

describe('posting period Manila day boundaries', () => {
  const day = new Date('2026-09-08T00:00:00.000Z');

  it('starts the Manila day at 16:00 UTC the previous day', () => {
    expect(manilaDayStart(day).toISOString()).toBe('2026-09-07T16:00:00.000Z');
  });

  it('ends the Manila day at 16:00 UTC the same day', () => {
    expect(manilaDayEnd(day).toISOString()).toBe('2026-09-08T16:00:00.000Z');
  });

  it('accepts an instant at 00:30 Manila as belonging to the opening day', () => {
    const instant = new Date('2026-09-07T16:30:00.000Z');
    expect(instant >= manilaDayStart(day) && instant < manilaDayEnd(day)).toBe(true);
  });
});
