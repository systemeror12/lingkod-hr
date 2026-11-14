'use strict';
/*
 * Throwaway prototype for systemeror12/lingkod-hr#327. Synthetic data only: every name, salary, amount, and record number is made up, and
 * nothing here establishes a payroll rule. Actions change sessionStorage and nothing else.
 */
const TODAY = '2026-11-23';
const AGENCY = 'National Archives Coordination Office';
const SELF = 'andrea';
const STORE = 'lhr-payroll-proto-327';
const NOV = '2026-11-REG';

const EMP = {
  andrea: { name: 'Andrea Villanueva', no: 'E-0412', pos: 'Administrative Officer IV', sg: 15, step: 1, monthly: 40208, seg: 'SS-0412-3', appt: 'AP-2023-018', acct: 'LBP ····4412' },
  paolo: { name: 'Paolo Reyes', no: 'E-0457', pos: 'Records Officer I', sg: 11, step: 1, monthly: 30024, seg: 'SS-0457-1', appt: 'AP-2025-006', acct: 'LBP ····7730' },
  ramon: { name: 'Ramon Bautista', no: 'E-0231', pos: 'Supervising Records Officer', sg: 22, step: 2, monthly: 79277, seg: 'SS-0231-5', appt: 'AP-2019-041', acct: 'LBP ····1196' },
  teresa: { name: 'Teresa Ocampo', no: 'E-0188', pos: 'Human Resource Management Officer III', sg: 18, step: 3, monthly: 52703, seg: 'SS-0188-4', appt: 'AP-2018-012', acct: 'LBP ····9054' },
  liza: { name: 'Liza Mercado', no: 'E-0302', pos: 'Administrative Officer V', sg: 18, step: 1, monthly: 51304, seg: 'SS-0302-2', appt: 'AP-2021-027', acct: 'LBP ····3381' },
  noel: { name: 'Noel Garcia', no: 'E-0275', pos: 'Budget Officer III', sg: 18, step: 2, monthly: 51997, seg: 'SS-0275-3', appt: 'AP-2020-009', acct: 'LBP ····6602' },
  josefina: { name: 'Josefina Cruz', no: 'E-0519', pos: 'Administrative Aide VI', sg: 6, step: 4, monthly: 19522, seg: 'SS-0519-1', appt: 'AP-2024-033', acct: 'LBP ····2847' },
  miguel: { name: 'Miguel Santos', no: 'E-0533', pos: 'Records Officer I', sg: 11, step: 1, monthly: 30024, seg: 'SS-0533-1', appt: 'AP-2026-021', acct: 'LBP ····5108', assumed: '2026-11-09' },
};
const CORE7 = ['andrea', 'paolo', 'ramon', 'teresa', 'liza', 'noel', 'josefina'];

// Grants follow docs/hris-controls.md §6.10 with the permissions #330 added. A and R are granted; C is left off.
const ROLES = {
  preparer: { label: 'Payroll Preparer', person: 'Liza Mercado', fn: 'PREPARATION', can: ['periods.read', 'periods.create', 'periods.calculate', 'periods.reopen', 'exceptions.manage', 'results.read', 'payslips.read', 'outputs.generate', 'outputs.read', 'exports.read'] },
  certifier: { label: 'HR Certifying Officer', person: 'Teresa Ocampo', fn: 'HR_CERTIFICATION', can: ['periods.read', 'results.read', 'periods.certify', 'periods.return', 'periods.revoke_certification', 'outputs.generate', 'outputs.read'] },
  budget: { label: 'Budget Officer', person: 'Noel Garcia', fn: 'BUDGET_REVIEW', can: ['periods.read', 'results.read', 'periods.review_funding', 'outputs.generate', 'outputs.read'] },
  accounting: { label: 'Accounting Reviewer', person: 'Carmela Reyes', fn: 'ACCOUNTING_REVIEW', can: ['periods.read', 'results.read', 'periods.review_accounting', 'periods.return', 'payslips.read', 'exports.read', 'exports.generate', 'outputs.generate', 'outputs.read'] },
  approver: { label: 'Payroll Approver', person: 'Antonio Lim', fn: 'APPROVAL', can: ['periods.read', 'results.read', 'periods.approve', 'periods.return', 'periods.return_approved', 'periods.revoke_certification', 'periods.finalize', 'payslips.read', 'payslips.release', 'payslips.withhold', 'exports.read', 'exports.generate', 'outputs.generate', 'outputs.read'] },
  cashier: { label: 'Cashier', person: 'Rosa Dela Cruz', fn: 'DISBURSEMENT', can: ['periods.read', 'results.read', 'payslips.read', 'exports.read', 'exports.generate', 'disbursement.update', 'outputs.generate', 'outputs.read'] },
  auditor: { label: 'Auditor', person: 'Jose Navarro', fn: null, can: ['periods.read', 'results.read', 'payslips.read', 'exports.read', 'outputs.read'] },
  employee: { label: 'Employee', person: 'Andrea Villanueva', fn: null, can: ['payslips.own'] },
};
const FUNCTIONS = {
  PREPARATION: 'Preparation', HR_CERTIFICATION: 'HR certification', BUDGET_REVIEW: 'Budget review',
  ACCOUNTING_REVIEW: 'Accounting review', APPROVAL: 'Approval', DISBURSEMENT: 'Disbursement',
};
const FN_ROLE = { PREPARATION: 'preparer', HR_CERTIFICATION: 'certifier', BUDGET_REVIEW: 'budget', ACCOUNTING_REVIEW: 'accounting', APPROVAL: 'approver', DISBURSEMENT: 'cashier' };

const PERIOD_STATUS = {
  DRAFT: ['Draft', 'neutral'], CALCULATING: ['Calculating', 'warning'], FOR_REVIEW: ['For review', 'info'], CERTIFIED: ['Certified', 'info'],
  APPROVED: ['Approved', 'info'], FINALIZED: ['Finalized', 'success'], VOIDED: ['Voided', 'danger'],
};
const RESULT_STATUS = { PENDING: ['Pending', 'warning'], CALCULATED: ['Calculated', 'info'], EXCEPTION: ['Exception', 'danger'], FINALIZED: ['Finalized', 'success'], VOIDED: ['Voided', 'danger'] };
const EXC_STATUS = { OPEN: ['Open', 'danger'], ACKNOWLEDGED: ['Acknowledged', 'neutral'], RESOLVED: ['Resolved', 'success'] };
const SEVERITY = { BLOCKING: ['Blocking', 'danger'], WARNING: ['Warning', 'warning'] };
const SLIP_STATUS = { GENERATING: ['Generating', 'warning'], READY: ['Ready, not released', 'info'], RELEASED: ['Released', 'success'], WITHHELD: ['Withheld', 'danger'], SUPERSEDED: ['Superseded', 'neutral'] };
const OUTCOME = { NONE: ['No outcome recorded', 'warning'], SUBMITTED: ['Submitted', 'info'], ACCEPTED: ['Accepted', 'info'], SETTLED: ['Settled', 'success'], REJECTED: ['Rejected', 'danger'] };
const OUTPUT_STATUS = { NONE: ['Not generated', 'neutral'], GENERATING: ['Generating', 'warning'], READY: ['Ready', 'success'], SUPERSEDED: ['Superseded', 'neutral'] };
const OUTPUTS = {
  register: 'Payroll register', variance: 'Variance report', gsis: 'GSIS remittance schedule', phic: 'PhilHealth remittance schedule',
  hdmf: 'Pag-IBIG remittance schedule', bir: 'Withholding tax schedule', acct: 'Finalized Payroll Accounting Support Export',
};

// Rule version labels are placeholders. The real ones are National Payroll Rule Versions a platform operator loads (#328).
const RULE = {
  SAL: 'Salary schedule · NPRV-SAL-2026', PERA: 'PERA · NPRV-PERA-01', OT: 'Overtime pay · NPRV-OT-01', GSIS: 'GSIS premium · NPRV-GSIS-01',
  PHIC: 'PhilHealth premium · NPRV-PHIC-2025', HDMF: 'Pag-IBIG contribution · NPRV-HDMF-01', EC: 'Employees’ Compensation · NPRV-EC-01',
  TAX: 'Withholding tax table · NPRV-TAX-2023', YEB: 'Year-end bonus · NPRV-YEB-01', CG: 'Cash gift · NPRV-CG-01',
};

// What each source module handed Payroll, per period, Employee, and calculation version. Quantities only; Payroll supplies every rate.
function factsFor(pid, emp, v) {
  const f = { lwop: 0, deficit: 0, ot: 0, loan: 0, src: {} };
  if (pid === NOV) {
    if (emp === 'andrea') { f.ot = 4; f.src.ot = 'Payroll Input PI-0935 · Overtime hours · 4.0 h on a workday · Overtime Authority OA-2026-031'; }
    if (emp === 'paolo') {
      f.lwop = v <= 1 ? 1 : 0.5;
      f.src.lwop = v <= 1
        ? 'Payroll Input PI-0931 · Leave without pay · 1.000 day on 12 Nov · Leave Application LA-2026-0388'
        : 'Payroll Input PI-0940 · Leave without pay · 0.500 day on 12 Nov · Leave Application LA-2026-0388 v2 (replaces PI-0931)';
    }
    if (emp === 'ramon') { f.deficit = 0.125; f.src.deficit = 'Payroll Input PI-0933 · Unpaid Deficit Remainder · 0.125 day · Attendance Deficit Charge ADC-2026-0214'; }
  }
  if (pid === '2026-10-REG') {
    if (emp === 'paolo') { f.lwop = 1; f.src.lwop = 'Payroll Input PI-0871 · Leave without pay · 1.000 day on 14 Oct · Leave Application LA-2026-0341'; }
    if (emp === 'andrea') { f.ot = 6; f.src.ot = 'Payroll Input PI-0880 · Overtime hours · 6.0 h on a workday · Overtime Authority OA-2026-027'; }
  }
  if (emp === 'josefina') { f.loan = 2350; f.src.loan = 'Issuer-validated obligation OBL-2026-014 · GSIS billing statement for the month'; }
  return f;
}

function seedData() {
  const fin = (by, at) => ({ by, at });
  const settled = (emps, at, pid) => emps.map((e, i) => ({ id: `PIN-${pid.slice(2, 7).replace('-', '')}-${String(i + 1).padStart(2, '0')}`, emp: e, outcomes: [{ status: 'SUBMITTED', at: at + ' 09:10', by: 'Rosa Dela Cruz', ref: 'Batch ' + pid.slice(5, 7) + '-A' }, { status: 'ACCEPTED', at: at + ' 13:40', by: 'Rosa Dela Cruz', ref: 'Bank acknowledgment' }, { status: 'SETTLED', at: at + ' 16:05', by: 'Rosa Dela Cruz', ref: 'Credit advice' }] }));
  const closed = (pid, month, calcAt, payAt) => ({
    v: 1, versions: [{ v: 1, at: calcAt + ' 10:02', by: 'Liza Mercado' }],
    cert: { by: 'Teresa Ocampo', at: calcAt + ' 15:20', v: 1 }, cpre: { id: 'CPRE-' + pid.slice(0, 7) + '-1', at: calcAt + ' 15:21', v: 1 },
    reviews: { budget: { outcome: 'CONFIRMED', by: 'Noel Garcia', at: nextDay(calcAt, 1) + ' 09:30' }, accounting: { outcome: 'CONFIRMED', by: 'Carmela Reyes', at: nextDay(calcAt, 1) + ' 11:15' } },
    approval: fin('Antonio Lim', nextDay(calcAt, 2) + ' 10:00'), final: fin('Antonio Lim', nextDay(calcAt, 2) + ' 10:25'),
    actors: { 'Liza Mercado': 'PREPARATION', 'Teresa Ocampo': 'HR_CERTIFICATION', 'Noel Garcia': 'BUDGET_REVIEW', 'Carmela Reyes': 'ACCOUNTING_REVIEW', 'Antonio Lim': 'APPROVAL', 'Rosa Dela Cruz': 'DISBURSEMENT' },
    history: [
      { what: 'Created ' + month + ' payroll', who: 'Liza Mercado', role: 'Payroll Preparer', at: nextDay(calcAt, -3) + ' 09:00' },
      { what: 'Calculation 1 completed', who: 'System', at: calcAt + ' 10:02' },
      { what: 'Certified calculation 1', who: 'Teresa Ocampo', role: 'HR Certifying Officer', at: calcAt + ' 15:20' },
      { what: 'Budget review confirmed', who: 'Noel Garcia', role: 'Budget Officer', at: nextDay(calcAt, 1) + ' 09:30' },
      { what: 'Accounting review confirmed', who: 'Carmela Reyes', role: 'Accounting Reviewer', at: nextDay(calcAt, 1) + ' 11:15' },
      { what: 'Approved', who: 'Antonio Lim', role: 'Payroll Approver', at: nextDay(calcAt, 2) + ' 10:00' },
      { what: 'Finalized', who: 'Antonio Lim', role: 'Payroll Approver', at: nextDay(calcAt, 2) + ' 10:25' },
    ],
  });
  const slips = (emps, status, at) => Object.fromEntries(emps.map(e => [e, { status, at, by: 'Antonio Lim' }]));

  const oct = Object.assign({ id: '2026-10-REG', name: 'October 2026', run: 'REGULAR', from: '2026-10-01', to: '2026-10-31', cutoff: '2026-10-20 17:00', pay: '2026-10-28', status: 'FINALIZED', emps: CORE7, holds: [] }, closed('2026-10-REG', 'October 2026', '2026-10-21', '2026-10-28'));
  oct.payslips = slips(CORE7, 'RELEASED', '2026-10-26 09:00');
  oct.payslips.ramon = { status: 'WITHHELD', at: '2026-10-26 08:50', by: 'Antonio Lim', reason: 'The PDF failed its integrity check. Held until it is regenerated.' };
  oct.export = { id: 'PEX-2026-10-1', at: '2026-10-26 10:10', by: 'Rosa Dela Cruz', checksum: 'sha256 4be1…9d02', instructions: settled(CORE7, '2026-10-28', '2026-10-REG') };
  oct.export.instructions[6].outcomes = [{ status: 'SUBMITTED', at: '2026-10-28 09:10', by: 'Rosa Dela Cruz', ref: 'Batch 10-A' }, { status: 'REJECTED', at: '2026-10-28 14:20', by: 'Rosa Dela Cruz', ref: 'Return advice RA-5521', note: 'Account closed.' }];
  oct.outputs = { register: { status: 'READY', at: '2026-10-26 10:30', by: 'Liza Mercado' }, variance: { status: 'READY', at: '2026-10-26 10:31', by: 'Liza Mercado' }, gsis: { status: 'READY', at: '2026-10-27 09:00', by: 'Liza Mercado' }, phic: { status: 'GENERATING', at: '2026-11-23 08:55', by: 'Liza Mercado' } };
  oct.history.push({ what: 'Payslips released (6); 1 withheld', who: 'Antonio Lim', role: 'Payroll Approver', at: '2026-10-26 09:00' }, { what: 'Payment Export PEX-2026-10-1 generated', who: 'Rosa Dela Cruz', role: 'Cashier', at: '2026-10-26 10:10' }, { what: 'Disbursement Outcome REJECTED recorded for Josefina Cruz', who: 'Rosa Dela Cruz', role: 'Cashier', at: '2026-10-28 14:20', note: 'Account closed.' });

  const sep = Object.assign({ id: '2026-09-REG', name: 'September 2026', run: 'REGULAR', from: '2026-09-01', to: '2026-09-30', cutoff: '2026-09-18 17:00', pay: '2026-09-28', status: 'FINALIZED', emps: CORE7, holds: [] }, closed('2026-09-REG', 'September 2026', '2026-09-21', '2026-09-28'));
  sep.payslips = slips(CORE7, 'RELEASED', '2026-09-24 09:00');
  sep.export = { id: 'PEX-2026-09-1', at: '2026-09-24 10:00', by: 'Rosa Dela Cruz', checksum: 'sha256 77a0…c3f1', instructions: settled(CORE7, '2026-09-28', '2026-09-REG') };
  sep.outputs = Object.fromEntries(Object.keys(OUTPUTS).map(k => [k, { status: 'READY', at: '2026-09-24 11:00', by: 'Liza Mercado' }]));

  const aug2 = Object.assign({ id: '2026-08-REG-2', name: 'August 2026 (replacement)', run: 'REGULAR', from: '2026-08-01', to: '2026-08-31', cutoff: '2026-08-20 17:00', pay: '2026-08-28', status: 'FINALIZED', emps: CORE7, holds: [], replaces: '2026-08-REG' }, closed('2026-08-REG-2', 'August 2026 (replacement)', '2026-08-25', '2026-08-28'));
  aug2.payslips = slips(CORE7, 'RELEASED', '2026-08-27 15:00');
  aug2.export = { id: 'PEX-2026-08-2', at: '2026-08-27 15:30', by: 'Rosa Dela Cruz', checksum: 'sha256 0c9e…51ab', instructions: settled(CORE7, '2026-08-28', '2026-08-REG-2') };
  aug2.outputs = Object.fromEntries(Object.keys(OUTPUTS).map(k => [k, { status: 'READY', at: '2026-08-27 16:00', by: 'Liza Mercado' }]));

  const aug = Object.assign({ id: '2026-08-REG', name: 'August 2026', run: 'REGULAR', from: '2026-08-01', to: '2026-08-31', cutoff: '2026-08-20 17:00', pay: '2026-08-28', emps: CORE7, holds: [], replacedBy: '2026-08-REG-2' }, closed('2026-08-REG', 'August 2026', '2026-08-21', '2026-08-28'));
  aug.status = 'VOIDED';
  aug.voided = { requestedBy: 'Carmela Reyes', requestedAt: '2026-08-24 09:15', by: 'Antonio Lim', at: '2026-08-24 11:40', reason: 'The whole payroll used the wrong cutoff. No Payment Export had been generated.', doc: 'Memo DV-2026-0812 v1' };
  aug.payslips = slips(CORE7, 'SUPERSEDED', '2026-08-24 11:40');
  aug.export = null; aug.outputs = {};
  aug.history.push({ what: 'Void requested', who: 'Carmela Reyes', role: 'Accounting Reviewer', at: '2026-08-24 09:15', note: aug.voided.reason }, { what: 'Void approved. Sources released; payslips superseded', who: 'Antonio Lim', role: 'Payroll Approver', at: '2026-08-24 11:40' });

  const yeb = {
    id: '2026-YEB', name: 'Year-end bonus and cash gift 2026', run: 'SPECIAL', kind: 'YEB', components: ['Year-end bonus', 'Cash gift'], from: '2026-11-01', to: '2026-11-30', cutoff: '2026-11-16 17:00', pay: '2026-11-25',
    status: 'CERTIFIED', emps: CORE7, holds: [], v: 1, versions: [{ v: 1, at: '2026-11-17 09:40', by: 'Liza Mercado' }],
    cert: { by: 'Teresa Ocampo', at: '2026-11-18 14:05', v: 1 }, cpre: { id: 'CPRE-2026-YEB-1', at: '2026-11-18 14:06', v: 1 },
    reviews: { budget: { outcome: 'CONFIRMED', by: 'Noel Garcia', at: '2026-11-19 10:20' }, accounting: null }, approval: null, final: null,
    actors: { 'Liza Mercado': 'PREPARATION', 'Teresa Ocampo': 'HR_CERTIFICATION', 'Noel Garcia': 'BUDGET_REVIEW' }, payslips: {}, export: null, outputs: {},
    history: [
      { what: 'Created special payroll for Year-end bonus and Cash gift', who: 'Liza Mercado', role: 'Payroll Preparer', at: '2026-11-13 09:00' },
      { what: 'Calculation 1 completed', who: 'System', at: '2026-11-17 09:40' },
      { what: 'Certified calculation 1', who: 'Teresa Ocampo', role: 'HR Certifying Officer', at: '2026-11-18 14:05' },
      { what: 'Budget review confirmed', who: 'Noel Garcia', role: 'Budget Officer', at: '2026-11-19 10:20' },
    ],
  };
  const sup = {
    id: '2026-10-SUP', name: 'Supplemental: October adjustments', run: 'SPECIAL', kind: 'SUP', carries: true, components: ['Payroll Adjustments (positive only)'], from: '2026-10-01', to: '2026-10-31', cutoff: '2026-11-10 17:00', pay: '2026-11-24',
    status: 'APPROVED', emps: ['paolo'], holds: [], v: 1, versions: [{ v: 1, at: '2026-11-11 09:15', by: 'Liza Mercado' }],
    cert: { by: 'Teresa Ocampo', at: '2026-11-12 10:00', v: 1 }, cpre: { id: 'CPRE-2026-10-SUP-1', at: '2026-11-12 10:01', v: 1 },
    reviews: { budget: { outcome: 'CONFIRMED', by: 'Noel Garcia', at: '2026-11-13 09:10' }, accounting: { outcome: 'CONFIRMED', by: 'Carmela Reyes', at: '2026-11-13 15:45' } },
    approval: { by: 'Antonio Lim', at: '2026-11-20 16:30' }, final: null,
    actors: { 'Liza Mercado': 'PREPARATION', 'Teresa Ocampo': 'HR_CERTIFICATION', 'Noel Garcia': 'BUDGET_REVIEW', 'Carmela Reyes': 'ACCOUNTING_REVIEW', 'Antonio Lim': 'APPROVAL' }, payslips: {}, export: null, outputs: {},
    history: [
      { what: 'Created special payroll carrying Payroll Adjustment ADJ-2026-003', who: 'Liza Mercado', role: 'Payroll Preparer', at: '2026-11-09 10:00' },
      { what: 'Calculation 1 completed', who: 'System', at: '2026-11-11 09:15' },
      { what: 'Certified calculation 1', who: 'Teresa Ocampo', role: 'HR Certifying Officer', at: '2026-11-12 10:00' },
      { what: 'Budget review confirmed', who: 'Noel Garcia', role: 'Budget Officer', at: '2026-11-13 09:10' },
      { what: 'Accounting review confirmed', who: 'Carmela Reyes', role: 'Accounting Reviewer', at: '2026-11-13 15:45' },
      { what: 'Approved', who: 'Antonio Lim', role: 'Payroll Approver', at: '2026-11-20 16:30' },
    ],
  };
  const nov = {
    id: NOV, name: 'November 2026', run: 'REGULAR', from: '2026-11-01', to: '2026-11-30', cutoff: '2026-11-20 17:00', pay: '2026-11-27',
    status: 'DRAFT', emps: [...CORE7, 'miguel'], holds: [], v: 1, versions: [{ v: 1, at: '2026-11-20 17:32', by: 'Liza Mercado' }],
    cert: null, cpre: null, reviews: { budget: null, accounting: null }, approval: null, final: null, missingDest: ['noel'],
    actors: { 'Liza Mercado': 'PREPARATION' }, payslips: {}, export: null, outputs: {},
    history: [
      { what: 'Created November 2026 payroll', who: 'Liza Mercado', role: 'Payroll Preparer', at: '2026-11-16 09:00' },
      { what: 'Calculation 1 started; rule snapshot RS-2026-11-1 taken', who: 'Liza Mercado', role: 'Payroll Preparer', at: '2026-11-20 17:05' },
      { what: 'Calculation 1 completed with 2 blocking exceptions', who: 'System', at: '2026-11-20 17:32' },
      { what: 'Returned for correction', who: 'Teresa Ocampo', role: 'HR Certifying Officer', at: '2026-11-21 09:40', note: 'Leave cancelled PI-0931 after calculation 1 used it, and Miguel Santos has no partial-month rule.' },
    ],
  };
  return {
    stage: 'DRAFT', clock: 0,
    periods: [nov, yeb, sup, oct, sep, aug2, aug],
    exceptions: [
      { id: 'EX-0061', period: NOV, v: 1, emp: 'paolo', severity: 'BLOCKING', status: 'OPEN', type: 'CANCELLED_INPUT_USED', title: 'A cancelled Payroll Input was used', detail: 'Leave cancelled PI-0931 (leave without pay, 1.000 day on 12 Nov) after calculation 1 used it. Its replacement is PI-0940 (0.500 day).', fix: 'Clears at the next calculation, which no longer uses PI-0931.' },
      { id: 'EX-0062', period: NOV, v: 1, emp: 'miguel', severity: 'BLOCKING', status: 'OPEN', type: 'NO_PARTIAL_MONTH_RULE', title: 'No rule for a partial month of basic salary', detail: 'Miguel Santos assumed duty on 9 Nov 2026. No National Payroll Rule Version on file prorates a monthly salary for a partial month (#613).', fix: 'Place a Payroll Hold to leave this Employee out, so the rest of the Agency can be paid. The held month is paid later as a Payroll Adjustment.' },
      { id: 'EX-0063', period: NOV, v: 1, emp: null, severity: 'WARNING', status: 'OPEN', type: 'ATTENDANCE_NOT_LOCKED', title: 'An Attendance Period that ended before the cutoff isn’t locked', detail: 'Attendance Period 1–15 Nov 2026 ended before the cutoff and isn’t locked. Its Attendance Payroll Facts aren’t published, so this payroll doesn’t use them. A later payroll consumes them.', fix: 'Acknowledge with a reason, or lock the Attendance Period and recalculate.' },
      { id: 'EX-0048', period: '2026-10-REG', v: 1, emp: null, severity: 'WARNING', status: 'ACKNOWLEDGED', type: 'ATTENDANCE_NOT_LOCKED', title: 'An Attendance Period that ended before the cutoff isn’t locked', detail: 'Attendance Period 1–15 Oct 2026 ended before the cutoff and wasn’t locked.', reason: 'HR confirmed the lock is scheduled for 22 Oct; its facts go to the November payroll.', by: 'Liza Mercado', at: '2026-10-21 11:05' },
    ],
  };
}
function nextDay(d, n) { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
