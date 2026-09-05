import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';

export class SeparationServiceError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'SeparationServiceError';
  }
}

export interface SeparationEffectInput {
  effectType:
    | 'CLOSE_SERVICE'
    | 'VACATE_POSITION'
    | 'STOP_PAYROLL'
    | 'DEACTIVATE_MEMBERSHIP'
    | 'REVOKE_SESSIONS';
  targetType: string;
  targetId: string;
}

export interface SeparationAuditWriter {
  write(
    transaction: Prisma.TransactionClient,
    event: Prisma.AuditEventUncheckedCreateInput,
  ): Promise<void>;
}

export const SEPARATION_AUDIT_WRITER = Symbol('SEPARATION_AUDIT_WRITER');

export const separationAuditWriter: SeparationAuditWriter = {
  async write(transaction, event): Promise<void> {
    await transaction.auditEvent.create({ data: event });
  },
};

@Injectable()
export class SeparationsService {
  constructor(
    @Inject(SEPARATION_AUDIT_WRITER) private readonly auditWriter: SeparationAuditWriter,
  ) {}

  async requireClearedCaseInTransaction(
    transaction: Prisma.TransactionClient,
    input: {
      agencyId: string;
      employeeId: string;
      separationType: string;
      serviceSegmentId: string;
      positionIncumbencyId: string;
      effectivity: Date;
    },
  ): Promise<{ id: string }> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "separation_cases" WHERE "agency_id" = CAST(${input.agencyId} AS uuid) AND "employee_id" = CAST(${input.employeeId} AS uuid) AND "separation_type" = ${input.separationType} AND "approved_effective_date" = ${input.effectivity}::date AND "status" IN ('APPROVED', 'CLEARANCE_IN_PROGRESS', 'CLEARED') FOR UPDATE`,
    );
    const record = rows[0]
      ? await transaction.separationCase.findFirst({
          where: { agencyId: input.agencyId, id: rows[0].id },
          select: {
            id: true,
            status: true,
            approvedByMembershipId: true,
            serviceSegmentId: true,
            positionIncumbencyId: true,
          },
        })
      : null;
    if (
      !record ||
      !record.approvedByMembershipId ||
      record.serviceSegmentId !== input.serviceSegmentId ||
      (record.positionIncumbencyId && record.positionIncumbencyId !== input.positionIncumbencyId)
    ) {
      throw new SeparationServiceError(
        'An exact approved Separation Case is required before service can close.',
        'PERSONNEL_ACTION_SEPARATION_CASE_REQUIRED',
      );
    }
    if (record.status !== 'CLEARED') {
      throw new SeparationServiceError(
        'The Separation Case remains pending until clearance is complete.',
        'PERSONNEL_ACTION_CLEARANCE_PENDING',
      );
    }
    return { id: record.id };
  }

  async completeInTransaction(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    input: {
      separationCaseId: string;
      personnelActionId: string;
      reason: string;
      idempotencyKey: string;
      effects: readonly SeparationEffectInput[];
      appliedAt: Date;
    },
  ): Promise<void> {
    await transaction.separationEffect.createMany({
      data: input.effects.map((effect) => ({
        agencyId: context.agencyId,
        separationCaseId: input.separationCaseId,
        ...effect,
        appliedAt: input.appliedAt,
        status: 'APPLIED',
      })),
    });
    await transaction.separationCase.update({
      where: {
        agencyId_id: { agencyId: context.agencyId, id: input.separationCaseId },
      },
      data: { status: 'EFFECTIVE', effectuatedAt: input.appliedAt },
    });
    await this.auditWriter.write(transaction, {
      agencyId: context.agencyId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      actorType: 'USER',
      action: 'SEPARATION_EFFECTUATED',
      entityType: 'SeparationCase',
      entityId: input.separationCaseId,
      previousStatus: 'CLEARED',
      newStatus: 'EFFECTIVE',
      reason: input.reason,
      requestId: context.requestId,
      idempotencyKey: input.idempotencyKey,
      occurredAt: input.appliedAt,
      metadata: {
        personnelActionId: input.personnelActionId,
        effectCount: input.effects.length,
      },
    });
  }
}
