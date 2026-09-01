import { expect, it } from 'vitest';
import {
  PDS_CITIZENSHIP_COUNTRIES,
  pdsCreateSchema,
  pdsFamilySchema,
  pdsPersonalDetailsSchema,
  pdsUpdateSchema,
} from './pds.schemas';

const personal = {
  surname: 'Santos',
  firstName: 'Marisol',
  middleName: 'Rivera',
  birthDate: '1990-04-12',
  birthPlace: 'Manila',
  sex: 'FEMALE',
  civilStatus: 'MARRIED',
  heightMeters: 1.62,
  weightKilograms: 58,
  bloodType: 'O+',
  agencyEmployeeNumber: 'NACO-0001',
  citizenship: 'FILIPINO',
  residentialAddress: { barangay: 'San Antonio', cityMunicipality: 'Pasig City' },
  permanentAddress: { barangay: 'San Antonio', cityMunicipality: 'Pasig City' },
  mobileNumber: '+639171234567',
  emailAddress: 'marisol@example.test',
};

it('keeps the Revised 2026 country snapshot and accepts a personal/family draft', () => {
  expect(PDS_CITIZENSHIP_COUNTRIES).toHaveLength(204);
  expect(PDS_CITIZENSHIP_COUNTRIES).toContain('Philippines');
  expect(
    pdsCreateSchema.parse({
      asOfDate: '2026-08-31',
      personal,
      family: {
        spouse: { surname: 'Santos', firstName: 'Ramon', occupation: 'Engineer' },
        children: [{ fullName: 'Santos, Ana', birthDate: '2018-07-01' }],
        father: { surname: 'Rivera', firstName: 'Jose' },
        mother: { surname: 'Garcia', firstName: 'Luisa' },
      },
    }),
  ).toMatchObject({ personal, family: { children: [{ fullName: 'Santos, Ana' }] } });
});

it('rejects unsupported values, conditional omissions, duplicate child order, and unknown fields', () => {
  expect(
    pdsPersonalDetailsSchema.safeParse({
      citizenship: 'DUAL_CITIZENSHIP',
      dualCitizenshipType: 'BY_BIRTH',
      unexpected: true,
    }).success,
  ).toBe(false);
  expect(
    pdsPersonalDetailsSchema.safeParse({
      citizenship: 'FILIPINO',
      dualCitizenshipCountry: 'Philippines',
    }).success,
  ).toBe(false);
  expect(
    pdsPersonalDetailsSchema.safeParse({
      civilStatus: 'MARRIED',
      civilStatusDetail: 'Church marriage',
    }).success,
  ).toBe(false);
  expect(
    pdsFamilySchema.safeParse({
      children: [
        { sequenceNo: 1, fullName: 'One', birthDate: '2020-01-01' },
        { sequenceNo: 1, fullName: 'Two', birthDate: '2021-01-01' },
      ],
    }).success,
  ).toBe(false);
  expect(
    pdsFamilySchema.safeParse({
      mother: { surname: 'Garcia', firstName: 'Luisa', nameExtension: 'Jr.' },
    }).success,
  ).toBe(false);
  expect(pdsUpdateSchema.safeParse({ personal: { civilStatus: 'OTHER' } }).success).toBe(false);
});
