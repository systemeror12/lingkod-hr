// PROTOTYPE (#399). Fake, in-memory states for an Agency's own seal and photo on the Civic sunrise
// login screens (#398). Nothing here calls the API. File limits are placeholders, not decisions.

export type ScreenKey = 'letterhead' | 'before-agency' | 'scene' | 'settings';
export type FakeState = { key: string; label: string; fake: Record<string, unknown> };

export const SEAL_SRC = '/agency-brand-prototype/sample-seal.svg';
// Public domain: "0216jfRizal Avenue DOH San Lazaro Hospital Shrine Santa Cruz Manilafvf 04.jpg",
// Wikimedia Commons. Stands in for a photo an Agency Administrator would upload.
export const PHOTO_SRC = '/agency-brand-prototype/agency-photo.jpg';

export const admin = {
  name: 'Jose Rizal Dela Cruz',
  email: 'jose.delacruz@doh.gov.ph',
  role: 'Agency Administrator',
};

/** Placeholder limits so the rejected states have something to say. Not decided. */
export const limits = {
  sealTypes: 'PNG or JPEG',
  sealMaxMb: 2,
  sealMinPx: 600,
  photoTypes: 'JPEG or PNG',
  photoMaxMb: 5,
  photoMinPx: 1200,
};

export type FakeFile = { name: string; detail: string; result: string };

/** What the pretend file picker offers; `result` is the settings state the pick leads to. */
export const sealFiles: FakeFile[] = [
  { name: 'seal-chd-ncr.png', detail: '412 KB · 1200 × 1200 px', result: 'staged' },
  { name: 'seal-chd-ncr.pdf', detail: '96 KB · PDF', result: 'wrong-type' },
  { name: 'seal-scan.png', detail: '8.4 MB · 4960 × 4960 px', result: 'too-large' },
  { name: 'seal-from-website.png', detail: '18 KB · 180 × 180 px', result: 'too-small' },
];

export const history = [
  {
    at: '2 Oct 2026, 2:04 PM',
    action: 'Seal replaced',
    file: 'seal-chd-ncr.png',
    by: admin.name,
  },
  {
    at: '2 Oct 2026, 1:58 PM',
    action: 'Photo added',
    file: 'chd-ncr-building.jpg',
    by: admin.name,
  },
  {
    at: '14 Aug 2026, 9:12 AM',
    action: 'Seal added',
    file: 'seal.png',
    by: 'Teodora Alonso Reyes',
  },
];

const openRules = {
  manager: 'Agency Administrator (BRD: "Agency profile … configuration")',
  permission: 'none yet in hris-controls',
  approval: 'none assumed; audit entry only',
};

export const screens: { key: ScreenKey; label: string; states: FakeState[] }[] = [
  {
    key: 'letterhead',
    label: 'Seal in the Invitation letterhead',
    states: [
      {
        key: 'no-seal',
        label: 'Agency has no seal yet',
        fake: { agencySeal: null, flow: 'Invitation Activation', step: 'SET_PASSWORD' },
      },
      {
        key: 'seal',
        label: 'Seal uploaded',
        fake: {
          agencySeal: 'seal-chd-ncr.png',
          flow: 'Invitation Activation',
          step: 'SET_PASSWORD',
        },
      },
      {
        key: 'codes',
        label: 'Seal uploaded · Recovery Codes',
        fake: { agencySeal: 'seal-chd-ncr.png', flow: 'Invitation Activation', step: 'CODES' },
      },
      {
        key: 'stamped',
        label: 'Seal uploaded · signed in (stamp)',
        fake: { agencySeal: 'seal-chd-ncr.png', flow: 'Invitation Activation', step: 'DONE' },
      },
      {
        key: 'no-seal-stamped',
        label: 'No seal · signed in (stamp)',
        fake: { agencySeal: null, flow: 'Invitation Activation', step: 'DONE' },
      },
    ],
  },
  {
    key: 'before-agency',
    label: 'Sign-in and Password Reset',
    states: [
      {
        key: 'sign-in',
        label: 'Sign-in: email and password',
        fake: { agencyKnown: false, step: 'PASSWORD' },
      },
      {
        key: 'signed-in',
        label: 'Sign-in: signed in',
        fake: { agencyKnown: true, step: 'DONE', agency: 'DOH CHD-NCR' },
      },
      {
        key: 'reset-request',
        label: 'Reset: forgot password',
        fake: { agencyKnown: false, step: 'REQUEST' },
      },
      {
        key: 'reset-done',
        label: 'Reset: password reset',
        fake: { agencyKnown: false, step: 'DONE', note: 'User is signed out; no session yet' },
      },
    ],
  },
  {
    key: 'scene',
    label: 'Agency photo in the scene',
    states: [
      {
        key: 'step-1',
        label: 'Step 1: set password',
        fake: { agencyPhoto: 'chd-ncr-building.jpg', progress: 0 },
      },
      {
        key: 'step-2',
        label: 'Step 2: authenticator',
        fake: { agencyPhoto: 'chd-ncr-building.jpg', progress: '1/3' },
      },
      {
        key: 'step-3',
        label: 'Step 3: Recovery Codes',
        fake: { agencyPhoto: 'chd-ncr-building.jpg', progress: '2/3' },
      },
      {
        key: 'done',
        label: 'Signed in',
        fake: { agencyPhoto: 'chd-ncr-building.jpg', progress: 1 },
      },
      {
        key: 'expired',
        label: 'Link expired (overcast)',
        fake: { agencyPhoto: 'chd-ncr-building.jpg', outcome: 'LINK_EXPIRED', gloom: true },
      },
    ],
  },
  {
    key: 'settings',
    label: 'Agency settings: seal and photo',
    states: [
      { key: 'empty', label: 'No seal, no photo', fake: { seal: null, photo: null, ...openRules } },
      {
        key: 'staged',
        label: 'Seal picked, not yet saved',
        fake: { seal: null, staged: 'seal-chd-ncr.png', photo: null, ...openRules },
      },
      {
        key: 'saved',
        label: 'Seal and photo saved',
        fake: {
          seal: 'seal-chd-ncr.png',
          photo: 'chd-ncr-building.jpg',
          photoOn: true,
          ...openRules,
        },
      },
      {
        key: 'photo-off',
        label: 'Photo kept, turned off',
        fake: { seal: 'seal-chd-ncr.png', photo: 'chd-ncr-building.jpg', photoOn: false },
      },
      {
        key: 'wrong-type',
        label: 'Rejected: wrong type',
        fake: { seal: 'seal-chd-ncr.png', rejected: 'seal-chd-ncr.pdf', error: 'FILE_TYPE' },
      },
      {
        key: 'too-large',
        label: 'Rejected: too large',
        fake: { seal: 'seal-chd-ncr.png', rejected: 'seal-scan.png', error: 'FILE_TOO_LARGE' },
      },
      {
        key: 'too-small',
        label: 'Rejected: too small to print',
        fake: {
          seal: 'seal-chd-ncr.png',
          rejected: 'seal-from-website.png',
          error: 'IMAGE_TOO_SMALL',
        },
      },
      {
        key: 'remove',
        label: 'Removing the seal',
        fake: { seal: 'seal-chd-ncr.png', confirming: 'REMOVE_SEAL' },
      },
    ],
  },
];

export const variants: Record<ScreenKey, { key: string; label: string }[]> = {
  letterhead: [
    { key: 'A', label: 'Seal in the ring' },
    { key: 'B', label: 'Memorandum header' },
  ],
  'before-agency': [
    { key: 'A', label: 'LingkodHR only' },
    { key: 'B', label: 'Device remembers Agency' },
    { key: 'C', label: 'Seal once signed in' },
  ],
  scene: [
    { key: 'A', label: 'Photo replaces scene' },
    { key: 'B', label: 'Photo inside scene' },
    { key: 'C', label: 'No photo, seal on building' },
  ],
  settings: [
    { key: 'A', label: 'One page, live preview' },
    { key: 'B', label: 'Panels with history' },
  ],
};
