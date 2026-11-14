/* ---------- Round 2 · B · Payslips and runs: the run is its own short record, and holds every run-wide button ---------- */
const V = {
  key: 'b', letter: 'B', name: 'Payslips and runs', nav: ['payslips', 'runs', 'reports', 'structures', 'rules'],
  payslips() {
    const home = { dest: 'payslips', view: 'tree', record: '' };
    if (S.view === 'form') {
      const x = slipById(S.record) || slipRows()[0];
      if (!x) return surface('No payslips.', 'Payslips appear when a payroll run is created.');
      S.record = x.id;
      return slipForm(x, { crumbs: [[isEmployee() ? 'My Payslips' : 'Employee Payslips', home], [`${EMP[x.e].name} · ${x.p.name}`]], list: isEmployee() ? slipRows() : slipRows(x.p.id), mk: r => ({ dest: 'payslips', view: 'form', record: r.id, tab: S.tab }), runLink: isEmployee() ? null : { dest: 'runs', view: 'form', record: x.p.id } });
    }
    const rows = slipRows(isEmployee() || S.pf === 'ALL' ? undefined : S.pf);
    const runFilter = `<label class="field">Payroll run<select class="input" data-filter="pf" data-fid="filter-pf"><option value="ALL">All runs</option>${D.periods.map(p => `<option value="${p.id}" ${S.pf === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>`;
    return `<div class="cp">${crumbs([[isEmployee() ? 'My Payslips' : 'Employee Payslips']])}<span class="cap muted">${rows.length ? `1–${rows.length} / ${rows.length}` : ''}</span></div>
      <section class="panel" aria-label="Employee payslips">${isEmployee() ? '' : slipFilters(runFilter + stageFilter())}${rows.length ? table('Employee payslips', 820, SLIP_HEAD(true), rows.map(r => slipRow(r, true)).join('')) : surface('No payslips.', isEmployee() ? 'A payslip appears here after your Agency releases it.' : 'Nothing matches.')}</section>`;
  },
  runs() {
    const list = S.sample === 'empty' ? [] : D.periods, home = { dest: 'runs', view: 'tree', record: '' };
    if (S.view === 'form') {
      const p = period(S.record) || list[0];
      if (!p) return surface('No payroll runs.', 'Create the first run for a calendar month.');
      S.record = p.id;
      const t = p.v ? totals(p) : null, tab = S.tab === 'approvals' ? 'approvals' : 'payslips', st = structOf(p), money = n => t ? peso(n) : '<span class="muted">—</span>';
      const slips = p.emps.map(e => ({ id: slipId(p, e), p, e }));
      return `<div class="cp">${crumbs([['Payroll Runs', home], [p.name]])}${pager(list, p.id, x => ({ dest: 'runs', view: 'form', record: x.id, tab }))}</div>
        <div class="ab"><div class="actions">${runActions(p)}</div>${statusbar(p)}</div>${runWarnings(p)}
        ${p.replacedBy ? `<div class="msg msg-danger" role="status">Voided: “${esc(p.voided.reason)}” Replaced by ${openLink(period(p.replacedBy).name, { dest: 'runs', view: 'form', record: p.replacedBy }, 'replaced')}.</div>` : ''}
        <div class="formwrap"><section class="panel sheet" aria-label="Payroll run"><div class="sheet-title"><span>Payroll run</span><h2>${esc(p.name)}</h2></div>
          ${fields([['Period', range(p.from, p.to)], ['Gross pay', money(t && t.gross)], ['Cutoff', dtt(p.cutoff)], ['Deductions', money(t && t.ded)], ['Payment date', dt(p.pay)], ['Net pay', money(t && t.net), true],
            ['Structure', openLink(st.name, { dest: 'structures', view: 'form', record: st.id }, 'struct-link')], ['Calculation', p.status === 'CALCULATING' ? `${p.v + 1} computing` : p.v || 'Not computed'], ['Reference', `<span class="code">${p.id}</span>`]])}
          ${tabs(['payslips', 'approvals'], tab, { payslips: `Payslips · ${p.emps.length}`, approvals: 'Approvals' })}
          <div id="tabpanel" role="tabpanel" aria-labelledby="tab-${tab}" class="sec">${tab === 'approvals' ? approvals(p) : table('Payslips of this run', 640, SLIP_HEAD(false), slips.map(r => slipRow(r)).join(''), '', 'plain')}</div></section>${historyPanel(p)}</div>`;
    }
    const head = `<div class="cp">${crumbs([['Payroll Runs']])}<div class="row">${viewSwitch(['tree', 'kanban'])}${can('periods.create') ? '<button type="button" class="btn btn-primary" data-act="period-new" data-fid="period-new">New payroll run</button>' : ''}</div></div>`;
    const open = p => ({ dest: 'runs', view: 'form', record: p.id });
    if (!list.length) return head + `<section class="panel">${surface('No payroll runs.', 'Create the first run for a calendar month.')}</section>`;
    if (S.view === 'kanban') return head + `<section class="panel" aria-label="Runs by status"><div class="board" tabindex="0" role="region" aria-label="Runs by status">${Object.keys(STAGE_TAG).map(k => { const col = list.filter(p => stageOf(p) === k); return `<section class="col" aria-labelledby="col-${k}"><h3 id="col-${k}">${tag(STAGE_TAG[k])}<span class="muted">${col.length}</span></h3>${col.length ? col.map(p => `<button type="button" class="card" data-go='${esc(JSON.stringify(open(p)))}' data-fid="card-${p.id}"><strong>${esc(p.name)}</strong><span class="cap muted">${count(p.emps.length, 'payslip')} · pays ${dt(p.pay)}</span><span>${p.v ? peso(totals(p).net) : '—'}</span></button>`).join('') : '<p class="cap muted" style="padding:8px 4px">None</p>'}</section>`; }).join('')}</div></section>`;
    return head + `<section class="panel" aria-label="Payroll runs">${table('Payroll runs', 760, ['Payroll run', 'Period', 'Payment date', '#Payslips', '#Net pay', 'Status'], list.map(p => `<tr><th scope="row">${openLink(p.name, open(p), 'run-' + p.id)}</th><td class="nowrap">${range(p.from, p.to)}</td><td class="nowrap">${dt(p.pay)}</td><td class="num">${p.emps.length}</td><td class="num">${p.v ? peso(totals(p).net) : '<span class="muted">—</span>'}</td><td>${tag(STAGE_TAG[stageOf(p)])}</td></tr>`).join(''))}</section>`;
  },
};
