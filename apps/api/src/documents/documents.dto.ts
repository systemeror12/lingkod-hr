import type {
  DocumentAccess,
  DocumentSummary,
  DocumentVersionSummary,
  LinkableDocumentVersionSummary,
} from './documents.service';

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

export class DocumentListResponseDto {
  readonly documents: DocumentDto[];

  constructor(documents: DocumentSummary[]) {
    this.documents = documents.map((document) => new DocumentDto(document));
  }
}

export class LinkableDocumentVersionDto {
  readonly documentId: string;
  readonly documentNo: string | null;
  readonly documentType: string;
  readonly classification: LinkableDocumentVersionSummary['classification'];
  readonly status: string;
  readonly version: DocumentVersionDto;

  constructor(document: LinkableDocumentVersionSummary) {
    this.documentId = document.documentId;
    this.documentNo = document.documentNo;
    this.documentType = document.documentType;
    this.classification = document.classification;
    this.status = document.status;
    this.version = new DocumentVersionDto(document.version);
  }
}

export class LinkableDocumentVersionListResponseDto {
  readonly documents: LinkableDocumentVersionDto[];

  constructor(documents: LinkableDocumentVersionSummary[]) {
    this.documents = documents.map((document) => new LinkableDocumentVersionDto(document));
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
