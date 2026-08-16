import { expect, it, vi } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import { AuditController } from './audit.controller';
import { AuditServiceError, type AuditEventDetail, type AuditEventList } from './audit.service';

const agencyId = '00000000-0000-4000-8000-000000000001';
const otherAgencyId = '00000000-0000-4000-8000-000000000002';
const eventId = '00000000-0000-4000-8000-000000000003';
const context: RequestContext = {
  requestId: 'audit-api-test',
  userId: '00000000-0000-4000-8000-000000000004',
  agencyId,
  membershipId: '00000000-0000-4000-8000-000000000005',
  primaryOrganizationUnitId: null,
  permissions: [{ code: 'audit.events.read', scopePolicy: 'AGENCY' }],
};

const event: AuditEventDetail = {
  id: eventId,
  occurredAt: '2026-08-15T20:00:00.000+08:00',
  actor: 'Marisol Santos',
  actorType: 'USER',
  action: 'ORGANIZATION_UNIT_CREATED',
  entityType: 'OrganizationUnit',
  entityId: '00000000-0000-4000-8000-000000000006',
  previousStatus: 'None',
  newStatus: 'DRAFT',
  requestId: 'create-request',
  before: null,
  after: { officialName: 'Records Management Division' },
};

function serviceMock(): {
  list: ReturnType<typeof vi.fn>;
  findById: ReturnType<typeof vi.fn>;
} {
  return { list: vi.fn(), findById: vi.fn() };
}

it('treats a list request outside the active Agency as not found', async () => {
  const service = serviceMock();
  const controller = new AuditController(service as never);

  await expect(controller.list(otherAgencyId, {}, context)).rejects.toMatchObject({ status: 404 });
  expect(service.list).not.toHaveBeenCalled();
});

it('returns an explicit, bounded list DTO from the active Agency', async () => {
  const service = serviceMock();
  const result: AuditEventList = { events: [event], nextCursor: null, hasMore: false };
  service.list.mockResolvedValue(result);
  const controller = new AuditController(service as never);

  await expect(controller.list(agencyId, { limit: '10' }, context)).resolves.toEqual({
    events: [
      {
        id: event.id,
        occurredAt: event.occurredAt,
        actor: event.actor,
        actorType: event.actorType,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        previousStatus: event.previousStatus,
        newStatus: event.newStatus,
      },
    ],
    nextCursor: null,
    hasMore: false,
  });
  expect(service.list).toHaveBeenCalledWith(context, { limit: 10 });
});

it('returns a generic missing-record response for an unavailable event', async () => {
  const service = serviceMock();
  service.findById.mockResolvedValue(null);
  const controller = new AuditController(service as never);

  await expect(controller.findById(agencyId, eventId, context)).rejects.toMatchObject({
    status: 404,
  });
});

it('keeps service authorization errors in the public envelope', async () => {
  const service = serviceMock();
  service.list.mockRejectedValue(
    new AuditServiceError(
      'The current Agency Membership lacks the required permission.',
      403,
      'AUDIT_EVENT_READ_FORBIDDEN',
    ),
  );
  const controller = new AuditController(service as never);

  await expect(controller.list(agencyId, {}, context)).rejects.toMatchObject({
    status: 403,
    response: {
      error: {
        code: 'AUDIT_EVENT_READ_FORBIDDEN',
        requestId: context.requestId,
      },
    },
  });
});

it('rejects invalid pagination before reading the store', async () => {
  const service = serviceMock();
  const controller = new AuditController(service as never);

  await expect(controller.list(agencyId, { limit: '1000' }, context)).rejects.toMatchObject({
    status: 400,
  });
  expect(service.list).not.toHaveBeenCalled();
});
