import { expect, it } from 'vitest';
import {
  PDS_CITIZENSHIP_COUNTRIES,
  pdsCreateSchema,
  pdsEducationSchema,
  pdsEligibilitySchema,
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

it('accepts the Revised 2026 qualification sections and exact evidence references', () => {
  expect(
    pdsEducationSchema.parse([
      {
        level: 'COLLEGE',
        schoolName: 'University of the Philippines',
        degreeCourse: 'BS Public Administration',
        periodOfAttendance: '2010-2014',
        highestLevelUnits: 'Graduate',
        yearGraduated: 2014,
        honors: 'N/A',
        documentId: '00000000-0000-4000-8000-000000000010',
        documentVersionId: '00000000-0000-4000-8000-000000000011',
      },
    ]),
  ).toHaveLength(1);
  expect(
    pdsEligibilitySchema.parse([
      {
        eligibilityName: 'Civil Service Professional',
        rating: 'Passed',
        examDate: '2020-01-15',
        examPlace: 'Manila',
        documentId: '00000000-0000-4000-8000-000000000010',
        documentVersionId: '00000000-0000-4000-8000-000000000011',
      },
    ]),
  ).toHaveLength(1);
});

it('rejects qualification ordering, ranges, ratings, and license mismatches', () => {
  expect(
    pdsEducationSchema.safeParse([
      {
        level: 'COLLEGE',
        sequenceNo: 1,
        schoolName: 'One',
        degreeCourse: 'Course',
        periodOfAttendance: '2014-2010',
        highestLevelUnits: 'N/A',
        honors: 'N/A',
      },
      {
        level: 'COLLEGE',
        sequenceNo: 1,
        schoolName: 'Two',
        degreeCourse: 'Course',
        periodOfAttendance: '2015-2016',
        highestLevelUnits: 'N/A',
        honors: 'N/A',
      },
    ]).success,
  ).toBe(false);
  expect(
    pdsEligibilitySchema.safeParse([
      {
        eligibilityName: 'Career Service',
        rating: '',
        examPlace: 'Manila',
      },
    ]).success,
  ).toBe(false);
  expect(
    pdsEligibilitySchema.safeParse([
      {
        eligibilityName: "Driver's License",
        examPlace: 'Manila',
        licenseNo: 'DL-1',
      },
    ]).success,
  ).toBe(false);
  expect(
    pdsEligibilitySchema.safeParse([
      {
        eligibilityName: 'Career Service',
        examDate: '2999-01-01',
        examPlace: 'Manila',
      },
    ]).success,
  ).toBe(false);
  expect(
    pdsEligibilitySchema.safeParse([
      {
        eligibilityName: "Driver's License",
        examDate: '2020-01-15',
        examPlace: 'Manila',
        licenseNo: 'DL-1',
        validUntil: '2019-12-31',
      },
    ]).success,
  ).toBe(false);
  expect(
    pdsEducationSchema.safeParse([
      {
        level: 'COLLEGE',
        schoolName: 'One',
        degreeCourse: 'Course',
        periodOfAttendance: '2014-2016',
        highestLevelUnits: 'N/A',
        honors: 'N/A',
        documentId: '00000000-0000-4000-8000-000000000010',
      },
    ]).success,
  ).toBe(false);
});
