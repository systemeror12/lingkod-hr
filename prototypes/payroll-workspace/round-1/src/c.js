/* ---------- Variant C · Linked registers: each record type is its own register across periods, as Leave keeps its ledger apart ---------- */
const V = {
  key: 'c', letter: 'C', name: 'Linked registers',
  nav: ['periods', 'results', 'exceptions', 'payslips', 'exports', 'reports', 'mine'],
  inert: ['Payroll Inputs', 'Rule versions', 'Payroll Adjustments', 'Legacy comparison'],
  dests: {
    periods: { label: 'Payroll Periods', perm: 'periods.read', views: ['tree', 'form', 'kanban'], lede: 'One payroll run of the Agency, with its stages and reviews. Its Employee results, exceptions, payslips, Payment Export, and reports are separate registers, each linked from the period.' },
    results: { label: 'Employee Results', perm: 'results.read', views: ['tree', 'form'], lede: 'One Payroll Employee Result per Employee and payroll, with its Payroll Lines and where each came from. Filter by Employee to follow one person across payrolls.' },
    exceptions: { label: 'Payroll Exceptions', perm: 'periods.read', views: ['tree', 'form', 'kanban'], lede: 'Every exception a calculation raised. A blocking exception stops certification and can’t be waived; a warning is acknowledged with a reason.' },
    payslips: { label: 'Payslips', perm: 'payslips.read', views: ['tree', 'kanban'], lede: 'The statement of each finalized Employee result. A payslip is Ready before it is Released, and release is separate from payment.' },
    exports: { label: 'Payment Exports', perm: 'exports.read', views: ['tree', 'form'], lede: 'The Payment Instructions of each finalized payroll and what happened to them. Generating an export marks no one paid.' },
    reports: { label: 'Registers & Reports', perm: 'outputs.read', views: ['tree'], lede: 'The register, variance report, remittance schedules, and exports of each payroll, with when each was generated and from which payroll.' },
    mine: { label: 'My Payslips', perm: 'payslips.own', views: ['tree', 'form'], lede: 'Your released payslips. Each one has a second tab showing how every amount was reached.' },
  },
  openPeriod: (id, tab) => ({ dest: 'periods', view: 'form', record: id, tab: tab || '' }),
  openResult: (p, e) => ({ dest: 'results', view: 'form', record: p.id + '~' + e }),
  body() { return { periods: periodsC, results: resultsC, exceptions: exceptionsC, payslips: payslipsC, exports: exportsC, reports: reportsC, mine: mineC }[S.dest](); },
};
const inPf = p => S.pf === 'ALL' || p.id === S.pf;
const periodStrip = p => `<p class="small muted">${openLink(p.id, V.openPeriod(p.id), 'strip-' + p.id)} · ${esc(p.name)} · ${tag(PERIOD_STATUS[p.status])} <span class="t-${pendingWith(p)[1] === 'muted' ? 'muted' : pendingWith(p)[1]}">${esc(pendingWith(p)[0])}</span></p>`;

function periodsC() {
  const list = filteredPeriods();
  if (S.view === 'kanban') return panel('Payroll Period status board', '', list.length ? periodsBoard(list) : periodsEmpty(), true);
  if (S.view !== 'form') return panel('Payroll Period register', `<span class="cap muted">${count(list.length, 'period')}</span>`, periodFilters() + (list.length ? periodsTree(list) : periodsEmpty()), true);
  const p = period(S.record) || list[0];
  if (!p) return periodsEmpty();
  S.record = p.id;
  const TABS = ['summary', 'review', 'history'], tab = TABS.includes(S.tab) ? S.tab : 'summary';
  const open = exceptionsOf(p).filter(x => x.status === 'OPEN').length, c = slipCounts(p), live = liveInstructions(p);
  const link = (label, value, note, dest, pend) => `<div class="total ${pend ? 'pending' : ''}"><dt>${label}</dt><dd class="v">${value}</dd><dd class="src">${note}</dd><dd class="small">${openLink('Open in ' + V.dests[dest].label, { dest, view: 'tree', record: '', pf: p.id }, 'reg-' + dest)}</dd></div>`;
  const fin = p.status === 'FINALIZED' || p.status === 'VOIDED';
  const body = tab === 'review' ? reviewSection(p) : tab === 'history' ? historySection(p) : `${linkedPeriods(p)}${totalsBlock(p)}
    <div class="sec"><h3>Records of this payroll</h3><dl class="totals">
      ${link('Employee results', p.v ? results(p).length : 'None', p.v ? `calculation ${p.v}${fin ? '' : p.status === 'DRAFT' ? ', returned' : p.status === 'CALCULATING' ? ', superseded' : ', not final'}` : 'Not calculated', 'results', !fin)}
      ${link('Exceptions', open ? open + ' open' : 'None open', `${blockers(p).length} blocking`, 'exceptions', open > 0)}
      ${can('payslips.read') ? link('Payslips', fin ? `${c.RELEASED} released` : 'None', fin ? `${c.GENERATING} generating · ${c.READY} ready · ${c.WITHHELD} withheld` : 'After finalization', 'payslips', !fin || c.GENERATING + c.READY > 0) : ''}
      ${can('exports.read') ? link('Payment Export', p.export ? `${live.filter(i => latest(i) === 'SETTLED').length} of ${live.length} settled` : 'Not generated', p.export ? p.export.id : fin ? 'No one is paid yet' : 'After finalization', 'exports', !p.export || live.some(i => latest(i) !== 'SETTLED')) : ''}
      ${can('outputs.read') ? link('Registers & reports', `${Object.values(p.outputs).filter(o => o.status === 'READY').length} ready`, fin ? `of ${Object.keys(OUTPUTS).length}` : 'After finalization', 'reports', !fin) : ''}
    </dl></div>`;
  return `<section class="panel" aria-label="Payroll Period ${esc(p.id)}"><div class="rec">
    <div class="rec-head"><div><div class="rec-title"><h2>${esc(p.id)}</h2>${tag(PERIOD_STATUS[p.status])}</div><p class="small muted">${esc(p.name)}</p>${periodFacts(p)}</div>${pager(list, p.id, x => V.openPeriod(x.id, tab))}</div>
    ${stageRail(p)}${periodActions(p)}${protoJobs(p)}${tabs(TABS, tab, { summary: 'Summary', review: 'Review', history: 'History' })}${tabpanel(tab, body)}</div></section>`;
}

function resultRows() {
  if (S.sample === 'empty') return [];
  return D.periods.filter(inPf).flatMap(p => p.v ? p.emps.map(e => ({ id: p.id + '~' + e, p, e })) : []).filter(x => matches(EMP[x.e].name + ' ' + EMP[x.e].no + ' ' + x.p.id));
}
function resultsC() {
  const list = resultRows();
  if (S.view === 'form') {
    const x = list.find(r => r.id === S.record) || resultRowById(S.record) || list[0];
    if (!x) return surface('No Employee results.', 'Results appear when a calculation completes.', true);
    S.record = x.id;
    return `<section class="panel" aria-label="Employee result"><div class="rec"><div class="rec-head"><div class="back">${openLink('← All Employee results', { dest: 'results', view: 'tree', record: '', pf: S.pf }, 'back-results')}</div>${pager(list, x.id, r => ({ dest: 'results', view: 'form', record: r.id, pf: S.pf }))}</div>
      ${periodStrip(x.p)}${x.p.status === 'CALCULATING' ? `<div class="msg msg-warning" role="status">Calculation ${x.p.v + 1} is running and has no results yet. This is calculation ${x.p.v}, which it supersedes.</div>` : ''}${resultDetail(x.p, x.e)}</div></section>`;
  }
  const rows = list.map(({ id, p, e }) => {
    const name = `<th scope="row">${openLink(EMP[e].name, { dest: 'results', view: 'form', record: id, pf: S.pf }, 'res-' + id)}<span class="blk cap muted" style="font-weight:400">${EMP[e].no}</span></th><td>${p.id}<span class="blk cap muted">${PERIOD_STATUS[p.status][0]}</span></td>`;
    if (!hasResult(p, e)) return `<tr>${name}<td>${p.v}</td><td>${tag(['No result', 'neutral'], true)}</td><td colspan="3" class="muted">${held(p, e) ? 'Held out under a Payroll Hold.' : 'Blocked by an open exception. No amount was calculated.'}</td></tr>`;
    const r = result(p, e), stale = p.status === 'DRAFT' || p.status === 'CALCULATING';
    return `<tr>${name}<td>${p.v}${stale ? '<span class="blk cap muted">superseded on recalculation</span>' : ''}</td><td>${tag(stale ? ['Superseded', 'neutral'] : RESULT_STATUS[r.status])}</td><td class="num">${peso(r.gross)}</td><td class="num">${peso(r.ded)}</td><td class="num"><strong>${peso(r.net)}</strong></td></tr>`;
  }).join('');
  return panel('Employee result register', `<span class="cap muted">${count(list.length, 'result')}</span>`, `<div class="filters">${search('Employee name, number, or period')}${periodFilter()}</div>` +
    (list.length ? table('Employee results', 900, ['Employee', 'Payroll Period', 'Calculation', 'Result', '#Gross pay', '#Deductions', '#Net pay'], rows) : surface('No Employee results match.', 'Clear the search or choose another period.')), true);
}
function resultRowById(id) { const [pid, e] = (id || '').split('~'), p = period(pid); return p && EMP[e] ? { id, p, e } : null; }

function exceptionList() { return S.sample === 'empty' ? [] : D.exceptions.filter(x => inPf(period(x.period)) && (S.status === 'ALL' || x.status === S.status) && matches(x.id + ' ' + x.title + ' ' + (x.emp ? EMP[x.emp].name : ''))); }
function exceptionsC() {
  const list = exceptionList(), open = x => ({ dest: 'exceptions', view: 'form', record: x.id, pf: S.pf });
  const none = surface('No exceptions match.', 'Clear the search or choose another period or status.');
  if (S.view === 'form') {
    const x = list.find(r => r.id === S.record) || D.exceptions.find(r => r.id === S.record) || list[0];
    if (!x) return surface('No exceptions.', 'Exceptions are raised by a calculation.', true);
    S.record = x.id;
    const p = period(x.period);
    return `<section class="panel" aria-label="Exception ${x.id}"><div class="rec"><div class="rec-head"><div class="back">${openLink('← All exceptions', { dest: 'exceptions', view: 'tree', record: '', pf: S.pf }, 'back-exc')}</div>${pager(list, x.id, open)}</div>
      <div><div class="rec-title"><h2>${x.id}</h2>${tag(SEVERITY[x.severity])}${tag(EXC_STATUS[x.status])}</div><p class="small">${esc(x.title)}</p></div>${periodStrip(p)}
      <dl class="dl"><div><dt>Applies to</dt><dd>${x.emp ? openLink(EMP[x.emp].name, V.openResult(p, x.emp), 'exc-emp') : 'Whole payroll'}</dd></div><div><dt>Raised by</dt><dd>Calculation ${x.v}</dd></div><div><dt>Effect</dt><dd>${x.severity === 'BLOCKING' ? 'Stops certification. Can’t be waived.' : 'Doesn’t block. Acknowledge with a reason.'}</dd></div></dl>
      <div class="box"><strong>Reason</strong><span>${esc(x.detail)}</span><span class="muted">${exceptionNeeds(x)}</span></div><div class="actions">${exceptionActions(x)}</div></div></section>`;
  }
  if (S.view === 'kanban') return panel('Exceptions by status', '', list.length ? board(EXC_STATUS, list, x => x.status, x => `<span class="k">${x.id} · ${x.period}</span><strong>${esc(x.title)}</strong><span>${tag(SEVERITY[x.severity])}</span><span class="cap muted">${x.emp ? esc(EMP[x.emp].name) : 'Whole payroll'}</span>`, open) : none, true);
  return panel('Exception register', `<span class="cap muted">${count(list.length, 'exception')}</span>`, `<div class="filters">${search('Exception, reason, or Employee')}${periodFilter()}${selectFilter('status', 'Status', 'All statuses', EXC_STATUS, S.status)}</div>` + (list.length ? `<div style="padding:16px">${exceptionsTable(list, { showPeriod: true, open })}</div>` : none), true);
}

function payslipsC() {
  const ps = S.sample === 'empty' ? [] : D.periods.filter(p => inPf(p) && Object.keys(p.payslips).length);
  const filters = `<div class="filters">${periodFilter()}</div>`;
  if (S.view === 'kanban') {
    const cards = ps.flatMap(p => Object.entries(p.payslips).map(([e, s]) => ({ id: p.id + '~' + e, p, e, s })));
    return panel('Payslips by status', '', filters + (cards.length ? board(SLIP_STATUS, cards, x => x.s.status, x => `<span class="k">${x.p.id}</span><strong>${esc(EMP[x.e].name)}</strong><span class="cap muted">Net ${peso(result(x.p, x.e).net)}</span>${x.s.reason ? `<span class="cap muted">“${esc(x.s.reason)}”</span>` : ''}`, x => ({ dest: 'payslips', view: 'tree', record: '', pf: x.p.id })) : surface('No payslips.', 'Payslips are generated after a payroll is finalized.')), true);
  }
  const pending = D.periods.filter(p => inPf(p) && !['FINALIZED', 'VOIDED'].includes(p.status));
  return `${panel('Payslip register', `<span class="cap muted">${count(ps.length, 'payroll')} with payslips</span>`, filters + (pending.length ? `<p class="cap muted" style="padding:10px 16px">No payslips exist for ${pending.map(p => `${esc(p.id)} (${PERIOD_STATUS[p.status][0]})`).join(', ')}: payslips are generated after finalization.</p>` : ''), true)}
    ${ps.map(p => `<section class="panel" aria-label="Payslips of ${esc(p.id)}"><div class="panel-head"><h2>${esc(p.id)} · ${esc(p.name)}</h2>${openLink('Open the period', V.openPeriod(p.id), 'slips-p-' + p.id)}</div><div class="panel-body sec">${protoJobs(p)}${payslipsSection(p)}</div></section>`).join('') || surface('No payslips.', 'Payslips are generated after a payroll is finalized.', true)}`;
}

function exportsC() {
  const list = S.sample === 'empty' ? [] : D.periods.filter(p => inPf(p) && p.status === 'FINALIZED');
  if (S.view === 'form') {
    const p = list.find(x => x.id === S.record) || list[0];
    if (!p) return surface('No finalized payroll.', 'A Payment Export comes only from a finalized payroll.', true);
    S.record = p.id;
    return `<section class="panel" aria-label="Payment Export of ${esc(p.id)}"><div class="rec"><div class="rec-head"><div class="back">${openLink('← All Payment Exports', { dest: 'exports', view: 'tree', record: '' }, 'back-exp')}</div>${pager(list, p.id, x => ({ dest: 'exports', view: 'form', record: x.id }))}</div>
      <div class="rec-title"><h2>${p.export ? p.export.id : 'No Payment Export'}</h2>${p.export ? '' : tag(['Not generated', 'neutral'], true)}</div>${periodStrip(p)}${paymentSection(p)}</div></section>`;
  }
  const rows = list.map(p => {
    const live = liveInstructions(p), amt = i => result(p, i.emp).net, open = { dest: 'exports', view: 'form', record: p.id };
    if (!p.export) return `<tr><th scope="row">${openLink('Not generated', open, 'exp-' + p.id)}</th><td>${p.id}<span class="blk cap muted">${esc(p.name)}</span></td><td>${tag(['Not generated', 'neutral'], true)}</td><td colspan="3" class="muted">${(p.missingDest || []).length ? 'Blocked: a disbursement destination is missing.' : 'No Payment Instruction exists. No one is paid.'}</td></tr>`;
    const by = {}; live.forEach(i => { by[latest(i)] = (by[latest(i)] || 0) + 1; });
    return `<tr><th scope="row">${openLink(p.export.id, open, 'exp-' + p.id)}</th><td>${p.id}<span class="blk cap muted">${esc(p.name)}</span></td><td class="small">${who(p.export)}</td><td class="num">${live.length}</td>
      <td class="num">${peso(sum(live.filter(i => latest(i) === 'SETTLED'), amt))}<span class="blk cap muted">of ${peso(sum(live, amt))}</span></td><td>${Object.entries(by).map(([k, n]) => `<span class="blk">${tag(OUTCOME[k], k === 'NONE')} ${n}</span>`).join('')}</td></tr>`;
  }).join('');
  return panel('Payment Export register', `<span class="cap muted">${count(list.length, 'finalized payroll')}</span>`, `<div class="filters">${periodFilter()}</div>` + (list.length ? table('Payment Exports', 940, ['Payment Export', 'Payroll Period', 'Generated', '#Instructions', '#Settled', 'Latest outcomes'], rows) : surface('No finalized payroll.', 'A Payment Export comes only from a finalized payroll.')), true);
}

function reportsC() {
  const ps = S.sample === 'empty' ? [] : D.periods.filter(p => inPf(p) && (p.cpre || p.status === 'FINALIZED'));
  return `${panel('Registers and reports', `<span class="cap muted">${count(ps.length, 'payroll')}</span>`, `<div class="filters">${periodFilter()}</div>`, true)}
    ${ps.map(p => `<section class="panel" aria-label="Outputs of ${esc(p.id)}"><div class="panel-head"><h2>${esc(p.id)} · ${esc(p.name)}</h2><div class="row">${tag(PERIOD_STATUS[p.status])}${openLink('Open the period', V.openPeriod(p.id), 'rep-p-' + p.id)}</div></div><div class="panel-body sec">${protoJobs(p)}${reportsSection(p)}</div></section>`).join('') || surface('No outputs.', 'Outputs follow certification and finalization.', true)}`;
}

function mineC() {
  const list = mySlips();
  if (S.view !== 'form') return panel('My payslips', `<span class="cap muted">${count(list.length, 'payslip')}</span>`, slipsTree(list, p => ({ dest: 'mine', view: 'form', record: p.id })), true);
  const p = list.find(x => x.id === S.record) || list[0];
  if (!p) return surface('No released payslips yet.', 'A payslip appears here after your Agency releases it.', true);
  S.record = p.id;
  const tab = S.tab === 'how' ? 'how' : 'payslip';
  return `<section class="panel" aria-label="Payslip"><div class="rec"><div class="rec-head"><div class="back">${openLink('← All payslips', { dest: 'mine', view: 'tree', record: '' }, 'back-slips')}</div>${pager(list, p.id, x => ({ dest: 'mine', view: 'form', record: x.id, tab }))}</div>
    ${tabs(['payslip', 'how'], tab, { payslip: 'Payslip', how: 'How it was reached' })}${tabpanel(tab, tab === 'how' ? `<p class="small muted">Every line of your ${esc(p.name)} payslip, with its quantity, rate, rule, and the record it came from.</p>${linesTable(result(p, SELF))}` : slipDoc(p, 'plain'))}</div></section>`;
}
