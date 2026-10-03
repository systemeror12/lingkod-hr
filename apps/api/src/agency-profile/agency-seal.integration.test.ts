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
import { AgencySealController } from './agency-seal.controller';
import {
  AgencySealService,
  AGENCY_SEAL_STORAGE,
  type AgencySealSummary,
} from './agency-seal.service';

const enabled = process.env.DATABASE_E2E === 'true';

it.skipIf(!enabled)(
  'saves, replaces, and removes an Agency seal through HTTP with audit history and Agency isolation',
  async () => {
    const admin = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_E2E_ADMIN_URL ?? '' } },
    });
    const suffix = randomUUID();
    const agency = await admin.agency.create({
      data: {
        code: `SEAL-${suffix}`,
        name: 'Seal Test Agency',
        acronym: 'STA',
        agencyType: 'NGA',
        status: 'ACTIVE',
      },
    });
    const other = await admin.agency.create({
      data: {
        code: `SEAL-OTHER-${suffix}`,
        name: 'Other Seal Agency',
        agencyType: 'NGA',
        status: 'ACTIVE',
      },
    });
    const user = await admin.user.create({
      data: {
        emailNormalized: `seal-${suffix}@example.test`,
        displayName: 'Seal Administrator',
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
      requestId: 'seal-integration',
      primaryOrganizationUnitId: null,
      permissions,
    };
    const storage = {
      putObject: vi.fn().mockResolvedValue(undefined),
      deleteObject: vi.fn().mockResolvedValue(undefined),
      signedReadUrl: vi.fn().mockResolvedValue('https://storage.example.test/signed-seal'),
    };
    @Module({
      controllers: [AgencySealController, AuditController],
      providers: [
        AgencySealService,
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
    const route = `${base}/agencies/${agency.id}/agency-profile/seal`;
    function request(url: string, init: RequestInit = {}) {
      return fetch(url, {
        ...init,
        headers: { ...init.headers, authorization: 'Bearer seal-test' },
      });
    }
    const image = async (width = 600, height = 600) =>
      sharp({ create: { width, height, channels: 3, background: '#b8901f' } })
        .png()
        .toBuffer();
    async function upload(
      buffer: Buffer,
      name: string,
      type = 'image/png',
      expectedSealId = '',
      url = route,
    ) {
      const form = new FormData();
      form.append('expectedSealId', expectedSealId);
      form.append('file', new Blob([new Uint8Array(buffer)], { type }), name);
      return request(url, { method: 'PUT', body: form });
    }
    const body = await image();
    try {
      const savedResponse = await upload(body, 'official.png');
      expect(savedResponse.status).toBe(200);
      const saved = ((await savedResponse.json()) as { seal: AgencySealSummary }).seal;
      expect(saved).toMatchObject({
        fileName: 'official.png',
        width: 600,
        height: 600,
        byteSize: body.length,
        contentHash: createHash('sha256').update(body).digest('hex'),
        changedByName: 'Seal Administrator',
      });
      expect(saved).not.toHaveProperty('objectKey');
      expect(storage.putObject.mock.calls[0]![0].key).toMatch(/^agency-seals\/[a-f0-9-]{36}$/);

      for (const [buffer, name, type, code, limit] of [
        [
          Buffer.from('<svg/>'),
          'wrong.svg',
          'image/svg+xml',
          'AGENCY_SEAL_TYPE_INVALID',
          'PNG or JPEG',
        ],
        [Buffer.alloc(3 * 1024 * 1024), 'large.png', 'image/png', 'AGENCY_SEAL_TOO_LARGE', '2 MB'],
        [await image(599), 'small.png', 'image/png', 'AGENCY_SEAL_TOO_SMALL', '600 × 600'],
      ] as const) {
        const rejected = await upload(buffer, name, type, saved.id);
        expect(rejected.status).toBe(400);
        const error = ((await rejected.json()) as { error: { code: string; message: string } })
          .error;
        expect(error).toMatchObject({ code, message: expect.stringContaining(name) });
        expect(error.message).toContain(limit);
        const current = ((await (await request(route)).json()) as { seal: AgencySealSummary }).seal;
        expect(current.id).toBe(saved.id);
        expect(current.fileName).toBe('official.png');
      }
      context = {
        ...context,
        permissions: [{ code: 'organization.agency.read', scopePolicy: 'AGENCY' }],
      };
      expect((await upload(body, 'denied.png', 'image/png', saved.id)).status).toBe(403);
      context = { ...context, permissions };
      expect(
        (
          await upload(
            body,
            'foreign.png',
            'image/png',
            saved.id,
            `${base}/agencies/${other.id}/agency-profile/seal`,
          )
        ).status,
      ).toBe(403);
      await expect(
        withDatabaseContext({ agencyId: other.id }, (tx) => tx.agencySeal.findMany()),
      ).resolves.toEqual([]);
      await expect(
        withDatabaseContext({ agencyId: other.id }, (tx) =>
          tx.agencySeal.updateMany({
            where: { agencyId: agency.id },
            data: { fileName: 'cross-agency.png' },
          }),
        ),
      ).resolves.toEqual({ count: 0 });

      // Invitation-token authorization issues only this Agency's short-lived private object URL.
      const token = randomBytes(32).toString('base64url');
      const invitation = await admin.invitation.create({
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
      const lookup = await auth.lookupInvitation(token);
      expect(lookup.status).toBe('VALID');
      if (lookup.status !== 'VALID') throw new Error('Expected valid invitation');
      const sealUrl = new URL(lookup.agency.sealUrl!);
      expect(sealUrl.searchParams.get('X-Amz-Signature')).toBeTruthy();
      expect(Number(sealUrl.searchParams.get('X-Amz-Expires'))).toBeLessThanOrEqual(60);
      expect(sealUrl.pathname).toContain('agency-seals/');
      await expect(auth.lookupInvitation(randomBytes(32).toString('base64url'))).resolves.toEqual({
        status: 'INVALID',
      });
      await admin.invitation.update({
        where: { id: invitation.id },
        data: { createdAt: new Date(Date.now() - 2000), expiresAt: new Date(Date.now() - 1000) },
      });
      await expect(auth.lookupInvitation(token)).resolves.toEqual({ status: 'EXPIRED' });

      const replacedResponse = await upload(body, 'replacement.png', 'image/png', saved.id);
      expect(replacedResponse.status).toBe(200);
      const replaced = ((await replacedResponse.json()) as { seal: AgencySealSummary }).seal;
      expect(replaced.id).not.toBe(saved.id);
      expect((await upload(body, 'stale.png', 'image/png', saved.id)).status).toBe(409);
      const removed = await request(route, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedSealId: replaced.id }),
      });
      expect(removed.status).toBe(200);
      expect(await removed.json()).toEqual({ seal: null });
      expect(await (await request(route)).json()).toEqual({ seal: null });
      const events = (
        (await (await request(`${base}/agencies/${agency.id}/audit-events?limit=25`)).json()) as {
          events: { action: string; id: string }[];
        }
      ).events;
      expect(events.map((event: { action: string }) => event.action)).toEqual([
        'AGENCY_SEAL_REMOVED',
        'AGENCY_SEAL_REPLACED',
        'AGENCY_SEAL_SAVED',
      ]);
      const details = await Promise.all(
        events.map(async (event: { id: string }) =>
          (await request(`${base}/agencies/${agency.id}/audit-events/${event.id}`)).json(),
        ),
      );
      expect(details[2]).toMatchObject({
        actor: 'Seal Administrator',
        before: null,
        after: { fileName: 'official.png', contentHash: saved.contentHash },
      });
      expect(details[1]).toMatchObject({
        before: { fileName: 'official.png' },
        after: { fileName: 'replacement.png' },
      });
      expect(details[0]).toMatchObject({ before: { fileName: 'replacement.png' }, after: null });
    } finally {
      await app.close();
      await admin.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await tx.auditEvent.deleteMany({ where: { agencyId: agency.id } });
        await tx.agencySeal.deleteMany({ where: { agencyId: agency.id } });
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
