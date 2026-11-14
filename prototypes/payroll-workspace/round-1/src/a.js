/* ---------- Variant A · Period file: the Payroll Period is the one record, from draft to disbursement ---------- */
const V = {
  key: 'a', letter: 'A', name: 'Period file',
  nav: ['periods', 'mine'],
  inert: ['Payroll Inputs', 'Rule versions', 'Payroll Adjustments', 'Legacy comparison'],
  dests: {
    periods: { label: 'Payroll Periods', perm: 'periods.read', views: ['tree', 'form', 'kanban'], lede: 'One payroll run of the Agency. Everything about a run lives in its file: Employee results and their Payroll Lines, exceptions, certification and reviews, payslips, the Payment Export, and reports. Each stage is recorded separately, and a stage that hasn’t happened says so.' },
    mine: { label: 'My Payslips', perm: 'payslips.own', views: ['tree', 'form'], lede: 'Your released payslips. Open one to see how each amount was reached.' },
  },
  openPeriod: (id, tab) => ({ dest: 'periods', view: 'form', record: id, tab: tab || '' }),
  openResult: (p, e) => ({ dest: 'periods', view: 'form', record: p.id, tab: 'employees', sub: e }),
  body() { return S.dest === 'mine' ? mineA() : periodsA(); },
};
function periodsA() {
  const list = filteredPeriods();
  if (S.view === 'form') return periodFormA(list);
  if (S.view === 'kanban') return panel('Payroll Period status board', '', list.length ? periodsBoard(list) : periodsEmpty(), true);
  return panel('Payroll Period register', `<span class="cap muted">${count(list.length, 'period')}</span>`, periodFilters() + (list.length ? periodsTree(list) : periodsEmpty()), true);
}
function periodFormA(list) {
  const p = period(S.record) || list[0];
  if (!p) return periodsEmpty();
  S.record = p.id;
  const TABS = ['summary', 'employees', 'exceptions', 'review', 'payslips', 'payment', 'reports', 'history'];
  const tab = TABS.includes(S.tab) ? S.tab : 'summary';
  const open = exceptionsOf(p).filter(x => x.status === 'OPEN').length, c = slipCounts(p);
  const labels = { summary: 'Summary', employees: `Employees · ${p.emps.length}`, exceptions: open ? `Exceptions · ${open} open` : 'Exceptions', review: 'Review', payslips: c.READY + c.GENERATING ? `Payslips · ${c.READY + c.GENERATING} not released` : 'Payslips', payment: 'Payment', reports: 'Reports', history: 'History' };
  let body;
  if (tab === 'summary') {
    const [text, tone] = pendingWith(p);
    body = `${linkedPeriods(p)}${totalsBlock(p)}
      <div class="box ${tone === 'muted' ? '' : 'todo'}"><h3>What is pending</h3><span class="${tone === 'muted' ? 'muted' : 't-' + tone}"><strong>${esc(text)}</strong></span>
      <span class="muted">${count(open, 'open exception')} · ${p.cert ? 'certified' : 'not certified'} · ${p.approval ? 'approved' : 'not approved'} · ${p.final ? 'finalized' : 'not finalized'}</span></div>`;
  } else if (tab === 'employees') {
    if (S.sub && EMP[S.sub]) {
      const emps = p.emps.map(e => ({ id: e }));
      body = `<div class="rec-head"><div class="back">${openLink('← All Employee results', V.openPeriod(p.id, 'employees'), 'back-emps')}</div>${pager(emps, S.sub, x => V.openResult(p, x.id))}</div>${resultDetail(p, S.sub, S.ver)}`;
    } else body = employeesSection(p);
  } else body = { exceptions: exceptionsSection, review: reviewSection, payslips: payslipsSection, payment: paymentSection, reports: reportsSection, history: historySection }[tab](p);
  return `<section class="panel" aria-label="Payroll Period ${esc(p.id)}"><div class="rec">
    <div class="rec-head"><div><div class="rec-title"><h2>${esc(p.id)}</h2>${tag(PERIOD_STATUS[p.status])}</div><p class="small muted">${esc(p.name)}</p>${periodFacts(p)}</div>${pager(list, p.id, x => V.openPeriod(x.id, tab))}</div>
    ${stageRail(p)}${periodActions(p)}${protoJobs(p)}
    ${tabs(TABS, tab, labels)}${tabpanel(tab, body)}</div></section>`;
}
function mineA() {
  const list = mySlips();
  if (S.view === 'form') {
    const p = list.find(x => x.id === S.record) || list[0];
    if (!p) return surface('No released payslips yet.', 'A payslip appears here after your Agency releases it.', true);
    S.record = p.id;
    return `<section class="panel" aria-label="Payslip"><div class="rec"><div class="rec-head"><div class="back">${openLink('← All payslips', { dest: 'mine', view: 'tree', record: '' }, 'back-slips')}</div>${pager(list, p.id, x => ({ dest: 'mine', view: 'form', record: x.id }))}</div>${slipDoc(p, 'expand')}</div></section>`;
  }
  return panel('My payslips', `<span class="cap muted">${count(list.length, 'payslip')}</span>`, slipsTree(list, p => ({ dest: 'mine', view: 'form', record: p.id })), true);
}
