import { expect, it } from 'vitest';
import {
  approvalRequestCreateSchema,
  approvalRequestListSchema,
  approvalRouteCreateSchema,
  approvalRouteDefinitionSchema,
  approvalRouteListSchema,
} from './approval.schemas';

const validStep = {
  stepNo: 1,
  stepMode: 'SEQUENTIAL' as const,
  requiredPermission: 'approvals.requests.approve',
  assignment: { kind: 'ROLE' as const, roleCode: 'hrmo_administrator' },
  requiresSeparateReview: true,
};

it('accepts a narrow sequential route with a typed assignment selector', () => {
  expect(approvalRouteDefinitionSchema.parse({ steps: [validStep] })).toEqual({
    steps: [validStep],
  });
});

it('accepts a subject Supervisor assignment with a fallback role', () => {
  const step = {
    ...validStep,
    assignment: { kind: 'SUBJECT_SUPERVISOR' as const, roleCode: 'hrmo_administrator' },
  };
  expect(approvalRouteDefinitionSchema.parse({ steps: [step] })).toEqual({ steps: [step] });
  expect(() =>
    approvalRouteDefinitionSchema.parse({
      steps: [{ ...validStep, assignment: { kind: 'SUBJECT_SUPERVISOR' } }],
    }),
  ).toThrow();
});

it('accepts distinct permissions for each decision outcome', () => {
  expect(
    approvalRouteDefinitionSchema.parse({
      steps: [
        {
          ...validStep,
          approvePermission: 'approvals.requests.approve',
          returnPermission: 'approvals.requests.return',
          rejectPermission: 'approvals.requests.reject',
        },
      ],
    }),
  ).toMatchObject({
    steps: [
      {
        approvePermission: 'approvals.requests.approve',
        returnPermission: 'approvals.requests.return',
        rejectPermission: 'approvals.requests.reject',
      },
    ],
  });
});

it.each([
  ['parallel steps', { steps: [{ ...validStep, stepMode: 'PARALLEL_ALL' }] }],
  ['duplicate step numbers', { steps: [validStep, { ...validStep, stepNo: 1 }] }],
  ['gapped step numbers', { steps: [validStep, { ...validStep, stepNo: 3 }] }],
])('rejects %s', (_, input) => {
  expect(() => approvalRouteDefinitionSchema.parse(input)).toThrow();
});

it('requires one active route version and an agency-owned route code at creation', () => {
  expect(() =>
    approvalRouteCreateSchema.parse({
      routeCode: 'RECRUITMENT_REQUEST_REVIEW',
      domain: 'RECRUITMENT',
      versionNo: 1,
      effectiveFrom: '2026-09-01',
      stepDefinition: { steps: [validStep] },
    }),
  ).not.toThrow();
});

it.each(['BOARD_RECOMMENDATION', 'SELECTION_DECISION'])(
  'rejects %s from the generic approval request contract',
  (subjectType) => {
    expect(() =>
      approvalRequestCreateSchema.parse({
        routeCode: 'RECRUITMENT_REQUEST_REVIEW',
        subjectType,
        subjectId: '00000000-0000-4000-8000-000000000001',
      }),
    ).toThrow();
  },
);

it('bounds approval list pages and applies the default page size', () => {
  expect(approvalRouteListSchema.parse({})).toMatchObject({ limit: 25 });
  expect(approvalRequestListSchema.parse({ limit: '50', cursor: 'opaque-cursor' })).toEqual({
    limit: 50,
    cursor: 'opaque-cursor',
  });
  expect(() => approvalRouteListSchema.parse({ limit: 51 })).toThrow();
  expect(() => approvalRequestListSchema.parse({ limit: 0 })).toThrow();
});
