import { expect, it } from 'vitest';
import { activeCooldown, addSignInFailure, type SignInThrottleState } from './sign-in-cooldown';

const start = new Date('2026-10-02T06:00:00.000Z');
const minutes = (count: number) => count * 60 * 1000;
const at = (offsetMs: number) => new Date(start.getTime() + offsetMs);

/** Adds `count` failures one second apart, starting at `from`. */
function fail(state: SignInThrottleState | null, count: number, from: Date) {
  let current = state;
  const started = [];
  for (let index = 0; index < count; index += 1) {
    const result = addSignInFailure(current, new Date(from.getTime() + index * 1000));
    current = result.state;
    if (result.cooldown) started.push(result.cooldown);
  }
  return { state: current, started };
}

it('starts a 5-minute cool-down on the fifth failure and not before', () => {
  const four = fail(null, 4, start);
  expect(four.started).toEqual([]);
  expect(activeCooldown(four.state, at(10_000))).toBeNull();

  const fifth = addSignInFailure(four.state, at(4_000));
  expect(fifth.cooldown).toEqual({ level: 1, minutes: 5, until: at(4_000 + minutes(5)) });
  expect(activeCooldown(fifth.state, at(5_000))).toEqual(at(4_000 + minutes(5)));
  expect(activeCooldown(fifth.state, at(4_000 + minutes(5)))).toBeNull();
});

it('doubles each later cool-down for the same email up to 60 minutes', () => {
  let state: SignInThrottleState | null = null;
  let now = start;
  const ladder = [];
  for (let round = 0; round < 6; round += 1) {
    const result = fail(state, 5, now);
    state = result.state;
    ladder.push(result.started.map(({ minutes: length }) => length));
    now = new Date((state?.cooldownUntil ?? now).getTime() + 1000);
  }
  expect(ladder).toEqual([[5], [10], [20], [40], [60], [60]]);
});

it('ignores failures that arrive during a cool-down', () => {
  const { state } = fail(null, 5, start);
  const during = addSignInFailure(state, at(minutes(1)));
  expect(during).toEqual({ state, cooldown: null });
});

it('counts a row whose last failure is more than 24 hours old as reset', () => {
  const twoRounds = fail(fail(null, 5, start).state, 5, at(minutes(6))).state;
  expect(twoRounds?.cooldownLevel).toBe(2);

  const lastFailure = twoRounds?.lastFailureAt ?? start;
  const stillCounted = addSignInFailure(
    twoRounds,
    new Date(lastFailure.getTime() + minutes(24 * 60)),
  );
  expect(stillCounted.state.cooldownLevel).toBe(2);

  const later = new Date(lastFailure.getTime() + minutes(24 * 60) + 1);
  const reset = addSignInFailure(twoRounds, later);
  expect(reset).toEqual({
    state: { failureCount: 1, cooldownLevel: 0, cooldownUntil: null, lastFailureAt: later },
    cooldown: null,
  });
});
