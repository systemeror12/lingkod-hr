import type { OrganizationUnitList, OrganizationUnitSummary } from './organization.service';

export class OrganizationUnitDto {
  readonly id: string;
  readonly code: string;
  readonly officialName: string;
  readonly unitType: OrganizationUnitSummary['unitType'];
  readonly effectiveDate: string;
  readonly status: OrganizationUnitSummary['status'];

  constructor(unit: OrganizationUnitSummary) {
    this.id = unit.id;
    this.code = unit.code;
    this.officialName = unit.officialName;
    this.unitType = unit.unitType;
    this.effectiveDate = unit.effectiveDate;
    this.status = unit.status;
  }
}

export class OrganizationUnitListResponseDto {
  readonly units: OrganizationUnitDto[];

  constructor(result: OrganizationUnitList) {
    this.units = result.units.map((unit) => new OrganizationUnitDto(unit));
  }
}
