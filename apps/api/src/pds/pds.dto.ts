import type {
  PdsFamilyRecordView,
  PdsFamilyView,
  PdsPersonalDetailsView,
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
  declare readonly umidIdNumber: string | null;
  declare readonly pagibigIdNumber: string | null;
  declare readonly philhealthNumber: string | null;
  declare readonly philSysCardNumber: string | null;
  declare readonly tinNumber: string | null;
  declare readonly agencyEmployeeNumber: string | null;
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

  constructor(value: PdsVersionDetail) {
    super(value);
    this.personal = value.personal ? new PdsPersonalDetailsDto(value.personal) : null;
    this.family = new PdsFamilyDto(value.family);
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
