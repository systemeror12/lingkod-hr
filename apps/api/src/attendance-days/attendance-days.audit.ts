import type { Prisma } from '@prisma/client';

export interface AttendanceDayAuditWriter {
  write(
    transaction: Prisma.TransactionClient,
    event: Prisma.AuditEventUncheckedCreateInput,
  ): Promise<void>;
}

export const ATTENDANCE_DAY_AUDIT_WRITER = Symbol('ATTENDANCE_DAY_AUDIT_WRITER');

export const attendanceDayAuditWriter: AttendanceDayAuditWriter = {
  async write(transaction, event): Promise<void> {
    await transaction.auditEvent.create({ data: event });
  },
};
