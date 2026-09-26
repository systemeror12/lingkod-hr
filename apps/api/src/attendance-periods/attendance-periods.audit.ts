import type { Prisma } from '@prisma/client';

export interface AttendancePeriodAuditWriter {
  write(
    transaction: Prisma.TransactionClient,
    event: Prisma.AuditEventUncheckedCreateInput,
  ): Promise<void>;
}

export const ATTENDANCE_PERIOD_AUDIT_WRITER = Symbol('ATTENDANCE_PERIOD_AUDIT_WRITER');

export const attendancePeriodAuditWriter: AttendancePeriodAuditWriter = {
  async write(transaction, event): Promise<void> {
    await transaction.auditEvent.create({ data: event });
  },
};
