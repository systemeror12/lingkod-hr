import { expect, it, vi } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import { AgencySealController } from './agency-seal.controller';
import { AgencySealService } from './agency-seal.service';

const context: RequestContext = {
  requestId: 'seal-api-test',
  agencyId: '00000000-0000-4000-8000-000000000001',
  userId: '00000000-0000-4000-8000-000000000002',
  membershipId: '00000000-0000-4000-8000-000000000003',
  primaryOrganizationUnitId: null,
  permissions: [{ code: 'organization.agency.update', scopePolicy: 'AGENCY' }],
};
const storage = { putObject: vi.fn(), deleteObject: vi.fn(), signedReadUrl: vi.fn() };

it('rejects a disguised SVG with the filename and allowed types before storing it', async () => {
  const controller = new AgencySealController(new AgencySealService(storage));
  await expect(
    controller.save(
      context.agencyId,
      { expectedSealId: '' },
      {
        originalname: 'official.png',
        mimetype: 'image/png',
        buffer: Buffer.from('<svg/>'),
        size: 6,
      },
      context,
    ),
  ).rejects.toMatchObject({
    status: 400,
    response: {
      error: { code: 'AGENCY_SEAL_TYPE_INVALID', message: expect.stringContaining('official.png') },
    },
  });
  expect(storage.putObject).not.toHaveBeenCalled();
});

it('names the file and 2 MB limit when an upload is too large', async () => {
  const controller = new AgencySealController(new AgencySealService(storage));
  await expect(
    controller.save(
      context.agencyId,
      { expectedSealId: '' },
      {
        originalname: 'large.png',
        mimetype: 'image/png',
        buffer: Buffer.alloc(2 * 1024 * 1024 + 1),
        size: 2 * 1024 * 1024 + 1,
      },
      context,
    ),
  ).rejects.toMatchObject({
    status: 400,
    response: {
      error: {
        code: 'AGENCY_SEAL_TOO_LARGE',
        message: expect.stringMatching(/large.png:.*2 MB.*unchanged/),
      },
    },
  });
});

it('rejects changes without the Agency update permission and requests outside the active Agency', async () => {
  const controller = new AgencySealController(new AgencySealService(storage));
  const file = {
    originalname: 'seal.png',
    mimetype: 'image/png',
    buffer: Buffer.from('png'),
    size: 3,
  };
  await expect(
    controller.save(context.agencyId, { expectedSealId: '' }, file, {
      ...context,
      permissions: [],
    }),
  ).rejects.toMatchObject({ status: 403 });
  expect(() =>
    controller.save('00000000-0000-4000-8000-000000000099', { expectedSealId: '' }, file, context),
  ).toThrowError(expect.objectContaining({ status: 403 }));
  await expect(
    controller.remove(context.agencyId, { expectedSealId: '' }, { ...context, permissions: [] }),
  ).rejects.toMatchObject({ status: 403 });
});

it('rejects a readable image too small to print before storing it', async () => {
  const { default: sharp } = await import('sharp');
  const buffer = await sharp({
    create: { width: 599, height: 600, channels: 3, background: '#b8901f' },
  })
    .png()
    .toBuffer();
  const controller = new AgencySealController(new AgencySealService(storage));
  await expect(
    controller.save(
      context.agencyId,
      { expectedSealId: '' },
      {
        originalname: 'small.png',
        mimetype: 'image/png',
        buffer,
        size: buffer.length,
      },
      context,
    ),
  ).rejects.toMatchObject({
    status: 400,
    response: {
      error: {
        code: 'AGENCY_SEAL_TOO_SMALL',
        message: expect.stringMatching(/small.png:.*600 × 600.*unchanged/),
      },
    },
  });
});
