import type {
  PlantillaPositionDetail,
  PlantillaPositionEvidence,
  PlantillaPositionEvidenceAccess,
  PlantillaPositionHistoryEntry,
  PlantillaPositionSummary,
  PlantillaPositionSuccessor,
  PlantillaPositionVersionSummary,
} from './plantilla-positions.service';

export class PlantillaPositionEvidenceDto {
  readonly id: string;
  readonly positionId: string;
  readonly documentId: string;
  readonly documentNo: string | null;
  readonly documentType: string;
  readonly classification: PlantillaPositionEvidence['classification'];
  readonly status: string;
  readonly purpose: PlantillaPositionEvidence['purpose'];
  readonly versionNo: number;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly effectiveFrom: string | null;
  readonly createdAt: string;

  constructor(evidence: PlantillaPositionEvidence) {
    this.id = evidence.id;
    this.positionId = evidence.positionId;
    this.documentId = evidence.documentId;
    this.documentNo = evidence.documentNo;
    this.documentType = evidence.documentType;
    this.classification = evidence.classification;
    this.status = evidence.status;
    this.purpose = evidence.purpose;
    this.versionNo = evidence.versionNo;
    this.mimeType = evidence.mimeType;
    this.sizeBytes = evidence.sizeBytes;
    this.effectiveFrom = evidence.effectiveFrom;
    this.createdAt = evidence.createdAt;
  }
}

export class PlantillaPositionEvidenceListResponseDto {
  readonly evidence: PlantillaPositionEvidenceDto[];

  constructor(evidence: PlantillaPositionEvidence[]) {
    this.evidence = evidence.map((item) => new PlantillaPositionEvidenceDto(item));
  }
}

export class PlantillaPositionEvidenceAccessDto extends PlantillaPositionEvidenceDto {
  readonly accessUrl: string;
  readonly expiresAt: string;

  constructor(evidence: PlantillaPositionEvidenceAccess) {
    super(evidence);
    this.accessUrl = evidence.accessUrl;
    this.expiresAt = evidence.expiresAt;
  }
}

export class PlantillaPositionEvidenceRemovalDto {
  readonly removed: true;

  constructor() {
    this.removed = true;
  }
}

export class PlantillaPositionVersionDto {
  readonly id: string;
  readonly positionId: string;
  readonly versionNo: number;
  readonly title: string;
  readonly parentheticalTitle: string | null;
  readonly salaryGrade: number;
  readonly organizationUnit: PlantillaPositionVersionSummary['organizationUnit'];
  readonly fundingSource: string;
  readonly employmentCategory: PlantillaPositionVersionSummary['employmentCategory'];
  readonly qualificationStandard: PlantillaPositionVersionSummary['qualificationStandard'];
  readonly staffingAuthority: PlantillaPositionVersionSummary['staffingAuthority'];
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly versionState: PlantillaPositionVersionSummary['versionState'];
  readonly lifecycleStatus: PlantillaPositionVersionSummary['lifecycleStatus'];
  readonly rowVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;

  constructor(version: PlantillaPositionVersionSummary) {
    this.id = version.id;
    this.positionId = version.positionId;
    this.versionNo = version.versionNo;
    this.title = version.title;
    this.parentheticalTitle = version.parentheticalTitle;
    this.salaryGrade = version.salaryGrade;
    this.organizationUnit = version.organizationUnit;
    this.fundingSource = version.fundingSource;
    this.employmentCategory = version.employmentCategory;
    this.qualificationStandard = version.qualificationStandard;
    this.staffingAuthority = version.staffingAuthority;
    this.effectiveFrom = version.effectiveFrom;
    this.effectiveTo = version.effectiveTo;
    this.versionState = version.versionState;
    this.lifecycleStatus = version.lifecycleStatus;
    this.rowVersion = version.rowVersion;
    this.createdAt = version.createdAt;
    this.updatedAt = version.updatedAt;
  }
}

export class PlantillaPositionDto {
  readonly id: string;
  readonly itemNumber: string;
  readonly status: PlantillaPositionSummary['status'];
  readonly currentVersion: PlantillaPositionVersionDto | null;
  readonly draft: PlantillaPositionVersionDto | null;
  readonly createdAt: string;
  readonly updatedAt: string;

  constructor(position: PlantillaPositionSummary) {
    this.id = position.id;
    this.itemNumber = position.itemNumber;
    this.status = position.status;
    this.currentVersion = position.currentVersion
      ? new PlantillaPositionVersionDto(position.currentVersion)
      : null;
    this.draft = position.draft ? new PlantillaPositionVersionDto(position.draft) : null;
    this.createdAt = position.createdAt;
    this.updatedAt = position.updatedAt;
  }
}

export class PlantillaPositionListResponseDto {
  readonly positions: PlantillaPositionDto[];

  constructor(positions: PlantillaPositionSummary[]) {
    this.positions = positions.map((position) => new PlantillaPositionDto(position));
  }
}

export class PlantillaPositionHistoryEntryDto {
  readonly id: string;
  readonly action: string;
  readonly previousStatus: string | null;
  readonly newStatus: string | null;
  readonly reason: string | null;
  readonly effectiveDate: string | null;
  readonly occurredAt: string;

  constructor(entry: PlantillaPositionHistoryEntry) {
    this.id = entry.id;
    this.action = entry.action;
    this.previousStatus = entry.previousStatus;
    this.newStatus = entry.newStatus;
    this.reason = entry.reason;
    this.effectiveDate = entry.effectiveDate;
    this.occurredAt = entry.occurredAt;
  }
}

export class PlantillaPositionDetailDto {
  readonly position: PlantillaPositionDto;
  readonly asOf: string;
  readonly effective: PlantillaPositionVersionDto | null;
  readonly versions: PlantillaPositionVersionDto[];
  readonly evidence: PlantillaPositionEvidenceDto[];
  readonly history: PlantillaPositionHistoryEntryDto[];

  constructor(detail: PlantillaPositionDetail) {
    this.position = new PlantillaPositionDto(detail.position);
    this.asOf = detail.asOf;
    this.effective = detail.effective ? new PlantillaPositionVersionDto(detail.effective) : null;
    this.versions = detail.versions.map((version) => new PlantillaPositionVersionDto(version));
    this.evidence = detail.evidence.map((evidence) => new PlantillaPositionEvidenceDto(evidence));
    this.history = detail.history.map((entry) => new PlantillaPositionHistoryEntryDto(entry));
  }
}

export class PlantillaPositionSuccessorDto {
  readonly current: PlantillaPositionVersionDto;
  readonly draft: PlantillaPositionVersionDto;

  constructor(successor: PlantillaPositionSuccessor) {
    this.current = new PlantillaPositionVersionDto(successor.current);
    this.draft = new PlantillaPositionVersionDto(successor.draft);
  }
}
