import type { RequestContext } from '@lingkod-hr/auth';
import { describe, expect, it, vi } from 'vitest';
import { REQUIRED_PERMISSIONS } from '../auth/auth.decorators';
import { calculationHash, payrollCalculationHash } from '../payroll-calculation/calculation-hash';
import { PayrollApprovalService } from './payroll-approval.service';
import { PayrollCertificationService } from './payroll-certification.service';
import { PayrollCheckpointReviewService } from './payroll-checkpoint-review.service';
import { PayrollFinalizationService } from './payroll-finalization.service';
import { payrollCheckpointReviewSchema } from './payroll-periods.schemas';
import { ruleVersionsInEffectDuring } from './payroll-rule-snapshots';
import { PayrollPeriodsController } from './payroll-periods.controller';
import {
  calculationRefusal,
  isOneCalendarMonth,
  PayrollPeriodsService,
  PayrollPeriodsServiceError,
} from './payroll-periods.service';
import { PayrollVoidService } from './payroll-void.service';

const version = (
  id: string,
  effectiveFrom: string,
  effectiveTo: string | null,
  successorEffectiveFrom: string | null = null,
) => ({ id, code: `CODE-${id}`, effectiveFrom, effectiveTo, successorEffectiveFrom });

describe('a regular period month', () => {
  it('is the first through the last day of one calendar month', () => {
    expect(isOneCalendarMonth('2026-03-01', '2026-03-31')).toBe(true);
    expect(isOneCalendarMonth('2028-02-01', '2028-02-29')).toBe(true);
    expect(isOneCalendarMonth('2027-02-01', '2027-02-28')).toBe(true);
    expect(isOneCalendarMonth('2026-03-01', '2026-03-30')).toBe(false);
    expect(isOneCalendarMonth('2026-03-02', '2026-04-01')).toBe(false);
    expect(isOneCalendarMonth('2026-03-01', '2026-04-30')).toBe(false);
    expect(isOneCalendarMonth('2026-03-16', '2026-03-31')).toBe(false);
  });
});

describe('a refused recalculation', () => {
  it('says why each status past DRAFT is not calculated again, and what comes first', () => {
    expect(calculationRefusal('FOR_REVIEW')).toMatch(/after a reviewer returns it for correction/);
    expect(calculationRefusal('CERTIFIED')).toMatch(
      /certified calculation version stands.*certification is revoked/,
    );
    expect(calculationRefusal('APPROVED')).toMatch(
      /approved calculation version stands.*returned before finalization/,
    );
    expect(calculationRefusal('FINALIZED')).toMatch(/never calculated again; a Payroll Adjustment/);
    expect(calculationRefusal('VOIDED')).toMatch(/VOIDED, which is final/);
    expect(calculationRefusal('CALCULATING')).toMatch(/wait for its calculation to finish/);
  });
});

describe('the calculation hash a certification binds', () => {
  const a = { employeeId: '00000000-0000-4000-8000-00000000000a', calculationHash: 'a'.repeat(64) };
  const b = { employeeId: '00000000-0000-4000-8000-00000000000b', calculationHash: 'b'.repeat(64) };

  it('hashes the results in Employee order, whatever order they were read in', () => {
    expect(payrollCalculationHash([b, a])).toBe(payrollCalculationHash([a, b]));
    expect(payrollCalculationHash([a, b])).toBe(calculationHash([a, b]));
  });

  it('changes when any result changes, and covers an empty calculation', () => {
    expect(payrollCalculationHash([a, { ...b, calculationHash: 'c'.repeat(64) }])).not.toBe(
      payrollCalculationHash([a, b]),
    );
    expect(payrollCalculationHash([a])).not.toBe(payrollCalculationHash([a, b]));
    expect(payrollCalculationHash([])).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('rule versions in effect during a period', () => {
  it('lists one version for a period it covers', () => {
    expect(
      ruleVersionsInEffectDuring(
        'SALARY_SCHEDULE',
        [version('a', '2026-01-01', null)],
        '2026-03-01',
        '2026-03-31',
      ),
    ).toEqual({ status: 'COVERED', ruleVersionIds: ['a'] });
  });

  it('lists both versions of a tranche change inside the period', () => {
    const versions = [
      version('old', '2026-01-01', null, '2026-03-16'),
      version('new', '2026-03-16', null),
    ];
    expect(
      ruleVersionsInEffectDuring('SALARY_SCHEDULE', versions, '2026-03-01', '2026-03-31'),
    ).toEqual({ status: 'COVERED', ruleVersionIds: ['old', 'new'] });
    // A superseded version out of effect for the whole period is not listed.
    expect(
      ruleVersionsInEffectDuring('SALARY_SCHEDULE', versions, '2026-04-01', '2026-04-30'),
    ).toEqual({ status: 'COVERED', ruleVersionIds: ['new'] });
  });

  it('refuses a missing rule and names an expired one', () => {
    expect(ruleVersionsInEffectDuring('SALARY_SCHEDULE', [], '2026-03-01', '2026-03-31')).toEqual({
      status: 'NOT_IN_EFFECT',
      reason: 'No SALARY_SCHEDULE version is in effect on 2026-03-01.',
    });
    expect(
      ruleVersionsInEffectDuring(
        'SALARY_SCHEDULE',
        [version('a', '2025-01-01', '2025-12-31'), version('b', '2026-01-01', '2026-03-20')],
        '2026-03-01',
        '2026-03-31',
      ),
    ).toEqual({
      status: 'NOT_IN_EFFECT',
      reason:
        'SALARY_SCHEDULE CODE-b ended on 2026-03-20, and no version is in effect on 2026-03-21.',
    });
  });

  it('fails loudly when the table holds two versions in effect on one date', () => {
    expect(() =>
      ruleVersionsInEffectDuring(
        'SALARY_SCHEDULE',
        [version('a', '2026-01-01', null), version('b', '2026-03-10', null)],
        '2026-03-01',
        '2026-03-31',
      ),
    ).toThrow(/More than one SALARY_SCHEDULE version is in effect on 2026-03-10/);
  });
});

describe('the Payroll Period controller', () => {
  const agencyId = '00000000-0000-4000-8000-000000000001';
  const periodId = '00000000-0000-4000-8000-000000000004';
  const context: RequestContext = {
    requestId: 'payroll-periods-api-test',
    userId: '00000000-0000-4000-8000-000000000002',
    agencyId,
    membershipId: '00000000-0000-4000-8000-000000000003',
    primaryOrganizationUnitId: null,
    permissions: [{ code: 'payroll.periods.create', scopePolicy: 'AGENCY' }],
  };

  it('needs payroll.periods.create for every draft command, and calculate to start', () => {
    for (const handler of ['create', 'moveCutoff', 'cancelDraft'] as const) {
      expect(
        Reflect.getMetadata(REQUIRED_PERMISSIONS, PayrollPeriodsController.prototype[handler]),
      ).toEqual(['payroll.periods.create']);
    }
    expect(
      Reflect.getMetadata(
        REQUIRED_PERMISSIONS,
        PayrollPeriodsController.prototype.startCalculation,
      ),
    ).toEqual(['payroll.periods.calculate']);
  });

  it('needs the §6.10 permission for the read and each review command', () => {
    const required = (handler: keyof PayrollPeriodsController) =>
      Reflect.getMetadata(REQUIRED_PERMISSIONS, PayrollPeriodsController.prototype[handler]);
    expect(required('read')).toEqual(['payroll.periods.read']);
    expect(required('certify')).toEqual(['payroll.periods.certify']);
    expect(required('revokeCertification')).toEqual(['payroll.periods.revoke_certification']);
    expect(required('returnForCorrection')).toEqual(['payroll.periods.return']);
    expect(required('recordBudgetReview')).toEqual(['payroll.periods.review_funding']);
    expect(required('recordAccountingReview')).toEqual(['payroll.periods.review_accounting']);
    expect(required('approve')).toEqual(['payroll.periods.approve']);
    expect(required('returnBeforeFinalization')).toEqual(['payroll.periods.return_approved']);
    expect(required('finalize')).toEqual(['payroll.periods.finalize']);
    expect(required('requestVoid')).toEqual(['payroll.periods.void']);
    expect(required('approveVoid')).toEqual(['payroll.periods.approve_void']);
    expect(required('declineVoid')).toEqual(['payroll.periods.approve_void']);
  });

  it('refuses each void command without its permission held Agency-wide, or without its input', async () => {
    const service = new PayrollVoidService({} as never);
    const holding = (code: string, scopePolicy: 'AGENCY' | 'OWN' = 'AGENCY'): RequestContext => ({
      ...context,
      permissions: [{ code, scopePolicy }],
    });
    const forbidden = { statusCode: 403, code: 'PAYROLL_PERIOD_REVIEW_FORBIDDEN' };
    const requested = {
      reason: 'Wrong schedule.',
      documentVersionId: '00000000-0000-4000-8000-000000000005',
      rowVersion: 1,
    };
    await expect(
      service.request(holding('payroll.periods.approve_void'), periodId, requested),
    ).rejects.toMatchObject({ ...forbidden, message: expect.stringMatching(/periods\.void /) });
    await expect(
      service.request(holding('payroll.periods.void', 'OWN'), periodId, requested),
    ).rejects.toMatchObject(forbidden);
    await expect(
      service.approve(holding('payroll.periods.void'), periodId, { rowVersion: 1 }),
    ).rejects.toMatchObject({ ...forbidden, message: expect.stringMatching(/approve_void/) });
    await expect(
      service.decline(holding('payroll.periods.void'), periodId, { reason: 'x', rowVersion: 1 }),
    ).rejects.toMatchObject(forbidden);
    await expect(
      service.request(holding('payroll.periods.void'), periodId, { reason: 'x', rowVersion: 1 }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_INPUT' });
    await expect(
      service.decline(holding('payroll.periods.approve_void'), periodId, { rowVersion: 1 }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_INPUT' });
  });

  it('refuses each checkpoint review without its own permission held Agency-wide', async () => {
    const service = new PayrollCheckpointReviewService({} as never);
    const confirm = {
      outcome: 'CONFIRMED',
      externalReference: 'ORS-2026-03-0001',
      evidenceDocumentVersionId: periodId,
    };
    const forbidden = { statusCode: 403, code: 'PAYROLL_PERIOD_REVIEW_FORBIDDEN' };
    // Each permission records only its own checkpoint, and an OWN grant records neither.
    const holding = (code: string, scopePolicy: 'AGENCY' | 'OWN' = 'AGENCY'): RequestContext => ({
      ...context,
      permissions: [{ code, scopePolicy }],
    });
    await expect(
      service.record(
        holding('payroll.periods.review_accounting'),
        'BUDGET',
        periodId,
        periodId,
        confirm,
      ),
    ).rejects.toMatchObject({ ...forbidden, message: expect.stringMatching(/review_funding/) });
    await expect(
      service.record(
        holding('payroll.periods.review_funding'),
        'ACCOUNTING',
        periodId,
        periodId,
        confirm,
      ),
    ).rejects.toMatchObject({ ...forbidden, message: expect.stringMatching(/review_accounting/) });
    await expect(
      service.record(
        holding('payroll.periods.review_funding', 'OWN'),
        'BUDGET',
        periodId,
        periodId,
        confirm,
      ),
    ).rejects.toMatchObject(forbidden);
  });

  it('confirms with an external reference and evidence, and returns only with a reason', () => {
    const evidenceDocumentVersionId = periodId;
    const valid = (input: unknown) => payrollCheckpointReviewSchema.safeParse(input).success;
    expect(
      valid({ outcome: 'CONFIRMED', externalReference: 'ORS-1', evidenceDocumentVersionId }),
    ).toBe(true);
    expect(valid({ outcome: 'CONFIRMED', externalReference: 'ORS-1' })).toBe(false);
    expect(valid({ outcome: 'CONFIRMED', evidenceDocumentVersionId })).toBe(false);
    expect(valid({ outcome: 'CONFIRMED', externalReference: ' ', evidenceDocumentVersionId })).toBe(
      false,
    );
    expect(
      valid({
        outcome: 'CONFIRMED',
        externalReference: 'ORS-1',
        evidenceDocumentVersionId,
        reason: 'No reason on a confirmation.',
      }),
    ).toBe(false);
    expect(valid({ outcome: 'RETURNED', reason: 'Funds are not available.' })).toBe(true);
    expect(
      valid({
        outcome: 'RETURNED',
        reason: 'See memo.',
        externalReference: 'MEMO-1',
        evidenceDocumentVersionId,
      }),
    ).toBe(true);
    expect(valid({ outcome: 'RETURNED' })).toBe(false);
    expect(valid({ outcome: 'RETURNED', reason: '  ' })).toBe(false);
    expect(valid({ outcome: 'PENDING' })).toBe(false);
  });

  it('refuses each review command without its permission held Agency-wide', async () => {
    const service = new PayrollCertificationService();
    const ownScope: RequestContext = {
      ...context,
      permissions: [
        { code: 'payroll.periods.certify', scopePolicy: 'OWN' },
        { code: 'payroll.periods.revoke_certification', scopePolicy: 'OWN' },
        { code: 'payroll.periods.return', scopePolicy: 'OWN' },
      ],
    };
    const forbidden = { statusCode: 403, code: 'PAYROLL_PERIOD_REVIEW_FORBIDDEN' };
    await expect(
      service.certify(ownScope, periodId, {
        calculationVersion: 1,
        calculationHash: 'a'.repeat(64),
      }),
    ).rejects.toMatchObject(forbidden);
    await expect(
      service.revokeCertification(ownScope, periodId, { reason: 'x', rowVersion: 1 }),
    ).rejects.toMatchObject(forbidden);
    await expect(
      service.returnForCorrection(ownScope, periodId, { reason: 'x', rowVersion: 1 }),
    ).rejects.toMatchObject(forbidden);
  });

  it('refuses approval and return before finalization without their permission held Agency-wide', async () => {
    const service = new PayrollApprovalService();
    const holding = (code: string, scopePolicy: 'AGENCY' | 'OWN' = 'AGENCY'): RequestContext => ({
      ...context,
      permissions: [{ code, scopePolicy }],
    });
    const forbidden = { statusCode: 403, code: 'PAYROLL_PERIOD_REVIEW_FORBIDDEN' };
    // Each permission allows only its own command, and an OWN grant allows neither.
    await expect(
      service.approve(holding('payroll.periods.return_approved'), periodId, { rowVersion: 1 }),
    ).rejects.toMatchObject({ ...forbidden, message: expect.stringMatching(/approve/) });
    await expect(
      service.approve(holding('payroll.periods.approve', 'OWN'), periodId, { rowVersion: 1 }),
    ).rejects.toMatchObject(forbidden);
    await expect(
      service.returnBeforeFinalization(holding('payroll.periods.approve'), periodId, {
        reason: 'x',
        rowVersion: 1,
      }),
    ).rejects.toMatchObject({ ...forbidden, message: expect.stringMatching(/return_approved/) });
    // A return needs its reason before anything is read.
    await expect(
      service.returnBeforeFinalization(holding('payroll.periods.return_approved'), periodId, {
        reason: '  ',
        rowVersion: 1,
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_INPUT' });
  });

  it('refuses finalization without payroll.periods.finalize held Agency-wide, or without a row version', async () => {
    const service = new PayrollFinalizationService();
    const holding = (code: string, scopePolicy: 'AGENCY' | 'OWN' = 'AGENCY'): RequestContext => ({
      ...context,
      permissions: [{ code, scopePolicy }],
    });
    const forbidden = { statusCode: 403, code: 'PAYROLL_PERIOD_REVIEW_FORBIDDEN' };
    await expect(
      service.finalize(holding('payroll.periods.approve'), periodId, { rowVersion: 1 }),
    ).rejects.toMatchObject({ ...forbidden, message: expect.stringMatching(/finalize/) });
    await expect(
      service.finalize(holding('payroll.periods.finalize', 'OWN'), periodId, { rowVersion: 1 }),
    ).rejects.toMatchObject(forbidden);
    await expect(
      service.finalize(holding('payroll.periods.finalize'), periodId, {}),
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_INPUT' });
  });

  it('refuses to start a calculation without payroll.periods.calculate', async () => {
    await expect(
      new PayrollPeriodsService().startCalculation(context, periodId, { rowVersion: 1 }),
    ).rejects.toMatchObject({ statusCode: 403, code: 'PAYROLL_PERIOD_CALCULATE_FORBIDDEN' });
  });

  it('refuses another Agency or a malformed period before calling the service', async () => {
    const service = { create: vi.fn(), moveCutoff: vi.fn(), cancelDraft: vi.fn() };
    const controller = new PayrollPeriodsController(
      service as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const other = '00000000-0000-4000-8000-000000000009';

    await expect(controller.create(other, {}, context)).rejects.toMatchObject({ status: 404 });
    await expect(controller.moveCutoff(agencyId, 'nope', {}, context)).rejects.toMatchObject({
      status: 404,
    });
    await expect(controller.cancelDraft(other, periodId, {}, context)).rejects.toMatchObject({
      status: 404,
    });
    expect(service.create).not.toHaveBeenCalled();
    expect(service.moveCutoff).not.toHaveBeenCalled();
    expect(service.cancelDraft).not.toHaveBeenCalled();
  });

  it('keeps service refusals in the public envelope', async () => {
    const service = {
      cancelDraft: vi
        .fn()
        .mockRejectedValue(
          new PayrollPeriodsServiceError('Not draft.', 409, 'PAYROLL_PERIOD_NOT_DRAFT'),
        ),
    };
    const controller = new PayrollPeriodsController(
      service as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      controller.cancelDraft(agencyId, periodId, { reason: 'x', rowVersion: 1 }, context),
    ).rejects.toMatchObject({
      status: 409,
      response: { error: { code: 'PAYROLL_PERIOD_NOT_DRAFT', requestId: context.requestId } },
    });
    expect(service.cancelDraft).toHaveBeenCalledWith(context, periodId, {
      reason: 'x',
      rowVersion: 1,
    });
  });
});
