/* ---------- state ---------- */
let D;
const S = { role: 'preparer', dest: '', view: 'tree', record: '', tab: '', sub: '', sample: 'live', q: '', status: 'ALL', pf: 'ALL', ver: 0, navOpen: false, flash: null, focus: null };
const URL_KEYS = ['role', 'dest', 'view', 'record', 'tab', 'sub', 'sample', 'pf'];
const URL_DEFAULT = { view: 'tree', sample: 'live', pf: 'ALL' };

function load() {
  try { D = JSON.parse(sessionStorage.getItem(STORE)); } catch (e) { D = null; }
  if (!D) D = seedData();
}
function save() { try { sessionStorage.setItem(STORE, JSON.stringify(D)); } catch (e) { /* storage is optional */ } }
function readUrl() {
  const q = new URLSearchParams(location.search);
  URL_KEYS.forEach(k => { if (q.has(k)) S[k] = q.get(k); else if (k !== 'role') S[k] = URL_DEFAULT[k] || ''; });
  if (!ROLES[S.role]) S.role = 'preparer';
  return q;
}
function urlFor(o) {
  const n = Object.assign({}, S, o), q = new URLSearchParams();
  URL_KEYS.forEach(k => { if (n[k] && n[k] !== URL_DEFAULT[k]) q.set(k, n[k]); });
  return location.pathname + '?' + q.toString();
}
function go(o, replace) {
  Object.assign(S, { sub: '', tab: '', ver: 0 }, o);
  if (o.dest && o.dest !== S._lastDest) { S.q = ''; S.status = 'ALL'; }
  S._lastDest = S.dest;
  history[replace ? 'replaceState' : 'pushState'](null, '', urlFor({}));
  render();
  if (!replace) window.scrollTo(0, 0);
}

/* ---------- helpers ---------- */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const sum = (list, fn) => r2(list.reduce((t, x) => t + fn(x), 0));
const peso = n => (n < 0 ? '−' : '') + '₱' + Math.abs(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dt = d => d ? `${+d.slice(8, 10)} ${MONTHS[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}` : '—';
const dtt = d => d ? dt(d) + (d.length > 10 ? ', ' + d.slice(11, 16) : '') : '—';
const range = (a, b) => a.slice(0, 7) === b.slice(0, 7) ? `${+a.slice(8)}–${+b.slice(8)} ${MONTHS[+b.slice(5, 7) - 1]} ${b.slice(0, 4)}` : dt(a) + ' – ' + dt(b);
const days = n => n.toFixed(3).replace(/0{1,2}$/, '');
const count = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');
const tag = ([label, tone], dashed) => `<span class="tag tag-${tone}"${dashed ? ' style="border-style:dashed"' : ''}>${esc(label)}</span>`;
let can = perm => ROLES[S.role].can.includes(perm);
const me = () => ROLES[S.role];
const period = id => D.periods.find(p => p.id === id);
const isEmployee = () => S.role === 'employee';
function now() { D.clock = (D.clock || 0) + 7; const m = 9 * 60 + D.clock; return `${TODAY} ${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }
function fakeHash(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } const x = (h >>> 0).toString(16).padStart(8, '0'); return x.slice(0, 4) + '…' + x.slice(4); }
function log(p, what, note, who) { p.history.push({ what, who: who || me().person, role: who ? '' : me().label, at: now(), note: note || '' }); }
function flash(text, tone) { S.flash = { text, tone: tone || 'success' }; S.focus = 'flash'; }

/* ---------- calculation (synthetic; the real calculators live in the API) ---------- */
function taxOn(t) {
  if (t <= 20833) return 0;
  if (t <= 33332) return (t - 20833) * 0.15;
  if (t <= 66666) return 1875 + (t - 33333) * 0.2;
  if (t <= 166666) return 8541.8 + (t - 66667) * 0.25;
  return 33541.8 + (t - 166667) * 0.3;
}
function excFor(p, emp) { return D.exceptions.filter(x => x.period === p.id && x.emp === emp); }
function held(p, emp) { return p.holds.find(h => h.emp === emp && !h.lifted); }
function hasResult(p, emp) { return !held(p, emp) && !excFor(p, emp).some(x => x.type === 'NO_PARTIAL_MONTH_RULE' && x.status === 'OPEN'); }
function result(p, emp, v) {
  v = v || p.v;
  const e = EMP[emp], f = factsFor(p.id, emp, v), lines = [];
  const basis = `Compensation basis · Service Segment ${e.seg} · SG ${e.sg} Step ${e.step} · Appointment ${e.appt} (Personnel)`;
  const add = (c, type, qty, rate, amount, rule, src, how) => lines.push({ c, type, qty, rate, amount: r2(amount), rule, src: src.filter(Boolean), how });
  if (p.kind === 'YEB') {
    add('Year-end bonus', 'EARNING', '1 month', peso(e.monthly) + ' a month', e.monthly, RULE.YEB, [basis], 'One month of your basic salary.');
    add('Cash gift', 'EARNING', '1', peso(5000), 5000, RULE.CG, ['Applies by effectivity. No input.'], 'A fixed amount for every covered Employee.');
    add('Withholding tax', 'DEDUCTION', 'Taxable ' + peso(0), 'Table', 0, RULE.TAX, ['Year-to-date snapshot taken with calculation ' + v], 'No tax is withheld on these lines in this sample.');
  } else if (p.kind === 'SUP') {
    const diff = r2(e.monthly / 22);
    add('Basic salary · adjustment for October 2026', 'EARNING', '+1.000 day', peso(e.monthly) + ' a month ÷ 22', diff, RULE.SAL,
      ['Payroll Adjustment ADJ-2026-003 · open until this payroll is finalized', 'Cause: source correction. Leave withdrew PI-0871 (leave without pay, 14 Oct) after 2026-10-REG consumed it', `Recalculated ${peso(e.monthly)} − original ${peso(r2(e.monthly * 21 / 22))}`],
      'A day of leave without pay on 14 Oct was corrected after the October payroll was finalized. This pays the difference.');
    add('Tax and contributions on the difference', 'INFORMATIONAL', '—', '—', 0, '—', ['Not decided yet (#348, #350, #632). Shown as zero.'], '');
  } else {
    const unpaid = f.lwop + f.deficit, paid = 22 - unpaid, basic = r2(e.monthly * paid / 22);
    add('Basic salary', 'EARNING', days(paid) + ' of 22 days', peso(e.monthly) + ' a month', basic, RULE.SAL, [basis, f.src.lwop, f.src.deficit],
      unpaid ? `(22 − ${days(unpaid)} unpaid ${unpaid === 1 ? 'day' : 'days'}) ÷ 22 × ${peso(e.monthly)}.` : `Your monthly salary rate for SG ${e.sg} Step ${e.step}.`);
    add('PERA', 'EARNING', '1 month', peso(2000), 2000, RULE.PERA, ['Applies by effectivity to every covered Employee. No input.'], 'A fixed monthly amount.');
    let ot = 0;
    if (f.ot) {
      const hr = r2(e.monthly / 22 / 8 * 1.25); ot = r2(hr * f.ot);
      add('Overtime pay', 'EARNING', f.ot.toFixed(1) + ' h', peso(hr) + ' an hour', ot, RULE.OT, [f.src.ot, 'Hourly rate: monthly ÷ 22 ÷ 8 × 125%'], `${f.ot.toFixed(1)} certified hours × ${peso(hr)}.`);
    }
    const gsis = r2(e.monthly * 0.09), phic = r2(e.monthly * 0.025), hdmf = 200;
    const taxable = r2(basic + ot - gsis - phic - hdmf), tax = r2(taxOn(taxable)), m = +p.from.slice(5, 7) - 1;
    add('GSIS premium, personal share', 'DEDUCTION', '9% of ' + peso(e.monthly), '9%', gsis, RULE.GSIS, [basis], '9% of your monthly salary.');
    add('PhilHealth premium, personal share', 'DEDUCTION', '2.5% of ' + peso(e.monthly), '2.5%', phic, RULE.PHIC, [basis], 'Half of the 5% premium.');
    add('Pag-IBIG contribution, personal share', 'DEDUCTION', '1 month', peso(200), hdmf, RULE.HDMF, ['Applies by effectivity. No input.'], 'A fixed monthly amount.');
    add('Withholding tax', 'DEDUCTION', 'Taxable ' + peso(taxable), 'Table', tax, RULE.TAX, [`Year-to-date snapshot before this payroll: taxable ${peso(r2(taxable * m))}, withheld ${peso(r2(tax * m))}`],
      `Taxable pay of ${peso(taxable)} after contributions.`);
    if (f.loan) add('GSIS consolidated loan', 'DEDUCTION', '1 installment', peso(f.loan), f.loan, 'No rule version: an issuer-validated obligation', [f.src.loan], 'The installment your lender billed for this month.');
    add('GSIS premium, government share', 'EMPLOYER_SHARE', '12% of ' + peso(e.monthly), '12%', e.monthly * 0.12, RULE.GSIS, [basis], '');
    add('PhilHealth premium, government share', 'EMPLOYER_SHARE', '2.5% of ' + peso(e.monthly), '2.5%', phic, RULE.PHIC, [basis], '');
    add('Pag-IBIG contribution, government share', 'EMPLOYER_SHARE', '1 month', peso(200), 200, RULE.HDMF, ['Applies by effectivity. No input.'], '');
    add('Employees’ Compensation', 'EMPLOYER_SHARE', '1 month', peso(100), 100, RULE.EC, ['Employer-only. No personal share.'], '');
  }
  const of = t => sum(lines.filter(l => l.type === t), l => l.amount);
  const gross = of('EARNING'), ded = of('DEDUCTION');
  let status = 'CALCULATED';
  if (p.status === 'VOIDED') status = 'VOIDED';
  else if (p.status === 'FINALIZED') status = 'FINALIZED';
  else if (v === p.v && excFor(p, emp).some(x => x.severity === 'BLOCKING' && x.status === 'OPEN')) status = 'EXCEPTION';
  return { emp, v, lines, gross, ded, net: r2(gross - ded), employer: of('EMPLOYER_SHARE'), status, hash: fakeHash(p.id + emp + v + gross + ded) };
}
function results(p, v) { return p.v ? p.emps.filter(e => hasResult(p, e)).map(e => result(p, e, v)) : []; }
function totals(p, v) {
  const rs = results(p, v);
  return { n: rs.length, gross: sum(rs, r => r.gross), ded: sum(rs, r => r.ded), net: sum(rs, r => r.net), employer: sum(rs, r => r.employer), hash: fakeHash(p.id + (v || p.v) + rs.map(r => r.hash).join('')) };
}
function exceptionsOf(p) { return D.exceptions.filter(x => x.period === p.id); }
function blockers(p) { return exceptionsOf(p).filter(x => x.severity === 'BLOCKING' && x.status === 'OPEN'); }
function openWarnings(p) { return exceptionsOf(p).filter(x => x.severity === 'WARNING' && x.status === 'OPEN'); }
function latest(i) { return i.outcomes.length ? i.outcomes[i.outcomes.length - 1].status : 'NONE'; }
function slipCounts(p) { const c = { GENERATING: 0, READY: 0, RELEASED: 0, WITHHELD: 0, SUPERSEDED: 0 }; Object.values(p.payslips).forEach(s => c[s.status]++); return c; }
function liveInstructions(p) { return p.export ? p.export.instructions.filter(i => !i.supersededBy) : []; }

// Who holds the pending action. Returns [text, tone]. A state that isn't finished never gets the success tone.
function pendingWith(p) {
  const b = blockers(p).length;
  switch (p.status) {
    case 'DRAFT': return p.v ? [`Payroll Preparer: recalculate${b ? ' · ' + count(b, 'blocking exception') + ' open' : ''}`, 'warning'] : ['Payroll Preparer: start calculation', 'warning'];
    case 'CALCULATING': return [`System: calculation ${p.v + 1} running, no results yet`, 'warning'];
    case 'FOR_REVIEW': return b ? [`Blocked: ${count(b, 'blocking exception')} open`, 'danger'] : ['HR Certifying Officer: certify', 'warning'];
    case 'CERTIFIED': {
      const need = [!p.reviews.budget && 'Budget', !p.reviews.accounting && 'Accounting'].filter(Boolean);
      return need.length ? [need.join(' and ') + (need.length > 1 ? ' reviews' : ' review') + ' not recorded', 'warning'] : ['Payroll Approver: approve', 'warning'];
    }
    case 'APPROVED': return ['Payroll Approver: finalize', 'warning'];
    case 'VOIDED': return [p.replacedBy ? 'Replaced by ' + p.replacedBy : 'No replacement', 'muted'];
    default: {
      const c = slipCounts(p), todo = [];
      if (c.GENERATING) todo.push(count(c.GENERATING, 'payslip') + ' generating');
      if (c.READY) todo.push(count(c.READY, 'payslip') + ' not released');
      if (c.WITHHELD) todo.push(count(c.WITHHELD, 'payslip') + ' withheld');
      if (!p.export) todo.push('no Payment Export');
      else { const open = liveInstructions(p).filter(i => latest(i) !== 'SETTLED'); if (open.length) todo.push(count(open.length, 'Payment Instruction') + ' not settled'); }
      return todo.length ? [todo.join(' · '), 'warning'] : ['Nothing pending', 'muted'];
    }
  }
}

/* ---------- actions ---------- */
// One person, one function per Payroll Period, across every calculation version (#330). No warning mode and no override.
function takeFunction(p, fn) {
  const who = me().person, have = p.actors[who];
  if (have && have !== fn) { flash(`Refused: ${who} already acted in ${FUNCTIONS[have]} on ${p.id}, and one person acts in one function per payroll.`, 'danger'); return false; }
  p.actors[who] = fn; return true;
}
const ACT = {
  calcStart(p) {
    if (!takeFunction(p, 'PREPARATION')) return;
    p.status = 'CALCULATING'; p.calcStarted = now();
    log(p, `Calculation ${p.v + 1} started; rule snapshot RS-${p.id.slice(0, 7)}-${p.v + 1} taken`);
    flash(`Calculation ${p.v + 1} started. ${p.id} has no results until it completes.`, 'warning');
  },
  calcFinish(p) {
    p.v += 1; p.status = 'FOR_REVIEW'; p.versions.push({ v: p.v, at: now(), by: 'System' });
    exceptionsOf(p).forEach(x => {
      if (x.status === 'RESOLVED') return;
      if (x.type === 'CANCELLED_INPUT_USED') Object.assign(x, { status: 'RESOLVED', by: 'System', at: now(), reason: `Calculation ${p.v} no longer uses PI-0931.` });
      else if (x.type === 'NO_PARTIAL_MONTH_RULE' && held(p, x.emp)) Object.assign(x, { status: 'RESOLVED', by: 'System', at: now(), reason: 'Held out under a Payroll Hold. No result in this payroll.' });
      else x.v = p.v;
    });
    const b = blockers(p).length;
    log(p, `Calculation ${p.v} completed${b ? ' with ' + count(b, 'blocking exception') : ''}`, '', 'System');
    flash(`Calculation ${p.v} completed. ${p.id} is For review${b ? ', with ' + count(b, 'blocking exception') + ' open' : ''}.`, b ? 'warning' : 'success');
  },
  returnForCorrection(p, reason) {
    p.status = 'DRAFT'; log(p, 'Returned for correction', reason);
    flash(`${p.id} returned to Draft. Calculation ${p.v} stays on record and is superseded when recalculated.`);
  },
  certify(p) {
    if (blockers(p).length) return flash(`Refused: ${count(blockers(p).length, 'blocking exception')} open. A blocking exception can’t be waived.`, 'danger');
    if (!takeFunction(p, 'HR_CERTIFICATION')) return;
    p.status = 'CERTIFIED'; p.cert = { by: me().person, at: now(), v: p.v };
    p.cpre = { id: `CPRE-${p.id}-${p.v}`, at: now(), v: p.v }; p.reviews = { budget: null, accounting: null };
    log(p, `Certified calculation ${p.v}; Certified Payroll Review Export ${p.cpre.id} generated`);
    flash(`Certified calculation ${p.v}. It is locked at that version. Budget and Accounting reviews are not recorded yet.`);
  },
  uncertify(p, reason, what) {
    if (p.cpre) p.cpre.superseded = true;
    p.status = 'FOR_REVIEW'; p.cert = null; p.reviews = { budget: null, accounting: null }; p.approval = null;
    log(p, what || 'Certification revoked', reason);
  },
  revoke(p, reason) { ACT.uncertify(p, reason); flash(`Certification revoked. ${p.id} is For review again; its review export is superseded.`, 'warning'); },
  review(p, which, outcome, note) {
    if (!takeFunction(p, which === 'budget' ? 'BUDGET_REVIEW' : 'ACCOUNTING_REVIEW')) return;
    const label = which === 'budget' ? 'Budget' : 'Accounting';
    if (outcome === 'RETURNED') {
      ACT.uncertify(p, note, `${label} review returned ${p.cpre.id}. Certification revoked; the other review is revoked`);
      return flash(`${label} review returned. ${p.id} is For review again, and the returned snapshot can never be approved.`, 'warning');
    }
    p.reviews[which] = { outcome, by: me().person, at: now(), note };
    log(p, `${label} review confirmed against ${p.cpre.id}`, note);
    const other = p.reviews[which === 'budget' ? 'accounting' : 'budget'];
    flash(`${label} review confirmed. ${other ? 'Both reviews are confirmed; the payroll is not approved yet.' : 'The other review is not recorded yet.'}`);
  },
  approve(p) {
    if (!p.reviews.budget || !p.reviews.accounting) return flash('Refused: approval needs both checkpoint reviews confirmed.', 'danger');
    if (!takeFunction(p, 'APPROVAL')) return;
    p.status = 'APPROVED'; p.approval = { by: me().person, at: now() };
    log(p, `Approved calculation ${p.v}`);
    flash(`Approved. ${p.id} is not finalized yet: nothing is immutable and no payslip exists.`);
  },
  returnApproved(p, reason) { ACT.uncertify(p, reason, 'Returned before finalization. Certification and reviews revoked'); flash(`${p.id} returned to For review.`, 'warning'); },
  finalize(p) {
    if (!takeFunction(p, 'APPROVAL')) return;
    p.status = 'FINALIZED'; p.final = { by: me().person, at: now() };
    results(p).forEach(r => { p.payslips[r.emp] = { status: 'GENERATING', at: now() }; });
    const h = p.holds.filter(x => !x.lifted);
    log(p, 'Finalized. Lines are immutable; inputs consumed' + (h.length ? `; Payroll Adjustment opened for ${h.map(x => EMP[x.emp].name).join(', ')}` : ''));
    flash(`Finalized. ${count(results(p).length, 'payslip')} generating; none is ready or released yet.`);
  },
  jobsFinish(p) {
    Object.values(p.payslips).forEach(s => { if (s.status === 'GENERATING') s.status = 'READY'; });
    Object.values(p.outputs).forEach(o => { if (o.status === 'GENERATING') o.status = 'READY'; });
    flash('Background work finished. Generated payslips are Ready, not released.');
  },
  releaseAll(p) {
    if (!takeFunction(p, 'APPROVAL')) return;
    let n = 0; Object.values(p.payslips).forEach(s => { if (s.status === 'READY') { Object.assign(s, { status: 'RELEASED', at: now(), by: me().person }); n++; } });
    log(p, `Payslips released (${n})`); flash(`${count(n, 'payslip')} released. Release says nothing about payment.`);
  },
  withhold(p, emp, reason) {
    if (!takeFunction(p, 'APPROVAL')) return;
    Object.assign(p.payslips[emp], { status: 'WITHHELD', at: now(), by: me().person, reason });
    log(p, `Payslip withheld for ${EMP[emp].name}`, reason); flash(`Payslip withheld for ${EMP[emp].name}. Withholding never stops payment.`, 'warning');
  },
  releaseOne(p, emp) {
    if (!takeFunction(p, 'APPROVAL')) return;
    Object.assign(p.payslips[emp], { status: 'RELEASED', at: now(), by: me().person, reason: '' });
    log(p, `Payslip released for ${EMP[emp].name}`); flash(`Payslip released for ${EMP[emp].name}.`);
  },
  destFix(p) { p.missingDest = []; flash('Prototype: the destination is now on record in Personnel.'); },
  exportGenerate(p) {
    if ((p.missingDest || []).length) return flash(`Blocked: ${p.missingDest.map(e => EMP[e].name).join(', ')} has no designated disbursement destination. One missing destination blocks the whole export.`, 'danger');
    const rs = results(p).filter(r => r.net > 0);
    p.export = { id: `PEX-${p.id}-1`, at: now(), by: me().person, checksum: 'sha256 ' + fakeHash(p.id + 'pex'), instructions: rs.map((r, i) => ({ id: `PIN-${p.id.slice(2, 7).replace('-', '')}${p.kind ? p.kind[0] : ''}-${String(i + 1).padStart(2, '0')}`, emp: r.emp, outcomes: [] })) };
    log(p, `Payment Export ${p.export.id} generated`); flash(`Payment Export generated with ${count(rs.length, 'Payment Instruction')}. No one is marked paid.`);
  },
  outcome(p, id, status, ref, note) {
    if (!takeFunction(p, 'DISBURSEMENT')) return;
    const i = p.export.instructions.find(x => x.id === id);
    i.outcomes.push({ status, at: now(), by: me().person, ref, note });
    log(p, `Disbursement Outcome ${status} recorded for ${EMP[i.emp].name}`, note); flash(`Outcome ${OUTCOME[status][0]} recorded for ${EMP[i.emp].name}.`, status === 'REJECTED' ? 'warning' : 'success');
  },
  supersede(p, id) {
    if (!takeFunction(p, 'DISBURSEMENT')) return;
    const i = p.export.instructions.find(x => x.id === id), n = { id: i.id + '-R' + (p.export.instructions.filter(x => x.id.startsWith(i.id.split('-R')[0])).length), emp: i.emp, outcomes: [], supersedes: i.id };
    i.supersededBy = n.id; p.export.instructions.push(n);
    log(p, `Payment Instruction ${i.id} superseded by ${n.id}`); flash(`${n.id} replaces ${i.id}. It has no outcome yet.`, 'warning');
  },
  outputGenerate(p, k) { p.outputs[k] = { status: 'GENERATING', at: now(), by: me().person }; log(p, `${OUTPUTS[k]} requested`); flash(`${OUTPUTS[k]} is generating. It isn’t ready yet.`, 'warning'); },
  ack(x, reason) { Object.assign(x, { status: 'ACKNOWLEDGED', reason, by: me().person, at: now() }); log(period(x.period), `Warning ${x.id} acknowledged`, reason); flash(`${x.id} acknowledged.`); },
  hold(x, reason) {
    const p = period(x.period);
    if (!takeFunction(p, 'PREPARATION')) return;
    p.holds.push({ emp: x.emp, exc: x.id, reason, by: me().person, at: now() });
    log(p, `Payroll Hold placed on ${EMP[x.emp].name}`, reason);
    flash(`Payroll Hold placed. ${EMP[x.emp].name} has no result in ${p.id}; the held month is paid later as a Payroll Adjustment.`, 'warning');
  },
  liftHold(x) {
    const p = period(x.period), h = held(p, x.emp);
    h.lifted = now(); log(p, `Payroll Hold lifted for ${EMP[x.emp].name}`); flash('Payroll Hold lifted.');
  },
};

// Walk the November payroll to a stage with the real actions, so every stage's data stays consistent.
function jumpTo(stage) {
  const keepRole = S.role;
  D = seedData(); D.stage = stage;
  const p = period(NOV), as = (r, fn) => { S.role = r; fn(); };
  const order = ['DRAFT', 'CALCULATING', 'FOR_REVIEW', 'CERTIFIED', 'REVIEWED', 'APPROVED', 'FINALIZED', 'RELEASED'];
  const at = order.indexOf(stage);
  if (at >= 1) as('preparer', () => { ACT.hold(D.exceptions[1], 'No partial-month rule on file (#613). Pay the held month as an adjustment.'); ACT.ack(D.exceptions[2], 'HR confirmed the 1–15 Nov lock is scheduled for 24 Nov; its facts go to the December payroll.'); ACT.calcStart(p); });
  if (at >= 2) ACT.calcFinish(p);
  if (at >= 3) as('certifier', () => ACT.certify(p));
  if (at >= 4) { as('budget', () => ACT.review(p, 'budget', 'CONFIRMED', '')); as('accounting', () => ACT.review(p, 'accounting', 'CONFIRMED', '')); }
  if (at >= 5) as('approver', () => ACT.approve(p));
  if (at >= 6) as('approver', () => ACT.finalize(p));
  if (at >= 7) { ACT.jobsFinish(p); as('approver', () => ACT.releaseAll(p)); ACT.destFix(p); as('cashier', () => ACT.exportGenerate(p)); }
  S.role = keepRole; S.flash = null; S.focus = null;
  save();
}
