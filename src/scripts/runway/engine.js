// Runway forecast engine. Pure functions, no DOM, so it can be tested in Node.
//
// A Runway document:
// {
//   version: 2,
//   checkins:   [{ date: 'YYYY-MM-DD', balance: number, by?: { [accountId]: number }, transferred?: number }],
//                 // newest last; balance = total of spending accounts (`by`); transferred = moved to savings since the previous one
//   income:     [{ id, name, amount, freq, start: 'YYYY-MM-DD', end?: 'YYYY-MM-DD', on?: boolean }],
//   bills:      [{ id, name, category?, amount, freq, start, end?, on?: boolean }],
//   categories: [{ id, name, budget }],                        // monthly everyday-spending budgets
//   goals:      [{ id, name, where: 'checking' | 'savings', saved, target?, monthly, day, start }],
//   settings:   { mode: 'monthly' | 'runway', cushion: number, setupDone?: boolean },
// }
// Goals are money put aside each month. 'savings' goals are transfers to a separate account;
// 'checking' goals stay in checking but are set aside, so the available balance is lower.
// `saved` is the amount as of the latest check-in and `start` is the next contribution date;
// contributions stop once the target is reached.
// freq: 'once' | 'weekly' | 'biweekly' | 'semimonthly' | 'monthly' | 'quarterly' | 'yearly'.
// `start` anchors the schedule: the first date for weekly/biweekly/once, and the day of the
// month (and month, for quarterly/yearly) for the rest. Semimonthly is the 1st and 15th.

export const FREQS = [
  ['monthly', 'Monthly'],
  ['biweekly', 'Every 2 weeks'],
  ['weekly', 'Weekly'],
  ['semimonthly', 'Twice a month (1st & 15th)'],
  ['quarterly', 'Every 3 months'],
  ['yearly', 'Yearly'],
  ['once', 'One time'],
];

export const emptyDoc = () => ({
  version: 2,
  checkins: [],
  income: [],
  bills: [],
  categories: [],
  goals: [],
  accounts: [],   // [{ id, name, kind: 'spending' | 'investment' }]
  portfolio: [],  // investment balances: [{ date, values: { [accountId]: number } }], newest last
  settings: { mode: 'monthly', cushion: 0 },
});

// ---------- dates (UTC, day precision) ----------
export const D = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
export const iso = (d) => d.toISOString().slice(0, 10);
export const addDays = (d, n) => new Date(d.getTime() + n * 864e5);
export const daysBetween = (a, b) => Math.round((D(b) - D(a)) / 864e5);
const dim = (y, m0) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
export const todayIso = (now = new Date()) => iso(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
export const monthEnd = (s) => { const d = D(s); return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))); };

// Does a schedule hit on day `s`? Monthly-style schedules repeat on the anchor's day of the
// month (or `day`, when set, so a 31st bill still lands on the last day of short months).
export function hits(item, s) {
  if (item.on === false || !item.start || !(item.amount > 0)) return false;
  if (s < item.start || (item.end && s > item.end)) return false;
  const d = D(s), a = D(item.start);
  const day = d.getUTCDate(), m0 = d.getUTCMonth();
  const aDay = Math.min(item.day || a.getUTCDate(), dim(d.getUTCFullYear(), m0)), aM0 = a.getUTCMonth();
  switch (item.freq) {
    case 'once': return s === item.start;
    case 'weekly': return daysBetween(item.start, s) % 7 === 0;
    case 'biweekly': return daysBetween(item.start, s) % 14 === 0;
    case 'semimonthly': return day === 1 || day === 15;
    case 'monthly': return day === aDay;
    case 'quarterly': return (((m0 - aM0) % 3) + 3) % 3 === 0 && day === aDay;
    case 'yearly': return m0 === aM0 && day === aDay;
    default: return false;
  }
}

// Average monthly amount of a schedule (for "per month" summaries).
export function perMonth(item) {
  if (item.on === false) return 0;
  const k = { weekly: 52 / 12, biweekly: 26 / 12, semimonthly: 2, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12, once: 0 }[item.freq] ?? 0;
  return (+item.amount || 0) * k;
}

export const budgetTotal = (doc) => doc.categories.reduce((a, c) => a + (+c.budget || 0), 0);
export const latestCheckin = (doc) => doc.checkins.length ? doc.checkins[doc.checkins.length - 1] : null;
const goals = (doc) => doc.goals || [];
export const setAsideTotal = (doc) => goals(doc).filter((g) => g.where === 'checking').reduce((a, g) => a + (+g.saved || 0), 0);
export const savingsTotal = (doc) => goals(doc).filter((g) => g.where === 'savings').reduce((a, g) => a + (+g.saved || 0), 0);
export const goalMonthly = (g) => (g.target > 0 && g.saved >= g.target ? 0 : +g.monthly || 0);
export const savingTotal = (doc) => goals(doc).reduce((a, g) => a + goalMonthly(g), 0);
// Spendable balance now: the latest check-in minus money set aside for goals kept in checking.
export const available = (doc) => { const c = latestCheckin(doc); return c ? c.balance - setAsideTotal(doc) : 0; };

// Does goal `g` get a contribution on day `s`? Monthly on its day, until the target is met.
export function goalHits(g, s) {
  if (!(g.monthly > 0) || !g.start || !hits({ freq: 'monthly', amount: g.monthly, start: g.start, day: g.day }, s)) return false;
  if (!(g.target > 0)) return true;
  const n = Math.ceil(Math.max(0, g.target - (+g.saved || 0)) / g.monthly);
  const a = D(g.start), d = D(s);
  return (d.getUTCFullYear() - a.getUTCFullYear()) * 12 + d.getUTCMonth() - a.getUTCMonth() < n;
}

// Next date on or after `from` that falls on day-of-month `day` (clamped to short months).
export function nextOnDay(day, from = todayIso()) {
  const f = D(from);
  for (let k = 0; k < 2; k++) {
    const y = f.getUTCFullYear(), m0 = f.getUTCMonth() + k;
    const d = new Date(Date.UTC(y, m0, Math.min(day, dim(y, m0))));
    if (iso(d) >= from) return iso(d);
  }
  return from;
}

// Events (income, bills and goal contributions) on day `s`.
export function eventsOn(doc, s, { noIncomeFrom } = {}) {
  const ev = [];
  for (const it of doc.income) if (hits(it, s) && !(noIncomeFrom && s >= noIncomeFrom)) ev.push({ kind: 'income', name: it.name, amount: +it.amount });
  for (const b of doc.bills) if (hits(b, s)) ev.push({ kind: 'bill', name: b.name, amount: -b.amount, id: b.id, category: b.category });
  // With income stopped, goal contributions pause too.
  if (!noIncomeFrom) for (const g of goals(doc)) if (goalHits(g, s)) ev.push({ kind: 'save', name: g.name, amount: -g.monthly, id: g.id, where: g.where });
  return ev;
}

// Move goal balances forward for contributions made after `from` through `to` (a new check-in).
// Returns how much went to separate savings accounts in that time.
export function applyContributions(doc, from, to) {
  let transferred = 0;
  for (const g of goals(doc)) {
    if (!g.start) continue;
    const before = { ...g }; // the schedule as it stood at the last check-in
    for (let d = addDays(D(from), 1); iso(d) <= to; d = addDays(d, 1)) {
      if (goalHits(before, iso(d))) {
        g.saved = Math.round(((+g.saved || 0) + g.monthly) * 100) / 100;
        if (g.where === 'savings') transferred += g.monthly;
      }
    }
    if (g.target > 0) g.saved = Math.min(g.saved, Math.max(g.target, 0));
    if (g.start <= to) g.start = nextOnDay(g.day || D(g.start).getUTCDate(), iso(addDays(D(to), 1)));
  }
  return transferred;
}

// Day-by-day balance from the latest check-in. Returns rows from `from` (default today).
// opts: { days, noIncomeFrom, skipBill, budgetScale, today }
export function simulate(doc, opts = {}) {
  const today = opts.today || todayIso();
  const last = latestCheckin(doc);
  if (!last) return [];
  const daily = budgetTotal(doc) * (opts.budgetScale ?? 1) * 12 / 365;
  const startDay = last.date < today ? last.date : today;
  const days = opts.days ?? 365;
  const out = [];
  let bal = opts.allCash ? last.balance + savingsTotal(doc) : available(doc);
  // The check-in balance is end-of-day for its date, so start the next day.
  for (let d = addDays(D(startDay), 1); out.length < days; d = addDays(d, 1)) {
    const s = iso(d);
    const ev = eventsOn(doc, s, opts).filter((e) => e.id === undefined || e.id !== opts.skipBill);
    const net = ev.reduce((a, e) => a + e.amount, 0) - daily;
    bal += net;
    if (s > today || (s === today && last.date < today)) out.push({ s, bal, ev });
  }
  return out;
}

export function firstBelow(rows, line = 0) {
  const r = rows.find((x) => x.bal < line);
  return r ? r.s : null;
}

// When money runs out for good: the first day of the last stretch below the line, so a
// short dip before a paycheck doesn't count as running out. Null if it never stays below.
export function runsOut(rows, line = 0) {
  let i = rows.length;
  while (i > 0 && rows[i - 1].bal < line) i--;
  return i < rows.length ? rows[i].s : null;
}

// Short dips below the line that recover before money runs out for good.
export function dips(rows, line = 0, until = null) {
  const out = [];
  let cur = null;
  for (const r of rows) {
    if (until && r.s >= until) break;
    if (r.bal < line) {
      if (!cur) cur = { from: r.s, low: r.bal, lowOn: r.s };
      else if (r.bal < cur.low) { cur.low = r.bal; cur.lowOn = r.s; }
    } else if (cur) { out.push({ ...cur, to: r.s }); cur = null; }
  }
  return out;
}

// Next income date after today (null if none within a year).
export function nextPayday(doc, today = todayIso()) {
  for (let i = 1; i <= 366; i++) {
    const s = iso(addDays(D(today), i));
    if (doc.income.some((it) => hits(it, s))) return s;
  }
  return null;
}

function sumEvents(doc, from, to, kind) {
  let t = 0;
  for (let d = D(from); iso(d) <= to; d = addDays(d, 1)) {
    for (const e of eventsOn(doc, iso(d))) if (e.kind === kind) t += Math.abs(e.amount);
  }
  return t;
}

// Everything the Monthly dashboard shows.
// The daily number is the most you could spend every day, on average, without the balance
// dropping below the safety cushion before the end of next month, given known income and bills.
export function monthly(doc, today = todayIso()) {
  const last = latestCheckin(doc);
  const cushion = +doc.settings.cushion || 0;
  const balance = available(doc);
  const payday = nextPayday(doc, today);
  const nextMonthEnd = monthEnd(iso(addDays(D(monthEnd(today)), 1)));
  let perDay = Infinity, running = balance - cushion, t = 0;
  for (let d = addDays(D(today), 1); iso(d) <= nextMonthEnd; d = addDays(d, 1)) {
    t += 1;
    for (const e of eventsOn(doc, iso(d))) running += e.amount;
    perDay = Math.min(perDay, running / t);
  }
  if (!isFinite(perDay)) perDay = running;
  // Spending is counted from tomorrow; today's spending is assumed to be in the check-in balance
  // when the check-in is today, otherwise today counts too.
  const untilPayday = payday ? daysBetween(today, payday) : null;
  const mEnd = monthEnd(today), mStart = today.slice(0, 8) + '01', tomorrow = iso(addDays(D(today), 1));
  const rows = simulate(doc, { today, days: daysBetween(today, mEnd) + 1 });
  const endRow = rows.find((r) => r.s === mEnd);
  return {
    balance,
    payday,
    untilPayday,
    perDay,
    incomeThisMonth: sumEvents(doc, mStart, mEnd, 'income'),
    billsLeftThisMonth: today < mEnd ? sumEvents(doc, tomorrow, mEnd, 'bill') : 0,
    budget: budgetTotal(doc),
    savingThisMonth: sumEvents(doc, mStart, mEnd, 'save'),
    endOfMonth: endRow ? endRow.bal : balance,
  };
}

// Bills people can't realistically cut aren't suggested as levers.
const ESSENTIAL = /rent|mortgage|insurance|loan|tax|irs|electric|power|gas|water|sewer|trash|utilit|child|alimony|car payment|credit card/i;
export const isEssential = (b) => ESSENTIAL.test(`${b.category || ''} ${b.name}`);

// Everything Runway mode shows: when the available balance would first drop below the cushion,
// with income and bills as scheduled (so an income end date, like severance, shows up here).
export function runway(doc, today = todayIso()) {
  const line = +doc.settings.cushion || 0;
  // Look 60 days past the two-year horizon so a dip that straddles its end isn't read as running out.
  const base = { today, days: 790 };
  const within = (o) => (o && daysBetween(today, o) <= 730 ? o : null);
  const rows = simulate(doc, base);
  const out = within(runsOut(rows, line));
  const days = out ? daysBetween(today, out) : null;
  const gain = (alt) => {
    const o = within(runsOut(simulate(doc, { ...base, ...alt }), line));
    return o === null ? Infinity : daysBetween(today, o) - (days ?? 0);
  };
  const levers = out === null ? [] : [
    ...doc.bills.filter((b) => b.on !== false && perMonth(b) > 0 && !isEssential(b)).map((b) => ({ label: `Cut ${b.name}`, sub: `${Math.round(perMonth(b))} / month`, days: gain({ skipBill: b.id }) })),
    ...(budgetTotal(doc) > 0 ? [{ label: 'Trim everyday spending by 20%', sub: `${Math.round(budgetTotal(doc) * 0.2)} / month`, days: gain({ budgetScale: 0.8 }) }] : []),
  ].filter((l) => l.days > 0).sort((a, b) => b.days - a.days).slice(0, 3);
  const burn = doc.bills.reduce((a, b) => a + perMonth(b), 0) + budgetTotal(doc);
  return { out, days, months: days === null ? null : days / 30.44, burn, levers, cash: available(doc), dips: dips(rows, line, out || iso(addDays(D(today), 731))) };
}

// Spending inferred between the last two check-ins: what left the account that isn't a known bill.
export function sinceLastCheckin(doc) {
  const n = doc.checkins.length;
  if (n < 2) return null;
  const a = doc.checkins[n - 2], b = doc.checkins[n - 1];
  const days = daysBetween(a.date, b.date);
  if (days <= 0) return null;
  // Money kept in checking for goals is still in the balance; transfers to savings are not.
  let income = 0, bills = 0;
  for (let d = addDays(D(a.date), 1); iso(d) <= b.date; d = addDays(d, 1)) {
    for (const e of eventsOn(doc, iso(d))) if (e.kind === 'income') income += e.amount; else if (e.kind === 'bill') bills -= e.amount;
  }
  const spent = a.balance + income - bills - b.balance - (+b.transferred || 0);
  const budgeted = budgetTotal(doc) * 12 / 365 * days;
  return { from: a.date, to: b.date, days, spent, budgeted };
}

// Convert the first Runway data file (version 1) into a version 2 document.
export function fromLegacy(old, saved) {
  const doc = emptyDoc();
  const inputs = { ...old.defaults, ...saved?.inputs };
  const on = saved?.on || {};
  const budget = saved?.budget || {};
  const S = old.settings || {};
  const start = S.start && S.start !== 'today' ? S.start : todayIso();
  const asOf = S.today || iso(addDays(D(start), -1));
  doc.checkins.push({ date: asOf, balance: (+inputs.startBal || 0) + (+inputs.cash || 0) + (+inputs.venmoBal || 0) });
  const id = () => Math.random().toString(36).slice(2, 9);
  if (+inputs.payAmt > 0 && S.firstPay) {
    const end = typeof inputs.sevEnd === 'string' ? inputs.sevEnd : undefined;
    doc.income.push({ id: id(), name: 'Paycheck', amount: +inputs.payAmt, freq: S.payEveryDays === 7 ? 'weekly' : 'biweekly', start: S.firstPay, ...(end ? { end } : {}) });
  }
  if (+inputs.ui > 0 && typeof inputs.sevEnd === 'string') {
    doc.income.push({ id: id(), name: 'Unemployment', amount: +inputs.ui, freq: 'weekly', start: iso(addDays(D(inputs.sevEnd), 14)) });
  }
  const month = start.slice(0, 7);
  const pad = (n) => String(n).padStart(2, '0');
  for (const it of old.items || []) {
    const r = it.rule || {};
    const amount = it.amts ? it.amts.reduce((a, b) => a + b, 0) / 12 : Math.abs(+it.amt || 0);
    const isOn = on[it.id] ?? (it.on !== false);
    const base = { name: it.name.replace(/^INCOME: /, ''), amount: Math.round(amount * 100) / 100, on: isOn };
    const range = { ...(r.to ? { end: monthEnd(r.to + '-01') } : {}) };
    const target = it.amt < 0 ? doc.income : doc.bills;
    const add = (o) => target.push({ id: id(), ...base, ...o, ...range });
    if (r.m != null) {
      const from = r.from || month;
      const [y, m] = from.split('-').map(Number);
      add({ freq: 'monthly', day: r.m, start: `${from}-${pad(Math.min(r.m, dim(y, m - 1)))}` });
    }
    else if (r.months) {
      const ms = [...r.months].sort((a, b) => a - b);
      if (ms.length === 4 && ms.every((m, i) => i === 0 || m - ms[i - 1] === 3)) add({ freq: 'quarterly', start: `${start.slice(0, 4)}-${pad(ms[0])}-${pad(r.d)}` });
      else ms.forEach((m) => add({ freq: 'yearly', start: `${start.slice(0, 4)}-${pad(m)}-${pad(r.d)}` }));
    } else if (r.dates) r.dates.forEach((s) => add({ freq: 'once', start: s }));
  }
  for (const b of old.budget || []) doc.categories.push({ id: b[0], name: b[1], budget: +(budget[b[0]] ?? b[3]) || 0 });
  return doc;
}

// Light shape check for documents that come from storage or an imported file.
export function isDoc(x) {
  return !!x && x.version === 2 && ['checkins', 'income', 'bills', 'categories'].every((k) => Array.isArray(x[k])) && (x.goals === undefined || Array.isArray(x.goals)) && typeof x.settings === 'object';
}

// How a typical month splits up, for the dashboard pie chart.
export function monthPlan(doc) {
  const income = doc.income.reduce((a, it) => a + perMonth(it), 0);
  const bills = doc.bills.reduce((a, b) => a + perMonth(b), 0);
  const everyday = budgetTotal(doc), saving = savingTotal(doc);
  return { income, bills, everyday, saving, left: income - bills - everyday - saving };
}

// ---------- accounts ----------
// Spending accounts (checking, Venmo, cash) add up to the check-in balance. Investment accounts
// (401(k), IRA, brokerage) are tracked on their own and never count toward available money.
export const spendingAccounts = (doc) => (doc.accounts || []).filter((a) => a.kind !== 'investment');
export const investmentAccounts = (doc) => (doc.accounts || []).filter((a) => a.kind === 'investment');

// Latest known balance of each account: { id: { value, date } }.
export function latestValues(doc) {
  const out = {};
  for (const c of doc.checkins) {
    const by = c.by || (doc.accounts?.[0] ? { [doc.accounts[0].id]: c.balance } : {});
    for (const [id, v] of Object.entries(by)) out[id] = { value: v, date: c.date };
  }
  for (const p of doc.portfolio || []) for (const [id, v] of Object.entries(p.values)) out[id] = { value: v, date: p.date };
  return out;
}

// Total investment value at each update, carrying forward accounts not updated that day.
export function portfolioHistory(doc) {
  const ids = new Set(investmentAccounts(doc).map((a) => a.id));
  const cur = {};
  return (doc.portfolio || []).map((p) => {
    Object.assign(cur, p.values);
    const total = Object.entries(cur).filter(([id]) => ids.has(id)).reduce((a, [, v]) => a + v, 0);
    return { date: p.date, total, values: { ...cur } };
  });
}

// ---------- forecast vs actual ----------
// Each check-in keeps the forecast that stood until the next check-in (`plan`: available balance
// for each of the next days) and its own available balance (`avail`). Comparing the next check-in
// against that plan says whether someone came out ahead of or behind the forecast.
export const PLAN_DAYS = 120;
export function planFor(doc, date) {
  return simulate(doc, { today: date, days: PLAN_DAYS }).map((r) => Math.round(r.bal));
}

export function trackRecord(doc) {
  const out = [];
  for (let i = 1; i < doc.checkins.length; i++) {
    const a = doc.checkins[i - 1], b = doc.checkins[i];
    const days = daysBetween(a.date, b.date);
    if (days <= 0) continue;
    if (a.plan && days <= a.plan.length && b.avail != null) {
      const expected = a.plan[days - 1];
      out.push({ from: a.date, to: b.date, days, expected, actual: b.avail, diff: b.avail - expected, exact: true });
    } else {
      // Older check-ins without a saved forecast: estimate with today's bills, income and budget.
      let income = 0, bills = 0;
      for (let d = addDays(D(a.date), 1); iso(d) <= b.date; d = addDays(d, 1)) {
        for (const e of eventsOn(doc, iso(d))) if (e.kind === 'income') income += e.amount; else if (e.kind === 'bill') bills -= e.amount;
      }
      const expected = a.balance + income - bills - (+b.transferred || 0) - budgetTotal(doc) * 12 / 365 * days;
      out.push({ from: a.date, to: b.date, days, expected, actual: b.balance, diff: b.balance - expected, exact: false });
    }
  }
  return out;
}
