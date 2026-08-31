import { expect, it } from 'vitest';
import { employeeCreateSchema, employeeMembershipLinkSchema } from './employees.schemas';

const employeeInput = {
  employeeNumber: 'NEDA-2026-0042',
  legalName: 'Mara Villanueva Santos',
  birthDate: '1994-05-12',
  sex: 'FEMALE',
  civilStatus: 'SINGLE',
  contactEmail: 'mara.santos@neda.gov.ph',
};

it('accepts the complete Employee identity contract', () => {
  expect(employeeCreateSchema.parse(employeeInput)).toMatchObject(employeeInput);
});

it('rejects malformed dates, unsupported sexes, bad emails, and unknown fields', () => {
  expect(
    employeeCreateSchema.safeParse({
      ...employeeInput,
      birthDate: '12 May 1994',
      sex: 'OTHER',
      contactEmail: 'not-an-email',
      unexpected: true,
    }).success,
  ).toBe(false);
});

it('keeps Membership links to a single Membership reference', () => {
  expect(
    employeeMembershipLinkSchema.parse({
      membershipId: '00000000-0000-4000-8000-000000000004',
    }),
  ).toMatchObject({ membershipId: '00000000-0000-4000-8000-000000000004' });
  expect(employeeMembershipLinkSchema.safeParse({ email: 'mara@neda.gov.ph' }).success).toBe(false);
});
