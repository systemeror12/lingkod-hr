import { z } from 'zod';

export const terminalLeaveInputIdSchema = z.string().uuid();
export const terminalLeaveInputIdempotencyKeySchema = z.string().trim().min(1).max(200);
export const terminalLeaveInputReasonSchema = z.string().trim().min(1).max(500);
export const terminalLeaveInputResultSchema = z.enum(['READY', 'INDETERMINATE']);

export const terminalLeaveInputPreserveSchema = z
  .object({
    separationCaseId: terminalLeaveInputIdSchema,
    clearanceDocumentId: terminalLeaveInputIdSchema.optional(),
    supportingDocumentIds: z.array(terminalLeaveInputIdSchema).max(20).optional(),
    salarySourceDocumentId: terminalLeaveInputIdSchema.optional(),
    supersedesSnapshotId: terminalLeaveInputIdSchema.optional(),
    reason: terminalLeaveInputReasonSchema.optional(),
  })
  .strict();
