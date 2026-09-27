import { expect, it } from 'vitest';
import {
  employeeCreateSchema,
  employeeListQuerySchema,
  employeeMembershipLinkSchema,
} from './employees.schemas';

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

it('defaults the register query to the first full page with no search or filters', () => {
  expect(employeeListQuerySchema.parse({})).toEqual({
    serviceStatus: [],
    membership: [],
    limit: 200,
    offset: 0,
  });
});

it('reads search, repeated filters, and offset pagination from the query string', () => {
  expect(
    employeeListQuerySchema.parse({
      q: '  Santos ',
      serviceStatus: ['ACTIVE', 'ON_EXTENDED_LEAVE'],
      membership: 'UNLINKED',
      limit: '50',
      offset: '100',
    }),
  ).toEqual({
    q: 'Santos',
    serviceStatus: ['ACTIVE', 'ON_EXTENDED_LEAVE'],
    membership: ['UNLINKED'],
    limit: 50,
    offset: 100,
  });
  expect(employeeListQuerySchema.parse({ q: '   ' }).q).toBeUndefined();
});

it('rejects unknown filter values, oversized pages, and negative offsets', () => {
  expect(employeeListQuerySchema.safeParse({ serviceStatus: 'RETIRED' }).success).toBe(false);
  expect(employeeListQuerySchema.safeParse({ membership: 'MAYBE' }).success).toBe(false);
  expect(employeeListQuerySchema.safeParse({ limit: '201' }).success).toBe(false);
  expect(employeeListQuerySchema.safeParse({ offset: '-1' }).success).toBe(false);
  expect(employeeListQuerySchema.safeParse({ q: 'x'.repeat(101) }).success).toBe(false);
  expect(employeeListQuerySchema.safeParse({ sort: 'name' }).success).toBe(false);
});
