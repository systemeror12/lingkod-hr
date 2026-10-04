import { expect, it, vi } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import { LeavePoliciesController } from './leave-policies.controller';
import {
  LeavePolicyServiceError,
  type LeavePolicyVersionSummary,
  type LeaveTypeSummary,
} from './leave-policies.service';

const agencyId = '00000000-0000-4000-8000-000000000001';
const otherAgencyId = '00000000-0000-4000-8000-000000000002';
const leaveTypeId = '00000000-0000-4000-8000-000000000003';
const versionId = '00000000-0000-4000-8000-000000000004';
const authorityId = '00000000-0000-4000-8000-000000000005';
const documentId = '00000000-0000-4000-8000-000000000006';
const context: RequestContext = {
  requestId: 'leave-policy-api-test',
  userId: '00000000-0000-4000-8000-000000000007',
  agencyId,
  membershipId: '00000000-0000-4000-8000-000000000008',
  primaryOrganizationUnitId: null,
  permissions: [{ code: 'leave.types.read', scopePolicy: 'AGENCY' }],
};

const draft: LeavePolicyVersionSummary = {
  id: versionId,
  leaveTypeId,
  versionNo: 1,
  entitlementBasis: 'ACCRUED_ACCOUNT',
  calendarBasis: 'WORKING_DAY',
  chargedLeaveTypeId: null,
  chargedLeaveTypeCode: null,
  evaluatorKind: 'SERVICE_ACCRUAL',
  ruleParameters: { earnDays: 1, perServiceDays: 24, annualCreditDays: 15 },
  applicability: { profiles: ['ORDINARY_CIVILIAN_NGA'], excludedProfiles: [] },
  documentRequirements: { required: ['SIGNED_LEAVE_APPLICATION_FORM'], additional: [] },
  approvalRouteCode: 'LEAVE-ROUTE-1',
  effectiveFrom: '2026-08-15',
  effectiveTo: null,
  status: 'DRAFT',
  authorities: [],
  rowVersion: 1,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const leaveType: LeaveTypeSummary = {
  id: leaveTypeId,
  code: 'VACATION_LEAVE',
  name: 'Vacation Leave',
  status: 'ACTIVE',
  catalogue: {
    code: 'VACATION_LEAVE',
    name: 'Vacation Leave',
    evaluatorKind: 'SERVICE_ACCRUAL',
    entitlementBasis: 'ACCRUED_ACCOUNT',
    calendarBasis: 'WORKING_DAY',
    chargedLeaveTypeCode: null,
    activationPolicy: 'FIXED_NATIONAL',
    personnelProfiles: ['ORDINARY_CIVILIAN_NGA'],
    requiredEvidenceKinds: ['SIGNED_LEAVE_APPLICATION_FORM'],
    ruleParameters: { earnDays: 1, perServiceDays: 24, annualCreditDays: 15 },
    authorityCitations: [{ citation: 'Rule XVI, sections 1-3', title: 'CSC MC No. 41, s. 1998' }],
    failClosed: false,
  },
  currentVersion: null,
  draft,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

function serviceMock() {
  return {
    listCatalogue: vi.fn(),
    list: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    createPolicyVersion: vi.fn(),
    updatePolicyDraft: vi.fn(),
    linkAuthority: vi.fn(),
    unlinkAuthority: vi.fn(),
    activate: vi.fn(),
  };
}

it('does not disclose or mutate another Agency register', async () => {
  const service = serviceMock();
  const controller = new LeavePoliciesController(service as never);

  await expect(controller.list(otherAgencyId, context)).rejects.toMatchObject({
    status: 404,
    response: {
      error: { code: 'LEAVE_TYPE_NOT_FOUND', requestId: context.requestId },
    },
  });
  await expect(
    controller.create(otherAgencyId, { catalogueCode: 'VACATION_LEAVE' }, context),
  ).rejects.toMatchObject({
    status: 403,
    response: {
      error: { code: 'LEAVE_TYPE_WRITE_FORBIDDEN', requestId: context.requestId },
    },
  });
  expect(service.list).not.toHaveBeenCalled();
  expect(service.create).not.toHaveBeenCalled();
});

it('returns the catalogue and the Agency leave register', async () => {
  const service = serviceMock();
  service.listCatalogue.mockReturnValue([leaveType.catalogue]);
  service.list.mockResolvedValue([leaveType]);
  const controller = new LeavePoliciesController(service as never);

  expect(controller.catalogue(agencyId, context)).toEqual({
    entries: [
      expect.objectContaining({
        code: 'VACATION_LEAVE',
        activationPolicy: 'FIXED_NATIONAL',
        personnelProfiles: ['ORDINARY_CIVILIAN_NGA'],
      }),
    ],
    personnelProfiles: expect.arrayContaining(['ORDINARY_CIVILIAN_NGA', 'TEACHER']),
    evidenceKinds: expect.arrayContaining(['SIGNED_LEAVE_APPLICATION_FORM']),
  });
  await expect(controller.list(agencyId, context)).resolves.toEqual({
    leaveTypes: [expect.objectContaining({ id: leaveTypeId, code: 'VACATION_LEAVE' })],
  });
  expect(service.list).toHaveBeenCalledWith(context);
});

it('returns detail as of a historical date and validates the query', async () => {
  const service = serviceMock();
  service.findById.mockResolvedValue({
    leaveType,
    asOf: '2025-12-31',
    effective: null,
    configuration: { result: 'INDETERMINATE', reasons: ['NO_EFFECTIVE_POLICY_VERSION'] },
    versions: [draft],
    history: [],
  });
  const controller = new LeavePoliciesController(service as never);

  await expect(
    controller.findById(agencyId, leaveTypeId, '2025-12-31', context),
  ).resolves.toMatchObject({
    asOf: '2025-12-31',
    configuration: { result: 'INDETERMINATE', reasons: ['NO_EFFECTIVE_POLICY_VERSION'] },
  });
  expect(service.findById).toHaveBeenCalledWith(context, leaveTypeId, '2025-12-31');

  await expect(
    controller.findById(agencyId, leaveTypeId, '31/12/2025', context),
  ).rejects.toMatchObject({
    status: 400,
    response: { error: { code: 'INVALID_INPUT', requestId: context.requestId } },
  });
  await expect(
    controller.findById(agencyId, 'not-a-uuid', undefined, context),
  ).rejects.toMatchObject({
    status: 404,
  });
});

it('forwards draft maintenance with validated input', async () => {
  const service = serviceMock();
  service.create.mockResolvedValue(leaveType);
  service.createPolicyVersion.mockResolvedValue(draft);
  service.updatePolicyDraft.mockResolvedValue({ ...draft, effectiveFrom: '2026-09-01' });
  const controller = new LeavePoliciesController(service as never);
  const body = {
    effectiveDate: '2026-09-01',
    approvalRouteCode: 'LEAVE-ROUTE-1',
    applicability: { profiles: ['ORDINARY_CIVILIAN_NGA'] },
    documentRequirements: { additional: ['MEDICAL_CERTIFICATE'] },
    reason: 'Annual policy refresh.',
  };

  await expect(
    controller.create(agencyId, { catalogueCode: 'VACATION_LEAVE' }, context),
  ).resolves.toMatchObject({ id: leaveTypeId });
  expect(service.create).toHaveBeenCalledWith(context, { catalogueCode: 'VACATION_LEAVE' });

  await expect(
    controller.createPolicyVersion(agencyId, leaveTypeId, body, context),
  ).resolves.toMatchObject({ id: versionId, status: 'DRAFT' });
  expect(service.createPolicyVersion).toHaveBeenCalledWith(context, leaveTypeId, body);

  await expect(
    controller.updatePolicyDraft(
      agencyId,
      leaveTypeId,
      versionId,
      { ...body, rowVersion: 1 },
      context,
    ),
  ).resolves.toMatchObject({ effectiveFrom: '2026-09-01' });

  await expect(
    controller.createPolicyVersion(
      agencyId,
      leaveTypeId,
      { ...body, formula: 'credits * 2' },
      context,
    ),
  ).rejects.toMatchObject({
    status: 400,
    response: {
      error: {
        code: 'INVALID_INPUT',
        fields: { formula: expect.any(String) },
        requestId: context.requestId,
      },
    },
  });
  expect(service.createPolicyVersion).toHaveBeenCalledTimes(1);
});

it('links and unlinks authority document versions', async () => {
  const service = serviceMock();
  service.linkAuthority.mockResolvedValue({
    ...draft,
    authorities: [
      {
        id: authorityId,
        authorityClass: 'NATIONAL_RULE',
        documentId,
        documentNo: null,
        documentType: 'LEAVE_POLICY',
        classification: 'INTERNAL',
        documentStatus: 'APPROVED',
        documentVersionId: versionId,
        documentVersionNo: 1,
        citation: 'Rule XVI, sections 1-3',
        validationReason: null,
        createdAt: '2026-08-01T00:00:00.000Z',
      },
    ],
  });
  service.unlinkAuthority.mockResolvedValue(draft);
  const controller = new LeavePoliciesController(service as never);

  await expect(
    controller.linkAuthority(
      agencyId,
      leaveTypeId,
      versionId,
      { authorityClass: 'NATIONAL_RULE', documentId, citation: 'Rule XVI, sections 1-3' },
      context,
    ),
  ).resolves.toMatchObject({ authorities: [{ id: authorityId }] });
  await expect(
    controller.unlinkAuthority(agencyId, leaveTypeId, versionId, authorityId, context),
  ).resolves.toMatchObject({ id: versionId });
  expect(service.unlinkAuthority).toHaveBeenCalledWith(
    context,
    leaveTypeId,
    versionId,
    authorityId,
  );
});

it('surfaces indeterminate activation reasons and forwards the Idempotency-Key', async () => {
  const service = serviceMock();
  service.activate.mockRejectedValue(
    new LeavePolicyServiceError(
      'The Leave Policy Version cannot deterministically drive leave assessment.',
      409,
      'LEAVE_POLICY_INDETERMINATE',
      ['MISSING_AGENCY_CONFIGURATION_AUTHORITY'],
    ),
  );
  const controller = new LeavePoliciesController(service as never);

  await expect(
    controller.activate(
      agencyId,
      leaveTypeId,
      versionId,
      { reason: 'Approved.' },
      'activate-1',
      context,
    ),
  ).rejects.toMatchObject({
    status: 409,
    response: {
      error: {
        code: 'LEAVE_POLICY_INDETERMINATE',
        reasons: ['MISSING_AGENCY_CONFIGURATION_AUTHORITY'],
        requestId: context.requestId,
      },
    },
  });
  expect(service.activate).toHaveBeenCalledWith(
    context,
    leaveTypeId,
    versionId,
    'Approved.',
    'activate-1',
  );

  await expect(
    controller.activate(agencyId, leaveTypeId, versionId, { reason: 'Approved.' }, '', context),
  ).rejects.toMatchObject({
    status: 400,
    response: { error: { code: 'INVALID_IDEMPOTENCY_KEY', requestId: context.requestId } },
  });

  service.activate.mockResolvedValue({ ...leaveType, status: 'ACTIVE', currentVersion: draft });
  await expect(
    controller.activate(
      agencyId,
      leaveTypeId,
      versionId,
      { reason: 'Approved.' },
      undefined,
      context,
    ),
  ).resolves.toMatchObject({ id: leaveTypeId, status: 'ACTIVE' });
});
