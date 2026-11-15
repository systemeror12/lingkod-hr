import type { RequestContext } from '@lingkod-hr/auth';
import { describe, expect, it, vi } from 'vitest';
import { REQUIRED_PERMISSIONS } from '../auth/auth.decorators';
import { ruleVersionsInEffectDuring } from './payroll-rule-snapshots';
import { PayrollPeriodsController } from './payroll-periods.controller';
import {
  isOneCalendarMonth,
  PayrollPeriodsService,
  PayrollPeriodsServiceError,
} from './payroll-periods.service';

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

  it('refuses to start a calculation without payroll.periods.calculate', async () => {
    await expect(
      new PayrollPeriodsService().startCalculation(context, periodId, { rowVersion: 1 }),
    ).rejects.toMatchObject({ statusCode: 403, code: 'PAYROLL_PERIOD_CALCULATE_FORBIDDEN' });
  });

  it('refuses another Agency or a malformed period before calling the service', async () => {
    const service = { create: vi.fn(), moveCutoff: vi.fn(), cancelDraft: vi.fn() };
    const controller = new PayrollPeriodsController(service as never);
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
    const controller = new PayrollPeriodsController(service as never);

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
