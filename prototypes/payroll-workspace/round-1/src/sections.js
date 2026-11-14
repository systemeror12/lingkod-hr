/* ---------- small renderers ---------- */
function panel(title, actions, body, flush) {
  return `<section class="panel" aria-label="${esc(title)}"><div class="panel-head"><h2>${esc(title)}</h2>${actions ? `<div class="row">${actions}</div>` : ''}</div>${flush ? body : `<div class="panel-body">${body}</div>`}</section>`;
}
function surface(title, text, page) { return `<div class="surface${page ? ' page' : ''}" role="status"><strong>${esc(title)}</strong><p>${text}</p></div>`; }
function btn(label, act, id, kind, off) {
  return `<button type="button" class="btn ${kind || 'btn-secondary'} btn-sm" data-act="${act}" data-id="${esc(id || '')}" data-fid="${act}:${esc(id || '')}" ${off ? 'disabled' : ''}>${esc(label)}</button>`;
}
function openLink(label, o, fid) { return `<button type="button" class="linkbtn" data-go='${esc(JSON.stringify(o))}' data-fid="${esc(fid || 'go:' + JSON.stringify(o))}">${esc(label)}</button>`; }
function search(placeholder) { return `<label class="field">Search<input class="input" type="search" data-filter="q" data-fid="filter-q" value="${esc(S.q)}" placeholder="${esc(placeholder)}"></label>`; }
function selectFilter(key, label, all, map, value) {
  return `<label class="field">${label}<select class="input" data-filter="${key}" data-fid="filter-${key}"><option value="ALL">${all}</option>${Object.entries(map).map(([k, l]) => `<option value="${esc(k)}" ${value === k ? 'selected' : ''}>${esc(Array.isArray(l) ? l[0] : l)}</option>`).join('')}</select></label>`;
}
function periodFilter() { return selectFilter('pf', 'Payroll Period', 'All periods', Object.fromEntries(D.periods.map(p => [p.id, p.id + ' · ' + p.name])), S.pf); }
function matches(text) { return !S.q || text.toLowerCase().includes(S.q.toLowerCase()); }
function tabs(list, current, labels) {
  return `<div class="tabs" role="tablist" aria-label="Record sections">${list.map(t => `<button type="button" role="tab" class="tab" id="tab-${t}" aria-controls="tabpanel" aria-selected="${t === current}" tabindex="${t === current ? 0 : -1}" data-tab="${t}" data-fid="tab-${t}">${esc(labels[t])}</button>`).join('')}</div>`;
}
function tabpanel(current, body) { return `<div id="tabpanel" role="tabpanel" aria-labelledby="tab-${current}" class="sec">${body}</div>`; }
function timeline(items) {
  if (!items || !items.length) return '<p class="muted small">No history recorded.</p>';
  return `<ol class="timeline">${items.slice().reverse().map(x => `<li><span><strong>${esc(x.what)}</strong> · ${esc(x.who)}${x.role ? ', ' + esc(x.role) : ''}</span><span class="muted cap">${esc(dtt(x.at))}</span>${x.note ? `<span class="muted">${esc(x.note)}</span>` : ''}</li>`).join('')}</ol>`;
}
function pager(list, id, mk) {
  const i = list.findIndex(x => x.id === id);
  if (i < 0) return '';
  const prev = list[i - 1], next = list[i + 1], b = (x, l) => `<button type="button" class="btn btn-secondary btn-sm" ${x ? `data-go='${esc(JSON.stringify(mk(x)))}'` : 'disabled'} data-fid="pager-${l}">${l}</button>`;
  return `<div class="pager"><span class="cap muted">${i + 1} of ${list.length}</span>${b(prev, 'Previous')}${b(next, 'Next')}</div>`;
}
function board(map, list, keyFn, cardFn, goFn, heads) {
  return `<div class="board" tabindex="0" role="region" aria-label="Status board">${Object.keys(map).map(k => {
    const col = list.filter(x => keyFn(x) === k);
    return `<section class="col" aria-labelledby="col-${k}"><h3 id="col-${k}">${heads ? heads(k) : tag(map[k])}<span class="muted">${col.length}</span></h3>
      ${col.length ? col.map(x => `<button type="button" class="card" data-go='${esc(JSON.stringify(goFn(x)))}' data-fid="card-${esc(x.id)}" ${x.id === S.record ? 'aria-current="true"' : ''}>${cardFn(x)}</button>`).join('') : '<p class="cap muted" style="padding:12px 4px">None</p>'}</section>`;
  }).join('')}</div>`;
}
function table(label, min, head, rows, foot) {
  return `<div class="scroll" tabindex="0" role="region" aria-label="${esc(label)}"><table class="tbl" style="min-width:${min}px"><thead><tr>${head.map(h => `<th scope="col"${h.startsWith('#') ? ' class="num"' : ''}>${esc(h.replace(/^#/, ''))}</th>`).join('')}</tr></thead><tbody>${rows}</tbody>${foot ? `<tfoot>${foot}</tfoot>` : ''}</table></div>`;
}
const who = (o, verb) => o ? `${verb ? verb + ' by ' : ''}${esc(o.by)} · ${dtt(o.at)}` : '';

/* ---------- the stage rail: calculated, certified, reviewed, approved, finalized ---------- */
function stageRail(p) {
  const cell = (k, cls, v, w) => `<li class="stage ${cls}"><span class="k">${k}</span><span class="v">${v}</span><span class="w">${w}</span></li>`;
  const cur = p.versions.find(x => x.v === p.v), out = [];
  const voided = p.status === 'VOIDED';
  if (p.status === 'CALCULATING') out.push(cell('Calculated', 'todo next', `Calculation ${p.v + 1} running`, `No results yet · started ${dtt(p.calcStarted)}`));
  else if (!p.v) out.push(cell('Calculated', 'todo next', 'Not calculated', 'Waiting on the Payroll Preparer'));
  else if (p.status === 'DRAFT') out.push(cell('Calculated', 'todo next', `Calculation ${p.v} returned`, 'On record; superseded when recalculated'));
  else out.push(cell('Calculated', 'done', `Calculation ${p.v}`, `${dtt(cur.at)} · hash ${totals(p).hash}`));
  out.push(p.cert ? cell('Certified', 'done', 'Certified', `${esc(p.cert.by)} · ${dtt(p.cert.at)} · locks calculation ${p.cert.v}`)
    : cell('Certified', 'todo' + (p.status === 'FOR_REVIEW' ? ' next' : ''), 'Not certified', p.status === 'FOR_REVIEW' ? (blockers(p).length ? `Blocked by ${count(blockers(p).length, 'exception')}` : 'Waiting on the HR Certifying Officer') : 'Needs a completed calculation'));
  const rv = (label, r) => `<li>${label}: ${r ? `<strong>Confirmed</strong> · ${esc(r.by)} · ${dtt(r.at)}` : 'no review recorded'}</li>`;
  const n = (p.reviews.budget ? 1 : 0) + (p.reviews.accounting ? 1 : 0);
  out.push(cell('Reviewed', n === 2 ? 'done' : 'todo' + (p.status === 'CERTIFIED' ? ' next' : ''), n === 2 ? 'Both reviews confirmed' : n === 1 ? '1 of 2 reviews confirmed' : 'Not reviewed',
    `<ul>${rv('Budget', p.reviews.budget)}${rv('Accounting', p.reviews.accounting)}</ul>`));
  out.push(p.approval ? cell('Approved', 'done', 'Approved', `${esc(p.approval.by)} · ${dtt(p.approval.at)}`)
    : cell('Approved', 'todo' + (p.status === 'CERTIFIED' && n === 2 ? ' next' : ''), 'Not approved', p.status === 'CERTIFIED' && n === 2 ? 'Waiting on the Payroll Approver' : 'Needs both reviews confirmed'));
  out.push(p.final ? cell('Finalized', voided ? 'done' : 'final', voided ? 'Was finalized' : 'Finalized', `${esc(p.final.by)} · ${dtt(p.final.at)} · ${voided ? 'since voided' : 'immutable'}`)
    : cell('Finalized', 'todo' + (p.status === 'APPROVED' ? ' next' : ''), 'Not finalized', p.status === 'APPROVED' ? 'Waiting on the Payroll Approver' : 'Needs approval'));
  if (voided) out.push(cell('Voided', 'done void', 'Voided', `${esc(p.voided.by)} · ${dtt(p.voided.at)}`));
  return `<ol class="rail" aria-label="Stages of ${esc(p.id)}">${out.join('')}</ol>`;
}
function statusCell(p) { const [t, tone] = pendingWith(p); return `<div class="stack">${tag(PERIOD_STATUS[p.status])}<span class="cap t-${tone === 'muted' ? 'muted' : tone}">${esc(t)}</span></div>`; }
function calcLabel(p) { return p.status === 'CALCULATING' ? `${p.v + 1} running` : p.v ? String(p.v) : 'Not calculated'; }
function netCell(p) {
  if (!p.v) return '<span class="muted">—</span>';
  const t = totals(p), note = p.status === 'FINALIZED' ? '' : p.status === 'VOIDED' ? 'voided' : p.status === 'CALCULATING' ? `calculation ${p.v}, superseded` : p.status === 'DRAFT' ? `calculation ${p.v}, returned` : `calculation ${p.v}, not final`;
  return `${peso(t.net)}${note ? `<span class="blk cap muted">${note}</span>` : ''}`;
}

/* ---------- period actions ---------- */
function periodActions(p) {
  const a = [], why = [];
  const B = (label, act, kind, off) => a.push(`<button type="button" class="btn ${kind || 'btn-secondary'}" data-act="${act}" data-id="${p.id}" data-fid="${act}:${p.id}" ${off ? 'disabled' : ''}>${label}</button>`);
  if (p.status === 'DRAFT' && can('periods.calculate')) {
    B(p.v ? `Recalculate as calculation ${p.v + 1}` : 'Start calculation', 'calc-start', 'btn-primary');
    const open = blockers(p).filter(x => x.type === 'NO_PARTIAL_MONTH_RULE' && !held(p, x.emp));
    if (open.length) why.push(`${open[0].id} is open with no Payroll Hold. Calculating now raises it again.`);
  }
  if (p.status === 'FOR_REVIEW') {
    const b = blockers(p).length;
    if (can('periods.certify')) { B(`Certify calculation ${p.v}`, 'certify', 'btn-primary', b > 0); if (b) why.push(`Certify is off: ${count(b, 'blocking exception')} open, and a blocking exception can’t be waived.`); }
    if (can('periods.return')) B('Return for correction', 'return');
  }
  if (p.status === 'CERTIFIED') {
    [['budget', 'periods.review_funding', 'Budget'], ['accounting', 'periods.review_accounting', 'Accounting']].forEach(([k, perm, label]) => {
      if (!can(perm)) return;
      if (p.reviews[k]) why.push(`Your ${label} review is recorded. A review can’t be changed.`);
      else { B(`Confirm ${label} review`, k + '-confirm', 'btn-primary'); B('Return this snapshot', k + '-return', 'btn-danger'); }
    });
    if (can('periods.approve')) {
      const need = [!p.reviews.budget && 'Budget', !p.reviews.accounting && 'Accounting'].filter(Boolean);
      B('Approve payroll', 'approve', 'btn-primary', need.length > 0);
      if (need.length) why.push(`Approve is off: the ${need.join(' and ')} ${need.length > 1 ? 'reviews are' : 'review is'} not recorded.`);
    }
    if (can('periods.revoke_certification')) B('Revoke certification', 'revoke', 'btn-danger');
  }
  if (p.status === 'APPROVED' && can('periods.finalize')) { B('Finalize payroll', 'finalize', 'btn-primary'); B('Return before finalization', 'return-approved', 'btn-danger'); }
  return a.length || why.length ? `<div class="sec"><div class="actions">${a.join('')}</div>${why.map(w => `<p class="cap muted">${esc(w)}</p>`).join('')}</div>` : '';
}
function protoJobs(p) {
  const gen = Object.values(p.payslips).some(s => s.status === 'GENERATING') || Object.values(p.outputs).some(o => o.status === 'GENERATING');
  if (p.status !== 'CALCULATING' && !gen) return '';
  return `<div class="proto"><div class="actions"><span><strong>Prototype control.</strong> The API finishes this work in the background.</span>
    ${p.status === 'CALCULATING' ? btn(`Let calculation ${p.v + 1} finish`, 'calc-finish', p.id) : btn('Let generation finish', 'jobs-finish', p.id)}</div></div>`;
}
function periodFacts(p) {
  const f = [['Run type', p.run === 'REGULAR' ? 'Regular' : 'Special'], ['Coverage', range(p.from, p.to)], ['Cutoff', dtt(p.cutoff)], ['Payment date', dt(p.pay)], ['Calculation version', calcLabel(p)], ['Employees', p.emps.length]];
  if (p.components) f.push(['Pays', p.components.join(', ')]);
  return `<dl class="facts">${f.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
}
function totalsBlock(p, v) {
  if (!p.v) return `<dl class="totals">${['Gross pay', 'Deductions', 'Net pay', 'Government share'].map(k => `<div class="total pending"><dt>${k}</dt><dd class="v">Not calculated</dd><dd class="src">No calculation has completed</dd></div>`).join('')}</dl>`;
  const t = totals(p, v), vv = v || p.v;
  const src = p.status === 'FINALIZED' ? `Finalized · calculation ${vv}` : p.status === 'VOIDED' ? 'Voided payroll' : p.status === 'CALCULATING' || p.status === 'DRAFT' || vv !== p.v ? `Calculation ${vv} · superseded on recalculation` : `Calculation ${vv} · not final`;
  const pend = p.status === 'CALCULATING' || p.status === 'DRAFT' || vv !== p.v;
  const c = (k, n, cls) => `<div class="total ${pend ? 'pending' : ''} ${cls || ''}"><dt>${k}</dt><dd class="v">${peso(n)}</dd><dd class="src">${src}</dd></div>`;
  return `<dl class="totals">${c('Gross pay', t.gross)}${c('Deductions', t.ded)}${c('Net pay', t.net, 'net')}${c('Government share', t.employer)}</dl>
    <p class="cap muted">${count(t.n, 'Employee result')}${p.emps.length - t.n ? ` · ${count(p.emps.length - t.n, 'Employee')} without a result` : ''} · hash ${t.hash}. Government share has no effect on net pay.</p>`;
}

/* ---------- Employee results and Payroll Lines ---------- */
function employeesSection(p) {
  const running = p.status === 'CALCULATING' ? `<div class="msg msg-warning" role="status">Calculation ${p.v + 1} is running and has no results yet.${p.v ? ` Calculation ${p.v} is shown below. It is superseded when the new one completes.` : ''}</div>` : '';
  if (!p.v) return running + surface('No results yet.', 'Employee results appear when the first calculation completes.');
  const v = S.ver && S.ver <= p.v ? +S.ver : p.v;
  const note = p.status === 'DRAFT' ? `<div class="msg msg-info" role="status">Returned for correction. Calculation ${p.v} stays on record and is superseded when recalculated.</div>` : '';
  const pick = p.versions.length > 1 ? `<label class="field" style="width:260px">Calculation version<select class="input" data-filter="ver" data-fid="filter-ver">${p.versions.slice().reverse().map(x => `<option value="${x.v}" ${x.v === v ? 'selected' : ''}>Calculation ${x.v} · ${x.v === p.v ? 'current' : 'superseded, kept on record'}</option>`).join('')}</select></label>` : '';
  const rows = p.emps.filter(e => matches(EMP[e].name + ' ' + EMP[e].no)).map(e => {
    const x = EMP[e], ex = excFor(p, e).filter(z => z.status === 'OPEN');
    const name = `<th scope="row">${openLink(x.name, V.openResult(p, e), 'emp-' + e)}<span class="blk cap muted" style="font-weight:400">${x.no} · ${esc(x.pos)}</span></th>`;
    if (!hasResult(p, e)) {
      const h = held(p, e);
      return `<tr>${name}<td>${tag(['No result', 'neutral'], true)}</td><td colspan="4" class="muted">${h ? `Held out under a Payroll Hold placed by ${esc(h.by)}. The held month is paid later as a Payroll Adjustment.` : `Blocked by ${ex.map(z => z.id).join(', ')}. No amount was calculated.`}</td></tr>`;
    }
    const r = result(p, e, v);
    return `<tr>${name}<td>${tag(v === p.v ? RESULT_STATUS[r.status] : ['Superseded', 'neutral'])}</td><td class="num">${peso(r.gross)}</td><td class="num">${peso(r.ded)}</td><td class="num"><strong>${peso(r.net)}</strong></td><td>${ex.length ? ex.map(z => `<span class="blk">${tag(SEVERITY[z.severity])} ${z.id}</span>`).join('') : '<span class="muted">None open</span>'}</td></tr>`;
  }).join('');
  const t = totals(p, v);
  return `${running}${note}<div class="row" style="align-items:flex-end;gap:12px">${search('Employee name or number')}${pick}</div>
    <div class="inset">${table('Employee results', 860, ['Employee', 'Result', '#Gross pay', '#Deductions', '#Net pay', 'Open exceptions'], rows || `<tr><td colspan="6" class="muted">No Employee matches.</td></tr>`,
    `<tr><th scope="row" colspan="2">${count(t.n, 'result')} · calculation ${v}</th><td class="num">${peso(t.gross)}</td><td class="num">${peso(t.ded)}</td><td class="num">${peso(t.net)}</td><td></td></tr>`)}</div>`;
}
const LINE_GROUPS = [['EARNING', 'Earnings · add to net pay'], ['DEDUCTION', 'Deductions · subtract from net pay'], ['EMPLOYER_SHARE', 'Government share · no effect on net pay'], ['INFORMATIONAL', 'Informational · no effect on net pay']];
function linesTable(r) {
  const rows = LINE_GROUPS.map(([type, label]) => {
    const ls = r.lines.filter(l => l.type === type);
    if (!ls.length) return '';
    return `<tr class="sub"><th colspan="6" scope="colgroup">${label}</th></tr>` + ls.map(l => `<tr><th scope="row">${esc(l.c)}</th><td class="nowrap">${esc(l.qty)}</td><td class="nowrap">${esc(l.rate)}</td><td class="num"><strong>${peso(l.amount)}</strong></td><td>${esc(l.rule)}</td><td><ul class="prov">${l.src.map(s => `<li>${esc(s)}</li>`).join('')}</ul></td></tr>`).join('');
  }).join('');
  return `<div class="inset">${table('Payroll Lines', 1040, ['Payroll Line', 'Quantity', 'Rate', '#Amount', 'Rule version', 'Source records'], rows,
    `<tr><th scope="row" colspan="3">Net pay = earnings − deductions</th><td class="num">${peso(r.net)}</td><td colspan="2"></td></tr>`)}</div>`;
}
function resultDetail(p, emp, v) {
  const e = EMP[emp], ex = excFor(p, emp);
  const head = `<div class="rec-title"><h3 style="font-size:1rem">${esc(e.name)}</h3>${hasResult(p, emp) ? '' : tag(['No result', 'neutral'], true)}</div>
    <p class="small muted">${e.no} · ${esc(e.pos)} · SG ${e.sg} Step ${e.step}${e.assumed ? ' · assumed duty ' + dt(e.assumed) : ''} · ${esc(p.id)}</p>`;
  const exc = ex.length ? `<div class="sec"><h3>Exceptions for this Employee</h3>${exceptionsTable(ex, {})}</div>` : '';
  if (!p.v) return head + surface('No result yet.', 'This payroll has not been calculated.');
  if (!hasResult(p, emp)) {
    const h = held(p, emp);
    return `${head}<div class="box todo"><strong>No result in this payroll.</strong><span>${h ? `Held out under a Payroll Hold: “${esc(h.reason)}” (${esc(h.by)}, ${dtt(h.at)}). When this payroll is finalized, a Payroll Adjustment opens to pay the held month.` : 'A blocking exception stopped the calculation for this Employee, so there are no Payroll Lines and no amounts.'}</span></div>${exc}`;
  }
  const r = result(p, emp, v || p.v), pend = r.v !== p.v || p.status === 'DRAFT' || p.status === 'CALCULATING';
  const src = pend ? `Calculation ${r.v} · superseded on recalculation` : p.status === 'FINALIZED' ? `Finalized · calculation ${r.v}` : `Calculation ${r.v} · not final`;
  const c = (k, n, cls) => `<div class="total ${pend ? 'pending' : ''} ${cls || ''}"><dt>${k}</dt><dd class="v">${peso(n)}</dd><dd class="src">${src}</dd></div>`;
  return `${head.replace('</h3>', `</h3>${tag(pend ? ['Superseded', 'neutral'] : RESULT_STATUS[r.status])}`)}
    <dl class="totals">${c('Gross pay', r.gross)}${c('Deductions', r.ded)}${c('Net pay', r.net, 'net')}${c('Government share', r.employer)}</dl>
    <div class="sec"><div class="sec-head"><h3>Payroll Lines</h3><span class="lines-key">Every line keeps its quantity, rate, rule version, and source. No line can be edited or overridden.</span></div>${linesTable(r)}
    <p class="cap muted">Result hash ${r.hash}. Recalculating from the same snapshot and inputs gives the same hash.</p></div>${exc}`;
}

/* ---------- exceptions ---------- */
function exceptionNeeds(x) {
  const p = period(x.period);
  if (x.status === 'RESOLVED') return `Resolved · ${esc(x.by)} · ${dtt(x.at)}<span class="blk">${esc(x.reason)}</span>`;
  if (x.status === 'ACKNOWLEDGED') return `Acknowledged · ${esc(x.by)} · ${dtt(x.at)}<span class="blk">“${esc(x.reason)}”</span>`;
  const h = x.emp && held(p, x.emp);
  if (h) return `Payroll Hold placed by ${esc(h.by)}. Clears at the next calculation.`;
  return esc(x.fix || '');
}
function exceptionActions(x) {
  const p = period(x.period);
  if (x.status !== 'OPEN' || !can('exceptions.manage')) return '';
  if (x.severity === 'WARNING') return btn('Acknowledge', 'exc-ack', x.id);
  if (x.type === 'NO_PARTIAL_MONTH_RULE') {
    if (p.status !== 'DRAFT') return '<span class="cap muted">A hold is placed only while the payroll is Draft.</span>';
    return held(p, x.emp) ? btn('Lift hold', 'hold-lift', x.id) : btn('Place Payroll Hold', 'hold-place', x.id, 'btn-primary');
  }
  return '';
}
function exceptionsTable(list, o) {
  const order = x => (x.status === 'OPEN' ? 0 : 2) + (x.severity === 'BLOCKING' ? 0 : 1);
  const rows = list.slice().sort((a, b) => order(a) - order(b)).map(x => `<tr id="row-${x.id}" ${x.id === S.record && S.dest === 'exceptions' ? 'aria-current="true"' : ''}>
    <th scope="row">${o.open ? openLink(x.id, o.open(x), 'exc-' + x.id) : x.id}<span class="blk" style="font-weight:400;max-width:340px">${esc(x.title)}</span></th>
    ${o.showPeriod ? `<td>${openLink(x.period, V.openPeriod(x.period), 'excp-' + x.id)}<span class="blk cap muted">calculation ${x.v}</span></td>` : ''}
    <td>${x.emp ? esc(EMP[x.emp].name) : 'Whole payroll'}</td>
    <td><div class="stack">${tag(SEVERITY[x.severity])}<span class="cap muted">${x.severity === 'BLOCKING' ? 'Stops certification. Can’t be waived.' : 'Doesn’t block. Acknowledge with a reason.'}</span></div></td>
    <td>${tag(EXC_STATUS[x.status])}</td>
    <td style="max-width:360px"><span class="small">${esc(x.detail)}</span><span class="blk cap muted" style="margin-top:4px">${exceptionNeeds(x)}</span></td>
    <td>${exceptionActions(x)}</td></tr>`).join('');
  return `<div class="inset">${table('Exceptions', o.showPeriod ? 1180 : 1040, ['Exception', ...(o.showPeriod ? ['Payroll Period'] : []), 'Applies to', 'Severity', 'Status', 'Reason and what it needs', 'Action'], rows)}</div>`;
}
function exceptionsSection(p) {
  const list = exceptionsOf(p);
  if (!list.length) return surface('No exceptions.', p.v ? `Calculation ${p.v} raised none.` : 'Exceptions are raised by a calculation.');
  const b = blockers(p).length, w = openWarnings(p).length;
  return `<p class="small ${b ? 't-danger' : 'muted'}">${b ? `<strong>${count(b, 'blocking exception')} open.</strong> This payroll can’t be certified until ${b === 1 ? 'it is' : 'they are'} resolved or the Employee is held out.` : 'No blocking exception is open.'} ${w ? count(w, 'warning') + ' not acknowledged.' : ''}</p>${exceptionsTable(list, {})}`;
}

/* ---------- certification, checkpoint reviews, approval, finalization ---------- */
function reviewSection(p) {
  const box = (title, done, label, body) => `<div class="box ${done ? '' : 'todo'}"><div class="sec-head"><h3>${title}</h3>${tag(label, !done)}</div>${body}</div>`;
  const t = p.v ? totals(p) : null;
  const rv = (k, label, role) => {
    const r = p.reviews[k];
    return box(`${label} checkpoint review`, !!r, r ? ['Confirmed', 'info'] : [p.cpre && !p.cpre.superseded ? 'No review recorded' : 'Not open', 'neutral'],
      r ? `<span>${who(r, 'Confirmed')}</span><span class="muted">Against ${p.cpre.id}. It confirms that exact snapshot and asserts no external posting.</span>`
        : `<span class="muted">${p.status === 'CERTIFIED' ? `Waiting on the ${role}. A reviewer who is only waiting records nothing.` : 'Opens when the payroll is certified and its review export exists.'}</span>`);
  };
  const actors = Object.entries(FUNCTIONS).map(([k, l]) => { const person = Object.keys(p.actors).find(n => p.actors[n] === k); return `<tr><th scope="row">${l}</th><td>${person ? esc(person) : '<span class="muted">No one has acted yet</span>'}</td></tr>`; }).join('');
  return `<div class="check">
    ${box('HR certification', !!p.cert, p.cert ? ['Certified', 'info'] : ['Not certified', 'neutral'], p.cert ? `<span>${who(p.cert, 'Certified')}</span><span class="muted">Locks calculation ${p.cert.v} · hash ${t.hash}. Personnel, attendance, and leave inputs.</span>` : `<span class="muted">${p.status === 'FOR_REVIEW' ? (blockers(p).length ? `Blocked: ${count(blockers(p).length, 'blocking exception')} open.` : 'Waiting on the HR Certifying Officer.') : 'Needs a completed calculation that is For review.'}</span>`)}
    ${box('Certified Payroll Review Export', !!p.cpre && !p.cpre.superseded, p.cpre ? (p.cpre.superseded ? ['Superseded', 'neutral'] : ['Generated', 'info']) : ['Not generated', 'neutral'], p.cpre ? `<span>${p.cpre.id} · ${dtt(p.cpre.at)} · calculation ${p.cpre.v}</span><span class="muted">${p.cpre.superseded ? 'Superseded when certification was revoked. Its reviews are revoked.' : 'One immutable snapshot for both reviews. It asserts no fund validation, obligation, or accounting posting.'}</span>` : '<span class="muted">Generated at certification, from the certified calculation.</span>')}
    ${rv('budget', 'Budget', 'Budget Officer')}${rv('accounting', 'Accounting', 'Accounting Reviewer')}
    ${box('Approval', !!p.approval, p.approval ? ['Approved', 'info'] : ['Not approved', 'neutral'], p.approval ? `<span>${who(p.approval, 'Approved')}</span><span class="muted">Approved is not finalized: lines aren’t immutable yet and no output exists.</span>` : '<span class="muted">Needs certification and both checkpoint reviews confirmed.</span>')}
    ${box('Finalization', !!p.final, p.final ? (p.status === 'VOIDED' ? ['Voided after finalization', 'danger'] : ['Finalized', 'success']) : ['Not finalized', 'neutral'], p.final ? `<span>${who(p.final, 'Finalized')}</span><span class="muted">${p.status === 'VOIDED' ? `Voided ${dtt(p.voided.at)} by ${esc(p.voided.by)}. The original stays readable.` : 'Lines are immutable. Every correction is a later linked record.'}</span>` : '<span class="muted">Checks the approved hash, open exceptions, and line totals in one transaction, then fails if anything changed after approval.</span>')}
  </div>
  <div class="sec"><div class="sec-head"><h3>One person, one function on this payroll</h3><span class="lines-key">A second function is refused, with no override.</span></div>
  <div class="inset">${table('Functions on this payroll', 420, ['Function', 'Person'], actors)}</div></div>`;
}

/* ---------- payslips ---------- */
function payslipsSection(p) {
  if (p.status !== 'FINALIZED' && p.status !== 'VOIDED') return surface('No payslips yet.', `Payslips are generated after finalization. ${esc(p.id)} is ${PERIOD_STATUS[p.status][0]}.`);
  const c = slipCounts(p), ready = c.READY;
  const rows = Object.entries(p.payslips).map(([e, s]) => {
    const r = result(p, e);
    let act = '';
    if (s.status === 'READY' && can('payslips.withhold')) act = btn('Withhold', 'slip-withhold', p.id + '|' + e, 'btn-danger');
    if (s.status === 'WITHHELD' && can('payslips.release')) act = btn('Release', 'slip-release', p.id + '|' + e);
    const when = s.status === 'RELEASED' ? who(s, 'Released') : s.status === 'WITHHELD' ? `${who(s, 'Withheld')}<span class="blk muted">“${esc(s.reason)}”</span>` : s.status === 'GENERATING' ? '<span class="muted">The PDF isn’t stored yet.</span>' : s.status === 'READY' ? '<span class="muted">Stored. The Employee can’t read it until it is released.</span>' : '<span class="muted">Superseded when the payroll was voided.</span>';
    return `<tr><th scope="row">${esc(EMP[e].name)}<span class="blk cap muted" style="font-weight:400">${EMP[e].no}</span></th><td class="num">${peso(r.net)}</td><td>${tag(SLIP_STATUS[s.status])}</td><td class="small">${when}</td><td>${act}</td></tr>`;
  }).join('');
  const summary = Object.entries(c).filter(([, n]) => n).map(([k, n]) => `${SLIP_STATUS[k][0]} ${n}`).join(' · ');
  return `<div class="sec-head"><p class="small"><strong>${summary}</strong><span class="blk cap muted">Release is one command for every Ready payslip. It doesn’t wait on Disbursement Outcomes, and withholding a payslip never stops payment.</span></p>
    ${can('payslips.release') ? `<button type="button" class="btn btn-primary" data-act="slip-release-all" data-id="${p.id}" data-fid="slip-release-all:${p.id}" ${ready ? '' : 'disabled'}>Release ${ready ? count(ready, 'Ready payslip') : 'payslips'}</button>` : ''}</div>
    <div class="inset">${table('Payslips', 760, ['Employee', '#Net pay', 'Payslip', 'Released or withheld', 'Action'], rows)}</div>`;
}

/* ---------- Payment Export and Disbursement Outcomes ---------- */
function paymentSection(p) {
  if (p.status === 'VOIDED') return surface('No Payment Export.', 'This payroll was voided before any Payment Export was generated.');
  if (p.status !== 'FINALIZED') return surface('No Payment Export yet.', `A Payment Export comes only from a finalized payroll. ${esc(p.id)} is ${PERIOD_STATUS[p.status][0]}.`);
  if (!p.export) {
    const miss = p.missingDest || [];
    return `<div class="box todo"><div class="sec-head"><h3>Payment Export</h3>${tag(['Not generated', 'neutral'], true)}</div>
      <span class="muted">One Payment Instruction per positive net pay. Generating it marks no one paid.</span>
      ${miss.length ? `<div class="msg msg-danger" role="status"><strong>Blocked.</strong> ${miss.map(e => esc(EMP[e].name)).join(', ')} has no designated disbursement destination. One missing destination blocks the whole export.</div>
        <div class="proto"><div class="actions"><span><strong>Prototype control.</strong> The destination is recorded in Personnel.</span>${btn('Record the destination', 'dest-fix', p.id)}</div></div>` : ''}
      ${can('exports.generate') ? `<div class="actions"><button type="button" class="btn btn-primary" data-act="export-generate" data-id="${p.id}" data-fid="export-generate:${p.id}">Generate Payment Export</button></div>` : '<span class="cap muted">Your role can’t generate the Payment Export.</span>'}</div>`;
  }
  const x = p.export, live = liveInstructions(p), by = {};
  live.forEach(i => { by[latest(i)] = (by[latest(i)] || 0) + 1; });
  const amount = i => result(p, i.emp).net, settled = sum(live.filter(i => latest(i) === 'SETTLED'), amount), total = sum(live, amount);
  const rows = x.instructions.map(i => {
    const l = latest(i), act = [];
    if (!i.supersededBy && can('disbursement.update')) {
      if (l !== 'SETTLED' && l !== 'REJECTED') act.push(btn('Record outcome', 'outcome', p.id + '|' + i.id));
      if (l === 'REJECTED') act.push(btn('Supersede instruction', 'supersede', p.id + '|' + i.id, 'btn-primary'));
    }
    return `<tr><th scope="row">${i.id}<span class="blk cap muted" style="font-weight:400">${esc(EMP[i.emp].name)}${i.supersedes ? ' · replaces ' + i.supersedes : ''}</span></th><td>${EMP[i.emp].acct}</td><td class="num">${peso(amount(i))}</td>
      <td>${i.supersededBy ? tag(['Superseded by ' + i.supersededBy, 'neutral']) : tag(OUTCOME[l], l === 'NONE')}</td>
      <td><ol class="prov" style="list-style:decimal;padding-left:16px">${i.outcomes.length ? i.outcomes.map(o => `<li><strong>${OUTCOME[o.status][0]}</strong> · ${dtt(o.at)} · ${esc(o.ref || 'no reference')}${o.note ? ' · ' + esc(o.note) : ''}</li>`).join('') : '<li style="list-style:none;margin-left:-16px">None recorded. Not paid.</li>'}</ol></td>
      <td><div class="actions">${act.join('')}</div></td></tr>`;
  }).join('');
  return `<dl class="dl"><div><dt>Payment Export</dt><dd>${x.id}</dd></div><div><dt>Generated</dt><dd>${who(x)}</dd></div><div><dt>Checksum</dt><dd>${x.checksum}</dd></div><div><dt>From</dt><dd>${esc(p.id)} · finalized calculation ${p.v}</dd></div></dl>
    <div class="msg msg-info" role="status">Generating this export marked no one paid. Each Payment Instruction is paid only when a <strong>Settled</strong> outcome is recorded: <strong>${peso(settled)}</strong> of ${peso(total)} settled.
      ${Object.entries(by).map(([k, n]) => `${OUTCOME[k][0]} ${n}`).join(' · ')}.</div>
    <div class="inset">${table('Payment Instructions', 1040, ['Payment Instruction', 'Destination', '#Amount', 'Latest outcome', 'Disbursement Outcomes, in order', 'Action'], rows)}</div>`;
}

/* ---------- register, reports, schedules, exports ---------- */
function reportsSection(p) {
  const rows = [];
  if (p.cpre) rows.push(`<tr><th scope="row">Certified Payroll Review Export<span class="blk cap muted" style="font-weight:400">${p.cpre.id}</span></th><td>${tag(p.cpre.superseded || p.status === 'VOIDED' ? OUTPUT_STATUS.SUPERSEDED : OUTPUT_STATUS.READY)}</td><td class="small">${dtt(p.cpre.at)} · at certification</td><td class="small">Certified calculation ${p.cpre.v}</td><td>${p.cpre.superseded ? '' : btn('Download', 'download', p.cpre.id)}</td></tr>`);
  if (p.status === 'FINALIZED' || p.status === 'VOIDED') Object.entries(OUTPUTS).forEach(([k, label]) => {
    const o = p.outputs[k], st = p.status === 'VOIDED' ? (o ? 'SUPERSEDED' : 'NONE') : o ? o.status : 'NONE';
    const act = st === 'READY' ? btn('Download', 'download', label) : st === 'NONE' && p.status === 'FINALIZED' && can('outputs.generate') ? btn('Generate', 'output-generate', p.id + '|' + k) : '';
    rows.push(`<tr><th scope="row">${label}</th><td>${tag(OUTPUT_STATUS[st], st === 'NONE')}</td><td class="small">${o ? who(o) : '<span class="muted">—</span>'}${st === 'GENERATING' ? '<span class="blk muted">Requested. The file isn’t stored yet.</span>' : ''}</td><td class="small">${o ? `${esc(p.id)} · finalized calculation ${p.v}` : '<span class="muted">—</span>'}</td><td>${act}</td></tr>`);
  });
  const pre = p.status !== 'FINALIZED' && p.status !== 'VOIDED' ? `<div class="msg msg-info" role="status">The register, variance report, remittance schedules, and accounting export come only from a finalized payroll. ${esc(p.id)} is ${PERIOD_STATUS[p.status][0]}.</div>` : '';
  return `${pre}${rows.length ? `<div class="inset">${table('Outputs', 860, ['Output', 'Status', 'Generated', 'From', 'Action'], rows.join(''))}</div>` : surface('No outputs yet.', 'The review export appears at certification. Everything else follows finalization.')}
    <p class="cap muted">These are LingkodHR’s own reports and Structured Exports. None claims to be a COA or BIR form (#617).</p>`;
}
function historySection(p) {
  return `<div class="sec"><h3>Calculation versions</h3><div class="inset">${table('Calculation versions', 520, ['Version', 'Completed', 'State'], p.versions.length ? p.versions.slice().reverse().map(x => `<tr><th scope="row">Calculation ${x.v}</th><td>${dtt(x.at)}</td><td>${x.v === p.v ? (p.status === 'DRAFT' || p.status === 'CALCULATING' ? 'Latest, returned. Kept on record.' : 'Current') : 'Superseded. Kept on record.'}</td></tr>`).join('') : '<tr><td colspan="3" class="muted">No calculation has completed.</td></tr>')}</div></div>
    <div class="sec"><h3>Audit history</h3>${timeline(p.history)}</div>`;
}

/* ---------- period Tree and Kanban, shared by the variants ---------- */
function filteredPeriods() {
  if (S.sample === 'empty') return [];
  return D.periods.filter(p => (S.status === 'ALL' || p.status === S.status) && matches(p.id + ' ' + p.name));
}
function periodsTree(list) {
  const rows = list.map(p => `<tr id="row-${p.id}" ${p.id === S.record ? 'aria-current="true"' : ''}>
    <th scope="row">${openLink(p.id, V.openPeriod(p.id), 'open-' + p.id)}<span class="blk cap muted" style="font-weight:400;max-width:260px">${esc(p.name)}</span></th>
    <td>${p.run === 'REGULAR' ? 'Regular' : 'Special'}${p.components ? `<span class="blk cap muted" style="max-width:200px">${esc(p.components.join(', '))}</span>` : ''}</td>
    <td class="nowrap">${range(p.from, p.to)}</td><td class="nowrap">${dt(p.pay)}</td><td>${statusCell(p)}</td><td>${calcLabel(p)}</td><td class="num">${p.emps.length}</td><td class="num">${netCell(p)}</td></tr>`).join('');
  return table('Payroll Periods table', 1120, ['Payroll Period', 'Run', 'Coverage', 'Payment date', 'Status and who holds it', 'Calculation', '#Employees', '#Net pay'], rows);
}
function periodsBoard(list) {
  return board(PERIOD_STATUS, list, p => p.status, p => `<span class="k">${p.id}</span><strong>${esc(p.name)}</strong><span class="cap t-${pendingWith(p)[1] === 'muted' ? 'muted' : pendingWith(p)[1]}">${esc(pendingWith(p)[0])}</span><span class="cap muted">${p.v ? `Net ${peso(totals(p).net)} · calculation ${p.v}` : 'Not calculated'} · pays ${dt(p.pay)}</span>`, p => V.openPeriod(p.id));
}
function periodsEmpty() {
  return S.sample === 'empty' ? surface('No Payroll Periods yet.', can('periods.create') ? 'Create the first regular period for a calendar month.' : 'A Payroll Preparer creates the first period.') : surface('No periods match.', 'Clear the search or choose another status.');
}
function periodFilters() { return `<div class="filters">${search('Period code or name')}${selectFilter('status', 'Status', 'All statuses', PERIOD_STATUS, S.status)}</div>`; }
function linkedPeriods(p) {
  const out = [];
  if (p.replacedBy) out.push(`<div class="msg msg-danger" role="status">Voided ${dtt(p.voided.at)} by ${esc(p.voided.by)}, requested by ${esc(p.voided.requestedBy)}: “${esc(p.voided.reason)}” (${esc(p.voided.doc)}). The original stays readable. Replaced by ${openLink(p.replacedBy, V.openPeriod(p.replacedBy), 'replaced-by')}.</div>`);
  if (p.replaces) out.push(`<div class="msg msg-info" role="status">Replaces the voided payroll ${openLink(p.replaces, V.openPeriod(p.replaces), 'replaces')} for the same month.</div>`);
  return out.join('');
}

/* ---------- the Employee's own payslips ---------- */
function mySlips() { return D.periods.filter(p => p.payslips[SELF] && p.payslips[SELF].status === 'RELEASED').sort((a, b) => b.pay.localeCompare(a.pay)); }
function slipDoc(p, mode) {
  const r = result(p, SELF), e = EMP[SELF], s = p.payslips[SELF];
  const line = l => {
    const how = mode === 'inline' && l.how ? `<span class="how">${esc(l.how)}</span>` : mode === 'expand'
      ? `<details><summary>How this was reached</summary><p style="margin:6px 0">${esc(l.how)}</p><ul class="prov" style="max-width:none"><li><strong>Quantity</strong> ${esc(l.qty)} · <strong>Rate</strong> ${esc(l.rate)}</li><li><strong>Rule</strong> ${esc(l.rule)}</li>${l.src.map(x => `<li><strong>Source</strong> ${esc(x)}</li>`).join('')}</ul></details>` : '';
    return `<div class="slip-line"><span>${esc(l.c)}</span><span class="amt">${peso(l.amount)}</span>${how}</div>`;
  };
  const col = (title, type, total) => `<section aria-label="${title}"><h3>${title}</h3>${r.lines.filter(l => l.type === type).map(line).join('')}<div class="slip-sum"><span>Total ${title.toLowerCase()}</span><span class="amt">${peso(total)}</span></div></section>`;
  return `<article class="slip" aria-label="Payslip for ${esc(p.name)}">
    <div class="slip-head"><div><p class="cap muted">${AGENCY}</p><h2 style="font-size:1.125rem">Payslip · ${esc(p.name)}</h2>
      <p class="small muted">${esc(e.name)} · ${e.no} · ${esc(e.pos)}</p><p class="small muted">Coverage ${range(p.from, p.to)} · payment date ${dt(p.pay)} · released ${dtt(s.at)}</p></div>
      <div class="slip-net"><span class="cap muted">Net pay</span><span class="v">${peso(r.net)}</span><span class="cap muted">${peso(r.gross)} earnings − ${peso(r.ded)} deductions</span></div></div>
    <div class="slip-cols">${col('Earnings', 'EARNING', r.gross)}${col('Deductions', 'DEDUCTION', r.ded)}</div>
    ${r.employer ? `<section aria-label="Government share"><h3>Paid by the government for you</h3><p class="cap muted">Not part of your pay and not deducted from it.</p>${r.lines.filter(l => l.type === 'EMPLOYER_SHARE').map(l => `<div class="slip-line"><span>${esc(l.c)}</span><span class="amt">${peso(l.amount)}</span></div>`).join('')}</section>` : ''}
    <p class="cap muted">This payslip states what was calculated in the finalized payroll ${esc(p.id)}, calculation ${p.v}. It isn’t proof of payment; payment is recorded separately.</p>
    <div class="actions">${btn('Download PDF', 'download', 'your payslip for ' + p.name)}<button type="button" class="btn btn-secondary btn-sm" data-act="print" data-fid="print">Print</button></div></article>`;
}
function slipsTree(list, mk) {
  if (!list.length) return surface('No released payslips yet.', 'A payslip appears here after your Agency releases it.');
  const rows = list.map(p => { const r = result(p, SELF); return `<tr ${p.id === S.record ? 'aria-current="true"' : ''}><th scope="row">${openLink(p.name, mk(p), 'slip-' + p.id)}<span class="blk cap muted" style="font-weight:400">${p.run === 'REGULAR' ? 'Regular payroll' : 'Special payroll'}</span></th><td class="nowrap">${dt(p.pay)}</td><td class="nowrap">${dtt(p.payslips[SELF].at)}</td><td class="num">${peso(r.gross)}</td><td class="num">${peso(r.ded)}</td><td class="num"><strong>${peso(r.net)}</strong></td></tr>`; }).join('');
  return table('My payslips', 720, ['Payslip', 'Payment date', 'Released', '#Earnings', '#Deductions', '#Net pay'], rows) + '<p class="cap muted" style="padding:10px 16px">Only released payslips are listed.</p>';
}
