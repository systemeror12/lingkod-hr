import { z } from 'zod';
import { DOCUMENT_CLASSIFICATIONS } from '../documents/documents.service';
import {
  PERSONNEL_DOCUMENT_CLASSIFICATIONS,
  PERSONNEL_DOCUMENT_PURPOSES,
  PERSONNEL_DOCUMENT_RELEASE_STATES,
} from './employee-documents.service';

export const employeeDocumentIdSchema = z.string().uuid();

export const employeeDocumentLinkSchema = z
  .object({
    documentId: z.string().uuid(),
    documentVersionId: z.string().uuid(),
    personnelClassification: z.enum(PERSONNEL_DOCUMENT_CLASSIFICATIONS),
    purpose: z.enum(PERSONNEL_DOCUMENT_PURPOSES),
    releaseState: z.enum(PERSONNEL_DOCUMENT_RELEASE_STATES).optional(),
  })
  .strict();

export const employeeDocumentUploadSchema = z
  .object({
    classification: z.enum(DOCUMENT_CLASSIFICATIONS),
    personnelClassification: z.enum(PERSONNEL_DOCUMENT_CLASSIFICATIONS),
    purpose: z.enum(PERSONNEL_DOCUMENT_PURPOSES),
  })
  .strict();

export const employeeDocumentRemovalSchema = z
  .object({ reason: z.string().trim().min(1).max(500) })
  .strict();
