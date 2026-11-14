/*
 * Round 2 for #327: an Odoo-shaped workspace. Employee Payslips, Salary Computation, Salary Structures, and Salary Rules as plain lists and
 * forms. It reuses round 1's sample data and actions (data.js, core.js). Nothing here is editable where #27, #43, and #328 say it isn't:
 * rules are loaded by the platform operator, and a computed line has no override.
 */

/* ---------- Salary Rules and Structures (read-only catalogue; sample wording, not a rule) ---------- */
const RULES = [
  { code: 'BASIC', name: 'Basic salary', cat: 'Basic', seq: 1, cond: 'Always', type: 'Calculator', calc: 'monthly_rate × (22 − unpaid_days) ÷ 22', version: RULE.SAL, line: 'Basic salary' },
  { code: 'PERA', name: 'PERA', cat: 'Allowance', seq: 10, cond: 'Always', type: 'Fixed amount', calc: '₱2,000.00 a month', version: RULE.PERA, line: 'PERA' },
  { code: 'OT', name: 'Overtime pay', cat: 'Allowance', seq: 20, cond: 'A Payroll Input carries certified overtime hours', type: 'Calculator', calc: 'hours × monthly_rate ÷ 22 ÷ 8 × 125%', version: RULE.OT, line: 'Overtime pay' },
  { code: 'YEB', name: 'Year-end bonus', cat: 'Allowance', seq: 30, cond: 'The run names this component', type: 'Calculator', calc: 'monthly_rate × 1', version: RULE.YEB, line: 'Year-end bonus' },
  { code: 'CG', name: 'Cash gift', cat: 'Allowance', seq: 31, cond: 'The run names this component', type: 'Fixed amount', calc: '₱5,000.00', version: RULE.CG, line: 'Cash gift' },
  { code: 'ADJ', name: 'Payroll Adjustment', cat: 'Allowance', seq: 40, cond: 'An open Payroll Adjustment is carried by the run', type: 'Calculator', calc: 'recalculated_line − original_line', version: RULE.SAL, line: 'Basic salary · adjustment for October 2026' },
  { code: 'GROSS', name: 'Gross', cat: 'Gross', seq: 100, cond: 'Always', type: 'Sum', calc: 'Basic + Allowance', version: '—' },
  { code: 'GSIS_PS', name: 'GSIS premium, personal share', cat: 'Deduction', seq: 110, cond: 'Always', type: 'Percentage', calc: '9% × monthly_rate', version: RULE.GSIS, line: 'GSIS premium, personal share' },
  { code: 'PHIC_PS', name: 'PhilHealth premium, personal share', cat: 'Deduction', seq: 120, cond: 'Always', type: 'Percentage', calc: '2.5% × monthly_rate', version: RULE.PHIC, line: 'PhilHealth premium, personal share' },
  { code: 'HDMF_PS', name: 'Pag-IBIG contribution, personal share', cat: 'Deduction', seq: 130, cond: 'Always', type: 'Fixed amount', calc: '₱200.00 a month', version: RULE.HDMF, line: 'Pag-IBIG contribution, personal share' },
  { code: 'WTAX', name: 'Withholding tax', cat: 'Deduction', seq: 140, cond: 'Always', type: 'Calculator', calc: 'tax_table(taxable_pay)', version: RULE.TAX, line: 'Withholding tax' },
  { code: 'LOAN', name: 'Loans and authorized deductions', cat: 'Deduction', seq: 150, cond: 'An issuer-validated obligation is on record', type: 'Input', calc: 'billed_installment', version: 'No rule version', line: 'GSIS consolidated loan' },
  { code: 'NET', name: 'Net pay', cat: 'Net', seq: 200, cond: 'Always', type: 'Sum', calc: 'Gross − Deduction', version: '—' },
  { code: 'GSIS_GS', name: 'GSIS premium, government share', cat: 'Government share', seq: 210, cond: 'Always', type: 'Percentage', calc: '12% × monthly_rate', version: RULE.GSIS, line: 'GSIS premium, government share' },
  { code: 'PHIC_GS', name: 'PhilHealth premium, government share', cat: 'Government share', seq: 220, cond: 'Always', type: 'Percentage', calc: '2.5% × monthly_rate', version: RULE.PHIC, line: 'PhilHealth premium, government share' },
  { code: 'HDMF_GS', name: 'Pag-IBIG contribution, government share', cat: 'Government share', seq: 230, cond: 'Always', type: 'Fixed amount', calc: '₱200.00 a month', version: RULE.HDMF, line: 'Pag-IBIG contribution, government share' },
  { code: 'EC', name: 'Employees’ Compensation', cat: 'Government share', seq: 240, cond: 'Always', type: 'Fixed amount', calc: '₱100.00 a month', version: RULE.EC, line: 'Employees’ Compensation' },
];
const RULE_BY_LINE = Object.fromEntries(RULES.filter(r => r.line).map(r => [r.line, r]));
const rule = code => RULES.find(r => r.code === code);
const STRUCTS = [
  { id: 'REG', name: 'Regular payroll', used: 'Every regular run', rules: ['BASIC', 'PERA', 'OT', 'GROSS', 'GSIS_PS', 'PHIC_PS', 'HDMF_PS', 'WTAX', 'LOAN', 'NET', 'GSIS_GS', 'PHIC_GS', 'HDMF_GS', 'EC'] },
  { id: 'YEB', name: 'Year-end bonus and cash gift', used: 'A special run that names these components', rules: ['YEB', 'CG', 'GROSS', 'WTAX', 'NET'] },
  { id: 'SUP', name: 'Supplemental adjustments', used: 'A special run that carries Payroll Adjustments', rules: ['ADJ', 'GROSS', 'NET'] },
];
const structOf = p => STRUCTS.find(s => s.id === (p.kind || 'REG'));

/* ---------- small renderers ---------- */
function openLink(label, o, fid) { return `<button type="button" class="linkbtn" data-go='${esc(JSON.stringify(o))}' data-fid="${esc(fid || 'go:' + JSON.stringify(o))}">${esc(label)}</button>`; }
function table(label, min, head, rows, foot, cls) {
  return `<div class="scroll" tabindex="0" role="region" aria-label="${esc(label)}"><table class="tbl ${cls || ''}" style="min-width:${min}px"><thead><tr>${head.map(h => `<th scope="col"${h.startsWith('#') ? ' class="num"' : ''}>${esc(h.replace(/^#/, ''))}</th>`).join('')}</tr></thead><tbody>${rows}</tbody>${foot ? `<tfoot>${foot}</tfoot>` : ''}</table></div>`;
}
function surface(title, text) { return `<div class="surface" role="status"><strong>${esc(title)}</strong><p>${text}</p></div>`; }
function tabs(list, current, labels) {
  return `<div class="tabs" role="tablist" aria-label="Sections">${list.map(t => `<button type="button" role="tab" class="tab" id="tab-${t}" aria-controls="tabpanel" aria-selected="${t === current}" tabindex="${t === current ? 0 : -1}" data-tab="${t}" data-fid="tab-${t}">${esc(labels[t])}</button>`).join('')}</div>`;
}
function pager(list, id, mk) {
  const i = list.findIndex(x => x.id === id);
  if (i < 0) return '';
  const b = (x, l) => `<button type="button" class="btn btn-secondary btn-sm" ${x ? `data-go='${esc(JSON.stringify(mk(x)))}'` : 'disabled'} data-fid="pager-${l}" aria-label="${l}">${l === 'Previous' ? '‹' : '›'}</button>`;
  return `<div class="pager"><span class="cap muted">${i + 1} / ${list.length}</span>${b(list[i - 1], 'Previous')}${b(list[i + 1], 'Next')}</div>`;
}
function crumbs(parts) { return `<nav class="bc" aria-label="Breadcrumb">${parts.map((x, i) => i === parts.length - 1 ? `<h1>${esc(x[0])}</h1>` : `${openLink(x[0], x[1], 'bc-' + i)}<span aria-hidden="true">/</span>`).join('')}</nav>`; }
function viewSwitch(views) { return views.length > 1 ? `<div class="viewsw" role="group" aria-label="View">${views.map(v => `<button type="button" aria-pressed="${S.view === v}" data-view="${v}" data-fid="view-${v}">${v === 'tree' ? 'List' : 'Kanban'}</button>`).join('')}</div>` : ''; }
function fields(pairs) { return `<dl class="fields">${pairs.filter(Boolean).map(([k, v, big]) => `<div><dt>${k}</dt><dd${big ? ' class="big"' : ''}>${v}</dd></div>`).join('')}</dl>`; }
function historyPanel(p) {
  return `<aside class="panel hist" aria-label="History"><h3>History</h3><ol class="timeline">${p.history.slice().reverse().map(x => `<li><span><strong>${esc(x.who)}</strong>${x.role ? ` <span class="muted">· ${esc(x.role)}</span>` : ''}</span><span>${esc(x.what)}</span>${x.note ? `<span class="muted">“${esc(x.note)}”</span>` : ''}<span class="muted cap">${esc(dtt(x.at))}</span></li>`).join('')}</ol></aside>`;
}

/* ---------- stage: one bar, six steps ---------- */
const STAGES = [['DRAFT', 'Draft'], ['CALCULATED', 'Calculated'], ['CERTIFIED', 'Certified'], ['REVIEWED', 'Reviewed'], ['APPROVED', 'Approved'], ['FINALIZED', 'Finalized']];
const STAGE_TAG = { DRAFT: ['Draft', 'neutral'], CALCULATING: ['Computing', 'warning'], CALCULATED: ['Calculated', 'info'], CERTIFIED: ['Certified', 'info'], REVIEWED: ['Reviewed', 'info'], APPROVED: ['Approved', 'info'], FINALIZED: ['Finalized', 'success'], VOIDED: ['Voided', 'danger'] };
const reviewCount = p => (p.reviews.budget ? 1 : 0) + (p.reviews.accounting ? 1 : 0);
function stageOf(p) {
  return { VOIDED: 'VOIDED', FINALIZED: 'FINALIZED', APPROVED: 'APPROVED', CERTIFIED: reviewCount(p) === 2 ? 'REVIEWED' : 'CERTIFIED', FOR_REVIEW: 'CALCULATED', CALCULATING: 'CALCULATING', DRAFT: 'DRAFT' }[p.status];
}
function statusbar(p) {
  const cur = stageOf(p);
  if (cur === 'VOIDED') return `<ol class="sb" aria-label="Stage"><li class="void" aria-current="step">Voided</li></ol>`;
  const at = STAGES.findIndex(s => s[0] === (cur === 'CALCULATING' ? 'DRAFT' : cur));
  return `<ol class="sb" aria-label="Stage">${STAGES.map(([k, l], i) => {
    const label = i === at && cur === 'CALCULATING' ? 'Computing…' : k === 'REVIEWED' && cur === 'CERTIFIED' ? `Reviewed ${reviewCount(p)}/2` : l;
    return `<li class="${i < at ? 'done' : i > at ? 'todo' : 'cur' + (cur === 'CALCULATING' ? ' wait' : cur === 'FINALIZED' ? ' final' : '')}" ${i === at ? 'aria-current="step"' : ''}>${label}</li>`;
  }).join('')}</ol>`;
}

/* ---------- payslips ---------- */
const slipId = (p, e) => p.id + '~' + e;
const slipRef = (p, e) => `SLIP/${p.id}/${EMP[e].no.slice(2)}`;
function slipById(id) { const [pid, e] = (id || '').split('~'), p = period(pid); return p && EMP[e] && p.emps.includes(e) ? { id, p, e } : null; }
function slipFlags(p, e) {
  const f = [], h = held(p, e), s = p.payslips[e];
  if (h) f.push(['On hold', 'neutral']);
  else if (!hasResult(p, e)) f.push(['Blocked', 'danger']);
  else if (p.status !== 'FINALIZED' && excFor(p, e).some(x => x.severity === 'BLOCKING' && x.status === 'OPEN')) f.push(['Exception', 'danger']);
  if (s && s.status === 'WITHHELD') f.push(['Withheld', 'danger']);
  const i = instructionOf(p, e);
  if (i && latest(i) === 'REJECTED') f.push(['Payment rejected', 'danger']);
  return f;
}
function instructionOf(p, e) { return p.export ? p.export.instructions.find(i => i.emp === e && !i.supersededBy) : null; }
function netOf(p, e) { return p.v && hasResult(p, e) ? result(p, e).net : null; }
function slipRows(only) {
  if (S.sample === 'empty') return [];
  return D.periods.filter(p => !only || p.id === only).flatMap(p => p.emps.map(e => ({ id: slipId(p, e), p, e })))
    .filter(x => !isEmployee() || (x.e === SELF && x.p.payslips[SELF] && x.p.payslips[SELF].status === 'RELEASED'))
    .filter(x => (S.status === 'ALL' || stageOf(x.p) === S.status) && (!S.q || (EMP[x.e].name + ' ' + slipRef(x.p, x.e) + ' ' + x.p.name).toLowerCase().includes(S.q.toLowerCase())));
}
function slipRow(x, showRun) {
  const { p, e } = x, n = netOf(p, e), fl = slipFlags(p, e);
  return `<tr ${x.id === S.record ? 'aria-current="true"' : ''}><th scope="row">${openLink(slipRef(p, e), { dest: 'payslips', view: 'form', record: x.id }, 'slip-' + x.id)}</th><td>${esc(EMP[e].name)}</td>
    ${showRun ? `<td>${esc(p.name)}</td>` : ''}<td class="nowrap">${range(p.from, p.to)}</td><td class="num">${n == null ? '<span class="muted">—</span>' : peso(n)}</td>
    <td><span class="flags">${isEmployee() ? tag(['Released', 'success']) : held(p, e) ? '' : tag(STAGE_TAG[stageOf(p)])}${fl.map(f => tag(f)).join('')}</span></td></tr>`;
}
const SLIP_HEAD = showRun => ['Reference', 'Employee', ...(showRun ? ['Payroll run'] : []), 'Period', '#Net pay', 'Status'];
function slipFilters(extra) {
  return `<div class="filters"><label class="field">Search<input class="input" type="search" data-filter="q" data-fid="filter-q" value="${esc(S.q)}" placeholder="Employee or reference"></label>${extra || ''}</div>`;
}
function stageFilter() { return `<label class="field">Status<select class="input" data-filter="status" data-fid="filter-status"><option value="ALL">All</option>${Object.entries(STAGE_TAG).map(([k, [l]]) => `<option value="${k}" ${S.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`; }
function slipBoard(rows) {
  return `<div class="board" tabindex="0" role="region" aria-label="Payslips by status">${Object.keys(STAGE_TAG).map(k => {
    const col = rows.filter(x => stageOf(x.p) === k);
    return `<section class="col" aria-labelledby="col-${k}"><h3 id="col-${k}">${tag(STAGE_TAG[k])}<span class="muted">${col.length}</span></h3>${col.length ? col.map(x => `<button type="button" class="card" data-go='${esc(JSON.stringify({ dest: 'payslips', view: 'form', record: x.id }))}' data-fid="card-${x.id}"><strong>${esc(EMP[x.e].name)}</strong><span class="cap muted">${esc(x.p.name)}</span><span>${netOf(x.p, x.e) == null ? '—' : peso(netOf(x.p, x.e))}</span>${slipFlags(x.p, x.e).length ? `<span class="flags">${slipFlags(x.p, x.e).map(f => tag(f)).join('')}</span>` : ''}</button>`).join('') : '<p class="cap muted" style="padding:8px 4px">None</p>'}</section>`;
  }).join('')}</div>`;
}

// Groups of finished runs start collapsed, as a grouped list does.
S.groups = {};
function groupOpen(p) { return S.q || S.status !== 'ALL' ? true : S.groups[p.id] !== undefined ? S.groups[p.id] : !['FINALIZED', 'VOIDED'].includes(p.status) || slipCounts(p).READY + slipCounts(p).GENERATING > 0; }

/* ---------- actions ---------- */
function runActions(p) {
  const a = [], why = [];
  const B = (label, act, kind, off) => a.push(`<button type="button" class="btn ${kind || 'btn-secondary'}" data-act="${act}" data-id="${p.id}" data-fid="${act}:${p.id}" ${off ? 'disabled' : ''}>${label}</button>`);
  const P = (label, act) => a.push(`<button type="button" class="proto-inline" data-act="${act}" data-id="${p.id}" data-fid="${act}:${p.id}" title="Prototype control: the API does this in the background">${label}</button>`);
  if (p.status === 'DRAFT' && can('periods.calculate')) B('Compute sheets', 'calc-start', 'btn-primary');
  if (p.status === 'CALCULATING') { a.push('<button type="button" class="btn btn-secondary" disabled>Computing…</button>'); P('Finish computing', 'calc-finish'); }
  if (p.status === 'FOR_REVIEW') {
    const b = blockers(p).length;
    if (can('periods.certify')) { B('Certify', 'certify', 'btn-primary', b > 0); if (b) why.push(`${count(b, 'payslip')} blocked`); }
    if (can('periods.return')) B('Return', 'return');
  }
  if (p.status === 'CERTIFIED') {
    [['budget', 'periods.review_funding', 'Budget'], ['accounting', 'periods.review_accounting', 'Accounting']].forEach(([k, perm, label]) => {
      if (can(perm) && !p.reviews[k]) { B(`Confirm ${label} review`, k + '-confirm', 'btn-primary'); B('Return', k + '-return'); }
    });
    if (can('periods.approve')) { const n = reviewCount(p); B('Approve', 'approve', 'btn-primary', n < 2); if (n < 2) why.push(`${n} of 2 reviews recorded`); }
  }
  if (p.status === 'APPROVED' && can('periods.finalize')) { B('Finalize', 'finalize', 'btn-primary'); B('Return', 'return-approved'); }
  if (p.status === 'FINALIZED') {
    const c = slipCounts(p);
    if (c.GENERATING) P(`Finish generating ${count(c.GENERATING, 'payslip')}`, 'jobs-finish');
    if (c.READY && can('payslips.release')) B(`Release ${count(c.READY, 'payslip')}`, 'slip-release-all', 'btn-primary');
    if (!p.export && can('exports.generate')) { B('Generate Payment Export', 'export-generate', S.role === 'cashier' ? 'btn-primary' : ''); if ((p.missingDest || []).length) P('Record the missing destination', 'dest-fix'); }
  }
  return a.join('') + why.map(w => `<span class="cap muted">${esc(w)}</span>`).join('');
}
function runWarnings(p) {
  return openWarnings(p).map(x => `<div class="msg msg-warning" role="status"><strong>Warning.</strong> ${esc(x.title)}. ${can('exceptions.manage') ? `<button type="button" class="linkbtn" data-act="exc-ack" data-id="${x.id}" data-fid="exc-ack:${x.id}">Review and acknowledge</button>` : ''}</div>`).join('');
}
function slipActions(p, e) {
  const a = [], id = p.id + '|' + e, B = (label, act, i, kind) => a.push(`<button type="button" class="btn ${kind || 'btn-secondary'}" data-act="${act}" data-id="${i}" data-fid="${act}:${i}">${label}</button>`);
  const x = excFor(p, e).find(z => z.type === 'NO_PARTIAL_MONTH_RULE' && z.status === 'OPEN');
  if (x && p.status === 'DRAFT' && can('exceptions.manage')) held(p, e) ? B('Lift hold', 'hold-lift', x.id) : B('Place Payroll Hold', 'hold-place', x.id);
  const s = p.payslips[e];
  if (s && s.status === 'READY' && can('payslips.withhold')) B('Withhold', 'slip-withhold', id);
  if (s && s.status === 'WITHHELD' && can('payslips.release')) B('Release', 'slip-release', id);
  const i = instructionOf(p, e);
  if (i && can('disbursement.update')) {
    if (latest(i) === 'REJECTED') B('Supersede instruction', 'supersede', p.id + '|' + i.id);
    else if (latest(i) !== 'SETTLED') B('Record payment outcome', 'outcome', p.id + '|' + i.id, 'btn-primary');
  }
  if (s && (isEmployee() || s.status !== 'GENERATING')) a.push('<button type="button" class="btn btn-secondary" data-act="print" data-fid="print">Print</button>');
  return a.join('');
}

/* ---------- payslip form ---------- */
function workedDays(p, e) {
  if (p.run !== 'REGULAR') return `<p class="sec-label">Worked days</p><p class="small muted">A special run reads no attendance.</p>`;
  const f = factsFor(p.id, e, p.v), paid = 22 - f.lwop - f.deficit, row = (d, c, n, src) => `<tr><th scope="row">${d}</th><td class="code">${c}</td><td class="num">${days(n)}</td><td class="small muted">${esc(src)}</td></tr>`;
  return `<p class="sec-label">Worked days</p>${table('Worked days', 620, ['Description', 'Code', '#Days', 'Source'],
    row('Paid working days', 'WORK100', paid, 'Locked Attendance and posted leave') + (f.lwop ? row('Leave without pay', 'LWOP', f.lwop, f.src.lwop) : '') + (f.deficit ? row('Unpaid tardiness and undertime', 'DEFICIT', f.deficit, f.src.deficit) : ''),
    `<tr><th scope="row" colspan="2">Working days in the month</th><td class="num">22.0</td><td></td></tr>`, 'plain')}`;
}
function otherInputs(p, e) {
  const f = factsFor(p.id, e, p.v), rows = [];
  if (f.ot) rows.push(['Overtime hours', 'OT', f.ot.toFixed(1) + ' h', f.src.ot]);
  if (f.loan && p.run === 'REGULAR') rows.push(['Loan installment', 'LOAN', peso(f.loan), f.src.loan]);
  if (p.kind === 'SUP') rows.push(['Payroll Adjustment', 'ADJ', '+1.000 day', 'ADJ-2026-003 · Leave withdrew PI-0871 after 2026-10-REG consumed it']);
  return `<p class="sec-label">Other inputs</p>${rows.length ? table('Other inputs', 620, ['Description', 'Code', '#Quantity', 'Source'], rows.map(r => `<tr><th scope="row">${r[0]}</th><td class="code">${r[1]}</td><td class="num">${r[2]}</td><td class="small muted">${esc(r[3])}</td></tr>`).join(''), '', 'plain') : '<p class="small muted">None for this payslip.</p>'}`;
}
function computation(p, e) {
  if (!p.v) return surface('Not computed yet.', 'Lines appear when the sheets are computed.');
  if (!hasResult(p, e)) return surface('No lines.', 'This payslip has no computation in this run.');
  const r = result(p, e), cols = 5;
  const line = l => {
    const ru = RULE_BY_LINE[l.c]; if (!ru) return '';
    const open = S.sub === ru.code;
    return `<tr><th scope="row"><button type="button" class="rowbtn" aria-expanded="${open}" data-line="${ru.code}" data-fid="line-${ru.code}">${esc(ru.name)}</button></th><td class="code">${ru.code}</td><td class="nowrap">${esc(l.qty)}</td><td class="nowrap">${esc(l.rate)}</td><td class="num">${peso(l.amount)}</td></tr>` +
      (open ? `<tr class="more"><td colspan="${cols}"><strong>Rule version</strong> ${esc(l.rule)}<br>${l.src.map(s => `<strong>Source</strong> ${esc(s)}`).join('<br>')}</td></tr>` : '');
  };
  const total = (code, n) => `<tr class="strong"><th scope="row">${rule(code).name}</th><td class="code">${code}</td><td></td><td></td><td class="num">${peso(n)}</td></tr>`;
  const of = t => r.lines.filter(l => l.type === t).map(line).join('');
  return table('Salary computation', 600, ['Salary rule', 'Code', 'Quantity', 'Rate', '#Amount'], of('EARNING') + total('GROSS', r.gross) + of('DEDUCTION') + total('NET', r.net) + of('EMPLOYER_SHARE'), '', 'plain');
}
function approvals(p) {
  const cur = p.versions.find(x => x.v === p.v), no = '<span class="muted">Not yet</span>';
  const row = (step, o, extra) => `<tr><th scope="row">${step}</th><td>${o ? esc(o.by) : no}</td><td class="nowrap">${o ? dtt(o.at) : ''}</td><td class="small muted">${o ? extra || '' : ''}</td></tr>`;
  const calc = p.status === 'CALCULATING' ? null : cur && p.status !== 'DRAFT' ? { by: 'System', at: cur.at } : null;
  return table('Approvals', 560, ['Step', 'By', 'When', ''], row('Calculated', calc, `Calculation ${p.v} · ${p.v ? totals(p).hash : ''}`) + row('Certified', p.cert, p.cert ? `Locks calculation ${p.cert.v}` : '') + row('Budget review', p.reviews.budget, 'Confirmed') + row('Accounting review', p.reviews.accounting, 'Confirmed') + row('Approved', p.approval) + row('Finalized', p.final, 'Immutable'), '', 'plain');
}
function slipBanners(p, e) {
  const out = [], h = held(p, e), ex = excFor(p, e).filter(x => x.status === 'OPEN' && x.severity === 'BLOCKING'), s = p.payslips[e];
  if (h) out.push(`<div class="msg msg-info" role="status"><strong>On hold.</strong> No amounts in this run. The month is paid later as a Payroll Adjustment. “${esc(h.reason)}”</div>`);
  else if (p.status !== 'FINALIZED') ex.forEach(x => out.push(`<div class="msg msg-danger" role="status"><strong>Blocked.</strong> ${esc(x.detail)}${x.type === 'CANCELLED_INPUT_USED' ? ' Compute the sheets again to clear it.' : ''}</div>`));
  if (p.status === 'CALCULATING') out.push(`<div class="msg msg-warning" role="status">Computing calculation ${p.v + 1}.${p.v ? ` The amounts below are from calculation ${p.v}.` : ''}</div>`);
  if (p.status === 'DRAFT' && p.v && !out.length) out.push(`<div class="msg msg-info" role="status">Returned for correction. Amounts are from calculation ${p.v} until the sheets are computed again.</div>`);
  if (s && s.status === 'WITHHELD' && !isEmployee()) out.push(`<div class="msg msg-warning" role="status"><strong>Withheld from the Employee.</strong> “${esc(s.reason)}” Payment isn’t affected.</div>`);
  return out.join('');
}
// o: { crumbs, list, mk, runActions: bool, approvals: bool, runLink: go-object | null }
function slipForm(x, o) {
  const { p, e } = x, em = EMP[e], r = p.v && hasResult(p, e) ? result(p, e) : null, s = p.payslips[e], i = instructionOf(p, e);
  const TABS = ['days', 'calc', ...(o.approvals && !isEmployee() ? ['approvals'] : [])], tab = TABS.includes(S.tab) ? S.tab : 'days';
  const acts = (o.runActions && !isEmployee() ? runActions(p) : '') + slipActions(p, e);
  const st = structOf(p), money = n => r ? peso(n) : '<span class="muted">—</span>';
  const body = tab === 'calc' ? computation(p, e) : tab === 'approvals' ? approvals(p) : workedDays(p, e) + otherInputs(p, e);
  return `<div class="cp">${crumbs(o.crumbs)}${pager(o.list, x.id, o.mk)}</div>
    <div class="ab"><div class="actions">${acts}</div>${isEmployee() ? tag(['Released', 'success']) : statusbar(p)}</div>
    ${S.flashHtml || ''}${o.runActions && !isEmployee() ? runWarnings(p) : ''}${slipBanners(p, e)}
    <div class="formwrap"><section class="panel sheet" aria-label="Payslip">
      <div class="sheet-title"><span>Employee</span><h2>${esc(em.name)}</h2></div>
      ${fields([['Period', range(p.from, p.to)], ['Gross pay', money(r && r.gross)], ['Payroll run', o.runLink ? openLink(p.name, o.runLink, 'run-link') : esc(p.name)], ['Deductions', money(r && r.ded)],
        ['Position', `${esc(em.pos)} · SG ${em.sg} Step ${em.step}`], ['Net pay', money(r && r.net), true], ['Structure', isEmployee() ? esc(st.name) : openLink(st.name, { dest: 'structures', view: 'form', record: st.id }, 'struct-link')], ['Payment date', dt(p.pay)],
        ['Reference', slipRef(p, e)], s && !isEmployee() ? ['Payslip', tag(SLIP_STATUS[s.status])] : null, i && !isEmployee() ? ['Payment', tag(OUTCOME[latest(i)], latest(i) === 'NONE') + (i.outcomes.length ? ` <span class="cap muted">${esc(i.outcomes[i.outcomes.length - 1].ref || '')}</span>` : '')] : null])}
      ${tabs(TABS, tab, { days: 'Worked Days & Inputs', calc: 'Salary Computation', approvals: 'Approvals' })}
      <div id="tabpanel" role="tabpanel" aria-labelledby="tab-${tab}" class="sec">${body}</div>
      ${isEmployee() ? '<p class="cap muted">This payslip states what was computed. Payment is recorded separately.</p>' : ''}</section>
      ${isEmployee() ? '' : historyPanel(p)}</div>`;
}

/* ---------- Salary Rules, Salary Structures, Reports ---------- */
function rulesPage() {
  if (S.view === 'form') {
    const r = rule(S.record) || RULES[0], tab = S.tab === 'version' ? 'version' : 'general', list = RULES.map(x => ({ id: x.code }));
    return `<div class="cp">${crumbs([['Salary Rules', { dest: 'rules', view: 'tree', record: '' }], [r.name]])}${pager(list, r.code, x => ({ dest: 'rules', view: 'form', record: x.id }))}</div>
      <div class="ab"><div class="actions"><span class="cap muted">Loaded by the platform operator. Read-only for the Agency.</span></div></div>
      <section class="panel sheet" aria-label="Salary rule"><div class="sheet-title"><span>Salary rule name</span><h2>${esc(r.name)}</h2></div>
      ${fields([['Category', r.cat], ['Code', `<span class="code">${r.code}</span>`], ['Sequence', r.seq], ['Appears on payslip', 'Yes'], ['Used in', STRUCTS.filter(s => s.rules.includes(r.code)).map(s => openLink(s.name, { dest: 'structures', view: 'form', record: s.id }, 'used-' + s.id)).join(', ')]])}
      ${tabs(['general', 'version'], tab, { general: 'General', version: 'Rule version' })}
      <div id="tabpanel" role="tabpanel" aria-labelledby="tab-${tab}" class="sec">${tab === 'general'
        ? `<p class="sec-label">Conditions</p>${fields([['Applies when', esc(r.cond)]])}<p class="sec-label">Computation</p>${fields([['Amount type', r.type]])}<div class="calc">result = ${esc(r.calc)}</div>`
        : fields([['Rule version', esc(r.version)], ['Effective', r.version === '—' || r.version === 'No rule version' ? '—' : '1 Jan 2026 – 31 Dec 2026'], ['Authority', r.version === '—' ? 'Derived from the lines above it' : r.version === 'No rule version' ? 'The lender’s billing' : 'Linked issuance (sample)'], ['Loaded', r.version.startsWith('No') || r.version === '—' ? '—' : 'Platform operator · 5 Jan 2026']])}</div></section>`;
  }
  const rows = RULES.filter(r => !S.q || (r.name + ' ' + r.code + ' ' + r.cat).toLowerCase().includes(S.q.toLowerCase())).map(r => `<tr><th scope="row">${openLink(r.name, { dest: 'rules', view: 'form', record: r.code }, 'rule-' + r.code)}</th><td class="code">${r.code}</td><td>${r.cat}</td><td class="num">${r.seq}</td><td class="small muted">${esc(r.version)}</td></tr>`).join('');
  return `<div class="cp">${crumbs([['Salary Rules']])}<span class="cap muted">1–${RULES.length} / ${RULES.length}</span></div>
    <section class="panel" aria-label="Salary rules">${slipFilters().replace('Employee or reference', 'Rule, code, or category')}${table('Salary rules', 760, ['Salary rule name', 'Code', 'Category', '#Sequence', 'Rule version'], rows)}</section>`;
}
function structuresPage() {
  if (S.view === 'form') {
    const s = STRUCTS.find(x => x.id === S.record) || STRUCTS[0];
    return `<div class="cp">${crumbs([['Salary Structures', { dest: 'structures', view: 'tree', record: '' }], [s.name]])}${pager(STRUCTS, s.id, x => ({ dest: 'structures', view: 'form', record: x.id }))}</div>
      <section class="panel sheet" aria-label="Salary structure">${fields([['Name', esc(s.name)], ['Reference', `<span class="code">${s.id}</span>`], ['Used by', esc(s.used)]])}
      ${tabs(['rules'], 'rules', { rules: 'Salary Rules' })}
      <div id="tabpanel" role="tabpanel" aria-labelledby="tab-rules" class="sec">${table('Salary rules of this structure', 620, ['Salary rule name', 'Code', 'Category', '#Sequence'], s.rules.map(c => rule(c)).map(r => `<tr><th scope="row">${openLink(r.name, { dest: 'rules', view: 'form', record: r.code }, 'srule-' + r.code)}</th><td class="code">${r.code}</td><td>${r.cat}</td><td class="num">${r.seq}</td></tr>`).join(''), '', 'plain')}</div></section>`;
  }
  return `<div class="cp">${crumbs([['Salary Structures']])}<span class="cap muted">1–${STRUCTS.length} / ${STRUCTS.length}</span></div>
    <section class="panel" aria-label="Salary structures">${table('Salary structures', 620, ['Name', 'Reference', 'Used by', '#Rules'], STRUCTS.map(s => `<tr><th scope="row">${openLink(s.name, { dest: 'structures', view: 'form', record: s.id }, 'struct-' + s.id)}</th><td class="code">${s.id}</td><td>${esc(s.used)}</td><td class="num">${s.rules.length}</td></tr>`).join(''))}</section>`;
}
function runPicker() { return `<select data-filter="pf" data-fid="filter-pf" aria-label="Payroll run">${D.periods.map(p => `<option value="${p.id}" ${S.pf === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`; }
function currentRun() { if (!period(S.pf)) S.pf = D.periods[0].id; return period(S.pf); }
function reportsPage() {
  const p = currentRun(), fin = p.status === 'FINALIZED', rows = [];
  const row = (name, st, o, act) => rows.push(`<tr><th scope="row">${name}</th><td>${tag(OUTPUT_STATUS[st], st === 'NONE')}</td><td class="small">${o ? `${esc(o.by)} · ${dtt(o.at)}` : '<span class="muted">—</span>'}</td><td>${act || ''}</td></tr>`);
  const B = (label, act, id) => `<button type="button" class="btn btn-secondary btn-sm" data-act="${act}" data-id="${esc(id)}" data-fid="${act}:${esc(id)}">${label}</button>`;
  if (p.cpre) row('Certified Payroll Review Export', p.cpre.superseded || p.status === 'VOIDED' ? 'SUPERSEDED' : 'READY', { by: p.cert ? p.cert.by : 'System', at: p.cpre.at }, p.cpre.superseded ? '' : B('Download', 'download', p.cpre.id));
  if (fin) {
    Object.entries(OUTPUTS).forEach(([k, label]) => { const o = p.outputs[k], st = o ? o.status : 'NONE'; row(label, st, o, st === 'READY' ? B('Download', 'download', label) : st === 'NONE' && can('outputs.generate') ? B('Generate', 'output-generate', p.id + '|' + k) : ''); });
    const live = liveInstructions(p);
    rows.push(`<tr><th scope="row">Payment Export</th><td>${p.export ? tag(OUTPUT_STATUS.READY) : tag(OUTPUT_STATUS.NONE, true)}</td><td class="small">${p.export ? `${esc(p.export.by)} · ${dtt(p.export.at)} · ${live.filter(i => latest(i) === 'SETTLED').length} of ${live.length} settled` : '<span class="muted">—</span>'}</td><td>${p.export ? B('Download', 'download', p.export.id) : can('exports.generate') ? B('Generate', 'export-generate', p.id) : ''}</td></tr>`);
  }
  const gen = Object.values(p.outputs).some(o => o.status === 'GENERATING');
  return `<div class="cp">${crumbs([['Reports']])}</div>
    <section class="panel" aria-label="Reports"><div class="pbar"><div class="pick">${runPicker()}${tag(STAGE_TAG[stageOf(p)])}</div>${gen ? `<button type="button" class="proto-inline" data-act="jobs-finish" data-id="${p.id}" data-fid="jobs-finish:${p.id}">Finish generating</button>` : ''}</div>
    ${rows.length ? table('Reports', 640, ['Report', 'Status', 'Generated', ''], rows.join('')) : surface('No reports yet.', 'The register and schedules come from a finalized run.')}
    ${!fin && rows.length ? '<p class="cap muted" style="padding:10px 16px">The register and schedules come from a finalized run.</p>' : ''}</section>`;
}

/* ---------- shell ---------- */
const VARIANTS = [['a', 'A', 'Payslips only'], ['b', 'B', 'Payslips and runs'], ['c', 'C', 'Month bar']];
const DESTS = { payslips: ['Employee Payslips', 'periods.read'], runs: ['Payroll Runs', 'periods.read'], reports: ['Reports', 'outputs.read'], structures: ['Salary Structures', 'periods.read'], rules: ['Salary Rules', 'periods.read'] };
function render() {
  const fid = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.fid : null;
  const allowed = isEmployee() ? ['payslips'] : V.nav;
  if (!allowed.includes(S.dest)) { if (S.dest) { S.view = 'tree'; S.record = ''; } S.dest = 'payslips'; }
  S.flashHtml = S.flash ? `<div class="msg msg-${S.flash.tone}" role="status" tabindex="-1" data-fid="flash">${esc(S.flash.text.replace(' is For review', ' is Calculated'))}</div>` : '';
  const r = me(), link = d => `<li><a class="nav-link" href="${urlFor({ dest: d, view: 'tree', record: '', tab: '', sub: '' })}" data-nav="${d}" data-fid="nav-${d}" ${d === S.dest ? 'aria-current="page"' : ''}>${isEmployee() ? 'My Payslips' : DESTS[d][0]}</a></li>`;
  const main = allowed.filter(d => !['structures', 'rules'].includes(d)), conf = allowed.filter(d => ['structures', 'rules'].includes(d));
  const pageHtml = S.sample === 'loading' ? surface('Loading…', 'Records appear when the API answers.') : S.sample === 'denied' ? surface('Not available to you.', 'Your role doesn’t include this page.') : { payslips: () => V.payslips(), runs: () => V.runs(), reports: reportsPage, structures: structuresPage, rules: rulesPage }[S.dest]();
  document.title = `${isEmployee() ? 'My Payslips' : DESTS[S.dest][0]} · ${V.letter} ${V.name} · Payroll prototype round 2`;
  document.getElementById('app').innerHTML = `<div class="shell">
  <aside class="nav" ${S.navOpen ? 'data-open' : ''}>
    <div class="nav-brand"><span class="nav-mark" aria-hidden="true">L</span><span>LingkodHR</span><button type="button" class="nav-toggle" data-act="nav" aria-expanded="${S.navOpen}" aria-controls="primary-navigation" data-fid="nav-toggle">${S.navOpen ? 'Close' : 'Menu'}</button></div>
    <div class="nav-agency"><span>Agency context</span><strong>${AGENCY}</strong></div>
    <nav id="primary-navigation" class="nav-list" aria-label="Primary">
      ${['Structure', 'Merit selection', 'Personnel', 'Time & attendance', 'Leave', 'Overtime'].map(s => `<div class="nav-stage">${s}</div>`).join('')}
      <div class="nav-stage on" id="stage-payroll">Payroll</div>
      <ul aria-labelledby="stage-payroll">${main.map(link).join('')}${conf.length ? `<li class="nav-sub">Configuration</li>${conf.map(link).join('')}` : ''}</ul>
      <div class="nav-stage">Oversight</div>
    </nav>
    <div class="nav-user"><span class="avatar" aria-hidden="true">${r.person.split(' ').map(w => w[0]).slice(0, 2).join('')}</span><span class="who"><strong>${esc(r.person)}</strong><span>${esc(r.label)}</span></span></div>
  </aside>
  <main id="main">${S.dest === 'payslips' && S.view === 'form' ? '' : S.flashHtml}${pageHtml}${controls()}</main></div>
  <nav class="switcher" aria-label="Prototype variants"><span>#327 · round 2</span>${VARIANTS.map(([k, l, n]) => `<a href="${k}.html?role=${S.role}" title="${l} · ${n}" aria-label="Variant ${l}, ${n}" ${k === V.key ? 'aria-current="page"' : ''}>${l}</a>`).join('')}<a href="compare.html" title="Comparison page">Compare</a></nav>`;
  const want = S.focus || fid; S.focus = null;
  const el = want && [...document.querySelectorAll('[data-fid]')].find(x => x.dataset.fid === want);
  if (el) { el.focus({ preventScroll: want !== 'flash' }); if (el.type === 'search') el.setSelectionRange(el.value.length, el.value.length); }
}
function controls() {
  const stages = [['DRAFT', 'Draft, returned'], ['CALCULATING', 'Computing'], ['FOR_REVIEW', 'Calculated'], ['CERTIFIED', 'Certified'], ['REVIEWED', 'Reviewed'], ['APPROVED', 'Approved'], ['FINALIZED', 'Finalized, payslips generating'], ['RELEASED', 'Finalized, released, export generated']];
  return `<details class="proto"><summary>Prototype controls</summary><div class="grid">
    <label class="field">Preview role<select class="input" data-role data-fid="role">${Object.entries(ROLES).map(([k, r]) => `<option value="${k}" ${k === S.role ? 'selected' : ''}>${esc(r.label)} · ${esc(r.person)}</option>`).join('')}</select></label>
    <label class="field" style="width:300px">Jump the November run to<select class="input" data-jump data-fid="jump">${stages.map(([k, l]) => `<option value="${k}" ${k === D.stage ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="field">Sample state<select class="input" data-samplesel data-fid="sample">${[['live', 'Live sample data'], ['empty', 'Empty'], ['loading', 'Loading'], ['denied', 'Permission denied']].map(([k, l]) => `<option value="${k}" ${k === S.sample ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <button type="button" class="btn btn-secondary" data-act="reset" data-fid="reset">Reset sample data</button></div>
    <p class="cap muted" style="margin-top:8px">Synthetic data. Today is ${dt(TODAY)}. Every name, amount, rule, and formula is made up.</p></details>`;
}

/* ---------- dialogs and events ---------- */
let ASK = null;
function ask(o) {
  ASK = o;
  const d = document.getElementById('dlg');
  d.innerHTML = `<form class="dlg" method="dialog" data-ask><div class="dlg-head"><h2 id="dlg-title">${esc(o.title)}</h2><p id="dlg-desc" class="small muted">${o.desc || ''}</p></div>
    ${o.fields || o.label ? `<div class="dlg-body">${o.fields || ''}${o.label ? `<label class="field">${esc(o.label)}<textarea class="input" name="reason" required></textarea></label>` : ''}</div>` : ''}
    <div class="dlg-foot"><button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="submit" class="btn ${o.danger ? 'btn-solid-danger' : 'btn-primary'}">${esc(o.confirm)}</button></div></form>`;
  d.showModal();
}
const all = p => `all ${count(p.emps.length, 'payslip')} of ${p.name}`;
const back = (title, fn) => id => ask({ title, desc: 'The run goes back for correction, and its certification and reviews no longer stand.', label: 'Reason', confirm: 'Return', danger: true, onOk: r => fn(period(id), r) });
const HANDLERS = {
  nav() { S.navOpen = !S.navOpen; },
  reset() { try { sessionStorage.removeItem(STORE); } catch (e) { /* ignore */ } D = seedData(); flash('Sample data reset.'); },
  print() { window.print(); },
  download(id) { flash(`Prototype: “${id}” would download.`, 'info'); },
  'period-new'() { const open = D.periods.find(p => p.run === 'REGULAR' && !['FINALIZED', 'VOIDED'].includes(p.status)); flash(open ? `${open.name} isn’t finalized yet. An Agency has one open regular run at a time.` : 'Prototype: creating the next run isn’t part of this round.', open ? 'danger' : 'info'); },
  'calc-start'(id) { const p = period(id); ask({ title: 'Compute sheets?', desc: `Computes ${all(p)} from the inputs accepted by the cutoff, ${dtt(p.cutoff)}.`, confirm: 'Compute sheets', onOk: () => ACT.calcStart(p) }); },
  'calc-finish'(id) { ACT.calcFinish(period(id)); },
  'jobs-finish'(id) { ACT.jobsFinish(period(id)); },
  return: back('Return for correction', (p, r) => ACT.returnForCorrection(p, r)),
  certify(id) { const p = period(id); ask({ title: 'Certify?', desc: `You certify the personnel, attendance, and leave inputs of ${all(p)}. Net ${peso(totals(p).net)}.`, confirm: 'Certify', onOk: () => ACT.certify(p) }); },
  revoke: back('Revoke certification', (p, r) => ACT.revoke(p, r)),
  'budget-confirm'(id) { const p = period(id); ask({ title: 'Confirm the Budget review?', desc: `Covers ${all(p)}. Net ${peso(totals(p).net)}. It can’t be changed afterwards.`, confirm: 'Confirm', onOk: () => ACT.review(p, 'budget', 'CONFIRMED', '') }); },
  'accounting-confirm'(id) { const p = period(id); ask({ title: 'Confirm the Accounting review?', desc: `Covers ${all(p)}. Net ${peso(totals(p).net)}. It can’t be changed afterwards.`, confirm: 'Confirm', onOk: () => ACT.review(p, 'accounting', 'CONFIRMED', '') }); },
  'budget-return': back('Return from Budget review', (p, r) => ACT.review(p, 'budget', 'RETURNED', r)),
  'accounting-return': back('Return from Accounting review', (p, r) => ACT.review(p, 'accounting', 'RETURNED', r)),
  approve(id) { const p = period(id); ask({ title: 'Approve?', desc: `Approves ${all(p)}. Net ${peso(totals(p).net)}. Approving doesn’t finalize.`, confirm: 'Approve', onOk: () => ACT.approve(p) }); },
  'return-approved': back('Return before finalization', (p, r) => ACT.returnApproved(p, r)),
  finalize(id) { const p = period(id); ask({ title: 'Finalize?', desc: `Finalizes ${all(p)}. After this, no line can change and a correction is a later record.`, confirm: 'Finalize', onOk: () => ACT.finalize(p) }); },
  'slip-release-all'(id) { const p = period(id); ask({ title: `Release ${count(slipCounts(p).READY, 'payslip')}?`, desc: 'Each Employee can then read their own payslip. Release is separate from payment.', confirm: 'Release', onOk: () => ACT.releaseAll(p) }); },
  'slip-withhold'(id) { const [pid, e] = id.split('|'); ask({ title: `Withhold ${EMP[e].name}’s payslip`, desc: 'The Employee can’t read it until it is released. Payment isn’t affected.', label: 'Reason', confirm: 'Withhold', danger: true, onOk: r => ACT.withhold(period(pid), e, r) }); },
  'slip-release'(id) { const [pid, e] = id.split('|'); ACT.releaseOne(period(pid), e); },
  'dest-fix'(id) { ACT.destFix(period(id)); },
  'export-generate'(id) { ACT.exportGenerate(period(id)); },
  outcome(id) {
    const [pid, iid] = id.split('|'), p = period(pid), i = p.export.instructions.find(x => x.id === iid), next = { NONE: ['SUBMITTED'], SUBMITTED: ['ACCEPTED', 'REJECTED'], ACCEPTED: ['SETTLED', 'REJECTED'] }[latest(i)] || [];
    ask({ title: 'Record payment outcome', desc: `${esc(EMP[i.emp].name)} · ${peso(result(p, i.emp).net)}`, fields: `<label class="field">Outcome<select class="input" name="status">${next.map(s => `<option value="${s}">${OUTCOME[s][0]}</option>`).join('')}</select></label><label class="field">Evidence reference<input class="input" name="ref" required></label>`, confirm: 'Record', onOk: (r, f) => ACT.outcome(p, iid, f.get('status'), f.get('ref'), '') });
  },
  supersede(id) { const [pid, iid] = id.split('|'); ask({ title: 'Supersede the rejected instruction?', desc: 'A new Payment Instruction replaces it. The rejected one stays on record.', confirm: 'Supersede', onOk: () => ACT.supersede(period(pid), iid) }); },
  'output-generate'(id) { const [pid, k] = id.split('|'); ACT.outputGenerate(period(pid), k); },
  'exc-ack'(id) { const x = D.exceptions.find(e => e.id === id); ask({ title: 'Acknowledge this warning', desc: esc(x.detail), label: 'Reason', confirm: 'Acknowledge', onOk: r => ACT.ack(x, r) }); },
  'hold-place'(id) { const x = D.exceptions.find(e => e.id === id); ask({ title: `Place a Payroll Hold on ${EMP[x.emp].name}`, desc: 'This payslip is left out so the rest of the run can go on. The month is paid later as a Payroll Adjustment.', label: 'Reason', confirm: 'Place hold', onOk: r => ACT.hold(x, r) }); },
  'hold-lift'(id) { ACT.liftHold(D.exceptions.find(e => e.id === id)); },
};
document.addEventListener('click', e => {
  const t = e.target.closest('[data-close],[data-go],[data-act],[data-tab],[data-view],[data-nav],[data-line],[data-group]');
  if (!t) return;
  if (t.dataset.close !== undefined) return document.getElementById('dlg').close();
  S.flash = null;
  if (t.dataset.go) return go(JSON.parse(t.dataset.go));
  if (t.dataset.nav) { e.preventDefault(); S.navOpen = false; return go({ dest: t.dataset.nav, view: 'tree', record: '' }); }
  if (t.dataset.tab) return go({ tab: t.dataset.tab }, true);
  if (t.dataset.line) return go({ tab: S.tab, sub: S.sub === t.dataset.line ? '' : t.dataset.line }, true);
  if (t.dataset.view) return go({ view: t.dataset.view, record: '' });
  if (t.dataset.group) { S.groups[t.dataset.group] = !groupOpen(period(t.dataset.group)); return render(); }
  HANDLERS[t.dataset.act](t.dataset.id);
  save(); render();
});
document.addEventListener('submit', e => {
  if (!e.target.matches('[data-ask]')) return;
  e.preventDefault();
  const f = new FormData(e.target), o = ASK;
  document.getElementById('dlg').close();
  S.flash = null;
  o.onOk((f.get('reason') || '').trim(), f);
  save(); render();
});
document.addEventListener('input', e => { const t = e.target; if (t.dataset.filter && t.type === 'search') { S[t.dataset.filter] = t.value; render(); } });
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.filter && t.type !== 'search') { S[t.dataset.filter] = t.value; S.flash = null; go({}, true); }
  else if (t.dataset.role !== undefined) { S.role = t.value; S.flash = null; go({ dest: 'payslips', view: 'tree', record: '' }); }
  else if (t.dataset.jump !== undefined) { jumpTo(t.value); render(); }
  else if (t.dataset.samplesel !== undefined) { S.sample = t.value; go({}, true); }
});
document.addEventListener('keydown', e => {
  if (!e.target.matches('[role=tab]') || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  const tabsEl = [...e.target.parentElement.children], n = tabsEl[(tabsEl.indexOf(e.target) + (e.key === 'ArrowRight' ? 1 : tabsEl.length - 1)) % tabsEl.length];
  S.focus = n.dataset.fid; go({ tab: n.dataset.tab }, true);
});
window.addEventListener('popstate', () => { readUrl(); render(); });
(function init() {
  load();
  const q = readUrl();
  if (q.has('stage')) jumpTo(q.get('stage'));
  S._lastDest = S.dest;
  render();
})();
