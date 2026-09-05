import type { SalnComplianceOwnSummary, SalnComplianceSummary } from './saln-compliance.service';

export class SalnComplianceDto {
  declare readonly id: string;
  declare readonly filingYear: number;
  declare readonly filingType: string;
  declare readonly status: string;
  declare readonly submittedAt: string | null;
  declare readonly createdAt: string;
  declare readonly employeeId?: string;
  declare readonly requirementReference?: string;
  declare readonly repositoryReference?: string | null;
  declare readonly acknowledgmentDocumentId?: string | null;
  declare readonly acknowledgmentDocumentVersionId?: string | null;
  declare readonly correctsRecordId?: string | null;
  declare readonly correctionReason?: string | null;
  declare readonly actorDisplayName?: string | null;

  constructor(record: SalnComplianceSummary | SalnComplianceOwnSummary) {
    Object.assign(this, record);
  }
}

export class SalnComplianceListDto {
  readonly records: SalnComplianceDto[];

  constructor(records: Array<SalnComplianceSummary | SalnComplianceOwnSummary>) {
    this.records = records.map((record) => new SalnComplianceDto(record));
  }
}
