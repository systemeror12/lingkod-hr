/**
 * The Sign-in Cool-down ladder for one keyed email hash (#364). 5 failures start a cool-down, and
 * each later one for the same email doubles: 5, 10, 20, 40, then 60 minutes. A state whose last
 * failure is more than 24 hours old counts as reset.
 */
export interface SignInThrottleState {
  /** Failures since the last cool-down started. */
  failureCount: number;
  /** Cool-downs started so far; the next one uses the following step of the ladder. */
  cooldownLevel: number;
  cooldownUntil: Date | null;
  lastFailureAt: Date;
}

export interface SignInCooldownStart {
  level: number;
  minutes: number;
  until: Date;
}

export const SIGN_IN_COOLDOWN_FAILURES = 5;
const COOLDOWN_MINUTES = [5, 10, 20, 40, 60] as const;
const RESET_AFTER_MS = 24 * 60 * 60 * 1000;

function current(state: SignInThrottleState | null, now: Date): SignInThrottleState | null {
  return state && now.getTime() - state.lastFailureAt.getTime() <= RESET_AFTER_MS ? state : null;
}

/** When the running cool-down ends, or null when attempts are allowed. */
export function activeCooldown(state: SignInThrottleState | null, now: Date): Date | null {
  const until = current(state, now)?.cooldownUntil;
  return until && until > now ? until : null;
}

/**
 * Adds one failure. A failure during a running cool-down changes nothing. Answers the new state
 * and the cool-down it started, if any.
 */
export function addSignInFailure(
  state: SignInThrottleState | null,
  now: Date,
): { state: SignInThrottleState; cooldown: SignInCooldownStart | null } {
  if (state && activeCooldown(state, now)) return { state, cooldown: null };
  const base = current(state, now) ?? { failureCount: 0, cooldownLevel: 0, cooldownUntil: null };
  const failureCount = base.failureCount + 1;
  if (failureCount < SIGN_IN_COOLDOWN_FAILURES) {
    return { state: { ...base, failureCount, lastFailureAt: now }, cooldown: null };
  }
  const level = base.cooldownLevel + 1;
  const minutes = COOLDOWN_MINUTES[Math.min(level, COOLDOWN_MINUTES.length) - 1] ?? 60;
  const until = new Date(now.getTime() + minutes * 60 * 1000);
  return {
    state: { failureCount: 0, cooldownLevel: level, cooldownUntil: until, lastFailureAt: now },
    cooldown: { level, minutes, until },
  };
}
