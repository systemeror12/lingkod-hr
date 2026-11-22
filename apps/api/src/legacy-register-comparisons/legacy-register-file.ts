import { Prisma } from '@prisma/client';

/**
 * The legacy register file: UTF-8 CSV with the header
 * `employee_number,component_code,amount`, then one row per Employee and pay
 * component. `employee_number` is the Agency's Employee number and
 * `component_code` a pay component code, both as LingkodHR records them, and
 * `amount` is a peso amount with up to 2 decimal places, signed as the legacy
 * register states it.
 */
export const LEGACY_REGISTER_HEADER = ['employee_number', 'component_code', 'amount'] as const;

const AMOUNT = /^-?\d{1,15}(\.\d{1,2})?$/;

export interface LegacyRegisterRow {
  /** The file line the row starts on; the header is line 1. */
  line: number;
  employeeNumber: string;
  componentCode: string;
  amount: string;
}

export interface LegacyRegisterIssue {
  /** The file line, or null for an issue with the whole file. */
  line: number | null;
  code: string;
  message: string;
}

export type ParsedLegacyRegister =
  { ok: true; rows: LegacyRegisterRow[] } | { ok: false; issues: LegacyRegisterIssue[] };

/**
 * Reads and validates the file's shape: encoding, header, field count,
 * required values, amount format, and one row per Employee number and
 * component code. Whether each Employee and component exists is checked
 * against the database by the caller.
 */
export function parseLegacyRegister(content: Buffer): ParsedLegacyRegister {
  let text: string;
  try {
    // The decoder also drops a leading byte order mark.
    text = new TextDecoder('utf-8', { fatal: true }).decode(content);
  } catch {
    return fileIssue('FILE_NOT_UTF8', 'The file is not UTF-8 text.');
  }
  const records = csvRecords(text);
  if (!records) {
    return fileIssue('FILE_MALFORMED', 'The file has a quoted field that is never closed.');
  }
  const [header, ...data] = records.filter(
    (record) => !(record.fields.length === 1 && record.fields[0]!.trim() === ''),
  );
  if (
    !header ||
    header.fields.length !== LEGACY_REGISTER_HEADER.length ||
    header.fields.some(
      (field, index) => field.trim().toLowerCase() !== LEGACY_REGISTER_HEADER[index],
    )
  ) {
    return fileIssue(
      'HEADER_INVALID',
      `The first row must be the header ${LEGACY_REGISTER_HEADER.join(',')}.`,
    );
  }
  if (data.length === 0) {
    return fileIssue('REGISTER_EMPTY', 'The file has no rows after the header.');
  }

  const issues: LegacyRegisterIssue[] = [];
  const rows: LegacyRegisterRow[] = [];
  const firstLineOf = new Map<string, number>();
  for (const { line, fields } of data) {
    if (fields.length !== LEGACY_REGISTER_HEADER.length) {
      issues.push({
        line,
        code: 'ROW_MALFORMED',
        message: `The row has ${fields.length} fields; it needs ${LEGACY_REGISTER_HEADER.length}.`,
      });
      continue;
    }
    const [employeeNumber, componentCode, amount] = fields.map((field) => field.trim()) as [
      string,
      string,
      string,
    ];
    const before = issues.length;
    if (employeeNumber === '') {
      issues.push({
        line,
        code: 'EMPLOYEE_NUMBER_MISSING',
        message: 'The row has no employee number.',
      });
    }
    if (componentCode === '') {
      issues.push({
        line,
        code: 'COMPONENT_CODE_MISSING',
        message: 'The row has no component code.',
      });
    }
    if (!AMOUNT.test(amount)) {
      issues.push({
        line,
        code: 'AMOUNT_INVALID',
        message: `The amount "${amount}" is not a peso amount with up to 2 decimal places, such as 1234.50.`,
      });
    }
    if (issues.length > before) continue;
    // Employee numbers and component codes are case-insensitive (citext).
    const key = `${employeeNumber.toLowerCase()}\u0000${componentCode.toLowerCase()}`;
    const first = firstLineOf.get(key);
    if (first !== undefined) {
      issues.push({
        line,
        code: 'ROW_DUPLICATE',
        message: `Employee ${employeeNumber} and component ${componentCode} already appear on line ${first}.`,
      });
      continue;
    }
    firstLineOf.set(key, line);
    rows.push({ line, employeeNumber, componentCode, amount });
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, rows };
}

/** An amount of one Employee and pay component, on either side of the comparison. */
export interface ComparedAmount {
  employeeId: string;
  payComponentId: string;
  amount: Prisma.Decimal;
}

export interface LegacyRegisterDifferenceValue {
  employeeId: string;
  payComponentId: string;
  legacyAmount: Prisma.Decimal | null;
  payrollAmount: Prisma.Decimal | null;
}

/**
 * Every Employee and component whose legacy and payroll amounts differ,
 * including one that only one side has. It reports both values and decides
 * neither is right.
 */
export function legacyRegisterDifferences(
  legacy: readonly ComparedAmount[],
  payroll: readonly ComparedAmount[],
): LegacyRegisterDifferenceValue[] {
  const keyOf = (amount: ComparedAmount) => `${amount.employeeId}:${amount.payComponentId}`;
  const pairs = new Map<string, LegacyRegisterDifferenceValue>();
  const pairOf = (amount: ComparedAmount) => {
    const key = keyOf(amount);
    let pair = pairs.get(key);
    if (!pair) {
      pair = {
        employeeId: amount.employeeId,
        payComponentId: amount.payComponentId,
        legacyAmount: null,
        payrollAmount: null,
      };
      pairs.set(key, pair);
    }
    return pair;
  };
  for (const amount of legacy) pairOf(amount).legacyAmount = amount.amount;
  for (const amount of payroll) pairOf(amount).payrollAmount = amount.amount;
  return [...pairs.values()].filter(
    ({ legacyAmount, payrollAmount }) =>
      !legacyAmount || !payrollAmount || !legacyAmount.equals(payrollAmount),
  );
}

function fileIssue(code: string, message: string): ParsedLegacyRegister {
  return { ok: false, issues: [{ line: null, code, message }] };
}

/** RFC 4180 records with the line each starts on, or null for an unclosed quote. */
function csvRecords(text: string): { line: number; fields: string[] }[] | null {
  const records: { line: number; fields: string[] }[] = [];
  let fields: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let recordLine = 1;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        if (char === '\n') line += 1;
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      fields.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      fields.push(field);
      records.push({ line: recordLine, fields });
      fields = [];
      field = '';
      line += 1;
      recordLine = line;
    } else {
      field += char;
    }
  }
  if (quoted) return null;
  if (field !== '' || fields.length > 0) {
    fields.push(field);
    records.push({ line: recordLine, fields });
  }
  return records;
}
