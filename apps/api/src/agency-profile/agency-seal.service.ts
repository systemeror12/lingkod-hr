import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hasPermission, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import {
  AGENCY_PROFILE_AUDIT_WRITER,
  agencyProfileAuditWriter,
  type AgencyProfileAuditWriter,
} from './agency-profile.service';
import { requestDatabaseContext } from '../database-context';
import {
  brandError,
  validateBrandImage,
  type BrandImageRules,
  type BrandImageUpload,
} from './agency-brand-image';
import type { DocumentStorage } from '../documents/documents.storage';

export const AGENCY_SEAL_STORAGE = Symbol('AGENCY_SEAL_STORAGE');
export const SIGNED_URL_SECONDS = 300;
export const SEAL_RULES: BrandImageRules = {
  code: 'AGENCY_SEAL',
  noun: 'seal',
  maxBytes: 2 * 1024 * 1024,
  maxLabel: '2 MB',
  minWidth: 600,
  minHeight: 600,
  minLabel: 'Use at least 600 × 600 px to print.',
};

export interface AgencySealSummary {
  id: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  width: number;
  height: number;
  contentHash: string;
  changedAt: string;
  changedByName: string;
  url: string;
}

type SealRecord = Prisma.AgencySealGetPayload<object>;

/** Metadata shared by the settings DTO and the before/after Audit Event. Never returns object keys. */
function fileMetadata(seal: SealRecord) {
  return {
    id: seal.id,
    fileName: seal.fileName,
    contentType: seal.contentType,
    byteSize: seal.byteSize,
    width: seal.width,
    height: seal.height,
    contentHash: seal.contentHash,
  };
}

@Injectable()
export class AgencySealService {
  constructor(
    @Inject(AGENCY_SEAL_STORAGE) private readonly storage: DocumentStorage,
    @Inject(AGENCY_PROFILE_AUDIT_WRITER)
    private readonly auditWriter: AgencyProfileAuditWriter = agencyProfileAuditWriter,
  ) {}

  async read(context: RequestContext): Promise<{ seal: AgencySealSummary | null }> {
    this.authorize(context, 'organization.agency.read');
    const record = await withDatabaseContext(requestDatabaseContext(context), (tx) =>
      tx.agencySeal.findUnique({ where: { agencyId: context.agencyId } }),
    );
    return { seal: record ? await this.summary(record) : null };
  }

  async save(
    context: RequestContext,
    file: BrandImageUpload,
    expectedSealId: string | null,
  ): Promise<{ seal: AgencySealSummary }> {
    this.authorize(context, 'organization.agency.update');
    const image = await validateBrandImage(context, file, SEAL_RULES);
    const objectKey = `agency-seals/${randomUUID()}`;
    let record: SealRecord;
    try {
      await this.storage.putObject({
        key: objectKey,
        body: file.buffer,
        contentType: image.contentType,
        contentHash: image.contentHash,
      });
      record = await withDatabaseContext(requestDatabaseContext(context), async (tx) => {
        const old = await this.lockCurrent(tx, context, expectedSealId);
        const actor = await tx.user.findUniqueOrThrow({
          where: { id: context.userId },
          select: { displayName: true },
        });
        const data = {
          id: randomUUID(),
          objectKey,
          ...image,
          changedAt: new Date(),
          changedByName: actor.displayName,
          changedByUserId: context.userId,
          changedByMembershipId: context.membershipId,
        };
        const saved = await tx.agencySeal.upsert({
          where: { agencyId: context.agencyId },
          create: { agencyId: context.agencyId, ...data },
          update: data,
        });
        await this.audit(
          tx,
          context,
          old ? 'AGENCY_SEAL_REPLACED' : 'AGENCY_SEAL_SAVED',
          old,
          saved,
        );
        return saved;
      });
    } catch (error) {
      // A failed database commit must not leave a newly uploaded object behind.
      await this.storage.deleteObject(objectKey).catch(() => undefined);
      throw error;
    }
    return { seal: await this.summary(record) };
  }

  async remove(context: RequestContext, expectedSealId: string | null): Promise<{ seal: null }> {
    this.authorize(context, 'organization.agency.update');
    await withDatabaseContext(requestDatabaseContext(context), async (tx) => {
      const old = await this.lockCurrent(tx, context, expectedSealId);
      if (!old) return;
      await tx.agencySeal.delete({ where: { agencyId: context.agencyId } });
      await this.audit(tx, context, 'AGENCY_SEAL_REMOVED', old, null);
    });
    // Retain previous private objects to preserve the files referenced by Audit Events.
    return { seal: null };
  }

  private async lockCurrent(
    tx: Prisma.TransactionClient,
    context: RequestContext,
    expectedSealId: string | null,
  ) {
    await tx.$queryRaw`SELECT id FROM agencies WHERE id = ${context.agencyId}::uuid FOR UPDATE`;
    const old = await tx.agencySeal.findUnique({ where: { agencyId: context.agencyId } });
    if ((old?.id ?? null) !== expectedSealId) {
      throw brandError(
        context,
        'AGENCY_SEAL_CHANGED',
        'The seal changed while you were editing. Reload this page before saving.',
        409,
      );
    }
    return old;
  }

  private async summary(record: SealRecord): Promise<AgencySealSummary> {
    return {
      ...fileMetadata(record),
      changedAt: record.changedAt.toISOString(),
      changedByName: record.changedByName,
      url: await this.storage.signedReadUrl(record.objectKey, SIGNED_URL_SECONDS),
    };
  }

  private async audit(
    tx: Prisma.TransactionClient,
    context: RequestContext,
    action: string,
    before: SealRecord | null,
    after: SealRecord | null,
  ) {
    await this.auditWriter.write(tx, {
      agencyId: context.agencyId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      actorType: 'USER',
      action,
      entityType: 'AgencySeal',
      entityId: after?.id ?? before!.id,
      requestId: context.requestId,
      metadata: {
        before: before ? fileMetadata(before) : null,
        after: after ? fileMetadata(after) : null,
      },
    });
  }

  private authorize(context: RequestContext, permission: string) {
    if (!hasPermission(context, permission)) {
      throw brandError(
        context,
        'AGENCY_SEAL_FORBIDDEN',
        'The current Agency Membership lacks the required permission.',
        403,
      );
    }
  }
}
