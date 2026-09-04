import type {
  PdsEvidenceView,
  PdsCertificationDetailsView,
  PdsDeclarationDetailsView,
  PdsFamilyRecordView,
  PdsFamilyView,
  PdsEducationRecordView,
  PdsEligibilityRecordView,
  PdsLearningDevelopmentView,
  PdsOtherInformationView,
  PdsOutputArtifactList,
  PdsOutputArtifactView,
  PdsPageSignatureView,
  PdsPersonalDetailsView,
  PdsReferenceRecordView,
  PdsTransitionEventView,
  PdsVoluntaryWorkView,
  PdsWesEntryView,
  PdsWesView,
  PdsWorkExperienceView,
  PdsVersionDetail,
  PdsVersionList,
  PdsVersionSummary,
} from './pds.service';

export class PdsPersonalDetailsDto implements PdsPersonalDetailsView {
  declare readonly surname: string | null;
  declare readonly firstName: string | null;
  declare readonly nameExtension: string | null;
  declare readonly middleName: string | null;
  declare readonly birthDate: string | null;
  declare readonly birthPlace: string | null;
  declare readonly sex: string | null;
  declare readonly civilStatus: string | null;
  declare readonly civilStatusDetail: string | null;
  declare readonly heightMeters: number | null;
  declare readonly weightKilograms: number | null;
  declare readonly bloodType: string | null;
  declare readonly citizenship: string | null;
  declare readonly dualCitizenshipType: string | null;
  declare readonly dualCitizenshipCountry: string | null;
  declare readonly residentialAddress: Record<string, unknown> | null;
  declare readonly permanentAddress: Record<string, unknown> | null;
  declare readonly telephoneNumber: string | null;
  declare readonly mobileNumber: string | null;
  declare readonly emailAddress: string | null;

  constructor(value: PdsPersonalDetailsView) {
    Object.assign(this, value);
  }
}

export class PdsFamilyRecordDto implements PdsFamilyRecordView {
  declare readonly id: string;
  declare readonly relationshipType: PdsFamilyRecordView['relationshipType'];
  declare readonly sequenceNo: number;
  declare readonly fullName: string | null;
  declare readonly surname: string | null;
  declare readonly firstName: string | null;
  declare readonly middleName: string | null;
  declare readonly nameExtension: string | null;
  declare readonly birthDate: string | null;
  declare readonly occupation: string | null;
  declare readonly employerBusinessName: string | null;
  declare readonly businessAddress: Record<string, unknown> | null;
  declare readonly telephoneNumber: string | null;

  constructor(value: PdsFamilyRecordView) {
    Object.assign(this, value);
  }
}

export class PdsFamilyDto implements PdsFamilyView {
  readonly spouse: PdsFamilyRecordDto | null;
  readonly children: PdsFamilyRecordDto[];
  readonly father: PdsFamilyRecordDto | null;
  readonly mother: PdsFamilyRecordDto | null;

  constructor(value: PdsFamilyView) {
    this.spouse = value.spouse ? new PdsFamilyRecordDto(value.spouse) : null;
    this.children = value.children.map((child) => new PdsFamilyRecordDto(child));
    this.father = value.father ? new PdsFamilyRecordDto(value.father) : null;
    this.mother = value.mother ? new PdsFamilyRecordDto(value.mother) : null;
  }
}

export class PdsEducationRecordDto implements PdsEducationRecordView {
  declare readonly id: string;
  declare readonly level: string;
  declare readonly sequenceNo: number;
  declare readonly schoolName: string;
  declare readonly degreeCourse: string;
  declare readonly periodOfAttendance: string;
  declare readonly highestLevelUnits: string;
  declare readonly yearGraduated: number | null;
  declare readonly honors: string;
  declare readonly documentId: string | null;
  declare readonly documentVersionId: string | null;

  constructor(value: PdsEducationRecordView) {
    Object.assign(this, value);
  }
}

export class PdsEvidenceDto implements PdsEvidenceView {
  declare readonly documentId: string | null;
  declare readonly documentVersionId: string | null;

  constructor(value: PdsEvidenceView) {
    Object.assign(this, value);
  }
}

export class PdsEligibilityRecordDto implements PdsEligibilityRecordView {
  declare readonly id: string;
  declare readonly sequenceNo: number;
  declare readonly eligibilityName: string;
  declare readonly rating: string | null;
  declare readonly examDate: string | null;
  declare readonly examPlace: string;
  declare readonly licenseNo: string | null;
  declare readonly validUntil: string | null;
  declare readonly documentId: string | null;
  declare readonly documentVersionId: string | null;

  constructor(value: PdsEligibilityRecordView) {
    Object.assign(this, value);
  }
}

export class PdsWorkExperienceDto extends PdsEvidenceDto implements PdsWorkExperienceView {
  declare readonly id: string;
  declare readonly sequenceNo: number;
  declare readonly inclusiveFrom: string | null;
  declare readonly inclusiveTo: string | null;
  declare readonly positionTitle: string | null;
  declare readonly departmentAgencyOfficeCompany: string | null;
  declare readonly monthlySalary: number | null;
  declare readonly salaryGradeStep: string | null;
  declare readonly appointmentStatus: string | null;
  declare readonly governmentService: PdsWorkExperienceView['governmentService'];
  declare readonly isCurrent: boolean;

  constructor(value: PdsWorkExperienceView) {
    super(value);
    Object.assign(this, value);
  }
}

export class PdsVoluntaryWorkDto extends PdsEvidenceDto implements PdsVoluntaryWorkView {
  declare readonly id: string;
  declare readonly sequenceNo: number;
  declare readonly organizationNameAddress: string | null;
  declare readonly inclusiveFrom: string | null;
  declare readonly inclusiveTo: string | null;
  declare readonly hours: number | null;
  declare readonly positionNatureOfWork: string | null;

  constructor(value: PdsVoluntaryWorkView) {
    super(value);
    Object.assign(this, value);
  }
}

export class PdsLearningDevelopmentDto
  extends PdsEvidenceDto
  implements PdsLearningDevelopmentView
{
  declare readonly id: string;
  declare readonly sequenceNo: number;
  declare readonly interventionTitle: string | null;
  declare readonly attendanceFrom: string | null;
  declare readonly attendanceTo: string | null;
  declare readonly hours: number | null;
  declare readonly type: string | null;
  declare readonly conductedSponsoredBy: string | null;

  constructor(value: PdsLearningDevelopmentView) {
    super(value);
    Object.assign(this, value);
  }
}

export class PdsWesEntryDto implements PdsWesEntryView {
  declare readonly id: string;
  declare readonly workExperienceId: string;
  declare readonly sequenceNo: number;
  declare readonly durationText: string;
  declare readonly position: string;
  declare readonly officeUnit: string;
  declare readonly immediateSupervisor: string;
  declare readonly agencyOrganizationLocation: string;
  declare readonly accomplishments: string | null;
  declare readonly actualDuties: string;

  constructor(value: PdsWesEntryView) {
    Object.assign(this, value);
  }
}

export class PdsWesDto extends PdsEvidenceDto implements PdsWesView {
  declare readonly id: string;
  declare readonly contextKey: string;
  declare readonly templateVersion: string;
  declare readonly status: string;
  declare readonly signatureDocumentId: string | null;
  declare readonly signatureDocumentVersionId: string | null;
  declare readonly signedAt: string | null;
  readonly entries: PdsWesEntryDto[];

  constructor(value: PdsWesView) {
    super(value);
    Object.assign(this, value);
    this.entries = value.entries.map((entry) => new PdsWesEntryDto(entry));
  }
}

export class PdsOtherInformationDto implements PdsOtherInformationView {
  declare readonly skillsAndHobbies: string | null;
  declare readonly nonAcademicDistinctions: string | null;
  declare readonly associationMemberships: string | null;

  constructor(value: PdsOtherInformationView) {
    Object.assign(this, value);
  }
}

export class PdsDeclarationDetailsDto implements PdsDeclarationDetailsView {
  declare readonly relatedWithinThirdDegree: boolean | null;
  declare readonly relatedWithinFourthDegreeLgu: boolean | null;
  declare readonly relationshipDetails: string | null;
  declare readonly relatedWithinFourthDegreeDetails: string | null;
  declare readonly foundGuiltyAdministrativeOffense: boolean | null;
  declare readonly administrativeOffenseDetails: string | null;
  declare readonly criminallyCharged: boolean | null;
  declare readonly criminalChargeDetails: string | null;
  declare readonly criminalChargeDateFiled: string | null;
  declare readonly criminalChargeDateFiledUnknown: boolean | null;
  declare readonly criminalChargeStatus: string | null;
  declare readonly convictedOfCrime: boolean | null;
  declare readonly convictionDetails: string | null;
  declare readonly separatedFromService: boolean | null;
  declare readonly separationMode: string | null;
  declare readonly separationDetails: string | null;
  declare readonly candidateInLastElection: boolean | null;
  declare readonly candidacyDetails: string | null;
  declare readonly resignedBeforeElection: boolean | null;
  declare readonly resignationDetails: string | null;
  declare readonly immigrantOrPermanentResident: boolean | null;
  declare readonly immigrantCountry: string | null;
  declare readonly immigrantDetails: string | null;
  declare readonly indigenousGroupMember: boolean | null;
  declare readonly indigenousGroupDetails: string | null;
  declare readonly personWithDisability: boolean | null;
  declare readonly disabilitySpecification: string | null;
  declare readonly disabilityIdNumber: string | null;
  declare readonly soloParent: boolean | null;
  declare readonly soloParentSpecification: string | null;
  declare readonly soloParentIdNumber: string | null;

  constructor(value: PdsDeclarationDetailsView) {
    Object.assign(this, value);
  }
}

export class PdsReferenceRecordDto implements PdsReferenceRecordView {
  declare readonly id: string;
  declare readonly sequenceNo: number;
  declare readonly name: string;
  declare readonly address: string;
  declare readonly contact: string;

  constructor(value: PdsReferenceRecordView) {
    Object.assign(this, value);
  }
}

export class PdsCertificationDetailsDto implements PdsCertificationDetailsView {
  declare readonly truthDeclarationAccepted: boolean | null;
  declare readonly verificationAuthorizationAccepted: boolean | null;
  declare readonly misrepresentationWarningAccepted: boolean | null;
  declare readonly photoDocumentId: string | null;
  declare readonly photoDocumentVersionId: string | null;
  declare readonly governmentIdType: string | null;
  declare readonly governmentIdNumber: string | null;
  declare readonly governmentIdIssuedAt: string | null;
  declare readonly governmentIdIssuedPlace: string | null;
  declare readonly employeeSignatureDocumentId: string | null;
  declare readonly employeeSignatureDocumentVersionId: string | null;
  declare readonly employeeSignatureDate: string | null;
  declare readonly thumbmarkDocumentId: string | null;
  declare readonly thumbmarkDocumentVersionId: string | null;
  declare readonly subscribedAndSwornText: string | null;
  declare readonly subscribedAndSwornAt: string | null;
  declare readonly oathAdministeredBy: string | null;
  declare readonly oathAdminSignatureDocumentId: string | null;
  declare readonly oathAdminSignatureDocumentVersionId: string | null;
  declare readonly oathAdministeredAt: string | null;

  constructor(value: PdsCertificationDetailsView) {
    Object.assign(this, value);
  }
}

export class PdsPageSignatureDto implements PdsPageSignatureView {
  declare readonly id: string;
  declare readonly pageKey: PdsPageSignatureView['pageKey'];
  declare readonly signatureDocumentId: string | null;
  declare readonly signatureDocumentVersionId: string | null;
  declare readonly signedAt: string | null;
  declare readonly signatureDate: string | null;

  constructor(value: PdsPageSignatureView) {
    Object.assign(this, value);
  }
}

export class PdsTransitionEventDto implements PdsTransitionEventView {
  declare readonly id: string;
  declare readonly fromStatus: string | null;
  declare readonly toStatus: string;
  declare readonly action: string;
  declare readonly actorUserId: string;
  declare readonly actorMembershipId: string;
  declare readonly reason: string | null;
  declare readonly occurredAt: string;

  constructor(value: PdsTransitionEventView) {
    Object.assign(this, value);
  }
}

export class PdsVersionDto implements PdsVersionSummary {
  declare readonly id: string;
  declare readonly employeeId: string;
  declare readonly versionNo: number;
  declare readonly formVersion: string;
  declare readonly asOfDate: string;
  declare readonly status: PdsVersionSummary['status'];
  declare readonly supersedesVersionId: string | null;
  declare readonly correctionReason: string | null;
  declare readonly employeeCertifiedAt: string | null;
  declare readonly employeeCertifiedByMembershipId: string | null;
  declare readonly hrVerifiedAt: string | null;
  declare readonly hrVerifiedByMembershipId: string | null;
  declare readonly createdByMembershipId: string;
  declare readonly createdAt: string;
  declare readonly updatedByMembershipId: string;
  declare readonly updatedAt: string;
  declare readonly rowVersion: number;
  declare readonly fieldScope: PdsVersionSummary['fieldScope'];

  constructor(value: PdsVersionSummary) {
    Object.assign(this, value);
  }
}

export class PdsVersionDetailDto extends PdsVersionDto {
  readonly personal: PdsPersonalDetailsDto | null;
  readonly family: PdsFamilyDto;
  readonly education: PdsEducationRecordDto[];
  readonly eligibility: PdsEligibilityRecordDto[];
  readonly workExperience: PdsWorkExperienceDto[];
  readonly voluntaryWork: PdsVoluntaryWorkDto[];
  readonly learningAndDevelopment: PdsLearningDevelopmentDto[];
  readonly wes: PdsWesDto[];
  readonly otherInformation: PdsOtherInformationDto | null;
  readonly declarations: PdsDeclarationDetailsDto | null;
  readonly references: PdsReferenceRecordDto[];
  readonly certification: PdsCertificationDetailsDto | null;
  readonly pageSignatures: PdsPageSignatureDto[];
  readonly transitions: PdsTransitionEventDto[];

  constructor(value: PdsVersionDetail) {
    super(value);
    this.personal = value.personal ? new PdsPersonalDetailsDto(value.personal) : null;
    this.family = new PdsFamilyDto(value.family);
    this.education = value.education.map((record) => new PdsEducationRecordDto(record));
    this.eligibility = value.eligibility.map((record) => new PdsEligibilityRecordDto(record));
    this.workExperience = value.workExperience.map((row) => new PdsWorkExperienceDto(row));
    this.voluntaryWork = value.voluntaryWork.map((row) => new PdsVoluntaryWorkDto(row));
    this.learningAndDevelopment = value.learningAndDevelopment.map(
      (row) => new PdsLearningDevelopmentDto(row),
    );
    this.wes = value.wes.map((artifact) => new PdsWesDto(artifact));
    this.otherInformation = value.otherInformation
      ? new PdsOtherInformationDto(value.otherInformation)
      : null;
    this.declarations = value.declarations
      ? new PdsDeclarationDetailsDto(value.declarations)
      : null;
    this.references = value.references.map((record) => new PdsReferenceRecordDto(record));
    this.certification = value.certification
      ? new PdsCertificationDetailsDto(value.certification)
      : null;
    this.pageSignatures = value.pageSignatures.map((row) => new PdsPageSignatureDto(row));
    this.transitions = value.transitions.map((event) => new PdsTransitionEventDto(event));
  }
}

export class PdsOutputArtifactDto implements PdsOutputArtifactView {
  declare readonly id: string;
  declare readonly outputKey: string;
  declare readonly outputType: PdsOutputArtifactView['outputType'];
  declare readonly formVersion: string;
  declare readonly templateVersion: string | null;
  declare readonly sourceArtifactId: string;
  declare readonly sourceArtifactHash: string;
  declare readonly generatedAt: string;
  declare readonly dataAsOfDate: string;
  declare readonly status: string;
  declare readonly renderingMetadata: Record<string, unknown>;
  declare readonly signatureMetadata: Record<string, unknown> | null;
  declare readonly renderedContent: Record<string, unknown> | null;

  constructor(value: PdsOutputArtifactView) {
    Object.assign(this, value);
  }
}

export class PdsOutputArtifactListDto implements PdsOutputArtifactList {
  declare readonly pdsVersionId: string;
  declare readonly fieldScope: PdsOutputArtifactList['fieldScope'];
  readonly outputs: PdsOutputArtifactDto[];

  constructor(value: PdsOutputArtifactList) {
    this.pdsVersionId = value.pdsVersionId;
    this.fieldScope = value.fieldScope;
    this.outputs = value.outputs.map((output) => new PdsOutputArtifactDto(output));
  }
}

export class PdsVersionListResponseDto implements PdsVersionList {
  readonly employeeId: string;
  readonly citizenshipCountries: readonly string[];
  readonly current: PdsVersionDto | null;
  readonly draft: PdsVersionDto | null;
  readonly versions: PdsVersionDto[];

  constructor(value: PdsVersionList) {
    this.employeeId = value.employeeId;
    this.citizenshipCountries = value.citizenshipCountries;
    this.current = value.current ? new PdsVersionDto(value.current) : null;
    this.draft = value.draft ? new PdsVersionDto(value.draft) : null;
    this.versions = value.versions.map((version) => new PdsVersionDto(version));
  }
}
