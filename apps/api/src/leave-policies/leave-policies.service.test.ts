import { expect, it } from 'vitest';
import type { RequestContext } from '@lingkod-hr/auth';
import {
  LEAVE_INDETERMINATE_REASONS,
  LeavePoliciesService,
  LeavePolicyServiceError,
  leavePolicyAuditWriter,
} from './leave-policies.service';

const documentsService = {} as ConstructorParameters<typeof LeavePoliciesService>[1];
const agencyId = '00000000-0000-4000-8000-000000000001';
const leaveTypeId = '00000000-0000-4000-8000-000000000002';
const versionId = '00000000-0000-4000-8000-000000000003';

function context(permissions: RequestContext['permissions']): RequestContext {
  return {
    requestId: 'leave-policy-service-test',
    userId: '00000000-0000-4000-8000-000000000004',
    agencyId,
    membershipId: '00000000-0000-4000-8000-000000000005',
    primaryOrganizationUnitId: null,
    permissions,
  };
}

function service() {
  return new LeavePoliciesService(leavePolicyAuditWriter, documentsService);
}

it('requires leave.types.read before exposing the catalogue', () => {
  expect(() => service().listCatalogue(context([]))).toThrowError(
    expect.objectContaining({ code: 'LEAVE_TYPE_READ_FORBIDDEN', statusCode: 403 }),
  );
});

it('requires leave.types.manage before starting any maintenance workflow', async () => {
  const readOnly = context([{ code: 'leave.types.read', scopePolicy: 'AGENCY' }]);
  await expect(
    service().create(readOnly, { catalogueCode: 'VACATION_LEAVE' }),
  ).rejects.toMatchObject({
    code: 'LEAVE_TYPE_MANAGE_FORBIDDEN',
    statusCode: 403,
  });
  await expect(
    service().activate(readOnly, leaveTypeId, versionId, 'Approved.'),
  ).rejects.toMatchObject({ code: 'LEAVE_TYPE_MANAGE_FORBIDDEN', statusCode: 403 });
});

it('rejects an unknown catalogue entry before touching agency data', async () => {
  const manage = context([{ code: 'leave.types.manage', scopePolicy: 'AGENCY' }]);
  await expect(
    service().create(manage, { catalogueCode: 'ADMIN_FORMULA_LEAVE' }),
  ).rejects.toMatchObject({
    code: 'LEAVE_CATALOGUE_ENTRY_UNKNOWN',
    statusCode: 400,
  });
});

it('rejects malformed calendar dates before touching agency data', async () => {
  const manage = context([{ code: 'leave.types.manage', scopePolicy: 'AGENCY' }]);
  await expect(
    service().createPolicyVersion(manage, leaveTypeId, {
      effectiveDate: '2026-02-30',
      approvalRouteCode: 'LEAVE-ROUTE-1',
      applicability: { profiles: ['ORDINARY_CIVILIAN_NGA'] },
      documentRequirements: {},
      reason: 'Attempted invalid date.',
    }),
  ).rejects.toMatchObject({ code: 'LEAVE_POLICY_DATE_INVALID', statusCode: 400 });
});

it('requires an Approval Route code before touching agency data', async () => {
  const manage = context([{ code: 'leave.types.manage', scopePolicy: 'AGENCY' }]);
  await expect(
    service().createPolicyVersion(manage, leaveTypeId, {
      effectiveDate: '2026-08-15',
      approvalRouteCode: '   ',
      applicability: { profiles: ['ORDINARY_CIVILIAN_NGA'] },
      documentRequirements: {},
      reason: 'Attempted blank route.',
    }),
  ).rejects.toMatchObject({ code: 'LEAVE_POLICY_ROUTE_REQUIRED', statusCode: 400 });
});

it('requires a stated reason for activation before touching agency data', async () => {
  const manage = context([{ code: 'leave.types.manage', scopePolicy: 'AGENCY' }]);
  await expect(service().activate(manage, leaveTypeId, versionId, '   ')).rejects.toMatchObject({
    code: 'LEAVE_POLICY_ACTIVATION_REASON_REQUIRED',
    statusCode: 400,
  });
});

it('requires evidence read access to bind authority documents', async () => {
  const manageOnly = context([{ code: 'leave.types.manage', scopePolicy: 'AGENCY' }]);
  await expect(
    service().linkAuthority(manageOnly, leaveTypeId, versionId, {
      authorityClass: 'NATIONAL_RULE',
      documentId: '00000000-0000-4000-8000-000000000006',
      citation: 'Rule XVI, sections 1-3',
    }),
  ).rejects.toMatchObject({
    code: 'LEAVE_POLICY_AUTHORITY_FORBIDDEN',
    statusCode: 403,
  });
});

it('carries indeterminate reasons on typed service errors', () => {
  const error = new LeavePolicyServiceError(
    'The Leave Policy Version cannot deterministically drive leave assessment.',
    409,
    'LEAVE_POLICY_INDETERMINATE',
    ['MISSING_NATIONAL_RULE_AUTHORITY'],
  );
  expect(error).toBeInstanceOf(Error);
  expect(error.reasons).toEqual(['MISSING_NATIONAL_RULE_AUTHORITY']);
  expect(LEAVE_INDETERMINATE_REASONS).toContain('FAIL_CLOSED_PLACEHOLDER');
  expect(LEAVE_INDETERMINATE_REASONS).toContain('NO_EFFECTIVE_POLICY_VERSION');
});
