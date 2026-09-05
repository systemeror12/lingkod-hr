import { expect, it } from 'vitest';
import {
  PDS_CITIZENSHIP_COUNTRIES,
  pdsCreateSchema,
  pdsEducationSchema,
  pdsEligibilitySchema,
  pdsFamilySchema,
  pdsLearningDevelopmentSchema,
  pdsPersonalDetailsSchema,
  pdsUpdateSchema,
  pdsVoluntaryWorkSchema,
  pdsWesSchema,
  pdsWorkExperienceSchema,
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
    pdsPersonalDetailsSchema.safeParse({
      umidIdNumber: 'UMID-1234',
      pagibigIdNumber: 'PAGIBIG-1234',
      philhealthNumber: 'PH-1234',
      philSysCardNumber: 'PSCN-1234',
      tinNumber: 'TIN-1234',
      agencyEmployeeNumber: 'NACO-0001',
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

it('accepts the Revised 2026 work, voluntary work, L&D, and WES sections', () => {
  const workExperienceId = '00000000-0000-4000-8000-000000000004';
  expect(
    pdsCreateSchema.parse({
      workExperience: [
        {
          sequenceNo: 1,
          inclusiveFrom: '2020-01-01',
          inclusiveTo: '2024-01-01',
          positionTitle: 'Administrative Officer',
          departmentAgencyOfficeCompany: 'Department of Example',
          monthlySalary: 21877,
          salaryGradeStep: '24-2',
          appointmentStatus: 'Permanent',
          governmentService: 'Y',
        },
      ],
      voluntaryWork: [
        {
          sequenceNo: 1,
          organizationNameAddress: 'Example Foundation, Manila',
          inclusiveFrom: '2021-01-01',
          inclusiveTo: '2021-12-31',
          hours: 24,
          positionNatureOfWork: 'Volunteer coordinator',
        },
      ],
      learningAndDevelopment: [
        {
          sequenceNo: 1,
          interventionTitle: 'Public service orientation',
          attendanceFrom: '2024-02-01',
          attendanceTo: '2024-02-02',
          hours: 16,
          type: 'Technical',
          conductedSponsoredBy: 'Example Academy',
        },
      ],
      wes: [
        {
          contextKey: 'vacancy-1',
          entries: [
            {
              workExperienceId,
              sequenceNo: 1,
              durationText: 'January 2020 - December 2024',
              position: 'Administrative Officer',
              officeUnit: 'Administrative Services Office',
              immediateSupervisor: 'Example Supervisor',
              agencyOrganizationLocation: 'Department of Example, Manila',
              accomplishments: 'Improved filing turnaround.',
              actualDuties: 'Managed administrative records.',
            },
          ],
        },
      ],
    }),
  ).toMatchObject({
    workExperience: [{ positionTitle: 'Administrative Officer' }],
    voluntaryWork: [{ hours: 24 }],
    learningAndDevelopment: [{ type: 'Technical' }],
    wes: [{ entries: [{ workExperienceId }] }],
  });
});

it('rejects invalid target-section ranges, hours, order, evidence pairs, and WES links', () => {
  expect(
    pdsWorkExperienceSchema.safeParse({
      inclusiveFrom: '2024-01-02',
      inclusiveTo: '2024-01-01',
    }).success,
  ).toBe(false);
  expect(pdsVoluntaryWorkSchema.safeParse({ hours: -1 }).success).toBe(false);
  expect(
    pdsLearningDevelopmentSchema.safeParse({
      attendanceFrom: '2024-01-01',
      attendanceTo: '2024-01-02',
      documentId: '00000000-0000-4000-8000-000000000001',
    }).success,
  ).toBe(false);
  expect(
    pdsWesSchema.safeParse({
      entries: [
        {
          workExperienceId: '00000000-0000-4000-8000-000000000001',
          sequenceNo: 1,
          durationText: 'January 2020 - December 2021',
          position: 'One',
          officeUnit: 'Office',
          immediateSupervisor: 'Supervisor',
          agencyOrganizationLocation: 'Agency',
          actualDuties: 'Duties',
        },
        {
          workExperienceId: '00000000-0000-4000-8000-000000000002',
          sequenceNo: 1,
          durationText: 'January 2018 - December 2019',
          position: 'Two',
          officeUnit: 'Office',
          immediateSupervisor: 'Supervisor',
          agencyOrganizationLocation: 'Agency',
          actualDuties: 'Duties',
        },
      ],
    }).success,
  ).toBe(false);
  expect(
    pdsCreateSchema.safeParse({
      workExperience: [
        { sequenceNo: 1, inclusiveFrom: '2020-01-01', inclusiveTo: '2021-01-01' },
        { sequenceNo: 2, inclusiveFrom: '2022-01-01', inclusiveTo: '2023-01-01' },
      ],
    }).success,
  ).toBe(false);
  expect(
    pdsCreateSchema.safeParse({
      learningAndDevelopment: [
        { sequenceNo: 1, attendanceFrom: '2020-01-01', attendanceTo: '2020-01-02' },
        { sequenceNo: 2, attendanceFrom: '2024-01-01', attendanceTo: '2024-01-02' },
      ],
    }).success,
  ).toBe(false);
  expect(
    pdsCreateSchema.safeParse({
      workExperience: [{ sequenceNo: 1 }, { sequenceNo: 1 }],
    }).success,
  ).toBe(false);
  expect(
    pdsCreateSchema.safeParse({
      workExperience: [{ sequenceNo: 1, monthlySalary: 1.001 }],
    }).success,
  ).toBe(false);
  expect(
    pdsWesSchema.safeParse({
      entries: [
        {
          workExperienceId: '00000000-0000-4000-8000-000000000001',
          sequenceNo: 1,
          position: 'One',
          officeUnit: 'Office',
          immediateSupervisor: 'Supervisor',
          agencyOrganizationLocation: 'Agency',
          actualDuties: 'Duties',
        },
      ],
    }).success,
  ).toBe(false);
  expect(pdsUpdateSchema.safeParse({ rowVersion: 2 }).success).toBe(false);
});
