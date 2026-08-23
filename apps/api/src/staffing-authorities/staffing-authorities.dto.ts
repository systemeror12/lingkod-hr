import type {
  StaffingAuthorityDetail,
  StaffingAuthorityEvidenceSummary,
  StaffingAuthorityLinkedEvidenceSummary,
  StaffingAuthoritySummary,
} from './staffing-authorities.service';

export class StaffingAuthorityLinkedEvidenceDto {
  readonly documentId: string;
  readonly documentNo: string | null;
  readonly documentType: string;
  readonly classification: string;
  readonly status: string;
  readonly versionNo: number | null;
  readonly mimeType: string | null;
  readonly sizeBytes: number | null;

  constructor(evidence: StaffingAuthorityLinkedEvidenceSummary) {
    this.documentId = evidence.documentId;
    this.documentNo = evidence.documentNo;
    this.documentType = evidence.documentType;
    this.classification = evidence.classification;
    this.status = evidence.status;
    this.versionNo = evidence.versionNo;
    this.mimeType = evidence.mimeType;
    this.sizeBytes = evidence.sizeBytes;
  }
}

export class StaffingAuthorityEvidenceDto extends StaffingAuthorityLinkedEvidenceDto {
  readonly validatedAt: string;
  readonly validationReason: string;

  constructor(evidence: StaffingAuthorityEvidenceSummary) {
    super(evidence);
    this.validatedAt = evidence.validatedAt;
    this.validationReason = evidence.validationReason;
  }
}

export class StaffingAuthorityDto {
  readonly id: string;
  readonly authorityType: StaffingAuthoritySummary['authorityType'];
  readonly referenceNo: string;
  readonly issuedDate: string;
  readonly effectiveDate: string;
  readonly sourceMetadata: StaffingAuthoritySummary['sourceMetadata'];
  readonly status: StaffingAuthoritySummary['status'];
  readonly evidence: StaffingAuthorityEvidenceDto | null;
  readonly revocationEvidence: StaffingAuthorityLinkedEvidenceDto | null;
  readonly supersededEffectiveDate: string | null;
  readonly revokedEffectiveDate: string | null;
  readonly revocationReason: string | null;
  readonly rowVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;

  constructor(authority: StaffingAuthoritySummary) {
    this.id = authority.id;
    this.authorityType = authority.authorityType;
    this.referenceNo = authority.referenceNo;
    this.issuedDate = authority.issuedDate;
    this.effectiveDate = authority.effectiveDate;
    this.sourceMetadata = authority.sourceMetadata;
    this.status = authority.status;
    this.evidence = authority.evidence
      ? new StaffingAuthorityEvidenceDto(authority.evidence)
      : null;
    this.revocationEvidence = authority.revocationEvidence
      ? new StaffingAuthorityLinkedEvidenceDto(authority.revocationEvidence)
      : null;
    this.supersededEffectiveDate = authority.supersededEffectiveDate;
    this.revokedEffectiveDate = authority.revokedEffectiveDate;
    this.revocationReason = authority.revocationReason;
    this.rowVersion = authority.rowVersion;
    this.createdAt = authority.createdAt;
    this.updatedAt = authority.updatedAt;
  }
}

export class StaffingAuthorityHistoryEntryDto {
  readonly id: string;
  readonly action: string;
  readonly previousStatus: string | null;
  readonly newStatus: string | null;
  readonly reason: string | null;
  readonly effectiveDate: string | null;
  readonly occurredAt: string;

  constructor(entry: StaffingAuthorityDetail['history'][number]) {
    this.id = entry.id;
    this.action = entry.action;
    this.previousStatus = entry.previousStatus;
    this.newStatus = entry.newStatus;
    this.reason = entry.reason;
    this.effectiveDate = entry.effectiveDate;
    this.occurredAt = entry.occurredAt;
  }
}

export class StaffingAuthorityDetailDto {
  readonly authority: StaffingAuthorityDto;
  readonly history: StaffingAuthorityHistoryEntryDto[];

  constructor(detail: StaffingAuthorityDetail) {
    this.authority = new StaffingAuthorityDto(detail.authority);
    this.history = detail.history.map((entry) => new StaffingAuthorityHistoryEntryDto(entry));
  }
}

export class StaffingAuthorityListResponseDto {
  readonly authorities: StaffingAuthorityDto[];

  constructor(authorities: StaffingAuthoritySummary[]) {
    this.authorities = authorities.map((authority) => new StaffingAuthorityDto(authority));
  }
}
