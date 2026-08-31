import { z } from 'zod';

export const PDS_FORM_VERSION = 'CS_FORM_212_REVISED_2026' as const;
export const PDS_STATUSES = ['DRAFT', 'SUBMITTED', 'RETURNED', 'CERTIFIED', 'SUPERSEDED'] as const;
export const PDS_CITIZENSHIP_TYPES = ['FILIPINO', 'DUAL_CITIZENSHIP'] as const;
export const PDS_DUAL_CITIZENSHIP_TYPES = ['BY_BIRTH', 'BY_NATURALIZATION'] as const;
export const PDS_SEXES = ['MALE', 'FEMALE'] as const;
export const PDS_CIVIL_STATUSES = ['SINGLE', 'MARRIED', 'WIDOWED', 'SEPARATED', 'OTHER'] as const;

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
    umidIdNumber: optionalText(120),
    pagibigIdNumber: optionalText(120),
    philhealthNumber: optionalText(120),
    philSysCardNumber: optionalText(120),
    tinNumber: optionalText(120),
    agencyEmployeeNumber: optionalText(80),
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

export const pdsCreateSchema = z
  .object({
    employeeId: z.string().uuid().optional(),
    asOfDate: z.string().date().optional(),
    personal: pdsPersonalDetailsSchema.optional(),
    family: pdsFamilySchema.optional(),
  })
  .strict();

export const pdsVersionIdSchema = z.string().uuid();

export const pdsUpdateSchema = z
  .object({
    rowVersion: z.number().int().positive().optional(),
    asOfDate: z.string().date().optional(),
    personal: pdsPersonalDetailsSchema.optional(),
    family: pdsFamilySchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.rowVersion !== undefined ||
      value.asOfDate !== undefined ||
      value.personal ||
      value.family,
    { message: 'Provide a PDS section or as-of date to update.' },
  );

export type PdsCreateInput = z.infer<typeof pdsCreateSchema>;
export type PdsUpdateInput = z.infer<typeof pdsUpdateSchema>;
export type PdsPersonalDetailsInput = z.infer<typeof pdsPersonalDetailsSchema>;
export type PdsFamilyInput = z.infer<typeof pdsFamilySchema>;
