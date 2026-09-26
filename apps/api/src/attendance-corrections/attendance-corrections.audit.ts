import type { Prisma } from '@prisma/client';

export interface AttendanceCorrectionAuditWriter {
  write(
    transaction: Prisma.TransactionClient,
    event: Prisma.AuditEventUncheckedCreateInput,
  ): Promise<void>;
}

export const ATTENDANCE_CORRECTION_AUDIT_WRITER = Symbol('ATTENDANCE_CORRECTION_AUDIT_WRITER');

export const attendanceCorrectionAuditWriter: AttendanceCorrectionAuditWriter = {
  async write(transaction, event): Promise<void> {
    await transaction.auditEvent.create({ data: event });
  },
};
