import type { RequestContext } from '@lingkod-hr/auth';
import { expect, it, vi } from 'vitest';
import { SalnComplianceController } from './saln-compliance.controller';

const agencyId = '00000000-0000-4000-8000-000000000001';
const employeeId = '00000000-0000-4000-8000-000000000002';
const recordId = '00000000-0000-4000-8000-000000000003';
const context: RequestContext = {
  requestId: 'saln-api-test',
  userId: '00000000-0000-4000-8000-000000000004',
  agencyId,
  membershipId: '00000000-0000-4000-8000-000000000005',
  primaryOrganizationUnitId: null,
  permissions: [],
};
const record = {
  id: recordId,
  employeeId,
  requirementReference: 'Agency memorandum 2026-04',
  filingYear: 2026,
  filingType: 'ANNUAL',
  status: 'SUBMITTED',
  submittedAt: '2026-04-30T01:00:00.000Z',
  repositoryReference: 'Records/2026/42',
  acknowledgmentDocumentId: null,
  acknowledgmentDocumentVersionId: null,
  correctsRecordId: null,
  correctionReason: null,
  actorDisplayName: 'Records Officer',
  createdAt: '2026-05-01T00:00:00.000Z',
};

function service() {
  return {
    findOwnEmployeeId: vi.fn().mockResolvedValue(employeeId),
    list: vi.fn().mockResolvedValue([record]),
    findById: vi.fn().mockResolvedValue(record),
    history: vi.fn().mockResolvedValue([record]),
    create: vi.fn().mockResolvedValue(record),
    update: vi.fn().mockResolvedValue(record),
    correct: vi.fn().mockResolvedValue(record),
  };
}

it('exposes list, detail, and correction without accepting due dates or SALN content', async () => {
  const mock = service();
  const controller = new SalnComplianceController(mock as never);
  await expect(controller.list(agencyId, employeeId, context)).resolves.toEqual({
    records: [record],
  });
  await expect(controller.listOwn(agencyId, context)).resolves.toEqual({ records: [record] });
  await expect(controller.detail(agencyId, employeeId, recordId, context)).resolves.toEqual(record);
  await expect(
    controller.create(agencyId, employeeId, { ...record, dueDate: '2026-04-30' }, context),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    controller.create(agencyId, employeeId, { ...record, declaration: { assets: [] } }, context),
  ).rejects.toMatchObject({ status: 400 });
  expect(mock.create).not.toHaveBeenCalled();
});

it('treats a foreign Agency route as absent', async () => {
  const mock = service();
  const controller = new SalnComplianceController(mock as never);
  await expect(
    controller.list('00000000-0000-4000-8000-000000000099', employeeId, context),
  ).rejects.toMatchObject({ status: 404 });
  expect(mock.list).not.toHaveBeenCalled();
});
