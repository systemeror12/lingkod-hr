import type { DocumentAccess, DocumentSummary, DocumentVersionSummary } from './documents.service';

export class DocumentVersionDto {
  readonly id: string;
  readonly versionNo: number;
  readonly contentHash: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly createdAt: string;
  readonly issuedAt: string | null;

  constructor(version: DocumentVersionSummary) {
    this.id = version.id;
    this.versionNo = version.versionNo;
    this.contentHash = version.contentHash;
    this.mimeType = version.mimeType;
    this.sizeBytes = version.sizeBytes;
    this.createdAt = version.createdAt;
    this.issuedAt = version.issuedAt;
  }
}

export class DocumentDto {
  readonly id: string;
  readonly documentNo: string | null;
  readonly documentType: string;
  readonly classification: DocumentSummary['classification'];
  readonly status: string;
  readonly createdAt: string;
  readonly currentVersion: DocumentVersionDto | null;

  constructor(document: DocumentSummary) {
    this.id = document.id;
    this.documentNo = document.documentNo;
    this.documentType = document.documentType;
    this.classification = document.classification;
    this.status = document.status;
    this.createdAt = document.createdAt;
    this.currentVersion = document.currentVersion
      ? new DocumentVersionDto(document.currentVersion)
      : null;
  }
}

export class DocumentAccessDto extends DocumentDto {
  readonly accessUrl: string;
  readonly expiresAt: string;

  constructor(access: DocumentAccess) {
    super(access.document);
    this.accessUrl = access.accessUrl;
    this.expiresAt = access.expiresAt;
  }
}
