import { expect, it, vi } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import { DeliberationsController } from './deliberations.controller';
import { SelectionController } from './selection.controller';

const agencyId = '00000000-0000-4000-8000-000000000001';
const otherAgencyId = '00000000-0000-4000-8000-000000000002';
const sessionId = '00000000-0000-4000-8000-000000000003';
const publicationId = '00000000-0000-4000-8000-000000000004';
const applicationId = '00000000-0000-4000-8000-000000000005';
const documentVersionId = '00000000-0000-4000-8000-000000000006';

const context: RequestContext = {
  requestId: 'deliberations-controller-test',
  userId: '00000000-0000-4000-8000-000000000007',
  agencyId,
  membershipId: '00000000-0000-4000-8000-000000000008',
  primaryOrganizationUnitId: null,
  permissions: [],
};

function deliberationServiceMock() {
  return {
    listSessions: vi.fn(),
    findSession: vi.fn(),
    createSession: vi.fn(),
    recordParticipation: vi.fn(),
    declareConflict: vi.fn(),
    startSession: vi.fn(),
    recordRecommendation: vi.fn(),
    issueReport: vi.fn(),
    completeSession: vi.fn(),
    cancelSession: vi.fn(),
  };
}

function selectionServiceMock() {
  return {
    listDecisions: vi.fn(),
    findDecision: vi.fn(),
    recordDecision: vi.fn(),
  };
}

it('does not disclose Sessions or Selection Decisions outside the active Agency', async () => {
  const deliberations = deliberationServiceMock();
  const selection = selectionServiceMock();
  const controller = new DeliberationsController(deliberations as never);
  const selectionController = new SelectionController(selection as never);

  await expect(controller.listSessions(otherAgencyId, {}, context)).rejects.toMatchObject({
    status: 404,
    response: { error: { code: 'RECRUITMENT_NOT_FOUND', requestId: context.requestId } },
  });
  expect(deliberations.listSessions).not.toHaveBeenCalled();

  await expect(selectionController.listDecisions(otherAgencyId, {}, context)).rejects.toMatchObject(
    {
      status: 404,
      response: { error: { code: 'RECRUITMENT_NOT_FOUND' } },
    },
  );
  expect(selection.listDecisions).not.toHaveBeenCalled();
});

it('rejects Session and Selection commands outside the active Agency before the service call', async () => {
  const deliberations = deliberationServiceMock();
  const selection = selectionServiceMock();
  const controller = new DeliberationsController(deliberations as never);
  const selectionController = new SelectionController(selection as never);

  await expect(
    controller.createSession(
      otherAgencyId,
      { vacancyPublicationId: publicationId, sessionDate: '2026-09-10' },
      context,
      'session-key',
    ),
  ).rejects.toMatchObject({
    status: 403,
    response: { error: { code: 'RECRUITMENT_WRITE_FORBIDDEN' } },
  });
  expect(deliberations.createSession).not.toHaveBeenCalled();

  await expect(
    selectionController.recordDecision(
      otherAgencyId,
      applicationId,
      { decision: 'RETURNED', reason: 'Further review.' },
      context,
      'decision-key',
    ),
  ).rejects.toMatchObject({
    status: 403,
    response: { error: { code: 'RECRUITMENT_WRITE_FORBIDDEN' } },
  });
  expect(selection.recordDecision).not.toHaveBeenCalled();
});

it('validates and forwards Session and Selection commands', async () => {
  const deliberations = deliberationServiceMock();
  const selection = selectionServiceMock();
  deliberations.createSession.mockResolvedValue({ id: sessionId });
  deliberations.startSession.mockResolvedValue({ id: sessionId });
  deliberations.recordRecommendation.mockResolvedValue({ id: sessionId });
  deliberations.completeSession.mockResolvedValue({ id: sessionId });
  selection.recordDecision.mockResolvedValue({ id: 'decision-1' });
  const controller = new DeliberationsController(deliberations as never);
  const selectionController = new SelectionController(selection as never);

  const createInput = { vacancyPublicationId: publicationId, sessionDate: '2026-09-10' };
  await expect(
    controller.createSession(agencyId, createInput, context, 'session-key'),
  ).resolves.toEqual({ id: sessionId });
  expect(deliberations.createSession).toHaveBeenCalledWith(context, createInput, 'session-key');

  await expect(
    controller.startSession(agencyId, sessionId, {}, context, 'start-key'),
  ).resolves.toEqual({ id: sessionId });
  expect(deliberations.startSession).toHaveBeenCalledWith(context, sessionId, 'start-key');

  const recommendation = {
    applicationId,
    recommendation: 'RECOMMENDED' as const,
    rankNo: 1,
  };
  await expect(
    controller.recordRecommendation(agencyId, sessionId, recommendation, context, 'recommend-key'),
  ).resolves.toEqual({ id: sessionId });
  expect(deliberations.recordRecommendation).toHaveBeenCalledWith(
    context,
    sessionId,
    recommendation,
    'recommend-key',
  );

  await expect(
    controller.completeSession(
      agencyId,
      sessionId,
      { minutesDocumentVersionId: documentVersionId },
      context,
      'complete-key',
    ),
  ).resolves.toEqual({ id: sessionId });
  expect(deliberations.completeSession).toHaveBeenCalledWith(
    context,
    sessionId,
    { minutesDocumentVersionId: documentVersionId },
    'complete-key',
  );

  const decision = {
    decision: 'SELECTED' as const,
    reason: 'The appointing authority selected the recommended candidate.',
    authorityDocumentVersionId: documentVersionId,
  };
  await expect(
    selectionController.recordDecision(agencyId, applicationId, decision, context, 'decision-key'),
  ).resolves.toEqual({ id: 'decision-1' });
  expect(selection.recordDecision).toHaveBeenCalledWith(
    context,
    applicationId,
    decision,
    'decision-key',
  );
});

it('rejects malformed deliberation input before the service is called', async () => {
  const deliberations = deliberationServiceMock();
  const controller = new DeliberationsController(deliberations as never);

  await expect(
    controller.recordRecommendation(
      agencyId,
      sessionId,
      { applicationId, recommendation: 'MAYBE' },
      context,
      'recommend-key',
    ),
  ).rejects.toMatchObject({
    status: 400,
    response: { error: { code: 'INVALID_INPUT' } },
  });
  expect(deliberations.recordRecommendation).not.toHaveBeenCalled();

  await expect(
    controller.declareConflict(
      agencyId,
      sessionId,
      { participationId: applicationId, applicationId, hasConflict: true },
      context,
      'a'.repeat(201),
    ),
  ).rejects.toMatchObject({
    status: 400,
    response: { error: { code: 'INVALID_IDEMPOTENCY_KEY' } },
  });
  expect(deliberations.declareConflict).not.toHaveBeenCalled();
});
