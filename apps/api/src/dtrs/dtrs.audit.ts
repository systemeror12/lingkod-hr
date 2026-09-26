import type { Prisma } from '@prisma/client';

export interface DtrAuditWriter {
  write(
    transaction: Prisma.TransactionClient,
    event: Prisma.AuditEventUncheckedCreateInput,
  ): Promise<void>;
}

export const DTR_AUDIT_WRITER = Symbol('DTR_AUDIT_WRITER');

export const dtrAuditWriter: DtrAuditWriter = {
  async write(transaction, event): Promise<void> {
    await transaction.auditEvent.create({ data: event });
  },
};
