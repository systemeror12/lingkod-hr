import 'reflect-metadata';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import { hashSessionToken, type RequestContext } from '@lingkod-hr/auth';
import { withDatabaseContext } from '@lingkod-hr/database';
import { expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { AuthService } from '../auth/auth.service';
import { PermissionGuard } from '../auth/permission.guard';
import { AuditController } from '../audit/audit.controller';
import { AuditService } from '../audit/audit.service';
import { AGENCY_PROFILE_AUDIT_WRITER, agencyProfileAuditWriter } from './agency-profile.service';
import { AgencyBuildingPhotoController } from './agency-building-photo.controller';
import {
  AgencyBuildingPhotoService,
  type AgencyBuildingPhotoSummary,
} from './agency-building-photo.service';
import { AGENCY_SEAL_STORAGE } from './agency-seal.service';

const enabled = process.env.DATABASE_E2E === 'true';

it.skipIf(!enabled)(
  'saves, hides, shows, replaces, and removes a building photo with audit history and Agency isolation',
  async () => {
    const admin = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_E2E_ADMIN_URL ?? '' } },
    });
    const suffix = randomUUID();
    const agency = await admin.agency.create({
      data: {
        code: `PHOTO-${suffix}`,
        name: 'Photo Test Agency',
        acronym: 'PTA',
        agencyType: 'NGA',
        status: 'ACTIVE',
      },
    });
    const other = await admin.agency.create({
      data: {
        code: `PHOTO-OTHER-${suffix}`,
        name: 'Other Photo Agency',
        agencyType: 'NGA',
        status: 'ACTIVE',
      },
    });
    const user = await admin.user.create({
      data: {
        emailNormalized: `photo-${suffix}@example.test`,
        displayName: 'Photo Administrator',
        globalStatus: 'ACTIVE',
      },
    });
    const membership = await admin.agencyMembership.create({
      data: { agencyId: agency.id, userId: user.id, status: 'ACTIVE' },
    });
    const permissions: RequestContext['permissions'] = [
      'organization.agency.read',
      'organization.agency.update',
      'audit.events.read',
    ].map((code) => ({ code, scopePolicy: 'AGENCY' }));
    let context: RequestContext = {
      agencyId: agency.id,
      userId: user.id,
      membershipId: membership.id,
      requestId: 'photo-integration',
      primaryOrganizationUnitId: null,
      permissions,
    };
    const storage = {
      putObject: vi.fn().mockResolvedValue(undefined),
      deleteObject: vi.fn().mockResolvedValue(undefined),
      signedReadUrl: vi.fn().mockResolvedValue('https://storage.example.test/signed-photo'),
    };
    @Module({
      controllers: [AgencyBuildingPhotoController, AuditController],
      providers: [
        AgencyBuildingPhotoService,
        AuditService,
        PermissionGuard,
        { provide: AGENCY_SEAL_STORAGE, useValue: storage },
        { provide: AGENCY_PROFILE_AUDIT_WRITER, useValue: agencyProfileAuditWriter },
        {
          provide: AuthService,
          useValue: {
            authenticateSession: async () => ({ context, display: { effectiveRoles: [] } }),
          },
        },
      ],
    })
    class TestModule {}
    const app = await NestFactory.create(TestModule, { logger: ['error'], abortOnError: false });
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const route = `${base}/agencies/${agency.id}/agency-profile/building-photo`;
    function request(url: string, init: RequestInit = {}) {
      return fetch(url, {
        ...init,
        headers: { ...init.headers, authorization: 'Bearer photo-test' },
      });
    }
    function json(method: string, body: object) {
      return request(route, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    }
    const image = async (width = 1200, height = 800) =>
      sharp({ create: { width, height, channels: 3, background: '#24508f' } })
        .jpeg()
        .toBuffer();
    async function upload(
      buffer: Buffer,
      name: string,
      type = 'image/jpeg',
      expectedPhotoId = '',
      url = route,
    ) {
      const form = new FormData();
      form.append('expectedPhotoId', expectedPhotoId);
      form.append('file', new Blob([new Uint8Array(buffer)], { type }), name);
      return request(url, { method: 'PUT', body: form });
    }
    const current = async () =>
      ((await (await request(route)).json()) as { photo: AgencyBuildingPhotoSummary | null }).photo;
    const body = await image();
    const token = randomBytes(32).toString('base64url');
    await admin.invitation.create({
      data: {
        agencyId: agency.id,
        emailNormalized: `invite-${suffix}@example.test`,
        tokenHash: new Uint8Array(hashSessionToken(token)),
        requestedRoleCodes: ['employee'],
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const auth = new AuthService();
    const invitationPhotoUrl = async () => {
      const lookup = await auth.lookupInvitation(token);
      if (lookup.status !== 'VALID') throw new Error('Expected valid invitation');
      return lookup.agency.photoUrl;
    };
    try {
      await expect(invitationPhotoUrl()).resolves.toBeNull();
      const savedResponse = await upload(body, 'building.jpg');
      expect(savedResponse.status).toBe(200);
      const saved = ((await savedResponse.json()) as { photo: AgencyBuildingPhotoSummary }).photo;
      expect(saved).toMatchObject({
        fileName: 'building.jpg',
        contentType: 'image/jpeg',
        width: 1200,
        height: 800,
        byteSize: body.length,
        contentHash: createHash('sha256').update(body).digest('hex'),
        shown: true,
        changedByName: 'Photo Administrator',
      });
      expect(saved).not.toHaveProperty('objectKey');
      const objectKey = storage.putObject.mock.calls[0]![0].key as string;
      expect(objectKey).toMatch(/^agency-building-photos\/[a-f0-9-]{36}$/);

      for (const [buffer, name, type, code, limit] of [
        [
          Buffer.from('GIF89a'),
          'wrong.gif',
          'image/gif',
          'AGENCY_PHOTO_TYPE_INVALID',
          'PNG or JPEG',
        ],
        [
          Buffer.alloc(6 * 1024 * 1024),
          'large.jpg',
          'image/jpeg',
          'AGENCY_PHOTO_TOO_LARGE',
          '5 MB',
        ],
        [await image(1199), 'narrow.jpg', 'image/jpeg', 'AGENCY_PHOTO_TOO_SMALL', '1200 px wide'],
      ] as const) {
        const rejected = await upload(buffer, name, type, saved.id);
        expect(rejected.status).toBe(400);
        const error = ((await rejected.json()) as { error: { code: string; message: string } })
          .error;
        expect(error).toMatchObject({ code, message: expect.stringContaining(name) });
        expect(error.message).toContain(limit);
        expect(error.message).toContain('The current photo is unchanged.');
        expect(await current()).toMatchObject({ id: saved.id, fileName: 'building.jpg' });
      }

      // The invitee is not signed in: the invitation token scopes a short-lived private URL.
      const photoUrl = new URL((await invitationPhotoUrl())!);
      expect(photoUrl.searchParams.get('X-Amz-Signature')).toBeTruthy();
      expect(Number(photoUrl.searchParams.get('X-Amz-Expires'))).toBeLessThanOrEqual(60);
      expect(photoUrl.pathname).toContain(objectKey);

      const hidden = await json('PATCH', { expectedPhotoId: saved.id, shown: false });
      expect(hidden.status).toBe(200);
      expect(((await hidden.json()) as { photo: AgencyBuildingPhotoSummary }).photo).toMatchObject({
        id: saved.id,
        shown: false,
      });
      expect(await current()).toMatchObject({ id: saved.id, shown: false });
      await expect(invitationPhotoUrl()).resolves.toBeNull();
      // Repeating the current setting writes no second Audit Event.
      expect((await json('PATCH', { expectedPhotoId: saved.id, shown: false })).status).toBe(200);
      expect((await json('PATCH', { expectedPhotoId: saved.id, shown: true })).status).toBe(200);
      await expect(invitationPhotoUrl()).resolves.toContain('X-Amz-Signature=');

      context = {
        ...context,
        permissions: [{ code: 'organization.agency.read', scopePolicy: 'AGENCY' }],
      };
      expect((await upload(body, 'denied.jpg', 'image/jpeg', saved.id)).status).toBe(403);
      expect((await json('PATCH', { expectedPhotoId: saved.id, shown: false })).status).toBe(403);
      context = { ...context, permissions };
      expect(
        (
          await upload(
            body,
            'foreign.jpg',
            'image/jpeg',
            saved.id,
            `${base}/agencies/${other.id}/agency-profile/building-photo`,
          )
        ).status,
      ).toBe(403);
      await expect(
        withDatabaseContext({ agencyId: other.id }, (tx) => tx.agencyBuildingPhoto.findMany()),
      ).resolves.toEqual([]);
      await expect(
        withDatabaseContext({ agencyId: other.id }, (tx) =>
          tx.agencyBuildingPhoto.updateMany({
            where: { agencyId: agency.id },
            data: { shown: false },
          }),
        ),
      ).resolves.toEqual({ count: 0 });

      await json('PATCH', { expectedPhotoId: saved.id, shown: false });
      const replacedResponse = await upload(body, 'replacement.jpg', 'image/jpeg', saved.id);
      expect(replacedResponse.status).toBe(200);
      const replaced = ((await replacedResponse.json()) as { photo: AgencyBuildingPhotoSummary })
        .photo;
      // Saving a photo shows it, even when the previous one was turned off.
      expect(replaced).toMatchObject({ fileName: 'replacement.jpg', shown: true });
      expect(replaced.id).not.toBe(saved.id);
      expect((await upload(body, 'stale.jpg', 'image/jpeg', saved.id)).status).toBe(409);
      expect((await json('PATCH', { expectedPhotoId: saved.id, shown: false })).status).toBe(409);
      const removed = await json('DELETE', { expectedPhotoId: replaced.id });
      expect(removed.status).toBe(200);
      expect(await removed.json()).toEqual({ photo: null });
      expect(await current()).toBeNull();
      await expect(invitationPhotoUrl()).resolves.toBeNull();
      expect((await json('PATCH', { expectedPhotoId: '', shown: true })).status).toBe(404);

      const events = (
        (await (await request(`${base}/agencies/${agency.id}/audit-events?limit=25`)).json()) as {
          events: { action: string; id: string }[];
        }
      ).events;
      expect(events.map((event) => event.action)).toEqual([
        'AGENCY_PHOTO_REMOVED',
        'AGENCY_PHOTO_REPLACED',
        'AGENCY_PHOTO_HIDDEN',
        'AGENCY_PHOTO_SHOWN',
        'AGENCY_PHOTO_HIDDEN',
        'AGENCY_PHOTO_SAVED',
      ]);
      const details = await Promise.all(
        events.map(async (event) =>
          (await request(`${base}/agencies/${agency.id}/audit-events/${event.id}`)).json(),
        ),
      );
      expect(details[5]).toMatchObject({
        actor: 'Photo Administrator',
        before: null,
        after: { fileName: 'building.jpg', contentHash: saved.contentHash, shown: true },
      });
      expect(details[4]).toMatchObject({
        before: { fileName: 'building.jpg', shown: true },
        after: { fileName: 'building.jpg', shown: false },
      });
      expect(details[1]).toMatchObject({
        before: { fileName: 'building.jpg', shown: false },
        after: { fileName: 'replacement.jpg', shown: true },
      });
      expect(details[0]).toMatchObject({ before: { fileName: 'replacement.jpg' }, after: null });
    } finally {
      await app.close();
      await admin.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await tx.auditEvent.deleteMany({ where: { agencyId: agency.id } });
        await tx.agencyBuildingPhoto.deleteMany({ where: { agencyId: agency.id } });
        await tx.invitation.deleteMany({ where: { agencyId: agency.id } });
      });
      await admin.agencyMembership.deleteMany({ where: { agencyId: agency.id } });
      await admin.user.delete({ where: { id: user.id } });
      await admin.agency.deleteMany({ where: { id: { in: [agency.id, other.id] } } });
      await admin.$disconnect();
    }
  },
  30_000,
);
