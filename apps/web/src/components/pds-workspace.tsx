'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from './ui/button';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog';
import {
  EmployeeInitials,
  EmployeePageTitle,
  employeeInputClass,
  employeeLabelClass,
  formatEmployeeDate,
  titleCase,
} from './employee-directory';

export interface PdsVersionSummaryData {
  id: string;
  employeeId: string;
  versionNo: number;
  formVersion: string;
  asOfDate: string;
  status: string;
  supersedesVersionId: string | null;
  correctionReason: string | null;
  createdByMembershipId: string;
  createdAt: string;
  updatedByMembershipId: string;
  updatedAt: string;
  rowVersion: number;
  fieldScope: 'FULL' | 'REDACTED';
}

export interface PdsVersionListData {
  employeeId: string;
  citizenshipCountries: readonly string[];
  current: PdsVersionSummaryData | null;
  draft: PdsVersionSummaryData | null;
  versions: PdsVersionSummaryData[];
}

interface PdsAddressData {
  houseBlockLotNo: string | null;
  street: string | null;
  subdivisionVillage: string | null;
  barangay: string | null;
  cityMunicipality: string | null;
  province: string | null;
  zipCode: string | null;
}

interface PdsPersonalData {
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
  residentialAddress: PdsAddressData | null;
  permanentAddress: PdsAddressData | null;
  telephoneNumber: string | null;
  mobileNumber: string | null;
  emailAddress: string | null;
}

interface PdsFamilyRecordData {
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
  businessAddress: PdsAddressData | null;
  telephoneNumber: string | null;
}

interface PdsFamilyData {
  spouse: PdsFamilyRecordData | null;
  children: PdsFamilyRecordData[];
  father: PdsFamilyRecordData | null;
  mother: PdsFamilyRecordData | null;
}

interface PdsEvidenceData {
  documentId: string | null;
  documentVersionId: string | null;
}

interface PdsEvidenceOption {
  documentId: string;
  documentNo: string | null;
  documentType: string;
  version: { id: string; versionNo: number };
}

interface PdsEducationRecordData {
  id?: string;
  sequenceNo: number;
  level: string | null;
  schoolName: string | null;
  degreeCourse: string | null;
  periodOfAttendance: string | null;
  highestLevelUnits: string | null;
  yearGraduated: number | null;
  honors: string | null;
  documentId: string | null;
  documentVersionId: string | null;
}

interface PdsEligibilityRecordData {
  id?: string;
  sequenceNo: number;
  eligibilityName: string | null;
  rating: string | null;
  examDate: string | null;
  examPlace: string | null;
  licenseNo: string | null;
  validUntil: string | null;
  documentId: string | null;
  documentVersionId: string | null;
}

interface PdsWorkExperienceData extends PdsEvidenceData {
  id?: string;
  sequenceNo: number;
  inclusiveFrom: string | null;
  inclusiveTo: string | null;
  positionTitle: string | null;
  departmentAgencyOfficeCompany: string | null;
  monthlySalary: number | null;
  salaryGradeStep: string | null;
  appointmentStatus: string | null;
  governmentService: 'Y' | 'N' | null;
  isCurrent?: boolean;
}

interface PdsVoluntaryWorkData extends PdsEvidenceData {
  id?: string;
  sequenceNo: number;
  organizationNameAddress: string | null;
  inclusiveFrom: string | null;
  inclusiveTo: string | null;
  hours: number | null;
  positionNatureOfWork: string | null;
}

interface PdsLearningDevelopmentData extends PdsEvidenceData {
  id?: string;
  sequenceNo: number;
  interventionTitle: string | null;
  attendanceFrom: string | null;
  attendanceTo: string | null;
  hours: number | null;
  type: string | null;
  conductedSponsoredBy: string | null;
}

interface PdsWesEntryData {
  id?: string;
  workExperienceId?: string;
  workExperienceSequenceNo?: number;
  sequenceNo: number;
  durationText: string;
  position: string | null;
  officeUnit: string | null;
  immediateSupervisor: string | null;
  agencyOrganizationLocation: string | null;
  accomplishments: string | null;
  actualDuties: string | null;
}

interface PdsWesData extends PdsEvidenceData {
  id?: string;
  contextKey: string | null;
  entries: PdsWesEntryData[];
}

export interface PdsDetailData extends PdsVersionSummaryData {
  personal: PdsPersonalData | null;
  family: PdsFamilyData;
  education?: PdsEducationRecordData[];
  eligibility?: PdsEligibilityRecordData[];
  workExperience?: PdsWorkExperienceData[];
  voluntaryWork?: PdsVoluntaryWorkData[];
  learningAndDevelopment?: PdsLearningDevelopmentData[];
  wes?: PdsWesData[] | null;
}

interface PdsDetailSections {
  workExperience: PdsWorkExperienceData[];
  voluntaryWork: PdsVoluntaryWorkData[];
  learningAndDevelopment: PdsLearningDevelopmentData[];
  wes: PdsWesData[];
}

interface AddressForm {
  houseBlockLotNo: string;
  street: string;
  subdivisionVillage: string;
  barangay: string;
  cityMunicipality: string;
  province: string;
  zipCode: string;
}

interface NameForm {
  surname: string;
  firstName: string;
  middleName: string;
  nameExtension: string;
}

interface EvidenceForm {
  documentId: string;
  documentVersionId: string;
}

interface SpouseForm extends NameForm {
  occupation: string;
  employerBusinessName: string;
  businessAddress: AddressForm;
  telephoneNumber: string;
}

interface ChildForm {
  uiKey: string;
  fullName: string;
  birthDate: string;
}

interface WorkExperienceForm extends EvidenceForm {
  uiKey: string;
  id: string;
  inclusiveFrom: string;
  inclusiveTo: string;
  positionTitle: string;
  departmentAgencyOfficeCompany: string;
  monthlySalary: string;
  salaryGradeStep: string;
  appointmentStatus: string;
  governmentService: string;
  isCurrent: boolean;
}

interface VoluntaryWorkForm extends EvidenceForm {
  uiKey: string;
  id: string;
  organizationNameAddress: string;
  inclusiveFrom: string;
  inclusiveTo: string;
  hours: string;
  positionNatureOfWork: string;
}

interface LearningDevelopmentForm extends EvidenceForm {
  uiKey: string;
  id: string;
  interventionTitle: string;
  attendanceFrom: string;
  attendanceTo: string;
  hours: string;
  type: string;
  conductedSponsoredBy: string;
}

interface WesEntryForm {
  uiKey: string;
  id: string;
  workExperienceKey: string;
  durationText: string;
  position: string;
  officeUnit: string;
  immediateSupervisor: string;
  agencyOrganizationLocation: string;
  accomplishments: string;
  actualDuties: string;
}

interface WesForm extends EvidenceForm {
  uiKey: string;
  id: string;
  contextKey: string;
  entries: WesEntryForm[];
}

interface EducationForm {
  level: string;
  schoolName: string;
  degreeCourse: string;
  periodOfAttendance: string;
  highestLevelUnits: string;
  yearGraduated: string;
  honors: string;
  documentId: string;
  documentVersionId: string;
}

interface EligibilityForm {
  eligibilityName: string;
  rating: string;
  examDate: string;
  examPlace: string;
  licenseNo: string;
  validUntil: string;
  documentId: string;
  documentVersionId: string;
}

interface PersonalForm {
  surname: string;
  firstName: string;
  nameExtension: string;
  middleName: string;
  birthDate: string;
  birthPlace: string;
  sex: string;
  civilStatus: string;
  civilStatusDetail: string;
  heightMeters: string;
  weightKilograms: string;
  bloodType: string;
  umidIdNumber: string;
  pagibigIdNumber: string;
  philhealthNumber: string;
  philSysCardNumber: string;
  tinNumber: string;
  agencyEmployeeNumber: string;
  citizenship: string;
  dualCitizenshipType: string;
  dualCitizenshipCountry: string;
  residentialAddress: AddressForm;
  permanentAddress: AddressForm;
  telephoneNumber: string;
  mobileNumber: string;
  emailAddress: string;
}

interface PdsForm {
  asOfDate: string;
  personal: PersonalForm;
  spouse: SpouseForm;
  children: ChildForm[];
  father: NameForm;
  mother: NameForm;
  education: EducationForm[];
  eligibility: EligibilityForm[];
  workExperience: WorkExperienceForm[];
  voluntaryWork: VoluntaryWorkForm[];
  learningAndDevelopment: LearningDevelopmentForm[];
  wes: WesForm[];
}

interface ErrorEnvelope {
  error?: { message?: string; fields?: Record<string, string> };
}

const addressFields = [
  ['houseBlockLotNo', 'House / block / lot no.'],
  ['street', 'Street'],
  ['subdivisionVillage', 'Subdivision / village'],
  ['barangay', 'Barangay'],
  ['cityMunicipality', 'City / municipality'],
  ['province', 'Province'],
  ['zipCode', 'ZIP code'],
] as const satisfies readonly [keyof AddressForm, string][];

const nameFields = [
  ['surname', 'Surname'],
  ['firstName', 'First name'],
  ['middleName', 'Middle name'],
  ['nameExtension', 'Name extension'],
] as const satisfies readonly [keyof NameForm, string][];

const personalTextFields = [
  ['surname', 'Surname'],
  ['firstName', 'First name'],
  ['middleName', 'Middle name'],
  ['nameExtension', 'Name extension'],
  ['birthPlace', 'Place of birth'],
  ['bloodType', 'Blood type'],
  ['umidIdNumber', 'UMID ID no.'],
  ['pagibigIdNumber', 'Pag-IBIG ID no.'],
  ['philhealthNumber', 'PhilHealth no.'],
  ['philSysCardNumber', 'PhilSys PCN'],
  ['tinNumber', 'TIN'],
  ['agencyEmployeeNumber', 'Agency employee no.'],
  ['telephoneNumber', 'Telephone'],
  ['mobileNumber', 'Mobile'],
  ['emailAddress', 'Email address'],
] as const satisfies readonly [keyof PersonalForm, string][];

const workExperienceOptions = [
  ['Y', 'Yes'],
  ['N', 'No'],
] as const satisfies readonly (readonly [string, string])[];

let rowKeySeed = 0;

function createRowKey(prefix: string): string {
  rowKeySeed += 1;
  return `${prefix}-${rowKeySeed}`;
}

const educationLevelOptions = [
  ['ELEMENTARY', 'Elementary'],
  ['SECONDARY', 'Secondary'],
  ['VOCATIONAL_TRADE', 'Vocational / trade course'],
  ['COLLEGE', 'College'],
  ['GRADUATE_STUDIES', 'Graduate studies'],
] as const;

const eligibilityCategoryOptions = [
  'Career Service',
  'RA 1080 (Board/Bar)',
  'Under Special Laws',
  'CES/CSEE',
  'Barangay Eligibility',
  "Driver's License",
] as const;

function today(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function stringValue(value: string | number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}

function parsePdsEvidenceOptions(value: unknown): PdsEvidenceOption[] {
  if (
    !value ||
    typeof value !== 'object' ||
    !Array.isArray((value as { documents?: unknown }).documents)
  ) {
    throw new Error('The Agency Document response was invalid.');
  }
  return (value as { documents: PdsEvidenceOption[] }).documents;
}

function optionalId(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

function optionalIdPayload(value: string): { id?: string } {
  const id = optionalId(value);
  return id ? { id } : {};
}

function numberValue(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function addressForm(value: PdsAddressData | null | undefined): AddressForm {
  return {
    houseBlockLotNo: stringValue(value?.houseBlockLotNo),
    street: stringValue(value?.street),
    subdivisionVillage: stringValue(value?.subdivisionVillage),
    barangay: stringValue(value?.barangay),
    cityMunicipality: stringValue(value?.cityMunicipality),
    province: stringValue(value?.province),
    zipCode: stringValue(value?.zipCode),
  };
}

function blankAddress(): AddressForm {
  return {
    houseBlockLotNo: '',
    street: '',
    subdivisionVillage: '',
    barangay: '',
    cityMunicipality: '',
    province: '',
    zipCode: '',
  };
}

function blankName(): NameForm {
  return { surname: '', firstName: '', middleName: '', nameExtension: '' };
}

function blankEvidence(): EvidenceForm {
  return { documentId: '', documentVersionId: '' };
}

function blankSpouse(): SpouseForm {
  return {
    ...blankName(),
    occupation: '',
    employerBusinessName: '',
    businessAddress: blankAddress(),
    telephoneNumber: '',
  };
}

function blankPersonal(): PersonalForm {
  return {
    surname: '',
    firstName: '',
    nameExtension: '',
    middleName: '',
    birthDate: '',
    birthPlace: '',
    sex: '',
    civilStatus: '',
    civilStatusDetail: '',
    heightMeters: '',
    weightKilograms: '',
    bloodType: '',
    umidIdNumber: '',
    pagibigIdNumber: '',
    philhealthNumber: '',
    philSysCardNumber: '',
    tinNumber: '',
    agencyEmployeeNumber: '',
    citizenship: '',
    dualCitizenshipType: '',
    dualCitizenshipCountry: '',
    residentialAddress: blankAddress(),
    permanentAddress: blankAddress(),
    telephoneNumber: '',
    mobileNumber: '',
    emailAddress: '',
  };
}

function blankChild(): ChildForm {
  return { uiKey: createRowKey('child'), fullName: '', birthDate: '' };
}

function blankWorkExperience(): WorkExperienceForm {
  return {
    uiKey: createRowKey('work'),
    id: '',
    inclusiveFrom: '',
    inclusiveTo: '',
    positionTitle: '',
    departmentAgencyOfficeCompany: '',
    monthlySalary: '',
    salaryGradeStep: '',
    appointmentStatus: '',
    governmentService: '',
    isCurrent: false,
    ...blankEvidence(),
  };
}

function blankVoluntaryWork(): VoluntaryWorkForm {
  return {
    uiKey: createRowKey('voluntary'),
    id: '',
    organizationNameAddress: '',
    inclusiveFrom: '',
    inclusiveTo: '',
    hours: '',
    positionNatureOfWork: '',
    ...blankEvidence(),
  };
}

function blankLearningDevelopment(): LearningDevelopmentForm {
  return {
    uiKey: createRowKey('learning'),
    id: '',
    interventionTitle: '',
    attendanceFrom: '',
    attendanceTo: '',
    hours: '',
    type: '',
    conductedSponsoredBy: '',
    ...blankEvidence(),
  };
}

function blankWesEntry(): WesEntryForm {
  return {
    uiKey: createRowKey('wes-entry'),
    id: '',
    workExperienceKey: '',
    durationText: '',
    position: '',
    officeUnit: '',
    immediateSupervisor: '',
    agencyOrganizationLocation: '',
    accomplishments: '',
    actualDuties: '',
  };
}

function blankWes(): WesForm {
  return {
    uiKey: createRowKey('wes'),
    id: '',
    contextKey: '',
    entries: [blankWesEntry()],
    ...blankEvidence(),
  };
}

function evidencePayload(value: EvidenceForm) {
  return {
    documentId: nullable(value.documentId),
    documentVersionId: nullable(value.documentVersionId),
  };
}

function addressPayload(value: AddressForm): PdsAddressData {
  return Object.fromEntries(
    addressFields.map(([key]) => [key, nullable(value[key])]),
  ) as unknown as PdsAddressData;
}

function namePayload(value: NameForm, includeNameExtension = true) {
  return {
    surname: nullable(value.surname),
    firstName: nullable(value.firstName),
    middleName: nullable(value.middleName),
    ...(includeNameExtension ? { nameExtension: nullable(value.nameExtension) } : {}),
  };
}

function updateAt<T>(items: readonly T[], index: number, updater: (item: T) => T): T[] {
  return items.map((item, itemIndex) => (itemIndex === index ? updater(item) : item));
}

function removeAt<T>(items: readonly T[], index: number): T[] {
  return items.filter((_, itemIndex) => itemIndex !== index);
}

function moveAt<T>(items: readonly T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (target < 0 || target >= items.length) return [...items];
  const next = [...items];
  const [item] = next.splice(index, 1);
  if (!item) return [...items];
  next.splice(target, 0, item);
  return next;
}

function sequenceLabel(from: string, to: string, isCurrent = false): string {
  if (isCurrent) {
    if (from) return `${formatEmployeeDate(from)} to Present`;
    return 'Present';
  }
  if (from && to) return `${formatEmployeeDate(from)} to ${formatEmployeeDate(to)}`;
  if (from) return formatEmployeeDate(from);
  if (to) return formatEmployeeDate(to);
  return 'Not provided';
}

function workExperienceLabel(row: WorkExperienceForm, index: number): string {
  const position = nullable(row.positionTitle);
  const office = nullable(row.departmentAgencyOfficeCompany);
  const duration =
    row.inclusiveFrom || row.inclusiveTo || row.isCurrent
      ? sequenceLabel(row.inclusiveFrom, row.inclusiveTo, row.isCurrent)
      : null;
  return [position, office, duration].filter(Boolean).join(' · ') || `Work experience ${index + 1}`;
}

function workKeyMaps(
  rows: readonly WorkExperienceForm[],
  sourceRows: readonly PdsWorkExperienceData[] = [],
) {
  const byId = new Map<string, string>();
  const bySequence = new Map<number, string>();
  rows.forEach((row, index) => {
    const id = optionalId(row.id);
    if (id) byId.set(id, row.uiKey);
    bySequence.set(sourceRows[index]?.sequenceNo ?? index + 1, row.uiKey);
  });
  return { byId, bySequence };
}

function blankEducation(): EducationForm {
  return {
    level: '',
    schoolName: '',
    degreeCourse: '',
    periodOfAttendance: '',
    highestLevelUnits: '',
    yearGraduated: '',
    honors: '',
    documentId: '',
    documentVersionId: '',
  };
}

function blankEligibility(): EligibilityForm {
  return {
    eligibilityName: '',
    rating: '',
    examDate: '',
    examPlace: '',
    licenseNo: '',
    validUntil: '',
    documentId: '',
    documentVersionId: '',
  };
}

function moveRow<T>(rows: T[], index: number, offset: -1 | 1): T[] {
  const target = index + offset;
  if (target < 0 || target >= rows.length) return rows;
  const next = [...rows];
  const [row] = next.splice(index, 1);
  if (row === undefined) return rows;
  next.splice(target, 0, row);
  return next;
}

function formFromDetail(detail: PdsDetailData | null): PdsForm {
  const workExperience = (detail?.workExperience ?? []).map((row) => ({
    uiKey: createRowKey('work'),
    id: row.id ?? '',
    inclusiveFrom: stringValue(row.inclusiveFrom),
    inclusiveTo: stringValue(row.inclusiveTo),
    positionTitle: stringValue(row.positionTitle),
    departmentAgencyOfficeCompany: stringValue(row.departmentAgencyOfficeCompany),
    monthlySalary: stringValue(row.monthlySalary),
    salaryGradeStep: stringValue(row.salaryGradeStep),
    appointmentStatus: stringValue(row.appointmentStatus),
    governmentService: stringValue(row.governmentService),
    isCurrent: Boolean(row.isCurrent),
    documentId: stringValue(row.documentId),
    documentVersionId: stringValue(row.documentVersionId),
  }));
  const workKeys = workKeyMaps(workExperience, detail?.workExperience ?? []);
  const personal = detail?.personal;

  return {
    asOfDate: detail?.asOfDate ?? today(),
    personal: {
      ...blankPersonal(),
      surname: stringValue(personal?.surname),
      firstName: stringValue(personal?.firstName),
      nameExtension: stringValue(personal?.nameExtension),
      middleName: stringValue(personal?.middleName),
      birthDate: stringValue(personal?.birthDate),
      birthPlace: stringValue(personal?.birthPlace),
      sex: stringValue(personal?.sex),
      civilStatus: stringValue(personal?.civilStatus),
      civilStatusDetail: stringValue(personal?.civilStatusDetail),
      heightMeters: stringValue(personal?.heightMeters),
      weightKilograms: stringValue(personal?.weightKilograms),
      bloodType: stringValue(personal?.bloodType),
      umidIdNumber: stringValue(personal?.umidIdNumber),
      pagibigIdNumber: stringValue(personal?.pagibigIdNumber),
      philhealthNumber: stringValue(personal?.philhealthNumber),
      philSysCardNumber: stringValue(personal?.philSysCardNumber),
      tinNumber: stringValue(personal?.tinNumber),
      agencyEmployeeNumber: stringValue(personal?.agencyEmployeeNumber),
      citizenship: stringValue(personal?.citizenship),
      dualCitizenshipType: stringValue(personal?.dualCitizenshipType),
      dualCitizenshipCountry: stringValue(personal?.dualCitizenshipCountry),
      residentialAddress: addressForm(personal?.residentialAddress),
      permanentAddress: addressForm(personal?.permanentAddress),
      telephoneNumber: stringValue(personal?.telephoneNumber),
      mobileNumber: stringValue(personal?.mobileNumber),
      emailAddress: stringValue(personal?.emailAddress),
    },
    spouse: detail?.family.spouse
      ? {
          ...blankSpouse(),
          surname: stringValue(detail.family.spouse.surname),
          firstName: stringValue(detail.family.spouse.firstName),
          middleName: stringValue(detail.family.spouse.middleName),
          nameExtension: stringValue(detail.family.spouse.nameExtension),
          occupation: stringValue(detail.family.spouse.occupation),
          employerBusinessName: stringValue(detail.family.spouse.employerBusinessName),
          businessAddress: addressForm(detail.family.spouse.businessAddress),
          telephoneNumber: stringValue(detail.family.spouse.telephoneNumber),
        }
      : blankSpouse(),
    children:
      detail?.family.children.map((child) => ({
        uiKey: createRowKey('child'),
        fullName: stringValue(child.fullName),
        birthDate: stringValue(child.birthDate),
      })) ?? [],
    father: detail?.family.father
      ? {
          surname: stringValue(detail.family.father.surname),
          firstName: stringValue(detail.family.father.firstName),
          middleName: stringValue(detail.family.father.middleName),
          nameExtension: stringValue(detail.family.father.nameExtension),
        }
      : blankName(),
    mother: detail?.family.mother
      ? {
          surname: stringValue(detail.family.mother.surname),
          firstName: stringValue(detail.family.mother.firstName),
          middleName: stringValue(detail.family.mother.middleName),
          nameExtension: stringValue(detail.family.mother.nameExtension),
        }
      : blankName(),
    education:
      detail?.education?.map((record) => ({
        level: stringValue(record.level),
        schoolName: stringValue(record.schoolName),
        degreeCourse: stringValue(record.degreeCourse),
        periodOfAttendance: stringValue(record.periodOfAttendance),
        highestLevelUnits: stringValue(record.highestLevelUnits),
        yearGraduated: stringValue(record.yearGraduated),
        honors: stringValue(record.honors),
        documentId: stringValue(record.documentId),
        documentVersionId: stringValue(record.documentVersionId),
      })) ?? [],
    eligibility:
      detail?.eligibility?.map((record) => ({
        eligibilityName: stringValue(record.eligibilityName),
        rating: stringValue(record.rating),
        examDate: stringValue(record.examDate),
        examPlace: stringValue(record.examPlace),
        licenseNo: stringValue(record.licenseNo),
        validUntil: stringValue(record.validUntil),
        documentId: stringValue(record.documentId),
        documentVersionId: stringValue(record.documentVersionId),
      })) ?? [],
    workExperience,
    voluntaryWork: (detail?.voluntaryWork ?? []).map((row) => ({
      uiKey: createRowKey('voluntary'),
      id: row.id ?? '',
      organizationNameAddress: stringValue(row.organizationNameAddress),
      inclusiveFrom: stringValue(row.inclusiveFrom),
      inclusiveTo: stringValue(row.inclusiveTo),
      hours: stringValue(row.hours),
      positionNatureOfWork: stringValue(row.positionNatureOfWork),
      documentId: stringValue(row.documentId),
      documentVersionId: stringValue(row.documentVersionId),
    })),
    learningAndDevelopment: (detail?.learningAndDevelopment ?? []).map((row) => ({
      uiKey: createRowKey('learning'),
      id: row.id ?? '',
      interventionTitle: stringValue(row.interventionTitle),
      attendanceFrom: stringValue(row.attendanceFrom),
      attendanceTo: stringValue(row.attendanceTo),
      hours: stringValue(row.hours),
      type: stringValue(row.type),
      conductedSponsoredBy: stringValue(row.conductedSponsoredBy),
      documentId: stringValue(row.documentId),
      documentVersionId: stringValue(row.documentVersionId),
    })),
    wes: (detail?.wes ?? []).map((artifact) => ({
      uiKey: createRowKey('wes'),
      id: artifact.id ?? '',
      contextKey: stringValue(artifact.contextKey),
      documentId: stringValue(artifact.documentId),
      documentVersionId: stringValue(artifact.documentVersionId),
      entries: artifact.entries.map((entry) => ({
        uiKey: createRowKey('wes-entry'),
        id: entry.id ?? '',
        workExperienceKey:
          (entry.workExperienceId ? workKeys.byId.get(entry.workExperienceId) : undefined) ??
          (entry.workExperienceSequenceNo
            ? workKeys.bySequence.get(entry.workExperienceSequenceNo)
            : undefined) ??
          '',
        durationText: stringValue(entry.durationText),
        position: stringValue(entry.position),
        officeUnit: stringValue(entry.officeUnit),
        immediateSupervisor: stringValue(entry.immediateSupervisor),
        agencyOrganizationLocation: stringValue(entry.agencyOrganizationLocation),
        accomplishments: stringValue(entry.accomplishments),
        actualDuties: stringValue(entry.actualDuties),
      })),
    })),
  };
}

function educationPayload(records: EducationForm[]) {
  const nextSequence = new Map<string, number>();
  return records.map((record, index) => {
    const sequenceNo = nextSequence.get(record.level) ?? 0;
    if (record.level) nextSequence.set(record.level, sequenceNo + 1);
    return {
      sequenceNo: record.level ? sequenceNo + 1 : index + 1,
      level: record.level || null,
      schoolName: nullable(record.schoolName),
      degreeCourse: nullable(record.degreeCourse),
      periodOfAttendance: nullable(record.periodOfAttendance),
      highestLevelUnits: nullable(record.highestLevelUnits),
      yearGraduated: numberValue(record.yearGraduated),
      honors: nullable(record.honors),
      documentId: nullable(record.documentId),
      documentVersionId: nullable(record.documentVersionId),
    };
  });
}

function eligibilityPayload(records: EligibilityForm[]) {
  return records.map((record, index) => ({
    sequenceNo: index + 1,
    eligibilityName: nullable(record.eligibilityName),
    rating: nullable(record.rating),
    examDate: nullable(record.examDate),
    examPlace: nullable(record.examPlace),
    licenseNo: nullable(record.licenseNo),
    validUntil: nullable(record.validUntil),
    documentId: nullable(record.documentId),
    documentVersionId: nullable(record.documentVersionId),
  }));
}

function formPayload(form: PdsForm) {
  const personal = form.personal;
  const spouseHasValue = Object.values(form.spouse).some((value) =>
    typeof value === 'string' ? value.trim() : Object.values(value).some(Boolean),
  );
  const fatherHasValue = Object.values(form.father).some((value) => value.trim());
  const motherHasValue = Object.values(form.mother).some((value) => value.trim());
  const workSequenceByKey = new Map(
    form.workExperience.map((row, index) => [row.uiKey, index + 1]),
  );
  const workByKey = new Map(form.workExperience.map((row) => [row.uiKey, row]));

  const payload = {
    asOfDate: form.asOfDate,
    personal: {
      surname: nullable(personal.surname),
      firstName: nullable(personal.firstName),
      nameExtension: nullable(personal.nameExtension),
      middleName: nullable(personal.middleName),
      birthDate: nullable(personal.birthDate),
      birthPlace: nullable(personal.birthPlace),
      sex: personal.sex || null,
      civilStatus: personal.civilStatus || null,
      civilStatusDetail: nullable(personal.civilStatusDetail),
      heightMeters: numberValue(personal.heightMeters),
      weightKilograms: numberValue(personal.weightKilograms),
      bloodType: nullable(personal.bloodType),
      umidIdNumber: nullable(personal.umidIdNumber),
      pagibigIdNumber: nullable(personal.pagibigIdNumber),
      philhealthNumber: nullable(personal.philhealthNumber),
      philSysCardNumber: nullable(personal.philSysCardNumber),
      tinNumber: nullable(personal.tinNumber),
      agencyEmployeeNumber: nullable(personal.agencyEmployeeNumber),
      citizenship: personal.citizenship || null,
      dualCitizenshipType: personal.dualCitizenshipType || null,
      dualCitizenshipCountry: nullable(personal.dualCitizenshipCountry),
      residentialAddress: addressPayload(personal.residentialAddress),
      permanentAddress: addressPayload(personal.permanentAddress),
      telephoneNumber: nullable(personal.telephoneNumber),
      mobileNumber: nullable(personal.mobileNumber),
      emailAddress: nullable(personal.emailAddress),
    },
    family: {
      spouse: spouseHasValue
        ? {
            ...namePayload(form.spouse),
            occupation: nullable(form.spouse.occupation),
            employerBusinessName: nullable(form.spouse.employerBusinessName),
            businessAddress: addressPayload(form.spouse.businessAddress),
            telephoneNumber: nullable(form.spouse.telephoneNumber),
          }
        : null,
      children: form.children.map((child, index) => ({
        sequenceNo: index + 1,
        fullName: nullable(child.fullName),
        birthDate: nullable(child.birthDate),
      })),
      father: fatherHasValue ? namePayload(form.father) : null,
      mother: motherHasValue ? namePayload(form.mother, false) : null,
    },
    workExperience: form.workExperience.map((row, index) => ({
      ...optionalIdPayload(row.id),
      sequenceNo: index + 1,
      inclusiveFrom: nullable(row.inclusiveFrom),
      inclusiveTo: nullable(row.inclusiveTo),
      positionTitle: nullable(row.positionTitle),
      departmentAgencyOfficeCompany: nullable(row.departmentAgencyOfficeCompany),
      monthlySalary: numberValue(row.monthlySalary),
      salaryGradeStep: nullable(row.salaryGradeStep),
      appointmentStatus: nullable(row.appointmentStatus),
      governmentService: row.governmentService || null,
      isCurrent: row.isCurrent,
      ...evidencePayload(row),
    })),
    voluntaryWork: form.voluntaryWork.map((row, index) => ({
      ...optionalIdPayload(row.id),
      sequenceNo: index + 1,
      organizationNameAddress: nullable(row.organizationNameAddress),
      inclusiveFrom: nullable(row.inclusiveFrom),
      inclusiveTo: nullable(row.inclusiveTo),
      hours: numberValue(row.hours),
      positionNatureOfWork: nullable(row.positionNatureOfWork),
      ...evidencePayload(row),
    })),
    learningAndDevelopment: form.learningAndDevelopment.map((row, index) => ({
      ...optionalIdPayload(row.id),
      sequenceNo: index + 1,
      interventionTitle: nullable(row.interventionTitle),
      attendanceFrom: nullable(row.attendanceFrom),
      attendanceTo: nullable(row.attendanceTo),
      hours: numberValue(row.hours),
      type: nullable(row.type),
      conductedSponsoredBy: nullable(row.conductedSponsoredBy),
      ...evidencePayload(row),
    })),
    wes: form.wes.map((artifact) => ({
      ...optionalIdPayload(artifact.id),
      contextKey: nullable(artifact.contextKey),
      ...evidencePayload(artifact),
      entries: artifact.entries.map((entry, index) => {
        const work = workByKey.get(entry.workExperienceKey);
        const workExperienceId = work ? optionalId(work.id) : undefined;
        return {
          ...optionalIdPayload(entry.id),
          ...(workExperienceId
            ? { workExperienceId }
            : entry.workExperienceKey
              ? { workExperienceSequenceNo: workSequenceByKey.get(entry.workExperienceKey) }
              : {}),
          sequenceNo: index + 1,
          durationText: nullable(entry.durationText),
          position: entry.position.trim(),
          officeUnit: entry.officeUnit.trim(),
          immediateSupervisor: entry.immediateSupervisor.trim(),
          agencyOrganizationLocation: entry.agencyOrganizationLocation.trim(),
          accomplishments: nullable(entry.accomplishments),
          actualDuties: entry.actualDuties.trim(),
        };
      }),
    })),
  };
  return {
    ...payload,
    education: educationPayload(form.education),
    eligibility: eligibilityPayload(form.eligibility),
  };
}

function formDetailSections(form: PdsForm): PdsDetailSections {
  const workSequenceByKey = new Map(
    form.workExperience.map((row, index) => [row.uiKey, index + 1]),
  );
  const workByKey = new Map(form.workExperience.map((row) => [row.uiKey, row]));

  return {
    workExperience: form.workExperience.map((row, index) => ({
      ...optionalIdPayload(row.id),
      sequenceNo: index + 1,
      inclusiveFrom: nullable(row.inclusiveFrom),
      inclusiveTo: nullable(row.inclusiveTo),
      positionTitle: nullable(row.positionTitle),
      departmentAgencyOfficeCompany: nullable(row.departmentAgencyOfficeCompany),
      monthlySalary: numberValue(row.monthlySalary),
      salaryGradeStep: nullable(row.salaryGradeStep),
      appointmentStatus: nullable(row.appointmentStatus),
      governmentService:
        row.governmentService === 'Y' || row.governmentService === 'N'
          ? row.governmentService
          : null,
      isCurrent: row.isCurrent,
      ...evidencePayload(row),
    })),
    voluntaryWork: form.voluntaryWork.map((row, index) => ({
      ...optionalIdPayload(row.id),
      sequenceNo: index + 1,
      organizationNameAddress: nullable(row.organizationNameAddress),
      inclusiveFrom: nullable(row.inclusiveFrom),
      inclusiveTo: nullable(row.inclusiveTo),
      hours: numberValue(row.hours),
      positionNatureOfWork: nullable(row.positionNatureOfWork),
      ...evidencePayload(row),
    })),
    learningAndDevelopment: form.learningAndDevelopment.map((row, index) => ({
      ...optionalIdPayload(row.id),
      sequenceNo: index + 1,
      interventionTitle: nullable(row.interventionTitle),
      attendanceFrom: nullable(row.attendanceFrom),
      attendanceTo: nullable(row.attendanceTo),
      hours: numberValue(row.hours),
      type: nullable(row.type),
      conductedSponsoredBy: nullable(row.conductedSponsoredBy),
      ...evidencePayload(row),
    })),
    wes: form.wes.map((artifact) => ({
      ...optionalIdPayload(artifact.id),
      contextKey: nullable(artifact.contextKey),
      ...evidencePayload(artifact),
      entries: artifact.entries.map((entry, index) => {
        const work = workByKey.get(entry.workExperienceKey);
        const workExperienceId = work ? optionalId(work.id) : undefined;
        const workExperienceSequenceNo = workSequenceByKey.get(entry.workExperienceKey);
        return {
          ...optionalIdPayload(entry.id),
          ...(workExperienceId
            ? { workExperienceId }
            : workExperienceSequenceNo
              ? { workExperienceSequenceNo }
              : {}),
          sequenceNo: index + 1,
          durationText: entry.durationText,
          position: nullable(entry.position),
          officeUnit: nullable(entry.officeUnit),
          immediateSupervisor: nullable(entry.immediateSupervisor),
          agencyOrganizationLocation: nullable(entry.agencyOrganizationLocation),
          accomplishments: nullable(entry.accomplishments),
          actualDuties: nullable(entry.actualDuties),
        };
      }),
    })),
  };
}

function detailAfterSave(saved: PdsDetailData, form: PdsForm): PdsDetailData {
  const fallback = formDetailSections(form);
  return {
    ...saved,
    workExperience: saved.workExperience ?? fallback.workExperience,
    voluntaryWork: saved.voluntaryWork ?? fallback.voluntaryWork,
    learningAndDevelopment: saved.learningAndDevelopment ?? fallback.learningAndDevelopment,
    wes: saved.wes ?? fallback.wes,
  };
}

function summaryFromDetail(detail: PdsDetailData): PdsVersionSummaryData {
  return {
    id: detail.id,
    employeeId: detail.employeeId,
    versionNo: detail.versionNo,
    formVersion: detail.formVersion,
    asOfDate: detail.asOfDate,
    status: detail.status,
    supersedesVersionId: detail.supersedesVersionId,
    correctionReason: detail.correctionReason,
    createdByMembershipId: detail.createdByMembershipId,
    createdAt: detail.createdAt,
    updatedByMembershipId: detail.updatedByMembershipId,
    updatedAt: detail.updatedAt,
    rowVersion: detail.rowVersion,
    fieldScope: detail.fieldScope,
  };
}

function listAfterSave(list: PdsVersionListData, detail: PdsDetailData): PdsVersionListData {
  const next = summaryFromDetail(detail);
  const versions = [next, ...list.versions.filter((version) => version.id !== next.id)].sort(
    (left, right) => right.versionNo - left.versionNo,
  );
  return {
    employeeId: detail.employeeId,
    citizenshipCountries: list.citizenshipCountries,
    current:
      versions.find((version) => version.status === 'CERTIFIED') ??
      versions.find((version) => version.status !== 'SUPERSEDED') ??
      versions[0] ??
      null,
    draft: versions.find((version) => ['DRAFT', 'RETURNED'].includes(version.status)) ?? null,
    versions,
  };
}

function display(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === '' ? 'Not provided' : String(value);
}

function TextField({
  label,
  value,
  onChange,
  type = 'text',
  required = false,
  min,
  step,
  list,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'date' | 'email' | 'number';
  required?: boolean;
  min?: string;
  step?: string;
  list?: string;
  disabled?: boolean;
}) {
  return (
    <label className={employeeLabelClass}>
      {label}
      <input
        className={employeeInputClass}
        type={type}
        value={value}
        onChange={(event) => onChange((event.target as unknown as { value: string }).value)}
        required={required}
        min={min}
        step={step}
        list={list}
        disabled={disabled}
      />
    </label>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <label className={employeeLabelClass}>
      {label}
      <textarea
        className={`${employeeInputClass} min-h-[96px] resize-y`}
        value={value}
        onChange={(event) => onChange((event.target as unknown as { value: string }).value)}
        required={required}
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  required = false,
  placeholder = 'Not provided',
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly (readonly [string, string])[];
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <label className={employeeLabelClass}>
      {label}
      <select
        className={employeeInputClass}
        value={value}
        onChange={(event) => onChange((event.target as unknown as { value: string }).value)}
        required={required}
        disabled={disabled}
      >
        <option value="">{placeholder}</option>
        {options.map(([option, text]) => (
          <option key={option} value={option}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 text-sm font-[560] text-ink">
      <input
        className="size-4 rounded border border-line"
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange((event.target as unknown as { checked: boolean }).checked)}
      />
      {label}
    </label>
  );
}

function AddressFields({
  value,
  onChange,
}: {
  value: AddressForm;
  onChange: (key: keyof AddressForm, value: string) => void;
}) {
  return (
    <div className="grid gap-4 min-[620px]:grid-cols-2">
      {addressFields.map(([key, label]) => (
        <TextField
          key={key}
          label={label}
          value={value[key]}
          onChange={(next) => onChange(key, next)}
        />
      ))}
    </div>
  );
}

function NameFields({
  value,
  onChange,
  includeNameExtension = true,
}: {
  value: NameForm;
  onChange: (key: keyof NameForm, value: string) => void;
  includeNameExtension?: boolean;
}) {
  const fields = includeNameExtension
    ? nameFields
    : nameFields.filter(([key]) => key !== 'nameExtension');
  return (
    <div className="grid gap-4 min-[620px]:grid-cols-2">
      {fields.map(([key, label]) => (
        <TextField
          key={key}
          label={label}
          value={value[key]}
          onChange={(next) => onChange(key, next)}
        />
      ))}
    </div>
  );
}

function EvidenceFields({
  value,
  onChange,
  options,
  loading,
  canBrowse,
}: {
  value: EvidenceForm;
  onChange: (key: keyof EvidenceForm, value: string) => void;
  options: readonly PdsEvidenceOption[];
  loading: boolean;
  canBrowse: boolean;
}) {
  const selectedKey =
    value.documentId && value.documentVersionId
      ? `${value.documentId}:${value.documentVersionId}`
      : '';
  const choices: readonly (readonly [string, string])[] = [
    ...(selectedKey &&
    !options.some((option) => `${option.documentId}:${option.version.id}` === selectedKey)
      ? [[selectedKey, 'Current linked Document Version'] as const]
      : []),
    ...options.map(
      (option) =>
        [
          `${option.documentId}:${option.version.id}`,
          `${option.documentNo ?? titleCase(option.documentType)} · v${option.version.versionNo}`,
        ] as const,
    ),
  ];

  return (
    <div className="grid gap-2">
      <SelectField
        label="Controlled evidence Document Version"
        value={selectedKey}
        options={choices}
        placeholder={
          loading
            ? 'Loading finalized Agency Document Versions…'
            : canBrowse
              ? 'No finalized Agency Document Version selected'
              : 'Evidence selection is restricted for this membership'
        }
        disabled={loading || !canBrowse}
        onChange={(next) => {
          const [documentId = '', documentVersionId = ''] = next.split(':');
          onChange('documentId', documentId);
          onChange('documentVersionId', documentVersionId);
        }}
      />
      <p className="m-0 text-xs leading-5 text-muted">
        Select one finalized same-Agency Document Version. Source storage is shared and is not
        copied into the PDS.
      </p>
    </div>
  );
}

function FormSection({
  item,
  title,
  children,
}: {
  item: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="m-0 grid gap-4 border-0 border-t border-line p-0 pt-5 first:border-t-0 first:pt-0">
      <legend className="m-0 flex items-baseline gap-3 p-0">
        <span className="font-mono text-[10px] font-bold tracking-[.1em] text-cobalt">{item}</span>
        <span className="text-sm font-[680] text-midnight">{title}</span>
      </legend>
      {children}
    </fieldset>
  );
}

function RepeatableRow({
  title,
  index,
  total,
  onMoveUp,
  onMoveDown,
  onRemove,
  children,
}: {
  title: string;
  index: number;
  total: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  children: ReactNode;
}) {
  const label = `${title} ${index + 1}`;
  const labelId = useId();
  return (
    <fieldset
      aria-labelledby={labelId}
      className="grid gap-4 rounded-[3px] border border-line bg-[#fafbfd] p-4"
    >
      <legend id={labelId} className="sr-only">
        {label}
      </legend>
      <div className="flex flex-col gap-3 min-[620px]:flex-row min-[620px]:items-center min-[620px]:justify-between">
        <strong aria-hidden="true" className="text-xs font-[680] text-ink">
          {label}
        </strong>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="default"
            disabled={index === 0}
            aria-label={`Move ${label.toLowerCase()} up`}
            onClick={onMoveUp}
          >
            Move up
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="default"
            disabled={index === total - 1}
            aria-label={`Move ${label.toLowerCase()} down`}
            onClick={onMoveDown}
          >
            Move down
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="default"
            aria-label={`Remove ${label.toLowerCase()}`}
            onClick={onRemove}
          >
            Remove
          </Button>
        </div>
      </div>
      {children}
    </fieldset>
  );
}

function EmptyRows({ message }: { message: string }) {
  return <p className="m-0 text-sm leading-6 text-muted">{message}</p>;
}

function DetailValue({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  return (
    <div>
      <dt className="text-[10px] font-bold tracking-[.08em] text-muted uppercase">{label}</dt>
      <dd className="mt-1 break-words text-sm font-[560] text-ink">{display(value)}</dd>
    </div>
  );
}

function RowButtons({
  label,
  index,
  count,
  onMove,
  onRemove,
}: {
  label: string;
  index: number;
  count: number;
  onMove: (offset: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button
        type="button"
        variant="secondary"
        size="default"
        onClick={() => onMove(-1)}
        disabled={index === 0}
      >
        Move {label} up
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="default"
        onClick={() => onMove(1)}
        disabled={index === count - 1}
      >
        Move {label} down
      </Button>
      <Button type="button" variant="secondary" size="default" onClick={onRemove}>
        Remove
      </Button>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors =
    status === 'DRAFT' || status === 'RETURNED'
      ? 'bg-[#fff2d9] text-[#82520d]'
      : status === 'CERTIFIED'
        ? 'bg-[#e7f4eb] text-[#27633b]'
        : 'bg-pale-blue text-cobalt';
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold tracking-[.06em] ${colors}`}
    >
      {status}
    </span>
  );
}

export function PdsWorkspace({
  agencyId,
  employeeName,
  initialList,
  initialDetail,
  canUpdate,
  canBrowseEvidence,
  createUrl,
  backHref,
}: {
  agencyId: string;
  employeeName?: string;
  initialList: PdsVersionListData;
  initialDetail: PdsDetailData | null;
  canUpdate: boolean;
  canBrowseEvidence: boolean;
  createUrl: string;
  backHref: string;
}) {
  const [list, setList] = useState(initialList);
  const [detail, setDetail] = useState(initialDetail);
  const [form, setForm] = useState(() => formFromDetail(initialDetail));
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<'ok' | 'error'>('ok');
  const [error, setError] = useState<string | null>(null);
  const [evidenceOptions, setEvidenceOptions] = useState<PdsEvidenceOption[]>([]);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const editable = detail?.fieldScope === 'FULL' && ['DRAFT', 'RETURNED'].includes(detail.status);
  const canCreate = canUpdate && (!detail || (detail.fieldScope === 'FULL' && !list.draft));
  const personal = detail?.personal;
  const family = detail?.family;
  const detailWorkExperience = detail?.workExperience ?? [];
  const detailVoluntaryWork = detail?.voluntaryWork ?? [];
  const detailLearningAndDevelopment = detail?.learningAndDevelopment ?? [];
  const detailWes = detail?.wes ?? [];
  const workOptions = form.workExperience.map(
    (row, index) => [row.uiKey, workExperienceLabel(row, index)] as const,
  );

  useEffect(() => {
    if (error) (errorRef.current as { focus: () => void } | null)?.focus();
  }, [error]);

  useEffect(() => {
    if (!open || !canBrowseEvidence) return;
    let active = true;
    setEvidenceLoading(true);
    void fetch(`/api/v1/agencies/${agencyId}/documents/versions`, { credentials: 'include' })
      .then(async (response) => {
        const value: unknown = await response.json().catch(() => null);
        if (!response.ok) throw new Error('Agency Document Versions could not be loaded.');
        if (active) setEvidenceOptions(parsePdsEvidenceOptions(value));
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(
            caught instanceof Error
              ? caught.message
              : 'Agency Document Versions could not be loaded.',
          );
        }
      })
      .finally(() => {
        if (active) setEvidenceLoading(false);
      });
    return () => {
      active = false;
    };
  }, [agencyId, canBrowseEvidence, open]);

  function openForm() {
    setForm(formFromDetail(detail));
    setError(null);
    setOpen(true);
  }

  function changePersonal(key: keyof PersonalForm, value: string) {
    setForm((current) => ({
      ...current,
      personal: {
        ...current.personal,
        [key]: value,
        ...(key === 'civilStatus' && value !== 'OTHER' ? { civilStatusDetail: '' } : {}),
        ...(key === 'citizenship' && value !== 'DUAL_CITIZENSHIP'
          ? { dualCitizenshipType: '', dualCitizenshipCountry: '' }
          : {}),
      },
    }));
  }

  function changeAddress(
    section: 'residentialAddress' | 'permanentAddress',
    key: keyof AddressForm,
    value: string,
  ) {
    setForm((current) => ({
      ...current,
      personal: {
        ...current.personal,
        [section]: { ...current.personal[section], [key]: value },
      },
    }));
  }

  function changeSpouse(key: keyof SpouseForm, value: string) {
    setForm((current) => ({ ...current, spouse: { ...current.spouse, [key]: value } }));
  }

  function changeSpouseAddress(key: keyof AddressForm, value: string) {
    setForm((current) => ({
      ...current,
      spouse: {
        ...current.spouse,
        businessAddress: { ...current.spouse.businessAddress, [key]: value },
      },
    }));
  }

  function changeName(section: 'father' | 'mother', key: keyof NameForm, value: string) {
    setForm((current) => ({ ...current, [section]: { ...current[section], [key]: value } }));
  }

  function changeEducation(index: number, key: keyof EducationForm, value: string) {
    setForm((current) => ({
      ...current,
      education: current.education.map((record, recordIndex) =>
        recordIndex === index ? { ...record, [key]: value } : record,
      ),
    }));
  }

  function changeEligibility(index: number, key: keyof EligibilityForm, value: string) {
    setForm((current) => ({
      ...current,
      eligibility: current.eligibility.map((record, recordIndex) =>
        recordIndex === index ? { ...record, [key]: value } : record,
      ),
    }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save();
  }

  async function save(): Promise<void> {
    setSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      const payload = formPayload(form);
      const updating = editable && detail !== null;
      const response = await fetch(
        updating ? `/api/v1/agencies/${agencyId}/pds/${detail.id}` : createUrl,
        {
          method: updating ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(updating ? { ...payload, rowVersion: detail.rowVersion } : payload),
        },
      );
      const value: unknown = await response.json().catch(() => null);
      if (
        response.ok &&
        value &&
        typeof value === 'object' &&
        typeof (value as PdsDetailData).id === 'string'
      ) {
        const saved = detailAfterSave(value as PdsDetailData, form);
        setDetail(saved);
        setForm(formFromDetail(saved));
        setList((current) => listAfterSave(current, saved));
        setOpen(false);
        setMessageTone('ok');
        setMessage(updating ? 'PDS Draft saved.' : 'PDS Draft created.');
        return;
      }
      const envelope = (value ?? {}) as ErrorEnvelope;
      setError(envelope.error?.message ?? 'The PDS Draft could not be saved.');
    } catch {
      setError('The PDS Draft could not be saved. Check the connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const education = detail?.education ?? [];
  const eligibility = detail?.eligibility ?? [];

  return (
    <>
      <Link
        href={backHref}
        className="mb-6 inline-block text-xs font-[650] text-cobalt no-underline"
      >
        ← {employeeName ? 'Employee record' : 'Dashboard'}
      </Link>
      <header className="mb-7 flex flex-col gap-5 min-[700px]:flex-row min-[700px]:items-end min-[700px]:justify-between">
        <div className="flex items-center gap-4">
          {employeeName && <EmployeeInitials name={employeeName} large />}
          <EmployeePageTitle
            eyebrow="CS Form No. 212 · Revised 2026 Draft"
            title={employeeName ? `${employeeName} · PDS` : 'My Personal Data Sheet'}
            description="Maintain personal, family, qualifications, work, voluntary, development, and WES draft information."
          />
        </div>
        {canUpdate && (editable || canCreate) && (
          <Dialog open={open} onOpenChange={(next) => !submitting && setOpen(next)}>
            <DialogTrigger asChild>
              <Button variant="primary" size="default" onClick={openForm}>
                {editable ? 'Edit Draft PDS' : 'Create Draft PDS'}
              </Button>
            </DialogTrigger>
            <DialogContent aria-describedby="pds-dialog-description">
              <DialogHeader>
                <div className="grid gap-1.5">
                  <DialogTitle>{editable ? 'Edit Draft PDS' : 'Create Draft PDS'}</DialogTitle>
                  <DialogDescription id="pds-dialog-description">
                    Items 1–30 and Work Experience Sheet rows are saved as one protected Draft.
                    Empty fields remain available for later completion.
                  </DialogDescription>
                </div>
              </DialogHeader>
              <DialogBody>
                <form id="pds-form" className="grid gap-6" onSubmit={submit}>
                  {error && (
                    <div
                      ref={errorRef}
                      tabIndex={-1}
                      role="alert"
                      className="rounded-[3px] border-l-2 border-[#b64040] bg-[#fdeeee] px-4 py-3 text-sm text-[#8f2d2d] outline-none"
                    >
                      {error}
                    </div>
                  )}
                  <div className="grid gap-3 border-l-2 border-cobalt bg-pale-blue px-4 py-3 text-xs leading-5 text-[#34557e]">
                    <strong className="font-[680] text-midnight">Draft record</strong>
                    <span>
                      This record can be changed while it is Draft or Returned. Submission and
                      certification are separate workflows.
                    </span>
                  </div>
                  <TextField
                    label="As-of date"
                    type="date"
                    value={form.asOfDate}
                    onChange={(value) => setForm((current) => ({ ...current, asOfDate: value }))}
                    required
                  />
                  <FormSection item="01–09" title="Personal identity and physical information">
                    <div className="grid gap-4 min-[620px]:grid-cols-2">
                      <TextField
                        label="Surname"
                        value={form.personal.surname}
                        onChange={(value) => changePersonal('surname', value)}
                      />
                      <TextField
                        label="First name"
                        value={form.personal.firstName}
                        onChange={(value) => changePersonal('firstName', value)}
                      />
                      <TextField
                        label="Name extension"
                        value={form.personal.nameExtension}
                        onChange={(value) => changePersonal('nameExtension', value)}
                      />
                      <TextField
                        label="Middle name"
                        value={form.personal.middleName}
                        onChange={(value) => changePersonal('middleName', value)}
                      />
                      <TextField
                        label="Birth date"
                        type="date"
                        value={form.personal.birthDate}
                        onChange={(value) => changePersonal('birthDate', value)}
                      />
                      <TextField
                        label="Place of birth"
                        value={form.personal.birthPlace}
                        onChange={(value) => changePersonal('birthPlace', value)}
                      />
                      <SelectField
                        label="Sex at birth"
                        value={form.personal.sex}
                        onChange={(value) => changePersonal('sex', value)}
                        options={[
                          ['FEMALE', 'Female'],
                          ['MALE', 'Male'],
                        ]}
                      />
                      <SelectField
                        label="Civil status"
                        value={form.personal.civilStatus}
                        onChange={(value) => changePersonal('civilStatus', value)}
                        options={[
                          ['SINGLE', 'Single'],
                          ['MARRIED', 'Married'],
                          ['WIDOWED', 'Widowed'],
                          ['SEPARATED', 'Separated'],
                          ['OTHER', 'Other/s'],
                        ]}
                      />
                      {form.personal.civilStatus === 'OTHER' && (
                        <TextField
                          label="Other/s civil status"
                          value={form.personal.civilStatusDetail}
                          onChange={(value) => changePersonal('civilStatusDetail', value)}
                          required
                        />
                      )}
                      <TextField
                        label="Height (metres)"
                        type="number"
                        min="0"
                        step="0.001"
                        value={form.personal.heightMeters}
                        onChange={(value) => changePersonal('heightMeters', value)}
                      />
                      <TextField
                        label="Weight (kilograms)"
                        type="number"
                        min="0"
                        step="0.001"
                        value={form.personal.weightKilograms}
                        onChange={(value) => changePersonal('weightKilograms', value)}
                      />
                      <TextField
                        label="Blood type"
                        value={form.personal.bloodType}
                        onChange={(value) => changePersonal('bloodType', value)}
                      />
                    </div>
                  </FormSection>
                  <FormSection item="10–15" title="Government and Agency identifiers">
                    <div className="grid gap-4 min-[620px]:grid-cols-2">
                      {personalTextFields.slice(6, 12).map(([key, label]) => (
                        <TextField
                          key={key}
                          label={label}
                          value={form.personal[key]}
                          onChange={(value) => changePersonal(key, value)}
                        />
                      ))}
                    </div>
                  </FormSection>
                  <FormSection item="16" title="Citizenship">
                    <div className="grid gap-4 min-[620px]:grid-cols-2">
                      <SelectField
                        label="Citizenship"
                        value={form.personal.citizenship}
                        onChange={(value) => changePersonal('citizenship', value)}
                        options={[
                          ['FILIPINO', 'Filipino'],
                          ['DUAL_CITIZENSHIP', 'Dual citizenship'],
                        ]}
                      />
                      {form.personal.citizenship === 'DUAL_CITIZENSHIP' && (
                        <>
                          <SelectField
                            label="Dual citizenship by"
                            value={form.personal.dualCitizenshipType}
                            onChange={(value) => changePersonal('dualCitizenshipType', value)}
                            options={[
                              ['BY_BIRTH', 'Birth'],
                              ['BY_NATURALIZATION', 'Naturalization'],
                            ]}
                          />
                          <SelectField
                            label="Other citizenship country"
                            value={form.personal.dualCitizenshipCountry}
                            onChange={(value) => changePersonal('dualCitizenshipCountry', value)}
                            options={list.citizenshipCountries.map(
                              (country) => [country, country] as const,
                            )}
                            required
                          />
                        </>
                      )}
                    </div>
                  </FormSection>
                  <FormSection item="17–18" title="Residential and permanent address">
                    <div className="grid gap-5">
                      <div className="grid gap-3">
                        <h3 className="m-0 text-xs font-[680] text-ink">Residential address</h3>
                        <AddressFields
                          value={form.personal.residentialAddress}
                          onChange={(key, value) => changeAddress('residentialAddress', key, value)}
                        />
                      </div>
                      <div className="grid gap-3">
                        <h3 className="m-0 text-xs font-[680] text-ink">Permanent address</h3>
                        <AddressFields
                          value={form.personal.permanentAddress}
                          onChange={(key, value) => changeAddress('permanentAddress', key, value)}
                        />
                      </div>
                    </div>
                  </FormSection>
                  <FormSection item="19–21" title="Contact information">
                    <div className="grid gap-4 min-[620px]:grid-cols-2">
                      {personalTextFields.slice(12).map(([key, label]) => (
                        <TextField
                          key={key}
                          label={label}
                          type={key === 'emailAddress' ? 'email' : 'text'}
                          value={form.personal[key]}
                          onChange={(value) => changePersonal(key, value)}
                        />
                      ))}
                    </div>
                  </FormSection>
                  <FormSection item="22" title="Spouse">
                    <div className="grid gap-4">
                      <NameFields value={form.spouse} onChange={changeSpouse} />
                      <div className="grid gap-4 min-[620px]:grid-cols-2">
                        <TextField
                          label="Occupation"
                          value={form.spouse.occupation}
                          onChange={(value) => changeSpouse('occupation', value)}
                        />
                        <TextField
                          label="Employer / business name"
                          value={form.spouse.employerBusinessName}
                          onChange={(value) => changeSpouse('employerBusinessName', value)}
                        />
                        <TextField
                          label="Telephone"
                          value={form.spouse.telephoneNumber}
                          onChange={(value) => changeSpouse('telephoneNumber', value)}
                        />
                      </div>
                      <h3 className="m-0 text-xs font-[680] text-ink">Spouse business address</h3>
                      <AddressFields
                        value={form.spouse.businessAddress}
                        onChange={changeSpouseAddress}
                      />
                    </div>
                  </FormSection>
                  <FormSection item="23" title="Children">
                    <div className="grid gap-4">
                      {form.children.map((child, index) => (
                        <RepeatableRow
                          key={child.uiKey}
                          title="Child"
                          index={index}
                          total={form.children.length}
                          onMoveUp={() =>
                            setForm((current) => ({
                              ...current,
                              children: moveAt(current.children, index, -1),
                            }))
                          }
                          onMoveDown={() =>
                            setForm((current) => ({
                              ...current,
                              children: moveAt(current.children, index, 1),
                            }))
                          }
                          onRemove={() =>
                            setForm((current) => ({
                              ...current,
                              children: removeAt(current.children, index),
                            }))
                          }
                        >
                          <div className="grid gap-4 min-[620px]:grid-cols-2">
                            <TextField
                              label="Full name"
                              value={child.fullName}
                              onChange={(value) =>
                                setForm((current) => ({
                                  ...current,
                                  children: updateAt(current.children, index, (item) => ({
                                    ...item,
                                    fullName: value,
                                  })),
                                }))
                              }
                            />
                            <TextField
                              label="Date of birth"
                              type="date"
                              value={child.birthDate}
                              onChange={(value) =>
                                setForm((current) => ({
                                  ...current,
                                  children: updateAt(current.children, index, (item) => ({
                                    ...item,
                                    birthDate: value,
                                  })),
                                }))
                              }
                            />
                          </div>
                        </RepeatableRow>
                      ))}
                      <Button
                        type="button"
                        variant="secondary"
                        size="default"
                        className="justify-self-start"
                        onClick={() =>
                          setForm((current) => ({
                            ...current,
                            children: [...current.children, blankChild()],
                          }))
                        }
                      >
                        Add child
                      </Button>
                    </div>
                  </FormSection>
                  <FormSection item="24" title="Father">
                    <NameFields
                      value={form.father}
                      onChange={(key, value) => changeName('father', key, value)}
                    />
                  </FormSection>
                  <FormSection item="25" title="Mother’s maiden name">
                    <NameFields
                      value={form.mother}
                      onChange={(key, value) => changeName('mother', key, value)}
                      includeNameExtension={false}
                    />
                  </FormSection>
                  <FormSection item="WORK" title="Work experience">
                    <div className="grid gap-4">
                      {form.workExperience.length === 0 && (
                        <EmptyRows message="No work experience rows added yet." />
                      )}
                      {form.workExperience.map((row, index) => (
                        <RepeatableRow
                          key={row.uiKey}
                          title="Work experience"
                          index={index}
                          total={form.workExperience.length}
                          onMoveUp={() =>
                            setForm((current) => ({
                              ...current,
                              workExperience: moveAt(current.workExperience, index, -1),
                            }))
                          }
                          onMoveDown={() =>
                            setForm((current) => ({
                              ...current,
                              workExperience: moveAt(current.workExperience, index, 1),
                            }))
                          }
                          onRemove={() =>
                            (() => {
                              const removedKey = row.uiKey;
                              const hasWesBinding = form.wes.some((artifact) =>
                                artifact.entries.some(
                                  (entry) => entry.workExperienceKey === removedKey,
                                ),
                              );
                              if (hasWesBinding) {
                                setError(
                                  'This work row is linked to a WES entry. Select a new parent before saving.',
                                );
                              }
                              setForm((current) => ({
                                ...current,
                                workExperience: removeAt(current.workExperience, index),
                                wes: current.wes.map((artifact) => ({
                                  ...artifact,
                                  entries: artifact.entries.map((entry) =>
                                    entry.workExperienceKey === removedKey
                                      ? { ...entry, workExperienceKey: '' }
                                      : entry,
                                  ),
                                })),
                              }));
                            })()
                          }
                        >
                          <div className="grid gap-4">
                            <ToggleField
                              label="Current work"
                              checked={row.isCurrent}
                              onChange={(checked) =>
                                setForm((current) => ({
                                  ...current,
                                  workExperience: updateAt(
                                    current.workExperience,
                                    index,
                                    (item) => ({
                                      ...item,
                                      isCurrent: checked,
                                      inclusiveTo: checked ? '' : item.inclusiveTo,
                                    }),
                                  ),
                                }))
                              }
                            />
                            <div className="grid gap-4 min-[620px]:grid-cols-2">
                              <TextField
                                label="Inclusive from"
                                type="date"
                                value={row.inclusiveFrom}
                                onChange={(value) =>
                                  setForm((current) => ({
                                    ...current,
                                    workExperience: updateAt(
                                      current.workExperience,
                                      index,
                                      (item) => ({
                                        ...item,
                                        inclusiveFrom: value,
                                      }),
                                    ),
                                  }))
                                }
                              />
                              <TextField
                                label="Inclusive to"
                                type="date"
                                value={row.inclusiveTo}
                                disabled={row.isCurrent}
                                onChange={(value) =>
                                  setForm((current) => ({
                                    ...current,
                                    workExperience: updateAt(
                                      current.workExperience,
                                      index,
                                      (item) => ({
                                        ...item,
                                        inclusiveTo: value,
                                      }),
                                    ),
                                  }))
                                }
                              />
                              <TextField
                                label="Position title"
                                value={row.positionTitle}
                                onChange={(value) =>
                                  setForm((current) => ({
                                    ...current,
                                    workExperience: updateAt(
                                      current.workExperience,
                                      index,
                                      (item) => ({
                                        ...item,
                                        positionTitle: value,
                                      }),
                                    ),
                                  }))
                                }
                              />
                              <TextField
                                label="Department / agency / office / company"
                                value={row.departmentAgencyOfficeCompany}
                                onChange={(value) =>
                                  setForm((current) => ({
                                    ...current,
                                    workExperience: updateAt(
                                      current.workExperience,
                                      index,
                                      (item) => ({
                                        ...item,
                                        departmentAgencyOfficeCompany: value,
                                      }),
                                    ),
                                  }))
                                }
                              />
                              <TextField
                                label="Monthly salary"
                                type="number"
                                min="0"
                                step="0.01"
                                value={row.monthlySalary}
                                onChange={(value) =>
                                  setForm((current) => ({
                                    ...current,
                                    workExperience: updateAt(
                                      current.workExperience,
                                      index,
                                      (item) => ({
                                        ...item,
                                        monthlySalary: value,
                                      }),
                                    ),
                                  }))
                                }
                              />
                              <TextField
                                label="Salary / job / pay grade and step"
                                value={row.salaryGradeStep}
                                onChange={(value) =>
                                  setForm((current) => ({
                                    ...current,
                                    workExperience: updateAt(
                                      current.workExperience,
                                      index,
                                      (item) => ({
                                        ...item,
                                        salaryGradeStep: value,
                                      }),
                                    ),
                                  }))
                                }
                              />
                              <TextField
                                label="Status of appointment"
                                value={row.appointmentStatus}
                                onChange={(value) =>
                                  setForm((current) => ({
                                    ...current,
                                    workExperience: updateAt(
                                      current.workExperience,
                                      index,
                                      (item) => ({
                                        ...item,
                                        appointmentStatus: value,
                                      }),
                                    ),
                                  }))
                                }
                              />
                              <SelectField
                                label="Government service"
                                value={row.governmentService}
                                onChange={(value) =>
                                  setForm((current) => ({
                                    ...current,
                                    workExperience: updateAt(
                                      current.workExperience,
                                      index,
                                      (item) => ({
                                        ...item,
                                        governmentService: value,
                                      }),
                                    ),
                                  }))
                                }
                                options={workExperienceOptions}
                              />
                            </div>
                            <EvidenceFields
                              value={row}
                              options={evidenceOptions}
                              loading={evidenceLoading}
                              canBrowse={canBrowseEvidence}
                              onChange={(key, value) =>
                                setForm((current) => ({
                                  ...current,
                                  workExperience: updateAt(
                                    current.workExperience,
                                    index,
                                    (item) => ({
                                      ...item,
                                      [key]: value,
                                    }),
                                  ),
                                }))
                              }
                            />
                          </div>
                        </RepeatableRow>
                      ))}
                      <Button
                        type="button"
                        variant="secondary"
                        size="default"
                        className="justify-self-start"
                        onClick={() =>
                          setForm((current) => ({
                            ...current,
                            workExperience: [...current.workExperience, blankWorkExperience()],
                          }))
                        }
                      >
                        Add work experience
                      </Button>
                    </div>
                  </FormSection>
                  <FormSection item="VOL" title="Voluntary work">
                    <div className="grid gap-4">
                      {form.voluntaryWork.length === 0 && (
                        <EmptyRows message="No voluntary-work rows added yet." />
                      )}
                      {form.voluntaryWork.map((row, index) => (
                        <RepeatableRow
                          key={row.uiKey}
                          title="Voluntary work"
                          index={index}
                          total={form.voluntaryWork.length}
                          onMoveUp={() =>
                            setForm((current) => ({
                              ...current,
                              voluntaryWork: moveAt(current.voluntaryWork, index, -1),
                            }))
                          }
                          onMoveDown={() =>
                            setForm((current) => ({
                              ...current,
                              voluntaryWork: moveAt(current.voluntaryWork, index, 1),
                            }))
                          }
                          onRemove={() =>
                            setForm((current) => ({
                              ...current,
                              voluntaryWork: removeAt(current.voluntaryWork, index),
                            }))
                          }
                        >
                          <div className="grid gap-4 min-[620px]:grid-cols-2">
                            <TextField
                              label="Organization name and address"
                              value={row.organizationNameAddress}
                              onChange={(value) =>
                                setForm((current) => ({
                                  ...current,
                                  voluntaryWork: updateAt(current.voluntaryWork, index, (item) => ({
                                    ...item,
                                    organizationNameAddress: value,
                                  })),
                                }))
                              }
                            />
                            <TextField
                              label="Position / nature of work"
                              value={row.positionNatureOfWork}
                              onChange={(value) =>
                                setForm((current) => ({
                                  ...current,
                                  voluntaryWork: updateAt(current.voluntaryWork, index, (item) => ({
                                    ...item,
                                    positionNatureOfWork: value,
                                  })),
                                }))
                              }
                            />
                            <TextField
                              label="Inclusive from"
                              type="date"
                              value={row.inclusiveFrom}
                              onChange={(value) =>
                                setForm((current) => ({
                                  ...current,
                                  voluntaryWork: updateAt(current.voluntaryWork, index, (item) => ({
                                    ...item,
                                    inclusiveFrom: value,
                                  })),
                                }))
                              }
                            />
                            <TextField
                              label="Inclusive to"
                              type="date"
                              value={row.inclusiveTo}
                              onChange={(value) =>
                                setForm((current) => ({
                                  ...current,
                                  voluntaryWork: updateAt(current.voluntaryWork, index, (item) => ({
                                    ...item,
                                    inclusiveTo: value,
                                  })),
                                }))
                              }
                            />
                            <TextField
                              label="Number of hours"
                              type="number"
                              min="0"
                              step="0.01"
                              value={row.hours}
                              onChange={(value) =>
                                setForm((current) => ({
                                  ...current,
                                  voluntaryWork: updateAt(current.voluntaryWork, index, (item) => ({
                                    ...item,
                                    hours: value,
                                  })),
                                }))
                              }
                            />
                          </div>
                          <EvidenceFields
                            value={row}
                            options={evidenceOptions}
                            loading={evidenceLoading}
                            canBrowse={canBrowseEvidence}
                            onChange={(key, value) =>
                              setForm((current) => ({
                                ...current,
                                voluntaryWork: updateAt(current.voluntaryWork, index, (item) => ({
                                  ...item,
                                  [key]: value,
                                })),
                              }))
                            }
                          />
                        </RepeatableRow>
                      ))}
                      <Button
                        type="button"
                        variant="secondary"
                        size="default"
                        className="justify-self-start"
                        onClick={() =>
                          setForm((current) => ({
                            ...current,
                            voluntaryWork: [...current.voluntaryWork, blankVoluntaryWork()],
                          }))
                        }
                      >
                        Add voluntary work
                      </Button>
                    </div>
                  </FormSection>
                  <FormSection item="L&D" title="Learning and development">
                    <div className="grid gap-4">
                      {form.learningAndDevelopment.length === 0 && (
                        <EmptyRows message="No learning-and-development rows added yet." />
                      )}
                      {form.learningAndDevelopment.map((row, index) => (
                        <RepeatableRow
                          key={row.uiKey}
                          title="Learning and development"
                          index={index}
                          total={form.learningAndDevelopment.length}
                          onMoveUp={() =>
                            setForm((current) => ({
                              ...current,
                              learningAndDevelopment: moveAt(
                                current.learningAndDevelopment,
                                index,
                                -1,
                              ),
                            }))
                          }
                          onMoveDown={() =>
                            setForm((current) => ({
                              ...current,
                              learningAndDevelopment: moveAt(
                                current.learningAndDevelopment,
                                index,
                                1,
                              ),
                            }))
                          }
                          onRemove={() =>
                            setForm((current) => ({
                              ...current,
                              learningAndDevelopment: removeAt(
                                current.learningAndDevelopment,
                                index,
                              ),
                            }))
                          }
                        >
                          <div className="grid gap-4 min-[620px]:grid-cols-2">
                            <TextField
                              label="Intervention / training title"
                              value={row.interventionTitle}
                              onChange={(value) =>
                                setForm((current) => ({
                                  ...current,
                                  learningAndDevelopment: updateAt(
                                    current.learningAndDevelopment,
                                    index,
                                    (item) => ({ ...item, interventionTitle: value }),
                                  ),
                                }))
                              }
                            />
                            <TextField
                              label="Type"
                              value={row.type}
                              onChange={(value) =>
                                setForm((current) => ({
                                  ...current,
                                  learningAndDevelopment: updateAt(
                                    current.learningAndDevelopment,
                                    index,
                                    (item) => ({ ...item, type: value }),
                                  ),
                                }))
                              }
                            />
                            <TextField
                              label="Attendance from"
                              type="date"
                              value={row.attendanceFrom}
                              onChange={(value) =>
                                setForm((current) => ({
                                  ...current,
                                  learningAndDevelopment: updateAt(
                                    current.learningAndDevelopment,
                                    index,
                                    (item) => ({ ...item, attendanceFrom: value }),
                                  ),
                                }))
                              }
                            />
                            <TextField
                              label="Attendance to"
                              type="date"
                              value={row.attendanceTo}
                              onChange={(value) =>
                                setForm((current) => ({
                                  ...current,
                                  learningAndDevelopment: updateAt(
                                    current.learningAndDevelopment,
                                    index,
                                    (item) => ({ ...item, attendanceTo: value }),
                                  ),
                                }))
                              }
                            />
                            <TextField
                              label="Number of hours"
                              type="number"
                              min="0"
                              step="0.01"
                              value={row.hours}
                              onChange={(value) =>
                                setForm((current) => ({
                                  ...current,
                                  learningAndDevelopment: updateAt(
                                    current.learningAndDevelopment,
                                    index,
                                    (item) => ({ ...item, hours: value }),
                                  ),
                                }))
                              }
                            />
                            <TextField
                              label="Conducted / sponsored by"
                              value={row.conductedSponsoredBy}
                              onChange={(value) =>
                                setForm((current) => ({
                                  ...current,
                                  learningAndDevelopment: updateAt(
                                    current.learningAndDevelopment,
                                    index,
                                    (item) => ({ ...item, conductedSponsoredBy: value }),
                                  ),
                                }))
                              }
                            />
                          </div>
                          <EvidenceFields
                            value={row}
                            options={evidenceOptions}
                            loading={evidenceLoading}
                            canBrowse={canBrowseEvidence}
                            onChange={(key, value) =>
                              setForm((current) => ({
                                ...current,
                                learningAndDevelopment: updateAt(
                                  current.learningAndDevelopment,
                                  index,
                                  (item) => ({ ...item, [key]: value }),
                                ),
                              }))
                            }
                          />
                        </RepeatableRow>
                      ))}
                      <Button
                        type="button"
                        variant="secondary"
                        size="default"
                        className="justify-self-start"
                        onClick={() =>
                          setForm((current) => ({
                            ...current,
                            learningAndDevelopment: [
                              ...current.learningAndDevelopment,
                              blankLearningDevelopment(),
                            ],
                          }))
                        }
                      >
                        Add learning and development
                      </Button>
                    </div>
                  </FormSection>
                  <FormSection item="WES" title="Work Experience Sheet">
                    <div className="grid gap-4">
                      {form.wes.length === 0 && (
                        <EmptyRows message="No Work Experience Sheet artifacts added yet." />
                      )}
                      {form.wes.map((artifact, artifactIndex) => (
                        <RepeatableRow
                          key={artifact.uiKey}
                          title="WES artifact"
                          index={artifactIndex}
                          total={form.wes.length}
                          onMoveUp={() =>
                            setForm((current) => ({
                              ...current,
                              wes: moveAt(current.wes, artifactIndex, -1),
                            }))
                          }
                          onMoveDown={() =>
                            setForm((current) => ({
                              ...current,
                              wes: moveAt(current.wes, artifactIndex, 1),
                            }))
                          }
                          onRemove={() =>
                            setForm((current) => ({
                              ...current,
                              wes: removeAt(current.wes, artifactIndex),
                            }))
                          }
                        >
                          <div className="grid gap-4">
                            <TextField
                              label="Context key"
                              value={artifact.contextKey}
                              onChange={(value) =>
                                setForm((current) => ({
                                  ...current,
                                  wes: updateAt(current.wes, artifactIndex, (item) => ({
                                    ...item,
                                    contextKey: value,
                                  })),
                                }))
                              }
                            />
                            <EvidenceFields
                              value={artifact}
                              options={evidenceOptions}
                              loading={evidenceLoading}
                              canBrowse={canBrowseEvidence}
                              onChange={(key, value) =>
                                setForm((current) => ({
                                  ...current,
                                  wes: updateAt(current.wes, artifactIndex, (item) => ({
                                    ...item,
                                    [key]: value,
                                  })),
                                }))
                              }
                            />
                            <div className="grid gap-4">
                              {artifact.entries.map((entry, entryIndex) => (
                                <RepeatableRow
                                  key={entry.uiKey}
                                  title="WES entry"
                                  index={entryIndex}
                                  total={artifact.entries.length}
                                  onMoveUp={() =>
                                    setForm((current) => ({
                                      ...current,
                                      wes: updateAt(current.wes, artifactIndex, (item) => ({
                                        ...item,
                                        entries: moveAt(item.entries, entryIndex, -1),
                                      })),
                                    }))
                                  }
                                  onMoveDown={() =>
                                    setForm((current) => ({
                                      ...current,
                                      wes: updateAt(current.wes, artifactIndex, (item) => ({
                                        ...item,
                                        entries: moveAt(item.entries, entryIndex, 1),
                                      })),
                                    }))
                                  }
                                  onRemove={() =>
                                    setForm((current) => ({
                                      ...current,
                                      wes: updateAt(current.wes, artifactIndex, (item) => ({
                                        ...item,
                                        entries: removeAt(item.entries, entryIndex),
                                      })),
                                    }))
                                  }
                                >
                                  <div className="grid gap-4">
                                    <SelectField
                                      label="Parent work-experience row"
                                      value={entry.workExperienceKey}
                                      onChange={(value) =>
                                        setForm((current) => ({
                                          ...current,
                                          wes: updateAt(current.wes, artifactIndex, (item) => ({
                                            ...item,
                                            entries: updateAt(item.entries, entryIndex, (row) => ({
                                              ...row,
                                              workExperienceKey: value,
                                            })),
                                          })),
                                        }))
                                      }
                                      options={workOptions}
                                      required
                                      placeholder={
                                        workOptions.length === 0
                                          ? 'Add a work-experience row first'
                                          : 'Select a parent row'
                                      }
                                    />
                                    <div className="grid gap-4 min-[620px]:grid-cols-2">
                                      <TextField
                                        label="Duration text"
                                        value={entry.durationText}
                                        onChange={(value) =>
                                          setForm((current) => ({
                                            ...current,
                                            wes: updateAt(current.wes, artifactIndex, (item) => ({
                                              ...item,
                                              entries: updateAt(
                                                item.entries,
                                                entryIndex,
                                                (row) => ({
                                                  ...row,
                                                  durationText: value,
                                                }),
                                              ),
                                            })),
                                          }))
                                        }
                                        required
                                      />
                                      <TextField
                                        label="Position"
                                        value={entry.position}
                                        onChange={(value) =>
                                          setForm((current) => ({
                                            ...current,
                                            wes: updateAt(current.wes, artifactIndex, (item) => ({
                                              ...item,
                                              entries: updateAt(
                                                item.entries,
                                                entryIndex,
                                                (row) => ({
                                                  ...row,
                                                  position: value,
                                                }),
                                              ),
                                            })),
                                          }))
                                        }
                                        required
                                      />
                                      <TextField
                                        label="Office / unit"
                                        value={entry.officeUnit}
                                        onChange={(value) =>
                                          setForm((current) => ({
                                            ...current,
                                            wes: updateAt(current.wes, artifactIndex, (item) => ({
                                              ...item,
                                              entries: updateAt(
                                                item.entries,
                                                entryIndex,
                                                (row) => ({
                                                  ...row,
                                                  officeUnit: value,
                                                }),
                                              ),
                                            })),
                                          }))
                                        }
                                        required
                                      />
                                      <TextField
                                        label="Immediate supervisor"
                                        value={entry.immediateSupervisor}
                                        onChange={(value) =>
                                          setForm((current) => ({
                                            ...current,
                                            wes: updateAt(current.wes, artifactIndex, (item) => ({
                                              ...item,
                                              entries: updateAt(
                                                item.entries,
                                                entryIndex,
                                                (row) => ({
                                                  ...row,
                                                  immediateSupervisor: value,
                                                }),
                                              ),
                                            })),
                                          }))
                                        }
                                        required
                                      />
                                      <TextField
                                        label="Agency / organization / location"
                                        value={entry.agencyOrganizationLocation}
                                        onChange={(value) =>
                                          setForm((current) => ({
                                            ...current,
                                            wes: updateAt(current.wes, artifactIndex, (item) => ({
                                              ...item,
                                              entries: updateAt(
                                                item.entries,
                                                entryIndex,
                                                (row) => ({
                                                  ...row,
                                                  agencyOrganizationLocation: value,
                                                }),
                                              ),
                                            })),
                                          }))
                                        }
                                        required
                                      />
                                    </div>
                                    <TextAreaField
                                      label="Accomplishments / contributions"
                                      value={entry.accomplishments}
                                      onChange={(value) =>
                                        setForm((current) => ({
                                          ...current,
                                          wes: updateAt(current.wes, artifactIndex, (item) => ({
                                            ...item,
                                            entries: updateAt(item.entries, entryIndex, (row) => ({
                                              ...row,
                                              accomplishments: value,
                                            })),
                                          })),
                                        }))
                                      }
                                    />
                                    <TextAreaField
                                      label="Summary of actual duties"
                                      value={entry.actualDuties}
                                      onChange={(value) =>
                                        setForm((current) => ({
                                          ...current,
                                          wes: updateAt(current.wes, artifactIndex, (item) => ({
                                            ...item,
                                            entries: updateAt(item.entries, entryIndex, (row) => ({
                                              ...row,
                                              actualDuties: value,
                                            })),
                                          })),
                                        }))
                                      }
                                      required
                                    />
                                  </div>
                                </RepeatableRow>
                              ))}
                              <Button
                                type="button"
                                variant="secondary"
                                size="default"
                                className="justify-self-start"
                                onClick={() =>
                                  setForm((current) => ({
                                    ...current,
                                    wes: updateAt(current.wes, artifactIndex, (item) => ({
                                      ...item,
                                      entries: [...item.entries, blankWesEntry()],
                                    })),
                                  }))
                                }
                              >
                                Add WES entry
                              </Button>
                            </div>
                          </div>
                        </RepeatableRow>
                      ))}
                      <Button
                        type="button"
                        variant="secondary"
                        size="default"
                        className="justify-self-start"
                        onClick={() =>
                          setForm((current) => ({ ...current, wes: [...current.wes, blankWes()] }))
                        }
                      >
                        Add WES artifact
                      </Button>
                    </div>
                  </FormSection>
                  <FormSection item="26" title="Educational background">
                    <div className="grid gap-4">
                      {form.education.map((record, index) => (
                        <div
                          key={index}
                          className="grid gap-3 rounded-[3px] border border-line bg-[#fafbfd] p-4"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <strong className="text-xs font-[680] text-ink">
                              Education {index + 1}
                            </strong>
                            <RowButtons
                              label="education row"
                              index={index}
                              count={form.education.length}
                              onMove={(offset) =>
                                setForm((current) => ({
                                  ...current,
                                  education: moveRow(current.education, index, offset),
                                }))
                              }
                              onRemove={() =>
                                setForm((current) => ({
                                  ...current,
                                  education: current.education.filter(
                                    (_, recordIndex) => recordIndex !== index,
                                  ),
                                }))
                              }
                            />
                          </div>
                          <div className="grid gap-4 min-[620px]:grid-cols-2">
                            <SelectField
                              label="Education level"
                              value={record.level}
                              onChange={(value) => changeEducation(index, 'level', value)}
                              options={educationLevelOptions}
                              required
                            />
                            <TextField
                              label="Name of school"
                              value={record.schoolName}
                              onChange={(value) => changeEducation(index, 'schoolName', value)}
                              required
                            />
                            <TextField
                              label="Basic education / degree / course"
                              value={record.degreeCourse}
                              onChange={(value) => changeEducation(index, 'degreeCourse', value)}
                              required
                            />
                            <TextField
                              label="Period of attendance"
                              value={record.periodOfAttendance}
                              onChange={(value) =>
                                changeEducation(index, 'periodOfAttendance', value)
                              }
                              required
                            />
                            <TextField
                              label="Highest level / units earned"
                              value={record.highestLevelUnits}
                              onChange={(value) =>
                                changeEducation(index, 'highestLevelUnits', value)
                              }
                            />
                            <TextField
                              label="Year graduated"
                              type="number"
                              min="1900"
                              value={record.yearGraduated}
                              onChange={(value) => changeEducation(index, 'yearGraduated', value)}
                            />
                            <TextField
                              label="Scholarship / academic honors"
                              value={record.honors}
                              onChange={(value) => changeEducation(index, 'honors', value)}
                            />
                            <TextField
                              label="Evidence document ID"
                              value={record.documentId}
                              onChange={(value) => changeEducation(index, 'documentId', value)}
                            />
                            <TextField
                              label="Evidence document version ID"
                              value={record.documentVersionId}
                              onChange={(value) =>
                                changeEducation(index, 'documentVersionId', value)
                              }
                            />
                          </div>
                        </div>
                      ))}
                      <Button
                        type="button"
                        variant="secondary"
                        size="default"
                        className="justify-self-start"
                        onClick={() =>
                          setForm((current) => ({
                            ...current,
                            education: [...current.education, blankEducation()],
                          }))
                        }
                      >
                        Add education row
                      </Button>
                    </div>
                  </FormSection>
                  <FormSection item="27" title="Civil-service eligibility">
                    <div className="grid gap-4">
                      <datalist id="pds-eligibility-categories">
                        {eligibilityCategoryOptions.map((option) => (
                          <option key={option} value={option} />
                        ))}
                      </datalist>
                      {form.eligibility.map((record, index) => (
                        <div
                          key={index}
                          className="grid gap-3 rounded-[3px] border border-line bg-[#fafbfd] p-4"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <strong className="text-xs font-[680] text-ink">
                              Eligibility {index + 1}
                            </strong>
                            <RowButtons
                              label="eligibility row"
                              index={index}
                              count={form.eligibility.length}
                              onMove={(offset) =>
                                setForm((current) => ({
                                  ...current,
                                  eligibility: moveRow(current.eligibility, index, offset),
                                }))
                              }
                              onRemove={() =>
                                setForm((current) => ({
                                  ...current,
                                  eligibility: current.eligibility.filter(
                                    (_, recordIndex) => recordIndex !== index,
                                  ),
                                }))
                              }
                            />
                          </div>
                          <div className="grid gap-4 min-[620px]:grid-cols-2">
                            <TextField
                              label="Eligibility name / category"
                              value={record.eligibilityName}
                              list="pds-eligibility-categories"
                              onChange={(value) =>
                                changeEligibility(index, 'eligibilityName', value)
                              }
                              required
                            />
                            <TextField
                              label="Rating"
                              value={record.rating}
                              onChange={(value) => changeEligibility(index, 'rating', value)}
                            />
                            <TextField
                              label="Date of examination / conferment"
                              type="date"
                              value={record.examDate}
                              onChange={(value) => changeEligibility(index, 'examDate', value)}
                            />
                            <TextField
                              label="Place of examination / conferment"
                              value={record.examPlace}
                              onChange={(value) => changeEligibility(index, 'examPlace', value)}
                            />
                            <TextField
                              label="License number"
                              value={record.licenseNo}
                              onChange={(value) => changeEligibility(index, 'licenseNo', value)}
                            />
                            <TextField
                              label="License date of validity"
                              type="date"
                              value={record.validUntil}
                              onChange={(value) => changeEligibility(index, 'validUntil', value)}
                            />
                            <TextField
                              label="Evidence document ID"
                              value={record.documentId}
                              onChange={(value) => changeEligibility(index, 'documentId', value)}
                            />
                            <TextField
                              label="Evidence document version ID"
                              value={record.documentVersionId}
                              onChange={(value) =>
                                changeEligibility(index, 'documentVersionId', value)
                              }
                            />
                          </div>
                        </div>
                      ))}
                      <Button
                        type="button"
                        variant="secondary"
                        size="default"
                        className="justify-self-start"
                        onClick={() =>
                          setForm((current) => ({
                            ...current,
                            eligibility: [...current.eligibility, blankEligibility()],
                          }))
                        }
                      >
                        Add eligibility row
                      </Button>
                    </div>
                  </FormSection>
                </form>
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="secondary" size="default" disabled={submitting}>
                    Cancel
                  </Button>
                </DialogClose>
                <Button
                  type="submit"
                  form="pds-form"
                  variant="primary"
                  size="default"
                  disabled={submitting}
                >
                  {submitting ? 'Saving…' : 'Save Draft'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </header>

      {message && (
        <p
          role="status"
          className={`mb-5 text-xs ${messageTone === 'ok' ? 'text-[#27633b]' : 'text-[#8f2d2d]'}`}
        >
          {message}
        </p>
      )}

      <div className="mb-5 grid gap-4 min-[761px]:grid-cols-[minmax(0,1.5fr)_minmax(220px,.7fr)]">
        <section
          className="rounded-[5px] border border-line bg-paper"
          aria-labelledby="pds-record-heading"
        >
          <header className="flex min-h-[58px] items-center justify-between gap-4 border-b border-line px-5">
            <div>
              <p className="m-0 font-mono text-[10px] font-bold tracking-[.1em] text-cobalt">C1</p>
              <h2 id="pds-record-heading" className="mt-1 mb-0 text-sm font-[680] text-midnight">
                PDS draft information
              </h2>
            </div>
            {detail && <StatusBadge status={detail.status} />}
          </header>
          {!detail ? (
            <div className="grid gap-2 px-5 py-8">
              <strong className="text-sm font-[650] text-midnight">No Draft PDS yet.</strong>
              <p className="m-0 max-w-[560px] text-sm leading-6 text-muted">
                Create the first Draft to begin recording personal, family, work, voluntary, and
                learning history plus WES rows.
              </p>
            </div>
          ) : detail.fieldScope === 'REDACTED' ? (
            <div className="border-l-2 border-[#d99a32] bg-[#fff9ec] px-5 py-5 text-sm leading-6 text-[#70490f]">
              Personal, family, work, development, and WES fields are withheld for this access
              scope. Version metadata is visible for Agency-safe record history.
            </div>
          ) : (
            <div className="grid gap-7 px-5 py-6 min-[700px]:px-8">
              <dl className="grid gap-x-8 gap-y-5 min-[620px]:grid-cols-3">
                <DetailValue label="Version" value={`v${detail.versionNo}`} />
                <DetailValue label="As of" value={formatEmployeeDate(detail.asOfDate)} />
                <DetailValue label="Form contract" value={detail.formVersion} />
              </dl>
              <div className="grid gap-4">
                <h3 className="m-0 text-xs font-[680] tracking-[.04em] text-cobalt uppercase">
                  Items 1–16
                </h3>
                <dl className="grid gap-x-8 gap-y-5 min-[620px]:grid-cols-3">
                  <DetailValue
                    label="Name"
                    value={
                      personal
                        ? [
                            personal.firstName,
                            personal.middleName,
                            personal.surname,
                            personal.nameExtension,
                          ]
                            .filter(Boolean)
                            .join(' ')
                        : null
                    }
                  />
                  <DetailValue
                    label="Birth date"
                    value={personal?.birthDate ? formatEmployeeDate(personal.birthDate) : null}
                  />
                  <DetailValue label="Birth place" value={personal?.birthPlace} />
                  <DetailValue
                    label="Sex at birth"
                    value={personal?.sex ? titleCase(personal.sex) : null}
                  />
                  <DetailValue
                    label="Civil status"
                    value={personal?.civilStatus ? titleCase(personal.civilStatus) : null}
                  />
                  <DetailValue label="Citizenship" value={personal?.citizenship} />
                  <DetailValue label="Height (m)" value={personal?.heightMeters} />
                  <DetailValue label="Weight (kg)" value={personal?.weightKilograms} />
                  <DetailValue label="Blood type" value={personal?.bloodType} />
                  <DetailValue label="Agency employee no." value={personal?.agencyEmployeeNumber} />
                </dl>
              </div>
              <div className="grid gap-4">
                <h3 className="m-0 text-xs font-[680] tracking-[.04em] text-cobalt uppercase">
                  Items 17–21
                </h3>
                <dl className="grid gap-x-8 gap-y-5 min-[620px]:grid-cols-2">
                  <DetailValue
                    label="Residential address"
                    value={
                      personal?.residentialAddress
                        ? Object.values(personal.residentialAddress).filter(Boolean).join(', ')
                        : null
                    }
                  />
                  <DetailValue
                    label="Permanent address"
                    value={
                      personal?.permanentAddress
                        ? Object.values(personal.permanentAddress).filter(Boolean).join(', ')
                        : null
                    }
                  />
                  <DetailValue label="Telephone" value={personal?.telephoneNumber} />
                  <DetailValue label="Mobile" value={personal?.mobileNumber} />
                  <DetailValue label="Email" value={personal?.emailAddress} />
                </dl>
              </div>
              <div className="grid gap-4">
                <h3 className="m-0 text-xs font-[680] tracking-[.04em] text-cobalt uppercase">
                  Items 22–25 · Family
                </h3>
                <dl className="grid gap-x-8 gap-y-5 min-[620px]:grid-cols-2">
                  <DetailValue label="Spouse" value={family?.spouse?.fullName} />
                  <DetailValue
                    label="Children"
                    value={
                      family
                        ? family.children
                            .map((child) => child.fullName)
                            .filter(Boolean)
                            .join(', ') || null
                        : null
                    }
                  />
                  <DetailValue label="Father" value={family?.father?.fullName} />
                  <DetailValue label="Mother’s maiden name" value={family?.mother?.fullName} />
                </dl>
              </div>
              <div className="grid gap-4">
                <h3 className="m-0 text-xs font-[680] tracking-[.04em] text-cobalt uppercase">
                  Work experience
                </h3>
                {detailWorkExperience.length === 0 ? (
                  <EmptyRows message="No work-experience rows recorded." />
                ) : (
                  <div className="grid gap-4">
                    {detailWorkExperience.map((row, index) => (
                      <div
                        key={row.id ?? `work-${index}`}
                        className="grid gap-4 rounded-[3px] border border-line bg-[#fafbfd] p-4"
                      >
                        <strong className="text-xs font-[680] text-ink">
                          Work experience {index + 1}
                        </strong>
                        <dl className="grid gap-x-8 gap-y-5 min-[620px]:grid-cols-2">
                          <DetailValue
                            label="Inclusive dates"
                            value={sequenceLabel(
                              stringValue(row.inclusiveFrom),
                              stringValue(row.inclusiveTo),
                              Boolean(row.isCurrent),
                            )}
                          />
                          <DetailValue label="Position title" value={row.positionTitle} />
                          <DetailValue
                            label="Department / agency / office / company"
                            value={row.departmentAgencyOfficeCompany}
                          />
                          <DetailValue label="Monthly salary" value={row.monthlySalary} />
                          <DetailValue label="Salary grade / step" value={row.salaryGradeStep} />
                          <DetailValue
                            label="Status of appointment"
                            value={row.appointmentStatus}
                          />
                          <DetailValue
                            label="Government service"
                            value={
                              row.governmentService === 'Y'
                                ? 'Yes'
                                : row.governmentService === 'N'
                                  ? 'No'
                                  : null
                            }
                          />
                          <DetailValue label="Evidence document ID" value={row.documentId} />
                          <DetailValue
                            label="Evidence document version ID"
                            value={row.documentVersionId}
                          />
                        </dl>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="grid gap-4">
                <h3 className="m-0 text-xs font-[680] tracking-[.04em] text-cobalt uppercase">
                  Voluntary work
                </h3>
                {detailVoluntaryWork.length === 0 ? (
                  <EmptyRows message="No voluntary-work rows recorded." />
                ) : (
                  <div className="grid gap-4">
                    {detailVoluntaryWork.map((row, index) => (
                      <div
                        key={row.id ?? `voluntary-${index}`}
                        className="grid gap-4 rounded-[3px] border border-line bg-[#fafbfd] p-4"
                      >
                        <strong className="text-xs font-[680] text-ink">
                          Voluntary work {index + 1}
                        </strong>
                        <dl className="grid gap-x-8 gap-y-5 min-[620px]:grid-cols-2">
                          <DetailValue
                            label="Organization name and address"
                            value={row.organizationNameAddress}
                          />
                          <DetailValue
                            label="Inclusive dates"
                            value={sequenceLabel(
                              stringValue(row.inclusiveFrom),
                              stringValue(row.inclusiveTo),
                            )}
                          />
                          <DetailValue label="Number of hours" value={row.hours} />
                          <DetailValue
                            label="Position / nature of work"
                            value={row.positionNatureOfWork}
                          />
                          <DetailValue label="Evidence document ID" value={row.documentId} />
                          <DetailValue
                            label="Evidence document version ID"
                            value={row.documentVersionId}
                          />
                        </dl>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="grid gap-4">
                <h3 className="m-0 text-xs font-[680] tracking-[.04em] text-cobalt uppercase">
                  Learning and development
                </h3>
                {detailLearningAndDevelopment.length === 0 ? (
                  <EmptyRows message="No learning-and-development rows recorded." />
                ) : (
                  <div className="grid gap-4">
                    {detailLearningAndDevelopment.map((row, index) => (
                      <div
                        key={row.id ?? `learning-${index}`}
                        className="grid gap-4 rounded-[3px] border border-line bg-[#fafbfd] p-4"
                      >
                        <strong className="text-xs font-[680] text-ink">
                          Learning and development {index + 1}
                        </strong>
                        <dl className="grid gap-x-8 gap-y-5 min-[620px]:grid-cols-2">
                          <DetailValue
                            label="Intervention / training title"
                            value={row.interventionTitle}
                          />
                          <DetailValue
                            label="Attendance dates"
                            value={sequenceLabel(
                              stringValue(row.attendanceFrom),
                              stringValue(row.attendanceTo),
                            )}
                          />
                          <DetailValue label="Number of hours" value={row.hours} />
                          <DetailValue label="Type" value={row.type} />
                          <DetailValue
                            label="Conducted / sponsored by"
                            value={row.conductedSponsoredBy}
                          />
                          <DetailValue label="Evidence document ID" value={row.documentId} />
                          <DetailValue
                            label="Evidence document version ID"
                            value={row.documentVersionId}
                          />
                        </dl>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="grid gap-4">
                <h3 className="m-0 text-xs font-[680] tracking-[.04em] text-cobalt uppercase">
                  Work Experience Sheet
                </h3>
                {detailWes.length === 0 ? (
                  <EmptyRows message="No Work Experience Sheet artifacts recorded." />
                ) : (
                  <div className="grid gap-4">
                    {detailWes.map((artifact, artifactIndex) => (
                      <div
                        key={artifact.id ?? `wes-${artifactIndex}`}
                        className="grid gap-4 rounded-[3px] border border-line bg-[#fafbfd] p-4"
                      >
                        <strong className="text-xs font-[680] text-ink">
                          WES artifact {artifactIndex + 1}
                        </strong>
                        <dl className="grid gap-x-8 gap-y-5 min-[620px]:grid-cols-2">
                          <DetailValue label="Context key" value={artifact.contextKey} />
                          <DetailValue label="Evidence document ID" value={artifact.documentId} />
                          <DetailValue
                            label="Evidence document version ID"
                            value={artifact.documentVersionId}
                          />
                        </dl>
                        <div className="grid gap-4">
                          {artifact.entries.map((entry, entryIndex) => {
                            const parent = detailWorkExperience.find(
                              (row) =>
                                (entry.workExperienceId && row.id === entry.workExperienceId) ||
                                (!entry.workExperienceId &&
                                  entry.workExperienceSequenceNo === row.sequenceNo),
                            );
                            return (
                              <div
                                key={entry.id ?? `wes-entry-${entryIndex}`}
                                className="grid gap-4 rounded-[3px] border border-line bg-paper p-4"
                              >
                                <strong className="text-xs font-[680] text-ink">
                                  WES entry {entryIndex + 1}
                                </strong>
                                <dl className="grid gap-x-8 gap-y-5 min-[620px]:grid-cols-2">
                                  <DetailValue
                                    label="Parent work row"
                                    value={
                                      parent
                                        ? [
                                            parent.positionTitle,
                                            parent.departmentAgencyOfficeCompany,
                                          ]
                                            .filter(Boolean)
                                            .join(' · ') || `Work experience ${parent.sequenceNo}`
                                        : (entry.workExperienceId ?? entry.workExperienceSequenceNo)
                                    }
                                  />
                                  <DetailValue label="Duration text" value={entry.durationText} />
                                  <DetailValue label="Position" value={entry.position} />
                                  <DetailValue label="Office / unit" value={entry.officeUnit} />
                                  <DetailValue
                                    label="Immediate supervisor"
                                    value={entry.immediateSupervisor}
                                  />
                                  <DetailValue
                                    label="Agency / organization / location"
                                    value={entry.agencyOrganizationLocation}
                                  />
                                  <DetailValue
                                    label="Accomplishments / contributions"
                                    value={entry.accomplishments}
                                  />
                                  <DetailValue
                                    label="Summary of actual duties"
                                    value={entry.actualDuties}
                                  />
                                </dl>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="grid gap-4">
                <h3 className="m-0 text-xs font-[680] tracking-[.04em] text-cobalt uppercase">
                  Item 26 · Education
                </h3>
                {education.length ? (
                  <div className="grid gap-3">
                    {education.map((record, index) => (
                      <dl
                        key={record.id ?? index}
                        className="grid gap-x-8 gap-y-5 rounded-[3px] border border-line bg-[#fafbfd] p-4 min-[620px]:grid-cols-3"
                      >
                        <DetailValue label="Level" value={record.level} />
                        <DetailValue label="School" value={record.schoolName} />
                        <DetailValue label="Degree / course" value={record.degreeCourse} />
                        <DetailValue
                          label="Period of attendance"
                          value={record.periodOfAttendance}
                        />
                        <DetailValue
                          label="Highest level / units"
                          value={record.highestLevelUnits}
                        />
                        <DetailValue label="Year graduated" value={record.yearGraduated} />
                        <DetailValue label="Honors" value={record.honors} />
                        <DetailValue label="Document ID" value={record.documentId} />
                        <DetailValue label="Document version ID" value={record.documentVersionId} />
                      </dl>
                    ))}
                  </div>
                ) : (
                  <p className="m-0 text-sm text-muted">No education rows recorded.</p>
                )}
              </div>
              <div className="grid gap-4">
                <h3 className="m-0 text-xs font-[680] tracking-[.04em] text-cobalt uppercase">
                  Item 27 · Eligibility
                </h3>
                {eligibility.length ? (
                  <div className="grid gap-3">
                    {eligibility.map((record, index) => (
                      <dl
                        key={record.id ?? index}
                        className="grid gap-x-8 gap-y-5 rounded-[3px] border border-line bg-[#fafbfd] p-4 min-[620px]:grid-cols-3"
                      >
                        <DetailValue
                          label="Eligibility / category"
                          value={record.eligibilityName}
                        />
                        <DetailValue label="Rating" value={record.rating} />
                        <DetailValue
                          label="Exam / conferment date"
                          value={record.examDate ? formatEmployeeDate(record.examDate) : null}
                        />
                        <DetailValue label="Exam / conferment place" value={record.examPlace} />
                        <DetailValue label="License number" value={record.licenseNo} />
                        <DetailValue
                          label="Valid until"
                          value={record.validUntil ? formatEmployeeDate(record.validUntil) : null}
                        />
                        <DetailValue label="Document ID" value={record.documentId} />
                        <DetailValue label="Document version ID" value={record.documentVersionId} />
                      </dl>
                    ))}
                  </div>
                ) : (
                  <p className="m-0 text-sm text-muted">No eligibility rows recorded.</p>
                )}
              </div>
            </div>
          )}
        </section>

        <section
          className="rounded-[5px] border border-line bg-paper"
          aria-labelledby="pds-history-heading"
        >
          <header className="flex min-h-[58px] items-center border-b border-line px-5">
            <div>
              <p className="m-0 font-mono text-[10px] font-bold tracking-[.1em] text-cobalt">
                RECORD HISTORY
              </p>
              <h2 id="pds-history-heading" className="mt-1 mb-0 text-sm font-[680] text-midnight">
                Versions
              </h2>
            </div>
          </header>
          {list.versions.length === 0 ? (
            <p className="m-0 px-5 py-6 text-sm text-muted">No versions recorded.</p>
          ) : (
            <ul className="m-0 list-none p-0">
              {list.versions.map((version) => (
                <li
                  key={version.id}
                  className="flex items-center justify-between gap-3 border-b border-line px-5 py-4 last:border-b-0"
                >
                  <div className="grid gap-1">
                    <strong className="font-mono text-xs text-midnight">
                      v{version.versionNo}
                    </strong>
                    <span className="text-xs text-muted">
                      As of {formatEmployeeDate(version.asOfDate)}
                    </span>
                  </div>
                  <StatusBadge status={version.status} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <p className="m-0 border-l-2 border-[#d99a32] bg-[#fff9ec] px-4 py-3 text-xs leading-5 text-[#70490f]">
        Submission, verification, certification, generated output, and later PDS correction are
        separate workflows and are not available in this Draft maintenance slice.
      </p>
    </>
  );
}
