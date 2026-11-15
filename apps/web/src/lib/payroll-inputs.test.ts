import { expect, it } from 'vitest';
import { decimalLabel, sourceRecord } from './payroll-inputs';

it('names each posted source record and the workspace that holds it', () => {
  expect(sourceRecord('LeavePosting')).toEqual({
    label: 'Leave Posting',
    workspace: { href: '/leave-applications', label: 'Leave Applications' },
  });
  expect(sourceRecord('AttendanceDeficitCharge').workspace?.href).toBe('/leave-accounts');
  expect(sourceRecord('OvertimeServiceRecord').workspace?.href).toBe('/overtime-authorities');
  expect(sourceRecord('SomethingNew')).toEqual({ label: 'SomethingNew', workspace: null });
});

it('drops trailing zeros from API decimals', () => {
  expect(decimalLabel('1500.00000000')).toBe('1500');
  expect(decimalLabel('0.12500000')).toBe('0.125');
  expect(decimalLabel('12')).toBe('12');
});
