import type {
  OrganizationHierarchy,
  OrganizationHierarchyUnit,
  OrganizationUnitHistory,
  OrganizationUnitList,
  OrganizationUnitSummary,
  OrganizationUnitSuccessor,
  OrganizationUnitVersionSummary,
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

export class OrganizationUnitVersionDto {
  readonly id: string;
  readonly organizationUnitId: string;
  readonly versionNo: number;
  readonly code: string;
  readonly unitType: OrganizationUnitVersionSummary['unitType'];
  readonly officialName: string;
  readonly parentUnitId: string | null;
  readonly costCenterCode: string | null;
  readonly responsibilityCenterCode: string | null;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly versionState: OrganizationUnitVersionSummary['versionState'];
  readonly lifecycleStatus: OrganizationUnitVersionSummary['lifecycleStatus'];

  constructor(version: OrganizationUnitVersionSummary) {
    this.id = version.id;
    this.organizationUnitId = version.organizationUnitId;
    this.versionNo = version.versionNo;
    this.code = version.code;
    this.unitType = version.unitType;
    this.officialName = version.officialName;
    this.parentUnitId = version.parentUnitId;
    this.costCenterCode = version.costCenterCode;
    this.responsibilityCenterCode = version.responsibilityCenterCode;
    this.effectiveFrom = version.effectiveFrom;
    this.effectiveTo = version.effectiveTo;
    this.versionState = version.versionState;
    this.lifecycleStatus = version.lifecycleStatus;
  }
}

export class OrganizationUnitSuccessorDto {
  readonly current: OrganizationUnitVersionDto;
  readonly draft: OrganizationUnitVersionDto;

  constructor(successor: OrganizationUnitSuccessor) {
    this.current = new OrganizationUnitVersionDto(successor.current);
    this.draft = new OrganizationUnitVersionDto(successor.draft);
  }
}

export class OrganizationUnitHistoryDto {
  readonly unit: OrganizationUnitHistory['unit'];
  readonly asOf: string;
  readonly effective: OrganizationUnitVersionDto | null;
  readonly current: OrganizationUnitVersionDto | null;
  readonly draft: OrganizationUnitVersionDto | null;
  readonly versions: OrganizationUnitVersionDto[];
  readonly transitions: OrganizationUnitHistory['transitions'];

  constructor(history: OrganizationUnitHistory) {
    this.unit = history.unit;
    this.asOf = history.asOf;
    this.effective = history.effective ? new OrganizationUnitVersionDto(history.effective) : null;
    this.current = history.current ? new OrganizationUnitVersionDto(history.current) : null;
    this.draft = history.draft ? new OrganizationUnitVersionDto(history.draft) : null;
    this.versions = history.versions.map((version) => new OrganizationUnitVersionDto(version));
    this.transitions = history.transitions;
  }
}

export class OrganizationUnitListResponseDto {
  readonly units: OrganizationUnitDto[];
  readonly drafts?: OrganizationUnitVersionDto[];

  constructor(result: OrganizationUnitList) {
    this.units = result.units.map((unit) => new OrganizationUnitDto(unit));
    if (result.drafts)
      this.drafts = result.drafts.map((draft) => new OrganizationUnitVersionDto(draft));
  }
}
