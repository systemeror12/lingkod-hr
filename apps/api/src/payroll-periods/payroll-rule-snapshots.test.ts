import { describe, expect, it } from 'vitest';
import { ruleVersionsForSnapshot } from './payroll-rule-snapshots';

const version = (id: string, effectiveFrom: string, effectiveTo: string | null) => ({
  id,
  code: `CODE-${id}`,
  effectiveFrom,
  effectiveTo,
  successorEffectiveFrom: null,
});

// `OTHER_KIND` stands for any loaded kind no calculator requires yet; it is a
// test name, not a rule kind.
describe('rule versions a snapshot references', () => {
  const salary = [version('salary', '2026-01-01', null)];

  it('references every kind in effect on any date, not only the required ones', () => {
    const versions = new Map([
      ['SALARY_SCHEDULE', salary],
      [
        'OTHER_KIND',
        [
          version('other-old', '2025-01-01', '2025-12-31'),
          version('other-mid', '2026-03-10', '2026-03-20'),
          version('other-late', '2026-04-01', null),
        ],
      ],
    ]);
    expect(ruleVersionsForSnapshot(versions, '2026-03-01', '2026-03-31')).toEqual({
      status: 'COVERED',
      ruleVersionIds: ['salary', 'other-mid'],
    });
  });

  it('does not refuse a kind that is not required when it covers no date', () => {
    const versions = new Map([
      ['SALARY_SCHEDULE', salary],
      ['OTHER_KIND', [version('other-old', '2025-01-01', '2025-12-31')]],
    ]);
    expect(ruleVersionsForSnapshot(versions, '2026-03-01', '2026-03-31')).toEqual({
      status: 'COVERED',
      ruleVersionIds: ['salary'],
    });
  });

  it('still refuses a required kind missing or expired on any date', () => {
    const other: [string, ReturnType<typeof version>[]] = [
      'OTHER_KIND',
      [version('other', '2026-01-01', null)],
    ];
    expect(ruleVersionsForSnapshot(new Map([other]), '2026-03-01', '2026-03-31')).toEqual({
      status: 'NOT_IN_EFFECT',
      reason: 'No SALARY_SCHEDULE version is in effect on 2026-03-01.',
    });
    expect(
      ruleVersionsForSnapshot(
        new Map([['SALARY_SCHEDULE', [version('s', '2026-01-01', '2026-03-15')]], other]),
        '2026-03-01',
        '2026-03-31',
      ),
    ).toEqual({
      status: 'NOT_IN_EFFECT',
      reason:
        'SALARY_SCHEDULE CODE-s ended on 2026-03-15, and no version is in effect on 2026-03-16.',
    });
    // A kind becomes required by joining the list, with its calculator.
    expect(
      ruleVersionsForSnapshot(
        new Map([
          ['SALARY_SCHEDULE', salary],
          ['OTHER_KIND', [version('o', '2026-03-10', null)]],
        ]),
        '2026-03-01',
        '2026-03-31',
        ['SALARY_SCHEDULE', 'OTHER_KIND'],
      ),
    ).toEqual({
      status: 'NOT_IN_EFFECT',
      reason: 'No OTHER_KIND version is in effect on 2026-03-01.',
    });
  });
});
