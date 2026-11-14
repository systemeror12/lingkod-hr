/* ---------- Variant B · Work desk: each actor lands on the work their function holds, across periods ---------- */
let RO = false; // The period record is read-only in this variant; actions live on the work pages.
const baseCan = can;
// eslint-disable-next-line no-func-assign
can = perm => baseCan(perm) && (!RO || perm.endsWith('.read') || perm === 'payslips.own');

const V = {
  key: 'b', letter: 'B', name: 'Work desk',
  nav: ['work', 'periods', 'mine'],
  inert: ['Payroll Inputs', 'Rule versions', 'Payroll Adjustments', 'Legacy comparison'],
  dests: {
    work: { label: 'Payroll Work', perm: 'periods.read', views: ['tree', 'form', 'kanban'], lede: 'What every open payroll is waiting on, by the function that holds it. Your own work is listed first, and each item opens a page with only what that step needs. Work held by someone else, or by the system, is shown as waiting, never as done.' },
    periods: { label: 'Payroll Periods', perm: 'periods.read', views: ['tree', 'form'], lede: 'The read-only record of each payroll run. To act on a payroll, open its work under Payroll Work.' },
    mine: { label: 'My Payslip', perm: 'payslips.own', views: ['form'], lede: 'Your latest released payslip, with how each amount was reached. Choose another month to read an earlier one.' },
  },
  badge(d) { if (d !== 'work') return ''; const n = workItems().filter(mineItem).length; return n ? ` · ${n}` : ''; },
  openPeriod: id => ({ dest: 'periods', view: 'form', record: id }),
  openResult: (p, e) => S.dest === 'work' ? { dest: 'work', view: 'form', record: S.record, sub: e } : { dest: 'periods', view: 'form', record: p.id, tab: 'employees', sub: e },
  body() { return S.dest === 'mine' ? mineB() : S.dest === 'periods' ? periodsB() : workB(); },
};

function workItems() {
  const out = [], add = (p, kind, fn, title, detail, system) => out.push({ id: p.id + ':' + kind, p, kind, fn, title, detail, system });
  D.periods.forEach(p => {
    const b = blockers(p).length, w = openWarnings(p).length;
    if (p.status === 'DRAFT') add(p, 'prepare', 'PREPARATION', p.v ? 'Correct and recalculate' : 'Start calculation', b + w ? `${count(b, 'blocking exception')}, ${count(w, 'warning')} open` : 'Ready to calculate');
    if (p.status === 'CALCULATING') add(p, 'calculating', 'PREPARATION', `Calculation ${p.v + 1} running`, 'No results yet. No one can act until it completes.', true);
    if (p.status === 'FOR_REVIEW') add(p, 'certify', 'HR_CERTIFICATION', `Certify calculation ${p.v}`, b ? `Blocked: ${count(b, 'blocking exception')} open` : `${count(results(p).length, 'Employee result')} to certify`);
    if (p.status === 'CERTIFIED') {
      if (!p.reviews.budget) add(p, 'budget', 'BUDGET_REVIEW', 'Record the Budget review', `Against ${p.cpre.id}`);
      if (!p.reviews.accounting) add(p, 'accounting', 'ACCOUNTING_REVIEW', 'Record the Accounting review', `Against ${p.cpre.id}`);
      if (p.reviews.budget && p.reviews.accounting) add(p, 'approve', 'APPROVAL', 'Approve payroll', 'Both checkpoint reviews confirmed');
    }
    if (p.status === 'APPROVED') add(p, 'finalize', 'APPROVAL', 'Finalize payroll', `Approved ${dtt(p.approval.at)}; not finalized`);
    if (p.status === 'FINALIZED') {
      const c = slipCounts(p);
      if (c.GENERATING + c.READY + c.WITHHELD) add(p, 'release', 'APPROVAL', c.READY ? `Release ${count(c.READY, 'payslip')}` : c.GENERATING ? 'Payslips generating' : `${count(c.WITHHELD, 'payslip')} withheld`, [c.GENERATING && c.GENERATING + ' generating', c.READY && c.READY + ' ready, not released', c.WITHHELD && (c.READY + c.GENERATING ? c.WITHHELD + ' withheld' : 'Not released to the Employee')].filter(Boolean).join(' · '), !c.READY && !c.WITHHELD);
      if (!p.export) add(p, 'payment', 'DISBURSEMENT', 'Generate the Payment Export', (p.missingDest || []).length ? 'Blocked: a destination is missing' : 'Not generated');
      else { const open = liveInstructions(p).filter(i => latest(i) !== 'SETTLED'); if (open.length) add(p, 'payment', 'DISBURSEMENT', 'Record Disbursement Outcomes', `${count(open.length, 'Payment Instruction')} not settled${open.some(i => latest(i) === 'REJECTED') ? ', 1 rejected' : ''}`); }
      const missing = Object.keys(OUTPUTS).filter(k => !p.outputs[k] || p.outputs[k].status !== 'READY').length;
      if (missing) add(p, 'outputs', 'PREPARATION', 'Generate the register and reports', `${missing} of ${Object.keys(OUTPUTS).length} not ready`);
    }
  });
  return out;
}
const mineItem = i => !i.system && i.fn === me().fn;
function workB() {
  let items = S.sample === 'empty' ? [] : workItems().filter(i => (S.status === 'ALL' || i.fn === S.status) && matches(i.title + ' ' + i.p.id + ' ' + i.p.name));
  if (S.view === 'form') return taskForm(items);
  const none = surface('No open payroll work.', 'Every payroll is finalized, released, settled, and reported.');
  const mineHead = k => `${tag([FUNCTIONS[k], k === me().fn ? 'info' : 'neutral'])}${k === me().fn ? '<span class="cap" style="font-weight:650">You</span>' : ''}`;
  if (S.view === 'kanban') return panel('Payroll work by function', '', items.length ? board(FUNCTIONS, items, i => i.fn, i => `<span class="k">${i.p.id}</span><strong>${esc(i.title)}</strong><span class="cap ${i.system ? 't-warning' : 'muted'}">${esc(i.detail)}</span><span class="cap muted">${PERIOD_STATUS[i.p.status][0]} · pays ${dt(i.p.pay)}</span>`, i => ({ dest: 'work', view: 'form', record: i.id }), mineHead) : none, true);
  const row = i => `<tr ${i.id === S.record ? 'aria-current="true"' : ''}><th scope="row">${openLink(i.title, { dest: 'work', view: 'form', record: i.id }, 'work-' + i.id)}<span class="blk cap ${/^Blocked/.test(i.detail) ? 't-danger' : 'muted'}" style="font-weight:400">${esc(i.detail)}</span></th>
    <td>${i.p.id}<span class="blk cap muted">${esc(i.p.name)}</span></td><td>${i.system ? tag(['System', 'warning']) : tag([FUNCTIONS[i.fn], mineItem(i) ? 'info' : 'neutral'])}<span class="blk cap muted">${i.system ? 'Background work' : esc(ROLES[FN_ROLE[i.fn]].label)}</span></td>
    <td>${tag(PERIOD_STATUS[i.p.status])}</td><td class="nowrap">${dt(i.p.pay)}</td></tr>`;
  const mine = items.filter(mineItem), rest = items.filter(i => !mineItem(i));
  const grp = (label, list, emptyText) => `<tr class="grp"><th colspan="5" scope="colgroup">${label} · ${list.length}</th></tr>${list.length ? list.map(row).join('') : `<tr><td colspan="5" class="muted">${emptyText}</td></tr>`}`;
  return panel('Open payroll work', `<span class="cap muted">${count(items.length, 'item')}</span>`,
    `<div class="filters">${search('Work, period code, or name')}${selectFilter('status', 'Held by', 'All functions', FUNCTIONS, S.status)}</div>` +
    (items.length ? table('Open payroll work', 900, ['Work', 'Payroll Period', 'Held by', 'Payroll status', 'Payment date'], grp(me().fn ? `Waiting on you, ${esc(me().label)}` : 'Waiting on you', mine, me().fn ? 'Nothing is waiting on you.' : 'Your role holds no payroll function. Everything below is read-only.') + grp('Waiting on others', rest, 'Nothing else is open.')) : none), true);
}
function taskForm(items) {
  const all = workItems();
  let it = all.find(i => i.id === S.record);
  if (!it && !S.record) { it = items.find(mineItem) || items[0]; if (it) S.record = it.id; }
  const back = `<div class="back">${openLink('← All payroll work', { dest: 'work', view: 'tree', record: '' }, 'back-work')}</div>`;
  if (!it) {
    const p = period((S.record || '').split(':')[0]);
    if (!p) return surface('No open payroll work.', 'Every payroll is finalized, released, settled, and reported.', true);
    const next = all.filter(i => i.p.id === p.id);
    return `<section class="panel" aria-label="Payroll work"><div class="rec">${back}<div class="rec-title"><h2>This step is done or has moved on</h2>${tag(PERIOD_STATUS[p.status])}</div><p class="small muted">${esc(p.id)} · ${esc(p.name)}</p>${stageRail(p)}${protoJobs(p)}
      <div class="sec"><h3>What ${esc(p.id)} is waiting on now</h3>${next.length ? `<div class="inset">${table('Next work', 560, ['Work', 'Held by'], next.map(i => `<tr><th scope="row">${openLink(i.title, { dest: 'work', view: 'form', record: i.id }, 'next-' + i.id)}<span class="blk cap muted" style="font-weight:400">${esc(i.detail)}</span></th><td>${i.system ? 'System' : esc(ROLES[FN_ROLE[i.fn]].label)}</td></tr>`).join(''))}</div>` : '<p class="muted small">Nothing. This payroll has no open work.</p>'}</div></div></section>`;
  }
  const p = it.p, yours = mineItem(it);
  const sec = (title, html, note) => `<div class="sec"><div class="sec-head"><h3>${title}</h3>${note ? `<span class="lines-key">${note}</span>` : ''}</div>${html}</div>`;
  const emps = S.sub && EMP[S.sub]
    ? `<div class="back">${openLink('← All Employee results', { dest: 'work', view: 'form', record: it.id }, 'back-emps')}</div>${resultDetail(p, S.sub, S.ver)}`
    : employeesSection(p);
  const parts = {
    prepare: () => sec('Exceptions', exceptionsSection(p)) + sec('Employee results', emps),
    calculating: () => `<div class="msg msg-warning" role="status">Calculation ${p.v + 1} is running. There is nothing to act on until it completes.</div>` + sec('Employee results', emps),
    certify: () => sec('What you are certifying', totalsBlock(p), 'Personnel, attendance, and leave inputs') + sec('Exceptions', exceptionsSection(p)) + sec('Employee results', emps),
    budget: () => sec('The snapshot under review', totalsBlock(p), p.cpre.id) + sec('Reviews on this payroll', reviewSection(p)) + sec('Employee results', emps),
    approve: () => sec('What you are approving', totalsBlock(p)) + sec('Certification and reviews', reviewSection(p)) + sec('Employee results', emps),
    release: () => sec('Payslips', payslipsSection(p)),
    payment: () => sec('Payment Export', paymentSection(p)),
    outputs: () => sec('Register, reports, and schedules', reportsSection(p)),
  };
  parts.accounting = parts.budget; parts.finalize = parts.approve;
  const list = items.filter(i => mineItem(i) === yours);
  return `<section class="panel" aria-label="Payroll work"><div class="rec">
    <div class="rec-head">${back}${pager(list, it.id, x => ({ dest: 'work', view: 'form', record: x.id }))}</div>
    <div><div class="rec-title"><h2>${esc(it.title)}</h2>${tag(PERIOD_STATUS[p.status])}</div>
      <p class="small muted">${openLink(p.id, V.openPeriod(p.id), 'task-period')} · ${esc(p.name)} · pays ${dt(p.pay)} · held by ${it.system ? 'the system' : esc(ROLES[FN_ROLE[it.fn]].label)}</p></div>
    ${yours ? '' : `<div class="msg msg-info" role="status">${it.system ? 'Background work. It finishes on its own.' : `This step is held by the ${esc(ROLES[FN_ROLE[it.fn]].label)}. You can read it, and it isn’t done until they act.`}</div>`}
    ${stageRail(p)}${periodActions(p)}${protoJobs(p)}${parts[it.kind]()}</div></section>`;
}
function periodsB() {
  const list = filteredPeriods();
  if (S.view !== 'form') return panel('Payroll Period register', `<span class="cap muted">${count(list.length, 'period')}</span>`, periodFilters() + (list.length ? periodsTree(list) : periodsEmpty()), true);
  const p = period(S.record) || list[0];
  if (!p) return periodsEmpty();
  S.record = p.id;
  const TABS = ['overview', 'employees', 'exceptions', 'review', 'outputs', 'history'], tab = TABS.includes(S.tab) ? S.tab : 'overview';
  const work = workItems().filter(i => i.p.id === p.id);
  RO = true;
  let body;
  try {
    body = {
      overview: () => `${linkedPeriods(p)}${totalsBlock(p)}<div class="sec"><h3>Open work on this payroll</h3>${work.length ? `<div class="inset">${table('Open work', 560, ['Work', 'Held by'], work.map(i => `<tr><th scope="row">${openLink(i.title, { dest: 'work', view: 'form', record: i.id }, 'pw-' + i.id)}<span class="blk cap muted" style="font-weight:400">${esc(i.detail)}</span></th><td>${i.system ? 'System' : esc(ROLES[FN_ROLE[i.fn]].label)}</td></tr>`).join(''))}</div>` : '<p class="muted small">None. Nothing is pending on this payroll.</p>'}</div>`,
      employees: () => S.sub && EMP[S.sub] ? `<div class="back">${openLink('← All Employee results', { dest: 'periods', view: 'form', record: p.id, tab: 'employees' }, 'back-emps')}</div>${resultDetail(p, S.sub, S.ver)}` : employeesSection(p),
      exceptions: () => exceptionsSection(p), review: () => reviewSection(p),
      outputs: () => `<div class="sec"><h3>Payslips</h3>${payslipsSection(p)}</div><div class="sec"><h3>Payment Export</h3>${paymentSection(p)}</div><div class="sec"><h3>Register, reports, and schedules</h3>${reportsSection(p)}</div>`,
      history: () => historySection(p),
    }[tab]();
  } finally { RO = false; }
  return `<section class="panel" aria-label="Payroll Period ${esc(p.id)}"><div class="rec">
    <div class="rec-head"><div><div class="rec-title"><h2>${esc(p.id)}</h2>${tag(PERIOD_STATUS[p.status])}${tag(['Read-only record', 'neutral'])}</div><p class="small muted">${esc(p.name)}</p>${periodFacts(p)}</div>${pager(list, p.id, x => ({ dest: 'periods', view: 'form', record: x.id, tab }))}</div>
    ${stageRail(p)}${tabs(TABS, tab, { overview: 'Overview', employees: `Employees · ${p.emps.length}`, exceptions: 'Exceptions', review: 'Review', outputs: 'Outputs', history: 'History' })}${tabpanel(tab, body)}</div></section>`;
}
function mineB() {
  const list = mySlips();
  if (!list.length) return surface('No released payslips yet.', 'A payslip appears here after your Agency releases it.', true);
  const p = list.find(x => x.id === S.record) || list[0];
  return `<section class="panel" aria-label="Payslip"><div class="rec"><div class="month-pick" role="group" aria-label="Released payslips">${list.map(x => `<button type="button" aria-pressed="${x.id === p.id}" data-month="${x.id}" data-fid="month-${x.id}">${esc(x.name.replace(' (replacement)', ''))}</button>`).join('')}</div>${slipDoc(p, 'inline')}</div></section>`;
}
