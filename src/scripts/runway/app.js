// Runway app UI. One document per person; every change saves automatically.
// "private" mode stores it through /api/runway (signed in); "demo" keeps it in this browser.
import * as E from './engine.js';
import { BILLS, CATEGORIES } from './catalog.js';

const root = document.getElementById('runway');
const MODE = root.dataset.mode;
const view = document.getElementById('view');
const $ = (sel, el = document) => el.querySelector(sel);

// ---------- formatting ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n, cents = false) => (n < 0 ? '−$' : '$') + Math.abs(n).toLocaleString(undefined, cents ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 0 });
const dateLabel = (s, opts = { month: 'short', day: 'numeric' }) => E.D(s).toLocaleDateString(undefined, { ...opts, timeZone: 'UTC' });
const ord = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 >> 3 ^ 1 && n % 10 < 4) ? n % 10 : 0] || 'th');
const uid = () => Math.random().toString(36).slice(2, 9);
const today = () => E.todayIso();

function schedule(it) {
  const a = E.D(it.start), day = it.day || a.getUTCDate();
  const end = it.end ? ` until ${dateLabel(it.end, { month: 'short', day: 'numeric', year: 'numeric' })}` : '';
  const text = {
    once: `Once on ${dateLabel(it.start, { month: 'short', day: 'numeric', year: 'numeric' })}`,
    weekly: `Weekly from ${dateLabel(it.start)}`,
    biweekly: `Every 2 weeks from ${dateLabel(it.start)}`,
    semimonthly: 'On the 1st and 15th',
    monthly: `Monthly on the ${ord(day)}`,
    quarterly: `Every 3 months on the ${ord(day)} (from ${dateLabel(it.start, { month: 'short' })})`,
    yearly: `Yearly on ${dateLabel(it.start)}`,
  }[it.freq] || '';
  return text + end;
}

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

let doc = E.emptyDoc();
let legacy = null;
let editing = null; // { kind: 'bill' | 'income', id? }
const status = (t) => { $('#saveStatus').textContent = t; };
let saveTimer, saving = Promise.resolve(), dirty = false;

function changed() {
  dirty = true;
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

// ---------- views ----------
const VIEWS = ['dashboard', 'checkin', 'bills', 'income', 'budget', 'settings'];
const current = () => (VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'dashboard');
addEventListener('hashchange', () => { editing = null; render(); });

function render() {
  const v = current();
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === v));
  const due = $('[data-nav="checkin"] .due');
  const last = E.latestCheckin(doc);
  if (due) due.hidden = !!last && E.daysBetween(last.date, today()) < 7;
  view.innerHTML = { dashboard, checkin, bills, income, budget, settings }[v]();
  if (v === 'dashboard') drawChart();
}

function setupSteps() {
  return [
    ['checkin', "Add today's balance", 'What’s in checking (and cash) right now.', doc.checkins.length > 0],
    ['income', 'Add your income', 'Paychecks or any money that comes in regularly.', doc.income.length > 0],
    ['bills', 'Add your bills', 'Rent, phone, subscriptions: anything that repeats.', doc.bills.length > 0],
    ['budget', 'Set an everyday budget', 'Groceries, dining out, gas and other day-to-day spending.', doc.categories.length > 0],
  ];
}

function dashboard() {
  const steps = setupSteps();
  const left = steps.filter((s) => !s[3]);
  const legacyBanner = legacy && !doc.checkins.length ? `
    <section class="panel notice"><div><h2>Bring over your existing forecast?</h2>
      <p class="muted">Your earlier Runway numbers are saved. Bring them in as bills, income and budget categories, then adjust anything here.</p></div>
      <button class="btn" type="button" data-act="import-legacy">Bring them over</button></section>` : '';
  const setup = left.length ? `
    <section class="panel">
      <h2>${doc.checkins.length ? 'Finish setting up' : 'Welcome to Runway'}</h2>
      <p class="muted">${doc.checkins.length ? 'A few more pieces make the forecast more accurate.' : 'Start with four quick steps. Everything is blank until you add it, and you can change anything later.'}</p>
      <ol class="steps">${steps.map(([v, t, d, done]) => `<li class="${done ? 'done' : ''}"><a href="#${v}"><span class="mark">${done ? '✓' : ''}</span><span><b>${t}</b><span class="muted">${d}</span></span></a></li>`).join('')}</ol>
      ${MODE === 'demo' && !doc.checkins.length ? '<p class="muted small">Just looking? <button class="linkbtn" type="button" data-act="sample">Load sample numbers</button> to see a filled-in example.</p>' : ''}
    </section>` : '';
  if (!doc.checkins.length) return top() + legacyBanner + setup;

  const runwayMode = doc.settings.mode === 'runway';
  const m = E.monthly(doc), r = E.runway(doc);
  const last = E.latestCheckin(doc);
  const since = E.sinceLastCheckin(doc);
  const cushion = +doc.settings.cushion || 0;

  const hero = runwayMode ? `
      <div class="eyebrow">If your income stopped tomorrow</div>
      ${r.out ? `<div class="big">Money lasts until <span class="${r.days < 90 ? 'bad' : 'good'}">${dateLabel(r.out, { month: 'short', day: 'numeric', year: 'numeric' })}</span></div>
      <p>About <b>${r.months < 1 ? r.days + ' days' : r.months.toFixed(1) + ' months'}</b> on ${money(m.balance)}, spending ${money(r.burn)} a month on bills and everyday costs${cushion ? `, keeping ${money(cushion)} as a cushion` : ''}.</p>`
    : `<div class="big">Your money lasts <span class="good">2+ years</span></div><p>Even with no income, your balance stays above ${money(cushion)} for at least two years.</p>`}` : `
      <div class="eyebrow">Aim to spend under</div>
      ${m.perDay > 0 ? `<div class="big"><span class="good">${money(m.perDay)}</span> a day</div>
      <p>On average, for everyday spending. That keeps you above ${money(cushion)} through the end of next month, after your bills and income.${m.payday ? ` Until your next paycheck on ${dateLabel(m.payday)}, that’s about <b>${money(m.perDay * m.untilPayday)}</b>.` : ''}</p>`
    : `<div class="big"><span class="bad">${money(0)}</span> a day</div>
      <p>Your bills before the end of next month are more than your balance and income, so there’s no room for everyday spending. <button class="linkbtn" type="button" data-act="mode-runway">Switch to Runway mode</button> to see how long your money lasts and what would stretch it.</p>`}`;

  const kpis = runwayMode ? [
    ['Cash today', money(m.balance), `As of ${dateLabel(last.date)}`],
    ['Monthly burn', money(r.burn), 'Bills plus everyday budget'],
    ['Runway', r.out ? (r.months < 1 ? `${r.days} days` : `${r.months.toFixed(1)} mo`) : '2+ years', r.out ? `Until ${dateLabel(r.out)}` : 'With no income'],
    ['Safety cushion', money(cushion), cushion ? 'Treated as empty' : 'Set one in Settings'],
  ] : [
    ['Balance', money(m.balance), `As of ${dateLabel(last.date)}`],
    ['Income this month', money(m.incomeThisMonth), m.payday ? `Next ${dateLabel(m.payday)}` : 'No upcoming income'],
    ['Bills left this month', money(m.billsLeftThisMonth), `Through ${dateLabel(E.monthEnd(today()))}`],
    ['End of month', money(m.endOfMonth), `Projected, with ${money(m.budget)} everyday budget`, m.endOfMonth < cushion ? 'bad' : ''],
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
      ${upcoming.length ? `<ul class="list">${upcoming.map((u) => `<li><div><div class="t">${esc(u.name)}</div><div class="s">${dateLabel(u.s, { weekday: 'short', month: 'short', day: 'numeric' })}</div></div><div class="amt ${u.amount > 0 ? 'good' : ''}">${u.amount > 0 ? '+' : ''}${money(u.amount, true)}</div></li>`).join('')}</ul>`
        : '<p class="muted">Nothing due in the next 30 days.</p>'}
    </section>
    <section class="panel"><h2>Everyday budget</h2>
      ${doc.categories.length ? `<ul class="list">${[...doc.categories].sort((a, b) => b.budget - a.budget).slice(0, 7).map((c) => `<li><div><div class="t">${esc(c.name)}</div><div class="bar"><i style="width:${Math.max(4, Math.round(c.budget / Math.max(...doc.categories.map((x) => x.budget || 0), 1) * 100))}%"></i></div></div><div class="amt">${money(c.budget)}<span class="s"> /mo</span></div></li>`).join('')}</ul>
        <p class="muted small">${money(m.budget)} a month is about ${money(m.budget * 12 / 365)} a day. <a href="#budget">Edit budget</a></p>`
        : '<p class="muted">No categories yet. <a href="#budget">Set an everyday budget</a> so the forecast includes day-to-day spending.</p>'}
    </section>`;

  return top() + legacyBanner + `
    <section class="panel hero">
      <div class="hero-main">${hero}</div>
      ${checkinMini(since)}
    </section>
    <section class="kpis">${kpis.map(([l, v, n, cls]) => `<div class="kpi"><span class="eyebrow">${l}</span><span class="v ${cls || ''}">${v}</span><span class="n">${n}</span></div>`).join('')}</section>
    <section class="panel chart">
      <div class="chart-head"><h2>Balance: ${doc.checkins.length > 1 ? 'actual and ' : ''}forecast</h2>
        <div class="legend">${doc.checkins.length > 1 ? '<span><i class="k-actual"></i>Your check-ins</span>' : ''}<span><i class="k-fore"></i>Forecast</span>${runwayMode ? '<span><i class="k-none"></i>No income from tomorrow</span>' : ''}${cushion ? `<span><i class="k-cush"></i>Cushion ${money(cushion)}</span>` : ''}</div></div>
      <div id="chart"></div>
    </section>
    <div class="two">${bottom}</div>
    ${setup}`;
}

function top() {
  const showMode = doc.checkins.length > 0;
  return `<div class="top"><div><h1>${{ dashboard: 'Dashboard', checkin: 'Check-in', bills: 'Bills', income: 'Income', budget: 'Everyday budget', settings: 'Settings' }[current()]}</h1></div>
    ${showMode && current() === 'dashboard' ? `<div class="mode" role="group" aria-label="View"><button type="button" data-act="mode-monthly" aria-pressed="${doc.settings.mode !== 'runway'}">Monthly</button><button type="button" data-act="mode-runway" aria-pressed="${doc.settings.mode === 'runway'}">Runway</button></div>` : ''}</div>`;
}

function checkinMini(since) {
  const last = E.latestCheckin(doc);
  const ago = E.daysBetween(last.date, today());
  let note = `Last check-in ${ago === 0 ? 'today' : ago === 1 ? 'yesterday' : ago + ' days ago'}.`;
  if (since) {
    const diff = since.budgeted - since.spent;
    note += ` Between your last two check-ins you spent about <b>${money(Math.max(0, since.spent))}</b> on everyday things, <span class="delta ${diff < 0 ? 'bad' : ''}">${money(Math.abs(diff))} ${diff < 0 ? 'over' : 'under'} budget</span>.`;
  }
  return `<form class="checkin" data-form="quick-checkin">
      <label for="qBal">${ago >= 7 ? 'Time for a check-in: what’s' : 'Check in: what’s'} in your account today?</label>
      <div class="row"><input id="qBal" name="balance" inputmode="decimal" placeholder="${esc(money(last.balance, true))}" autocomplete="off" required><button class="btn" type="submit">Update</button></div>
      <div class="note">${note}</div>
    </form>`;
}

function checkin() {
  const since = E.sinceLastCheckin(doc);
  const rows = [...doc.checkins].reverse();
  return top() + `
    <section class="panel">
      <h2>Update your balance</h2>
      <p class="muted">Add up checking and any cash you’d spend from. Checking in weekly or monthly keeps the forecast honest and shows how your spending tracks against your budget.</p>
      <form class="form-row" data-form="checkin">
        <label>Date<input type="date" name="date" value="${today()}" max="${today()}" required></label>
        <label>Balance<input name="balance" inputmode="decimal" placeholder="$0.00" required autocomplete="off"></label>
        <button class="btn" type="submit">Save check-in</button>
      </form>
      ${since ? `<p class="callout">From ${dateLabel(since.from)} to ${dateLabel(since.to)}, about <b>${money(Math.max(0, since.spent))}</b> went to everyday spending (after known bills and income). Your budget for those ${since.days} days was ${money(since.budgeted)}.</p>` : ''}
    </section>
    <section class="panel"><h2>History</h2>
      ${rows.length ? `<table class="tbl"><thead><tr><th>Date</th><th class="num">Balance</th><th></th></tr></thead><tbody>${rows.map((c) => `<tr><td>${dateLabel(c.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</td><td class="num">${money(c.balance, true)}</td><td class="num"><button class="linkbtn" type="button" data-act="del-checkin" data-date="${c.date}">Remove</button></td></tr>`).join('')}</tbody></table>`
        : '<p class="muted">No check-ins yet.</p>'}
    </section>`;
}

function picker(catalog, field, selected) {
  const chip = (n) => `<button type="button" class="pick ${selected === n ? 'on' : ''}" data-pick="${esc(n)}" data-field="${field}">${esc(n)}</button>`;
  const inMore = catalog.more.includes(selected);
  return `<div class="picker">
      <div class="picks">${catalog.common.map(chip).join('')}</div>
      <details ${inMore ? 'open' : ''}><summary>More options</summary><div class="picks">${catalog.more.map(chip).join('')}</div></details>
    </div>`;
}

function itemForm(kind) {
  const list = kind === 'bill' ? doc.bills : doc.income;
  const it = editing?.id ? list.find((x) => x.id === editing.id) : null;
  const v = it || { name: '', amount: '', freq: kind === 'bill' ? 'monthly' : 'biweekly', start: today(), end: '' };
  const incomeNames = { common: ['Paycheck', 'Side income', 'Benefits', 'Child support', 'Rental income'], more: [] };
  return `<section class="panel editor">
      <h2>${it ? 'Edit' : 'Add'} ${kind === 'bill' ? 'a bill' : 'income'}</h2>
      <form data-form="${kind}">
        <div class="field"><span class="lbl">${kind === 'bill' ? 'What is it?' : 'Where does it come from?'}</span>
          ${kind === 'bill' ? picker(BILLS, 'name', v.name) : `<div class="picks">${incomeNames.common.map((n) => `<button type="button" class="pick ${v.name === n ? 'on' : ''}" data-pick="${n}" data-field="name">${n}</button>`).join('')}</div>`}
          <label class="own">${kind === 'bill' ? 'Or add your own' : 'Name'}<input name="name" value="${esc(v.name)}" placeholder="${kind === 'bill' ? 'e.g. Music lessons' : 'e.g. Paycheck'}" required maxlength="60"></label>
        </div>
        <div class="grid3">
          <label>Amount<input name="amount" inputmode="decimal" value="${v.amount === '' ? '' : esc(v.amount)}" placeholder="$0.00" required></label>
          <label>How often<select name="freq">${E.FREQS.map(([k, t]) => `<option value="${k}" ${v.freq === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
          <label><span data-start-label>${v.freq === 'once' ? 'Date' : 'Next date'}</span><input type="date" name="start" value="${esc(v.start)}" required></label>
        </div>
        <details ${v.end ? 'open' : ''}><summary>Ends on a date (optional)</summary>
          <label class="inline">Last date<input type="date" name="end" value="${esc(v.end || '')}"></label>
        </details>
        <div class="actions"><button class="btn" type="submit">${it ? 'Save changes' : kind === 'bill' ? 'Add bill' : 'Add income'}</button><button class="btn ghost" type="button" data-act="cancel-edit">Cancel</button></div>
      </form>
    </section>`;
}

function itemTable(kind) {
  const list = kind === 'bill' ? doc.bills : doc.income;
  if (!list.length) return `<p class="muted">${kind === 'bill' ? 'No bills yet. Add rent, utilities, subscriptions, anything that repeats.' : 'No income yet. Add paychecks or anything that comes in regularly.'}</p>`;
  const total = list.reduce((a, x) => a + E.perMonth(x), 0);
  return `<table class="tbl"><thead><tr><th class="chk">On</th><th>${kind === 'bill' ? 'Bill' : 'Source'}</th><th>When</th><th class="num">Amount</th><th class="num">Per month</th><th></th></tr></thead><tbody>
    ${list.map((x) => `<tr class="${x.on === false ? 'off' : ''}"><td class="chk"><input type="checkbox" aria-label="Include ${esc(x.name)}" data-act="toggle" data-kind="${kind}" data-id="${x.id}" ${x.on === false ? '' : 'checked'}></td>
      <td>${esc(x.name)}</td><td class="muted">${esc(schedule(x))}</td><td class="num">${money(+x.amount, true)}</td><td class="num muted">${E.perMonth(x) ? money(E.perMonth(x)) : '—'}</td>
      <td class="num nowrap"><button class="linkbtn" type="button" data-act="edit" data-kind="${kind}" data-id="${x.id}">Edit</button> <button class="linkbtn" type="button" data-act="del" data-kind="${kind}" data-id="${x.id}">Remove</button></td></tr>`).join('')}
    </tbody><tfoot><tr><td></td><td colspan="3"><b>Total per month</b> <span class="muted">(checked items)</span></td><td class="num"><b>${money(total)}</b></td><td></td></tr></tfoot></table>
    <p class="muted small">Uncheck something to see the forecast without it.</p>`;
}

function bills() {
  return top() + (editing?.kind === 'bill' ? itemForm('bill') : `<div class="bar-actions"><button class="btn" type="button" data-act="add" data-kind="bill">Add a bill</button></div>`) +
    `<section class="panel">${itemTable('bill')}</section>`;
}
function income() {
  return top() + (editing?.kind === 'income' ? itemForm('income') : `<div class="bar-actions"><button class="btn" type="button" data-act="add" data-kind="income">Add income</button></div>`) +
    `<section class="panel">${itemTable('income')}</section>`;
}

function budget() {
  const total = E.budgetTotal(doc);
  const used = new Set(doc.categories.map((c) => c.name));
  const chip = (n) => `<button type="button" class="pick" data-act="add-cat" data-name="${esc(n)}" ${used.has(n) ? 'disabled' : ''}>+ ${esc(n)}</button>`;
  return top() + `
    <section class="panel">
      <h2>Monthly amounts</h2>
      <p class="muted">Day-to-day spending that isn’t a fixed bill. The forecast spreads it evenly across each day.</p>
      ${doc.categories.length ? `<div class="cats">${doc.categories.map((c) => `<div class="cat"><label for="cat-${c.id}">${esc(c.name)}</label><input id="cat-${c.id}" inputmode="decimal" data-cat="${c.id}" value="${c.budget || ''}" placeholder="$0"><button class="linkbtn" type="button" data-act="del-cat" data-id="${c.id}" aria-label="Remove ${esc(c.name)}">Remove</button></div>`).join('')}</div>
        <p class="total">Total <b>${money(total)}</b> a month · about ${money(total * 12 / 365)} a day</p>` : '<p class="muted">No categories yet. Pick some below.</p>'}
    </section>
    <section class="panel">
      <h2>Add a category</h2>
      <div class="picks">${CATEGORIES.common.map(chip).join('')}</div>
      <details><summary>More options</summary><div class="picks">${CATEGORIES.more.map(chip).join('')}</div></details>
      <form class="form-row" data-form="own-cat"><label>Add your own<input name="name" maxlength="40" placeholder="Name it anything" required></label><button class="btn ghost" type="submit">Add</button></form>
    </section>`;
}

function settings() {
  return top() + `
    <section class="panel">
      <h2>Safety cushion</h2>
      <p class="muted">Treat this much as “empty”, so the forecast warns you before you get close to $0.</p>
      <label class="inline">Cushion<input inputmode="decimal" data-setting="cushion" value="${+doc.settings.cushion || ''}" placeholder="$0"></label>
    </section>
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

// ---------- chart ----------
function drawChart() {
  const el = document.getElementById('chart');
  if (!el) return;
  const runwayMode = doc.settings.mode === 'runway';
  const t = today();
  const horizon = runwayMode ? 365 : 92;
  const fore = E.simulate(doc, { today: t, days: horizon });
  const none = runwayMode ? E.simulate(doc, { today: t, days: horizon, noIncomeFrom: E.iso(E.addDays(E.D(t), 1)) }) : [];
  const past = doc.checkins.filter((c) => E.daysBetween(c.date, t) <= (runwayMode ? 180 : 92));
  const start = past.length ? past[0].date : t;
  const end = fore.length ? fore[fore.length - 1].s : t;
  const span = Math.max(1, E.daysBetween(start, end));
  const cushion = +doc.settings.cushion || 0;
  const vals = [...past.map((c) => c.balance), ...fore.map((r) => r.bal), ...none.map((r) => r.bal), cushion, 0];
  let lo = Math.min(...vals), hi = Math.max(...vals);
  lo = Math.max(lo, -Math.max(2000, hi * 0.6));
  const pad = (hi - lo) * 0.08 || 500; lo -= pad; hi += pad;
  const W = 1000, H = 260, pl = 64, pr = 14, pt = 12, pb = 28;
  const x = (s) => pl + E.daysBetween(start, s) / span * (W - pl - pr);
  const y = (v) => pt + (hi - Math.max(v, lo)) * (H - pt - pb) / (hi - lo);
  const line = (pts) => pts.map(([s, v]) => `${x(s).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  let g = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Balance chart">`;
  for (let i = 0; i <= 4; i++) { const v = lo + (hi - lo) * i / 4; g += `<line x1="${pl}" x2="${W - pr}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="grid"/><text x="${pl - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${money(v)}</text>`; }
  g += `<line x1="${pl}" x2="${W - pr}" y1="${y(0)}" y2="${y(0)}" class="zero"/>`;
  if (cushion) g += `<line x1="${pl}" x2="${W - pr}" y1="${y(cushion)}" y2="${y(cushion)}" class="cush"/>`;
  // month labels
  for (let d = E.D(start.slice(0, 8) + '01'); E.iso(d) <= end; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    const s = E.iso(d); if (s < start) continue;
    g += `<text x="${x(s).toFixed(1)}" y="${H - 8}" text-anchor="middle">${dateLabel(s, { month: 'short' })}</text>`;
  }
  const last = E.latestCheckin(doc);
  const foreline = [[t, last.date === t ? last.balance : (fore[0]?.bal ?? last.balance)], ...fore.map((r) => [r.s, r.bal])];
  g += `<polygon points="${x(t)},${y(lo)} ${line(foreline)} ${x(end)},${y(lo)}" class="fore-fill"/>`;
  g += `<polyline points="${line(foreline)}" class="fore"/>`;
  if (none.length) g += `<polyline points="${line([[t, foreline[0][1]], ...none.map((r) => [r.s, r.bal])])}" class="none"/>`;
  if (past.length > 1) g += `<polyline points="${line(past.map((c) => [c.date, c.balance]))}" class="actual"/>`;
  past.forEach((c) => { g += `<circle cx="${x(c.date).toFixed(1)}" cy="${y(c.balance).toFixed(1)}" r="3.5" class="dot"/>`; });
  g += `<line x1="${x(t)}" x2="${x(t)}" y1="${pt}" y2="${H - pb}" class="today"/><text x="${x(t) + 4}" y="${pt + 10}" class="today-t">Today</text>`;
  el.innerHTML = g + '</svg>';
}

// ---------- events ----------
const num = (v) => { const n = parseFloat(String(v).replace(/[^0-9.-]/g, '')); return isFinite(n) ? Math.round(n * 100) / 100 : NaN; };

function addCheckin(date, balance) {
  doc.checkins = doc.checkins.filter((c) => c.date !== date);
  doc.checkins.push({ date, balance });
  doc.checkins.sort((a, b) => (a.date < b.date ? -1 : 1));
}

view.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target, data = Object.fromEntries(new FormData(f));
  const kind = f.dataset.form;
  if (kind === 'quick-checkin' || kind === 'checkin') {
    const bal = num(data.balance);
    if (!isFinite(bal)) return f.querySelector('[name=balance]').setCustomValidity('Enter an amount, like 2450.75'), f.reportValidity();
    addCheckin(kind === 'checkin' ? data.date : today(), bal);
    if (kind === 'checkin' && doc.checkins.length === 1) location.hash = '#income';
    changed();
  } else if (kind === 'bill' || kind === 'income') {
    const amount = num(data.amount);
    if (!(amount > 0)) return f.querySelector('[name=amount]').setCustomValidity('Enter an amount above zero'), f.reportValidity();
    const list = kind === 'bill' ? doc.bills : doc.income;
    const existing = editing?.id && list.find((x) => x.id === editing.id);
    const item = { id: existing?.id || uid(), name: data.name.trim(), amount, freq: data.freq, start: data.start, ...(data.end ? { end: data.end } : {}), on: existing ? existing.on !== false : true };
    if (existing?.day && data.freq !== 'weekly' && data.freq !== 'biweekly' && E.D(data.start).getUTCDate() === E.D(existing.start).getUTCDate()) item.day = existing.day;
    if (existing) list[list.indexOf(existing)] = item; else list.push(item);
    editing = null;
    changed();
  } else if (kind === 'own-cat') {
    const name = data.name.trim();
    if (name) { doc.categories.push({ id: uid(), name, budget: 0 }); changed(); setTimeout(() => document.querySelector(`[data-cat]:last-of-type`)?.focus(), 0); }
  }
});

view.addEventListener('input', (e) => {
  const t = e.target;
  if (t.name === 'balance' || t.name === 'amount') t.setCustomValidity('');
  if (t.dataset.cat) {
    const c = doc.categories.find((x) => x.id === t.dataset.cat);
    c.budget = Math.max(0, num(t.value) || 0);
    clearTimeout(saveTimer); dirty = true;
    // Update the total in place so typing isn't interrupted by a re-render.
    const tot = $('.total', view); const total = E.budgetTotal(doc);
    if (tot) tot.innerHTML = `Total <b>${money(total)}</b> a month · about ${money(total * 12 / 365)} a day`;
    debouncedSave();
  } else if (t.dataset.setting === 'cushion') {
    doc.settings.cushion = Math.max(0, num(t.value) || 0);
    dirty = true; debouncedSave();
  } else if (t.name === 'freq') {
    const lbl = $('[data-start-label]', view); if (lbl) lbl.textContent = t.value === 'once' ? 'Date' : 'Next date';
  } else if (t.name === 'name') {
    t.closest('form').querySelectorAll('.pick').forEach((p) => p.classList.toggle('on', p.dataset.pick === t.value));
  }
});
function debouncedSave() {
  status('Saving…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => changed(), 700);
}

view.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.dataset.act === 'toggle') {
    const list = t.dataset.kind === 'bill' ? doc.bills : doc.income;
    list.find((x) => x.id === t.dataset.id).on = t.checked;
    changed();
  } else if (t.dataset.act === 'import' && t.files?.[0]) {
    let parsed;
    try { parsed = JSON.parse(await t.files[0].text()); } catch { return status('That file isn’t a Runway backup.'); }
    const next = E.isDoc(parsed) ? parsed : parsed?.items && parsed?.budget ? E.fromLegacy(parsed, parsed.savedEdits) : null;
    if (!next) return status('That file isn’t a Runway backup.');
    if ((doc.checkins.length || doc.bills.length) && !confirm('Replace everything here with this backup?')) return;
    doc = { ...E.emptyDoc(), ...next, settings: { ...E.emptyDoc().settings, ...next.settings } };
    location.hash = '#dashboard';
    changed();
  }
});

view.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act], [data-pick]');
  if (!b) return;
  if (b.dataset.pick) {
    const input = b.closest('form').querySelector(`[name="${b.dataset.field}"]`);
    input.value = b.dataset.pick;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    b.closest('form').querySelector('[name=amount]')?.focus();
    return;
  }
  const act = b.dataset.act;
  if (act === 'mode-runway' || act === 'mode-monthly') { doc.settings.mode = act === 'mode-runway' ? 'runway' : 'monthly'; changed(); }
  else if (act === 'add') { editing = { kind: b.dataset.kind }; render(); $('[name=name]', view)?.focus(); }
  else if (act === 'edit') { editing = { kind: b.dataset.kind, id: b.dataset.id }; render(); scrollTo({ top: 0 }); }
  else if (act === 'cancel-edit') { editing = null; render(); }
  else if (act === 'del') {
    const key = b.dataset.kind === 'bill' ? 'bills' : 'income';
    const it = doc[key].find((x) => x.id === b.dataset.id);
    if (confirm(`Remove ${it.name}?`)) { doc[key] = doc[key].filter((x) => x !== it); changed(); }
  }
  else if (act === 'del-checkin') { doc.checkins = doc.checkins.filter((c) => c.date !== b.dataset.date); changed(); }
  else if (act === 'add-cat') { doc.categories.push({ id: uid(), name: b.dataset.name, budget: 0 }); changed(); setTimeout(() => $(`#cat-${doc.categories[doc.categories.length - 1].id}`)?.focus(), 0); }
  else if (act === 'del-cat') { doc.categories = doc.categories.filter((c) => c.id !== b.dataset.id); changed(); }
  else if (act === 'import-legacy' && legacy) { doc = E.fromLegacy(legacy.data, legacy.state); legacy = null; changed(); }
  else if (act === 'sample') {
    if (doc.checkins.length && !confirm('Replace what’s here with sample numbers?')) return;
    const res = await fetch('/runway-sample.json'); doc = await res.json();
    doc.checkins = [{ date: today(), balance: doc.checkins?.[0]?.balance ?? 4200 }];
    const t = E.D(today());
    for (const it of [...doc.income, ...doc.bills]) {
      if (it.day) { const m = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + (t.getUTCDate() >= it.day ? 1 : 0), it.day)); it.start = E.iso(m); }
      else if (it.offsetDays != null) it.start = E.iso(E.addDays(t, it.offsetDays));
      delete it.offsetDays;
    }
    location.hash = '#dashboard'; changed();
  }
  else if (act === 'export') {
    const blob = new Blob([JSON.stringify(doc, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `runway-backup-${today()}.json`; a.click(); URL.revokeObjectURL(a.href);
  }
  else if (act === 'erase') {
    if (!confirm('Erase all your Runway data? This can’t be undone. Download a backup first if you might want it.')) return;
    clearTimeout(saveTimer); await saving;
    if (await store.erase()) { doc = E.emptyDoc(); dirty = false; location.hash = '#dashboard'; render(); status('Erased'); }
  }
});

// ---------- start ----------
(async () => {
  status('Loading…');
  try {
    const res = await store.load();
    if (!res) return;
    if (res.doc && E.isDoc(res.doc)) doc = { ...E.emptyDoc(), ...res.doc, settings: { ...E.emptyDoc().settings, ...res.doc.settings } };
    legacy = res.legacy;
    status(res.doc?.savedAt ? 'Last saved ' + new Date(res.doc.savedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
  } catch {
    status('Couldn’t load your data. Try reloading.');
  }
  render();
})();
