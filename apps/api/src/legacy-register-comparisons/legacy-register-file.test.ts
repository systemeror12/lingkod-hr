import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { legacyRegisterDifferences, parseLegacyRegister } from './legacy-register-file';

const file = (text: string) => Buffer.from(text, 'utf8');

describe('parseLegacyRegister', () => {
  it('reads each row with its line, ignoring a BOM, CRLF, quotes, and blank lines', () => {
    expect(
      parseLegacyRegister(
        file(
          '\uFEFFEmployee_Number, component_code ,amount\r\n' +
            'E-001,BASIC_SALARY,30000.25\r\n' +
            '\r\n' +
            '"E-002","PERA","-2000"\r\n',
        ),
      ),
    ).toEqual({
      ok: true,
      rows: [
        { line: 2, employeeNumber: 'E-001', componentCode: 'BASIC_SALARY', amount: '30000.25' },
        { line: 4, employeeNumber: 'E-002', componentCode: 'PERA', amount: '-2000' },
      ],
    });
  });

  it('rejects a file that is not UTF-8, has no header, or has no rows', () => {
    expect(parseLegacyRegister(Buffer.from([0xff, 0xfe, 0x00]))).toMatchObject({
      ok: false,
      issues: [{ line: null, code: 'FILE_NOT_UTF8' }],
    });
    expect(parseLegacyRegister(file('employee,component,amount\nE-1,PERA,1\n'))).toMatchObject({
      ok: false,
      issues: [{ line: null, code: 'HEADER_INVALID' }],
    });
    expect(parseLegacyRegister(file('employee_number,component_code,amount\n'))).toMatchObject({
      ok: false,
      issues: [{ line: null, code: 'REGISTER_EMPTY' }],
    });
    expect(
      parseLegacyRegister(file('employee_number,component_code,amount\n"E-1,PERA,1\n')),
    ).toMatchObject({ ok: false, issues: [{ line: null, code: 'FILE_MALFORMED' }] });
  });

  it('gives every row-level reason at once, by line', () => {
    const parsed = parseLegacyRegister(
      file(
        [
          'employee_number,component_code,amount',
          'E-001,BASIC_SALARY,30000',
          'E-001,BASIC_SALARY,1',
          'e-001,basic_salary,2',
          'E-002,PERA',
          ',,1.234',
          'E-003,PERA,"2,000.00"',
        ].join('\n'),
      ),
    );
    expect(parsed).toEqual({
      ok: false,
      issues: [
        expect.objectContaining({ line: 3, code: 'ROW_DUPLICATE' }),
        expect.objectContaining({ line: 4, code: 'ROW_DUPLICATE' }),
        expect.objectContaining({ line: 5, code: 'ROW_MALFORMED' }),
        expect.objectContaining({ line: 6, code: 'EMPLOYEE_NUMBER_MISSING' }),
        expect.objectContaining({ line: 6, code: 'COMPONENT_CODE_MISSING' }),
        expect.objectContaining({ line: 6, code: 'AMOUNT_INVALID' }),
        expect.objectContaining({ line: 7, code: 'AMOUNT_INVALID' }),
      ],
    });
  });
});

describe('legacyRegisterDifferences', () => {
  const amount = (employeeId: string, payComponentId: string, value: string) => ({
    employeeId,
    payComponentId,
    amount: new Prisma.Decimal(value),
  });

  it('keeps both values of each differing pair, and leaves out equal ones', () => {
    expect(
      legacyRegisterDifferences(
        [
          amount('e1', 'basic', '30000.00'),
          amount('e1', 'pera', '2000'),
          amount('e2', 'pera', '1'),
        ],
        [
          amount('e1', 'basic', '30000.0000'),
          amount('e1', 'pera', '2000.5'),
          amount('e3', 'pera', '2'),
        ],
      ).map((difference) => ({
        ...difference,
        legacyAmount: difference.legacyAmount?.toFixed(4) ?? null,
        payrollAmount: difference.payrollAmount?.toFixed(4) ?? null,
      })),
    ).toEqual([
      {
        employeeId: 'e1',
        payComponentId: 'pera',
        legacyAmount: '2000.0000',
        payrollAmount: '2000.5000',
      },
      { employeeId: 'e2', payComponentId: 'pera', legacyAmount: '1.0000', payrollAmount: null },
      { employeeId: 'e3', payComponentId: 'pera', legacyAmount: null, payrollAmount: '2.0000' },
    ]);
  });
});
