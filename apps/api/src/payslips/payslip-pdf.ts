/** One Payroll Line as the Payslip states it, with how its amount was reached. */
export interface PayslipLine {
  componentCode: string;
  componentName: string;
  lineType: string;
  /** As stored: four places for quantity and amount, eight for rate. */
  quantity: string | null;
  rate: string | null;
  amount: string;
  /** `source_snapshot.unit`, `.formula`, and `.authority`, where the calculator recorded them. */
  unit: string | null;
  formula: string | null;
  authority: string | null;
  ruleVersion: { code: string; name: string; issuanceReference: string } | null;
}

/** What one Payslip states: one finalized Payroll Employee Result and its lines. */
export interface PayslipStatement {
  agencyName: string;
  period: {
    code: string;
    runType: string;
    periodFrom: string;
    periodTo: string;
    paymentDate: string;
    finalizedAt: string;
  };
  employee: { employeeNumber: string; legalName: string };
  result: {
    id: string;
    calculationVersion: number;
    calculationHash: string;
    grossAmount: string;
    totalDeductions: string;
    netAmount: string;
  };
  lines: PayslipLine[];
}

const SECTIONS = [
  ['EARNING', 'Earnings'],
  ['DEDUCTION', 'Deductions'],
  ['EMPLOYER_SHARE', 'Employer shares (paid by the Agency, not deducted from pay)'],
  ['INFORMATIONAL', 'Informational (does not change pay)'],
] as const;

/**
 * The Payslip's text, top to bottom. It is LingkodHR's own Printable System
 * View (#617): no form number, form title, or claim to conform to a COA or
 * BIR format. Each line shows its amount and how it was reached: its
 * quantity and rate, the formula and authority the calculation recorded, and
 * the National Payroll Rule Version it applied.
 */
export function payslipText(statement: PayslipStatement): string[] {
  const { period, employee, result } = statement;
  const text = [
    'PAYSLIP',
    statement.agencyName,
    'A LingkodHR Printable System View. It states one finalized Payroll Employee Result. It is not proof of payment and is not a prescribed government form.',
    '',
    `Employee: ${employee.legalName} (${employee.employeeNumber})`,
    `Payroll Period: ${period.code}, ${period.runType}, ${period.periodFrom} to ${period.periodTo}`,
    `Payment date: ${period.paymentDate}. Finalized: ${period.finalizedAt}.`,
    `Payroll Employee Result ${result.id}, calculation version ${result.calculationVersion}`,
    `Calculation hash: ${result.calculationHash}`,
  ];
  for (const [lineType, title] of SECTIONS) {
    const lines = statement.lines.filter((line) => line.lineType === lineType);
    if (lines.length === 0) continue;
    text.push('', title.toUpperCase());
    for (const line of lines) text.push(...lineText(line));
  }
  text.push(
    '',
    `Gross earnings: PHP ${money(result.grossAmount)}`,
    `Total deductions: PHP ${money(result.totalDeductions)}`,
    `Net pay: PHP ${money(result.netAmount)}`,
  );
  return text;
}

function lineText(line: PayslipLine): string[] {
  const text = [`${line.componentName} (${line.componentCode}): PHP ${money(line.amount)}`];
  const basis = [
    line.quantity !== null &&
      `quantity ${decimal(line.quantity)}${line.unit ? ` ${line.unit}` : ''}`,
    line.rate !== null && `rate ${decimal(line.rate)}`,
  ].filter(Boolean);
  if (basis.length > 0) text.push(`    ${basis.join(' x ')}`);
  if (line.formula) text.push(`    Formula: ${line.formula}`);
  if (line.authority) text.push(`    Authority: ${line.authority}`);
  if (line.ruleVersion) {
    const { code, name, issuanceReference } = line.ruleVersion;
    text.push(`    Rule: ${name} (${code}), ${issuanceReference}`);
  }
  return text;
}

/** A stored amount with thousands separators, at two places when its last two are zero. */
export function money(value: string): string {
  const [whole = '0', fraction = ''] = value.split('.');
  const sign = whole.startsWith('-') ? '-' : '';
  const digits = whole.replace('-', '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const places = fraction.padEnd(2, '0');
  const shown = /^\d{2}0*$/.test(places) ? places.slice(0, 2) : places;
  return `${sign}${digits}.${shown}`;
}

/** A stored quantity or rate without trailing zeros. */
function decimal(value: string): string {
  return value.includes('.') ? value.replace(/\.?0+$/, '') : value;
}

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 50;
const FONT_SIZE = 9;
const LEADING = 12;
const LINES_PER_PAGE = Math.floor((PAGE_HEIGHT - 2 * MARGIN) / LEADING);
const WRAP_AT = 100;

/**
 * A minimal PDF of plain text lines in Helvetica on A4 pages. The same lines
 * always give the same bytes: there is no creation date or random identifier,
 * so a retried rendering of a finalized result is the same file.
 */
export function renderTextPdf(lines: readonly string[]): Buffer {
  const wrapped = lines.flatMap(wrap);
  const pages: string[][] = [];
  for (let index = 0; index < Math.max(wrapped.length, 1); index += LINES_PER_PAGE) {
    pages.push(wrapped.slice(index, index + LINES_PER_PAGE));
  }
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, page) => `${4 + 2 * page} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  pages.forEach((page, index) => {
    const stream = [
      'BT',
      `/F1 ${FONT_SIZE} Tf`,
      `${LEADING} TL`,
      `${MARGIN} ${PAGE_HEIGHT - MARGIN} Td`,
      ...page.map((line) => `(${pdfString(line)}) Tj T*`),
      'ET',
    ].join('\n');
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + 2 * index} 0 R >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  });
  // Every character below is one byte, so string offsets are byte offsets.
  let body = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = body.length;
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

function wrap(line: string): string[] {
  const indent = /^\s*/.exec(line)![0];
  const rows: string[] = [];
  let rest = line;
  while (rest.length > WRAP_AT) {
    const space = rest.lastIndexOf(' ', WRAP_AT);
    const cut = space > indent.length ? space : WRAP_AT;
    rows.push(rest.slice(0, cut));
    rest = `${indent}    ${rest.slice(cut).trimStart()}`;
  }
  rows.push(rest);
  return rows;
}

/** WinAnsi bytes for the few characters outside Latin-1 that payroll text uses. */
const WIN_ANSI: Record<string, string> = {
  '–': '\x96',
  '—': '\x97',
  '‘': '\x91',
  '’': '\x92',
  '“': '\x93',
  '”': '\x94',
  '−': '-',
  '₱': 'PHP ',
};

/** A PDF literal string: WinAnsi bytes, with `\`, `(`, and `)` escaped. */
function pdfString(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0)!;
    const byte =
      WIN_ANSI[char] ??
      ((code >= 0x20 && code < 0x7f) || (code >= 0xa0 && code <= 0xff) ? char : '?');
    out += byte === '\\' || byte === '(' || byte === ')' ? `\\${byte}` : byte;
  }
  return out;
}
