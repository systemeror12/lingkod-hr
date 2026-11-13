import type { Prisma } from '@prisma/client';
import { holdsAgencyWide, type RequestContext } from '@lingkod-hr/auth';
import type { DocumentsService } from '../documents/documents.service';
import {
  AttendanceCorrectionServiceError,
  type AttendanceCorrectionEvidenceSummary,
} from './attendance-corrections.types';

export const correctionEvidenceSelect = {
  id: true,
  documentVersionId: true,
  sourceType: true,
  sourceId: true,
  createdAt: true,
  documentVersion: {
    select: {
      id: true,
      document: {
        select: { id: true, documentNo: true, documentType: true, classification: true },
      },
    },
  },
} satisfies Prisma.AttendanceCorrectionEvidenceSelect;

type CorrectionEvidenceRecord = Prisma.AttendanceCorrectionEvidenceGetPayload<{
  select: typeof correctionEvidenceSelect;
}>;

export function canReadSensitiveEvidence(context: RequestContext): boolean {
  return holdsAgencyWide(context, 'documents.evidence.read_sensitive');
}

/**
 * Applies the shared External Evidence rule to a requested Document Version:
 * same Agency, finalized, and `HIGHLY_SENSITIVE` only with
 * `documents.evidence.read_sensitive`.
 */
export async function assertCorrectionEvidenceLinkable(
  documents: DocumentsService,
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  versionId: string,
): Promise<void> {
  const version = await transaction.documentVersion.findFirst({
    where: { agencyId: context.agencyId, id: versionId },
    select: { documentId: true },
  });
  const evidence = version
    ? await documents.resolveExternalEvidenceInTransaction(transaction, context, {
        documentId: version.documentId,
        versionId,
        allowSensitive: canReadSensitiveEvidence(context),
        requirement: 'FINALIZED_VERSION',
      })
    : null;
  if (evidence?.ok === false && evidence.reason === 'SENSITIVE_FORBIDDEN') {
    throw new AttendanceCorrectionServiceError(
      'The documents.evidence.read_sensitive permission is required to link this evidence.',
      403,
      'ATTENDANCE_CORRECTION_EVIDENCE_FORBIDDEN',
    );
  }
  if (!evidence?.ok) {
    throw new AttendanceCorrectionServiceError(
      'Attendance Correction evidence must reference a finalized Document Version.',
      409,
      'ATTENDANCE_CORRECTION_EVIDENCE_INVALID',
    );
  }
}

/**
 * Shapes one evidence row for a reader. Readers without
 * `documents.evidence.read_sensitive` learn only that `HIGHLY_SENSITIVE`
 * evidence exists, never which Document Version it is.
 */
export function correctionEvidenceSummary(
  row: CorrectionEvidenceRecord,
  canReadSensitive: boolean,
): AttendanceCorrectionEvidenceSummary {
  const document = row.documentVersion?.document ?? null;
  if (document?.classification === 'HIGHLY_SENSITIVE' && !canReadSensitive) {
    return { access: 'RESTRICTED', id: row.id, createdAt: row.createdAt.toISOString() };
  }
  return {
    access: 'FULL',
    id: row.id,
    documentVersionId: row.documentVersionId,
    documentId: document?.id ?? null,
    documentNo: document?.documentNo ?? null,
    documentType: document?.documentType ?? null,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Lowercased because records keep the submitted uuid spelling, while
 * PostgreSQL matches uuids case-insensitively and returns them lowercase.
 */
function recordEvidenceId(record: Prisma.JsonValue): string | null {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) return null;
  const value = record.evidenceDocumentVersionId;
  return typeof value === 'string' ? value.toLowerCase() : null;
}

/**
 * Redacts the `evidenceDocumentVersionId` of requested or replacement
 * Attendance Context records for readers without
 * `documents.evidence.read_sensitive`. `HIGHLY_SENSITIVE` evidence becomes
 * `evidence: { access: 'RESTRICTED' }`; other records pass through unchanged.
 */
export async function redactRecordEvidence(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  records: readonly Prisma.JsonValue[],
): Promise<Prisma.JsonValue[]> {
  const ids = records.map(recordEvidenceId).filter((id) => id !== null);
  if (ids.length === 0 || canReadSensitiveEvidence(context)) return [...records];
  const sensitive = await transaction.documentVersion.findMany({
    where: {
      agencyId: context.agencyId,
      id: { in: ids },
      document: { classification: 'HIGHLY_SENSITIVE' },
    },
    select: { id: true },
  });
  const sensitiveIds = new Set(sensitive.map((version) => version.id));
  return records.map((record) => {
    const id = recordEvidenceId(record);
    if (id === null || !sensitiveIds.has(id)) return record;
    const restricted: Prisma.JsonObject = {
      ...(record as Prisma.JsonObject),
      evidence: { access: 'RESTRICTED' },
    };
    delete restricted.evidenceDocumentVersionId;
    return restricted;
  });
}
