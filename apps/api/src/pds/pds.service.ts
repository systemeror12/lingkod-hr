import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { canAccessRecord, hasPermission, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import { DocumentsService } from '../documents/documents.service';
import {
  PDS_FORM_VERSION,
  PDS_CITIZENSHIP_COUNTRIES,
  PDS_EDUCATION_LEVELS,
  pdsEducationSchema,
  pdsEligibilitySchema,
  pdsPersonalDetailsSchema,
  type PdsCreateInput,
  type PdsEducationInput,
  type PdsEligibilityInput,
  type PdsFamilyInput,
  type PdsLearningDevelopmentInput,
  type PdsPersonalDetailsInput,
  type PdsUpdateInput,
  type PdsVoluntaryWorkInput,
  type PdsWesInput,
  type PdsWorkExperienceInput,
} from './pds.schemas';

export type PdsVersionState = 'DRAFT' | 'SUBMITTED' | 'RETURNED' | 'CERTIFIED' | 'SUPERSEDED';

export type PdsFieldScope = 'FULL' | 'REDACTED';

export interface PdsPersonalDetailsView {
  surname: string | null;
  firstName: string | null;
  nameExtension: string | null;
  middleName: string | null;
  birthDate: string | null;
  birthPlace: string | null;
  sex: string | null;
  civilStatus: string | null;
  civilStatusDetail: string | null;
  heightMeters: number | null;
  weightKilograms: number | null;
  bloodType: string | null;
  umidIdNumber: string | null;
  pagibigIdNumber: string | null;
  philhealthNumber: string | null;
  philSysCardNumber: string | null;
  tinNumber: string | null;
  agencyEmployeeNumber: string | null;
  citizenship: string | null;
  dualCitizenshipType: string | null;
  dualCitizenshipCountry: string | null;
  residentialAddress: Record<string, unknown> | null;
  permanentAddress: Record<string, unknown> | null;
  telephoneNumber: string | null;
  mobileNumber: string | null;
  emailAddress: string | null;
}

export interface PdsFamilyRecordView {
  id: string;
  relationshipType: 'SPOUSE' | 'CHILD' | 'FATHER' | 'MOTHER';
  sequenceNo: number;
  fullName: string | null;
  surname: string | null;
  firstName: string | null;
  middleName: string | null;
  nameExtension: string | null;
  birthDate: string | null;
  occupation: string | null;
  employerBusinessName: string | null;
  businessAddress: Record<string, unknown> | null;
  telephoneNumber: string | null;
}

export interface PdsFamilyView {
  spouse: PdsFamilyRecordView | null;
  children: PdsFamilyRecordView[];
  father: PdsFamilyRecordView | null;
  mother: PdsFamilyRecordView | null;
}

export interface PdsEducationRecordView {
  id: string;
  level: string;
  sequenceNo: number;
  schoolName: string;
  degreeCourse: string;
  periodOfAttendance: string;
  highestLevelUnits: string;
  yearGraduated: number | null;
  honors: string;
  documentId: string | null;
  documentVersionId: string | null;
}

export interface PdsEligibilityRecordView {
  id: string;
  sequenceNo: number;
  eligibilityName: string;
  rating: string | null;
  examDate: string | null;
  examPlace: string;
  licenseNo: string | null;
  validUntil: string | null;
  documentId: string | null;
  documentVersionId: string | null;
}

export interface PdsEvidenceView {
  documentId: string | null;
  documentVersionId: string | null;
}

export interface PdsWorkExperienceView extends PdsEvidenceView {
  id: string;
  sequenceNo: number;
  inclusiveFrom: string | null;
  inclusiveTo: string | null;
  positionTitle: string | null;
  departmentAgencyOfficeCompany: string | null;
  monthlySalary: number | null;
  salaryGradeStep: string | null;
  appointmentStatus: string | null;
  governmentService: 'Y' | 'N' | null;
  isCurrent: boolean;
}

export interface PdsVoluntaryWorkView extends PdsEvidenceView {
  id: string;
  sequenceNo: number;
  organizationNameAddress: string | null;
  inclusiveFrom: string | null;
  inclusiveTo: string | null;
  hours: number | null;
  positionNatureOfWork: string | null;
}

export interface PdsLearningDevelopmentView extends PdsEvidenceView {
  id: string;
  sequenceNo: number;
  interventionTitle: string | null;
  attendanceFrom: string | null;
  attendanceTo: string | null;
  hours: number | null;
  type: string | null;
  conductedSponsoredBy: string | null;
}

export interface PdsWesEntryView {
  id: string;
  workExperienceId: string;
  sequenceNo: number;
  durationText: string;
  position: string;
  officeUnit: string;
  immediateSupervisor: string;
  agencyOrganizationLocation: string;
  accomplishments: string | null;
  actualDuties: string;
}

export interface PdsWesView extends PdsEvidenceView {
  id: string;
  contextKey: string;
  templateVersion: string;
  status: string;
  entries: PdsWesEntryView[];
}

export interface PdsVersionSummary {
  id: string;
  employeeId: string;
  versionNo: number;
  formVersion: string;
  asOfDate: string;
  status: PdsVersionState;
  supersedesVersionId: string | null;
  correctionReason: string | null;
  createdByMembershipId: string;
  createdAt: string;
  updatedByMembershipId: string;
  updatedAt: string;
  rowVersion: number;
  fieldScope: PdsFieldScope;
}

export interface PdsVersionDetail extends PdsVersionSummary {
  personal: PdsPersonalDetailsView | null;
  family: PdsFamilyView;
  education: PdsEducationRecordView[];
  eligibility: PdsEligibilityRecordView[];
  workExperience: PdsWorkExperienceView[];
  voluntaryWork: PdsVoluntaryWorkView[];
  learningAndDevelopment: PdsLearningDevelopmentView[];
  wes: PdsWesView[];
}

export interface PdsVersionList {
  employeeId: string;
  citizenshipCountries: readonly string[];
  current: PdsVersionSummary | null;
  draft: PdsVersionSummary | null;
  versions: PdsVersionSummary[];
}

export interface PdsAuditWriter {
  write(
    transaction: Prisma.TransactionClient,
    event: Prisma.AuditEventUncheckedCreateInput,
  ): Promise<void>;
}

export const PDS_AUDIT_WRITER = Symbol('PDS_AUDIT_WRITER');

export const pdsAuditWriter: PdsAuditWriter = {
  async write(transaction, event): Promise<void> {
    const safeMetadataKeys = new Set([
      'access',
      'asOfDate',
      'changedFieldCount',
      'childCount',
      'evidenceLinkCount',
      'fieldScope',
      'formVersion',
      'hasFather',
      'hasMother',
      'hasSpouse',
      'rowCount',
      'section',
      'versionCount',
      'versionNo',
      'employeeId',
    ]);
    const metadata =
      event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata)
        ? Object.fromEntries(
            Object.entries(event.metadata).filter(([key]) => safeMetadataKeys.has(key)),
          )
        : {};
    await transaction.auditEvent.create({ data: { ...event, metadata } });
  },
};

const PDS_VERSION_LIST_LIMIT = 200;
const PDS_WES_TEMPLATE_VERSION = 'CS_FORM_212_ATTACHMENT_WES_ORAOHRA_2025_H2';

export class PdsServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'PdsServiceError';
  }
}

const pdsSummarySelect = {
  id: true,
  agencyId: true,
  employeeId: true,
  versionNo: true,
  formVersion: true,
  asOfDate: true,
  status: true,
  supersedesVersionId: true,
  correctionReason: true,
  createdByMembershipId: true,
  createdAt: true,
  updatedByMembershipId: true,
  updatedAt: true,
  rowVersion: true,
} satisfies Prisma.PdsVersionSelect;

const pdsSummaryWithOwnerSelect = {
  ...pdsSummarySelect,
  employee: {
    select: {
      memberships: { select: { userId: true } },
      currentServiceSegment: { select: { organizationUnitId: true } },
    },
  },
} satisfies Prisma.PdsVersionSelect;

const pdsSelect = {
  ...pdsSummaryWithOwnerSelect,
  personalDetails: {
    select: {
      surname: true,
      firstName: true,
      nameExtension: true,
      middleName: true,
      birthDate: true,
      birthPlace: true,
      sex: true,
      civilStatus: true,
      civilStatusDetail: true,
      heightMeters: true,
      weightKilograms: true,
      bloodType: true,
      umidIdNumber: true,
      pagibigIdNumber: true,
      philhealthNumber: true,
      philSysCardNumber: true,
      tinNumber: true,
      agencyEmployeeNumber: true,
      citizenship: true,
      dualCitizenshipType: true,
      dualCitizenshipCountry: true,
      residentialAddress: true,
      permanentAddress: true,
      telephoneNumber: true,
      mobileNumber: true,
      emailAddress: true,
    },
  },
  familyRecords: {
    orderBy: [{ relationshipType: 'asc' }, { sequenceNo: 'asc' }],
    select: {
      id: true,
      relationshipType: true,
      sequenceNo: true,
      fullName: true,
      surname: true,
      firstName: true,
      middleName: true,
      nameExtension: true,
      birthDate: true,
      occupation: true,
      employerBusinessName: true,
      businessAddress: true,
      telephoneNumber: true,
    },
  },
  educationRecords: {
    orderBy: [{ level: 'asc' }, { sequenceNo: 'asc' }],
    select: {
      id: true,
      level: true,
      sequenceNo: true,
      schoolName: true,
      degreeCourse: true,
      periodOfAttendance: true,
      highestLevelUnits: true,
      yearGraduated: true,
      honors: true,
      documentId: true,
      documentVersionId: true,
    },
  },
  eligibilityRecords: {
    orderBy: { sequenceNo: 'asc' },
    select: {
      id: true,
      sequenceNo: true,
      eligibilityName: true,
      rating: true,
      examDate: true,
      examPlace: true,
      licenseNo: true,
      validUntil: true,
      documentId: true,
      documentVersionId: true,
    },
  },
  workExperienceRecords: {
    orderBy: { sequenceNo: 'asc' },
    select: {
      id: true,
      sequenceNo: true,
      inclusiveFrom: true,
      inclusiveTo: true,
      positionTitle: true,
      departmentAgencyOfficeCompany: true,
      monthlySalary: true,
      salaryGradeStep: true,
      appointmentStatus: true,
      governmentService: true,
      isCurrent: true,
      documentId: true,
      documentVersionId: true,
    },
  },
  voluntaryWorkRecords: {
    orderBy: { sequenceNo: 'asc' },
    select: {
      id: true,
      sequenceNo: true,
      organizationNameAddress: true,
      inclusiveFrom: true,
      inclusiveTo: true,
      hours: true,
      positionNatureOfWork: true,
      documentId: true,
      documentVersionId: true,
    },
  },
  learningDevelopmentRecords: {
    orderBy: { sequenceNo: 'asc' },
    select: {
      id: true,
      sequenceNo: true,
      interventionTitle: true,
      attendanceFrom: true,
      attendanceTo: true,
      hours: true,
      type: true,
      conductedSponsoredBy: true,
      documentId: true,
      documentVersionId: true,
    },
  },
  wesArtifacts: {
    orderBy: { contextKey: 'asc' },
    select: {
      id: true,
      contextKey: true,
      templateVersion: true,
      status: true,
      documentId: true,
      documentVersionId: true,
      entries: {
        orderBy: { sequenceNo: 'asc' },
        select: {
          id: true,
          workExperienceId: true,
          sequenceNo: true,
          durationText: true,
          position: true,
          officeUnit: true,
          immediateSupervisor: true,
          agencyOrganizationLocation: true,
          accomplishments: true,
          actualDuties: true,
        },
      },
    },
  },
} satisfies Prisma.PdsVersionSelect;

const pdsRedactedSelect = {
  ...pdsSummaryWithOwnerSelect,
  educationRecords: {
    orderBy: [{ level: 'asc' }, { sequenceNo: 'asc' }],
    select: {
      id: true,
      level: true,
      sequenceNo: true,
      schoolName: true,
      degreeCourse: true,
      periodOfAttendance: true,
      highestLevelUnits: true,
      yearGraduated: true,
      honors: true,
    },
  },
  eligibilityRecords: {
    orderBy: { sequenceNo: 'asc' },
    select: {
      id: true,
      sequenceNo: true,
      eligibilityName: true,
      examDate: true,
      examPlace: true,
    },
  },
} satisfies Prisma.PdsVersionSelect;

type PdsRecord = Prisma.PdsVersionGetPayload<{ select: typeof pdsSelect }>;
type PdsSummaryRecord = Prisma.PdsVersionGetPayload<{ select: typeof pdsSummarySelect }>;
type PdsRedactedRecord = Prisma.PdsVersionGetPayload<{ select: typeof pdsRedactedSelect }>;

const PDS_EDUCATION_LEVEL_ORDER = new Map(
  PDS_EDUCATION_LEVELS.map((level, index) => [level, index]),
);
type PdsAccessRecord = Prisma.PdsVersionGetPayload<{
  select: typeof pdsSummaryWithOwnerSelect;
}>;

function formatDate(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function formatDateTime(value: Date): string {
  return value.toISOString();
}

function jsonObject(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim();
  return normalized || null;
}

function ratingText(value: string | number | null | undefined): string | null {
  const normalized = value === null || value === undefined ? null : String(value).trim();
  if (!normalized) return null;
  return normalized.toLowerCase() === 'if applicable' ? 'If Applicable' : normalized;
}

function databaseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new PdsServiceError('The PDS date is invalid.', 400, 'PDS_DATE_INVALID');
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new PdsServiceError('The PDS date is invalid.', 400, 'PDS_DATE_INVALID');
  }
  return date;
}

function today(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function address(value: { [key: string]: string | null | undefined } | null | undefined) {
  if (!value) return Prisma.JsonNull;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, item ?? null]),
  ) as Prisma.InputJsonValue;
}

function displayName(value: {
  surname: string;
  firstName: string;
  middleName?: string | null | undefined;
  nameExtension?: string | null | undefined;
}): string {
  return [value.firstName, value.middleName, value.surname, value.nameExtension]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(' ');
}

function personalCreateData(
  agencyId: string,
  pdsVersionId: string,
  input: PdsPersonalDetailsInput | undefined,
): Prisma.PdsPersonalDetailsUncheckedCreateInput {
  return {
    agencyId,
    pdsVersionId,
    surname: text(input?.surname),
    firstName: text(input?.firstName),
    nameExtension: text(input?.nameExtension),
    middleName: text(input?.middleName),
    birthDate: input?.birthDate ? databaseDate(input.birthDate) : null,
    birthPlace: text(input?.birthPlace),
    sex: input?.sex ?? null,
    civilStatus: input?.civilStatus ?? null,
    civilStatusDetail: text(input?.civilStatusDetail),
    heightMeters:
      input?.heightMeters === undefined || input.heightMeters === null
        ? null
        : new Prisma.Decimal(input.heightMeters),
    weightKilograms:
      input?.weightKilograms === undefined || input.weightKilograms === null
        ? null
        : new Prisma.Decimal(input.weightKilograms),
    bloodType: text(input?.bloodType),
    umidIdNumber: text(input?.umidIdNumber),
    pagibigIdNumber: text(input?.pagibigIdNumber),
    philhealthNumber: text(input?.philhealthNumber),
    philSysCardNumber: text(input?.philSysCardNumber),
    tinNumber: text(input?.tinNumber),
    agencyEmployeeNumber: text(input?.agencyEmployeeNumber),
    citizenship: input?.citizenship ?? null,
    dualCitizenshipType: input?.dualCitizenshipType ?? null,
    dualCitizenshipCountry: input?.dualCitizenshipCountry ?? null,
    residentialAddress: address(input?.residentialAddress),
    permanentAddress: address(input?.permanentAddress),
    telephoneNumber: text(input?.telephoneNumber),
    mobileNumber: text(input?.mobileNumber),
    emailAddress: text(input?.emailAddress),
  };
}

function personalUpdateData(
  input: PdsPersonalDetailsInput,
): Prisma.PdsPersonalDetailsUncheckedUpdateInput {
  const data: Prisma.PdsPersonalDetailsUncheckedUpdateInput = {};
  if ('surname' in input) data.surname = text(input.surname);
  if ('firstName' in input) data.firstName = text(input.firstName);
  if ('nameExtension' in input) data.nameExtension = text(input.nameExtension);
  if ('middleName' in input) data.middleName = text(input.middleName);
  if ('birthDate' in input) data.birthDate = input.birthDate ? databaseDate(input.birthDate) : null;
  if ('birthPlace' in input) data.birthPlace = text(input.birthPlace);
  if ('sex' in input) data.sex = input.sex ?? null;
  if ('civilStatus' in input) {
    data.civilStatus = input.civilStatus ?? null;
    if (input.civilStatus !== 'OTHER') data.civilStatusDetail = null;
  }
  if ('civilStatusDetail' in input) data.civilStatusDetail = text(input.civilStatusDetail);
  if ('heightMeters' in input && input.heightMeters !== undefined) {
    data.heightMeters = input.heightMeters === null ? null : new Prisma.Decimal(input.heightMeters);
  }
  if ('weightKilograms' in input && input.weightKilograms !== undefined) {
    data.weightKilograms =
      input.weightKilograms === null ? null : new Prisma.Decimal(input.weightKilograms);
  }
  if ('bloodType' in input) data.bloodType = text(input.bloodType);
  if ('umidIdNumber' in input) data.umidIdNumber = text(input.umidIdNumber);
  if ('pagibigIdNumber' in input) data.pagibigIdNumber = text(input.pagibigIdNumber);
  if ('philhealthNumber' in input) data.philhealthNumber = text(input.philhealthNumber);
  if ('philSysCardNumber' in input) data.philSysCardNumber = text(input.philSysCardNumber);
  if ('tinNumber' in input) data.tinNumber = text(input.tinNumber);
  if ('agencyEmployeeNumber' in input) data.agencyEmployeeNumber = text(input.agencyEmployeeNumber);
  if ('citizenship' in input) {
    data.citizenship = input.citizenship ?? null;
    if (input.citizenship !== 'DUAL_CITIZENSHIP') {
      data.dualCitizenshipType = null;
      data.dualCitizenshipCountry = null;
    }
  }
  if ('dualCitizenshipType' in input) data.dualCitizenshipType = input.dualCitizenshipType ?? null;
  if ('dualCitizenshipCountry' in input)
    data.dualCitizenshipCountry = input.dualCitizenshipCountry ?? null;
  if ('residentialAddress' in input) data.residentialAddress = address(input.residentialAddress);
  if ('permanentAddress' in input) data.permanentAddress = address(input.permanentAddress);
  if ('telephoneNumber' in input) data.telephoneNumber = text(input.telephoneNumber);
  if ('mobileNumber' in input) data.mobileNumber = text(input.mobileNumber);
  if ('emailAddress' in input) data.emailAddress = text(input.emailAddress);
  return data;
}

function familyCreateData(
  agencyId: string,
  pdsVersionId: string,
  input: PdsFamilyInput,
): Prisma.PdsFamilyRecordCreateManyInput[] {
  const records: Prisma.PdsFamilyRecordCreateManyInput[] = [];
  const sequences = new Set<string>();
  const add = (record: Prisma.PdsFamilyRecordCreateManyInput) => {
    const key = `${record.relationshipType}:${record.sequenceNo}`;
    if (sequences.has(key)) {
      throw new PdsServiceError(
        'Family record sequence numbers must be unique within this PDS.',
        400,
        'PDS_FAMILY_SEQUENCE_CONFLICT',
      );
    }
    sequences.add(key);
    records.push(record);
  };

  if (input.spouse) {
    add({
      agencyId,
      pdsVersionId,
      relationshipType: 'SPOUSE',
      sequenceNo: 1,
      fullName: displayName(input.spouse),
      surname: text(input.spouse.surname),
      firstName: text(input.spouse.firstName),
      middleName: text(input.spouse.middleName),
      nameExtension: text(input.spouse.nameExtension),
      occupation: text(input.spouse.occupation),
      employerBusinessName: text(input.spouse.employerBusinessName),
      businessAddress: address(input.spouse.businessAddress),
      telephoneNumber: text(input.spouse.telephoneNumber),
    });
  }
  for (const [index, child] of (input.children ?? []).entries()) {
    add({
      agencyId,
      pdsVersionId,
      relationshipType: 'CHILD',
      sequenceNo: child.sequenceNo ?? index + 1,
      fullName: text(child.fullName),
      birthDate: databaseDate(child.birthDate),
    });
  }
  if (input.father) {
    add({
      agencyId,
      pdsVersionId,
      relationshipType: 'FATHER',
      sequenceNo: 1,
      fullName: displayName(input.father),
      surname: text(input.father.surname),
      firstName: text(input.father.firstName),
      middleName: text(input.father.middleName),
      nameExtension: text(input.father.nameExtension),
    });
  }
  if (input.mother) {
    add({
      agencyId,
      pdsVersionId,
      relationshipType: 'MOTHER',
      sequenceNo: 1,
      fullName: displayName(input.mother),
      surname: text(input.mother.surname),
      firstName: text(input.mother.firstName),
      middleName: text(input.mother.middleName),
    });
  }
  return records;
}

function educationCreateData(
  agencyId: string,
  pdsVersionId: string,
  input: PdsEducationInput,
): Prisma.PdsEducationRecordCreateManyInput[] {
  const records: Prisma.PdsEducationRecordCreateManyInput[] = [];
  const seen = new Set<string>();
  const nextSequence = new Map<string, number>();
  for (const record of input) {
    const sequenceNo = record.sequenceNo ?? (nextSequence.get(record.level) ?? 0) + 1;
    const key = `${record.level}:${sequenceNo}`;
    if (seen.has(key)) {
      throw new PdsServiceError(
        'Education sequence numbers must be unique within each level.',
        400,
        'PDS_EDUCATION_SEQUENCE_CONFLICT',
      );
    }
    seen.add(key);
    nextSequence.set(record.level, Math.max(nextSequence.get(record.level) ?? 0, sequenceNo));
    records.push({
      agencyId,
      pdsVersionId,
      level: record.level,
      sequenceNo,
      schoolName: text(record.schoolName) ?? '',
      degreeCourse: text(record.degreeCourse) ?? '',
      periodOfAttendance: text(record.periodOfAttendance) ?? '',
      highestLevelUnits: text(record.highestLevelUnits) ?? '',
      yearGraduated: record.yearGraduated ?? null,
      honors: text(record.honors) ?? '',
      documentId: record.documentId ?? null,
      documentVersionId: record.documentVersionId ?? null,
    });
  }
  return records;
}

function eligibilityCreateData(
  agencyId: string,
  pdsVersionId: string,
  input: PdsEligibilityInput,
): Prisma.PdsEligibilityRecordCreateManyInput[] {
  const records: Prisma.PdsEligibilityRecordCreateManyInput[] = [];
  const seen = new Set<number>();
  for (const [index, record] of input.entries()) {
    const sequenceNo = record.sequenceNo ?? index + 1;
    if (seen.has(sequenceNo)) {
      throw new PdsServiceError(
        'Eligibility sequence numbers must be unique within this PDS.',
        400,
        'PDS_ELIGIBILITY_SEQUENCE_CONFLICT',
      );
    }
    seen.add(sequenceNo);
    records.push({
      agencyId,
      pdsVersionId,
      sequenceNo,
      eligibilityName: record.eligibilityName,
      rating: ratingText(record.rating),
      examDate: record.examDate ? databaseDate(record.examDate) : null,
      examPlace: text(record.examPlace) ?? '',
      licenseNo: text(record.licenseNo),
      validUntil: record.validUntil ? databaseDate(record.validUntil) : null,
      documentId: record.documentId ?? null,
      documentVersionId: record.documentVersionId ?? null,
    });
  }
  return records;
}

type EvidenceInput = {
  documentId?: string | null | undefined;
  documentVersionId?: string | null | undefined;
};

function sectionSequence(
  value: number | undefined,
  index: number,
  section: string,
  seen: Set<number>,
): number {
  const sequenceNo = value ?? index + 1;
  if (!Number.isSafeInteger(sequenceNo) || sequenceNo < 1 || seen.has(sequenceNo)) {
    throw new PdsServiceError(
      `${section} sequence numbers must be unique positive integers.`,
      400,
      'PDS_SEQUENCE_CONFLICT',
    );
  }
  seen.add(sequenceNo);
  return sequenceNo;
}

function dateValue(value: string | null | undefined): Date | null {
  return value ? databaseDate(value) : null;
}

function decimalValue(value: number | null | undefined): Prisma.Decimal | null {
  return value === null || value === undefined ? null : new Prisma.Decimal(value);
}

function moneyValue(value: number | null | undefined): Prisma.Decimal | null {
  if (value === null || value === undefined) return null;
  if (value > 999999999999.99 || Number(value.toFixed(2)) !== value) {
    throw new PdsServiceError(
      'Monthly salary must be a non-negative amount with no more than two decimal places.',
      400,
      'PDS_WORK_EXPERIENCE_INVALID',
    );
  }
  return new Prisma.Decimal(value);
}

function requiredTextValue(value: string | null | undefined, field: string): string {
  const normalized = text(value);
  if (!normalized) {
    throw new PdsServiceError(`${field} is required.`, 400, 'PDS_WES_ENTRY_INVALID');
  }
  return normalized;
}

function recentDateValue(row: {
  inclusiveFrom: Date | null;
  inclusiveTo: Date | null;
  isCurrent: boolean;
}): number | null {
  if (row.isCurrent) return Number.POSITIVE_INFINITY;
  return (row.inclusiveTo ?? row.inclusiveFrom)?.getTime() ?? null;
}

function workExperienceCreateData(
  agencyId: string,
  pdsVersionId: string,
  rows: readonly PdsWorkExperienceInput[],
): Prisma.PdsWorkExperienceRecordCreateManyInput[] {
  const seen = new Set<number>();
  return rows.map((row, index) => ({
    ...(row.id ? { id: row.id } : {}),
    agencyId,
    pdsVersionId,
    sequenceNo: sectionSequence(row.sequenceNo, index, 'Work experience', seen),
    inclusiveFrom: dateValue(row.inclusiveFrom),
    inclusiveTo: dateValue(row.inclusiveTo),
    positionTitle: text(row.positionTitle),
    departmentAgencyOfficeCompany: text(row.departmentAgencyOfficeCompany),
    monthlySalary: moneyValue(row.monthlySalary),
    salaryGradeStep: text(row.salaryGradeStep),
    appointmentStatus: text(row.appointmentStatus),
    governmentService: row.governmentService ?? null,
    isCurrent: row.isCurrent ?? false,
    documentId: row.documentId ?? null,
    documentVersionId: row.documentVersionId ?? null,
  }));
}

function voluntaryWorkCreateData(
  agencyId: string,
  pdsVersionId: string,
  rows: readonly PdsVoluntaryWorkInput[],
): Prisma.PdsVoluntaryWorkRecordCreateManyInput[] {
  const seen = new Set<number>();
  return rows.map((row, index) => ({
    ...(row.id ? { id: row.id } : {}),
    agencyId,
    pdsVersionId,
    sequenceNo: sectionSequence(row.sequenceNo, index, 'Voluntary work', seen),
    organizationNameAddress: text(row.organizationNameAddress),
    inclusiveFrom: dateValue(row.inclusiveFrom),
    inclusiveTo: dateValue(row.inclusiveTo),
    hours: decimalValue(row.hours),
    positionNatureOfWork: text(row.positionNatureOfWork),
    documentId: row.documentId ?? null,
    documentVersionId: row.documentVersionId ?? null,
  }));
}

function learningDevelopmentCreateData(
  agencyId: string,
  pdsVersionId: string,
  rows: readonly PdsLearningDevelopmentInput[],
): Prisma.PdsLearningDevelopmentRecordCreateManyInput[] {
  const seen = new Set<number>();
  return rows.map((row, index) => ({
    ...(row.id ? { id: row.id } : {}),
    agencyId,
    pdsVersionId,
    sequenceNo: sectionSequence(row.sequenceNo, index, 'Learning and development', seen),
    interventionTitle: text(row.interventionTitle),
    attendanceFrom: dateValue(row.attendanceFrom),
    attendanceTo: dateValue(row.attendanceTo),
    hours: decimalValue(row.hours),
    type: text(row.type),
    conductedSponsoredBy: text(row.conductedSponsoredBy),
    documentId: row.documentId ?? null,
    documentVersionId: row.documentVersionId ?? null,
  }));
}

function personalView(record: PdsRecord['personalDetails']): PdsPersonalDetailsView | null {
  if (!record) return null;
  return {
    surname: record.surname,
    firstName: record.firstName,
    nameExtension: record.nameExtension,
    middleName: record.middleName,
    birthDate: formatDate(record.birthDate),
    birthPlace: record.birthPlace,
    sex: record.sex,
    civilStatus: record.civilStatus,
    civilStatusDetail: record.civilStatusDetail,
    heightMeters: record.heightMeters?.toNumber() ?? null,
    weightKilograms: record.weightKilograms?.toNumber() ?? null,
    bloodType: record.bloodType,
    umidIdNumber: record.umidIdNumber,
    pagibigIdNumber: record.pagibigIdNumber,
    philhealthNumber: record.philhealthNumber,
    philSysCardNumber: record.philSysCardNumber,
    tinNumber: record.tinNumber,
    agencyEmployeeNumber: record.agencyEmployeeNumber,
    citizenship: record.citizenship,
    dualCitizenshipType: record.dualCitizenshipType,
    dualCitizenshipCountry: record.dualCitizenshipCountry,
    residentialAddress: jsonObject(record.residentialAddress),
    permanentAddress: jsonObject(record.permanentAddress),
    telephoneNumber: record.telephoneNumber,
    mobileNumber: record.mobileNumber,
    emailAddress: record.emailAddress,
  };
}

function familyRecordView(record: PdsRecord['familyRecords'][number]): PdsFamilyRecordView {
  return {
    id: record.id,
    relationshipType: record.relationshipType as PdsFamilyRecordView['relationshipType'],
    sequenceNo: record.sequenceNo,
    fullName: record.fullName,
    surname: record.surname,
    firstName: record.firstName,
    middleName: record.middleName,
    nameExtension: record.nameExtension,
    birthDate: formatDate(record.birthDate),
    occupation: record.occupation,
    employerBusinessName: record.employerBusinessName,
    businessAddress: jsonObject(record.businessAddress),
    telephoneNumber: record.telephoneNumber,
  };
}

function familyView(records: PdsRecord['familyRecords']): PdsFamilyView {
  const views = records.map(familyRecordView);
  return {
    spouse: views.find((record) => record.relationshipType === 'SPOUSE') ?? null,
    children: views.filter((record) => record.relationshipType === 'CHILD'),
    father: views.find((record) => record.relationshipType === 'FATHER') ?? null,
    mother: views.find((record) => record.relationshipType === 'MOTHER') ?? null,
  };
}

function educationView(records: PdsRecord['educationRecords']): PdsEducationRecordView[] {
  return [...records].sort(compareEducationRecords).map((record) => ({
    id: record.id,
    level: record.level,
    sequenceNo: record.sequenceNo,
    schoolName: record.schoolName,
    degreeCourse: record.degreeCourse,
    periodOfAttendance: record.periodOfAttendance,
    highestLevelUnits: record.highestLevelUnits,
    yearGraduated: record.yearGraduated,
    honors: record.honors,
    documentId: record.documentId,
    documentVersionId: record.documentVersionId,
  }));
}

function compareEducationRecords(
  left: { level: string; sequenceNo: number },
  right: { level: string; sequenceNo: number },
): number {
  return (
    (PDS_EDUCATION_LEVEL_ORDER.get(left.level as (typeof PDS_EDUCATION_LEVELS)[number]) ??
      Number.MAX_SAFE_INTEGER) -
      (PDS_EDUCATION_LEVEL_ORDER.get(right.level as (typeof PDS_EDUCATION_LEVELS)[number]) ??
        Number.MAX_SAFE_INTEGER) || left.sequenceNo - right.sequenceNo
  );
}

function redactedEducationView(
  records: PdsRedactedRecord['educationRecords'],
): PdsEducationRecordView[] {
  return [...records].sort(compareEducationRecords).map((record) => ({
    id: record.id,
    level: record.level,
    sequenceNo: record.sequenceNo,
    schoolName: record.schoolName,
    degreeCourse: record.degreeCourse,
    periodOfAttendance: record.periodOfAttendance,
    highestLevelUnits: record.highestLevelUnits,
    yearGraduated: record.yearGraduated,
    honors: record.honors,
    documentId: null,
    documentVersionId: null,
  }));
}

function eligibilityView(records: PdsRecord['eligibilityRecords']): PdsEligibilityRecordView[] {
  return records.map((record) => ({
    id: record.id,
    sequenceNo: record.sequenceNo,
    eligibilityName: record.eligibilityName,
    rating: record.rating,
    examDate: formatDate(record.examDate),
    examPlace: record.examPlace,
    licenseNo: record.licenseNo,
    validUntil: formatDate(record.validUntil),
    documentId: record.documentId,
    documentVersionId: record.documentVersionId,
  }));
}

function redactedEligibilityView(
  records: PdsRedactedRecord['eligibilityRecords'],
): PdsEligibilityRecordView[] {
  return records.map((record) => ({
    id: record.id,
    sequenceNo: record.sequenceNo,
    eligibilityName: record.eligibilityName,
    rating: null,
    examDate: formatDate(record.examDate),
    examPlace: record.examPlace,
    licenseNo: null,
    validUntil: null,
    documentId: null,
    documentVersionId: null,
  }));
}

function workExperienceView(
  record: PdsRecord['workExperienceRecords'][number],
): PdsWorkExperienceView {
  return {
    id: record.id,
    sequenceNo: record.sequenceNo,
    inclusiveFrom: formatDate(record.inclusiveFrom),
    inclusiveTo: formatDate(record.inclusiveTo),
    positionTitle: record.positionTitle,
    departmentAgencyOfficeCompany: record.departmentAgencyOfficeCompany,
    monthlySalary: record.monthlySalary?.toNumber() ?? null,
    salaryGradeStep: record.salaryGradeStep,
    appointmentStatus: record.appointmentStatus,
    governmentService: record.governmentService as PdsWorkExperienceView['governmentService'],
    isCurrent: record.isCurrent,
    documentId: record.documentId,
    documentVersionId: record.documentVersionId,
  };
}

function voluntaryWorkView(
  record: PdsRecord['voluntaryWorkRecords'][number],
): PdsVoluntaryWorkView {
  return {
    id: record.id,
    sequenceNo: record.sequenceNo,
    organizationNameAddress: record.organizationNameAddress,
    inclusiveFrom: formatDate(record.inclusiveFrom),
    inclusiveTo: formatDate(record.inclusiveTo),
    hours: record.hours?.toNumber() ?? null,
    positionNatureOfWork: record.positionNatureOfWork,
    documentId: record.documentId,
    documentVersionId: record.documentVersionId,
  };
}

function learningDevelopmentView(
  record: PdsRecord['learningDevelopmentRecords'][number],
): PdsLearningDevelopmentView {
  return {
    id: record.id,
    sequenceNo: record.sequenceNo,
    interventionTitle: record.interventionTitle,
    attendanceFrom: formatDate(record.attendanceFrom),
    attendanceTo: formatDate(record.attendanceTo),
    hours: record.hours?.toNumber() ?? null,
    type: record.type,
    conductedSponsoredBy: record.conductedSponsoredBy,
    documentId: record.documentId,
    documentVersionId: record.documentVersionId,
  };
}

function wesEntryView(
  record: PdsRecord['wesArtifacts'][number]['entries'][number],
): PdsWesEntryView {
  return {
    id: record.id,
    workExperienceId: record.workExperienceId,
    sequenceNo: record.sequenceNo,
    durationText: record.durationText ?? '',
    position: record.position,
    officeUnit: record.officeUnit,
    immediateSupervisor: record.immediateSupervisor,
    agencyOrganizationLocation: record.agencyOrganizationLocation,
    accomplishments: record.accomplishments,
    actualDuties: record.actualDuties,
  };
}

function wesView(record: PdsRecord['wesArtifacts'][number]): PdsWesView {
  return {
    id: record.id,
    contextKey: record.contextKey,
    templateVersion: record.templateVersion,
    status: record.status,
    documentId: record.documentId,
    documentVersionId: record.documentVersionId,
    entries: record.entries.map(wesEntryView),
  };
}

function summary(record: PdsSummaryRecord, fieldScope: PdsFieldScope): PdsVersionSummary {
  return {
    id: record.id,
    employeeId: record.employeeId,
    versionNo: record.versionNo,
    formVersion: record.formVersion,
    asOfDate: formatDate(record.asOfDate) as string,
    status: record.status as PdsVersionState,
    supersedesVersionId: record.supersedesVersionId,
    correctionReason: record.correctionReason,
    createdByMembershipId: record.createdByMembershipId,
    createdAt: formatDateTime(record.createdAt),
    updatedByMembershipId: record.updatedByMembershipId,
    updatedAt: formatDateTime(record.updatedAt),
    rowVersion: record.rowVersion,
    fieldScope,
  };
}

function currentVersion(versions: readonly PdsVersionSummary[]): PdsVersionSummary | null {
  return (
    versions.find((version) => version.status === 'CERTIFIED') ??
    versions.find((version) => version.status !== 'SUPERSEDED') ??
    versions[0] ??
    null
  );
}

function detail(record: PdsRecord, fieldScope: PdsFieldScope): PdsVersionDetail {
  return {
    ...summary(record, fieldScope),
    personal: fieldScope === 'FULL' ? personalView(record.personalDetails) : null,
    family:
      fieldScope === 'FULL'
        ? familyView(record.familyRecords)
        : { spouse: null, children: [], father: null, mother: null },
    education: fieldScope === 'FULL' ? educationView(record.educationRecords) : [],
    eligibility: fieldScope === 'FULL' ? eligibilityView(record.eligibilityRecords) : [],
    workExperience:
      fieldScope === 'FULL' ? record.workExperienceRecords.map(workExperienceView) : [],
    voluntaryWork: fieldScope === 'FULL' ? record.voluntaryWorkRecords.map(voluntaryWorkView) : [],
    learningAndDevelopment:
      fieldScope === 'FULL' ? record.learningDevelopmentRecords.map(learningDevelopmentView) : [],
    wes: fieldScope === 'FULL' ? record.wesArtifacts.map(wesView) : [],
  };
}

function redactedDetail(record: PdsRedactedRecord, fieldScope: PdsFieldScope): PdsVersionDetail {
  return {
    ...summary(record, fieldScope),
    personal: null,
    family: { spouse: null, children: [], father: null, mother: null },
    education: redactedEducationView(record.educationRecords),
    eligibility: redactedEligibilityView(record.eligibilityRecords),
    workExperience: [],
    voluntaryWork: [],
    learningAndDevelopment: [],
    wes: [],
  };
}

function ownerUserId(record: Pick<PdsAccessRecord, 'employee'>): string | null {
  return record.employee.memberships[0]?.userId ?? null;
}

function hasPermissionGrant(context: RequestContext, permission: string): boolean {
  return context.permissions.some((grant) => grant.code === permission);
}

function permissionScope(context: RequestContext, permission: string): 'AGENCY' | 'OWN' | null {
  if (
    context.permissions.some(
      (candidate) => candidate.code === permission && candidate.scopePolicy === 'AGENCY',
    )
  ) {
    return 'AGENCY';
  }
  return context.permissions.some(
    (candidate) => candidate.code === permission && candidate.scopePolicy === 'OWN',
  )
    ? 'OWN'
    : null;
}

function readFieldScope(
  context: RequestContext,
  record: Pick<PdsAccessRecord, 'agencyId' | 'employee'>,
): PdsFieldScope | null {
  if (!hasPermissionGrant(context, 'personnel.pds.read')) return null;
  const owner = ownerUserId(record);
  const accessRecord = {
    agencyId: record.agencyId,
    ...(owner ? { ownerUserId: owner } : {}),
    ...(record.employee.currentServiceSegment
      ? { organizationUnitId: record.employee.currentServiceSegment.organizationUnitId }
      : {}),
  };
  if (!canAccessRecord(context, 'personnel.pds.read', accessRecord)) {
    return null;
  }
  return context.permissions.some(
    (candidate) =>
      candidate.code === 'personnel.pds.read' &&
      (candidate.scopePolicy === 'AGENCY' ||
        (candidate.scopePolicy === 'OWN' && owner === context.userId)),
  )
    ? 'FULL'
    : 'REDACTED';
}

function canAccess(
  context: RequestContext,
  permission: string,
  employeeOwnerUserId: string | null,
): boolean {
  const scope = permissionScope(context, permission);
  return scope === 'AGENCY' || (scope === 'OWN' && employeeOwnerUserId === context.userId);
}

function databaseContext(context: RequestContext, pdsMutation = false) {
  return requestDatabaseContext(context, ...(pdsMutation ? (['pds-mutation'] as const) : []));
}

@Injectable()
export class PdsService {
  constructor(
    @Inject(PDS_AUDIT_WRITER) private readonly auditWriter: PdsAuditWriter,
    @Inject(DocumentsService) private readonly documentsService: DocumentsService,
  ) {}

  private validateQualificationInput(input: PdsCreateInput | PdsUpdateInput): void {
    if (input.education !== undefined) {
      const parsed = pdsEducationSchema.safeParse(input.education);
      if (!parsed.success) {
        throw new PdsServiceError(
          parsed.error.issues[0]?.message ?? 'The PDS education records are invalid.',
          400,
          'PDS_EDUCATION_INVALID',
        );
      }
    }
    if (input.eligibility !== undefined) {
      const parsed = pdsEligibilitySchema.safeParse(input.eligibility);
      if (!parsed.success) {
        throw new PdsServiceError(
          parsed.error.issues[0]?.message ?? 'The PDS eligibility records are invalid.',
          400,
          'PDS_ELIGIBILITY_INVALID',
        );
      }
      for (const record of parsed.data) {
        if (record.examDate && record.examDate > today()) {
          throw new PdsServiceError(
            'The examination or conferment date cannot be in the future.',
            400,
            'PDS_QUALIFICATION_DATE_INVALID',
          );
        }
      }
    }
  }

  private async validateEvidenceLinks(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    records: readonly { documentId?: string | null; documentVersionId?: string | null }[],
  ): Promise<void> {
    const ownWorkflow = permissionScope(context, 'personnel.pds.update') === 'OWN';
    for (const record of records) {
      if (!record.documentId && !record.documentVersionId) continue;
      if (!record.documentId || !record.documentVersionId || !this.documentsService) {
        throw new PdsServiceError(
          'Evidence must reference an exact same-Agency Document Version.',
          400,
          'PDS_EVIDENCE_INVALID',
        );
      }
      const evidenceResult = await this.documentsService.resolveExternalEvidenceInTransaction(
        transaction,
        context,
        {
          documentId: record.documentId,
          versionId: record.documentVersionId,
          allowSensitive:
            ownWorkflow ||
            hasPermission(context, 'documents.evidence.read_sensitive', {
              agencyId: context.agencyId,
            }),
          requirement: ownWorkflow ? 'NOT_VOIDED' : 'FINALIZED_VERSION',
        },
      );
      if (
        evidenceResult.ok === false &&
        (evidenceResult.reason === 'DOCUMENT_NOT_FOUND' ||
          evidenceResult.reason === 'VERSION_NOT_FOUND' ||
          (ownWorkflow && evidenceResult.reason === 'STATUS_INELIGIBLE'))
      ) {
        throw new PdsServiceError(
          'Evidence must reference a finalized same-Agency Document Version.',
          400,
          'PDS_EVIDENCE_INVALID',
        );
      }
      if (ownWorkflow) {
        const ownVersion = await this.documentsService.isVersionCreatedByMembershipInTransaction(
          transaction,
          context,
          record.documentId,
          record.documentVersionId,
          context.membershipId,
        );
        if (!ownVersion) {
          throw new PdsServiceError(
            'Employees may link only their own uploaded evidence.',
            403,
            'PDS_EVIDENCE_FORBIDDEN',
          );
        }
        continue;
      }
      if (!hasPermission(context, 'documents.evidence.read', { agencyId: context.agencyId })) {
        throw new PdsServiceError(
          'The current Agency Membership cannot inspect shared Agency Documents.',
          403,
          'PDS_EVIDENCE_READ_FORBIDDEN',
        );
      }
      if (evidenceResult.ok === false && evidenceResult.reason === 'SENSITIVE_FORBIDDEN') {
        throw new PdsServiceError(
          'The current Agency Membership cannot inspect highly sensitive shared Documents.',
          403,
          'PDS_EVIDENCE_SENSITIVE_FORBIDDEN',
        );
      }
      if (evidenceResult.ok === false && evidenceResult.reason === 'STATUS_INELIGIBLE') {
        throw new PdsServiceError(
          'Evidence must reference a finalized same-Agency Document Version.',
          400,
          'PDS_EVIDENCE_INVALID',
        );
      }
      if (!evidenceResult.ok) throw new Error('Unexpected External Evidence resolution result.');
    }
  }

  private async writeQualificationRows(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    pdsVersionId: string,
    input: PdsCreateInput | PdsUpdateInput,
  ): Promise<void> {
    if (input.education !== undefined) {
      const records = educationCreateData(context.agencyId, pdsVersionId, input.education);
      await this.validateEvidenceLinks(transaction, context, records);
      if (records.length) await transaction.pdsEducationRecord.createMany({ data: records });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'PDS_EDUCATION_UPDATED',
        entityType: 'PdsVersion',
        entityId: pdsVersionId,
        requestId: context.requestId,
        metadata: {
          section: 'education',
          rowCount: records.length,
          evidenceLinkCount: records.filter((record) => record.documentId).length,
        },
      });
    }
    if (input.eligibility !== undefined) {
      const records = eligibilityCreateData(context.agencyId, pdsVersionId, input.eligibility);
      await this.validateEvidenceLinks(transaction, context, records);
      if (records.length) await transaction.pdsEligibilityRecord.createMany({ data: records });
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'PDS_ELIGIBILITY_UPDATED',
        entityType: 'PdsVersion',
        entityId: pdsVersionId,
        requestId: context.requestId,
        metadata: {
          section: 'eligibility',
          rowCount: records.length,
          evidenceLinkCount: records.filter((record) => record.documentId).length,
        },
      });
    }
  }

  async list(context: RequestContext, employeeId: string): Promise<PdsVersionList> {
    this.assertContext(context, 'personnel.pds.read', 'PDS_READ_FORBIDDEN');
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      return this.listInTransaction(transaction, context, employeeId);
    });
  }

  async listOwn(context: RequestContext): Promise<PdsVersionList> {
    this.assertContext(context, 'personnel.pds.read', 'PDS_READ_FORBIDDEN');
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const employeeId = await this.ownEmployeeId(transaction, context);
      if (!employeeId) throw this.notFound();
      return this.listInTransaction(transaction, context, employeeId);
    });
  }

  async findById(context: RequestContext, pdsVersionId: string): Promise<PdsVersionDetail | null> {
    this.assertContext(context, 'personnel.pds.read', 'PDS_READ_FORBIDDEN');
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const summaryRecord = await transaction.pdsVersion.findFirst({
        where: { agencyId: context.agencyId, id: pdsVersionId },
        select: pdsSummaryWithOwnerSelect,
      });
      if (!summaryRecord) return null;
      const fieldScope = readFieldScope(context, summaryRecord);
      if (!fieldScope) return null;
      await this.auditRead(transaction, context, pdsVersionId, fieldScope, 'DETAIL');
      if (fieldScope === 'REDACTED') {
        const record = await transaction.pdsVersion.findFirst({
          where: { agencyId: context.agencyId, id: pdsVersionId },
          select: pdsRedactedSelect,
        });
        return record ? redactedDetail(record, fieldScope) : null;
      }
      const record = await transaction.pdsVersion.findFirst({
        where: { agencyId: context.agencyId, id: pdsVersionId },
        select: pdsSelect,
      });
      return record ? detail(record, fieldScope) : null;
    });
  }

  async create(context: RequestContext, input: PdsCreateInput): Promise<PdsVersionDetail> {
    this.assertContext(context, 'personnel.pds.update', 'PDS_UPDATE_FORBIDDEN');
    this.validateQualificationInput(input);
    return withDatabaseContext(databaseContext(context, true), async (transaction) => {
      const employeeId = input.employeeId ?? (await this.ownEmployeeId(transaction, context));
      if (!employeeId) throw this.employeeRequired();
      await this.lockEmployee(transaction, context.agencyId, employeeId);
      const employee = await transaction.employee.findUnique({
        where: { agencyId_id: { agencyId: context.agencyId, id: employeeId } },
        select: { id: true, memberships: { select: { userId: true } } },
      });
      if (!employee) throw this.notFound();
      if (!canAccess(context, 'personnel.pds.update', employee.memberships[0]?.userId ?? null)) {
        throw this.notFound();
      }
      const existing = await transaction.pdsVersion.findFirst({
        where: { agencyId: context.agencyId, employeeId, status: { in: ['DRAFT', 'RETURNED'] } },
        select: pdsSelect,
      });
      if (existing) return detail(existing, 'FULL');

      const latest = await transaction.pdsVersion.findFirst({
        where: { agencyId: context.agencyId, employeeId },
        orderBy: { versionNo: 'desc' },
        select: { id: true, versionNo: true },
      });
      const created = await transaction.pdsVersion.create({
        data: {
          agencyId: context.agencyId,
          employeeId,
          versionNo: (latest?.versionNo ?? 0) + 1,
          formVersion: PDS_FORM_VERSION,
          asOfDate: databaseDate(input.asOfDate ?? today()),
          status: 'DRAFT',
          supersedesVersionId: latest?.id ?? null,
          createdByMembershipId: context.membershipId,
          updatedByMembershipId: context.membershipId,
        },
        select: { id: true },
      });
      await transaction.pdsPersonalDetails.create({
        data: personalCreateData(context.agencyId, created.id, input.personal),
      });
      if (input.family) {
        const records = familyCreateData(context.agencyId, created.id, input.family);
        if (records.length) await transaction.pdsFamilyRecord.createMany({ data: records });
      }
      await this.writeQualificationRows(transaction, context, created.id, input);
      const workExperience = input.workExperience ?? [];
      for (const row of workExperience) await this.assertEvidence(transaction, context, row);
      if (workExperience.length) {
        await transaction.pdsWorkExperienceRecord.createMany({
          data: workExperienceCreateData(context.agencyId, created.id, workExperience),
        });
      }
      const voluntaryWork = input.voluntaryWork ?? [];
      for (const row of voluntaryWork) await this.assertEvidence(transaction, context, row);
      if (voluntaryWork.length) {
        await transaction.pdsVoluntaryWorkRecord.createMany({
          data: voluntaryWorkCreateData(context.agencyId, created.id, voluntaryWork),
        });
      }
      const learningAndDevelopment = input.learningAndDevelopment ?? [];
      for (const row of learningAndDevelopment)
        await this.assertEvidence(transaction, context, row);
      if (learningAndDevelopment.length) {
        await transaction.pdsLearningDevelopmentRecord.createMany({
          data: learningDevelopmentCreateData(context.agencyId, created.id, learningAndDevelopment),
        });
      }
      const wes = input.wes ?? [];
      const wesResult = await this.createWesArtifacts(
        transaction,
        context,
        created.id,
        employeeId,
        wes,
      );
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'PDS_VERSION_CREATED',
        entityType: 'PdsVersion',
        entityId: created.id,
        previousStatus: 'None',
        newStatus: 'DRAFT',
        requestId: context.requestId,
        metadata: {
          employeeId,
          formVersion: PDS_FORM_VERSION,
          versionNo: (latest?.versionNo ?? 0) + 1,
          asOfDate: input.asOfDate ?? today(),
          workExperienceCount: workExperience.length,
          voluntaryWorkCount: voluntaryWork.length,
          learningAndDevelopmentCount: learningAndDevelopment.length,
          wesArtifactCount: wesResult.artifactCount,
          wesEntryCount: wesResult.entryCount,
        },
      });
      const record = await this.record(transaction, context.agencyId, created.id);
      if (!record) throw this.notFound();
      return detail(record, 'FULL');
    });
  }

  async update(
    context: RequestContext,
    pdsVersionId: string,
    input: PdsUpdateInput,
  ): Promise<PdsVersionDetail> {
    this.assertContext(context, 'personnel.pds.update', 'PDS_UPDATE_FORBIDDEN');
    this.validateQualificationInput(input);
    return withDatabaseContext(databaseContext(context, true), async (transaction) => {
      await this.lockVersion(transaction, context.agencyId, pdsVersionId);
      const existing = await this.record(transaction, context.agencyId, pdsVersionId);
      if (!existing) throw this.notFound();
      if (!canAccess(context, 'personnel.pds.update', ownerUserId(existing))) throw this.notFound();
      if (!['DRAFT', 'RETURNED'].includes(existing.status)) throw this.immutable();
      if (input.rowVersion !== undefined && input.rowVersion !== existing.rowVersion) {
        throw new PdsServiceError(
          'This PDS Draft changed. Reload it before saving.',
          409,
          'PDS_STALE_VERSION',
        );
      }

      const versionData: Prisma.PdsVersionUncheckedUpdateInput = {
        updatedByMembershipId: context.membershipId,
      };
      if (input.asOfDate !== undefined) versionData.asOfDate = databaseDate(input.asOfDate);
      await transaction.pdsVersion.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: pdsVersionId } },
        data: versionData,
      });

      if (input.personal) {
        const currentPersonal = personalView(existing.personalDetails);
        const parsedPersonal = pdsPersonalDetailsSchema.safeParse({
          ...(currentPersonal ?? {}),
          ...input.personal,
        });
        if (!parsedPersonal.success) {
          throw new PdsServiceError(
            parsedPersonal.error.issues[0]?.message ?? 'The PDS personal details are invalid.',
            400,
            'PDS_PERSONAL_INVALID',
          );
        }
        await transaction.pdsPersonalDetails.upsert({
          where: { pdsVersionId },
          create: personalCreateData(context.agencyId, pdsVersionId, input.personal),
          update: personalUpdateData(input.personal),
        });
        await this.auditWriter.write(transaction, {
          agencyId: context.agencyId,
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          actorType: 'USER',
          action: 'PDS_PERSONAL_DETAILS_UPDATED',
          entityType: 'PdsVersion',
          entityId: pdsVersionId,
          previousStatus: existing.status,
          newStatus: existing.status,
          requestId: context.requestId,
          metadata: { section: 'personal', changedFieldCount: Object.keys(input.personal).length },
        });
      }
      if (input.family) {
        await transaction.pdsFamilyRecord.deleteMany({
          where: { agencyId: context.agencyId, pdsVersionId },
        });
        const records = familyCreateData(context.agencyId, pdsVersionId, input.family);
        if (records.length) await transaction.pdsFamilyRecord.createMany({ data: records });
        await this.auditWriter.write(transaction, {
          agencyId: context.agencyId,
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          actorType: 'USER',
          action: 'PDS_FAMILY_DETAILS_UPDATED',
          entityType: 'PdsVersion',
          entityId: pdsVersionId,
          previousStatus: existing.status,
          newStatus: existing.status,
          requestId: context.requestId,
          metadata: {
            section: 'family',
            childCount: input.family.children?.length ?? 0,
            hasSpouse: Boolean(input.family.spouse),
            hasFather: Boolean(input.family.father),
            hasMother: Boolean(input.family.mother),
          },
        });
      }
      if (input.education !== undefined) {
        await transaction.pdsEducationRecord.deleteMany({
          where: { agencyId: context.agencyId, pdsVersionId },
        });
      }
      if (input.eligibility !== undefined) {
        await transaction.pdsEligibilityRecord.deleteMany({
          where: { agencyId: context.agencyId, pdsVersionId },
        });
      }
      await this.writeQualificationRows(transaction, context, pdsVersionId, input);
      const workExperienceChanged = input.workExperience !== undefined;
      let wesInput: readonly PdsWesInput[] | null | undefined = input.wes;
      if (workExperienceChanged && wesInput === undefined && existing.wesArtifacts.length) {
        wesInput = this.preservedWesInput(existing);
      }
      if (workExperienceChanged || wesInput !== undefined) {
        if (existing.wesArtifacts.length) this.assertWesEditable(existing);
        await transaction.pdsWesEntry.deleteMany({
          where: { agencyId: context.agencyId, pdsVersionId },
        });
        await transaction.pdsWesArtifact.deleteMany({
          where: { agencyId: context.agencyId, pdsVersionId },
        });
      }
      if (workExperienceChanged) {
        const result = await this.replaceWorkExperience(
          transaction,
          context,
          pdsVersionId,
          input.workExperience ?? [],
        );
        await this.writeSectionAudit(
          transaction,
          context,
          pdsVersionId,
          existing.status,
          'PDS_WORK_EXPERIENCE_UPDATED',
          { section: 'workExperience', ...result },
        );
      }
      if (input.voluntaryWork !== undefined) {
        const result = await this.replaceVoluntaryWork(
          transaction,
          context,
          pdsVersionId,
          input.voluntaryWork,
        );
        await this.writeSectionAudit(
          transaction,
          context,
          pdsVersionId,
          existing.status,
          'PDS_VOLUNTARY_WORK_UPDATED',
          { section: 'voluntaryWork', ...result },
        );
      }
      if (input.learningAndDevelopment !== undefined) {
        const result = await this.replaceLearningDevelopment(
          transaction,
          context,
          pdsVersionId,
          input.learningAndDevelopment,
        );
        await this.writeSectionAudit(
          transaction,
          context,
          pdsVersionId,
          existing.status,
          'PDS_LEARNING_DEVELOPMENT_UPDATED',
          { section: 'learningAndDevelopment', ...result },
        );
      }
      if (wesInput !== undefined) {
        const result =
          wesInput === null
            ? { artifactCount: 0, entryCount: 0, evidenceCount: 0 }
            : await this.createWesArtifacts(
                transaction,
                context,
                pdsVersionId,
                existing.employeeId,
                wesInput,
              );
        await this.writeSectionAudit(
          transaction,
          context,
          pdsVersionId,
          existing.status,
          'PDS_WES_UPDATED',
          { section: 'wes', ...result },
        );
      }
      const updated = await this.record(transaction, context.agencyId, pdsVersionId);
      if (!updated) throw this.notFound();
      return detail(updated, 'FULL');
    });
  }

  private async assertEvidence(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    input: EvidenceInput,
  ): Promise<void> {
    const documentId = input.documentId ?? null;
    const documentVersionId = input.documentVersionId ?? null;
    if (!documentId && !documentVersionId) return;
    if (!documentId || !documentVersionId) {
      throw new PdsServiceError(
        'An evidence Document and exact Document Version are both required.',
        400,
        'PDS_EVIDENCE_PAIR_INVALID',
      );
    }
    if (!hasPermission(context, 'documents.evidence.read', { agencyId: context.agencyId })) {
      throw new PdsServiceError(
        'The current Agency Membership cannot inspect shared Agency Documents.',
        403,
        'PDS_EVIDENCE_FORBIDDEN',
      );
    }
    const evidenceResult = await this.documentsService.resolveExternalEvidenceInTransaction(
      transaction,
      context,
      {
        documentId,
        versionId: documentVersionId,
        allowSensitive: hasPermission(context, 'documents.evidence.read_sensitive', {
          agencyId: context.agencyId,
        }),
        requirement: 'FINALIZED_VERSION',
      },
    );
    if (
      evidenceResult.ok === false &&
      (evidenceResult.reason === 'DOCUMENT_NOT_FOUND' ||
        evidenceResult.reason === 'VERSION_NOT_FOUND')
    ) {
      throw new PdsServiceError(
        'The selected evidence Document Version could not be found in this Agency.',
        404,
        'PDS_EVIDENCE_NOT_FOUND',
      );
    }
    if (evidenceResult.ok === false && evidenceResult.reason === 'SENSITIVE_FORBIDDEN') {
      throw new PdsServiceError(
        'The current Agency Membership cannot inspect this External Evidence.',
        403,
        'PDS_EVIDENCE_SENSITIVE_FORBIDDEN',
      );
    }
    if (evidenceResult.ok === false && evidenceResult.reason === 'STATUS_INELIGIBLE') {
      throw new PdsServiceError(
        'The selected evidence Document Version is not finalized for PDS linking.',
        400,
        'PDS_EVIDENCE_INELIGIBLE',
      );
    }
    if (!evidenceResult.ok) throw new Error('Unexpected External Evidence resolution result.');
  }

  private async assertSectionIds(
    transaction: Prisma.TransactionClient,
    pdsVersionId: string,
    rows: readonly { id?: string | undefined }[],
    section: string,
    code: string,
    findRows: (ids: string[]) => Promise<ReadonlyArray<{ id: string; pdsVersionId: string }>>,
  ): Promise<void> {
    const ids = rows.flatMap((row) => (row.id ? [row.id] : []));
    if (!ids.length) return;
    if (new Set(ids).size !== ids.length) {
      throw new PdsServiceError(
        `${section} row identifiers must be unique.`,
        400,
        'PDS_ROW_ID_CONFLICT',
      );
    }
    const found = await findRows(ids);
    if (found.length !== ids.length || found.some((row) => row.pdsVersionId !== pdsVersionId)) {
      throw new PdsServiceError(
        `The selected ${section} row does not belong to this PDS Version.`,
        400,
        code,
      );
    }
  }

  private async replaceWorkExperience(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    pdsVersionId: string,
    rows: readonly PdsWorkExperienceInput[],
  ): Promise<{ rowCount: number; evidenceCount: number }> {
    await this.assertSectionIds(
      transaction,
      pdsVersionId,
      rows,
      'work-experience',
      'PDS_WORK_EXPERIENCE_NOT_FOUND',
      (ids) =>
        transaction.pdsWorkExperienceRecord.findMany({
          where: { agencyId: context.agencyId, id: { in: ids } },
          select: { id: true, pdsVersionId: true },
        }),
    );
    for (const row of rows) await this.assertEvidence(transaction, context, row);
    await transaction.pdsWorkExperienceRecord.deleteMany({
      where: { agencyId: context.agencyId, pdsVersionId },
    });
    const data = workExperienceCreateData(context.agencyId, pdsVersionId, rows);
    if (data.length) await transaction.pdsWorkExperienceRecord.createMany({ data });
    return {
      rowCount: data.length,
      evidenceCount: data.filter((row) => Boolean(row.documentId)).length,
    };
  }

  private async replaceVoluntaryWork(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    pdsVersionId: string,
    rows: readonly PdsVoluntaryWorkInput[],
  ): Promise<{ rowCount: number; evidenceCount: number }> {
    await this.assertSectionIds(
      transaction,
      pdsVersionId,
      rows,
      'voluntary-work',
      'PDS_VOLUNTARY_WORK_NOT_FOUND',
      (ids) =>
        transaction.pdsVoluntaryWorkRecord.findMany({
          where: { agencyId: context.agencyId, id: { in: ids } },
          select: { id: true, pdsVersionId: true },
        }),
    );
    for (const row of rows) await this.assertEvidence(transaction, context, row);
    await transaction.pdsVoluntaryWorkRecord.deleteMany({
      where: { agencyId: context.agencyId, pdsVersionId },
    });
    const data = voluntaryWorkCreateData(context.agencyId, pdsVersionId, rows);
    if (data.length) await transaction.pdsVoluntaryWorkRecord.createMany({ data });
    return {
      rowCount: data.length,
      evidenceCount: data.filter((row) => Boolean(row.documentId)).length,
    };
  }

  private async replaceLearningDevelopment(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    pdsVersionId: string,
    rows: readonly PdsLearningDevelopmentInput[],
  ): Promise<{ rowCount: number; evidenceCount: number }> {
    await this.assertSectionIds(
      transaction,
      pdsVersionId,
      rows,
      'learning-and-development',
      'PDS_LEARNING_DEVELOPMENT_NOT_FOUND',
      (ids) =>
        transaction.pdsLearningDevelopmentRecord.findMany({
          where: { agencyId: context.agencyId, id: { in: ids } },
          select: { id: true, pdsVersionId: true },
        }),
    );
    for (const row of rows) await this.assertEvidence(transaction, context, row);
    await transaction.pdsLearningDevelopmentRecord.deleteMany({
      where: { agencyId: context.agencyId, pdsVersionId },
    });
    const data = learningDevelopmentCreateData(context.agencyId, pdsVersionId, rows);
    if (data.length) await transaction.pdsLearningDevelopmentRecord.createMany({ data });
    return {
      rowCount: data.length,
      evidenceCount: data.filter((row) => Boolean(row.documentId)).length,
    };
  }

  private preservedWesInput(record: PdsRecord): PdsWesInput[] {
    return record.wesArtifacts.map((artifact) => ({
      contextKey: artifact.contextKey,
      documentId: artifact.documentId,
      documentVersionId: artifact.documentVersionId,
      entries: artifact.entries.map((entry) => ({
        workExperienceId: entry.workExperienceId,
        sequenceNo: entry.sequenceNo,
        durationText: entry.durationText ?? '',
        position: entry.position,
        officeUnit: entry.officeUnit,
        immediateSupervisor: entry.immediateSupervisor,
        agencyOrganizationLocation: entry.agencyOrganizationLocation,
        accomplishments: entry.accomplishments,
        actualDuties: entry.actualDuties,
      })),
    }));
  }

  private assertWesEditable(record: PdsRecord): void {
    if (record.wesArtifacts.some((artifact) => artifact.status !== 'DRAFT')) {
      throw this.immutable();
    }
  }

  private async createWesArtifacts(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    pdsVersionId: string,
    employeeId: string,
    artifacts: readonly PdsWesInput[],
  ): Promise<{ artifactCount: number; entryCount: number; evidenceCount: number }> {
    if (!artifacts.length) return { artifactCount: 0, entryCount: 0, evidenceCount: 0 };
    const workRows = await transaction.pdsWorkExperienceRecord.findMany({
      where: { agencyId: context.agencyId, pdsVersionId },
      select: {
        id: true,
        sequenceNo: true,
        inclusiveFrom: true,
        inclusiveTo: true,
        isCurrent: true,
      },
    });
    const workIds = new Set(workRows.map((row) => row.id));
    const workBySequence = new Map(workRows.map((row) => [row.sequenceNo, row.id]));
    const workById = new Map(workRows.map((row) => [row.id, row]));
    const contexts = new Set<string>();
    let entryCount = 0;
    let evidenceCount = 0;

    for (const artifact of artifacts) {
      const contextKey =
        artifact.contextKey === null || artifact.contextKey === undefined
          ? 'DEFAULT'
          : text(artifact.contextKey);
      if (!contextKey) {
        throw new PdsServiceError('A WES context key is required.', 400, 'PDS_WES_CONTEXT_INVALID');
      }
      if (contexts.has(contextKey)) {
        throw new PdsServiceError(
          'WES context keys must be unique within this PDS Version.',
          400,
          'PDS_WES_CONTEXT_CONFLICT',
        );
      }
      contexts.add(contextKey);
      await this.assertEvidence(transaction, context, artifact);
      if (artifact.documentId) evidenceCount += 1;

      const entrySequences = new Set<number>();
      const entryParents = new Set<string>();
      let previousLatest: number | null = null;
      const entries = artifact.entries.map((entry, index) => {
        const sequenceNo = sectionSequence(entry.sequenceNo, index, 'WES entry', entrySequences);
        const workExperienceId =
          entry.workExperienceId ??
          (entry.workExperienceSequenceNo === undefined
            ? undefined
            : workBySequence.get(entry.workExperienceSequenceNo));
        if (!workExperienceId || !workIds.has(workExperienceId)) {
          throw new PdsServiceError(
            'Each WES entry must reference a work-experience row in this PDS Version.',
            400,
            'PDS_WES_PARENT_NOT_FOUND',
          );
        }
        const workRow = workById.get(workExperienceId);
        const latest = workRow ? recentDateValue(workRow) : null;
        if (latest !== null && previousLatest !== null && latest > previousLatest) {
          throw new PdsServiceError(
            'WES entries must be ordered from most recent to oldest.',
            400,
            'PDS_WES_ORDER_INVALID',
          );
        }
        if (latest !== null) previousLatest = latest;
        const durationText = requiredTextValue(entry.durationText, 'WES duration');
        if (workRow?.isCurrent && !/\bpresent\b/i.test(durationText)) {
          throw new PdsServiceError(
            'Current WES work must use Present in its duration.',
            400,
            'PDS_WES_DURATION_INVALID',
          );
        }
        if (entryParents.has(workExperienceId)) {
          throw new PdsServiceError(
            'A work-experience row may appear only once in one WES artifact.',
            400,
            'PDS_WES_PARENT_CONFLICT',
          );
        }
        entryParents.add(workExperienceId);
        return {
          sequenceNo,
          workExperienceId,
          durationText,
          position: requiredTextValue(entry.position, 'WES position'),
          officeUnit: requiredTextValue(entry.officeUnit, 'WES office or unit'),
          immediateSupervisor: requiredTextValue(
            entry.immediateSupervisor,
            'WES immediate supervisor',
          ),
          agencyOrganizationLocation: requiredTextValue(
            entry.agencyOrganizationLocation,
            'WES agency, organization, or location',
          ),
          accomplishments: text(entry.accomplishments),
          actualDuties: requiredTextValue(entry.actualDuties, 'WES actual duties'),
        };
      });

      const created = await transaction.pdsWesArtifact.create({
        data: {
          agencyId: context.agencyId,
          employeeId,
          pdsVersionId,
          contextKey,
          templateVersion: PDS_WES_TEMPLATE_VERSION,
          status: 'DRAFT',
          documentId: artifact.documentId ?? null,
          documentVersionId: artifact.documentVersionId ?? null,
        },
        select: { id: true },
      });
      if (entries.length) {
        await transaction.pdsWesEntry.createMany({
          data: entries.map((entry) => ({
            agencyId: context.agencyId,
            wesArtifactId: created.id,
            pdsVersionId,
            workExperienceId: entry.workExperienceId,
            sequenceNo: entry.sequenceNo,
            durationText: entry.durationText,
            position: entry.position,
            officeUnit: entry.officeUnit,
            immediateSupervisor: entry.immediateSupervisor,
            agencyOrganizationLocation: entry.agencyOrganizationLocation,
            accomplishments: entry.accomplishments,
            actualDuties: entry.actualDuties,
          })),
        });
      }
      entryCount += entries.length;
    }
    return { artifactCount: artifacts.length, entryCount, evidenceCount };
  }

  private async writeSectionAudit(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    pdsVersionId: string,
    status: string,
    action: string,
    metadata: Prisma.InputJsonObject,
  ): Promise<void> {
    await this.auditWriter.write(transaction, {
      agencyId: context.agencyId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      actorType: 'USER',
      action,
      entityType: 'PdsVersion',
      entityId: pdsVersionId,
      previousStatus: status,
      newStatus: status,
      requestId: context.requestId,
      metadata,
    });
  }

  private async record(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    id: string,
  ): Promise<PdsRecord | null> {
    return transaction.pdsVersion.findFirst({ where: { agencyId, id }, select: pdsSelect });
  }

  private async auditRead(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    entityId: string,
    fieldScope: PdsFieldScope,
    access: 'LIST' | 'DETAIL',
    versionCount?: number,
    entityType = 'PdsVersion',
  ): Promise<void> {
    await this.auditWriter.write(transaction, {
      agencyId: context.agencyId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      actorType: 'USER',
      action: access === 'LIST' ? 'PDS_VERSIONS_READ' : 'PDS_VERSION_READ',
      entityType,
      entityId,
      requestId: context.requestId,
      metadata: {
        access,
        fieldScope,
        ...(versionCount === undefined ? {} : { versionCount }),
      },
    });
  }

  private async listInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    employeeId: string,
  ): Promise<PdsVersionList> {
    const employee = await transaction.employee.findUnique({
      where: { agencyId_id: { agencyId: context.agencyId, id: employeeId } },
      select: {
        id: true,
        memberships: { select: { userId: true } },
        currentServiceSegment: { select: { organizationUnitId: true } },
      },
    });
    if (!employee) throw this.notFound();
    const fieldScope = readFieldScope(context, {
      agencyId: context.agencyId,
      employee,
    });
    if (!fieldScope) throw this.notFound();
    const records = await transaction.pdsVersion.findMany({
      where: { agencyId: context.agencyId, employeeId },
      orderBy: { versionNo: 'desc' },
      take: PDS_VERSION_LIST_LIMIT,
      select: pdsSummarySelect,
    });
    const versions = records.map((record) => summary(record, fieldScope));
    if (records.length) {
      await this.auditRead(
        transaction,
        context,
        employeeId,
        fieldScope,
        'LIST',
        records.length,
        'Employee',
      );
    }
    return {
      employeeId,
      citizenshipCountries: PDS_CITIZENSHIP_COUNTRIES,
      current: currentVersion(versions),
      draft: versions.find((version) => ['DRAFT', 'RETURNED'].includes(version.status)) ?? null,
      versions,
    };
  }

  private async ownEmployeeId(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
  ): Promise<string | null> {
    const membership = await transaction.agencyMembership.findUnique({
      where: { agencyId_id: { agencyId: context.agencyId, id: context.membershipId } },
      select: { userId: true, employeeId: true },
    });
    return membership && membership.userId === context.userId
      ? (membership.employeeId ?? null)
      : null;
  }

  private async lockEmployee(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    employeeId: string,
  ): Promise<void> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "employees" WHERE "agency_id" = CAST(${agencyId} AS uuid) AND "id" = CAST(${employeeId} AS uuid) FOR UPDATE`,
    );
    if (rows.length !== 1) throw this.notFound();
  }

  private async lockVersion(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    versionId: string,
  ): Promise<void> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "pds_versions" WHERE "agency_id" = CAST(${agencyId} AS uuid) AND "id" = CAST(${versionId} AS uuid) FOR UPDATE`,
    );
    if (rows.length !== 1) throw this.notFound();
  }

  private assertContext(context: RequestContext, permission: string, code: string): void {
    if (
      !context.agencyId ||
      !context.userId ||
      !context.membershipId ||
      !hasPermissionGrant(context, permission)
    ) {
      throw new PdsServiceError(
        'The current Agency Membership lacks the required PDS permission.',
        403,
        code,
      );
    }
  }

  private notFound(): PdsServiceError {
    return new PdsServiceError('The PDS Version could not be found.', 404, 'PDS_NOT_FOUND');
  }

  private employeeRequired(): PdsServiceError {
    return new PdsServiceError(
      'Select an Employee or link the current Membership to an Employee.',
      400,
      'PDS_EMPLOYEE_REQUIRED',
    );
  }

  private immutable(): PdsServiceError {
    return new PdsServiceError(
      'Submitted, certified, or superseded PDS Versions cannot be edited.',
      409,
      'PDS_VERSION_IMMUTABLE',
    );
  }
}
