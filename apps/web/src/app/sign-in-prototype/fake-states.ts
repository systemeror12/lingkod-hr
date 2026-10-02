// PROTOTYPE (#398). Fake, in-memory states for the login and account security screens.
// Nothing here calls the API. Rules come from #363–#368 and #370; this file only shows them.

export type FakeState = { key: string; label: string; fake: Record<string, unknown> };
export type ScreenKey = 'sign-in' | 'enroll' | 'invite' | 'reset' | 'reauth' | 'account' | 'admin';

export const user = {
  displayName: 'Maria Clara Santos',
  email: 'maria.santos@doh.gov.ph',
};

export const agency = {
  department: 'Department of Health',
  name: 'Center for Health Development – NCR',
  // Non-breaking hyphen, so the acronym never wraps mid-name.
  acronym: 'DOH CHD\u2011NCR',
};

export const otpauthUri =
  'otpauth://totp/LingkodHR:maria.santos%40doh.gov.ph?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=LingkodHR&algorithm=SHA1&digits=6&period=30';

export const manualSecret = 'JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP';

export const recoveryCodes = [
  'k7q2m-x9tfa',
  'p4wzn-c2hrd',
  'b8s6e-yv3qk',
  'f2r9j-n7awm',
  'h5d3x-q8lpc',
  'z6m4t-w2gbe',
  'a3n8v-k5ryd',
  'u9c2p-j4hsx',
  'e7g5b-m3tzq',
  'w2y6f-d8kna',
];

export type Member = {
  id: string;
  name: string;
  email: string;
  roles: string;
  membership: 'ACTIVE' | 'INVITED' | 'SUSPENDED' | 'DEACTIVATED';
  lock: 'NONE' | 'LOCKED_HERE' | 'LOCKED_ELSEWHERE';
  factor: 'ENROLLED' | 'NONE';
  mfaRequired: boolean;
  self?: boolean;
};

export const members: Member[] = [
  {
    id: 'u1',
    name: 'Jose Rizal Dela Cruz',
    email: 'jose.delacruz@doh.gov.ph',
    roles: 'Security Administrator',
    membership: 'ACTIVE',
    lock: 'NONE',
    factor: 'ENROLLED',
    mfaRequired: true,
    self: true,
  },
  {
    id: 'u2',
    name: 'Maria Clara Santos',
    email: 'maria.santos@doh.gov.ph',
    roles: 'HRMO Officer',
    membership: 'ACTIVE',
    lock: 'NONE',
    factor: 'ENROLLED',
    mfaRequired: true,
  },
  {
    id: 'u3',
    name: 'Andres Bonifacio Reyes',
    email: 'andres.reyes@doh.gov.ph',
    roles: 'Payroll Officer',
    membership: 'ACTIVE',
    lock: 'LOCKED_HERE',
    factor: 'ENROLLED',
    mfaRequired: true,
  },
  {
    id: 'u4',
    name: 'Gabriela Silang Torres',
    email: 'gabriela.torres@doh.gov.ph',
    roles: 'Employee',
    membership: 'ACTIVE',
    lock: 'LOCKED_ELSEWHERE',
    factor: 'NONE',
    mfaRequired: false,
  },
  {
    id: 'u5',
    name: 'Apolinario Mabini Cruz',
    email: 'apolinario.cruz@doh.gov.ph',
    roles: 'Leave Officer',
    membership: 'SUSPENDED',
    lock: 'NONE',
    factor: 'ENROLLED',
    mfaRequired: true,
  },
  {
    id: 'u6',
    name: 'Melchora Aquino Ramos',
    email: 'melchora.ramos@doh.gov.ph',
    roles: 'HRMO Officer',
    membership: 'INVITED',
    lock: 'NONE',
    factor: 'NONE',
    mfaRequired: true,
  },
];

export const passwordRule = 'Use at least 15 characters. This one has 11.';

export const screens: { key: ScreenKey; label: string; states: FakeState[] }[] = [
  {
    key: 'sign-in',
    label: 'Sign-in (#373 #374 #375)',
    states: [
      { key: 'password', label: 'Email and password', fake: { step: 'PASSWORD' } },
      {
        key: 'password-invalid',
        label: 'Wrong credentials',
        fake: { step: 'PASSWORD', error: 'CREDENTIALS_INVALID', failuresForEmail: 3 },
      },
      {
        key: 'cooldown',
        label: 'Sign-in Cool-down',
        fake: {
          step: 'PASSWORD',
          error: 'SIGN_IN_COOLDOWN',
          http: 429,
          minutesLeft: 9,
          ladder: '2nd cool-down (10 min)',
        },
      },
      {
        key: 'expired',
        label: 'Pending sign-in expired',
        fake: { step: 'PASSWORD', error: 'SIGN_IN_EXPIRED', pendingSignIn: 'expired after 5 min' },
      },
      {
        key: 'totp',
        label: 'Authenticator code',
        fake: { step: 'TOTP', pendingSignIn: '5 min, single use' },
      },
      {
        key: 'totp-invalid',
        label: 'Wrong code',
        fake: { step: 'TOTP', error: 'CODE_INVALID', consecutiveWrongCodes: 3, ceiling: 10 },
      },
      { key: 'recovery', label: 'Recovery Code', fake: { step: 'RECOVERY_CODE' } },
      {
        key: 'recovery-invalid',
        label: 'Wrong Recovery Code',
        fake: {
          step: 'RECOVERY_CODE',
          error: 'RECOVERY_CODE_INVALID',
          consecutiveWrongCodes: 4,
          ceiling: 10,
        },
      },
      {
        key: 'ceiling',
        label: 'Second-factor ceiling',
        fake: {
          step: 'TOTP',
          error: 'PASSWORD_RESET_REQUIRED',
          consecutiveWrongCodes: 10,
          noticeEmailed: true,
          status: 'ACTIVE',
        },
      },
      {
        key: 'recovery-used',
        label: 'Signed in with Recovery Code',
        fake: {
          step: 'SIGNED_IN',
          authenticationMethods: ['pwd', 'recovery_code'],
          recoveryCodesLeft: 7,
          otherSessionsRevoked: 2,
        },
      },
      {
        key: 'recovery-used-last',
        label: 'Recovery Code — none left',
        fake: {
          step: 'SIGNED_IN',
          authenticationMethods: ['pwd', 'recovery_code'],
          recoveryCodesLeft: 0,
        },
      },
    ],
  },
  {
    key: 'enroll',
    label: 'Forced enrollment (#376)',
    states: [
      {
        key: 'scan',
        label: 'Scan QR / enter key',
        fake: { purpose: 'SIGN_IN', step: 'ENROLL_SCAN', pendingSignIn: '5 min' },
      },
      {
        key: 'scan-invalid',
        label: 'Confirming code wrong',
        fake: { purpose: 'SIGN_IN', step: 'ENROLL_SCAN', error: 'CODE_INVALID' },
      },
      {
        key: 'codes',
        label: '10 Recovery Codes',
        fake: { purpose: 'SIGN_IN', step: 'ENROLL_CODES', acknowledged: false },
      },
      {
        key: 'done',
        label: 'Enrolled, signed in',
        fake: {
          purpose: 'SIGN_IN',
          step: 'SIGNED_IN',
          authenticationMethods: ['pwd', 'totp'],
          noticeEmailed: 'TOTP enrolled',
        },
      },
    ],
  },
  {
    key: 'invite',
    label: 'Invitation Activation (#377)',
    states: [
      {
        key: 'first-time',
        label: 'First-time: set password',
        fake: { path: 'FIRST_TIME', step: 'SET_PASSWORD', invitation: 'PENDING' },
      },
      {
        key: 'first-time-rule',
        label: 'First-time: password rule failed',
        fake: { path: 'FIRST_TIME', step: 'SET_PASSWORD', error: 'PASSWORD_RULE', rule: 'LENGTH' },
      },
      {
        key: 'existing',
        label: 'Existing User: prove password',
        fake: { path: 'EXISTING_USER', step: 'PASSWORD', invitation: 'PENDING' },
      },
      {
        key: 'existing-code',
        label: 'Existing User: code',
        fake: { path: 'EXISTING_USER', step: 'TOTP' },
      },
      {
        key: 'existing-invalid',
        label: 'Existing User: wrong credentials',
        fake: { path: 'EXISTING_USER', step: 'PASSWORD', error: 'CREDENTIALS_INVALID' },
      },
      {
        key: 'existing-locked',
        label: 'Existing User: LOCKED',
        fake: { path: 'EXISTING_USER', error: 'USER_LOCKED', invitation: 'PENDING' },
      },
      {
        key: 'enroll',
        label: 'Enroll TOTP (MFA-Required)',
        fake: { step: 'ENROLL_SCAN', pendingActivation: '15 min', saved: 'nothing yet' },
      },
      {
        key: 'codes',
        label: 'Recovery Codes',
        fake: { step: 'ENROLL_CODES', acknowledged: false, saved: 'nothing yet' },
      },
      {
        key: 'activation-expired',
        label: 'Pending activation expired',
        fake: { error: 'ACTIVATION_EXPIRED', saved: 'nothing', invitation: 'PENDING' },
      },
      {
        key: 'link-expired',
        label: 'Invitation expired',
        fake: { error: 'INVITATION_EXPIRED', lifetime: '7 days' },
      },
      {
        key: 'link-used',
        label: 'Used in another browser',
        fake: { error: 'INVITATION_INVALID', invitation: 'ACCEPTED' },
      },
      {
        key: 'done',
        label: 'Activated, signed in',
        fake: {
          step: 'SIGNED_IN',
          membership: 'ACTIVE',
          invitation: 'ACCEPTED',
          agency: 'DOH CHD-NCR',
        },
      },
    ],
  },
  {
    key: 'reset',
    label: 'Password Reset (#378)',
    states: [
      { key: 'request', label: 'Forgot password', fake: { step: 'REQUEST' } },
      {
        key: 'request-sent',
        label: 'Request sent (uniform)',
        fake: { step: 'REQUEST_SENT', revealsAccount: false },
      },
      {
        key: 'form',
        label: 'New password + code',
        fake: { step: 'RESET_FORM', hasFactor: true, token: '30 min, single use' },
      },
      {
        key: 'form-no-factor',
        label: 'New password (no factor)',
        fake: { step: 'RESET_FORM', hasFactor: false },
      },
      {
        key: 'form-rule',
        label: 'Password rule failed',
        fake: { step: 'RESET_FORM', error: 'PASSWORD_RULE', rule: 'LENGTH', tokenStillValid: true },
      },
      {
        key: 'form-code-invalid',
        label: 'Wrong code',
        fake: { step: 'RESET_FORM', error: 'CODE_INVALID', tokenStillValid: true },
      },
      {
        key: 'form-cooldown',
        label: 'Cool-down',
        fake: { step: 'RESET_FORM', error: 'SIGN_IN_COOLDOWN', http: 429, minutesLeft: 18 },
      },
      {
        key: 'link-invalid',
        label: 'Link invalid or expired',
        fake: { error: 'RESET_TOKEN_INVALID' },
      },
      {
        key: 'done',
        label: 'Reset complete',
        fake: { step: 'DONE', sessionsRevoked: 3, signedIn: false, noticeEmailed: true },
      },
    ],
  },
  {
    key: 'reauth',
    label: 'Reauthentication (#379)',
    states: [
      {
        key: 'idle',
        label: 'Sensitive action',
        fake: { action: 'REGENERATE_RECOVERY_CODES', authTimeAge: '23 min' },
      },
      {
        key: 'prompt',
        label: 'Prompt',
        fake: { error: 'REAUTHENTICATION_REQUIRED', window: '5 min' },
      },
      {
        key: 'prompt-invalid',
        label: 'Prompt: wrong proof',
        fake: { error: 'CREDENTIALS_INVALID', event: 'REAUTHENTICATION_FAILURE' },
      },
      {
        key: 'prompt-cooldown',
        label: 'Prompt: cool-down',
        fake: { error: 'SIGN_IN_COOLDOWN', http: 429, minutesLeft: 9 },
      },
      {
        key: 'continued',
        label: 'Action continued',
        fake: { authTime: 'now', retried: 'once', recoveryCodesLeft: 10, oldSetVoided: true },
      },
    ],
  },
  {
    key: 'account',
    label: 'Account security (#379 #380)',
    states: [
      { key: 'overview', label: 'Overview', fake: { recoveryCodesLeft: 7, otherSessions: 2 } },
      { key: 'low-codes', label: 'Few codes left', fake: { recoveryCodesLeft: 2 } },
      {
        key: 'change-password',
        label: 'Change password',
        fake: { form: 'CHANGE_PASSWORD', proof: 'current password + code, always' },
      },
      {
        key: 'change-password-rule',
        label: 'Change password: rule failed',
        fake: { form: 'CHANGE_PASSWORD', error: 'PASSWORD_RULE', rule: 'MATCHES_CURRENT' },
      },
      {
        key: 'change-password-invalid',
        label: 'Change password: wrong proof',
        fake: { form: 'CHANGE_PASSWORD', error: 'CREDENTIALS_INVALID' },
      },
      {
        key: 'change-password-done',
        label: 'Password changed',
        fake: { otherSessionsRevoked: 2, currentSession: 'kept', noticeEmailed: true },
      },
      {
        key: 'replace-factor',
        label: 'Replace authenticator',
        fake: { form: 'REPLACE_FACTOR', step: 'ENROLL_SCAN', reauthenticated: true },
      },
      {
        key: 'replace-done',
        label: 'Authenticator replaced',
        fake: { oldFactor: 'removed', otherSessionsRevoked: 2, noticeEmailed: true },
      },
    ],
  },
  {
    key: 'admin',
    label: 'Security admin (#381 #382)',
    states: [
      { key: 'list', label: 'Member list', fake: { viewer: 'Security Administrator' } },
      {
        key: 'factor-reset',
        label: 'Factor Reset',
        fake: { target: 'Maria Clara Santos', method: null, note: '' },
      },
      {
        key: 'factor-reset-done',
        label: 'Factor Reset done',
        fake: {
          target: 'Maria Clara Santos',
          factor: 'NONE',
          sessionsRevoked: 2,
          event: 'MFA_FACTOR_RESET',
        },
      },
      { key: 'lock', label: 'Place lock', fake: { target: 'Maria Clara Santos', reason: '' } },
      {
        key: 'locked-here',
        label: 'Locked by this Agency',
        fake: { target: 'Andres Bonifacio Reyes', lock: 'LOCKED', lockingAgency: 'this Agency' },
      },
      {
        key: 'locked-elsewhere',
        label: 'Locked by another Agency',
        fake: { target: 'Gabriela Silang Torres', lock: 'LOCKED', lockingAgency: 'hidden' },
      },
    ],
  },
];

export const publicVariants = [
  { key: 'A', label: 'Single card' },
  { key: 'B', label: 'Step rail' },
  { key: 'C', label: 'Context strip' },
  { key: 'D', label: 'Agency letterhead' },
  { key: 'E', label: 'Civic sunrise' },
];

export const protectedVariants = [
  { key: 'A', label: 'Dialogs' },
  { key: 'B', label: 'Inline panels' },
];

export function variantsFor(screen: ScreenKey) {
  return ['reauth', 'account', 'admin'].includes(screen) ? protectedVariants : publicVariants;
}
