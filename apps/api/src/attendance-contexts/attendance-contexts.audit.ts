import type { Prisma } from '@prisma/client';

export interface AttendanceContextAuditWriter {
  write(
    transaction: Prisma.TransactionClient,
    event: Prisma.AuditEventUncheckedCreateInput,
  ): Promise<void>;
}

export const ATTENDANCE_CONTEXT_AUDIT_WRITER = Symbol('ATTENDANCE_CONTEXT_AUDIT_WRITER');

export const attendanceContextAuditWriter: AttendanceContextAuditWriter = {
  async write(transaction, event): Promise<void> {
    await transaction.auditEvent.create({ data: event });
  },
};
