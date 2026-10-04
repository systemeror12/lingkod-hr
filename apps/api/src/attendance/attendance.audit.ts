import type { Prisma } from '@prisma/client';

export interface AttendanceAuditWriter {
  write(
    transaction: Prisma.TransactionClient,
    event: Prisma.AuditEventUncheckedCreateInput,
  ): Promise<void>;
}

export const ATTENDANCE_AUDIT_WRITER = Symbol('ATTENDANCE_AUDIT_WRITER');

export const attendanceAuditWriter: AttendanceAuditWriter = {
  async write(transaction, event): Promise<void> {
    await transaction.auditEvent.create({ data: event });
  },
};
