import { expect, it } from 'vitest';
import {
  EMPLOYEE_REGISTER_PAGE_SIZE,
  employeeRegisterApiQuery,
  employeeRegisterHref,
  readEmployeeRegisterParams,
} from './employee-register';

it('reads search, repeated filters, and the page from the URL and drops unknown values', () => {
  expect(
    readEmployeeRegisterParams({
      q: '  Santos ',
      serviceStatus: ['ACTIVE', 'RETIRED', 'ACTIVE'],
      membership: 'UNLINKED',
      page: '3',
    }),
  ).toEqual({ q: 'Santos', serviceStatus: ['ACTIVE'], membership: ['UNLINKED'], page: 3 });
  expect(readEmployeeRegisterParams({ page: '-2', q: ['a', 'b'] })).toEqual({
    q: 'a',
    serviceStatus: [],
    membership: [],
    page: 1,
  });
});

it('asks the API for one offset page with the same search and filters', () => {
  const query = employeeRegisterApiQuery({
    q: 'Santos',
    serviceStatus: ['ACTIVE', 'SUSPENDED'],
    membership: ['LINKED'],
    page: 3,
  });
  expect(query.getAll('serviceStatus')).toEqual(['ACTIVE', 'SUSPENDED']);
  expect(query.get('q')).toBe('Santos');
  expect(query.get('membership')).toBe('LINKED');
  expect(query.get('limit')).toBe(String(EMPLOYEE_REGISTER_PAGE_SIZE));
  expect(query.get('offset')).toBe(String(EMPLOYEE_REGISTER_PAGE_SIZE * 2));
});

it('builds register links that omit defaults', () => {
  expect(employeeRegisterHref({ q: '', serviceStatus: [], membership: [], page: 1 })).toBe(
    '/employees',
  );
  expect(
    employeeRegisterHref({ q: 'Mara Santos', serviceStatus: ['ACTIVE'], membership: [], page: 2 }),
  ).toBe('/employees?q=Mara+Santos&serviceStatus=ACTIVE&page=2');
});
