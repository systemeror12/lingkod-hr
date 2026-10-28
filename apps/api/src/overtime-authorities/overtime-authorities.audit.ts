import type { Prisma } from '@prisma/client';

export interface OvertimeAuthorityAuditWriter {
  write(
    transaction: Prisma.TransactionClient,
    event: Prisma.AuditEventUncheckedCreateInput,
  ): Promise<void>;
}

export const OVERTIME_AUTHORITY_AUDIT_WRITER = Symbol('OVERTIME_AUTHORITY_AUDIT_WRITER');

export const overtimeAuthorityAuditWriter: OvertimeAuthorityAuditWriter = {
  async write(transaction, event): Promise<void> {
    await transaction.auditEvent.create({ data: event });
  },
};
