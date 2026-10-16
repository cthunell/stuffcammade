// Job pipeline UI. One document per person; every change saves automatically through /api/jobs.
(function () {
  var STAGES = [
    { id: "applied", label: "Applied" },
    { id: "scheduling", label: "Scheduling" },
    { id: "interview", label: "Interviewing" },
    { id: "waiting", label: "Waiting to hear back" },
    { id: "offer", label: "Offer" },
    { id: "declined", label: "Declined" }
  ];
  var STAGE_LABEL = {}, STAGE_NUM = {}, STAGE_FULL = {};
  STAGES.forEach(function (s, i) { s.n = i + 1; STAGE_LABEL[s.id] = s.label; STAGE_NUM[s.id] = s.n; STAGE_FULL[s.id] = s.n + ". " + s.label; });
  var PRIORITIES = [
    { id: "high", label: "High" }, { id: "medium-high", label: "Medium-high" }, { id: "medium", label: "Medium" },
    { id: "medium-low", label: "Medium-low" }, { id: "low", label: "Low" }
  ];
  var PRI_LABEL = {}, PRI_RANK = {};
  PRIORITIES.forEach(function (p, i) { PRI_LABEL[p.id] = p.label; PRI_RANK[p.id] = i; });
  function fmtDateTime(s) {
    if (!s) return "";
    var d = new Date(s);
    if (isNaN(d)) return s;
    return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }
  function payChip(j) {
    var p = (j.pay || "").trim();
    return !p || /^(unknown|tbd)$/i.test(p) ? "Pay: unknown" : p;
  }
  function scheduleText(j) {
    if (j.interviewAt) return "Interview " + fmtDateTime(j.interviewAt);
    if (j.interviewPending) return "Interview date not set yet";
    return "";
  }

  var db = false, jobs = [], rev = 0, loaded = false, loadFailed = false, openId = null, mode = "view", query = "", draggingId = null;
  var $table = document.getElementById("table"), $filters = document.getElementById("filters");

  /* ---------- table view: columns, sort, filter (view settings live in this browser only) ---------- */
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function payNum(j) {
    var m = /\$\s*([\d.]+)\s*(k)?/i.exec(j.pay || "");
    return m ? parseFloat(m[1]) * (m[2] ? 1000 : 1) : null;
  }
  var COLS = [
    { key: "company", label: "Company", sort: function (j) { return (j.company || "").toLowerCase(); } },
    { key: "stage", label: "Stage", sort: function (j) { return STAGE_NUM[j.stage]; } },
    { key: "level", label: "Level", sort: function (j) { return (j.level || "").toLowerCase() || null; } },
    { key: "pay", label: "Pay", sort: payNum },
    { key: "priority", label: "Priority", sort: function (j) { return j.priority ? PRI_RANK[j.priority] : null; } },
    { key: "sells", label: "What they sell", sort: function (j) { return (j.sells || "").toLowerCase() || null; } },
    { key: "title", label: "Job title", sort: function (j) { return (j.title || "").toLowerCase() || null; } },
    { key: "location", label: "Location", sort: function (j) { return (j.location || "").toLowerCase() || null; } },
    { key: "appliedOn", label: "Applied", sort: function (j) { return j.appliedOn || null; } },
    { key: "days", label: "Days in stage", sort: function (j) { return daysSince(j.stageSince || j.appliedOn); } },
    { key: "interview", label: "Interview", sort: function (j) { return j.interviewAt || null; } },
    { key: "rating", label: "Rating", sort: function (j) { return j.interviewRating || null; } },
    { key: "nextStep", label: "Next step", sort: function (j) { return (j.nextStep || "").toLowerCase() || null; } },
    { key: "industry", label: "Industry", sort: function (j) { return (j.industry || "").toLowerCase() || null; } },
    { key: "lostReason", label: "Why lost", sort: function (j) { return (j.lostReason || "").toLowerCase() || null; } }
  ];
  var COLS_BY = {};
  COLS.forEach(function (c) { COLS_BY[c.key] = c; });
  var DEFAULT_HIDDEN = { industry: true, lostReason: true };
  var saved = lsGet("jp-view") || {};
  var view = saved.view === "table" ? "table" : "board";
  var colOrder = COLS.map(function (c) { return c.key; });
  if (Array.isArray(saved.order)) {
    var seen = {}, ord = [];
    saved.order.forEach(function (k) { if (COLS_BY[k] && !seen[k]) { seen[k] = 1; ord.push(k); } });
    colOrder.forEach(function (k) { if (!seen[k]) ord.push(k); });
    colOrder = ord;
  }
  var hiddenCols = saved.hidden && typeof saved.hidden === "object" ? saved.hidden : Object.assign({}, DEFAULT_HIDDEN);
  var sortKey = COLS_BY[saved.sortKey] ? saved.sortKey : "stage", sortDir = saved.sortDir === "desc" ? "desc" : "asc";
  var stageFilter = {}, priFilter = "", colsOpen = false, dragCol = null, lastFocus = "";
  function saveView() { lsSet("jp-view", { view: view, order: colOrder, hidden: hiddenCols, sortKey: sortKey, sortDir: sortDir }); }

  var $board = document.getElementById("board");
  var $overlay = document.getElementById("overlay");
  var $stats = document.getElementById("stats");
  var $toast = document.getElementById("toast");

  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "text") el.textContent = v;
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return el;
  }
  function today() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function parse(iso) { var p = String(iso || "").split("-"); return new Date(+p[0], (+p[1] || 1) - 1, +p[2] || 1); }
  function daysSince(iso) {
    if (!iso) return 0;
    return Math.max(0, Math.round((parse(today()) - parse(iso)) / 86400000));
  }
  function fmtDate(iso) {
    if (!iso) return "";
    return parse(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }
  function ageText(iso) {
    var d = daysSince(iso);
    return d === 0 ? "today" : d === 1 ? "1 day" : d + " days";
  }
  function safeUrl(u) { return /^https?:\/\//i.test(u || "") ? u : null; }
  function toast(msg) {
    $toast.textContent = msg; $toast.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(function () { $toast.hidden = true; }, 3500);
  }

  /* ---------- storage: one document, saved through /api/jobs ---------- */
  var $status = document.getElementById("saveStatus");
  var saveTimer = null, saving = false, dirty = false;
  function setStatus(t) { $status.textContent = t; }
  function queueSave() { dirty = true; setStatus("Saving"); clearTimeout(saveTimer); saveTimer = setTimeout(flush, 500); }
  function apply(doc) {
    var list = doc && Array.isArray(doc.jobs) ? doc.jobs : [];
    jobs = list.map(function (o) {
      o = Object.assign({}, o);
      if (o.stage === "heard" || !STAGE_LABEL[o.stage]) o.stage = "scheduling";
      return o;
    });
    rev = doc && typeof doc.rev === "number" ? doc.rev : 0;
  }
  function flush(keepalive) {
    clearTimeout(saveTimer);
    if (saving || !dirty) return Promise.resolve();
    saving = true; dirty = false;
    return fetch("/api/jobs", { method: "PUT", headers: { "Content-Type": "application/json" }, keepalive: keepalive === true,
      body: JSON.stringify({ version: 1, baseRev: rev, jobs: jobs }) })
      .then(function (res) {
        if (res.status === 401) { dirty = true; setStatus("Signed out. Reload to sign in again."); return; }
        if (res.status === 409) {
          return res.json().then(function (cur) {
            apply(cur.doc); renderBoard();
            toast("This pipeline changed somewhere else. Loaded the newest copy; redo your last edit.");
            setStatus("Saved");
          });
        }
        if (!res.ok) throw new Error(String(res.status));
        return res.json().then(function (out) { rev = out.rev; if (!dirty) setStatus("Saved"); });
      })
      .catch(function () { dirty = true; setStatus("Could not save. Retrying"); clearTimeout(saveTimer); saveTimer = setTimeout(flush, 4000); })
      .then(function () { saving = false; if (dirty && !saveTimer) saveTimer = setTimeout(flush, 500); });
  }
  window.addEventListener("pagehide", function () { if (dirty) flush(true); });
  function patch(id, data) {
    var j = byId(id);
    if (!j) return;
    data.updatedAt = new Date().toISOString();
    Object.assign(j, data);
    queueSave();
  }
  function commitMove(id, stage, extra, note) {
    var j = byId(id);
    if (!j || j.stage === stage) return;
    var entry = { stage: stage, at: today() };
    if (note) entry.note = note;
    var data = extra || {};
    data.stage = stage; data.stageSince = today(); data.history = (j.history || []).concat([entry]);
    patch(id, data);
  }
  /* Moving a card asks follow-up questions for some transitions, then commits. */
  function requestMove(id, stage) {
    var j = byId(id);
    if (!j || j.stage === stage) return;
    var needSchedule = stage === "scheduling" && j.stage === "applied";
    var needRating = j.stage === "interview" && (stage === "offer" || stage === "waiting" || stage === "declined");
    var needReason = stage === "declined";
    if (!needSchedule && !needRating && !needReason) { commitMove(id, stage); return; }
    askMove(j, stage, needSchedule, needRating, needReason);
  }
  function askMove(j, stage, needSchedule, needRating, needReason) {
    var answers = { priority: j.priority || "", rating: 0 };
    var dlg = h("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-label": "Move " + j.company });
    var back = h("div", { class: "dialog-back" }, dlg);
    var error = h("p", { class: "err", role: "alert", hidden: true });
    function close() { if (back.parentNode) back.parentNode.removeChild(back); }
    function choice(group, options, key, labelFn) {
      var wrap = h("div", { class: "row", role: "radiogroup", "aria-label": group });
      var btns = [];
      options.forEach(function (o) {
        var b = h("button", { class: "pill", type: "button", role: "radio", "aria-checked": String(answers[key] === o.v), text: o.t });
        b.addEventListener("click", function () {
          answers[key] = o.v;
          btns.forEach(function (x) { x.setAttribute("aria-checked", String(x === b)); });
        });
        btns.push(b); wrap.appendChild(b);
      });
      return wrap;
    }
    dlg.appendChild(h("h2", { text: "Move " + j.company + " to " + STAGE_FULL[stage] }));
    var dateInput, pending, reason;
    if (needSchedule) {
      dateInput = h("input", { id: "q-date", class: "field", type: "datetime-local" });
      pending = h("input", { id: "q-pending", type: "checkbox" });
      pending.addEventListener("change", function () { dateInput.disabled = pending.checked; if (pending.checked) dateInput.value = ""; });
      dlg.appendChild(h("div", { class: "sec" }, h("label", { class: "label", for: "q-date", text: "When is it scheduled for?" }), dateInput,
        h("label", { class: "check" }, pending, h("span", { text: "Still scheduling, no firm date yet" }))));
      dlg.appendChild(h("div", { class: "sec" }, h("span", { class: "label", text: "Priority" }),
        choice("Priority", PRIORITIES.map(function (p) { return { v: p.id, t: p.label }; }), "priority")));
    }
    if (needRating) {
      var nums = []; for (var i = 1; i <= 10; i++) nums.push({ v: i, t: String(i) });
      dlg.appendChild(h("div", { class: "sec" }, h("span", { class: "label", text: "How did the interview go? (1 to 10)" }), choice("Interview rating", nums, "rating")));
    }
    if (needReason) {
      reason = h("textarea", { id: "q-reason", placeholder: "e.g. They wanted 6+ years of enterprise experience" });
      dlg.appendChild(h("div", { class: "sec" }, h("label", { class: "label", for: "q-reason", text: "Why was this a lost opportunity?" }), reason));
    }
    dlg.appendChild(error);
    var go = h("button", { class: "btn primary", type: "button", text: "Move" });
    go.addEventListener("click", function () {
      var extra = {}, notes = [];
      function fail(m) { error.textContent = m; error.hidden = false; }
      if (needSchedule) {
        if (!answers.priority) return fail("Pick a priority.");
        if (!pending.checked && !dateInput.value) return fail("Enter the interview date, or tick Still scheduling.");
        extra.priority = answers.priority;
        extra.interviewAt = pending.checked ? "" : dateInput.value;
        extra.interviewPending = pending.checked;
        notes.push(pending.checked ? "Date not set yet" : fmtDateTime(dateInput.value));
        notes.push(PRI_LABEL[answers.priority] + " priority");
      }
      if (needRating) {
        if (!answers.rating) return fail("Rate how the interview went.");
        extra.interviewRating = answers.rating;
        notes.push("Interview rated " + answers.rating + "/10");
      }
      if (needReason) {
        var r = reason.value.trim();
        if (!r) return fail("Write down why this one didn't work out.");
        extra.lostReason = r;
        notes.push(r);
      }
      close();
      commitMove(j.id, stage, extra, notes.join(" · "));
    });
    dlg.appendChild(h("div", { class: "actions" }, h("button", { class: "btn", type: "button", text: "Cancel", onclick: close }), go));
    document.body.appendChild(back);
    var first = dlg.querySelector("input, textarea, button.pill");
    if (first) first.focus();
  }
  function byId(id) { return jobs.filter(function (j) { return j.id === id; })[0]; }

  /* ---------- board ---------- */
  function matches(j) {
    if (!query) return true;
    var q = query.toLowerCase();
    return [j.company, j.sells, j.level, j.title].join(" ").toLowerCase().indexOf(q) !== -1;
  }
  function renderStats() {
    var c = {};
    STAGES.forEach(function (s) { c[s.id] = 0; });
    jobs.forEach(function (j) { if (c[j.stage] !== undefined) c[j.stage]++; });
    var active = c.applied + c.scheduling + c.interview + c.waiting;
    var talking = c.scheduling + c.interview + c.waiting;
    $stats.textContent = "";
    [["Active", active], ["In conversation", talking], ["Offers", c.offer], ["Declined", c.declined]].forEach(function (p) {
      $stats.appendChild(h("span", null, h("b", { text: String(p[1]) }), " " + p[0]));
    });
  }
  function card(j) {
    var company = h("span", { class: "company" });
    var site = safeUrl(j.companyUrl);
    if (site) company.appendChild(h("a", { href: site, target: "_blank", rel: "noopener", text: j.company, onclick: function (e) { e.stopPropagation(); }, title: "Open company website" }));
    else company.textContent = j.company;
    var el = h("div", { class: "card", "data-stage": j.stage, draggable: "true", tabindex: "0", role: "button", "aria-label": "Open " + j.company },
      h("div", { class: "card-top" }, company),
      j.sells ? h("div", { class: "sells", text: j.sells }) : null,
      h("div", { class: "chips" },
        j.level ? h("span", { class: "chip", text: j.level }) : null,
        h("span", { class: "chip", text: payChip(j) }),
        j.priority ? h("span", { class: "chip pri pri-" + j.priority, text: PRI_LABEL[j.priority] + " priority" }) : null,
        j.interviewRating ? h("span", { class: "chip", text: "Interview " + j.interviewRating + "/10" }) : null),
      (j.stage === "scheduling" || j.stage === "interview") && scheduleText(j) ? h("div", { class: "next", text: scheduleText(j) }) : null,
      j.nextStep ? h("div", { class: "next", text: j.nextStep }) : null,
      j.stage === "declined" && j.lostReason ? h("div", { class: "reason", text: j.lostReason }) : null,
      h("div", { class: "age", text: daysSince(j.stageSince || j.appliedOn) === 0 ? "Moved here today" : ageText(j.stageSince || j.appliedOn) + " in this stage" })
    );
    el.addEventListener("click", function () { openJob(j.id); });
    el.addEventListener("keydown", function (e) { if ((e.key === "Enter" || e.key === " ") && e.target === el) { e.preventDefault(); openJob(j.id); } });
    el.addEventListener("dragstart", function (e) { draggingId = j.id; el.classList.add("dragging"); try { e.dataTransfer.setData("text/plain", j.id); e.dataTransfer.effectAllowed = "move"; } catch (x) {} });
    el.addEventListener("dragend", function () { draggingId = null; el.classList.remove("dragging"); });
    return el;
  }
  function stateMessage() {
    if (loadFailed) return "Could not load your pipeline. Reload the page to try again.";
    if (!loaded) return "Loading your pipeline";
    if (!jobs.length) return "No opportunities yet. Use Add opportunity, or Import data to load a backup.";
    return "";
  }
  function renderBoard() {
    renderStats();
    $board.hidden = view !== "board"; $table.hidden = view !== "table"; $filters.hidden = view !== "table" || !!stateMessage();
    document.getElementById("v-board").setAttribute("aria-pressed", String(view === "board"));
    document.getElementById("v-table").setAttribute("aria-pressed", String(view === "table"));
    if (view === "table") { renderTable(); return; }
    renderCards();
  }
  function renderCards() {
    $board.textContent = "";
    var msg = stateMessage();
    if (msg) { $board.appendChild(h("div", { class: "state", text: msg })); return; }
    STAGES.forEach(function (s) {
      var list = jobs.filter(function (j) { return j.stage === s.id && matches(j); })
        .sort(function (a, b) {
          var pa = a.priority ? PRI_RANK[a.priority] : 99, pb = b.priority ? PRI_RANK[b.priority] : 99;
          return pa - pb || String(b.stageSince || "").localeCompare(String(a.stageSince || "")) || String(a.company).localeCompare(String(b.company));
        });
      var cards = h("div", { class: "cards" });
      if (list.length) list.forEach(function (j) { cards.appendChild(card(j)); });
      else cards.appendChild(h("div", { class: "empty-col", text: query ? "No matches" : "Nothing here yet" }));
      var col = h("section", { class: "col", "data-stage": s.id, "aria-label": s.label },
        h("div", { class: "col-head" }, h("span", { class: "num", "aria-hidden": "true", text: String(s.n) }), h("h2", { text: s.label }), h("span", { class: "count", text: String(list.length) })),
        cards);
      col.addEventListener("dragover", function (e) { if (draggingId) { e.preventDefault(); col.classList.add("over"); } });
      col.addEventListener("dragleave", function (e) { if (!col.contains(e.relatedTarget)) col.classList.remove("over"); });
      col.addEventListener("drop", function (e) { e.preventDefault(); col.classList.remove("over"); if (draggingId) requestMove(draggingId, s.id); });
      $board.appendChild(col);
    });
  }

  /* ---------- table view ---------- */
  function visibleCols() { return colOrder.filter(function (k) { return !hiddenCols[k]; }).map(function (k) { return COLS_BY[k]; }); }
  function tableRows() {
    var anyStage = Object.keys(stageFilter).length > 0;
    var list = jobs.filter(function (j) {
      if (!matches(j)) return false;
      if (anyStage && !stageFilter[j.stage]) return false;
      if (priFilter === "none") return !j.priority;
      return !priFilter || j.priority === priFilter;
    });
    var col = COLS_BY[sortKey], dir = sortDir === "asc" ? 1 : -1;
    list.sort(function (a, b) {
      var va = col.sort(a), vb = col.sort(b);
      if (va === null || va === undefined) { if (vb === null || vb === undefined) return String(a.company).localeCompare(String(b.company)); return 1; }
      if (vb === null || vb === undefined) return -1;
      var c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return c * dir || String(a.company).localeCompare(String(b.company));
    });
    return list;
  }
  function setSort(key) {
    if (sortKey === key) sortDir = sortDir === "asc" ? "desc" : "asc"; else { sortKey = key; sortDir = "asc"; }
    saveView(); renderBoard();
  }
  function moveCol(key, delta) {
    var i = colOrder.indexOf(key), t = i + delta;
    if (i < 0 || t < 0 || t >= colOrder.length) return;
    colOrder.splice(i, 1); colOrder.splice(t, 0, key);
    saveView(); renderBoard();
  }
  function renderFilters(shown) {
    $filters.textContent = "";
    var chips = h("div", { class: "row", role: "group", "aria-label": "Filter by stage" });
    var anyStage = Object.keys(stageFilter).length > 0;
    var all = h("button", { class: "fchip", type: "button", id: "ff-all", "aria-pressed": String(!anyStage) }, h("span", { text: "All" }), h("span", { class: "cnt", text: String(jobs.length) }));
    all.addEventListener("click", function () { stageFilter = {}; lastFocus = "ff-all"; renderBoard(); });
    chips.appendChild(all);
    STAGES.forEach(function (s) {
      var n = jobs.filter(function (j) { return j.stage === s.id; }).length;
      var b = h("button", { class: "fchip", type: "button", id: "ff-" + s.id, "data-stage": s.id, "aria-pressed": String(!!stageFilter[s.id]), "aria-label": s.label + ", " + n + (n === 1 ? " opportunity" : " opportunities") },
        h("span", { class: "num", "aria-hidden": "true", text: String(s.n) }), h("span", { text: s.label }), h("span", { class: "cnt" + (n ? "" : " zero"), "aria-hidden": "true", text: String(n) }));
      b.addEventListener("click", function () { if (stageFilter[s.id]) delete stageFilter[s.id]; else stageFilter[s.id] = true; lastFocus = "ff-" + s.id; renderBoard(); });
      chips.appendChild(b);
    });
    var pri = h("select", { id: "ff-pri", class: "field narrow", "aria-label": "Filter by priority" },
      h("option", { value: "", text: "Any priority" }));
    PRIORITIES.forEach(function (p) { pri.appendChild(h("option", { value: p.id, text: p.label })); });
    pri.appendChild(h("option", { value: "none", text: "No priority" }));
    pri.value = priFilter;
    pri.addEventListener("change", function () { priFilter = pri.value; lastFocus = "ff-pri"; renderBoard(); });
    var colBtn = h("button", { class: "btn small", id: "cols-btn", type: "button", "aria-expanded": String(colsOpen), text: "Columns" });
    colBtn.addEventListener("click", function () { colsOpen = !colsOpen; lastFocus = "cols-btn"; renderBoard(); });
    var right = h("div", { class: "row center" }, h("span", { class: "count", text: shown + " of " + jobs.length }), pri, colBtn);
    $filters.appendChild(chips); $filters.appendChild(right);
    if (colsOpen) {
      var menu = h("div", { class: "colmenu", role: "group", "aria-label": "Columns" },
        h("p", { class: "label", text: "Show, hide and reorder columns" }));
      colOrder.forEach(function (k, i) {
        var cb = h("input", { type: "checkbox", id: "cm-" + k }); cb.checked = !hiddenCols[k];
        cb.addEventListener("change", function () { if (cb.checked) delete hiddenCols[k]; else hiddenCols[k] = true; lastFocus = "cm-" + k; saveView(); renderBoard(); });
        var up = h("button", { class: "icon-btn", type: "button", id: "cm-up-" + k, "aria-label": "Move " + COLS_BY[k].label + " left", text: "↑", disabled: i === 0 });
        var dn = h("button", { class: "icon-btn", type: "button", id: "cm-dn-" + k, "aria-label": "Move " + COLS_BY[k].label + " right", text: "↓", disabled: i === colOrder.length - 1 });
        up.addEventListener("click", function () { lastFocus = "cm-up-" + k; moveCol(k, -1); });
        dn.addEventListener("click", function () { lastFocus = "cm-dn-" + k; moveCol(k, 1); });
        menu.appendChild(h("div", { class: "colrow" }, h("label", { class: "check", for: "cm-" + k }, cb, h("span", { text: COLS_BY[k].label })), h("span", { class: "row" }, up, dn)));
      });
      menu.appendChild(h("button", { class: "btn small", type: "button", text: "Reset columns", onclick: function () {
        colOrder = COLS.map(function (c) { return c.key; }); hiddenCols = Object.assign({}, DEFAULT_HIDDEN); saveView(); renderBoard(); } }));
      $filters.appendChild(menu);
    }
  }
  function cellFor(col, j) {
    var td = h("td", { "data-col": col.key });
    switch (col.key) {
      case "company":
        td.appendChild(h("div", { class: "cell-company" },
          h("button", { class: "link-btn", type: "button", text: j.company, onclick: function (e) { e.stopPropagation(); openJob(j.id); } }),
          safeUrl(j.companyUrl) ? h("a", { href: safeUrl(j.companyUrl), target: "_blank", rel: "noopener", "aria-label": "Open " + j.company + " website", title: "Open company website", text: "↗" }) : null));
        break;
      case "stage": {
        var sel = h("select", { class: "stage-select", "data-stage": j.stage, "aria-label": "Stage for " + j.company });
        STAGES.forEach(function (s) { sel.appendChild(h("option", { value: s.id, text: STAGE_FULL[s.id] })); });
        sel.value = j.stage;
        sel.addEventListener("change", function () { var v = sel.value; requestMove(j.id, v); renderBoard(); });
        td.appendChild(sel); break;
      }
      case "priority": {
        var ps = h("select", { class: "cell-select", "aria-label": "Priority for " + j.company }, h("option", { value: "", text: "—" }));
        PRIORITIES.forEach(function (p) { ps.appendChild(h("option", { value: p.id, text: p.label })); });
        ps.value = j.priority || "";
        ps.addEventListener("change", function () { patch(j.id, { priority: ps.value }); });
        td.appendChild(ps); break;
      }
      case "pay": {
        var unknown = payChip(j) === "Pay: unknown";
        td.appendChild(h("span", { class: unknown ? "dim" : "mono", text: unknown ? "Unknown" : j.pay })); break;
      }
      case "level": td.textContent = j.level || ""; break;
      case "sells": td.textContent = j.sells || ""; td.className = "wide"; break;
      case "title": td.textContent = j.title || ""; break;
      case "location": td.textContent = j.location || ""; break;
      case "industry": td.textContent = j.industry || ""; break;
      case "appliedOn": td.textContent = fmtDate(j.appliedOn); td.className = "mono"; break;
      case "days": td.textContent = daysSince(j.stageSince || j.appliedOn) + "d"; td.className = "mono"; break;
      case "interview": td.textContent = scheduleText(j).replace(/^Interview /, ""); break;
      case "rating": td.textContent = j.interviewRating ? j.interviewRating + "/10" : ""; td.className = "mono"; break;
      case "nextStep": td.textContent = j.nextStep || ""; break;
      case "lostReason": td.textContent = j.lostReason || ""; td.className = "wide"; break;
    }
    return td;
  }
  function renderTable() {
    var msg = stateMessage();
    $table.textContent = "";
    if (msg) { $table.appendChild(h("div", { class: "state", text: msg })); return; }
    var rows = tableRows(), cols = visibleCols();
    renderFilters(rows.length);
    var head = h("tr");
    cols.forEach(function (c, i) {
      var active = sortKey === c.key;
      var btn = h("button", { class: "th-btn", type: "button", "aria-label": "Sort by " + c.label },
        h("span", { text: c.label }), h("span", { class: "arrow", "aria-hidden": "true", text: active ? (sortDir === "asc" ? "▲" : "▼") : "" }));
      btn.addEventListener("click", function () { setSort(c.key); });
      var th = h("th", { scope: "col", draggable: "true", "data-col": c.key, class: i === 0 ? "sticky" : null, "aria-sort": active ? (sortDir === "asc" ? "ascending" : "descending") : "none", title: "Drag to reorder" }, btn);
      th.addEventListener("dragstart", function (e) { dragCol = c.key; try { e.dataTransfer.setData("text/plain", c.key); e.dataTransfer.effectAllowed = "move"; } catch (x) {} });
      th.addEventListener("dragend", function () { dragCol = null; $table.querySelectorAll("th.over").forEach(function (t) { t.classList.remove("over"); }); });
      th.addEventListener("dragover", function (e) { if (dragCol && dragCol !== c.key) { e.preventDefault(); th.classList.add("over"); } });
      th.addEventListener("dragleave", function () { th.classList.remove("over"); });
      th.addEventListener("drop", function (e) {
        e.preventDefault(); th.classList.remove("over");
        if (!dragCol || dragCol === c.key) return;
        colOrder.splice(colOrder.indexOf(dragCol), 1);
        colOrder.splice(colOrder.indexOf(c.key), 0, dragCol);
        dragCol = null; saveView(); renderBoard();
      });
      head.appendChild(th);
    });
    var body = h("tbody");
    rows.forEach(function (j) {
      var tr = h("tr", { "data-stage": j.stage, class: j.stage === "declined" ? "declined" : null });
      cols.forEach(function (c, i) { var td = cellFor(c, j); if (i === 0) td.classList.add("sticky"); tr.appendChild(td); });
      tr.addEventListener("click", function (e) { if (!e.target.closest("select, a, button")) openJob(j.id); });
      body.appendChild(tr);
    });
    if (!rows.length) body.appendChild(h("tr", null, h("td", { colspan: String(cols.length), class: "dim", text: "No opportunities match these filters." })));
    var tbl = h("table", { class: "grid" }, h("thead", null, head), body);
    $table.appendChild(h("div", { class: "scroll" }, tbl));
    if (lastFocus) { var f = document.getElementById(lastFocus); if (f) f.focus(); lastFocus = ""; }
  }

  /* ---------- panel ---------- */
  function closePanel() { openId = null; mode = "view"; $overlay.textContent = ""; }
  function openJob(id) { openId = id; mode = "view"; renderPanel(); }
  function shell(content) {
    $overlay.textContent = "";
    $overlay.appendChild(h("div", { class: "scrim", onclick: closePanel }));
    var p = h("aside", { class: "panel", role: "dialog", "aria-modal": "true", "aria-label": "Opportunity details" });
    content.forEach(function (c) { if (c) p.appendChild(c); });
    $overlay.appendChild(p);
    return p;
  }
  function fact(label, value) {
    return h("div", { class: "sec" }, h("span", { class: "label", text: label }), h("p", { text: value || "Not listed" }));
  }
  function renderPanel() {
    if (mode === "edit" || mode === "new") return renderForm();
    var j = byId(openId);
    if (!j) { closePanel(); return; }
    var site = safeUrl(j.companyUrl), post = safeUrl(j.jobUrl);
    var nextInput = h("input", { id: "nextStep", class: "field", type: "text", value: j.nextStep || "", placeholder: "e.g. Intro call Thursday 2pm" });
    nextInput.addEventListener("change", function () { patch(j.id, { nextStep: nextInput.value.trim() }); });
    var notes = h("textarea", { id: "notes", placeholder: "Contacts, what they said, questions to ask" });
    notes.value = j.notes || "";
    notes.addEventListener("change", function () { patch(j.id, { notes: notes.value }); });
    var pills = h("div", { class: "row", role: "group", "aria-label": "Stage" });
    STAGES.forEach(function (s) {
      var b = h("button", { class: "pill", type: "button", "data-stage": s.id, "aria-pressed": String(j.stage === s.id), text: STAGE_FULL[s.id] });
      b.addEventListener("click", function () { requestMove(j.id, s.id); });
      pills.appendChild(b);
    });
    var priSel = h("select", { id: "priority", class: "field" }, h("option", { value: "", text: "Not set" }));
    PRIORITIES.forEach(function (p) { priSel.appendChild(h("option", { value: p.id, text: p.label })); });
    priSel.value = j.priority || "";
    priSel.addEventListener("change", function () { patch(j.id, { priority: priSel.value }); });
    var when = h("input", { id: "interviewAt", class: "field", type: "datetime-local", value: j.interviewAt || "" });
    var pend = h("input", { id: "interviewPending", type: "checkbox" });
    pend.checked = !!j.interviewPending && !j.interviewAt;
    when.disabled = pend.checked;
    when.addEventListener("change", function () { patch(j.id, { interviewAt: when.value, interviewPending: !when.value && pend.checked }); });
    pend.addEventListener("change", function () {
      when.disabled = pend.checked;
      if (pend.checked) when.value = "";
      patch(j.id, { interviewPending: pend.checked, interviewAt: pend.checked ? "" : when.value });
    });
    var rateSel = h("select", { id: "rating", class: "field" }, h("option", { value: "", text: "Not rated" }));
    for (var r = 1; r <= 10; r++) rateSel.appendChild(h("option", { value: String(r), text: r + " / 10" }));
    rateSel.value = j.interviewRating ? String(j.interviewRating) : "";
    rateSel.addEventListener("change", function () { patch(j.id, { interviewRating: rateSel.value ? +rateSel.value : 0 }); });
    var lost = null;
    if (j.stage === "declined" || j.lostReason) {
      lost = h("textarea", { id: "lostReason", placeholder: "Why this one didn't work out" });
      lost.value = j.lostReason || "";
      lost.addEventListener("change", function () { patch(j.id, { lostReason: lost.value }); });
    }
    var tracking = h("div", { class: "facts" },
      h("div", { class: "sec" }, h("label", { class: "label", for: "priority", text: "Priority" }), priSel),
      h("div", { class: "sec" }, h("label", { class: "label", for: "rating", text: "Interview rating" }), rateSel),
      h("div", { class: "sec full" }, h("label", { class: "label", for: "interviewAt", text: "Interview date" }), when,
        h("label", { class: "check" }, pend, h("span", { text: "Still scheduling, no firm date yet" }))));
    var tl = h("ul", { class: "timeline" });
    (j.history || []).slice().reverse().forEach(function (e) {
      tl.appendChild(h("li", { "data-stage": e.stage }, h("time", { text: fmtDate(e.at) }), h("span", null, h("b", { text: STAGE_FULL[e.stage] || e.stage }), e.note ? h("span", { class: "note", text: " · " + e.note }) : null)));
    });
    shell([
      h("div", { class: "panel-head" },
        h("div", null, h("h2", { text: j.company }), h("div", { class: "sub", text: [j.title, j.level].filter(Boolean).join(" · ") })),
        h("div", { class: "row" },
          h("button", { class: "btn small", type: "button", text: "Edit", onclick: function () { mode = "edit"; renderPanel(); } }),
          h("button", { class: "btn small", type: "button", text: "Close", onclick: closePanel }))),
      h("div", { class: "sec", "data-stage": j.stage }, h("span", { class: "label", text: "Stage" }), pills),
      h("div", { class: "sec" }, h("label", { class: "label", for: "nextStep", text: "Next step" }), nextInput),
      tracking,
      lost ? h("div", { class: "sec" }, h("label", { class: "label", for: "lostReason", text: "Why it was lost" }), lost) : null,
      h("div", { class: "sec" }, h("span", { class: "label", text: "What they sell" }), h("p", { text: j.sells || "Not listed" })),
      h("div", { class: "facts" }, fact("Pay", j.payDetail || (/^(unknown|tbd)?$/i.test((j.pay || "").trim()) ? "Unknown" : j.pay)), fact("Location", j.location), fact("Industry", j.industry), fact("Applied", fmtDate(j.appliedOn))),
      j.details ? h("div", { class: "sec" }, h("span", { class: "label", text: "Details" }), h("p", { text: j.details })) : null,
      h("div", { class: "links" },
        post ? h("a", { href: post, target: "_blank", rel: "noopener", text: "Job posting" }) : null,
        site ? h("a", { href: site, target: "_blank", rel: "noopener", text: "Company website" }) : null),
      h("div", { class: "sec" }, h("label", { class: "label", for: "notes", text: "Notes" }), notes),
      h("div", { class: "sec" }, h("span", { class: "label", text: "History" }), tl)
    ]);
  }
  var FIELDS = [
    ["company", "Company", "text", true, "Required"],
    ["companyUrl", "Company website", "url", false, "https://"],
    ["title", "Job title", "text", false, ""],
    ["level", "Level", "text", false, "IC, Manager, Director"],
    ["pay", "Pay, short (shown on card)", "text", false, "$175-220k OTE, or leave blank for unknown"],
    ["payDetail", "Pay, full", "text", true, ""],
    ["location", "Location", "text", false, ""],
    ["industry", "Industry", "text", false, ""],
    ["jobUrl", "Job posting link", "url", true, "https://"],
    ["appliedOn", "Date applied", "date", false, ""],
    ["sells", "What they sell (one line)", "text", true, ""],
    ["details", "Details", "textarea", true, "What they offer, what you'd be selling, requirements, perks"]
  ];
  function renderForm() {
    var isNew = mode === "new";
    var j = isNew ? { appliedOn: today() } : byId(openId);
    if (!j) { closePanel(); return; }
    var inputs = {};
    var grid = h("div", { class: "form" });
    FIELDS.forEach(function (f) {
      var el = f[2] === "textarea" ? h("textarea", { id: "f-" + f[0], placeholder: f[4] }) : h("input", { id: "f-" + f[0], type: f[2], placeholder: f[4] });
      el.value = j[f[0]] || "";
      if (f[2] !== "textarea") el.className = "field";
      inputs[f[0]] = el;
      grid.appendChild(h("label", { class: f[3] ? "full" : "" }, h("span", { class: "label", text: f[1] }), el));
    });
    var confirmed = false;
    var del = isNew ? null : h("button", { class: "btn danger", type: "button", text: "Delete" });
    if (del) del.addEventListener("click", function () {
      if (!confirmed) { confirmed = true; del.textContent = "Confirm delete"; return; }
      jobs = jobs.filter(function (x) { return x.id !== j.id; }); queueSave(); closePanel(); renderBoard();
    });
    var save = h("button", { class: "btn primary", type: "button", text: isNew ? "Add to pipeline" : "Save" });
    save.addEventListener("click", function () {
      var data = {};
      FIELDS.forEach(function (f) { data[f[0]] = inputs[f[0]].value.trim(); });
      if (!data.company) { toast("Add a company name first."); inputs.company.focus(); return; }
      if (!data.pay) data.pay = "Unknown";
      if (data.companyUrl && !safeUrl(data.companyUrl)) { toast("Company website must start with http:// or https://"); return; }
      if (data.jobUrl && !safeUrl(data.jobUrl)) { toast("Job posting link must start with http:// or https://"); return; }
      if (isNew) {
        var id = (data.company.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "job") + "-" + Date.now().toString(36);
        data.stage = "applied"; data.stageSince = data.appliedOn || today(); data.nextStep = ""; data.notes = "";
        data.history = [{ stage: "applied", at: data.stageSince }]; data.updatedAt = new Date().toISOString();
        data.id = id; jobs.push(data); queueSave(); renderBoard(); openId = id; mode = "view"; renderPanel();
      } else {
        patch(j.id, data); mode = "view"; renderPanel();
      }
    });
    shell([
      h("div", { class: "panel-head" }, h("h2", { text: isNew ? "Add opportunity" : "Edit " + j.company }),
        h("button", { class: "btn small", type: "button", text: "Cancel", onclick: function () { if (isNew) closePanel(); else { mode = "view"; renderPanel(); } } })),
      grid,
      h("div", { class: "actions" }, del || h("span"), save)
    ]);
  }

  /* ---------- wiring ---------- */
  document.getElementById("add").addEventListener("click", function () { openId = null; mode = "new"; renderPanel(); });
  document.getElementById("v-board").addEventListener("click", function () { view = "board"; saveView(); renderBoard(); });
  document.getElementById("v-table").addEventListener("click", function () { view = "table"; saveView(); renderBoard(); });
  document.getElementById("search").addEventListener("input", function (e) { query = e.target.value.trim(); renderBoard(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && $overlay.firstChild) closePanel(); });

  renderBoard();

  function refreshPanel() {
    renderBoard();
    if (openId && mode === "view") {
      var panel = $overlay.querySelector(".panel");
      if (!panel || !panel.contains(document.activeElement)) renderPanel();
    }
  }
  function load() {
    return fetch("/api/jobs", { cache: "no-store" }).then(function (res) {
      if (res.status === 401) { location.href = "/api/auth/signin?callbackUrl=%2Fjobs"; return; }
      if (!res.ok) throw new Error(String(res.status));
      return res.json().then(function (out) { apply(out.doc); db = true; loaded = true; loadFailed = false; refreshPanel(); });
    }).catch(function () { if (!loaded) { loaded = true; loadFailed = true; renderBoard(); } });
  }
  // Pick up changes made elsewhere (another device, or Claude) when you come back to the tab.
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && loaded && !dirty && !saving) load();
  });

  /* ---------- import and backup ---------- */
  var $file = document.getElementById("import");
  document.getElementById("import-btn").addEventListener("click", function () { $file.click(); });
  $file.addEventListener("change", function () {
    var f = $file.files && $file.files[0];
    $file.value = "";
    if (!f) return;
    f.text().then(function (text) {
      var data;
      try { data = JSON.parse(text); } catch (e) { toast("That file is not valid JSON."); return; }
      var incoming = Array.isArray(data) ? data : data && data.jobs;
      if (!Array.isArray(incoming) || !incoming.every(function (o) { return o && typeof o.id === "string" && typeof o.company === "string"; })) { toast("That file is not pipeline data."); return; }
      var have = {}; jobs.forEach(function (j) { have[j.id] = true; });
      var added = 0;
      incoming.forEach(function (o) { if (!have[o.id]) { var c = Object.assign({}, o); if (c.stage === "heard" || !STAGE_LABEL[c.stage]) c.stage = "scheduling"; jobs.push(c); added++; } });
      db = true; loaded = true; loadFailed = false;
      if (added) queueSave();
      renderBoard();
      toast(added ? "Imported " + added + (added === 1 ? " opportunity." : " opportunities.") : "Nothing new to import.");
    });
  });
  document.getElementById("backup-btn").addEventListener("click", function () {
    var blob = new Blob([JSON.stringify({ version: 1, rev: rev, jobs: jobs }, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "job-pipeline-" + today() + ".json";
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });

  load();
})();
