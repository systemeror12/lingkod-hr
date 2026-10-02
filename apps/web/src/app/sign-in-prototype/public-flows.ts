// PROTOTYPE (#398). What each public step says and does, independent of how a variant lays it out.

import { agency, passwordRule, user, type ScreenKey } from './fake-states';

export type Go = (state: string, screen?: ScreenKey) => void;

export type FieldSpec =
  | { kind: 'email'; readOnly?: boolean }
  | { kind: 'password' }
  | { kind: 'new-password' }
  | { kind: 'name' }
  | { kind: 'code' }
  | { kind: 'recovery' };

export type FieldKey = FieldSpec['kind'];

export type StepView = {
  flow: string;
  kicker: string;
  rail: { label: string; status: 'done' | 'current' | 'todo' }[];
  title: string;
  lead?: string;
  identity?: string;
  /** Lifetime of the server-side pending sign-in or activation, in seconds. */
  pendingSeconds?: number;
  pendingLabel?: string;
  error?: { message: string; field?: FieldKey };
  wait?: { minutesLeft: number; message: string };
  /** Replaces the form: a terminal error, or a success that leaves the flow. */
  outcome?: {
    tone: 'danger' | 'warning' | 'success';
    kicker: string;
    title: string;
    body: string;
    action?: { label: string; go: () => void };
    secondary?: { label: string; go: () => void };
  };
  fields?: FieldSpec[];
  /** Without callbacks, the variant switches between code and Recovery Code locally. */
  factor?: { current: 'code' | 'recovery'; toCode?: () => void; toRecovery?: () => void };
  enrollment?: 'scan' | 'codes';
  codesLeft?: { count: number; actions: { label: string; go: () => void; primary?: boolean }[] };
  primary?: { label: string; busyLabel: string; next: () => void; requiresAck?: boolean };
  secondary?: { label: string; go: () => void }[];
  footnote?: string;
};

const signInRail = (current: 0 | 1): StepView['rail'] => [
  { label: 'Email and password', status: current === 0 ? 'current' : 'done' },
  { label: 'Verify it’s you', status: current === 1 ? 'current' : 'todo' },
];

const enrollRail = (first: string, current: 1 | 2 | 3): StepView['rail'] => [
  { label: first, status: 'done' },
  {
    label: 'Set up authenticator',
    status: current === 1 ? 'current' : current > 1 ? 'done' : 'todo',
  },
  {
    label: 'Save Recovery Codes',
    status: current === 2 ? 'current' : current > 2 ? 'done' : 'todo',
  },
];

export function signInView(state: string, go: Go): StepView {
  const base = { flow: 'Sign in', kicker: 'LingkodHR' };
  const factor = {
    toCode: () => go('totp'),
    toRecovery: () => go('recovery'),
  };
  switch (state) {
    case 'totp':
    case 'totp-invalid':
      return {
        ...base,
        rail: signInRail(1),
        title: 'Enter your authenticator code',
        lead: 'Open your authenticator app and enter the 6-digit code for LingkodHR.',
        identity: user.email,
        pendingSeconds: 300,
        pendingLabel: 'Sign-in expires',
        fields: [{ kind: 'code' }],
        factor: { current: 'code', ...factor },
        ...(state === 'totp-invalid'
          ? { error: { message: 'That code didn’t work. Try the current code.', field: 'code' } }
          : {}),
        primary: {
          label: 'Verify',
          busyLabel: 'Verifying…',
          next: () => go('overview', 'account'),
        },
        secondary: [{ label: 'Use a different account', go: () => go('password') }],
      };
    case 'recovery':
    case 'recovery-invalid':
      return {
        ...base,
        rail: signInRail(1),
        title: 'Enter a Recovery Code',
        lead: 'Use one of the codes you saved when you set up your authenticator. Each code works once.',
        identity: user.email,
        pendingSeconds: 300,
        pendingLabel: 'Sign-in expires',
        fields: [{ kind: 'recovery' }],
        factor: { current: 'recovery', ...factor },
        ...(state === 'recovery-invalid'
          ? { error: { message: 'That Recovery Code didn’t work.', field: 'recovery' } }
          : {}),
        primary: { label: 'Verify', busyLabel: 'Verifying…', next: () => go('recovery-used') },
        secondary: [{ label: 'Use a different account', go: () => go('password') }],
        footnote: 'Lost your codes too? Contact your Security Administrator.',
      };
    case 'ceiling':
      return {
        ...base,
        rail: signInRail(1),
        title: 'Reset your password',
        identity: user.email,
        outcome: {
          tone: 'danger',
          kicker: 'Password reset required',
          title: 'Reset your password to sign in',
          body: 'Your password was accepted, but the code after it was wrong too many times. Your password won’t work until you reset it. We emailed you about this.',
          action: { label: 'Reset password', go: () => go('request', 'reset') },
        },
      };
    case 'recovery-used':
    case 'recovery-used-last': {
      const count = state === 'recovery-used' ? 7 : 0;
      return {
        ...base,
        rail: signInRail(1),
        title: 'You signed in with a Recovery Code',
        lead:
          count > 0
            ? 'We signed you out of your other sessions and emailed you a notice. If you lost your authenticator, replace it now.'
            : 'That was your last code. If you lose your authenticator without codes, only a Security Administrator can reset it.',
        identity: user.email,
        codesLeft: {
          count,
          actions: [
            {
              label: 'Replace authenticator',
              go: () => go('replace-factor', 'account'),
              primary: count > 0,
            },
            {
              label: 'Generate new codes',
              go: () => go('prompt', 'reauth'),
              primary: count === 0,
            },
            { label: 'Continue to workspace', go: () => go('overview', 'account') },
          ],
        },
      };
    }
    default:
      return {
        ...base,
        rail: signInRail(0),
        title: 'Sign in to your Agency workspace',
        fields: [{ kind: 'email' }, { kind: 'password' }],
        ...(state === 'password-invalid'
          ? { error: { message: 'Email or password is incorrect.' } }
          : {}),
        ...(state === 'expired'
          ? { error: { message: 'Your sign-in timed out. Enter your email and password again.' } }
          : {}),
        ...(state === 'cooldown'
          ? {
              wait: {
                minutesLeft: 9,
                message: 'Too many attempts for this email. Try again in 9 minutes.',
              },
            }
          : {}),
        primary: { label: 'Sign in', busyLabel: 'Signing in…', next: () => go('totp') },
        secondary: [{ label: 'Forgot password?', go: () => go('request', 'reset') }],
      };
  }
}

function enrollmentSteps(
  state: 'scan' | 'scan-invalid' | 'codes',
  common: Pick<StepView, 'flow' | 'kicker' | 'identity' | 'pendingSeconds' | 'pendingLabel'>,
  firstStep: string,
  onConfirmed: () => void,
  onFinished: () => void,
  finishLabel: string,
  cancel: { label: string; go: () => void },
): StepView {
  if (state === 'codes')
    return {
      ...common,
      rail: enrollRail(firstStep, 2),
      title: 'Save your Recovery Codes',
      lead: 'If you lose your authenticator, each code lets you sign in once. You won’t see these codes again.',
      enrollment: 'codes',
      primary: { label: finishLabel, busyLabel: 'Saving…', next: onFinished, requiresAck: true },
    };
  return {
    ...common,
    rail: enrollRail(firstStep, 1),
    title: 'Set up your authenticator',
    lead: 'Your role needs a second step at sign-in. Scan this QR code with an authenticator app, then enter the code it shows.',
    enrollment: 'scan',
    fields: [{ kind: 'code' }],
    ...(state === 'scan-invalid'
      ? {
          error: {
            message: 'That code didn’t match. Check the app’s clock and try the current code.',
            field: 'code',
          },
        }
      : {}),
    primary: { label: 'Confirm code', busyLabel: 'Confirming…', next: onConfirmed },
    secondary: [cancel],
  };
}

export function enrollView(state: string, go: Go): StepView {
  const common = {
    flow: 'Sign in',
    kicker: 'LingkodHR',
    identity: user.email,
    pendingSeconds: 300,
    pendingLabel: 'Sign-in expires',
  };
  if (state === 'done')
    return {
      ...common,
      rail: enrollRail('Email and password', 3),
      title: 'You’re set up',
      outcome: {
        tone: 'success',
        kicker: 'Authenticator added',
        title: 'You’re set up',
        body: 'From now on, sign-in asks for a code from this app. We emailed you a notice.',
        action: { label: 'Open workspace', go: () => go('overview', 'account') },
      },
    };
  return enrollmentSteps(
    state === 'codes' || state === 'scan-invalid' ? state : 'scan',
    common,
    'Email and password',
    () => go('codes'),
    () => go('done'),
    'Continue',
    { label: 'Use a different account', go: () => go('password', 'sign-in') },
  );
}

export function inviteView(state: string, go: Go): StepView {
  const kicker = `Invitation · ${agency.acronym}`;
  const lead = `${agency.name} invited you as HRMO Officer.`;
  const firstTimeRail: StepView['rail'] = [
    { label: 'Set your password', status: 'current' },
    { label: 'Set up authenticator', status: 'todo' },
    { label: 'Save Recovery Codes', status: 'todo' },
  ];
  const existingRail = (current: 0 | 1): StepView['rail'] => [
    { label: 'Confirm your password', status: current === 0 ? 'current' : 'done' },
    { label: 'Verify it’s you', status: current === 1 ? 'current' : 'todo' },
  ];
  const base = { flow: 'Activate access', kicker, identity: user.email };
  const pending = { pendingSeconds: 900, pendingLabel: 'Setup expires' };
  const restart = { label: 'Start again', go: () => go('first-time') };
  switch (state) {
    case 'first-time':
    case 'first-time-rule':
      return {
        ...base,
        rail: firstTimeRail,
        title: 'Activate your LingkodHR access',
        lead: `${lead} Set your name and a password. Nothing is saved until you finish.`,
        fields: [{ kind: 'email', readOnly: true }, { kind: 'name' }, { kind: 'new-password' }],
        ...(state === 'first-time-rule'
          ? { error: { message: passwordRule, field: 'new-password' } }
          : {}),
        primary: { label: 'Continue', busyLabel: 'Checking…', next: () => go('enroll') },
      };
    case 'existing':
    case 'existing-invalid':
      return {
        ...base,
        rail: existingRail(0),
        title: `Join ${agency.acronym} with your account`,
        lead: `${lead} You already have a LingkodHR account, so enter your current password. It won’t change.`,
        fields: [{ kind: 'email', readOnly: true }, { kind: 'password' }],
        ...(state === 'existing-invalid'
          ? { error: { message: 'Email or password is incorrect.' } }
          : {}),
        primary: { label: 'Continue', busyLabel: 'Checking…', next: () => go('existing-code') },
        secondary: [{ label: 'Forgot password?', go: () => go('request', 'reset') }],
      };
    case 'existing-code':
      return {
        ...base,
        ...pending,
        rail: existingRail(1),
        title: 'Enter your authenticator code',
        lead: 'Enter the 6-digit code from your authenticator app to accept the invitation.',
        fields: [{ kind: 'code' }],
        factor: { current: 'code' },
        primary: { label: 'Accept invitation', busyLabel: 'Activating…', next: () => go('done') },
      };
    case 'existing-locked':
      return {
        ...base,
        rail: existingRail(0),
        title: 'Your account is locked',
        outcome: {
          tone: 'danger',
          kicker: 'Account locked',
          title: 'Your account is locked',
          body: 'A Security Administrator locked your account. Contact your Agency Administrator. This invitation stays open until it expires.',
        },
      };
    case 'enroll':
    case 'codes':
      return enrollmentSteps(
        state === 'codes' ? 'codes' : 'scan',
        { ...base, ...pending },
        'Set your password',
        () => go('codes'),
        () => go('done'),
        'Finish activation',
        restart,
      );
    case 'activation-expired':
      return {
        ...base,
        rail: firstTimeRail,
        title: 'Your setup timed out',
        outcome: {
          tone: 'warning',
          kicker: 'Nothing was saved',
          title: 'Your setup timed out',
          body: 'Setup has to finish within 15 minutes. Your invitation link still works, so you can start again.',
          action: restart,
        },
      };
    case 'link-expired':
      return {
        ...base,
        rail: firstTimeRail,
        title: 'This invitation has expired',
        outcome: {
          tone: 'warning',
          kicker: 'Invitation expired',
          title: 'This invitation has expired',
          body: 'Invitations last 7 days. Ask your Agency Administrator to send a new one. No access was granted.',
        },
      };
    case 'link-used':
      return {
        ...base,
        rail: firstTimeRail,
        title: 'This invitation can’t be used',
        outcome: {
          tone: 'danger',
          kicker: 'Invitation invalid',
          title: 'This invitation can’t be used',
          body: 'It was already accepted or replaced by a newer invitation. If you didn’t accept it, contact your Agency Administrator.',
          action: { label: 'Sign in', go: () => go('password', 'sign-in') },
        },
      };
    default:
      return {
        ...base,
        rail: [
          { label: 'Set your password', status: 'done' },
          { label: 'Set up authenticator', status: 'done' },
          { label: 'Save Recovery Codes', status: 'done' },
        ],
        title: `You’re in ${agency.acronym}`,
        outcome: {
          tone: 'success',
          kicker: 'Access activated',
          title: `You now have access to ${agency.acronym}`,
          body: `You’re signed in to ${agency.name} as HRMO Officer.`,
          action: { label: 'Open workspace', go: () => go('overview', 'account') },
        },
      };
  }
}

export function resetView(state: string, go: Go): StepView {
  const base = { flow: 'Reset password', kicker: 'LingkodHR' };
  const rail = (current: 0 | 1 | 2): StepView['rail'] =>
    ['Request a link', 'Choose a new password', 'Sign in again'].map((label, index) => ({
      label,
      status: index < current ? 'done' : index === current ? 'current' : 'todo',
    }));
  const backToSignIn = { label: 'Back to sign in', go: () => go('password', 'sign-in') };
  switch (state) {
    case 'request-sent':
      return {
        ...base,
        rail: rail(1),
        title: 'Check your email',
        outcome: {
          tone: 'success',
          kicker: 'Check your email',
          title: 'If that email belongs to a LingkodHR account, we’ve sent a reset link.',
          body: 'The link works once, for 30 minutes. Asking again replaces the earlier link.',
          action: { label: 'Open the link (demo)', go: () => go('form') },
          secondary: backToSignIn,
        },
      };
    case 'form':
    case 'form-no-factor':
    case 'form-rule':
    case 'form-code-invalid':
    case 'form-cooldown': {
      const hasFactor = state !== 'form-no-factor';
      return {
        ...base,
        rail: rail(1),
        title: 'Choose a new password',
        lead: hasFactor
          ? 'You still need your authenticator code. A reset signs you out on every device.'
          : 'A reset signs you out on every device.',
        identity: user.email,
        fields: hasFactor
          ? [{ kind: 'new-password' }, { kind: 'code' }]
          : [{ kind: 'new-password' }],
        ...(hasFactor ? { factor: { current: 'code' as const } } : {}),
        ...(state === 'form-rule'
          ? { error: { message: passwordRule, field: 'new-password' } }
          : {}),
        ...(state === 'form-code-invalid'
          ? { error: { message: 'That code didn’t work. Your link still works.', field: 'code' } }
          : {}),
        ...(state === 'form-cooldown'
          ? {
              wait: {
                minutesLeft: 18,
                message: 'Too many wrong codes for this account. Try again in 18 minutes.',
              },
            }
          : {}),
        primary: { label: 'Reset password', busyLabel: 'Resetting…', next: () => go('done') },
      };
    }
    case 'link-invalid':
      return {
        ...base,
        rail: rail(1),
        title: 'This reset link can’t be used',
        outcome: {
          tone: 'danger',
          kicker: 'Link invalid',
          title: 'This reset link is invalid or has expired.',
          body: 'Request a new one.',
          action: { label: 'Request a new link', go: () => go('request') },
        },
      };
    case 'done':
      return {
        ...base,
        rail: rail(2),
        title: 'Your password was reset',
        outcome: {
          tone: 'success',
          kicker: 'Password reset',
          title: 'Your password was reset',
          body: 'We signed you out on every device and emailed you a notice. Sign in with your new password.',
          action: { label: 'Sign in', go: () => go('password', 'sign-in') },
        },
      };
    default:
      return {
        ...base,
        rail: rail(0),
        title: 'Reset your password',
        lead: 'Enter the email you sign in with. If it belongs to an account, we’ll send a reset link.',
        fields: [{ kind: 'email' }],
        primary: {
          label: 'Send reset link',
          busyLabel: 'Sending…',
          next: () => go('request-sent'),
        },
        secondary: [backToSignIn],
      };
  }
}

export function publicView(screen: ScreenKey, state: string, go: Go): StepView {
  if (screen === 'enroll') return enrollView(state, go);
  if (screen === 'invite') return inviteView(state, go);
  if (screen === 'reset') return resetView(state, go);
  return signInView(state, go);
}
