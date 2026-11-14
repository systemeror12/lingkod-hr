/* ---------- Round 2 · A · Payslips only: one list, grouped by run; the run's buttons sit on its group row and on each payslip ---------- */
const newRun = () => can('periods.create') ? '<button type="button" class="btn btn-primary" data-act="period-new" data-fid="period-new">New payroll run</button>' : '';
const V = {
  key: 'a', letter: 'A', name: 'Payslips only', nav: ['payslips', 'reports', 'structures', 'rules'],
  payslips() {
    const home = { dest: 'payslips', view: 'tree', record: '' };
    if (S.view === 'form') {
      const x = slipById(S.record) || slipRows()[0];
      if (!x) return surface('No payslips.', 'Payslips appear when a payroll run is created.');
      S.record = x.id;
      return slipForm(x, { crumbs: [[isEmployee() ? 'My Payslips' : 'Employee Payslips', home], [`${EMP[x.e].name} · ${x.p.name}`]], list: isEmployee() ? slipRows() : slipRows(x.p.id), mk: r => ({ dest: 'payslips', view: 'form', record: r.id, tab: S.tab }), runActions: true, approvals: true });
    }
    const rows = slipRows(), head = `<div class="cp">${crumbs([[isEmployee() ? 'My Payslips' : 'Employee Payslips']])}<div class="row">${isEmployee() ? '' : viewSwitch(['tree', 'kanban'])}${newRun()}</div></div>`;
    if (!rows.length) return head + `<section class="panel">${slipFilters(isEmployee() ? '' : stageFilter())}${surface('No payslips.', isEmployee() ? 'A payslip appears here after your Agency releases it.' : 'Nothing matches, or no run exists yet.')}</section>`;
    if (S.view === 'kanban') return head + `<section class="panel" aria-label="Payslips by status">${slipBoard(rows)}</section>`;
    if (isEmployee()) return head + `<section class="panel" aria-label="My payslips">${table('My payslips', 640, SLIP_HEAD(true), rows.map(r => slipRow(r, true)).join(''))}</section>`;
    const body = D.periods.filter(p => rows.some(r => r.p === p)).map(p => {
      const mine = rows.filter(r => r.p === p), net = sum(mine, r => netOf(p, r.e) || 0), w = runWarnings(p);
      return `<tr class="grp"><th colspan="5" scope="colgroup"><div class="ginner"><div class="gleft"><button type="button" class="rowbtn" aria-expanded="${groupOpen(p)}" data-group="${p.id}" data-fid="group-${p.id}">${esc(p.name)}</button>${tag(STAGE_TAG[stageOf(p)])}<span class="cap muted" style="font-weight:400">${count(mine.length, 'payslip')}${p.v ? ' · net ' + peso(net) : ''}</span></div><div class="actions">${runActions(p)}</div></div></th></tr>${groupOpen(p) ? `${w ? `<tr><td colspan="5">${w}</td></tr>` : ''}${mine.map(r => slipRow(r)).join('')}` : ''}`;
    }).join('');
    return head + `<section class="panel" aria-label="Employee payslips">${slipFilters(stageFilter())}${table('Employee payslips', 760, SLIP_HEAD(false), body)}</section>`;
  },
};
