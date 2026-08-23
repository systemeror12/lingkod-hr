import type {
  QualificationStandardDetail,
  QualificationStandardEvidenceSummary,
  QualificationStandardHistoryEntry,
  QualificationStandardSuccessor,
  QualificationStandardSummary,
  QualificationStandardVersionSummary,
} from './qualification-standards.service';

export class QualificationStandardEvidenceDto {
  readonly documentId: string;
  readonly documentNo: string | null;
  readonly documentType: string;
  readonly classification: string;
  readonly status: string;
  readonly versionNo: number;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly validatedAt: string;
  readonly validationReason: string;

  constructor(evidence: QualificationStandardEvidenceSummary) {
    this.documentId = evidence.documentId;
    this.documentNo = evidence.documentNo;
    this.documentType = evidence.documentType;
    this.classification = evidence.classification;
    this.status = evidence.status;
    this.versionNo = evidence.versionNo;
    this.mimeType = evidence.mimeType;
    this.sizeBytes = evidence.sizeBytes;
    this.validatedAt = evidence.validatedAt;
    this.validationReason = evidence.validationReason;
  }
}

export class QualificationStandardVersionDto {
  readonly id: string;
  readonly qualificationStandardId: string;
  readonly versionNo: number;
  readonly educationRequirement: string | null;
  readonly trainingHoursRequired: number | null;
  readonly experienceMonthsRequired: number | null;
  readonly eligibilityRequirement: string | null;
  readonly competencyRequirements: unknown[];
  readonly licenseRequirements: unknown[];
  readonly specialRequirements: string | null;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly versionState: QualificationStandardVersionSummary['versionState'];
  readonly lifecycleStatus: QualificationStandardVersionSummary['lifecycleStatus'];
  readonly sourceEvidence: QualificationStandardEvidenceDto | null;
  readonly approvalEvidence: QualificationStandardEvidenceDto | null;
  readonly rowVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;

  constructor(version: QualificationStandardVersionSummary) {
    this.id = version.id;
    this.qualificationStandardId = version.qualificationStandardId;
    this.versionNo = version.versionNo;
    this.educationRequirement = version.educationRequirement;
    this.trainingHoursRequired = version.trainingHoursRequired;
    this.experienceMonthsRequired = version.experienceMonthsRequired;
    this.eligibilityRequirement = version.eligibilityRequirement;
    this.competencyRequirements = version.competencyRequirements;
    this.licenseRequirements = version.licenseRequirements;
    this.specialRequirements = version.specialRequirements;
    this.effectiveFrom = version.effectiveFrom;
    this.effectiveTo = version.effectiveTo;
    this.versionState = version.versionState;
    this.lifecycleStatus = version.lifecycleStatus;
    this.sourceEvidence = version.sourceEvidence
      ? new QualificationStandardEvidenceDto(version.sourceEvidence)
      : null;
    this.approvalEvidence = version.approvalEvidence
      ? new QualificationStandardEvidenceDto(version.approvalEvidence)
      : null;
    this.rowVersion = version.rowVersion;
    this.createdAt = version.createdAt;
    this.updatedAt = version.updatedAt;
  }
}

export class QualificationStandardDto {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly status: QualificationStandardSummary['status'];
  readonly currentVersion: QualificationStandardVersionDto | null;
  readonly draft: QualificationStandardVersionDto | null;
  readonly createdAt: string;
  readonly updatedAt: string;

  constructor(standard: QualificationStandardSummary) {
    this.id = standard.id;
    this.code = standard.code;
    this.name = standard.name;
    this.status = standard.status;
    this.currentVersion = standard.currentVersion
      ? new QualificationStandardVersionDto(standard.currentVersion)
      : null;
    this.draft = standard.draft ? new QualificationStandardVersionDto(standard.draft) : null;
    this.createdAt = standard.createdAt;
    this.updatedAt = standard.updatedAt;
  }
}

export class QualificationStandardSuccessorDto {
  readonly current: QualificationStandardVersionDto;
  readonly draft: QualificationStandardVersionDto;

  constructor(successor: QualificationStandardSuccessor) {
    this.current = new QualificationStandardVersionDto(successor.current);
    this.draft = new QualificationStandardVersionDto(successor.draft);
  }
}

export class QualificationStandardHistoryEntryDto {
  readonly id: string;
  readonly action: string;
  readonly previousStatus: string | null;
  readonly newStatus: string | null;
  readonly reason: string | null;
  readonly effectiveDate: string | null;
  readonly occurredAt: string;

  constructor(entry: QualificationStandardHistoryEntry) {
    this.id = entry.id;
    this.action = entry.action;
    this.previousStatus = entry.previousStatus;
    this.newStatus = entry.newStatus;
    this.reason = entry.reason;
    this.effectiveDate = entry.effectiveDate;
    this.occurredAt = entry.occurredAt;
  }
}

export class QualificationStandardDetailDto {
  readonly standard: QualificationStandardDto;
  readonly asOf: string;
  readonly effective: QualificationStandardVersionDto | null;
  readonly versions: QualificationStandardVersionDto[];
  readonly history: QualificationStandardHistoryEntryDto[];

  constructor(detail: QualificationStandardDetail) {
    this.standard = new QualificationStandardDto(detail.standard);
    this.asOf = detail.asOf;
    this.effective = detail.effective
      ? new QualificationStandardVersionDto(detail.effective)
      : null;
    this.versions = detail.versions.map((version) => new QualificationStandardVersionDto(version));
    this.history = detail.history.map((entry) => new QualificationStandardHistoryEntryDto(entry));
  }
}

export class QualificationStandardListResponseDto {
  readonly standards: QualificationStandardDto[];

  constructor(standards: QualificationStandardSummary[]) {
    this.standards = standards.map((standard) => new QualificationStandardDto(standard));
  }
}
