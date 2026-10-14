// Runway app UI. One document per person; every change saves automatically.
// "private" mode stores it through /api/runway (signed in); "demo" keeps it in this browser.
import * as E from './engine.js';
import { BILLS, CATEGORIES, INCOME, GOALS, SAVINGS_BY_DEFAULT, ACCOUNTS } from './catalog.js';

const root = document.getElementById('runway');
const MODE = root.dataset.mode;
const view = document.getElementById('view');
const $ = (sel, el = document) => el.querySelector(sel);

// ---------- formatting ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n, cents = false) => (n < 0 ? '−$' : '$') + Math.abs(n).toLocaleString(undefined, cents ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 0 });
const plain = (n) => (n ? String(Math.round(n * 100) / 100) : '');
const dateLabel = (s, opts = { month: 'short', day: 'numeric' }) => E.D(s).toLocaleDateString(undefined, { ...opts, timeZone: 'UTC' });
const ord = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 >> 3 ^ 1 && n % 10 < 4) ? n % 10 : 0] || 'th');
const uid = () => Math.random().toString(36).slice(2, 9);
const today = () => E.todayIso();
const tomorrow = () => E.iso(E.addDays(E.D(today()), 1));
const num = (v) => { const n = parseFloat(String(v).replace(/[^0-9.-]/g, '')); return isFinite(n) ? Math.round(n * 100) / 100 : NaN; };

// ---------- storage ----------
const LOCAL_KEY = 'runway-demo:doc';
const store = MODE === 'demo' ? {
  async load() {
    try { return { doc: JSON.parse(localStorage.getItem(LOCAL_KEY)), legacy: null }; } catch { return { doc: null, legacy: null }; }
  },
  async save(doc) {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(doc)); return true; } catch { return false; }
  },
  async erase() { try { localStorage.removeItem(LOCAL_KEY); } catch { /* storage unavailable */ } return true; },
} : {
  async load() {
    const res = await fetch('/api/runway', { cache: 'no-store' });
    if (res.status === 401) { location.href = '/api/auth/signin?callbackUrl=%2Frunway'; return null; }
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  },
  async save(doc, keepalive = false) {
    const res = await fetch('/api/runway', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(doc), keepalive });
    if (res.status === 401) throw new Error('signed out');
    return res.ok;
  },
  async erase() { return (await fetch('/api/runway', { method: 'DELETE' })).ok; },
};

// Older documents had one balance; it becomes a "Checking" spending account.
const normalize = (d) => ({
  ...E.emptyDoc(), ...d,
  goals: d.goals || [], portfolio: d.portfolio || [],
  accounts: d.accounts?.length ? d.accounts : [{ id: 'checking', name: 'Checking', kind: 'spending' }],
  settings: { ...E.emptyDoc().settings, ...d.settings },
});
let doc = normalize(E.emptyDoc());
let legacy = null;
let focusNext = null; // element id to focus after the next render
const status = (t) => { $('#saveStatus').textContent = t; };
let saveTimer, saving = Promise.resolve(), dirty = false;

function changed() {
  dirty = true;
  refreshPlan();
  render();
  status('Saving…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const snapshot = JSON.parse(JSON.stringify(doc));
    saving = saving.then(async () => {
      try {
        const ok = await store.save(snapshot);
        if (!ok) throw new Error('save failed');
        dirty = false;
        status('Saved ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
      } catch (e) {
        status(e.message === 'signed out' ? 'Signed out. Reload to sign in; recent changes were not saved.' : 'Not saved. Check your connection; the next change will retry.');
      }
    });
  }, 500);
}
addEventListener('pagehide', () => { if (dirty) store.save(doc, true); });

// Edits in place commit on blur, before focus has moved to the next field (or a click has
// landed), so wait for that before re-rendering.
let pointerDown = false, pendingRender = false;
function editedInPlace() {
  if (pointerDown) pendingRender = true; else setTimeout(changed);
}
addEventListener('pointerdown', () => { pointerDown = true; }, true);
addEventListener('pointerup', () => {
  pointerDown = false;
  if (pendingRender) { pendingRender = false; setTimeout(changed); }
}, true);

// ---------- views ----------
const VIEWS = { dashboard: 'Dashboard', checkin: 'Check-in', bills: 'Bills', income: 'Income', budget: 'Everyday budget', goals: 'Savings & goals', investments: 'Investments', settings: 'Settings' };
const current = () => (location.hash.slice(1) in VIEWS ? location.hash.slice(1) : 'dashboard');
addEventListener('hashchange', () => { render(); scrollTo({ top: 0 }); });

// Re-rendering keeps focus on the same field (every input has a stable id), so editing a
// table cell and tabbing to the next one isn't interrupted.
function render() {
  const v = current();
  const active = focusNext || document.activeElement?.id;
  let caret = null;
  try { if (!focusNext) caret = [document.activeElement.selectionStart, document.activeElement.selectionEnd]; } catch { /* not a text field */ }
  focusNext = null;
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === v));
  const grp = $('#planGroup');
  if (grp && grp.querySelector('a.on')) grp.open = true;
  else if (grp && !grp.dataset.ready) { try { if (localStorage.getItem('runway:planOpen') === '0') grp.open = false; } catch { /* storage blocked */ } }
  if (grp && !grp.dataset.ready) {
    grp.dataset.ready = '1';
    grp.addEventListener('toggle', () => { try { localStorage.setItem('runway:planOpen', grp.open ? '1' : '0'); } catch { /* storage blocked */ } });
  }
  const due = $('[data-nav="checkin"] .due');
  const last = E.latestCheckin(doc);
  if (due) due.hidden = !!last && E.daysBetween(last.date, today()) < 7;
  view.innerHTML = { dashboard, checkin, bills, income, budget, goals, investments, settings }[v]();
  if (v === 'investments') drawPortfolio();
  if (v === 'dashboard') drawChart();
  const el = active && document.getElementById(active);
  if (el && view.contains(el)) {
    el.focus({ preventScroll: true });
    try { if (caret && caret[0] != null) el.setSelectionRange(...caret); } catch { /* not a text field */ }
  }
}

function top(extra = '') {
  return `<div class="top"><h1>${VIEWS[current()]}</h1>${extra}</div>`;
}

// ---------- setup checklist ----------
function setupSteps() {
  return [
    ['checkin', "Add today's balance", 'What’s in checking (and cash) right now.', doc.checkins.length > 0],
    ['income', 'Add your income', 'Paychecks or any money that comes in regularly.', doc.income.length > 0],
    ['bills', 'Add your bills', 'Rent, phone, subscriptions: anything that repeats.', doc.bills.length > 0],
    ['budget', 'Set an everyday budget', 'Groceries, dining out, gas and other day-to-day spending.', doc.categories.length > 0],
    ['goals', 'Add savings and goals', 'Savings accounts, an emergency fund, a trip.', doc.goals.length > 0],
  ];
}

function setupPanel() {
  const steps = setupSteps();
  const done = steps.filter((s) => s[3]).length;
  if (doc.settings.setupDone || done === steps.length) return '';
  const next = steps.find((s) => !s[3]);
  return `
    <section class="panel setup">
      <div class="setup-head">
        <div><h2>${doc.checkins.length ? 'Finish setting up' : 'Welcome to Runway'}</h2>
          <p class="muted">${doc.checkins.length ? `${done} of ${steps.length} done. Each step makes the forecast more accurate.` : 'Five quick steps. Everything starts blank, and you can change anything later.'}</p></div>
        <button class="linkbtn" type="button" data-act="skip-setup">Skip setup</button>
      </div>
      <div class="bar"><i style="width:${done / steps.length * 100}%"></i></div>
      <ol class="steps">${steps.map(([v, t, d, ok]) => `<li class="${ok ? 'done' : v === next[0] ? 'next' : ''}"><a href="#${v}"><span class="mark">${ok ? '✓' : ''}</span><span><b>${t}</b><span class="muted">${d}</span></span></a></li>`).join('')}</ol>
      ${MODE === 'demo' && !doc.checkins.length ? '<p class="muted small">Just looking? <button class="linkbtn" type="button" data-act="sample">Load sample numbers</button> to see a filled-in example.</p>' : ''}
    </section>`;
}

// ---------- pie charts ----------
const PALETTE = ['var(--p1)', 'var(--p2)', 'var(--p3)', 'var(--p4)', 'var(--p5)', 'var(--p6)', 'var(--p7)', 'var(--p8)'];
function donut(segs, center, sub) {
  const total = segs.reduce((a, s) => a + Math.max(0, s.value), 0);
  const R = 70, C = 2 * Math.PI * R;
  let off = 0, arcs = '';
  if (total > 0) for (const s of segs) {
    const len = Math.max(0, s.value) / total * C;
    if (len > 0) arcs += `<circle r="${R}" cx="90" cy="90" fill="none" stroke="${s.color}" stroke-width="26" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}"><title>${esc(s.label)}: ${money(s.value)}</title></circle>`;
    off += len;
  }
  return `<div class="donut">
      <svg viewBox="0 0 180 180" role="img" aria-label="${esc(segs.map((s) => `${s.label} ${money(s.value)}`).join(', '))}">
        <g transform="rotate(-90 90 90)"><circle r="${R}" cx="90" cy="90" fill="none" stroke="var(--line)" stroke-width="26"/>${arcs}</g>
        <text x="90" y="88" text-anchor="middle" class="d-big">${center}</text><text x="90" y="108" text-anchor="middle" class="d-sub">${sub}</text>
      </svg>
      <ul class="d-legend">${segs.map((s) => `<li><i style="background:${s.color}"></i><span>${esc(s.label)}</span><b>${money(s.value)}</b><span class="s">${total > 0 ? Math.round(Math.max(0, s.value) / total * 100) : 0}%</span></li>`).join('')}</ul>
    </div>`;
}

function monthDonut() {
  const p = E.monthPlan(doc);
  const segs = [
    { label: 'Bills', value: p.bills, color: 'var(--p1)' },
    { label: 'Everyday spending', value: p.everyday, color: 'var(--p2)' },
    { label: 'Savings & goals', value: p.saving, color: 'var(--p3)' },
  ];
  if (p.left > 0) segs.push({ label: 'Not planned yet', value: p.left, color: 'var(--p8)' });
  const note = p.income <= 0 ? 'Add income to see how your month splits up.'
    : p.left < 0 ? `Your plan is <b class="bad">${money(-p.left)} a month more</b> than your income.`
      : p.left > 0 ? `${money(p.left)} a month isn’t planned yet. <a href="#goals">Put it toward a goal</a> or leave it as breathing room.`
        : 'Every dollar of income has a job.';
  return `<section class="panel"><h2>Your month</h2>${donut(segs, money(p.income), 'income / mo')}<p class="muted small">${note}</p></section>`;
}

function budgetDonut() {
  const cats = [...doc.categories].filter((c) => c.budget > 0).sort((a, b) => b.budget - a.budget);
  const top7 = cats.slice(0, 7).map((c, i) => ({ label: c.name, value: c.budget, color: PALETTE[i] }));
  const rest = cats.slice(7).reduce((a, c) => a + c.budget, 0);
  if (rest) top7.push({ label: 'Everything else', value: rest, color: PALETTE[7] });
  const total = E.budgetTotal(doc);
  return donut(top7, money(total), `${money(total * 12 / 365)} a day`);
}

// ---------- dashboard ----------
function dashboard() {
  const legacyBanner = legacy && !doc.checkins.length ? `
    <section class="panel notice"><div><h2>Bring over your existing forecast?</h2>
      <p class="muted">Your earlier Runway numbers are saved. Bring them in as bills, income and budget categories, then adjust anything here.</p></div>
      <button class="btn" type="button" data-act="import-legacy">Bring them over</button></section>` : '';
  if (!doc.checkins.length) return top() + legacyBanner + setupPanel();

  const runwayMode = doc.settings.mode === 'runway';
  const m = E.monthly(doc), r = E.runway(doc);
  const last = E.latestCheckin(doc);
  const since = E.sinceLastCheckin(doc);
  const cushion = +doc.settings.cushion || 0;
  const setAside = E.setAsideTotal(doc), saving = E.savingTotal(doc);

  const hero = runwayMode ? `
      <div class="eyebrow">With your income and bills as scheduled</div>
      ${r.out ? `<div class="big">Money lasts until <span class="${r.days < 90 ? 'bad' : 'good'}">${dateLabel(r.out, { month: 'short', day: 'numeric', year: 'numeric' })}</span></div>
      <p>About <b>${r.months < 1 ? r.days + ' days' : r.months.toFixed(1) + ' months'}</b> on ${money(r.cash)} available${setAside ? ` (not counting ${money(setAside)} set aside for goals)` : ''}, spending ${money(r.burn)} a month on bills and everyday costs${cushion ? `, keeping ${money(cushion)} as a cushion` : ''}. ${endingIncome(r.out)}</p>`
    : `<div class="big">Your money lasts <span class="good">2+ years</span></div><p>With your income as scheduled, your available balance stays above ${money(cushion)} for at least two years.</p>`}` : `
      <div class="eyebrow">Aim to spend under</div>
      ${m.perDay > 0 ? `<div class="big"><span class="good">${money(m.perDay)}</span> a day</div>
      <p>On average, for everyday spending. That keeps you above ${money(cushion)} through the end of next month, after bills${saving ? ', savings' : ''} and income.${m.payday ? ` Until your next paycheck on ${dateLabel(m.payday)}, that’s about <b>${money(m.perDay * m.untilPayday)}</b>.` : ''}</p>`
    : `<div class="big"><span class="bad">${money(0)}</span> a day</div>
      <p>Your bills${saving ? ' and savings' : ''} before the end of next month are more than your available balance and income, so there’s no room for everyday spending. <button class="linkbtn" type="button" data-act="mode-runway">Switch to Runway mode</button> to see how long your money lasts and what would stretch it.</p>`}`;

  const kpis = runwayMode ? [
    ['Available', money(r.cash), setAside ? `${money(last.balance)} in spending accounts, ${money(setAside)} set aside` : `As of ${dateLabel(last.date)}`],
    ['Monthly burn', money(r.burn), 'Bills plus everyday budget'],
    ['Runway', r.out ? (r.months < 1 ? `${r.days} days` : `${r.months.toFixed(1)} mo`) : '2+ years', r.out ? `Until ${dateLabel(r.out)}` : 'With income as scheduled'],
    ['Safety cushion', money(cushion), cushion ? 'Treated as empty' : 'Set one in Settings'],
  ] : [
    ['Available', money(m.balance), setAside ? `${money(last.balance)} in spending accounts, ${money(setAside)} set aside` : `As of ${dateLabel(last.date)}`],
    ['Income this month', money(m.incomeThisMonth), m.payday ? `Next ${dateLabel(m.payday)}` : 'No upcoming income'],
    ['Bills left this month', money(m.billsLeftThisMonth), `Through ${dateLabel(E.monthEnd(today()))}`],
    ['End of month', money(m.endOfMonth), `Available, with ${money(m.budget)} everyday budget`, m.endOfMonth < cushion ? 'bad' : ''],
  ];

  const upcoming = [];
  for (let i = 1; i <= 30 && upcoming.length < 7; i++) {
    const s = E.iso(E.addDays(E.D(today()), i));
    for (const e of E.eventsOn(doc, s)) upcoming.push({ s, ...e });
  }
  const bottom = runwayMode ? `
    <section class="panel"><h2>Biggest levers</h2>
      ${r.levers.length ? `<ul class="list">${r.levers.map((l) => `<li><div><div class="t">${esc(l.label)}</div><div class="s">saves $${esc(l.sub)}</div></div><span class="chip good">${l.days === Infinity ? 'lasts 2+ yrs' : `+${l.days} day${l.days === 1 ? '' : 's'}`}</span></li>`).join('')}</ul>`
        : `<p class="muted">${r.out ? 'No single optional bill moves the date much. Look at everyday spending in Budget.' : 'Nothing to stretch: your money already lasts.'}</p>`}
    </section>
    <section class="panel"><h2>Help for tight months</h2>
      <ul class="tips">
        <li><b>Call to lower a bill.</b> Phone, internet and insurance companies often have cheaper plans or hardship rates if you ask.</li>
        <li><b>Pause, don’t cancel.</b> Many subscriptions and gyms let you pause for a month or two.</li>
        <li><b>Check benefits.</b> If you lost a job, apply for unemployment right away; there’s usually a waiting week.</li>
        <li><b>Talk to lenders early.</b> Loan servicers and card issuers have hardship programs that are easier to get before a missed payment.</li>
      </ul>
    </section>` : `
    <section class="panel"><h2>Coming up</h2>
      ${upcoming.length ? `<ul class="list">${upcoming.map((u) => `<li><div><div class="t">${esc(u.name)}${u.kind === 'save' ? ' <span class="chip">saving</span>' : ''}</div><div class="s">${dateLabel(u.s, { weekday: 'short', month: 'short', day: 'numeric' })}</div></div><div class="amt ${u.amount > 0 ? 'good' : ''}">${u.amount > 0 ? '+' : ''}${money(u.amount, true)}</div></li>`).join('')}</ul>`
        : '<p class="muted">Nothing due in the next 30 days.</p>'}
    </section>
    ${monthDonut()}`;

  const goalsPanel = doc.goals.length && !runwayMode ? `
    <section class="panel"><div class="chart-head"><h2>Savings & goals</h2><a class="small" href="#goals">Edit goals</a></div>
      <div class="goal-mini">${doc.goals.map((g) => {
        const pct = g.target > 0 ? Math.min(100, (+g.saved || 0) / g.target * 100) : null;
        return `<div><div class="t">${esc(g.name)} <span class="s">${g.where === 'savings' ? 'savings account' : 'set aside'}</span></div>
          <div class="amt-l">${money(+g.saved || 0)}${g.target > 0 ? `<span class="s"> of ${money(g.target)}</span>` : ''}</div>
          ${pct !== null ? `<div class="bar"><i style="width:${Math.max(2, pct)}%"></i></div>` : ''}
          <div class="s">${goalNote(g)}</div></div>`;
      }).join('')}</div>
    </section>` : '';

  return top(`<div class="mode" role="group" aria-label="View"><button type="button" data-act="mode-monthly" aria-pressed="${!runwayMode}">Monthly</button><button type="button" data-act="mode-runway" aria-pressed="${runwayMode}">Runway</button></div>`) + legacyBanner + setupPanel() + `
    <section class="panel hero">
      <div class="hero-main">${hero}</div>
      ${heroSide(m)}
    </section>
    <section class="kpis">${kpis.map(([l, v, n, cls]) => `<div class="kpi"><span class="eyebrow">${l}</span><span class="v ${cls || ''}">${v}</span><span class="n">${n}</span></div>`).join('')}</section>
    <section class="panel chart">
      <div class="chart-head"><h2>Balance: ${doc.checkins.length > 1 ? 'actual and ' : ''}forecast</h2>
        <div class="legend">${doc.checkins.length > 1 ? '<span><i class="k-actual"></i>Your check-ins</span>' : ''}<span><i class="k-fore"></i>Available forecast${setAside ? ` (leaves out ${money(setAside)} set aside)` : ''}</span>${cushion ? `<span><i class="k-cush"></i>Cushion ${money(cushion)}</span>` : ''}</div></div>
      <div id="chart"></div>
    </section>
    ${calendarPanel()}
    <div class="two">${bottom}</div>
    ${goalsPanel}`;
}

// One line on how the latest check-in compared with the forecast going into it.
function vsNote() {
  const t = E.trackRecord(doc), r = t[t.length - 1];
  if (!r || !r.exact) return '';
  if (Math.abs(r.diff) < 1) return 'Your last check-in landed right on the forecast.';
  return `Your last check-in came in <span class="delta ${r.diff < 0 ? 'bad' : ''}">${money(Math.abs(r.diff))} ${r.diff < 0 ? 'behind' : 'ahead of'}</span> the forecast.`;
}

function trackPanel() {
  const t = E.trackRecord(doc).slice(-12);
  if (!t.length) return '';
  const total = t.reduce((a, r) => a + r.diff, 0), ahead = t.filter((r) => r.diff >= 0).length;
  const max = Math.max(...t.map((r) => Math.abs(r.diff)), 1);
  const W = 1000, H = 160, mid = H / 2, bw = Math.min(60, (W - 40) / t.length - 10);
  const bars = t.map((r, i) => {
    const h = Math.abs(r.diff) / max * (mid - 18), x = 20 + i * ((W - 40) / t.length) + ((W - 40) / t.length - bw) / 2;
    return `<rect x="${x.toFixed(1)}" y="${(r.diff >= 0 ? mid - h : mid).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" rx="3" class="${r.diff >= 0 ? 'up' : 'down'}"><title>${dateLabel(r.to)}: ${r.diff >= 0 ? 'ahead' : 'behind'} ${money(Math.abs(r.diff))}</title></rect>
      <text x="${(x + bw / 2).toFixed(1)}" y="${H - 2}" text-anchor="middle">${dateLabel(r.to)}</text>`;
  }).join('');
  return `<section class="panel">
      <h2>Forecast vs actual</h2>
      <p class="muted">Each check-in is compared with what the forecast expected for that day, so you can see if you’re beating it or falling behind over time. Over your last ${t.length} check-in${t.length === 1 ? '' : 's'} you’ve been ahead ${ahead} time${ahead === 1 ? '' : 's'}, <span class="delta ${total < 0 ? 'bad' : ''}">${money(Math.abs(total))} ${total < 0 ? 'behind' : 'ahead'} in total</span>.</p>
      <div class="track"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Ahead or behind the forecast at each check-in"><line x1="10" x2="${W - 10}" y1="${mid}" y2="${mid}" class="zero"/>${bars}</svg></div>
      <table class="tbl"><thead><tr><th>Check-in</th><th class="num">Forecast expected</th><th class="num">Actual</th><th class="num">Difference</th></tr></thead><tbody>
        ${[...t].reverse().map((r) => `<tr><td>${dateLabel(r.to, { weekday: 'short', month: 'short', day: 'numeric' })} <span class="s">(${r.days} day${r.days === 1 ? '' : 's'} after the one before)</span></td><td class="num">${money(r.expected)}${r.exact ? '' : '<span class="s"> est.</span>'}</td><td class="num">${money(r.actual)}</td><td class="num"><span class="${r.diff < 0 ? 'bad' : 'good'}">${r.diff >= 0 ? '+' : '−'}${money(Math.abs(r.diff))}</span></td></tr>`).join('')}
      </tbody></table>
      ${t.some((r) => !r.exact) ? '<p class="muted small">“est.” rows are from before Runway saved forecasts, so they’re estimated with your current bills, income and budget.</p>' : ''}
    </section>`;
}

function spentNote(since) {
  if (!since) return '';
  if (since.spent < 0) return `Between your last two check-ins your balance came in <b>${money(-since.spent)} higher</b> than bills and income explain. If money came in that isn’t listed under Income, that’s why.`;
  const diff = since.budgeted - since.spent;
  return `Between your last two check-ins you spent about <b>${money(since.spent)}</b> on everyday things, <span class="delta ${diff < 0 ? 'bad' : ''}">${money(Math.abs(diff))} ${diff < 0 ? 'over' : 'under'} budget</span>.`;
}

const balanceInput = (a, lv, form) => `<input id="v-${a.id}" ${form ? `form="${form}"` : ''} class="money" data-acct-value="${a.id}" inputmode="decimal" placeholder="${lv[a.id] ? esc(money(lv[a.id].value, true)) : '$0.00'}" autocomplete="off" aria-label="${esc(a.name)} balance">`;

// Right side of the dashboard hero: how you're pacing against the forecast, the
// stretch until the next paycheck, and a nudge toward the check-in page.
function heroSide(m) {
  const t = E.trackRecord(doc).slice(-12);
  let pace;
  if (t.length) {
    let run = 0;
    const pts = [0, ...t.map((r) => (run += r.diff))], total = run;
    const lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || 1, W = 240, H = 48;
    const xy = pts.map((v, i) => `${(i / (pts.length - 1) * W).toFixed(1)},${(H - 4 - (v - lo) / span * (H - 8)).toFixed(1)}`);
    const zero = (H - 4 - (0 - lo) / span * (H - 8)).toFixed(1);
    pace = `<div class="eyebrow">Vs. your forecast</div>
      <div class="side-v ${total < 0 ? 'bad' : 'good'}">${total >= 0 ? '+' : '−'}${money(Math.abs(total))} <span class="side-u">${total < 0 ? 'behind' : 'ahead'}</span></div>
      <svg class="spark ${total < 0 ? 'down' : 'up'}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><line x1="0" x2="${W}" y1="${zero}" y2="${zero}"/><polyline points="${xy.join(' ')}"/></svg>
      <div class="s">Running total over your last ${t.length} check-in${t.length === 1 ? '' : 's'}. <a href="#checkin">See each one</a></div>`;
  } else {
    pace = `<div class="eyebrow">Vs. your forecast</div>
      <div class="s">After your next check-in you’ll see here whether you’re beating the forecast or falling behind it.</div>`;
  }
  let pay = '';
  if (m.payday) {
    let out = 0;
    for (let i = 1; i <= m.untilPayday; i++) {
      const s = E.iso(E.addDays(E.D(today()), i));
      for (const e of E.eventsOn(doc, s)) if (e.amount < 0 && s < m.payday) out -= e.amount;
    }
    pay = `<div class="side-sec"><div class="eyebrow">Next paycheck</div>
      <div class="side-v">${m.untilPayday === 0 ? 'Today' : `${m.untilPayday} day${m.untilPayday === 1 ? '' : 's'}`} <span class="side-u">${dateLabel(m.payday)}</span></div>
      <div class="s">${out ? `${money(out)} in bills and savings before then` : 'No bills due before then'}</div></div>`;
  }
  const last = E.latestCheckin(doc), ago = E.daysBetween(last.date, today());
  return `<aside class="hero-side">
      <div class="side-sec">${pace}</div>
      ${pay}
      <a class="side-ci ${ago >= 7 ? 'due' : ''}" href="#checkin">${ago >= 7 ? 'Time for a check-in' : 'Update balances'} <span>Last ${ago === 0 ? 'today' : ago === 1 ? 'yesterday' : ago + ' days ago'} →</span></a>
    </aside>`;
}

function endingIncome(out) {
  const ends = doc.income.filter((it) => it.on !== false && it.end && it.end >= today() && it.end <= E.iso(E.addDays(E.D(out), 31)));
  return ends.length ? ` ${ends.map((it) => `${esc(it.name)} stops after ${dateLabel(it.end)}`).join('; ')}.`
    : ' Income counts only as long as it’s scheduled, so set an end date on income that will stop.';
}

// ---------- check-in ----------
function checkin() {
  const since = E.sinceLastCheckin(doc);
  const rows = [...doc.checkins].reverse();
  const lv = E.latestValues(doc);
  const group = (kind) => {
    const list = kind === 'spending' ? E.spendingAccounts(doc) : E.investmentAccounts(doc);
    return list.map((a) => `<tr data-acct="${a.id}">
        <td><input id="a${a.id}-name" data-f="name" value="${esc(a.name)}" maxlength="40" aria-label="Account name"></td>
        <td class="muted small">${lv[a.id] ? `${money(lv[a.id].value, true)} on ${dateLabel(lv[a.id].date)}` : 'No balance yet'}</td>
        <td class="num">${balanceInput(a, lv, 'ci-form')}</td>
        <td><select id="a${a.id}-kind" data-f="kind" aria-label="Kind of account"><option value="spending" ${kind === 'spending' ? 'selected' : ''}>Spending</option><option value="investment" ${kind === 'investment' ? 'selected' : ''}>Investment</option></select></td>
        <td class="num"><button class="x" type="button" data-act="del-acct" aria-label="Remove ${esc(a.name)}">×</button></td></tr>`).join('')
      || `<tr><td colspan="5" class="muted small">${kind === 'spending' ? 'No spending accounts. Add checking below.' : 'None yet. Add a 401(k), IRA or brokerage account below to track it on the Investments tab.'}</td></tr>`;
  };
  return top() + `
    <section class="panel">
      <h2>Update your balances</h2>
      <p class="muted">Enter today’s balance for each account you want to update; blank ones keep their last balance. <b>Spending</b> accounts (checking, Venmo, cash) add up to the money you can spend and drive the forecast. <b>Investment</b> accounts are tracked on the Investments tab and never count as spendable. Separate savings accounts live in Savings & goals.</p>
      <form id="ci-form" data-form="checkin"></form>
      <div class="tbl-wrap"><table class="tbl edit accts">
        <thead><tr><th>Spending accounts</th><th>Last balance</th><th class="num">Today’s balance</th><th>Kind</th><th></th></tr></thead>
        <tbody>${group('spending')}</tbody>
        <thead><tr><th>Investment accounts</th><th></th><th></th><th></th><th></th></tr></thead>
        <tbody>${group('investment')}</tbody>
      </table></div>
      <div class="form-row ci-save"><label>Date<input id="ciDate" form="ci-form" type="date" name="date" value="${today()}" max="${today()}" required></label><button class="btn" type="submit" form="ci-form">Save check-in</button></div>
      ${since ? `<p class="callout">From ${dateLabel(since.from)} to ${dateLabel(since.to)}: ${spentNote(since).replace('Between your last two check-ins ', '')} Your everyday budget for those ${since.days} days was ${money(since.budgeted)}. ${vsNote()}</p>` : ''}
      <form class="form-row add-acct" data-form="new-acct">
        <datalist id="acct-names">${[...ACCOUNTS.spending, ...ACCOUNTS.investment].map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
        <label>Add an account<input id="anew-name" name="name" list="acct-names" maxlength="40" placeholder="e.g. Venmo or Roth IRA" required></label>
        <label>Kind<select id="anew-kind" name="kind"><option value="spending">Spending (counts toward available)</option><option value="investment">Investment (tracked only)</option></select></label>
        <button class="btn ghost" type="submit">Add account</button>
      </form>
    </section>
    ${trackPanel()}
    <section class="panel"><h2>History</h2>
      ${rows.length ? `<table class="tbl"><thead><tr><th>Date</th><th>Accounts</th><th class="num">Spending total</th><th></th></tr></thead><tbody>${rows.map((c) => `<tr><td>${dateLabel(c.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</td><td class="muted small">${c.by ? Object.entries(c.by).map(([id, v]) => `${esc(doc.accounts.find((a) => a.id === id)?.name || 'Removed account')} ${money(v)}`).join(' · ') : ''}</td><td class="num">${money(c.balance, true)}</td><td class="num"><button class="linkbtn" type="button" data-act="del-checkin" data-date="${c.date}">Remove</button></td></tr>`).join('')}</tbody></table>`
        : '<p class="muted">No check-ins yet.</p>'}
    </section>`;
}

// ---------- investments ----------
const pct = (a, b) => (b ? ` (${a >= 0 ? '+' : '−'}${Math.abs(a / b * 100).toFixed(1)}%)` : '');
const change = (a, b) => `<span class="${a < 0 ? 'bad' : a > 0 ? 'good' : ''}">${a >= 0 ? '+' : ''}${money(a)}${pct(a, b)}</span>`;
function investments() {
  const inv = E.investmentAccounts(doc), hist = E.portfolioHistory(doc), lv = E.latestValues(doc);
  const addForm = `<form class="form-row" data-form="new-acct"><input type="hidden" name="kind" value="investment">
      <datalist id="inv-names">${ACCOUNTS.investment.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
      <label>Add an investment account<input id="inew-acct" name="name" list="inv-names" maxlength="40" placeholder="e.g. 401(k)" required></label><button class="btn ghost" type="submit">Add</button></form>`;
  if (!inv.length) return top() + `<section class="panel"><h2>Track your investments</h2><p class="muted">Add retirement and investing accounts to see how they’re doing over time. They’re kept separate from your spending money and never count toward your available balance or runway.</p>${addForm}</section>`;
  const lastH = hist[hist.length - 1], prevH = hist[hist.length - 2], firstH = hist[0];
  const perAcct = (id) => (doc.portfolio || []).filter((p) => id in p.values).map((p) => ({ date: p.date, v: p.values[id] }));
  return top() + `
    ${hist.length ? `<section class="kpis three">
      <div class="kpi"><span class="eyebrow">Total value</span><span class="v">${money(lastH.total)}</span><span class="n">As of ${dateLabel(lastH.date)}</span></div>
      <div class="kpi"><span class="eyebrow">Since last update</span><span class="v">${prevH ? change(lastH.total - prevH.total, prevH.total) : '—'}</span><span class="n">${prevH ? `Since ${dateLabel(prevH.date)}` : 'Update again to see a change'}</span></div>
      <div class="kpi"><span class="eyebrow">Since you started</span><span class="v">${hist.length > 1 ? change(lastH.total - firstH.total, firstH.total) : '—'}</span><span class="n">Since ${dateLabel(firstH.date, { month: 'short', day: 'numeric', year: 'numeric' })}</span></div>
    </section>` : ''}
    ${hist.length > 1 ? '<section class="panel chart"><div class="chart-head"><h2>Total value</h2></div><div id="pchart"></div></section>' : ''}
    <section class="panel">
      <h2>Update values</h2>
      <form id="inv-form" data-form="checkin"></form>
      <div class="tbl-wrap"><table class="tbl edit">
        <thead><tr><th>Account</th><th class="num">Last value</th><th class="num">Since previous</th><th class="num">Since first</th><th class="num">New value</th></tr></thead>
        <tbody>${inv.map((a) => { const h = perAcct(a.id), l = h[h.length - 1], p = h[h.length - 2], f = h[0];
          return `<tr><td>${esc(a.name)}</td><td class="num">${l ? `${money(l.v)}<div class="s">${dateLabel(l.date)}</div>` : '<span class="muted">—</span>'}</td>
            <td class="num">${p ? change(l.v - p.v, p.v) : '—'}</td><td class="num">${h.length > 1 ? change(l.v - f.v, f.v) : '—'}</td>
            <td class="num">${balanceInput(a, lv, 'inv-form')}</td></tr>`; }).join('')}</tbody>
      </table></div>
      <div class="form-row"><label>Date<input id="invDate" form="inv-form" type="date" name="date" value="${today()}" max="${today()}" required></label><button class="btn" type="submit" form="inv-form">Save values</button></div>
      <p class="muted small">Changes include any money you put in, so they aren’t pure investment returns. Updating once a month is plenty.</p>
      ${addForm}
    </section>`;
}

function drawPortfolio() {
  const el = document.getElementById('pchart');
  if (!el) return;
  const hist = E.portfolioHistory(doc);
  const W = 1000, H = 220, pl = 70, pr = 14, pt = 12, pb = 28;
  let lo = Math.min(...hist.map((h) => h.total)), hi = Math.max(...hist.map((h) => h.total));
  const pad = (hi - lo) * 0.1 || hi * 0.05 || 100; lo -= pad; hi += pad;
  const a = hist[0].date, span = Math.max(1, E.daysBetween(a, hist[hist.length - 1].date));
  const x = (s) => pl + E.daysBetween(a, s) / span * (W - pl - pr), y = (v) => pt + (hi - v) * (H - pt - pb) / (hi - lo);
  let g = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Investment value over time">`;
  for (let i = 0; i <= 4; i++) { const v = lo + (hi - lo) * i / 4; g += `<line x1="${pl}" x2="${W - pr}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="grid"/><text x="${pl - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${money(v)}</text>`; }
  g += `<polyline points="${hist.map((h) => `${x(h.date).toFixed(1)},${y(h.total).toFixed(1)}`).join(' ')}" class="fore"/>`;
  hist.forEach((h) => { g += `<circle cx="${x(h.date).toFixed(1)}" cy="${y(h.total).toFixed(1)}" r="4" class="dot"><title>${dateLabel(h.date, { month: 'short', day: 'numeric', year: 'numeric' })}: ${money(h.total)}</title></circle>`; });
  [hist[0], hist[hist.length - 1]].forEach((h, i) => { g += `<text x="${x(h.date).toFixed(1)}" y="${H - 8}" text-anchor="${i ? 'end' : 'start'}">${dateLabel(h.date, { month: 'short', day: 'numeric', year: 'numeric' })}</text>`; });
  el.innerHTML = g + '</svg>';
}

// ---------- bills and income: one editable table, with a blank row for adding ----------
function dueCell(it, id, formAttr = '') {
  if (it.freq === 'semimonthly') return '<span class="muted small">1st &amp; 15th</span>';
  if (it.freq === 'monthly') {
    const day = it.day || (it.start ? E.D(it.start).getUTCDate() : '');
    return `<select id="${id}" ${formAttr} data-f="day" aria-label="Day of the month">${day ? '' : '<option value="">Day…</option>'}${Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}" ${+day === i + 1 ? 'selected' : ''}>${ord(i + 1)}</option>`).join('')}</select>`;
  }
  return `<input id="${id}" ${formAttr} type="date" data-f="start" value="${esc(it.start || '')}" aria-label="${it.freq === 'once' ? 'Date' : 'Next date'}">`;
}

function suggestions(catalog, kind) {
  const used = new Set((kind === 'bill' ? doc.bills : doc.income).map((x) => x.name));
  const chip = (n) => used.has(n) ? '' : `<button type="button" class="pick" data-act="fill-name" data-kind="${kind}" data-name="${esc(n)}">+ ${esc(n)}</button>`;
  return `<div class="quick"><span class="lbl">${kind === 'bill' ? 'Common bills' : 'Common income'}</span>
      <div class="picks">${catalog.common.map(chip).join('')}</div>
      ${catalog.more.length ? `<details><summary>More options</summary><div class="picks">${catalog.more.map(chip).join('')}</div></details>` : ''}
    </div>`;
}

const draft = { bill: null, income: null }; // the blank "add" row's values while it's being filled in
const newDraft = (kind) => ({ name: '', amount: '', freq: kind === 'bill' ? 'monthly' : 'biweekly', day: '', start: kind === 'bill' ? '' : today(), end: '' });

function itemTable(kind) {
  const list = kind === 'bill' ? doc.bills : doc.income;
  const catalog = kind === 'bill' ? BILLS : INCOME;
  const d = draft[kind] ||= newDraft(kind);
  const total = list.reduce((a, x) => a + E.perMonth(x), 0);
  const freqSel = (id, v, attrs) => `<select id="${id}" ${attrs}>${E.FREQS.map(([k, t]) => `<option value="${k}" ${v === k ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
  const k = kind[0], fa = `form="new-${kind}"`;
  return `
    <form id="new-${kind}" data-form="new-item" data-kind="${kind}"></form>
    <datalist id="names-${kind}">${[...catalog.common, ...catalog.more].map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
    <div class="tbl-wrap"><table class="tbl edit">
      <thead><tr><th class="chk">On</th><th>${kind === 'bill' ? 'Bill' : 'Source'}</th><th class="num">Amount</th><th>How often</th><th>Due</th><th>Ends <span class="opt">optional</span></th><th class="num">Per month</th><th></th></tr></thead>
      <tbody>
      ${list.map((x) => `<tr class="${x.on === false ? 'off' : ''}" data-kind="${kind}" data-id="${x.id}">
        <td class="chk"><input id="${k}${x.id}-on" type="checkbox" data-f="on" aria-label="Include ${esc(x.name)}" ${x.on === false ? '' : 'checked'}></td>
        <td><input id="${k}${x.id}-name" data-f="name" value="${esc(x.name)}" list="names-${kind}" maxlength="60" aria-label="Name"></td>
        <td class="num"><input id="${k}${x.id}-amount" class="money" data-f="amount" inputmode="decimal" value="${plain(+x.amount)}" aria-label="Amount"></td>
        <td>${freqSel(`${k}${x.id}-freq`, x.freq, 'data-f="freq" aria-label="How often"')}</td>
        <td>${dueCell(x, `${k}${x.id}-due`)}</td>
        <td>${x.freq === 'once' ? '' : `<input id="${k}${x.id}-end" type="date" data-f="end" value="${esc(x.end || '')}" aria-label="Last date (optional)">`}</td>
        <td class="num muted">${E.perMonth(x) ? money(E.perMonth(x)) : '—'}</td>
        <td class="num"><button class="x" type="button" data-act="del" aria-label="Remove ${esc(x.name)}">×</button></td></tr>`).join('')}
      <tr class="new" data-kind="${kind}" data-draft="1">
        <td class="chk"></td>
        <td><input id="${k}new-name" ${fa} name="name" data-f="name" value="${esc(d.name)}" list="names-${kind}" maxlength="60" placeholder="${list.length ? 'Add another…' : kind === 'bill' ? 'e.g. Rent / mortgage' : 'e.g. Paycheck'}" aria-label="New ${kind} name"></td>
        <td class="num"><input id="${k}new-amount" class="money" ${fa} name="amount" data-f="amount" inputmode="decimal" value="${esc(d.amount)}" placeholder="$0" aria-label="Amount"></td>
        <td>${freqSel(`${k}new-freq`, d.freq, `${fa} name="freq" data-f="freq" aria-label="How often"`)}</td>
        <td>${dueCell(d, `${k}new-due`, fa)}</td>
        <td>${d.freq === 'once' ? '' : `<input id="${k}new-end" type="date" ${fa} data-f="end" value="${esc(d.end)}" aria-label="Last date (optional)">`}</td>
        <td></td>
        <td class="num"><button class="btn small-btn" type="submit" ${fa}>Add</button></td></tr>
      </tbody>
      ${list.length ? `<tfoot><tr><td></td><td colspan="5"><b>Total per month</b> <span class="muted">(checked items)</span></td><td class="num"><b>${money(total)}</b></td><td></td></tr></tfoot>` : ''}
    </table></div>
    <p class="muted small">Type in the last row and press Enter to add. Edits save as you go. Uncheck something to see the forecast without it.</p>`;
}

function bills() {
  return top() + `<section class="panel">${itemTable('bill')}${suggestions(BILLS, 'bill')}</section>`;
}
function income() {
  return top() + `<section class="panel">${itemTable('income')}${suggestions(INCOME, 'income')}</section>`;
}

// ---------- everyday budget ----------
function budget() {
  const used = new Set(doc.categories.map((c) => c.name));
  const chip = (n) => used.has(n) ? '' : `<button type="button" class="pick" data-act="add-cat" data-name="${esc(n)}">+ ${esc(n)}</button>`;
  const total = E.budgetTotal(doc);
  return top() + `
    <div class="budget-grid">
      <section class="panel">
        <h2>Monthly amounts</h2>
        <p class="muted">Day-to-day spending that isn’t a fixed bill. The forecast spreads it evenly across each day.</p>
        <form id="new-cat" data-form="own-cat"></form>
        <datalist id="names-cat">${[...CATEGORIES.common, ...CATEGORIES.more].map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
        <table class="tbl edit cats-tbl"><tbody>
          ${doc.categories.map((c) => `<tr data-cat="${c.id}">
            <td><input id="c${c.id}-name" data-f="name" value="${esc(c.name)}" maxlength="40" aria-label="Category name"></td>
            <td class="num"><input id="c${c.id}-budget" class="money" data-f="budget" inputmode="decimal" value="${plain(+c.budget)}" placeholder="$0" aria-label="${esc(c.name)} per month"></td>
            <td class="num s">${total > 0 ? Math.round((+c.budget || 0) / total * 100) + '%' : ''}</td>
            <td class="num"><button class="x" type="button" data-act="del-cat" aria-label="Remove ${esc(c.name)}">×</button></td></tr>`).join('')}
          <tr class="new">
            <td><input id="cnew-name" form="new-cat" name="name" list="names-cat" maxlength="40" placeholder="${doc.categories.length ? 'Add another…' : 'e.g. Groceries'}" aria-label="New category name"></td>
            <td class="num"><input id="cnew-budget" class="money" form="new-cat" name="budget" inputmode="decimal" placeholder="$0" aria-label="Per month"></td>
            <td></td><td class="num"><button class="btn small-btn" type="submit" form="new-cat">Add</button></td></tr>
        </tbody></table>
        <p class="total">Total <b>${money(total)}</b> a month · about ${money(total * 12 / 365)} a day</p>
        <div class="quick"><span class="lbl">Common categories</span>
          <div class="picks">${CATEGORIES.common.map(chip).join('')}</div>
          <details><summary>More options</summary><div class="picks">${CATEGORIES.more.map(chip).join('')}</div></details>
        </div>
      </section>
      <section class="panel"><h2>Where it goes</h2>${total > 0 ? budgetDonut() : '<p class="muted">Add amounts to see the breakdown.</p>'}</section>
    </div>`;
}

// ---------- savings and goals ----------
function goalNote(g) {
  const saved = +g.saved || 0;
  if (g.target > 0 && saved >= g.target) return 'Reached. Monthly saving has stopped.';
  if (!(g.monthly > 0)) return g.target > 0 ? `${money(g.target - saved)} to go. Add a monthly amount to get there.` : 'No monthly amount yet.';
  if (!(g.target > 0)) return `${money(g.monthly)} a month on the ${ord(g.day || 1)}.`;
  const n = Math.ceil((g.target - saved) / g.monthly);
  const s = E.D(g.start || E.nextOnDay(g.day || 1, tomorrow()));
  const when = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + n - 1, 1));
  return `${money(g.monthly)} a month reaches it around ${when.toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' })}.`;
}

function goals() {
  const chip = (n) => doc.goals.some((g) => g.name === n) ? '' : `<button type="button" class="pick" data-act="add-goal" data-name="${esc(n)}">+ ${esc(n)}</button>`;
  const setAside = E.setAsideTotal(doc), savings = E.savingsTotal(doc), monthlyTotal = E.savingTotal(doc);
  const card = (g) => {
    const id = `g${g.id}`;
    const pct = g.target > 0 ? Math.min(100, (+g.saved || 0) / g.target * 100) : null;
    return `<div class="goal panel" data-goal="${g.id}">
      <div class="goal-head"><input id="${id}-name" class="goal-name" data-f="name" value="${esc(g.name)}" maxlength="40" aria-label="Goal name"><button class="x" type="button" data-act="del-goal" aria-label="Remove ${esc(g.name)}">×</button></div>
      <div class="seg" role="group" aria-label="Where the money is kept">
        <button type="button" id="${id}-wc" data-act="goal-where" data-where="checking" aria-pressed="${g.where !== 'savings'}">Set aside in checking</button>
        <button type="button" id="${id}-ws" data-act="goal-where" data-where="savings" aria-pressed="${g.where === 'savings'}">Savings account</button>
      </div>
      <div class="goal-fields">
        <label>Saved so far<input id="${id}-saved" class="money" data-f="saved" inputmode="decimal" value="${plain(+g.saved)}" placeholder="$0"></label>
        <label><span>Target <span class="opt">optional</span></span><input id="${id}-target" class="money" data-f="target" inputmode="decimal" value="${plain(+g.target)}" placeholder="$0"></label>
        <label>Each month<input id="${id}-monthly" class="money" data-f="monthly" inputmode="decimal" value="${plain(+g.monthly)}" placeholder="$0"></label>
        <label>On the<select id="${id}-day" data-f="day">${Array.from({ length: 28 }, (_, i) => `<option value="${i + 1}" ${(g.day || 1) === i + 1 ? 'selected' : ''}>${ord(i + 1)}</option>`).join('')}</select></label>
      </div>
      ${pct !== null ? `<div class="bar"><i style="width:${Math.max(2, pct)}%"></i></div>` : ''}
      <p class="s">${goalNote(g)}</p>
    </div>`;
  };
  return top() + `
    <section class="panel">
      <p class="muted" style="margin-top:0">Two kinds of saving. <b>Savings accounts</b> hold money you move out of checking, so it isn’t spendable. <b>Set aside in checking</b> is money you keep in checking for something like a trip: your balance doesn’t change, but your available balance is lower so you don’t spend it by accident. Monthly amounts come out of your available money on the day you choose.</p>
      ${doc.goals.length ? `<div class="kpis three">
        <div class="kpi"><span class="eyebrow">In savings accounts</span><span class="v">${money(savings)}</span></div>
        <div class="kpi"><span class="eyebrow">Set aside in checking</span><span class="v">${money(setAside)}</span></div>
        <div class="kpi"><span class="eyebrow">Saving each month</span><span class="v">${money(monthlyTotal)}</span></div></div>` : ''}
    </section>
    ${doc.goals.length ? `<div class="goals">${doc.goals.map(card).join('')}</div>` : ''}
    <section class="panel">
      <h2>Add a savings account or goal</h2>
      <div class="picks">${GOALS.common.map(chip).join('')}</div>
      <details><summary>More options</summary><div class="picks">${GOALS.more.map(chip).join('')}</div></details>
      <form class="form-row" data-form="own-goal"><label>Add your own<input id="gnew-name" name="name" maxlength="40" placeholder="Name it anything" required></label><button class="btn ghost" type="submit">Add</button></form>
    </section>`;
}

// ---------- settings ----------
function settings() {
  return top() + `
    <section class="panel">
      <h2>Safety cushion</h2>
      <p class="muted">Treat this much as “empty”, so the forecast warns you before you get close to $0.</p>
      <label class="inline">Cushion<input id="setCushion" class="money" inputmode="decimal" data-setting="cushion" value="${plain(+doc.settings.cushion)}" placeholder="$0"></label>
    </section>
    ${doc.settings.setupDone ? '<section class="panel"><h2>Setup checklist</h2><p class="muted">You skipped the setup checklist.</p><div class="btns"><button class="btn ghost" type="button" data-act="show-setup">Show it on the dashboard again</button></div></section>' : ''}
    <section class="panel">
      <h2>Your data</h2>
      <p class="muted">${MODE === 'demo' ? 'In this demo everything stays in this browser. Nothing is sent anywhere.' : 'Saved privately to your account and available on any device you sign in on.'}</p>
      <div class="btns">
        <button class="btn ghost" type="button" data-act="export">Download a backup</button>
        <label class="btn ghost filebtn">Restore from a backup<input type="file" accept=".json,application/json" data-act="import" hidden></label>
        ${MODE === 'demo' ? '<button class="btn ghost" type="button" data-act="sample">Load sample numbers</button>' : ''}
        <button class="btn danger" type="button" data-act="erase">Erase everything</button>
      </div>
    </section>`;
}

// ---------- calendar ----------
// Month grid of the forecast: what comes in and goes out each day, and the balance that night.
let calMonth = 0;
function calendarPanel() {
  const t = today();
  const rows = E.simulate(doc, { today: t, days: 400 });
  const months = [];
  for (let i = 0; i < 12; i++) { const d = E.D(t.slice(0, 8) + '01'); months.push(E.iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + i, 1))).slice(0, 7)); }
  calMonth = Math.min(calMonth, months.length - 1);
  const mk = months[calMonth], first = E.D(mk + '-01');
  const n = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const map = new Map(rows.map((r) => [r.s, r]));
  const line = +doc.settings.cushion || 0;
  let h = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((x) => `<div class="dow">${x}</div>`).join('');
  for (let i = 0; i < first.getUTCDay(); i++) h += '<div class="day empty"></div>';
  for (let d = 1; d <= n; d++) {
    const s = `${mk}-${String(d).padStart(2, '0')}`, r = map.get(s);
    if (!r) { h += `<div class="day past ${s === t ? 'is-today' : ''}"><div class="dn">${d}${s === t ? ' · today' : ''}</div></div>`; continue; }
    const chips = r.ev.map((e) => `<div class="cchip ${e.kind}" title="${esc(e.name)} ${money(e.amount, true)}">${e.amount > 0 ? '+' : '−'}$${Math.abs(Math.round(e.amount)).toLocaleString()} ${esc(e.name)}</div>`).join('');
    h += `<div class="day ${r.bal < 0 ? 'neg' : r.bal < line ? 'low' : ''} ${s === t ? 'is-today' : ''}"><div class="dn">${d}${s === t ? ' · today' : ''}</div>${chips}<div class="cbal">${money(r.bal)}</div></div>`;
  }
  return `<section class="panel">
      <div class="chart-head"><h2>Calendar</h2></div>
      <div class="cal-tabs" role="group" aria-label="Month">${months.map((m, i) => `<button type="button" data-act="cal-month" data-i="${i}" aria-pressed="${i === calMonth}">${E.D(m + '-01').toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' })}</button>`).join('')}</div>
      <div class="cal-scroll"><div class="cal">${h}</div></div>
      <p class="muted small">Each day shows what comes in or goes out and the available balance at the end of the day, including everyday spending from your budget.</p>
    </section>`;
}

// ---------- chart ----------
function drawChart() {
  const el = document.getElementById('chart');
  if (!el) return;
  const runwayMode = doc.settings.mode === 'runway';
  const t = today();
  const horizon = runwayMode ? 365 : 92;
  const fore = E.simulate(doc, { today: t, days: horizon });
  const none = [];
  const past = doc.checkins.filter((c) => E.daysBetween(c.date, t) <= (runwayMode ? 180 : 92));
  const start = past.length ? past[0].date : t;
  const end = fore.length ? fore[fore.length - 1].s : t;
  const span = Math.max(1, E.daysBetween(start, end));
  const cushion = +doc.settings.cushion || 0;
  const vals = [...past.map((c) => c.balance), ...fore.map((r) => r.bal), ...none.map((r) => r.bal), cushion, 0];
  let lo = Math.min(...vals), hi = Math.max(...vals);
  lo = Math.max(lo, -Math.max(2000, hi));
  const pad = (hi - lo) * 0.08 || 500; lo -= pad; hi += pad;
  const W = 1000, H = 260, pl = 64, pr = 14, pt = 12, pb = 28;
  const x = (s) => pl + E.daysBetween(start, s) / span * (W - pl - pr);
  const y = (v) => pt + (hi - Math.max(v, lo)) * (H - pt - pb) / (hi - lo);
  const line = (pts) => pts.map(([s, v]) => `${x(s).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  let g = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Balance chart">`;
  for (let i = 0; i <= 4; i++) { const v = lo + (hi - lo) * i / 4; g += `<line x1="${pl}" x2="${W - pr}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="grid"/><text x="${pl - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${money(v)}</text>`; }
  g += `<line x1="${pl}" x2="${W - pr}" y1="${y(0)}" y2="${y(0)}" class="zero"/>`;
  if (cushion) g += `<line x1="${pl}" x2="${W - pr}" y1="${y(cushion)}" y2="${y(cushion)}" class="cush"/>`;
  for (let d = E.D(start.slice(0, 8) + '01'); E.iso(d) <= end; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    const s = E.iso(d); if (s < start) continue;
    g += `<text x="${x(s).toFixed(1)}" y="${H - 8}" text-anchor="middle">${dateLabel(s, { month: 'short' })}</text>`;
  }
  // Past check-ins show the checking balance; the forecast shows what's available to spend.
  const now = E.available(doc);
  const last = E.latestCheckin(doc);
  const foreline = [[t, last.date === t ? now : (fore[0]?.bal ?? now)], ...fore.map((r) => [r.s, r.bal])];
  g += `<polygon points="${x(t)},${y(lo)} ${line(foreline)} ${x(end)},${y(lo)}" class="fore-fill"/>`;
  g += `<polyline points="${line(foreline)}" class="fore"/>`;
  if (past.length > 1) g += `<polyline points="${line(past.map((c) => [c.date, c.balance]))}" class="actual"/>`;
  past.forEach((c) => { g += `<circle cx="${x(c.date).toFixed(1)}" cy="${y(c.balance).toFixed(1)}" r="3.5" class="dot"/>`; });
  g += `<line x1="${x(t)}" x2="${x(t)}" y1="${pt}" y2="${H - pb}" class="today"/><text x="${x(t) + 4}" y="${pt + 10}" class="today-t">Today</text>`;
  g += `<g class="hover" visibility="hidden"><line class="cursor" y1="${pt}" y2="${H - pb}"/><circle r="4.5" class="hdot h-fore"/><circle r="4.5" class="hdot h-none"/><circle r="4.5" class="hdot h-actual"/></g>`;
  g += `<rect class="hit" x="${pl}" y="${pt}" width="${W - pl - pr}" height="${H - pt - pb}"/>`;
  el.innerHTML = g + '</svg><div class="tip" hidden></div>';

  // Hover readout: the date under the cursor and each line's balance that day.
  const svg = el.querySelector('svg'), tip = el.querySelector('.tip'), hov = svg.querySelector('.hover');
  const foreMap = new Map(foreline), noneMap = new Map(none.map((r) => [r.s, r.bal]));
  const evMap = new Map(fore.map((r) => [r.s, r.ev]));
  const put = (sel, v, s) => { const c = hov.querySelector(sel); if (v == null) c.setAttribute('visibility', 'hidden'); else { c.setAttribute('visibility', 'visible'); c.setAttribute('cx', x(s)); c.setAttribute('cy', y(v)); } };
  const hide = () => { hov.setAttribute('visibility', 'hidden'); tip.hidden = true; };
  svg.addEventListener('pointerleave', hide);
  svg.addEventListener('pointermove', (ev) => {
    const box = svg.getBoundingClientRect();
    const px = (ev.clientX - box.left) / box.width * W;
    if (px < pl || px > W - pr) return hide();
    let s = E.iso(E.addDays(E.D(start), Math.round((px - pl) / (W - pl - pr) * span)));
    let actual = null;
    if (s < t) {
      // Before today only check-ins are known; snap to the nearest one.
      const c = past.reduce((a, b) => (Math.abs(E.daysBetween(b.date, s)) < Math.abs(E.daysBetween(a.date, s)) ? b : a), past[0]);
      if (!c) return hide();
      s = c.date; actual = c.balance;
    }
    const f = foreMap.get(s), nn = noneMap.get(s);
    hov.setAttribute('visibility', 'visible');
    hov.querySelector('.cursor').setAttribute('x1', x(s)); hov.querySelector('.cursor').setAttribute('x2', x(s));
    put('.h-fore', actual == null ? f : null, s); put('.h-none', actual == null ? nn : null, s); put('.h-actual', actual, s);
    const evs = (evMap.get(s) || []);
    tip.innerHTML = `<b>${dateLabel(s, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</b>`
      + (actual != null ? `<div><i class="k-actual"></i>Check-in total <span>${money(actual, true)}</span></div>` : '')
      + (actual == null && f != null ? `<div><i class="k-fore"></i>Available <span class="${f < 0 ? 'bad' : ''}">${money(f, true)}</span></div>` : '')
      + (actual == null && nn != null ? `<div><i class="k-none"></i>No income <span class="${nn < 0 ? 'bad' : ''}">${money(nn, true)}</span></div>` : '')
      + evs.slice(0, 4).map((e) => `<div class="tev">${esc(e.name)} <span class="${e.amount > 0 ? 'good' : ''}">${e.amount > 0 ? '+' : ''}${money(e.amount, true)}</span></div>`).join('')
      + (evs.length > 4 ? `<div class="tev muted">and ${evs.length - 4} more</div>` : '');
    tip.hidden = false;
    const cx = x(s) / W * box.width, w = tip.offsetWidth;
    tip.style.left = `${cx + 14 + w > box.width ? cx - 14 - w : cx + 14}px`;
    tip.style.top = `${Math.max(0, (ev.clientY - box.top) - tip.offsetHeight / 2)}px`;
  });
}

// ---------- events ----------
function addCheckin(date, balance, by) {
  const last = E.latestCheckin(doc);
  const entry = { date, balance, ...(by ? { by } : {}) };
  if (last && date > last.date) {
    refreshPlan(); // freeze the forecast the previous check-in ends with
    const transferred = E.applyContributions(doc, last.date, date);
    if (transferred) entry.transferred = transferred;
  }
  doc.checkins = doc.checkins.filter((c) => c.date !== date);
  doc.checkins.push(entry);
  doc.checkins.sort((a, b) => (a.date < b.date ? -1 : 1));
  if (E.latestCheckin(doc) === entry) entry.avail = Math.round((balance - E.setAsideTotal(doc)) * 100) / 100;
}

// The latest check-in's forecast follows every edit until the next check-in is saved, so the
// comparison uses the plan as it stood going into that check-in.
function refreshPlan() {
  const last = E.latestCheckin(doc);
  if (last) last.plan = E.planFor(doc, last.date);
}

// Set an item's schedule from its fields; monthly items keep a day of the month.
function fixSchedule(it) {
  if (it.freq === 'monthly') {
    const day = +it.day || (it.start ? E.D(it.start).getUTCDate() : 0);
    // Anchor at the first check-in so a bill due earlier this month still counts between check-ins.
    const from = doc.checkins[0] && doc.checkins[0].date < today() ? doc.checkins[0].date : today();
    if (day) { it.day = day; it.start = E.nextOnDay(day, from); }
  } else {
    delete it.day;
    if (!it.start) it.start = today();
  }
  if (!it.end) delete it.end;
}

const invalid = (input, msg) => { input.setCustomValidity(msg); input.reportValidity(); };

// Save the balances typed into a check-in form. Spending accounts left blank keep their last
// balance; investment values go to the portfolio history.
function saveBalances(form, date) {
  const vals = {};
  for (const input of document.querySelectorAll(`[data-acct-value]`)) {
    if (input.form !== form) continue;
    if (input.value.trim() === '') continue;
    const n = num(input.value);
    if (!isFinite(n)) { invalid(input, 'Enter an amount, like 2450.75'); return false; }
    vals[input.dataset.acctValue] = n;
  }
  const sp = E.spendingAccounts(doc), inv = E.investmentAccounts(doc);
  const lv = E.latestValues(doc);
  if (!Object.keys(vals).length) { const first = document.querySelector(`[data-acct-value]`); if (first) invalid(first, 'Enter at least one balance'); return false; }
  if (sp.some((a) => a.id in vals)) {
    const by = {};
    for (const a of sp) { const v = a.id in vals ? vals[a.id] : lv[a.id]?.value; if (v != null) by[a.id] = v; }
    addCheckin(date, Math.round(Object.values(by).reduce((x, y) => x + y, 0) * 100) / 100, by);
  }
  const invVals = Object.fromEntries(inv.filter((a) => a.id in vals).map((a) => [a.id, vals[a.id]]));
  if (Object.keys(invVals).length) {
    const existing = doc.portfolio.find((p) => p.date === date);
    if (existing) Object.assign(existing.values, invVals); else doc.portfolio.push({ date, values: invVals });
    doc.portfolio.sort((a, b) => (a.date < b.date ? -1 : 1));
  }
  return true;
}

view.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target, data = Object.fromEntries(new FormData(f));
  const kind = f.dataset.form;
  if (kind === 'quick-checkin' || kind === 'checkin') {
    const first = !doc.checkins.length;
    if (!saveBalances(f, kind === 'checkin' ? data.date : today())) return;
    if (kind === 'checkin' && first && doc.checkins.length) location.hash = '#income';
    changed();
  } else if (kind === 'new-acct') {
    const name = data.name.trim();
    if (!name) return;
    const a = { id: uid(), name, kind: data.kind === 'investment' ? 'investment' : 'spending' };
    doc.accounts.push(a);
    focusNext = `v-${a.id}`;
    changed();
  } else if (kind === 'new-item') {
    const k = f.dataset.kind, p = k[0];
    const d = draft[k];
    const nameEl = $(`#${p}new-name`), amountEl = $(`#${p}new-amount`), due = $(`#${p}new-due`);
    const name = nameEl.value.trim(), amount = num(amountEl.value);
    if (!name) return invalid(nameEl, 'Give it a name');
    if (!(amount > 0)) return invalid(amountEl, 'Enter an amount above zero');
    if (due && !due.value) return invalid(due, d.freq === 'monthly' ? 'Pick the day it’s due' : 'Pick the next date');
    const item = { id: uid(), name, amount, freq: d.freq, on: true };
    if (d.freq === 'monthly') item.day = +due.value; else if (due) item.start = due.value;
    const end = $(`#${p}new-end`)?.value; if (end) item.end = end;
    fixSchedule(item);
    (k === 'bill' ? doc.bills : doc.income).push(item);
    draft[k] = { ...newDraft(k), freq: d.freq };
    focusNext = `${p}new-name`;
    changed();
  } else if (kind === 'own-cat') {
    const name = data.name.trim();
    if (!name) return invalid($('#cnew-name'), 'Give it a name');
    doc.categories.push({ id: uid(), name, budget: Math.max(0, num(data.budget) || 0) });
    focusNext = 'cnew-name';
    changed();
  } else if (kind === 'own-goal') {
    const name = data.name.trim();
    if (name) addGoal(name);
  }
});

function addGoal(name) {
  const g = { id: uid(), name, where: SAVINGS_BY_DEFAULT.includes(name) ? 'savings' : 'checking', saved: 0, monthly: 0, day: 1, start: E.nextOnDay(1, tomorrow()) };
  doc.goals.push(g);
  focusNext = `g${g.id}-saved`;
  changed();
}

// Apply an in-place edit to the document. Runs on every keystroke (so a re-render never loses
// what's being typed) and again on change, which then re-renders.
function applyEdit(t) {
  const f = t.dataset.f;
  const itemRow = t.closest('tr[data-id]');
  const catRow = t.closest('tr[data-cat]');
  const goalEl = t.closest('[data-goal]');
  const acctRow = t.closest('tr[data-acct]');
  if (acctRow && f) {
    const a = doc.accounts.find((x) => x.id === acctRow.dataset.acct);
    if (f === 'name') { if (t.value.trim()) a.name = t.value.trim(); } else if (f === 'kind') a.kind = t.value;
  } else if (itemRow) {
    const list = itemRow.dataset.kind === 'bill' ? doc.bills : doc.income;
    const it = list.find((x) => x.id === itemRow.dataset.id);
    if (f === 'on') it.on = t.checked;
    else if (f === 'name') { if (t.value.trim()) it.name = t.value.trim(); }
    else if (f === 'amount') { const n = num(t.value); if (n > 0) it.amount = n; }
    else if (f === 'freq') { it.freq = t.value; if (it.freq !== 'monthly' && !(it.start >= today())) it.start = today(); fixSchedule(it); }
    else if (f === 'day') { it.day = +t.value; fixSchedule(it); }
    else if (f === 'start') { if (t.value) it.start = t.value; }
    else if (f === 'end') { it.end = t.value; fixSchedule(it); }
  } else if (catRow) {
    const c = doc.categories.find((x) => x.id === catRow.dataset.cat);
    if (f === 'name') { if (t.value.trim()) c.name = t.value.trim(); }
    else c.budget = Math.max(0, num(t.value) || 0);
  } else if (goalEl && f) {
    const g = doc.goals.find((x) => x.id === goalEl.dataset.goal);
    if (f === 'name') { if (t.value.trim()) g.name = t.value.trim(); }
    else if (f === 'day') { g.day = +t.value; g.start = E.nextOnDay(g.day, tomorrow()); }
    else g[f] = Math.max(0, num(t.value) || 0);
  } else if (t.dataset.setting === 'cushion') {
    doc.settings.cushion = Math.max(0, num(t.value) || 0);
  } else return false;
  dirty = true;
  return true;
}

view.addEventListener('input', (e) => {
  const t = e.target;
  t.setCustomValidity?.('');
  const row = t.closest('tr[data-draft]');
  if (row) { if (t.dataset.f) draft[row.dataset.kind][t.dataset.f] = t.value; }
  else applyEdit(t);
});

view.addEventListener('change', async (e) => {
  const t = e.target, f = t.dataset.f;
  const draftRow = t.closest('tr[data-draft]');
  if (draftRow) {
    draft[draftRow.dataset.kind][f] = t.value;
    if (f === 'freq') { focusNext = t.id; setTimeout(render); }
  } else if (applyEdit(t)) {
    editedInPlace();
  } else if (t.dataset.act === 'import' && t.files?.[0]) {
    let parsed;
    try { parsed = JSON.parse(await t.files[0].text()); } catch { return status('That file isn’t a Runway backup.'); }
    const next = E.isDoc(parsed) ? parsed : parsed?.items && parsed?.budget ? E.fromLegacy(parsed, parsed.savedEdits) : null;
    if (!next) return status('That file isn’t a Runway backup.');
    if ((doc.checkins.length || doc.bills.length) && !confirm('Replace everything here with this backup?')) return;
    doc = normalize(next);
    location.hash = '#dashboard';
    changed();
  }
});

view.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]');
  if (!b || b.tagName === 'INPUT') return;
  const act = b.dataset.act;
  if (act === 'mode-runway' || act === 'mode-monthly') { doc.settings.mode = act === 'mode-runway' ? 'runway' : 'monthly'; changed(); }
  else if (act === 'cal-month') { calMonth = +b.dataset.i; render(); }
  else if (act === 'skip-setup') { doc.settings.setupDone = true; changed(); }
  else if (act === 'show-setup') { doc.settings.setupDone = false; changed(); }
  else if (act === 'fill-name') {
    const k = b.dataset.kind, p = k[0];
    draft[k].name = b.dataset.name;
    $(`#${p}new-name`).value = b.dataset.name;
    $(`#${p}new-amount`).focus();
  }
  else if (act === 'del') {
    const row = b.closest('tr'); const key = row.dataset.kind === 'bill' ? 'bills' : 'income';
    doc[key] = doc[key].filter((x) => x.id !== row.dataset.id); changed();
  }
  else if (act === 'del-acct') {
    const id = b.closest('tr').dataset.acct, a = doc.accounts.find((x) => x.id === id);
    if (a.kind !== 'investment' && E.spendingAccounts(doc).length === 1) return alert('Keep at least one spending account. You can rename this one.');
    if (confirm(`Remove ${a.name}? Past check-ins keep their totals.`)) { doc.accounts = doc.accounts.filter((x) => x !== a); changed(); }
  }
  else if (act === 'del-checkin') { doc.checkins = doc.checkins.filter((c) => c.date !== b.dataset.date); changed(); }
  else if (act === 'add-cat') {
    const c = { id: uid(), name: b.dataset.name, budget: 0 };
    doc.categories.push(c); focusNext = `c${c.id}-budget`; changed();
  }
  else if (act === 'del-cat') { doc.categories = doc.categories.filter((c) => c.id !== b.closest('tr').dataset.cat); changed(); }
  else if (act === 'add-goal') addGoal(b.dataset.name);
  else if (act === 'del-goal') {
    const g = doc.goals.find((x) => x.id === b.closest('[data-goal]').dataset.goal);
    if (!(+g.saved) || confirm(`Remove ${g.name}? The ${money(+g.saved)} saved for it will count as available again.`)) { doc.goals = doc.goals.filter((x) => x !== g); changed(); }
  }
  else if (act === 'goal-where') { const g = doc.goals.find((x) => x.id === b.closest('[data-goal]').dataset.goal); g.where = b.dataset.where; focusNext = b.id; changed(); }
  else if (act === 'import-legacy' && legacy) { doc = normalize(E.fromLegacy(legacy.data, legacy.state)); legacy = null; changed(); }
  else if (act === 'sample') {
    if (doc.checkins.length && !confirm('Replace what’s here with sample numbers?')) return;
    const res = await fetch('/runway-sample.json'); const s = await res.json();
    const t = E.D(today());
    for (const it of [...s.income, ...s.bills]) {
      if (it.day) it.start = E.nextOnDay(it.day, today());
      else if (it.offsetDays != null) it.start = E.iso(E.addDays(t, it.offsetDays));
      delete it.offsetDays;
    }
    for (const g of s.goals || []) g.start = E.nextOnDay(g.day || 1, tomorrow());
    s.checkins = [{ ...s.checkins[0], date: today() }];
    for (const p of s.portfolio || []) { p.date = E.iso(E.addDays(t, p.offsetDays || 0)); delete p.offsetDays; }
    doc = normalize(s);
    location.hash = '#dashboard'; changed();
  }
  else if (act === 'export') {
    const blob = new Blob([JSON.stringify(doc, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `runway-backup-${today()}.json`; a.click(); URL.revokeObjectURL(a.href);
  }
  else if (act === 'erase') {
    if (!confirm('Erase all your Runway data? This can’t be undone. Download a backup first if you might want it.')) return;
    clearTimeout(saveTimer); await saving;
    if (await store.erase()) { doc = normalize(E.emptyDoc()); dirty = false; location.hash = '#dashboard'; render(); status('Erased'); }
  }
});

// ---------- start ----------
(async () => {
  status('Loading…');
  try {
    const res = await store.load();
    if (!res) return;
    if (res.doc && E.isDoc(res.doc)) doc = normalize(res.doc);
    legacy = res.legacy;
    status(res.doc?.savedAt ? 'Last saved ' + new Date(res.doc.savedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
  } catch {
    status('Couldn’t load your data. Try reloading.');
  }
  render();
})();
