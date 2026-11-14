/* ---------- shell ---------- */
const VARIANTS = [['a', 'A', 'Period file'], ['b', 'B', 'Work desk'], ['c', 'C', 'Linked registers']];
function render() {
  const fid = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.fid : null;
  normalize();
  document.title = `${V.dests[S.dest].label} · ${V.letter} ${V.name} · Payroll prototype`;
  document.getElementById('app').innerHTML = shell();
  const want = S.focus || fid;
  S.focus = null;
  const el = want && [...document.querySelectorAll('[data-fid]')].find(x => x.dataset.fid === want);
  if (el) { el.focus({ preventScroll: want !== 'flash' }); if (el.type === 'search') el.setSelectionRange(el.value.length, el.value.length); }
}
function normalize() {
  const allowed = V.nav.filter(d => can(V.dests[d].perm));
  if (!allowed.includes(S.dest)) { if (S.dest) { S.view = 'tree'; S.record = ''; } S.dest = allowed[0] || V.nav[0]; }
  if (!V.dests[S.dest].views.includes(S.view)) S.view = V.dests[S.dest].views[0];
}
function shell() {
  const r = me(), dests = V.nav.filter(d => can(V.dests[d].perm));
  const stages = ['Structure', 'Merit selection', 'Personnel', 'Time & attendance', 'Leave', 'Overtime'];
  return `<div class="shell">
  <aside class="nav" ${S.navOpen ? 'data-open' : ''}>
    <div class="nav-brand"><span class="nav-mark" aria-hidden="true">L</span><span>LingkodHR</span>
      <button type="button" class="nav-toggle" data-act="nav" aria-expanded="${S.navOpen}" aria-controls="primary-navigation" data-fid="nav-toggle">${S.navOpen ? 'Close' : 'Menu'}</button></div>
    <div class="nav-agency"><span>Agency context</span><strong>${AGENCY}</strong></div>
    <nav id="primary-navigation" class="nav-list" aria-label="Primary">
      ${stages.map(s => `<div class="nav-stage">${s}</div>`).join('')}
      <div class="nav-stage on" id="stage-payroll">Payroll</div>
      <ul aria-labelledby="stage-payroll">${dests.map(d => `<li><a class="nav-link" href="${urlFor({ dest: d, view: 'tree', record: '', tab: '', sub: '' })}" data-nav="${d}" data-fid="nav-${d}" ${d === S.dest ? 'aria-current="page"' : ''}>${V.dests[d].label}${V.badge ? V.badge(d) : ''}</a></li>`).join('')}
        ${isEmployee() ? '' : V.inert.map(l => `<li class="nav-inert">${l}</li>`).join('')}</ul>
      <div class="nav-stage">Oversight</div>
      <p class="nav-note">Only Payroll works in this prototype.${isEmployee() ? '' : ' The grey Payroll entries show where the other tickets would sit.'}</p>
    </nav>
    <div class="nav-user"><span class="avatar" aria-hidden="true">${r.person.split(' ').map(w => w[0]).slice(0, 2).join('')}</span><span class="who"><strong>${esc(r.person)}</strong><span>${esc(r.label)}</span></span></div>
  </aside>
  <main id="main">${page()}${controls()}</main>
</div>${switcher()}`;
}
function switcher() {
  return `<nav class="switcher" aria-label="Prototype variants"><span>#327</span>${VARIANTS.map(([k, l, n]) => `<a href="${k}.html?role=${S.role}" title="${l} · ${n}" aria-label="Variant ${l}, ${n}" ${k === V.key ? 'aria-current="page"' : ''}>${l}</a>`).join('')}<a href="compare.html" title="Comparison page">Compare</a></nav>`;
}
function page() {
  const meta = V.dests[S.dest];
  const viewSw = meta.views.length > 1 ? `<div class="viewsw" role="group" aria-label="Record view">${meta.views.map(v => `<button type="button" aria-pressed="${S.view === v}" data-view="${v}" data-fid="view-${v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div>` : '';
  const primary = S.dest === 'periods' && can('periods.create') ? `<button type="button" class="btn btn-primary" data-act="period-new" data-fid="period-new">Create Payroll Period</button>` : '';
  const flashMsg = S.flash ? `<div class="msg msg-${S.flash.tone}" role="status" tabindex="-1" data-fid="flash">${esc(S.flash.text)}</div>` : '';
  return `<header class="page-header"><nav aria-label="Breadcrumb"><ol class="crumbs"><li>Payroll</li></ol></nav>
    <div class="title-row"><h1>${meta.label}</h1><div class="row">${viewSw}${primary}</div></div></header>
    <p class="lede">${meta.lede}</p>${flashMsg}${body()}`;
}
function body() {
  const meta = V.dests[S.dest];
  if (S.sample === 'denied' || !can(meta.perm)) return surface(meta.label + ' aren’t available to you.', 'Your role, ' + esc(me().label) + ', doesn’t include reading ' + esc(meta.label) + '. Ask your HR Administrator if you need access.', true);
  if (S.sample === 'loading') return `<div class="surface page" role="status" aria-live="polite"><strong>Loading ${esc(meta.label)}…</strong><p>Records appear when the API answers.</p></div>`;
  return V.body();
}
function controls() {
  const stages = [['DRAFT', 'Draft, returned with exceptions'], ['CALCULATING', 'Calculating'], ['FOR_REVIEW', 'For review'], ['CERTIFIED', 'Certified, no reviews yet'], ['REVIEWED', 'Certified, both reviews confirmed'], ['APPROVED', 'Approved'], ['FINALIZED', 'Finalized, payslips generating'], ['RELEASED', 'Finalized, payslips released, export generated']];
  return `<details class="proto"><summary>Prototype controls</summary><div class="grid">
    <label class="field">Preview role<select class="input" data-role data-fid="role">${Object.entries(ROLES).map(([k, r]) => `<option value="${k}" ${k === S.role ? 'selected' : ''}>${esc(r.label)} · ${esc(r.person)}</option>`).join('')}</select></label>
    <label class="field" style="width:320px">Jump the November payroll to<select class="input" data-jump data-fid="jump">${stages.map(([k, l]) => `<option value="${k}" ${k === D.stage ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="field">Sample state<select class="input" data-samplesel data-fid="sample">${[['live', 'Live sample data'], ['empty', 'Empty'], ['loading', 'Loading'], ['denied', 'Permission denied']].map(([k, l]) => `<option value="${k}" ${k === S.sample ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <button type="button" class="btn btn-secondary" data-act="reset" data-fid="reset">Reset sample data</button></div>
    <p class="cap muted" style="margin-top:8px">Synthetic data for ${AGENCY}. Today is ${dt(TODAY)}. Every name and amount is made up, and no figure here is a payroll rule. Actions persist in this tab, across variants, until reset.</p></details>`;
}

/* ---------- dialogs ---------- */
let ASK = null;
function ask(o) {
  ASK = o;
  const d = document.getElementById('dlg');
  d.innerHTML = `<form class="dlg" method="dialog" data-ask><div class="dlg-head"><h2 id="dlg-title">${esc(o.title)}</h2><p id="dlg-desc" class="small muted">${o.desc || ''}</p></div>
    ${o.fields || o.label ? `<div class="dlg-body">${o.fields || ''}${o.label ? `<label class="field">${esc(o.label)}<textarea class="input" name="reason" required></textarea>${o.hint ? `<span class="hint">${o.hint}</span>` : ''}</label>` : ''}</div>` : ''}
    <div class="dlg-foot"><button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="submit" class="btn ${o.danger ? 'btn-solid-danger' : 'btn-primary'}">${esc(o.confirm)}</button></div></form>`;
  d.showModal();
}
const HANDLERS = {
  nav() { S.navOpen = !S.navOpen; },
  reset() { try { sessionStorage.removeItem(STORE); } catch (e) { /* ignore */ } D = seedData(); flash('Sample data reset.'); },
  print() { window.print(); },
  download(id) { flash(`Prototype: “${id}” would download as the stored file.`, 'info'); },
  'period-new'() {
    const open = D.periods.find(p => p.run === 'REGULAR' && !['FINALIZED', 'VOIDED'].includes(p.status));
    flash(open ? `Refused for a regular period: ${open.id} isn’t finalized, and an Agency has one open regular period at a time. A special period would name the components it pays.` : 'Prototype: creating the next period isn’t part of this round.', open ? 'danger' : 'info');
  },
  'calc-start'(id) { const p = period(id); ask({ title: `Start calculation ${p.v + 1} of ${p.id}?`, desc: `It takes a rule snapshot and uses every input accepted by the cutoff, ${dtt(p.cutoff)}. Until it completes, ${p.id} has no current results.`, confirm: 'Start calculation', onOk: () => ACT.calcStart(p) }); },
  'calc-finish'(id) { ACT.calcFinish(period(id)); },
  'jobs-finish'(id) { ACT.jobsFinish(period(id)); },
  return(id) { ask({ title: 'Return for correction', desc: 'The payroll goes back to Draft so the Payroll Preparer can correct inputs and recalculate.', label: 'Review comment', confirm: 'Return to Draft', danger: true, onOk: r => ACT.returnForCorrection(period(id), r) }); },
  certify(id) { const p = period(id), t = totals(p); ask({ title: `Certify calculation ${p.v} of ${p.id}?`, desc: `You certify the personnel, attendance, and leave inputs of ${count(t.n, 'Employee result')}, net ${peso(t.net)}, hash ${t.hash}. Certifying locks the payroll at this calculation and generates the Certified Payroll Review Export. It does not approve the payroll.`, confirm: 'Certify', onOk: () => ACT.certify(p) }); },
  revoke(id) { ask({ title: 'Revoke certification', desc: 'The payroll returns to For review. Its review export is superseded and both checkpoint reviews are revoked.', label: 'Reason', confirm: 'Revoke certification', danger: true, onOk: r => ACT.revoke(period(id), r) }); },
  'budget-confirm'(id) { const p = period(id); ask({ title: `Confirm the Budget review of ${p.cpre.id}?`, desc: 'You confirm this exact certified snapshot. It asserts no external fund validation or obligation, and it can’t be changed afterwards.', confirm: 'Confirm Budget review', onOk: () => ACT.review(p, 'budget', 'CONFIRMED', '') }); },
  'accounting-confirm'(id) { const p = period(id); ask({ title: `Confirm the Accounting review of ${p.cpre.id}?`, desc: 'You confirm this exact certified snapshot. It asserts no accounting posting, and it can’t be changed afterwards.', confirm: 'Confirm Accounting review', onOk: () => ACT.review(p, 'accounting', 'CONFIRMED', '') }); },
  'budget-return'(id) { ask({ title: 'Return this snapshot', desc: 'The payroll goes back to For review. Certification is revoked, the export is superseded, and the Accounting review is revoked.', label: 'Why it is returned', confirm: 'Return', danger: true, onOk: r => ACT.review(period(id), 'budget', 'RETURNED', r) }); },
  'accounting-return'(id) { ask({ title: 'Return this snapshot', desc: 'The payroll goes back to For review. Certification is revoked, the export is superseded, and the Budget review is revoked.', label: 'Why it is returned', confirm: 'Return', danger: true, onOk: r => ACT.review(period(id), 'accounting', 'RETURNED', r) }); },
  approve(id) { const p = period(id), t = totals(p); ask({ title: `Approve ${p.id}?`, desc: `Calculation ${p.v}, certified by ${esc(p.cert.by)}, with both checkpoint reviews confirmed. Net ${peso(t.net)}. Approving does not finalize: lines stay open to a return, and no payslip or export exists until you finalize.`, confirm: 'Approve payroll', onOk: () => ACT.approve(p) }); },
  'return-approved'(id) { ask({ title: 'Return before finalization', desc: 'The payroll goes back to For review, and its certification and reviews are revoked.', label: 'Reason', confirm: 'Return', danger: true, onOk: r => ACT.returnApproved(period(id), r) }); },
  finalize(id) { const p = period(id), t = totals(p); ask({ title: `Finalize ${p.id}?`, desc: `Finalizing checks the approved hash ${t.hash}, open exceptions, and line totals in one transaction. After it, every line is immutable and a correction is a later linked record. Payslips start generating; none is released.`, confirm: 'Finalize payroll', onOk: () => ACT.finalize(p) }); },
  'slip-release-all'(id) { const p = period(id); ask({ title: `Release ${count(slipCounts(p).READY, 'Ready payslip')}?`, desc: 'Each Employee can read their own payslip once it is released. Release doesn’t wait on Disbursement Outcomes and says nothing about payment.', confirm: 'Release payslips', onOk: () => ACT.releaseAll(p) }); },
  'slip-withhold'(id) { const [pid, emp] = id.split('|'); ask({ title: `Withhold ${EMP[emp].name}’s payslip`, desc: 'The Employee can’t read it until it is released. Withholding never stops payment.', label: 'Authorized reason', confirm: 'Withhold payslip', danger: true, onOk: r => ACT.withhold(period(pid), emp, r) }); },
  'slip-release'(id) { const [pid, emp] = id.split('|'); ACT.releaseOne(period(pid), emp); },
  'dest-fix'(id) { ACT.destFix(period(id)); },
  'export-generate'(id) { ACT.exportGenerate(period(id)); },
  outcome(id) {
    const [pid, iid] = id.split('|'), p = period(pid), i = p.export.instructions.find(x => x.id === iid), l = latest(i);
    const next = { NONE: ['SUBMITTED'], SUBMITTED: ['ACCEPTED', 'REJECTED'], ACCEPTED: ['SETTLED', 'REJECTED'] }[l] || [];
    ask({
      title: `Record a Disbursement Outcome for ${i.id}`, desc: `${esc(EMP[i.emp].name)} · ${peso(result(p, i.emp).net)} · latest: ${OUTCOME[l][0]}. Outcomes are evidence from outside LingkodHR and are only ever added.`,
      fields: `<label class="field">Outcome<select class="input" name="status">${next.map(s => `<option value="${s}">${OUTCOME[s][0]}</option>`).join('')}</select></label><label class="field">Evidence reference<input class="input" name="ref" required placeholder="Batch, acknowledgment, or advice number"></label><label class="field">Note<input class="input" name="note"></label>`,
      confirm: 'Record outcome', onOk: (r, f) => ACT.outcome(p, iid, f.get('status'), f.get('ref'), f.get('note')),
    });
  },
  supersede(id) { const [pid, iid] = id.split('|'); ask({ title: `Supersede ${iid}?`, desc: 'A new Payment Instruction replaces the rejected one. The rejected instruction and its outcomes stay on record.', confirm: 'Supersede instruction', onOk: () => ACT.supersede(period(pid), iid) }); },
  'output-generate'(id) { const [pid, k] = id.split('|'); ACT.outputGenerate(period(pid), k); },
  'exc-ack'(id) { const x = D.exceptions.find(e => e.id === id); ask({ title: `Acknowledge ${x.id}`, desc: esc(x.detail), label: 'Reason', hint: 'A warning is acknowledged with a reason. A blocking exception can’t be acknowledged or waived.', confirm: 'Acknowledge warning', onOk: r => ACT.ack(x, r) }); },
  'hold-place'(id) { const x = D.exceptions.find(e => e.id === id); ask({ title: `Place a Payroll Hold on ${EMP[x.emp].name}`, desc: `${esc(EMP[x.emp].name)} gets no result in ${x.period}, so the rest of the Agency can be paid. The held month is paid later as a Payroll Adjustment.`, label: 'Reason', confirm: 'Place Payroll Hold', onOk: r => ACT.hold(x, r) }); },
  'hold-lift'(id) { ACT.liftHold(D.exceptions.find(e => e.id === id)); },
};

/* ---------- events ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-close],[data-go],[data-act],[data-tab],[data-view],[data-nav],[data-month]');
  if (!t) return;
  if (t.dataset.close !== undefined) return document.getElementById('dlg').close();
  if (t.dataset.go) return go(JSON.parse(t.dataset.go));
  if (t.dataset.nav) { e.preventDefault(); S.navOpen = false; return go({ dest: t.dataset.nav, view: 'tree', record: '' }); }
  if (t.dataset.tab) return go({ tab: t.dataset.tab }, true);
  if (t.dataset.month) return go({ record: t.dataset.month }, true);
  if (t.dataset.view) return go({ view: t.dataset.view, tab: S.tab });
  S.flash = null;
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
document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.filter && t.type === 'search') { S[t.dataset.filter] = t.value; render(); }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.filter && t.type !== 'search') { S[t.dataset.filter] = t.value; render(); }
  else if (t.dataset.role !== undefined) { S.role = t.value; S.flash = null; go({ dest: '', view: 'tree', record: '' }); }
  else if (t.dataset.jump !== undefined) { jumpTo(t.value); flash(`Prototype: the November payroll is now at “${t.selectedOptions[0].textContent}”.`, 'info'); render(); }
  else if (t.dataset.samplesel !== undefined) { S.sample = t.value; go({}, true); }
});
document.addEventListener('keydown', e => {
  if (!e.target.matches('[role=tab]') || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  const all = [...e.target.parentElement.children], n = all[(all.indexOf(e.target) + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length];
  S.focus = n.dataset.fid; go({ tab: n.dataset.tab }, true);
});
window.addEventListener('popstate', () => { readUrl(); render(); });

(function init() {
  load();
  const q = readUrl();
  if (q.has('stage')) { jumpTo(q.get('stage')); }
  S._lastDest = S.dest;
  render();
})();
