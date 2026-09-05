import type {
  PdsEvidenceView,
  PdsFamilyRecordView,
  PdsFamilyView,
  PdsEducationRecordView,
  PdsEligibilityRecordView,
  PdsLearningDevelopmentView,
  PdsPersonalDetailsView,
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
  readonly entries: PdsWesEntryDto[];

  constructor(value: PdsWesView) {
    super(value);
    Object.assign(this, value);
    this.entries = value.entries.map((entry) => new PdsWesEntryDto(entry));
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
