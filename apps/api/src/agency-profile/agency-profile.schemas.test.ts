import { expect, it } from 'vitest';
import {
  agencyProfileActivationSchema,
  agencyProfileDraftSchema,
  AGENCY_PROFILE_TYPES,
} from './agency-profile.schemas';

const validDraft = {
  officialName: 'Department of Public Service Innovation',
  acronym: 'DPSI',
  agencyType: 'NGA',
  parentOrganization: 'Office of the President',
  reportingIdentifiers: 'UACS 240010000 · CSC 04-118',
  appointingAuthorityTitle: 'Secretary',
  defaultTimezone: 'Asia/Manila',
  defaultCurrency: 'PHP',
  effectiveFrom: '2026-10-01',
};

it('accepts the supported Agency Profile Draft contract', () => {
  expect(agencyProfileDraftSchema.safeParse(validDraft).success).toBe(true);
  expect(AGENCY_PROFILE_TYPES).toContain('NGA');
});

it('normalizes optional blank fields and rejects unsupported values', () => {
  const parsed = agencyProfileDraftSchema.safeParse({
    ...validDraft,
    acronym: ' ',
    parentOrganization: '',
    reportingIdentifiers: ' ',
    appointingAuthorityTitle: '',
    agencyType: 'UNSUPPORTED',
  });

  expect(parsed.success).toBe(false);
});

it('requires a reason and a valid effectivity date for activation', () => {
  expect(
    agencyProfileActivationSchema.safeParse({
      effectiveDate: '2026-10-01',
      reason: 'Approved prospective identity change.',
    }).success,
  ).toBe(true);
  expect(
    agencyProfileActivationSchema.safeParse({
      effectiveDate: '2026-10-01',
      reason: ' ',
    }).success,
  ).toBe(false);
});
