import { z } from 'zod';

// The national leave catalogue is fixed code. An Agency admits one Leave Type
// per catalogue entry, but only the findings that the accepted national sources
// actually delegate can be configured. Parameter values are frozen per entry:
// no administrator, formula, or Agency edit may replace them.

export const LEAVE_EVALUATOR_KINDS = [
  'SERVICE_ACCRUAL',
  'ANNUAL_ALLOWANCE',
  'EVENT_BOUND_ALLOWANCE',
  'MANDATORY_CHARGE_FROM_ACCOUNT',
  'NON_CREDIT_AUTHORIZATION',
  'SOURCE_DEFINED_PLACEHOLDER',
] as const;

export type LeaveEvaluatorKind = (typeof LEAVE_EVALUATOR_KINDS)[number];

export const LEAVE_ENTITLEMENT_BASES = [
  'ACCRUED_ACCOUNT',
  'PERIODIC_ALLOWANCE',
  'QUALIFYING_EVENT',
  'NON_CREDIT_AUTHORIZATION',
] as const;

export type LeaveEntitlementBasis = (typeof LEAVE_ENTITLEMENT_BASES)[number];

export const LEAVE_CALENDAR_BASES = [
  'WORKING_DAY',
  'CALENDAR_DAY',
  'SCHEDULED_TIME',
  'SOURCE_DEFINED',
] as const;

export type LeaveCalendarBasis = (typeof LEAVE_CALENDAR_BASES)[number];

export const LEAVE_PERSONNEL_PROFILES = [
  'ORDINARY_CIVILIAN_NGA',
  'TEACHER',
  'SPECIAL_LAW_PERSONNEL',
  'JO_COS_WORKER',
  'UNIFORMED_OR_MILITARY',
] as const;

export type LeavePersonnelProfile = (typeof LEAVE_PERSONNEL_PROFILES)[number];

export const LEAVE_EVIDENCE_KINDS = [
  'SIGNED_LEAVE_APPLICATION_FORM',
  'MEDICAL_CERTIFICATE',
  'BIRTH_OR_PREGNANCY_EVIDENCE',
  'MARRIAGE_EVIDENCE',
  'PLACEMENT_AUTHORITY_EVIDENCE',
  'SOLO_PARENT_IDENTIFICATION',
  'PROTECTION_ORDER_EVIDENCE',
  'CALAMITY_DECLARATION_EVIDENCE',
  'STUDY_AGREEMENT_EVIDENCE',
  'MEDICAL_RECOMMENDATION',
  'GYNECOLOGICAL_SURGERY_EVIDENCE',
  'SCHEDULE_OR_CLEARANCE_EVIDENCE',
] as const;

export type LeaveEvidenceKind = (typeof LEAVE_EVIDENCE_KINDS)[number];

export const LEAVE_AUTHORITY_CLASSES = ['NATIONAL_RULE', 'AGENCY_CONFIGURATION'] as const;

export type LeaveAuthorityClass = (typeof LEAVE_AUTHORITY_CLASSES)[number];

export const LEAVE_QUALIFYING_EVENTS = [
  'LIVE_CHILDBIRTH',
  'MISCARRIAGE_OR_EMERGENCY_TERMINATION',
  'QUALIFYING_DELIVERY',
  'PLACEMENT',
  'DECLARED_CALAMITY',
  'GYNECOLOGICAL_SURGERY',
  'MASTERS_PROGRAM',
] as const;

export type LeaveQualifyingEvent = (typeof LEAVE_QUALIFYING_EVENTS)[number];

export interface LeaveRuleParameters {
  earnDays?: number;
  perServiceDays?: number;
  annualCreditDays?: number;
  annualDays?: number;
  grantedDays?: number;
  grantedMonths?: number;
  maximumQualifyingDeliveries?: number;
  requiredWorkingDays?: number;
  minimumAccountCredits?: number;
  usageWindowDays?: number;
  maximumMonths?: number;
  qualifyingEvent?: LeaveQualifyingEvent;
  variants?: readonly {
    code: LeaveQualifyingEvent;
    grantedDays?: number;
    grantedMonths?: number;
  }[];
  paid?: boolean;
  chargesLedger?: boolean;
  accumulation?: 'UNLIMITED' | 'NON_CUMULATIVE' | 'NOT_APPLICABLE';
  expiration?: 'NONE' | 'YEAR_END';
  forfeiture?: 'NONE' | 'YEAR_END_UNUSED' | 'NON_CONVERSION';
  commutation?: 'PERMITTED' | 'NOT_COMMUTABLE' | 'NOT_SPECIFIED';
  agencyDiscretionary?: true;
  indeterminateSource?: true;
}

export interface LeaveAuthorityCitation {
  citation: string;
  title: string;
}

export interface LeaveCatalogueEntry {
  code: string;
  name: string;
  evaluatorKind: LeaveEvaluatorKind;
  entitlementBasis: LeaveEntitlementBasis;
  calendarBasis: LeaveCalendarBasis;
  chargedLeaveTypeCode: string | null;
  ruleParameters: LeaveRuleParameters;
  personnelProfiles: readonly LeavePersonnelProfile[];
  requiredEvidenceKinds: readonly LeaveEvidenceKind[];
  authorityCitations: readonly LeaveAuthorityCitation[];
  requiresAgencyConfigurationEvidence: boolean;
  failClosed: boolean;
}

const ruleParameterShape = z
  .object({
    earnDays: z.number().finite().positive().max(366).optional(),
    perServiceDays: z.number().int().positive().max(3660).optional(),
    annualCreditDays: z.number().finite().positive().max(3660).optional(),
    annualDays: z.number().finite().positive().max(3660).optional(),
    grantedDays: z.number().finite().positive().max(3660).optional(),
    grantedMonths: z.number().finite().positive().max(120).optional(),
    maximumQualifyingDeliveries: z.number().int().positive().max(100).optional(),
    requiredWorkingDays: z.number().finite().positive().max(3660).optional(),
    minimumAccountCredits: z.number().finite().nonnegative().max(3660).optional(),
    usageWindowDays: z.number().int().positive().max(3660).optional(),
    maximumMonths: z.number().finite().positive().max(120).optional(),
    qualifyingEvent: z.enum(LEAVE_QUALIFYING_EVENTS).optional(),
    variants: z
      .array(
        z
          .object({
            code: z.enum(LEAVE_QUALIFYING_EVENTS),
            grantedDays: z.number().finite().positive().max(3660).optional(),
            grantedMonths: z.number().finite().positive().max(120).optional(),
          })
          .strict(),
      )
      .nonempty()
      .max(10)
      .optional(),
    paid: z.boolean().optional(),
    chargesLedger: z.boolean().optional(),
    accumulation: z.enum(['UNLIMITED', 'NON_CUMULATIVE', 'NOT_APPLICABLE']).optional(),
    expiration: z.enum(['NONE', 'YEAR_END']).optional(),
    forfeiture: z.enum(['NONE', 'YEAR_END_UNUSED', 'NON_CONVERSION']).optional(),
    commutation: z.enum(['PERMITTED', 'NOT_COMMUTABLE', 'NOT_SPECIFIED']).optional(),
    agencyDiscretionary: z.literal(true).optional(),
    indeterminateSource: z.literal(true).optional(),
  })
  .strict();

const evaluatorParameterRequirements: Record<
  LeaveEvaluatorKind,
  {
    required: readonly (keyof LeaveRuleParameters)[];
    anyOf?: readonly (readonly (keyof LeaveRuleParameters)[])[];
  }
> = {
  SERVICE_ACCRUAL: {
    required: [
      'earnDays',
      'perServiceDays',
      'annualCreditDays',
      'accumulation',
      'expiration',
      'forfeiture',
    ],
  },
  ANNUAL_ALLOWANCE: {
    required: ['annualDays', 'accumulation', 'expiration', 'forfeiture', 'commutation'],
  },
  EVENT_BOUND_ALLOWANCE: {
    required: ['qualifyingEvent', 'accumulation', 'expiration'],
    anyOf: [['grantedDays', 'grantedMonths']],
  },
  MANDATORY_CHARGE_FROM_ACCOUNT: {
    required: ['requiredWorkingDays', 'minimumAccountCredits', 'accumulation', 'expiration'],
  },
  NON_CREDIT_AUTHORIZATION: {
    required: ['paid', 'chargesLedger'],
  },
  SOURCE_DEFINED_PLACEHOLDER: {
    required: ['indeterminateSource'],
  },
};

export class LeaveCatalogueIntegrityError extends Error {}

export function assertLeaveCatalogueIntegrity(): void {
  const codes = new Set(LEAVE_CATALOGUE.map((entry) => entry.code));
  if (codes.size !== LEAVE_CATALOGUE.length) {
    throw new LeaveCatalogueIntegrityError('Leave catalogue codes must be unique');
  }
  for (const entry of LEAVE_CATALOGUE) {
    const parsed = ruleParameterShape.safeParse(entry.ruleParameters);
    if (!parsed.success) {
      throw new LeaveCatalogueIntegrityError(
        `Leave catalogue parameters are invalid for ${entry.code}`,
      );
    }
    for (const key of evaluatorParameterRequirements[entry.evaluatorKind].required) {
      if (parsed.data[key] === undefined) {
        throw new LeaveCatalogueIntegrityError(
          `Leave catalogue parameters are incomplete for ${entry.code}: ${key}`,
        );
      }
    }
    for (const group of evaluatorParameterRequirements[entry.evaluatorKind].anyOf ?? []) {
      if (!group.some((key) => parsed.data[key] !== undefined)) {
        throw new LeaveCatalogueIntegrityError(
          `Leave catalogue parameters are incomplete for ${entry.code}: ${group.join(' or ')}`,
        );
      }
    }
    if (entry.personnelProfiles.length === 0) {
      throw new LeaveCatalogueIntegrityError(
        `Leave catalogue entry ${entry.code} must admit at least one personnel profile`,
      );
    }
    if (entry.chargedLeaveTypeCode !== null && !codes.has(entry.chargedLeaveTypeCode)) {
      throw new LeaveCatalogueIntegrityError(
        `Leave catalogue entry ${entry.code} charges an unknown Leave Type`,
      );
    }
    if (entry.authorityCitations.length === 0) {
      throw new LeaveCatalogueIntegrityError(
        `Leave catalogue entry ${entry.code} must cite at least one national source`,
      );
    }
  }
}

const MC41 = 'CSC MC No. 41, s. 1998 (Omnibus Rules on Leave), as amended';
const ORDINARY: readonly LeavePersonnelProfile[] = ['ORDINARY_CIVILIAN_NGA'];

export const LEAVE_CATALOGUE: readonly LeaveCatalogueEntry[] = [
  {
    code: 'VACATION_LEAVE',
    name: 'Vacation Leave',
    evaluatorKind: 'SERVICE_ACCRUAL',
    entitlementBasis: 'ACCRUED_ACCOUNT',
    calendarBasis: 'WORKING_DAY',
    chargedLeaveTypeCode: null,
    ruleParameters: {
      earnDays: 1,
      perServiceDays: 24,
      annualCreditDays: 15,
      accumulation: 'UNLIMITED',
      expiration: 'NONE',
      forfeiture: 'NONE',
    },
    personnelProfiles: ORDINARY,
    requiredEvidenceKinds: ['SIGNED_LEAVE_APPLICATION_FORM'],
    authorityCitations: [
      { citation: 'Rule XVI, sections 1-3', title: MC41 },
      { citation: 'sections 27-30', title: MC41 },
    ],
    requiresAgencyConfigurationEvidence: false,
    failClosed: false,
  },
  {
    code: 'SICK_LEAVE',
    name: 'Sick Leave',
    evaluatorKind: 'SERVICE_ACCRUAL',
    entitlementBasis: 'ACCRUED_ACCOUNT',
    calendarBasis: 'WORKING_DAY',
    chargedLeaveTypeCode: null,
    ruleParameters: {
      earnDays: 1,
      perServiceDays: 24,
      annualCreditDays: 15,
      accumulation: 'UNLIMITED',
      expiration: 'NONE',
      forfeiture: 'NONE',
    },
    personnelProfiles: ORDINARY,
    requiredEvidenceKinds: ['SIGNED_LEAVE_APPLICATION_FORM', 'MEDICAL_CERTIFICATE'],
    authorityCitations: [
      { citation: 'Rule XVI, sections 1-3', title: MC41 },
      { citation: 'sections 27-30', title: MC41 },
    ],
    requiresAgencyConfigurationEvidence: false,
    failClosed: false,
  },
  {
    code: 'MANDATORY_LEAVE',
    name: 'Mandatory or Forced Leave',
    evaluatorKind: 'MANDATORY_CHARGE_FROM_ACCOUNT',
    entitlementBasis: 'QUALIFYING_EVENT',
    calendarBasis: 'WORKING_DAY',
    chargedLeaveTypeCode: 'VACATION_LEAVE',
    ruleParameters: {
      requiredWorkingDays: 5,
      minimumAccountCredits: 10,
      accumulation: 'NOT_APPLICABLE',
      expiration: 'NONE',
      forfeiture: 'YEAR_END_UNUSED',
    },
    personnelProfiles: ORDINARY,
    requiredEvidenceKinds: ['SCHEDULE_OR_CLEARANCE_EVIDENCE'],
    authorityCitations: [{ citation: 'section 25', title: MC41 }],
    requiresAgencyConfigurationEvidence: true,
    failClosed: false,
  },
  {
    code: 'MATERNITY_LEAVE',
    name: 'Maternity Leave',
    evaluatorKind: 'EVENT_BOUND_ALLOWANCE',
    entitlementBasis: 'QUALIFYING_EVENT',
    calendarBasis: 'CALENDAR_DAY',
    chargedLeaveTypeCode: null,
    ruleParameters: {
      qualifyingEvent: 'LIVE_CHILDBIRTH',
      grantedDays: 105,
      variants: [{ code: 'MISCARRIAGE_OR_EMERGENCY_TERMINATION', grantedDays: 60 }],
      accumulation: 'NOT_APPLICABLE',
      expiration: 'NONE',
    },
    personnelProfiles: ORDINARY,
    requiredEvidenceKinds: ['BIRTH_OR_PREGNANCY_EVIDENCE'],
    authorityCitations: [
      { citation: 'RA 11210', title: 'An Act Expanding the Maternity Leave Period, 2019' },
      { citation: 'Rule I and sections 11-20', title: 'CSC MC No. 5, s. 2021' },
    ],
    requiresAgencyConfigurationEvidence: true,
    failClosed: false,
  },
  {
    code: 'PATERNITY_LEAVE',
    name: 'Paternity Leave',
    evaluatorKind: 'EVENT_BOUND_ALLOWANCE',
    entitlementBasis: 'QUALIFYING_EVENT',
    calendarBasis: 'CALENDAR_DAY',
    chargedLeaveTypeCode: null,
    ruleParameters: {
      qualifyingEvent: 'QUALIFYING_DELIVERY',
      grantedDays: 7,
      maximumQualifyingDeliveries: 4,
      accumulation: 'NOT_APPLICABLE',
      expiration: 'NONE',
    },
    personnelProfiles: ORDINARY,
    requiredEvidenceKinds: ['MARRIAGE_EVIDENCE', 'BIRTH_OR_PREGNANCY_EVIDENCE'],
    authorityCitations: [
      { citation: 'RA 8187', title: 'Paternity Leave Act of 1996' },
      { citation: 'Rule I and sections 11-20', title: 'CSC MC No. 5, s. 2021' },
      { citation: 'period of availment', title: 'CSC MC No. 1, s. 2016' },
    ],
    requiresAgencyConfigurationEvidence: false,
    failClosed: false,
  },
  {
    code: 'SPECIAL_PRIVILEGE_LEAVE',
    name: 'Special Privilege Leave',
    evaluatorKind: 'ANNUAL_ALLOWANCE',
    entitlementBasis: 'PERIODIC_ALLOWANCE',
    calendarBasis: 'WORKING_DAY',
    chargedLeaveTypeCode: null,
    ruleParameters: {
      annualDays: 3,
      accumulation: 'NON_CUMULATIVE',
      expiration: 'YEAR_END',
      forfeiture: 'YEAR_END_UNUSED',
      commutation: 'NOT_COMMUTABLE',
    },
    personnelProfiles: ORDINARY,
    requiredEvidenceKinds: ['SIGNED_LEAVE_APPLICATION_FORM'],
    authorityCitations: [{ citation: 'section 21', title: MC41 }],
    requiresAgencyConfigurationEvidence: false,
    failClosed: false,
  },
  {
    code: 'SOLO_PARENT_LEAVE',
    name: 'Solo Parent Parental Leave',
    evaluatorKind: 'ANNUAL_ALLOWANCE',
    entitlementBasis: 'PERIODIC_ALLOWANCE',
    calendarBasis: 'WORKING_DAY',
    chargedLeaveTypeCode: null,
    ruleParameters: {
      annualDays: 7,
      accumulation: 'NON_CUMULATIVE',
      expiration: 'YEAR_END',
      forfeiture: 'YEAR_END_UNUSED',
      commutation: 'NOT_COMMUTABLE',
    },
    personnelProfiles: ORDINARY,
    requiredEvidenceKinds: ['SOLO_PARENT_IDENTIFICATION'],
    authorityCitations: [
      {
        citation: 'section 8',
        title: 'RA 11861 (Expanded Solo Parents Welfare Act), amending RA 8972',
      },
    ],
    requiresAgencyConfigurationEvidence: true,
    failClosed: false,
  },
  {
    code: 'VAWC_LEAVE',
    name: 'Leave for Victims of Violence Against Women and Children',
    evaluatorKind: 'ANNUAL_ALLOWANCE',
    entitlementBasis: 'PERIODIC_ALLOWANCE',
    calendarBasis: 'WORKING_DAY',
    chargedLeaveTypeCode: null,
    ruleParameters: {
      annualDays: 10,
      accumulation: 'NON_CUMULATIVE',
      expiration: 'YEAR_END',
      forfeiture: 'YEAR_END_UNUSED',
      commutation: 'NOT_COMMUTABLE',
    },
    personnelProfiles: ORDINARY,
    requiredEvidenceKinds: ['PROTECTION_ORDER_EVIDENCE'],
    authorityCitations: [
      { citation: 'RA 9262', title: 'Anti-Violence Against Women and Their Children Act of 2004' },
      { citation: 'CSC MC No. 15, s. 2006', title: 'VAWC leave guidelines' },
    ],
    requiresAgencyConfigurationEvidence: false,
    failClosed: false,
  },
  {
    code: 'SPECIAL_EMERGENCY_LEAVE',
    name: 'Special Emergency or Calamity Leave',
    evaluatorKind: 'EVENT_BOUND_ALLOWANCE',
    entitlementBasis: 'QUALIFYING_EVENT',
    calendarBasis: 'WORKING_DAY',
    chargedLeaveTypeCode: null,
    ruleParameters: {
      qualifyingEvent: 'DECLARED_CALAMITY',
      grantedDays: 5,
      usageWindowDays: 30,
      chargesLedger: false,
      accumulation: 'NOT_APPLICABLE',
      expiration: 'NONE',
    },
    personnelProfiles: ORDINARY,
    requiredEvidenceKinds: ['CALAMITY_DECLARATION_EVIDENCE'],
    authorityCitations: [
      { citation: 'CSC MC No. 2, s. 2012', title: 'Special emergency leave guidelines' },
      { citation: 'CSC MC No. 16, s. 2012', title: 'Special emergency leave clarification' },
    ],
    requiresAgencyConfigurationEvidence: true,
    failClosed: false,
  },
  {
    code: 'ADOPTION_LEAVE',
    name: 'Adoption Leave',
    evaluatorKind: 'EVENT_BOUND_ALLOWANCE',
    entitlementBasis: 'QUALIFYING_EVENT',
    calendarBasis: 'CALENDAR_DAY',
    chargedLeaveTypeCode: null,
    ruleParameters: {
      qualifyingEvent: 'PLACEMENT',
      grantedDays: 60,
      accumulation: 'NOT_APPLICABLE',
      expiration: 'NONE',
    },
    personnelProfiles: ORDINARY,
    requiredEvidenceKinds: ['PLACEMENT_AUTHORITY_EVIDENCE'],
    authorityCitations: [
      { citation: 'section 12', title: 'RA 8552 (Domestic Adoption Act of 1998)' },
      { citation: 'Rule I and sections 11-20', title: 'CSC MC No. 5, s. 2021' },
      {
        citation: 'CSC Resolution No. 2101012',
        title: 'Adoption leave application process',
      },
    ],
    requiresAgencyConfigurationEvidence: true,
    failClosed: false,
  },
  {
    code: 'WELLNESS_LEAVE',
    name: 'Wellness Leave',
    evaluatorKind: 'ANNUAL_ALLOWANCE',
    entitlementBasis: 'PERIODIC_ALLOWANCE',
    calendarBasis: 'WORKING_DAY',
    chargedLeaveTypeCode: null,
    ruleParameters: {
      annualDays: 5,
      accumulation: 'NON_CUMULATIVE',
      expiration: 'YEAR_END',
      forfeiture: 'YEAR_END_UNUSED',
      commutation: 'NOT_COMMUTABLE',
      agencyDiscretionary: true,
    },
    personnelProfiles: ORDINARY,
    requiredEvidenceKinds: ['SIGNED_LEAVE_APPLICATION_FORM'],
    authorityCitations: [{ citation: 'CSC MC No. 1, s. 2026', title: 'Wellness Leave Policy' }],
    requiresAgencyConfigurationEvidence: true,
    failClosed: false,
  },
  {
    code: 'SPECIAL_LEAVE_BENEFITS_FOR_WOMEN',
    name: 'Special Leave Benefits for Women',
    evaluatorKind: 'EVENT_BOUND_ALLOWANCE',
    entitlementBasis: 'QUALIFYING_EVENT',
    calendarBasis: 'CALENDAR_DAY',
    chargedLeaveTypeCode: null,
    ruleParameters: {
      qualifyingEvent: 'GYNECOLOGICAL_SURGERY',
      grantedMonths: 2,
      accumulation: 'NOT_APPLICABLE',
      expiration: 'NONE',
    },
    personnelProfiles: ORDINARY,
    requiredEvidenceKinds: ['MEDICAL_CERTIFICATE', 'GYNECOLOGICAL_SURGERY_EVIDENCE'],
    authorityCitations: [
      { citation: 'section 8', title: 'RA 9710 (Magna Carta of Women)' },
      { citation: 'CSC MC No. 25, s. 2010', title: 'Special leave benefits for women' },
    ],
    requiresAgencyConfigurationEvidence: false,
    failClosed: false,
  },
  {
    code: 'STUDY_LEAVE',
    name: 'Study Leave',
    evaluatorKind: 'NON_CREDIT_AUTHORIZATION',
    entitlementBasis: 'NON_CREDIT_AUTHORIZATION',
    calendarBasis: 'SOURCE_DEFINED',
    chargedLeaveTypeCode: null,
    ruleParameters: {
      paid: true,
      chargesLedger: false,
      maximumMonths: 6,
      variants: [{ code: 'MASTERS_PROGRAM', grantedMonths: 4 }],
    },
    personnelProfiles: ORDINARY,
    requiredEvidenceKinds: ['STUDY_AGREEMENT_EVIDENCE'],
    authorityCitations: [{ citation: 'CSC MC No. 21, s. 2004', title: 'Study leave guidelines' }],
    requiresAgencyConfigurationEvidence: true,
    failClosed: false,
  },
  {
    code: 'REHABILITATION_LEAVE',
    name: 'Rehabilitation Leave',
    evaluatorKind: 'NON_CREDIT_AUTHORIZATION',
    entitlementBasis: 'NON_CREDIT_AUTHORIZATION',
    calendarBasis: 'SOURCE_DEFINED',
    chargedLeaveTypeCode: null,
    ruleParameters: {
      paid: true,
      chargesLedger: false,
      maximumMonths: 6,
    },
    personnelProfiles: ORDINARY,
    requiredEvidenceKinds: ['MEDICAL_RECOMMENDATION'],
    authorityCitations: [
      {
        citation: 'CSC-DBM Joint Circular No. 1, s. 2006',
        title: 'Rehabilitation leave guidelines',
      },
      {
        citation: 'CSC Resolution No. 1300065',
        title: 'Rehabilitation leave amendment',
      },
    ],
    requiresAgencyConfigurationEvidence: true,
    failClosed: false,
  },
  {
    code: 'LEAVE_WITHOUT_PAY',
    name: 'Leave Without Pay',
    evaluatorKind: 'NON_CREDIT_AUTHORIZATION',
    entitlementBasis: 'NON_CREDIT_AUTHORIZATION',
    calendarBasis: 'WORKING_DAY',
    chargedLeaveTypeCode: null,
    ruleParameters: {
      paid: false,
      chargesLedger: false,
    },
    personnelProfiles: ORDINARY,
    requiredEvidenceKinds: ['SIGNED_LEAVE_APPLICATION_FORM'],
    authorityCitations: [
      { citation: 'sections 27-30', title: MC41 },
      { citation: 'section 50', title: MC41 },
    ],
    requiresAgencyConfigurationEvidence: false,
    failClosed: false,
  },
  {
    code: 'OTHER_LEAVE_UNDER_LAW',
    name: 'Other Leave Under Law or CSC Issuance',
    evaluatorKind: 'SOURCE_DEFINED_PLACEHOLDER',
    entitlementBasis: 'NON_CREDIT_AUTHORIZATION',
    calendarBasis: 'SOURCE_DEFINED',
    chargedLeaveTypeCode: null,
    ruleParameters: { indeterminateSource: true },
    personnelProfiles: ORDINARY,
    requiredEvidenceKinds: [],
    authorityCitations: [
      {
        citation: 'LEA-001 catalogue placeholder',
        title: 'No accepted national evaluator rule has been admitted yet',
      },
    ],
    requiresAgencyConfigurationEvidence: true,
    failClosed: true,
  },
];

assertLeaveCatalogueIntegrity();

export function findLeaveCatalogueEntry(code: string): LeaveCatalogueEntry | null {
  return LEAVE_CATALOGUE.find((entry) => entry.code === code) ?? null;
}

export function parseLeaveRuleParameters(value: unknown) {
  return ruleParameterShape.safeParse(value);
}
