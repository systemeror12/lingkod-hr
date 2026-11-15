import { Prisma } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { describe, expect, it, vi } from 'vitest';
import { REQUIRED_PERMISSIONS } from '../auth/auth.decorators';
import type { SalaryGradeRateLookup } from '../payroll-rule-versions/national-payroll-rule-versions';
import { PersonnelSalaryFactsError } from '../personnel-salary-facts/personnel-salary-facts.types';
import { CompensationBasisController } from './compensation-basis.controller';
import {
  CompensationBasisService,
  resolveStretch,
  splitAt,
  type SalaryFacts,
} from './compensation-basis.service';

const facts = (overrides: Partial<Extract<SalaryFacts, { status: 'IN_SERVICE' }>> = {}) =>
  ({
    status: 'IN_SERVICE',
    from: '2030-03-01',
    to: '2030-03-31',
    serviceSegmentId: 'segment-1',
    salaryGrade: 11,
    salaryStep: 1,
    payBasis: 'MONTHLY_FULL_TIME',
    employmentFraction: null,
    ...overrides,
  }) satisfies SalaryFacts;

const found = (monthlyRate = '33000'): SalaryGradeRateLookup => ({
  status: 'FOUND',
  ruleVersionId: 'schedule-1',
  ruleVersionCode: 'SSL-TEST',
  salaryGrade: 11,
  salaryStep: 1,
  monthlyRate: new Prisma.Decimal(monthlyRate),
});

const codes = (stretch: ReturnType<typeof resolveStretch>) =>
  stretch.status === 'INDETERMINATE' ? stretch.reasons.map((reason) => reason.code) : [];

describe('resolveStretch', () => {
  it('resolves the monthly full-time basis with each value beside its source', () => {
    expect(resolveStretch(facts(), found())).toEqual({
      status: 'RESOLVED',
      from: '2030-03-01',
      to: '2030-03-31',
      personnel: {
        serviceSegmentId: 'segment-1',
        salaryGrade: 11,
        salaryStep: 1,
        payBasis: 'MONTHLY_FULL_TIME',
        employmentFraction: null,
      },
      salarySchedule: {
        ruleVersionId: 'schedule-1',
        ruleVersionCode: 'SSL-TEST',
        monthlyRate: '33000',
      },
      rate: {
        monthlyRate: '33000',
        dailyRate: '1500',
        derivation: 'Monthly rate is the schedule rate; daily rate is the monthly rate ÷ 22.',
      },
    });
  });

  it('prorates the part-time basis by the employment fraction', () => {
    const stretch = resolveStretch(
      facts({ payBasis: 'PART_TIME_PROPORTIONAL', employmentFraction: '0.5' }),
      found(),
    );
    expect(stretch).toMatchObject({
      status: 'RESOLVED',
      rate: { monthlyRate: '16500', dailyRate: '750' },
    });
  });

  it('pays the casual basis a daily wage of the monthly rate ÷ 22 and no monthly rate', () => {
    expect(resolveStretch(facts({ payBasis: 'CASUAL_DAILY_WAGE' }), found('30000'))).toMatchObject({
      status: 'RESOLVED',
      rate: { monthlyRate: null, dailyRate: '1363.6363636363636364' },
    });
  });

  it('never treats a missing pay basis as monthly full-time', () => {
    const stretch = resolveStretch(facts({ payBasis: null }), found());
    expect(stretch).toMatchObject({
      status: 'INDETERMINATE',
      personnel: { salaryGrade: 11, salaryStep: 1, payBasis: null },
      salarySchedule: { ruleVersionCode: 'SSL-TEST', monthlyRate: '33000' },
    });
    expect(codes(stretch)).toEqual(['MISSING_PAY_BASIS']);
  });

  it('blocks an unsupported pay basis rather than inheriting monthly behavior', () => {
    expect(codes(resolveStretch(facts({ payBasis: 'UNIFORMED_BASE_PAY' }), found()))).toEqual([
      'UNSUPPORTED_PAY_BASIS',
    ]);
  });

  it('needs an employment fraction above 0 and at most 1 for part-time', () => {
    for (const employmentFraction of [null, '0', '1.5', 'half']) {
      expect(
        codes(
          resolveStretch(
            facts({ payBasis: 'PART_TIME_PROPORTIONAL', employmentFraction }),
            found(),
          ),
        ),
      ).toEqual(['MISSING_EMPLOYMENT_FRACTION']);
    }
  });

  it('names every missing fact, schedule, and rate', () => {
    expect(codes(resolveStretch(facts({ salaryGrade: null, salaryStep: null }), null))).toEqual([
      'MISSING_SALARY_GRADE',
      'MISSING_SALARY_STEP',
    ]);
    expect(
      codes(
        resolveStretch(facts(), { status: 'MISSING_RULE', ruleKind: 'SALARY_SCHEDULE', on: 'x' }),
      ),
    ).toEqual(['MISSING_SALARY_SCHEDULE']);
    const missingRate = resolveStretch(facts({ payBasis: null }), {
      status: 'MISSING_RATE',
      ruleVersionId: 'schedule-1',
      ruleVersionCode: 'SSL-TEST',
      salaryGrade: 11,
      salaryStep: 1,
    });
    expect(codes(missingRate)).toEqual(['MISSING_PAY_BASIS', 'MISSING_SALARY_RATE']);
    expect(missingRate).toMatchObject({ salarySchedule: { monthlyRate: null } });
    expect(
      resolveStretch({ status: 'NO_SERVICE_SEGMENT', from: '2030-03-01', to: '2030-03-02' }, null),
    ).toMatchObject({ status: 'INDETERMINATE', personnel: null, salarySchedule: null });
  });
});

describe('splitAt', () => {
  const stretch = { from: '2030-03-01', to: '2030-03-31', id: 'a' };

  it('splits on each boundary inside the stretch and nowhere else', () => {
    expect(splitAt(stretch, ['2030-03-20', '2030-03-01', '2030-04-01', '2030-03-10'])).toEqual([
      { from: '2030-03-01', to: '2030-03-09', id: 'a' },
      { from: '2030-03-10', to: '2030-03-19', id: 'a' },
      { from: '2030-03-20', to: '2030-03-31', id: 'a' },
    ]);
    expect(splitAt(stretch, ['2030-03-31', '2030-03-31'])).toEqual([
      { from: '2030-03-01', to: '2030-03-30', id: 'a' },
      { from: '2030-03-31', to: '2030-03-31', id: 'a' },
    ]);
    expect(splitAt(stretch, [])).toEqual([stretch]);
  });
});

describe('a pay-basis change inside one period', () => {
  it('resolves each pay basis on its own dates', async () => {
    // Personnel records no pay basis yet (#619), so the facts are injected here.
    const personnel = {
      readInTransaction: vi
        .fn()
        .mockResolvedValue([
          facts({ to: '2030-03-15', payBasis: 'CASUAL_DAILY_WAGE' }),
          facts({ from: '2030-03-16', serviceSegmentId: 'segment-2' }),
        ]),
    };
    const transaction = {
      nationalPayrollRuleVersion: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'schedule-1',
            code: 'SSL-TEST',
            effectiveFrom: new Date('2030-01-01'),
            effectiveTo: null,
            supersededBy: null,
          },
        ]),
      },
      salaryGradeRate: {
        findUnique: vi.fn().mockResolvedValue({ monthlyRate: new Prisma.Decimal('33000') }),
      },
    };
    const service = new CompensationBasisService(personnel as never);
    const basis = await service.resolveInTransaction(
      transaction as never,
      'agency-1',
      'employee-1',
      '2030-03-01',
      '2030-03-31',
    );
    expect(basis.status).toBe('RESOLVED');
    expect(basis.stretches).toMatchObject([
      {
        from: '2030-03-01',
        to: '2030-03-15',
        personnel: { payBasis: 'CASUAL_DAILY_WAGE' },
        rate: { monthlyRate: null, dailyRate: '1500' },
      },
      {
        from: '2030-03-16',
        to: '2030-03-31',
        personnel: { payBasis: 'MONTHLY_FULL_TIME' },
        rate: { monthlyRate: '33000', dailyRate: '1500' },
      },
    ]);
  });
});

describe('CompensationBasisController', () => {
  const agencyId = '00000000-0000-4000-8000-000000000001';
  const employeeId = '00000000-0000-4000-8000-000000000004';
  const context: RequestContext = {
    requestId: 'compensation-basis-test',
    userId: '00000000-0000-4000-8000-000000000002',
    agencyId,
    membershipId: '00000000-0000-4000-8000-000000000003',
    primaryOrganizationUnitId: null,
    permissions: [{ code: 'payroll.compensation.read', scopePolicy: 'AGENCY' }],
  };
  const range = { from: '2030-03-01', to: '2030-03-31' };

  it('needs payroll.compensation.read', () => {
    expect(
      Reflect.getMetadata(REQUIRED_PERMISSIONS, CompensationBasisController.prototype.read),
    ).toEqual(['payroll.compensation.read']);
  });

  it('reads a range and refuses another Agency, a bad id, or a missing range', async () => {
    const service = { read: vi.fn().mockResolvedValue({ status: 'INDETERMINATE' }) };
    const controller = new CompensationBasisController(service as never);
    await expect(controller.read(agencyId, employeeId, range, context)).resolves.toEqual({
      status: 'INDETERMINATE',
    });
    expect(service.read).toHaveBeenCalledWith(context, employeeId, '2030-03-01', '2030-03-31');

    const other = '00000000-0000-4000-8000-000000000009';
    await expect(controller.read(other, employeeId, range, context)).rejects.toMatchObject({
      status: 404,
    });
    await expect(controller.read(agencyId, 'not-a-uuid', range, context)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      controller.read(agencyId, employeeId, { from: '2030-03-01' }, context),
    ).rejects.toMatchObject({ status: 400 });
    expect(service.read).toHaveBeenCalledTimes(1);
  });

  it('refuses a holder without Agency-wide scope and passes Personnel refusals through', async () => {
    const personnel = {
      readInTransaction: vi
        .fn()
        .mockRejectedValue(
          new PersonnelSalaryFactsError('bad', 400, 'PERSONNEL_SALARY_FACTS_INVALID_DATE'),
        ),
    };
    const service = new CompensationBasisService(personnel as never);
    const controller = new CompensationBasisController(service);
    const ownOnly: RequestContext = {
      ...context,
      permissions: [{ code: 'payroll.compensation.read', scopePolicy: 'OWN' }],
    };
    await expect(controller.read(agencyId, employeeId, range, ownOnly)).rejects.toMatchObject({
      status: 403,
    });
    expect(personnel.readInTransaction).not.toHaveBeenCalled();

    const failing = new CompensationBasisController({
      read: vi
        .fn()
        .mockRejectedValue(
          new PersonnelSalaryFactsError('bad', 400, 'PERSONNEL_SALARY_FACTS_INVALID_DATE'),
        ),
    } as never);
    await expect(failing.read(agencyId, employeeId, range, context)).rejects.toMatchObject({
      status: 400,
      response: { error: { code: 'PERSONNEL_SALARY_FACTS_INVALID_DATE' } },
    });
  });
});
