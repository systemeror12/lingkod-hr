import { expect, it } from 'vitest';
import {
  boardParticipationSchema,
  boardRecommendationSchema,
  candidateEvaluationReportSchema,
  conflictDeclarationSchema,
  selectionDecisionSchema,
  sessionCommandSchema,
  sessionCompletionSchema,
  sessionCreateSchema,
  sessionListSchema,
} from './deliberations.schemas';

const id = (suffix: string) => `00000000-0000-4000-8000-0000000000${suffix}`;

it('accepts supported Selection Board Session commands', () => {
  expect(
    sessionCreateSchema.safeParse({
      vacancyPublicationId: id('01'),
      sessionDate: '2026-09-10',
    }).success,
  ).toBe(true);
  expect(sessionListSchema.safeParse({}).success).toBe(true);
  expect(sessionListSchema.safeParse({ status: 'IN_PROGRESS' }).success).toBe(true);
  expect(
    boardParticipationSchema.safeParse({
      rosterSnapshotMemberId: id('02'),
      attendanceStatus: 'PRESENT',
      signedAt: '2026-09-10T01:00:00.000Z',
    }).success,
  ).toBe(true);
  expect(
    conflictDeclarationSchema.safeParse({
      participationId: id('03'),
      applicationId: id('04'),
      hasConflict: true,
      details: 'A declared relationship.',
    }).success,
  ).toBe(true);
  expect(sessionCommandSchema.safeParse({}).success).toBe(true);
  expect(sessionCompletionSchema.safeParse({ minutesDocumentVersionId: id('05') }).success).toBe(
    true,
  );
  expect(
    candidateEvaluationReportSchema.safeParse({ reportDocumentVersionId: id('06') }).success,
  ).toBe(true);
  expect(
    selectionDecisionSchema.safeParse({
      decision: 'SELECTED',
      reason: 'The appointing authority selected the recommended candidate.',
      authorityDocumentVersionId: id('07'),
    }).success,
  ).toBe(true);
});

it('rejects unsupported or incomplete Session commands', () => {
  expect(sessionCreateSchema.safeParse({ vacancyPublicationId: id('01') }).success).toBe(false);
  expect(
    sessionCreateSchema.safeParse({
      vacancyPublicationId: id('01'),
      sessionDate: '2026-09-10',
      quorum: 2,
    }).success,
  ).toBe(false);
  expect(sessionCommandSchema.safeParse({ reason: 'x' }).success).toBe(false);
  expect(
    boardParticipationSchema.safeParse({
      rosterSnapshotMemberId: id('02'),
      attendanceStatus: 'EXCUSED',
    }).success,
  ).toBe(false);
  expect(
    conflictDeclarationSchema.safeParse({
      participationId: id('03'),
      applicationId: id('04'),
      hasConflict: 'yes',
    }).success,
  ).toBe(false);
  expect(
    candidateEvaluationReportSchema.safeParse({ reportDocumentVersionId: id('06'), extra: 1 })
      .success,
  ).toBe(false);
});

it('requires the board reason for a not-recommended outcome and a valid rank', () => {
  expect(
    boardRecommendationSchema.safeParse({
      applicationId: id('08'),
      recommendation: 'RECOMMENDED',
      rankNo: 1,
    }).success,
  ).toBe(true);
  expect(
    boardRecommendationSchema.safeParse({
      applicationId: id('08'),
      recommendation: 'NOT_RECOMMENDED',
    }).success,
  ).toBe(false);
  expect(
    boardRecommendationSchema.safeParse({
      applicationId: id('08'),
      recommendation: 'NOT_RECOMMENDED',
      reason: 'The board did not reach a majority for this applicant.',
    }).success,
  ).toBe(true);
  expect(
    boardRecommendationSchema.safeParse({
      applicationId: id('08'),
      recommendation: 'RECOMMENDED',
      rankNo: 0,
    }).success,
  ).toBe(false);
});

it('requires a decision reason and appointing authority evidence for selection', () => {
  expect(
    selectionDecisionSchema.safeParse({ decision: 'RETURNED', reason: 'Further review required.' })
      .success,
  ).toBe(true);
  expect(
    selectionDecisionSchema.safeParse({
      decision: 'NOT_SELECTED',
      reason: 'The appointing authority declined the slate.',
    }).success,
  ).toBe(true);
  expect(
    selectionDecisionSchema.safeParse({
      decision: 'SELECTED',
      reason: 'Selected.',
    }).success,
  ).toBe(false);
  expect(
    selectionDecisionSchema.safeParse({
      decision: 'SELECTED',
      reason: 'Selected.',
      authorityDocumentVersionId: id('09'),
    }).success,
  ).toBe(true);
  expect(
    selectionDecisionSchema.safeParse({
      decision: 'SELECTED',
      reason: '',
      authorityDocumentVersionId: id('09'),
    }).success,
  ).toBe(false);
});
