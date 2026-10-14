// Cash runway forecast. All personal data comes from /api/runway (signed-in only);
// edits auto-save back there so they stick across reloads and devices.

const $ = (id) => document.getElementById(id);
const INPUTS = ['startBal', 'cash', 'sevEnd', 'payAmt', 'ui', 'venmoBal'];

// ---------- data (filled from the store) ----------
// rule: {m:day} monthly | {months:[1-12], d:day} | {dates:[iso]} ; amts = optional per-month (index 0=Jan) amounts
let DATA, ITEMS, ONE_TIME, CAVEATS, BUDGET, SETTINGS, START, DAYS, TODAY, HOLIDAY_SHIFT;
// Budget rows: [id, label, lean, typical, austere, what it covers, history override]
const budget = {};
const state = { on: {}, month: 0 };
const HIST = (b) => (b[6] !== undefined && b[6] !== null ? b[6] : b[3]);
const HIST_TOTAL = () => BUDGET.reduce((a, b) => a + HIST(b), 0);
const budgetTotal = () => Object.values(budget).reduce((a, b) => a + (+b || 0), 0);

// ---------- helpers ----------
const D = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 864e5);
const dim = (y, m0) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
const fmt = (n) => (n < 0 ? '-' : '') + '$' + Math.abs(Math.round(n)).toLocaleString();
const fmt2 = (n) => (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ord = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 >> 3 ^ 1 && n % 10 < 4) ? n % 10 : 0] || 'th');

function charges(item, d) {
  const y = d.getUTCFullYear(), m0 = d.getUTCMonth(), day = d.getUTCDate(), r = item.rule;
  let hit = false;
  if (r.from && iso(d).slice(0, 7) < r.from) return 0;
  if (r.to && iso(d).slice(0, 7) > r.to) return 0;
  if (r.m != null) hit = day === Math.min(r.m, dim(y, m0));
  else if (r.months) hit = r.months.includes(m0 + 1) && day === r.d;
  else if (r.dates) hit = r.dates.includes(iso(d));
  if (!hit) return 0;
  return item.amts ? item.amts[m0] : item.amt;
}

function payDates(sevEnd) {
  const out = []; let d = D(SETTINGS.firstPay); const end = D(sevEnd);
  while (d <= addDays(START, DAYS)) {
    let s = iso(d); if (HOLIDAY_SHIFT[s]) s = HOLIDAY_SHIFT[s];
    if (D(s) <= end) out.push(s);
    d = addDays(d, SETTINGS.payEveryDays || 14);
  }
  return out;
}

function simulate(opt) {
  const pays = new Set(payDates(opt.sevEnd));
  const daily = opt.varSpend * 12 / 365;
  const uiStart = addDays(D(opt.sevEnd), 14);
  let bal = opt.startBal + opt.cash + opt.venmoBal; const days = [];
  for (let i = 0; i < DAYS; i++) {
    const d = addDays(START, i), s = iso(d);
    const ev = []; let net = 0;
    if (pays.has(s)) { net += opt.payAmt; ev.push({ t: 'pay', n: 'Paycheck', a: opt.payAmt }); }
    if (opt.ui > 0 && d >= uiStart && ((d - uiStart) / 864e5) % 7 === 0) { net += opt.ui; ev.push({ t: 'pay', n: 'Unemployment', a: opt.ui }); }
    ITEMS.forEach((it) => {
      if (!state.on[it.id]) return;
      const a = charges(it, d); if (!a) return;
      net -= a; ev.push({ t: it.g === 'Subscriptions' ? 'sub' : (a < 0 ? 'pay' : 'bill'), n: it.name.replace(/ \(.*?\)/, '').replace(/^INCOME: /, ''), a: -a });
    });
    net -= daily;
    bal += net; days.push({ s, d, ev, bal, net });
  }
  return days;
}
function runout(days) { const x = days.find((r) => r.bal < 0); return x ? x.s : null; }
function daysBetween(a, b) { return Math.round((D(b) - D(a)) / 864e5); }
function opts() {
  return { startBal: +$('startBal').value || 0, cash: +$('cash').value || 0, sevEnd: $('sevEnd').value, payAmt: +$('payAmt').value || 0, varSpend: budgetTotal(), ui: +$('ui').value || 0, venmoBal: +$('venmoBal').value || 0 };
}
function monthlyFixed() {
  let t = 0;
  ITEMS.forEach((it) => {
    if (!state.on[it.id]) return;
    const a = it.amts ? it.amts.reduce((x, y) => x + y, 0) / 12 : it.amt;
    const per = it.rule.m != null ? 1 : it.rule.months ? it.rule.months.length / 12 : 1 / 12;
    t += a * per;
  });
  return t;
}

// ---------- render ----------
function render() {
  const o = opts();
  $('varLbl').textContent = fmt(o.varSpend);
  $('budgetTotal').textContent = fmt(o.varSpend) + (o.varSpend < HIST_TOTAL() ? ` (${fmt(HIST_TOTAL() - o.varSpend)} under typical)` : o.varSpend > HIST_TOTAL() ? ` (${fmt(o.varSpend - HIST_TOTAL())} over typical)` : '');
  const days = simulate(o), out = runout(days);
  const lastPay = payDates(o.sevEnd).slice(-1)[0];
  const fixed = monthlyFixed();
  const income = (o.payAmt * 26 / 12);

  // KPIs
  const k = [];
  k.push(['First dip below $0', out ? new Date(out + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '12+ months', out ? `${daysBetween(TODAY, out)} days from today` : 'Balance stays above $0 for the next year', out ? 'neg' : 'pos']);
  k.push(['Fixed bills / month', fmt(fixed), 'Enabled bills & subscriptions only']);
  k.push(['Variable spend / month', fmt(o.varSpend), 'Groceries, food, gas, shopping, cash']);
  k.push(['Paycheck income / month', fmt(income), `Only until ${lastPay || '—'}`]);
  const lpDay = days.find((r) => r.s >= (lastPay || '9999'));
  if (lpDay) k.splice(1, 0, ['Balance after last severance check', fmt(lpDay.bal), lpDay.s, lpDay.bal < 0 ? 'neg' : 'pos']);
  const burn = fixed + o.varSpend;
  k.splice(4, 0, ['Monthly gap WITH severance pay', fmt(burn - income), burn > income ? 'Spending exceeds paycheck income — balance shrinks even while paid' : 'Paycheck covers spending', burn > income ? 'neg' : 'pos']);
  k.push(['Burn with NO pay', fmt(burn) + '/mo', `≈ ${((o.startBal + o.cash) / burn).toFixed(1)} months of runway on ${fmt(o.startBal + o.cash)}`, 'neg']);
  $('kpis').innerHTML = k.map((x) => `<div class="kpi"><div class="l">${x[0]}</div><div class="v ${x[3] || ''}">${x[1]}</div><div class="n">${x[2]}</div></div>`).join('');

  drawChart(days, lastPay);
  drawScenarios(o);
  drawCalendar(days);
}

function drawChart(days, lastPay) {
  const W = 1100, H = 260, pl = 56, pr = 10, pt = 10, pb = 24;
  const vals = days.map((r) => r.bal); let lo = Math.min(0, ...vals), hi = Math.max(...vals);
  lo = Math.max(lo, -6000); // deep negatives are meaningless; clip so the runway region stays readable
  const pad = (hi - lo) * .06 || 500; lo -= pad; hi += pad;
  const x = (i) => pl + i * (W - pl - pr) / (days.length - 1), y = (v) => pt + (hi - Math.max(v, lo)) * (H - pt - pb) / (hi - lo);
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Projected balance">`;
  const ticks = 5;
  for (let t = 0; t <= ticks; t++) { const v = lo + (hi - lo) * t / ticks; svg += `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${pl - 6}" y="${y(v) + 4}" text-anchor="end">${fmt(v)}</text>`; }
  svg += `<line x1="${pl}" x2="${W - pr}" y1="${y(0)}" y2="${y(0)}" stroke="var(--neg)" stroke-dasharray="4 3"/>`;
  const pts = [];
  days.forEach((r, i) => pts.push(`${x(i).toFixed(1)},${y(r.bal).toFixed(1)}`));
  svg += `<polyline fill="none" stroke="var(--accent)" stroke-width="2" points="${pts.join(' ')}"/>`;
  // negative overlay
  let run = []; const flush = () => { if (run.length > 1) svg += `<polyline fill="none" stroke="var(--neg)" stroke-width="2.5" points="${run.join(' ')}"/>`; run = []; };
  days.forEach((r, i) => { if (r.bal < 0) run.push(pts[i]); else flush(); }); flush();
  // month labels
  days.forEach((r, i) => { if (r.d.getUTCDate() === 1) svg += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${r.d.toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' })}</text>`; });
  if (lastPay) { const i = days.findIndex((r) => r.s >= lastPay); if (i >= 0) svg += `<line x1="${x(i)}" x2="${x(i)}" y1="${pt}" y2="${H - pb}" stroke="var(--pay)" stroke-dasharray="3 3"/>`; }
  svg += '</svg>'; $('chart').innerHTML = svg;
}

function drawScenarios(o) {
  const rows = (SETTINGS.scenarios || []).map((r) => [...r]);
  rows.push(['Your setting (' + o.sevEnd + ')', o.sevEnd]);
  let h = '<tr><th>If severance pays…</th><th class="num">Last check</th><th class="num">First dip below $0</th><th class="num">Balance after last check</th><th class="num">Lowest in 90 days</th></tr>';
  rows.forEach(([lbl, end]) => {
    const days = simulate({ ...o, sevEnd: end }); const r = runout(days);
    const lp = payDates(end).slice(-1)[0] || '—';
    h += `<tr><td>${esc(lbl)}</td><td class="num">${lp}</td><td class="num ${r ? 'neg' : 'pos'}">${r || '12+ months'}</td><td class="num">${lp === '—' ? '—' : fmt((days.find((x) => x.s >= lp) || { bal: 0 }).bal)}</td><td class="num">${fmt(Math.min(...days.slice(0, 90).map((x) => x.bal)))}</td></tr>`;
  });
  $('scen').innerHTML = h;
}

function drawCalendar(days) {
  const months = []; days.forEach((r) => { const k = r.s.slice(0, 7); if (!months.includes(k)) months.push(k); });
  if (state.month >= months.length) state.month = 0;
  const tabs = $('monthTabs');
  tabs.innerHTML = months.map((m, i) => { const d = D(m + '-01'); return `<button type="button" class="${i === state.month ? 'on' : ''}" data-i="${i}">${d.toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' })}</button>`; }).join('');
  tabs.querySelectorAll('button').forEach((b) => b.onclick = () => { state.month = +b.dataset.i; drawCalendar(days); save(); });
  const mk = months[state.month], first = D(mk + '-01'), n = dim(first.getUTCFullYear(), first.getUTCMonth());
  const map = {}; days.forEach((r) => map[r.s] = r);
  let h = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((x) => `<div class="dow">${x}</div>`).join('');
  for (let i = 0; i < first.getUTCDay(); i++) h += '<div class="day empty"></div>';
  for (let d = 1; d <= n; d++) {
    const s = mk + '-' + String(d).padStart(2, '0'), r = map[s];
    if (!r) { h += `<div class="day ${s === TODAY ? 'today' : ''}" style="opacity:.5"><div class="dn">${d}</div>${s === TODAY ? '<div class="note">today</div>' : ''}</div>`; continue; }
    const chips = r.ev.map((e) => `<div class="chip ${e.t}" title="${esc(e.n)} ${fmt2(e.a)}">${e.a > 0 ? '+' : '−'}$${Math.abs(Math.round(e.a)).toLocaleString()} ${esc(e.n)}</div>`).join('');
    h += `<div class="day ${r.bal < 0 ? 'neg' : ''}"><div class="dn">${d}</div>${chips}<div class="bal ${r.bal < 0 ? 'neg' : ''}">${fmt(r.bal)}</div></div>`;
  }
  $('cal').innerHTML = h;
}

function drawItems() {
  const groups = [...new Set(ITEMS.map((i) => i.g))];
  let h = '';
  groups.forEach((g) => {
    h += `<h2 style="margin-top:14px">${esc(g)}</h2><table><tr><th></th><th>Charge</th><th class="num">Amount</th><th>When</th><th>Confidence</th><th>Notes</th></tr>`;
    ITEMS.filter((i) => i.g === g).forEach((i) => {
      const when = i.rule.m != null ? ((i.rule.m >= 30 ? 'Last day-ish of month' : `~${ord(i.rule.m)} of each month`) + (i.rule.to ? ` (through ${i.rule.to})` : '')) : i.rule.months ? `Quarterly (~${ord(i.rule.d)} of ${i.rule.months.map((m) => D('2026-' + String(m).padStart(2, '0') + '-01').toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' })).join('/')})` : `Annual — ${i.rule.dates[0]}`;
      const amt = i.amts ? `${fmt(Math.min(...i.amts))}–${fmt(Math.max(...i.amts))}` : fmt2(Math.abs(i.amt));
      const flag = i.conf === 'low' ? '<span class="tag low">verify</span>' : `<span class="tag ${i.conf === 'high' ? 'high' : ''}">${esc(i.conf)}</span>`;
      h += `<tr><td><input type="checkbox" data-id="${esc(i.id)}" ${state.on[i.id] ? 'checked' : ''}></td><td>${esc(i.name)}</td><td class="num">${i.amt < 0 ? '+' : ''}${amt}</td><td>${when}</td><td>${flag}</td><td class="note">${esc(i.note)}</td></tr>`;
    });
    h += '</table>';
  });
  $('items').innerHTML = h;
  $('items').querySelectorAll('input[type=checkbox]').forEach((c) => c.onchange = () => { state.on[c.dataset.id] = c.checked; render(); save(); });
}

function drawStatic() {
  $('onetime').innerHTML = '<tr><th>When</th><th>Item</th><th class="num">Amount</th></tr>' + ONE_TIME.map((r) => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td class="num">${r[2] == null ? '—' : fmt2(r[2])}</td></tr>`).join('');
  $('caveats').innerHTML = CAVEATS.map((c) => `<li style="margin:6px 0">${esc(c)}</li>`).join('');
}

function drawBudget() {
  const grid = $('budgetGrid');
  grid.innerHTML = BUDGET.map((b) => `<div><label>${esc(b[1])}${b[5] ? ` <span title="${esc(b[5])}" style="cursor:help">ⓘ</span>` : ''}</label><input type="number" min="0" step="5" data-b="${esc(b[0])}" value="${+budget[b[0]] || 0}"><div class="note" style="margin-top:3px">${b[6] === 0 ? 'No history' : 'Typical ' + fmt(b[3])} · <span data-d="${esc(b[0])}"></span></div></div>`).join('');
  updateDiffs();
  grid.querySelectorAll('input').forEach((inp) => inp.addEventListener('input', () => { budget[inp.dataset.b] = +inp.value || 0; updateDiffs(); render(); save(); }));
}
function diffText(delta) { return delta < 0 ? `<span class="pos">saves ${fmt(-delta)}/mo</span>` : delta > 0 ? `<span class="neg">${fmt(delta)} over</span>` : 'on par'; }
function updateDiffs() {
  BUDGET.forEach((b) => { const el = document.querySelector(`[data-d="${CSS.escape(b[0])}"]`); if (el) el.innerHTML = diffText((budget[b[0]] || 0) - HIST(b)); });
  const typ = HIST_TOTAL(), now = budgetTotal(), d = now - typ;
  $('budgetVs').innerHTML = `Typical total ${fmt(typ)} · you: ${fmt(now)} · ` + (d < 0 ? `<span class="pos">saving ${fmt(-d)}/mo (${fmt(-d * 12)}/yr)</span>` : d > 0 ? `<span class="neg">${fmt(d)}/mo above typical</span>` : 'same as typical');
}

// ---------- saving ----------
const status = (text) => { $('saveStatus').textContent = text; };
let saveTimer, saving = Promise.resolve();

function snapshot() {
  return {
    inputs: Object.fromEntries(INPUTS.map((id) => [id, $(id).type === 'date' ? $(id).value : +$(id).value || 0])),
    on: { ...state.on },
    budget: { ...budget },
    month: state.month,
  };
}

function save() {
  status('Saving…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const body = JSON.stringify(snapshot());
    saving = saving.then(async () => {
      try {
        const res = await fetch('/api/runway', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body });
        if (res.status === 401) return status('Signed out. Reload to sign in; this change was not saved.');
        if (!res.ok) throw new Error(String(res.status));
        status('Saved ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
      } catch {
        status('Not saved. Check your connection; the next change will retry.');
      }
    });
  }, 600);
}

// Last-chance save if the tab closes while a change is pending.
addEventListener('pagehide', () => {
  if (!saveTimer || !DATA) return;
  clearTimeout(saveTimer);
  fetch('/api/runway', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snapshot()), keepalive: true });
});

// ---------- load ----------
function applyData(data, saved) {
  DATA = data;
  ({ items: ITEMS, oneTime: ONE_TIME = [], caveats: CAVEATS = [], budget: BUDGET, settings: SETTINGS } = data);
  START = D(SETTINGS.start); DAYS = SETTINGS.days || 365; TODAY = SETTINGS.today; HOLIDAY_SHIFT = SETTINGS.holidayShift || {};

  $('title').textContent = data.title || 'Cash Runway Forecast';
  $('subtitle').textContent = data.subtitle || '';
  $('controlNote').textContent = data.controlNote || '';
  document.querySelectorAll('[data-label]').forEach((el) => { el.textContent = data.labels?.[el.dataset.label] ?? el.dataset.label; });

  const inputs = { ...data.defaults, ...saved?.inputs };
  INPUTS.forEach((id) => { $(id).value = inputs[id] ?? ''; });

  Object.keys(state.on).forEach((k) => delete state.on[k]);
  ITEMS.forEach((i) => state.on[i.id] = saved?.on?.[i.id] ?? (i.on !== false));
  Object.keys(budget).forEach((k) => delete budget[k]);
  BUDGET.forEach((b) => budget[b[0]] = saved?.budget?.[b[0]] ?? b[3]);
  state.month = saved?.month ?? 0;

  // Preset labels show each preset's total, e.g. "Lean (~$1,900)".
  document.querySelectorAll('[data-preset]').forEach((btn) => {
    const idx = { lean: 2, typical: 3, austere: 4 }[btn.dataset.preset];
    const total = Math.round(BUDGET.reduce((a, x) => a + (+x[idx] || 0), 0) / 100) * 100;
    btn.textContent = `${btn.textContent.replace(/ \(.*\)$/, '')} (~${fmt(total)})`;
  });

  $('empty').hidden = true;
  $('forecast').hidden = false;
  drawBudget(); drawItems(); drawStatic(); render();
  status(saved?.savedAt ? 'Last saved ' + new Date(saved.savedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
}

async function load() {
  status('Loading…');
  const res = await fetch('/api/runway', { cache: 'no-store' });
  if (res.status === 401) { location.href = '/api/auth/signin?callbackUrl=%2Frunway'; return; }
  if (!res.ok) { status('Could not load the forecast. Try reloading.'); return; }
  const { data, state: saved } = await res.json();
  if (!data) { $('empty').hidden = false; $('dataBox').open = true; status(''); return; }
  applyData(data, saved);
}

// ---------- wiring ----------
document.querySelectorAll('[data-preset]').forEach((b) => b.onclick = () => {
  const idx = { lean: 2, typical: 3, austere: 4 }[b.dataset.preset];
  BUDGET.forEach((x) => budget[x[0]] = x[idx]); drawBudget(); render(); save();
});
INPUTS.forEach((id) => $(id).addEventListener('input', () => { render(); save(); }));

$('resetBtn').onclick = async () => {
  if (!DATA || !confirm('Reset every number, checkbox and budget category back to the original forecast?')) return;
  clearTimeout(saveTimer);
  await saving;
  const res = await fetch('/api/runway', { method: 'DELETE' });
  if (!res.ok) return status('Reset failed. Try again.');
  applyData(DATA, null);
  status('Reset to original');
};

$('exportBtn').onclick = () => {
  if (!DATA) return;
  const blob = new Blob([JSON.stringify({ ...DATA, savedEdits: snapshot() }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `runway-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
};

$('importFile').onchange = async (e) => {
  const file = e.target.files?.[0]; e.target.value = '';
  if (!file) return;
  if (DATA && !confirm('Replace the forecast with this file? Your current edits will be reset.')) return;
  let parsed;
  try { parsed = JSON.parse(await file.text()); } catch { return status('That file is not valid JSON.'); }
  const { savedEdits, ...data } = parsed;
  clearTimeout(saveTimer);
  await saving;
  const res = await fetch('/api/runway', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  if (!res.ok) { const msg = (await res.json().catch(() => ({}))).error; return status(msg || 'Import failed.'); }
  // A backup file carries its edits; restore them too.
  if (savedEdits) await fetch('/api/runway', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(savedEdits) });
  applyData(data, savedEdits || null);
  status('Imported');
};

load();
