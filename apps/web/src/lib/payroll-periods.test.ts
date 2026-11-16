import { describe, expect, it } from 'vitest';
import {
  exceptionMessage,
  exceptionTypeLabel,
  moneyLabel,
  periodStatusDisplay,
  stageCells,
  startsCollapsed,
} from './payroll-periods';

describe('stageCells', () => {
  it('reads Computing… while calculating and never marks the calculation done', () => {
    const cells = stageCells('CALCULATING')!;
    expect(cells.map(({ label }) => label)).toEqual([
      'Draft',
      'Computing…',
      'Certified',
      'Reviewed',
      'Approved',
      'Finalized',
    ]);
    expect(cells[1]).toEqual({ label: 'Computing…', state: 'current' });
    expect(cells.filter(({ state }) => state === 'done').map(({ label }) => label)).toEqual([]);
    expect(periodStatusDisplay.CALCULATING).toEqual({ label: 'Computing…', tone: 'warning' });
  });

  it('marks the stages a period reached, with its own stage current', () => {
    expect(stageCells('FOR_REVIEW')!.map(({ state }) => state)).toEqual([
      'done',
      'current',
      'pending',
      'pending',
      'pending',
      'pending',
    ]);
    expect(stageCells('FINALIZED')!.at(-1)).toEqual({ label: 'Finalized', state: 'current' });
    expect(stageCells('VOIDED')).toBeNull();
  });

  it('shows only a finalized period as complete and collapses finished periods', () => {
    const complete = Object.entries(periodStatusDisplay)
      .filter(([, { tone }]) => tone === 'success')
      .map(([status]) => status);
    expect(complete).toEqual(['FINALIZED']);
    expect(startsCollapsed('FINALIZED')).toBe(true);
    expect(startsCollapsed('VOIDED')).toBe(true);
    expect(startsCollapsed('DRAFT')).toBe(false);
  });
});

describe('labels', () => {
  it('reads amounts as pesos without rounding away a recorded digit', () => {
    expect(moneyLabel('31705.0000')).toBe('₱31,705.00');
    expect(moneyLabel('1234567.5000')).toBe('₱1,234,567.50');
    expect(moneyLabel('0.0000')).toBe('₱0.00');
    expect(moneyLabel('12.3456')).toBe('₱12.3456');
    expect(moneyLabel('-40.5000')).toBe('-₱40.50');
  });

  it('names an exception type and its recorded reason', () => {
    expect(exceptionTypeLabel('COMPENSATION_BASIS_INDETERMINATE')).toBe(
      'Compensation basis indeterminate',
    );
    expect(exceptionMessage({ message: 'No pay basis is recorded.' })).toBe(
      'No pay basis is recorded.',
    );
    expect(exceptionMessage({})).toBeNull();
    expect(exceptionMessage(null)).toBeNull();
  });
});
