import type { Prisma } from '@prisma/client';

export interface AttendanceSubmissionAuditWriter {
  write(
    transaction: Prisma.TransactionClient,
    event: Prisma.AuditEventUncheckedCreateInput,
  ): Promise<void>;
}

export const ATTENDANCE_SUBMISSION_AUDIT_WRITER = Symbol('ATTENDANCE_SUBMISSION_AUDIT_WRITER');

export const attendanceSubmissionAuditWriter: AttendanceSubmissionAuditWriter = {
  async write(transaction, event): Promise<void> {
    await transaction.auditEvent.create({ data: event });
  },
};
