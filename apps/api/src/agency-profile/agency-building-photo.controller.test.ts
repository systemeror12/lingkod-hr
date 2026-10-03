import { expect, it, vi } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import { AgencyBuildingPhotoController } from './agency-building-photo.controller';
import { AgencyBuildingPhotoService } from './agency-building-photo.service';

const context: RequestContext = {
  requestId: 'photo-api-test',
  agencyId: '00000000-0000-4000-8000-000000000001',
  userId: '00000000-0000-4000-8000-000000000002',
  membershipId: '00000000-0000-4000-8000-000000000003',
  primaryOrganizationUnitId: null,
  permissions: [{ code: 'organization.agency.update', scopePolicy: 'AGENCY' }],
};
const storage = { putObject: vi.fn(), deleteObject: vi.fn(), signedReadUrl: vi.fn() };
const controller = () => new AgencyBuildingPhotoController(new AgencyBuildingPhotoService(storage));

it('names the file and the 5 MB limit when a photo is too large', async () => {
  await expect(
    controller().save(
      context.agencyId,
      { expectedPhotoId: '' },
      {
        originalname: 'large.jpg',
        mimetype: 'image/jpeg',
        buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
        size: 5 * 1024 * 1024 + 1,
      },
      context,
    ),
  ).rejects.toMatchObject({
    status: 400,
    response: {
      error: {
        code: 'AGENCY_PHOTO_TOO_LARGE',
        message: expect.stringMatching(/large.jpg:.*5 MB.*current photo is unchanged/),
      },
    },
  });
  expect(storage.putObject).not.toHaveBeenCalled();
});

it('rejects a photo narrower than 1200 px before storing it', async () => {
  const { default: sharp } = await import('sharp');
  const buffer = await sharp({
    create: { width: 1199, height: 2000, channels: 3, background: '#24508f' },
  })
    .jpeg()
    .toBuffer();
  await expect(
    controller().save(
      context.agencyId,
      { expectedPhotoId: '' },
      { originalname: 'narrow.jpg', mimetype: 'image/jpeg', buffer, size: buffer.length },
      context,
    ),
  ).rejects.toMatchObject({
    status: 400,
    response: {
      error: {
        code: 'AGENCY_PHOTO_TOO_SMALL',
        message: expect.stringMatching(/narrow.jpg:.*1199 × 2000 px.*1200 px wide.*unchanged/),
      },
    },
  });
  expect(storage.putObject).not.toHaveBeenCalled();
});

it('rejects photo changes without the Agency update permission or outside the active Agency', async () => {
  const readOnly = { ...context, permissions: [] };
  await expect(
    controller().setShown(context.agencyId, { expectedPhotoId: '', shown: false }, readOnly),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    controller().remove(context.agencyId, { expectedPhotoId: '' }, readOnly),
  ).rejects.toMatchObject({ status: 403 });
  expect(() =>
    controller().setShown(
      '00000000-0000-4000-8000-000000000099',
      { expectedPhotoId: '', shown: true },
      context,
    ),
  ).toThrowError(expect.objectContaining({ status: 403 }));
  expect(() =>
    controller().setShown(context.agencyId, { expectedPhotoId: '', shown: 'yes' }, context),
  ).toThrowError(expect.objectContaining({ status: 400 }));
});
