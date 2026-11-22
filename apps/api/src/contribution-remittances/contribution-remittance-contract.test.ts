import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CONTRIBUTION_REMITTANCE_STATEMENT,
  planContributionRemittance,
  type ContributionSourceLine,
} from './contribution-remittance-contract';

const period = {
  id: 'period-1',
  code: 'PAY-2026-03',
  runType: 'REGULAR',
  periodFrom: '2026-03-01',
  periodTo: '2026-03-31',
  paymentDate: '2026-03-31',
  calculationVersion: 2,
  finalizedAt: '2026-03-30T08:00:00.000Z',
};

const scheduleIds = {
  GSIS: 'schedule-gsis',
  PHILHEALTH: 'schedule-philhealth',
  PAGIBIG: 'schedule-pagibig',
  EMPLOYEES_COMPENSATION: 'schedule-ec',
};

const line = (
  id: string,
  employee: string,
  contributionType: string,
  employeeShare: string,
  employerShare: string,
): ContributionSourceLine => ({
  contributionLineId: id,
  payrollEmployeeId: `result-${employee}`,
  agencyEmployeeNumber: employee,
  employeeName: `Name ${employee}`,
  contributionType,
  compensationBase: '30000',
  employeeShare,
  employerShare,
  ruleVersionId: `rule-${contributionType}`,
  ruleVersionCode: `${contributionType}-2026`,
});

const plan = (lines: ContributionSourceLine[]) =>
  planContributionRemittance({
    agencyId: 'agency-1',
    summaryId: 'summary-1',
    scheduleIds,
    generatedAt: '2026-03-31T00:00:00.000Z',
    period,
    lines,
  });

const sha256 = (content: string) => createHash('sha256').update(content, 'utf8').digest('hex');

describe('planContributionRemittance', () => {
  const lines = [
    line('l-3', 'E-002', 'GSIS', '1800.0000', '2400.0000'),
    line('l-1', 'E-001', 'GSIS', '2700', '3600'),
    line('l-2', 'E-001', 'PHILHEALTH', '750.00', '750.00'),
    line('l-4', 'E-001', 'EMPLOYEES_COMPENSATION', '0', '100.00'),
    line('l-5', 'E-002', 'EMPLOYEES_COMPENSATION', '0', '100.00'),
  ];

  it('totals each schedule exactly from its own lines, in employee order', () => {
    const { schedules } = plan(lines);
    expect(schedules.map((schedule) => schedule.contributionType)).toEqual([
      'GSIS',
      'PHILHEALTH',
      'PAGIBIG',
      'EMPLOYEES_COMPENSATION',
    ]);
    const gsis = schedules[0]!;
    expect(gsis).toMatchObject({
      id: 'schedule-gsis',
      lineCount: 2,
      employeeShareTotal: '4500.0000',
      employerShareTotal: '6000.0000',
      totalAmount: '10500.0000',
    });
    const content = JSON.parse(gsis.content) as {
      lines: { contributionLineId: string; employeeShare: string; totalShare: string }[];
      totals: unknown;
    };
    expect(content.lines.map((entry) => [entry.contributionLineId, entry.totalShare])).toEqual([
      ['l-1', '6300.0000'],
      ['l-3', '4200.0000'],
    ]);
    expect(content.lines[0]!.employeeShare).toBe('2700.0000');
    expect(content.totals).toEqual({
      lineCount: 2,
      employeeShareTotal: '4500.0000',
      employerShareTotal: '6000.0000',
      totalAmount: '10500.0000',
    });
    expect(gsis.checksum).toBe(sha256(gsis.content));
  });

  it('gives a type with no line a schedule with zero totals', () => {
    const pagibig = plan(lines).schedules[2]!;
    expect(pagibig).toMatchObject({
      contributionType: 'PAGIBIG',
      lineCount: 0,
      employeeShareTotal: '0.0000',
      employerShareTotal: '0.0000',
      totalAmount: '0.0000',
    });
    expect((JSON.parse(pagibig.content) as { lines: unknown[] }).lines).toEqual([]);
  });

  it('totals the summary from the schedules and names each checksum', () => {
    const result = plan(lines);
    const summary = JSON.parse(result.content) as {
      artifact: string;
      contributions: { contributionType: string; scheduleChecksum: string; totalAmount: string }[];
      totals: unknown;
    };
    expect(summary.artifact).toBe('CONTRIBUTION_SUMMARY');
    expect(summary.contributions.map((entry) => entry.scheduleChecksum)).toEqual(
      result.schedules.map((schedule) => schedule.checksum),
    );
    expect(summary.contributions.map((entry) => entry.totalAmount)).toEqual([
      '10500.0000',
      '1500.0000',
      '0.0000',
      '200.0000',
    ]);
    expect(summary.totals).toEqual({
      lineCount: 5,
      employeeShareTotal: '5250.0000',
      employerShareTotal: '6950.0000',
      totalAmount: '12200.0000',
    });
    expect(result.checksum).toBe(sha256(result.content));
  });

  it('states on every artifact that it is no filing, remittance, or issuer format', () => {
    const result = plan(lines);
    for (const content of [result.content, ...result.schedules.map((s) => s.content)]) {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      expect(parsed.statement).toBe(CONTRIBUTION_REMITTANCE_STATEMENT);
      expect(parsed.contract).toEqual({ code: 'CONTRIBUTION_REMITTANCE', version: 1 });
      expect(Object.keys(parsed)).not.toContain('form');
    }
  });

  it('renders the same bytes for the same lines in any order', () => {
    expect(plan([...lines].reverse())).toEqual(plan(lines));
  });

  it('refuses a contribution type the contract has no schedule for', () => {
    expect(() => plan([line('l-9', 'E-001', 'OTHER', '1', '1')])).toThrow(/OTHER/);
  });
});
