import type { Prisma } from '@prisma/client';

export interface AttendanceConfigurationAuditWriter {
  write(
    transaction: Prisma.TransactionClient,
    event: Prisma.AuditEventUncheckedCreateInput,
  ): Promise<void>;
}

export const ATTENDANCE_CONFIGURATION_AUDIT_WRITER = Symbol(
  'ATTENDANCE_CONFIGURATION_AUDIT_WRITER',
);

export const attendanceConfigurationAuditWriter: AttendanceConfigurationAuditWriter = {
  async write(transaction, event): Promise<void> {
    await transaction.auditEvent.create({ data: event });
  },
};
