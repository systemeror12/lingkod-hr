import type {
  OrganizationHierarchy,
  OrganizationHierarchyUnit,
  OrganizationUnitList,
  OrganizationUnitSummary,
} from './organization.service';

export class OrganizationUnitDto {
  readonly id: string;
  readonly code: string;
  readonly officialName: string;
  readonly unitType: OrganizationUnitSummary['unitType'];
  readonly effectiveDate: string;
  readonly effectiveTo: string | null;
  readonly parentUnitId: string | null;
  readonly versionState: OrganizationUnitSummary['versionState'];
  readonly lifecycleStatus: OrganizationUnitSummary['lifecycleStatus'];
  readonly status: OrganizationUnitSummary['status'];

  constructor(unit: OrganizationUnitSummary) {
    this.id = unit.id;
    this.code = unit.code;
    this.officialName = unit.officialName;
    this.unitType = unit.unitType;
    this.effectiveDate = unit.effectiveDate;
    this.effectiveTo = unit.effectiveTo;
    this.parentUnitId = unit.parentUnitId;
    this.versionState = unit.versionState;
    this.lifecycleStatus = unit.lifecycleStatus;
    this.status = unit.status;
  }
}

export class OrganizationHierarchyUnitDto {
  readonly id: string;
  readonly code: string;
  readonly officialName: string;
  readonly unitType: OrganizationHierarchyUnit['unitType'];
  readonly parentUnitId: string | null;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly lifecycleStatus: OrganizationHierarchyUnit['lifecycleStatus'];
  readonly childCount: number;

  constructor(unit: OrganizationHierarchyUnit) {
    this.id = unit.id;
    this.code = unit.code;
    this.officialName = unit.officialName;
    this.unitType = unit.unitType;
    this.parentUnitId = unit.parentUnitId;
    this.effectiveFrom = unit.effectiveFrom;
    this.effectiveTo = unit.effectiveTo;
    this.lifecycleStatus = unit.lifecycleStatus;
    this.childCount = unit.childCount;
  }
}

export class OrganizationHierarchyResponseDto {
  readonly asOf: string;
  readonly eligibleParentIds: string[];
  readonly units: OrganizationHierarchyUnitDto[];

  constructor(hierarchy: OrganizationHierarchy) {
    this.asOf = hierarchy.asOf;
    this.eligibleParentIds = hierarchy.eligibleParentIds;
    this.units = hierarchy.units.map((unit) => new OrganizationHierarchyUnitDto(unit));
  }
}

export class OrganizationUnitListResponseDto {
  readonly units: OrganizationUnitDto[];

  constructor(result: OrganizationUnitList) {
    this.units = result.units.map((unit) => new OrganizationUnitDto(unit));
  }
}
