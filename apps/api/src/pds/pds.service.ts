import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { hasPermission, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { requestDatabaseContext } from '../database-context';
import { DocumentsService } from '../documents/documents.service';
import { ownEmployeeId, resolveEmployeeScope, scopeCovers } from '../employee-scope';
import {
  PDS_FORM_VERSION,
  PDS_CITIZENSHIP_COUNTRIES,
  PDS_EDUCATION_LEVELS,
  PDS_CONTINUATION_PAGE_KEYS,
  PDS_MAIN_PAGE_KEYS,
  PDS_PAGE_KEYS,
  pdsEducationSchema,
  pdsEligibilitySchema,
  pdsPersonalDetailsSchema,
  type PdsCertificationDetailsInput,
  type PdsCreateInput,
  type PdsDeclarationDetailsInput,
  type PdsEducationInput,
  type PdsEmployeeCertificationInput,
  type PdsEligibilityInput,
  type PdsFamilyInput,
  type PdsLearningDevelopmentInput,
  type PdsOtherInformationInput,
  type PdsPageSignatureInput,
  type PdsPersonalDetailsInput,
  type PdsReasonInput,
  type PdsReferenceRecordInput,
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
  signatureDocumentId: string | null;
  signatureDocumentVersionId: string | null;
  signedAt: string | null;
  entries: PdsWesEntryView[];
}

export interface PdsOtherInformationView {
  skillsAndHobbies: string | null;
  nonAcademicDistinctions: string | null;
  associationMemberships: string | null;
}

export interface PdsDeclarationDetailsView {
  relatedWithinThirdDegree: boolean | null;
  relatedWithinFourthDegreeLgu: boolean | null;
  relationshipDetails: string | null;
  relatedWithinFourthDegreeDetails: string | null;
  foundGuiltyAdministrativeOffense: boolean | null;
  administrativeOffenseDetails: string | null;
  criminallyCharged: boolean | null;
  criminalChargeDetails: string | null;
  criminalChargeDateFiled: string | null;
  criminalChargeDateFiledUnknown: boolean | null;
  criminalChargeStatus: string | null;
  convictedOfCrime: boolean | null;
  convictionDetails: string | null;
  separatedFromService: boolean | null;
  separationMode: string | null;
  separationDetails: string | null;
  candidateInLastElection: boolean | null;
  candidacyDetails: string | null;
  resignedBeforeElection: boolean | null;
  resignationDetails: string | null;
  immigrantOrPermanentResident: boolean | null;
  immigrantCountry: string | null;
  immigrantDetails: string | null;
  indigenousGroupMember: boolean | null;
  indigenousGroupDetails: string | null;
  personWithDisability: boolean | null;
  disabilitySpecification: string | null;
  disabilityIdNumber: string | null;
  soloParent: boolean | null;
  soloParentSpecification: string | null;
  soloParentIdNumber: string | null;
}

export interface PdsReferenceRecordView {
  id: string;
  sequenceNo: number;
  name: string;
  address: string;
  contact: string;
}

export interface PdsCertificationDetailsView {
  truthDeclarationAccepted: boolean | null;
  verificationAuthorizationAccepted: boolean | null;
  misrepresentationWarningAccepted: boolean | null;
  photoDocumentId: string | null;
  photoDocumentVersionId: string | null;
  governmentIdType: string | null;
  governmentIdNumber: string | null;
  governmentIdIssuedAt: string | null;
  governmentIdIssuedPlace: string | null;
  employeeSignatureDocumentId: string | null;
  employeeSignatureDocumentVersionId: string | null;
  employeeSignatureDate: string | null;
  thumbmarkDocumentId: string | null;
  thumbmarkDocumentVersionId: string | null;
  subscribedAndSwornText: string | null;
  subscribedAndSwornAt: string | null;
  oathAdministeredBy: string | null;
  oathAdminSignatureDocumentId: string | null;
  oathAdminSignatureDocumentVersionId: string | null;
  oathAdministeredAt: string | null;
}

export interface PdsPageSignatureView {
  id: string;
  pageKey: (typeof PDS_PAGE_KEYS)[number];
  signatureDocumentId: string | null;
  signatureDocumentVersionId: string | null;
  signedAt: string | null;
  signatureDate: string | null;
}

export interface PdsTransitionEventView {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  action: string;
  actorUserId: string;
  actorMembershipId: string;
  reason: string | null;
  occurredAt: string;
}

export interface PdsOutputArtifactView {
  id: string;
  outputKey: string;
  outputType: 'PDS' | 'WES';
  formVersion: string;
  templateVersion: string | null;
  sourceArtifactId: string;
  sourceArtifactHash: string;
  generatedAt: string;
  dataAsOfDate: string;
  status: string;
  renderingMetadata: Record<string, unknown>;
  signatureMetadata: Record<string, unknown> | null;
  renderedContent: Record<string, unknown> | null;
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
  employeeCertifiedAt: string | null;
  employeeCertifiedByMembershipId: string | null;
  hrVerifiedAt: string | null;
  hrVerifiedByMembershipId: string | null;
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
  otherInformation: PdsOtherInformationView | null;
  declarations: PdsDeclarationDetailsView | null;
  references: PdsReferenceRecordView[];
  certification: PdsCertificationDetailsView | null;
  pageSignatures: PdsPageSignatureView[];
  transitions: PdsTransitionEventView[];
}

export interface PdsOutputArtifactList {
  pdsVersionId: string;
  fieldScope: PdsFieldScope;
  outputs: PdsOutputArtifactView[];
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
      'status',
      'previousStatus',
      'newStatus',
      'reasonCode',
      'outputCount',
      'artifactCount',
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
    readonly fields?: Record<string, string>,
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
  employeeCertifiedAt: true,
  employeeCertifiedByMembershipId: true,
  hrVerifiedAt: true,
  hrVerifiedByMembershipId: true,
  createdByMembershipId: true,
  createdAt: true,
  updatedByMembershipId: true,
  updatedAt: true,
  rowVersion: true,
} as unknown as Prisma.PdsVersionSelect;

const pdsSelect = {
  ...pdsSummarySelect,
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
      employeeSignatureDocumentId: true,
      employeeSignatureDocumentVersionId: true,
      signedAt: true,
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
  otherInformation: {
    select: {
      skillsAndHobbies: true,
      nonAcademicDistinctions: true,
      associationMemberships: true,
    },
  },
  declarationDetails: {
    select: {
      relatedWithinThirdDegree: true,
      relatedWithinFourthDegreeLgu: true,
      relationshipDetails: true,
      relatedWithinFourthDegreeDetails: true,
      foundGuiltyAdministrativeOffense: true,
      administrativeOffenseDetails: true,
      criminallyCharged: true,
      criminalChargeDetails: true,
      criminalChargeDateFiled: true,
      criminalChargeDateFiledUnknown: true,
      criminalChargeStatus: true,
      convictedOfCrime: true,
      convictionDetails: true,
      separatedFromService: true,
      separationMode: true,
      separationDetails: true,
      candidateInLastElection: true,
      candidacyDetails: true,
      resignedBeforeElection: true,
      resignationDetails: true,
      immigrantOrPermanentResident: true,
      immigrantCountry: true,
      immigrantDetails: true,
      indigenousGroupMember: true,
      indigenousGroupDetails: true,
      personWithDisability: true,
      disabilitySpecification: true,
      disabilityIdNumber: true,
      soloParent: true,
      soloParentSpecification: true,
      soloParentIdNumber: true,
    },
  },
  referenceRecords: {
    orderBy: { sequenceNo: 'asc' },
    select: { id: true, sequenceNo: true, name: true, address: true, contact: true },
  },
  certificationDetails: {
    select: {
      truthDeclarationAccepted: true,
      verificationAuthorizationAccepted: true,
      misrepresentationWarningAccepted: true,
      photoDocumentId: true,
      photoDocumentVersionId: true,
      governmentIdType: true,
      governmentIdNumber: true,
      governmentIdIssuedAt: true,
      governmentIdIssuedPlace: true,
      employeeSignatureDocumentId: true,
      employeeSignatureDocumentVersionId: true,
      employeeSignatureDate: true,
      thumbmarkDocumentId: true,
      thumbmarkDocumentVersionId: true,
      subscribedAndSwornText: true,
      subscribedAndSwornAt: true,
      oathAdministeredBy: true,
      oathAdminSignatureDocumentId: true,
      oathAdminSignatureDocumentVersionId: true,
      oathAdministeredAt: true,
    },
  },
  pageSignatures: {
    orderBy: { pageKey: 'asc' },
    select: {
      id: true,
      pageKey: true,
      signatureDocumentId: true,
      signatureDocumentVersionId: true,
      signedAt: true,
      signatureDate: true,
    },
  },
  transitionEvents: {
    orderBy: { occurredAt: 'asc' },
    select: {
      id: true,
      fromStatus: true,
      toStatus: true,
      action: true,
      actorUserId: true,
      actorMembershipId: true,
      reason: true,
      occurredAt: true,
    },
  },
} as unknown as Prisma.PdsVersionSelect;

const pdsRedactedSelect = {
  ...pdsSummarySelect,
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
} as unknown as Prisma.PdsVersionSelect;

type DecimalLike = {
  toNumber(): number;
};

type PdsSummaryRecord = {
  id: string;
  agencyId: string;
  employeeId: string;
  versionNo: number;
  formVersion: string;
  asOfDate: Date;
  status: string;
  supersedesVersionId: string | null;
  correctionReason: string | null;
  employeeCertifiedAt: Date | null;
  employeeCertifiedByMembershipId: string | null;
  hrVerifiedAt: Date | null;
  hrVerifiedByMembershipId: string | null;
  createdByMembershipId: string;
  createdAt: Date;
  updatedByMembershipId: string;
  updatedAt: Date;
  rowVersion: number;
};

type PdsPersonalRecord = {
  surname: string | null;
  firstName: string | null;
  nameExtension: string | null;
  middleName: string | null;
  birthDate: Date | null;
  birthPlace: string | null;
  sex: string | null;
  civilStatus: string | null;
  civilStatusDetail: string | null;
  heightMeters: DecimalLike | null;
  weightKilograms: DecimalLike | null;
  bloodType: string | null;
  citizenship: string | null;
  dualCitizenshipType: string | null;
  dualCitizenshipCountry: string | null;
  residentialAddress: Prisma.JsonValue | null;
  permanentAddress: Prisma.JsonValue | null;
  telephoneNumber: string | null;
  mobileNumber: string | null;
  emailAddress: string | null;
};

type PdsFamilyRecord = {
  id: string;
  relationshipType: string;
  sequenceNo: number;
  fullName: string | null;
  surname: string | null;
  firstName: string | null;
  middleName: string | null;
  nameExtension: string | null;
  birthDate: Date | null;
  occupation: string | null;
  employerBusinessName: string | null;
  businessAddress: Prisma.JsonValue | null;
  telephoneNumber: string | null;
};

type PdsEducationRecord = {
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
};

type PdsEligibilityRecord = {
  id: string;
  sequenceNo: number;
  eligibilityName: string;
  rating: string | null;
  examDate: Date | null;
  examPlace: string;
  licenseNo: string | null;
  validUntil: Date | null;
  documentId: string | null;
  documentVersionId: string | null;
};

type PdsWorkExperienceRecord = {
  id: string;
  sequenceNo: number;
  inclusiveFrom: Date | null;
  inclusiveTo: Date | null;
  positionTitle: string | null;
  departmentAgencyOfficeCompany: string | null;
  monthlySalary: DecimalLike | null;
  salaryGradeStep: string | null;
  appointmentStatus: string | null;
  governmentService: string | null;
  isCurrent: boolean;
  documentId: string | null;
  documentVersionId: string | null;
};

type PdsVoluntaryWorkRecord = {
  id: string;
  sequenceNo: number;
  organizationNameAddress: string | null;
  inclusiveFrom: Date | null;
  inclusiveTo: Date | null;
  hours: DecimalLike | null;
  positionNatureOfWork: string | null;
  documentId: string | null;
  documentVersionId: string | null;
};

type PdsLearningDevelopmentRecord = {
  id: string;
  sequenceNo: number;
  interventionTitle: string | null;
  attendanceFrom: Date | null;
  attendanceTo: Date | null;
  hours: DecimalLike | null;
  type: string | null;
  conductedSponsoredBy: string | null;
  documentId: string | null;
  documentVersionId: string | null;
};

type PdsWesEntryRecord = {
  id: string;
  workExperienceId: string;
  sequenceNo: number;
  durationText: string | null;
  position: string;
  officeUnit: string;
  immediateSupervisor: string;
  agencyOrganizationLocation: string;
  accomplishments: string | null;
  actualDuties: string;
};

type PdsWesArtifactRecord = {
  id: string;
  contextKey: string;
  templateVersion: string;
  status: string;
  documentId: string | null;
  documentVersionId: string | null;
  employeeSignatureDocumentId: string | null;
  employeeSignatureDocumentVersionId: string | null;
  signedAt: Date | null;
  entries: PdsWesEntryRecord[];
};

type PdsDeclarationDetailsRecord = Omit<PdsDeclarationDetailsView, 'criminalChargeDateFiled'> & {
  criminalChargeDateFiled: Date | null;
};

type PdsCertificationDetailsRecord = Omit<
  PdsCertificationDetailsView,
  'governmentIdIssuedAt' | 'employeeSignatureDate' | 'subscribedAndSwornAt' | 'oathAdministeredAt'
> & {
  governmentIdIssuedAt: Date | null;
  employeeSignatureDate: Date | null;
  subscribedAndSwornAt: Date | null;
  oathAdministeredAt: Date | null;
};

type PdsPageSignatureRecord = Omit<PdsPageSignatureView, 'signedAt' | 'signatureDate'> & {
  signedAt: Date | null;
  signatureDate: Date | null;
};

type PdsTransitionEventRecord = {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  action: string;
  actorUserId: string;
  actorMembershipId: string;
  reason: string | null;
  occurredAt: Date;
};

type PdsRecord = PdsSummaryRecord & {
  personalDetails: PdsPersonalRecord | null;
  familyRecords: PdsFamilyRecord[];
  educationRecords: PdsEducationRecord[];
  eligibilityRecords: PdsEligibilityRecord[];
  workExperienceRecords: PdsWorkExperienceRecord[];
  voluntaryWorkRecords: PdsVoluntaryWorkRecord[];
  learningDevelopmentRecords: PdsLearningDevelopmentRecord[];
  wesArtifacts: PdsWesArtifactRecord[];
  otherInformation: PdsOtherInformationView | null;
  declarationDetails: PdsDeclarationDetailsRecord | null;
  referenceRecords: PdsReferenceRecordView[];
  certificationDetails: PdsCertificationDetailsRecord | null;
  pageSignatures: PdsPageSignatureRecord[];
  transitionEvents: PdsTransitionEventRecord[];
};

type PdsRedactedRecord = PdsSummaryRecord & {
  educationRecords: PdsEducationRecord[];
  eligibilityRecords: PdsEligibilityRecord[];
};

type PdsOutputRecord = {
  id: string;
  outputKey: string;
  outputType: string;
  formVersion: string;
  templateVersion: string | null;
  sourceArtifactId: string;
  sourceArtifactHash: string;
  generatedAt: Date;
  dataAsOfDate: Date;
  status: string;
  renderingMetadata: Prisma.JsonValue | null;
  signatureMetadata: Prisma.JsonValue | null;
  renderedContent: Prisma.JsonValue | null;
};

const PDS_EDUCATION_LEVEL_ORDER = new Map(
  PDS_EDUCATION_LEVELS.map((level, index) => [level, index]),
);
type PendingPdsDelegate<TResult = unknown> = {
  create(args: unknown): Promise<TResult>;
  createMany(args: unknown): Promise<unknown>;
  deleteMany(args: unknown): Promise<unknown>;
  findMany(args: unknown): Promise<TResult[]>;
  upsert(args: unknown): Promise<TResult>;
};

type PdsExtraClient = Prisma.TransactionClient & {
  pdsOtherInformation: PendingPdsDelegate;
  pdsDeclarationDetails: PendingPdsDelegate;
  pdsReferenceRecord: PendingPdsDelegate;
  pdsCertificationDetails: PendingPdsDelegate;
  pdsPageSignature: PendingPdsDelegate;
  pdsTransitionEvent: PendingPdsDelegate;
  pdsOutputArtifact: PendingPdsDelegate<PdsOutputRecord>;
};

function pdsExtra(transaction: Prisma.TransactionClient): PdsExtraClient {
  return transaction as PdsExtraClient;
}

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

function dateTimeValue(value: string | null | undefined): Date | null {
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    throw new PdsServiceError('The PDS date-time value is invalid.', 400, 'PDS_DATE_INVALID');
  }
  return date;
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

function otherInformationData(
  agencyId: string,
  pdsVersionId: string,
  input: PdsOtherInformationInput,
) {
  return {
    agencyId,
    pdsVersionId,
    skillsAndHobbies: text(input.skillsAndHobbies),
    nonAcademicDistinctions: text(input.nonAcademicDistinctions),
    associationMemberships: text(input.associationMemberships),
  };
}

function declarationData(
  agencyId: string,
  pdsVersionId: string,
  input: PdsDeclarationDetailsInput,
) {
  return {
    agencyId,
    pdsVersionId,
    relatedWithinThirdDegree: input.relatedWithinThirdDegree ?? null,
    relatedWithinFourthDegreeLgu: input.relatedWithinFourthDegreeLgu ?? null,
    relationshipDetails: text(input.relationshipDetails),
    relatedWithinFourthDegreeDetails: text(input.relatedWithinFourthDegreeDetails),
    foundGuiltyAdministrativeOffense: input.foundGuiltyAdministrativeOffense ?? null,
    administrativeOffenseDetails: text(input.administrativeOffenseDetails),
    criminallyCharged: input.criminallyCharged ?? null,
    criminalChargeDetails: text(input.criminalChargeDetails),
    criminalChargeDateFiled: dateValue(input.criminalChargeDateFiled),
    criminalChargeDateFiledUnknown: input.criminalChargeDateFiledUnknown ?? null,
    criminalChargeStatus: text(input.criminalChargeStatus),
    convictedOfCrime: input.convictedOfCrime ?? null,
    convictionDetails: text(input.convictionDetails),
    separatedFromService: input.separatedFromService ?? null,
    separationMode: text(input.separationMode),
    separationDetails: text(input.separationDetails),
    candidateInLastElection: input.candidateInLastElection ?? null,
    candidacyDetails: text(input.candidacyDetails),
    resignedBeforeElection: input.resignedBeforeElection ?? null,
    resignationDetails: text(input.resignationDetails),
    immigrantOrPermanentResident: input.immigrantOrPermanentResident ?? null,
    immigrantCountry: input.immigrantCountry ?? null,
    immigrantDetails: text(input.immigrantDetails),
    indigenousGroupMember: input.indigenousGroupMember ?? null,
    indigenousGroupDetails: text(input.indigenousGroupDetails),
    personWithDisability: input.personWithDisability ?? null,
    disabilitySpecification: text(input.disabilitySpecification),
    disabilityIdNumber: text(input.disabilityIdNumber),
    soloParent: input.soloParent ?? null,
    soloParentSpecification: text(input.soloParentSpecification),
    soloParentIdNumber: text(input.soloParentIdNumber),
  };
}

function referenceData(
  agencyId: string,
  pdsVersionId: string,
  rows: readonly PdsReferenceRecordInput[],
) {
  const seen = new Set<number>();
  return rows.map((row, index) => ({
    ...(row.id ? { id: row.id } : {}),
    agencyId,
    pdsVersionId,
    sequenceNo: sectionSequence(row.sequenceNo, index, 'Reference', seen),
    name: requiredTextValue(row.name, 'Reference name'),
    address: requiredTextValue(row.address, 'Reference address'),
    contact: requiredTextValue(row.contact, 'Reference contact'),
  }));
}

function certificationData(
  agencyId: string,
  pdsVersionId: string,
  input: PdsCertificationDetailsInput,
) {
  return {
    agencyId,
    pdsVersionId,
    truthDeclarationAccepted: input.truthDeclarationAccepted ?? null,
    verificationAuthorizationAccepted: input.verificationAuthorizationAccepted ?? null,
    misrepresentationWarningAccepted: input.misrepresentationWarningAccepted ?? null,
    photoDocumentId: input.photoDocumentId ?? null,
    photoDocumentVersionId: input.photoDocumentVersionId ?? null,
    governmentIdType: text(input.governmentIdType),
    governmentIdNumber: text(input.governmentIdNumber),
    governmentIdIssuedAt: dateValue(input.governmentIdIssuedAt),
    governmentIdIssuedPlace: text(input.governmentIdIssuedPlace),
    employeeSignatureDocumentId: input.employeeSignatureDocumentId ?? null,
    employeeSignatureDocumentVersionId: input.employeeSignatureDocumentVersionId ?? null,
    employeeSignatureDate: dateValue(input.employeeSignatureDate),
    thumbmarkDocumentId: input.thumbmarkDocumentId ?? null,
    thumbmarkDocumentVersionId: input.thumbmarkDocumentVersionId ?? null,
    subscribedAndSwornText: text(input.subscribedAndSwornText),
    subscribedAndSwornAt: dateTimeValue(input.subscribedAndSwornAt),
    oathAdministeredBy: text(input.oathAdministeredBy),
    oathAdminSignatureDocumentId: input.oathAdminSignatureDocumentId ?? null,
    oathAdminSignatureDocumentVersionId: input.oathAdminSignatureDocumentVersionId ?? null,
    oathAdministeredAt: dateTimeValue(input.oathAdministeredAt),
  };
}

function pageSignatureData(
  agencyId: string,
  pdsVersionId: string,
  rows: readonly PdsPageSignatureInput[],
) {
  const seen = new Set<string>();
  return rows.map((row) => {
    if (seen.has(row.pageKey)) {
      throw new PdsServiceError(
        'PDS page signatures must be unique within this PDS Version.',
        400,
        'PDS_PAGE_SIGNATURE_CONFLICT',
      );
    }
    seen.add(row.pageKey);
    return {
      ...(row.id ? { id: row.id } : {}),
      agencyId,
      pdsVersionId,
      pageKey: row.pageKey,
      signatureDocumentId: row.signatureDocumentId ?? null,
      signatureDocumentVersionId: row.signatureDocumentVersionId ?? null,
      signedAt: dateTimeValue(row.signedAt),
      signatureDate: dateValue(row.signatureDate),
    };
  });
}

function evidenceInputsFromCompletion(input: PdsCreateInput | PdsUpdateInput): EvidenceInput[] {
  const evidence: EvidenceInput[] = [];
  for (const wes of input.wes ?? []) {
    evidence.push(wes, {
      documentId: wes.signatureDocumentId,
      documentVersionId: wes.signatureDocumentVersionId,
    });
  }
  if (input.certification) {
    evidence.push(
      {
        documentId: input.certification.photoDocumentId,
        documentVersionId: input.certification.photoDocumentVersionId,
      },
      {
        documentId: input.certification.employeeSignatureDocumentId,
        documentVersionId: input.certification.employeeSignatureDocumentVersionId,
      },
      {
        documentId: input.certification.thumbmarkDocumentId,
        documentVersionId: input.certification.thumbmarkDocumentVersionId,
      },
      {
        documentId: input.certification.oathAdminSignatureDocumentId,
        documentVersionId: input.certification.oathAdminSignatureDocumentVersionId,
      },
    );
  }
  for (const signature of input.pageSignatures ?? []) {
    evidence.push({
      documentId: signature.signatureDocumentId,
      documentVersionId: signature.signatureDocumentVersionId,
    });
  }
  return evidence;
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
    spouse:
      views.find((record: PdsFamilyRecordView) => record.relationshipType === 'SPOUSE') ?? null,
    children: views.filter((record: PdsFamilyRecordView) => record.relationshipType === 'CHILD'),
    father:
      views.find((record: PdsFamilyRecordView) => record.relationshipType === 'FATHER') ?? null,
    mother:
      views.find((record: PdsFamilyRecordView) => record.relationshipType === 'MOTHER') ?? null,
  };
}

function educationView(records: PdsRecord['educationRecords']): PdsEducationRecordView[] {
  return [...records]
    .sort(compareEducationRecords)
    .map((record: PdsRecord['educationRecords'][number]) => ({
      id: record.id,
      level: record.level,
      sequenceNo: record.sequenceNo,
      schoolName: record.schoolName,
      degreeCourse: record.degreeCourse,
      periodOfAttendance: record.periodOfAttendance,
      highestLevelUnits: record.highestLevelUnits,
      yearGraduated: record.yearGraduated,
      honors: record.honors,
      documentId: record.documentId ?? null,
      documentVersionId: record.documentVersionId ?? null,
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
  return [...records]
    .sort(compareEducationRecords)
    .map((record: PdsRedactedRecord['educationRecords'][number]) => ({
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
  return records.map((record: PdsRecord['eligibilityRecords'][number]) => ({
    id: record.id,
    sequenceNo: record.sequenceNo,
    eligibilityName: record.eligibilityName,
    rating: record.rating ?? null,
    examDate: formatDate(record.examDate),
    examPlace: record.examPlace,
    licenseNo: record.licenseNo ?? null,
    validUntil: formatDate(record.validUntil ?? null),
    documentId: record.documentId ?? null,
    documentVersionId: record.documentVersionId ?? null,
  }));
}

function redactedEligibilityView(
  records: PdsRedactedRecord['eligibilityRecords'],
): PdsEligibilityRecordView[] {
  return records.map((record: PdsRedactedRecord['eligibilityRecords'][number]) => ({
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
    signatureDocumentId: record.employeeSignatureDocumentId ?? null,
    signatureDocumentVersionId: record.employeeSignatureDocumentVersionId ?? null,
    signedAt: formatDate(record.signedAt),
    entries: record.entries.map(wesEntryView),
  };
}

function otherInformationView(
  record: PdsRecord['otherInformation'],
): PdsOtherInformationView | null {
  if (!record) return null;
  return {
    skillsAndHobbies: record.skillsAndHobbies,
    nonAcademicDistinctions: record.nonAcademicDistinctions,
    associationMemberships: record.associationMemberships,
  };
}

function declarationDetailsView(
  record: PdsRecord['declarationDetails'],
): PdsDeclarationDetailsView | null {
  if (!record) return null;
  return {
    relatedWithinThirdDegree: record.relatedWithinThirdDegree,
    relatedWithinFourthDegreeLgu: record.relatedWithinFourthDegreeLgu,
    relationshipDetails: record.relationshipDetails,
    relatedWithinFourthDegreeDetails: record.relatedWithinFourthDegreeDetails,
    foundGuiltyAdministrativeOffense: record.foundGuiltyAdministrativeOffense,
    administrativeOffenseDetails: record.administrativeOffenseDetails,
    criminallyCharged: record.criminallyCharged,
    criminalChargeDetails: record.criminalChargeDetails,
    criminalChargeDateFiled: formatDate(record.criminalChargeDateFiled),
    criminalChargeDateFiledUnknown: record.criminalChargeDateFiledUnknown,
    criminalChargeStatus: record.criminalChargeStatus,
    convictedOfCrime: record.convictedOfCrime,
    convictionDetails: record.convictionDetails,
    separatedFromService: record.separatedFromService,
    separationMode: record.separationMode,
    separationDetails: record.separationDetails,
    candidateInLastElection: record.candidateInLastElection,
    candidacyDetails: record.candidacyDetails,
    resignedBeforeElection: record.resignedBeforeElection,
    resignationDetails: record.resignationDetails,
    immigrantOrPermanentResident: record.immigrantOrPermanentResident,
    immigrantCountry: record.immigrantCountry,
    immigrantDetails: record.immigrantDetails,
    indigenousGroupMember: record.indigenousGroupMember,
    indigenousGroupDetails: record.indigenousGroupDetails,
    personWithDisability: record.personWithDisability,
    disabilitySpecification: record.disabilitySpecification,
    disabilityIdNumber: record.disabilityIdNumber,
    soloParent: record.soloParent,
    soloParentSpecification: record.soloParentSpecification,
    soloParentIdNumber: record.soloParentIdNumber,
  };
}

function referenceRecordView(
  record: PdsRecord['referenceRecords'][number],
): PdsReferenceRecordView {
  return {
    id: record.id,
    sequenceNo: record.sequenceNo,
    name: record.name,
    address: record.address,
    contact: record.contact,
  };
}

function certificationDetailsView(
  record: PdsRecord['certificationDetails'],
): PdsCertificationDetailsView | null {
  if (!record) return null;
  return {
    truthDeclarationAccepted: record.truthDeclarationAccepted,
    verificationAuthorizationAccepted: record.verificationAuthorizationAccepted,
    misrepresentationWarningAccepted: record.misrepresentationWarningAccepted,
    photoDocumentId: record.photoDocumentId,
    photoDocumentVersionId: record.photoDocumentVersionId,
    governmentIdType: record.governmentIdType,
    governmentIdNumber: record.governmentIdNumber,
    governmentIdIssuedAt: formatDate(record.governmentIdIssuedAt),
    governmentIdIssuedPlace: record.governmentIdIssuedPlace,
    employeeSignatureDocumentId: record.employeeSignatureDocumentId,
    employeeSignatureDocumentVersionId: record.employeeSignatureDocumentVersionId,
    employeeSignatureDate: formatDate(record.employeeSignatureDate),
    thumbmarkDocumentId: record.thumbmarkDocumentId,
    thumbmarkDocumentVersionId: record.thumbmarkDocumentVersionId,
    subscribedAndSwornText: record.subscribedAndSwornText,
    subscribedAndSwornAt: record.subscribedAndSwornAt
      ? formatDateTime(record.subscribedAndSwornAt)
      : null,
    oathAdministeredBy: record.oathAdministeredBy,
    oathAdminSignatureDocumentId: record.oathAdminSignatureDocumentId,
    oathAdminSignatureDocumentVersionId: record.oathAdminSignatureDocumentVersionId,
    oathAdministeredAt: record.oathAdministeredAt
      ? formatDateTime(record.oathAdministeredAt)
      : null,
  };
}

function pageSignatureView(record: PdsRecord['pageSignatures'][number]): PdsPageSignatureView {
  return {
    id: record.id,
    pageKey: record.pageKey,
    signatureDocumentId: record.signatureDocumentId,
    signatureDocumentVersionId: record.signatureDocumentVersionId,
    signedAt: record.signedAt ? formatDateTime(record.signedAt) : null,
    signatureDate: formatDate(record.signatureDate),
  };
}

function transitionEventView(
  record: PdsRecord['transitionEvents'][number],
): PdsTransitionEventView {
  return {
    id: record.id,
    fromStatus: record.fromStatus,
    toStatus: record.toStatus,
    action: record.action,
    actorUserId: record.actorUserId,
    actorMembershipId: record.actorMembershipId,
    reason: record.reason,
    occurredAt: formatDateTime(record.occurredAt),
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
    employeeCertifiedAt: record.employeeCertifiedAt
      ? formatDateTime(record.employeeCertifiedAt)
      : null,
    employeeCertifiedByMembershipId: record.employeeCertifiedByMembershipId ?? null,
    hrVerifiedAt: record.hrVerifiedAt ? formatDateTime(record.hrVerifiedAt) : null,
    hrVerifiedByMembershipId: record.hrVerifiedByMembershipId ?? null,
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

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
}

function sourceHash(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function firstMissing(field: string, message: string): PdsServiceError {
  return new PdsServiceError(message, 400, 'PDS_COMPLETENESS_FAILED', { [field]: message });
}

function requireValue(value: unknown, field: string, message: string): void {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) {
    throw firstMissing(field, message);
  }
}

function requireEvidence(value: PdsEvidenceView, field: string, message: string): void {
  if (!value.documentId || !value.documentVersionId) throw firstMissing(field, message);
}

const addressFieldNames = [
  'houseBlockLotNo',
  'street',
  'subdivisionVillage',
  'barangay',
  'cityMunicipality',
  'province',
  'zipCode',
] as const;

function requireAddressCompleteness(
  value: Record<string, unknown> | null,
  field: string,
  label: string,
): void {
  for (const name of addressFieldNames) {
    requireValue(value?.[name], `${field}.${name}`, `Complete the ${label} ${name} or enter N/A.`);
  }
}

function requireNameCompleteness(
  value: PdsFamilyRecordView | null,
  field: string,
  label: string,
): void {
  if (!value) throw firstMissing(`${field}.surname`, `Complete the ${label} or enter N/A.`);
  requireValue(value.surname, `${field}.surname`, `Complete the ${label} surname or enter N/A.`);
  requireValue(
    value.firstName,
    `${field}.firstName`,
    `Complete the ${label} first name or enter N/A.`,
  );
  requireValue(
    value.middleName,
    `${field}.middleName`,
    `Complete the ${label} middle name or enter N/A.`,
  );
}

function requirePersonalCompleteness(record: PdsRecord): void {
  const personal = personalView(record.personalDetails);
  if (!personal) throw firstMissing('personal', 'Complete personal information before submission.');
  for (const field of [
    'surname',
    'firstName',
    'birthDate',
    'birthPlace',
    'sex',
    'civilStatus',
    'heightMeters',
    'weightKilograms',
    'bloodType',
    'citizenship',
  ] as const) {
    requireValue(personal[field], `personal.${field}`, `Complete ${field} before submission.`);
  }
  for (const field of ['telephoneNumber', 'mobileNumber', 'emailAddress'] as const) {
    requireValue(personal[field], `personal.${field}`, `Complete ${field} or enter N/A.`);
  }
  requireAddressCompleteness(personal.residentialAddress, 'personal.residentialAddress', 'Item 17');
  requireAddressCompleteness(personal.permanentAddress, 'personal.permanentAddress', 'Item 18');
  if (personal.citizenship === 'DUAL_CITIZENSHIP') {
    requireValue(
      personal.dualCitizenshipType,
      'personal.dualCitizenshipType',
      'Select the dual citizenship basis.',
    );
    requireValue(
      personal.dualCitizenshipCountry,
      'personal.dualCitizenshipCountry',
      'Select the other citizenship country.',
    );
  }
}

function requirePriorSectionCompleteness(record: PdsRecord): void {
  const family = familyView(record.familyRecords);
  if (record.personalDetails?.civilStatus === 'MARRIED') {
    requireNameCompleteness(family.spouse, 'family.spouse', 'Item 22 spouse');
    requireValue(
      family.spouse?.occupation,
      'family.spouse.occupation',
      'Complete the Item 22 spouse occupation or enter N/A.',
    );
    requireValue(
      family.spouse?.employerBusinessName,
      'family.spouse.employerBusinessName',
      'Complete the Item 22 spouse employer or enter N/A.',
    );
    requireAddressCompleteness(
      family.spouse?.businessAddress ?? null,
      'family.spouse.businessAddress',
      'Item 22 spouse business address',
    );
    requireValue(
      family.spouse?.telephoneNumber,
      'family.spouse.telephoneNumber',
      'Complete the Item 22 spouse telephone number or enter N/A.',
    );
  }
  for (const [index, child] of family.children.entries()) {
    requireValue(child.fullName, `family.children.${index}.fullName`, 'Complete the child name.');
    requireValue(
      child.birthDate,
      `family.children.${index}.birthDate`,
      'Complete the child birth date.',
    );
  }
  requireNameCompleteness(family.father, 'family.father', 'Item 24 father');
  requireNameCompleteness(family.mother, 'family.mother', 'Item 25 mother');

  const educationLevels = new Set(record.educationRecords.map((row) => row.level));
  for (const level of PDS_EDUCATION_LEVELS) {
    if (!educationLevels.has(level)) {
      throw firstMissing('education', 'Add every Item 26 education level, using N/A where needed.');
    }
  }
  for (const [index, row] of record.educationRecords.entries()) {
    for (const field of ['schoolName', 'degreeCourse', 'periodOfAttendance', 'honors'] as const) {
      requireValue(
        row[field],
        `education.${index}.${field}`,
        'Complete every Item 26 row with a value or N/A.',
      );
    }
    if (!row.yearGraduated) {
      requireValue(
        row.highestLevelUnits,
        `education.${index}.highestLevelUnits`,
        'Enter highest level or units earned when no graduation year is recorded.',
      );
    }
  }

  if (!record.eligibilityRecords.length) {
    throw firstMissing('eligibility', 'Add Item 27 eligibility information or an N/A row.');
  }
  for (const [index, row] of record.eligibilityRecords.entries()) {
    requireValue(
      row.eligibilityName,
      `eligibility.${index}.eligibilityName`,
      'Complete every Item 27 row with a value or N/A.',
    );
    requireValue(
      row.examPlace,
      `eligibility.${index}.examPlace`,
      'Complete every Item 27 place with a value or N/A.',
    );
    if (row.eligibilityName.trim().toUpperCase() !== 'N/A') {
      requireValue(row.examDate, `eligibility.${index}.examDate`, 'Enter the Item 27 date.');
    }
  }

  if (!record.workExperienceRecords.length) {
    throw firstMissing('workExperience', 'Add Item 28 work information or an N/A row.');
  }
  for (const [index, row] of record.workExperienceRecords.entries()) {
    for (const field of [
      'positionTitle',
      'departmentAgencyOfficeCompany',
      'salaryGradeStep',
      'appointmentStatus',
    ] as const) {
      requireValue(
        row[field],
        `workExperience.${index}.${field}`,
        'Complete every Item 28 row with a value or N/A.',
      );
    }
    if (row.positionTitle?.trim().toUpperCase() !== 'N/A') {
      requireValue(
        row.inclusiveFrom,
        `workExperience.${index}.inclusiveFrom`,
        'Enter the Item 28 start date.',
      );
      if (!row.isCurrent) {
        requireValue(
          row.inclusiveTo,
          `workExperience.${index}.inclusiveTo`,
          'Enter the Item 28 end date.',
        );
      }
      requireValue(
        row.monthlySalary,
        `workExperience.${index}.monthlySalary`,
        'Enter the Item 28 monthly salary.',
      );
      requireValue(
        row.governmentService,
        `workExperience.${index}.governmentService`,
        'Answer the Item 28 government-service field.',
      );
    }
  }

  if (!record.voluntaryWorkRecords.length) {
    throw firstMissing('voluntaryWork', 'Add Item 29 voluntary-work information or an N/A row.');
  }
  for (const [index, row] of record.voluntaryWorkRecords.entries()) {
    requireValue(
      row.organizationNameAddress,
      `voluntaryWork.${index}.organizationNameAddress`,
      'Complete every Item 29 row with a value or N/A.',
    );
    requireValue(
      row.positionNatureOfWork,
      `voluntaryWork.${index}.positionNatureOfWork`,
      'Complete every Item 29 position with a value or N/A.',
    );
    if (row.organizationNameAddress?.trim().toUpperCase() !== 'N/A') {
      requireValue(
        row.inclusiveFrom,
        `voluntaryWork.${index}.inclusiveFrom`,
        'Enter the Item 29 start date.',
      );
      requireValue(
        row.inclusiveTo,
        `voluntaryWork.${index}.inclusiveTo`,
        'Enter the Item 29 end date.',
      );
      requireValue(row.hours, `voluntaryWork.${index}.hours`, 'Enter the Item 29 hours.');
    }
  }

  if (!record.learningDevelopmentRecords.length) {
    throw firstMissing(
      'learningAndDevelopment',
      'Add Item 30 learning and development information or an N/A row.',
    );
  }
  for (const [index, row] of record.learningDevelopmentRecords.entries()) {
    for (const field of ['interventionTitle', 'type', 'conductedSponsoredBy'] as const) {
      requireValue(
        row[field],
        `learningAndDevelopment.${index}.${field}`,
        'Complete every Item 30 row with a value or N/A.',
      );
    }
    if (row.interventionTitle?.trim().toUpperCase() !== 'N/A') {
      requireValue(
        row.attendanceFrom,
        `learningAndDevelopment.${index}.attendanceFrom`,
        'Enter the Item 30 start date.',
      );
      requireValue(
        row.attendanceTo,
        `learningAndDevelopment.${index}.attendanceTo`,
        'Enter the Item 30 end date.',
      );
      requireValue(row.hours, `learningAndDevelopment.${index}.hours`, 'Enter the Item 30 hours.');
    }
  }
}

const declarationAnswerFields = [
  'relatedWithinThirdDegree',
  'relatedWithinFourthDegreeLgu',
  'foundGuiltyAdministrativeOffense',
  'criminallyCharged',
  'convictedOfCrime',
  'separatedFromService',
  'candidateInLastElection',
  'resignedBeforeElection',
  'immigrantOrPermanentResident',
  'indigenousGroupMember',
  'personWithDisability',
  'soloParent',
] as const;

function requireSubmissionCompleteness(record: PdsRecord): void {
  requirePersonalCompleteness(record);
  requirePriorSectionCompleteness(record);
  if (record.formVersion !== PDS_FORM_VERSION) {
    throw firstMissing('formVersion', 'Use the Revised 2026 PDS contract before submission.');
  }
  const other = otherInformationView(record.otherInformation);
  if (!other) throw firstMissing('otherInformation', 'Complete Items 31 to 33 before submission.');
  requireValue(other.skillsAndHobbies, 'otherInformation.skillsAndHobbies', 'Complete Item 31.');
  requireValue(
    other.nonAcademicDistinctions,
    'otherInformation.nonAcademicDistinctions',
    'Complete Item 32.',
  );
  requireValue(
    other.associationMemberships,
    'otherInformation.associationMemberships',
    'Complete Item 33.',
  );
  const declarations = declarationDetailsView(record.declarationDetails);
  if (!declarations)
    throw firstMissing('declarations', 'Complete Items 34 to 40 before submission.');
  for (const field of declarationAnswerFields) {
    if (declarations[field] === null)
      throw firstMissing(`declarations.${field}`, 'Answer every Item 34 to 40 declaration.');
  }
  if (declarations.relatedWithinThirdDegree && !declarations.relationshipDetails) {
    throw firstMissing('declarations.relationshipDetails', 'Describe the Item 34a relationship.');
  }
  if (declarations.relatedWithinFourthDegreeLgu && !declarations.relatedWithinFourthDegreeDetails) {
    throw firstMissing(
      'declarations.relatedWithinFourthDegreeDetails',
      'Describe the Item 34b relationship.',
    );
  }
  if (declarations.foundGuiltyAdministrativeOffense && !declarations.administrativeOffenseDetails) {
    throw firstMissing(
      'declarations.administrativeOffenseDetails',
      'Describe the Item 35a finding.',
    );
  }
  if (declarations.criminallyCharged) {
    requireValue(
      declarations.criminalChargeDetails,
      'declarations.criminalChargeDetails',
      'Describe the Item 35b charge.',
    );
    if (
      !declarations.criminalChargeDateFiled &&
      declarations.criminalChargeDateFiledUnknown !== true
    ) {
      throw firstMissing(
        'declarations.criminalChargeDateFiled',
        'Enter the Item 35b filing date or mark it unknown.',
      );
    }
    requireValue(
      declarations.criminalChargeStatus,
      'declarations.criminalChargeStatus',
      'Enter the Item 35b case status.',
    );
  }
  if (declarations.convictedOfCrime && !declarations.convictionDetails) {
    throw firstMissing('declarations.convictionDetails', 'Describe the Item 36 conviction.');
  }
  if (declarations.separatedFromService) {
    requireValue(
      declarations.separationMode,
      'declarations.separationMode',
      'Enter the Item 37 separation mode.',
    );
    requireValue(
      declarations.separationDetails,
      'declarations.separationDetails',
      'Describe the Item 37 separation.',
    );
  }
  if (declarations.candidateInLastElection && !declarations.candidacyDetails) {
    throw firstMissing('declarations.candidacyDetails', 'Describe the Item 38a candidacy.');
  }
  if (declarations.resignedBeforeElection && !declarations.resignationDetails) {
    throw firstMissing('declarations.resignationDetails', 'Describe the Item 38b resignation.');
  }
  if (declarations.immigrantOrPermanentResident && !declarations.immigrantCountry) {
    throw firstMissing('declarations.immigrantCountry', 'Select the Item 39 country.');
  }
  if (declarations.indigenousGroupMember && !declarations.indigenousGroupDetails) {
    throw firstMissing('declarations.indigenousGroupDetails', 'Enter the Item 40a group.');
  }
  if (declarations.personWithDisability) {
    requireValue(
      declarations.disabilitySpecification,
      'declarations.disabilitySpecification',
      'Enter the Item 40b specification.',
    );
    requireValue(
      declarations.disabilityIdNumber,
      'declarations.disabilityIdNumber',
      'Enter the Item 40b ID number.',
    );
  }
  if (declarations.soloParent) {
    requireValue(
      declarations.soloParentSpecification,
      'declarations.soloParentSpecification',
      'Enter the Item 40c specification.',
    );
    requireValue(
      declarations.soloParentIdNumber,
      'declarations.soloParentIdNumber',
      'Enter the Item 40c ID number.',
    );
  }
  if (record.referenceRecords.length !== 3) {
    throw firstMissing(
      'references',
      'Enter all three Item 41 references, using N/A where applicable.',
    );
  }
  for (const [index, reference] of record.referenceRecords.entries()) {
    requireValue(
      reference.name,
      `references.${index}.name`,
      'Complete every Item 41 reference name.',
    );
    requireValue(
      reference.address,
      `references.${index}.address`,
      'Complete every Item 41 reference address.',
    );
    requireValue(
      reference.contact,
      `references.${index}.contact`,
      'Complete every Item 41 reference contact.',
    );
  }
  for (const [wesIndex, wes] of record.wesArtifacts.entries()) {
    if (wes.templateVersion !== PDS_WES_TEMPLATE_VERSION) {
      throw firstMissing(
        'wes.templateVersion',
        'Use the supported WES template before submission.',
      );
    }
    if (!wes.entries.length)
      throw firstMissing('wes.entries', 'Each WES artifact needs at least one work entry.');
    for (const [index, entry] of wes.entries.entries()) {
      for (const field of [
        'durationText',
        'position',
        'officeUnit',
        'immediateSupervisor',
        'agencyOrganizationLocation',
        'actualDuties',
      ] as const) {
        requireValue(
          entry[field],
          `wes.${wesIndex}.entries.${index}.${field}`,
          'Complete every required WES narrative field.',
        );
      }
    }
  }
}

function requireCertificationCompleteness(record: PdsRecord): void {
  requireSubmissionCompleteness(record);
  const pageSignatures = new Map<string, PdsPageSignatureView>(
    record.pageSignatures.map((row: PdsRecord['pageSignatures'][number]) => {
      const signature = pageSignatureView(row);
      return [signature.pageKey, signature];
    }),
  );
  for (const pageKey of requiredPageKeys(record)) {
    const signature = pageSignatures.get(pageKey);
    if (!signature) throw firstMissing(`pageSignatures.${pageKey}`, `Sign page ${pageKey}.`);
    requireEvidence(
      {
        documentId: signature.signatureDocumentId,
        documentVersionId: signature.signatureDocumentVersionId,
      },
      `pageSignatures.${pageKey}.signatureDocumentId`,
      `Attach the page ${pageKey} signature evidence.`,
    );
    requireValue(
      signature.signedAt,
      `pageSignatures.${pageKey}.signedAt`,
      `Enter the page ${pageKey} signature timestamp.`,
    );
    requireValue(
      signature.signatureDate,
      `pageSignatures.${pageKey}.signatureDate`,
      `Enter the page ${pageKey} signature date.`,
    );
  }
  const certification = certificationDetailsView(record.certificationDetails);
  if (!certification) throw firstMissing('certification', 'Complete Item 42 before certification.');
  for (const field of [
    'truthDeclarationAccepted',
    'verificationAuthorizationAccepted',
    'misrepresentationWarningAccepted',
  ] as const) {
    if (certification[field] !== true)
      throw firstMissing(`certification.${field}`, 'Accept every Item 42 declaration.');
  }
  requireEvidence(
    {
      documentId: certification.photoDocumentId,
      documentVersionId: certification.photoDocumentVersionId,
    },
    'certification.photoDocumentId',
    'Attach the Item 42 photo evidence.',
  );
  requireValue(
    certification.governmentIdType,
    'certification.governmentIdType',
    'Enter the government ID type.',
  );
  requireValue(
    certification.governmentIdNumber,
    'certification.governmentIdNumber',
    'Enter the government ID number.',
  );
  requireValue(
    certification.governmentIdIssuedAt,
    'certification.governmentIdIssuedAt',
    'Enter the government ID issue date.',
  );
  requireValue(
    certification.governmentIdIssuedPlace,
    'certification.governmentIdIssuedPlace',
    'Enter the government ID issue place.',
  );
  if (!certification.employeeSignatureDocumentId && !certification.thumbmarkDocumentId) {
    throw firstMissing(
      'certification.employeeSignatureDocumentId',
      'Attach an Item 42 signature or thumbmark.',
    );
  }
  if (certification.employeeSignatureDocumentId) {
    requireEvidence(
      {
        documentId: certification.employeeSignatureDocumentId,
        documentVersionId: certification.employeeSignatureDocumentVersionId,
      },
      'certification.employeeSignatureDocumentId',
      'Attach the Item 42 signature evidence.',
    );
  }
  if (certification.thumbmarkDocumentId) {
    requireEvidence(
      {
        documentId: certification.thumbmarkDocumentId,
        documentVersionId: certification.thumbmarkDocumentVersionId,
      },
      'certification.thumbmarkDocumentId',
      'Attach the Item 42 thumbmark evidence.',
    );
  }
  requireValue(
    certification.employeeSignatureDate,
    'certification.employeeSignatureDate',
    'Enter the Item 42 employee signature date.',
  );
  requireValue(
    certification.subscribedAndSwornText,
    'certification.subscribedAndSwornText',
    'Complete the subscribed and sworn block.',
  );
  requireValue(
    certification.subscribedAndSwornAt,
    'certification.subscribedAndSwornAt',
    'Enter the subscribed and sworn timestamp.',
  );
  requireValue(
    certification.oathAdministeredBy,
    'certification.oathAdministeredBy',
    'Enter the oath administrator.',
  );
  requireEvidence(
    {
      documentId: certification.oathAdminSignatureDocumentId,
      documentVersionId: certification.oathAdminSignatureDocumentVersionId,
    },
    'certification.oathAdminSignatureDocumentId',
    'Attach the oath administrator signature evidence.',
  );
  requireValue(
    certification.oathAdministeredAt,
    'certification.oathAdministeredAt',
    'Enter the oath administration timestamp.',
  );
  for (const wes of record.wesArtifacts) {
    requireEvidence(
      {
        documentId: wes.employeeSignatureDocumentId,
        documentVersionId: wes.employeeSignatureDocumentVersionId,
      },
      'wes.signatureDocumentId',
      'Attach the WES employee signature evidence.',
    );
    requireValue(wes.signedAt, 'wes.signedAt', 'Enter the WES signature date.');
  }
}

function continuationPages(record: PdsRecord): string[] {
  return PDS_CONTINUATION_PAGE_KEYS.filter((pageKey) => {
    switch (pageKey) {
      case 'C5':
        return record.familyRecords.length > 4;
      case 'C6':
        return record.educationRecords.length > 5;
      case 'C7':
        return record.eligibilityRecords.length > 7;
      case 'C8':
        return record.workExperienceRecords.length > 28;
      case 'C9':
        return record.voluntaryWorkRecords.length > 7;
      case 'C10':
        return record.learningDevelopmentRecords.length > 21;
      case 'C11':
        return (
          (record.otherInformation?.skillsAndHobbies?.length ?? 0) > 500 ||
          (record.otherInformation?.nonAcademicDistinctions?.length ?? 0) > 500 ||
          (record.otherInformation?.associationMemberships?.length ?? 0) > 500
        );
    }
  });
}

function requiredPageKeys(record: PdsRecord): readonly string[] {
  return [...PDS_MAIN_PAGE_KEYS, ...continuationPages(record)];
}

const pdsPageLayout: Record<string, readonly Record<string, unknown>[]> = {
  C1: [
    {
      section: 'I. PERSONAL INFORMATION',
      items: [
        '1. Surname',
        '2. First Name, Name Extension, Middle Name',
        '3. Date of Birth',
        '4. Place of Birth',
        '5. Sex at Birth',
        '6. Civil Status',
        '7. Height',
        '8. Weight',
        '9. Blood Type',
        '10. UMID ID No.',
        '11. Pag-IBIG ID No.',
        '12. PhilHealth No.',
        '13. PhilSys Card Number',
        '14. TIN No.',
        '15. Agency Employee No.',
        '16. Citizenship',
        '17. Residential Address',
        '18. Permanent Address',
        '19. Telephone No.',
        '20. Mobile No.',
        '21. E-mail Address',
      ],
    },
    {
      section: 'II. FAMILY BACKGROUND',
      items: ['22. Spouse', '23. Children', '24. Father', '25. Mother’s Maiden Name'],
    },
    {
      section: 'III. EDUCATIONAL BACKGROUND',
      items: ['26. Education'],
      columns: [
        'Level',
        'Name of School',
        'Basic Education/Degree/Course',
        'Period of Attendance',
        'Highest Level/Units Earned',
        'Year Graduated',
        'Scholarship/Academic Honors',
      ],
    },
  ],
  C2: [
    {
      section: 'IV. CIVIL SERVICE ELIGIBILITY',
      items: ['27. Eligibility'],
      columns: [
        'Eligibility',
        'Rating',
        'Date of Examination/Conferment',
        'Place of Examination/Conferment',
        'License Number',
        'License Date of Validity',
      ],
    },
    {
      section: 'V. WORK EXPERIENCE',
      items: ['28. Work Experience'],
      columns: [
        'Inclusive Dates',
        'Position Title',
        'Department/Agency/Office/Company',
        'Monthly Salary',
        'Salary/Job/Pay Grade and Step',
        'Status of Appointment',
        'Government Service',
      ],
    },
  ],
  C3: [
    {
      section:
        'VI. VOLUNTARY WORK OR INVOLVEMENT IN CIVIC/NON-GOVERNMENT/PEOPLE/VOLUNTARY ORGANIZATIONS',
      items: ['29. Voluntary Work'],
    },
    {
      section: 'VII. LEARNING AND DEVELOPMENT INTERVENTIONS/TRAINING PROGRAMS ATTENDED',
      items: ['30. Learning and Development'],
    },
    {
      section: 'VIII. OTHER INFORMATION',
      items: [
        '31. Special Skills and Hobbies',
        '32. Non-Academic Distinctions/Recognition',
        '33. Membership in Association/Organization',
      ],
    },
  ],
  C4: [
    { section: 'DECLARATIONS', items: ['34.a–40.c. Declarations'] },
    { section: 'REFERENCES', items: ['41. References'] },
    {
      section: 'CERTIFICATION',
      items: ['42. Certification, Photo, Government ID, Signature or Thumbmark, and Oath'],
    },
  ],
  C5: [{ section: 'FAMILY BACKGROUND CONTINUATION', items: ['23. Children'] }],
  C6: [{ section: 'EDUCATIONAL BACKGROUND CONTINUATION', items: ['26. Education'] }],
  C7: [{ section: 'CIVIL SERVICE ELIGIBILITY CONTINUATION', items: ['27. Eligibility'] }],
  C8: [{ section: 'WORK EXPERIENCE CONTINUATION', items: ['28. Work Experience'] }],
  C9: [{ section: 'VOLUNTARY WORK CONTINUATION', items: ['29. Voluntary Work'] }],
  C10: [
    { section: 'LEARNING AND DEVELOPMENT CONTINUATION', items: ['30. Learning and Development'] },
  ],
  C11: [{ section: 'OTHER INFORMATION CONTINUATION', items: ['31–33. Other Information'] }],
};

const pdsCertificationStatements = {
  truthDeclaration:
    'I declare under oath that I have personally accomplished this Personal Data Sheet which is a true, correct, and complete statement pursuant to the provisions of pertinent laws, rules, and regulations of the Republic of the Philippines.',
  verificationAuthorization:
    'I authorize the agency head/authorized representative to verify/validate the contents stated herein.',
  misrepresentationWarning:
    'I agree that any misrepresentation made in this document and its attachments shall cause the filing of administrative/criminal case/s against me.',
} as const;

function pdsRenderedContent(record: PdsRecord): Record<string, unknown> {
  const pageKeys = requiredPageKeys(record);
  return {
    header: 'CS Form No. 212, Revised 2026, Personal Data Sheet',
    warning:
      'Any misrepresentation made in the Personal Data Sheet and the Work Experience Sheet shall cause the filing of administrative or criminal case/s.',
    guideReference: 'Guide to Filling Out the Personal Data Sheet (PDS), Revised 2026',
    instructions: [
      'Fill every applicable field with a value or N/A.',
      'Mark the applicable checkbox for each choice.',
      'DO NOT ABBREVIATE names, schools, employers, offices, agencies, organizations, titles, awards, or associations where the guide requires the full name.',
    ],
    revision: record.formVersion,
    dateProfile: {
      storage: 'ISO-8601 date',
      displayConflict: 'PDS source mm/dd/yyyy vs guide dd/mm/yyyy',
    },
    photo: { widthCm: 3.5, heightCm: 4.5, transformations: 'NONE' },
    signaturePlacement: { position: 'BOTTOM_OF_EVERY_PAGE', pageKeys },
    certificationStatements: pdsCertificationStatements,
    pages: pageKeys.map((pageKey) => ({
      pageKey,
      sections: pdsPageLayout[pageKey] ?? [],
      footer:
        pageKey.startsWith('C') && Number(pageKey.slice(1)) <= 4
          ? `CS FORM 212 (Revised 2026), Page ${pageKey.slice(1)} of 4`
          : null,
    })),
    sections: detail(record, 'FULL'),
  };
}

function wesRenderedContent(
  record: PdsRecord,
  artifact: PdsRecord['wesArtifacts'][number],
): Record<string, unknown> {
  return {
    header: 'Attachment to CS Form No. 212',
    title: 'WORK EXPERIENCE SHEET',
    instructions: [
      'Include only work experiences relevant to the position being applied for.',
      'The duration should include start and finish dates, most recent first, with Present for current work.',
    ],
    fieldOrder: [
      'Duration',
      'Position',
      'Name of Office/Unit',
      'Immediate Supervisor',
      'Name of Agency/Organization and Location',
      'List of Accomplishments and Contributions (if any)',
      'Summary of Actual Duties',
    ],
    templateVersion: artifact.templateVersion,
    contextKey: artifact.contextKey,
    sourcePdsVersionId: record.id,
    entries: artifact.entries.map((entry) => {
      const view = wesEntryView(entry);
      return {
        duration: view.durationText,
        position: view.position,
        officeUnit: view.officeUnit,
        immediateSupervisor: view.immediateSupervisor,
        agencyOrganizationLocation: view.agencyOrganizationLocation,
        accomplishments: view.accomplishments,
        actualDuties: view.actualDuties,
      };
    }),
    signature: {
      label: 'Signature over Printed Name of Employee/Applicant',
      dateLabel: 'Date',
      signedAt: formatDate(artifact.signedAt),
    },
    date: formatDate(artifact.signedAt),
  };
}

function signatureMetadata(
  record: PdsRecord,
  wesArtifact?: PdsRecord['wesArtifacts'][number],
): Record<string, unknown> {
  const certification = certificationDetailsView(record.certificationDetails);
  return {
    employeeCertifiedAt: record.employeeCertifiedAt
      ? formatDateTime(record.employeeCertifiedAt)
      : null,
    employeeCertifiedByMembershipId: record.employeeCertifiedByMembershipId ?? null,
    hrVerifiedAt: record.hrVerifiedAt ? formatDateTime(record.hrVerifiedAt) : null,
    hrVerifiedByMembershipId: record.hrVerifiedByMembershipId ?? null,
    pageKeys: record.pageSignatures.map((row: PdsRecord['pageSignatures'][number]) => row.pageKey),
    hasItem42Signature: Boolean(certification?.employeeSignatureDocumentId),
    hasItem42Thumbmark: Boolean(certification?.thumbmarkDocumentId),
    ...(wesArtifact ? { wesSignedAt: formatDate(wesArtifact.signedAt) } : {}),
  };
}

function outputView(record: PdsOutputRecord, fieldScope: PdsFieldScope): PdsOutputArtifactView {
  return {
    id: record.id,
    outputKey: record.outputKey,
    outputType: record.outputType as PdsOutputArtifactView['outputType'],
    formVersion: record.formVersion,
    templateVersion: record.templateVersion,
    sourceArtifactId: record.sourceArtifactId,
    sourceArtifactHash: record.sourceArtifactHash,
    generatedAt: formatDateTime(record.generatedAt),
    dataAsOfDate: formatDate(record.dataAsOfDate) as string,
    status: record.status,
    renderingMetadata: jsonObject(record.renderingMetadata) ?? {},
    signatureMetadata: fieldScope === 'FULL' ? jsonObject(record.signatureMetadata) : null,
    renderedContent: fieldScope === 'FULL' ? jsonObject(record.renderedContent) : null,
  };
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
    otherInformation: fieldScope === 'FULL' ? otherInformationView(record.otherInformation) : null,
    declarations: fieldScope === 'FULL' ? declarationDetailsView(record.declarationDetails) : null,
    references: fieldScope === 'FULL' ? record.referenceRecords.map(referenceRecordView) : [],
    certification:
      fieldScope === 'FULL' ? certificationDetailsView(record.certificationDetails) : null,
    pageSignatures: fieldScope === 'FULL' ? record.pageSignatures.map(pageSignatureView) : [],
    transitions: record.transitionEvents.map(transitionEventView),
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
    otherInformation: null,
    declarations: null,
    references: [],
    certification: null,
    pageSignatures: [],
    transitions: [],
  };
}

function hasPermissionGrant(context: RequestContext, permission: string): boolean {
  return context.permissions.some((grant) => grant.code === permission);
}

/**
 * The PDS fields the acting Agency Membership may read for one Employee: null
 * outside the `personnel.pds.read` Employee Scope, FULL when the
 * `personnel.pds.read_sensitive` Employee Scope also covers the Employee, and
 * REDACTED otherwise.
 */
async function readFieldScope(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  employeeId: string,
): Promise<PdsFieldScope | null> {
  const read = await resolveEmployeeScope(transaction, context, 'personnel.pds.read');
  if (!scopeCovers(read, employeeId)) return null;
  const sensitive = await resolveEmployeeScope(
    transaction,
    context,
    'personnel.pds.read_sensitive',
  );
  return scopeCovers(sensitive, employeeId) ? 'FULL' : 'REDACTED';
}

async function scopedDetail(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  record: PdsRecord,
): Promise<PdsVersionDetail> {
  const fieldScope = await readFieldScope(transaction, context, record.employeeId);
  return fieldScope === 'FULL'
    ? detail(record, fieldScope)
    : redactedDetail(record, fieldScope ?? 'REDACTED');
}

/** Whether the `personnel.pds.update` Employee Scope covers the Employee. */
async function canUpdate(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  employeeId: string,
): Promise<boolean> {
  return scopeCovers(
    await resolveEmployeeScope(transaction, context, 'personnel.pds.update'),
    employeeId,
  );
}

/**
 * Submit and certify stay with the Employee: the PDS must be the actor's own,
 * and the actor must hold the permission with an OWN grant (#591 decides
 * whether this grant check stays).
 */
async function isOwnWithOwnGrant(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  permission: string,
  employeeId: string,
): Promise<boolean> {
  if (
    !context.permissions.some((grant) => grant.code === permission && grant.scopePolicy === 'OWN')
  )
    return false;
  return (await ownEmployeeId(transaction, context)) === employeeId;
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
    const ownWorkflow = !hasPermission(context, 'personnel.pds.update', {
      agencyId: context.agencyId,
    });
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

  private async writeCompletionSections(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    pdsVersionId: string,
    input: PdsCreateInput | PdsUpdateInput,
  ): Promise<void> {
    const extra = pdsExtra(transaction);
    for (const evidence of evidenceInputsFromCompletion(input))
      await this.assertEvidence(transaction, context, evidence);
    if (input.otherInformation) {
      await extra.pdsOtherInformation.upsert({
        where: { agencyId_pdsVersionId: { agencyId: context.agencyId, pdsVersionId } },
        create: otherInformationData(context.agencyId, pdsVersionId, input.otherInformation),
        update: otherInformationData(context.agencyId, pdsVersionId, input.otherInformation),
      });
      await this.writeSectionAudit(
        transaction,
        context,
        pdsVersionId,
        'DRAFT',
        'PDS_OTHER_INFORMATION_UPDATED',
        {
          section: 'otherInformation',
          changedFieldCount: Object.keys(input.otherInformation).length,
        },
      );
    }
    if (input.declarations) {
      await extra.pdsDeclarationDetails.upsert({
        where: { agencyId_pdsVersionId: { agencyId: context.agencyId, pdsVersionId } },
        create: declarationData(context.agencyId, pdsVersionId, input.declarations),
        update: declarationData(context.agencyId, pdsVersionId, input.declarations),
      });
      await this.writeSectionAudit(
        transaction,
        context,
        pdsVersionId,
        'DRAFT',
        'PDS_DECLARATIONS_UPDATED',
        {
          section: 'declarations',
          changedFieldCount: Object.keys(input.declarations).length,
        },
      );
    }
    if (input.references) {
      await extra.pdsReferenceRecord.deleteMany({
        where: { agencyId: context.agencyId, pdsVersionId },
      });
      const records = referenceData(context.agencyId, pdsVersionId, input.references);
      if (records.length) await extra.pdsReferenceRecord.createMany({ data: records });
      await this.writeSectionAudit(
        transaction,
        context,
        pdsVersionId,
        'DRAFT',
        'PDS_REFERENCES_UPDATED',
        {
          section: 'references',
          rowCount: records.length,
        },
      );
    }
    if (input.certification) {
      await extra.pdsCertificationDetails.upsert({
        where: { agencyId_pdsVersionId: { agencyId: context.agencyId, pdsVersionId } },
        create: certificationData(context.agencyId, pdsVersionId, input.certification),
        update: certificationData(context.agencyId, pdsVersionId, input.certification),
      });
      await this.writeSectionAudit(
        transaction,
        context,
        pdsVersionId,
        'DRAFT',
        'PDS_CERTIFICATION_DETAILS_UPDATED',
        {
          section: 'certification',
          changedFieldCount: Object.keys(input.certification).length,
        },
      );
    }
    if (input.pageSignatures) {
      await extra.pdsPageSignature.deleteMany({
        where: { agencyId: context.agencyId, pdsVersionId },
      });
      const rows = pageSignatureData(context.agencyId, pdsVersionId, input.pageSignatures);
      if (rows.length) await extra.pdsPageSignature.createMany({ data: rows });
      await this.writeSectionAudit(
        transaction,
        context,
        pdsVersionId,
        'DRAFT',
        'PDS_PAGE_SIGNATURES_UPDATED',
        {
          section: 'pageSignatures',
          rowCount: rows.length,
          evidenceLinkCount: rows.filter((row) => Boolean(row.signatureDocumentId)).length,
        },
      );
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
      const employeeId = await ownEmployeeId(transaction, context);
      if (!employeeId) throw this.notFound();
      return this.listInTransaction(transaction, context, employeeId);
    });
  }

  async findById(context: RequestContext, pdsVersionId: string): Promise<PdsVersionDetail | null> {
    this.assertContext(context, 'personnel.pds.read', 'PDS_READ_FORBIDDEN');
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const summaryRecord = (await transaction.pdsVersion.findFirst({
        where: { agencyId: context.agencyId, id: pdsVersionId },
        select: pdsSummarySelect,
      })) as unknown as PdsSummaryRecord | null;
      if (!summaryRecord) return null;
      const fieldScope = await readFieldScope(transaction, context, summaryRecord.employeeId);
      if (!fieldScope) return null;
      await this.auditRead(transaction, context, pdsVersionId, fieldScope, 'DETAIL');
      if (fieldScope === 'REDACTED') {
        const record = (await transaction.pdsVersion.findFirst({
          where: { agencyId: context.agencyId, id: pdsVersionId },
          select: pdsRedactedSelect,
        })) as unknown as PdsRedactedRecord | null;
        return record ? redactedDetail(record, fieldScope) : null;
      }
      const record = (await transaction.pdsVersion.findFirst({
        where: { agencyId: context.agencyId, id: pdsVersionId },
        select: pdsSelect,
      })) as unknown as PdsRecord | null;
      return record ? detail(record, fieldScope) : null;
    });
  }

  async create(context: RequestContext, input: PdsCreateInput): Promise<PdsVersionDetail> {
    this.assertContext(context, 'personnel.pds.update', 'PDS_UPDATE_FORBIDDEN');
    this.validateQualificationInput(input);
    return withDatabaseContext(databaseContext(context, true), async (transaction) => {
      const employeeId = input.employeeId ?? (await ownEmployeeId(transaction, context));
      if (!employeeId) throw this.employeeRequired();
      await this.lockEmployee(transaction, context.agencyId, employeeId);
      const employee = await transaction.employee.findUnique({
        where: { agencyId_id: { agencyId: context.agencyId, id: employeeId } },
        select: { id: true },
      });
      if (!employee) throw this.notFound();
      if (!(await canUpdate(transaction, context, employeeId))) throw this.notFound();
      const existing = (await transaction.pdsVersion.findFirst({
        where: { agencyId: context.agencyId, employeeId, status: { in: ['DRAFT', 'RETURNED'] } },
        select: pdsSelect,
      })) as unknown as PdsRecord | null;
      if (existing) return scopedDetail(transaction, context, existing);

      const latest = await transaction.pdsVersion.findFirst({
        where: { agencyId: context.agencyId, employeeId },
        orderBy: { versionNo: 'desc' },
        select: { id: true, versionNo: true, status: true },
      });
      if (latest?.status === 'CERTIFIED') {
        throw new PdsServiceError(
          'Use the PDS correction workflow to create a successor to a Certified PDS.',
          409,
          'PDS_CORRECTION_REQUIRED',
        );
      }
      const created = await transaction.pdsVersion.create({
        data: {
          agencyId: context.agencyId,
          employeeId,
          versionNo: (latest?.versionNo ?? 0) + 1,
          formVersion: PDS_FORM_VERSION,
          asOfDate: databaseDate(input.asOfDate ?? today()),
          status: 'DRAFT',
          supersedesVersionId: null,
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
      await this.writeCompletionSections(transaction, context, created.id, input);
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
      return scopedDetail(transaction, context, record);
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
      if (!(await canUpdate(transaction, context, existing.employeeId))) throw this.notFound();
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
      await this.writeCompletionSections(transaction, context, pdsVersionId, input);
      const updated = await this.record(transaction, context.agencyId, pdsVersionId);
      if (!updated) throw this.notFound();
      return scopedDetail(transaction, context, updated);
    });
  }

  async submit(context: RequestContext, pdsVersionId: string): Promise<PdsVersionDetail> {
    this.assertContext(context, 'personnel.pds.update', 'PDS_UPDATE_FORBIDDEN');
    return withDatabaseContext(databaseContext(context, true), async (transaction) => {
      await this.lockVersion(transaction, context.agencyId, pdsVersionId);
      const record = await this.record(transaction, context.agencyId, pdsVersionId);
      if (!record) throw this.notFound();
      if (!(await canUpdate(transaction, context, record.employeeId))) throw this.notFound();
      if (
        !(await isOwnWithOwnGrant(transaction, context, 'personnel.pds.update', record.employeeId))
      ) {
        throw new PdsServiceError(
          'Employees may submit only their own PDS.',
          403,
          'PDS_SUBMIT_FORBIDDEN',
        );
      }
      if (!['DRAFT', 'RETURNED'].includes(record.status)) {
        throw new PdsServiceError(
          'Only a Draft or Returned PDS can be submitted.',
          409,
          'PDS_TRANSITION_INVALID',
        );
      }
      requireSubmissionCompleteness(record);
      await this.writeTransition(
        transaction,
        context,
        record,
        'SUBMITTED',
        'PDS_SUBMITTED',
        null,
        true,
      );
      await transaction.pdsVersion.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: pdsVersionId } },
        data: {
          status: 'SUBMITTED',
          employeeCertifiedAt: null,
          employeeCertifiedByMembershipId: null,
          hrVerifiedAt: null,
          hrVerifiedByMembershipId: null,
          updatedByMembershipId: context.membershipId,
        } as Prisma.PdsVersionUncheckedUpdateInput & Record<string, unknown>,
      });
      const updated = await this.record(transaction, context.agencyId, pdsVersionId);
      if (!updated) throw this.notFound();
      return scopedDetail(transaction, context, updated);
    });
  }

  async returnForCorrection(
    context: RequestContext,
    pdsVersionId: string,
    input: PdsReasonInput,
  ): Promise<PdsVersionDetail> {
    this.assertAgencyAction(context, 'personnel.pds.update', 'PDS_UPDATE_FORBIDDEN');
    const reason = text(input.reason);
    if (!reason)
      throw new PdsServiceError('A return reason is required.', 400, 'PDS_REASON_REQUIRED');
    return withDatabaseContext(databaseContext(context, true), async (transaction) => {
      await this.lockVersion(transaction, context.agencyId, pdsVersionId);
      const record = await this.record(transaction, context.agencyId, pdsVersionId);
      if (!record) throw this.notFound();
      if (record.status !== 'SUBMITTED') {
        throw new PdsServiceError(
          'Only a Submitted PDS can be returned.',
          409,
          'PDS_TRANSITION_INVALID',
        );
      }
      await this.writeTransition(
        transaction,
        context,
        record,
        'RETURNED',
        'PDS_RETURNED',
        reason,
        true,
      );
      await transaction.pdsVersion.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: pdsVersionId } },
        data: {
          status: 'RETURNED',
          updatedByMembershipId: context.membershipId,
        } as Prisma.PdsVersionUncheckedUpdateInput & Record<string, unknown>,
      });
      const updated = await this.record(transaction, context.agencyId, pdsVersionId);
      if (!updated) throw this.notFound();
      return scopedDetail(transaction, context, updated);
    });
  }

  async certify(
    context: RequestContext,
    pdsVersionId: string,
    input: PdsEmployeeCertificationInput,
  ): Promise<PdsVersionDetail> {
    this.assertContext(context, 'personnel.pds.certify', 'PDS_CERTIFY_FORBIDDEN');
    if (input.employeeCertificationAccepted !== true) {
      throw new PdsServiceError(
        'Employee certification must be accepted.',
        400,
        'PDS_CERTIFICATION_REQUIRED',
      );
    }
    return withDatabaseContext(databaseContext(context, true), async (transaction) => {
      await this.lockVersion(transaction, context.agencyId, pdsVersionId);
      const record = await this.record(transaction, context.agencyId, pdsVersionId);
      if (!record) throw this.notFound();
      if (
        !(await isOwnWithOwnGrant(transaction, context, 'personnel.pds.certify', record.employeeId))
      ) {
        throw new PdsServiceError(
          'Employees may certify only their own PDS.',
          403,
          'PDS_CERTIFY_FORBIDDEN',
        );
      }
      if (record.status !== 'SUBMITTED') {
        throw new PdsServiceError(
          'Only a Submitted PDS can be certified by the employee.',
          409,
          'PDS_TRANSITION_INVALID',
        );
      }
      requireCertificationCompleteness(record);
      await this.writeTransition(
        transaction,
        context,
        record,
        'SUBMITTED',
        'PDS_EMPLOYEE_CERTIFIED',
        null,
        false,
      );
      await transaction.pdsVersion.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: pdsVersionId } },
        data: {
          employeeCertifiedAt: new Date(),
          employeeCertifiedByMembershipId: context.membershipId,
          updatedByMembershipId: context.membershipId,
        } as Prisma.PdsVersionUncheckedUpdateInput & Record<string, unknown>,
      });
      const updated = await this.record(transaction, context.agencyId, pdsVersionId);
      if (!updated) throw this.notFound();
      return scopedDetail(transaction, context, updated);
    });
  }

  async verify(context: RequestContext, pdsVersionId: string): Promise<PdsVersionDetail> {
    this.assertAgencyAction(context, 'personnel.pds.certify', 'PDS_VERIFY_FORBIDDEN');
    return withDatabaseContext(databaseContext(context, true), async (transaction) => {
      await this.lockVersion(transaction, context.agencyId, pdsVersionId);
      const record = await this.record(transaction, context.agencyId, pdsVersionId);
      if (!record) throw this.notFound();
      if (record.status !== 'SUBMITTED') {
        throw new PdsServiceError(
          'Only a Submitted PDS can be verified.',
          409,
          'PDS_TRANSITION_INVALID',
        );
      }
      if (!record.employeeCertifiedAt || !record.employeeCertifiedByMembershipId) {
        throw new PdsServiceError(
          'Employee certification is required before HR verification.',
          409,
          'PDS_EMPLOYEE_CERTIFICATION_REQUIRED',
        );
      }
      requireCertificationCompleteness(record);
      await this.writeTransition(
        transaction,
        context,
        record,
        'CERTIFIED',
        'PDS_HR_VERIFIED',
        null,
        false,
      );
      await transaction.pdsVersion.update({
        where: { agencyId_id: { agencyId: context.agencyId, id: pdsVersionId } },
        data: {
          status: 'CERTIFIED',
          hrVerifiedAt: new Date(),
          hrVerifiedByMembershipId: context.membershipId,
          updatedByMembershipId: context.membershipId,
        } as Prisma.PdsVersionUncheckedUpdateInput & Record<string, unknown>,
      });
      if (record.supersedesVersionId) {
        const source = (await transaction.pdsVersion.findFirst({
          where: {
            agencyId: context.agencyId,
            id: record.supersedesVersionId,
            status: 'CERTIFIED',
          },
          select: pdsSelect,
        })) as unknown as PdsRecord | null;
        if (source) {
          await this.writeTransition(
            transaction,
            context,
            source,
            'SUPERSEDED',
            'PDS_SUPERSEDED',
            record.correctionReason,
            false,
          );
          await transaction.pdsVersion.update({
            where: { agencyId_id: { agencyId: context.agencyId, id: source.id } },
            data: {
              status: 'SUPERSEDED',
              updatedByMembershipId: context.membershipId,
            } as Prisma.PdsVersionUncheckedUpdateInput & Record<string, unknown>,
          });
        }
      }
      const updated = await this.record(transaction, context.agencyId, pdsVersionId);
      if (!updated) throw this.notFound();
      return scopedDetail(transaction, context, updated);
    });
  }

  async correct(
    context: RequestContext,
    pdsVersionId: string,
    input: PdsReasonInput,
  ): Promise<PdsVersionDetail> {
    this.assertContext(context, 'personnel.pds.update', 'PDS_UPDATE_FORBIDDEN');
    const reason = text(input.reason);
    if (!reason)
      throw new PdsServiceError('A correction reason is required.', 400, 'PDS_REASON_REQUIRED');
    return withDatabaseContext(databaseContext(context, true), async (transaction) => {
      await this.lockVersion(transaction, context.agencyId, pdsVersionId);
      const source = await this.record(transaction, context.agencyId, pdsVersionId);
      if (!source) throw this.notFound();
      if (!(await canUpdate(transaction, context, source.employeeId))) throw this.notFound();
      if (source.status !== 'CERTIFIED') {
        throw new PdsServiceError(
          'Only a Certified PDS can be corrected.',
          409,
          'PDS_TRANSITION_INVALID',
        );
      }
      const open = (await transaction.pdsVersion.findFirst({
        where: {
          agencyId: context.agencyId,
          employeeId: source.employeeId,
          supersedesVersionId: source.id,
          status: { in: ['DRAFT', 'RETURNED'] },
        },
        select: pdsSelect,
      })) as unknown as PdsRecord | null;
      if (open) return scopedDetail(transaction, context, open);
      const latest = await transaction.pdsVersion.findFirst({
        where: { agencyId: context.agencyId, employeeId: source.employeeId },
        orderBy: { versionNo: 'desc' },
        select: { versionNo: true },
      });
      const created = await transaction.pdsVersion.create({
        data: {
          agencyId: context.agencyId,
          employeeId: source.employeeId,
          versionNo: (latest?.versionNo ?? source.versionNo) + 1,
          formVersion: source.formVersion,
          asOfDate: source.asOfDate,
          status: 'DRAFT',
          supersedesVersionId: source.id,
          correctionReason: reason,
          createdByMembershipId: context.membershipId,
          updatedByMembershipId: context.membershipId,
        } as Prisma.PdsVersionUncheckedCreateInput & Record<string, unknown>,
        select: { id: true },
      });
      await this.cloneSections(transaction, context, source, created.id);
      const draft = await this.record(transaction, context.agencyId, created.id);
      if (!draft) throw this.notFound();
      await this.writeTransition(
        transaction,
        context,
        draft,
        'DRAFT',
        'PDS_CORRECTION_CREATED',
        reason,
        false,
      );
      return scopedDetail(transaction, context, draft);
    });
  }

  async render(context: RequestContext, pdsVersionId: string): Promise<PdsOutputArtifactList> {
    this.assertAgencyAction(context, 'personnel.pds.update', 'PDS_RENDER_FORBIDDEN');
    return withDatabaseContext(databaseContext(context, true), async (transaction) => {
      const record = await this.record(transaction, context.agencyId, pdsVersionId);
      if (!record) throw this.notFound();
      const fieldScope = await readFieldScope(transaction, context, record.employeeId);
      if (fieldScope !== 'FULL') throw this.notFound();
      if (record.status !== 'CERTIFIED') {
        throw new PdsServiceError(
          'Only a Certified PDS can be rendered.',
          409,
          'PDS_RENDER_NOT_READY',
        );
      }
      const existing = await this.outputRecords(transaction, context.agencyId, pdsVersionId);
      if (existing.length)
        return {
          pdsVersionId,
          fieldScope,
          outputs: existing.map((row) => outputView(row, fieldScope)),
        };
      requireCertificationCompleteness(record);
      const rows = await this.createOutputArtifacts(transaction, context, record);
      await this.auditWriter.write(transaction, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        actorType: 'USER',
        action: 'PDS_OUTPUT_RENDERED',
        entityType: 'PdsVersion',
        entityId: pdsVersionId,
        requestId: context.requestId,
        metadata: {
          outputCount: rows.length,
          status: record.status,
          formVersion: record.formVersion,
        },
      });
      return { pdsVersionId, fieldScope, outputs: rows.map((row) => outputView(row, fieldScope)) };
    });
  }

  async listOutputs(context: RequestContext, pdsVersionId: string): Promise<PdsOutputArtifactList> {
    this.assertContext(context, 'personnel.pds.read', 'PDS_READ_FORBIDDEN');
    return withDatabaseContext(databaseContext(context), async (transaction) => {
      const summaryRecord = (await transaction.pdsVersion.findFirst({
        where: { agencyId: context.agencyId, id: pdsVersionId },
        select: pdsSummarySelect,
      })) as unknown as PdsSummaryRecord | null;
      if (!summaryRecord) throw this.notFound();
      const fieldScope = await readFieldScope(transaction, context, summaryRecord.employeeId);
      if (!fieldScope) throw this.notFound();
      const records = await this.outputRecords(transaction, context.agencyId, pdsVersionId);
      await this.auditRead(
        transaction,
        context,
        pdsVersionId,
        fieldScope,
        'DETAIL',
        records.length,
        'PdsOutputArtifact',
      );
      return {
        pdsVersionId,
        fieldScope,
        outputs: records.map((row) => outputView(row, fieldScope)),
      };
    });
  }

  private assertAgencyAction(context: RequestContext, permission: string, code: string): void {
    this.assertContext(context, permission, code);
    if (!hasPermission(context, permission, { agencyId: context.agencyId })) {
      throw new PdsServiceError('This PDS action requires Agency scope.', 403, code);
    }
  }

  private async writeTransition(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    record: PdsRecord,
    toStatus: string,
    action: string,
    reason: string | null,
    includeSnapshot: boolean,
  ): Promise<void> {
    await pdsExtra(transaction).pdsTransitionEvent.create({
      data: {
        agencyId: context.agencyId,
        pdsVersionId: record.id,
        fromStatus: record.status,
        toStatus,
        action,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        reason,
        occurredAt: new Date(),
        submittedSnapshot: includeSnapshot
          ? (detail(record, 'FULL') as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      },
    });
    await this.auditWriter.write(transaction, {
      agencyId: context.agencyId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      actorType: 'USER',
      action,
      entityType: 'PdsVersion',
      entityId: record.id,
      previousStatus: record.status,
      newStatus: toStatus,
      reason: reason ?? null,
      requestId: context.requestId,
      metadata: {
        previousStatus: record.status,
        newStatus: toStatus,
        status: toStatus,
        reasonCode: reason ? 'PROVIDED' : 'NONE',
      },
    });
  }

  private async cloneSections(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    source: PdsRecord,
    pdsVersionId: string,
  ): Promise<void> {
    const extra = pdsExtra(transaction);
    await transaction.pdsPersonalDetails.create({
      data: personalCreateData(
        context.agencyId,
        pdsVersionId,
        (personalView(source.personalDetails) ?? undefined) as PdsPersonalDetailsInput | undefined,
      ),
    });
    const familyRecords = familyCreateData(
      context.agencyId,
      pdsVersionId,
      familyView(source.familyRecords) as PdsFamilyInput,
    );
    if (familyRecords.length) await transaction.pdsFamilyRecord.createMany({ data: familyRecords });
    const educationRecords = educationCreateData(
      context.agencyId,
      pdsVersionId,
      educationView(source.educationRecords) as PdsEducationInput,
    );
    if (educationRecords.length)
      await transaction.pdsEducationRecord.createMany({ data: educationRecords });
    const eligibilityRecords = eligibilityCreateData(
      context.agencyId,
      pdsVersionId,
      eligibilityView(source.eligibilityRecords) as PdsEligibilityInput,
    );
    if (eligibilityRecords.length)
      await transaction.pdsEligibilityRecord.createMany({ data: eligibilityRecords });
    const workRecords = workExperienceCreateData(
      context.agencyId,
      pdsVersionId,
      source.workExperienceRecords.map((row: PdsRecord['workExperienceRecords'][number]) => ({
        ...workExperienceView(row),
        id: undefined,
      })) as PdsWorkExperienceInput[],
    );
    if (workRecords.length)
      await transaction.pdsWorkExperienceRecord.createMany({ data: workRecords });
    const voluntaryRows = voluntaryWorkCreateData(
      context.agencyId,
      pdsVersionId,
      source.voluntaryWorkRecords.map((row: PdsRecord['voluntaryWorkRecords'][number]) => ({
        ...voluntaryWorkView(row),
        id: undefined,
      })) as PdsVoluntaryWorkInput[],
    );
    if (voluntaryRows.length)
      await transaction.pdsVoluntaryWorkRecord.createMany({ data: voluntaryRows });
    const learningRows = learningDevelopmentCreateData(
      context.agencyId,
      pdsVersionId,
      source.learningDevelopmentRecords.map(
        (row: PdsRecord['learningDevelopmentRecords'][number]) => ({
          ...learningDevelopmentView(row),
          id: undefined,
        }),
      ) as PdsLearningDevelopmentInput[],
    );
    if (learningRows.length)
      await transaction.pdsLearningDevelopmentRecord.createMany({ data: learningRows });
    if (source.otherInformation) {
      await extra.pdsOtherInformation.create({
        data: otherInformationData(
          context.agencyId,
          pdsVersionId,
          otherInformationView(source.otherInformation) as PdsOtherInformationInput,
        ),
      });
    }
    if (source.declarationDetails) {
      await extra.pdsDeclarationDetails.create({
        data: declarationData(
          context.agencyId,
          pdsVersionId,
          declarationDetailsView(source.declarationDetails) as PdsDeclarationDetailsInput,
        ),
      });
    }
    const referenceRows = referenceData(
      context.agencyId,
      pdsVersionId,
      source.referenceRecords.map((row: PdsRecord['referenceRecords'][number]) => ({
        ...referenceRecordView(row),
        id: undefined,
      })),
    );
    if (referenceRows.length) await extra.pdsReferenceRecord.createMany({ data: referenceRows });
    if (source.certificationDetails) {
      const certification = certificationDetailsView(
        source.certificationDetails,
      ) as PdsCertificationDetailsInput;
      await extra.pdsCertificationDetails.create({
        data: certificationData(context.agencyId, pdsVersionId, {
          ...certification,
          truthDeclarationAccepted: null,
          verificationAuthorizationAccepted: null,
          misrepresentationWarningAccepted: null,
          employeeSignatureDocumentId: null,
          employeeSignatureDocumentVersionId: null,
          employeeSignatureDate: null,
          thumbmarkDocumentId: null,
          thumbmarkDocumentVersionId: null,
          subscribedAndSwornAt: null,
          oathAdministeredBy: null,
          oathAdminSignatureDocumentId: null,
          oathAdminSignatureDocumentVersionId: null,
          oathAdministeredAt: null,
        }),
      });
    }
    await this.createWesArtifacts(
      transaction,
      context,
      pdsVersionId,
      source.employeeId,
      this.preservedWesInput(source),
    );
  }

  private async outputRecords(
    transaction: Prisma.TransactionClient,
    agencyId: string,
    pdsVersionId: string,
  ): Promise<PdsOutputRecord[]> {
    return pdsExtra(transaction).pdsOutputArtifact.findMany({
      where: { agencyId, pdsVersionId, status: 'RELEASED' },
      orderBy: [{ outputType: 'asc' }, { outputKey: 'asc' }],
    });
  }

  private async createOutputArtifacts(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    record: PdsRecord,
  ): Promise<PdsOutputRecord[]> {
    const extra = pdsExtra(transaction);
    const pdsContent = pdsRenderedContent(record);
    const base = {
      agencyId: context.agencyId,
      employeeId: record.employeeId,
      pdsVersionId: record.id,
      formVersion: record.formVersion,
      dataAsOfDate: record.asOfDate,
      status: 'RELEASED',
    };
    await extra.pdsOutputArtifact.create({
      data: {
        ...base,
        outputKey: `${record.id}:PDS:${record.formVersion}`,
        outputType: 'PDS',
        templateVersion: null,
        sourceArtifactId: `pds:${record.id}`,
        sourceArtifactHash: sourceHash(pdsContent),
        renderingMetadata: {
          pages: [...PDS_MAIN_PAGE_KEYS, ...continuationPages(record)],
          dateProfile: 'ISO-8601',
          revision: record.formVersion,
          layoutContract: {
            guideReference: pdsContent.guideReference,
            photo: pdsContent.photo,
            signaturePlacement: pdsContent.signaturePlacement,
            pages: pdsContent.pages,
          },
        },
        signatureMetadata: signatureMetadata(record),
        renderedContent: pdsContent,
      },
    });
    for (const artifact of record.wesArtifacts) {
      const content = wesRenderedContent(record, artifact);
      await extra.pdsOutputArtifact.create({
        data: {
          ...base,
          wesArtifactId: artifact.id,
          outputKey: `${record.id}:WES:${artifact.id}:${artifact.templateVersion}`,
          outputType: 'WES',
          templateVersion: artifact.templateVersion,
          sourceArtifactId: `wes:${artifact.id}`,
          sourceArtifactHash: sourceHash(content),
          renderingMetadata: {
            templateVersion: artifact.templateVersion,
            contextKey: artifact.contextKey,
            layoutContract: {
              header: content.header,
              title: content.title,
              fieldOrder: content.fieldOrder,
              signature: content.signature,
            },
          },
          signatureMetadata: signatureMetadata(record, artifact),
          renderedContent: content,
        },
      });
    }
    return this.outputRecords(transaction, context.agencyId, record.id);
  }

  private async assertEvidence(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    input: EvidenceInput,
  ): Promise<void> {
    await this.validateEvidenceLinks(transaction, context, [
      {
        documentId: input.documentId ?? null,
        documentVersionId: input.documentVersionId ?? null,
      },
    ]);
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
    return record.wesArtifacts.map((artifact: PdsRecord['wesArtifacts'][number]) => ({
      contextKey: artifact.contextKey,
      documentId: artifact.documentId,
      documentVersionId: artifact.documentVersionId,
      signatureDocumentId: null,
      signatureDocumentVersionId: null,
      signedAt: null,
      entries: artifact.entries.map(
        (entry: PdsRecord['wesArtifacts'][number]['entries'][number]) => ({
          workExperienceSequenceNo:
            record.workExperienceRecords.find(
              (row: PdsRecord['workExperienceRecords'][number]) =>
                row.id === entry.workExperienceId,
            )?.sequenceNo ?? undefined,
          sequenceNo: entry.sequenceNo,
          durationText: entry.durationText ?? '',
          position: entry.position,
          officeUnit: entry.officeUnit,
          immediateSupervisor: entry.immediateSupervisor,
          agencyOrganizationLocation: entry.agencyOrganizationLocation,
          accomplishments: entry.accomplishments,
          actualDuties: entry.actualDuties,
        }),
      ),
    }));
  }

  private assertWesEditable(record: PdsRecord): void {
    if (
      record.wesArtifacts.some(
        (artifact: PdsRecord['wesArtifacts'][number]) => artifact.status !== 'DRAFT',
      )
    ) {
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
      await this.assertEvidence(transaction, context, {
        documentId: artifact.signatureDocumentId,
        documentVersionId: artifact.signatureDocumentVersionId,
      });
      if (artifact.documentId) evidenceCount += 1;
      if (artifact.signatureDocumentId) evidenceCount += 1;

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
          employeeSignatureDocumentId: artifact.signatureDocumentId ?? null,
          employeeSignatureDocumentVersionId: artifact.signatureDocumentVersionId ?? null,
          signedAt: dateValue(artifact.signedAt),
        } as Prisma.PdsWesArtifactUncheckedCreateInput & Record<string, unknown>,
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
    return (await transaction.pdsVersion.findFirst({
      where: { agencyId, id },
      select: pdsSelect,
    })) as unknown as PdsRecord | null;
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
      select: { id: true },
    });
    if (!employee) throw this.notFound();
    const fieldScope = await readFieldScope(transaction, context, employeeId);
    if (!fieldScope) throw this.notFound();
    const records = (await transaction.pdsVersion.findMany({
      where: { agencyId: context.agencyId, employeeId },
      orderBy: { versionNo: 'desc' },
      take: PDS_VERSION_LIST_LIMIT,
      select: pdsSummarySelect,
    })) as unknown as PdsSummaryRecord[];
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
