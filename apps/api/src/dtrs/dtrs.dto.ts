import type {
  DtrDocumentDetail,
  DtrPeriodVersionSummary,
  DtrDocumentSummary,
  DtrGenerateResult,
  DtrManifest,
  DtrManifestDay,
  DtrManifestEmployee,
  DtrManifestPeriod,
  DtrPreview,
} from './dtrs.types';

export class DtrPeriodDto {
  readonly id: string;
  readonly code: string;
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly status: string;

  constructor(period: DtrManifestPeriod) {
    this.id = period.id;
    this.code = period.code;
    this.dateFrom = period.dateFrom;
    this.dateTo = period.dateTo;
    this.status = period.status;
  }
}

export class DtrEmployeeDto {
  readonly id: string;
  readonly employeeNumber: string;
  readonly legalName: string;

  constructor(employee: DtrManifestEmployee) {
    this.id = employee.id;
    this.employeeNumber = employee.employeeNumber;
    this.legalName = employee.legalName;
  }
}

export class DtrDocumentDto {
  readonly id: string;
  readonly agencyId: string;
  readonly attendancePeriodVersionId: string;
  readonly period: DtrPeriodDto;
  readonly versionNo: number;
  readonly versionStatus: string;
  readonly employee: DtrEmployeeDto;
  readonly classification: string;
  readonly outputType: string;
  readonly predecessorDtrDocumentId: string | null;
  readonly documentVersionId: string;
  readonly generatedAt: string;
  readonly isCurrent: boolean;

  constructor(record: DtrDocumentSummary) {
    this.id = record.id;
    this.agencyId = record.agencyId;
    this.attendancePeriodVersionId = record.attendancePeriodVersionId;
    this.period = new DtrPeriodDto(record.period);
    this.versionNo = record.versionNo;
    this.versionStatus = record.versionStatus;
    this.employee = new DtrEmployeeDto(record.employee);
    this.classification = record.classification;
    this.outputType = record.outputType;
    this.predecessorDtrDocumentId = record.predecessorDtrDocumentId;
    this.documentVersionId = record.documentVersionId;
    this.generatedAt = record.generatedAt;
    this.isCurrent = record.isCurrent;
  }
}

export class DtrDocumentListResponseDto {
  readonly dtrs: DtrDocumentDto[];

  constructor(records: readonly DtrDocumentSummary[]) {
    this.dtrs = records.map((record) => new DtrDocumentDto(record));
  }
}

export class DtrDocumentDetailDto {
  readonly document: DtrDocumentDto;
  readonly manifest: DtrManifest;

  constructor(detail: DtrDocumentDetail) {
    this.document = new DtrDocumentDto(detail.document);
    this.manifest = detail.manifest;
  }
}

export class DtrPreviewDto {
  readonly unfinalized: true;
  readonly period: DtrPeriodDto;
  readonly employee: DtrEmployeeDto;
  readonly days: DtrManifestDay[];

  constructor(preview: DtrPreview) {
    this.unfinalized = true;
    this.period = new DtrPeriodDto(preview.period);
    this.employee = new DtrEmployeeDto(preview.employee);
    this.days = preview.days;
  }
}

export class DtrPeriodVersionDto {
  readonly id: string;
  readonly attendancePeriodId: string;
  readonly versionNo: number;
  readonly status: string;
  readonly predecessorVersionId: string | null;
  readonly lockedAt: string | null;
  readonly dtrCount: number;

  constructor(record: DtrPeriodVersionSummary) {
    this.id = record.id;
    this.attendancePeriodId = record.attendancePeriodId;
    this.versionNo = record.versionNo;
    this.status = record.status;
    this.predecessorVersionId = record.predecessorVersionId;
    this.lockedAt = record.lockedAt;
    this.dtrCount = record.dtrCount;
  }
}

export class DtrPeriodVersionListResponseDto {
  readonly versions: DtrPeriodVersionDto[];

  constructor(records: readonly DtrPeriodVersionSummary[]) {
    this.versions = records.map((record) => new DtrPeriodVersionDto(record));
  }
}

export class DtrGenerateResponseDto {
  readonly attendancePeriodVersionId: string;
  readonly dtrDocumentIds: string[];
  readonly existingDtrDocumentIds: string[];

  constructor(result: DtrGenerateResult) {
    this.attendancePeriodVersionId = result.attendancePeriodVersionId;
    this.dtrDocumentIds = result.dtrDocumentIds;
    this.existingDtrDocumentIds = result.existingDtrDocumentIds;
  }
}
