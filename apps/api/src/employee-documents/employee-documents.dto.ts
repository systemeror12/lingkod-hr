import type { EmployeeDocumentAccess, EmployeeDocumentSummary } from './employee-documents.service';

export class EmployeeDocumentDto {
  readonly id: string;
  readonly employeeId: string;
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly documentNo: string | null;
  readonly documentType: string;
  readonly classification: EmployeeDocumentSummary['classification'];
  readonly status: string;
  readonly personnelClassification: EmployeeDocumentSummary['personnelClassification'];
  readonly purpose: EmployeeDocumentSummary['purpose'];
  readonly releaseState: EmployeeDocumentSummary['releaseState'];
  readonly versionNo: number;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly issuedAt: string | null;
  readonly createdAt: string;

  constructor(document: EmployeeDocumentSummary) {
    this.id = document.id;
    this.employeeId = document.employeeId;
    this.documentId = document.documentId;
    this.documentVersionId = document.documentVersionId;
    this.documentNo = document.documentNo;
    this.documentType = document.documentType;
    this.classification = document.classification;
    this.status = document.status;
    this.personnelClassification = document.personnelClassification;
    this.purpose = document.purpose;
    this.releaseState = document.releaseState;
    this.versionNo = document.versionNo;
    this.mimeType = document.mimeType;
    this.sizeBytes = document.sizeBytes;
    this.issuedAt = document.issuedAt;
    this.createdAt = document.createdAt;
  }
}

export class EmployeeDocumentListResponseDto {
  readonly documents: EmployeeDocumentDto[];

  constructor(documents: EmployeeDocumentSummary[]) {
    this.documents = documents.map((document) => new EmployeeDocumentDto(document));
  }
}

export class EmployeeDocumentAccessDto extends EmployeeDocumentDto {
  readonly accessUrl: string;
  readonly expiresAt: string;

  constructor(document: EmployeeDocumentAccess) {
    super(document);
    this.accessUrl = document.accessUrl;
    this.expiresAt = document.expiresAt;
  }
}

export class EmployeeDocumentRemovalDto {
  readonly removed = true;
}
