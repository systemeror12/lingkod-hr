/* ---------- Round 2 · C · Month bar: pick the month at the top of Employee Payslips; its stage and one next button sit in that bar ---------- */
const V = {
  key: 'c', letter: 'C', name: 'Month bar', nav: ['payslips', 'reports', 'structures', 'rules'],
  payslips() {
    const home = { dest: 'payslips', view: 'tree', record: '' };
    if (S.view === 'form') {
      const x = slipById(S.record) || slipRows(isEmployee() ? undefined : currentRun().id)[0];
      if (!x) return surface('No payslips.', 'Payslips appear when a payroll run is created.');
      S.record = x.id; if (!isEmployee()) S.pf = x.p.id;
      return slipForm(x, { crumbs: [[isEmployee() ? 'My Payslips' : 'Employee Payslips', home], [`${EMP[x.e].name} · ${x.p.name}`]], list: isEmployee() ? slipRows() : slipRows(x.p.id), mk: r => ({ dest: 'payslips', view: 'form', record: r.id, tab: S.tab }) });
    }
    if (isEmployee()) { const rows = slipRows(); return `<div class="cp">${crumbs([['My Payslips']])}</div><section class="panel" aria-label="My payslips">${rows.length ? table('My payslips', 640, SLIP_HEAD(true), rows.map(r => slipRow(r, true)).join('')) : surface('No payslips.', 'A payslip appears here after your Agency releases it.')}</section>`; }
    const p = currentRun(), at = D.periods.indexOf(p), rows = slipRows(p.id), t = p.v ? totals(p) : null, acts = runActions(p);
    const step = (i, l, sym) => `<button type="button" class="btn btn-secondary btn-sm" aria-label="${l} run" ${D.periods[i] ? `data-go='${esc(JSON.stringify({ dest: 'payslips', view: 'tree', record: '', pf: D.periods[i].id }))}'` : 'disabled'} data-fid="run-${l}">${sym}</button>`;
    return `<div class="cp">${crumbs([['Employee Payslips']])}${can('periods.create') ? '<button type="button" class="btn btn-primary" data-act="period-new" data-fid="period-new">New payroll run</button>' : ''}</div>
      <section class="panel" aria-label="Employee payslips of ${esc(p.name)}">
        <div class="pbar"><div class="pick">${step(at + 1, 'Earlier', '‹')}${runPicker()}${step(at - 1, 'Later', '›')}</div>${statusbar(p)}</div>
        <div class="subbar"><div class="actions">${acts || '<span class="cap muted">Nothing for your role to do on this run.</span>'}</div><span class="cap muted" style="margin-left:auto">${range(p.from, p.to)} · pays ${dt(p.pay)}</span></div>
        ${runWarnings(p) ? `<div style="padding:12px 16px 0">${runWarnings(p)}</div>` : ''}
        ${S.sample === 'empty' ? surface('No payslips.', 'This run has no payslips.') : table('Employee payslips', 640, SLIP_HEAD(false), rows.map(r => slipRow(r)).join(''), t ? `<tr><th scope="row" colspan="3">${count(t.n, 'payslip')} computed</th><td class="num">${peso(t.net)}</td><td></td></tr>` : '')}
        <details style="padding:12px 16px;border-top:1px solid var(--border)" ${S.tab === 'approvals' ? 'open' : ''}><summary class="small" style="cursor:pointer;font-weight:650">Approvals</summary><div style="margin-top:10px">${approvals(p)}</div></details>
      </section>`;
  },
};
