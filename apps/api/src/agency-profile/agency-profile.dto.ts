import type { AgencyProfileList, AgencyProfileVersionSummary } from './agency-profile.service';

export class AgencyProfileVersionDto {
  readonly id: string;
  readonly versionNo: number;
  readonly versionState: AgencyProfileVersionSummary['versionState'];
  readonly domainStatus: AgencyProfileVersionSummary['domainStatus'];
  readonly officialName: string;
  readonly acronym: string | null;
  readonly agencyType: AgencyProfileVersionSummary['agencyType'];
  readonly parentOrganization: string | null;
  readonly reportingIdentifiers: string | null;
  readonly appointingAuthorityTitle: string | null;
  readonly defaultTimezone: string;
  readonly defaultCurrency: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;

  constructor(version: AgencyProfileVersionSummary) {
    this.id = version.id;
    this.versionNo = version.versionNo;
    this.versionState = version.versionState;
    this.domainStatus = version.domainStatus;
    this.officialName = version.officialName;
    this.acronym = version.acronym;
    this.agencyType = version.agencyType;
    this.parentOrganization = version.parentOrganization;
    this.reportingIdentifiers = version.reportingIdentifiers;
    this.appointingAuthorityTitle = version.appointingAuthorityTitle;
    this.defaultTimezone = version.defaultTimezone;
    this.defaultCurrency = version.defaultCurrency;
    this.effectiveFrom = version.effectiveFrom;
    this.effectiveTo = version.effectiveTo;
  }
}

export class AgencyProfileResponseDto {
  readonly current: AgencyProfileVersionDto | null;
  readonly draft: AgencyProfileVersionDto | null;
  readonly versions: AgencyProfileVersionDto[];

  constructor(result: AgencyProfileList) {
    this.current = result.current ? new AgencyProfileVersionDto(result.current) : null;
    this.draft = result.draft ? new AgencyProfileVersionDto(result.draft) : null;
    this.versions = result.versions.map((version) => new AgencyProfileVersionDto(version));
  }
}
