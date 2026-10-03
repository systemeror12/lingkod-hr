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
import { AGENCY_SEAL_STORAGE, SIGNED_URL_SECONDS } from './agency-seal.service';
import type { DocumentStorage } from '../documents/documents.storage';

export const PHOTO_RULES: BrandImageRules = {
  code: 'AGENCY_PHOTO',
  noun: 'photo',
  maxBytes: 5 * 1024 * 1024,
  maxLabel: '5 MB',
  minWidth: 1200,
  minHeight: 1,
  minLabel: 'Use at least 1200 px wide.',
};

export interface AgencyBuildingPhotoSummary {
  id: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  width: number;
  height: number;
  contentHash: string;
  shown: boolean;
  changedAt: string;
  changedByName: string;
  url: string;
}

type PhotoRecord = Prisma.AgencyBuildingPhotoGetPayload<object>;

/** Metadata shared by the settings DTO and the before/after Audit Event. Never returns object keys. */
function fileMetadata(photo: PhotoRecord) {
  return {
    id: photo.id,
    fileName: photo.fileName,
    contentType: photo.contentType,
    byteSize: photo.byteSize,
    width: photo.width,
    height: photo.height,
    contentHash: photo.contentHash,
    shown: photo.shown,
  };
}

/**
 * The Agency's building photo, which replaces the drawn scene on Invitation Activation while it is
 * shown. Stored, validated, and audited like the seal; saving a photo always shows it.
 */
@Injectable()
export class AgencyBuildingPhotoService {
  constructor(
    @Inject(AGENCY_SEAL_STORAGE) private readonly storage: DocumentStorage,
    @Inject(AGENCY_PROFILE_AUDIT_WRITER)
    private readonly auditWriter: AgencyProfileAuditWriter = agencyProfileAuditWriter,
  ) {}

  async read(context: RequestContext): Promise<{ photo: AgencyBuildingPhotoSummary | null }> {
    this.authorize(context, 'organization.agency.read');
    const record = await withDatabaseContext(requestDatabaseContext(context), (tx) =>
      tx.agencyBuildingPhoto.findUnique({ where: { agencyId: context.agencyId } }),
    );
    return { photo: record ? await this.summary(record) : null };
  }

  async save(
    context: RequestContext,
    file: BrandImageUpload,
    expectedPhotoId: string | null,
  ): Promise<{ photo: AgencyBuildingPhotoSummary }> {
    this.authorize(context, 'organization.agency.update');
    const image = await validateBrandImage(context, file, PHOTO_RULES);
    const objectKey = `agency-building-photos/${randomUUID()}`;
    let record: PhotoRecord;
    try {
      await this.storage.putObject({
        key: objectKey,
        body: file.buffer,
        contentType: image.contentType,
        contentHash: image.contentHash,
      });
      record = await withDatabaseContext(requestDatabaseContext(context), async (tx) => {
        const old = await this.lockCurrent(tx, context, expectedPhotoId);
        const data = {
          id: randomUUID(),
          objectKey,
          ...image,
          shown: true,
          ...(await this.changedBy(tx, context)),
        };
        const saved = await tx.agencyBuildingPhoto.upsert({
          where: { agencyId: context.agencyId },
          create: { agencyId: context.agencyId, ...data },
          update: data,
        });
        await this.audit(
          tx,
          context,
          old ? 'AGENCY_PHOTO_REPLACED' : 'AGENCY_PHOTO_SAVED',
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
    return { photo: await this.summary(record) };
  }

  /** Turns the kept photo on or off for Invitation screens. Repeating the current setting writes nothing. */
  async setShown(
    context: RequestContext,
    expectedPhotoId: string | null,
    shown: boolean,
  ): Promise<{ photo: AgencyBuildingPhotoSummary }> {
    this.authorize(context, 'organization.agency.update');
    const record = await withDatabaseContext(requestDatabaseContext(context), async (tx) => {
      const old = await this.lockCurrent(tx, context, expectedPhotoId);
      if (!old) {
        throw brandError(context, 'AGENCY_PHOTO_NOT_FOUND', 'Upload a building photo first.', 404);
      }
      if (old.shown === shown) return old;
      const saved = await tx.agencyBuildingPhoto.update({
        where: { agencyId: context.agencyId },
        data: { shown, ...(await this.changedBy(tx, context)) },
      });
      await this.audit(
        tx,
        context,
        shown ? 'AGENCY_PHOTO_SHOWN' : 'AGENCY_PHOTO_HIDDEN',
        old,
        saved,
      );
      return saved;
    });
    return { photo: await this.summary(record) };
  }

  async remove(context: RequestContext, expectedPhotoId: string | null): Promise<{ photo: null }> {
    this.authorize(context, 'organization.agency.update');
    await withDatabaseContext(requestDatabaseContext(context), async (tx) => {
      const old = await this.lockCurrent(tx, context, expectedPhotoId);
      if (!old) return;
      await tx.agencyBuildingPhoto.delete({ where: { agencyId: context.agencyId } });
      await this.audit(tx, context, 'AGENCY_PHOTO_REMOVED', old, null);
    });
    // Retain previous private objects to preserve the files referenced by Audit Events.
    return { photo: null };
  }

  private async lockCurrent(
    tx: Prisma.TransactionClient,
    context: RequestContext,
    expectedPhotoId: string | null,
  ) {
    await tx.$queryRaw`SELECT id FROM agencies WHERE id = ${context.agencyId}::uuid FOR UPDATE`;
    const old = await tx.agencyBuildingPhoto.findUnique({ where: { agencyId: context.agencyId } });
    if ((old?.id ?? null) !== expectedPhotoId) {
      throw brandError(
        context,
        'AGENCY_PHOTO_CHANGED',
        'The building photo changed while you were editing. Reload this page before saving.',
        409,
      );
    }
    return old;
  }

  private async changedBy(tx: Prisma.TransactionClient, context: RequestContext) {
    const actor = await tx.user.findUniqueOrThrow({
      where: { id: context.userId },
      select: { displayName: true },
    });
    return {
      changedAt: new Date(),
      changedByName: actor.displayName,
      changedByUserId: context.userId,
      changedByMembershipId: context.membershipId,
    };
  }

  private async summary(record: PhotoRecord): Promise<AgencyBuildingPhotoSummary> {
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
    before: PhotoRecord | null,
    after: PhotoRecord | null,
  ) {
    await this.auditWriter.write(tx, {
      agencyId: context.agencyId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      actorType: 'USER',
      action,
      entityType: 'AgencyBuildingPhoto',
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
        'AGENCY_PHOTO_FORBIDDEN',
        'The current Agency Membership lacks the required permission.',
        403,
      );
    }
  }
}
