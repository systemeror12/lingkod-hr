import { z } from 'zod';

export const PDS_FORM_VERSION = 'CS_FORM_212_REVISED_2026' as const;
export const PDS_STATUSES = ['DRAFT', 'SUBMITTED', 'RETURNED', 'CERTIFIED', 'SUPERSEDED'] as const;
export const PDS_CITIZENSHIP_TYPES = ['FILIPINO', 'DUAL_CITIZENSHIP'] as const;
export const PDS_DUAL_CITIZENSHIP_TYPES = ['BY_BIRTH', 'BY_NATURALIZATION'] as const;
export const PDS_SEXES = ['MALE', 'FEMALE'] as const;
export const PDS_CIVIL_STATUSES = ['SINGLE', 'MARRIED', 'WIDOWED', 'SEPARATED', 'OTHER'] as const;
export const PDS_EDUCATION_LEVELS = [
  'ELEMENTARY',
  'SECONDARY',
  'VOCATIONAL_TRADE',
  'COLLEGE',
  'GRADUATE_STUDIES',
] as const;
export const PDS_ELIGIBILITY_CATEGORIES = [
  'Career Service',
  'RA 1080 (Board/Bar)',
  'Under Special Laws',
  'CES/CSEE',
  'Barangay Eligibility',
  "Driver's License",
] as const;
export const PDS_MAIN_PAGE_KEYS = ['C1', 'C2', 'C3', 'C4'] as const;
export const PDS_CONTINUATION_PAGE_KEYS = ['C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'C11'] as const;
export const PDS_PAGE_KEYS = [...PDS_MAIN_PAGE_KEYS, ...PDS_CONTINUATION_PAGE_KEYS] as const;
export const PDS_OUTPUT_TYPES = ['PDS', 'WES'] as const;

export const PDS_CITIZENSHIP_COUNTRIES = `
Afghanistan;Albania;Algeria;Andorra;Angola;Antigua and Barbuda;Argentina;Armenia;Aruba;Australia
Austria;Azerbaijan;Bahamas, The;Bahrain;Bangladesh;Barbados;Belarus;Belgium;Belize;Benin
Bhutan;Bolivia;Bosnia and Herzegovina;Botswana;Brazil;Brunei;Bulgaria;Burkina Faso;Burma;Burundi
Cambodia;Cameroon;Canada;Cape Verde;Central African Republic;Chad;Chile;China;Colombia;Comoros
Congo, Democratic Republic of the;Congo, Republic of the;Costa Rica;Cote d'Ivoire;Croatia
Cuba;Curacao;Cyprus;Czech Republic;Djibouti;Dominica;Dominican Republic;East Timor;Ecuador;Egypt
El Salvador;Equatorial Guinea;Eritrea;Estonia;Ethiopia;Fiji;Finland;France;Gabon;Gambia, The
Georgia;Germany;Ghana;Greece;Grenada;Guatemala;Guinea;Guinea-Bissau;Guyana;Haiti
Holy See;Honduras;Hong Kong;Hungary;Iceland;India;Indonesia;Iran;Iraq;Ireland
Israel;Italy;Jamaica;Japan;Jordan;Kazakhstan;Kenya;Kiribati;Korea, North;Korea, South
Kosovo;Kuwait;Kyrgyzstan;Laos;Latvia;Lebanon;Lesotho;Liberia;Libya;Liechtenstein
Lithuania;Luxembourg;Macau;Macedonia;Madagascar;Malawi;Malaysia;Maldives;Mali;Malta
Marshall Islands;Mauritania;Mauritius;Mexico;Micronesia;Moldova;Monaco;Mongolia;Montenegro;Morocco
Mozambique;Namibia;Nauru;Nepal;Netherlands;Netherlands Antilles;New Zealand;Nicaragua;Niger;Nigeria
North Korea;Norway;Oman;Pakistan;Palau;Palestinian Territories;Panama;Papua New Guinea;Paraguay;Peru
Philippines;Poland;Portugal;Qatar;Romania;Russia;Rwanda;Saint Kitts and Nevis;Saint Lucia;Saint Vincent and the Grenadines
Samoa;San Marino;Sao Tome and Principe;Saudi Arabia;Senegal;Serbia;Seychelles;Sierra Leone;Singapore;Sint Maarten
Slovakia;Slovenia;Solomon Islands;Somalia;South Africa;South Korea;South Sudan;Spain;Sri Lanka;Sudan
Suriname;Swaziland;Sweden;Switzerland;Syria;Taiwan;Tajikistan;Tanzania;Thailand;Timor-Leste
Togo;Tonga;Trinidad and Tobago;Tunisia;Turkey;Turkmenistan;Tuvalu;Uganda;Ukraine;United Arab Emirates
United Kingdom;Uruguay;Uzbekistan;Vanuatu;Venezuela;Vietnam;Yemen;Zambia;Zimbabwe
`
  .trim()
  .replace(/\s*\n\s*/g, ';')
  .split(';') as [string, ...string[]];

const optionalText = (max = 500) => z.string().trim().max(max).nullable().optional();
const requiredText = (max = 500) => z.string().trim().min(1).max(max);
const optionalDate = z.string().date().nullable().optional();
const optionalDateTime = z.string().datetime({ offset: true }).nullable().optional();
const pastOrTodayDate = optionalDate.refine(
  (value) => value === undefined || value === null || value <= todayDate(),
  'The date cannot be in the future.',
);

function todayDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

const optionalHours = z.number().finite().nonnegative().nullable().optional();
const optionalMoney = z
  .number()
  .finite()
  .nonnegative()
  .nullable()
  .optional()
  .refine(
    (value) => value === null || value === undefined || value <= 999999999999.99,
    'Monthly salary must fit the supported money range.',
  )
  .refine(
    (value) => value === null || value === undefined || Number(value.toFixed(2)) === value,
    'Monthly salary must have no more than two decimal places.',
  );

function evidenceFields<T extends z.ZodRawShape>(shape: T) {
  return z
    .object({
      ...shape,
      documentId: z.string().uuid().nullable().optional(),
      documentVersionId: z.string().uuid().nullable().optional(),
    })
    .strict()
    .superRefine((value, context) => {
      const evidence = value as {
        documentId?: string | null;
        documentVersionId?: string | null;
      };
      if (Boolean(evidence.documentId) !== Boolean(evidence.documentVersionId)) {
        context.addIssue({
          code: 'custom',
          path: ['documentVersionId'],
          message: 'An evidence Document and exact Document Version are both required.',
        });
      }
    });
}

function dateRange(
  value: Record<string, unknown>,
  context: z.RefinementCtx,
  fromPath: string,
  toPath: string,
): void {
  const from = typeof value[fromPath] === 'string' ? value[fromPath] : null;
  const to = typeof value[toPath] === 'string' ? value[toPath] : null;
  if (from && to && to < from) {
    context.addIssue({
      code: 'custom',
      path: [toPath],
      message: 'The finish date must be on or after the start date.',
    });
  }
  if (!from && to) {
    context.addIssue({
      code: 'custom',
      path: [fromPath],
      message: 'A start date is required when a finish date is entered.',
    });
  }
}

function validateSequenceNumbers(
  rows: readonly { sequenceNo: number }[] | undefined,
  context: z.RefinementCtx,
  path: string,
  label: string,
): void {
  const seen = new Set<number>();
  for (const [index, row] of (rows ?? []).entries()) {
    if (seen.has(row.sequenceNo)) {
      context.addIssue({
        code: 'custom',
        path: [path, index, 'sequenceNo'],
        message: `${label} sequence numbers must be unique within this PDS.`,
      });
    }
    seen.add(row.sequenceNo);
  }
}

function validateMostRecentFirst(
  rows: readonly Record<string, unknown>[] | undefined,
  context: z.RefinementCtx,
  path: string,
  fromField: string,
  toField: string,
  currentField?: string,
  label = 'Rows',
): void {
  let previousLatest: string | null = null;
  for (const [index, row] of (rows ?? []).entries()) {
    const latest =
      currentField && row[currentField] === true
        ? '9999-12-31'
        : typeof row[toField] === 'string'
          ? row[toField]
          : typeof row[fromField] === 'string'
            ? row[fromField]
            : null;
    if (latest && previousLatest && latest > previousLatest) {
      context.addIssue({
        code: 'custom',
        path: [path, index, toField],
        message: `${label} must be ordered from most recent to oldest.`,
      });
    }
    if (latest) previousLatest = latest;
  }
}

function requireEvidencePair(
  value: Record<string, unknown>,
  context: z.RefinementCtx,
  documentPath: string,
  versionPath: string,
): void {
  if (Boolean(value[documentPath]) !== Boolean(value[versionPath])) {
    context.addIssue({
      code: 'custom',
      path: [versionPath],
      message: 'An evidence Document and exact Document Version are both required.',
    });
  }
}

function conditionalText(
  value: Record<string, unknown>,
  context: z.RefinementCtx,
  flagPath: string,
  detailPath: string,
  message: string,
): void {
  const flag = value[flagPath];
  const detail = typeof value[detailPath] === 'string' ? value[detailPath].trim() : '';
  if (flag === true && !detail) {
    context.addIssue({ code: 'custom', path: [detailPath], message });
  }
  if (flag !== true && detail) {
    context.addIssue({
      code: 'custom',
      path: [detailPath],
      message: 'Details require a Yes answer for this declaration.',
    });
  }
}

export const pdsAddressSchema = z
  .object({
    houseBlockLotNo: optionalText(160),
    street: optionalText(160),
    subdivisionVillage: optionalText(160),
    barangay: optionalText(160),
    cityMunicipality: optionalText(160),
    province: optionalText(160),
    zipCode: optionalText(20),
  })
  .strict();

export const pdsPersonalDetailsSchema = z
  .object({
    surname: optionalText(120),
    firstName: optionalText(120),
    nameExtension: optionalText(40),
    middleName: optionalText(120),
    birthDate: optionalDate,
    birthPlace: optionalText(240),
    sex: z.enum(PDS_SEXES).nullable().optional(),
    civilStatus: z.enum(PDS_CIVIL_STATUSES).nullable().optional(),
    civilStatusDetail: optionalText(160),
    heightMeters: z.number().finite().nonnegative().nullable().optional(),
    weightKilograms: z.number().finite().nonnegative().nullable().optional(),
    bloodType: optionalText(40),
    citizenship: z.enum(PDS_CITIZENSHIP_TYPES).nullable().optional(),
    dualCitizenshipType: z.enum(PDS_DUAL_CITIZENSHIP_TYPES).nullable().optional(),
    dualCitizenshipCountry: z.enum(PDS_CITIZENSHIP_COUNTRIES).nullable().optional(),
    residentialAddress: pdsAddressSchema.nullable().optional(),
    permanentAddress: pdsAddressSchema.nullable().optional(),
    telephoneNumber: optionalText(60),
    mobileNumber: optionalText(60),
    emailAddress: z
      .union([z.string().trim().email().max(320), z.literal('N/A')])
      .nullable()
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.civilStatus === 'OTHER' && !value.civilStatusDetail?.trim()) {
      context.addIssue({
        code: 'custom',
        path: ['civilStatusDetail'],
        message: 'Describe the selected Other/s civil status.',
      });
    }
    if (value.civilStatus !== 'OTHER' && value.civilStatusDetail?.trim()) {
      context.addIssue({
        code: 'custom',
        path: ['civilStatusDetail'],
        message: 'Other/s civil status details require Other/s to be selected.',
      });
    }
    if (value.citizenship === 'DUAL_CITIZENSHIP') {
      if (!value.dualCitizenshipType) {
        context.addIssue({
          code: 'custom',
          path: ['dualCitizenshipType'],
          message: 'Select whether dual citizenship is by birth or naturalization.',
        });
      }
      if (!value.dualCitizenshipCountry) {
        context.addIssue({
          code: 'custom',
          path: ['dualCitizenshipCountry'],
          message: 'Select the other citizenship country.',
        });
      }
    }
    if (
      value.citizenship !== 'DUAL_CITIZENSHIP' &&
      (value.dualCitizenshipType || value.dualCitizenshipCountry)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['dualCitizenshipType'],
        message: 'Dual citizenship details require Dual Citizenship.',
      });
    }
  });

const familyNameSchema = z.object({
  surname: requiredText(120),
  firstName: requiredText(120),
  middleName: optionalText(120),
  nameExtension: optionalText(40),
});

export const pdsSpouseSchema = familyNameSchema
  .extend({
    occupation: optionalText(200),
    employerBusinessName: optionalText(240),
    businessAddress: pdsAddressSchema.nullable().optional(),
    telephoneNumber: optionalText(60),
  })
  .strict();

export const pdsFatherSchema = familyNameSchema.strict();
export const pdsMotherSchema = z
  .object({
    surname: requiredText(120),
    firstName: requiredText(120),
    middleName: optionalText(120),
  })
  .strict();

export const pdsChildSchema = z
  .object({
    sequenceNo: z.number().int().positive().optional(),
    fullName: requiredText(300),
    birthDate: z.string().date(),
  })
  .strict();

export const pdsFamilySchema = z
  .object({
    spouse: pdsSpouseSchema.nullable().optional(),
    children: z.array(pdsChildSchema).optional(),
    father: pdsFatherSchema.nullable().optional(),
    mother: pdsMotherSchema.nullable().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const seen = new Set<number>();
    for (const [index, child] of (value.children ?? []).entries()) {
      if (child.sequenceNo === undefined) continue;
      if (seen.has(child.sequenceNo)) {
        context.addIssue({
          code: 'custom',
          path: ['children', index, 'sequenceNo'],
          message: 'Child sequence numbers must be unique within this PDS.',
        });
      }
      seen.add(child.sequenceNo);
    }
  });

const pdsEvidenceFields = {
  documentId: z.string().uuid().nullable().optional(),
  documentVersionId: z.string().uuid().nullable().optional(),
};

const withEvidenceValidation = <T extends z.ZodRawShape>(shape: T) =>
  z
    .object({ ...shape, ...pdsEvidenceFields })
    .strict()
    .superRefine((value, context) => {
      const evidence = value as { documentId?: string | null; documentVersionId?: string | null };
      const hasDocument = Boolean(evidence.documentId);
      const hasVersion = Boolean(evidence.documentVersionId);
      if (hasDocument !== hasVersion) {
        context.addIssue({
          code: 'custom',
          path: [hasDocument ? 'documentVersionId' : 'documentId'],
          message: 'Document and Document Version must be provided together.',
        });
      }
    });

const schoolYearSchema = requiredText(40).refine((value) => {
  if (value === 'N/A') return true;
  const match = /^(\d{4})(?:-(\d{4}))?$/.exec(value);
  return Boolean(match && (!match[2] || Number(match[2]) >= Number(match[1])));
}, 'Enter a school year such as 1992-1996 or N/A.');

const ratingSchema = z
  .union([z.number().finite(), z.string().trim().min(1).max(80)])
  .nullable()
  .optional();

export const pdsEducationRecordSchema = withEvidenceValidation({
  sequenceNo: z.number().int().positive().optional(),
  level: z.enum(PDS_EDUCATION_LEVELS),
  schoolName: requiredText(240),
  degreeCourse: requiredText(240),
  periodOfAttendance: schoolYearSchema,
  highestLevelUnits: optionalText(160),
  yearGraduated: z.number().int().min(1).max(9999).nullable().optional(),
  honors: requiredText(240),
}).superRefine((value, context) => {
  if (value.yearGraduated === undefined || value.yearGraduated === null) {
    if (!value.highestLevelUnits?.trim()) {
      context.addIssue({
        code: 'custom',
        path: ['highestLevelUnits'],
        message: 'Highest level or units earned is required when no graduation year is given.',
      });
    }
  }
});

export const pdsEducationSchema = z
  .array(pdsEducationRecordSchema)
  .superRefine((records, context) => {
    const seen = new Set<string>();
    for (const [index, record] of records.entries()) {
      if (record.sequenceNo === undefined) continue;
      const key = `${record.level}:${record.sequenceNo}`;
      if (seen.has(key)) {
        context.addIssue({
          code: 'custom',
          path: [index, 'sequenceNo'],
          message: 'Education sequence numbers must be unique within each level.',
        });
      }
      seen.add(key);
    }
  });

export const pdsEligibilityRecordSchema = withEvidenceValidation({
  sequenceNo: z.number().int().positive().optional(),
  eligibilityName: requiredText(240),
  rating: ratingSchema,
  examDate: pastOrTodayDate,
  examPlace: requiredText(240),
  licenseNo: optionalText(160),
  validUntil: optionalDate,
}).superRefine((value, context) => {
  const licenseApplies =
    value.eligibilityName === 'RA 1080 (Board/Bar)' || value.eligibilityName === "Driver's License";
  const hasLicense = Boolean(value.licenseNo || value.validUntil);
  if (licenseApplies && (!value.licenseNo || !value.validUntil)) {
    context.addIssue({
      code: 'custom',
      path: ['licenseNo'],
      message: 'License number and validity date are required for this eligibility.',
    });
  }
  if (!licenseApplies && hasLicense && (!value.licenseNo || !value.validUntil)) {
    context.addIssue({
      code: 'custom',
      path: ['licenseNo'],
      message: 'License details require a license eligibility category.',
    });
  }
  if (value.examDate && value.validUntil && value.validUntil < value.examDate) {
    context.addIssue({
      code: 'custom',
      path: ['validUntil'],
      message: 'License validity cannot end before the examination or conferment date.',
    });
  }
});

export const pdsEligibilitySchema = z
  .array(pdsEligibilityRecordSchema)
  .superRefine((records, context) => {
    const seen = new Set<number>();
    for (const [index, record] of records.entries()) {
      if (record.sequenceNo === undefined) continue;
      if (seen.has(record.sequenceNo)) {
        context.addIssue({
          code: 'custom',
          path: [index, 'sequenceNo'],
          message: 'Eligibility sequence numbers must be unique within this PDS.',
        });
      }
      seen.add(record.sequenceNo);
    }
  });

export const pdsWorkExperienceSchema = evidenceFields({
  id: z.string().uuid().optional(),
  sequenceNo: z.number().int().positive(),
  inclusiveFrom: optionalDate,
  inclusiveTo: optionalDate,
  positionTitle: optionalText(240),
  departmentAgencyOfficeCompany: optionalText(320),
  monthlySalary: optionalMoney,
  salaryGradeStep: optionalText(80),
  appointmentStatus: optionalText(120),
  governmentService: z.enum(['Y', 'N']).nullable().optional(),
  isCurrent: z.boolean().optional(),
}).superRefine((value, context) => {
  dateRange(value, context, 'inclusiveFrom', 'inclusiveTo');
  if (value.isCurrent && value.inclusiveTo) {
    context.addIssue({
      code: 'custom',
      path: ['inclusiveTo'],
      message: 'Current work cannot have a finish date.',
    });
  }
});

export const pdsVoluntaryWorkSchema = evidenceFields({
  id: z.string().uuid().optional(),
  sequenceNo: z.number().int().positive(),
  organizationNameAddress: optionalText(500),
  inclusiveFrom: optionalDate,
  inclusiveTo: optionalDate,
  hours: optionalHours,
  positionNatureOfWork: optionalText(240),
}).superRefine((value, context) => {
  dateRange(value, context, 'inclusiveFrom', 'inclusiveTo');
});

export const pdsLearningDevelopmentSchema = evidenceFields({
  id: z.string().uuid().optional(),
  sequenceNo: z.number().int().positive(),
  interventionTitle: optionalText(320),
  attendanceFrom: optionalDate,
  attendanceTo: optionalDate,
  hours: optionalHours,
  type: optionalText(120),
  conductedSponsoredBy: optionalText(320),
}).superRefine((value, context) => {
  dateRange(value, context, 'attendanceFrom', 'attendanceTo');
});

export const pdsWesEntrySchema = z
  .object({
    id: z.string().uuid().optional(),
    workExperienceId: z.string().uuid().optional(),
    workExperienceSequenceNo: z.number().int().positive().optional(),
    sequenceNo: z.number().int().positive(),
    durationText: requiredText(160),
    position: requiredText(240),
    officeUnit: requiredText(320),
    immediateSupervisor: requiredText(240),
    agencyOrganizationLocation: requiredText(500),
    accomplishments: optionalText(2000),
    actualDuties: requiredText(4000),
  })
  .strict()
  .superRefine((value, context) => {
    if (Boolean(value.workExperienceId) === Boolean(value.workExperienceSequenceNo)) {
      context.addIssue({
        code: 'custom',
        path: ['workExperienceId'],
        message: 'Select exactly one parent work-experience row.',
      });
    }
  });

export const pdsWesSchema = z
  .object({
    id: z.string().uuid().optional(),
    contextKey: z.string().trim().min(1).max(120).nullable().optional(),
    documentId: z.string().uuid().nullable().optional(),
    documentVersionId: z.string().uuid().nullable().optional(),
    signatureDocumentId: z.string().uuid().nullable().optional(),
    signatureDocumentVersionId: z.string().uuid().nullable().optional(),
    signedAt: optionalDate,
    entries: z.array(pdsWesEntrySchema),
  })
  .strict()
  .superRefine((value, context) => {
    if (Boolean(value.documentId) !== Boolean(value.documentVersionId)) {
      context.addIssue({
        code: 'custom',
        path: ['documentVersionId'],
        message: 'An evidence Document and exact Document Version are both required.',
      });
    }
    requireEvidencePair(value, context, 'signatureDocumentId', 'signatureDocumentVersionId');
    const sequences = new Set<number>();
    const parents = new Set<string>();
    for (const [index, entry] of value.entries.entries()) {
      const sequenceNo = entry.sequenceNo;
      if (sequences.has(sequenceNo)) {
        context.addIssue({
          code: 'custom',
          path: ['entries', index, 'sequenceNo'],
          message: 'WES entry sequence numbers must be unique within the artifact.',
        });
      }
      sequences.add(sequenceNo);
      const parentKey = entry.workExperienceId ?? `sequence:${entry.workExperienceSequenceNo}`;
      if (parents.has(parentKey)) {
        context.addIssue({
          code: 'custom',
          path: ['entries', index, 'workExperienceId'],
          message: 'A work-experience row may appear only once in one WES artifact.',
        });
      }
      parents.add(parentKey);
    }
  });

export const pdsOtherInformationSchema = z
  .object({
    skillsAndHobbies: optionalText(2000),
    nonAcademicDistinctions: optionalText(2000),
    associationMemberships: optionalText(2000),
  })
  .strict();

export const pdsDeclarationDetailsSchema = z
  .object({
    relatedWithinThirdDegree: z.boolean().nullable().optional(),
    relatedWithinFourthDegreeLgu: z.boolean().nullable().optional(),
    relationshipDetails: optionalText(2000),
    relatedWithinFourthDegreeDetails: optionalText(2000),
    foundGuiltyAdministrativeOffense: z.boolean().nullable().optional(),
    administrativeOffenseDetails: optionalText(2000),
    criminallyCharged: z.boolean().nullable().optional(),
    criminalChargeDetails: optionalText(2000),
    criminalChargeDateFiled: optionalDate,
    criminalChargeDateFiledUnknown: z.boolean().nullable().optional(),
    criminalChargeStatus: optionalText(1000),
    convictedOfCrime: z.boolean().nullable().optional(),
    convictionDetails: optionalText(2000),
    separatedFromService: z.boolean().nullable().optional(),
    separationMode: optionalText(240),
    separationDetails: optionalText(2000),
    candidateInLastElection: z.boolean().nullable().optional(),
    candidacyDetails: optionalText(2000),
    resignedBeforeElection: z.boolean().nullable().optional(),
    resignationDetails: optionalText(2000),
    immigrantOrPermanentResident: z.boolean().nullable().optional(),
    immigrantCountry: z.enum(PDS_CITIZENSHIP_COUNTRIES).nullable().optional(),
    immigrantDetails: optionalText(1000),
    indigenousGroupMember: z.boolean().nullable().optional(),
    indigenousGroupDetails: optionalText(1000),
    personWithDisability: z.boolean().nullable().optional(),
    disabilitySpecification: optionalText(1000),
    disabilityIdNumber: optionalText(240),
    soloParent: z.boolean().nullable().optional(),
    soloParentSpecification: optionalText(1000),
    soloParentIdNumber: optionalText(240),
  })
  .strict()
  .superRefine((value, context) => {
    conditionalText(
      value,
      context,
      'relatedWithinThirdDegree',
      'relationshipDetails',
      'Describe the Item 34a relationship.',
    );
    conditionalText(
      value,
      context,
      'relatedWithinFourthDegreeLgu',
      'relatedWithinFourthDegreeDetails',
      'Describe the Item 34b relationship.',
    );
    conditionalText(
      value,
      context,
      'foundGuiltyAdministrativeOffense',
      'administrativeOffenseDetails',
      'Describe the administrative offense finding for Item 35a.',
    );
    conditionalText(
      value,
      context,
      'convictedOfCrime',
      'convictionDetails',
      'Describe the conviction for Item 36.',
    );
    conditionalText(
      value,
      context,
      'separatedFromService',
      'separationDetails',
      'Describe the separation for Item 37.',
    );
    if (value.separatedFromService === true && !value.separationMode?.trim()) {
      context.addIssue({
        code: 'custom',
        path: ['separationMode'],
        message: 'Select or enter the separation mode for Item 37.',
      });
    }
    if (value.separatedFromService !== true && value.separationMode?.trim()) {
      context.addIssue({
        code: 'custom',
        path: ['separationMode'],
        message: 'Separation mode requires a Yes answer for Item 37.',
      });
    }
    conditionalText(
      value,
      context,
      'candidateInLastElection',
      'candidacyDetails',
      'Describe the candidacy for Item 38a.',
    );
    conditionalText(
      value,
      context,
      'resignedBeforeElection',
      'resignationDetails',
      'Describe the resignation for Item 38b.',
    );
    if (value.criminallyCharged === true) {
      if (!value.criminalChargeDetails?.trim()) {
        context.addIssue({
          code: 'custom',
          path: ['criminalChargeDetails'],
          message: 'Describe the criminal charge for Item 35b.',
        });
      }
      if (!value.criminalChargeDateFiled && value.criminalChargeDateFiledUnknown !== true) {
        context.addIssue({
          code: 'custom',
          path: ['criminalChargeDateFiled'],
          message: 'Enter the filing date or mark it unknown for Item 35b.',
        });
      }
      if (!value.criminalChargeStatus?.trim()) {
        context.addIssue({
          code: 'custom',
          path: ['criminalChargeStatus'],
          message: 'Enter the case status for Item 35b.',
        });
      }
    } else if (
      value.criminalChargeDetails?.trim() ||
      value.criminalChargeDateFiled ||
      value.criminalChargeDateFiledUnknown === true ||
      value.criminalChargeStatus?.trim()
    ) {
      context.addIssue({
        code: 'custom',
        path: ['criminalChargeDetails'],
        message: 'Criminal charge details require a Yes answer for Item 35b.',
      });
    }
    if (value.criminalChargeDateFiled && value.criminalChargeDateFiledUnknown === true) {
      context.addIssue({
        code: 'custom',
        path: ['criminalChargeDateFiledUnknown'],
        message: 'Use either a filing date or the unknown marker, not both.',
      });
    }
    if (value.immigrantOrPermanentResident === true && !value.immigrantCountry) {
      context.addIssue({
        code: 'custom',
        path: ['immigrantCountry'],
        message: 'Select the country for Item 39.',
      });
    }
    if (
      value.immigrantOrPermanentResident !== true &&
      (value.immigrantCountry || value.immigrantDetails?.trim())
    ) {
      context.addIssue({
        code: 'custom',
        path: ['immigrantCountry'],
        message: 'Immigrant details require a Yes answer for Item 39.',
      });
    }
    conditionalText(
      value,
      context,
      'indigenousGroupMember',
      'indigenousGroupDetails',
      'Enter the indigenous group for Item 40a.',
    );
    if (value.personWithDisability === true) {
      if (!value.disabilitySpecification?.trim()) {
        context.addIssue({
          code: 'custom',
          path: ['disabilitySpecification'],
          message: 'Enter the disability specification for Item 40b.',
        });
      }
      if (!value.disabilityIdNumber?.trim()) {
        context.addIssue({
          code: 'custom',
          path: ['disabilityIdNumber'],
          message: 'Enter the PWD ID number for Item 40b.',
        });
      }
    } else if (value.disabilitySpecification?.trim() || value.disabilityIdNumber?.trim()) {
      context.addIssue({
        code: 'custom',
        path: ['disabilitySpecification'],
        message: 'Disability details require a Yes answer for Item 40b.',
      });
    }
    if (value.soloParent === true) {
      if (!value.soloParentSpecification?.trim()) {
        context.addIssue({
          code: 'custom',
          path: ['soloParentSpecification'],
          message: 'Enter the solo parent specification for Item 40c.',
        });
      }
      if (!value.soloParentIdNumber?.trim()) {
        context.addIssue({
          code: 'custom',
          path: ['soloParentIdNumber'],
          message: 'Enter the solo parent ID number for Item 40c.',
        });
      }
    } else if (value.soloParentSpecification?.trim() || value.soloParentIdNumber?.trim()) {
      context.addIssue({
        code: 'custom',
        path: ['soloParentSpecification'],
        message: 'Solo parent details require a Yes answer for Item 40c.',
      });
    }
  });

export const pdsReferenceRecordSchema = z
  .object({
    id: z.string().uuid().optional(),
    sequenceNo: z.number().int().min(1).max(3),
    name: requiredText(240),
    address: requiredText(500),
    contact: requiredText(240),
  })
  .strict();

export const pdsCertificationDetailsSchema = z
  .object({
    truthDeclarationAccepted: z.boolean().nullable().optional(),
    verificationAuthorizationAccepted: z.boolean().nullable().optional(),
    misrepresentationWarningAccepted: z.boolean().nullable().optional(),
    photoDocumentId: z.string().uuid().nullable().optional(),
    photoDocumentVersionId: z.string().uuid().nullable().optional(),
    governmentIdType: optionalText(160),
    governmentIdNumber: optionalText(160),
    governmentIdIssuedAt: optionalDate,
    governmentIdIssuedPlace: optionalText(240),
    employeeSignatureDocumentId: z.string().uuid().nullable().optional(),
    employeeSignatureDocumentVersionId: z.string().uuid().nullable().optional(),
    employeeSignatureDate: optionalDate,
    thumbmarkDocumentId: z.string().uuid().nullable().optional(),
    thumbmarkDocumentVersionId: z.string().uuid().nullable().optional(),
    subscribedAndSwornText: optionalText(2000),
    subscribedAndSwornAt: optionalDateTime,
    oathAdministeredBy: optionalText(240),
    oathAdminSignatureDocumentId: z.string().uuid().nullable().optional(),
    oathAdminSignatureDocumentVersionId: z.string().uuid().nullable().optional(),
    oathAdministeredAt: optionalDateTime,
  })
  .strict()
  .superRefine((value, context) => {
    requireEvidencePair(value, context, 'photoDocumentId', 'photoDocumentVersionId');
    requireEvidencePair(
      value,
      context,
      'employeeSignatureDocumentId',
      'employeeSignatureDocumentVersionId',
    );
    requireEvidencePair(value, context, 'thumbmarkDocumentId', 'thumbmarkDocumentVersionId');
    requireEvidencePair(
      value,
      context,
      'oathAdminSignatureDocumentId',
      'oathAdminSignatureDocumentVersionId',
    );
  });

export const pdsPageSignatureSchema = z
  .object({
    id: z.string().uuid().optional(),
    pageKey: z.enum(PDS_PAGE_KEYS),
    signatureDocumentId: z.string().uuid().nullable().optional(),
    signatureDocumentVersionId: z.string().uuid().nullable().optional(),
    signedAt: optionalDateTime,
    signatureDate: optionalDate,
  })
  .strict()
  .superRefine((value, context) => {
    requireEvidencePair(value, context, 'signatureDocumentId', 'signatureDocumentVersionId');
  });

export const pdsReferenceRecordsSchema = z
  .array(pdsReferenceRecordSchema)
  .max(3)
  .superRefine((rows, context) =>
    validateSequenceNumbers(rows, context, 'references', 'Reference'),
  );

export const pdsPageSignaturesSchema = z
  .array(pdsPageSignatureSchema)
  .superRefine((rows, context) =>
    validateSequenceNumbers(
      rows.map((row) => ({ sequenceNo: PDS_PAGE_KEYS.indexOf(row.pageKey) + 1 })),
      context,
      'pageSignatures',
      'PDS page signature',
    ),
  );

export const pdsReasonSchema = z.object({ reason: requiredText(2000) }).strict();
export const pdsEmployeeCertificationSchema = z
  .object({ employeeCertificationAccepted: z.literal(true) })
  .strict();
export const pdsEmptyActionSchema = z.object({}).strict();

export const pdsCreateSchema = z
  .object({
    employeeId: z.string().uuid().optional(),
    asOfDate: z.string().date().optional(),
    personal: pdsPersonalDetailsSchema.optional(),
    family: pdsFamilySchema.optional(),
    education: pdsEducationSchema.optional(),
    eligibility: pdsEligibilitySchema.optional(),
    workExperience: z.array(pdsWorkExperienceSchema).optional(),
    voluntaryWork: z.array(pdsVoluntaryWorkSchema).optional(),
    learningAndDevelopment: z.array(pdsLearningDevelopmentSchema).optional(),
    wes: z.array(pdsWesSchema).optional(),
    otherInformation: pdsOtherInformationSchema.optional(),
    declarations: pdsDeclarationDetailsSchema.optional(),
    references: pdsReferenceRecordsSchema.optional(),
    certification: pdsCertificationDetailsSchema.optional(),
    pageSignatures: pdsPageSignaturesSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    validateSequenceNumbers(value.workExperience, context, 'workExperience', 'Work experience');
    validateSequenceNumbers(value.voluntaryWork, context, 'voluntaryWork', 'Voluntary work');
    validateSequenceNumbers(
      value.learningAndDevelopment,
      context,
      'learningAndDevelopment',
      'Learning and development',
    );
    validateMostRecentFirst(
      value.workExperience,
      context,
      'workExperience',
      'inclusiveFrom',
      'inclusiveTo',
      'isCurrent',
      'Work experience',
    );
    validateMostRecentFirst(
      value.learningAndDevelopment,
      context,
      'learningAndDevelopment',
      'attendanceFrom',
      'attendanceTo',
      undefined,
      'Learning and development',
    );
    validateSequenceNumbers(value.references, context, 'references', 'Reference');
  });

export const pdsVersionIdSchema = z.string().uuid();

export const pdsUpdateSchema = z
  .object({
    rowVersion: z.number().int().positive().optional(),
    asOfDate: z.string().date().optional(),
    personal: pdsPersonalDetailsSchema.optional(),
    family: pdsFamilySchema.optional(),
    education: pdsEducationSchema.optional(),
    eligibility: pdsEligibilitySchema.optional(),
    workExperience: z.array(pdsWorkExperienceSchema).optional(),
    voluntaryWork: z.array(pdsVoluntaryWorkSchema).optional(),
    learningAndDevelopment: z.array(pdsLearningDevelopmentSchema).optional(),
    wes: z.array(pdsWesSchema).nullable().optional(),
    otherInformation: pdsOtherInformationSchema.optional(),
    declarations: pdsDeclarationDetailsSchema.optional(),
    references: pdsReferenceRecordsSchema.optional(),
    certification: pdsCertificationDetailsSchema.optional(),
    pageSignatures: pdsPageSignaturesSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    validateSequenceNumbers(value.workExperience, context, 'workExperience', 'Work experience');
    validateSequenceNumbers(value.voluntaryWork, context, 'voluntaryWork', 'Voluntary work');
    validateSequenceNumbers(
      value.learningAndDevelopment,
      context,
      'learningAndDevelopment',
      'Learning and development',
    );
    validateMostRecentFirst(
      value.workExperience,
      context,
      'workExperience',
      'inclusiveFrom',
      'inclusiveTo',
      'isCurrent',
      'Work experience',
    );
    validateMostRecentFirst(
      value.learningAndDevelopment,
      context,
      'learningAndDevelopment',
      'attendanceFrom',
      'attendanceTo',
      undefined,
      'Learning and development',
    );
    validateSequenceNumbers(value.references, context, 'references', 'Reference');
  })
  .refine(
    (value) =>
      value.asOfDate !== undefined ||
      value.personal ||
      value.family ||
      value.education ||
      value.eligibility ||
      value.workExperience ||
      value.voluntaryWork ||
      value.learningAndDevelopment ||
      value.wes !== undefined ||
      value.otherInformation ||
      value.declarations ||
      value.references ||
      value.certification ||
      value.pageSignatures,
    { message: 'Provide a PDS section or as-of date to update.' },
  );

export type PdsCreateInput = z.infer<typeof pdsCreateSchema>;
export type PdsUpdateInput = z.infer<typeof pdsUpdateSchema>;
export type PdsPersonalDetailsInput = z.infer<typeof pdsPersonalDetailsSchema>;
export type PdsFamilyInput = z.infer<typeof pdsFamilySchema>;
export type PdsEducationInput = z.infer<typeof pdsEducationSchema>;
export type PdsEligibilityInput = z.infer<typeof pdsEligibilitySchema>;
export type PdsWorkExperienceInput = z.infer<typeof pdsWorkExperienceSchema>;
export type PdsVoluntaryWorkInput = z.infer<typeof pdsVoluntaryWorkSchema>;
export type PdsLearningDevelopmentInput = z.infer<typeof pdsLearningDevelopmentSchema>;
export type PdsWesInput = z.infer<typeof pdsWesSchema>;
export type PdsWesEntryInput = z.infer<typeof pdsWesEntrySchema>;
export type PdsOtherInformationInput = z.infer<typeof pdsOtherInformationSchema>;
export type PdsDeclarationDetailsInput = z.infer<typeof pdsDeclarationDetailsSchema>;
export type PdsReferenceRecordInput = z.infer<typeof pdsReferenceRecordSchema>;
export type PdsCertificationDetailsInput = z.infer<typeof pdsCertificationDetailsSchema>;
export type PdsPageSignatureInput = z.infer<typeof pdsPageSignatureSchema>;
export type PdsReasonInput = z.infer<typeof pdsReasonSchema>;
export type PdsEmployeeCertificationInput = z.infer<typeof pdsEmployeeCertificationSchema>;
